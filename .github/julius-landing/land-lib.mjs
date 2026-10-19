// Pure functions of the autonomous landing gate. No network, no filesystem, no process state: `land.mjs` feeds them what it read from GitHub and from the checkout,
// and `scripts/julius-landing.test.ts` feeds them hostile input. Every function REFUSES by returning a non-empty `problems` array; nothing here ever merges.
import { createHash, createPublicKey, verify } from 'node:crypto';

export const REPO = 'ohdieyuh-glitch/sunday-relay';
export const APP_LOGIN = 'julius-worker[bot]';
export const MAX_CLEARANCE_AGE_MS = 24 * 60 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/u;

// Paths an unattended lander must NEVER carry onto main: workflows (GitHub would refuse a GITHUB_TOKEN merge anyway, and workflow changes are founder-governed), this landing
// system itself (its key, allowlist and code), the mission pins file, and migrations. Such changes land only through a founder-governed path.
// Case-insensitive: a checkout on a case-insensitive filesystem (Windows, macOS) folds `.GITHUB/Julius-Landing/...` onto the governed file.
export const FORBIDDEN_PATH = /^(\.github\/workflows\/|\.github\/julius-landing\/|\.github\/julius-mission-pins\.txt$|.*\bmigrations?\/)/iu;

/** The canonical clearance text the reviewer signs. One `key: value` per line, fixed key order, LF line ends. */
export const CLEARANCE_KEYS = ['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'nonce', 'by', 'issued', 'expires'];

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

/** The digest the reviewer signs for "these exact bot comments, reviews and inline comments were seen". Order independent. */
export function botCommentsDigest({ issueComments, inlineComments, reviews }) {
  const rows = [
    ...issueComments.map((c) => `issue:${c.user?.login}:${c.id}:${c.updated_at}`),
    ...inlineComments.map((c) => `inline:${c.user?.login}:${c.id}:${c.updated_at ?? c.created_at}`),
    ...reviews.map((r) => `review:${r.user?.login}:${r.id}:${r.state}:${r.commit_id}`),
  ].sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

/** Clearance vs the live pull request. `pr` is the REST `pulls/N` object, `commit` the head commit object, `files` the changed file names. */
export function checkPullRequest({ fields, now, pr, commit, files, mainSha, allowedBranches, digest }) {
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
  const forbidden = files.filter((f) => FORBIDDEN_PATH.test(f));
  if (forbidden.length > 0) problems.push(`the PR changes founder-governed paths: ${forbidden.slice(0, 5).join(', ')}`);
  if (files.length === 0) problems.push('the PR changes no files');
  if (digest !== fields['bot-comments-sha256']) problems.push('the set of bot comments, inline comments or reviews differs from what the reviewer saw');
  return problems;
}

/** Every check run and commit status on the head must have completed green. `self` is the name of this workflow's own check, ignored. */
export function checkCi({ checkRuns, statuses, self }) {
  const problems = [];
  const runs = checkRuns.filter((r) => r.name !== self);
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

/** One use per nonce: a clearance whose nonce already appears in a commit message on main's recent history has been used. */
export function nonceUsed(commitMessages, nonce) {
  return commitMessages.some((m) => String(m).includes(`clearance-nonce ${nonce}`));
}
