// Offline source-review package, not a production installer or dependency updater.
import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const NOTICES=['ethers','@adraffy/ens-normalize','@noble/curves','@noble/hashes','aes-js','tslib','ws','@types/node'];
const DOCUMENTS=['LICENSE','LICENSING.md','LICENSES/CC-BY-SA-4.0.txt','THIRD_PARTY_NOTICES.md',
  'docs/M1_FREEZE_SOURCE_MANIFEST.json','docs/governance/BAARNE_MANIFESTO.md',
  'docs/AI_HANDOFF/CONSTITUTION_INVARIANTS.md','docs/TRUST_PROTOCOL_V0.1.md',
  'docs/M1_FREEZE_REPORT.md','docs/M1_GATE_F_REPORT.md','docs/M1_GATE_H_REPORT.md',
  'packages/membership-state/README.md','docs/permanence/BAARNE_PERMANENCE_KIT_SPEC.md',
  'docs/BAARNE_RELATED_WORK_AND_DIGITAL_MONUMENT_RESEARCH_2026-10-16.md',
  'docs/permanence/MONUMENT_READ_ME_FIRST.md',
  'docs/release/OPERATOR_RUNBOOK.md','docs/release/OPERATOR_CLOSED_DEFAULTS.json'];
async function readSource(path){
  const absolute=resolve(ROOT,path);
  if(!absolute.startsWith(ROOT+'\\')&&!absolute.startsWith(ROOT+'/'))throw Error('SOURCE_OUTSIDE_REPOSITORY');
  const info=await lstat(absolute);
  if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)throw Error('INVALID_REVIEW_SOURCE');
  return readFile(absolute);
}
export async function buildV1ReviewPackage(destination){
  const candidate=JSON.parse(await readSource('docs/release/V1_CANDIDATE.json'));
  if(!/^docs\/evidence\/release-candidate-k[0-9]+\/SOURCE_MANIFEST(?:_R[0-9]+)?\.json$/.test(candidate.sourceSnapshot))throw Error('INVALID_CANDIDATE_SNAPSHOT');
  const snapshot=JSON.parse(await readSource(candidate.sourceSnapshot));
  if(candidate.sourceAggregateSha256!==snapshot.aggregateSha256)throw Error('CANDIDATE_PIN_MISMATCH');
  const sources=[];
  for(const source of snapshot.files){
    if(source.path.split('/').some(part=>part==='.'||part==='..'))throw Error('INVALID_SOURCE_PATH');
    if(!/^(?:apps|packages|experiments|scripts|tests)\/[A-Za-z0-9_@.\/-]+\.(?:mjs|ts|py|go|html|css|json)$/.test(source.path)&&!['package.json','package-lock.json'].includes(source.path))throw Error('REVIEW_SOURCE_NOT_ALLOWLISTED');
    const bytes=await readSource(source.path);
    if(bytes.length!==source.bytes||sha(bytes)!==source.sha256)throw Error('CANDIDATE_SOURCE_DRIFT');
    sources.push({source:source.path,bytes});
  }
  const aggregate=sha(snapshot.files.map(f=>f.sha256+'  '+f.path+'\n').sort().join(''));
  if(aggregate!==snapshot.aggregateSha256)throw Error('CANDIDATE_AGGREGATE_MISMATCH');
  const root=resolve(destination);await mkdir(root); // Never merge/overwrite.
  const files={},origins={};
  const put=async(path,bytes,source)=>{
    await mkdir(dirname(join(root,path)),{recursive:true});
    await writeFile(join(root,path),bytes,{flag:'wx'});
    files[path]={sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};
    if(source)origins[path]=source;
  };
  const copy=async(source,target=source)=>put(target,await readSource(source),source);
  for(const entry of sources){
    const target=entry.source==='package.json'?'source-metadata/repository-package.json':entry.source==='package-lock.json'?'source-metadata/repository-lock.json':entry.source;
    await put(target,entry.bytes,entry.source);
  }
  for(const path of DOCUMENTS)if(!Object.hasOwn(files,path))await copy(path);
  await copy('node_modules/ethers/dist/ethers.js','node_modules/ethers/ethers.js');
  await copy('node_modules/ethers/dist/ethers.js.map','node_modules/ethers/ethers.js.map');
  // Preserve the upstream location too, used by the existing capsule builder.
  await copy('node_modules/ethers/dist/ethers.js');
  await copy('node_modules/ethers/dist/ethers.js.map');
  const metadata=JSON.parse(await readSource('node_modules/ethers/package.json'));
  if(metadata.version!=='6.17.0')throw Error('UNREVIEWED_ETHERS_VERSION');
  await put('node_modules/ethers/package.json',JSON.stringify({name:'ethers',version:metadata.version,
    license:metadata.license,type:'module',exports:'./ethers.js',private:true})+'\n');
  const ts=JSON.parse(await readSource('node_modules/typescript/package.json'));
  if(ts.version!=='5.8.3')throw Error('UNREVIEWED_TYPESCRIPT_VERSION');
  await copy('node_modules/typescript/lib/typescript.js');
  // Parser API only. No tsc/tsserver CLI or install-time hooks are provided.
  await put('node_modules/typescript/package.json',JSON.stringify({name:'typescript',version:ts.version,
    license:ts.license,main:'./lib/typescript.js',private:true})+'\n');
  for(const name of NOTICES){
    const prefix=`node_modules/${name}`;
    await copy(`${prefix}/package.json`,`vendor-notices/${name}/package.json`);
    if(name!=='ethers')await copy(`${prefix}/package.json`);
    const notices=(await readdir(join(ROOT,prefix))).filter(n=>/^(?:licen[cs]e|notice|copying|copyright)/i.test(n)).sort();
    if(!notices.length)throw Error('MISSING_VENDOR_NOTICE');
    for(const notice of notices){
      await copy(`${prefix}/${notice}`,`vendor-notices/${name}/${notice}`);
      await copy(`${prefix}/${notice}`);
    }
  }
  for(const notice of ['LICENSE.txt','ThirdPartyNoticeText.txt']){
    await copy(`node_modules/typescript/${notice}`);
    await copy(`node_modules/typescript/${notice}`,`vendor-notices/typescript/${notice}`);
  }
  await copy('node_modules/typescript/package.json','vendor-notices/typescript/package.json');
  await put('package.json',JSON.stringify({name:'baarne-v1-isolated-synthetic-review',private:true,type:'module',
    engines:{node:'>=24.19.0 <25'},scripts:{'hub:demo':'node apps/hub/server.mjs','hub:private':'node apps/hub/private-server.mjs'}},null,2)+'\n');
  await put('README_REVIEW.md',`# Isolated synthetic source-review package\n\nUse the pinned Node 24.22.0 from the separate engineering kit; no npm install/ci is needed. No remote, real data or production launch is authorized.\n\nOnly ethers' unmodified self-contained ESM distribution and TypeScript's unmodified parser library execute here. Other package.json/license files are notice metadata for the preservation builder, not installed executable dependencies. The original root package/lock is under source-metadata and is not the installation manifest. M2, Hardhat and SnarkJS are absent.\n\nThe historical Hub entry remains a fictional demo. The opt-in private client entry is node apps/hub/private-server.mjs NEW_SYNTHETIC_DIRECTORY and prints a /private.html loopback URL. Two independent owner key providers sign their requests. No production entry, real-user enrollment, remote TLS or OS/hardware custody is enabled. By default this Windows lab keeps service keys in session memory. The explicit startPrivateHub operatorKey/resumePin API supports encrypted clean-stop checkpoints and closed backup/restore with an externally held synthetic key and trusted pins. It preserves the same origin; crash/uncertain stops fail closed for review. The opt-in apps/hub/operator-cli.mjs init/status/run/recover/backup/restore commands use a synthetic-only CurrentUser DPAPI provider, kept outside the workspace and byte backup. Provider and Control V2 pins are required; health and stop use local stdin, with no public administration port. Pinned encrypted intents support explicit zero/one signed-tail recovery; unknown history or partial unacknowledged enrollment stays unavailable. Storage reserve/quota halts persist. This cannot recover a lost Windows user/DPAPI context and is not production custody, global freshness or production permission. Read docs/release/OPERATOR_RUNBOOK.md and OPERATOR_CLOSED_DEFAULTS.json; C1-C4 remain closed. Encrypted browser owner backups do not back up the server encryption keys or profiles. CometBFT/Go/Python/Node binaries and images are not included or audited by this package. The parser library does not include tsc/tsserver. This is not a full build environment or production release.\n\nRead LICENSING.md, THIRD_PARTY_NOTICES.md and vendor-notices/typescript/ThirdPartyNoticeText.txt. Preserve all upstream notices; original software and prose retain the owner's AGPL-3.0-only / CC BY-SA 4.0 scope.\n\nREVIEW_MANIFEST.json records raw byte hashes; its SHA-256 must be obtained separately. A manifest cannot authenticate its own replacement.\n`);
  await put('REVIEW_PROVENANCE.json',JSON.stringify({version:'BAARNE_ISOLATED_NODE_REVIEW_V1',
    candidateId:candidate.candidateId,sourceSnapshot:candidate.sourceSnapshot,sourceAggregateSha256:aggregate,
    origins,executables:['ethers@6.17.0 bundled ESM','typescript@5.8.3 parser only'],
    bundledUpstream:['@adraffy/ens-normalize@1.11.1','@noble/curves@1.2.0','@noble/hashes@1.3.2','aes-js@4.0.0-beta.5'],
    noInstall:true,productionAuthorized:false,pilot:'NO-GO',
    nonNpmBinaryReviewComplete:false},null,2)+'\n');
  const manifest=JSON.stringify({version:'BAARNE_ISOLATED_REVIEW_MANIFEST_V1',files},null,2)+'\n';
  await writeFile(join(root,'REVIEW_MANIFEST.json'),manifest,{flag:'wx'});
  return {status:'LOCAL_ISOLATED_REVIEW_BUILT',manifestSha256:sha(manifest),fileCount:Object.keys(files).length,
    productionAuthorized:false,dependencyInstallPerformed:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3)throw Error('USAGE: node build-v1-review-package.mjs NEW_DIRECTORY');
    console.log(JSON.stringify(await buildV1ReviewPackage(process.argv[2])));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
