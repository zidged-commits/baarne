import {mkdir} from 'node:fs/promises';

// POSIX honors this mode at creation; Windows continues to rely on its ACL defaults.
export async function createPrivateDirectory(path){
  await mkdir(path,{mode:0o700});
}
