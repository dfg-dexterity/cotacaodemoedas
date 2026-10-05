import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLUNAS_SAP,
  MOEDAS,
  converter,
  diasEntre,
  ehFechamento,
  emPool,
  estatisticas,
  fechamentoAte,
  fmtCotacao,
  fmtDataBr,
  fmtHora,
  fmtMoeda,
  fmtPct,
  fmtSinal,
  fmtTaxa,
  gerarCsv,
  hojeEmSaoPaulo,
  isoValido,
  linhasPlanilha,
  linhasSap,
  moedaPorCodigo,
  normalizarOlinda,
  ordenarCotacoes,
  paraDataOlinda,
  parseValorBr,
  periodoDoAtalho,
  somarAnos,
  somarDias,
  somarMeses,
  sufixoPeriodo,
  textoParidade,
  unidadeParidade,
  validarPeriodo,
  valorDaMedida,
  variacao,
} from '../assets/ptax.js'
import { OLINDA_EUR } from './olinda-fixture.mjs'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b} (tolerância ${eps})`)

describe('moedas da PTAX', () => {
  it('dez moedas, com tipo A/B correto', () => {
    assert.deepEqual(MOEDAS.map((m) => m.codigo), ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'DKK', 'NOK', 'SEK'])
    assert.deepEqual(MOEDAS.filter((m) => m.tipo === 'B').map((m) => m.codigo), ['EUR', 'GBP', 'AUD'])
    assert.ok(MOEDAS.every((m) => m.nome && (m.tipo === 'A' || m.tipo === 'B')))
  })

  it('moedaPorCodigo aceita minúsculas e recusa o resto', () => {
    assert.equal(moedaPorCodigo('eur').nome, 'Euro')
    assert.equal(moedaPorCodigo(' JPY ').tipo, 'A')
    assert.equal(moedaPorCodigo('BRL'), null)
    assert.equal(moedaPorCodigo(null), null)
  })

  it('paridade lida na direção do tipo', () => {
    assert.equal(textoParidade('EUR', 1.1703), '1 EUR = 1,1703 USD')
    assert.equal(textoParidade('JPY', 147.32), '1 USD = 147,3200 JPY')
    assert.equal(textoParidade('USD', 1), 'Referência da paridade')
    assert.equal(unidadeParidade('GBP'), 'USD por GBP')
    assert.equal(unidadeParidade('CHF'), 'CHF por USD')
    assert.equal(unidadeParidade('USD'), 'moeda de referência')
  })
})

describe('datas e períodos', () => {
  it('isoValido confere o calendário', () => {
    assert.equal(isoValido('2026-09-15'), true)
    assert.equal(isoValido('2028-02-29'), true)
    assert.equal(isoValido('2026-02-29'), false)
    assert.equal(isoValido('2026-13-01'), false)
    assert.equal(isoValido('15/09/2026'), false)
    assert.equal(isoValido(undefined), false)
  })

  it('soma de dias, meses (fim de mês) e anos', () => {
    assert.equal(somarDias('2026-10-05', -10), '2026-09-25')
    assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
    assert.equal(somarMeses('2026-03-31', -1), '2026-02-28')
    assert.equal(somarMeses('2026-10-05', -3), '2026-07-05')
    assert.equal(somarAnos('2028-02-29', -1), '2027-02-28')
    assert.equal(diasEntre('2026-09-01', '2026-10-01'), 30)
  })

  it('atalhos 1M, 3M, 6M, 1A e 5A contam para trás a partir da data final', () => {
    assert.deepEqual(periodoDoAtalho('1M', '2026-10-05'), { inicio: '2026-09-05', fim: '2026-10-05' })
    assert.deepEqual(periodoDoAtalho('3M', '2026-05-31'), { inicio: '2026-02-28', fim: '2026-05-31' })
    assert.equal(periodoDoAtalho('6M', '2026-10-05').inicio, '2026-04-05')
    assert.equal(periodoDoAtalho('1A', '2026-10-05').inicio, '2025-10-05')
    assert.equal(periodoDoAtalho('5A', '2026-10-05').inicio, '2021-10-05')
    assert.equal(periodoDoAtalho('2S', '2026-10-05'), null)
  })

  it('validarPeriodo: formato, ordem e limite de 10 anos', () => {
    assert.deepEqual(validarPeriodo('2026-09-01', '2026-09-30'), { ok: true })
    assert.equal(validarPeriodo('2016-09-30', '2026-09-30').ok, true)
    assert.match(validarPeriodo('2016-09-29', '2026-09-30').erro, /10 anos/)
    assert.match(validarPeriodo('2026-09-31', '2026-09-30').erro, /"inicio"/)
    assert.match(validarPeriodo('2026-09-01', '').erro, /"fim"/)
    assert.match(validarPeriodo('2026-10-01', '2026-09-30').erro, /posterior/)
  })

  it('formato de data da Olinda e hoje em Brasília', () => {
    assert.equal(paraDataOlinda('2026-09-05'), '09-05-2026')
    // 02:30 UTC de 06/10 ainda é 05/10 em Brasília (UTC−3)
    assert.equal(hojeEmSaoPaulo(new Date('2026-10-06T02:30:00Z')), '2026-10-05')
    assert.equal(hojeEmSaoPaulo(new Date('2026-10-06T03:30:00Z')), '2026-10-06')
  })
})

describe('boletins da Olinda', () => {
  it('ehFechamento: nome começando por "Fech", sem diferenciar maiúsculas', () => {
    assert.equal(ehFechamento('Fechamento PTAX'), true)
    assert.equal(ehFechamento('fechamento'), true)
    assert.equal(ehFechamento('FECHAMENTO'), true)
    assert.equal(ehFechamento('Abertura'), false)
    assert.equal(ehFechamento('Intermediário'), false)
    assert.equal(ehFechamento(undefined), false)
  })

  it('normalizarOlinda fica só com o fechamento de cada dia, em ordem cronológica', () => {
    const r = normalizarOlinda(OLINDA_EUR)
    assert.deepEqual(r.map((c) => c.data), ['2026-09-14', '2026-09-15', '2026-09-16'])
    assert.deepEqual(r[0], {
      data: '2026-09-14',
      dataHora: '2026-09-14 13:10:11.870',
      boletim: 'Fechamento PTAX',
      compra: 6.289,
      venda: 6.2912,
      paridadeCompra: 1.1703,
      paridadeVenda: 1.1704,
    })
    assert.equal(r[2].boletim, 'FECHAMENTO')
  })

  it('normalizarOlinda com boletins "todos" devolve os seis, ordenados por data e hora', () => {
    const r = normalizarOlinda(OLINDA_EUR, { boletins: 'todos' })
    assert.equal(r.length, 6)
    assert.deepEqual(r.map((c) => c.boletim).slice(0, 3), ['Abertura', 'Intermediário', 'Fechamento PTAX'])
  })

  it('normalizarOlinda ignora linhas sem data ou sem cotação e aceita lista vazia', () => {
    assert.deepEqual(normalizarOlinda(null), [])
    const r = normalizarOlinda([
      { cotacaoCompra: 5.3, cotacaoVenda: 5.31, dataHoraCotacao: '', tipoBoletim: 'Fechamento' },
      { cotacaoCompra: null, cotacaoVenda: 5.31, dataHoraCotacao: '2026-09-15 13:09:00.000', tipoBoletim: 'Fechamento' },
      { cotacaoCompra: 5.3, cotacaoVenda: 5.31, dataHoraCotacao: '2026-09-15 13:09:00.000', tipoBoletim: 'Fechamento' },
    ])
    assert.equal(r.length, 1)
    assert.equal(r[0].paridadeCompra, null)
  })

  it('fechamentoAte pega o último até a data e o anterior a ele', () => {
    const r = normalizarOlinda(OLINDA_EUR)
    const { atual, anterior } = fechamentoAte(r, '2026-09-15')
    assert.equal(atual.data, '2026-09-15')
    assert.equal(anterior.data, '2026-09-14')
    assert.equal(fechamentoAte(r, '2026-09-20').atual.data, '2026-09-16') // fim de semana: último disponível
    assert.deepEqual(fechamentoAte(r, '2026-09-13'), { atual: null, anterior: null })
  })
})

describe('variação e estatísticas', () => {
  it('variacao: absoluta, percentual e direção', () => {
    const v = variacao(6.3021, 6.2912)
    close(v.abs, 0.0109)
    close(v.pct, (0.0109 / 6.2912) * 100)
    assert.equal(v.direcao, 'alta')
    assert.equal(variacao(6.2762, 6.3021).direcao, 'baixa')
    assert.deepEqual(variacao(5.4, 5.4), { abs: 0, pct: 0, direcao: 'estavel' })
    assert.equal(variacao(5.4, 0), null)
    assert.equal(variacao(NaN, 5.4), null)
  })

  it('estatisticas: mín., máx., média e variação do período', () => {
    const s = estatisticas([5.4, 5.5, 5.3, 5.6])
    assert.equal(s.n, 4)
    assert.equal(s.min, 5.3)
    assert.equal(s.max, 5.6)
    close(s.media, 5.45)
    close(s.variacaoPct, (0.2 / 5.4) * 100)
    assert.equal(estatisticas([]), null)
  })

  it('valorDaMedida e ordenarCotacoes', () => {
    const r = normalizarOlinda(OLINDA_EUR)
    assert.equal(valorDaMedida(r[0], 'venda'), 6.2912)
    assert.equal(valorDaMedida(r[0], 'compra'), 6.289)
    assert.equal(valorDaMedida(r[0], 'paridade'), 1.1704)
    assert.deepEqual(ordenarCotacoes(r).map((c) => c.data), ['2026-09-16', '2026-09-15', '2026-09-14'])
    assert.deepEqual(ordenarCotacoes(r, 'venda', 'asc').map((c) => c.venda), [6.2762, 6.2912, 6.3021])
    assert.deepEqual(ordenarCotacoes(r, 'chave-invalida', 'asc').map((c) => c.data), ['2026-09-14', '2026-09-15', '2026-09-16'])
    assert.equal(r[0].data, '2026-09-14') // não altera a lista original
  })
})

describe('formatação pt-BR', () => {
  it('cotação com casas fixas (4; 6 abaixo de 0,1), valor com 2, percentual com sinal', () => {
    assert.equal(fmtCotacao(5.4321), '5,4321')
    assert.equal(fmtCotacao(6.1), '6,1000')
    assert.equal(fmtCotacao(0.03652), '0,036520')
    assert.equal(fmtCotacao(0.0365218), '0,0365218')
    assert.equal(fmtCotacao(147.62), '147,6200')
    assert.equal(fmtCotacao(NaN), '—')
    assert.equal(fmtMoeda(5432.1, 'BRL'), 'R$ 5.432,10')
    assert.equal(fmtMoeda(1000, 'USD'), 'USD 1.000,00')
    assert.equal(fmtPct(0.4512), '+0,45%')
    assert.equal(fmtPct(-0.32), '−0,32%')
    assert.equal(fmtPct(0.001), '0,00%')
    assert.equal(fmtSinal(-0.014), '−0,0140')
    assert.equal(fmtSinal(0.000143), '+0,000143')
    assert.equal(fmtTaxa(6.569037), '6,5690')
    assert.equal(fmtTaxa(0.0367961), '0,036796')
  })

  it('datas e horas', () => {
    assert.equal(fmtDataBr('2026-09-05'), '05/09/2026')
    assert.equal(fmtHora('2026-09-15 13:09:27.395'), '13:09')
    assert.equal(fmtHora('2026-09-15'), '')
  })

  it('parseValorBr aceita o jeito brasileiro de digitar', () => {
    assert.equal(parseValorBr('1.234,56'), 1234.56)
    assert.equal(parseValorBr('1234,5'), 1234.5)
    assert.equal(parseValorBr('1.500'), 1500)
    assert.equal(parseValorBr('1234.5'), 1234.5)
    assert.equal(parseValorBr('R$ 10,00'), 10)
    assert.ok(Number.isNaN(parseValorBr('dez reais')))
    assert.ok(Number.isNaN(parseValorBr('')))
  })
})

describe('exportação', () => {
  const cot = normalizarOlinda(OLINDA_EUR)

  it('CSV com ";", vírgula decimal, valor publicado sem arredondar e CRLF', () => {
    const csv = gerarCsv(cot, 'EUR')
    const linhas = csv.split('\r\n')
    assert.equal(linhas[0], 'Data;Moeda;Compra (R$);Venda (R$);Paridade compra;Paridade venda;Boletim;Data/hora do boletim')
    assert.equal(linhas[1], '14/09/2026;EUR;6,289;6,2912;1,1703;1,1704;Fechamento PTAX;2026-09-14 13:10:11.870')
    assert.equal(linhas.length, 5) // cabeçalho + 3 + linha vazia final
    assert.equal(linhas[4], '')
    assert.ok(!/\d\.\d/.test(linhas[2].split(';').slice(2, 6).join(';')), 'nenhum ponto decimal nos números')
  })

  it('CSV protege campo com ";" ou aspas', () => {
    const csv = gerarCsv([{ ...cot[0], boletim: 'Fechamento; "extra"' }], 'EUR')
    assert.match(csv, /;"Fechamento; ""extra""";/)
  })

  it('planilha: números como número, data DD/MM/AAAA', () => {
    const aoa = linhasPlanilha(cot, 'EUR')
    assert.equal(aoa.length, 4)
    assert.deepEqual(aoa[3].slice(0, 6), ['16/09/2026', 'EUR', 6.274, 6.2762, 1.1689, 1.169])
  })

  it('carga SAP F2610: colunas, padrões 01/M/BRL/venda e data AAAAMMDD', () => {
    const aoa = linhasSap(cot, { moedaOrigem: 'eur' })
    assert.deepEqual(aoa[0], COLUNAS_SAP)
    assert.deepEqual(aoa[0], ['Categoria de dados do mercado', 'Tipo de taxa de câmbio', 'Moeda de origem', 'Moeda de destino', 'Data efetiva', 'Taxa de câmbio'])
    assert.deepEqual(aoa[1], ['01', 'M', 'EUR', 'BRL', '20260914', 6.2912])
    assert.equal(aoa.length, 4)
  })

  it('carga SAP com taxa de compra e tipo de taxa editado', () => {
    const aoa = linhasSap(ordenarCotacoes(cot, 'data', 'desc'), { moedaOrigem: 'EUR', categoria: '02', tipoTaxa: 'b', taxa: 'compra' })
    assert.deepEqual(aoa[1], ['02', 'B', 'EUR', 'BRL', '20260914', 6.289]) // sempre em ordem cronológica
    assert.throws(() => linhasSap(cot, {}), /moeda de origem/)
  })

  it('sufixo de período para nome de arquivo', () => {
    assert.equal(sufixoPeriodo('2026-07-01', '2026-09-30'), '20260701-20260930')
  })
})

describe('conversor', () => {
  const taxas = {
    USD: { compra: 5.4315, venda: 5.4321, data: '2026-10-02', dataHora: '2026-10-02 13:09:27.395' },
    EUR: { compra: 6.3002, venda: 6.3021, data: '2026-10-02', dataHora: '2026-10-02 13:09:27.395' },
  }

  it('moeda estrangeira para reais: valor × PTAX', () => {
    const r = converter({ valor: 1000, de: 'USD', para: 'BRL', taxas, lado: 'venda' })
    close(r.resultado, 5432.1)
    assert.equal(r.passos[0].conta, 'USD 1.000,00 × 5,4321 = R$ 5.432,10')
    assert.match(r.passos[0].nota, /PTAX de venda do USD.*02\/10\/2026 13:09/)
  })

  it('reais para moeda estrangeira: valor ÷ PTAX, com o lado escolhido', () => {
    const r = converter({ valor: 5431.5, de: 'BRL', para: 'USD', taxas, lado: 'compra' })
    close(r.resultado, 1000)
    assert.equal(r.passos[0].conta, 'R$ 5.431,50 ÷ 5,4315 = USD 1.000,00')
  })

  it('cruzada entre duas moedas passa pelo real', () => {
    const r = converter({ valor: 1000, de: 'EUR', para: 'USD', taxas, lado: 'venda' })
    close(r.resultado, (1000 * 6.3021) / 5.4321)
    close(r.taxaCruzada, 6.3021 / 5.4321)
    assert.equal(r.passos.length, 3)
    assert.equal(r.passos[0].conta, 'EUR 1.000,00 × 6,3021 = R$ 6.302,10')
    assert.equal(r.passos[1].conta, `R$ 6.302,10 ÷ 5,4321 = USD ${(6302.1 / 5.4321).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    assert.equal(r.passos[2].conta, 'Taxa cruzada: 6,3021 ÷ 5,4321 = 1,160159 USD por EUR')
  })

  it('mesma moeda e erros', () => {
    assert.equal(converter({ valor: 10, de: 'EUR', para: 'EUR', taxas }).resultado, 10)
    assert.throws(() => converter({ valor: 10, de: 'GBP', para: 'BRL', taxas }), /Sem PTAX de venda de GBP/)
    assert.throws(() => converter({ valor: -1, de: 'USD', para: 'BRL', taxas }), /valor numérico positivo/)
    assert.throws(() => converter({ valor: NaN, de: 'USD', para: 'BRL', taxas }), /valor numérico positivo/)
  })
})

describe('emPool', () => {
  it('respeita o limite de concorrência e devolve na ordem, sem derrubar as outras em caso de falha', async () => {
    let ativas = 0
    let pico = 0
    const tarefas = Array.from({ length: 10 }, (_, i) => async () => {
      ativas++
      pico = Math.max(pico, ativas)
      await new Promise((r) => setTimeout(r, 5 + (i % 3) * 3))
      ativas--
      if (i === 4) throw new Error('falhou a 4')
      return i * 10
    })
    const r = await emPool(tarefas, 4)
    assert.equal(pico, 4)
    assert.equal(r.length, 10)
    assert.deepEqual(r[2], { ok: true, valor: 20 })
    assert.equal(r[4].ok, false)
    assert.match(r[4].erro.message, /falhou a 4/)
  })

  it('lista vazia', async () => {
    assert.deepEqual(await emPool([], 4), [])
  })
})
