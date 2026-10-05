/*
 * ptax.js — funções puras da Cotação de Moedas (sem DOM e sem rede).
 *
 * Fonte única da lista de moedas, das contas de datas e períodos, da variação,
 * da formatação pt-BR e das linhas de exportação (CSV, Excel e carga SAP).
 * É usado pela interface (assets/app.js), pela função da Vercel (api/ptax.js)
 * e pelos testes (tests/*.test.mjs) — por isso não toca em `document` nem em `fetch`.
 */

export const FONTE = 'Banco Central do Brasil — PTAX (API Olinda)';

/*
 * Moedas publicadas na PTAX. A paridade de cada uma é cotada contra o dólar:
 *   tipo A — paridade em unidades da moeda por 1 USD (ex.: 147,32 JPY por USD);
 *   tipo B — paridade em dólares por 1 unidade da moeda (ex.: 1,1703 USD por EUR).
 * A ordem é a de exibição no painel.
 */
export const MOEDAS = [
  { codigo: 'USD', nome: 'Dólar americano', tipo: 'A' },
  { codigo: 'EUR', nome: 'Euro', tipo: 'B' },
  { codigo: 'GBP', nome: 'Libra esterlina', tipo: 'B' },
  { codigo: 'JPY', nome: 'Iene', tipo: 'A' },
  { codigo: 'CHF', nome: 'Franco suíço', tipo: 'A' },
  { codigo: 'CAD', nome: 'Dólar canadense', tipo: 'A' },
  { codigo: 'AUD', nome: 'Dólar australiano', tipo: 'B' },
  { codigo: 'DKK', nome: 'Coroa dinamarquesa', tipo: 'A' },
  { codigo: 'NOK', nome: 'Coroa norueguesa', tipo: 'A' },
  { codigo: 'SEK', nome: 'Coroa sueca', tipo: 'A' },
];

const POR_CODIGO = new Map(MOEDAS.map((m) => [m.codigo, m]));

/** Moeda da PTAX pelo código ISO (aceita minúsculas); `null` se não for uma das dez. */
export function moedaPorCodigo(codigo) {
  return POR_CODIGO.get(String(codigo ?? '').trim().toUpperCase()) ?? null;
}

/* ================================ Datas =================================== */
/* Datas circulam como texto ISO 'AAAA-MM-DD' e as contas são feitas em UTC,
   para que o fuso do navegador nunca desloque um dia. */

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

/** `true` se o texto é uma data de calendário válida no formato AAAA-MM-DD. */
export function isoValido(iso) {
  if (typeof iso !== 'string') return false;
  const m = RE_ISO.exec(iso);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

function paraUtc(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
const deUtc = (dt) => dt.toISOString().slice(0, 10);

export function somarDias(iso, n) {
  const dt = paraUtc(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return deUtc(dt);
}

/** Soma meses mantendo o dia; se o mês de destino for mais curto, cai no último dia (31/03 − 1 mês = 28/02). */
export function somarMeses(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return deUtc(alvo);
}

export const somarAnos = (iso, n) => somarMeses(iso, 12 * n);

export function diasEntre(inicio, fim) {
  return Math.round((paraUtc(fim) - paraUtc(inicio)) / DIA_MS);
}

/** Data de hoje no horário de Brasília (a PTAX é publicada nesse fuso), como AAAA-MM-DD. */
export function hojeEmSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'AAAA-MM-DD' → 'MM-DD-AAAA', o formato que a API Olinda do Banco Central espera. */
export function paraDataOlinda(iso) {
  const [a, m, d] = iso.split('-');
  return `${m}-${d}-${a}`;
}

/** Atalhos de período do histórico, contados para trás a partir da data final. */
export const ATALHOS = { '1M': 1, '3M': 3, '6M': 6, '1A': 12, '5A': 60 };

export function periodoDoAtalho(atalho, fim) {
  const meses = ATALHOS[atalho];
  if (!meses || !isoValido(fim)) return null;
  return { inicio: somarMeses(fim, -meses), fim };
}

export const PERIODO_MAXIMO_ANOS = 10;

/** Valida o período de consulta. Devolve `{ ok: true }` ou `{ ok: false, erro }` com a mensagem para o usuário. */
export function validarPeriodo(inicio, fim) {
  if (!isoValido(inicio)) return { ok: false, erro: 'Parâmetro "inicio" inválido: use AAAA-MM-DD (ex.: 2026-09-01).' };
  if (!isoValido(fim)) return { ok: false, erro: 'Parâmetro "fim" inválido: use AAAA-MM-DD (ex.: 2026-09-30).' };
  if (inicio > fim) return { ok: false, erro: `A data inicial (${fmtDataBr(inicio)}) é posterior à final (${fmtDataBr(fim)}).` };
  if (inicio < somarAnos(fim, -PERIODO_MAXIMO_ANOS)) {
    return { ok: false, erro: `Período maior que ${PERIODO_MAXIMO_ANOS} anos: consulte em partes.` };
  }
  return { ok: true };
}

/* ============================ Boletins PTAX =============================== */

/** Boletim de fechamento: o nome começa por "Fech" (Fechamento, Fechamento PTAX…), sem diferenciar maiúsculas. */
export function ehFechamento(tipoBoletim) {
  return String(tipoBoletim ?? '').trim().toLowerCase().startsWith('fech');
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte a lista `value` da API Olinda (CotacaoMoedaPeriodo) em cotações
 * `{ data, dataHora, boletim, compra, venda, paridadeCompra, paridadeVenda }`
 * em ordem cronológica. Com `boletins: 'fechamento'` (padrão) fica só o boletim de
 * fechamento de cada dia; com `'todos'`, também Abertura e Intermediários.
 */
export function normalizarOlinda(lista, { boletins = 'fechamento' } = {}) {
  const linhas = [];
  for (const c of Array.isArray(lista) ? lista : []) {
    if (!c || typeof c !== 'object') continue;
    const dataHora = String(c.dataHoraCotacao ?? '').trim();
    const data = dataHora.slice(0, 10);
    const compra = numero(c.cotacaoCompra);
    const venda = numero(c.cotacaoVenda);
    if (!isoValido(data) || compra === null || venda === null) continue;
    linhas.push({
      data,
      dataHora,
      boletim: String(c.tipoBoletim ?? '').trim(),
      compra,
      venda,
      paridadeCompra: numero(c.paridadeCompra),
      paridadeVenda: numero(c.paridadeVenda),
    });
  }
  linhas.sort((a, b) => (a.dataHora < b.dataHora ? -1 : a.dataHora > b.dataHora ? 1 : 0));
  if (boletins === 'todos') return linhas;
  const porDia = new Map();
  for (const l of linhas) if (ehFechamento(l.boletim)) porDia.set(l.data, l); // se houver dois, vale o mais tarde
  return [...porDia.values()];
}

/** Último fechamento até a data (inclusive) e o fechamento anterior a ele. */
export function fechamentoAte(cotacoes, dataIso) {
  const ate = (cotacoes || []).filter((c) => c.data <= dataIso);
  return { atual: ate[ate.length - 1] ?? null, anterior: ate[ate.length - 2] ?? null };
}

/** Variação de `atual` contra `anterior`: absoluta, percentual e direção (alta, baixa ou estável). */
export function variacao(atual, anterior) {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  const abs = Math.round((atual - anterior) * 1e10) / 1e10;
  return { abs, pct: (abs / anterior) * 100, direcao: abs > 0 ? 'alta' : abs < 0 ? 'baixa' : 'estavel' };
}

/** Mínimo, máximo, média e variação entre o primeiro e o último valor (em ordem cronológica). */
export function estatisticas(valores) {
  const v = (valores || []).filter(Number.isFinite);
  if (!v.length) return null;
  const primeiro = v[0];
  const ultimo = v[v.length - 1];
  const vr = variacao(ultimo, primeiro);
  return {
    n: v.length,
    min: Math.min(...v),
    max: Math.max(...v),
    media: v.reduce((s, x) => s + x, 0) / v.length,
    primeiro,
    ultimo,
    variacaoAbs: vr ? vr.abs : null,
    variacaoPct: vr ? vr.pct : null,
  };
}

/** Valor da cotação na medida pedida: 'venda', 'compra' ou 'paridade' (paridade de venda). */
export function valorDaMedida(cotacao, medida) {
  if (medida === 'compra') return cotacao.compra;
  if (medida === 'paridade') return cotacao.paridadeVenda;
  return cotacao.venda;
}

const CHAVES_ORDENACAO = new Set(['data', 'compra', 'venda', 'paridadeCompra', 'paridadeVenda']);

/** Cópia ordenada para a tabela. Chave: data, compra, venda, paridadeCompra ou paridadeVenda. */
export function ordenarCotacoes(cotacoes, chave = 'data', dir = 'desc') {
  const k = CHAVES_ORDENACAO.has(chave) ? chave : 'data';
  const sinal = dir === 'asc' ? 1 : -1;
  return [...(cotacoes || [])].sort((a, b) => {
    const va = a[k], vb = b[k];
    if (va === vb) return k === 'data' ? 0 : (a.data < b.data ? 1 : -1);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va < vb ? -1 : 1) * sinal;
  });
}

/* ============================== Formatação ================================ */

export function fmtNumero(v, min = 2, max = min) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
}

/**
 * Cotação ou paridade como publicada, com casas fixas para a coluna alinhar: 4 casas
 * (6 abaixo de 0,1, como o iene), sem esconder casas extras que a fonte publicar.
 */
export function fmtCotacao(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) < 0.1 ? fmtNumero(v, 6, 8) : fmtNumero(v, 4, 6);
}

/** Taxa calculada (média, conta) na precisão em que a PTAX é publicada: 4 casas, ou 6 abaixo de 0,1 (iene). */
export function fmtTaxa(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) < 0.1 ? fmtNumero(v, 6, 6) : fmtNumero(v, 4, 4);
}

/** Valor monetário com 2 casas. */
export const fmtValor = (v) => fmtNumero(v, 2, 2);

/** Valor com o código da moeda à frente (R$ para o real): "USD 1.000,00", "R$ 5.432,10". */
export function fmtMoeda(v, codigo) {
  return codigo === 'BRL' ? `R$ ${fmtValor(v)}` : `${codigo} ${fmtValor(v)}`;
}

/** Percentual com sinal (+0,45% / −0,32%), usando o sinal de menos tipográfico. */
export function fmtPct(v, casas = 2) {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(casas));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtNumero(Math.abs(r), casas, casas)}%`;
}

/** Variação com sinal (+0,0281 / −0,0140): 4 casas, até 6 para moedas de valor pequeno. */
export function fmtSinal(v, formatar = (x) => fmtNumero(x, 4, 6)) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatar(Math.abs(v))}`;
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function fmtDataBr(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** '2026-09-15 13:09:27.395' → '13:09'. */
export function fmtHora(dataHora) {
  const h = String(dataHora ?? '').slice(11, 16);
  return /^\d{2}:\d{2}$/.test(h) ? h : '';
}

/** Unidade da paridade com o dólar: "USD por EUR" (tipo B) ou "JPY por USD" (tipo A). */
export function unidadeParidade(codigo) {
  const m = moedaPorCodigo(codigo);
  if (!m || m.codigo === 'USD') return 'moeda de referência';
  return m.tipo === 'B' ? `USD por ${m.codigo}` : `${m.codigo} por USD`;
}

/** Leitura da paridade: "1 EUR = 1,1703 USD" (tipo B) ou "1 USD = 147,32 JPY" (tipo A). */
export function textoParidade(codigo, paridade) {
  const m = moedaPorCodigo(codigo);
  if (!m) return '';
  if (m.codigo === 'USD') return 'Referência da paridade';
  if (!Number.isFinite(paridade)) return 'Paridade —';
  return m.tipo === 'B'
    ? `1 ${m.codigo} = ${fmtCotacao(paridade)} USD`
    : `1 USD = ${fmtCotacao(paridade)} ${m.codigo}`;
}

/** Lê um valor digitado em pt-BR ("1.234,56", "1234,56", "1.500", "1234.5"). `NaN` se não for número. */
export function parseValorBr(texto) {
  let s = String(texto ?? '').trim().replace(/\s+/g, '').replace(/^R\$/i, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/* ============================== Exportação ================================ */

export const COLUNAS_PLANILHA = [
  'Data', 'Moeda', 'Compra (R$)', 'Venda (R$)', 'Paridade compra', 'Paridade venda', 'Boletim', 'Data/hora do boletim',
];

/** Linhas da planilha do histórico (cabeçalho + uma linha por cotação, em ordem cronológica); números como número. */
export function linhasPlanilha(cotacoes, moeda) {
  const asc = ordenarCotacoes(cotacoes, 'data', 'asc');
  return [
    COLUNAS_PLANILHA,
    ...asc.map((c) => [
      fmtDataBr(c.data), moeda, c.compra, c.venda, c.paridadeCompra ?? '', c.paridadeVenda ?? '', c.boletim, c.dataHora,
    ]),
  ];
}

/** Número para CSV brasileiro: vírgula decimal, sem separador de milhar, sem arredondar o valor publicado. */
export function numeroCsv(v) {
  return Number.isFinite(v) ? String(v).replace('.', ',') : '';
}

function campoCsv(v) {
  const s = typeof v === 'number' ? numeroCsv(v) : String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV do histórico: separador ";", decimal com vírgula, linhas terminadas em CRLF (o Excel brasileiro abre direto). */
export function gerarCsv(cotacoes, moeda) {
  return linhasPlanilha(cotacoes, moeda).map((linha) => linha.map(campoCsv).join(';')).join('\r\n') + '\r\n';
}

/* Carga no SAP: app Importar Dados de Mercado (SAP Fiori F2610), taxas de câmbio.
   Os nomes das colunas seguem o modelo em português do app; confira com o modelo
   baixado do próprio F2610 no seu sistema antes da primeira carga. */
export const COLUNAS_SAP = [
  'Categoria de dados do mercado',
  'Tipo de taxa de câmbio',
  'Moeda de origem',
  'Moeda de destino',
  'Data efetiva',
  'Taxa de câmbio',
];

/**
 * Linhas da carga SAP (cabeçalho + uma linha por fechamento, em ordem cronológica).
 * Padrões: categoria 01, tipo de taxa M, destino BRL, taxa de venda. Data efetiva AAAAMMDD (texto).
 */
export function linhasSap(cotacoes, { categoria = '01', tipoTaxa = 'M', moedaOrigem, moedaDestino = 'BRL', taxa = 'venda' } = {}) {
  const origem = String(moedaOrigem ?? '').trim().toUpperCase();
  if (!origem) throw new TypeError('linhasSap: informe a moeda de origem.');
  const cat = String(categoria ?? '').trim() || '01';
  const tipo = String(tipoTaxa ?? '').trim().toUpperCase() || 'M';
  const destino = String(moedaDestino ?? '').trim().toUpperCase() || 'BRL';
  const asc = ordenarCotacoes(cotacoes, 'data', 'asc');
  return [
    COLUNAS_SAP,
    ...asc.map((c) => [cat, tipo, origem, destino, c.data.replace(/-/g, ''), taxa === 'compra' ? c.compra : c.venda]),
  ];
}

/** Sufixo de nome de arquivo para o período: 20260701-20260930. */
export function sufixoPeriodo(inicio, fim) {
  return `${String(inicio).replace(/-/g, '')}-${String(fim).replace(/-/g, '')}`;
}

/* =============================== Conversor ================================ */

/**
 * Converte `valor` de uma moeda para outra pela PTAX (compra ou venda) da data.
 * `taxas`: { USD: { compra, venda, data, dataHora }, … } — o real (BRL) vale 1.
 * Entre duas moedas estrangeiras a conta passa pelo real: valor × taxa(de) ÷ taxa(para).
 * Devolve { resultado, taxaCruzada, passos: [{ conta, nota }] }.
 */
export function converter({ valor, de, para, taxas = {}, lado = 'venda' }) {
  if (!Number.isFinite(valor) || valor < 0) throw new RangeError('Informe um valor numérico positivo.');
  const campo = lado === 'compra' ? 'compra' : 'venda';
  const nomeLado = `PTAX de ${campo}`;
  const taxa = (cod) => {
    const t = taxas[cod];
    const v = t ? t[campo] : NaN;
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Sem ${nomeLado} de ${cod} para a data.`);
    return v;
  };
  const nota = (cod) => {
    const t = taxas[cod];
    const quando = t && t.data ? ` · fechamento de ${fmtDataBr(t.data)}${fmtHora(t.dataHora) ? ` ${fmtHora(t.dataHora)}` : ''}` : '';
    return `${nomeLado} do ${cod}: R$ ${fmtCotacao(t[campo])} por ${cod}${quando}`;
  };

  if (de === para) {
    return { resultado: valor, taxaCruzada: 1, passos: [{ conta: `${fmtMoeda(valor, de)} = ${fmtMoeda(valor, para)}`, nota: 'Mesma moeda: nada a converter.' }] };
  }
  if (para === 'BRL') {
    const t = taxa(de);
    const r = valor * t;
    return { resultado: r, taxaCruzada: t, passos: [{ conta: `${fmtMoeda(valor, de)} × ${fmtCotacao(t)} = ${fmtMoeda(r, 'BRL')}`, nota: nota(de) }] };
  }
  if (de === 'BRL') {
    const t = taxa(para);
    const r = valor / t;
    return { resultado: r, taxaCruzada: 1 / t, passos: [{ conta: `${fmtMoeda(valor, 'BRL')} ÷ ${fmtCotacao(t)} = ${fmtMoeda(r, para)}`, nota: nota(para) }] };
  }
  const tDe = taxa(de);
  const tPara = taxa(para);
  const emReais = valor * tDe;
  const r = emReais / tPara;
  const cruzada = tDe / tPara;
  return {
    resultado: r,
    taxaCruzada: cruzada,
    passos: [
      { conta: `${fmtMoeda(valor, de)} × ${fmtCotacao(tDe)} = R$ ${fmtNumero(emReais, 2, 6)}`, nota: nota(de) },
      { conta: `R$ ${fmtNumero(emReais, 2, 6)} ÷ ${fmtCotacao(tPara)} = ${fmtMoeda(r, para)}`, nota: nota(para) },
      { conta: `Taxa cruzada: ${fmtCotacao(tDe)} ÷ ${fmtCotacao(tPara)} = ${fmtNumero(cruzada, 6, 6)} ${para} por ${de}`, nota: 'Quantas unidades da moeda de destino valem 1 unidade da moeda de origem, via real.' },
    ],
  };
}

/* ============================ Concorrência ================================ */

/**
 * Executa as tarefas (funções que devolvem promessa) com no máximo `limite` ao mesmo tempo.
 * Devolve, na ordem das tarefas, `{ ok: true, valor }` ou `{ ok: false, erro }` — uma falha não derruba as outras.
 */
export async function emPool(tarefas, limite = 4) {
  const resultados = new Array(tarefas.length);
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < tarefas.length) {
      const i = proxima++;
      try {
        resultados[i] = { ok: true, valor: await tarefas[i]() };
      } catch (erro) {
        resultados[i] = { ok: false, erro };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, tarefas.length)) }, trabalhador));
  return resultados;
}
