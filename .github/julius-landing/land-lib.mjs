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
// Case-insensitive: a checkout on a case-insensitive filesystem (Windows, macOS) folds `.GITHUB/Julius-Landing/...` onto the governed file.
export const HARD_FORBIDDEN_PATH = /^(\.github\/workflows\/|\.github\/julius-landing\/|\.github\/julius-mission-pins\.txt$|\.github\/julius-approvers\.json$|\.github\/CODEOWNERS$|CODEOWNERS$|docs\/CODEOWNERS$|CLAUDE\.md$|package\.json$|package-lock\.json$|scripts\/julius-approval-gates\.mjs$|scripts\/julius-live-evidence\.mjs$|scripts\/julius-main-provenance\.(mjs|d\.mts|test\.ts)$|\.github\/julius-live-evidence-dump\.sh$|.*\bmigrations?\/)/iu;
// SIGNED-EXCEPTION: the spend ceilings and the effort tripwire live here. A PR may change them only if the reviewer's signed clearance lists the EXACT file in `governed-exceptions`.
export const EXCEPTION_ELIGIBLE = ['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs'];
// Matched case-insensitively for the same reason as above; a case variant is never in the signed list (that list holds exact names only), so it is always refused.
const isExceptionEligible = (f) => EXCEPTION_ELIGIBLE.some((e) => e.toLowerCase() === String(f).toLowerCase());
// "Is this path founder-governed at all": hard-forbidden OR exception-eligible.
export const FORBIDDEN_PATH = { test: (f) => HARD_FORBIDDEN_PATH.test(f) || isExceptionEligible(f) };

/** The canonical clearance text the reviewer signs. One `key: value` per line, fixed key order, LF line ends. */
export const CLEARANCE_KEYS = ['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'];

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
  if (lines.length !== 2 + CLEARANCE_KEYS.length + 1 || lines[lines.length - 1] !== '') problems.push('exactly one trailing newline and no extra lines');
  for (const key of ['head', 'tree', 'base']) if (fields[key] !== undefined && !SHA.test(fields[key])) problems.push(`${key} must be a full 40-hex sha`);
  if (fields.pr !== undefined && !/^[1-9][0-9]{0,6}$/u.test(fields.pr)) problems.push('pr must be a positive integer');
  if (fields.kind !== undefined && !['CLEARED', 'CLEARED-TREE'].includes(fields.kind)) problems.push('kind must be CLEARED or CLEARED-TREE');
  if (fields['governed-exceptions'] !== undefined) {
    const v = fields['governed-exceptions'];
    const list = v === '-' ? [] : v.split(',');
    if (v !== '-' && (list.some((f) => !EXCEPTION_ELIGIBLE.includes(f)) || new Set(list).size !== list.length || [...list].sort().join(',') !== v)) problems.push('governed-exceptions must be "-" or a sorted, comma-separated list of exception-eligible files');
  }
  if (fields.nonce !== undefined && !/^[0-9a-f]{32}$/u.test(fields.nonce)) problems.push('nonce must be 32 hex characters');
  if (fields.by !== undefined && fields.by !== 'INDEPENDENT_REVIEW') problems.push('by must be INDEPENDENT_REVIEW');
  if (fields['bot-comments-sha256'] !== undefined && !/^[0-9a-f]{64}$/u.test(fields['bot-comments-sha256'])) problems.push('bot-comments-sha256 must be 64 hex');
  for (const key of ['issued', 'expires']) {
    if (fields[key] !== undefined && !(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(fields[key]) && !Number.isNaN(Date.parse(fields[key])))) problems.push(`${key} must be a UTC timestamp like 2026-10-19T05:00:00Z`);
  }
  return { problems, fields };
}

/** Ed25519 signature check of the exact clearance bytes against the public key committed on main. */
export function verifyClearanceSignature(text, signatureB64, publicKeyPem) {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return ['the committed reviewer key is not an ed25519 key'];
    const signature = Buffer.from(String(signatureB64).trim(), 'base64');
    if (signature.length !== 64) return ['the signature is not 64 bytes'];
    return verify(null, Buffer.from(text, 'utf8'), key, signature) ? [] : ['the signature does not verify against the committed reviewer key'];
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
  // The git author NAME above is free text. The top-level `author` is the account GitHub resolved from the author email: when present it must be the App. It is null when the
  // email maps to no account, so an unresolved author is NOT refused here (residual: such a commit is identified by the free-text name only). The top-level `committer` is not
  // checked: commits created through the API often carry another committer login.
  if (commit?.author != null && commit.author.login !== APP_LOGIN) problems.push(`the head commit's GitHub author is ${commit.author.login}, not ${APP_LOGIN}`);
  if (!allowedBranches.includes(pr.head?.ref)) problems.push(`branch ${pr.head?.ref} is not in the founder's standing landing allowlist`);
  // `files` holds EVERY name GitHub reports for a changed file: `filename` and, for a rename or copy, `previous_filename` too (a workflow renamed out of .github/workflows is still a
  // workflow change). `fileRows` is how many file rows were actually read; it must equal the PR's own changed_files count, or the list was truncated and nothing is trusted.
  if (fileRows !== pr.changed_files) problems.push(`the files list is incomplete: read ${fileRows} rows, the PR reports ${pr.changed_files} changed files`);
  if (!Number.isInteger(pr.changed_files) || pr.changed_files > 300) problems.push('the PR changes more than 300 files (or the count is unknown); an unattended landing is refused');
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
export function checkCi({ checkRuns, statuses, self, required = [] }) {
  const problems = [];
  const runs = checkRuns.filter((r) => r.name !== self);
  // A founder-governed list of checks that MUST be present exactly once and green: a head on which the important check never ran cannot slip through behind other green checks.
  for (const name of required) {
    const hits = runs.filter((r) => r.name === name);
    if (hits.length !== 1) problems.push(`required check "${name}" appears ${hits.length} times on the head (exactly 1 required)`);
  }
  // Any OTHER name seen more than once is ambiguous too (two workflows can emit the same job name; which one is "the" check is unknowable here): refuse rather than guess.
  const seen = new Map();
  for (const r of runs) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  for (const [name, n] of seen) if (n > 1 && !required.includes(name)) problems.push(`check "${name}" appears ${n} times on the head (ambiguous)`);
  if (runs.length === 0) problems.push('no check runs found on the head');
  for (const r of runs) {
    if (r.status !== 'completed') problems.push(`check "${r.name}" is ${r.status}`);
    else if (!['success', 'neutral'].includes(r.conclusion)) problems.push(`check "${r.name}" concluded ${r.conclusion}`);
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

export const LANDER_IDENTITY = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

/** The commit the lander CREATED, read back from GitHub (REST `commits/{sha}`), against exactly what it asked for: the cleared tree, ONE parent = the cleared base, the exact message
 * and the github-actions[bot] identity. Any difference means the ref update must not follow. */
export function checkCreatedCommit({ created, sha, base, tree, message }) {
  const problems = [];
  if (!SHA.test(String(sha))) problems.push('the created commit has no valid sha');
  if (created?.sha !== undefined && created.sha !== sha) problems.push(`the read-back commit is ${created.sha}, expected ${sha}`);
  if (created?.parents?.length !== 1 || created.parents[0]?.sha !== base) problems.push('the created commit does not have exactly one parent, the cleared base');
  if (created?.commit?.tree?.sha !== tree) problems.push(`the created tree is ${created?.commit?.tree?.sha}, expected ${tree}`);
  if (created?.commit?.message !== message) problems.push('the created commit message differs from the one that was sent');
  for (const who of ['author', 'committer']) {
    if (created?.commit?.[who]?.name !== LANDER_IDENTITY.name || created?.commit?.[who]?.email !== LANDER_IDENTITY.email) problems.push(`the created commit ${who} is not ${LANDER_IDENTITY.name}`);
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
const MARKER_WORDS = ['BEGIN JULIUS LANDING', 'END JULIUS LANDING'];
const canonicalB64 = (text) => typeof text === 'string' && /^[A-Za-z0-9+/]*={0,2}$/u.test(text) && Buffer.from(text, 'base64').toString('base64') === text;
const signatureIsCanonical = (b64) => canonicalB64(b64) && Buffer.from(b64, 'base64').length === 64;

/** Build the landing commit message. `freeText` defaults to the title built from the clearance (PR number and head only); a caller-supplied text is allowed but THROWS when any line
 * carries a marker word (a PR title, say, must never be able to forge or truncate the block) or a CR. THROWS when the clearance does not parse or the signature is not canonical
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
  if (MARKER_WORDS.some((w) => body.includes(w))) throw new Error('the free text of the landing message must not contain a landing marker word');
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
