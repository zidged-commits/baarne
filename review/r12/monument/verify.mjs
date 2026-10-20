// Trust this bootstrap and obtain the capsule hash through a separate path.
// Hash all files BEFORE importing any preserved BAARNE/dependency code.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CAPSULE_VERSION = 'BAARNE_MONUMENT_SYNTHETIC_CAPSULE_V1';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(code); };
const safeName = name => typeof name === 'string' && name.length <= 240 &&
  /^[A-Za-z0-9_@.\/-]+$/.test(name) && name.split('/').every(p => p && p !== '.' && p !== '..');

export async function capsuleInventory(root) {
  const files = [], directories = [];
  let total = 0;
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('CAPSULE_DIRECTORY_REQUIRED');
  async function walk(prefix = '', depth = 0) {
    if (depth > 12) fail('CAPSULE_DEPTH_LIMIT');
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeName(name)) fail('CAPSULE_PATH_INVALID');
      if (files.length + directories.length >= 512) fail('CAPSULE_ENTRY_LIMIT');
      const info = await lstat(join(root, name));
      if (info.isSymbolicLink()) fail('CAPSULE_LINK_FORBIDDEN');
      if (info.isDirectory()) { directories.push(name); await walk(name, depth + 1); }
      else if (info.isFile()) {
        total += info.size;
        if (info.size > 8_000_000 || total > 32_000_000) fail('CAPSULE_SIZE_LIMIT');
        if (name !== 'CAPSULE.json') files.push(name);
      } else fail('CAPSULE_ENTRY_INVALID');
    }
  }
  await walk();
  return { files: files.sort(), directories: directories.sort() };
}

export async function verifyMonumentCapsule(directory, trustedHash) {
  if (typeof trustedHash !== 'string' || !/^[0-9a-f]{64}$/.test(trustedHash)) fail('CAPSULE_PIN_REQUIRED');
  const root = resolve(directory);
  const inventory = await capsuleInventory(root);
  const bytes = await readFile(join(root, 'CAPSULE.json'));
  if (sha256(bytes) !== trustedHash) fail('CAPSULE_PIN_MISMATCH');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'archiveHash,evidenceMode,files,version' ||
      manifest.version !== CAPSULE_VERSION || manifest.evidenceMode !== 'SYNTHETIC_FIXTURE' ||
      typeof manifest.archiveHash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.archiveHash) || !manifest.files ||
      typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('CAPSULE_MANIFEST_INVALID');
  const names = Object.keys(manifest.files).sort();
  const dirs = new Set();
  for (const name of names) {
    if (!safeName(name) || name === 'CAPSULE.json' || typeof manifest.files[name] !== 'string' ||
        !/^[0-9a-f]{64}$/.test(manifest.files[name])) fail('CAPSULE_MANIFEST_INVALID');
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  if (JSON.stringify(inventory.files) !== JSON.stringify(names) ||
      JSON.stringify(inventory.directories) !== JSON.stringify([...dirs].sort()) ||
      !['verify.mjs', 'package.json', 'READ-ME-FIRST.md', 'PROVENANCE.json',
        'history/package.json', 'source/scripts/core-portable-verifier.mjs', 'EXPECTED_REPLAY.json'].every(n => names.includes(n))) fail('CAPSULE_INVENTORY_MISMATCH');
  for (const name of names) {
    if (sha256(await readFile(join(root, name))) !== manifest.files[name]) fail('CAPSULE_CHECKSUM_MISMATCH');
  }
  const { verifySyntheticArchive } = await import(pathToFileURL(join(root, 'source/scripts/core-portable-verifier.mjs')).href);
  const replay = await verifySyntheticArchive(join(root, 'history'), manifest.archiveHash);
  const expected = JSON.parse(await readFile(join(root, 'EXPECTED_REPLAY.json'), 'utf8'));
  if (JSON.stringify(replay) !== JSON.stringify(expected)) fail('CAPSULE_REPLAY_MISMATCH');
  return { status: 'OFFLINE_MONUMENT_SYNTHETIC_VERIFIED', capsuleHash: trustedHash, replay,
    livePilotAuthorized: false, independentImplementation: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail('USAGE: node verify.mjs TRUSTED_CAPSULE_SHA256');
    console.log(JSON.stringify(await verifyMonumentCapsule(dirname(fileURLToPath(import.meta.url)), process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
