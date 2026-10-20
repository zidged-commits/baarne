// One-destination adapter joining the durable notice outbox to a participant journal.
// Loopback receipts remain synthetic service acknowledgements, not consensus proofs.
import {canonical,digest} from './application.mjs';
import {verifySourceNotice} from './source-notice.mjs';

export function sourceNoticeActionId(entry){
  if(!entry||typeof entry.targetId!=='string'||!/^[0-9a-f]{64}$/.test(entry.targetId)||!entry.destination||!entry.notice)throw Error('INVALID_SOURCE_NOTICE_TARGET');
  return `source-notice:${entry.targetId}:${digest(entry.notice).slice(0,32)}`;
}

export function createSourceNoticeDelivery(client,url,{persistCheckpoint}={}){
  if(!client||typeof client.checkpoint!=='function'||typeof client.pendingRecord!=='function'||typeof client.pending!=='function'||typeof client.prepare!=='function'||typeof client.send!=='function'||typeof client.reconcile!=='function'||typeof client.resolvedCommand!=='function'||typeof url!=='string'||typeof persistCheckpoint!=='function')throw Error('INVALID_SOURCE_NOTICE_DELIVERY');
  return async entry=>{
    const checkpoint=client.checkpoint();
    if(entry.targetId!==digest(entry.destination)||canonical(entry.destination)!==canonical(checkpoint.scope))throw Error('SOURCE_NOTICE_DESTINATION_MISMATCH');
    verifySourceNotice(entry.notice,checkpoint.ownerKey,entry.destination,checkpoint.actorId);
    const expected={operation:'SOURCE_NOTICE',payload:{notice:entry.notice},actionId:sourceNoticeActionId(entry)};
    const resolved=client.resolvedCommand(expected);
    if(resolved){await persistCheckpoint(client.checkpoint());return {status:'APPLIED',receipt:resolved.commandId,at:entry.updatedAt};}

    if(client.pending()){
      const pending=client.pendingRecord();
      if(!pending||pending.body.operation!==expected.operation||pending.body.actionId!==expected.actionId||canonical(pending.body.payload)!==canonical(expected.payload))throw Error('PENDING_SOURCE_NOTICE_MISMATCH');
      await persistCheckpoint(client.checkpoint());
      const status=await client.reconcile(url);
      if(status.status==='APPLIED'){
        await persistCheckpoint(client.checkpoint());
        const applied=client.resolvedCommand(expected);
        if(!applied||applied.commandId!==digest(pending))throw Error('SOURCE_NOTICE_RECEIPT_MISMATCH');
        return {status:'APPLIED',receipt:applied.commandId,at:entry.updatedAt};
      }
      if(status.status==='IN_PROGRESS')return {status:'IN_PROGRESS',receipt:digest(pending),at:entry.updatedAt};
      if(status.status!=='NOT_APPLIED'||!client.pendingRecord()||digest(client.pendingRecord())!==digest(pending))throw Error('SOURCE_NOTICE_STATUS_UNRESOLVED');
    }else{
      await client.prepare(expected.operation,expected.payload,expected.actionId);
      await persistCheckpoint(client.checkpoint());
    }

    const pending=client.pendingRecord();
    if(!pending||pending.body.actionId!==expected.actionId||pending.body.operation!==expected.operation||canonical(pending.body.payload)!==canonical(expected.payload))throw Error('SOURCE_NOTICE_PENDING_CHANGED');
    const result=await client.send(url);
    await persistCheckpoint(client.checkpoint());
    if(result.status==='APPLIED'){
      const applied=client.resolvedCommand(expected);
      if(!applied||applied.commandId!==digest(pending))throw Error('SOURCE_NOTICE_RECEIPT_MISMATCH');
      return {status:'APPLIED',receipt:applied.commandId,at:entry.updatedAt};
    }
    return {status:result.status==='IN_PROGRESS'?'IN_PROGRESS':'UNKNOWN',receipt:digest(pending),at:entry.updatedAt};
  };
}

export async function deliverSourceNoticeTarget(outbox,targetId,client,url,sign,{persistCheckpoint},now=Math.floor(Date.now()/1000)){
  if(!outbox||typeof outbox.deliver!=='function')throw Error('INVALID_SOURCE_NOTICE_OUTBOX');
  return outbox.deliver(targetId,sign,createSourceNoticeDelivery(client,url,{persistCheckpoint}),now);
}

const resumableStatuses=new Set(['PENDING','UNKNOWN','UNAVAILABLE','IN_PROGRESS']);
const terminalStatuses=new Set(['APPLIED','NOT_APPLIED','REJECTED']);

function deliveryErrorCode(error){
  const code=typeof error?.code==='string'?error.code:error?.message;
  return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'DELIVERY_ABORTED';
}

// Explicitly invoked, sequential fan-out. Each target is independently
// checkpointed by the outbox and participant client; reopening and calling
// this again skips terminal targets and resumes only unresolved destinations.
export async function deliverPendingSourceNoticeTargets(outbox,resolveTarget,now=Math.floor(Date.now()/1000)){
  if(!outbox||typeof outbox.status!=='function'||typeof outbox.entry!=='function'||typeof outbox.deliver!=='function'||typeof resolveTarget!=='function'||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_SOURCE_NOTICE_FANOUT');
  const initial=outbox.status(),results=[];let stopped=false;
  for(const target of initial.targets){
    if(terminalStatuses.has(target.status)){
      results.push({targetId:target.targetId,status:target.status,attempts:target.attempts,skipped:true});
      continue;
    }
    if(stopped){results.push({targetId:target.targetId,status:'NOT_ATTEMPTED',attempts:target.attempts});continue;}
    if(!resumableStatuses.has(target.status)){
      results.push({targetId:target.targetId,status:'BLOCKED',attempts:target.attempts,code:'TARGET_NOT_RESUMABLE'});
      stopped=true;
      continue;
    }
    try{
      const entry=outbox.entry(target.targetId),binding=await resolveTarget(entry);
      if(!binding||typeof binding!=='object'||typeof binding.url!=='string'||typeof binding.sign!=='function'||typeof binding.persistCheckpoint!=='function')throw Error('INVALID_TARGET_BINDING');
      const result=await deliverSourceNoticeTarget(outbox,target.targetId,binding.client,binding.url,binding.sign,{persistCheckpoint:binding.persistCheckpoint},now);
      results.push({targetId:target.targetId,status:result.status,attempts:outbox.status().targets.find(item=>item.targetId===target.targetId)?.attempts??target.attempts});
    }catch(error){
      results.push({targetId:target.targetId,status:'BLOCKED',attempts:target.attempts,code:deliveryErrorCode(error)});
      stopped=true;
    }
  }
  const final=outbox.status();
  return {batchId:final.batchId,checkpoint:final.checkpoint,results};
}
