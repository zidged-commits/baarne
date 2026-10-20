// Windows kernel FileShare.None ownership; no stale PID lock reclamation.
import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {lstat} from 'node:fs/promises';
const program=`$ErrorActionPreference='Stop'; $p=([Console]::In.ReadLine() | ConvertFrom-Json).path;
try {$f=[IO.File]::Open($p,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);
if ($f.Length -ne 0) { throw 'INVALID_LOCK' }; [Console]::Out.WriteLine('LOCKED');[Console]::Out.Flush();[Console]::In.ReadLine() | Out-Null}
catch {[Console]::Out.WriteLine('FAILED');[Console]::Out.Flush();exit 1}
finally {if ($f) {$f.Dispose()}}`;
export async function acquireVaultLock(path){
  if(process.platform!=='win32')throw Error('WINDOWS_KERNEL_LOCK_REQUIRED');
  try{const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.size!==0)throw Error('INVALID_WRITER_LOCK');}catch(e){if(e.code!=='ENOENT')throw e;}
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',program],{stdio:['pipe','pipe','ignore'],windowsHide:true});
  const exited=new Promise(resolve=>child.once('close',resolve));let closed=false;
  const close=async()=>{if(!closed){closed=true;child.stdin.end();}await exited;};
  try{await new Promise((resolve,reject)=>{const rl=createInterface({input:child.stdout}),timer=setTimeout(()=>{child.kill();reject(Error('LOCK_TIMEOUT'));},10000);
      const finish=(error)=>{clearTimeout(timer);rl.close();child.stdout.resume();error?reject(error):resolve();};
      rl.once('line',line=>finish(line==='LOCKED'?null:Error('WRITER_ALREADY_OWNED_OR_INVALID_LOCK')));child.once('error',()=>finish(Error('LOCK_HELPER_UNAVAILABLE')));child.once('exit',()=>finish(Error('LOCK_HELPER_EXITED')));
      child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({path})+'\n');});
  }catch(e){child.stdin.end();await exited;throw e;}
  return {close,assertOwned:()=>{if(closed||child.exitCode!==null||child.signalCode!==null)throw Error('WRITER_OWNERSHIP_LOST');}};
}
