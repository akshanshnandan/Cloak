import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const file = path.resolve('extension/test-fixtures/index.html');
const server = http.createServer(async (_request, response) => {
  try { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(await readFile(file)); }
  catch { response.writeHead(500); response.end('Fixture unavailable. Run this server from the Cloak repository root.'); }
});
server.listen(4318, '127.0.0.1', () => console.log('Cloak fixture: http://127.0.0.1:4318'));
