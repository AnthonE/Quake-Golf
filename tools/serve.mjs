#!/usr/bin/env node
// Static server for the browser harness and client. Every response is
// cross-origin isolated (COOP + COEP), which shared wasm memory needs.
// It serves the repository, except the certificate's private key.
// PUT /out/<name> saves a trace into traces/.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.qgl': 'application/octet-stream',
};

export function serve({ port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'PUT' && url.pathname.startsWith('/out/')) {
        const name = url.pathname.slice(5).replace(/[^\w.-]/g, '_');
        const chunks = [];
        for await (const c of req) chunks.push(c);
        await mkdir(join(ROOT, 'traces'), { recursive: true });
        await writeFile(join(ROOT, 'traces', name), Buffer.concat(chunks));
        res.writeHead(204).end();
        return;
      }
      const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      // the page needs the certificate's hash, never its key
      if (path.startsWith(join(ROOT, 'certs')) && !path.endsWith('hash.txt')) { res.writeHead(403).end(); return; }
      const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(port, host, () => ok({ server, port: server.address().port })));
}

if (isMain(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  serve({ port }).then(({ port }) => console.log(`http://127.0.0.1:${port}/ (cross-origin isolated)`));
}
