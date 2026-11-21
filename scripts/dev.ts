// Servidor local sencillo: sirve dist/ y expone POST/GET /api/chat con el mismo código que Vercel.
// Lee .env y .env.local (el segundo tiene prioridad). Alternativa equivalente: `vercel dev`.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildApp } from './build.mjs';

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv('.env.local');
loadEnv('.env');

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT ?? 3000);

if (!process.env.SKIP_BUILD) await buildApp({ minify: false, sourcemap: true });
const { POST, GET } = await import('../api/chat');

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const r = await (req.method === 'POST'
      ? POST(new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body }))
      : GET());
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = normalize(join('dist', decodeURIComponent(url.pathname)));
  if (!p.startsWith('dist')) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) {
    res.writeHead(404).end('No encontrado');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(port, () => console.log(`http://localhost:${port}  (asistente: ${process.env.OPENCODE_API_KEY ? 'clave detectada en el entorno' : 'sin OPENCODE_API_KEY'})`));
