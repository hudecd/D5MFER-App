import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/index.mjs';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve('public', '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(path.resolve('public') + '/')) { res.writeHead(403).end(); return; }
  try { const buffer = await readFile(file); res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(buffer); }
  catch { res.writeHead(404).end('Nenájdené'); }
}).listen(3000, '0.0.0.0', () => console.log('D5MFER app: http://localhost:3000'));
