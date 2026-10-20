import { createHash } from 'node:crypto';
import { Wallet } from 'ethers';
import {
  BASE_SEPOLIA_CHAIN_ID,
  FINALIZED_EVIDENCE_VERSION,
  membershipAuthorizationHash,
  signMembershipEvent,
  verifyFinalizedOrdering,
} from '../../packages/membership-gate-f/src/index.mjs';
import { makeMembershipEvent } from '../../packages/membership-state/src/index.mjs';
import { hashReference, portableSignatureMessage, validateReference } from '../../packages/trust-protocol/src/index.ts';

export const gateHNetworkId = 'baarne:m1-gate-h-test';
export const gateHSchemaUid = gateHToken('schema');
export const gateHExpected = Object.freeze({ chainId: BASE_SEPOLIA_CHAIN_ID, networkId: gateHNetworkId, schemaUid: gateHSchemaUid });
export const gateHWallets = [31, 32, 33, 34, 35, 36].map(value => new Wallet(`0x${value.toString(16).padStart(64, '0')}`));
export const gateHFounders = gateHWallets.slice(0, 3);
export const gateHCandidate = gateHWallets[3];
export const gateHIdentity = wallet => `evm-eoa:${wallet.address.toLowerCase()}`;

export function gateHToken(label) { return `0x${createHash('sha256').update(`BAARNE GATE H ${label}`).digest('hex')}`; }
export function gateHBlock(number) { return Object.freeze({ number, hash: gateHToken(`block:${number}`), timestamp: 2_000 + number }); }
export function gateHGenesis() {
  return {
    genesisVersion: 'BAARNE_MEMBERSHIP_GENESIS_V1', stateMachineVersion: 'BAARNE_MEMBERSHIP_STATE_V1',
    networkId: gateHNetworkId, createdAt: 2_000, founderInvitationClosesAt: 9_000,
    founders: gateHFounders.map(gateHIdentity),
  };
}
async function signEvent(event, wallet, label) {
  return { event, authorization: await signMembershipEvent(event, {
    signer: gateHIdentity(wallet), nonce: gateHToken(`nonce:${label}`), signMessage: message => wallet.signMessage(message),
  }) };
}
async function reference(issuer, subject, issuedAt, label) {
  const record = validateReference({
    protocolVersion: '0.1', recordType: 'BAARNE_REFERENCE_V1', issuer: gateHIdentity(issuer), subject,
    issuedAt, expiresAt: null, nonce: gateHToken(`reference:${label}`), revocable: true, metadataHash: null,
  });
  const recordHash = await hashReference(record);
  return { record, authorization: {
    signatureType: 'BAARNE_SIGNATURE_V1', signatureVersion: '1', identityMethod: 'evm-eoa',
    signatureMethod: 'eip191-personal-sign-v1', signer: gateHIdentity(issuer), recordHash,
    signature: (await issuer.signMessage(await portableSignatureMessage(record))).toLowerCase(),
  } };
}
export function gateHEvidence(material, blockNumber, transactionIndex = 0, logIndex = 0) {
  return {
    authorizationHash: membershipAuthorizationHash(material.authorization),
    attestationUid: gateHToken(`uid:${blockNumber}:${transactionIndex}:${logIndex}`),
    blockHash: gateHBlock(blockNumber).hash, blockNumber, blockTimestamp: gateHBlock(blockNumber).timestamp,
    chainId: BASE_SEPOLIA_CHAIN_ID, eventId: material.event.eventId, evidenceVersion: FINALIZED_EVIDENCE_VERSION,
    logIndex, networkId: gateHNetworkId, schemaUid: gateHSchemaUid,
    transactionHash: gateHToken(`tx:${blockNumber}:${transactionIndex}`), transactionIndex,
  };
}
export function gateHProviderViews(logs, finalizedNumber, secondLogs = logs) {
  const numbers = [...new Set([finalizedNumber, ...logs.map(log => log.blockNumber), ...secondLogs.map(log => log.blockNumber)])];
  const blocks = numbers.map(gateHBlock);
  return [
    { providerId: 'gate-h-rpc-a', chainId: BASE_SEPOLIA_CHAIN_ID, finalizedBlock: gateHBlock(finalizedNumber), blocks, logs },
    { providerId: 'gate-h-rpc-b', chainId: BASE_SEPOLIA_CHAIN_ID, finalizedBlock: gateHBlock(finalizedNumber), blocks: [...blocks].reverse(), logs: [...secondLogs].reverse() },
  ];
}

export async function buildGateHFixture() {
  const materials = [], logs = [];
  const push = async (event, signer, number, label, transactionIndex = 0, logIndex = 0) => {
    const material = await signEvent(event, signer, label);
    materials.push(material); logs.push(gateHEvidence(material, number, transactionIndex, logIndex)); return material;
  };
  const candidate = gateHIdentity(gateHCandidate);
  const invitationId = gateHToken('candidate-invitation');
  const pendingInvitationId = gateHToken('pending-invitation');
  const applicationId = gateHToken('candidate-application');
  await push(makeMembershipEvent(gateHNetworkId, 'FOUNDER_INVITATION_ISSUED', 10, {
    invitationId, founder: gateHIdentity(gateHFounders[0]), candidate,
  }), gateHFounders[0], 300, 'invite-candidate');
  await push(makeMembershipEvent(gateHNetworkId, 'FOUNDER_INVITATION_ISSUED', 11, {
    invitationId: pendingInvitationId, founder: gateHIdentity(gateHFounders[1]), candidate: gateHIdentity(gateHWallets[4]),
  }), gateHFounders[1], 301, 'invite-pending');
  await push(makeMembershipEvent(gateHNetworkId, 'APPLICATION_OPENED', 12, { applicationId, candidate, invitationId }), gateHCandidate, 302, 'application');
  for (let index = 0; index < 3; index += 1) {
    const reservationId = gateHToken(`reservation:${index}`);
    const reserveBlock = 303 + index * 2;
    const referenceBlock = reserveBlock + 1;
    await push(makeMembershipEvent(gateHNetworkId, 'REFERENCE_SLOT_RESERVED', 20 + index, {
      reservationId, issuer: gateHIdentity(gateHFounders[index]), slot: 0, applicationId,
    }), gateHFounders[index], reserveBlock, `reserve-${index}`);
    const signedReference = await reference(gateHFounders[index], candidate, gateHBlock(referenceBlock).timestamp, `issuer-${index}`);
    await push(makeMembershipEvent(gateHNetworkId, 'REFERENCE_RECORDED', 30 + index, {
      reservationId, applicationId, reference: signedReference,
    }), gateHFounders[index], referenceBlock, `record-${index}`);
  }
  await push(makeMembershipEvent(gateHNetworkId, 'MEMBERSHIP_ACTIVATED', 40, { applicationId, candidate }), gateHCandidate, 309, 'activate');
  await push(makeMembershipEvent(gateHNetworkId, 'GENESIS_CLOSED', 41, {}), gateHFounders[0], 310, 'unsupported-close');
  await push(makeMembershipEvent(gateHNetworkId, 'FOUNDER_INVITATION_ISSUED', 42, {
    invitationId: gateHToken('post-close-invitation'), founder: gateHIdentity(gateHFounders[2]), candidate: gateHIdentity(gateHWallets[5]),
  }), gateHFounders[2], 311, 'post-close-invite');
  await push(makeMembershipEvent(gateHNetworkId, 'MEMBERSHIP_ACTIVATED', 43, { applicationId, candidate }), gateHCandidate, 312, 'duplicate-activation');
  const providerViews = gateHProviderViews(logs, 312);
  const ordering = verifyFinalizedOrdering(providerViews, materials, gateHExpected);
  if (ordering.status !== 'FINALIZED') throw new Error(`FIXTURE_ORDERING_${ordering.status}`);
  return Object.freeze({ genesis: gateHGenesis(), expected: gateHExpected, materials: Object.freeze(materials), logs: Object.freeze(logs), providerViews: Object.freeze(providerViews), entries: ordering.entries });
}
