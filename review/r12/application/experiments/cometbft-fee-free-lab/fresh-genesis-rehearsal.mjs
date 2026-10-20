// Synthetic-only proof that a new BAARNE network starts from a separate
// Genesis/store while preserving the previous network's committed history.
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './membership-fixture.mjs';
import {MembershipLabApplication} from './membership.mjs';
import {canonical, digest} from './application.mjs';
import {createPrivateDirectory} from './private-directory.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function rehearseFreshGenesis(root) {
  const previous = await fixture(1_000);
  const fresh = await fixture(2_000);
  fresh.config.membership.networkId = `baarne:fresh-${randomBytes(12).toString('hex')}`;

  const previousDirectory = join(root, 'previous-network');
  const freshDirectory = join(root, 'fresh-network');
  const previousApp = await MembershipLabApplication.create(previousDirectory, previous.config);
  await previousApp.stageBlock(1, previous.blocks[0].time, previous.blocks[0].txs);
  await previousApp.commit();

  const previousBefore = previousApp.info();
  const previousStatePath = join(previousDirectory, 'state.json');
  const previousStateHashBefore = sha256(await readFile(previousStatePath));
  const freshApp = await MembershipLabApplication.create(freshDirectory, fresh.config);
  const freshInitial = freshApp.info();

  const oldIntentInFreshNetwork = freshApp.checkIntent(previous.blocks[0].txs[0]);
  let oldStoreRejected = false;
  try {
    await MembershipLabApplication.load(freshDirectory, previous.config);
  } catch (error) {
    oldStoreRejected = error?.message === 'INVALID_STORE';
  }

  let existingStoreOverwriteRejected = false;
  let existingStoreOverwriteErrorCode = null;
  try {
    await MembershipLabApplication.create(previousDirectory, fresh.config);
  } catch (error) {
    existingStoreOverwriteErrorCode = error?.code ?? null;
    existingStoreOverwriteRejected = existingStoreOverwriteErrorCode === 'EEXIST';
  }

  const previousAfter = previousApp.info();
  const previousStateHashAfter = sha256(await readFile(previousStatePath));
  const result = {
    schemaVersion: 'BAARNE_FRESH_GENESIS_REHEARSAL_V1',
    scope: 'SYNTHETIC_LOCAL_ONLY',
    previousNetwork: {
      genesisHash: digest(previous.config),
      networkId: previous.config.membership.networkId,
      committedHeight: previousBefore.height,
      acceptedCount: previousBefore.acceptedCount,
      stateHash: previousBefore.stateHash,
    },
    freshNetwork: {
      genesisHash: digest(fresh.config),
      networkId: fresh.config.membership.networkId,
      initialHeight: freshInitial.height,
      initialAcceptedCount: freshInitial.acceptedCount,
      initialStateHash: freshInitial.stateHash,
    },
    existingStoreOverwriteErrorCode,
    checks: {
      genesisAndNetworkIdentityChanged: digest(previous.config) !== digest(fresh.config) &&
        previous.config.membership.networkId !== fresh.config.membership.networkId,
      fictionalFounderCohortsDisjoint: previous.config.membership.founders.every(
        identity => !fresh.config.membership.founders.includes(identity)),
      freshNetworkStartsEmpty: freshInitial.height === 0 && freshInitial.acceptedCount === 0,
      previousIntentRejectedByFreshNetwork: oldIntentInFreshNetwork.code !== 0 &&
        oldIntentInFreshNetwork.reason === 'WRONG_SCOPE',
      previousStoreRejectedUnderFreshGenesis: oldStoreRejected,
      existingStoreOverwriteRejected,
      previousHistoryUnchanged: canonical(previousBefore) === canonical(previousAfter) &&
        previousStateHashBefore === previousStateHashAfter,
    },
    livePilotAuthorized: false,
  };
  if (Object.values(result.checks).some(value => value !== true)) {
    throw Error('FRESH_GENESIS_REHEARSAL_FAILED');
  }
  return result;
}

export async function createFreshGenesisScratch(evidenceDirectory) {
  const scratch = join(evidenceDirectory, `.run-${randomBytes(8).toString('hex')}`);
  await createPrivateDirectory(scratch);
  return scratch;
}

export async function writeFreshGenesisResult(evidenceDirectory, result) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const output = join(evidenceDirectory,
    `RESET_REHEARSAL_RESULT-${timestamp}-${randomBytes(6).toString('hex')}.json`);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const evidenceDirectory = join(process.cwd(), 'docs', 'evidence', 'fresh-genesis');
  await mkdir(evidenceDirectory, {recursive: true});
  const scratch = await createFreshGenesisScratch(evidenceDirectory);
  try {
    const result = await rehearseFreshGenesis(scratch);
    const output = await writeFreshGenesisResult(evidenceDirectory, result);
    console.log(JSON.stringify({output, checks: result.checks, livePilotAuthorized: false}, null, 2));
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}
