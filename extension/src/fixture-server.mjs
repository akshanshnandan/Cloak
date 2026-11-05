import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const fixtures = new Map([['/', 'index.html'], ['/shopping', 'shopping.html'], ['/news', 'news.html'], ['/docs', 'docs.html']]);
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const file = fixtures.get(pathname);
  if (!file) { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Choose /shopping, /news, or /docs.'); return; }
  try { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(await readFile(path.resolve('extension/test-fixtures', file), 'utf8')); }
  catch { response.writeHead(500); response.end('Fixture unavailable. Run this server from the Cloak repository root.'); }
});
server.listen(4318, '127.0.0.1', () => console.log('Cloak fixtures: http://127.0.0.1:4318/{shopping,news,docs}'));
