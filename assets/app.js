/*
 * app.js — interface da Cotação de Moedas: Painel, Histórico e Conversor.
 *
 * Contas de datas, variação, formatação e linhas de exportação ficam em
 * assets/ptax.js (funções puras, testadas no Node); o gráfico vem de
 * assets/charts.js (SVG sem dependência, o mesmo da Calculadora MTM). Os dados
 * vêm de /api/ptax (proxy da PTAX do Banco Central, ver api/ptax.js).
 *
 * Parâmetros de URL:
 *   ?embed=1      modo incorporado (iframe no site): sem faixa de título nem rodapé
 *   ?moeda=EUR    abre o histórico da moeda (com #conversor, pré-seleciona a moeda de origem)
 *   #historico    abre o histórico · #conversor abre o conversor (o endereço acompanha a aba)
 */
import * as P from './ptax.js';
import { graficoLinhas, montarGraficos } from './charts.js';

const $ = (id) => document.getElementById(id);
const EMBUTIDO = document.documentElement.classList.contains('modo-embutido');
const PARAMS = new URLSearchParams(location.search);
const HOJE = P.hojeEmSaoPaulo();

// localStorage pode lançar exceção em iframe de terceiros ou com bloqueio de dados do site.
const armazenamento = {
  ler(chave) { try { return localStorage.getItem(chave); } catch { return null; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* segue sem lembrar */ } },
};
const CHAVE_MOEDA = 'cotacaodemoedas:moeda';
const CHAVE_CONVERSOR = 'cotacaodemoedas:conversor';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function setStatus(el, texto, tipo) {
  el.textContent = texto;
  el.classList.remove('is-ok', 'is-warn', 'is-err');
  if (tipo) el.classList.add(`is-${tipo}`);
}

function marcarGrupo(grupo, atributo, valor) {
  grupo.querySelectorAll('.rng').forEach((b) => {
    const ativo = b.dataset[atributo] === valor;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
}

/* ======================= Bibliotecas sob demanda ========================== */

// O SheetJS (~900 KB) só desce quando alguém exporta para Excel.
const LIBS = { XLSX: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js' };
const libsPendentes = {};
function carregarLib(nome) {
  if (window[nome]) return Promise.resolve(window[nome]);
  if (!libsPendentes[nome]) {
    libsPendentes[nome] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIBS[nome];
      s.async = true;
      s.onload = () => (window[nome] ? resolve(window[nome]) : reject(new Error(`${nome} indisponível`)));
      s.onerror = () => { delete libsPendentes[nome]; s.remove(); reject(new Error('falha ao baixar a biblioteca de Excel')); };
      document.head.appendChild(s);
    });
  }
  return libsPendentes[nome];
}

function baixar(conteudo, nome, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================================ API ===================================== */

// Uma promessa por consulta: painel, histórico e conversor reaproveitam o que já veio.
const cacheApi = new Map();
function buscarPtax(moeda, inicio, fim) {
  const url = `/api/ptax?moeda=${encodeURIComponent(moeda)}&inicio=${inicio}&fim=${fim}`;
  if (!cacheApi.has(url)) {
    const promessa = fetch(url).then(async (r) => {
      let corpo = null;
      try { corpo = await r.json(); } catch { /* corpo não JSON */ }
      if (r.status === 404) return { moeda, inicio, fim, cotacoes: [], aviso: corpo && corpo.error };
      if (!r.ok) throw new Error(corpo && corpo.error ? corpo.error : `HTTP ${r.status}`);
      if (!corpo || !Array.isArray(corpo.cotacoes)) throw new Error('resposta inesperada da API');
      return corpo;
    });
    promessa.catch(() => cacheApi.delete(url));
    cacheApi.set(url, promessa);
  }
  return cacheApi.get(url);
}

/* ============================= Navegação ================================== */

const VIEWS = {
  painel: { n: '01', nome: 'Painel', hash: '' },
  historico: { n: '02', nome: 'Histórico', hash: '#historico' },
  conversor: { n: '03', nome: 'Conversor', hash: '#conversor' },
};
const navLinks = [...document.querySelectorAll('.dxt-nav a[data-view]')];
const sobrancelha = $('sobrancelha');
const iniciadas = new Set();
let viewAtual = 'painel';

const viewDoHash = (h) => (h === '#historico' ? 'historico' : h === '#conversor' ? 'conversor' : 'painel');

function mostrarView(qual) {
  if (!VIEWS[qual]) qual = 'painel';
  viewAtual = qual;
  for (const k of Object.keys(VIEWS)) $(`view-${k}`).hidden = k !== qual;
  for (const a of navLinks) {
    const ativo = a.dataset.view === qual;
    a.classList.toggle('is-active', ativo);
    if (ativo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  sobrancelha.textContent = `${VIEWS[qual].n} / Dados de mercado · ${VIEWS[qual].nome}`;
  atualizarEndereco();
  if (!iniciadas.has(qual)) {
    iniciadas.add(qual);
    ({ painel: carregarPainel, historico: carregarHistorico, conversor: converter })[qual]();
  } else if (qual === 'historico') {
    montarGraficos($('histGrafico')); // a largura pode ter mudado enquanto a aba estava oculta
  }
}

// O endereço acompanha a aba (e a moeda do histórico), para o link copiado abrir onde a pessoa estava.
function atualizarEndereco() {
  const p = new URLSearchParams(location.search);
  if (viewAtual === 'historico' && histMoeda.value) p.set('moeda', histMoeda.value);
  else p.delete('moeda');
  const qs = p.toString();
  const alvo = `${location.pathname}${qs ? `?${qs}` : ''}${VIEWS[viewAtual].hash}`;
  if (alvo !== location.pathname + location.search + location.hash) {
    try { history.replaceState(null, '', alvo); } catch { /* ambiente sem history */ }
  }
}

for (const a of navLinks) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    mostrarView(a.dataset.view);
  });
}
window.addEventListener('hashchange', () => {
  const qual = viewDoHash(location.hash);
  if (qual !== viewAtual) mostrarView(qual);
});

/* =============================== Painel =================================== */

const painelData = $('painelData');
const painelCards = $('painelCards');
const painelStatus = $('painelStatus');
const painelBadge = $('painelBadge');
const painelAtualizar = $('painelAtualizar');
let painelToken = 0;
let painelRef = HOJE;

function hrefHistorico(codigo) {
  const p = new URLSearchParams(location.search);
  p.set('moeda', codigo);
  return `?${p.toString()}#historico`;
}

function cardHtml(m) {
  return `<a class="mcard is-carregando" href="${esc(hrefHistorico(m.codigo))}" data-moeda="${m.codigo}" title="Abrir o histórico: ${esc(m.nome)}">
    <div class="mcard-topo">
      <span class="mcard-cod">${m.codigo}</span>
      <span class="dxt-badge mcard-var" data-c="var">—</span>
    </div>
    <div class="mcard-nome">${esc(m.nome)}</div>
    <div class="mcard-precos">
      <div class="mcard-rotulo">Venda · R$</div>
      <div class="mcard-valor" data-c="venda">0,0000</div>
      <div class="mcard-compra">Compra <span data-c="compra">0,0000</span></div>
    </div>
    <div class="mcard-spark" data-c="spark"></div>
    <div class="mcard-pe">
      <span class="mcard-paridade" data-c="paridade">&nbsp;</span>
      <span class="mcard-data"><span data-c="data">&nbsp;</span><span class="mcard-tipo">Tipo ${m.tipo}</span></span>
    </div>
  </a>`;
}

/* Mini-gráfico das últimas sessões: traço apagado e só o último trecho em cor (cerceta alta, âmbar baixa). */
function sparkline(valores, direcao) {
  if (valores.length < 2) return '';
  const min = Math.min(...valores);
  const faixa = Math.max(...valores) - min || 1;
  const W = 100, H = 28, M = 3;
  const pts = valores.map((v, i) =>
    `${(M + (i * (W - 2 * M)) / (valores.length - 1)).toFixed(1)},${(H - M - ((v - min) / faixa) * (H - 2 * M)).toFixed(1)}`);
  const cor = direcao === 'baixa' ? 'var(--dxt-amarelo)' : 'var(--dxt-acc-txt)';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="rgba(247,243,231,.28)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <polyline points="${pts.slice(-2).join(' ')}" fill="none" stroke="${cor}" stroke-width="2.25" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function erroCard(el, mensagem) {
  el.classList.remove('is-carregando');
  el.querySelector('[data-c="venda"]').textContent = '—';
  el.querySelector('[data-c="compra"]').textContent = '—';
  const spark = el.querySelector('[data-c="spark"]');
  spark.className = 'mcard-erro';
  spark.textContent = mensagem;
  el.querySelector('[data-c="paridade"]').textContent = 'Clique para tentar no histórico';
}

function preencherCard(m, cotacoes, ref) {
  const el = painelCards.querySelector(`[data-moeda="${m.codigo}"]`);
  if (!el) return null;
  const { atual, anterior } = P.fechamentoAte(cotacoes, ref);
  if (!atual) {
    erroCard(el, `Sem PTAX de fechamento nos 10 dias até ${P.fmtDataBr(ref)}.`);
    return null;
  }
  el.classList.remove('is-carregando');
  const campo = (c) => el.querySelector(`[data-c="${c}"]`);
  const vr = anterior ? P.variacao(atual.venda, anterior.venda) : null;
  campo('venda').textContent = P.fmtCotacao(atual.venda);
  campo('compra').textContent = P.fmtCotacao(atual.compra);

  const badge = campo('var');
  badge.classList.remove('dxt-badge--up', 'dxt-badge--down');
  if (vr) {
    const seta = vr.direcao === 'alta' ? '▲ ' : vr.direcao === 'baixa' ? '▼ ' : '';
    badge.textContent = `${seta}${P.fmtPct(vr.pct)}`;
    if (vr.direcao === 'alta') badge.classList.add('dxt-badge--up');
    if (vr.direcao === 'baixa') badge.classList.add('dxt-badge--down');
    badge.title = `Venda ${P.fmtSinal(vr.abs)} (${P.fmtPct(vr.pct)}) contra o fechamento de ${P.fmtDataBr(anterior.data)}`;
  } else {
    badge.textContent = '—';
    badge.title = 'Sem fechamento anterior para comparar';
  }

  const vendas = cotacoes.filter((c) => c.data <= ref).map((c) => c.venda);
  campo('spark').innerHTML = sparkline(vendas, vr && vr.direcao);
  campo('paridade').textContent = P.textoParidade(m.codigo, atual.paridadeVenda);
  const hora = P.fmtHora(atual.dataHora);
  campo('data').textContent = `${P.fmtDataBr(atual.data)}${hora ? ` · ${hora}` : ''}`;
  el.setAttribute('aria-label',
    `${m.nome} (${m.codigo}): venda R$ ${P.fmtCotacao(atual.venda)}, compra R$ ${P.fmtCotacao(atual.compra)}` +
    `${vr ? `, ${P.fmtPct(vr.pct)} contra o fechamento anterior` : ''}, boletim de ${P.fmtDataBr(atual.data)}. Abrir o histórico.`);
  return atual;
}

async function carregarPainel() {
  const token = ++painelToken;
  let ref = painelData.value;
  if (!P.isoValido(ref) || ref > HOJE) {
    ref = HOJE;
    painelData.value = HOJE;
  }
  painelRef = ref;
  const inicio = P.somarDias(ref, -10);
  painelCards.innerHTML = P.MOEDAS.map(cardHtml).join('');
  painelBadge.textContent = `${P.MOEDAS.length} moedas`;
  painelAtualizar.disabled = true;
  let feitos = 0;
  const total = P.MOEDAS.length;
  setStatus(painelStatus, `Consultando o Banco Central… 0/${total}`);

  // No máximo 4 consultas ao mesmo tempo: o BCB responde melhor assim.
  const resultados = await P.emPool(P.MOEDAS.map((m) => async () => {
    try {
      const r = await buscarPtax(m.codigo, inicio, ref);
      return token === painelToken ? preencherCard(m, r.cotacoes, ref) : null;
    } finally {
      feitos++;
      if (token === painelToken) setStatus(painelStatus, `Consultando o Banco Central… ${feitos}/${total}`);
    }
  }), 4);
  if (token !== painelToken) return;
  painelAtualizar.disabled = false;

  const datas = new Set();
  let falhas = 0;
  resultados.forEach((r, i) => {
    if (r.ok && r.valor) datas.add(r.valor.data);
    if (!r.ok) {
      falhas++;
      const el = painelCards.querySelector(`[data-moeda="${P.MOEDAS[i].codigo}"]`);
      if (el) erroCard(el, `Falha ao consultar: ${r.erro.message}`);
    }
  });

  if (datas.size === 1) {
    const [d] = datas;
    painelBadge.textContent = `Boletim de ${P.fmtDataBr(d)}`;
  } else if (datas.size > 1) {
    painelBadge.textContent = `Últimos boletins até ${P.fmtDataBr(ref)}`;
  }
  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (falhas === total) setStatus(painelStatus, 'Não foi possível consultar o Banco Central · tente Atualizar', 'err');
  else if (falhas) setStatus(painelStatus, `Atualizado às ${agora} · ${falhas} moeda(s) com falha`, 'warn');
  else setStatus(painelStatus, `Atualizado às ${agora}${ref < HOJE ? ` · data escolhida ${P.fmtDataBr(ref)}` : ''}`);
}

painelCards.addEventListener('click', (e) => {
  const a = e.target.closest('a.mcard');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // nova aba segue o href
  e.preventDefault();
  abrirHistorico(a.dataset.moeda, painelRef);
});
painelData.addEventListener('change', carregarPainel);
$('painelRecente').addEventListener('click', () => {
  painelData.value = HOJE;
  carregarPainel();
});
painelAtualizar.addEventListener('click', () => {
  cacheApi.clear();
  carregarPainel();
});

/* ============================== Histórico ================================= */

const histMoeda = $('histMoeda');
const histDe = $('histDe');
const histAte = $('histAte');
const histStatus = $('histStatus');
const histAtalhos = $('histAtalhos');
const histMedidas = $('histMedidas');
const histTbody = document.querySelector('#histTabela tbody');
const btnCsv = $('btnCsv');
const btnXlsx = $('btnXlsx');
const btnSap = $('btnSap');

let histAtalho = '3M';
let histMedida = 'venda';
let histToken = 0;
let hist = { moeda: null, inicio: null, fim: null, cotacoes: [], erro: null };
let ordem = { chave: 'data', dir: 'desc' };

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function definirPeriodo(atalho, fim) {
  const p = P.periodoDoAtalho(atalho, fim);
  histDe.value = p.inicio;
  histAte.value = p.fim;
  histAtalho = atalho;
  marcarGrupo(histAtalhos, 'atalho', histAtalho);
}

function abrirHistorico(moeda, ref) {
  histMoeda.value = moeda;
  definirPeriodo(histAtalho || '3M', P.isoValido(ref) && ref <= HOJE ? ref : HOJE);
  iniciadas.add('historico');
  mostrarView('historico');
  carregarHistorico();
  if (window.scrollY > 0) window.scrollTo({ top: 0 });
}

function habilitarExportacao(sim) {
  btnCsv.disabled = !sim;
  btnXlsx.disabled = !sim;
  btnSap.disabled = !sim;
}

async function carregarHistorico() {
  const moeda = histMoeda.value;
  let fim = histAte.value;
  let inicio = histDe.value;
  const avisos = [];
  if (!P.isoValido(fim) || fim > HOJE) fim = HOJE;
  if (!P.isoValido(inicio)) inicio = P.somarMeses(fim, -3);
  if (inicio > fim) {
    [inicio, fim] = [fim, inicio];
    avisos.push('datas invertidas');
  }
  const limite = P.somarAnos(fim, -P.PERIODO_MAXIMO_ANOS);
  if (inicio < limite) {
    inicio = limite;
    avisos.push(`período limitado a ${P.PERIODO_MAXIMO_ANOS} anos`);
  }
  histDe.value = inicio;
  histAte.value = fim;
  armazenamento.gravar(CHAVE_MOEDA, moeda);
  atualizarEndereco();

  const token = ++histToken;
  habilitarExportacao(false);
  setStatus(histStatus, `Consultando ${moeda}…`);
  renderSerie(true);
  try {
    const r = await buscarPtax(moeda, inicio, fim);
    if (token !== histToken) return;
    hist = { moeda, inicio, fim, cotacoes: r.cotacoes, erro: null };
    renderHistorico();
    const n = r.cotacoes.length;
    if (n) {
      setStatus(histStatus, `${n} ${n === 1 ? 'fechamento' : 'fechamentos'} · ${P.fmtDataBr(inicio)} a ${P.fmtDataBr(fim)}${avisos.length ? ` · ${avisos.join(' · ')}` : ''}`, avisos.length ? 'warn' : null);
    } else {
      setStatus(histStatus, `Sem PTAX de ${moeda} no período`, 'warn');
    }
  } catch (e) {
    if (token !== histToken) return;
    hist = { moeda, inicio, fim, cotacoes: [], erro: e.message };
    renderHistorico();
    setStatus(histStatus, 'Falha na consulta ao Banco Central', 'err');
  }
}

function renderHistorico() {
  const { moeda, cotacoes } = hist;
  const info = P.moedaPorCodigo(moeda);
  const n = cotacoes.length;
  const atual = cotacoes[n - 1] ?? null;
  const anterior = cotacoes[n - 2] ?? null;

  $('kpiVenda').textContent = atual ? `R$ ${P.fmtCotacao(atual.venda)}` : '—';
  $('kpiCompra').textContent = atual ? `Compra R$ ${P.fmtCotacao(atual.compra)}` : 'Compra —';
  $('kpiData').textContent = atual ? `${P.fmtDataBr(atual.data)}${P.fmtHora(atual.dataHora) ? ` · ${P.fmtHora(atual.dataHora)}` : ''}` : '—';

  const vr = atual && anterior ? P.variacao(atual.venda, anterior.venda) : null;
  const kpiVar = $('kpiVar');
  const kpiVarAbs = $('kpiVarAbs');
  kpiVar.textContent = vr ? P.fmtPct(vr.pct) : '—';
  kpiVar.classList.toggle('dxt-up', !!vr && vr.direcao === 'alta');
  kpiVar.classList.toggle('dxt-down', !!vr && vr.direcao === 'baixa');
  kpiVarAbs.textContent = vr ? `${P.fmtSinal(vr.abs)} R$` : '—';
  kpiVarAbs.classList.toggle('dxt-badge--up', !!vr && vr.direcao === 'alta');
  kpiVarAbs.classList.toggle('dxt-badge--down', !!vr && vr.direcao === 'baixa');
  $('kpiAnterior').textContent = anterior ? `Anterior ${P.fmtDataBr(anterior.data)} · ${P.fmtCotacao(anterior.venda)}` : 'Anterior —';

  $('kpiParidade').textContent = moeda === 'USD' ? '1' : atual ? P.fmtCotacao(atual.paridadeVenda) : '—';
  $('kpiTipo').textContent = info ? `Tipo ${info.tipo}` : 'Tipo —';
  $('kpiUnidade').textContent = P.unidadeParidade(moeda);

  renderSerie(false);
  renderTabela();
  habilitarExportacao(n > 0);
}

function rotuloEixo(iso, span) {
  const [a, m, d] = iso.split('-');
  return span > 120 ? `${MESES[Number(m) - 1]}/${a.slice(2)}` : `${d}/${m}`;
}

function renderSerie(carregando) {
  const { moeda, cotacoes, inicio, fim } = hist;
  const pontos = cotacoes.map((c) => ({ x: c.data, y: P.valorDaMedida(c, histMedida) }));
  const st = P.estatisticas(pontos.map((p) => p.y));

  $('statMin').textContent = st ? P.fmtCotacao(st.min) : '—';
  $('statMax').textContent = st ? P.fmtCotacao(st.max) : '—';
  $('statMed').textContent = st ? P.fmtTaxa(st.media) : '—';
  $('statVar').textContent = st && st.variacaoPct !== null ? P.fmtPct(st.variacaoPct) : '—';
  const pill = $('statVarPill');
  pill.classList.toggle('dxt-badge--up', !!st && st.variacaoPct > 0);
  pill.classList.toggle('dxt-badge--down', !!st && st.variacaoPct < 0);

  if (!moeda) return;
  const rotulo = { venda: 'PTAX de venda (R$)', compra: 'PTAX de compra (R$)', paridade: `Paridade (${P.unidadeParidade(moeda)})` }[histMedida];
  const span = inicio && fim ? P.diasEntre(inicio, fim) : 0;
  const el = $('histGrafico');
  el.innerHTML = graficoLinhas({
    id: 'historico',
    altura: el.clientWidth && el.clientWidth < 560 ? 260 : 340,
    ariaLabel: `${rotulo} de ${moeda} de ${P.fmtDataBr(inicio)} a ${P.fmtDataBr(fim)}`,
    carregando,
    vazio: hist.erro ? `Não foi possível consultar a PTAX: ${hist.erro}` : carregando ? 'Consultando o Banco Central…' : 'Sem cotações no período.',
    x: { tipo: 'data', formatar: (iso) => rotuloEixo(iso, span) },
    y: { formatar: (v, casas) => P.fmtNumero(v, casas, casas), folgaMinima: st ? Math.max(Math.abs(st.media) * 0.001, 1e-6) : undefined },
    tooltip: { titulo: (iso) => P.fmtDataBr(iso), valor: (v) => P.fmtCotacao(v) },
    series: [{ chave: histMedida, rotulo, slot: 0, pontos }],
  });
  montarGraficos(el);
}

function renderTabela() {
  const linhas = P.ordenarCotacoes(hist.cotacoes, ordem.chave, ordem.dir);
  const par = (v) => (Number.isFinite(v) ? P.fmtCotacao(v) : '—');
  histTbody.innerHTML = linhas.map((c) =>
    `<tr><td>${P.fmtDataBr(c.data)}</td><td class="right">${P.fmtCotacao(c.compra)}</td><td class="right">${P.fmtCotacao(c.venda)}</td>` +
    `<td class="right">${par(c.paridadeCompra)}</td><td class="right">${par(c.paridadeVenda)}</td><td class="right">${esc(P.fmtHora(c.dataHora))}</td></tr>`).join('');
  $('histContagem').textContent = `${linhas.length} ${linhas.length === 1 ? 'fechamento' : 'fechamentos'}`;
  document.querySelectorAll('#histTabela .th-ord').forEach((b) => {
    const th = b.closest('th');
    if (b.dataset.chave === ordem.chave) th.setAttribute('aria-sort', ordem.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
}

histMoeda.addEventListener('change', carregarHistorico);
for (const campo of [histDe, histAte]) {
  campo.addEventListener('change', () => {
    histAtalho = null;
    marcarGrupo(histAtalhos, 'atalho', null);
    carregarHistorico();
  });
}
histAtalhos.addEventListener('click', (e) => {
  const b = e.target.closest('.rng');
  if (!b) return;
  definirPeriodo(b.dataset.atalho, P.isoValido(histAte.value) && histAte.value <= HOJE ? histAte.value : HOJE);
  carregarHistorico();
});
histMedidas.addEventListener('click', (e) => {
  const b = e.target.closest('.rng');
  if (!b) return;
  histMedida = b.dataset.medida;
  marcarGrupo(histMedidas, 'medida', histMedida);
  renderSerie(false);
});
document.querySelectorAll('#histTabela .th-ord').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.dataset.chave;
    ordem = ordem.chave === k ? { chave: k, dir: ordem.dir === 'asc' ? 'desc' : 'asc' } : { chave: k, dir: 'desc' };
    renderTabela();
  });
});

/* ------------------------------ Exportação -------------------------------- */

const nomeBase = () => `PTAX ${hist.moeda} ${P.sufixoPeriodo(hist.inicio, hist.fim)}`;

btnCsv.addEventListener('click', () => {
  if (!hist.cotacoes.length) return;
  // BOM para o Excel abrir os acentos em UTF-8.
  baixar(`﻿${P.gerarCsv(hist.cotacoes, hist.moeda)}`, `${nomeBase()}.csv`, 'text/csv;charset=utf-8');
});

btnXlsx.addEventListener('click', async () => {
  if (!hist.cotacoes.length) return;
  btnXlsx.disabled = true;
  try {
    const XLSX = await carregarLib('XLSX');
    const ws = XLSX.utils.aoa_to_sheet(P.linhasPlanilha(hist.cotacoes, hist.moeda));
    ws['!cols'] = [12, 8, 13, 13, 15, 15, 18, 24].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PTAX');
    XLSX.writeFile(wb, `${nomeBase()}.xlsx`);
  } catch (err) {
    setStatus(histStatus, `Excel indisponível (${err.message}) · use o CSV`, 'err');
  } finally {
    btnXlsx.disabled = hist.cotacoes.length === 0;
  }
});

/* --------------------------- Carga SAP (F2610) ---------------------------- */

const modalSap = $('modalSap');
const sapCategoria = $('sapCategoria');
const sapTipo = $('sapTipo');
const sapLadoGrupo = $('sapLado');
let sapLado = 'venda';
let focoAnterior = null;

function abrirModal(el) {
  focoAnterior = document.activeElement;
  el.hidden = false;
  const b = el.querySelector('button');
  if (b) b.focus();
}
function fecharModal(el) {
  if (el.hidden) return;
  el.hidden = true;
  if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus();
}

const linhasSapAtuais = () =>
  P.linhasSap(hist.cotacoes, { categoria: sapCategoria.value, tipoTaxa: sapTipo.value, moedaOrigem: hist.moeda, taxa: sapLado });

function renderSapPrevia() {
  const [cabecalho, ...linhas] = linhasSapAtuais();
  const tabela = $('sapPrevia');
  tabela.tHead.innerHTML = `<tr>${cabecalho.map((c, i) => `<th${i === 5 ? ' class="right"' : ''}>${esc(c)}</th>`).join('')}</tr>`;
  const amostra = linhas.length <= 6 ? linhas : [...linhas.slice(0, 3), null, ...linhas.slice(-2)];
  tabela.tBodies[0].innerHTML = amostra.map((l) => (l === null
    ? `<tr><td colspan="6" class="reticencias">… mais ${linhas.length - 5} linhas …</td></tr>`
    : `<tr>${l.map((v, i) => `<td${i === 5 ? ' class="right"' : ''}>${esc(i === 5 ? P.fmtCotacao(v) : v)}</td>`).join('')}</tr>`)).join('');
  $('sapPar').textContent = `${hist.moeda} → BRL`;
  $('sapResumo').textContent =
    `${hist.moeda}/BRL · ${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'} · ${P.fmtDataBr(hist.inicio)} a ${P.fmtDataBr(hist.fim)} · PTAX de ${sapLado}`;
}

btnSap.addEventListener('click', () => {
  if (!hist.cotacoes.length) return;
  renderSapPrevia();
  abrirModal(modalSap);
});
sapCategoria.addEventListener('input', renderSapPrevia);
sapTipo.addEventListener('input', renderSapPrevia);
sapLadoGrupo.addEventListener('click', (e) => {
  const b = e.target.closest('.rng');
  if (!b) return;
  sapLado = b.dataset.lado;
  marcarGrupo(sapLadoGrupo, 'lado', sapLado);
  renderSapPrevia();
});
$('btnSapGerar').addEventListener('click', async (e) => {
  const botao = e.currentTarget;
  const aoa = linhasSapAtuais();
  const tipo = aoa[1] ? aoa[1][1] : 'M';
  botao.disabled = true;
  try {
    const XLSX = await carregarLib('XLSX');
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [24, 22, 16, 16, 14, 16].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `Dados de Mercado Carga Cambio ${hist.moeda}-BRL ${tipo} ${P.sufixoPeriodo(hist.inicio, hist.fim)}.xlsx`);
    fecharModal(modalSap);
  } catch (err) {
    $('sapResumo').textContent = `Não foi possível gerar o Excel (${err.message}). Tente de novo.`;
  } finally {
    botao.disabled = false;
  }
});
$('sapFechar').addEventListener('click', () => fecharModal(modalSap));
$('sapCancelar').addEventListener('click', () => fecharModal(modalSap));
modalSap.addEventListener('click', (e) => { if (e.target === modalSap) fecharModal(modalSap); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(modalSap); });

/* ============================== Conversor ================================= */

const convValor = $('convValor');
const convDe = $('convDe');
const convPara = $('convPara');
const convData = $('convData');
const convLadoGrupo = $('convLado');
let convLado = 'venda';
let convToken = 0;
let convEspera = 0;

function opcoesMoedas(select, comReal) {
  select.innerHTML =
    (comReal ? '<option value="BRL">BRL — Real</option>' : '') +
    P.MOEDAS.map((m) => `<option value="${m.codigo}">${m.codigo} — ${esc(m.nome)}</option>`).join('');
}

function erroConversor(mensagem) {
  const res = $('convResultado');
  res.textContent = '—';
  res.classList.add('is-vazio');
  $('convResumo').innerHTML = '';
  $('convConta').innerHTML = `<div class="conv-erro">${esc(mensagem)}</div>`;
  $('convTaxasBox').hidden = true;
}

async function converter() {
  const valor = P.parseValorBr(convValor.value);
  const de = convDe.value;
  const para = convPara.value;
  let data = convData.value;
  if (!P.isoValido(data) || data > HOJE) {
    data = HOJE;
    convData.value = HOJE;
  }
  armazenamento.gravar(CHAVE_CONVERSOR, JSON.stringify({ de, para, lado: convLado }));
  const token = ++convToken;
  if (!Number.isFinite(valor) || valor < 0) {
    erroConversor('Informe um valor numérico, por exemplo 1.000,00.');
    return;
  }

  const moedas = [...new Set([de, para].filter((c) => c !== 'BRL'))];
  $('convResultado').classList.add('is-vazio');
  try {
    const inicio = P.somarDias(data, -10);
    const respostas = await Promise.all(moedas.map((c) => buscarPtax(c, inicio, data)));
    if (token !== convToken) return;
    const taxas = {};
    moedas.forEach((c, i) => {
      const { atual } = P.fechamentoAte(respostas[i].cotacoes, data);
      if (!atual) throw new Error(`Sem PTAX de fechamento de ${c} nos 10 dias até ${P.fmtDataBr(data)}.`);
      taxas[c] = atual;
    });
    const r = P.converter({ valor, de, para, taxas, lado: convLado });

    const res = $('convResultado');
    res.textContent = P.fmtMoeda(r.resultado, para);
    res.classList.remove('is-vazio');

    const datasUsadas = [...new Set(Object.values(taxas).map((t) => t.data))];
    const selos = [`<span class="dxt-badge">${esc(P.fmtMoeda(valor, de))} → ${esc(para)}</span>`, `<span class="dxt-badge">PTAX de ${convLado}</span>`];
    for (const d of datasUsadas) {
      selos.push(d === data
        ? `<span class="dxt-badge">Fechamento de ${P.fmtDataBr(d)}</span>`
        : `<span class="dxt-badge dxt-badge--down">Sem boletim em ${P.fmtDataBr(data)} · usado o de ${P.fmtDataBr(d)}</span>`);
    }
    $('convResumo').innerHTML = selos.join('');
    $('convConta').innerHTML = r.passos.map((p) =>
      `<div class="passo-conta"><div class="formula">${esc(p.conta)}</div><div class="explica">${esc(p.nota)}</div></div>`).join('');

    const box = $('convTaxasBox');
    box.hidden = moedas.length === 0;
    $('convTaxas').innerHTML = moedas.map((c) => {
      const t = taxas[c];
      const hora = P.fmtHora(t.dataHora);
      return `<tr><td>${c}</td><td class="right${convLado === 'compra' ? ' usada' : ''}">${P.fmtCotacao(t.compra)}</td>` +
        `<td class="right${convLado === 'venda' ? ' usada' : ''}">${P.fmtCotacao(t.venda)}</td>` +
        `<td class="right">${P.fmtDataBr(t.data)}${hora ? ` ${hora}` : ''}</td></tr>`;
    }).join('');
  } catch (e) {
    if (token !== convToken) return;
    erroConversor(e.message);
  }
}

convValor.addEventListener('input', () => {
  clearTimeout(convEspera);
  convEspera = setTimeout(converter, 350);
});
convValor.addEventListener('blur', () => {
  const v = P.parseValorBr(convValor.value);
  if (Number.isFinite(v)) convValor.value = P.fmtValor(v);
});
convValor.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(convEspera); converter(); } });
convDe.addEventListener('change', converter);
convPara.addEventListener('change', converter);
convData.addEventListener('change', converter);
$('convInverter').addEventListener('click', () => {
  [convDe.value, convPara.value] = [convPara.value, convDe.value];
  converter();
});
convLadoGrupo.addEventListener('click', (e) => {
  const b = e.target.closest('.rng');
  if (!b) return;
  convLado = b.dataset.lado;
  marcarGrupo(convLadoGrupo, 'lado', convLado);
  converter();
});

/* ================================ Início ================================== */

opcoesMoedas(histMoeda, false);
opcoesMoedas(convDe, true);
opcoesMoedas(convPara, true);
for (const campo of [painelData, histDe, histAte, convData]) campo.max = HOJE;
painelData.value = HOJE;
convData.value = HOJE;

const moedaUrl = P.moedaPorCodigo(PARAMS.get('moeda'));
const moedaSalva = P.moedaPorCodigo(armazenamento.ler(CHAVE_MOEDA));
histMoeda.value = (moedaUrl || moedaSalva || P.MOEDAS[0]).codigo;
definirPeriodo('3M', HOJE);
marcarGrupo(histMedidas, 'medida', histMedida);

convDe.value = 'USD';
convPara.value = 'BRL';
try {
  const salvo = JSON.parse(armazenamento.ler(CHAVE_CONVERSOR) || 'null');
  const valida = (c) => c === 'BRL' || !!P.moedaPorCodigo(c);
  if (salvo && valida(salvo.de) && valida(salvo.para)) {
    convDe.value = salvo.de;
    convPara.value = salvo.para;
  }
  if (salvo && (salvo.lado === 'compra' || salvo.lado === 'venda')) convLado = salvo.lado;
} catch { /* preferência ilegível: fica o padrão */ }
if (moedaUrl && location.hash === '#conversor') {
  convDe.value = moedaUrl.codigo;
  if (convPara.value === moedaUrl.codigo) convPara.value = 'BRL';
}
marcarGrupo(convLadoGrupo, 'lado', convLado);
marcarGrupo(sapLadoGrupo, 'lado', sapLado);

// No modo incorporado, links para o site abrem em outra aba — dentro do iframe
// o site inteiro abriria aninhado na moldura.
if (EMBUTIDO) {
  document.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
}

mostrarView(location.hash === '#conversor' ? 'conversor' : location.hash === '#historico' || moedaUrl ? 'historico' : 'painel');
