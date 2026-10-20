import { createHash } from 'node:crypto';
import { canonical } from '../../admission/src/json.ts';
import { referenceCodec, verifyReferencePackage } from '../../v0.1-core/src/reference.mjs';

export const MEMBERSHIP_EVENT_VERSION = 'BAARNE_MEMBERSHIP_EVENT_V1';
export const MEMBERSHIP_STATE_VERSION = 'BAARNE_MEMBERSHIP_STATE_V1';
export const MEMBERSHIP_GENESIS_VERSION = 'BAARNE_MEMBERSHIP_GENESIS_V1';
export const REFERENCE_SLOT_COUNT = 3;
export const MAX_ELECTORATE_HOPS = 6;

const EVENT_DOMAIN = 'BAARNE_MEMBERSHIP_EVENT_V1\n';
const GENESIS_DOMAIN = 'BAARNE_MEMBERSHIP_GENESIS_V1\n';
const STATE_DOMAIN = 'BAARNE_MEMBERSHIP_STATE_V1\n';
const EVENT_TYPES = new Set([
  'FOUNDER_INVITATION_ISSUED', 'GENESIS_CLOSED', 'APPLICATION_OPENED',
  'APPLICATION_CANCELLED',
  'REFERENCE_SLOT_RESERVED', 'REFERENCE_SLOT_RELEASED', 'REFERENCE_RECORDED',
  'MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_RESIGNED', 'MEMBERSHIP_SUSPENDED',
  'MEMBERSHIP_EXPELLED',
]);
const EXACT_PAYLOADS = {
  FOUNDER_INVITATION_ISSUED: ['invitationId', 'founder', 'candidate'],
  GENESIS_CLOSED: [],
  APPLICATION_OPENED: ['applicationId', 'candidate', 'invitationId'],
  APPLICATION_CANCELLED: ['applicationId', 'candidate'],
  REFERENCE_SLOT_RESERVED: ['reservationId', 'issuer', 'slot', 'applicationId'],
  REFERENCE_SLOT_RELEASED: ['reservationId', 'issuer'],
  REFERENCE_RECORDED: ['reservationId', 'applicationId', 'reference'],
  MEMBERSHIP_ACTIVATED: ['applicationId', 'candidate'],
  MEMBERSHIP_RESIGNED: ['member'],
  MEMBERSHIP_SUSPENDED: ['member', 'decisionRef'],
  MEMBERSHIP_EXPELLED: ['member', 'decisionRef'],
};

class TransitionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new TransitionError(code); };
function exact(value, keys, code = 'MALFORMED') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) fail(code);
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    output[key] = descriptor.value;
  }
  return output;
}
function integer(value, code = 'INVALID_TIMESTAMP') {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(code);
  return value;
}
function snapshotData(value, depth = 0) {
  if (depth > 12) fail('MALFORMED');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (value.length > 64 * 1024) fail('MALFORMED'); return value; }
  if (typeof value === 'number') return integer(value, 'MALFORMED');
  if (Array.isArray(value)) {
    if (value.length > 1024) fail('MALFORMED');
    return value.map(item => snapshotData(item, depth + 1));
  }
  if (typeof value !== 'object') fail('MALFORMED');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('MALFORMED');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 128 || keys.some(key => typeof key !== 'string')) fail('MALFORMED');
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('MALFORMED');
    output[key] = snapshotData(descriptor.value, depth + 1);
  }
  return output;
}
function bytes32(value, code = 'INVALID_IDENTIFIER') {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) fail(code);
  return value;
}
function identity(value) {
  try {
    const checked = referenceCodec.validateReference({
      protocolVersion: '0.1', recordType: 'BAARNE_REFERENCE_V1', issuer: value,
      subject: value, issuedAt: 0, expiresAt: null, nonce: `0x${'00'.repeat(32)}`,
      revocable: true, metadataHash: null,
    });
    if (checked.issuer !== value) fail('INVALID_IDENTITY');
    return checked.issuer;
  } catch { fail('INVALID_IDENTITY'); }
}
function networkId(value) {
  if (typeof value !== 'string' || !/^baarne:[a-z0-9][a-z0-9-]{2,63}$/.test(value)) fail('INVALID_NETWORK');
  return value;
}
function digest(domain, value) {
  return `0x${createHash('sha256').update(domain).update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;
}
function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}
function eventTuple(event) { return [event.occurredAt, event.eventId]; }
function compareTuple(a, b) { return a[0] - b[0] || a[1].localeCompare(b[1]); }

export function validateMembershipGenesis(input) {
  const value = exact(input, ['genesisVersion', 'stateMachineVersion', 'networkId', 'createdAt', 'founderInvitationClosesAt', 'founders'], 'INVALID_GENESIS');
  if (value.genesisVersion !== MEMBERSHIP_GENESIS_VERSION || value.stateMachineVersion !== MEMBERSHIP_STATE_VERSION) fail('INVALID_GENESIS_VERSION');
  const createdAt = integer(value.createdAt);
  const founderInvitationClosesAt = integer(value.founderInvitationClosesAt);
  if (founderInvitationClosesAt < createdAt) fail('INVALID_GENESIS_WINDOW');
  if (!Array.isArray(value.founders) || value.founders.length < 3) fail('INVALID_FOUNDERS');
  const founders = [...value.founders].map(identity).sort();
  if (new Set(founders).size !== founders.length) fail('DUPLICATE_FOUNDER');
  return Object.freeze({
    genesisVersion: MEMBERSHIP_GENESIS_VERSION,
    stateMachineVersion: MEMBERSHIP_STATE_VERSION,
    networkId: networkId(value.networkId), createdAt, founderInvitationClosesAt,
    founders: Object.freeze(founders),
  });
}

export function canonicalMembershipGenesis(input) { return canonical(validateMembershipGenesis(input)); }
export function hashMembershipGenesis(input) { return digest(GENESIS_DOMAIN, validateMembershipGenesis(input)); }

function validatePayload(type, payload) {
  const value = snapshotData(exact(payload, EXACT_PAYLOADS[type]));
  switch (type) {
    case 'FOUNDER_INVITATION_ISSUED': bytes32(value.invitationId); identity(value.founder); identity(value.candidate); break;
    case 'GENESIS_CLOSED': break;
    case 'APPLICATION_OPENED': bytes32(value.applicationId); identity(value.candidate); if (value.invitationId !== null) bytes32(value.invitationId); break;
    case 'APPLICATION_CANCELLED': bytes32(value.applicationId); identity(value.candidate); break;
    case 'REFERENCE_SLOT_RESERVED': bytes32(value.reservationId); identity(value.issuer); bytes32(value.applicationId); if (!Number.isInteger(value.slot) || value.slot < 0 || value.slot >= REFERENCE_SLOT_COUNT) fail('INVALID_SLOT'); break;
    case 'REFERENCE_SLOT_RELEASED': bytes32(value.reservationId); identity(value.issuer); break;
    case 'REFERENCE_RECORDED': bytes32(value.reservationId); bytes32(value.applicationId); if (!value.reference || typeof value.reference !== 'object') fail('INVALID_REFERENCE'); break;
    case 'MEMBERSHIP_ACTIVATED': bytes32(value.applicationId); identity(value.candidate); break;
    case 'MEMBERSHIP_RESIGNED': identity(value.member); break;
    case 'MEMBERSHIP_SUSPENDED':
    case 'MEMBERSHIP_EXPELLED': identity(value.member); bytes32(value.decisionRef, 'INVALID_DECISION_REFERENCE'); break;
    default: fail('UNSUPPORTED_EVENT_TYPE');
  }
  return value;
}

function eventBody(network, eventType, occurredAt, payload) {
  if (!EVENT_TYPES.has(eventType)) fail('UNSUPPORTED_EVENT_TYPE');
  return { eventVersion: MEMBERSHIP_EVENT_VERSION, networkId: networkId(network), eventType, occurredAt: integer(occurredAt), payload: validatePayload(eventType, payload) };
}
export function membershipEventId(event) {
  const body = eventBody(event.networkId, event.eventType, event.occurredAt, event.payload);
  return digest(EVENT_DOMAIN, body);
}
export function makeMembershipEvent(network, eventType, occurredAt, payload) {
  const body = eventBody(network, eventType, occurredAt, payload);
  return Object.freeze({ ...body, eventId: digest(EVENT_DOMAIN, body) });
}
export function validateMembershipEvent(input) {
  const value = exact(input, ['eventVersion', 'networkId', 'eventType', 'occurredAt', 'payload', 'eventId']);
  if (value.eventVersion !== MEMBERSHIP_EVENT_VERSION) fail('INVALID_EVENT_VERSION');
  const body = eventBody(value.networkId, value.eventType, value.occurredAt, value.payload);
  const eventId = bytes32(value.eventId, 'INVALID_EVENT_ID');
  if (eventId !== digest(EVENT_DOMAIN, body)) fail('EVENT_ID_MISMATCH');
  return Object.freeze({ ...body, eventId });
}
export function canonicalMembershipEvent(input) { return canonical(validateMembershipEvent(input)); }

function memberRecord(id, founder, startedAt, startReason) {
  return { identity: id, status: 'ACTIVE', founder, periods: [{ startedAt, endedAt: null, startReason, endReason: null, applicationId: null }], slots: Array(REFERENCE_SLOT_COUNT).fill(null) };
}
function baseState(state) { const { stateHash: ignored, ...rest } = state; return structuredClone(rest); }
function normalize(state) {
  state.members = sortedObject(state.members);
  state.applications = sortedObject(state.applications);
  state.invitations = sortedObject(state.invitations);
  state.reservations = sortedObject(state.reservations);
  state.events = sortedObject(state.events);
  state.references.sort((a, b) => a.recordHash.localeCompare(b.recordHash) || a.eventId.localeCompare(b.eventId));
  for (const application of Object.values(state.applications)) application.references.sort((a, b) => a.issuer.localeCompare(b.issuer) || a.recordHash.localeCompare(b.recordHash));
  return state;
}
export function membershipStateHash(state) { return digest(STATE_DOMAIN, normalize(baseState(state))); }
function withHash(state) { const normalized = normalize(state); return { ...normalized, stateHash: membershipStateHash(normalized) }; }
export function canonicalMembershipState(state) { return canonical(withHash(baseState(state))); }

export function initializeMembershipState(genesisInput) {
  const genesis = validateMembershipGenesis(genesisInput);
  const members = {};
  for (const founder of genesis.founders) members[founder] = memberRecord(founder, true, genesis.createdAt, 'GENESIS');
  return withHash({ stateMachineVersion: MEMBERSHIP_STATE_VERSION, networkId: genesis.networkId,
    genesisHash: hashMembershipGenesis(genesis), height: 0, lastEvent: null,
    genesis: { open: true, invitationClosesAt: genesis.founderInvitationClosesAt, founders: [...genesis.founders] },
    members, applications: {}, invitations: {}, reservations: {}, references: [], events: {} });
}

function activeMember(state, id) {
  const member = state.members[id];
  if (!member || member.status !== 'ACTIVE') fail('MEMBER_NOT_ACTIVE');
  return member;
}
function openApplication(state, applicationId) {
  const application = state.applications[applicationId];
  if (!application || application.status !== 'OPEN') fail('APPLICATION_NOT_OPEN');
  return application;
}
function releaseReservation(state, reservation, at, reason) {
  const issuer = state.members[reservation.issuer];
  if (issuer?.slots[reservation.slot] === reservation.reservationId) issuer.slots[reservation.slot] = null;
  reservation.status = 'RELEASED';
  reservation.releasedAt = at;
  reservation.releaseReason = reason;
}
function releaseApplicationReservations(state, applicationId, at, reason) {
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.applicationId === applicationId && ['RESERVED', 'CONSUMED'].includes(reservation.status)) {
      releaseReservation(state, reservation, at, reason);
    }
  }
}
function releaseCurrentMembershipInboundSlots(state, member, at, reason) {
  const applicationId = member.periods.at(-1)?.applicationId;
  if (applicationId !== null && applicationId !== undefined) releaseApplicationReservations(state, applicationId, at, reason);
}
function endActivePeriod(member, at, reason) {
  const period = member.periods.at(-1);
  if (!period || period.endedAt !== null) fail('ACTIVE_PERIOD_MISSING');
  period.endedAt = at; period.endReason = reason;
}

function closeGenesis(state, event, reason) {
  if (!state.genesis.open) return;
  state.genesis.open = false;
  state.genesis.closedAt = event.occurredAt;
  state.genesis.closeReason = reason;
  state.genesis.closedByEventId = event.eventId;
  for (const invitation of Object.values(state.invitations)) {
    if (invitation.status !== 'ISSUED') continue;
    invitation.status = 'INVALIDATED';
    invitation.invalidatedAt = event.occurredAt;
    invitation.invalidatedByEventId = event.eventId;
  }
}

function applySynchronous(state, event) {
  const p = event.payload;
  switch (event.eventType) {
    case 'FOUNDER_INVITATION_ISSUED': {
      if (!state.genesis.open || event.occurredAt >= state.genesis.invitationClosesAt) fail('GENESIS_INVITATIONS_CLOSED');
      if (!state.genesis.founders.includes(p.founder)) fail('NOT_GENESIS_FOUNDER');
      activeMember(state, p.founder);
      if (state.members[p.candidate]?.status === 'ACTIVE') fail('CANDIDATE_ALREADY_MEMBER');
      if (state.invitations[p.invitationId]) fail('DUPLICATE_INVITATION');
      if (Object.values(state.invitations).some(x => x.candidate === p.candidate && x.status === 'ISSUED')) fail('CANDIDATE_ALREADY_INVITED');
      state.invitations[p.invitationId] = { invitationId: p.invitationId, founder: p.founder, candidate: p.candidate, issuedAt: event.occurredAt, status: 'ISSUED', consumedAt: null, applicationId: null, invalidatedAt: null, invalidatedByEventId: null };
      break;
    }
    case 'GENESIS_CLOSED':
      if (!state.genesis.open) fail('GENESIS_ALREADY_CLOSED');
      if (event.occurredAt < state.genesis.invitationClosesAt) fail('GENESIS_CLOSE_TOO_EARLY');
      closeGenesis(state, event, 'EXPLICIT_LEGACY_EVENT'); break;
    case 'APPLICATION_OPENED': {
      if (state.applications[p.applicationId]) fail('DUPLICATE_APPLICATION');
      const member = state.members[p.candidate];
      if (member && member.status !== 'RESIGNED') fail('CANDIDATE_NOT_ELIGIBLE');
      if (Object.values(state.applications).some(x => x.candidate === p.candidate && ['OPEN', 'READY'].includes(x.status))) fail('APPLICATION_ALREADY_OPEN');
      if (state.genesis.open) {
        if (event.occurredAt >= state.genesis.invitationClosesAt) fail('GENESIS_CLOSURE_REQUIRED');
        if (p.invitationId === null) fail('FOUNDER_INVITATION_REQUIRED');
        const invitation = state.invitations[p.invitationId];
        if (!invitation || invitation.status !== 'ISSUED' || invitation.candidate !== p.candidate) fail('INVALID_FOUNDER_INVITATION');
        invitation.status = 'CONSUMED'; invitation.consumedAt = event.occurredAt; invitation.applicationId = p.applicationId;
      } else if (p.invitationId !== null) fail('FOUNDER_INVITATION_NOT_ALLOWED');
      state.applications[p.applicationId] = { applicationId: p.applicationId, candidate: p.candidate, status: 'OPEN', openedAt: event.occurredAt, invitationId: p.invitationId, references: [], activatedAt: null, cancelledAt: null };
      break;
    }
    case 'APPLICATION_CANCELLED': {
      const application = state.applications[p.applicationId];
      if (!application || !['OPEN', 'READY'].includes(application.status) || application.candidate !== p.candidate) fail('APPLICATION_NOT_CANCELLABLE');
      releaseApplicationReservations(state, application.applicationId, event.occurredAt, 'APPLICATION_CANCELLED');
      application.status = 'CANCELLED'; application.cancelledAt = event.occurredAt;
      break;
    }
    case 'REFERENCE_SLOT_RESERVED': {
      const issuer = activeMember(state, p.issuer); const application = openApplication(state, p.applicationId);
      if (issuer.identity === application.candidate) fail('SELF_REFERENCE');
      if (issuer.slots[p.slot] !== null) fail('REFERENCE_SLOT_UNAVAILABLE');
      if (state.reservations[p.reservationId]) fail('DUPLICATE_RESERVATION');
      if (application.references.some(x => x.issuer === issuer.identity) || Object.values(state.reservations).some(x => x.status === 'RESERVED' && x.issuer === issuer.identity && x.applicationId === application.applicationId)) fail('DUPLICATE_REFERENCE_ISSUER');
      issuer.slots[p.slot] = p.reservationId;
      state.reservations[p.reservationId] = { reservationId: p.reservationId, issuer: issuer.identity, slot: p.slot, applicationId: application.applicationId, candidate: application.candidate, status: 'RESERVED', reservedAt: event.occurredAt, releasedAt: null, releaseReason: null, consumedAt: null, referenceRecordHash: null };
      break;
    }
    case 'REFERENCE_SLOT_RELEASED': {
      const reservation = state.reservations[p.reservationId];
      if (!reservation || reservation.status !== 'RESERVED' || reservation.issuer !== p.issuer) fail('RESERVATION_NOT_ACTIVE');
      const issuer = activeMember(state, p.issuer);
      if (issuer.slots[reservation.slot] !== reservation.reservationId) fail('SLOT_RESERVATION_MISMATCH');
      releaseReservation(state, reservation, event.occurredAt, 'ISSUER_RELEASED');
      break;
    }
    case 'MEMBERSHIP_ACTIVATED': {
      const application = state.applications[p.applicationId];
      if (!application || application.status !== 'READY' || application.candidate !== p.candidate || application.references.length !== 3 || new Set(application.references.map(x => x.issuer)).size !== 3) fail('APPLICATION_NOT_READY');
      const existing = state.members[p.candidate];
      if (existing && existing.status !== 'RESIGNED') fail('CANDIDATE_NOT_ELIGIBLE');
      if (existing) { existing.status = 'ACTIVE'; existing.periods.push({ startedAt: event.occurredAt, endedAt: null, startReason: 'ADMISSION', endReason: null, applicationId: application.applicationId }); }
      else {
        state.members[p.candidate] = memberRecord(p.candidate, false, event.occurredAt, 'ADMISSION');
        state.members[p.candidate].periods[0].applicationId = application.applicationId;
      }
      application.status = 'ACTIVATED'; application.activatedAt = event.occurredAt;
      if (state.genesis.open && !state.genesis.founders.includes(p.candidate)) closeGenesis(state, event, 'FIRST_REGULAR_MEMBERSHIP_ACTIVATED');
      break;
    }
    case 'MEMBERSHIP_RESIGNED': {
      const member = activeMember(state, p.member); endActivePeriod(member, event.occurredAt, 'RESIGNED'); releaseCurrentMembershipInboundSlots(state, member, event.occurredAt, 'REFERRED_MEMBER_RESIGNED'); member.status = 'RESIGNED'; break;
    }
    case 'MEMBERSHIP_SUSPENDED': {
      const member = activeMember(state, p.member); endActivePeriod(member, event.occurredAt, 'SUSPENDED'); member.status = 'SUSPENDED'; member.lastDecisionRef = p.decisionRef; break;
    }
    case 'MEMBERSHIP_EXPELLED': {
      const member = state.members[p.member];
      if (!member || !['ACTIVE', 'SUSPENDED'].includes(member.status)) fail('INVALID_MEMBERSHIP_TRANSITION');
      if (member.status === 'ACTIVE') endActivePeriod(member, event.occurredAt, 'EXPELLED');
      releaseCurrentMembershipInboundSlots(state, member, event.occurredAt, 'REFERRED_MEMBER_EXPELLED');
      member.status = 'EXPELLED'; member.lastDecisionRef = p.decisionRef; break;
    }
    default: break;
  }
}

async function applyReference(state, event, verifyReference) {
  const p = event.payload; const reservation = state.reservations[p.reservationId];
  if (!reservation || reservation.status !== 'RESERVED' || reservation.applicationId !== p.applicationId) fail('RESERVATION_NOT_ACTIVE');
  const issuer = activeMember(state, reservation.issuer); const application = openApplication(state, p.applicationId);
  if (issuer.slots[reservation.slot] !== reservation.reservationId) fail('SLOT_RESERVATION_MISMATCH');
  const checked = await verifyReference(p.reference);
  if (!checked || checked.status !== 'VALID') fail('INVALID_REFERENCE');
  if (checked.record.issuer !== issuer.identity || checked.record.subject !== application.candidate) fail('REFERENCE_BINDING_MISMATCH');
  if (checked.record.issuedAt < reservation.reservedAt || checked.record.issuedAt > event.occurredAt) fail('REFERENCE_TIME_INVALID');
  if (checked.record.expiresAt !== null && checked.record.expiresAt <= event.occurredAt) fail('REFERENCE_EXPIRED');
  if (state.references.some(x => x.recordHash === checked.recordHash)) fail('DUPLICATE_REFERENCE');
  if (application.references.some(x => x.issuer === issuer.identity)) fail('DUPLICATE_REFERENCE_ISSUER');
  const historical = { eventId: event.eventId, applicationId: application.applicationId, recordHash: checked.recordHash, issuer: issuer.identity, subject: application.candidate, record: checked.record, authorization: structuredClone(p.reference.authorization), acceptedAt: event.occurredAt };
  state.references.push(historical); application.references.push({ issuer: issuer.identity, recordHash: checked.recordHash, acceptedAt: event.occurredAt, eventId: event.eventId });
  reservation.status = 'CONSUMED'; reservation.consumedAt = event.occurredAt; reservation.referenceRecordHash = checked.recordHash;
  if (application.references.length === 3) application.status = 'READY';
}

export function createMembershipStateMachine(options = {}) {
  const verifyReference = options.verifyReference ?? verifyReferencePackage;
  const authorizeEvent = options.authorizeEvent ?? null;
  const eventOrdering = options.eventOrdering ?? 'EVENT_TUPLE';
  const resolveOccurredAt = options.resolveOccurredAt ?? (event => event.occurredAt);
  if (typeof verifyReference !== 'function') throw new Error('INVALID_REFERENCE_VERIFIER');
  if (authorizeEvent !== null && typeof authorizeEvent !== 'function') throw new Error('INVALID_EVENT_AUTHORIZER');
  if (!['EVENT_TUPLE', 'EXTERNAL_FINALIZED'].includes(eventOrdering)) throw new Error('INVALID_EVENT_ORDERING');
  if (typeof resolveOccurredAt !== 'function') throw new Error('INVALID_EVENT_TIME_RESOLVER');
  async function applyEvent(stateInput, eventInput) {
    const reject = (status, eventId = eventInput?.eventId ?? null) => Object.freeze({ status, eventId, state: stateInput });
    let event;
    try { event = validateMembershipEvent(eventInput); } catch (error) { return reject(error instanceof TransitionError ? error.code : 'MALFORMED_EVENT'); }
    if (!stateInput || stateInput.stateMachineVersion !== MEMBERSHIP_STATE_VERSION) return reject('INVALID_STATE', event.eventId);
    try {
      if (typeof stateInput.stateHash !== 'string' || membershipStateHash(stateInput) !== stateInput.stateHash) return reject('STATE_HASH_MISMATCH', event.eventId);
    } catch { return reject('INVALID_STATE', event.eventId); }
    if (event.networkId !== stateInput.networkId) return reject('NETWORK_MISMATCH', event.eventId);
    if (stateInput.events[event.eventId]) return reject('REPLAYED_EVENT', event.eventId);
    if (eventOrdering === 'EVENT_TUPLE' && stateInput.lastEvent && compareTuple(eventTuple(event), [stateInput.lastEvent.occurredAt, stateInput.lastEvent.eventId]) <= 0) return reject('EVENT_ORDER_VIOLATION', event.eventId);
    if (authorizeEvent) {
      try {
        if (await authorizeEvent(structuredClone(event), structuredClone(stateInput)) !== 'AUTHORIZED') return reject('UNAUTHORIZED_EVENT', event.eventId);
      } catch { return reject('EVENT_AUTHORIZATION_FAILED', event.eventId); }
    }
    let effectiveEvent = event;
    try {
      const authoritativeTime = integer(await resolveOccurredAt(structuredClone(event), structuredClone(stateInput)));
      if (authoritativeTime !== event.occurredAt) effectiveEvent = Object.freeze({ ...event, occurredAt: authoritativeTime });
    } catch { return reject('EVENT_TIME_RESOLUTION_FAILED', event.eventId); }
    const state = baseState(stateInput);
    try {
      if (effectiveEvent.eventType === 'REFERENCE_RECORDED') await applyReference(state, effectiveEvent, verifyReference);
      else applySynchronous(state, effectiveEvent);
      state.height += 1; state.lastEvent = { occurredAt: effectiveEvent.occurredAt, eventId: event.eventId };
      state.events[event.eventId] = { eventType: event.eventType, occurredAt: effectiveEvent.occurredAt, height: state.height };
      return Object.freeze({ status: 'ACCEPTED', eventId: event.eventId, state: withHash(state) });
    } catch (error) { return reject(error instanceof TransitionError ? error.code : 'TRANSITION_FAILED', event.eventId); }
  }
  async function replay(genesisInput, eventInputs) {
    const events = eventInputs.map(validateMembershipEvent);
    if (eventOrdering === 'EVENT_TUPLE') events.sort((a, b) => compareTuple(eventTuple(a), eventTuple(b)));
    let state = initializeMembershipState(genesisInput); const results = [];
    for (const event of events) { const result = await applyEvent(state, event); results.push({ eventId: event.eventId, eventType: event.eventType, status: result.status }); if (result.status === 'ACCEPTED') state = result.state; }
    return Object.freeze({ state, results: Object.freeze(results) });
  }
  return Object.freeze({ applyEvent, replay });
}

export const { applyMembershipEvent, replayMembershipEvents } = (() => {
  const machine = createMembershipStateMachine();
  return { applyMembershipEvent: machine.applyEvent, replayMembershipEvents: machine.replay };
})();

function historicalAdjacency(state) {
  const graph = new Map();
  const add = (a, b) => { if (!graph.has(a)) graph.set(a, new Set()); graph.get(a).add(b); };
  for (const reference of state.references) {
    if (!state.members[reference.issuer] || !state.members[reference.subject]) continue;
    add(reference.issuer, reference.subject); add(reference.subject, reference.issuer);
  }
  return graph;
}
export function findHistoricalReferencePath(state, fromInput, toInput, maxHops = MAX_ELECTORATE_HOPS) {
  const from = identity(fromInput), to = identity(toInput);
  if (!Number.isInteger(maxHops) || maxHops < 0 || maxHops > MAX_ELECTORATE_HOPS) throw new Error('INVALID_HOP_LIMIT');
  if (from === to) return [from];
  const graph = historicalAdjacency(state), queue = [{ id: from, distance: 0 }], parent = new Map([[from, null]]);
  while (queue.length) {
    const current = queue.shift(); if (current.distance >= maxHops) continue;
    for (const next of [...(graph.get(current.id) ?? [])].sort()) {
      if (parent.has(next)) continue; parent.set(next, current.id);
      if (next === to) { const path = []; for (let at = to; at !== null; at = parent.get(at)) path.push(at); return path.reverse(); }
      queue.push({ id: next, distance: current.distance + 1 });
    }
  }
  return null;
}
export function calculateSixHopElectorate(state, subjectInput) {
  const subject = identity(subjectInput), graph = historicalAdjacency(state), queue = [{ id: subject, distance: 0 }], distance = new Map([[subject, 0]]);
  while (queue.length) {
    const current = queue.shift(); if (current.distance >= MAX_ELECTORATE_HOPS) continue;
    for (const next of [...(graph.get(current.id) ?? [])].sort()) if (!distance.has(next)) { distance.set(next, current.distance + 1); queue.push({ id: next, distance: current.distance + 1 }); }
  }
  return Object.freeze([...distance.entries()].filter(([id, hops]) => id !== subject && hops <= MAX_ELECTORATE_HOPS && state.members[id]?.status === 'ACTIVE').map(([id, hops]) => ({ identity: id, hops })).sort((a, b) => a.hops - b.hops || a.identity.localeCompare(b.identity)));
}
