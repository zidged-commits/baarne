import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySyntheticArchive } from './core-portable-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function restoreSyntheticArchive(source, destination, trustedPackageHash) {
  const original = resolve(source), target = resolve(destination);
  const baseline = await verifySyntheticArchive(original, trustedPackageHash);
  const manifestBytes = await readFile(join(original, 'package.json'));
  if (hash(manifestBytes) !== trustedPackageHash) throw new Error('SOURCE_CHANGED_DURING_RESTORE');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  // This exclusively reserves a new root. Never delete or replace an existing destination.
  await mkdir(target);
  for (const name of Object.keys(manifest.files).sort()) {
    const bytes = await readFile(join(original, name));
    if (hash(bytes) !== manifest.files[name]) throw new Error('SOURCE_CHANGED_DURING_RESTORE');
    await mkdir(dirname(join(target, name)), { recursive: true });
    await writeFile(join(target, name), bytes, { flag: 'wx' });
  }
  // A partial copy has no package manifest and cannot pass verification.
  await writeFile(join(target, 'package.json'), manifestBytes, { flag: 'wx' });
  const restored = await verifySyntheticArchive(target, trustedPackageHash);
  if (JSON.stringify(restored) !== JSON.stringify(baseline)) throw new Error('RESTORED_REPLAY_MISMATCH');
  return { ...restored, status: 'SYNTHETIC_ARCHIVE_RESTORED', existingDestinationOverwritten: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, trustedHash, ...extra] = process.argv.slice(2);
  try {
    if (!source || !destination || !trustedHash || extra.length) throw new Error('USAGE: SOURCE NEW_DESTINATION TRUSTED_PACKAGE_HASH');
    console.log(JSON.stringify(await restoreSyntheticArchive(source, destination, trustedHash)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
