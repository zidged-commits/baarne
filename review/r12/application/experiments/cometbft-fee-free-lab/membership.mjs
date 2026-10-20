// Isolated semantic bridge. Input ordering/time is NOT a consensus certificate.
// Synthetic Ed25519 bindings below are not a production identity/recovery policy.
import {createPublicKey, verify} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical, digest, writeAtomic} from './application.mjs';
import {createMembershipStateMachine, initializeMembershipState, validateMembershipEvent,
  validateMembershipGenesis} from '../../packages/membership-state/src/index.mjs';
import {MEMBERSHIP_LAB_BLOCK_LIMIT,readMembershipLabStore,validateMembershipLabBlockBytes} from './membership-bounds.mjs';

export const MEMBERSHIP_DOMAIN = 'BAARNE_FEE_FREE_MEMBERSHIP_LAB_V1';
const exact = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) throw Error('INVALID_FIELDS');
};
function genesis(input) {
  exact(input, ['domain', 'membership', 'signers']);
  if (input.domain !== MEMBERSHIP_DOMAIN) throw Error('WRONG_DOMAIN');
  const membership = validateMembershipGenesis(input.membership);
  if (!input.signers || Array.isArray(input.signers) || Object.keys(input.signers).length < 3 ||
      Object.keys(input.signers).length > 16) throw Error('INVALID_SIGNERS');
  const keys = new Set();
  for (const [identity, key] of Object.entries(input.signers)) {
    if (!/^evm-eoa:0x[0-9a-f]{40}$/.test(identity) || /^evm-eoa:0x0+$/.test(identity) ||
        typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key) || keys.has(key)) throw Error('INVALID_SIGNERS');
    keys.add(key);
  }
  if (membership.founders.some(f => !Object.hasOwn(input.signers, f))) throw Error('UNBOUND_FOUNDER');
  return structuredClone(input);
}
function actor(event, state) {
  const p = event.payload;
  switch (event.eventType) {
    case 'FOUNDER_INVITATION_ISSUED': return p.founder;
    case 'APPLICATION_OPENED': case 'APPLICATION_CANCELLED': case 'MEMBERSHIP_ACTIVATED': return p.candidate;
    case 'REFERENCE_SLOT_RESERVED': case 'REFERENCE_SLOT_RELEASED': return p.issuer;
    case 'REFERENCE_RECORDED': return state.reservations[p.reservationId]?.issuer;
    case 'MEMBERSHIP_RESIGNED': return p.member;
    default: throw Error('UNSUPPORTED_POLICY');
  }
}
function decode(raw, config) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16384) throw Error('INVALID_SIZE');
  const tx = JSON.parse(raw);
  exact(tx, ['body', 'id', 'signature']);
  exact(tx.body, ['domain', 'genesisHash', 'signer', 'nonce', 'event']);
  const b = tx.body;
  if (canonical(tx) !== raw) throw Error('NONCANONICAL');
  if (b.domain !== MEMBERSHIP_DOMAIN || b.genesisHash !== digest(config)) throw Error('WRONG_SCOPE');
  const event = validateMembershipEvent(b.event);
  if (event.networkId !== config.membership.networkId) throw Error('WRONG_NETWORK');
  if (typeof b.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(b.nonce) ||
      typeof b.signer !== 'string' || !Object.hasOwn(config.signers, b.signer)) throw Error('INVALID_SIGNER_OR_NONCE');
  if (tx.id !== digest(b) || typeof tx.signature !== 'string' || !/^[0-9a-f]{128}$/.test(tx.signature)) throw Error('INVALID_SIGNATURE');
  const key = createPublicKey({key: Buffer.from('302a300506032b6570032100' + config.signers[b.signer], 'hex'), format: 'der', type: 'spki'});
  if (!verify(null, Buffer.from(canonical(b)), key, Buffer.from(tx.signature, 'hex'))) throw Error('INVALID_SIGNATURE');
  return tx;
}

// Replay starts from authentic supplied Genesis; never trusts a caller state snapshot.
// Block height/time provenance must be verified by a separate consensus adapter.
export async function replayMembershipLab(configInput, blocksInput) {
  const config = genesis(configInput), blocks = structuredClone(blocksInput);
  if (!Array.isArray(blocks) || blocks.length > MEMBERSHIP_LAB_BLOCK_LIMIT) throw Error('INVALID_BLOCKS');
  let state = initializeMembershipState(config.membership), previousTime = config.membership.createdAt;
  const accepted = new Map(), nonces = new Set(), results = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]; exact(block, ['height', 'time', 'txs']);
    validateMembershipLabBlockBytes(block);
    if (block.height !== index + 1 || !Number.isSafeInteger(block.time) || block.time < previousTime ||
        !Array.isArray(block.txs) || block.txs.length > 64) throw Error('INVALID_BLOCK_ORDER_OR_TIME');
    previousTime = block.time;
    const machine = createMembershipStateMachine({eventOrdering:'EXTERNAL_FINALIZED', resolveOccurredAt: () => block.time});
    const row = [];
    for (const raw of block.txs) {
      try {
        const tx = decode(raw, config), b = tx.body;
        if (accepted.has(tx.id)) { row.push({status:'DUPLICATE', id:tx.id}); continue; }
        if (nonces.has(b.signer + ':' + b.nonce)) throw Error('NONCE_ALREADY_USED');
        if (actor(b.event, state) !== b.signer) throw Error('UNAUTHORIZED_SIGNER');
        const result = await machine.applyEvent(state, b.event);
        row.push({status:result.status, id:tx.id});
        if (result.status === 'ACCEPTED') {
          state = result.state; accepted.set(tx.id, raw); nonces.add(b.signer + ':' + b.nonce);
        }
      } catch (e) { row.push({status:e.message}); }
    }
    results.push(row);
  }
  const document = {domain:MEMBERSHIP_DOMAIN, genesisHash:digest(config), height:blocks.length,
    time:previousTime, state, accepted:[...accepted.values()]};
  return {document, appHash:digest(document), results, evidenceMode:'UNAUTHENTICATED_ORDERED_LAB_INPUT', livePilotAuthorized:false};
}

export class MembershipLabApplication {
  #config; #blocks; #view; #pending; #directory; #busy=false;
  constructor(directory, config, blocks, view) {
    this.#directory=directory;this.#config=config;this.#blocks=blocks;this.#view=view;
  }
  static async create(directory, input) {
    const config=genesis(input), blocks=[], view=await replayMembershipLab(config,blocks);
    await mkdir(directory);await writeAtomic(directory,{domain:MEMBERSHIP_DOMAIN,genesisHash:digest(config),blocks});
    return new MembershipLabApplication(directory,config,blocks,view);
  }
  static async load(directory,input) {
    const config=genesis(input), raw=await readMembershipLabStore(join(directory,'state.json')), document=JSON.parse(raw);
    exact(document,['state','stateHash']);exact(document.state,['domain','genesisHash','blocks']);
    if(canonical(document)!==raw || document.stateHash!==digest(document.state) ||
       document.state.domain!==MEMBERSHIP_DOMAIN || document.state.genesisHash!==digest(config))throw Error('INVALID_STORE');
    const blocks=document.state.blocks,view=await replayMembershipLab(config,blocks);
    return new MembershipLabApplication(directory,config,blocks,view);
  }
  info() {return {height:this.#blocks.length,stateHash:this.#view.appHash,acceptedCount:this.#view.document.accepted.length};}
  exportState() {return structuredClone(this.#view.document);}
  checkIntent(raw) {
    try {decode(raw,this.#config);return {code:0};}catch(e){return {code:1,reason:e.message};}
  }
  async stageBlock(height,time,txs) {
    if(this.#pending||this.#busy)throw Error('COMMIT_REQUIRED');
    this.#busy=true;
    try {
      const block=structuredClone({height,time,txs}), blocks=[...this.#blocks,block];
      const view=await replayMembershipLab(this.#config,blocks);
      this.#pending={blocks,view};
      return {stateHash:view.appHash,results:view.results.at(-1).map(r=>({code:['ACCEPTED','DUPLICATE'].includes(r.status)?0:1,reason:r.status}))};
    }finally{this.#busy=false;}
  }
  async commit() {
    if(!this.#pending||this.#busy)throw Error('FINALIZE_REQUIRED');
    this.#busy=true;
    const pending=this.#pending;
    // Bridge owns a kernel flock and serializes IPC; no multiple-writer claim here.
    try {
      await writeAtomic(this.#directory,{domain:MEMBERSHIP_DOMAIN,genesisHash:digest(this.#config),blocks:pending.blocks});
      this.#blocks=pending.blocks;this.#view=pending.view;this.#pending=null;
      return this.info();
    }finally{this.#busy=false;}
  }
}
