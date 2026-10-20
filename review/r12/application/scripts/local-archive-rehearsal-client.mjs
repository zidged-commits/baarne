import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function stopArchive(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ARCHIVE_STOP_TIMEOUT')); }, 5_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

export async function startArchive(root) {
  const child = fork(fileURLToPath(new URL('./local-archive-rehearsal-server.mjs', import.meta.url)), [root], { silent: true });
  child.stdout.resume(); child.stderr.resume();
  try {
    const port = await new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer); child.off('message', ready); child.off('error', failed); child.off('exit', exited);
        if (error) reject(error); else resolve(value);
      };
      const ready = message => {
        if (message?.type !== 'archive-ready' || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          finish(new Error('INVALID_ARCHIVE_READY'));
        } else finish(null, message.port);
      };
      const failed = () => finish(new Error('ARCHIVE_START_FAILED'));
      const exited = () => finish(new Error('ARCHIVE_EXITED_BEFORE_READY'));
      const timer = setTimeout(() => finish(new Error('ARCHIVE_START_TIMEOUT')), 10_000);
      child.once('message', ready); child.once('error', failed); child.once('exit', exited);
    });
    const origin = `http://127.0.0.1:${port}`;
    return { child, origin, reader: archiveReader(origin) };
  } catch (error) { await stopArchive(child); throw error; }
}

export function archiveReader(origin, { timeoutMs = 2_000, maxBytes = 2_000_000 } = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('LOCAL_ARCHIVE_ORIGIN_REQUIRED');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_READ_LIMIT');
  async function read(path) {
    let response;
    try { response = await fetch(url.origin + path, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
    catch { throw Object.assign(new Error('ARCHIVE_UNAVAILABLE'), { code: 'ENOENT' }); }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('ARCHIVE_OBJECT_UNAVAILABLE'), { code: 'ENOENT' });
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('ARCHIVE_OBJECT_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const directories = { event: 'events', authorization: 'authorizations', evidence: 'evidence' };
  return {
    readManifest: () => read('/manifest.json'),
    get(kind, hash) {
      if (!Object.hasOwn(directories, kind) || typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) throw new Error('INVALID_ARCHIVE_OBJECT');
      return read(`/objects/${directories[kind]}/${hash.slice(2)}.json`);
    },
  };
}
