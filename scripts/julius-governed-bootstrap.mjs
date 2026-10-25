// Installs a signed checkpoint attestation on main with the governed App.
//
// julius-governed-land.yml runs only from main, so the first move from the
// current main cannot be that workflow. Gatekeeper runs this on a checkout of
// the target, with an App installation token in JULIUS_GOVERNED_LANDER_TOKEN.
// Dry-run is the default. --execute is the only arm.
// There is no re-enable flag and no skip.
//
// The target argument R is the commit the Independent Reviewer attested, and
// --target-tree is required. This script creates installer commit I on top of
// R. I removes every attestation file already in R's checkpoint directory and
// adds only <R>.txt and its signature, so main carries exactly one
// attestation. It reads I back and moves main only when I's tree is the tree
// it created, I's single parent is R, I's message is the installer message,
// the R...I diff is exactly those attestation paths, the committer is the App
// bot and GitHub reports the signature verified. The update is force:false.
//
// Recovery. The same script, with R equal to main, replaces an expired or
// expiring attestation on main with a fresh signed one. That is the recovery
// for every expiry, including the window this script installs, so the window
// may be as long as ATTESTATION_MAX_WINDOW_MS. It must still have
// BOOTSTRAP_MIN_REMAINING_MS left when it is installed. Keep this file: it is
// the only path that can re-attest main once an attestation has expired,
// because every gate, including the governed lander, refuses an expired one.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { branchRulesProblems, governedCommitBody } from '../.github/julius-landing/governed-land.mjs';
import {
  CHECKPOINT_ATTESTATION_DIR,
  TRUSTED_CHECKPOINT_SHA,
  TRUSTED_COMPUTING_BASE,
  attestationShapeProblem,
  checkpointAttestationProblems,
  isCheckpointInstallerDiff,
  landingIdentityProblem,
  parseCheckpointAttestation,
  reviewerKeyPinRefusal,
} from './julius-main-provenance-trust.mjs';

/** The longest window this script installs. Six months, the default the reviewer is asked to sign. */
export const ATTESTATION_MAX_WINDOW_MS = 184 * 24 * 60 * 60 * 1000;
/** Kept for callers of the earlier name. It is the same ceiling. */
export const BOOTSTRAP_MAX_WINDOW_MS = ATTESTATION_MAX_WINDOW_MS;
/** An attestation that expires sooner than this after it is installed is refused: it would need recovery at once. */
export const BOOTSTRAP_MIN_REMAINING_MS = 7 * 24 * 60 * 60 * 1000;
/** The first-parent walk from the target back to the attestation prior stops here and refuses. */
export const ATTESTED_RANGE_CAP = 250;
export const INSTALLER_COMMIT_MESSAGE = [
  'Add the signed checkpoint attestation.',
  '',
  'Parent is the attested checkpoint. This commit replaces the checkpoint directory with only that attestation and its signature.',
  '',
].join('\n');

const SHA = /^[0-9a-f]{40}$/u;
const REPO = 'ohdieyuh-glitch/sunday-relay';
const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB_PATH = '.github/julius-landing/reviewer-ed25519.pub';
const SNAPSHOT_PATH = '.github/julius-landing/main-ruleset.json';

export function attestationRelPaths(targetSha) {
  return {
    txt: `${CHECKPOINT_ATTESTATION_DIR}/${targetSha}.txt`,
    sig: `${CHECKPOINT_ATTESTATION_DIR}/${targetSha}.sig`,
  };
}

/** The installer diff: every existing checkpoint file removed, the new attestation files added. Sorted, exact. */
export function installerDiffPlan(targetSha, existingNames) {
  const added = Object.values(attestationRelPaths(targetSha));
  const removed = (Array.isArray(existingNames) ? existingNames : [])
    .map((name) => `${CHECKPOINT_ATTESTATION_DIR}/${name}`)
    .filter((path) => !added.includes(path));
  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
  };
}

export function bootstrapAuditRecord({ status, main, parent, target, tree, installer }) {
  return [
    'JULIUS GOVERNED BOOTSTRAP',
    `status: ${status}`,
    `main: ${main}`,
    `parent: ${parent}`,
    `target: ${target}`,
    `tree: ${tree}`,
    `installer: ${installer}`,
    'method: fast-forward',
    '',
  ].join('\n');
}

/** The installer read back from GitHub, against exactly what was asked for. Any problem means main does not move. */
export function installerReadBackProblems({ commit, compare, expectedTree, target, plan }) {
  const problems = [];
  if (commit?.tree?.sha !== expectedTree) problems.push(`the installer tree is ${commit?.tree?.sha ?? 'unreadable'}, not the created tree ${expectedTree}`);
  const parents = Array.isArray(commit?.parents) ? commit.parents.map((row) => row?.sha) : [];
  if (parents.length !== 1 || parents[0] !== target) problems.push(`the installer parents are ${parents.join(',') || 'unreadable'}, not the target ${target}`);
  const stored = commit?.message;
  if (stored !== INSTALLER_COMMIT_MESSAGE && stored !== INSTALLER_COMMIT_MESSAGE.replace(/\n$/u, '')) problems.push('the installer message is not the installer message');
  const files = Array.isArray(compare?.files) ? compare.files : null;
  if (compare?.status !== 'ahead' || compare?.ahead_by !== 1 || compare?.behind_by !== 0 || files === null) {
    problems.push('the target...installer diff is not one commit ahead');
  } else {
    const rows = files.map((file) => `${file?.status}:${file?.filename}`).sort();
    const wanted = [...plan.added.map((path) => `added:${path}`), ...plan.removed.map((path) => `removed:${path}`)].sort();
    if (rows.length !== wanted.length || rows.some((row, index) => row !== wanted[index])) {
      problems.push(`the target...installer diff is ${rows.join(', ') || 'empty'}, not exactly ${wanted.join(', ')}`);
    }
  }
  return problems;
}

/** Pure decision. Network and disk stay in runBootstrap. */
export function evaluateGovernedBootstrap(input) {
  const problems = [];
  const expected = input?.expectedMainSha;
  const main = input?.mainSha;
  const target = input?.targetSha;
  const targetTree = input?.targetTree;
  if (typeof expected !== 'string' || !SHA.test(expected)) problems.push('the expected main sha is not a full 40-hex sha');
  if (typeof main !== 'string' || !SHA.test(main)) problems.push('main could not be read');
  else if (typeof expected === 'string' && SHA.test(expected) && main !== expected) {
    problems.push(`main is ${main}, not the expected ${expected}`);
  }
  if (typeof target !== 'string' || !SHA.test(target)) problems.push('the target sha is not a full 40-hex sha');
  if (typeof targetTree !== 'string' || !SHA.test(targetTree)) problems.push('the target tree is not a full 40-hex sha');
  if (input?.liveTargetTree !== targetTree) problems.push(`the target tree is ${input?.liveTargetTree ?? 'unreadable'}, not ${targetTree}`);
  const compare = input?.compare;
  const recovery = typeof main === 'string' && main === target;
  const descends = recovery || (compare?.behind_by === 0 && compare?.status === 'ahead' && Number(compare?.ahead_by) > 0);
  if (!descends) problems.push('the target is not main and does not descend from main');
  const pin = reviewerKeyPinRefusal(input?.publicKeyPem, input?.externalAnchor);
  if (pin) problems.push(pin.reason);
  const text = input?.attestationText;
  const parsed = typeof text === 'string' && text !== '' ? parseCheckpointAttestation(text) : null;
  const existing = Array.isArray(input?.existingCheckpointNames) ? input.existingCheckpointNames : null;
  if (existing === null) problems.push('the checkpoint directory at the target could not be read');
  else if (existing.some((name) => !/^[0-9a-f]{40}\.(txt|sig)$/u.test(name))) {
    problems.push(`the checkpoint directory at the target holds files that are not attestations: ${existing.join(', ')}`);
  }
  if (!parsed || parsed.problems.length > 0) problems.push('the checkpoint attestation was not verified');
  else {
    const verified = checkpointAttestationProblems({
      text,
      signatureB64: input?.attestationSignatureB64,
      pem: input?.publicKeyPem,
      treeHashes: input?.treeHashes,
      now: input?.now,
    });
    if (verified.length > 0) problems.push('the checkpoint attestation was not verified');
    if (typeof target === 'string' && SHA.test(target)) {
      const plan = installerDiffPlan(target, existing ?? []);
      const after = plan.added.map((path) => path.slice(CHECKPOINT_ATTESTATION_DIR.length + 1));
      const shape = attestationShapeProblem({ names: after, text });
      if (shape) problems.push(`the installed checkpoint directory would be refused: ${shape}`);
      if (isCheckpointInstallerDiff([...plan.added, ...plan.removed]) !== true) problems.push('the installer diff is not a checkpoint attestation');
    }
    const issued = Date.parse(parsed.fields.issued ?? '');
    const expires = Date.parse(parsed.fields.expires ?? '');
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || !(expires > issued) || expires - issued > ATTESTATION_MAX_WINDOW_MS) {
      problems.push('the attestation window is longer than the six-month ceiling');
    } else if (typeof input?.now === 'number' && expires - input.now < BOOTSTRAP_MIN_REMAINING_MS) {
      problems.push('the attestation expires within seven days of being installed');
    }
    const last = parsed.fields.commits?.[parsed.fields.commits.length - 1];
    if (parsed.fields.checkpoint !== target || last?.sha !== target) problems.push('the attestation checkpoint is not the target commit');
    if (last?.tree !== targetTree) problems.push('the attestation does not bind the target tree');
    const chain = input?.attestedRange;
    if (!Array.isArray(chain)) problems.push(`the first-parent chain from ${TRUSTED_CHECKPOINT_SHA} to the target could not be read`);
    else {
      const listed = (parsed.fields.commits ?? []).map((row) => `${row.sha} ${row.tree}`);
      const actual = chain.map((row) => `${row.sha} ${row.tree}`);
      if (listed.length !== actual.length || listed.some((row, index) => row !== actual[index])) {
        problems.push(`the attestation does not list the first-parent chain ${TRUSTED_CHECKPOINT_SHA}..target exactly`);
      }
    }
  }
  if (input?.snapshotSha256 && input?.treeHashes?.[SNAPSHOT_PATH] !== input.snapshotSha256) {
    problems.push('the main ruleset snapshot is not the blob on the target');
  }
  if (input?.publicKeySha256 && input?.treeHashes?.[PUB_PATH] !== input.publicKeySha256) {
    problems.push('the reviewer key is not the blob on the target');
  }
  problems.push(...branchRulesProblems(input?.liveRules, input?.snapshot, input?.appId));
  const botId = typeof input?.botId === 'string' ? input.botId.trim() : '';
  if (!/^[1-9][0-9]{0,16}$/u.test(botId)) problems.push('JULIUS_GOVERNED_LANDER_BOT_ID is unset');
  return { ok: problems.length === 0, problems, recovery };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function github(request, token, path, init = {}) {
  const response = await request(path, {
    method: init.method ?? 'GET',
    body: init.body,
    token,
  });
  return response ?? { status: 0, body: null };
}

function contentSha256(body) {
  if (body?.encoding !== 'base64' || typeof body?.content !== 'string') return null;
  return createHash('sha256').update(Buffer.from(body.content.replace(/\n/g, ''), 'base64')).digest('hex');
}

/** The first-parent chain after `floor` up to and including `tip`, oldest first, or null. */
async function readAttestedRange(request, token, tip, floor) {
  const reversed = [];
  let sha = tip;
  for (let step = 0; step < ATTESTED_RANGE_CAP; step += 1) {
    const response = await github(request, token, `/repos/${REPO}/commits/${sha}`);
    const tree = response.body?.commit?.tree?.sha;
    const parent = response.body?.parents?.[0]?.sha;
    if (response.status !== 200 || typeof tree !== 'string' || typeof parent !== 'string') return null;
    reversed.push({ sha, tree });
    if (parent === floor) return reversed.reverse();
    sha = parent;
  }
  return null;
}

/**
 * @param {object} options
 * @param {string[]} options.argv
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(path: string, init: { method: string, body?: string, token: string }) => Promise<{ status: number, body: unknown }>} [options.request]
 * @param {(path: string) => string} [options.readFile]
 * @param {number} [options.now]
 */
export async function runBootstrap({ argv = [], env = {}, request, readFile, now = Date.now() } = {}) {
  const execute = argv.includes('--execute');
  const read = readFile ?? ((path) => readFileSync(path, 'utf8'));
  const token = typeof env.JULIUS_GOVERNED_LANDER_TOKEN === 'string' ? env.JULIUS_GOVERNED_LANDER_TOKEN : '';
  const problems = [];
  if (token === '') problems.push('JULIUS_GOVERNED_LANDER_TOKEN is unset');
  const expectedMainSha = argValue(argv, '--main-sha');
  const targetSha = argValue(argv, '--target');
  const targetTreeArg = argValue(argv, '--target-tree');
  if (typeof targetTreeArg !== 'string' || !SHA.test(targetTreeArg)) problems.push('--target-tree is required and must be the full 40-hex tree of the target');
  const attestationPath = argValue(argv, '--attestation');
  const signaturePath = argValue(argv, '--signature');
  let attestationText = '';
  let attestationSignatureB64 = '';
  if (typeof attestationPath !== 'string' || typeof signaturePath !== 'string') problems.push('the attestation and signature paths are required');
  else {
    try {
      attestationText = read(attestationPath);
      attestationSignatureB64 = read(signaturePath).trim();
    } catch {
      problems.push('the attestation files could not be read');
    }
  }
  let publicKeyPem = '';
  let snapshotText = '';
  let snapshot = null;
  try { publicKeyPem = read(join(ROOT, '..', PUB_PATH)); } catch { problems.push('the reviewer key could not be read'); }
  try {
    snapshotText = read(join(ROOT, '..', SNAPSHOT_PATH));
    snapshot = JSON.parse(snapshotText);
  } catch { problems.push('the main ruleset snapshot could not be read'); }
  if (token === '' || typeof request !== 'function' || problems.length > 0) {
    if (typeof request !== 'function' && token !== '') problems.push('the GitHub client is unavailable');
    return { ok: false, execute, problems, record: null };
  }
  const mainResponse = await github(request, token, `/repos/${REPO}/git/ref/heads/main`);
  const mainSha = mainResponse.status === 200 ? mainResponse.body?.object?.sha : undefined;
  const compareResponse = SHA.test(String(mainSha)) && SHA.test(String(targetSha)) && mainSha !== targetSha
    ? await github(request, token, `/repos/${REPO}/compare/${mainSha}...${targetSha}`)
    : { status: 0, body: null };
  const commitResponse = SHA.test(String(targetSha))
    ? await github(request, token, `/repos/${REPO}/commits/${targetSha}`)
    : { status: 0, body: null };
  const liveTree = commitResponse.status === 200 ? commitResponse.body?.commit?.tree?.sha : undefined;
  const treeHashes = {};
  let existingCheckpointNames = null;
  let attestedRange = null;
  if (SHA.test(String(targetSha))) {
    for (const path of TRUSTED_COMPUTING_BASE) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const blob = await github(request, token, `/repos/${REPO}/contents/${encoded}?ref=${targetSha}`);
      const digest = blob.status === 200 ? contentSha256(blob.body) : null;
      if (digest === null) problems.push(`the blob ${path} at the target could not be read`);
      else treeHashes[path] = digest;
    }
    const listing = await github(request, token, `/repos/${REPO}/contents/${CHECKPOINT_ATTESTATION_DIR}?ref=${targetSha}`);
    if (listing.status === 404) existingCheckpointNames = [];
    else if (listing.status === 200 && Array.isArray(listing.body) && listing.body.every((row) => row?.type === 'file' && typeof row?.name === 'string')) {
      existingCheckpointNames = listing.body.map((row) => row.name).sort();
    }
    attestedRange = await readAttestedRange(request, token, targetSha, TRUSTED_CHECKPOINT_SHA);
  }
  const rulesResponse = await github(request, token, `/repos/${REPO}/rules/branches/main`);
  const decision = evaluateGovernedBootstrap({
    expectedMainSha,
    mainSha,
    targetSha,
    targetTree: targetTreeArg,
    liveTargetTree: liveTree,
    compare: compareResponse.status === 200 ? compareResponse.body : null,
    attestationText,
    attestationSignatureB64,
    publicKeyPem,
    externalAnchor: env.JULIUS_REVIEWER_KEY_SHA256,
    treeHashes,
    existingCheckpointNames,
    attestedRange,
    liveRules: rulesResponse.status === 200 ? rulesResponse.body : null,
    snapshot,
    snapshotSha256: snapshotText === '' ? undefined : sha256Text(snapshotText),
    publicKeySha256: publicKeyPem === '' ? undefined : sha256Text(publicKeyPem),
    appId: env.JULIUS_GOVERNED_LANDER_APP_ID,
    botId: env.JULIUS_GOVERNED_LANDER_BOT_ID,
    now,
  });
  problems.push(...decision.problems);
  if (problems.length > 0) return { ok: false, execute, problems, record: null };
  const pending = bootstrapAuditRecord({
    status: 'pending',
    main: 'pending',
    parent: mainSha,
    target: targetSha,
    tree: targetTreeArg,
    installer: 'pending',
  });
  if (!execute) return { ok: true, execute: false, problems: [], record: pending };
  const paths = attestationRelPaths(targetSha);
  const plan = installerDiffPlan(targetSha, existingCheckpointNames);
  const blobFor = async (content) => {
    const response = await github(request, token, `/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    if (response.status !== 201 || typeof response.body?.sha !== 'string') throw new Error(`blob create answered ${response.status}`);
    return response.body.sha;
  };
  let installerSha = '';
  try {
    const txtBlob = await blobFor(attestationText);
    const sigBlob = await blobFor(`${attestationSignatureB64}\n`);
    const treeResponse = await github(request, token, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: targetTreeArg,
        tree: [
          ...plan.removed.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
          { path: paths.txt, mode: '100644', type: 'blob', sha: txtBlob },
          { path: paths.sig, mode: '100644', type: 'blob', sha: sigBlob },
        ],
      }),
    });
    if (treeResponse.status !== 201 || typeof treeResponse.body?.sha !== 'string') throw new Error(`tree create answered ${treeResponse.status}`);
    const createdTree = treeResponse.body.sha;
    const commitResponseWrite = await github(request, token, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify(governedCommitBody({
        message: INSTALLER_COMMIT_MESSAGE,
        tree: createdTree,
        parents: [targetSha],
      })),
    });
    if (commitResponseWrite.status !== 201 || typeof commitResponseWrite.body?.sha !== 'string') throw new Error(`commit create answered ${commitResponseWrite.status}`);
    installerSha = commitResponseWrite.body.sha;
    const gitCommit = await github(request, token, `/repos/${REPO}/git/commits/${installerSha}`);
    const diff = await github(request, token, `/repos/${REPO}/compare/${targetSha}...${installerSha}`);
    const shape = gitCommit.status === 200 && diff.status === 200
      ? installerReadBackProblems({ commit: gitCommit.body, compare: diff.body, expectedTree: createdTree, target: targetSha, plan })
      : ['the installer commit could not be read back'];
    if (shape.length > 0) return { ok: false, execute: true, problems: [...shape, 'main was not moved'], record: null };
    const readBack = await github(request, token, `/repos/${REPO}/commits/${installerSha}`);
    const identity = landingIdentityProblem({
      committerId: readBack.body?.committer?.id,
      verificationVerified: readBack.body?.commit?.verification?.verified === true,
      verificationReason: typeof readBack.body?.commit?.verification?.reason === 'string' ? readBack.body.commit.verification.reason : '',
      botId: env.JULIUS_GOVERNED_LANDER_BOT_ID,
    });
    if (readBack.status !== 200 || identity) {
      return { ok: false, execute: true, problems: [identity ?? 'the installer commit could not be read back'], record: null };
    }
    const again = await github(request, token, `/repos/${REPO}/git/ref/heads/main`);
    if (again.body?.object?.sha !== expectedMainSha) {
      return { ok: false, execute: true, problems: [`main moved before the update; it is ${again.body?.object?.sha ?? 'unreadable'}`], record: null };
    }
    const patched = await github(request, token, `/repos/${REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: installerSha, force: false }),
    });
    if (patched.status !== 200) return { ok: false, execute: true, problems: [`the ref update was refused; no retry and no force: ${patched.status}`], record: null };
    const after = await github(request, token, `/repos/${REPO}/git/ref/heads/main`);
    if (after.body?.object?.sha !== installerSha) {
      return { ok: false, execute: true, problems: [`main is ${after.body?.object?.sha ?? 'unreadable'} after the update, not ${installerSha}`], record: null };
    }
  } catch (error) {
    return { ok: false, execute: true, problems: [`the installer commit was not created; main was not moved: ${error instanceof Error ? error.message : 'unknown'}`], record: null };
  }
  return {
    ok: true,
    execute: true,
    problems: [],
    record: bootstrapAuditRecord({
      status: 'final',
      main: installerSha,
      parent: mainSha,
      target: targetSha,
      tree: targetTreeArg,
      installer: installerSha,
    }),
  };
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();

if (entrypoint !== null && import.meta.url === entrypoint) {
  const result = await runBootstrap({
    argv: process.argv.slice(2),
    env: process.env,
    request: async (path, init) => {
      const response = await fetch(`https://api.github.com${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${init.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body = null;
      if (text !== '') {
        try { body = JSON.parse(text); } catch { body = null; }
      }
      return { status: response.status, body };
    },
  });
  const lines = [...result.problems, result.record ?? ''].filter((line) => line !== '');
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${lines.join('\n')}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
