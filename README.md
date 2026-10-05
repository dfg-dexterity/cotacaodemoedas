# Cotação de Moedas

Cotação de Dados de Mercado: a PTAX do Banco Central (compra, venda e paridade com o dólar) das
dez moedas da PTAX — dólar americano, euro, libra esterlina, iene, franco suíço, dólar canadense,
dólar australiano e coroas dinamarquesa, norueguesa e sueca —, com painel do fechamento do dia,
série histórica com gráfico, conversor e exportação para CSV, Excel e carga no SAP (F2610).
Ferramenta gratuita da Dexterity IT Solutions, irmã das demais ferramentas de Dados de Mercado
(mesmo visual, mesmo rodapé, mesmo modo incorporado).

| Endereço | Para quê |
| --- | --- |
| **https://www.dexterityit.com.br/cotacao-de-moedas** | Endereço público e canônico: página do site (Odoo) com a ferramenta incorporada. É o que vai em cartões, rodapés, posts e no Notion. |
| **https://cotacaodemoedas.vercel.app** | A aplicação em si (Vercel), usada só no `iframe` da página do site. Endereço técnico — ver [Projeto na Vercel](#projeto-na-vercel). |

Use sempre o endereço no domínio da Dexterity. O `*.vercel.app` é técnico e não deve aparecer em
material público (só no `src` do iframe dos blocos de `site/` e neste README).

## Telas

- **Painel** (inicial): PTAX de fechamento das 10 moedas na data escolhida (padrão: a mais recente
  disponível) — venda e compra em R$, variação da venda contra o fechamento anterior (cerceta = alta,
  âmbar = baixa), mini-gráfico das últimas sessões, paridade com o dólar, tipo A/B e data/hora do
  boletim. Em fim de semana, feriado ou antes das ~13h10, mostra o último fechamento disponível até a
  data. Clicar numa moeda abre o histórico dela.
- **Histórico**: moeda + período (De/Até e atalhos 1M, 3M, 6M, 1A, 5A; máximo de 10 anos), gráfico de
  linha em SVG sem dependência (venda, compra ou paridade), estatísticas (mín., máx., média, variação
  do período), tabela ordenável (data, compra, venda, paridades, hora do boletim) e exportação:
  **CSV** (`;` e vírgula decimal, com BOM para o Excel), **Excel** (SheetJS baixado sob demanda do
  cdn.jsdelivr.net) e **Carga SAP** (ver abaixo).
- **Conversor**: valor numa moeda ↔ R$ pela PTAX de compra ou de venda da data, ou entre duas moedas
  estrangeiras via R$ (taxa cruzada = PTAX da origem ÷ PTAX do destino, mesmo lado nas duas pontas).
  Mostra a conta feita e as cotações usadas; avisa quando a data não tem boletim e usa o anterior.
- **Perguntas frequentes** no fim da página (fora do iframe); o mesmo texto vai no JSON-LD `FAQPage`.

## Parâmetros de URL

| Parâmetro | Efeito |
| --- | --- |
| `?embed=1` | Modo incorporado, para `iframe` no site (Odoo), no Notion ou na intranet: sem faixa de título, sem perguntas frequentes e sem as colunas do rodapé (fica só a nota da fonte), na largura toda da moldura. Links para o site abrem em outra aba. |
| `?moeda=EUR` | Abre o histórico da moeda (USD, EUR, GBP, JPY, CHF, CAD, AUD, DKK, NOK, SEK). Com `#conversor`, pré-seleciona a moeda de origem do conversor. |
| `#historico` / `#conversor` | Abre na tela de histórico ou de conversor. O endereço acompanha a aba (e a moeda do histórico), então o link copiado abre onde a pessoa estava. |

Exemplos: `/?embed=1` (painel incorporado), `/?embed=1&moeda=EUR#historico` (histórico do euro
incorporado), `/#conversor`.

`vercel.json` envia `Content-Security-Policy: frame-ancestors *` — sem isso o navegador pode recusar
o embed. Para restringir, troque o `*` pelos domínios que incorporam a ferramenta.

## API

`GET /api/ptax?moeda=EUR&inicio=AAAA-MM-DD&fim=AAAA-MM-DD[&boletins=todos]` — função da Vercel
(`api/ptax.js`) que consulta a **API Olinda do Banco Central** (serviço PTAX v1,
`CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)`,
datas no formato `'MM-DD-AAAA'`).

```json
{
  "moeda": "EUR", "nome": "Euro", "tipo": "B",
  "inicio": "2026-09-14", "fim": "2026-09-16", "boletins": "fechamento",
  "fonte": "Banco Central do Brasil — PTAX (API Olinda)",
  "cotacoes": [
    { "data": "2026-09-15", "dataHora": "2026-09-15 13:09:27.395", "boletim": "Fechamento PTAX",
      "compra": 6.3002, "venda": 6.3021, "paridadeCompra": 1.1712, "paridadeVenda": 1.1713 }
  ]
}
```

- `cotacoes` em ordem cronológica. Por padrão só o boletim de **fechamento** de cada dia (o
  `tipoBoletim` que começa por "Fech", sem diferenciar maiúsculas); com `boletins=todos`, também
  Abertura e Intermediários.
- **400**: moeda fora da lista, data inválida, início depois do fim, período maior que 10 anos ou
  `boletins` inválido. **404**: nenhuma cotação no período (fim de semana, feriado, boletim do dia
  ainda não publicado). **502**: o Banco Central não respondeu (tempo limite de 25 s), respondeu com
  erro ou fora do formato — com mensagem em português. Falha de rede ou HTTP 5xx é repetida uma vez.
- `Access-Control-Allow-Origin: *`, `Content-Type: application/json`, `X-Robots-Tag: noindex`.
- Cache na borda: período encerrado `s-maxage=86400`; período que inclui hoje (horário de Brasília)
  `s-maxage=900, stale-while-revalidate=3600`. Erros não são guardados (404 de hoje: 5 min).
- O painel chama a API uma vez por moeda (início = data − 10 dias, para achar o último fechamento e o
  anterior), com no máximo 4 requisições simultâneas; o navegador reaproveita as respostas entre as
  telas.

**Tipos de moeda (paridade com o dólar):** tipo A = unidades da moeda por 1 USD (JPY, CHF, CAD, DKK,
NOK, SEK; o USD é a referência); tipo B = dólares por 1 unidade da moeda (EUR, GBP, AUD).

## Carga SAP (F2610)

O botão **Carga SAP** do histórico gera o Excel (aba `Data`) no layout do app **Importar Dados de
Mercado (SAP Fiori F2610)** para taxas de câmbio, uma linha por fechamento do período, com modal de
conferência (primeiras e últimas linhas antes de gerar):

| Coluna | Valor |
| --- | --- |
| Categoria de dados do mercado | `01` (editável) |
| Tipo de taxa de câmbio | `M` (editável) |
| Moeda de origem | a moeda do histórico (ex.: `EUR`) |
| Moeda de destino | `BRL` |
| Data efetiva | `AAAAMMDD` (texto) |
| Taxa de câmbio | PTAX de **venda** (padrão) ou de compra, em R$ por unidade |

> **Confira com o modelo baixado do próprio F2610 antes da primeira carga.** Os nomes e a ordem das
> colunas variam com o idioma e a versão do S/4HANA, e a categoria de dados de mercado e o tipo de
> taxa dependem da configuração do cliente. Para moedas com fator de conversão (ex.: JPY cotado por
> 100 unidades na TCURF), ajuste a taxa ao fator antes de importar — a ferramenta exporta R$ por
> 1 unidade, como o Banco Central publica.

## SEO

- `<title>` e meta descrição no padrão da MK-02-003 (título começando pelo termo buscado, até 60
  caracteres; descrição de 150 a 160).
- `<link rel="canonical">` e `og:url` apontam para a página do site,
  `www.dexterityit.com.br/cotacao-de-moedas`: o conteúdo se consolida no domínio principal.
- Open Graph e `twitter:card summary`; JSON-LD com `WebApplication`, `BreadcrumbList` e `FAQPage`
  (o mesmo texto das perguntas visíveis), referenciando a organização do site
  (`https://www.dexterityit.com.br/#organizacao`).
- `robots.txt` bloqueia `/api/` e `/site/`; as funções e a pasta `site/` também respondem com
  `X-Robots-Tag: noindex`.

## Publicação no site (Odoo)

Segue a MK-02-004 (opção A: página no Odoo com a casca padrão e a aplicação em `iframe`). Os blocos
prontos ficam em `site/` — o repositório é a fonte da verdade, nunca editar direto no Odoo:

| Arquivo | Onde entra |
| --- | --- |
| `site/odoo-pagina-cotacao-de-moedas.html` | Página `/cotacao-de-moedas` (hoje "em breve"): bloco Código Incorporado dentro da casca padrão. Tem o H1, o texto de apoio (~550 palavras com as perguntas), as perguntas frequentes, o JSON-LD e o `iframe` em `cotacaodemoedas.vercel.app/?embed=1`. |
| `site/odoo-cartao-vitrine.html` | Cartão da vitrine `/ferramentas` (categoria Câmbio) e a linha do rodapé do site. |

SEO da página no painel **Otimizar SEO** do Odoo:

- **Título:** `Cotação de moedas hoje: PTAX do dólar, euro e mais 8`
- **Descrição:** `PTAX de compra e venda do dólar, euro, libra, iene e mais 6 moedas, direto do Banco Central: fechamento do dia, série histórica, conversor e carga no SAP.`

Ordem: criar o projeto na Vercel e conferir `https://cotacaodemoedas.vercel.app/?embed=1` →
colar o bloco na página, **tirar o aviso de "em breve" e o `noindex`** e publicar → conferir o
`iframe` em janela anônima e a 390 px → cartão da vitrine → rodapé do site (coluna Ferramentas) →
pedir a indexação no Search Console.

## Projeto na Vercel

O projeto ainda não existe. Para criar (uma vez):

1. Vercel › time **`dexterityit`** › **Add New… › Project** › importar o repositório
   `dfg-dexterity/cotacaodemoedas` (GitHub).
2. **Project Name:** `cotacaodemoedas` (gera `https://cotacaodemoedas.vercel.app`).
3. **Framework Preset:** `Other`. **Root Directory:** `./`. **Build Command:** nenhum (deixar vazio /
   desligado) — não há build: a página é estática e `api/*.js` vira função. **Output Directory:**
   padrão (a raiz). **Install Command:** padrão (não há dependências).
4. **Environment Variables:** nenhuma. A região (`gru1`, São Paulo) e o `maxDuration` das funções
   (60 s) vêm do `vercel.json`.
5. Deploy. Depois, conferir `https://cotacaodemoedas.vercel.app/?embed=1` e
   `https://cotacaodemoedas.vercel.app/api/ptax?moeda=USD&inicio=2026-09-01&fim=2026-09-30`.
6. Em **Settings › Deployment Protection**, manter a produção pública (o padrão "Standard Protection"
   só protege as prévias); se a produção ficar protegida, o `iframe` do site não abre.

Cada push na branch padrão gera o deploy de produção e cada PR ganha uma prévia. Se um dia a
aplicação ganhar subdomínio da Dexterity (como `indicadores.dexterityit.com.br` nos Indicadores
Econômicos), trocar o `src` do iframe em `site/odoo-pagina-cotacao-de-moedas.html` e este README.

## Desenvolvimento

Página estática + funções serverless da Vercel, sem build (como a Calculadora MTM):

| Arquivo | O que é |
| --- | --- |
| `index.html` | Casca do padrão (barra, faixa de título, rodapé), as três telas, SEO e perguntas frequentes. |
| `assets/ptax.js` | Funções puras: moedas, datas e períodos, boletins da Olinda, variação, formatação pt-BR, CSV, planilha, linhas SAP, conversor. Usado pela interface, pela API e pelos testes. |
| `assets/app.js` | Interface (ES module). |
| `assets/charts.js` | Gráfico de linhas em SVG sem dependência, copiado da Calculadora MTM (só acrescenta `y.folgaMinima`). |
| `assets/app.css` | Estilos próprios, só com tokens `--dxt-*`. |
| `assets/dexterity.css`, `assets/favicon.svg` | Folha e ícone da marca — cópias do padrão, não editar aqui. |
| `api/ptax.js` | Proxy da PTAX (Olinda). |
| `scripts/dev-server.mjs` | Servidor local com `/api`. |
| `tests/` | `node --test`: funções puras e API com `fetch` simulado no formato Olinda. |

```bash
npm test                    # node --test tests/*.test.mjs
npm run dev                 # http://localhost:8080 (PORT=8131 npm run dev para outra porta)
```

Teste de navegador: Playwright com Chromium, a 1440 px e 390 px, normal e `?embed=1`, conferindo
que não há rolagem horizontal nem erro de JS. Onde o Banco Central ou o cdn.jsdelivr.net estiverem
bloqueados, intercepte `/api/ptax` com `page.route` e dados simulados.

## Identidade visual

Tema escuro único da Dexterity IT Solutions — base `#1B1B1B`, off-white `#F7F3E7`, cerceta `#009994`
(destaque `#00B3AC`), âmbar `#FFA436`, roxo `#98569A`; Barlow Condensed (títulos), Figtree (texto) e
IBM Plex Mono (rótulos e números); cantos retos, grades com fio de 1px, sem sombra nos cartões.
Cor tem sentido: **cerceta = alta**, **âmbar = baixa/atenção**, vermelho só para erro, roxo para
nota — a variação negativa aparece em âmbar, nunca em vermelho.

`assets/dexterity.css` é **idêntico** nas ferramentas de Dados de Mercado (Calculadora MTM,
Derivativos Listados B3, Indicadores Econômicos, Moedas BNDES e Cotação de Moedas): ao alterar,
replique nos demais. A coluna **Ferramentas** do rodapé também é a mesma nos cinco apps.
