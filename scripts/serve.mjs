// Tiny static file server (no dependencies). Usage: node scripts/serve.mjs [dir] [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './util.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.obj': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

export function serve(dir = 'public', port = Number(process.env.PORT) || 5173) {
  const base = path.resolve(root, dir);
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url.endsWith('/')) url += 'index.html';
    let file = path.join(base, url);
    if (!file.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
    // during dev, /assets/* is served from the project-level assets folder
    if (!fs.existsSync(file) && url.startsWith('/assets/')) file = path.join(root, url);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => {
    console.log(`\n  Anime Fight Engine  ->  http://localhost:${server.address().port}/\n`);
    resolve(server);
  }));
}

if (process.argv[1] && path.basename(process.argv[1]) === 'serve.mjs') {
  serve(process.argv[2] || 'public', process.argv[3] ? Number(process.argv[3]) : undefined);
}
