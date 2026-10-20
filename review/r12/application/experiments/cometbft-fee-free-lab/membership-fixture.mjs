import {generateKeyPairSync, sign, randomBytes} from 'node:crypto';
import {Wallet} from 'ethers';
import {canonical, digest} from './application.mjs';
import {MEMBERSHIP_DOMAIN} from './membership.mjs';
import {makeMembershipEvent} from '../../packages/membership-state/src/index.mjs';
import {hashReference, portableSignatureMessage, validateReference} from '../../packages/trust-protocol/src/index.ts';

export async function fixture(createdAt=1000) {
  const people = Array.from({length:5}, () => {
    const wallet = Wallet.createRandom(), pair = generateKeyPairSync('ed25519');
    return {wallet, identity:'evm-eoa:' + wallet.address.toLowerCase(), ...pair,
      publicHex:pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex')};
  });
  const networkId = 'baarne:fee-free-membership-lab';
  const config = {domain:MEMBERSHIP_DOMAIN, membership:{genesisVersion:'BAARNE_MEMBERSHIP_GENESIS_V1',
    stateMachineVersion:'BAARNE_MEMBERSHIP_STATE_V1', networkId, createdAt,
    founderInvitationClosesAt:createdAt+4000, founders:people.slice(0,3).map(p => p.identity)},
    signers:Object.fromEntries(people.map(p => [p.identity,p.publicHex]))};
  const token = label => '0x' + digest(label);
  function tx(type, payload, who, changes={}) {
    const event = makeMembershipEvent(networkId, type, 999999, payload);
    const body = {domain:MEMBERSHIP_DOMAIN, genesisHash:digest(config), signer:who.identity,
      nonce:randomBytes(16).toString('hex'), event, ...changes};
    return canonical({body,id:digest(body),signature:sign(null,Buffer.from(canonical(body)),who.privateKey).toString('hex')});
  }
  const [a,b,c,d,e] = people, invitationId=token('invite'), applicationId=token('application');
  const txs = [tx('FOUNDER_INVITATION_ISSUED',{invitationId,founder:a.identity,candidate:d.identity},a),
    tx('FOUNDER_INVITATION_ISSUED',{invitationId:token('pending'),founder:b.identity,candidate:e.identity},b),
    tx('APPLICATION_OPENED',{applicationId,candidate:d.identity,invitationId},d)];
  for (const [i,p] of [a,b,c].entries()) {
    const reservationId=token('reserve'+i);
    txs.push(tx('REFERENCE_SLOT_RESERVED',{reservationId,issuer:p.identity,slot:0,applicationId},p));
    const record=validateReference({protocolVersion:'0.1',recordType:'BAARNE_REFERENCE_V1',issuer:p.identity,
      subject:d.identity,issuedAt:createdAt+10,expiresAt:null,nonce:token('reference'+i),revocable:true,metadataHash:null});
    const authorization={signatureType:'BAARNE_SIGNATURE_V1',signatureVersion:'1',identityMethod:'evm-eoa',
      signatureMethod:'eip191-personal-sign-v1',signer:p.identity,recordHash:await hashReference(record),
      signature:(await p.wallet.signMessage(await portableSignatureMessage(record))).toLowerCase()};
    txs.push(tx('REFERENCE_RECORDED',{reservationId,applicationId,reference:{record,authorization}},p));
  }
  txs.push(tx('MEMBERSHIP_ACTIVATED',{applicationId,candidate:d.identity},d));
  const blocks=[{height:1,time:createdAt+10,txs}];
  return {people,config,tx,token,txs,blocks,applicationId,invitationId};
}

