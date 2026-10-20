// Windows CurrentUser DPAPI rehearsal using synthetic test-generated secrets only.
// Same-user malware/admin/memory access remains outside this boundary.
import {spawnSync} from 'node:child_process';
import {digest} from './application.mjs';import {exact} from './lifecycle-v3.mjs';
const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;
$r=[Console]::In.ReadToEnd() | ConvertFrom-Json;
if ($r.mode -ne 'ISOLATED_SYNTHETIC_LAB') { throw 'LAB_SCOPE_REQUIRED' };
$data=[Convert]::FromBase64String($r.data); $entropy=[Convert]::FromBase64String($r.entropy);
try { if ($r.operation -eq 'protect') { if ($data.Length -ne 32) { throw 'INVALID_SECRET' }; $out=[Security.Cryptography.ProtectedData]::Protect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
elseif ($r.operation -eq 'unprotect') { $out=[Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); if ($out.Length -ne 32) { throw 'INVALID_SECRET' } }
else { throw 'INVALID_OPERATION' }; [Console]::Out.Write([Convert]::ToBase64String($out)) }
finally { [Array]::Clear($data,0,$data.Length); if ($out) { [Array]::Clear($out,0,$out.Length) } }`;
function context(input){exact(input,['mode','network','account','role']);
  if(input.mode!=='ISOLATED_SYNTHETIC_LAB'||typeof input.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(input.network)||typeof input.account!=='string'||!/^[0-9a-f]{64}$/.test(input.account)||!['VAULT_ENCRYPTION','OWNER_SIGNING'].includes(input.role))throw Error('INVALID_KEY_CONTEXT');return digest({version:'BAARNE_DPAPI_LAB_V1',...input});}
function transform(operation,data,scope){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const entropy=Buffer.from(context(scope),'hex').toString('base64');
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({mode:scope.mode,operation,data,entropy}),encoding:'utf8',timeout:10000,maxBuffer:32768,windowsHide:true});
  if(r.status!==0||r.error||!r.stdout||r.stdout.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.stdout))throw Error('DPAPI_OPERATION_FAILED');return r.stdout;
}
export function protectLabSecret(secret,scope){if(!Buffer.isBuffer(secret)||secret.length!==32)throw Error('INVALID_LAB_SECRET');return transform('protect',secret.toString('base64'),scope);}
export function unprotectLabSecret(blob,scope){if(typeof blob!=='string'||blob.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(blob))throw Error('INVALID_PROTECTED_BLOB');const secret=Buffer.from(transform('unprotect',blob,scope),'base64');if(secret.length!==32){secret.fill(0);throw Error('INVALID_LAB_SECRET');}return secret;}
