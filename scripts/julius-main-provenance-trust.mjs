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
 * Installer lineage. The attested checkpoint is the floor. Installer status is
 * not a path check that any later commit can satisfy. It is the contiguous
 * run of exact-path commits that starts at the checkpoint and ends at the
 * commit that introduces the attestation `.sig`. Every path in that run is in
 * TRUSTED_COMPUTING_BASE, is one checkpoint attestation file, or is one of
 * CHECKPOINT_INSTALLER_EXACT_PATHS. There is no wildcard. The run counts only
 * when the attestation signature verifies. A companion-only commit after the
 * `.sig`, or an exact-path commit with no signature commit in the run, is
 * unprovenanced. The next commit after that run has to be a signed landing
 * or a signed G6.
 *
 * A signed landing is a JULIUS-CLEARANCE-V1 block. The pinned key must verify
 * it. Its repo, pull request, head, tree and base are read only from that
 * text and must bind to the commit being verified: repo is this repository,
 * tree is the commit's tree, base is its single parent, and the head is the
 * cleared commit (its tree and parent are checked when that object is in the
 * checkout). The validity window is enforced at landing time, against the
 * commit's committer timestamp, not against the clock of a later walk. A new
 * landing whose committer time is outside that window, or more than five
 * minutes ahead of the verifier, is refused. Its nonce may be used once on
 * the first-parent chain, and only after the signature verifies. The walk
 * does not recompute `bot-comments-sha256`: that digest is inside the signed
 * clearance, and the pull-request conversation is not available here. The
 * lander checks the live digest when it creates the landing.
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

let landingLibPromise;
function landingLib() {
  // Literal specifier. A computed import is invisible to the repository boundary scan.
  if (!landingLibPromise) landingLibPromise = import('../.github/julius-landing/land-lib.mjs');
  return landingLibPromise;
}

export const TRUSTED_CHECKPOINT_SHA = '2528ac5c0f0d4303051123a7592ef18e3552ba74';
export const TRUSTED_CHECKPOINT_TREE = '328469e79cd25339e16402f5fac8895c3669b4e1';
export const TRUSTED_CHECKPOINT_HEAD = '897c7138d1c9a673afca4577a61602698517a55f';
export const TRUSTED_CHECKPOINT_BASE = '82fcb5ed0e75b1280d3b4a06f246387195cc77f8';
export const TRUSTED_CHECKPOINT_PR = 389;
export const TRUSTED_CHECKPOINT_ACCEPT_RUN = '39335737220';

/**
 * Full SPKI SHA-256. Never compare a prefix of this. Rotated 2026-10-25 from
 * 7eacf984 (whose private key is not available to the independent review) to
 * the independent-review key recorded in PR #452 comment 6395143765. The
 * outgoing key did not sign the handover. The external anchor
 * JULIUS_REVIEWER_KEY_SHA256 is the only out-of-band confirmation.
 */
export const PINNED_REVIEWER_SPKI_SHA256 = '12c9b1853c4c33322241273f386b0fd08fdefd08134c911dd4024c5bb5cdff13';
/** The 32 raw ed25519 public-key bytes, hex. */
export const PINNED_REVIEWER_RAW_KEY = 'e033a345ed082b8126c8c6d9ad43cb54a4c854fe8c5423c2fc7ed475ee5461b5';
/** The only commit that introduces the reviewer public key (#379). */
export const REVIEWER_KEY_INTRODUCED_IN = 'e56b6bd9d6cd082af897df9bab8475c2323d342c';

export const LANDING_REPO = 'ohdieyuh-glitch/sunday-relay';
export const CHECKPOINT_HEADER = 'JULIUS-CHECKPOINT-V1';
export const EXTERNAL_ANCHOR_VARIABLE = 'JULIUS_REVIEWER_KEY_SHA256';
/** Numeric GitHub user id of the governed-landing App bot. Never a login name. */
export const GOVERNED_LANDER_BOT_VARIABLE = 'JULIUS_GOVERNED_LANDER_BOT_ID';

/**
 * Files whose bytes are the trust root. Workflows execute the verifier from
 * the checkpoint copy of these paths. The unsigned attestation document is
 * not in this list: it is not authority until the pinned key signs it.
 */
export const TRUSTED_COMPUTING_BASE = Object.freeze([
  '.github/julius-landing/reviewer-ed25519.pub',
  '.github/julius-landing/founder-approval-ed25519.pub',
  '.github/julius-landing/land-lib.mjs',
  '.github/julius-landing/land.mjs',
  '.github/julius-landing/governed-land.mjs',
  '.github/julius-landing/governed-queue.txt',
  '.github/julius-landing/main-ruleset.json',
  '.github/julius-landing/reviewer-tools.mjs',
  '.github/julius-landing/allowed-branches.txt',
  '.github/julius-landing/required-checks.txt',
  '.github/workflows/julius-accept-main.yml',
  '.github/workflows/julius-land.yml',
  '.github/workflows/julius-governed-land.yml',
  'scripts/julius-main-provenance.mjs',
  'scripts/julius-main-provenance.d.mts',
  'scripts/julius-main-provenance-trust.mjs',
  'scripts/julius-main-provenance-trust.d.mts',
  'scripts/julius-review-currency.mjs',
  'scripts/julius-governed-bootstrap.mjs',
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

const ATTESTATION_FILE = /^\.github\/julius-landing\/checkpoints\/[0-9a-f]{40}\.(txt|sig|founder\.sig)$/iu;
/** The files one attestation occupies in the checkpoint directory. Nothing else may sit there. */
export const CHECKPOINT_DIRECTORY_SUFFIXES = Object.freeze(['.txt', '.sig', '.founder.sig']);

/**
 * Exact companion files of the founder installer, besides the trusted
 * computing base and the checkpoint attestation files. One path each.
 * A glob would let a later commit carry arbitrary code.
 */
export const CHECKPOINT_INSTALLER_EXACT_PATHS = Object.freeze([
  '.github/julius-landing/README.md',
  'docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt',
  'scripts/julius-landing.test.ts',
  'scripts/julius-main-provenance-signed.test.ts',
  'scripts/julius-main-provenance-trust-liveness.test.ts',
  'scripts/julius-main-provenance-trust.test.ts',
]);

const CLEARANCE_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** The first-parent walk refuses rather than trusting a prefix of a longer chain. */
export const FIRST_PARENT_WALK_CAP = 30;

export function firstParentWalkCapReason(checkpoint) {
  return `the first-parent walk stopped after ${FIRST_PARENT_WALK_CAP} commits without reaching checkpoint ${checkpoint}. Refusing.`;
}

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

/**
 * THE SECOND SAFEGUARD (H1). A reviewer signature alone does not land a
 * founder-governed path, a protected-paths entry, a trusted file, a workflow,
 * or a checkpoint attestation (the bootstrap included). Those also need a pure
 * Ed25519 signature over the exact same UTF-8 bytes from the founder-approval
 * key, which is held off the development machine.
 *
 * The pin is the SPKI PEM at FOUNDER_APPROVAL_KEY_PATH, which is in the
 * trusted computing base, so its bytes are signed into every attestation. The
 * anchor is the repository variable JULIUS_FOUNDER_APPROVAL_KEY_SHA256, the
 * lowercase-hex sha256 of that key's SPKI DER. The pin must equal the anchor,
 * and it must not be the reviewer key. This tree ships with the pin file
 * absent: every check that needs the founder refuses with
 * founder_key_unpinned. The first pin arrives in the bootstrap target, whose
 * attestation hashes the key file and which the founder signs.
 */
export const FOUNDER_APPROVAL_KEY_PATH = '.github/julius-landing/founder-approval-ed25519.pub';
export const FOUNDER_ANCHOR_VARIABLE = 'JULIUS_FOUNDER_APPROVAL_KEY_SHA256';
/** The distinct refusal codes. Each refusal text starts with "founder approval: <code>:" or "<code>:". */
export const FOUNDER_REFUSAL = Object.freeze({
  signatureMissing: 'founder_signature_missing',
  keyUnpinned: 'founder_key_unpinned',
  anchorMismatch: 'founder_anchor_mismatch',
  signatureInvalid: 'founder_signature_invalid',
  reviewerSignatureMissing: 'reviewer_signature_missing',
});
export const FOUNDER_KEY_NOT_PINNED = `founder approval: ${FOUNDER_REFUSAL.keyUnpinned}: no founder-approval key is pinned at ${FOUNDER_APPROVAL_KEY_PATH}, so a governed path, trusted file, workflow, or attestation cannot land`;

/** Null when the founder-approval key file is an ed25519 key, independent of the reviewer key, and equal to its anchor. */
export function founderKeyPinRefusal(pem, externalAnchor) {
  if (typeof pem !== 'string' || pem.trim() === '') return FOUNDER_KEY_NOT_PINNED;
  const material = reviewerKeyMaterial(pem);
  if (material.problem) return `founder approval: ${FOUNDER_REFUSAL.keyUnpinned}: ${FOUNDER_APPROVAL_KEY_PATH} is not an ed25519 SPKI public key`;
  if (exactFingerprintMatch(material.spkiSha256, PINNED_REVIEWER_SPKI_SHA256)) {
    return `founder approval: ${FOUNDER_REFUSAL.keyUnpinned}: the founder-approval key is the reviewer key; it must be an independent key`;
  }
  if (!exactFingerprintMatch(externalAnchor, material.spkiSha256)) {
    return externalAnchor === undefined || externalAnchor === null || externalAnchor === ''
      ? `founder approval: ${FOUNDER_REFUSAL.anchorMismatch}: ${FOUNDER_ANCHOR_VARIABLE} is unset`
      : `founder approval: ${FOUNDER_REFUSAL.anchorMismatch}: ${FOUNDER_ANCHOR_VARIABLE} does not match the sha256 of the pinned founder-approval key`;
  }
  return null;
}

/**
 * Null when `signatureB64` is the pinned founder-approval key's signature over
 * exactly `text`. `pem` is the founder-approval key file, checked against its
 * anchor. Pass `pinned: false` only to check a signature against a key whose
 * bytes are already bound by a signed attestation (a rotation's post-landing key).
 */
export function founderApprovalProblem({ text, signatureB64, pem, anchor, pinned = true } = {}) {
  if (typeof signatureB64 !== 'string' || signatureB64 === '') {
    return `founder approval: ${FOUNDER_REFUSAL.signatureMissing}: no founder-approval signature was supplied`;
  }
  if (pinned) {
    const refusal = founderKeyPinRefusal(pem, anchor);
    if (refusal) return refusal;
  }
  const material = reviewerKeyMaterial(pem);
  if (!material.key) return FOUNDER_KEY_NOT_PINNED;
  if (typeof text !== 'string' || !signatureVerifies(text, signatureB64, material)) {
    return `founder approval: ${FOUNDER_REFUSAL.signatureInvalid}: the founder-approval signature does not verify over these exact bytes`;
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

/**
 * The attestation signature must verify against the pinned key, and every
 * trusted-file hash in it must be the post-landing tree. Presence of the file
 * is not that proof. Any failure is a refusal; the caller says the attestation
 * was not verified.
 */
export function checkpointAttestationProblems({ text, signatureB64, pem, treeHashes, now, founderSignatureB64, founderPem, founderAnchor, founderPinned = true } = {}) {
  if (typeof text !== 'string' || text === '') return ['the checkpoint attestation was not verified'];
  if (typeof signatureB64 !== 'string' || signatureB64 === '') {
    return ['the checkpoint attestation was not verified', `${FOUNDER_REFUSAL.reviewerSignatureMissing}: the attestation has no reviewer signature`];
  }
  const parsed = parseCheckpointAttestation(text);
  if (parsed.problems.length > 0) return ['the checkpoint attestation was not verified'];
  const material = reviewerKeyMaterial(pem);
  if (!material.key || !signatureVerifies(text, signatureB64, material)) return ['the checkpoint attestation was not verified'];
  const listed = parsed.fields.tcb ?? [];
  if (listed.length !== TRUSTED_COMPUTING_BASE.length || listed.some((row, index) => row.path !== TRUSTED_COMPUTING_BASE[index])) {
    return ['the checkpoint attestation was not verified'];
  }
  if (!treeHashes || typeof treeHashes !== 'object') return ['the checkpoint attestation was not verified'];
  for (const row of listed) {
    if (treeHashes[row.path] !== row.sha256) return ['the checkpoint attestation was not verified'];
  }
  if (judgeAttestationWindow(parsed.fields, now)) return ['the checkpoint attestation was not verified'];
  const founder = founderApprovalProblem({ text, signatureB64: founderSignatureB64, pem: founderPem, anchor: founderAnchor, pinned: founderPinned });
  if (founder) return ['the checkpoint attestation was not verified', founder];
  return [];
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

/** A diff that only touches the installer allowlist. The lander still refuses it. */
export function isCheckpointInstallerDiff(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  const allowed = new Set([...TRUSTED_COMPUTING_BASE, ...CHECKPOINT_INSTALLER_EXACT_PATHS]);
  return paths.every((path) => typeof path === 'string' && path !== '' && !/[*?[\]{}]/u.test(path) && (allowed.has(path) || ATTESTATION_FILE.test(path)));
}

/**
 * A protected-path or trusted-file landing is the governed lander's only when
 * GitHub's commits API says the committer user id is the pinned bot and the
 * signature is verified. A matching name is not that proof. `botId` is the
 * repository variable JULIUS_GOVERNED_LANDER_BOT_ID.
 */
/** A governed audit branch is not a pull request head or base. `ref` may be `refs/heads/...` or the branch name. */
export function governedAuditBranchProblem(ref) {
  if (typeof ref !== 'string' || ref === '') return null;
  const name = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  if (name === 'julius-governed-audit' || name.startsWith('julius-governed-audit/')) {
    return `${ref} is a governed audit branch and cannot be a pull request head or base`;
  }
  return null;
}

export function landingIdentityProblem({ committerId, verificationVerified, verificationReason, botId, verificationReadProblem } = {}) {
  if (typeof verificationReadProblem === 'string' && verificationReadProblem !== '') return verificationReadProblem;
  const id = typeof botId === 'string' ? botId.trim() : '';
  if (!/^[1-9][0-9]{0,16}$/u.test(id)) return `${GOVERNED_LANDER_BOT_VARIABLE} is unset`;
  if (String(committerId ?? '') !== id) return `the landing committer id is not the governed lander bot ${id}`;
  if (verificationVerified !== true || verificationReason !== 'valid') return 'the landing commit has no GitHub-verified signature';
  return null;
}

/** Trusted files, including the governed lander, move only together with a checkpoint attestation. Fast-forward is that bootstrap shape only. */
export function governedLandingShapeProblem(files, method) {
  const list = Array.isArray(files) ? files.filter((path) => typeof path === 'string') : [];
  const trusted = list.some((path) => TRUSTED_COMPUTING_BASE.includes(path));
  const paired = list.some((path) => ATTESTATION_FILE.test(path));
  if (trusted && !paired) return 'a landing that changes a trusted file must be paired with a checkpoint attestation';
  if (method === 'fast-forward' && (!paired || isCheckpointInstallerDiff(list) !== true)) {
    return 'fast-forward is only for a checkpoint or bootstrap landing';
  }
  return null;
}

/** A trusted file or a checkpoint attestation file in the diff has to be signature-checked before main moves. */
export function checkpointPairingRequired(files) {
  const list = Array.isArray(files) ? files : [];
  return list.some((path) => typeof path === 'string' && (TRUSTED_COMPUTING_BASE.includes(path) || ATTESTATION_FILE.test(path)));
}

function introducesAttestationSignature(commit) {
  return Array.isArray(commit?.paths) && commit.paths.some((path) => typeof path === 'string' && ATTESTATION_FILE.test(path) && path.toLowerCase().endsWith('.sig'));
}

/**
 * Installer status is the signed lineage only: a contiguous exact-path prefix
 * that ends at the commit introducing the attestation signature. Paths alone,
 * or a later companion commit, do not qualify. An unsigned attestation qualifies nothing.
 */
export function markInstallerLineage(commits, attestationSigned) {
  if (!attestationSigned || !Array.isArray(commits)) return Array.isArray(commits) ? commits : [];
  let signatureAt = -1;
  for (let index = 0; index < commits.length; index += 1) {
    if (!isCheckpointInstallerDiff(commits[index]?.paths)) break;
    if (introducesAttestationSignature(commits[index])) {
      signatureAt = index;
      break;
    }
  }
  if (signatureAt < 0) return commits;
  return commits.map((commit, index) => (index <= signatureAt ? { ...commit, installerLineage: true } : commit));
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
  if (commit?.installerLineage === true) {
    return {
      sha: commit.sha,
      tree: commit.tree,
      classification: 'installer',
      provenant: false,
      touchesVerifier: true,
      reason: 'installer commit in the signed checkpoint lineage',
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
  const classifications = markInstallerLineage(commits, signed).map((commit) => classifyCommit(commit));
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
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return options.encoding
    ? execFileSync('git', args, { encoding: options.encoding, stdio, cwd, env })
    : execFileSync('git', args, { stdio, cwd, env });
}

function checkpointFileName(name) {
  return /^[0-9a-f]{40}\.txt$/u.test(name);
}

/**
 * The shape every gate requires of the checkpoint directory, before any key or
 * clock is consulted: exactly one `<checkpoint>.txt`, its `.sig`, no other
 * file, a parseable text named for its own checkpoint, a nonce that binds the
 * listed lines, and the trusted checkpoint as `prior`. The bootstrap applies
 * this to the directory it is about to install and the governed lander to the
 * head it is about to land, so neither can produce a main the verifier refuses
 * for its shape. Returns the first problem, or null.
 */
export function attestationShapeProblem({ names, text } = {}) {
  const list = Array.isArray(names) ? names.map(String) : [];
  const texts = list.filter(checkpointFileName).sort();
  if (texts.length === 0) return INSTALLER_RECOVERY;
  if (texts.length > 1) return `more than one checkpoint attestation is on main (${texts.join(', ')}). ${INSTALLER_RECOVERY}`;
  const stem = texts[0].replace(/\.txt$/u, '');
  const allowed = new Set(CHECKPOINT_DIRECTORY_SUFFIXES.map((suffix) => `${stem}${suffix}`));
  const stray = list.filter((name) => !allowed.has(name)).sort();
  if (stray.length > 0) return `the checkpoint directory holds files that are not this attestation (${stray.join(', ')}). ${INSTALLER_RECOVERY}`;
  if (!list.includes(`${stem}.sig`)) return `${FOUNDER_REFUSAL.reviewerSignatureMissing}: the checkpoint attestation is unsigned. ${INSTALLER_RECOVERY}`;
  if (!list.includes(`${stem}.founder.sig`)) return `${FOUNDER_REFUSAL.signatureMissing}: the checkpoint attestation has no founder-approval signature (${stem}.founder.sig). ${INSTALLER_RECOVERY}`;
  if (typeof text !== 'string' || text === '') return `the checkpoint attestation is unsigned. ${INSTALLER_RECOVERY}`;
  const parsed = parseCheckpointAttestation(text);
  if (parsed.problems.length > 0) return parsed.problems[0];
  if (`${parsed.fields.checkpoint}.txt` !== texts[0]) {
    return `the attestation file ${texts[0]} is not named for checkpoint ${parsed.fields.checkpoint}. ${INSTALLER_RECOVERY}`;
  }
  const nonceProblem = attestationNonceProblems(parsed.fields);
  if (nonceProblem) return nonceProblem;
  if (parsed.fields.prior !== TRUSTED_CHECKPOINT_SHA) return `the attestation prior is not the trusted checkpoint ${TRUSTED_CHECKPOINT_SHA}`;
  return null;
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
  let founderSignatureB64 = null;
  try { founderSignatureB64 = readFileSync(join(dir, texts[0].replace(/.txt$/u, '.founder.sig')), 'utf8').trim(); } catch { founderSignatureB64 = null; }
  if (founderSignatureB64 === '') founderSignatureB64 = null;
  return { text, signatureB64, founderSignatureB64, fileName: texts[0], path: `${CHECKPOINT_ATTESTATION_DIR}/${texts[0]}` };
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
  let founderPem;
  try { founderPem = readFileSync(join(root, FOUNDER_APPROVAL_KEY_PATH), 'utf8'); } catch { return null; }
  if (founderApprovalProblem({ text: found.text, signatureB64: found.founderSignatureB64 ?? '', pem: founderPem, anchor: env[FOUNDER_ANCHOR_VARIABLE] })) return null;
  return parsed.fields.checkpoint ?? null;
}

function withSingleTrailingNewline(message) {
  return `${String(message ?? '').replace(/\n+$/u, '')}\n`;
}

/** Clock check for a JULIUS-CLEARANCE-V1. `issued` may be up to five minutes ahead. Lifetime is at most 24 hours. */
export function judgeClearanceWindow(fields, now, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (typeof now !== 'number' || !Number.isFinite(now)) return 'the clearance clock is not a finite timestamp';
  const issued = Date.parse(fields?.issued ?? '');
  const expires = Date.parse(fields?.expires ?? '');
  if (Number.isNaN(issued) || Number.isNaN(expires)) return 'the clearance timestamps are not valid';
  if (expires <= issued) return 'the clearance expires at or before it was issued';
  if (expires - issued > maxAgeMs) return 'the clearance lifetime exceeds 24 hours';
  if (now - issued < -CLEARANCE_FUTURE_SKEW_MS) return 'the clearance is not yet valid';
  if (now > expires) return 'the clearance has expired';
  return null;
}

/**
 * A landing block authorizes this commit only when the signed clearance is
 * well-formed, the pinned key verifies it, and repo, pull request, head, tree
 * and base bind to this commit. The validity window is the commit's committer
 * time. `seenNonces` records a nonce only after that signature verifies. A
 * missing block is `absent`; anything else is a refusal. The signed
 * `bot-comments-sha256` is not recomputed here: this walk has no pull-request
 * conversation to digest.
 */
export async function judgeCommitLanding(commit, options = {}) {
  const message = commit?.message;
  if (typeof message !== 'string' || !message.includes('BEGIN JULIUS LANDING')) {
    return { ok: false, absent: true, reason: 'no landing block' };
  }
  const { parseLandingCommitMessage, MAX_CLEARANCE_AGE_MS, unauthorizedGovernedPaths, unusedProtectedPaths } = await landingLib();
  const parsed = parseLandingCommitMessage(withSingleTrailingNewline(message));
  const clearance = parsed.fields?.clearance;
  if (parsed.problems.length > 0 || !clearance) {
    return {
      ok: false,
      absent: false,
      reason: `the landing block is not a JULIUS-CLEARANCE-V1 clearance: ${parsed.problems[0] ?? 'the clearance did not parse'}`,
    };
  }
  const nonce = clearance.nonce;
  const seen = options.seenNonces;
  if (seen instanceof Set && seen.has(nonce)) {
    return { ok: false, absent: false, nonce, reason: `the clearance nonce ${nonce} was already used on this first-parent chain` };
  }
  const pin = reviewerKeyPinRefusal(options.pem, options.anchor);
  if (pin) return { ok: false, absent: false, nonce, reason: pin.reason };
  const material = reviewerKeyMaterial(options.pem);
  if (!material.key || !signatureVerifies(parsed.fields.clearanceText, parsed.fields.signatureB64, material)) {
    return { ok: false, absent: false, nonce, reason: 'the landing signature does not verify against the pinned reviewer key' };
  }
  if (seen instanceof Set) seen.add(nonce);
  const committerTime = typeof commit?.committerTime === 'number' && Number.isFinite(commit.committerTime) ? commit.committerTime : null;
  if (committerTime === null) return { ok: false, absent: false, nonce, reason: 'the landing time could not be read' };
  if (typeof options.now === 'number' && Number.isFinite(options.now) && committerTime > options.now + CLEARANCE_FUTURE_SKEW_MS) {
    return { ok: false, absent: false, nonce, reason: 'the landing time is in the future' };
  }
  const windowProblem = judgeClearanceWindow(clearance, committerTime, MAX_CLEARANCE_AGE_MS);
  if (windowProblem) return { ok: false, absent: false, nonce, reason: windowProblem };
  if (clearance.tree !== commit?.tree) {
    return {
      ok: false,
      absent: false,
      nonce,
      reason: `the reviewer signed tree ${clearance.tree} for pull request #${clearance.pr} (head ${clearance.head}), this commit carries ${commit?.tree ?? 'an unreadable tree'}`,
    };
  }
  if (typeof commit?.parent !== 'string' || clearance.base !== commit.parent) {
    return {
      ok: false,
      absent: false,
      nonce,
      reason: `the reviewer signed base ${clearance.base} for pull request #${clearance.pr} (head ${clearance.head}), this commit's parent is ${commit?.parent ?? 'unreadable'}`,
    };
  }
  if (commit?.parentCount !== undefined && commit.parentCount !== 1) {
    return { ok: false, absent: false, nonce, reason: `a signed landing has exactly one parent, this commit has ${commit.parentCount}` };
  }
  if (typeof commit?.headTree === 'string' && commit.headTree !== clearance.tree) {
    return {
      ok: false,
      absent: false,
      nonce,
      reason: `the cleared head ${clearance.head} carries tree ${commit.headTree}, not the signed tree ${clearance.tree}`,
    };
  }
  const governedHead = clearance['landing-method'] === 'squash' || clearance['landing-method'] === 'fast-forward';
  if (!governedHead && commit?.headParentCount !== undefined && commit.headParentCount !== 1) {
    return { ok: false, absent: false, nonce, reason: `the cleared head ${clearance.head} is not one commit on the signed base` };
  }
  if (!governedHead && typeof commit?.headParent === 'string' && commit.headParent !== clearance.base) {
    return {
      ok: false,
      absent: false,
      nonce,
      reason: `the cleared head ${clearance.head} sits on ${commit.headParent}, not the signed base ${clearance.base}`,
    };
  }
  const paths = commit?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((path) => typeof path === 'string' && path !== '')) {
    return { ok: false, absent: false, nonce, reason: 'the paths this landing changes could not be read completely' };
  }
  const governed = unauthorizedGovernedPaths(paths, clearance);
  if (governed.length > 0) {
    return { ok: false, absent: false, nonce, reason: `a signed landing may not change founder-governed paths: ${governed.slice(0, 5).join(', ')}` };
  }
  const unused = unusedProtectedPaths(paths, clearance);
  if (unused.length > 0) {
    return { ok: false, absent: false, nonce, reason: `the signed clearance lists protected paths this landing does not change: ${unused.slice(0, 5).join(', ')}` };
  }
  const { HARD_FORBIDDEN_PATH } = await landingLib();
  const needsLander = paths.some((path) => HARD_FORBIDDEN_PATH.test(path) || TRUSTED_COMPUTING_BASE.includes(path));
  if (needsLander) {
    const botId = options.governedLanderBotId ?? options.env?.[GOVERNED_LANDER_BOT_VARIABLE] ?? process.env[GOVERNED_LANDER_BOT_VARIABLE];
    const identity = landingIdentityProblem({
      committerId: commit?.committerId,
      verificationVerified: commit?.verificationVerified,
      verificationReason: commit?.verificationReason,
      verificationReadProblem: commit?.verificationReadProblem,
      botId,
    });
    if (identity) return { ok: false, absent: false, nonce, reason: identity };
    // H1: the governed App committer is not enough. The founder-approval key
    // must have signed these exact clearance bytes, carried in the landing block.
    const founder = founderApprovalProblem({
      text: parsed.fields.clearanceText,
      signatureB64: parsed.fields.founderSignatureB64 ?? '',
      pem: options.founderPem,
      anchor: options.founderAnchor ?? options.env?.[FOUNDER_ANCHOR_VARIABLE] ?? process.env[FOUNDER_ANCHOR_VARIABLE],
    });
    if (founder) return { ok: false, absent: false, nonce, reason: founder };
  }
  return {
    ok: true,
    absent: false,
    nonce,
    pr: clearance.pr,
    head: clearance.head,
    reason: `signed landing for pull request #${clearance.pr} (head ${clearance.head}, tree ${clearance.tree}, base ${clearance.base}) in ${LANDING_REPO}`,
  };
}

/**
 * Mark a chain commit as a signed landing only after its own clearance verifies.
 * A caller-supplied flag on an ancestor is not evidence.
 */
export async function annotateChainLandings(commits, options = {}) {
  if (!Array.isArray(commits)) return commits;
  const seen = options.seenNonces instanceof Set ? options.seenNonces : new Set();
  const annotated = [];
  for (const commit of commits) {
    const judged = await judgeCommitLanding(commit, { ...options, seenNonces: seen });
    if (!judged.ok) {
      if (commit && Object.prototype.hasOwnProperty.call(commit, 'signedLanding')) {
        const next = { ...commit };
        delete next.signedLanding;
        annotated.push(next);
      } else {
        annotated.push(commit);
      }
    } else {
      annotated.push({ ...commit, signedLanding: true });
    }
  }
  return annotated;
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

function commitObject(raw) {
  const text = String(raw);
  const split = text.indexOf('\n\n');
  const header = split >= 0 ? text.slice(0, split) : text;
  const message = split >= 0 ? text.slice(split + 2) : '';
  const lines = header.split('\n');
  const tree = lines.find((line) => line.startsWith('tree '))?.slice('tree '.length) ?? '';
  const parents = lines.filter((line) => line.startsWith('parent ')).map((line) => line.slice('parent '.length));
  const committer = lines.find((line) => line.startsWith('committer '));
  const committerSeconds = /^committer .* (\d+) [+-]\d{4}$/u.exec(committer ?? '');
  const committerTime = committerSeconds ? Number(committerSeconds[1]) * 1000 : undefined;
  return { tree, message, parents, committerTime: Number.isFinite(committerTime) ? committerTime : undefined };
}

function pathsFromNameStatus(text) {
  const paths = [];
  for (const line of String(text).split('\n')) {
    if (line === '') continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0];
    if (status.startsWith('R') || status.startsWith('C')) {
      for (const path of parts.slice(1)) if (path !== '') paths.push(path);
    } else if (parts[1] !== '') {
      paths.push(parts[1]);
    }
  }
  return paths;
}

async function objectExists(spec, root) {
  try {
    await git(['cat-file', '-e', spec], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function deepenHistory(root) {
  try {
    const shallow = String(await git(['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' })).trim();
    if (shallow !== 'true') return false;
  } catch {
    return false;
  }
  try {
    await git(['fetch', '--deepen=100', 'origin'], { cwd: root, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

const HISTORY_MISSING = (sha) => `history is missing: the parent of ${sha} is not in this checkout. A depth-1 checkout cannot verify the first-parent chain. Fetch that history and rerun.`;

async function attachHeadBinding(commit, root) {
  if (typeof commit.message !== 'string' || !commit.message.includes('BEGIN JULIUS LANDING')) return commit;
  const { parseLandingCommitMessage } = await landingLib();
  const parsed = parseLandingCommitMessage(withSingleTrailingNewline(commit.message));
  const head = parsed.fields?.clearance?.head;
  if (typeof head !== 'string' || !SHA.test(head)) return commit;
  if (!(await objectExists(`${head}^{commit}`, root))) return commit;
  try {
    const tree = String(await git(['rev-parse', `${head}^{tree}`], { cwd: root, encoding: 'utf8' })).trim();
    const raw = String(await git(['cat-file', '-p', head], { cwd: root, encoding: 'utf8' }));
    const parents = commitObject(raw).parents;
    return {
      ...commit,
      headTree: tree,
      headParent: parents.length === 1 ? parents[0] : undefined,
      headParentCount: parents.length,
    };
  } catch {
    return commit;
  }
}

async function fetchGithubCommitIdentity(sha, env) {
  const token = typeof env?.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN !== ''
    ? env.GITHUB_TOKEN
    : (typeof env?.GH_TOKEN === 'string' && env.GH_TOKEN !== '' ? env.GH_TOKEN : '');
  if (token === '' || typeof sha !== 'string' || !SHA.test(sha)) return { problem: 'the GitHub commit verification could not be read' };
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${LANDING_REPO}/commits/${sha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { problem: 'the GitHub commit verification could not be read' };
  }
  if (!response.ok) return { problem: 'the GitHub commit verification could not be read' };
  let body;
  try { body = await response.json(); } catch { return { problem: 'the GitHub commit verification could not be read' }; }
  return {
    committerId: body?.committer?.id,
    verificationVerified: body?.commit?.verification?.verified === true,
    verificationReason: typeof body?.commit?.verification?.reason === 'string' ? body.commit.verification.reason : '',
  };
}

async function attachLanderIdentity(commit, env, identities) {
  const message = typeof commit?.message === 'string' ? commit.message : '';
  const paths = Array.isArray(commit?.paths) ? commit.paths : [];
  if (!message.includes('BEGIN JULIUS LANDING')) return commit;
  const { HARD_FORBIDDEN_PATH } = await landingLib();
  const needs = paths.some((path) => HARD_FORBIDDEN_PATH.test(path) || TRUSTED_COMPUTING_BASE.includes(path));
  if (!needs) return commit;
  const preset = identities && typeof commit?.sha === 'string' ? identities[commit.sha] : undefined;
  if (preset && typeof preset === 'object') return { ...commit, ...preset };
  const identity = await fetchGithubCommitIdentity(commit.sha, env);
  if (identity.problem) return { ...commit, verificationReadProblem: identity.problem };
  return { ...commit, ...identity };
}

async function classifyWalkedCommit(commit, pem, anchor, now, seen, env, founder = {}) {
  if (commit.installerLineage === true) {
    await judgeCommitLanding(commit, { pem, anchor, now, seenNonces: seen, env, ...founder });
    return { ...commit, classification: 'installer', reason: 'installer commit in the signed checkpoint lineage' };
  }
  const judged = await judgeCommitLanding(commit, { pem, anchor, now, seenNonces: seen, env, ...founder });
  if (judged.ok) return { ...commit, classification: 'signed-landing', reason: judged.reason, nonce: judged.nonce };
  if (!judged.absent) return { ...commit, classification: 'unprovenanced', reason: judged.reason };
  const recorded = classifyCommit(commit);
  return {
    ...commit,
    classification: recorded.classification === 'installer' ? 'unprovenanced' : recorded.classification,
    reason: recorded.reason,
  };
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
  const found = texts.length === 1 ? readCheckpointAttestation(root) : null;
  const shape = attestationShapeProblem({ names, text: found?.signatureB64 ? found.text : '' });
  if (shape) return { ok: false, reason: shape };
  const parsed = parseCheckpointAttestation(found.text);
  const windowProblem = judgeAttestationWindow(parsed.fields, now);
  if (windowProblem) return { ok: false, reason: windowProblem };
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
  let founderPem = '';
  try { founderPem = readFileSync(join(root, FOUNDER_APPROVAL_KEY_PATH), 'utf8'); } catch { founderPem = ''; }
  const founder = founderApprovalProblem({ text: found.text, signatureB64: found.founderSignatureB64 ?? '', pem: founderPem, anchor: env[FOUNDER_ANCHOR_VARIABLE] });
  if (founder) return { ok: false, reason: `the checkpoint attestation is not founder-approved: ${founder}` };
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
    const walked = [];
    let sha = head;
    let deepened = false;
    let steps = 0;
    for (let i = 0; i < FIRST_PARENT_WALK_CAP && sha !== checkpoint; i += 1) {
      let raw;
      try {
        raw = String(await git(['cat-file', '-p', sha], { cwd: root, encoding: 'utf8' }));
      } catch {
        return { ok: false, reason: `history is missing: commit ${sha} is not in this checkout. Fetch the first-parent history and rerun.` };
      }
      steps += 1;
      const body = commitObject(raw);
      if (body.parents.length === 0) {
        return { ok: false, reason: `the first-parent chain does not reach the trusted checkpoint ${checkpoint}. ${INSTALLER_RECOVERY}` };
      }
      const parent = body.parents[0];
      if (!(await objectExists(`${parent}^{commit}`, root))) {
        if (!deepened) {
          deepened = true;
          await deepenHistory(root);
        }
        if (!(await objectExists(`${parent}^{commit}`, root))) return { ok: false, reason: HISTORY_MISSING(sha) };
      }
      let listed;
      try {
        listed = String(await git(['diff-tree', '--no-commit-id', '--name-status', '--find-renames', '-r', sha], { cwd: root, encoding: 'utf8' }));
      } catch {
        return { ok: false, reason: HISTORY_MISSING(sha) };
      }
      walked.push({
        sha,
        tree: body.tree,
        message: body.message,
        paths: pathsFromNameStatus(listed),
        parent,
        parentCount: body.parents.length,
        committerTime: body.committerTime,
      });
      sha = parent;
    }
    if (sha !== checkpoint) {
      if (steps >= FIRST_PARENT_WALK_CAP) return { ok: false, reason: firstParentWalkCapReason(checkpoint) };
      return { ok: false, reason: `the first-parent chain does not reach the trusted checkpoint ${checkpoint}. ${INSTALLER_RECOVERY}` };
    }
    const seen = new Set();
    const classified = [];
    for (const commit of markInstallerLineage(walked.slice().reverse(), true)) {
      const bound = await attachHeadBinding(commit, root);
      const identified = await attachLanderIdentity(bound, env, options.identities);
      classified.push(await classifyWalkedCommit(identified, pem, env[EXTERNAL_ANCHOR_VARIABLE], now, seen, env, { founderPem, founderAnchor: env[FOUNDER_ANCHOR_VARIABLE] }));
    }
    const unjustified = classified.filter((row) => row.classification !== 'installer' && row.classification !== 'signed-landing' && row.classification !== 'signed-g6');
    if (unjustified.length > 0) {
      const row = unjustified[0];
      const detail = row.reason ? `: ${row.reason}` : '';
      return { ok: false, reason: `unprovenanced: HEAD ${head} is not the attested checkpoint ${checkpoint} and the first-parent chain does not justify it (${row.sha} is ${row.classification}${detail})` };
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
