/**
 * TRUST ROOT FOR REVIEWED MAIN.
 *
 * The reviewer key is pinned here as the full SHA-256 of its SPKI DER, and the
 * raw 32-byte ed25519 public key is pinned beside it. A short prefix is not a
 * match. The same fingerprint must be presented from outside the repository
 * (`JULIUS_REVIEWER_KEY_SHA256`); a missing or different value fails closed.
 *
 * The last independently accepted checkpoint is the julius-accept-main artifact
 * for 2528ac5c (landing #389, accept-main run 39335737220). See
 * `.github/workflows/julius-accept-main.yml`, which names artifacts
 * `julius-accepted-main-<sha>`. That commit is the prior inside an attestation.
 * It is not the byte oracle the live gates compare against.
 *
 * A JULIUS-CHECKPOINT-V1 attestation is how the Independent Reviewer names the
 * checkpoint the live gates trust, and the sha256 of every trusted file at the
 * tree that attestation authorizes. The unsigned text for 2528ac5c..f539cab2 is
 * `docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt`. The live file is
 * `.github/julius-landing/checkpoints/<checkpoint>.txt` plus its `.sig`. This
 * module parses that text. It does not treat an unsigned file as acceptance.
 * Nothing here signs.
 *
 * Bootstrap. These gates require a signed attestation already on main, so they
 * cannot land themselves. The founder installer-1 commit is made outside the
 * lander. Its parent is the attested checkpoint, and that commit lands this
 * verifier together with `.github/julius-landing/checkpoints/<checkpoint>.txt`
 * and its `.sig`. There is no bypass flag and the first run does not trust an
 * unsigned tree. Do not squash the installer onto an older main: the named
 * checkpoint would not be an ancestor and the gate fails closed.
 *
 * TRUSTED COMPUTING BASE. A change to any of these files changes what the gate
 * trusts. Such a change is unprovenanced unless a signed G6 installer, or a
 * signed checkpoint attestation that names the resulting commit and tree,
 * verifies under the anchor in force at the previous checkpoint.
 */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TRUSTED_CHECKPOINT_SHA = '2528ac5c0f0d4303051123a7592ef18e3552ba74';
export const TRUSTED_CHECKPOINT_TREE = '328469e79cd25339e16402f5fac8895c3669b4e1';
export const TRUSTED_CHECKPOINT_HEAD = '897c7138d1c9a673afca4577a61602698517a55f';
export const TRUSTED_CHECKPOINT_BASE = '82fcb5ed0e75b1280d3b4a06f246387195cc77f8';
export const TRUSTED_CHECKPOINT_PR = 389;
export const TRUSTED_CHECKPOINT_ACCEPT_RUN = '39335737220';

/** Full SPKI SHA-256. Never compare a prefix of this. */
export const PINNED_REVIEWER_SPKI_SHA256 = 'b0b8e29b3efff5936dd51a54617ca8bda1b94e75557339821d7d00a98364d13a';
/** The 32 raw ed25519 public-key bytes, hex. */
export const PINNED_REVIEWER_RAW_KEY = 'ed738f419234d621fbfc3028c934e2a75b6bd62e02bd83a11e74e9bb6ad222b3';
/** The only commit that introduces the reviewer public key (#379). */
export const REVIEWER_KEY_INTRODUCED_IN = 'e56b6bd9d6cd082af897df9bab8475c2323d342c';

export const LANDING_REPO = 'ohdieyuh-glitch/sunday-relay';
export const CHECKPOINT_HEADER = 'JULIUS-CHECKPOINT-V1';
export const EXTERNAL_ANCHOR_VARIABLE = 'JULIUS_REVIEWER_KEY_SHA256';

/**
 * Files whose bytes are the trust root. Workflows execute the verifier from
 * the checkpoint copy of these paths. The unsigned attestation document is
 * not in this list: it is not authority until the pinned key signs it.
 */
export const TRUSTED_COMPUTING_BASE = Object.freeze([
  '.github/julius-landing/reviewer-ed25519.pub',
  '.github/julius-landing/land-lib.mjs',
  '.github/julius-landing/land.mjs',
  '.github/julius-landing/reviewer-tools.mjs',
  '.github/julius-landing/allowed-branches.txt',
  '.github/julius-landing/required-checks.txt',
  '.github/workflows/julius-accept-main.yml',
  '.github/workflows/julius-land.yml',
  'scripts/julius-main-provenance.mjs',
  'scripts/julius-main-provenance.d.mts',
  'scripts/julius-main-provenance-trust.mjs',
  'scripts/julius-main-provenance-trust.d.mts',
  'scripts/julius-review-currency.mjs',
]);

/** Governed directory. HARD_FORBIDDEN_PATH already matches this prefix. No App PR can add or swap a file here. */
export const CHECKPOINT_ATTESTATION_DIR = '.github/julius-landing/checkpoints';

/**
 * The exact recovery the live gate prints when main has no signed attestation.
 * README and the provenance PR body use this same sentence.
 */
export const INSTALLER_RECOVERY = 'RECOVERY: no signed checkpoint attestation is on main. The founder installer-1 commit lands this verifier and .github/julius-landing/checkpoints/<checkpoint>.txt together with its .sig, in one governed commit whose parent is the attested checkpoint, outside the lander. There is no bypass and the first run does not trust an unsigned tree.';

/** Issued at the Skywalker review of this repair. The window is six months so a 7-day default cannot lock the lander; the reviewer may shorten it when they sign. */
export const ATTESTATION_ISSUED = '2026-10-23T18:30:00Z';
export const ATTESTATION_EXPIRES = '2027-04-23T18:30:00Z';

/**
 * Trusted-file hashes at f539cab2, the historical checkpoint the unsigned
 * 2528ac5c..f539cab2 attestation names. The two trust-module paths do not exist
 * in that tree. The live attestation is a different file and lists the full base.
 */
export const HISTORICAL_TCB = Object.freeze([
  Object.freeze({ path: '.github/julius-landing/reviewer-ed25519.pub', sha256: 'a684dffb135879c2432fde435e1aa3721145dcd9fc7853574cbb6a97b74f7a4a' }),
  Object.freeze({ path: '.github/julius-landing/land-lib.mjs', sha256: 'fb147a1e8742c8ff1c15e93e221109e8be19cd198bad8f8490ac68615c05faed' }),
  Object.freeze({ path: '.github/julius-landing/land.mjs', sha256: '3fbc24fb44a5f60459ad66af0b1ad8c7bc7afe91aa5b55bb64a961d699141f1c' }),
  Object.freeze({ path: '.github/julius-landing/reviewer-tools.mjs', sha256: '91021d0fa8a6b90e63c543bffa1073c4b8b5e0889c5cc85c2d5c4e04811cc26d' }),
  Object.freeze({ path: '.github/julius-landing/allowed-branches.txt', sha256: '7dbc1023a0c4418089ce09825ea56aaf190b734f610481e28724ed4e85de3b9b' }),
  Object.freeze({ path: '.github/julius-landing/required-checks.txt', sha256: 'b9acf72beac5e81d0ce38fcf9473c1d8769d5814351646325802ed0f6270230d' }),
  Object.freeze({ path: '.github/workflows/julius-accept-main.yml', sha256: '8de58423dca8487f3ea9e1f093a7e1f976375797daf89d1dfbb4d12eded615b5' }),
  Object.freeze({ path: '.github/workflows/julius-land.yml', sha256: 'd35cb6d5b26e48fa6282e1bf0d62bcfa146d54ccdba3792a1c51f511c7846439' }),
  Object.freeze({ path: 'scripts/julius-main-provenance.mjs', sha256: 'a4b0eb3aad33ad2bedc832de604fe95b2775d4038fcc1008470220e33ef8031e' }),
  Object.freeze({ path: 'scripts/julius-main-provenance.d.mts', sha256: '2e77127dab12c086f1d574885d5182920710b836d6e6cef78b8a741b1b6456cc' }),
  Object.freeze({ path: 'scripts/julius-review-currency.mjs', sha256: '786aa3ff76f325ae3c41f488c1451ed5a2088119daf61d2689497e928081d267' }),
]);

const ATTESTATION_FILE = /^\.github\/julius-landing\/checkpoints\/[0-9a-f]{40}\.(txt|sig)$/iu;

const SHA = /^[0-9a-f]{40}$/u;

/** Full-length equality. A shared 8-hex prefix is not a match. mutant:pin-compare */
export function exactFingerprintMatch(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string'
    && actual.length === 64 && expected.length === 64
    && actual === expected;
}

export function reviewerKeyMaterial(pem) {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') return { problem: 'the reviewer key is not an ed25519 key' };
    const der = key.export({ type: 'spki', format: 'der' });
    const bytes = Buffer.from(der);
    if (bytes.length < 32) return { problem: 'the reviewer key fingerprint could not be read' };
    const raw = bytes.subarray(bytes.length - 32);
    return {
      key,
      spkiSha256: createHash('sha256').update(bytes).digest('hex'),
      rawHex: raw.toString('hex'),
    };
  } catch {
    return { problem: 'the reviewer key fingerprint could not be read' };
  }
}

/**
 * @returns {null | {verdict:'unprovenanced'|'indeterminate', reason:string}}
 * Null means the key is the pinned key and the external anchor matches it.
 */
export function reviewerKeyPinRefusal(pem, externalAnchor) {
  const material = reviewerKeyMaterial(pem);
  if (material.problem) return { verdict: 'indeterminate', reason: material.problem };
  if (!exactFingerprintMatch(material.spkiSha256, PINNED_REVIEWER_SPKI_SHA256) || material.rawHex !== PINNED_REVIEWER_RAW_KEY) {
    return {
      verdict: 'unprovenanced',
      reason: `the reviewer key is not the pinned reviewer key ${PINNED_REVIEWER_SPKI_SHA256}`,
    };
  }
  if (!exactFingerprintMatch(externalAnchor, PINNED_REVIEWER_SPKI_SHA256)) {
    return {
      verdict: 'unprovenanced',
      reason: externalAnchor === undefined || externalAnchor === null || externalAnchor === ''
        ? `${EXTERNAL_ANCHOR_VARIABLE} is unset`
        : `${EXTERNAL_ANCHOR_VARIABLE} does not match the pinned reviewer key ${PINNED_REVIEWER_SPKI_SHA256}`,
    };
  }
  return null;
}

/** First-parent commits after the checkpoint, in order, with the basis Skywalker named. Not acceptance. */
export const RECORDED_RANGE = Object.freeze([
  Object.freeze({
    sha: '3f20fc1ace7b157d4ff2673959c98998564ef43b',
    tree: '75a61ea2721429a4c7f0849ecc6fffec9e8f6e7f',
    pr: 392,
    classification: 'founder-exact-head',
    touchesVerifier: false,
    basis: "the founder's exact-head APPROVED review at 5936fde4, which has the same tree. Kaisin INDEPENDENT_REVIEW records ce9963 (sha256 a1bb4cb47512678c16a9c62ad8b61a909993470b6df3b2bb57411d8b82ce1390; ACCEPTED head 98a674bd, tree 75a61ea2) and 08a19b (sha256 6d0da2a5dd66bbc711c334708d74020793d28eb6608120e82c4a4b86df212149; A1 MERGE VERIFIED). Tree-verified. These are unsigned, self-registered reviewer records, and NOT Skywalker's review. T2 code-review record d786aa (session 71c1f751) is cited by commit 98a674bd as a signed T2 ruling; d8c600490e68eb0f02b8328a5c482288cbb149e3 is a head, not the record hash. The full sha256 of d786aa was not recovered (prefix b35cfe03, suffix 8c90) and is not invented here.",
  }),
  Object.freeze({
    sha: '689d2be92c3158ba4a59883ed4f6cc02f700660b',
    tree: 'ecfe4f5c047cf1727a80cf459bd5a0a319f80adb',
    pr: 394,
    classification: 'founder-squash',
    touchesVerifier: false,
    basis: "Skywalker's exact-head review of head 73c467910c60bd6b4b2123a8a3fb589696fa69bc, cited as issue comment 6362982251 (https://github.com/ohdieyuh-glitch/sunday-relay/pull/394#issuecomment-6362982251). PASS WITH FINDING (low). The review carried a finding. Wonderland-only.",
  }),
  Object.freeze({
    sha: 'f539cab2530b7733bd987068be676308440e04a5',
    tree: 'bcbefd01d3b6fea0e12e1fed2f967c2d11bc1af0',
    pr: 395,
    classification: 'g6',
    touchesVerifier: true,
    basis: "Skywalker's exact-head review of head 32c5a2be10c60a3a4c7de7741a98bf3ce63c4f5c, cited as issue comment 6363691933 (https://github.com/ohdieyuh-glitch/sunday-relay/pull/395#issuecomment-6363691933). PASS WITH FINDING (F-395-1, low, non-blocking) plus G6. The review carried a finding.",
  }),
]);

/**
 * First 32 hex of sha256 over the commit lines and the trusted-file lines.
 * A nonce that does not match those lines is not this attestation.
 */
export function attestationNonce(commits, tcb = []) {
  const lines = [
    ...(Array.isArray(commits) ? commits : []).map((commit) => `${commit.sha} ${commit.tree}`),
    ...(Array.isArray(tcb) ? tcb : []).map((row) => `${row.path} ${row.sha256}`),
  ];
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex').slice(0, 32);
}

export function attestationNonceProblems(fields) {
  if (!fields || !Array.isArray(fields.commits) || !Array.isArray(fields.tcb)) return 'nonce does not bind the listed commits and trusted-file hashes';
  if (fields.nonce !== attestationNonce(fields.commits, fields.tcb)) return 'nonce does not bind the listed commits and trusted-file hashes';
  return null;
}

/** Clock check. Parse stays format-only. `issued <= now <= expires`. */
export function judgeAttestationWindow(fields, now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) return 'the attestation clock is not a finite timestamp';
  const issued = Date.parse(fields?.issued ?? '');
  const expires = Date.parse(fields?.expires ?? '');
  if (Number.isNaN(issued) || Number.isNaN(expires)) return 'the attestation timestamps are not valid';
  if (now < issued) return 'the checkpoint attestation is not yet valid';
  if (now > expires) return 'the checkpoint attestation has expired';
  return null;
}

/** The exact bytes Skywalker is asked to sign. Unsigned. The nonce is derived, not chosen. */
export function canonicalCheckpointAttestation(fields = {}) {
  const prior = fields.prior ?? TRUSTED_CHECKPOINT_SHA;
  const commits = fields.commits ?? RECORDED_RANGE;
  const tcb = fields.tcb ?? HISTORICAL_TCB;
  const checkpoint = fields.checkpoint ?? commits[commits.length - 1]?.sha;
  const lines = [
    CHECKPOINT_HEADER,
    `repo: ${fields.repo ?? LANDING_REPO}`,
    `prior: ${prior}`,
    `checkpoint: ${checkpoint}`,
    `key-spki-sha256: ${fields.keySpkiSha256 ?? PINNED_REVIEWER_SPKI_SHA256}`,
    `nonce: ${fields.nonce ?? attestationNonce(commits, tcb)}`,
    `issued: ${fields.issued ?? ATTESTATION_ISSUED}`,
    `expires: ${fields.expires ?? ATTESTATION_EXPIRES}`,
    `by: ${fields.by ?? 'INDEPENDENT_REVIEW'}`,
    `count: ${commits.length}`,
  ];
  commits.forEach((commit, index) => {
    const n = index + 1;
    lines.push(`${n}.sha: ${commit.sha}`, `${n}.tree: ${commit.tree}`, `${n}.basis: ${commit.basis}`);
  });
  lines.push(`tcb-count: ${tcb.length}`);
  tcb.forEach((row, index) => {
    const n = index + 1;
    lines.push(`tcb.${n}.path: ${row.path}`, `tcb.${n}.sha256: ${row.sha256}`);
  });
  return `${lines.join('\n')}\n`;
}

const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u;

/** Parse a JULIUS-CHECKPOINT-V1 body. Does not check a signature and does not look at the clock. */
export function parseCheckpointAttestation(text) {
  const problems = [];
  const lines = String(text ?? '').split('\n');
  if (lines[0] !== CHECKPOINT_HEADER) problems.push(`first line must be ${CHECKPOINT_HEADER}`);
  const take = (index, key) => {
    const line = lines[index] ?? '';
    const prefix = `${key}: `;
    if (!line.startsWith(prefix)) {
      problems.push(`line ${index + 1} must start with "${prefix}"`);
      return undefined;
    }
    return line.slice(prefix.length);
  };
  const repo = take(1, 'repo');
  const prior = take(2, 'prior');
  const checkpoint = take(3, 'checkpoint');
  const keySpkiSha256 = take(4, 'key-spki-sha256');
  const nonce = take(5, 'nonce');
  const issued = take(6, 'issued');
  const expires = take(7, 'expires');
  const by = take(8, 'by');
  const countText = take(9, 'count');
  if (repo !== undefined && repo.toLowerCase() !== LANDING_REPO.toLowerCase()) problems.push(`the attestation is for ${repo}, not ${LANDING_REPO}`);
  if (prior !== undefined && !SHA.test(prior)) problems.push('prior must be a full 40-hex sha');
  if (checkpoint !== undefined && !SHA.test(checkpoint)) problems.push('checkpoint must be a full 40-hex sha');
  if (keySpkiSha256 !== undefined && !exactFingerprintMatch(keySpkiSha256, PINNED_REVIEWER_SPKI_SHA256)) {
    problems.push(`key-spki-sha256 is not the pinned reviewer key ${PINNED_REVIEWER_SPKI_SHA256}`);
  }
  if (nonce !== undefined && !/^[0-9a-f]{32}$/u.test(nonce)) problems.push('nonce must be 32 hex characters');
  for (const [name, value] of [['issued', issued], ['expires', expires]]) {
    if (value !== undefined && !(UTC.test(value) && !Number.isNaN(Date.parse(value)))) problems.push(`${name} must be a UTC timestamp`);
  }
  if (issued !== undefined && expires !== undefined && Date.parse(expires) <= Date.parse(issued)) problems.push('expires must be after issued');
  if (by !== undefined && by !== 'INDEPENDENT_REVIEW') problems.push('by must be INDEPENDENT_REVIEW');
  const count = Number(countText);
  if (!Number.isInteger(count) || count < 1 || String(count) !== countText) problems.push('count must be a positive integer');
  const commits = [];
  if (Number.isInteger(count) && count >= 1) {
    for (let n = 1; n <= count; n += 1) {
      const sha = take(9 + (n - 1) * 3 + 1, `${n}.sha`);
      const tree = take(9 + (n - 1) * 3 + 2, `${n}.tree`);
      const basis = take(9 + (n - 1) * 3 + 3, `${n}.basis`);
      if (sha !== undefined && !SHA.test(sha)) problems.push(`${n}.sha must be a full 40-hex sha`);
      if (tree !== undefined && !SHA.test(tree)) problems.push(`${n}.tree must be a full 40-hex sha`);
      if (basis !== undefined && basis === '') problems.push(`${n}.basis must not be empty`);
      commits.push({ sha, tree, basis });
    }
    if (commits.length > 0 && checkpoint !== undefined && commits[commits.length - 1]?.sha !== checkpoint) {
      problems.push('checkpoint must be the last listed commit sha');
    }
  }
  const tcb = [];
  if (Number.isInteger(count) && count >= 1) {
    const tcbCountLine = 10 + count * 3;
    const tcbCountText = take(tcbCountLine, 'tcb-count');
    const tcbCount = Number(tcbCountText);
    if (!Number.isInteger(tcbCount) || tcbCount < 1 || String(tcbCount) !== tcbCountText) problems.push('tcb-count must be a positive integer');
    if (Number.isInteger(tcbCount) && tcbCount >= 1) {
      for (let n = 1; n <= tcbCount; n += 1) {
        const path = take(tcbCountLine + (n - 1) * 2 + 1, `tcb.${n}.path`);
        const sha256 = take(tcbCountLine + (n - 1) * 2 + 2, `tcb.${n}.sha256`);
        if (path !== undefined && !/^[A-Za-z0-9._/-]+$/u.test(path)) problems.push(`tcb.${n}.path is not a repository path`);
        if (sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(sha256)) problems.push(`tcb.${n}.sha256 must be 64 lowercase hex characters`);
        tcb.push({ path, sha256 });
      }
      const end = tcbCountLine + 1 + tcbCount * 2;
      if (lines.length !== end + 1 || lines[lines.length - 1] !== '') problems.push('exactly one trailing newline and no extra lines');
    }
  }
  return { problems, fields: { repo, prior, checkpoint, keySpkiSha256, nonce, issued, expires, by, count, commits, tcb } };
}

/** Exact first-parent coverage. Order, length, sha and tree all matter. mutant:chain-length mutant:chain-compare */
export function commitsMatch(actual, listed) {
  if (!Array.isArray(actual) || !Array.isArray(listed) || actual.length !== listed.length) return false;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i]?.sha !== listed[i]?.sha || actual[i]?.tree !== listed[i]?.tree) return false;
  }
  return true;
}

export function attestationCoversCommits(parsed, commits, prior) {
  if (!parsed || parsed.problems?.length) return false;
  if (parsed.fields.prior !== prior) return false;
  if (!commitsMatch(commits, parsed.fields.commits)) return false;
  return parsed.fields.checkpoint === commits[commits.length - 1]?.sha;
}

function signatureVerifies(text, signatureB64, material) {
  try {
    if (typeof signatureB64 !== 'string' || signatureB64 === '') return false;
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== signatureB64) return false;
    return verify(null, Buffer.from(text, 'utf8'), material.key, signature) === true;
  } catch {
    return false;
  }
}

/** A diff that only touches the trusted computing base or a checkpoint attestation file. The lander still refuses it. */
export function isCheckpointInstallerDiff(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every((path) => typeof path === 'string' && (TRUSTED_COMPUTING_BASE.includes(path) || ATTESTATION_FILE.test(path)));
}

/**
 * Classify one commit. Recorded founder commits stay non-provenant. A git
 * author name, email, or commit.author.login is never a classification.
 */
export function classifyCommit(commit) {
  const known = RECORDED_RANGE.find((row) => row.sha === commit?.sha);
  if (known) {
    if (known.tree !== commit?.tree) {
      return { sha: commit?.sha, tree: commit?.tree, classification: 'unprovenanced', provenant: false, touchesVerifier: true, reason: `commit ${commit?.sha} is not the recorded tree ${known.tree}` };
    }
    return {
      sha: known.sha,
      tree: known.tree,
      classification: known.classification,
      provenant: false,
      touchesVerifier: known.touchesVerifier,
      basis: known.basis,
      reason: `${known.classification} (#${known.pr}); not provenant until a signed ${CHECKPOINT_HEADER} attestation covers it`,
    };
  }
  if (isCheckpointInstallerDiff(commit?.paths)) {
    return {
      sha: commit.sha,
      tree: commit.tree,
      classification: 'installer',
      provenant: false,
      touchesVerifier: true,
      reason: 'installer commit for the checkpoint attestation; not a signed landing',
    };
  }
  if (commit?.signedLanding === true) {
    return { sha: commit.sha, tree: commit.tree, classification: 'signed-landing', provenant: true, touchesVerifier: false, reason: 'signed landing' };
  }
  if (commit?.signedG6 === true) {
    return { sha: commit.sha, tree: commit.tree, classification: 'signed-g6', provenant: true, touchesVerifier: true, reason: 'signed G6 installer' };
  }
  return {
    sha: commit?.sha,
    tree: commit?.tree,
    classification: 'unprovenanced',
    provenant: false,
    touchesVerifier: commit?.touchesVerifier === true,
    reason: 'not a signed landing, a signed G6 installer, or a commit covered by a signed checkpoint attestation',
  };
}

/**
 * Chain from the trusted checkpoint to the tip.
 * Founder commits stay non-provenant even when a signature covers them: coverage
 * lets a later signed landing or G6 sit on top, and does not reclassify the squash.
 */
export function evaluateTrustChain(input) {
  const tipSha = input?.tipSha;
  const tipTree = input?.tipTree;
  const externalAnchor = input?.externalAnchor;
  const pin = reviewerKeyPinRefusal(input?.reviewerKeyPem, externalAnchor);
  if (tipSha === TRUSTED_CHECKPOINT_SHA && tipTree === TRUSTED_CHECKPOINT_TREE && pin === null) {
    return {
      accepted: true,
      tipProvenant: true,
      reason: `the tip is the trusted checkpoint ${TRUSTED_CHECKPOINT_SHA} (landing #${TRUSTED_CHECKPOINT_PR}, accept-main run ${TRUSTED_CHECKPOINT_ACCEPT_RUN})`,
      classifications: [],
    };
  }
  const commits = Array.isArray(input?.commits) ? input.commits : null;
  if (commits === null) {
    return { accepted: false, tipProvenant: false, reason: 'the first-parent chain from the trusted checkpoint was not supplied', classifications: [] };
  }
  if (commits.length === 0) {
    return { accepted: false, tipProvenant: false, reason: 'the first-parent chain from the trusted checkpoint was not supplied', classifications: [] };
  }
  const classifications = commits.map((commit) => classifyCommit(commit));
  const text = input?.attestationText;
  const parsed = typeof text === 'string' ? parseCheckpointAttestation(text) : { problems: ['no JULIUS-CHECKPOINT-V1 attestation was supplied'], fields: {} };
  const material = reviewerKeyMaterial(input?.reviewerKeyPem);
  const signaturePresent = typeof input?.signatureB64 === 'string' && input.signatureB64 !== '';
  const signatureOk = pin === null && Boolean(material.key) && parsed.problems.length === 0
    && signaturePresent
    && signatureVerifies(text, input?.signatureB64, material)
    && parsed.fields.prior === TRUSTED_CHECKPOINT_SHA
    && parsed.fields.repo?.toLowerCase() === LANDING_REPO.toLowerCase();
  const nonceProblem = signatureOk ? attestationNonceProblems(parsed.fields) : null;
  const windowProblem = signatureOk && typeof input?.now === 'number' ? judgeAttestationWindow(parsed.fields, input.now) : null;
  const signed = signatureOk && nonceProblem === null && windowProblem === null;
  // A signed attestation covers a prefix that starts at the trusted checkpoint.
  // Everything after that prefix has to be a signed landing or a signed G6.
  // Coverage does not make a founder squash provenant.
  let rest = classifications;
  let covered = false;
  if (signed) {
    const listed = parsed.fields.commits ?? [];
    const prefix = commits.slice(0, listed.length);
    if (attestationCoversCommits(parsed, prefix, TRUSTED_CHECKPOINT_SHA)) {
      covered = true;
      rest = classifications.slice(listed.length);
    }
  }
  const restAllowed = (row) => row.classification === 'signed-landing'
    || row.classification === 'signed-g6'
    || (signed && row.classification === 'installer');
  const restBad = rest.filter((row) => !restAllowed(row));
  const illegalTcb = rest.filter((row) => row.touchesVerifier && row.classification !== 'signed-g6' && !(signed && row.classification === 'installer'));
  if (pin || restBad.length > 0 || illegalTcb.length > 0 || nonceProblem || windowProblem) {
    const why = pin?.reason
      ?? (parsed.problems?.[0])
      ?? nonceProblem
      ?? windowProblem
      ?? (typeof text === 'string' && !signatureOk
        ? (signaturePresent
          ? 'the checkpoint attestation signature does not verify against the pinned reviewer key'
          : 'no signed checkpoint attestation covers this chain')
        : null)
      ?? (covered ? illegalTcb[0]?.reason : null)
      ?? restBad[0]?.reason
      ?? 'no signed checkpoint attestation covers this chain';
    return { accepted: false, tipProvenant: false, reason: why, classifications };
  }
  const tip = classifications[classifications.length - 1];
  const tipProvenant = tip?.classification === 'signed-landing' || tip?.classification === 'signed-g6';
  return {
    accepted: true,
    tipProvenant,
    reason: tipProvenant
      ? tip.reason
      : `${tip?.sha} is ${tip?.classification} and is not provenant; the signed attestation only covers the chain`,
    classifications,
  };
}

/** Downgrade a single-commit `provenant` when the chain does not make the tip provenant. Never the reverse. */
export function applyTrustChain(single, chain) {
  if (single?.verdict !== 'provenant') return single;
  if (chain?.tipProvenant === true) return single;
  return {
    ...single,
    verdict: 'unprovenanced',
    reason: chain?.reason ?? 'the trust chain from the accepted checkpoint does not make this tip provenant',
  };
}

export function classifyRecordedRange() {
  return RECORDED_RANGE.map((row) => classifyCommit(row));
}

/** Read-only git. Loaded here, as the other provenance scripts load it, because the ref is a commit id. */
async function git(args, options = {}) {
  const { execFileSync } = await import('node:child_process');
  const stdio = ['ignore', 'pipe', 'pipe'];
  const cwd = options.cwd;
  return options.encoding
    ? execFileSync('git', args, { encoding: options.encoding, stdio, cwd })
    : execFileSync('git', args, { stdio, cwd });
}

function checkpointFileName(name) {
  return /^[0-9a-f]{40}\.txt$/u.test(name);
}

/** The single attestation on disk, or null when the directory is absent or not exactly one file. */
export function readCheckpointAttestation(root = process.cwd()) {
  const dir = join(root, CHECKPOINT_ATTESTATION_DIR);
  let names;
  try { names = readdirSync(dir); } catch { return null; }
  const texts = names.filter(checkpointFileName).sort();
  if (texts.length !== 1) return null;
  const text = readFileSync(join(dir, texts[0]), 'utf8');
  const signaturePath = join(dir, texts[0].replace(/\.txt$/u, '.sig'));
  let signatureB64 = null;
  try { signatureB64 = readFileSync(signaturePath, 'utf8').trim(); } catch { signatureB64 = null; }
  if (signatureB64 === '') signatureB64 = null;
  return { text, signatureB64, fileName: texts[0], path: `${CHECKPOINT_ATTESTATION_DIR}/${texts[0]}` };
}

/**
 * The attested checkpoint, only when the on-disk signature verifies under the pin.
 * An unsigned file does not move the floor.
 */
export function attestedCheckpointFloor(root = process.cwd(), env = process.env, now = Date.now()) {
  const found = readCheckpointAttestation(root);
  if (!found?.text || !found.signatureB64) return null;
  const parsed = parseCheckpointAttestation(found.text);
  if (parsed.problems.length > 0) return null;
  if (attestationNonceProblems(parsed.fields)) return null;
  if (judgeAttestationWindow(parsed.fields, now)) return null;
  let pem;
  try { pem = readFileSync(join(root, '.github/julius-landing/reviewer-ed25519.pub'), 'utf8'); } catch { return null; }
  if (reviewerKeyPinRefusal(pem, env[EXTERNAL_ANCHOR_VARIABLE])) return null;
  const material = reviewerKeyMaterial(pem);
  if (!material.key || !signatureVerifies(found.text, found.signatureB64, material)) return null;
  if (parsed.fields.prior !== TRUSTED_CHECKPOINT_SHA) return null;
  return parsed.fields.checkpoint ?? null;
}

function clearanceFromLandingMessage(message) {
  const text = String(message ?? '');
  const begin = '-----BEGIN JULIUS LANDING-----';
  const end = '-----END JULIUS LANDING-----';
  const first = text.indexOf(begin);
  if (first < 0 || text.indexOf(begin, first + begin.length) !== -1) return null;
  const last = text.indexOf(end);
  if (last < first) return null;
  const block = text.slice(first, last).split('\n');
  const clearanceLine = block.find((line) => line.startsWith('clearance-b64: '));
  const signatureLine = block.find((line) => line.startsWith('signature-b64: '));
  if (!clearanceLine || !signatureLine) return null;
  const clearanceB64 = clearanceLine.slice('clearance-b64: '.length);
  const signatureB64 = signatureLine.slice('signature-b64: '.length);
  let clearance;
  try { clearance = Buffer.from(clearanceB64, 'base64').toString('utf8'); } catch { return null; }
  if (Buffer.from(clearance, 'utf8').toString('base64') !== clearanceB64) return null;
  return { clearance, signatureB64 };
}

async function hardForbidden() {
  const { HARD_FORBIDDEN_PATH } = await import('../.github/julius-landing/land-lib.mjs');
  return HARD_FORBIDDEN_PATH;
}

/** Worktree attestation bytes must be the blobs at HEAD. A dirty swap fails here. */
export async function attestationWorktreeMatchesHead(root = process.cwd()) {
  const dir = join(root, CHECKPOINT_ATTESTATION_DIR);
  let names;
  try { names = readdirSync(dir); } catch {
    return { ok: false, reason: `refused: no checkpoint attestation file is on this tree. ${INSTALLER_RECOVERY}` };
  }
  const files = names.filter((name) => name.endsWith('.txt') || name.endsWith('.sig')).sort();
  if (files.length === 0) return { ok: false, reason: `refused: no checkpoint attestation file is on this tree. ${INSTALLER_RECOVERY}` };
  for (const name of files) {
    const rel = `${CHECKPOINT_ATTESTATION_DIR}/${name}`;
    let headBytes;
    try { headBytes = await git(['show', `HEAD:${rel}`], { cwd: root }); } catch {
      return { ok: false, reason: `refused: ${rel} is not in HEAD` };
    }
    let disk;
    try { disk = readFileSync(join(root, rel)); } catch {
      return { ok: false, reason: `refused: ${rel} was swapped and does not match HEAD` };
    }
    if (!Buffer.isBuffer(headBytes) || !headBytes.equals(disk)) {
      return { ok: false, reason: `refused: ${rel} was swapped and does not match HEAD` };
    }
  }
  return { ok: true, reason: 'the checkpoint attestation files match HEAD' };
}

async function classifyWalkedCommit(commit, pem, anchor, forbidden) {
  if (isCheckpointInstallerDiff(commit.paths)) return { ...commit, classification: 'installer' };
  const block = clearanceFromLandingMessage(commit.message);
  const material = reviewerKeyMaterial(pem);
  const forbiddenHit = commit.paths.some((path) => forbidden.test(path));
  if (block && !forbiddenHit && material.key && reviewerKeyPinRefusal(pem, anchor) === null && signatureVerifies(block.clearance, block.signatureB64, material)) {
    return { ...commit, classification: 'signed-landing' };
  }
  const recorded = classifyCommit(commit);
  return { ...commit, classification: recorded.classification === 'installer' ? 'unprovenanced' : recorded.classification };
}

/**
 * Exit 0 only when a signed checkpoint attestation on main authorizes this tree.
 * Compares the working tree to the attested hashes. Does not compare bytes to 2528ac5c.
 * An env attestation is not a substitute for the governed file and its .sig.
 */
export async function requireTrustedVerifier(env = process.env, options = {}) {
  const root = options.root ?? process.cwd();
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const dir = join(root, CHECKPOINT_ATTESTATION_DIR);
  let names;
  try { names = readdirSync(dir); } catch { return { ok: false, reason: INSTALLER_RECOVERY }; }
  const texts = names.filter(checkpointFileName).sort();
  if (texts.length === 0) return { ok: false, reason: INSTALLER_RECOVERY };
  if (texts.length > 1) return { ok: false, reason: `more than one checkpoint attestation is on main (${texts.join(', ')}). ${INSTALLER_RECOVERY}` };
  const found = readCheckpointAttestation(root);
  if (!found?.signatureB64) return { ok: false, reason: `the checkpoint attestation is unsigned. ${INSTALLER_RECOVERY}` };
  const parsed = parseCheckpointAttestation(found.text);
  if (parsed.problems.length > 0) return { ok: false, reason: parsed.problems[0] };
  if (`${parsed.fields.checkpoint}.txt` !== found.fileName) {
    return { ok: false, reason: `the attestation file ${found.fileName} is not named for checkpoint ${parsed.fields.checkpoint}. ${INSTALLER_RECOVERY}` };
  }
  const nonceProblem = attestationNonceProblems(parsed.fields);
  if (nonceProblem) return { ok: false, reason: nonceProblem };
  const windowProblem = judgeAttestationWindow(parsed.fields, now);
  if (windowProblem) return { ok: false, reason: windowProblem };
  if (parsed.fields.prior !== TRUSTED_CHECKPOINT_SHA) {
    return { ok: false, reason: `the attestation prior is not the trusted checkpoint ${TRUSTED_CHECKPOINT_SHA}` };
  }
  let pem;
  try { pem = readFileSync(join(root, '.github/julius-landing/reviewer-ed25519.pub'), 'utf8'); } catch {
    return { ok: false, reason: 'the reviewer key could not be read' };
  }
  const pin = reviewerKeyPinRefusal(pem, env[EXTERNAL_ANCHOR_VARIABLE]);
  if (pin) return { ok: false, reason: pin.reason };
  const material = reviewerKeyMaterial(pem);
  if (!material.key || !signatureVerifies(found.text, found.signatureB64, material)) {
    return { ok: false, reason: 'the checkpoint attestation signature does not verify against the pinned reviewer key' };
  }
  const listed = parsed.fields.tcb ?? [];
  if (listed.length !== TRUSTED_COMPUTING_BASE.length || listed.some((row, index) => row.path !== TRUSTED_COMPUTING_BASE[index])) {
    return { ok: false, reason: 'the attestation does not cover the trusted computing base' };
  }
  for (const row of listed) {
    let bytes;
    try { bytes = readFileSync(join(root, row.path)); } catch { bytes = null; }
    const actual = bytes ? createHash('sha256').update(bytes).digest('hex') : '';
    if (actual !== row.sha256) return { ok: false, reason: `unprovenanced: ${row.path} is not the attested trusted-file hash` };
  }
  const integrity = await attestationWorktreeMatchesHead(root);
  if (!integrity.ok) return integrity;
  let head = '';
  try { head = String(await git(['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).trim(); } catch { head = ''; }
  if (head === '') return { ok: false, reason: 'the trust chain from the trusted checkpoint could not be read' };
  const checkpoint = parsed.fields.checkpoint;
  if (head !== checkpoint) {
    const forbidden = await hardForbidden();
    const walked = [];
    let sha = head;
    for (let i = 0; i < 30 && sha !== checkpoint; i += 1) {
      let tree = '';
      let message = '';
      let parent = '';
      try {
        tree = String(await git(['rev-parse', `${sha}^{tree}`], { cwd: root, encoding: 'utf8' })).trim();
        message = String(await git(['log', '-1', '--format=%B', sha], { cwd: root, encoding: 'utf8' }));
        const listedPaths = String(await git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha], { cwd: root, encoding: 'utf8' }));
        parent = String(await git(['rev-parse', `${sha}^`], { cwd: root, encoding: 'utf8' })).trim();
        const paths = listedPaths.split('\n').filter((path) => path !== '');
        walked.push(await classifyWalkedCommit({ sha, tree, message, paths }, pem, env[EXTERNAL_ANCHOR_VARIABLE], forbidden));
      } catch {
        return { ok: false, reason: `the first-parent chain does not reach the trusted checkpoint ${checkpoint}. ${INSTALLER_RECOVERY}` };
      }
      sha = parent;
    }
    if (sha !== checkpoint) {
      return { ok: false, reason: `the first-parent chain does not reach the trusted checkpoint ${checkpoint}. ${INSTALLER_RECOVERY}` };
    }
    const unjustified = walked.filter((row) => row.classification !== 'installer' && row.classification !== 'signed-landing' && row.classification !== 'signed-g6');
    if (unjustified.length > 0) {
      return { ok: false, reason: `unprovenanced: HEAD ${head} is not the attested checkpoint ${checkpoint} and the first-parent chain does not justify it (${unjustified[0].sha} is ${unjustified[0].classification})` };
    }
  }
  return { ok: true, reason: `chain verified from attested checkpoint ${checkpoint}` };
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();

if (entrypoint !== null && import.meta.url === entrypoint && process.argv.includes('--require-trusted-verifier')) {
  const result = await requireTrustedVerifier();
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${result.reason}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
