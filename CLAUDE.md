# CLAUDE.md — Cotação de Moedas

PTAX do Banco Central (compra, venda, paridade) das 10 moedas da PTAX: painel do fechamento, histórico
com gráfico e exportação (CSV, Excel, carga SAP F2610) e conversor. Ferramenta de Dados de Mercado da
Dexterity. Página estática sem build (HTML + ES modules) + função da Vercel `api/ptax.js` (proxy da API
Olinda do BCB).

## Regras

- **Contas e formatação só em `assets/ptax.js`** (funções puras, sem DOM nem rede, usadas pela interface,
  pela API e pelos testes). Mudou regra? Teste em `tests/` (`npm test`).
- **Visual**: `assets/dexterity.css` é cópia byte a byte do padrão das ferramentas de Dados de Mercado —
  não editar aqui. Estilos próprios em `assets/app.css`, só com tokens `--dxt-*`. Cerceta = alta, âmbar =
  baixa/atenção, vermelho só erro; cantos retos, sem sombra.
- **Rodapé** idêntico nos cinco apps (coluna Ferramentas); aqui o link "Cotação de Moedas" leva
  `aria-current="page"`.
- **Endereços** sempre no domínio da Dexterity (`www.dexterityit.com.br/cotacao-de-moedas` no canonical,
  og:url, rodapé e posts). `*.vercel.app` só no `src` do iframe de `site/` e no README.
- **`?embed=1`** (iframe do site) tem de continuar funcionando: blocos que só fazem sentido fora do iframe
  levam `class="dxt-so-site"`; `localStorage` sempre em `try/catch`.
- **`site/` é a fonte da verdade do Odoo** (página e cartão da vitrine). Perguntas frequentes: o texto
  visível e o JSON-LD `FAQPage` andam juntos (no `index.html` e no bloco do site).
- **Responsivo**: testar a 390 px — sem rolagem horizontal da página; tabelas dentro de `.table-wrap`.
- A API mantém `Access-Control-Allow-Origin: *` e o cache na borda; sem segredos no código.
- Textos em português do Brasil, vocabulário de tesouraria (PTAX, boletim de fechamento, paridade, taxa
  cruzada).

## Comandos

```bash
npm test        # node --test tests/*.test.mjs
npm run dev     # servidor local com /api em :8080 (PORT=8131 para outra porta)
```

Navegador: Playwright com Chromium (`/opt/pw-browsers`), 1440 px e 390 px, normal e `?embed=1`. Se o BCB
ou o cdn.jsdelivr.net estiverem bloqueados, simule `/api/ptax` com `page.route`.

## Publicação

Vercel, time `dexterityit`, projeto `cotacaodemoedas` (a criar — passo a passo no README). No site (Odoo)
a ferramenta entra por iframe na página `/cotacao-de-moedas`, conforme a MK-02-004.
