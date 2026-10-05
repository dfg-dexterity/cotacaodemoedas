/**
 * GET /api/ptax?moeda=EUR&inicio=2026-09-01&fim=2026-09-30[&boletins=todos]
 *
 * PTAX do Banco Central para uma das dez moedas da PTAX (USD, EUR, GBP, JPY, CHF,
 * CAD, AUD, DKK, NOK, SEK) no período, direto da API Olinda (serviço PTAX v1,
 * CotacaoMoedaPeriodo). Por padrão devolve só o boletim de fechamento de cada dia;
 * com `boletins=todos`, também os de Abertura e Intermediários.
 *
 * 200 → { moeda, nome, tipo, inicio, fim, boletins, fonte,
 *         cotacoes: [{ data, dataHora, boletim, compra, venda, paridadeCompra, paridadeVenda }] }
 *       em ordem cronológica.
 * 400 → parâmetro inválido (moeda fora da lista, data inválida, início > fim, mais de 10 anos).
 * 404 → nenhuma cotação no período (fim de semana, feriado, boletim do dia ainda não publicado).
 * 502 → o Banco Central não respondeu ou respondeu fora do formato.
 *
 * Cache na borda da Vercel: período encerrado = 1 dia; período que inclui hoje
 * (horário de Brasília) = 15 min, servindo o anterior por até 1 h enquanto revalida.
 */
import {
  FONTE,
  MOEDAS,
  fmtDataBr,
  hojeEmSaoPaulo,
  moedaPorCodigo,
  normalizarOlinda,
  paraDataOlinda,
  validarPeriodo,
} from '../assets/ptax.js'

const OLINDA = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/'
const TIMEOUT_MS = 25_000
const CACHE_ENCERRADO = 's-maxage=86400'
const CACHE_HOJE = 's-maxage=900, stale-while-revalidate=3600'

/** URL do CotacaoMoedaPeriodo com as datas no formato 'MM-DD-AAAA' da Olinda. */
export function urlOlinda(moeda, inicio, fim) {
  return (
    `${OLINDA}CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${moeda}'&@dataInicial='${paraDataOlinda(inicio)}'&@dataFinalCotacao='${paraDataOlinda(fim)}'` +
    `&$format=json&$select=paridadeCompra,paridadeVenda,cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim`
  )
}

class ErroBcb extends Error {
  constructor(mensagem, repetir) {
    super(mensagem)
    this.repetir = repetir
  }
}

/** Consulta a Olinda; repete uma vez em falha de rede ou HTTP 5xx (não em tempo esgotado nem em resposta malformada). */
async function consultarOlinda(url) {
  let ultimo
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!r.ok) throw new ErroBcb(`o Banco Central respondeu HTTP ${r.status}`, r.status >= 500)
      let corpo
      try {
        corpo = await r.json()
      } catch {
        throw new ErroBcb('a resposta do Banco Central não veio em JSON', false)
      }
      if (!corpo || !Array.isArray(corpo.value)) throw new ErroBcb('a resposta do Banco Central veio em formato inesperado', false)
      return corpo.value
    } catch (e) {
      ultimo = e
      const tempoEsgotado = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
      if (tempoEsgotado) {
        ultimo = new ErroBcb(`o Banco Central não respondeu em ${TIMEOUT_MS / 1000} s`, false)
        break
      }
      const repetir = e instanceof ErroBcb ? e.repetir : true
      if (!repetir) break
    }
  }
  throw ultimo
}

function responder(res, status, corpo, cache) {
  res.setHeader('Cache-Control', cache)
  res.status(status).send(JSON.stringify(corpo))
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  const metodo = String(req.method || 'GET').toUpperCase()
  if (metodo === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store')
    res.status(204).send('')
    return
  }
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    res.setHeader('Allow', 'GET, OPTIONS')
    responder(res, 405, { error: 'Método não suportado: use GET.' }, 'no-store')
    return
  }

  const query = req.query ?? Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams)
  const q = (k) => {
    let v = query?.[k] ?? ''
    if (Array.isArray(v)) v = v[0]
    return String(v).trim()
  }

  const moeda = q('moeda').toUpperCase()
  const info = moedaPorCodigo(moeda)
  if (!info) {
    const lista = MOEDAS.map((m) => m.codigo).join(', ')
    responder(res, 400, { error: `Parâmetro "moeda" inválido: use uma das moedas da PTAX (${lista}).` }, 'no-store')
    return
  }

  const inicio = q('inicio')
  const fim = q('fim')
  const periodo = validarPeriodo(inicio, fim)
  if (!periodo.ok) {
    responder(res, 400, { error: periodo.erro }, 'no-store')
    return
  }

  const boletins = (q('boletins') || 'fechamento').toLowerCase()
  if (boletins !== 'fechamento' && boletins !== 'todos') {
    responder(res, 400, { error: 'Parâmetro "boletins" inválido: use "fechamento" (padrão) ou "todos".' }, 'no-store')
    return
  }

  const incluiHoje = fim >= hojeEmSaoPaulo()

  let lista
  try {
    lista = await consultarOlinda(urlOlinda(moeda, inicio, fim))
  } catch (e) {
    responder(
      res,
      502,
      { error: `Não foi possível consultar a PTAX no Banco Central: ${e.message}. Tente de novo em alguns minutos.`, moeda, inicio, fim },
      'no-store',
    )
    return
  }

  const cotacoes = normalizarOlinda(lista, { boletins })
  if (!cotacoes.length) {
    responder(
      res,
      404,
      {
        error:
          `Sem cotação PTAX${boletins === 'todos' ? '' : ' de fechamento'} de ${moeda} entre ${fmtDataBr(inicio)} e ${fmtDataBr(fim)} ` +
          '(fim de semana, feriado ou boletim do dia ainda não publicado).',
        moeda,
        inicio,
        fim,
        cotacoes: [],
      },
      incluiHoje ? 's-maxage=300' : CACHE_ENCERRADO,
    )
    return
  }

  responder(
    res,
    200,
    { moeda, nome: info.nome, tipo: info.tipo, inicio, fim, boletins, fonte: FONTE, cotacoes },
    incluiHoje ? CACHE_HOJE : CACHE_ENCERRADO,
  )
}
