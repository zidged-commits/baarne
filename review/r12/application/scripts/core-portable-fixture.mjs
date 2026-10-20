// Operator rehearsal package. Fixture chain observations are never live evidence.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMembershipEventArchive } from '../packages/membership-archive/src/index.mjs';

import { syntheticArchiveInventory, verifySyntheticArchive } from './core-portable-verifier.mjs';
export { verifySyntheticArchive } from './core-portable-verifier.mjs';

const VERSION = 'BAARNE_PORTABLE_SYNTHETIC_ARCHIVE_V1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

export async function exportSyntheticArchive(destination) {
  const root = resolve(destination);
  // Exclusive directory creation: existing exports are never replaced or deleted.
  await mkdir(root);
  const { buildGateHFixture } = await import('../tests/helpers/m1-gate-h-fixture.mjs');
  const fixture = await buildGateHFixture();
  await writeMembershipEventArchive(join(root, 'archive'), fixture);
  for (const [name, value] of [['genesis.json', fixture.genesis], ['scope.json', fixture.expected], ['chain.json', fixture.providerViews]]) {
    await writeFile(join(root, name), JSON.stringify(value) + '\n', { flag: 'wx' });
  }
  const files = {};
  for (const name of await syntheticArchiveInventory(root)) files[name] = sha(await readFile(join(root, name)));
  const bytes = JSON.stringify({ version: VERSION, evidenceMode: 'SYNTHETIC_FIXTURE', files }, null, 2) + '\n';
  await writeFile(join(root, 'package.json'), bytes, { flag: 'wx' });
  return { status: 'SYNTHETIC_PACKAGE_EXPORTED', packageHash: sha(bytes), fileCount: Object.keys(files).length, livePilotAuthorized: false };
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, trustedHash, ...extra] = process.argv.slice(2);
  try {
    if (!directory || extra.length || (command === 'export' && trustedHash) || !['export', 'verify'].includes(command)) fail('USAGE: export NEW_DIRECTORY | verify DIRECTORY TRUSTED_HASH');
    const result = command === 'export' ? await exportSyntheticArchive(directory) : await verifySyntheticArchive(directory, trustedHash);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
