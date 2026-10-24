// Pure functions of the autonomous landing gate. No network, no filesystem, no process state: `land.mjs` feeds them what it read from GitHub and from the checkout,
// and `scripts/julius-landing.test.ts` feeds them hostile input. Every function REFUSES by returning a non-empty `problems` array; nothing here ever merges.
import { createHash, createPublicKey, verify } from 'node:crypto';

export const REPO = 'ohdieyuh-glitch/sunday-relay';
export const APP_LOGIN = 'julius-worker[bot]';
export const MAX_CLEARANCE_AGE_MS = 24 * 60 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/u;

// HARD-FORBIDDEN: paths an unattended lander must NEVER carry onto main, with or without a clearance. Workflows (GitHub would refuse a GITHUB_TOKEN merge anyway; workflow
// changes are founder-governed), this landing system (key, allowlist, required checks, code), the mission pins file, migrations, the approver/approval gates, CODEOWNERS,
// CLAUDE.md, package manifests and the evidence dump. Such changes land only through a founder-governed path.
// The main-provenance gate and the review-currency module it imports are PREFIX rules (any file whose path starts with scripts/julius-main-provenance or scripts/julius-review-currency):
// editing either changes what the gate trusts, so no new sibling name can slip past an exact-name list.
// Round 3 prefixes, for the gate and secret-handling scripts that workflows run (anything whose path STARTS with one of these, case-insensitive): scripts/julius-main-monotonicity,
// scripts/julius-paid-slot, scripts/julius-subscription-check, scripts/julius-live-preflight-gates, scripts/julius-accept, scripts/relay-repository-boundary,
// scripts/export-julius-harness, .github/julius-live- (the julius-live-*.sh boundary scripts and their helpers), .github/actions/, .github/julius-mission-slice/,
// .github/julius-learning-registrations/, and scripts/julius-landing (the landing system's own tests, scripts/julius-landing*.test.ts: a PR must not be able to weaken the tests that
// pin the lander). The mission directories (.github/julius-missions/**), relay-bridge/**, src/** and JULIUS_HARNESS_MANIFEST.md stay allowed.
// Case-insensitive: a checkout on a case-insensitive filesystem (Windows, macOS) folds `.GITHUB/Julius-Landing/...` onto the governed file.
// `.github/julius-landing/checkpoints/` is inside the second alternative. A pull request cannot add or replace a checkpoint attestation.
export const HARD_FORBIDDEN_PATH = /^(\.github\/workflows\/|\.github\/julius-landing\/|\.github\/julius-mission-pins\.txt$|\.github\/julius-approvers\.json$|\.github\/CODEOWNERS$|CODEOWNERS$|docs\/CODEOWNERS$|CLAUDE\.md$|package\.json$|package-lock\.json$|scripts\/julius-approval-gates\.mjs$|scripts\/julius-live-evidence\.mjs$|scripts\/julius-main-provenance|scripts\/julius-review-currency|scripts\/julius-main-monotonicity|scripts\/julius-paid-slot|scripts\/julius-subscription-check|scripts\/julius-live-preflight-gates|scripts\/julius-accept|scripts\/relay-repository-boundary|scripts\/export-julius-harness|scripts\/relay-parity-gate|scripts\/wonderland-beta-gate|scripts\/julius-live-preflight-identity|scripts\/julius-derive-scoped-credentials|scripts\/julius-ci-callers|scripts\/ci-test-accounting|scripts\/julius-paid-dispatch|scripts\/julius-paid-run-archive|\.github\/julius-mission-pins\.sh$|\.github\/julius-executor-entrypoint\.sh$|scripts\/julius-docker-executor\.sh$|scripts\/julius-executor-ready\.mjs$|scripts\/julius-reviewer-isolation|scripts\/julius-reviewer-deadline\.mjs$|scripts\/julius-live-preflight\.ts$|scripts\/julius-usage-limit\.mjs$|\.github\/julius-learning-store\.sh$|\.github\/julius-phase\.sh$|\.github\/wait-for-executor\.sh$|\.github\/julius-live-|\.github\/actions\/|\.github\/julius-mission-slice\/|\.github\/julius-learning-registrations\/|scripts\/julius-landing|\.github\/julius-live-evidence-dump\.sh$|.*\bmigrations?\/)/iu;
// SIGNED-EXCEPTION: the spend ceilings and the effort tripwire live here. A PR may change them only if the reviewer's signed clearance lists the EXACT file in `governed-exceptions`.
export const EXCEPTION_ELIGIBLE = ['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs'];
// Matched case-insensitively for the same reason as above; a case variant is never in the signed list (that list holds exact names only), so it is always refused.
const isExceptionEligible = (f) => EXCEPTION_ELIGIBLE.some((e) => e.toLowerCase() === String(f).toLowerCase());
// "Is this path founder-governed at all": hard-forbidden OR exception-eligible.
export const FORBIDDEN_PATH = { test: (f) => HARD_FORBIDDEN_PATH.test(f) || isExceptionEligible(f) };

/** The canonical clearance text the reviewer signs. One `key: value` per line, fixed key order, LF line ends. */
export const CLEARANCE_KEYS = ['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'];
/**
 * Optional lines after `expires`, in this order, each omitted or present once.
 * A clearance without them is the historical form. `protected-paths` is covered
 * by the same signature: it is how a governed landing names founder-governed
 * paths. The historical lander does not honor it.
 */
export const CLEARANCE_OPTIONAL_KEYS = Object.freeze(['protected-paths', 'landing-method', 'binds-draft', 'depends']);

export function splitClearanceList(value) {
  if (value === undefined || value === '-') return [];
  return String(value).split(',');
}

/** Hard-forbidden paths not named in the signed `protected-paths`, plus exception-eligible paths not named in `governed-exceptions`. */
export function unauthorizedGovernedPaths(paths, fields) {
  const exceptions = splitClearanceList(fields?.['governed-exceptions']);
  const listed = splitClearanceList(fields?.['protected-paths']);
  return (Array.isArray(paths) ? paths : []).filter((path) => {
    if (typeof path !== 'string' || path === '') return true;
    if (HARD_FORBIDDEN_PATH.test(path)) return !listed.includes(path);
    if (isExceptionEligible(path) && !exceptions.includes(path)) return true;
    return false;
  });
}

/** Signed protected paths that this diff does not actually change. */
export function unusedProtectedPaths(paths, fields) {
  const listed = splitClearanceList(fields?.['protected-paths']);
  const changed = Array.isArray(paths) ? paths : [];
  return listed.filter((path) => !changed.includes(path));
}

function optionalClearanceProblems(fields) {
  const problems = [];
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
  return problems;
}

export function parseClearance(text) {
  const problems = [];
  const lines = String(text).split('\n');
  if (lines[0] !== 'JULIUS-CLEARANCE-V1') problems.push('first line must be JULIUS-CLEARANCE-V1');
  if (lines[1] !== `repo: ${REPO}`) problems.push(`second line must be "repo: ${REPO}"`);
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
  for (const key of ['head', 'tree', 'base']) if (fields[key] !== undefined && !SHA.test(fields[key])) problems.push(`${key} must be a full 40-hex sha`);
  if (fields.pr !== undefined && !/^[1-9][0-9]{0,6}$/u.test(fields.pr)) problems.push('pr must be a positive integer');
  if (fields.kind !== undefined && !['CLEARED', 'CLEARED-TREE'].includes(fields.kind)) problems.push('kind must be CLEARED or CLEARED-TREE');
  if (fields['governed-exceptions'] !== undefined) {
    const v = fields['governed-exceptions'];
    const list = v === '-' ? [] : v.split(',');
    if (v !== '-' && (list.some((f) => !EXCEPTION_ELIGIBLE.includes(f)) || new Set(list).size !== list.length || [...list].sort().join(',') !== v)) problems.push('governed-exceptions must be "-" or a sorted, comma-separated list of exception-eligible files');
  }
  problems.push(...optionalClearanceProblems(fields));
  if (fields.nonce !== undefined && !/^[0-9a-f]{32}$/u.test(fields.nonce)) problems.push('nonce must be 32 hex characters');
  if (fields.by !== undefined && fields.by !== 'INDEPENDENT_REVIEW') problems.push('by must be INDEPENDENT_REVIEW');
  if (fields['bot-comments-sha256'] !== undefined && !/^[0-9a-f]{64}$/u.test(fields['bot-comments-sha256'])) problems.push('bot-comments-sha256 must be 64 hex');
  for (const key of ['issued', 'expires']) {
    if (fields[key] !== undefined && !(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(fields[key]) && !Number.isNaN(Date.parse(fields[key])))) problems.push(`${key} must be a UTC timestamp like 2026-10-19T05:00:00Z`);
  }
  return { problems, fields };
}

/**
 * The reviewer trust root, duplicated from scripts/julius-main-provenance-trust.mjs so this file does not import it.
 * A test fails if the two copies drift. Full SPKI SHA-256 and the raw 32-byte key. A short prefix is not a match.
 * The same fingerprint must also be presented as JULIUS_REVIEWER_KEY_SHA256. A missing or different value fails closed.
 */
export const PINNED_REVIEWER_SPKI_SHA256 = '7eacf984b77022f9c3719760052b9eaeab0c5fcabe8058050bdc999e365a845c';
export const PINNED_REVIEWER_RAW_KEY = '5797b5d6532f0859182e1969abbc75cca2a4faf89884416de22bf582eb1fd0f3';
export const EXTERNAL_ANCHOR_VARIABLE = 'JULIUS_REVIEWER_KEY_SHA256';

/** Full-length equality of the SPKI SHA-256 and the raw 32-byte key. An 8-hex prefix is not a match. */
export function exactPinnedFingerprint(spkiSha256, rawHex) {
  return typeof spkiSha256 === 'string' && typeof rawHex === 'string'
    && spkiSha256.length === 64 && rawHex.length === 64
    && spkiSha256 === PINNED_REVIEWER_SPKI_SHA256
    && rawHex === PINNED_REVIEWER_RAW_KEY;
}

export function reviewerKeyMaterialProblems(publicKeyPem) {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return ['the committed reviewer key is not an ed25519 key'];
    const der = Buffer.from(key.export({ type: 'spki', format: 'der' }));
    if (der.length < 32) return ['the reviewer key fingerprint could not be read'];
    const spkiSha256 = createHash('sha256').update(der).digest('hex');
    const rawHex = der.subarray(der.length - 32).toString('hex');
    if (!exactPinnedFingerprint(spkiSha256, rawHex)) {
      return [`the reviewer key is not the pinned reviewer key ${PINNED_REVIEWER_SPKI_SHA256}`];
    }
    return [];
  } catch {
    return ['the reviewer key fingerprint could not be read'];
  }
}

export function externalAnchorProblems(external = process.env[EXTERNAL_ANCHOR_VARIABLE]) {
  if (typeof external === 'string' && external.length === 64 && external === PINNED_REVIEWER_SPKI_SHA256) return [];
  if (external === undefined || external === null || external === '') return [`${EXTERNAL_ANCHOR_VARIABLE} is unset`];
  return [`${EXTERNAL_ANCHOR_VARIABLE} does not match the pinned reviewer key ${PINNED_REVIEWER_SPKI_SHA256}`];
}

/** Ed25519 signature check of the exact clearance bytes against the public key committed on main. An unpinned key is refused for that reason. */
export function verifyClearanceSignature(text, signatureB64, publicKeyPem) {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return ['the committed reviewer key is not an ed25519 key'];
    const signature = Buffer.from(String(signatureB64).trim(), 'base64');
    if (signature.length !== 64) return ['the signature is not 64 bytes'];
    const ok = verify(null, Buffer.from(text, 'utf8'), key, signature) === true;
    const material = reviewerKeyMaterialProblems(publicKeyPem);
    if (!ok) {
      if (material.some((problem) => problem.includes('not the pinned reviewer key'))) return material;
      return ['the signature does not verify against the committed reviewer key'];
    }
    if (material.length > 0) return material;
    return externalAnchorProblems(process.env[EXTERNAL_ANCHOR_VARIABLE]);
  } catch (error) {
    return [`signature check failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** sha256 of a body, hex. A missing body hashes as the empty string. */
const bodyHash = (body) => createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex');

/** The digest the reviewer signs for "these exact bot comments, reviews and inline comments were seen". Order independent. Every row carries sha256(body) AND the edit timestamp
 * (`updated_at`, else `created_at`; `submitted_at` for a review): an edited body changes the digest even if a timestamp were ever to stay put, and a new edit timestamp changes it
 * even if the body hash were to stay put. Rows are JSON arrays so no field can bleed into its neighbour. */
export function botCommentsDigest({ issueComments, inlineComments, reviews }) {
  const rows = [
    ...issueComments.map((c) => JSON.stringify(['issue', c.user?.login ?? null, c.id ?? null, c.updated_at ?? c.created_at ?? null, bodyHash(c.body)])),
    ...inlineComments.map((c) => JSON.stringify(['inline', c.user?.login ?? null, c.id ?? null, c.updated_at ?? c.created_at ?? null, bodyHash(c.body)])),
    ...reviews.map((r) => JSON.stringify(['review', r.user?.login ?? null, r.id ?? null, r.state ?? null, r.commit_id ?? null, r.submitted_at ?? r.updated_at ?? null, bodyHash(r.body)])),
  ].sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

/** Clearance vs the live pull request. `pr` is the REST `pulls/N` object, `commit` the head commit object, `files` the changed file names. */
export function checkPullRequest({ fields, now, pr, commit, files, fileRows, mainSha, allowedBranches, digest }) {
  const problems = [];
  const age = now - Date.parse(fields.issued);
  if (Number.isNaN(age) || age < -5 * 60 * 1000) problems.push('the clearance is dated in the future');
  if (now > Date.parse(fields.expires)) problems.push('the clearance has expired');
  if (Date.parse(fields.expires) - Date.parse(fields.issued) > MAX_CLEARANCE_AGE_MS) problems.push('the clearance lifetime exceeds 24 hours');
  if (String(pr.number) !== fields.pr) problems.push(`the clearance is for PR ${fields.pr}, not ${pr.number}`);
  if (pr.state !== 'open' || pr.merged) problems.push('the pull request is not open');
  if (pr.draft) problems.push('the pull request is a draft');
  if (pr.head?.sha !== fields.head) problems.push(`the PR head is ${pr.head?.sha}, the clearance names ${fields.head}`);
  if (pr.head?.repo?.full_name !== REPO) problems.push('the PR head is not in this repository');
  if (pr.base?.ref !== 'main') problems.push('the PR does not target main');
  if (mainSha !== fields.base) problems.push(`main is ${mainSha}, the clearance names base ${fields.base}`);
  if (pr.user?.login !== APP_LOGIN) problems.push(`the PR author is ${pr.user?.login}, not ${APP_LOGIN}`);
  if (pr.commits !== 1) problems.push(`the PR has ${pr.commits} commits, exactly one is required`);
  if (commit?.commit?.tree?.sha !== fields.tree) problems.push(`the head tree is ${commit?.commit?.tree?.sha}, the clearance names ${fields.tree}`);
  if (commit?.parents?.length !== 1 || commit.parents[0]?.sha !== fields.base) problems.push('the head is not one commit directly on the cleared base');
  if (commit?.commit?.author?.name !== APP_LOGIN || commit?.commit?.committer?.name !== APP_LOGIN) problems.push('the head commit is not authored and committed by the App');
  // The git author NAME above is free text. The top-level `author` is the account GitHub resolved from the author email, and it MUST be the App: an UNRESOLVED author (null) is
  // refused too, because the main-provenance gate judges exactly this login and would call the landed tip unprovenanced. The top-level `committer` is not checked: commits created
  // through the API often carry another committer login.
  if (commit?.author?.login !== APP_LOGIN) problems.push(`the head commit's GitHub author is ${commit?.author?.login ?? 'unresolved'}, not ${APP_LOGIN}`);
  if (!allowedBranches.includes(pr.head?.ref)) problems.push(`branch ${pr.head?.ref} is not in the founder's standing landing allowlist`);
  // `files` holds EVERY name GitHub reports for a changed file: `filename` and, for a rename or copy, `previous_filename` too (a workflow renamed out of .github/workflows is still a
  // workflow change). `fileRows` is how many file rows were actually read; it must equal the PR's own changed_files count, or the list was truncated and nothing is trusted.
  if (fileRows !== pr.changed_files) problems.push(`the files list is incomplete: read ${fileRows} rows, the PR reports ${pr.changed_files} changed files`);
  if (!Number.isInteger(pr.changed_files) || pr.changed_files >= 300) problems.push('the PR changes 300 or more files (or the count is unknown); an unattended landing is refused');
  const exceptions = fields['governed-exceptions'] === '-' || fields['governed-exceptions'] === undefined ? [] : fields['governed-exceptions'].split(',');
  const hard = files.filter((f) => HARD_FORBIDDEN_PATH.test(f));
  if (hard.length > 0) problems.push(`the PR changes founder-governed paths: ${hard.slice(0, 5).join(', ')}`);
  const unsigned = files.filter((f) => isExceptionEligible(f) && !exceptions.includes(f));
  if (unsigned.length > 0) problems.push(`the PR changes founder-governed paths: ${unsigned.join(', ')} (not listed in the signed governed-exceptions)`);
  const unused = exceptions.filter((f) => !files.includes(f));
  if (unused.length > 0) problems.push(`the signed clearance lists exceptions the PR does not change: ${unused.join(', ')}`);
  if (files.length === 0) problems.push('the PR changes no files');
  if (digest !== fields['bot-comments-sha256']) problems.push('the set of bot comments, inline comments or reviews differs from what the reviewer saw');
  return problems;
}

/** Every check run and commit status on the head must have completed green. `self` is the name of this workflow's own check, ignored. */
/** The lines of required-checks.txt (comments and blanks already removed) as `{ name, appId }`. A line is `Check name` (matched by name only) or `Check name @15368` (matched by name AND
 * the GitHub App id that must have produced the check run). A malformed id is not guessed at: it stays part of the name, so the check can never be found and the landing refuses. */
export function parseRequiredChecks(lines) {
  return lines.map((line) => {
    const m = /^(.*\S)\s+@([0-9]+)$/u.exec(line);
    return m ? { name: m[1], appId: Number(m[2]) } : { name: line, appId: undefined };
  });
}

/** `required` entries are names or `{ name, appId }`. With an appId the single run of that name must also carry `app.id` equal to it (the check-run API always sends `app`; absent = refused),
 * so a look-alike check posted by another app under the same name cannot stand in for the real one. 'neutral' is NOT green: only 'success' is. */
export function checkCi({ checkRuns, statuses, self, required = [] }) {
  const problems = [];
  const runs = checkRuns.filter((r) => r.name !== self);
  const wanted = required.map((r) => (typeof r === 'string' ? { name: r, appId: undefined } : r));
  const requiredNames = wanted.map((r) => r.name);
  // A founder-governed list of checks that MUST be present exactly once and green: a head on which the important check never ran cannot slip through behind other green checks.
  for (const { name, appId } of wanted) {
    const hits = runs.filter((r) => r.name === name);
    if (hits.length !== 1) problems.push(`required check "${name}" appears ${hits.length} times on the head (exactly 1 required)`);
    else if (appId !== undefined && hits[0].app?.id !== appId) problems.push(`required check "${name}" was produced by app ${hits[0].app?.id ?? 'unknown'}, not the required app ${appId}`);
  }
  // Any OTHER name seen more than once is ambiguous too (two workflows can emit the same job name; which one is "the" check is unknowable here): refuse rather than guess.
  const seen = new Map();
  for (const r of runs) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  for (const [name, n] of seen) if (n > 1 && !requiredNames.includes(name)) problems.push(`check "${name}" appears ${n} times on the head (ambiguous)`);
  if (runs.length === 0) problems.push('no check runs found on the head');
  for (const r of runs) {
    if (r.status !== 'completed') problems.push(`check "${r.name}" is ${r.status}`);
    else if (r.conclusion !== 'success') problems.push(`check "${r.name}" concluded ${r.conclusion}`);
  }
  for (const s of statuses) if (s.state !== 'success') problems.push(`status "${s.context}" is ${s.state}`);
  return problems;
}

export function ciIsPending({ checkRuns, statuses, self }) {
  return checkRuns.filter((r) => r.name !== self).some((r) => r.status !== 'completed') || statuses.some((s) => s.state === 'pending');
}

export function checkLanded({ landed, base, tree }) {
  const problems = [];
  if (landed?.parents?.length !== 1 || landed.parents[0]?.sha !== base) problems.push('the landed commit is not directly on the cleared base');
  if (landed?.commit?.tree?.sha !== tree) problems.push(`the landed tree is ${landed?.commit?.tree?.sha}, expected ${tree}`);
  return problems;
}

/** The lander App, pinned in this governed file. Not a repository variable. Installation id is not consulted, so it is not pinned. */
export const LANDER_APP_ID = '5444986';
export const LANDER_BOT_LOGIN = 'julius-lander[bot]';
export const LANDER_BOT_USER_ID = '347026632';
export const LANDER_IDENTITY = { name: LANDER_BOT_LOGIN, email: `${LANDER_BOT_USER_ID}+julius-lander[bot]@users.noreply.github.com` };

/** The commit the lander CREATED, read back from GitHub (REST `commits/{sha}`), against exactly what it asked for: the cleared tree, ONE parent = the cleared base, the exact message
 * and the julius-lander[bot] identity. Any difference means the ref update must not follow. */
export function checkCreatedCommit({ created, sha, base, tree, message, identity = LANDER_IDENTITY }) {
  const problems = [];
  if (!SHA.test(String(sha))) problems.push('the created commit has no valid sha');
  if (created?.sha !== undefined && created.sha !== sha) problems.push(`the read-back commit is ${created.sha}, expected ${sha}`);
  if (created?.parents?.length !== 1 || created.parents[0]?.sha !== base) problems.push('the created commit does not have exactly one parent, the cleared base');
  if (created?.commit?.tree?.sha !== tree) problems.push(`the created tree is ${created?.commit?.tree?.sha}, expected ${tree}`);
  // GitHub's git data API stores a created commit's message WITHOUT its final newline (real run 39290405293: sent 1246 bytes, stored 1245). Accept exactly the message that was sent, or the
  // sent message minus its ONE final newline; nothing else (no other trailing whitespace, no other byte). The signed block, the nonce and the signature are still compared byte for byte.
  const stored = created?.commit?.message;
  if (typeof message !== 'string' || (stored !== message && !(message.endsWith('\n') && stored === message.slice(0, -1)))) problems.push('the created commit message differs from the one that was sent');
  for (const who of ['author', 'committer']) {
    if (created?.commit?.[who]?.name !== identity.name || created?.commit?.[who]?.email !== identity.email) problems.push(`the created commit ${who} is not ${identity.name}`);
  }
  return problems;
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* THE LANDING COMMIT MESSAGE (format "JULIUS LANDING v1"). The lander creates the landed commit itself (git data API), so the signed clearance travels INSIDE the commit it
 * authorizes and the main-provenance gate can verify it from the commit message alone. ONE definition, here; .github/julius-landing/README.md specifies it for other implementers.
 *
 *   <free text: subject, blank line, body; no line may contain the words BEGIN JULIUS LANDING or END JULIUS LANDING>
 *   <blank line>
 *   -----BEGIN JULIUS LANDING-----
 *   v: 1
 *   clearance-nonce: <32 hex = the clearance's nonce>
 *   clearance-b64: <standard base64, padded, ONE line, of the EXACT signed clearance text bytes>
 *   signature-b64: <standard base64, padded, ONE line, of the 64-byte ed25519 signature over those bytes>
 *   -----END JULIUS LANDING-----
 *   <single trailing newline, nothing after>
 *
 * The PR number, head, tree and base are NOT repeated as free fields: a reader takes them ONLY from the signed clearance text. */
export const LANDING_BEGIN = '-----BEGIN JULIUS LANDING-----';
export const LANDING_END = '-----END JULIUS LANDING-----';
// The provenance gate counts EVERY mention of this (uppercase) phrase in a message and answers indeterminate for more than the two marker lines, so free text may not contain it at all.
const MARKER_PHRASE = 'JULIUS LANDING';
const markerMentions = (text) => text.split(MARKER_PHRASE).length - 1;
const canonicalB64 = (text) => typeof text === 'string' && /^[A-Za-z0-9+/]*={0,2}$/u.test(text) && Buffer.from(text, 'base64').toString('base64') === text;
const signatureIsCanonical = (b64) => canonicalB64(b64) && Buffer.from(b64, 'base64').length === 64;

/** Build the landing commit message. `freeText` defaults to the title built from the clearance (PR number and head only); a caller-supplied text is allowed but THROWS when any line
 * mentions the uppercase phrase JULIUS LANDING at all (a PR title, say, must never be able to forge or truncate the block) or carries a CR. THROWS when the clearance does not parse or the signature is not canonical
 * base64 of 64 bytes (the signature is verified against the key by the caller, not here). */
export function buildLandingCommitMessage({ clearanceText, signatureB64, freeText }) {
  const parsed = parseClearance(clearanceText);
  if (parsed.problems.length) throw new Error(`cannot build a landing message from a malformed clearance: ${parsed.problems.join('; ')}`);
  const signature = String(signatureB64).trim();
  if (!signatureIsCanonical(signature)) throw new Error('the signature must be canonical base64 of 64 bytes');
  const f = parsed.fields;
  const text = freeText ?? `${squashTitle(f.pr, f.head)}\n\nLanded by the Julius landing workflow: reviewer clearance (${f.kind}) issued ${f.issued}, head ${f.head}, tree ${f.tree}, base ${f.base}. Rollback: git revert of this commit.`;
  const body = String(text).replace(/\n+$/u, '');
  if (body === '') throw new Error('the free text of the landing message must not be empty');
  if (body.includes('\r')) throw new Error('the free text of the landing message must not contain CR');
  if (markerMentions(body) > 0) throw new Error(`the free text of the landing message must not contain "${MARKER_PHRASE}" (uppercase) anywhere`);
  return [body, '', LANDING_BEGIN, 'v: 1', `clearance-nonce: ${f.nonce}`, `clearance-b64: ${Buffer.from(clearanceText, 'utf8').toString('base64')}`, `signature-b64: ${signature}`, LANDING_END, ''].join('\n');
}

/** Parse a landing commit message strictly. Returns { problems, fields }; fields = { freeText, nonce, clearanceText, signatureB64, clearance } where `clearance` is the parsed signed
 * text (the ONLY source of pr, head, tree and base). Options: `expected` { pr, head, tree, base } (any subset) must equal the signed clearance's values; `publicKeyPem` also
 * verifies the ed25519 signature (without it only the format is judged and the caller must verify). */
export function parseLandingCommitMessage(message, { expected, publicKeyPem } = {}) {
  const problems = [];
  const fields = {};
  const text = String(message);
  if (text.includes('\r')) problems.push('CR is not allowed');
  if (!text.endsWith('\n') || text.endsWith('\n\n')) problems.push('the message must end with exactly one newline');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const begins = lines.reduce((acc, l, i) => (l.includes('BEGIN JULIUS LANDING') ? [...acc, i] : acc), []);
  const ends = lines.reduce((acc, l, i) => (l.includes('END JULIUS LANDING') ? [...acc, i] : acc), []);
  if (begins.length !== 1 || ends.length !== 1) { problems.push(`exactly one BEGIN and one END marker are required (found ${begins.length} and ${ends.length})`); return { problems, fields }; }
  // Every mention of the phrase anywhere in the message: exactly the two marker lines carry it (one each), nothing else.
  if (markerMentions(text) !== 2) { problems.push(`"${MARKER_PHRASE}" must appear exactly twice (the two marker lines); found ${markerMentions(text)}`); return { problems, fields }; }
  const [b] = begins; const [e] = ends;
  if (lines[b] !== LANDING_BEGIN) problems.push('the BEGIN marker must be exactly its line');
  if (lines[e] !== LANDING_END) problems.push('the END marker must be exactly its line');
  if (e !== lines.length - 1) problems.push('nothing may follow the END marker');
  if (b === 0) problems.push('free text must come before the block');
  if (e - b !== 5) problems.push('the block must hold exactly four key lines');
  if (problems.length) return { problems, fields };
  const block = lines.slice(b + 1, e);
  const raw = {};
  ['v', 'clearance-nonce', 'clearance-b64', 'signature-b64'].forEach((key, i) => {
    if (!block[i].startsWith(`${key}: `)) problems.push(`block line ${i + 1} must start with "${key}: "`);
    else raw[key] = block[i].slice(key.length + 2);
  });
  if (raw.v !== undefined && raw.v !== '1') problems.push('v must be 1');
  if (raw['clearance-nonce'] !== undefined && !/^[0-9a-f]{32}$/u.test(raw['clearance-nonce'])) problems.push('clearance-nonce must be 32 hex characters');
  if (raw['clearance-b64'] !== undefined && (raw['clearance-b64'] === '' || !canonicalB64(raw['clearance-b64']))) problems.push('clearance-b64 must be canonical base64 on one line');
  if (raw['signature-b64'] !== undefined && !signatureIsCanonical(raw['signature-b64'])) problems.push('signature-b64 must be canonical base64 of 64 bytes');
  if (problems.length) return { problems, fields };
  const clearanceText = Buffer.from(raw['clearance-b64'], 'base64').toString('utf8');
  const parsed = parseClearance(clearanceText);
  for (const p of parsed.problems) problems.push(`clearance: ${p}`);
  if (parsed.problems.length === 0) {
    const c = parsed.fields;
    if (raw['clearance-nonce'] !== c.nonce) problems.push(`the block nonce (${raw['clearance-nonce']}) differs from the signed clearance nonce (${c.nonce})`);
    for (const key of ['pr', 'head', 'tree', 'base']) if (expected?.[key] !== undefined && String(expected[key]) !== c[key]) problems.push(`the signed clearance ${key} is ${c[key]}, expected ${expected[key]}`);
    fields.clearance = c;
  }
  if (publicKeyPem !== undefined) problems.push(...verifyClearanceSignature(clearanceText, raw['signature-b64'], publicKeyPem));
  Object.assign(fields, { freeText: lines.slice(0, b).join('\n'), nonce: raw['clearance-nonce'], clearanceText, signatureB64: raw['signature-b64'] });
  return { problems, fields };
}

/** The paging rule shared by the lander and the reviewer tools, so both read the same set. `getPage(page)` returns that page's rows (per_page=100). A short page ends the
 * read; a FULL page at the cap THROWS (fail closed): a silent stop would hide rows past the cap (a forbidden file, a failing check, a comment the digest must cover). */
export const PER_PAGE = 100;
export const MAX_PAGES = 10;
export async function readAllPages(getPage) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await getPage(page);
    if (!Array.isArray(rows)) throw new Error(`page ${page} is not a list`);
    all.push(...rows);
    if (rows.length < PER_PAGE) return all;
  }
  throw new Error(`more than ${MAX_PAGES * PER_PAGE} rows: refusing rather than reading a partial set`);
}

/** The squash commit title, built from the PR number and the cleared head only. Never the PR title: anyone with write access can edit that, and it would land verbatim on main. */
export function squashTitle(number, head) {
  return `Landed PR #${number} (${String(head).slice(0, 12)})`;
}

/** One use per nonce: a clearance whose nonce already appears in a commit message on main's recent history has been used. */
export function nonceUsed(commitMessages, nonce) {
  // Two spellings: `clearance-nonce <nonce>` (the earlier merge-API landings) and `clearance-nonce: <nonce>` (the key line of the landing block below).
  return commitMessages.some((m) => String(m).includes(`clearance-nonce ${nonce}`) || String(m).includes(`clearance-nonce: ${nonce}`));
}

/** The job must be running the workflow as it is on main's tip: a dispatch from any other ref or commit is refused. */
export function checkRuntime({ ref, sha, mainSha }) {
  const problems = [];
  if (ref !== 'refs/heads/main') problems.push(`the workflow runs from ${ref}, not refs/heads/main`);
  if (sha !== mainSha) problems.push(`the workflow commit ${sha} is not main's tip ${mainSha}`);
  return problems;
}
