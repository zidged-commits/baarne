// Builds only a local, synthetic preservation rehearsal. No network or install.
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { exportSyntheticArchive, verifySyntheticArchive } from './core-portable-fixture.mjs';
import { CAPSULE_VERSION, capsuleInventory, sha256 } from './monument-capsule-verifier.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unix = path => path.split(sep).join('/');
const SOURCE_PREFIXES = ['packages/admission/src/', 'packages/trust-protocol/src/',
  'packages/identity/src/', 'packages/v0.1-core/src/', 'packages/membership-state/src/',
  'packages/membership-gate-f/src/', 'packages/membership-archive/src/'];
const DOCUMENTS = ['docs/governance/BAARNE_MANIFESTO.md', 'docs/AI_HANDOFF/CONSTITUTION_INVARIANTS.md',
  'docs/TRUST_PROTOCOL_V0.1.md', 'docs/M1_FREEZE_REPORT.md', 'docs/M1_GATE_F_REPORT.md',
  'docs/M1_GATE_H_REPORT.md', 'packages/membership-state/README.md',
  'docs/permanence/BAARNE_PERMANENCE_KIT_SPEC.md',
  'docs/BAARNE_RELATED_WORK_AND_DIGITAL_MONUMENT_RESEARCH_2026-10-16.md'];
const VENDOR = ['ethers', '@adraffy/ens-normalize', '@noble/curves', '@noble/hashes',
  'aes-js', 'tslib', 'ws', '@types/node'];

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8_000_000) throw Error('SOURCE_FILE_INVALID');
  return readFile(path);
}

export async function buildMonumentCapsule(destination) {
  const root = resolve(destination);
  // Never merge into or overwrite an existing directory, including a link.
  await mkdir(root);
  const sources = {}, dependencies = [];
  const put = async (name, bytes) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), bytes, { flag: 'wx' });
  };
  const copy = async (from, to) => {
    const bytes = await regularFile(join(REPO, from));
    await put(to, bytes);
    sources[from] = { path: to, sha256: sha256(bytes) };
    return bytes;
  };
  const queue = ['scripts/core-portable-verifier.mjs'], seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    if (name !== 'scripts/core-portable-verifier.mjs' &&
        (!SOURCE_PREFIXES.some(prefix => name.startsWith(prefix)) || !/\.(mjs|ts)$/.test(name))) throw Error('SOURCE_OUTSIDE_ALLOWLIST');
    seen.add(name);
    const bytes = await copy(name, `source/${name}`);
    const imports = ts.preProcessFile(bytes.toString('utf8'), true, true).importedFiles;
    for (const item of imports) {
      if (item.fileName.startsWith('node:') || item.fileName === 'ethers') continue;
      if (!item.fileName.startsWith('.')) throw Error('UNSUPPORTED_CAPSULE_DEPENDENCY');
      queue.push(unix(relative(REPO, resolve(REPO, dirname(name), item.fileName))));
    }
  }
  for (const name of DOCUMENTS) await copy(name, `documents/${name}`);
  for (const name of ['LICENSE', 'LICENSING.md', 'LICENSES/CC-BY-SA-4.0.txt', 'THIRD_PARTY_NOTICES.md']) await copy(name, name);
  await copy('docs/permanence/MONUMENT_READ_ME_FIRST.md', 'READ-ME-FIRST.md');
  await copy('scripts/monument-capsule-verifier.mjs', 'verify.mjs');
  await copy('node_modules/ethers/dist/ethers.js', 'node_modules/ethers/ethers.js');
  for (const name of VENDOR) {
    const packagePath = `node_modules/${name}`;
    const metadata = JSON.parse(await copy(`${packagePath}/package.json`, `vendor-notices/${name}/package.json`));
    const notices = (await readdir(join(REPO, packagePath))).filter(file =>
      /^(?:licen[cs]e|notice|copying|copyright)/i.test(file)).sort();
    if (!notices.length) throw Error('VENDOR_NOTICE_MISSING');
    for (const notice of notices) await copy(`${packagePath}/${notice}`, `vendor-notices/${name}/${notice}`);
    dependencies.push({ name, version: metadata.version, license: metadata.license });
  }
  const ethers = dependencies.find(item => item.name === 'ethers');
  await put('node_modules/ethers/package.json', JSON.stringify({ name: 'ethers', version: ethers.version,
    type: 'module', exports: './ethers.js', private: true }) + '\n');
  await put('package.json', JSON.stringify({ name: 'baarne-monument-synthetic-capsule',
    private: true, type: 'module', engines: { node: '>=22.20.0 <25' } }) + '\n');
  const archive = await exportSyntheticArchive(join(root, 'history'));
  const replay = await verifySyntheticArchive(join(root, 'history'), archive.packageHash);
  await put('EXPECTED_REPLAY.json', JSON.stringify(replay, null, 2) + '\n');
  const freezeBytes = await regularFile(join(REPO, 'docs/M1_FREEZE_SOURCE_MANIFEST.json'));
  const frozen = JSON.parse(freezeBytes.toString('utf8'));
  const freezeComparison = [];
  for (const [name, entry] of Object.entries(sources)) {
    const baseline = frozen.files.find(item => item.path === name);
    if (!baseline) continue;
    if (baseline.sha256 !== entry.sha256) throw Error('PRESERVED_FROZEN_SOURCE_MISMATCH');
    freezeComparison.push({ path: name, sha256: entry.sha256 });
  }
  await put('PROVENANCE.json', JSON.stringify({ version: CAPSULE_VERSION, evidenceMode: 'SYNTHETIC_FIXTURE',
    node: process.version, buildOnlyTypeScript: ts.version, sources, dependencies,
    freezeSourceManifestSha256: sha256(freezeBytes), freezeComparison,
    runtimeSelection: 'Unmodified installed ethers/dist/ethers.js ESM bundle via local package wrapper',
    projectLicense: 'AGPL-3.0-only', documentationLicense: 'CC-BY-SA-4.0',
    licenseScope: 'LICENSING.md', redistributionReview: 'PENDING_THIRD_PARTY_AND_OWNER_REVIEW',
    independentImplementation: false,
    livePilotAuthorized: false }, null, 2) + '\n');
  const files = {};
  for (const name of (await capsuleInventory(root)).files) files[name] = sha256(await readFile(join(root, name)));
  const bytes = JSON.stringify({ version: CAPSULE_VERSION, evidenceMode: 'SYNTHETIC_FIXTURE',
    archiveHash: archive.packageHash, files }, null, 2) + '\n';
  await put('CAPSULE.json', bytes);
  return { status: 'LOCAL_SYNTHETIC_MONUMENT_BUILT', capsuleHash: sha256(bytes),
    bootstrapHash: files['verify.mjs'], fileCount: Object.keys(files).length,
    sourceFileCount: seen.size, replay, livePilotAuthorized: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('USAGE: node build-monument-capsule.mjs NEW_DIRECTORY');
    console.log(JSON.stringify(await buildMonumentCapsule(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
