import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const domain = fileURLToPath(new URL('../../packages/behavioral-twin/src/', import.meta.url));
const labDomain = fileURLToPath(new URL('../../packages/cross-network-discovery-lab/src/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function safePath(base, requested) {
  const relative = normalize(requested).replace(/^(?:\.\.(?:[\\/]|$))+/, '');
  const path = join(base, relative);
  if (!path.startsWith(base)) throw new Error('INVALID_PATH');
  return path;
}

export function createHubServer({privateHandler} = {}) { return createServer(async (request, response) => {
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  if (privateHandler && request.url?.startsWith('/private-api/')) { await privateHandler(request, response); return; }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  if (request.url === '/health') { response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"LOCAL_SYNTHETIC_DEMO"}'); return; }
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    let path;
    if (url.pathname.startsWith('/domain/')) path = safePath(domain, url.pathname.slice('/domain/'.length));
    else if (url.pathname.startsWith('/lab-domain/')) path = safePath(labDomain, url.pathname.slice('/lab-domain/'.length));
    else path = safePath(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!statSync(path).isFile()) throw new Error('NOT_FOUND');
    response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}); }

export function startHubServer({ port = Number(process.env.BAARNE_HUB_PORT ?? 4173), host = '127.0.0.1' } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || host !== '127.0.0.1') throw new Error('INVALID_LISTEN_CONFIGURATION');
  const server = createHubServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ server, url: `http://${host}:${address.port}` });
    });
  });
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) startHubServer().then(({ url }) => process.stdout.write(`BAARNE Hub synthetic demo: ${url}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
