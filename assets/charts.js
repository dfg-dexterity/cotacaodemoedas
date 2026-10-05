/*
 * charts.js — gráficos SVG de linhas sem dependências (somente interface).
 *
 * Copiado da Calculadora MTM (repositório calculadoramtmdexterity, assets/charts.js).
 * Única adaptação: `spec.y.folgaMinima` (folga mínima do eixo Y, padrão 0,05), para
 * séries de valor pequeno como a PTAX do iene (~0,04) não virarem uma linha reta.
 *
 * Este arquivo NÃO contém cálculo financeiro nenhum: recebe séries já prontas
 * ({ x, y }) e desenha eixos, linhas, rótulos diretos e o crosshair com tooltip
 * no visual Dexterity (tema escuro único, cantos retos, fios de 1px, sem sombra).
 *
 * Uso: `graficoLinhas(spec)` devolve o HTML do contêiner e registra a spec;
 * `montarGraficos(root)` mede a largura real e desenha (idempotente). Um único
 * ouvinte de `resize` (150 ms) redesenha os gráficos ainda presentes na página.
 */

export const PALETA = {
  // Paleta categórica das séries (cerceta, âmbar, roxo, verde, rosa, lilás — sem vermelho, reservado a erro).
  // Validada sobre #242424 pelos dois critérios em uso: validador do skill dataviz (banda de luminosidade,
  // croma, contraste ≥ 3:1, pares adjacentes sob daltonismo; a separação fica na faixa 6–8, admitida porque
  // toda série tem rótulo direto, legenda e tooltip) e validador do app Curvas B3 (ΔE CIE76 ≥ 12 entre TODOS
  // os pares em visão normal, deuteranopia, protanopia e tritanopia). Ordem fixa: a cor segue a data, nunca a posição.
  series: ['#10a49e', '#d07600', '#c068c3', '#508e53', '#ad4f7f', '#aa6ce8'],
  surface: '#242424', grid: '#313030', axis: '#3f3f3d', ink: '#F7F3E7', ink2: '#A49F98', muted: '#908C85',
};
export const MAX_SERIES = 6;

const NS = 'http://www.w3.org/2000/svg';
const MARGEM = { topo: 12, base: 28, dir: 16, dirRotulos: 76 };
const ESPERA_MS = 150;
const DIA_MS = 86400000;

const registro = new Map(); // id -> { spec, el, largura, esconder }
const abertos = new Set();  // leituras (crosshair) visíveis — toque fora do gráfico fecha
let ouvintesInstalados = false;
let observador = null;
let temporizador = 0;

const ESTILO = `
.grafico{position:relative;width:100%;min-width:0;font-family:var(--dxt-font-sans,Figtree,system-ui,sans-serif)}
.grafico svg{display:block;width:100%;overflow:hidden}
.grafico.is-carregando{opacity:.45}
.grafico text{font-family:inherit;font-size:11px;fill:${PALETA.muted};font-variant-numeric:tabular-nums}
.grafico text.grafico-rotulo{fill:${PALETA.ink2}}
.grafico .grafico-alvo{cursor:crosshair}
.grafico:focus:not(:focus-visible){outline:none}
.grafico:focus-visible{outline:2px solid var(--dxt-amarelo,#FFA436);outline-offset:3px}
.grafico-tip{position:absolute;z-index:5;pointer-events:none;max-width:260px;padding:8px 10px;background:var(--dxt-surface,#242424);border:1px solid var(--dxt-line,rgba(247,243,231,.13));font-size:12px;line-height:1.45;color:${PALETA.ink}}
.grafico-tip[hidden]{display:none}
.grafico-tip-titulo{color:${PALETA.ink2};margin-bottom:4px}
.grafico-tip-row{display:flex;align-items:center;gap:8px;white-space:nowrap}
.grafico-tip-key{flex:none;width:12px;height:2px}
.grafico-tip-val{font-family:var(--dxt-font-mono,'IBM Plex Mono',monospace);font-weight:600;font-variant-numeric:tabular-nums;color:${PALETA.ink}}
.grafico-tip-nome{color:${PALETA.ink2}}
.grafico-vazio{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px;color:${PALETA.muted};font-size:14px}
`;

/* ------------------------------- API pública ------------------------------ */

/** Registra a spec e devolve o HTML do contêiner (vazio até `montarGraficos`). */
export function graficoLinhas(spec) {
  if (!spec || typeof spec.id !== 'string' || !spec.id) throw new TypeError('graficoLinhas: spec.id (texto) é obrigatório');
  const anterior = registro.get(spec.id);
  registro.set(spec.id, { spec, el: anterior ? anterior.el : null, largura: 0, esconder: anterior ? anterior.esconder : null });
  return `<div class="grafico" data-grafico="${escapar(spec.id)}"></div>`;
}

/** Desenha todo `[data-grafico]` dentro de `root` cuja spec está registrada; pode ser chamado quantas vezes for preciso. */
export function montarGraficos(root = document) {
  if (typeof document === 'undefined' || !root) return;
  injetarCss();
  instalarOuvintes();
  const alvos = root.nodeType === 1 && root.hasAttribute('data-grafico') ? [root] : [];
  if (root.querySelectorAll) alvos.push(...root.querySelectorAll('[data-grafico]'));
  for (const el of alvos) {
    const item = registro.get(el.getAttribute('data-grafico'));
    if (item) desenhar(el, item);
  }
}

/* ------------------------------- Utilidades ------------------------------- */

function svg(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  return e;
}
function texto(attrs, conteudo) {
  const t = svg('text', attrs);
  t.textContent = conteudo;
  return t;
}
function html(tag, classe, conteudo) {
  const e = document.createElement(tag);
  e.className = classe;
  if (conteudo != null) e.textContent = conteudo;
  return e;
}
function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function seletorId(id) {
  return globalThis.CSS && globalThis.CSS.escape ? globalThis.CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
}
const arred = (v) => Math.round(v * 100) / 100;
function isoParaDias(iso) {
  if (typeof iso !== 'string') return NaN;
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d) / DIA_MS;
}
const diasParaIso = (dias) => new Date(dias * DIA_MS).toISOString().slice(0, 10);

/**
 * Ticks "bonitos" (passos 1, 2, 2,5 ou 5 × 10^n), contagem próxima do alvo, todos dentro de [lo, hi].
 * Devolve também `casas`: as casas decimais que o passo exige (2,5 × 10^n pede uma a mais) — o
 * formatador do eixo precisa delas para não mostrar dois ticks distintos com o mesmo rótulo.
 */
function ticksBonitos(lo, hi, alvo) {
  if (!(hi > lo)) return { ticks: [lo], casas: 0 };
  const bruto = (hi - lo) / Math.max(1, alvo - 1);
  const expo = Math.floor(Math.log10(bruto));
  const mag = 10 ** expo;
  let melhor = null;
  for (const f of [1, 2, 2.5, 5, 10]) {
    const passo = f * mag;
    const ini = Math.ceil(lo / passo - 1e-9), fim = Math.floor(hi / passo + 1e-9), n = fim - ini + 1;
    if (n >= 2 && (!melhor || Math.abs(n - alvo) <= Math.abs(melhor.n - alvo))) melhor = { f, passo, ini, fim, n };
  }
  if (!melhor) return { ticks: [lo, hi], casas: Math.max(0, -expo) };
  const casas = Math.max(0, -expo) + (melhor.f === 2.5 ? 1 : 0);
  const ticks = [];
  for (let k = melhor.ini; k <= melhor.fim; k++) ticks.push(Number((k * melhor.passo).toFixed(casas)));
  return { ticks, casas };
}

/* Interpolação monótona cúbica (a mesma do `type="monotone"` do recharts / d3 monotoneX): suave, sem ultrapassar os pontos. */
function inclinacao3(x0, y0, x1, y1, x2, y2) {
  const h0 = x1 - x0, h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}
function inclinacao2(x0, y0, x1, y1, t) {
  const h = x1 - x0;
  return h ? (3 * (y1 - y0) / h - t) / 2 : t;
}
/** Caminho SVG de um trecho contínuo (>= 2 pontos em pixels). */
function trecho(p) {
  const n = p.length;
  let d = `M${arred(p[0].x)},${arred(p[0].y)}`;
  if (n === 2) return `${d}L${arred(p[1].x)},${arred(p[1].y)}`;
  let t0 = 0;
  for (let i = 1; i < n; i++) {
    const a = p[i - 1], b = p[i];
    let t1 = i < n - 1 ? inclinacao3(a.x, a.y, b.x, b.y, p[i + 1].x, p[i + 1].y) : 0;
    if (i === 1) t0 = inclinacao2(a.x, a.y, b.x, b.y, t1);
    if (i === n - 1) t1 = inclinacao2(a.x, a.y, b.x, b.y, t0);
    const dx = (b.x - a.x) / 3;
    d += `C${arred(a.x + dx)},${arred(a.y + dx * t0)},${arred(b.x - dx)},${arred(b.y - dx * t1)},${arred(b.x)},${arred(b.y)}`;
    t0 = t1;
  }
  return d;
}

/* ------------------------------ Preparação -------------------------------- */

/** Normaliza as séries: x numérico (dias desde 1970 para 'data'), y nulo = lacuna; grade = união dos x com valor. */
function prepararDados(spec) {
  const tipoData = !!(spec.x && spec.x.tipo === 'data');
  const paraNumero = tipoData ? isoParaDias : Number;
  const origem = new Map(); // x numérico -> x original (ISO ou número), para formatar
  const uniao = new Set();
  const series = [];
  let yMin = Infinity, yMax = -Infinity;
  (spec.series || []).forEach((s, i) => {
    const pontos = [], mapa = new Map();
    for (const p of s.pontos || []) {
      const x = paraNumero(p.x);
      if (!Number.isFinite(x)) continue;
      const y = p.y == null || !Number.isFinite(Number(p.y)) ? null : Number(p.y);
      pontos.push({ x, y });
      if (y === null) continue;
      mapa.set(x, y);
      uniao.add(x);
      if (!origem.has(x)) origem.set(x, p.x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    if (!mapa.size) return; // série sem nenhum valor: nem linha, nem rótulo
    pontos.sort((a, b) => a.x - b.x);
    const slot = ((Math.trunc(Number(s.slot)) || 0) % PALETA.series.length + PALETA.series.length) % PALETA.series.length;
    series.push({ chave: s.chave != null ? String(s.chave) : String(i), rotulo: s.rotulo != null ? String(s.rotulo) : '', cor: PALETA.series[slot], pontos, mapa });
  });
  return { tipoData, series, origem, grade: [...uniao].sort((a, b) => a - b), yMin, yMax };
}

/* -------------------------------- Desenho --------------------------------- */

function desenhar(el, item) {
  const spec = item.spec;
  if (item.esconder) item.esconder();
  item.el = el;
  item.largura = el.clientWidth;
  if (observador) observador.observe(el);

  const W = el.clientWidth || 640;
  const H = Number(spec.altura) > 0 ? Number(spec.altura) : W < 560 ? 300 : 440;
  el.classList.add('grafico');
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${spec.ariaLabel || 'Gráfico de linhas'}. Setas para a esquerda e direita percorrem os pontos; Esc fecha a leitura.`);
  el.classList.toggle('is-carregando', !!spec.carregando);
  if (spec.carregando) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
  el.style.height = `${H}px`;
  el.replaceChildren();

  const { tipoData, series, origem, grade, yMin, yMax } = prepararDados(spec);
  if (!grade.length) {
    el.append(html('div', 'grafico-vazio', spec.vazio || 'Sem dados para exibir.'));
    el.firstChild.style.height = `${H}px`;
    return;
  }

  // Escalas: domínio Y com folga de 6% (mínimo spec.y.folgaMinima, padrão 0,05); margem esquerda pela largura do maior rótulo.
  const fmtX = (spec.x && spec.x.formatar) || String;
  const fmtY = (spec.y && spec.y.formatar) || String;
  const titulo = (spec.tooltip && spec.tooltip.titulo) || fmtX;
  const valor = (spec.tooltip && spec.tooltip.valor) || fmtY;
  const xOriginal = (x) => (tipoData ? (origem.has(x) ? origem.get(x) : diasParaIso(x)) : x);

  const folgaMinima = spec.y && Number(spec.y.folgaMinima) > 0 ? Number(spec.y.folgaMinima) : 0.05;
  const folga = Math.max((yMax - yMin) * 0.06, folgaMinima);
  const yLo = yMin - folga, yHi = yMax + folga;
  const { ticks: ticksY, casas: casasY } = ticksBonitos(yLo, yHi, 5);
  const rotulosY = ticksY.map((t) => String(fmtY(t, casasY)));
  const maiorRotulo = rotulosY.reduce((m, r) => Math.max(m, r.length), 0);
  const esq = 8 + Math.max(40, Math.ceil(maiorRotulo * 6.5) + 8);
  const dir = Math.max(esq + 24, W - (spec.rotulosDiretos ? MARGEM.dirRotulos : MARGEM.dir));
  const topo = MARGEM.topo, base = H - MARGEM.base;
  const xMin = grade[0], xMax = grade[grade.length - 1];
  const sx = (x) => (xMax > xMin ? esq + ((x - xMin) / (xMax - xMin)) * (dir - esq) : (esq + dir) / 2);
  const sy = (y) => base - ((y - yLo) / (yHi - yLo)) * (base - topo);

  // Ticks do eixo X: lista sugerida (ou ~6 bonitos) para 'numero'; datas espaçadas nos dados; nunca a menos de 40px.
  let candidatos = [];
  if (tipoData) {
    const n = grade.length, q = Math.min(6, n, Math.max(3, Math.floor((dir - esq) / 80)));
    for (let i = 0; i < q; i++) {
      const x = grade[Math.round((i * (n - 1)) / Math.max(1, q - 1))];
      if (!candidatos.includes(x)) candidatos.push(x);
    }
  } else {
    const sugeridos = spec.x && Array.isArray(spec.x.ticks) && spec.x.ticks.length ? spec.x.ticks : ticksBonitos(xMin, xMax, 6).ticks;
    candidatos = sugeridos.filter((t) => Number.isFinite(t) && t >= xMin && t <= xMax).sort((a, b) => a - b);
  }
  const ticksX = [];
  let ultimoPx = -Infinity;
  for (const t of candidatos) {
    const px = sx(t);
    if (px - ultimoPx >= 40) { ticksX.push(t); ultimoPx = px; }
  }

  const raiz = svg('svg', {
    width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMinYMin meet',
    role: 'img', 'aria-label': spec.ariaLabel || 'Gráfico de linhas', class: 'grafico-svg',
  });

  // Grade horizontal (fio sólido), eixo X e rótulos dos eixos.
  const gGrade = svg('g', { class: 'grafico-grade', 'shape-rendering': 'crispEdges' });
  for (const t of ticksY) {
    const y = Math.round(sy(t)) + 0.5;
    gGrade.append(svg('line', { x1: esq, x2: dir, y1: y, y2: y, stroke: PALETA.grid, 'stroke-width': 1 }));
  }
  const yEixo = Math.round(base) + 0.5;
  gGrade.append(svg('line', { x1: esq, x2: dir, y1: yEixo, y2: yEixo, stroke: PALETA.axis, 'stroke-width': 1 }));
  const gEixos = svg('g', { class: 'grafico-eixos' });
  ticksY.forEach((t, i) => gEixos.append(texto({ x: esq - 8, y: arred(sy(t)), dy: '0.35em', 'text-anchor': 'end' }, rotulosY[i])));
  for (const t of ticksX) {
    const rotulo = String(fmtX(xOriginal(t)));
    const meia = (rotulo.length * 6.5) / 2;
    const x = Math.min(Math.max(sx(t), meia + 2), W - meia - 2); // nunca sai do SVG
    gEixos.append(texto({ x: arred(x), y: base + 17, 'text-anchor': 'middle' }, rotulo));
  }

  // Linhas: um <path> por série; y nulo quebra o traço; valor isolado vira um ponto.
  const gLinhas = svg('g', { class: 'grafico-linhas' });
  for (const s of series) {
    let d = '', corrida = [];
    const fechar = () => {
      if (corrida.length >= 2) d += trecho(corrida);
      else if (corrida.length === 1) gLinhas.append(svg('circle', { cx: arred(corrida[0].x), cy: arred(corrida[0].y), r: 4, fill: s.cor, stroke: PALETA.surface, 'stroke-width': 2 }));
      corrida = [];
    };
    for (const p of s.pontos) p.y === null ? fechar() : corrida.push({ x: sx(p.x), y: sy(p.y) });
    fechar();
    gLinhas.append(svg('path', {
      d: d || 'M0,0', fill: 'none', stroke: s.cor, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      class: 'grafico-linha', 'data-serie': s.chave,
    }));
  }

  // Rótulos diretos na ponta: ordenados por y, afastados 16px; guia (fio) quando o rótulo sai da linha.
  const gRotulos = svg('g', { class: 'grafico-rotulos' });
  const textosRotulo = [];
  if (spec.rotulosDiretos) {
    const itens = [];
    for (const s of series) {
      const fim = s.pontos.reduce((acc, p) => (p.y !== null ? p : acc), null);
      if (fim) itens.push({ s, fx: sx(fim.x), fy: sy(fim.y), y: sy(fim.y) });
    }
    itens.sort((a, b) => a.y - b.y);
    for (let i = 1; i < itens.length; i++) if (itens[i].y - itens[i - 1].y < 16) itens[i].y = itens[i - 1].y + 16;
    for (let i = itens.length - 1; i >= 0; i--) itens[i].y = Math.min(itens[i].y, base - 4 - (itens.length - 1 - i) * 16);
    for (const it of itens) {
      if (Math.abs(it.y - it.fy) >= 3) {
        gRotulos.append(svg('line', { x1: arred(it.fx), y1: arred(it.fy), x2: dir + 8, y2: arred(it.y), stroke: PALETA.axis, 'stroke-width': 1 }));
      }
      gRotulos.append(svg('line', { x1: dir + 8, x2: dir + 18, y1: arred(it.y), y2: arred(it.y), stroke: it.s.cor, 'stroke-width': 2 }));
      textosRotulo.push(gRotulos.appendChild(texto({ x: dir + 22, y: arred(it.y), dy: '0.35em', class: 'grafico-rotulo' }, it.s.rotulo)));
    }
  }

  // Camada ativa: crosshair, pontos ativos (anel na cor da superfície) e alvo transparente sobre todo o plot.
  const gAtivo = svg('g', { class: 'grafico-ativo', visibility: 'hidden' });
  const cursor = gAtivo.appendChild(svg('line', { y1: topo, y2: base, stroke: PALETA.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
  const pontosAtivos = series.map((s) => gAtivo.appendChild(svg('circle', { r: 4, fill: s.cor, stroke: PALETA.surface, 'stroke-width': 2 })));
  const alvo = svg('rect', {
    x: esq, y: topo, width: dir - esq, height: base - topo, fill: 'transparent', 'pointer-events': 'all', class: 'grafico-alvo',
  });
  raiz.append(gGrade, gEixos, gLinhas, gRotulos, gAtivo, alvo);
  el.append(raiz);

  // Rótulo que não cabe na margem não é cortado: mede e abrevia.
  for (const tx of textosRotulo) {
    const cabe = W - 2 - Number(tx.getAttribute('x'));
    for (let s = tx.textContent; s.length > 1 && tx.getComputedTextLength() > cabe; s = s.slice(0, -1)) tx.textContent = `${s.slice(0, -1).trimEnd()}…`;
  }

  const tip = html('div', 'grafico-tip');
  tip.hidden = true;
  tip.setAttribute('aria-live', 'polite');
  el.append(tip);

  /* ------------------------ Crosshair e tooltip ------------------------- */
  const gradePx = grade.map(sx);
  let indice = -1, memoria = grade.length - 1;
  const escala = () => raiz.getBoundingClientRect().width / W || 1;

  const esconder = () => {
    indice = -1;
    gAtivo.setAttribute('visibility', 'hidden');
    tip.hidden = true;
    abertos.delete(item);
  };
  item.esconder = esconder;

  const indiceMaisProximo = (px) => {
    let lo = 0, hi = gradePx.length - 1;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (gradePx[meio] < px) lo = meio + 1; else hi = meio;
    }
    return lo > 0 && px - gradePx[lo - 1] < gradePx[lo] - px ? lo - 1 : lo;
  };

  // Tooltip: título, depois uma linha por série com valor (ordem decrescente) — sempre via textContent.
  const preencherTip = (xg) => {
    tip.replaceChildren(html('div', 'grafico-tip-titulo', String(titulo(xOriginal(xg)))));
    const linhas = series.map((s) => ({ s, v: s.mapa.get(xg) })).filter((r) => r.v !== undefined).sort((a, b) => b.v - a.v);
    for (const r of linhas) {
      const row = html('div', 'grafico-tip-row');
      const chave = html('span', 'grafico-tip-key');
      chave.style.background = r.s.cor;
      row.append(chave, html('span', 'grafico-tip-val', String(valor(r.v))), html('span', 'grafico-tip-nome', r.s.rotulo));
      tip.append(row);
    }
  };

  // Posiciona 12px à direita do cursor (px CSS do contêiner) e vira para a esquerda se estourar.
  const posicionarTip = (cx, cy) => {
    tip.hidden = false;
    const lw = tip.offsetWidth, lh = tip.offsetHeight;
    let left = cx + 12;
    if (left + lw > el.clientWidth) left = cx - 12 - lw;
    tip.style.left = `${Math.round(Math.max(0, left))}px`;
    tip.style.top = `${Math.round(Math.max(0, Math.min(cy - lh / 2, el.clientHeight - lh)))}px`;
  };

  const mostrar = (i, cyCss) => {
    indice = memoria = i;
    const xg = grade[i], px = gradePx[i];
    cursor.setAttribute('x1', arred(px));
    cursor.setAttribute('x2', arred(px));
    let soma = 0, n = 0;
    series.forEach((s, k) => {
      const v = s.mapa.get(xg), c = pontosAtivos[k];
      if (v === undefined) { c.setAttribute('visibility', 'hidden'); return; }
      c.setAttribute('cx', arred(px));
      c.setAttribute('cy', arred(sy(v)));
      c.removeAttribute('visibility');
      soma += sy(v); n++;
    });
    gAtivo.removeAttribute('visibility');
    preencherTip(xg);
    const k = escala();
    posicionarTip(px * k, cyCss != null ? cyCss : (n ? soma / n : (topo + base) / 2) * k);
    abertos.add(item);
  };

  const noPonteiro = (e) => {
    const m = raiz.getScreenCTM();
    if (m) mostrar(indiceMaisProximo((e.clientX - m.e) / m.a), e.clientY - el.getBoundingClientRect().top);
  };
  alvo.addEventListener('pointermove', noPonteiro);
  alvo.addEventListener('pointerdown', noPonteiro);
  alvo.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') esconder(); });
  el.onfocus = () => { if (indice < 0) mostrar(memoria); };
  el.onblur = esconder;
  el.onkeydown = (e) => {
    let i;
    if (e.key === 'ArrowRight') i = indice < 0 ? memoria : Math.min(grade.length - 1, indice + 1);
    else if (e.key === 'ArrowLeft') i = indice < 0 ? memoria : Math.max(0, indice - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = grade.length - 1;
    else if (e.key === 'Escape') { esconder(); return; }
    else return;
    e.preventDefault();
    mostrar(i);
  };
}

/* --------------------------- Estilo e ouvintes ---------------------------- */

function injetarCss() {
  if (document.getElementById('grafico-css')) return;
  document.head.append(Object.assign(document.createElement('style'), { id: 'grafico-css', textContent: ESTILO }));
}

function instalarOuvintes() {
  if (ouvintesInstalados) return;
  ouvintesInstalados = true;
  window.addEventListener('resize', agendarRedesenho);
  if (typeof ResizeObserver === 'function') {
    // Cobre mudanças de largura sem resize da janela (seção que aparece, painel que abre); só redesenha se a largura mudou.
    observador = new ResizeObserver((entradas) => {
      for (const en of entradas) {
        const item = registro.get(en.target.getAttribute('data-grafico') || '');
        if (item && item.el === en.target && Math.abs(en.target.clientWidth - item.largura) >= 1) { agendarRedesenho(); return; }
      }
    });
  }
  document.addEventListener('pointerdown', (e) => {
    for (const item of abertos) if (!item.el.contains(e.target)) item.esconder();
  }, true);
}

function agendarRedesenho() {
  clearTimeout(temporizador);
  temporizador = setTimeout(redesenharTodos, ESPERA_MS);
}

/** Redesenha os gráficos presentes na página cuja largura mudou; esquece os que saíram do documento. */
function redesenharTodos() {
  for (const [id, item] of registro) {
    const el = item.el && item.el.isConnected ? item.el : document.querySelector(`[data-grafico="${seletorId(id)}"]`);
    if (!el) {
      if (item.el) { if (observador) observador.unobserve(item.el); registro.delete(id); }
      continue;
    }
    if (!el.clientWidth) continue; // oculto: espera aparecer
    if (el === item.el && Math.abs(el.clientWidth - item.largura) < 1) continue;
    desenhar(el, item);
  }
}
