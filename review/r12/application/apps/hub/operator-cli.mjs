// Local operator stdin is the control channel; no public administrative port.
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {provisionHubOperator,runHubOperator,inspectHubOperator,backupHubOperator,restoreHubOperator} from './operator-provider.mjs';
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
const safeError=error=>({error:/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:error.code??'OPERATOR_TASK_FAILED',productionAuthorized:false});
export async function operatorMain(args){
  const [command,mode,providerDirectory,a,b,...rest]=args;
  if(command==='init'&&args.length===4)return output({event:'PROVISIONED',...await provisionHubOperator({mode,providerDirectory,workspace:a})});
  const options={mode,providerDirectory,providerPin:a,controlPin:b};
  if(command==='status'&&args.length===5)return output({event:'STATUS',...await inspectHubOperator(options)});
  if(command==='backup'&&args.length===6)return output({event:'BACKUP',...await backupHubOperator({...options,target:rest[0]})});
  if(command==='restore'&&args.length===8)return output({event:'RESTORED_UNVERIFIED',...await restoreHubOperator({...options,backupDirectory:rest[0],backupPin:rest[1],target:rest[2]})});
  if(!['run','recover'].includes(command)||args.length!==5)throw Error('USAGE_OPERATOR_INIT_STATUS_RUN_RECOVER_BACKUP_RESTORE_EXPLICIT_SYNTHETIC_MODE');
  const app=await runHubOperator({...options,recover:command==='recover',onDurableState:state=>output({event:'CHECKPOINT',...state})});let stop;
  const finish=()=>stop??=(async()=>{output({event:'STOPPED',...await app.stop()});})();
  const signals=[];for(const name of ['SIGINT','SIGTERM']){const handler=()=>{finish().catch(error=>{output(safeError(error));process.exitCode=1;}).finally(()=>process.stdin.destroy());};signals.push([name,handler]);process.once(name,handler);}
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  try{
    output({event:'READY',url:app.url,...app.health()});
    for await(const line of lines){
      if(line==='health')output({event:'HEALTH',...app.health()});
      else if(line==='stop'){await finish();break;}
      else output({error:'OPERATOR_COMMAND_REQUIRED_HEALTH_OR_STOP',productionAuthorized:false});
    }
    await finish();
  }finally{lines.close();for(const [name,handler] of signals)process.removeListener(name,handler);await app.stop();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))operatorMain(process.argv.slice(2)).catch(error=>{output(safeError(error));process.exitCode=1;});
