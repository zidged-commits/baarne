// Read-only verifier shared by the repository CLI and the offline capsule.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FilesystemMembershipArchive, recoverAndReplayMembershipHistory } from '../packages/membership-archive/src/index.mjs';

const VERSION = 'BAARNE_PORTABLE_SYNTHETIC_ARCHIVE_V1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = name => ['genesis.json', 'scope.json', 'chain.json', 'archive/manifest.json'].includes(name) ||
  /^archive\/objects\/(events|authorizations|evidence)\/[0-9a-f]{64}\.json$/.test(name);
const fail = code => { throw new Error(code); };

export async function syntheticArchiveInventory(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await lstat(join(root, name));
    if (info.isSymbolicLink()) fail('PACKAGE_LINK_FORBIDDEN');
    if (info.isDirectory()) {
      if (!['archive', 'archive/objects', 'archive/objects/events', 'archive/objects/authorizations', 'archive/objects/evidence'].includes(name)) fail('UNKNOWN_PACKAGE_DIRECTORY');
      files.push(...await syntheticArchiveInventory(root, name));
    } else if (info.isFile()) {
      if (name !== 'package.json' && !allowed(name)) fail('UNKNOWN_PACKAGE_FILE');
      if (info.size > 2_000_000) fail('PACKAGE_FILE_TOO_LARGE');
      if (name !== 'package.json') files.push(name);
    } else fail('INVALID_PACKAGE_ENTRY');
  }
  return files.sort();
}

export async function verifySyntheticArchive(directory, trustedPackageHash) {
  if (typeof trustedPackageHash !== 'string' || !/^[0-9a-f]{64}$/.test(trustedPackageHash)) fail('TRUSTED_PACKAGE_HASH_REQUIRED');
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) fail('PACKAGE_DIRECTORY_REQUIRED');
  const names = await syntheticArchiveInventory(root);
  const bytes = await readFile(join(root, 'package.json'));
  if (sha(bytes) !== trustedPackageHash) fail('PACKAGE_ANCHOR_MISMATCH');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (Object.keys(manifest).sort().join(',') !== 'evidenceMode,files,version' || manifest.version !== VERSION || manifest.evidenceMode !== 'SYNTHETIC_FIXTURE') fail('INVALID_PACKAGE_MANIFEST');
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('INVALID_PACKAGE_MANIFEST');
  const expectedNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames) || !['genesis.json', 'scope.json', 'chain.json', 'archive/manifest.json'].every(name => expectedNames.includes(name))) fail('PACKAGE_INVENTORY_MISMATCH');
  for (const name of expectedNames) {
    if (!allowed(name) || typeof manifest.files[name] !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.files[name])) fail('INVALID_PACKAGE_MANIFEST');
    if (sha(await readFile(join(root, name))) !== manifest.files[name]) fail('PACKAGE_CHECKSUM_MISMATCH');
  }
  const parse = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
  const result = await recoverAndReplayMembershipHistory({
    genesis: await parse('genesis.json'), expected: await parse('scope.json'), providerViews: await parse('chain.json'),
    archives: [new FilesystemMembershipArchive(join(root, 'archive'))],
  });
  if (result.status !== 'VERIFIED') fail(`PACKAGE_REPLAY_${result.status}`);
  return { status: 'PORTABLE_SYNTHETIC_REPLAY_VERIFIED', packageHash: trustedPackageHash, stateHash: result.state.stateHash,
    accepted: result.accepted, rejected: result.rejected, evidenceMode: 'SYNTHETIC_FIXTURE', livePilotAuthorized: false };
}
