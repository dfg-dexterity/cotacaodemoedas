/**
 * Servidor local de desenvolvimento: arquivos estáticos + funções de /api
 * (mesma assinatura das funções serverless da Vercel, com shims mínimos de
 * req.query e res.status/setHeader/send). Adaptado da Calculadora MTM.
 *
 * Uso: `npm run dev` → http://localhost:8080 (ou `PORT=8131 npm run dev`).
 */
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function shimRes(res) {
  let code = 200
  return {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) {
      code = c
      return this
    },
    send(body) {
      res.statusCode = code
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    },
    json(body) {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    },
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '')
      try {
        const mod = await import(pathToFileURL(join(ROOT, 'api', `${name}.js`)).href)
        const query = Object.fromEntries(url.searchParams.entries())
        await mod.default({ query, method: req.method, headers: req.headers, url: req.url }, shimRes(res))
      } catch (e) {
        res.statusCode = 500
        res.end(`api error: ${e.message}`)
      }
      return
    }
    let file = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    if (file === '/' || file === '') file = '/index.html'
    const path = join(ROOT, file)
    if (!path.startsWith(ROOT)) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    try {
      const s = await stat(path)
      const target = s.isDirectory() ? join(path, 'index.html') : path
      const data = await readFile(target)
      res.setHeader('Content-Type', MIME[extname(target)] ?? 'application/octet-stream')
      res.end(data)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  .listen(PORT, () => console.log(`Cotação de Moedas em http://localhost:${PORT}`))
