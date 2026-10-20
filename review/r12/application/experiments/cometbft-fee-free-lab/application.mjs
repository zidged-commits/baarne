// Synthetic application boundary only. Not M1, a consensus engine, or a member policy.
import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const DOMAIN = 'BAARNE_FEE_FREE_APPLICATION_LAB_V1';
const MAX_SNAPSHOT_BYTES = 65536;
const publicKeyPattern = /^[0-9a-f]{64}$/;
const slotPattern = /^lab-slot-[a-z0-9]{1,12}$/;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('INVALID_FIELDS');
}
function validateGenesis(genesis) {
  exactKeys(genesis, ['domain', 'slots']);
  if (genesis.domain !== DOMAIN || !genesis.slots || Array.isArray(genesis.slots) ||
      Object.keys(genesis.slots).length < 1 || Object.keys(genesis.slots).length > 16) throw Error('INVALID_GENESIS');
  for (const [slot, issuer] of Object.entries(genesis.slots)) {
    if (!slotPattern.test(slot) || typeof issuer !== 'string' || !publicKeyPattern.test(issuer)) throw Error('INVALID_GENESIS');
  }
}
function decode(raw, genesis, genesisHash) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2048) throw Error('INVALID_SIZE');
  let tx;
  try { tx = JSON.parse(raw); } catch { throw Error('MALFORMED_INTENT'); }
  exactKeys(tx, ['body', 'id', 'signature']);
  exactKeys(tx.body, ['domain', 'genesisHash', 'issuer', 'nonce', 'recipient', 'slot']);
  const b = tx.body;
  if (canonical(tx) !== raw) throw Error('NONCANONICAL_INTENT');
  if (b.domain !== DOMAIN || b.genesisHash !== genesisHash) throw Error('WRONG_SCOPE');
  if (typeof b.issuer !== 'string' || typeof b.recipient !== 'string' ||
      !publicKeyPattern.test(b.issuer) || !publicKeyPattern.test(b.recipient) ||
      typeof b.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(b.nonce) ||
      typeof b.slot !== 'string' || !slotPattern.test(b.slot)) throw Error('INVALID_INTENT');
  if (!Object.hasOwn(genesis.slots, b.slot) || genesis.slots[b.slot] !== b.issuer) throw Error('UNAUTHORIZED_SLOT');
  if (tx.id !== digest(b) || typeof tx.signature !== 'string' || !/^[0-9a-f]{128}$/.test(tx.signature)) throw Error('INVALID_ID_OR_SIGNATURE');
  const publicKey = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(b.issuer, 'hex')]), format: 'der', type: 'spki'});
  if (!verify(null, Buffer.from(canonical(b)), publicKey, Buffer.from(tx.signature, 'hex'))) throw Error('INVALID_SIGNATURE');
  return tx;
}
function apply(raw, state, genesis, genesisHash) {
  let tx;
  try { tx = decode(raw, genesis, genesisHash); }
  catch (error) { return {code: 1, reason: error.message}; }
  if (state.accepted.some(previous => JSON.parse(previous).id === tx.id)) return {code: 0, id: tx.id, duplicate: true};
  const b = tx.body;
  if (state.accepted.some(previous => {
    const old = JSON.parse(previous).body;
    return old.issuer === b.issuer && old.nonce === b.nonce;
  })) return {code: 2, id: tx.id, reason: 'NONCE_ALREADY_USED'};
  if (state.accepted.some(previous => JSON.parse(previous).body.slot === b.slot)) return {code: 3, id: tx.id, reason: 'CAPACITY_CONFLICT'};
  state.accepted.push(raw);
  return {code: 0, id: tx.id, duplicate: false};
}
function fresh(genesisHash) { return {domain: DOMAIN, genesisHash, height: 0, accepted: []}; }
function checkSnapshot(document, genesis, genesisHash) {
  exactKeys(document, ['state', 'stateHash']);
  const state = document.state;
  exactKeys(state, ['domain', 'genesisHash', 'height', 'accepted']);
  if (state.domain !== DOMAIN || state.genesisHash !== genesisHash ||
      !Number.isSafeInteger(state.height) || state.height < 0 || !Array.isArray(state.accepted) ||
      state.accepted.length > Object.keys(genesis.slots).length || document.stateHash !== digest(state)) throw Error('INVALID_SNAPSHOT');
  const replay = fresh(genesisHash);
  for (const tx of state.accepted) {
    const result = apply(tx, replay, genesis, genesisHash);
    if (result.code !== 0 || result.duplicate) throw Error('INVALID_SNAPSHOT_HISTORY');
  }
  return state;
}
export async function writeAtomic(directory, state, hook) {
  const temp = join(directory, 'pending-' + randomUUID() + '.json');
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(canonical({state, stateHash: digest(state)})); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await hook?.('beforeRename');
    await rename(temp, join(directory, 'state.json'));
    // The Linux Docker laboratory verifies directory sync. Windows cannot
    // provide the same portable directory-fsync contract via Node.
    if (process.platform !== 'win32') {
      const dir = await open(directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
    await hook?.('afterRename');
  } catch (error) {
    await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    throw error; // No success acknowledgment on uncertain persistence.
  }
}

async function readSnapshotBounded(path) {
  const pathInfo = await lstat(path);
  if (!pathInfo.isFile()) throw Error('INVALID_SNAPSHOT_FILE');
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(path, flags);
  } catch (error) {
    if (error.code === 'ELOOP') throw Error('INVALID_SNAPSHOT_FILE');
    throw error;
  }
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
      throw Error('INVALID_SNAPSHOT_FILE');
    }
    if (openedInfo.size > MAX_SNAPSHOT_BYTES) throw Error('SNAPSHOT_TOO_LARGE');
    const buffer = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_SNAPSHOT_BYTES) throw Error('SNAPSHOT_TOO_LARGE');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export class LabApplication {
  #genesis; #genesisHash; #state; #pending; #directory; #hook; #committing = false;
  constructor(directory, genesis, state, hook) {
    this.#directory = directory;
    this.#genesis = structuredClone(genesis);
    this.#genesisHash = digest(genesis);
    this.#state = structuredClone(state);
    this.#hook = hook;
  }
  static async create(directory, genesis) {
    genesis = structuredClone(genesis);
    validateGenesis(genesis);
    await mkdir(directory); // Exclusive: existing stores are never initialized again.
    const state = fresh(digest(genesis));
    await writeAtomic(directory, state);
    return new LabApplication(directory, genesis, state);
  }
  static async load(directory, genesis, {faultHook} = {}) {
    genesis = structuredClone(genesis);
    validateGenesis(genesis);
    const bytes = await readSnapshotBounded(join(directory, 'state.json'));
    const document = JSON.parse(bytes.toString('utf8'));
    if (canonical(document) !== bytes.toString('utf8')) throw Error('NONCANONICAL_SNAPSHOT');
    const state = checkSnapshot(document, genesis, digest(genesis));
    return new LabApplication(directory, genesis, state, faultHook);
  }
  info() { return {height: this.#state.height, stateHash: digest(this.#state), acceptedCount: this.#state.accepted.length}; }
  checkIntent(raw) {
    try { const tx = decode(raw, this.#genesis, this.#genesisHash); return {code: 0, id: tx.id}; }
    catch (error) { return {code: 1, reason: error.message}; }
  }
  exportState() { return structuredClone(this.#state); }
  stageBlock(height, transactions) {
    if (this.#pending) throw Error('BLOCK_ALREADY_STAGED');
    if (!Number.isSafeInteger(height) || height !== this.#state.height + 1) throw Error('INVALID_HEIGHT');
    if (!Array.isArray(transactions) || transactions.length > 64) throw Error('INVALID_BLOCK_SIZE');
    const state = structuredClone(this.#state);
    const results = transactions.map(raw => apply(raw, state, this.#genesis, this.#genesisHash));
    state.height = height;
    this.#pending = state;
    return {results, stateHash: digest(state)};
  }
  async commit() {
    if (this.#committing) throw Error('COMMIT_IN_PROGRESS');
    if (!this.#pending) throw Error('NO_STAGED_BLOCK');
    this.#committing = true;
    try {
      await writeAtomic(this.#directory, this.#pending, this.#hook);
      this.#state = this.#pending;
      this.#pending = undefined;
      return this.info();
    } finally { this.#committing = false; }
  }
}
