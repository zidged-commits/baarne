// Prepare public evidence from retained actual blocks, without restarting nodes.
// Results are semantically recomputed; Go will authenticate their result roots.
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {publicLifecycleProof,parsePublicLifecycleJson} from '../experiments/cometbft-fee-free-lab/public-lifecycle-evidence.mjs';
const [directory,output]=process.argv.slice(2),genesis=parsePublicLifecycleJson(await readFile(join(directory,'public-input.json'),'utf8')),raw=await readFile(join(directory,'public-blocks.json'),'utf8');
if(Buffer.byteLength(raw)>16*1024*1024)throw Error('INPUT_TOO_LARGE');
const outputRecord=await publicLifecycleProof({genesis,blocks:parsePublicLifecycleJson(raw)});
await writeFile(output,JSON.stringify(outputRecord),{flag:'wx'});
