import {randomUUID} from 'node:crypto';
import {LabApplication} from './application.mjs';
import {parseObserverNodeNames,validateObserverRpcRequest,validateObserverRpcResponse} from './observer-config.mjs';
import {readBoundedWorkerLines} from './worker-stdio.mjs';
import {MAX_OBSERVER_RECORD_BYTES,parseUniqueObserverJson,readBoundedObserverJson,requireObserverJsonContentType,writeBoundedObserverResponse} from './observer-stdio.mjs';
const names=parseObserverNodeNames(process.argv[2]);
// Offline replay packets already use a 16 MiB file limit; keep observer stdin
// within that same bound while allowing real multi-block synthetic histories.
for await(const rawLine of readBoundedWorkerLines(process.stdin,{maxBytes:MAX_OBSERVER_RECORD_BYTES,errorCode:'OBSERVER_INPUT_TOO_LARGE'})){
  try{
    const line=new TextDecoder('utf8',{fatal:true}).decode(rawLine);
    const q=parseUniqueObserverJson(line);let result;
    if(q.operation==='replay'){
      if(q.genesis.config?.domain==='BAARNE_SYNTHETIC_LIFECYCLE_V3'){
        const {createLifecycle,applyLifecycleBlock,lifecycleView}=await import('./lifecycle-v3.mjs');
        const engine=await createLifecycle(q.genesis.config,q.genesis.bootstrap),hashes=[],results=[];
        for(const {block} of q.blocks){const row=await applyLifecycleBlock(engine,{height:Number(block.header.height),time:Math.floor(Date.parse(block.header.time)/1000),txs:(block.data.txs??[]).map(x=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(x,'base64')))});hashes.push(lifecycleView(engine).appHash);results.push(row.map(r=>({code:r.status==='REJECTED'?1:0})));}
        result={hashes,results,state:lifecycleView(engine).document};await writeBoundedObserverResponse({ok:true,result});continue;
      }
      if(q.genesis.domain==='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2'){
        const {createRecoverableExecution,applyRecoverableBlock,executionView}=await import('./membership-recovery.mjs');
        const engine=createRecoverableExecution(q.genesis),hashes=[],results=[];
        for(const {block} of q.blocks){const row=await applyRecoverableBlock(engine,{height:Number(block.header.height),
          time:Math.floor(Date.parse(block.header.time)/1000),txs:(block.data.txs??[]).map(x=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(x,'base64')))});
          hashes.push(executionView(engine).appHash);results.push(row.map(r=>({code:['ACCEPTED','RECOVERED','DUPLICATE'].includes(r.status)?0:1})));}
        const view=executionView(engine);result={hashes,results,state:view.document,info:{height:engine.height,stateHash:view.appHash,acceptedCount:engine.accepted.size}};
        await writeBoundedObserverResponse({ok:true,result});continue;
      }
      const Application=q.genesis.domain==='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2'?
        (await import('./membership-recovery.mjs')).RecoverableMembershipApplication:
        q.membership?(await import('./membership.mjs')).MembershipLabApplication:LabApplication;
      const app=await Application.create('/tmp/replay-'+randomUUID(),q.genesis);
      const hashes=[],results=[];
      for(const block of q.blocks){const txs=(block.block.data.txs??[]).map(x=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(x,'base64')));
        const staged=q.membership?await app.stageBlock(Number(block.block.header.height),Math.floor(Date.parse(block.block.header.time)/1000),txs):app.stageBlock(Number(block.block.header.height),txs);
        results.push(staged.results);await app.commit();hashes.push(staged.stateHash);}
      result={hashes,results,info:app.info(),state:app.exportState()};
    }else{
      validateObserverRpcRequest(q);
      const r=await fetch('http://'+names[q.node]+':26657',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:q.method,params:q.params??{}}),signal:AbortSignal.timeout(3000)});
      try{
        if(!r.ok)throw Error('HTTP_'+r.status);
        if(q.operation==='discardResponse'){
          await r.body?.cancel();result={status:'UNKNOWN',reason:'RESPONSE_DISCARDED_AFTER_HEADERS'};
        }else{requireObserverJsonContentType(r.headers);const d=validateObserverRpcResponse(await readBoundedObserverJson(r));if(d.error)throw Error(JSON.stringify(d.error));result=d.result;}
      }finally{
        if(r.body&&!r.bodyUsed){try{await r.body.cancel();}catch{}}
      }
    }
    await writeBoundedObserverResponse({ok:true,result});
  }catch(e){await writeBoundedObserverResponse({ok:false,error:e.message});}
}
