/**
 * REVIEWED MAIN PROVENANCE — is the exact code tree on `main` externally approved?
 *
 * A pull request approval names a candidate COMMIT. Julius runs `main`, and a
 * squash merge deliberately gives the landed commit a different sha from the
 * one that was approved. So an approval, on its own, proves nothing about the
 * code that actually executes. The link between them has to be established from
 * facts, and the fact that survives a squash is the TREE: squashing changes
 * commit identity and must not change reviewed content.
 *
 * This answers one question and no other: is the exact source tree currently on
 * `main` the tree of a worker-authored candidate that the founder approved at an
 * exact sha, merged as the commit that is there now? It says nothing about
 * whether the code is any good. That is the runtime Independent Reviewer's
 * question, about a different artifact, and conflating the two would let a
 * runtime verdict stand in for a merge provenance proof.
 *
 * WHAT IT REFUSES TO USE. No timestamps, no branch-name conventions, no "the
 * most recent approval", no ancestry in place of identity. Every input is an
 * immutable git object id or an authenticated GitHub record.
 *
 * WHAT IT DOES NOT PROVE. This is a statement about ONE commit, not about the
 * branch's history. A branch reset to an earlier commit that was itself
 * approved still answers `provenant`, correctly — that code was approved — so
 * this gate does not detect a rollback, and nothing here should be read as
 * claiming the branch only ever moved forward. Detecting that needs recorded
 * state across runs, which is a different primitive and deliberately not this
 * one.
 *
 * FAIL CLOSED. `provenant` is the only passing verdict. `unprovenanced` is a
 * definite negative — nothing merged this, the author was wrong, no approval
 * exists, the tree differs. `indeterminate` is everything unreadable, ambiguous,
 * truncated or moving. Both block, and neither may be reported as approval.
 */

import { createPublicKey, verify } from 'node:crypto';

import {
  NON_ATTESTING_IDENTITIES,
  REVIEW_AUTHORITY_LOGINS,
  collectPages,
  evaluateReviewCurrency,
} from './julius-review-currency.mjs';
import {
  EXTERNAL_ANCHOR_VARIABLE,
  FIRST_PARENT_WALK_CAP,
  GOVERNED_LANDER_BOT_VARIABLE,
  TRUSTED_CHECKPOINT_SHA,
  TRUSTED_COMPUTING_BASE,
  annotateChainLandings,
  landingIdentityProblem,
  firstParentWalkCapReason,
  applyTrustChain,
  attestedCheckpointFloor,
  evaluateTrustChain,
  readCheckpointAttestation,
  reviewerKeyPinRefusal,
  governedAuditBranchProblem,
} from './julius-main-provenance-trust.mjs';

const externalAnchorOf = (input) => (
  input && Object.prototype.hasOwnProperty.call(input, 'externalReviewerKeySha256')
    ? input.externalReviewerKeySha256
    : process.env[EXTERNAL_ANCHOR_VARIABLE]
);

export { NON_ATTESTING_IDENTITIES, REVIEW_AUTHORITY_LOGINS };

/**
 * WHO MAY HAVE AUTHORED THE CANDIDATE.
 *
 * The same set as the identities that may never attest, and derived from it
 * rather than repeated, because that is the invariant: the author of a landed
 * candidate must be an identity that cannot approve one. Written as two
 * independent lists they could drift into overlapping with the approvers, and
 * the drift would be silent — a candidate authored by someone who may also
 * approve is self-certification with extra steps.
 */
export const WORKER_AUTHOR_LOGINS = NON_ATTESTING_IDENTITIES;

/** The only verdicts. Anything not `provenant` blocks. */
export const PROVENANCE_VERDICTS = Object.freeze(['provenant', 'unprovenanced', 'indeterminate']);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const isSha = (value) => typeof value === 'string' && FULL_SHA.test(value);

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

/* ------------------------------------------------- SIGNED LANDING --- */

/**
 * A SECOND, INDEPENDENT WAY FOR A MAIN TIP TO BE PROVENANT: the Independent Reviewer signed it.
 *
 * The autonomous lander (julius-lander[bot]) lands a commit whose MESSAGE carries the reviewer's ed25519
 * clearance and signature. Such a commit is not the merge result of any pull request, so the founder-approval
 * path above cannot see it. This path answers the same question from different facts: is the tree that main carries,
 * on the base it was built on, exactly what the reviewer signed for, and was it authored by the coding worker?
 *
 * THE MESSAGE FORMAT (one block, the last lines of the message; nothing else in it names a marker):
 *   -----BEGIN JULIUS LANDING-----
 *   v: 1
 *   clearance-nonce: <32 hex, equal to the nonce inside the clearance>
 *   clearance-b64: <base64 of the EXACT signed clearance text, one line>
 *   signature-b64: <base64 ed25519 signature over those exact bytes, one line>
 *   -----END JULIUS LANDING-----
 * The pr / head / tree / base are NOT repeated as free fields: they are read ONLY from the signed text.
 *
 * WHAT IT TRUSTS: the public key COMMITTED at the tip's single PARENT, passed in with the sha it was read at. Never a
 * key from the message, never the tip's own copy (a landing that could replace the key could sign itself). WHAT IT
 * DOES NOT JUDGE: time. A clearance proves that content was cleared over that base; clocks stay out of this gate, as
 * in the rest of this file. Single use of a nonce is the lander's replay guard, not this one.
 *
 * FAIL CLOSED. No marker anywhere in the message: `absent`, and the founder-approval path decides, unchanged. Any
 * marker at all and ANY defect (two blocks, a marker inline, text after the end, an extra or missing key, base64 that is
 * not canonical, a clearance that does not parse, a signature that does not verify, a tree/base/head that does not
 * match): the verdict is final and is NOT handed to the founder-approval path. Mixing a forged block with a
 * legitimate approval would let each excuse the other.
 */
export const LANDING_BEGIN = '-----BEGIN JULIUS LANDING-----';
export const LANDING_END = '-----END JULIUS LANDING-----';
const LANDING_REPO = 'ohdieyuh-glitch/sunday-relay';
const CLEARANCE_KEYS = ['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'];
const CLEARANCE_OPTIONAL_KEYS = ['protected-paths', 'landing-method', 'binds-draft', 'depends'];
const EXCEPTION_ELIGIBLE = ['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs'];
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const isCanonicalBase64 = (text) => typeof text === 'string' && CANONICAL_BASE64.test(text)
  && Buffer.from(text, 'base64').toString('base64') === text;

/** @returns {{state:'absent'} | {state:'invalid', reason:string} | {state:'ok', nonce:string, clearanceB64:string, signatureB64:string}} */
export function extractLandingBlock(message) {
  // A message that was never supplied (an older evidence file, a caller that predates this path) leaves the founder-approval path exactly as it was.
  // A message that WAS supplied but is not text is unreadable, and unreadable fails closed.
  if (message === undefined) return { state: 'absent' };
  if (typeof message !== 'string') return { state: 'invalid', reason: 'the commit message could not be read' };
  const mentions = message.split('JULIUS LANDING').length - 1;
  if (mentions === 0) return { state: 'absent' };
  const bad = (reason) => ({ state: 'invalid', reason });
  if (message.includes('\r')) return bad('the commit message carries a carriage return');
  if (mentions !== 2 || message.split(LANDING_BEGIN).length - 1 !== 1 || message.split(LANDING_END).length - 1 !== 1) {
    return bad('the commit message must contain exactly one BEGIN and one END landing marker and no other mention of them');
  }
  const lines = message.split('\n');
  const begin = lines.indexOf(LANDING_BEGIN);
  const end = lines.indexOf(LANDING_END);
  if (begin < 0 || end < 0) return bad('a landing marker is not alone on its line');
  if (end !== begin + 5) return bad('the landing block must hold exactly four lines between its markers');
  const after = lines.slice(end + 1);
  if (!(after.length === 0 || (after.length === 1 && after[0] === ''))) return bad('text follows the landing block');
  const expect = [['v', /^1$/u], ['clearance-nonce', /^[0-9a-f]{32}$/u], ['clearance-b64', CANONICAL_BASE64], ['signature-b64', CANONICAL_BASE64]];
  const values = {};
  for (let i = 0; i < 4; i += 1) {
    const [key, shape] = expect[i];
    const line = lines[begin + 1 + i];
    const prefix = `${key}: `;
    if (!line.startsWith(prefix)) return bad(`line ${i + 1} of the landing block must start with "${prefix}"`);
    const value = line.slice(prefix.length);
    if (!shape.test(value)) return bad(`the ${key} value is malformed`);
    values[key] = value;
  }
  if (!isCanonicalBase64(values['clearance-b64']) || !isCanonicalBase64(values['signature-b64'])) return bad('a base64 payload is not canonical');
  return { state: 'ok', nonce: values['clearance-nonce'], clearanceB64: values['clearance-b64'], signatureB64: values['signature-b64'] };
}

/** The clearance text rules, restated here on purpose: this file imports nothing from the lander it is a check on. */
export function parseSignedClearance(text, queriedRepo) {
  const problems = [];
  const lines = String(text).split('\n');
  if (lines[0] !== 'JULIUS-CLEARANCE-V1') problems.push('first line must be JULIUS-CLEARANCE-V1');
  if (lines[1] !== `repo: ${LANDING_REPO}`) problems.push(`second line must be "repo: ${LANDING_REPO}"`);
  // v3.5b S-3: the queried repository is REQUIRED (library, GitHub mode and --evidence mode); GitHub repository names are case-insensitive.
  if (typeof queriedRepo !== 'string' || queriedRepo === '') problems.push('the queried repository is required');
  else if (lines[1] === `repo: ${LANDING_REPO}` && queriedRepo.toLowerCase() !== LANDING_REPO.toLowerCase()) problems.push(`the clearance is for ${LANDING_REPO}, not the queried repo ${queriedRepo}`);
  const fields = {};
  CLEARANCE_KEYS.forEach((key, i) => {
    const line = lines[2 + i] ?? '';
    const prefix = `${key}: `;
    if (!line.startsWith(prefix)) problems.push(`line ${3 + i} must start with "${prefix}"`);
    else fields[key] = line.slice(prefix.length);
  });
  let cursor = 0;
  let index = 2 + CLEARANCE_KEYS.length;
  while (index < lines.length - 1) {
    const line = lines[index];
    let matched = -1;
    for (let keyIndex = cursor; keyIndex < CLEARANCE_OPTIONAL_KEYS.length; keyIndex += 1) {
      if (line.startsWith(`${CLEARANCE_OPTIONAL_KEYS[keyIndex]}: `)) {
        matched = keyIndex;
        break;
      }
    }
    if (matched < 0) break;
    const key = CLEARANCE_OPTIONAL_KEYS[matched];
    fields[key] = line.slice(key.length + 2);
    cursor = matched + 1;
    index += 1;
  }
  if (lines.length === 0 || lines[lines.length - 1] !== '' || index !== lines.length - 1) problems.push('exactly one trailing newline and no extra lines');
  for (const key of ['head', 'tree', 'base']) if (fields[key] !== undefined && !isSha(fields[key])) problems.push(`${key} must be a full 40-hex sha`);
  if (fields.pr !== undefined && !/^[1-9][0-9]{0,6}$/u.test(fields.pr)) problems.push('pr must be a positive integer');
  if (fields.kind !== undefined && !['CLEARED', 'CLEARED-TREE'].includes(fields.kind)) problems.push('kind must be CLEARED or CLEARED-TREE');
  if (fields['governed-exceptions'] !== undefined) {
    const value = fields['governed-exceptions'];
    const list = value === '-' ? [] : value.split(',');
    if (value !== '-' && (list.some((f) => !EXCEPTION_ELIGIBLE.includes(f)) || new Set(list).size !== list.length || [...list].sort().join(',') !== value)) {
      problems.push('governed-exceptions must be "-" or a sorted comma list of eligible files');
    }
  }
  if (fields['protected-paths'] !== undefined) {
    const value = fields['protected-paths'];
    const list = value === '-' ? [] : value.split(',');
    const safe = (path) => path !== '' && !path.includes('..') && !path.startsWith('/') && !/[*?[\]{}\s]/u.test(path) && /^[A-Za-z0-9._@/-]+$/u.test(path);
    if (value !== '-' && (list.some((path) => !safe(path)) || new Set(list).size !== list.length || [...list].sort().join(',') !== value)) {
      problems.push('protected-paths must be "-" or a sorted comma-separated path list');
    }
  }
  if (fields['landing-method'] !== undefined && !['squash', 'fast-forward'].includes(fields['landing-method'])) {
    problems.push('landing-method must be squash or fast-forward');
  }
  if (fields['binds-draft'] !== undefined && fields['binds-draft'] !== 'yes') problems.push('binds-draft must be yes');
  if (fields.depends !== undefined) {
    const value = fields.depends;
    const parts = value === '-' ? [] : value.split(',');
    const ids = parts.map((part) => (/^[1-9][0-9]{0,6}$/u.test(part) ? Number(part) : Number.NaN));
    if (value !== '-' && (ids.some((id) => !Number.isInteger(id)) || new Set(parts).size !== parts.length || [...ids].sort((a, b) => a - b).join(',') !== value)) {
      problems.push('depends must be "-" or a numerically sorted comma-separated list of pull request numbers');
    }
  }
  if (fields.nonce !== undefined && !/^[0-9a-f]{32}$/u.test(fields.nonce)) problems.push('nonce must be 32 hex characters');
  if (fields.by !== undefined && fields.by !== 'INDEPENDENT_REVIEW') problems.push('by must be INDEPENDENT_REVIEW');
  if (fields['bot-comments-sha256'] !== undefined && !/^[0-9a-f]{64}$/u.test(fields['bot-comments-sha256'])) problems.push('bot-comments-sha256 must be 64 hex');
  for (const key of ['issued', 'expires']) {
    if (fields[key] !== undefined && !(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(fields[key]) && !Number.isNaN(Date.parse(fields[key])))) problems.push(`${key} must be a UTC timestamp`);
  }
  return { problems, fields };
}

/**
 * THE KEY FILE IS EXACTLY ONE PUBLIC ED25519 KEY AND NOTHING ELSE.
 *
 * Node's createPublicKey is liberal: it will derive a public key from a PRIVATE key PEM and ignores whatever else a
 * multi-block file carries. A key file that holds a private key, a second key, comments or trailing text is not the
 * file the reviewer committed, so it is refused rather than interpreted. Returns the key object, or a reason.
 */
export function readReviewerKey(pem) {
  if (typeof pem !== 'string' || pem === '') return { problem: 'the reviewer key could not be read' };
  if (pem.includes('\r')) return { problem: 'the reviewer key file carries a carriage return' };
  if (/PRIVATE KEY/u.test(pem)) return { problem: 'the reviewer key file holds a private key' };
  if (pem.split('-----BEGIN ').length - 1 !== 1 || pem.split('-----END ').length - 1 !== 1) {
    return { problem: 'the reviewer key file must hold exactly one PEM block' };
  }
  if (!/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/u.test(pem)) {
    return { problem: 'the reviewer key file must be exactly one SPKI PUBLIC KEY block and nothing else' };
  }
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    return { problem: 'the reviewer key is not a readable public key' };
  }
  if (key.asymmetricKeyType !== 'ed25519') return { problem: 'the reviewer key is not an ed25519 key' };
  // Canonical form: what Node writes back for this key is what the file must already say (no padding games inside the base64).
  if (String(key.export({ type: 'spki', format: 'pem' })).replace(/\n+$/u, '') !== pem.replace(/\n+$/u, '')) {
    return { problem: 'the reviewer key file is not the canonical encoding of its key' };
  }
  return { key };
}

/**
 * THE PATHS A SIGNED LANDING MAY NOT CHANGE (d4b).
 *
 * A reviewer-signed tip can reach this gate WITHOUT the lander: there is no branch protection, so a hand-pushed commit that
 * carries a genuine signed block is exactly as good as a landed one, unless the gate itself refuses what the lander would
 * have refused. These two constants are a deliberate COPY of the lander's HARD_FORBIDDEN_PATH and EXCEPTION_ELIGIBLE (this
 * file imports nothing from the lander it checks); a drift test keeps the copies equal. A hard-forbidden path is
 * provenant only when the signed clearance's protected-paths lists that exact path. A historical clearance with no
 * protected-paths line lists nothing, so those paths stay refused. The two exception-eligible files may change only
 * when the SIGNED clearance names them in governed-exceptions.
 */
const SIGNED_LANDING_HARD_FORBIDDEN = /^(\.github\/workflows\/|\.github\/julius-landing\/|\.github\/julius-mission-pins\.txt$|\.github\/julius-approvers\.json$|\.github\/CODEOWNERS$|CODEOWNERS$|docs\/CODEOWNERS$|CLAUDE\.md$|package\.json$|package-lock\.json$|scripts\/julius-approval-gates\.mjs$|scripts\/julius-live-evidence\.mjs$|scripts\/julius-main-provenance|scripts\/julius-review-currency|scripts\/julius-main-monotonicity|scripts\/julius-paid-slot|scripts\/julius-subscription-check|scripts\/julius-live-preflight-gates|scripts\/julius-accept|scripts\/relay-repository-boundary|scripts\/export-julius-harness|scripts\/relay-parity-gate|scripts\/wonderland-beta-gate|scripts\/julius-live-preflight-identity|scripts\/julius-derive-scoped-credentials|scripts\/julius-ci-callers|scripts\/ci-test-accounting|scripts\/julius-paid-dispatch|scripts\/julius-paid-run-archive|\.github\/julius-mission-pins\.sh$|\.github\/julius-executor-entrypoint\.sh$|scripts\/julius-docker-executor\.sh$|scripts\/julius-executor-ready\.mjs$|scripts\/julius-reviewer-isolation|scripts\/julius-reviewer-deadline\.mjs$|scripts\/julius-live-preflight\.ts$|scripts\/julius-usage-limit\.mjs$|\.github\/julius-learning-store\.sh$|\.github\/julius-phase\.sh$|\.github\/wait-for-executor\.sh$|\.github\/julius-live-|\.github\/actions\/|\.github\/julius-mission-slice\/|\.github\/julius-learning-registrations\/|scripts\/julius-landing|\.github\/julius-live-evidence-dump\.sh$|.*\bmigrations?\/)/iu;
const SIGNED_LANDING_EXCEPTION_ELIGIBLE = ['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs'];
export const SIGNED_LANDING_GOVERNED = Object.freeze({ HARD_FORBIDDEN: SIGNED_LANDING_HARD_FORBIDDEN, EXCEPTION_ELIGIBLE: SIGNED_LANDING_EXCEPTION_ELIGIBLE });

const signedVerdict = (name, reason, extra = {}) => ({ state: 'decided', result: verdict(name, reason, { via: 'signed-landing', ...extra }) });

/**
 * @returns {{state:'absent'} | {state:'decided', result: object}}
 * @param {object} input
 * @param {unknown} input.mainCommitMessage
 * @param {unknown} input.reviewerKeyPem     The PEM committed at the parent.
 * @param {unknown} input.reviewerKeyAtSha   The commit that PEM was read at. Must be the tip's single parent.
 * @param {unknown} input.tipReviewerKeyPem  The same file read AT THE TIP: must be byte-identical to the parent's.
 * @param {unknown} input.changedPaths       Every path (and previous path) the tip changes against its parent.
 * @param {unknown} input.changedPathsComplete Strictly true: the list was read completely (fewer than 300 files, exactly one commit ahead).
 * @param {unknown} input.headCommit         `{ sha, authorLogin, treeSha }` of the commit the clearance names as `head`.
 */
export function evaluateSignedLanding(input, tip) {
  const block = extractLandingBlock(input?.mainCommitMessage);
  if (block.state === 'absent') return { state: 'absent' };
  const { mainSha, mainTreeSha, parentSha } = tip;
  const base = { mainSha, mainTreeSha, parentSha };
  if (block.state === 'invalid') return signedVerdict('indeterminate', `the landing block is not readable: ${block.reason}`, base);

  const clearanceText = Buffer.from(block.clearanceB64, 'base64').toString('utf8');
  if (Buffer.from(clearanceText, 'utf8').toString('base64') !== block.clearanceB64) {
    return signedVerdict('indeterminate', 'the clearance payload is not valid UTF-8', base);
  }
  const parsed = parseSignedClearance(clearanceText, input?.repo);
  if (parsed.problems.length > 0) {
    return signedVerdict('indeterminate', `the signed clearance text is malformed: ${parsed.problems.join('; ')}`, base);
  }
  const clearance = parsed.fields;
  if (clearance.nonce !== block.nonce) return signedVerdict('unprovenanced', 'the nonce in the landing block is not the nonce inside the signed clearance', base);

  // THE KEY: committed at the parent, and proven to have been read there.
  if (!isSha(input?.reviewerKeyAtSha) || input.reviewerKeyAtSha !== parentSha) {
    return signedVerdict('indeterminate', 'the reviewer key was not read at the single parent of the tip', base);
  }
  const read = readReviewerKey(input?.reviewerKeyPem);
  if (read.problem) return signedVerdict('indeterminate', `${read.problem} (as committed at the parent)`, base);
  // DEFENCE IN DEPTH: the key file AT THE TIP must be byte-identical to the parent's. A squash that swaps the key
  // (founder-approved, say) cannot then be dressed as a signed landing: the signature is checked against the parent's key,
  // but a tip that changes the trust anchor is not provenant, whatever it is signed with.
  if (typeof input?.tipReviewerKeyPem !== 'string') {
    return signedVerdict('indeterminate', 'the reviewer key file at the tip could not be read', base);
  }
  if (input.tipReviewerKeyPem !== input.reviewerKeyPem) {
    return signedVerdict('unprovenanced', 'the tip changes the reviewer key file; a landing that moves the trust anchor is not provenant', base);
  }
  const key = read.key;
  const signature = Buffer.from(block.signatureB64, 'base64');
  if (signature.length !== 64) return signedVerdict('unprovenanced', 'the landing signature is not 64 bytes', base);
  let signatureOk = false;
  try {
    signatureOk = verify(null, Buffer.from(clearanceText, 'utf8'), key, signature);
  } catch {
    return signedVerdict('indeterminate', 'the landing signature could not be checked', base);
  }
  if (signatureOk !== true) {
    // An unpinned key is refused because it is not the trust root, including when the signature was made by that key.
    const pin = reviewerKeyPinRefusal(input?.reviewerKeyPem, externalAnchorOf(input));
    if (pin?.verdict === 'unprovenanced') return signedVerdict('unprovenanced', pin.reason, base);
    return signedVerdict('unprovenanced', 'the landing signature does not verify against the reviewer key committed at the parent', base);
  }

  // WHAT WAS SIGNED must be what main carries, on the base it was built on.
  if (clearance.tree !== mainTreeSha) {
    return signedVerdict('unprovenanced', `the reviewer signed tree ${clearance.tree}, main carries ${mainTreeSha}`, base);
  }
  if (clearance.base !== parentSha) {
    return signedVerdict('unprovenanced', `the reviewer signed base ${clearance.base}, the tip's parent is ${parentSha}`, base);
  }
  const head = input?.headCommit;
  if (!isSha(head?.sha) || head.sha !== clearance.head || !isSha(head?.treeSha)) {
    return signedVerdict('indeterminate', 'the cleared head commit could not be read as the commit the clearance names', base);
  }
  if (head.treeSha !== clearance.tree) {
    return signedVerdict('unprovenanced', `the cleared head ${head.sha} carries tree ${head.treeSha}, not the signed tree ${clearance.tree}`, base);
  }
  // A governed landing names its method inside the signed clearance. Historical
  // clearances do not, and those heads are still the coding worker's.
  const governedMethod = clearance['landing-method'] === 'squash' || clearance['landing-method'] === 'fast-forward';
  if (!governedMethod && !WORKER_AUTHOR_LOGINS.includes(head?.authorLogin)) {
    return signedVerdict('unprovenanced',
      `the cleared head was authored by ${typeof head?.authorLogin === 'string' ? head.authorLogin : 'an unreadable identity'}, not the coding worker`, base);
  }
  // WHAT THE TIP CHANGES AGAINST ITS PARENT (d4b): read completely, or the answer is indeterminate.
  const changed = input?.changedPaths;
  if (input?.changedPathsComplete !== true || !Array.isArray(changed) || changed.length === 0 || !changed.every((path) => typeof path === 'string' && path !== '')) {
    return signedVerdict('indeterminate', 'the paths the signed tip changes against its parent could not be read completely', base);
  }
  const exceptions = clearance['governed-exceptions'] === '-' ? [] : clearance['governed-exceptions'].split(',');
  const protectedPaths = clearance['protected-paths'] === undefined || clearance['protected-paths'] === '-' ? [] : clearance['protected-paths'].split(',');
  const governed = changed.filter((path) => (SIGNED_LANDING_HARD_FORBIDDEN.test(path) && !protectedPaths.includes(path))
    || (SIGNED_LANDING_EXCEPTION_ELIGIBLE.some((file) => file.toLowerCase() === path.toLowerCase()) && !exceptions.includes(path)));
  if (governed.length > 0) {
    return signedVerdict('unprovenanced', `a signed landing may not change founder-governed paths: ${governed.slice(0, 5).join(', ')}`, base);
  }
  const unusedProtected = protectedPaths.filter((path) => !changed.includes(path));
  if (unusedProtected.length > 0) {
    return signedVerdict('unprovenanced', `the signed clearance lists protected paths this landing does not change: ${unusedProtected.slice(0, 5).join(', ')}`, base);
  }
  const needsLander = changed.some((path) => SIGNED_LANDING_HARD_FORBIDDEN.test(path) || TRUSTED_COMPUTING_BASE.includes(path));
  if (needsLander) {
    const identity = landingIdentityProblem({
      committerId: input?.landingCommitterId,
      verificationVerified: input?.landingVerificationVerified,
      verificationReason: input?.landingVerificationReason,
      verificationReadProblem: input?.verificationReadProblem,
      botId: input?.governedLanderBotId ?? process.env[GOVERNED_LANDER_BOT_VARIABLE],
    });
    if (identity) return signedVerdict('unprovenanced', identity, base);
  }
  const success = { ...base, prNumber: Number(clearance.pr), reviewedHeadSha: clearance.head, approvedBy: [clearance.by] };
  const pin = reviewerKeyPinRefusal(input?.reviewerKeyPem, externalAnchorOf(input));
  if (pin) return signedVerdict(pin.verdict, pin.reason, success);
  return signedVerdict('provenant',
    `main ${mainSha} carries tree ${mainTreeSha} on base ${parentSha}, signed by the Independent Reviewer for pull request #${clearance.pr} (head ${clearance.head})`,
    success);
}

async function withTrustChain(single, source) {
  if (single?.verdict !== 'provenant') return single;
  let commits = source?.chainCommits;
  // Every ancestor landing is verified on its own, at that commit's committer
  // time. The tip's flag is kept only when that commit carries no landing block,
  // because evaluateSignedLanding already judged it. A block on the tip is
  // judged again here. The verifier's clock is not the clearance window.
  if (Array.isArray(commits) && commits.length > 0) {
    const anchor = source && Object.prototype.hasOwnProperty.call(source, 'externalReviewerKeySha256')
      ? source.externalReviewerKeySha256
      : process.env[EXTERNAL_ANCHOR_VARIABLE];
    commits = await annotateChainLandings(commits, {
      pem: source?.reviewerKeyPem,
      anchor,
      now: typeof source?.now === 'number' ? source.now : Date.now(),
    });
    const last = commits.length - 1;
    const tipMessage = commits[last]?.message;
    const tipHasBlock = typeof tipMessage === 'string' && tipMessage.includes('BEGIN JULIUS LANDING');
    if (single.via === 'signed-landing' && !tipHasBlock) {
      commits = commits.map((commit, index) => (index === last ? { ...commit, signedLanding: true } : commit));
    }
  }
  const chain = evaluateTrustChain({
    tipSha: single.mainSha,
    tipTree: single.mainTreeSha,
    commits,
    attestationText: source?.attestationText ?? process.env.JULIUS_CHECKPOINT_ATTESTATIONS,
    signatureB64: source?.attestationSignatureB64 ?? process.env.JULIUS_CHECKPOINT_ATTESTATION_SIGNATURE,
    reviewerKeyPem: source?.reviewerKeyPem,
    externalAnchor: source && Object.prototype.hasOwnProperty.call(source, 'externalReviewerKeySha256')
      ? source.externalReviewerKeySha256
      : process.env[EXTERNAL_ANCHOR_VARIABLE],
    now: source?.now,
  });
  return applyTrustChain(single, chain);
}

/**
 * Every page of a commit's file list, or a refusal.
 * A response longer than the requested page is the server's whole list only
 * when it is under the 300-file ceiling. A full page asks for the next one.
 * A walk that never sees a short page fails closed.
 */
export function pagedCommitFiles(fetchPage, { perPage = 100, maxPages = 30 } = {}) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const commit = fetchPage(page, perPage);
    if (!commit || typeof commit !== 'object' || !Array.isArray(commit.files)) {
      throw new Error('a commit file page was not a list');
    }
    if (page === 1 && commit.files.length > perPage) {
      if (commit.files.length >= 300) throw new Error('the commit file list is incomplete');
      return commit.files;
    }
    rows.push(...commit.files);
    if (commit.files.length < perPage) return rows;
  }
  throw new Error(`pagination did not finish within ${maxPages} pages`);
}

function pathsFromFiles(files) {
  return files.flatMap((file) => [file?.filename, file?.previous_filename].filter((path) => typeof path === 'string'));
}

export function readFirstParentChain(gh, repo, tipSha, floorSha = TRUSTED_CHECKPOINT_SHA) {
  if (tipSha === floorSha) return [];
  const reversed = [];
  let sha = tipSha;
  let steps = 0;
  for (let i = 0; i < FIRST_PARENT_WALK_CAP && typeof sha === 'string' && sha !== floorSha; i += 1) {
    steps += 1;
    const commit = gh(`repos/${repo}/commits/${sha}`);
    let files = null;
    try {
      files = pagedCommitFiles((page, perPage) => (
        page === 1 ? commit : gh(`repos/${repo}/commits/${sha}?per_page=${perPage}&page=${page}`)
      ));
    } catch (error) {
      if (error instanceof Error && /incomplete|did not finish/u.test(error.message)) throw error;
      files = null;
    }
    const committerDate = commit?.commit?.committer?.date;
    const committerTime = typeof committerDate === 'string' ? Date.parse(committerDate) : Number.NaN;
    reversed.push({
      sha: commit?.sha,
      tree: commit?.commit?.tree?.sha,
      paths: Array.isArray(files) ? pathsFromFiles(files) : undefined,
      message: commit?.commit?.message,
      parent: commit?.parents?.[0]?.sha,
      parentCount: Array.isArray(commit?.parents) ? commit.parents.length : undefined,
      committerTime: Number.isFinite(committerTime) ? committerTime : undefined,
      committerId: commit?.committer?.id,
      verificationVerified: commit?.commit?.verification?.verified === true,
      verificationReason: typeof commit?.commit?.verification?.reason === 'string' ? commit.commit.verification.reason : '',
    });
    const parent = commit?.parents?.[0]?.sha;
    if (parent === floorSha) return reversed.reverse();
    sha = parent;
  }
  if (steps >= FIRST_PARENT_WALK_CAP && sha !== floorSha) throw new Error(firstParentWalkCapReason(floorSha));
  return null;
}

/**
 * @param {object} input
 * @param {unknown} input.mainSha        `main`, read before the lookups.
 * @param {unknown} input.mainShaAfter   `main`, read again after. A moving branch is not provable.
 * @param {unknown} input.mainTreeSha    The tree of the commit on `main`.
 * @param {unknown} input.mainParents    Its parent shas. A squash onto `main` has exactly one.
 * @param {unknown} input.pullRequests   `/commits/{sha}/pulls` — every PR associated with the commit.
 * @param {unknown} input.reviewedTreeSha The tree of the reviewed candidate head.
 * @param {unknown} input.reviewedHeadShaAfter The PR head, re-read.
 * @param {unknown} input.reviews        The PR's reviews.
 * @param {unknown} input.reviewComments The PR's review comments.
 * @param {unknown} [input.statuses]     Commit statuses on the reviewed head.
 * @param {unknown} input.parentContainedInReviewedHead Strictly true/false.
 * @param {unknown} input.baseRefChanged Strictly false. Whether the pull request was ever retargeted.
 * @param {unknown} [input.branch] The branch under verification. Defaults to `main`.
 * @param {unknown} [input.mainCommitMessage] The tip's commit message (landing block, see above).
 * @param {unknown} [input.reviewerKeyPem] The reviewer public key committed at the parent.
 * @param {unknown} [input.reviewerKeyAtSha] The sha that key was read at.
 * @param {unknown} [input.tipReviewerKeyPem] The key file read at the tip itself (must equal the parent's).
 * @param {unknown} [input.changedPaths] Paths the tip changes against its parent (signed landings are refused on governed paths).
 * @param {unknown} [input.changedPathsComplete] Strictly true when that list is complete.
 * @param {unknown} [input.headCommit] `{ sha, authorLogin, treeSha }` of the commit the clearance names.
 */
export function evaluateMainProvenance(input) {
  const branch = typeof input?.branch === 'string' && input.branch !== '' ? input.branch : 'main';
  const mainSha = input?.mainSha;
  const mainShaAfter = input?.mainShaAfter;
  if (!isSha(mainSha)) return verdict('indeterminate', 'the head of main could not be read as a full commit sha');
  if (!isSha(mainShaAfter)) return verdict('indeterminate', 'main could not be re-read to prove it held still');
  // MAIN MOVED WHILE THE GATE RAN. Everything below describes one commit; if the
  // branch advanced, the proof is about code that is no longer running.
  if (mainShaAfter !== mainSha) {
    return verdict('indeterminate', `main moved during the check: ${mainSha} then ${mainShaAfter}`);
  }
  if (!isSha(input?.mainTreeSha)) return verdict('indeterminate', 'the tree of the commit on main could not be read');

  /**
   * EXACTLY ONE PARENT.
   *
   * A squash merge produces a single-parent commit whose parent is the base the
   * merge happened onto. No parents is a root commit and nothing precedes it to
   * check; two or more is a real merge commit, whose content is a combination
   * this gate's tree comparison was not designed to reason about. Both are
   * refused rather than guessed at.
   */
  const parents = input?.mainParents;
  if (!Array.isArray(parents) || !parents.every(isSha)) {
    return verdict('indeterminate', 'the parents of the commit on main could not be read');
  }
  if (parents.length !== 1) {
    return verdict('indeterminate', `the commit on main has ${parents.length} parents; a squashed candidate has exactly one`);
  }
  const parentSha = parents[0];

  /**
   * A TIP THAT CARRIES A LANDING BLOCK IS JUDGED BY THE REVIEWER'S SIGNATURE AND BY NOTHING ELSE. No block: unchanged.
   */
  const signed = evaluateSignedLanding(input, { mainSha, mainTreeSha: input.mainTreeSha, parentSha });
  if (signed.state === 'decided') return signed.result;

  if (!Array.isArray(input?.pullRequests)) {
    return verdict('indeterminate', 'the pull requests associated with this commit could not be read');
  }

  /**
   * THE PULL REQUEST THAT PRODUCED THIS COMMIT, not one that merely mentions it.
   *
   * `/commits/{sha}/pulls` lists every pull request associated with a commit,
   * which includes ones whose branch happens to contain it. The discriminator
   * is GitHub's own record of what the merge produced: a merged pull request
   * whose `merge_commit_sha` IS this commit. A push of a commit that was never
   * anything's merge result matches nothing here and fails on the spot.
   *
   * A squash merged into some OTHER branch and then pushed here by hand does
   * match this filter — GitHub recorded it as that pull request's merge result,
   * wherever it was later placed. The base check below is what refuses it, and
   * this filter alone should not be read as catching every direct push.
   */
  const merging = input.pullRequests.filter((pull) =>
    pull?.merged === true && pull?.mergeCommitSha === mainSha);
  if (merging.length === 0) {
    return verdict('unprovenanced',
      `no merged pull request records ${mainSha} as its merge result`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha });
  }
  if (merging.length > 1) {
    // Two records claiming the same merge result is a contradiction, and a
    // contradiction is not a proof.
    return verdict('indeterminate',
      `${merging.length} merged pull requests claim ${mainSha} as their merge result`, { mainSha });
  }
  const pull = merging[0];

  /**
   * THE APPROVAL WAS RENDERED AGAINST THIS BRANCH.
   *
   * GitHub shows a reviewer the diff of the head against the pull request's
   * BASE. A candidate opened against some other branch shows a small diff while
   * carrying everything that branch contains, and squashing it produces a
   * commit whose tree is the candidate's — which every other check here would
   * accept. Landing that commit on `main` afterwards would launder content the
   * reviewer never saw into the branch Julius executes.
   *
   * Requiring the base to be the branch under verification is what makes "the
   * founder approved this diff" a statement about THIS branch. It is a fact on
   * the pull request record, not an inference.
   */
  const auditRef = governedAuditBranchProblem(pull?.headRef) ?? governedAuditBranchProblem(pull?.baseRef);
  if (auditRef) {
    return verdict('unprovenanced', auditRef, { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }
  if (pull?.baseRef !== branch) {
    return verdict('unprovenanced',
      `the landed candidate was reviewed against ${typeof pull?.baseRef === 'string' ? pull.baseRef : 'an unreadable branch'}, not ${branch}`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }

  /**
   * AND THE BASE WAS NEVER CHANGED.
   *
   * The base a pull request names today is not necessarily the base the review
   * was rendered against: retargeting an open pull request is an ordinary
   * edit, available to anyone who can write to it, and the coding worker can.
   * Approve a one-line diff against a worker branch, retarget to `main`,
   * squash — and the base now reads `main`, the tree is the approved
   * candidate's, and every check above is satisfied by a review of a diff that
   * hid everything the worker branch carried.
   *
   * The honest test of "was the base the reviewer saw the base that merged" is
   * whether it ever moved. Any recorded change refuses, without comparing
   * timestamps to decide whether the change came before or after the approval:
   * ordering inferred from clocks is exactly the kind of reasoning this gate
   * does not do. A candidate that needs a different base needs a new pull
   * request, which gets its own review of its own diff.
   */
  const baseRefChanged = input?.baseRefChanged;
  if (baseRefChanged !== false) {
    return verdict(baseRefChanged === true ? 'unprovenanced' : 'indeterminate',
      baseRefChanged === true
        ? `the base of pull request #${pull?.number} was changed, so the approved diff was rendered against a base that is not the one it merged into`
        : 'whether the base of the landed pull request ever changed could not be established',
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }

  if (!WORKER_AUTHOR_LOGINS.includes(pull?.authorLogin)) {
    return verdict('unprovenanced',
      `the landed candidate was authored by ${typeof pull?.authorLogin === 'string' ? pull.authorLogin : 'an unreadable identity'}, not the coding worker`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }
  if (!isSha(pull?.headSha)) {
    return verdict('indeterminate', 'the reviewed head of that pull request could not be read', { prNumber: pull?.number });
  }
  if (!isSha(input?.reviewedTreeSha)) {
    return verdict('indeterminate', 'the tree of the reviewed candidate could not be read', { prNumber: pull.number });
  }

  /**
   * APPROVAL IS THE SAME RULE AS EVERYWHERE ELSE, so there is one definition of
   * it. Exact-sha `APPROVED` from a configured authority that is not the author,
   * with no blocking finding on that head. The author check inside it is what
   * keeps founder self-approval invalid here too, without this file repeating
   * the reasoning.
   */
  const approval = evaluateReviewCurrency({
    headSha: pull.headSha,
    headShaAfter: input?.reviewedHeadShaAfter,
    reviews: input?.reviews,
    reviewComments: input?.reviewComments,
    statuses: input?.statuses,
    pullAuthorLogin: pull.authorLogin,
  });
  if (approval.verdict !== 'current') {
    return verdict(approval.verdict === 'indeterminate' ? 'indeterminate' : 'unprovenanced',
      `the landed candidate is not approved: ${approval.reason}`,
      { mainSha, prNumber: pull.number, reviewedHeadSha: pull.headSha, reviewCurrency: approval.verdict });
  }

  /**
   * THE TREE IS THE THING THAT SURVIVES A SQUASH.
   *
   * Commit identity deliberately changes; content must not. Ancestry is not a
   * substitute: a commit can descend from the reviewed candidate and still carry
   * a different tree, which is precisely the case where something was added
   * after approval.
   */
  if (input.reviewedTreeSha !== input.mainTreeSha) {
    return verdict('unprovenanced',
      `the tree on main (${input.mainTreeSha}) is not the reviewed tree (${input.reviewedTreeSha})`,
      { mainSha, prNumber: pull.number, reviewedHeadSha: pull.headSha });
  }

  /**
   * THE BASE THE SQUASH LANDED ON WAS ALREADY IN THE REVIEWED CANDIDATE.
   *
   * Squashing collapses the candidate onto whatever main had become. If that
   * parent was not already contained in the reviewed head, the landed tree
   * combines approved content with base commits the reviewer never saw — and
   * because the tree comparison above passes whenever the squash reproduced the
   * candidate's tree, nothing else here would notice.
   */
  const contained = input?.parentContainedInReviewedHead;
  if (contained !== true && contained !== false) {
    return verdict('indeterminate',
      'containment of the pre-merge parent in the reviewed candidate could not be proven',
      { mainSha, prNumber: pull.number, parentSha });
  }
  if (contained === false) {
    return verdict('unprovenanced',
      `the pre-merge parent ${parentSha} was not contained in the reviewed candidate`,
      { mainSha, prNumber: pull.number, parentSha, reviewedHeadSha: pull.headSha });
  }

  return verdict('provenant',
    `main ${mainSha} carries the tree of ${pull.headSha}, approved by ${(approval.approvedBy ?? []).join(', ')} and merged as pull request #${pull.number}`,
    {
      mainSha,
      mainTreeSha: input.mainTreeSha,
      parentSha,
      prNumber: pull.number,
      reviewedHeadSha: pull.headSha,
      approvedBy: approval.approvedBy ?? [],
    });
}

/* ------------------------------------------------------------------ CLI --- */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Usage: node scripts/julius-main-provenance.mjs <owner/repo> [branch]
 *
 * Reads the branch twice, around every other lookup, so a push landing while
 * the gate runs is caught rather than silently proved.
 */
/**
 * THE SAME RULE, WITHOUT A `gh` BINARY.
 *
 * The rule above is a pure function over one object; `main` below is only a
 * fetcher, and it fetches with `gh api`. A Claude Code cloud container has no
 * `gh` — so on the one machine that most needs to check a landing before
 * spending money, the authoritative gate could not run at all, and its rules
 * were being re-applied BY HAND from GitHub API responses read another way.
 * Two implementations of a trust rule is one too many, and the hand-run one is
 * the one nobody tests.
 *
 * `--evidence <file>` feeds the same object from JSON gathered however the
 * operator can gather it. It is NOT a weaker mode: every field the rule reads
 * that the file omits arrives `undefined`, and this rule answers
 * `indeterminate` for an unreadable field rather than passing it — so a
 * truncated or hand-trimmed evidence file cannot produce `provenant`. What the
 * mode cannot do is prove the file describes the repository it names, so the
 * output line says where the evidence came from and never claims otherwise.
 */
async function fromEvidenceFile(path) {
  const { readFileSync } = await import('node:fs');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('evidence file must hold a single JSON object');
  }
  return parsed;
}

async function main(argv) {
  const evidenceIndex = argv.indexOf('--evidence');
  const evidencePath = evidenceIndex >= 0 ? argv[evidenceIndex + 1] : undefined;
  const positional = evidenceIndex >= 0 ? [...argv.slice(0, evidenceIndex), ...argv.slice(evidenceIndex + 2)] : argv;
  const [repo, branchArg] = positional;
  const branch = branchArg ?? 'main';
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo) || !/^[\w./-]+$/u.test(branch)) {
    process.stderr.write('usage: julius-main-provenance.mjs <owner/repo> [branch] [--evidence <file>]\n');
    return 2;
  }
  if (evidenceIndex >= 0 && (typeof evidencePath !== 'string' || evidencePath === '')) {
    process.stderr.write('usage: --evidence needs a path to a JSON object holding the fields evaluateMainProvenance reads\n');
    return 2;
  }
  if (typeof evidencePath === 'string') {
    let evaluated;
    try {
      const evidence = await fromEvidenceFile(evidencePath);
      evaluated = await withTrustChain(evaluateMainProvenance({ ...evidence, branch, repo }), evidence); // v3.5b S-3: the command line's repository, never the file's
    } catch (error) {
      process.stderr.write(`main_provenance_indeterminate: ${error instanceof Error ? error.message : 'evidence unreadable'}\n`);
      return 1;
    }
    return report(repo, branch, evaluated, `file:${evidencePath}`);
  }
  const { execFileSync } = await import('node:child_process');
  const gh = (path) => {
    // `gh` runs as the coding worker: read-only on statuses, no administration.
    // Nothing here reads or prints a token, and no provider is contacted.
    const raw = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw);
  };
  const ghAll = (path) => collectPages((page, perPage) =>
    gh(`${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`));
  const ref = encodeURIComponent(branch);

  let result;
  try {
    const mainSha = gh(`repos/${repo}/branches/${ref}`)?.commit?.sha;
    const mainCommit = gh(`repos/${repo}/commits/${mainSha}`);

    /**
     * ONLY A TIP THAT CARRIES A LANDING BLOCK costs the extra reads. The key is read AT THE PARENT (never at the tip, never
     * from the message), the head commit is read by the sha the SIGNED text names, and every failure to read stays
     * undefined so the rule answers indeterminate.
     */
    const mainCommitMessage = mainCommit?.commit?.message;
    let reviewerKeyPem;
    let reviewerKeyAtSha;
    let tipReviewerKeyPem;
    let changedPaths;
    let changedPathsComplete;
    let headCommit;
    const landingBlock = extractLandingBlock(mainCommitMessage);
    const parentOfTip = mainCommit?.parents?.[0]?.sha;
    if (landingBlock.state === 'ok' && typeof parentOfTip === 'string') {
      const keyFile = gh(`repos/${repo}/contents/.github/julius-landing/reviewer-ed25519.pub?ref=${parentOfTip}`);
      if (keyFile?.type === 'file' && keyFile?.encoding === 'base64' && typeof keyFile?.content === 'string') {
        reviewerKeyPem = Buffer.from(keyFile.content, 'base64').toString('utf8');
        reviewerKeyAtSha = parentOfTip;
      }
      const tipKeyFile = gh(`repos/${repo}/contents/.github/julius-landing/reviewer-ed25519.pub?ref=${mainSha}`);
      if (tipKeyFile?.type === 'file' && tipKeyFile?.encoding === 'base64' && typeof tipKeyFile?.content === 'string') {
        tipReviewerKeyPem = Buffer.from(tipKeyFile.content, 'base64').toString('utf8');
      }
      // The compare API lists at most 300 files: a list that may be truncated, or a tip that is not exactly one commit ahead, stays incomplete.
      const comparison = gh(`repos/${repo}/compare/${parentOfTip}...${mainSha}`);
      if (Array.isArray(comparison?.files) && comparison.files.length < 300 && comparison?.ahead_by === 1 && comparison?.behind_by === 0) {
        changedPaths = comparison.files.flatMap((file) => [file?.filename, file?.previous_filename].filter((path) => typeof path === 'string'));
        changedPathsComplete = true;
      }
      const signedHead = parseSignedClearance(Buffer.from(landingBlock.clearanceB64, 'base64').toString('utf8'), repo).fields.head;
      if (isSha(signedHead)) {
        const commit = gh(`repos/${repo}/commits/${signedHead}`);
        headCommit = { sha: commit?.sha, authorLogin: commit?.author?.login, treeSha: commit?.commit?.tree?.sha };
      }
    }
    const pullRequests = ghAll(`repos/${repo}/commits/${mainSha}/pulls`).map((pull) => ({
      number: pull?.number,
      merged: typeof pull?.merged_at === 'string',
      mergeCommitSha: pull?.merge_commit_sha,
      authorLogin: pull?.user?.login,
      headSha: pull?.head?.sha,
      headRef: pull?.head?.ref,
      baseRef: pull?.base?.ref,
    }));
    const landed = pullRequests.find((pull) => pull.merged && pull.mergeCommitSha === mainSha);

    let reviews = [];
    let reviewComments = [];
    let statuses = [];
    let reviewedTreeSha;
    let reviewedHeadShaAfter;
    let parentContainedInReviewedHead;
    let baseRefChanged;
    if (landed && typeof landed.headSha === 'string') {
      reviews = ghAll(`repos/${repo}/pulls/${landed.number}/reviews`);
      reviewComments = ghAll(`repos/${repo}/pulls/${landed.number}/comments`);
      statuses = ghAll(`repos/${repo}/commits/${landed.headSha}/statuses`);
      reviewedTreeSha = gh(`repos/${repo}/commits/${landed.headSha}`)?.commit?.tree?.sha;
      const parent = mainCommit?.parents?.[0]?.sha;
      if (typeof parent === 'string') {
        const comparison = gh(`repos/${repo}/compare/${parent}...${landed.headSha}`);
        const mergeBase = comparison?.merge_base_commit?.sha;
        // Unreadable stays UNDEFINED. "Not proven contained" and "proven not
        // contained" are different answers and only one of them is a fact.
        parentContainedInReviewedHead = typeof mergeBase === 'string' ? mergeBase === parent : undefined;
      }
      /**
       * `base_ref_changed` is the timeline's record of a retarget. Reading the
       * whole timeline and asking whether the event is present is a fact about
       * the pull request; asking WHEN it happened relative to the approval
       * would be an inference from clocks, which this gate does not make.
       */
      baseRefChanged = ghAll(`repos/${repo}/issues/${landed.number}/timeline`)
        .some((event) => event?.event === 'base_ref_changed');
      reviewedHeadShaAfter = gh(`repos/${repo}/pulls/${landed.number}`)?.head?.sha;
    }

    result = evaluateMainProvenance({
      branch,
      mainSha,
      mainShaAfter: gh(`repos/${repo}/branches/${ref}`)?.commit?.sha,
      mainTreeSha: mainCommit?.commit?.tree?.sha,
      mainParents: Array.isArray(mainCommit?.parents) ? mainCommit.parents.map((parent) => parent?.sha) : undefined,
      pullRequests,
      reviewedTreeSha,
      reviewedHeadShaAfter,
      reviews,
      reviewComments,
      statuses,
      parentContainedInReviewedHead,
      baseRefChanged,
      mainCommitMessage,
      repo,
      reviewerKeyPem,
      reviewerKeyAtSha,
      tipReviewerKeyPem,
      changedPaths,
      changedPathsComplete,
      headCommit,
      landingCommitterId: mainCommit?.committer?.id,
      landingVerificationVerified: mainCommit?.commit?.verification?.verified === true,
      landingVerificationReason: mainCommit?.commit?.verification?.reason,
      governedLanderBotId: process.env[GOVERNED_LANDER_BOT_VARIABLE],
    });
    let chainCommits;
    let chainProblem = null;
    const attested = attestedCheckpointFloor(process.cwd());
    const floor = attested ?? TRUSTED_CHECKPOINT_SHA;
    try {
      chainCommits = readFirstParentChain(gh, repo, mainSha, floor);
      if (chainCommits === null) chainProblem = 'the first-parent chain does not reach the trusted checkpoint';
    } catch (error) {
      chainProblem = error instanceof Error && /stopped after 30 commits|incomplete|did not finish/u.test(error.message)
        ? error.message
        : 'the trust chain from the trusted checkpoint could not be read';
    }
    if (result.verdict === 'provenant' && chainProblem) {
      result = { ...result, verdict: 'unprovenanced', reason: chainProblem };
    } else if (!chainProblem) {
      let chainKeyPem = reviewerKeyPem;
      try {
        const keyFile = gh(`repos/${repo}/contents/.github/julius-landing/reviewer-ed25519.pub?ref=${floor}`);
        if (keyFile?.type === 'file' && keyFile?.encoding === 'base64' && typeof keyFile?.content === 'string') {
          chainKeyPem = Buffer.from(keyFile.content, 'base64').toString('utf8');
        }
      } catch {
        // A missing checkpoint key fails closed inside the chain pin.
      }
      const disk = attested ? readCheckpointAttestation(process.cwd()) : null;
      result = await withTrustChain(result, {
        chainCommits,
        reviewerKeyPem: chainKeyPem,
        attestationText: disk?.text,
        attestationSignatureB64: disk?.signatureB64 ?? undefined,
        now: attested ? Date.now() : undefined,
      });
    }
  } catch (error) {
    // Unreadable metadata is not a passing gate.
    process.stderr.write(`main_provenance_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  return report(repo, branch, result, 'github');
}

/**
 * One line, and it names its SOURCE. A verdict read from a file and one read
 * from GitHub are the same rule over different evidence, and a reader who
 * cannot tell them apart cannot judge what the pass is worth.
 */
function report(repo, branch, result, source) {
  const line = `repo=${repo} branch=${branch} source=${source} provenance=${result.verdict}`
    + ` main=${result.mainSha ?? 'unknown'} tree=${result.mainTreeSha ?? 'unknown'}`
    + ` pr=${result.prNumber ?? 'none'} reviewed_head=${result.reviewedHeadSha ?? 'none'}`
    + ` approved_by=${(result.approvedBy ?? []).join(',') || 'none'} reason=${result.reason}`;
  if (result.verdict === 'provenant') {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
