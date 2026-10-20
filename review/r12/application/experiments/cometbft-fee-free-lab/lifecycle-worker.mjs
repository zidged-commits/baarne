import {canonical} from './application.mjs';import {LifecycleAbci} from './lifecycle-abci.mjs';
import {parseWorkerFrame} from './worker-protocol.mjs';
import {readBoundedWorkerLines} from './worker-stdio.mjs';
import {loadWorkerGenesis} from './worker-config.mjs';
const [directory,file,mode]=process.argv.slice(2),input=await loadWorkerGenesis(file);
if(mode==='initialize'){await LifecycleAbci.create(directory,input);process.exit(0);}
const app=await LifecycleAbci.load(directory,input),decoder=new TextDecoder('utf8',{fatal:true});
for await(const rawLine of readBoundedWorkerLines(process.stdin)){
  let id;
  try{const frame=parseWorkerFrame(decoder.decode(rawLine));id=frame.id;const q=frame.request;let result;
    switch(q.method){
      case 'info':result=app.info();break;
      case 'init':if(q.chainId!=='BAARNE_FEE_FREE_FINALITY_LAB_V1'||canonical(JSON.parse(q.genesis))!==canonical(input))throw Error('WRONG_SCOPE');result=app.info();break;
      case 'check':try{result=await app.checkIntent(decoder.decode(Buffer.from(q.tx,'base64')));}catch{result={code:1,reason:'INVALID_UTF8_ENCODING'};}break;
      case 'finalize':result=await app.stageBlock(q.height,q.time,(q.txs??[]).map(x=>decoder.decode(Buffer.from(x,'base64'))));break;
      case 'commit':result=await app.commit();break;
      case 'query':result={info:app.info(),state:app.exportState()};break;
      default:throw Error('UNKNOWN_METHOD');
    }console.log(JSON.stringify({id,response:{ok:true,result}}));
  }catch(e){
    if(!Number.isSafeInteger(id)){console.error(`INVALID_IPC_FRAME ${e.message}`);process.exitCode=1;break;}
    console.log(JSON.stringify({id,response:{ok:false,error:e.message}}));
  }
}
