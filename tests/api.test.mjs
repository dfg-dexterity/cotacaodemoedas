import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import handler, { urlOlinda } from '../api/ptax.js'
import { hojeEmSaoPaulo, somarDias } from '../assets/ptax.js'
import { OLINDA_EUR } from './olinda-fixture.mjs'

/* res mínimo com a mesma interface das funções da Vercel (status/setHeader/send). */
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
  }
}

async function chamar(query, method = 'GET') {
  const res = fakeRes()
  await handler({ method, query }, res)
  let json = null
  try { json = res.body ? JSON.parse(res.body) : null } catch { /* 204 */ }
  return { status: res.statusCode, headers: res.headers, json }
}

const fetchOriginal = globalThis.fetch
let chamadas = []

/** Troca o fetch global por um que responde com `fn(url)` (Response, objeto { value } ou exceção). */
function simularFetch(fn) {
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url: String(url), opts })
    const r = await fn(String(url))
    if (r instanceof Response) return r
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

beforeEach(() => { chamadas = [] })
afterEach(() => { globalThis.fetch = fetchOriginal })

describe('GET /api/ptax — sucesso', () => {
  it('monta a URL do CotacaoMoedaPeriodo com datas MM-DD-AAAA', () => {
    const u = urlOlinda('EUR', '2026-09-01', '2026-09-30')
    assert.ok(u.startsWith('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?'))
    assert.ok(u.includes("@moeda='EUR'"))
    assert.ok(u.includes("@dataInicial='09-01-2026'"))
    assert.ok(u.includes("@dataFinalCotacao='09-30-2026'"))
    assert.ok(u.includes('$format=json'))
    assert.ok(u.includes('$select=paridadeCompra,paridadeVenda,cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim'))
  })

  it('devolve só o fechamento de cada dia, ordenado, com CORS, JSON e cache de período encerrado', async () => {
    simularFetch(() => ({ value: OLINDA_EUR }))
    const r = await chamar({ moeda: 'eur', inicio: '2026-09-14', fim: '2026-09-16' })
    assert.equal(r.status, 200)
    assert.equal(chamadas.length, 1)
    assert.ok(chamadas[0].url.includes("@moeda='EUR'"))
    assert.ok(chamadas[0].url.includes("@dataInicial='09-14-2026'"))
    assert.ok(chamadas[0].opts.signal instanceof AbortSignal)
    assert.equal(r.headers['access-control-allow-origin'], '*')
    assert.match(r.headers['content-type'], /^application\/json/)
    assert.equal(r.headers['cache-control'], 's-maxage=86400')
    assert.equal(r.json.moeda, 'EUR')
    assert.equal(r.json.nome, 'Euro')
    assert.equal(r.json.tipo, 'B')
    assert.equal(r.json.inicio, '2026-09-14')
    assert.equal(r.json.fim, '2026-09-16')
    assert.equal(r.json.boletins, 'fechamento')
    assert.deepEqual(r.json.cotacoes.map((c) => c.data), ['2026-09-14', '2026-09-15', '2026-09-16'])
    assert.ok(r.json.cotacoes.every((c) => /^fech/i.test(c.boletim)))
    assert.deepEqual(r.json.cotacoes[1], {
      data: '2026-09-15',
      dataHora: '2026-09-15 13:09:27.395',
      boletim: 'Fechamento PTAX',
      compra: 6.3002,
      venda: 6.3021,
      paridadeCompra: 1.1712,
      paridadeVenda: 1.1713,
    })
  })

  it('boletins=todos inclui Abertura e Intermediário', async () => {
    simularFetch(() => ({ value: OLINDA_EUR }))
    const r = await chamar({ moeda: 'EUR', inicio: '2026-09-14', fim: '2026-09-16', boletins: 'todos' })
    assert.equal(r.status, 200)
    assert.equal(r.json.boletins, 'todos')
    assert.equal(r.json.cotacoes.length, 6)
    assert.equal(r.json.cotacoes[0].boletim, 'Abertura')
  })

  it('período que inclui hoje tem cache curto na borda', async () => {
    const hoje = hojeEmSaoPaulo()
    simularFetch(() => ({ value: [{ ...OLINDA_EUR[0], dataHoraCotacao: `${somarDias(hoje, -1)} 13:09:27.395` }] }))
    const r = await chamar({ moeda: 'USD', inicio: somarDias(hoje, -10), fim: hoje })
    assert.equal(r.status, 200)
    assert.equal(r.headers['cache-control'], 's-maxage=900, stale-while-revalidate=3600')
  })

  it('aceita query como lista (primeiro valor) e OPTIONS para pré-voo', async () => {
    simularFetch(() => ({ value: OLINDA_EUR }))
    const r = await chamar({ moeda: ['EUR', 'USD'], inicio: '2026-09-14', fim: '2026-09-16' })
    assert.equal(r.json.moeda, 'EUR')
    const o = await chamar({}, 'OPTIONS')
    assert.equal(o.status, 204)
    assert.equal(o.headers['access-control-allow-origin'], '*')
  })
})

describe('GET /api/ptax — validação (400/405, sem consultar o BCB)', () => {
  beforeEach(() => simularFetch(() => { throw new Error('não deveria consultar o BCB') }))

  const casos = [
    ['moeda fora da lista', { moeda: 'BRL', inicio: '2026-09-01', fim: '2026-09-30' }, /"moeda" inválido.*USD, EUR, GBP, JPY, CHF, CAD, AUD, DKK, NOK, SEK/],
    ['moeda ausente', { inicio: '2026-09-01', fim: '2026-09-30' }, /"moeda" inválido/],
    ['data inicial inexistente', { moeda: 'USD', inicio: '2026-02-30', fim: '2026-03-30' }, /"inicio" inválido/],
    ['data final em outro formato', { moeda: 'USD', inicio: '2026-09-01', fim: '30/09/2026' }, /"fim" inválido/],
    ['início depois do fim', { moeda: 'USD', inicio: '2026-10-01', fim: '2026-09-30' }, /posterior/],
    ['mais de 10 anos', { moeda: 'USD', inicio: '2015-01-01', fim: '2026-09-30' }, /10 anos/],
    ['boletins inválido', { moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30', boletins: 'abertura' }, /"boletins" inválido/],
  ]
  for (const [nome, query, erro] of casos) {
    it(nome, async () => {
      const r = await chamar(query)
      assert.equal(r.status, 400)
      assert.match(r.json.error, erro)
      assert.equal(r.headers['cache-control'], 'no-store')
      assert.equal(r.headers['access-control-allow-origin'], '*')
      assert.equal(chamadas.length, 0)
    })
  }

  it('POST → 405', async () => {
    const r = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' }, 'POST')
    assert.equal(r.status, 405)
    assert.equal(chamadas.length, 0)
  })
})

describe('GET /api/ptax — sem cotação (404)', () => {
  it('lista vazia (fim de semana ou feriado)', async () => {
    simularFetch(() => ({ value: [] }))
    const r = await chamar({ moeda: 'GBP', inicio: '2026-09-19', fim: '2026-09-20' })
    assert.equal(r.status, 404)
    assert.match(r.json.error, /Sem cotação PTAX de fechamento de GBP entre 19\/09\/2026 e 20\/09\/2026/)
    assert.deepEqual(r.json.cotacoes, [])
    assert.equal(r.headers['cache-control'], 's-maxage=86400')
  })

  it('só boletins intermediários no dia (fechamento ainda não publicado)', async () => {
    const hoje = hojeEmSaoPaulo()
    simularFetch(() => ({
      value: [
        { ...OLINDA_EUR[1], dataHoraCotacao: `${hoje} 10:04:21.233` },
        { ...OLINDA_EUR[2], dataHoraCotacao: `${hoje} 11:06:02.101` },
      ],
    }))
    const r = await chamar({ moeda: 'EUR', inicio: hoje, fim: hoje })
    assert.equal(r.status, 404)
    assert.equal(r.headers['cache-control'], 's-maxage=300')
    const todos = await chamar({ moeda: 'EUR', inicio: hoje, fim: hoje, boletins: 'todos' })
    assert.equal(todos.status, 200)
    assert.equal(todos.json.cotacoes.length, 2)
  })
})

describe('GET /api/ptax — falha do Banco Central (502)', () => {
  it('erro de rede: tenta de novo uma vez e responde 502 com mensagem clara', async () => {
    simularFetch(() => { throw new TypeError('fetch failed') })
    const r = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(r.status, 502)
    assert.equal(chamadas.length, 2)
    assert.match(r.json.error, /^Não foi possível consultar a PTAX no Banco Central: fetch failed\. Tente de novo/)
    assert.equal(r.headers['cache-control'], 'no-store')
  })

  it('HTTP 500 duas vezes → 502; na segunda tentativa com sucesso → 200', async () => {
    simularFetch(() => new Response('erro interno', { status: 500 }))
    const r = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(r.status, 502)
    assert.match(r.json.error, /HTTP 500/)
    assert.equal(chamadas.length, 2)

    chamadas = []
    let n = 0
    simularFetch(() => (++n === 1 ? new Response('indisponível', { status: 503 }) : { value: OLINDA_EUR }))
    const ok = await chamar({ moeda: 'EUR', inicio: '2026-09-14', fim: '2026-09-16' })
    assert.equal(ok.status, 200)
    assert.equal(chamadas.length, 2)
  })

  it('HTTP 4xx do BCB não repete', async () => {
    simularFetch(() => new Response('requisição inválida', { status: 400 }))
    const r = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(r.status, 502)
    assert.equal(chamadas.length, 1)
  })

  it('resposta que não é JSON ou sem a lista "value"', async () => {
    simularFetch(() => new Response('<html>manutenção</html>', { status: 200 }))
    const html = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(html.status, 502)
    assert.match(html.json.error, /não veio em JSON/)

    simularFetch(() => ({ erro: 'formato novo' }))
    const sem = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(sem.status, 502)
    assert.match(sem.json.error, /formato inesperado/)
  })

  it('tempo esgotado vira mensagem em português, sem repetir', async () => {
    simularFetch(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
    const r = await chamar({ moeda: 'USD', inicio: '2026-09-01', fim: '2026-09-30' })
    assert.equal(r.status, 502)
    assert.equal(chamadas.length, 1)
    assert.match(r.json.error, /não respondeu em 25 s/)
  })
})
