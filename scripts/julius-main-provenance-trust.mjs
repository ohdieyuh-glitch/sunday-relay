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
 * `julius-accepted-main-<sha>`. Workflows run this verifier from that
 * checkpoint, not from the tip under test.
 *
 * A JULIUS-CHECKPOINT-V1 attestation is how the Independent Reviewer extends
 * the floor across founder commits that are not themselves signed landings.
 * The unsigned text for 2528ac5c..f539cab2 is
 * `docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt`. This module
 * parses that text. It does not treat the file as acceptance: acceptance needs
 * a signature under the pinned key. Nothing here signs.
 *
 * TRUSTED COMPUTING BASE. A change to any of these files changes what the gate
 * trusts. Such a change is unprovenanced unless a signed G6 installer, or a
 * signed checkpoint attestation that names the resulting commit and tree,
 * verifies under the anchor in force at the previous checkpoint.
 */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
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
    basis: "the founder's exact-head APPROVED review at 5936fde4, which has the same tree. Kaisin INDEPENDENT_REVIEW records ce9963 (sha256 a1bb4cb47512678c16a9c62ad8b61a909993470b6df3b2bb57411d8b82ce1390; ACCEPTED head 98a674bd, tree 75a61ea2) and 08a19b (sha256 6d0da2a5dd66bbc711c334708d74020793d28eb6608120e82c4a4b86df212149; A1 MERGE VERIFIED). Tree-verified. These are unsigned, self-registered reviewer records, and NOT Skywalker's review.",
  }),
  Object.freeze({
    sha: '689d2be92c3158ba4a59883ed4f6cc02f700660b',
    tree: 'ecfe4f5c047cf1727a80cf459bd5a0a319f80adb',
    pr: 394,
    classification: 'founder-squash',
    touchesVerifier: false,
    basis: "Skywalker's exact-head review; Wonderland-only.",
  }),
  Object.freeze({
    sha: 'f539cab2530b7733bd987068be676308440e04a5',
    tree: 'bcbefd01d3b6fea0e12e1fed2f967c2d11bc1af0',
    pr: 395,
    classification: 'g6',
    touchesVerifier: true,
    basis: "Skywalker's exact-head review plus G6.",
  }),
]);

const ATTESTATION_NONCE = '04bec0c413a2333a5929326b5c2fa85c';

/** The exact bytes Skywalker is asked to sign. Unsigned. */
export function canonicalCheckpointAttestation(fields = {}) {
  const prior = fields.prior ?? TRUSTED_CHECKPOINT_SHA;
  const commits = fields.commits ?? RECORDED_RANGE;
  const checkpoint = fields.checkpoint ?? commits[commits.length - 1]?.sha;
  const lines = [
    CHECKPOINT_HEADER,
    `repo: ${fields.repo ?? LANDING_REPO}`,
    `prior: ${prior}`,
    `checkpoint: ${checkpoint}`,
    `key-spki-sha256: ${fields.keySpkiSha256 ?? PINNED_REVIEWER_SPKI_SHA256}`,
    `nonce: ${fields.nonce ?? ATTESTATION_NONCE}`,
    `issued: ${fields.issued ?? '2026-10-23T00:00:00Z'}`,
    `expires: ${fields.expires ?? '2026-10-30T00:00:00Z'}`,
    `by: ${fields.by ?? 'INDEPENDENT_REVIEW'}`,
    `count: ${commits.length}`,
  ];
  commits.forEach((commit, index) => {
    const n = index + 1;
    lines.push(`${n}.sha: ${commit.sha}`, `${n}.tree: ${commit.tree}`, `${n}.basis: ${commit.basis}`);
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
    const end = 10 + count * 3;
    if (lines.length !== end + 1 || lines[lines.length - 1] !== '') problems.push('exactly one trailing newline and no extra lines');
    if (commits.length > 0 && checkpoint !== undefined && commits[commits.length - 1]?.sha !== checkpoint) {
      problems.push('checkpoint must be the last listed commit sha');
    }
  }
  return { problems, fields: { repo, prior, checkpoint, keySpkiSha256, nonce, issued, expires, by, count, commits } };
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
  const signed = pin === null && Boolean(material.key) && parsed.problems.length === 0
    && signatureVerifies(text, input?.signatureB64, material)
    && parsed.fields.prior === TRUSTED_CHECKPOINT_SHA
    && parsed.fields.repo?.toLowerCase() === LANDING_REPO.toLowerCase();
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
  const restBad = rest.filter((row) => row.classification !== 'signed-landing' && row.classification !== 'signed-g6');
  const illegalTcb = rest.filter((row) => row.touchesVerifier && row.classification !== 'signed-g6');
  if (pin || restBad.length > 0 || illegalTcb.length > 0) {
    const why = pin?.reason
      ?? (parsed.problems?.[0])
      ?? (typeof text === 'string' && !signed
        ? (typeof input?.signatureB64 === 'string' && input.signatureB64 !== ''
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

function gitShow(spec) {
  return execFileSync('git', ['show', spec], { encoding: 'utf8' });
}

/** Exit 0 only when the working tree's trusted files match the checkpoint, or a signed attestation covers the difference. */
export function requireTrustedVerifier(env = process.env) {
  const pin = reviewerKeyPinRefusal(gitShow(`${TRUSTED_CHECKPOINT_SHA}:.github/julius-landing/reviewer-ed25519.pub`), env[EXTERNAL_ANCHOR_VARIABLE]);
  if (pin) return { ok: false, reason: pin.reason };
  const differed = [];
  for (const path of TRUSTED_COMPUTING_BASE) {
    let checkpointBytes;
    try {
      checkpointBytes = execFileSync('git', ['show', `${TRUSTED_CHECKPOINT_SHA}:${path}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      checkpointBytes = null;
    }
    let tipBytes;
    try {
      tipBytes = readFileSync(path);
    } catch {
      tipBytes = null;
    }
    const same = Buffer.isBuffer(checkpointBytes) && Buffer.isBuffer(tipBytes) && checkpointBytes.equals(tipBytes);
    if (!same) differed.push(path);
  }
  if (differed.length === 0) return { ok: true, reason: 'the trusted computing base matches the checkpoint' };
  const chain = evaluateTrustChain({
    tipSha: env.JULIUS_TIP_SHA,
    tipTree: env.JULIUS_TIP_TREE,
    commits: RECORDED_RANGE,
    attestationText: env.JULIUS_CHECKPOINT_ATTESTATIONS,
    signatureB64: env.JULIUS_CHECKPOINT_ATTESTATION_SIGNATURE,
    reviewerKeyPem: gitShow(`${TRUSTED_CHECKPOINT_SHA}:.github/julius-landing/reviewer-ed25519.pub`),
    externalAnchor: env[EXTERNAL_ANCHOR_VARIABLE],
  });
  if (chain.accepted !== true) {
    return {
      ok: false,
      reason: `unprovenanced: ${differed.join(', ')} differ from ${TRUSTED_CHECKPOINT_SHA} and no signed checkpoint attestation covers them`,
    };
  }
  // A signature over the historical range does not bless a later tree. HEAD must be the attested checkpoint, and every differed path must match that commit.
  const parsed = typeof env.JULIUS_CHECKPOINT_ATTESTATIONS === 'string' ? parseCheckpointAttestation(env.JULIUS_CHECKPOINT_ATTESTATIONS) : { fields: {} };
  const attested = parsed.fields?.checkpoint;
  let head = '';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { head = ''; }
  if (head !== attested) {
    return { ok: false, reason: `unprovenanced: HEAD ${head || 'unreadable'} is not the attested checkpoint ${attested ?? 'none'}` };
  }
  for (const path of differed) {
    let attestedBytes = null;
    try { attestedBytes = execFileSync('git', ['show', `${attested}:${path}`], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { attestedBytes = null; }
    let tipBytes = null;
    try { tipBytes = readFileSync(path); } catch { tipBytes = null; }
    const same = Buffer.isBuffer(attestedBytes) && Buffer.isBuffer(tipBytes) && attestedBytes.equals(tipBytes);
    if (!same) return { ok: false, reason: `unprovenanced: ${path} is not the attested checkpoint ${attested}` };
  }
  return { ok: true, reason: chain.reason };
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();

if (entrypoint !== null && import.meta.url === entrypoint && process.argv.includes('--require-trusted-verifier')) {
  const result = requireTrustedVerifier();
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${result.reason}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
