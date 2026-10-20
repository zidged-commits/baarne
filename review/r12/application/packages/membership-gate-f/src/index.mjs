import { createHash } from 'node:crypto';
import { canonical } from '../../admission/src/json.ts';
import { evmEoaVerifier } from '../../identity/src/evm-eoa.ts';
import {
  MEMBERSHIP_EVENT_VERSION,
  createMembershipStateMachine,
  hashMembershipGenesis,
  initializeMembershipState,
  membershipStateHash,
  validateMembershipEvent,
} from '../../membership-state/src/index.mjs';

export const GATE_F_PROTOCOL_VERSION = 'BAARNE_M1_GATE_F_V1';
export const MEMBERSHIP_AUTHORIZATION_VERSION = 'BAARNE_MEMBERSHIP_AUTHORIZATION_V1';
export const MEMBERSHIP_SIGNATURE_TYPE = 'BAARNE_MEMBERSHIP_EVENT_SIGNATURE_V1';
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const FINALIZED_EVIDENCE_VERSION = 'BAARNE_BASE_SEPOLIA_FINALIZED_EVENT_V1';
export const CHECKPOINT_VERSION = 'BAARNE_M1_GATE_F_CHECKPOINT_V1';
export const PROPOSED_EAS_SCHEMA = 'bytes32 membershipEventId,bytes32 authorizationEnvelopeHash';

const SIGNATURE_METHOD = 'eip191-personal-sign-v1';
const PAYLOAD_HASH_DOMAIN = 'BAARNE_MEMBERSHIP_EVENT_PAYLOAD_V1\n';
const AUTHORIZATION_DOMAIN = 'BAARNE_MEMBERSHIP_AUTHORIZATION_V1\n';
const AUTHORIZATION_HASH_DOMAIN = 'BAARNE_MEMBERSHIP_AUTHORIZATION_HASH_V1\n';
const HISTORY_HASH_DOMAIN = 'BAARNE_M1_FINALIZED_HISTORY_V1\n';
const CHECKPOINT_HASH_DOMAIN = 'BAARNE_M1_GATE_F_CHECKPOINT_V1\n';
const ZERO_HASH = `0x${'00'.repeat(32)}`;

const AUTH_BODY_KEYS = Object.freeze([
  'authorizationVersion', 'chainId', 'eventId', 'eventType', 'eventVersion',
  'networkId', 'nonce', 'payloadHash', 'protocolVersion', 'signatureMethod',
  'signatureType', 'signatureVersion', 'signer',
]);
const AUTH_KEYS = Object.freeze([...AUTH_BODY_KEYS, 'signature']);
const EVIDENCE_KEYS = Object.freeze([
  'authorizationHash', 'attestationUid', 'blockHash', 'blockNumber',
  'blockTimestamp', 'chainId', 'eventId', 'evidenceVersion', 'logIndex',
  'networkId', 'schemaUid', 'transactionHash', 'transactionIndex',
]);

class GateFError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'GateFError'; }
}
const fail = code => { throw new GateFError(code); };
function exact(input, keys, code = 'MALFORMED') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(code);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail(code);
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}
function uint(value, code = 'MALFORMED') {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(code);
  return value;
}
function hex(value, bytes, code = 'MALFORMED') {
  if (typeof value !== 'string' || value.length !== 2 + bytes * 2 || !/^0x[0-9a-f]+$/.test(value)) fail(code);
  return value;
}
function identity(value) {
  if (typeof value !== 'string' || !/^evm-eoa:0x[0-9a-f]{40}$/.test(value) || /^evm-eoa:0x0+$/.test(value)) fail('INVALID_SIGNER');
  return value;
}
function digest(domain, value) {
  return `0x${createHash('sha256').update(domain).update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;
}
function authorizationBody(value) { return Object.fromEntries(AUTH_BODY_KEYS.map(key => [key, value[key]])); }
function position(value) { return [value.blockNumber, value.transactionIndex, value.logIndex]; }
function comparePosition(a, b) {
  const left = position(a), right = position(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
function positionKey(value) { return position(value).join(':'); }

export function membershipPayloadHash(eventInput) {
  const event = validateMembershipEvent(eventInput);
  return digest(PAYLOAD_HASH_DOMAIN, event.payload);
}

export function membershipAuthorizationMessage(input) {
  const envelope = input && typeof input === 'object' && Object.hasOwn(input, 'signature')
    ? validateMembershipAuthorization(input) : validateMembershipAuthorization(input, false);
  return AUTHORIZATION_DOMAIN + canonical(authorizationBody(envelope));
}

export function membershipAuthorizationHash(input) {
  return digest(AUTHORIZATION_HASH_DOMAIN, validateMembershipAuthorization(input));
}

export async function retrieveMembershipEventMaterials(commitmentsInput, archivesInput) {
  if (!Array.isArray(commitmentsInput) || !Array.isArray(archivesInput) || archivesInput.length < 1 ||
      archivesInput.some(archive => !archive || typeof archive.get !== 'function')) fail('INVALID_CONTENT_SOURCE');
  const materials = [], missing = [], mismatched = [];
  for (const input of commitmentsInput) {
    let commitment;
    try {
      commitment = exact(input, ['eventId', 'authorizationHash'], 'MALFORMED_COMMITMENT');
      hex(commitment.eventId, 32, 'MALFORMED_COMMITMENT');
      hex(commitment.authorizationHash, 32, 'MALFORMED_COMMITMENT');
    } catch (error) { throw error; }
    let event = null, authorization = null, sawInvalid = false;
    for (const archive of archivesInput) {
      if (!event) {
        try {
          const candidate = await archive.get('event', commitment.eventId);
          if (candidate !== null && candidate !== undefined) {
            const checked = validateMembershipEvent(candidate);
            if (checked.eventId === commitment.eventId) event = checked; else sawInvalid = true;
          }
        } catch { sawInvalid = true; }
      }
      if (!authorization) {
        try {
          const candidate = await archive.get('authorization', commitment.authorizationHash);
          if (candidate !== null && candidate !== undefined) {
            const checked = validateMembershipAuthorization(candidate);
            if (membershipAuthorizationHash(checked) === commitment.authorizationHash) authorization = checked; else sawInvalid = true;
          }
        } catch { sawInvalid = true; }
      }
      if (event && authorization) break;
    }
    if (!event || !authorization) {
      (sawInvalid ? mismatched : missing).push(Object.freeze({ ...commitment }));
      continue;
    }
    materials.push(Object.freeze({ event, authorization }));
  }
  const status = mismatched.length ? 'CONTENT_HASH_MISMATCH' : missing.length ? 'CONTENT_UNAVAILABLE' : 'AVAILABLE';
  return Object.freeze({ status, materials: Object.freeze(materials), missing: Object.freeze(missing), mismatched: Object.freeze(mismatched) });
}

export function validateMembershipAuthorization(input, requireSignature = true) {
  const value = exact(input, requireSignature ? AUTH_KEYS : AUTH_BODY_KEYS);
  if (value.protocolVersion !== GATE_F_PROTOCOL_VERSION ||
      value.authorizationVersion !== MEMBERSHIP_AUTHORIZATION_VERSION ||
      value.eventVersion !== MEMBERSHIP_EVENT_VERSION ||
      value.signatureType !== MEMBERSHIP_SIGNATURE_TYPE || value.signatureVersion !== '1' ||
      value.signatureMethod !== SIGNATURE_METHOD) fail('INVALID_AUTHORIZATION_VERSION');
  if (value.chainId !== BASE_SEPOLIA_CHAIN_ID) fail('CHAIN_MISMATCH');
  if (typeof value.networkId !== 'string' || !/^baarne:[a-z0-9][a-z0-9-]{2,63}$/.test(value.networkId)) fail('NETWORK_MISMATCH');
  if (typeof value.eventType !== 'string' || value.eventType.length > 64) fail('EVENT_MISMATCH');
  hex(value.eventId, 32, 'EVENT_MISMATCH');
  hex(value.payloadHash, 32, 'PAYLOAD_MISMATCH');
  hex(value.nonce, 32, 'INVALID_NONCE');
  identity(value.signer);
  if (requireSignature && (typeof value.signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(value.signature))) fail('MALFORMED_SIGNATURE');
  return Object.freeze({ ...value });
}

export function authorizationBodyForEvent(eventInput, { signer, nonce, chainId = BASE_SEPOLIA_CHAIN_ID } = {}) {
  const event = validateMembershipEvent(eventInput);
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) fail('CHAIN_MISMATCH');
  return Object.freeze({
    authorizationVersion: MEMBERSHIP_AUTHORIZATION_VERSION,
    chainId,
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    networkId: event.networkId,
    nonce: hex(nonce, 32, 'INVALID_NONCE'),
    payloadHash: membershipPayloadHash(event),
    protocolVersion: GATE_F_PROTOCOL_VERSION,
    signatureMethod: SIGNATURE_METHOD,
    signatureType: MEMBERSHIP_SIGNATURE_TYPE,
    signatureVersion: '1',
    signer: identity(signer),
  });
}

export async function signMembershipEvent(eventInput, options) {
  if (!options || typeof options.signMessage !== 'function') fail('SIGNER_REQUIRED');
  const body = authorizationBodyForEvent(eventInput, options);
  let signature;
  try { signature = String(await options.signMessage(AUTHORIZATION_DOMAIN + canonical(body))).toLowerCase(); }
  catch { fail('SIGNING_FAILED'); }
  const envelope = validateMembershipAuthorization({ ...body, signature });
  if (await evmEoaVerifier.verify(membershipAuthorizationMessage(envelope), envelope.signature, envelope.signer) !== 'VALID') fail('SIGNING_FAILED');
  return envelope;
}

export async function verifyMembershipEventSignature(eventInput, authorizationInput, expected = {}) {
  let event, authorization;
  try {
    event = validateMembershipEvent(eventInput);
    authorization = validateMembershipAuthorization(authorizationInput);
  } catch (error) {
    const stateCode = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : null;
    return Object.freeze({ status: error instanceof GateFError ? error.code : stateCode ?? 'MALFORMED_AUTHORIZATION' });
  }
  if (expected.chainId !== undefined && authorization.chainId !== expected.chainId) return Object.freeze({ status: 'CHAIN_MISMATCH' });
  if (authorization.networkId !== event.networkId || expected.networkId && authorization.networkId !== expected.networkId) return Object.freeze({ status: 'NETWORK_MISMATCH' });
  if (authorization.eventId !== event.eventId || authorization.eventType !== event.eventType || authorization.eventVersion !== event.eventVersion) return Object.freeze({ status: 'EVENT_MISMATCH' });
  if (authorization.payloadHash !== membershipPayloadHash(event)) return Object.freeze({ status: 'PAYLOAD_MISMATCH' });
  const verified = await evmEoaVerifier.verify(membershipAuthorizationMessage(authorization), authorization.signature, authorization.signer);
  return Object.freeze({ status: verified === 'VALID' ? 'SIGNATURE_VALID' : verified, authorization });
}

function eventActor(event, state) {
  switch (event.eventType) {
    case 'FOUNDER_INVITATION_ISSUED':
      if (!state.genesis.open || !state.genesis.founders.includes(event.payload.founder) || state.members[event.payload.founder]?.status !== 'ACTIVE') return { status: 'AUTHORITY_STATE_MISMATCH' };
      return { actor: event.payload.founder };
    case 'APPLICATION_OPENED': return { actor: event.payload.candidate };
    case 'APPLICATION_CANCELLED': return { actor: event.payload.candidate };
    case 'REFERENCE_SLOT_RESERVED':
      if (state.members[event.payload.issuer]?.status !== 'ACTIVE') return { status: 'AUTHORITY_STATE_MISMATCH' };
      return { actor: event.payload.issuer };
    case 'REFERENCE_SLOT_RELEASED': return { actor: event.payload.issuer };
    case 'REFERENCE_RECORDED': {
      const reservation = state.reservations[event.payload.reservationId];
      if (!reservation || reservation.applicationId !== event.payload.applicationId) return { status: 'AUTHORITY_STATE_MISMATCH' };
      return { actor: reservation.issuer };
    }
    case 'MEMBERSHIP_ACTIVATED': return { actor: event.payload.candidate };
    case 'MEMBERSHIP_RESIGNED': return { actor: event.payload.member };
    case 'GENESIS_CLOSED':
    case 'MEMBERSHIP_SUSPENDED':
    case 'MEMBERSHIP_EXPELLED': return { status: 'UNSUPPORTED_POLICY' };
    default: return { status: 'UNSUPPORTED_POLICY' };
  }
}

export async function authorizeMembershipEvent(eventInput, state, authorizationInput, expected = {}) {
  const signature = await verifyMembershipEventSignature(eventInput, authorizationInput, expected);
  if (signature.status !== 'SIGNATURE_VALID') return signature;
  const event = validateMembershipEvent(eventInput);
  const policy = eventActor(event, state);
  if (policy.status) return Object.freeze({ status: policy.status, signer: signature.authorization.signer });
  if (signature.authorization.signer !== policy.actor) return Object.freeze({ status: 'UNAUTHORIZED_SIGNER', signer: signature.authorization.signer, requiredSigner: policy.actor });
  return Object.freeze({ status: 'AUTHORIZED', signer: signature.authorization.signer, nonce: signature.authorization.nonce });
}

export function validateFinalizedEvidence(input) {
  const value = exact(input, EVIDENCE_KEYS, 'MALFORMED_EVIDENCE');
  if (value.evidenceVersion !== FINALIZED_EVIDENCE_VERSION) fail('MALFORMED_EVIDENCE');
  if (value.chainId !== BASE_SEPOLIA_CHAIN_ID) fail('CHAIN_MISMATCH');
  if (typeof value.networkId !== 'string' || !/^baarne:[a-z0-9][a-z0-9-]{2,63}$/.test(value.networkId)) fail('NETWORK_MISMATCH');
  for (const key of ['eventId', 'authorizationHash', 'transactionHash', 'blockHash', 'schemaUid', 'attestationUid']) hex(value[key], 32, 'MALFORMED_EVIDENCE');
  for (const key of ['blockNumber', 'blockTimestamp', 'transactionIndex', 'logIndex']) uint(value[key], 'MALFORMED_EVIDENCE');
  return Object.freeze({ ...value });
}

function normalizeLog(input) {
  const evidence = validateFinalizedEvidence(input);
  return Object.freeze({ ...evidence });
}
function normalizeBlock(input) {
  const value = exact(input, ['number', 'hash', 'timestamp'], 'MALFORMED_RPC_VIEW');
  return Object.freeze({ number: uint(value.number, 'MALFORMED_RPC_VIEW'), hash: hex(value.hash, 32, 'MALFORMED_RPC_VIEW'), timestamp: uint(value.timestamp, 'MALFORMED_RPC_VIEW') });
}
function normalizeView(input) {
  const value = exact(input, ['providerId', 'chainId', 'finalizedBlock', 'blocks', 'logs'], 'MALFORMED_RPC_VIEW');
  if (typeof value.providerId !== 'string' || value.providerId.length < 1 || value.providerId.length > 128) fail('MALFORMED_RPC_VIEW');
  if (value.chainId !== BASE_SEPOLIA_CHAIN_ID) fail('WRONG_CHAIN');
  const finalizedBlock = normalizeBlock(value.finalizedBlock);
  if (!Array.isArray(value.blocks) || !Array.isArray(value.logs)) fail('MALFORMED_RPC_VIEW');
  const blocks = value.blocks.map(normalizeBlock);
  const logs = value.logs.map(normalizeLog);
  const finalCopy = blocks.find(block => block.number === finalizedBlock.number);
  if (!finalCopy || canonical(finalCopy) !== canonical(finalizedBlock)) fail('MALFORMED_RPC_VIEW');
  return Object.freeze({ providerId: value.providerId, chainId: value.chainId, finalizedBlock, blocks, logs });
}

function rpcQuantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) fail('MALFORMED_RPC');
  const number = Number(BigInt(value));
  return uint(number, 'MALFORMED_RPC');
}
function rpcBlock(value) {
  if (!value || typeof value !== 'object') fail('MALFORMED_RPC');
  return normalizeBlock({ number: rpcQuantity(value.number), hash: value.hash, timestamp: rpcQuantity(value.timestamp) });
}
function rpcHexQuantity(value) { return `0x${uint(value, 'MALFORMED_RPC').toString(16)}`; }

/**
 * Read-only JSON-RPC normalization boundary. `decodeLog` is trusted versioned
 * adapter configuration (for example, a future EAS schema decoder); it cannot
 * confer authorization and must return a complete evidence object or null.
 */
export async function readFinalizedProviderView(connection, query) {
  if (!connection || typeof connection.request !== 'function' || !query || typeof query.decodeLog !== 'function') fail('INVALID_RPC_READER');
  if (typeof query.providerId !== 'string' || query.providerId.length < 1 || query.providerId.length > 128) fail('INVALID_RPC_READER');
  const fromBlock = uint(query.fromBlock, 'INVALID_RPC_READER');
  if (typeof query.address !== 'string' || !/^0x[0-9a-f]{40}$/.test(query.address)) fail('INVALID_RPC_READER');
  if (!Array.isArray(query.topics) || query.topics.some(value => value !== null && (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)))) fail('INVALID_RPC_READER');
  try {
    if (rpcQuantity(await connection.request('eth_chainId', [])) !== BASE_SEPOLIA_CHAIN_ID) fail('WRONG_CHAIN');
    const finalizedBefore = rpcBlock(await connection.request('eth_getBlockByNumber', ['finalized', false]));
    const requestedTo = query.toBlock === undefined ? finalizedBefore.number : uint(query.toBlock, 'INVALID_RPC_READER');
    const toBlock = Math.min(requestedTo, finalizedBefore.number);
    const rawLogs = fromBlock > toBlock ? [] : await connection.request('eth_getLogs', [{
      address: query.address, topics: query.topics, fromBlock: rpcHexQuantity(fromBlock), toBlock: rpcHexQuantity(toBlock),
    }]);
    if (!Array.isArray(rawLogs) || rawLogs.length > 100_000) fail('MALFORMED_RPC');
    const blocks = new Map([[finalizedBefore.number, finalizedBefore]]);
    const logs = [];
    for (const raw of rawLogs) {
      if (!raw || typeof raw !== 'object' || raw.removed === true) fail('MALFORMED_RPC');
      const blockNumber = rpcQuantity(raw.blockNumber);
      if (blockNumber > finalizedBefore.number) fail('PREFINAL_LOG_RETURNED');
      let observedBlock = blocks.get(blockNumber);
      if (!observedBlock) {
        observedBlock = rpcBlock(await connection.request('eth_getBlockByNumber', [rpcHexQuantity(blockNumber), false]));
        blocks.set(blockNumber, observedBlock);
      }
      if (raw.blockHash !== observedBlock.hash) fail('BLOCK_CHANGED');
      const decoded = await query.decodeLog(structuredClone(raw), observedBlock);
      if (decoded === null) continue;
      logs.push(normalizeLog(decoded));
    }
    const finalizedAfter = rpcBlock(await connection.request('eth_getBlockByNumber', ['finalized', false]));
    if (finalizedAfter.number < finalizedBefore.number ||
        finalizedAfter.number === finalizedBefore.number && finalizedAfter.hash !== finalizedBefore.hash) fail('BLOCK_CHANGED');
    return normalizeView({ providerId: query.providerId, chainId: BASE_SEPOLIA_CHAIN_ID,
      finalizedBlock: finalizedBefore, blocks: [...blocks.values()], logs });
  } catch (error) {
    if (error instanceof GateFError) throw error;
    fail('RPC_UNAVAILABLE');
  }
}
function uniqueSortedLogs(logs) {
  const positions = new Map();
  for (const log of logs) {
    const key = positionKey(log), previous = positions.get(key);
    if (previous && canonical(previous) !== canonical(log)) fail('CONFLICTING_CHAIN_POSITION');
    positions.set(key, log);
  }
  return [...positions.values()].sort(comparePosition);
}

export function discoverFinalizedMembershipCommitments(providerViewsInput, expected) {
  try {
    if (!Array.isArray(providerViewsInput) || providerViewsInput.length < 2) fail('INDEPENDENT_RPC_REQUIRED');
    const views = providerViewsInput.map(normalizeView);
    if (new Set(views.map(view => view.providerId)).size !== views.length) fail('INDEPENDENT_RPC_REQUIRED');
    const commonNumber = Math.min(...views.map(view => view.finalizedBlock.number));
    const commonBlocks = views.map(view => view.blocks.find(block => block.number === commonNumber));
    if (commonBlocks.some(block => !block)) fail('RPC_DISAGREEMENT');
    if (new Set(commonBlocks.map(block => block.hash)).size !== 1) fail('RPC_DISAGREEMENT');
    const logSets = views.map(view => uniqueSortedLogs(view.logs.filter(log => log.blockNumber <= commonNumber)));
    const first = canonical(logSets[0]);
    if (logSets.some(logs => canonical(logs) !== first)) fail('RPC_LOG_DISAGREEMENT');
    for (const view of views) {
      const blocks = new Map(view.blocks.map(block => [block.number, block]));
      for (const log of logSets[0]) {
        const block = blocks.get(log.blockNumber);
        if (!block || block.hash !== log.blockHash || block.timestamp !== log.blockTimestamp) fail('RPC_DISAGREEMENT');
      }
    }
    for (const evidence of logSets[0]) {
      if (evidence.networkId !== expected.networkId || evidence.chainId !== expected.chainId || evidence.schemaUid !== expected.schemaUid) fail('EVIDENCE_SCOPE_MISMATCH');
    }
    return Object.freeze({ status: 'FINALIZED', commonFinalizedBlock: commonBlocks[0],
      evidence: Object.freeze(logSets[0]),
      commitments: Object.freeze(logSets[0].map(item => Object.freeze({ eventId: item.eventId, authorizationHash: item.authorizationHash }))),
      ignoredPrefinalCount: views.reduce((sum, view) => sum + view.logs.filter(log => log.blockNumber > commonNumber).length, 0) });
  } catch (error) {
    return Object.freeze({ status: error instanceof GateFError ? error.code : 'FINALITY_VERIFICATION_FAILED', evidence: Object.freeze([]), commitments: Object.freeze([]) });
  }
}

export function verifyFinalizedOrdering(providerViewsInput, materialsInput, expected) {
  try {
    if (!Array.isArray(materialsInput)) fail('MALFORMED_MATERIAL');
    const discovery = discoverFinalizedMembershipCommitments(providerViewsInput, expected);
    if (discovery.status !== 'FINALIZED') fail(discovery.status);
    const materials = new Map();
    for (const material of materialsInput) {
      if (!material || typeof material !== 'object') fail('MALFORMED_MATERIAL');
      const event = validateMembershipEvent(material.event);
      const authorization = validateMembershipAuthorization(material.authorization);
      const key = `${event.eventId}/${membershipAuthorizationHash(authorization)}`;
      if (materials.has(key)) fail('DUPLICATE_MATERIAL');
      materials.set(key, Object.freeze({ event, authorization }));
    }
    const entries = discovery.evidence.map(evidence => {
      const material = materials.get(`${evidence.eventId}/${evidence.authorizationHash}`);
      if (!material) fail('MISSING_EVENT_MATERIAL');
      if (material.event.networkId !== evidence.networkId) fail('EVIDENCE_SCOPE_MISMATCH');
      return Object.freeze({ evidence, ...material });
    });
    return Object.freeze({ status: 'FINALIZED', commonFinalizedBlock: discovery.commonFinalizedBlock, entries: Object.freeze(entries), ignoredPrefinalCount: discovery.ignoredPrefinalCount });
  } catch (error) {
    return Object.freeze({ status: error instanceof GateFError ? error.code : 'FINALITY_VERIFICATION_FAILED', entries: Object.freeze([]) });
  }
}

function chainHistoryHash(previous, entry, result) {
  return digest(HISTORY_HASH_DOMAIN, { previous, position: position(entry.evidence), eventId: entry.event.eventId,
    authorizationHash: entry.evidence.authorizationHash, result });
}
function nonceKey(authorization) { return `${authorization.signer}/${authorization.nonce}`; }
function checkpointBody(value) {
  const { checkpointHash: ignored, ...body } = value;
  return body;
}
export function checkpointHash(value) { return digest(CHECKPOINT_HASH_DOMAIN, checkpointBody(value)); }

function validateCheckpoint(input, genesis, expected) {
  try {
    const value = exact(input, ['checkpointVersion', 'chainId', 'networkId', 'genesisHash', 'commonFinalizedBlock',
      'lastPosition', 'historyHash', 'seenNonces', 'state', 'checkpointHash'], 'INVALID_CHECKPOINT');
    if (value.checkpointVersion !== CHECKPOINT_VERSION || value.chainId !== expected.chainId || value.networkId !== expected.networkId ||
        value.genesisHash !== hashMembershipGenesis(genesis) || checkpointHash(value) !== value.checkpointHash ||
        value.state?.networkId !== expected.networkId || membershipStateHash(value.state) !== value.state.stateHash ||
        !Array.isArray(value.seenNonces) || new Set(value.seenNonces).size !== value.seenNonces.length ||
        !Array.isArray(value.lastPosition) || value.lastPosition.length !== 3) fail('INVALID_CHECKPOINT');
    const sentinel = value.lastPosition.every(item => item === -1);
    if (!sentinel) value.lastPosition.forEach(item => uint(item, 'INVALID_CHECKPOINT'));
    value.seenNonces.forEach(item => { if (typeof item !== 'string' || item.length > 400) fail('INVALID_CHECKPOINT'); });
    normalizeBlock(value.commonFinalizedBlock);
    hex(value.historyHash, 32, 'INVALID_CHECKPOINT');
    return structuredClone(value);
  } catch { fail('INVALID_CHECKPOINT'); }
}

export async function replayFinalizedMembershipEvents(genesis, providerViews, materials, expected, options = {}) {
  const ordering = verifyFinalizedOrdering(providerViews, materials, expected);
  if (ordering.status !== 'FINALIZED') return Object.freeze({ status: ordering.status, accepted: Object.freeze([]), rejected: Object.freeze([]), state: null, checkpoint: null });
  let state = initializeMembershipState(genesis), lastPosition = [-1, -1, -1], historyHash = digest(HISTORY_HASH_DOMAIN, { genesisHash: hashMembershipGenesis(genesis) });
  const seenNonces = new Set();
  if (options.checkpoint) {
    const checkpoint = validateCheckpoint(options.checkpoint, genesis, expected);
    state = checkpoint.state; lastPosition = checkpoint.lastPosition; historyHash = checkpoint.historyHash;
    checkpoint.seenNonces.forEach(value => seenNonces.add(value));
  }
  let currentAuthorization = null, currentAuthorizationResult = null, currentEvidence = null;
  const machine = createMembershipStateMachine({
    eventOrdering: 'EXTERNAL_FINALIZED',
    async authorizeEvent(event, precedingState) {
      currentAuthorizationResult = await authorizeMembershipEvent(event, precedingState, currentAuthorization, expected);
      return currentAuthorizationResult.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'DENIED';
    },
    resolveOccurredAt() { return currentEvidence.blockTimestamp; },
  });
  const accepted = [], rejected = [];
  for (const entry of ordering.entries) {
    if (comparePosition(entry.evidence, { blockNumber: lastPosition[0], transactionIndex: lastPosition[1], logIndex: lastPosition[2] }) <= 0) continue;
    const signature = await verifyMembershipEventSignature(entry.event, entry.authorization, expected);
    let result;
    if (signature.status !== 'SIGNATURE_VALID') {
      result = signature.status;
    } else if (seenNonces.has(nonceKey(entry.authorization))) {
      result = 'AUTHORIZATION_NONCE_REPLAY';
    } else {
      seenNonces.add(nonceKey(entry.authorization));
      currentAuthorization = entry.authorization; currentAuthorizationResult = null; currentEvidence = entry.evidence;
      const transition = await machine.applyEvent(state, entry.event);
      result = transition.status === 'UNAUTHORIZED_EVENT' && currentAuthorizationResult?.status ? currentAuthorizationResult.status : transition.status;
      if (transition.status === 'ACCEPTED') state = transition.state;
    }
    const item = Object.freeze({ eventId: entry.event.eventId, position: Object.freeze(position(entry.evidence)), status: result });
    (result === 'ACCEPTED' ? accepted : rejected).push(item);
    historyHash = chainHistoryHash(historyHash, entry, result);
    lastPosition = position(entry.evidence);
  }
  const body = {
    checkpointVersion: CHECKPOINT_VERSION, chainId: expected.chainId, networkId: expected.networkId,
    genesisHash: hashMembershipGenesis(genesis), commonFinalizedBlock: ordering.commonFinalizedBlock,
    lastPosition, historyHash, seenNonces: [...seenNonces].sort(), state,
  };
  const checkpoint = Object.freeze({ ...body, checkpointHash: digest(CHECKPOINT_HASH_DOMAIN, body) });
  return Object.freeze({ status: 'VERIFIED', commonFinalizedBlock: ordering.commonFinalizedBlock,
    accepted: Object.freeze(accepted), rejected: Object.freeze(rejected), state, checkpoint,
    ignoredPrefinalCount: ordering.ignoredPrefinalCount });
}

export { GateFError };
