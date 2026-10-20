// JSONL IPC behind the official Go ABCI server. No custom consensus/protobuf.
import {LabApplication, digest} from './application.mjs';
import {parseWorkerFrame} from './worker-protocol.mjs';
import {readBoundedWorkerLines} from './worker-stdio.mjs';
import {loadWorkerGenesis} from './worker-config.mjs';
const [directory,genesisFile]=process.argv.slice(2);
const genesis=await loadWorkerGenesis(genesisFile);
const app=await LabApplication.load(directory,genesis);
const decoder=new TextDecoder('utf8',{fatal:true});
const tx=encoded=>decoder.decode(Buffer.from(encoded,'base64'));
for await(const rawLine of readBoundedWorkerLines(process.stdin)) {
  let id;
  try {
    const line=decoder.decode(rawLine);
    const frame=parseWorkerFrame(line);
    id=frame.id;
    const q=frame.request; let result;
    switch(q.method) {
      case 'info': result=app.info(); break;
      case 'init':
        if(q.chainId!=='BAARNE_FEE_FREE_FINALITY_LAB_V1' || digest(JSON.parse(q.genesis))!==digest(genesis))throw Error('WRONG_GENESIS_SCOPE');
        result=app.info(); break;
      case 'check':
        try { result=app.checkIntent(tx(q.tx)); }
        catch { result={code:1,reason:'INVALID_UTF8_ENCODING'}; }
        break;
      case 'finalize': result=app.stageBlock(q.height,(q.txs??[]).map(tx));break;
      case 'commit': result=await app.commit();break;
      case 'query': result={info:app.info(),state:app.exportState()};break;
      default: throw Error('UNKNOWN_METHOD');
    }
    console.log(JSON.stringify({id,response:{ok:true,result}}));
  }catch(e){
    if(!Number.isSafeInteger(id)){console.error(`INVALID_IPC_FRAME ${e.message}`);process.exitCode=1;break;}
    console.log(JSON.stringify({id,response:{ok:false,error:e.message}}));
  }
}
