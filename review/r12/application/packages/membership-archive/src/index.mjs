import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonical } from '../../admission/src/json.ts';
import {
  GATE_F_PROTOCOL_VERSION,
  discoverFinalizedMembershipCommitments,
  membershipAuthorizationHash,
  replayFinalizedMembershipEvents,
  retrieveMembershipEventMaterials,
  validateFinalizedEvidence,
  validateMembershipAuthorization,
} from '../../membership-gate-f/src/index.mjs';
import { hashMembershipGenesis, validateMembershipEvent } from '../../membership-state/src/index.mjs';

export const MEMBERSHIP_ARCHIVE_VERSION = 'BAARNE_M1_EVENT_ARCHIVE_V1';
export const MEMBERSHIP_ARCHIVE_LAYOUT = 'BAARNE_M1_ARCHIVE_OBJECTS_V1';
export const MEMBERSHIP_ARCHIVE_CANONICALIZATION = 'BAARNE_RESTRICTED_CANONICAL_JSON_V1';

const MANIFEST_DOMAIN = 'BAARNE_M1_ARCHIVE_MANIFEST_V1\n';
const EVIDENCE_DOMAIN = 'BAARNE_M1_ARCHIVE_EVIDENCE_V1\n';
const HEX32 = /^0x[0-9a-f]{64}$/;
const MANIFEST_KEYS = Object.freeze([
  'archiveVersion', 'canonicalization', 'chainId', 'entries', 'genesisHash',
  'hashAlgorithm', 'layout', 'manifestHash', 'networkId', 'protocolVersion', 'schemaUid',
]);
const ENTRY_KEYS = Object.freeze(['authorizationHash', 'eventId', 'evidenceHash', 'position']);

class ArchiveError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'ArchiveError'; }
}
const fail = code => { throw new ArchiveError(code); };
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail(code);
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}
function hash(domain, value) {
  return `0x${createHash('sha256').update(domain).update(canonical(value)).digest('hex')}`;
}
function requireHash(value, code = 'INVALID_ARCHIVE_HASH') {
  if (typeof value !== 'string' || !HEX32.test(value)) fail(code);
  return value;
}
function position(evidence) { return [evidence.blockNumber, evidence.transactionIndex, evidence.logIndex]; }
function compareEntry(a, b) { return a.position[0] - b.position[0] || a.position[1] - b.position[1] || a.position[2] - b.position[2]; }
function manifestBody(value) {
  const { manifestHash: ignored, ...body } = value;
  return body;
}
function objectPath(root, kind, objectHash) {
  requireHash(objectHash);
  const directory = kind === 'event' ? 'events' : kind === 'authorization' ? 'authorizations' : kind === 'evidence' ? 'evidence' : fail('INVALID_ARCHIVE_KIND');
  return join(root, 'objects', directory, `${objectHash.slice(2)}.json`);
}
async function writeCanonical(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = canonical(value);
  try { await writeFile(path, bytes, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error?.code !== 'EEXIST' || await readFile(path, 'utf8') !== bytes) throw error;
  }
}
async function parseFile(path) { return JSON.parse(await readFile(path, 'utf8')); }

export function membershipArchiveEvidenceHash(input) {
  return hash(EVIDENCE_DOMAIN, validateFinalizedEvidence(input));
}

export function validateMembershipArchiveManifest(input, expected, genesis) {
  const value = exact(input, MANIFEST_KEYS, 'INVALID_ARCHIVE_MANIFEST');
  if (value.archiveVersion !== MEMBERSHIP_ARCHIVE_VERSION || value.layout !== MEMBERSHIP_ARCHIVE_LAYOUT ||
      value.canonicalization !== MEMBERSHIP_ARCHIVE_CANONICALIZATION || value.hashAlgorithm !== 'sha256' ||
      value.protocolVersion !== GATE_F_PROTOCOL_VERSION) fail('INVALID_ARCHIVE_MANIFEST');
  if (value.chainId !== expected.chainId || value.networkId !== expected.networkId || value.schemaUid !== expected.schemaUid) fail('ARCHIVE_SCOPE_MISMATCH');
  if (value.genesisHash !== hashMembershipGenesis(genesis)) fail('ARCHIVE_GENESIS_MISMATCH');
  requireHash(value.genesisHash, 'INVALID_ARCHIVE_MANIFEST');
  requireHash(value.manifestHash, 'INVALID_ARCHIVE_MANIFEST');
  if (!Array.isArray(value.entries)) fail('INVALID_ARCHIVE_MANIFEST');
  const seenPositions = new Set();
  const entries = value.entries.map(inputEntry => {
    const entry = exact(inputEntry, ENTRY_KEYS, 'INVALID_ARCHIVE_MANIFEST');
    requireHash(entry.eventId, 'INVALID_ARCHIVE_MANIFEST');
    requireHash(entry.authorizationHash, 'INVALID_ARCHIVE_MANIFEST');
    requireHash(entry.evidenceHash, 'INVALID_ARCHIVE_MANIFEST');
    if (!Array.isArray(entry.position) || entry.position.length !== 3 || entry.position.some(v => !Number.isSafeInteger(v) || v < 0)) fail('INVALID_ARCHIVE_MANIFEST');
    const key = entry.position.join(':');
    if (seenPositions.has(key)) fail('INVALID_ARCHIVE_MANIFEST');
    seenPositions.add(key);
    return Object.freeze({ ...entry, position: Object.freeze([...entry.position]) });
  });
  const sorted = [...entries].sort(compareEntry);
  if (canonical(sorted) !== canonical(entries) || hash(MANIFEST_DOMAIN, manifestBody(value)) !== value.manifestHash) fail('INVALID_ARCHIVE_MANIFEST');
  return Object.freeze({ ...value, entries: Object.freeze(entries) });
}

export async function writeMembershipEventArchive(root, { genesis, expected, entries }) {
  if (typeof root !== 'string' || !root || !Array.isArray(entries)) fail('INVALID_ARCHIVE_INPUT');
  const temporary = `${root}.building`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const manifestEntries = [];
  try {
    for (const input of entries) {
      if (!input || typeof input !== 'object') fail('INVALID_ARCHIVE_INPUT');
      const event = validateMembershipEvent(input.event);
      const authorization = validateMembershipAuthorization(input.authorization);
      const evidence = validateFinalizedEvidence(input.evidence);
      const authorizationHash = membershipAuthorizationHash(authorization);
      if (event.eventId !== evidence.eventId || authorizationHash !== evidence.authorizationHash ||
          evidence.chainId !== expected.chainId || evidence.networkId !== expected.networkId || evidence.schemaUid !== expected.schemaUid) fail('ARCHIVE_ENTRY_MISMATCH');
      const evidenceHash = membershipArchiveEvidenceHash(evidence);
      await writeCanonical(objectPath(temporary, 'event', event.eventId), event);
      await writeCanonical(objectPath(temporary, 'authorization', authorizationHash), authorization);
      await writeCanonical(objectPath(temporary, 'evidence', evidenceHash), evidence);
      manifestEntries.push(Object.freeze({ authorizationHash, eventId: event.eventId, evidenceHash, position: Object.freeze(position(evidence)) }));
    }
    manifestEntries.sort(compareEntry);
    if (new Set(manifestEntries.map(entry => entry.position.join(':'))).size !== manifestEntries.length) fail('DUPLICATE_ARCHIVE_POSITION');
    const body = {
      archiveVersion: MEMBERSHIP_ARCHIVE_VERSION,
      canonicalization: MEMBERSHIP_ARCHIVE_CANONICALIZATION,
      chainId: expected.chainId,
      entries: manifestEntries,
      genesisHash: hashMembershipGenesis(genesis),
      hashAlgorithm: 'sha256',
      layout: MEMBERSHIP_ARCHIVE_LAYOUT,
      networkId: expected.networkId,
      protocolVersion: GATE_F_PROTOCOL_VERSION,
      schemaUid: expected.schemaUid,
    };
    const manifest = Object.freeze({ ...body, manifestHash: hash(MANIFEST_DOMAIN, body) });
    await writeCanonical(join(temporary, 'manifest.json'), manifest);
    await rm(root, { recursive: true, force: true });
    await rename(temporary, root);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export class FilesystemMembershipArchive {
  constructor(root) {
    if (typeof root !== 'string' || !root) fail('INVALID_ARCHIVE_INPUT');
    this.root = root;
    this.available = true;
    this.failAfterReads = null;
    this.reads = 0;
  }
  setAvailable(value) { this.available = Boolean(value); }
  interruptAfter(readCount) {
    if (readCount !== null && (!Number.isSafeInteger(readCount) || readCount < 0)) fail('INVALID_ARCHIVE_INPUT');
    this.failAfterReads = readCount; this.reads = 0;
  }
  #check() {
    if (!this.available) throw new ArchiveError('ARCHIVE_UNAVAILABLE');
    if (this.failAfterReads !== null && this.reads >= this.failAfterReads) throw new ArchiveError('ARCHIVE_READ_INTERRUPTED');
    this.reads += 1;
  }
  async readManifest() { this.#check(); return parseFile(join(this.root, 'manifest.json')); }
  async get(kind, objectHash) { this.#check(); return parseFile(objectPath(this.root, kind, objectHash)); }
}

export async function inspectMembershipArchive(archive, discovery, expected, genesis) {
  try {
    if (!archive || typeof archive.readManifest !== 'function' || typeof archive.get !== 'function') fail('INVALID_ARCHIVE_INPUT');
    const manifest = validateMembershipArchiveManifest(await archive.readManifest(), expected, genesis);
    if (!discovery || discovery.status !== 'FINALIZED') fail('FINALIZED_DISCOVERY_REQUIRED');
    const required = discovery.evidence.map(evidence => ({
      authorizationHash: evidence.authorizationHash,
      eventId: evidence.eventId,
      evidenceHash: membershipArchiveEvidenceHash(evidence),
      position: position(evidence),
    }));
    if (canonical(manifest.entries) !== canonical(required)) return Object.freeze({ status: 'ARCHIVE_INDEX_INCONSISTENT', manifest });
    for (let index = 0; index < manifest.entries.length; index += 1) {
      const archivedEvidence = validateFinalizedEvidence(await archive.get('evidence', manifest.entries[index].evidenceHash));
      if (membershipArchiveEvidenceHash(archivedEvidence) !== manifest.entries[index].evidenceHash || canonical(archivedEvidence) !== canonical(discovery.evidence[index])) {
        return Object.freeze({ status: 'ARCHIVE_EVIDENCE_MISMATCH', manifest });
      }
    }
    return Object.freeze({ status: 'COMPLETE', manifest });
  } catch (error) {
    const status = error instanceof ArchiveError ? error.code : error?.code === 'ENOENT' ? 'ARCHIVE_UNAVAILABLE' : 'ARCHIVE_INVALID';
    return Object.freeze({ status });
  }
}

export async function recoverAndReplayMembershipHistory({ genesis, expected, providerViews, archives }) {
  const started = performance.now();
  const discovery = discoverFinalizedMembershipCommitments(providerViews, expected);
  if (discovery.status !== 'FINALIZED') return Object.freeze({ status: discovery.status, state: null, diagnostics: Object.freeze([]) });
  if (!Array.isArray(archives) || archives.length < 1) return Object.freeze({ status: 'CONTENT_UNAVAILABLE', state: null, diagnostics: Object.freeze([]) });
  const diagnostics = [];
  const complete = [];
  for (let index = 0; index < archives.length; index += 1) {
    const inspection = await inspectMembershipArchive(archives[index], discovery, expected, genesis);
    diagnostics.push(Object.freeze({ archive: index, status: inspection.status }));
    if (inspection.status === 'COMPLETE') complete.push(archives[index]);
  }
  if (!complete.length) {
    const interrupted = diagnostics.some(item => item.status === 'ARCHIVE_READ_INTERRUPTED');
    const inconsistent = diagnostics.some(item => item.status === 'ARCHIVE_INDEX_INCONSISTENT' || item.status === 'ARCHIVE_EVIDENCE_MISMATCH' || item.status === 'ARCHIVE_INVALID');
    return Object.freeze({ status: interrupted ? 'ARCHIVE_READ_INTERRUPTED' : inconsistent ? 'ARCHIVE_INCONSISTENT' : 'CONTENT_UNAVAILABLE', state: null, diagnostics: Object.freeze(diagnostics) });
  }
  const retrieved = await retrieveMembershipEventMaterials(discovery.commitments, complete);
  if (retrieved.status !== 'AVAILABLE') return Object.freeze({ status: retrieved.status, state: null, diagnostics: Object.freeze(diagnostics) });
  const replay = await replayFinalizedMembershipEvents(genesis, providerViews, retrieved.materials, expected);
  return Object.freeze({ ...replay, retrievalMs: performance.now() - started, diagnostics: Object.freeze(diagnostics), discoveredCount: discovery.commitments.length });
}
