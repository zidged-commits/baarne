// Controlled synthetic crash fixture. Public metadata only on stdout.
import {createInterface} from 'node:readline';
import {runHubOperator} from '../../apps/hub/operator-provider.mjs';
const [providerDirectory,providerPin,controlPin,cutAt,recover]=process.argv.slice(2);
let armed=false,latest,app;
const emit=value=>console.log(JSON.stringify(value));
try{
  app=await runHubOperator({mode:'ISOLATED_SYNTHETIC_LAB',providerDirectory,providerPin,controlPin,recover:recover==='recover',
    onDurableState:state=>{latest=state;emit({event:'CHECKPOINT',...state});},
    faultHook:async step=>{if(armed&&step===cutAt){emit({event:'CUT',...latest});await new Promise(()=>{});}}});
  emit({event:'READY',url:app.url,...app.health()});
  const lines=createInterface({input:process.stdin});for await(const line of lines){
    if(line==='arm'){armed=true;emit({event:'ARMED'});}
    if(line==='stop'){emit({event:'STOPPED',...await app.stop()});break;}
  }
  lines.close();await app.stop();
}catch(error){emit({event:'ERROR',error:/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:error.code??'RECOVERY_REJECTED'});process.exitCode=1;}
