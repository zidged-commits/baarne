// Local synthetic rehearsal only: not a deployable archive service.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemMembershipArchive } from '../packages/membership-archive/src/index.mjs';

export function createLocalArchiveServer(root) {
  const archive = new FilesystemMembershipArchive(root);
  const kinds = { events: 'event', authorizations: 'authorization', evidence: 'evidence' };
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    const reply = (status, value) => { response.writeHead(status); response.end(JSON.stringify(value)); };
    if (request.method !== 'GET') { reply(405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    const match = /^\/objects\/(events|authorizations|evidence)\/([0-9a-f]{64})\.json$/.exec(request.url);
    if (request.url !== '/manifest.json' && !match) { reply(404, { error: 'NOT_FOUND' }); return; }
    try {
      const value = match ? await archive.get(kinds[match[1]], `0x${match[2]}`) : await archive.readManifest();
      const bytes = JSON.stringify(value);
      if (Buffer.byteLength(bytes) > 2_000_000) { reply(413, { error: 'OBJECT_TOO_LARGE' }); return; }
      response.writeHead(200); response.end(bytes);
    } catch { reply(404, { error: 'NOT_FOUND' }); }
  });
  server.maxConnections = 16;
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('ARCHIVE_ROOT_REQUIRED'); process.exitCode = 1; }
  else {
    const server = createLocalArchiveServer(resolve(process.argv[2]));
    server.on('error', () => { console.error('ARCHIVE_LISTEN_FAILED'); process.exitCode = 1; });
    server.listen(0, '127.0.0.1', () => process.send?.({ type: 'archive-ready', port: server.address().port }));
    const shutdown = () => { server.close(() => process.exit(0)); server.closeAllConnections(); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    process.once('disconnect', shutdown);
  }
}
