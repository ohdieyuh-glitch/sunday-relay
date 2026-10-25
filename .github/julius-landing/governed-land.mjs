// Governed landing. Pure decisions live in the exports. The CLI at the bottom
// reads GitHub and writes only after every decision is a pass. The ref update
// is non-forced. Crypto and the clearance parser stay in land-lib.mjs.
import { createHash, createSign } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COMMENTS_DIGEST_RULE,
  HARD_FORBIDDEN_PATH,
  REPO,
  botCommentsDigest,
  buildLandingCommitMessage,
  checkCi,
  checkCreatedCommit,
  checkRuntime,
  nonceUsed,
  parseClearance,
  parseRequiredChecks,
  readAllPages,
  splitClearanceList,
  squashTitle,
  unauthorizedGovernedPaths,
  unusedProtectedPaths,
  verifyClearanceSignature,
} from './land-lib.mjs';
import {
  CHECKPOINT_ATTESTATION_DIR,
  FOUNDER_APPROVAL_KEY_PATH,
  TRUSTED_COMPUTING_BASE,
  founderApprovalProblem,
  attestationShapeProblem,
  checkpointAttestationProblems,
  checkpointPairingRequired,
  governedAuditBranchProblem,
  governedLandingShapeProblem,
  judgeClearanceWindow,
  landingIdentityProblem,
} from '../../scripts/julius-main-provenance-trust.mjs';

export const GOVERNED_SELF_CHECK = 'Land a governed pull request';
const BEGIN = '-----BEGIN JULIUS CLEARANCE-----\n';
const BETWEEN = '-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n';
const SIGNATURE_END = '\n-----END JULIUS CLEARANCE SIGNATURE-----';
const FOUNDER_FIELD = 'founder-signature-b64: ';

/**
 * Clearance blocks in one body, with the [start, end) offsets each block occupies.
 * The signature block holds the reviewer signature on its first line and, for
 * a governed change (H1), a second line `founder-signature-b64: <base64>`: the
 * founder-approval signature over the same clearance bytes, outside the
 * signed text. An empty first line with a founder field is kept, so the
 * refusal can say reviewer_signature_missing.
 */
function deliverySpans(body) {
  const text = String(body ?? '');
  const spans = [];
  let cursor = 0;
  while (text.indexOf(BEGIN, cursor) >= 0) {
    const start = text.indexOf(BEGIN, cursor);
    const textStart = start + BEGIN.length;
    const mid = text.indexOf(BETWEEN, textStart);
    if (mid < 0) break;
    const clearanceText = text.slice(textStart, mid);
    const signatureStart = mid + BETWEEN.length;
    const close = text.indexOf(SIGNATURE_END, signatureStart);
    if (close < 0) break;
    const lines = text.slice(signatureStart, close).split('\n');
    const end = close + SIGNATURE_END.length;
    const signatureB64 = lines[0];
    const founderSignatureB64 = lines.length === 2 && lines[1].startsWith(FOUNDER_FIELD) ? lines[1].slice(FOUNDER_FIELD.length) : undefined;
    const wellFormed = lines.length === 1 ? signatureB64 !== '' : (founderSignatureB64 !== undefined && founderSignatureB64 !== '');
    if (wellFormed) spans.push({ clearanceText, signatureB64, founderSignatureB64, start, end });
    cursor = end;
  }
  return spans;
}

/** Every clearance block in the comment bodies. The signature, not the commenter, is the authority. */
export function extractClearanceDeliveries(bodies) {
  const deliveries = [];
  for (const body of Array.isArray(bodies) ? bodies : []) {
    for (const { clearanceText, signatureB64, founderSignatureB64 } of deliverySpans(body)) {
      deliveries.push(founderSignatureB64 === undefined ? { clearanceText, signatureB64 } : { clearanceText, signatureB64, founderSignatureB64 });
    }
  }
  return deliveries;
}

const CANONICAL_SIGNATURE = (b64) => typeof b64 === 'string' && /^[A-Za-z0-9+/]+={0,2}$/u.test(b64)
  && Buffer.from(b64, 'base64').length === 64 && Buffer.from(b64, 'base64').toString('base64') === b64;

/**
 * True when the comment is only deliveries of this exact clearance text: every
 * block carries that text and a canonical 64-byte signature, and nothing but
 * whitespace sits outside the blocks. Such a comment cannot be inside the
 * digest it carries. Any other comment, including one that adds a word to a
 * delivery or delivers a different clearance, stays in the digest.
 */
export function isClearanceDeliveryComment(body, clearanceText) {
  const text = String(body ?? '');
  const spans = deliverySpans(text);
  if (spans.length === 0 || typeof clearanceText !== 'string' || clearanceText === '') return false;
  let outside = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.clearanceText !== clearanceText || !CANONICAL_SIGNATURE(span.signatureB64)) return false;
    if (span.founderSignatureB64 !== undefined && !CANONICAL_SIGNATURE(span.founderSignatureB64)) return false;
    outside += text.slice(cursor, span.start);
    cursor = span.end;
  }
  outside += text.slice(cursor);
  return outside.trim() === '';
}

/**
 * The digest a governed clearance signs, under its signed
 * `comments-digest: excludes-delivery` rule: the historical botCommentsDigest
 * over every inline comment, every review, and every issue comment except
 * those that only deliver this exact clearance.
 */
export function governedCommentsDigest({ issueComments, inlineComments, reviews, clearanceText }) {
  const kept = (Array.isArray(issueComments) ? issueComments : []).filter((comment) => !isClearanceDeliveryComment(comment?.body, clearanceText));
  return botCommentsDigest({
    issueComments: kept,
    inlineComments: Array.isArray(inlineComments) ? inlineComments : [],
    reviews: Array.isArray(reviews) ? reviews : [],
  });
}

/**
 * Signed clearances for this exact head, tree, and base. The newest signed
 * `issued` wins. Comment time is not the order. A clearance for any other
 * head, tree, or base is ignored. Two texts that share that `issued` and
 * disagree are a refusal. The signature, not the commenter, is the authority.
 */
export function chooseClearanceDelivery(comments, publicKeyPem, expected = {}) {
  const rows = (Array.isArray(comments) ? comments : []).map((comment) => (
    typeof comment === 'string' ? { body: comment, created_at: '', id: 0 } : (comment ?? {})
  ));
  const verified = [];
  for (const comment of rows) {
    for (const delivery of extractClearanceDeliveries([comment.body])) {
      const parsed = parseClearance(delivery.clearanceText);
      if (parsed.problems.length > 0) continue;
      if (verifyClearanceSignature(delivery.clearanceText, delivery.signatureB64, publicKeyPem).length > 0) continue;
      const fields = parsed.fields;
      if (typeof expected.head === 'string' && fields.head !== expected.head) continue;
      if (typeof expected.tree === 'string' && fields.tree !== expected.tree) continue;
      if (typeof expected.base === 'string' && fields.base !== expected.base) continue;
      verified.push({
        ...delivery,
        fields,
        created_at: String(comment.created_at ?? ''),
        id: Number(comment.id ?? 0),
      });
    }
  }
  if (verified.length === 0) {
    // A founder signature with no reviewer signature is its own refusal: the reviewer signature is always required.
    const founderOnly = rows.some((comment) => extractClearanceDeliveries([comment.body]).some((delivery) => delivery.signatureB64 === '' && typeof delivery.founderSignatureB64 === 'string'));
    if (founderOnly) return { problem: 'reviewer_signature_missing: a clearance delivery carries a founder-approval signature and no reviewer signature' };
    return { problem: 'no signed clearance is on the pull request' };
  }
  verified.sort((left, right) => {
    const issued = String(left.fields.issued).localeCompare(String(right.fields.issued));
    if (issued !== 0) return issued;
    return left.id - right.id;
  });
  const newest = verified[verified.length - 1];
  const issued = String(newest.fields.issued);
  const texts = new Set(verified.filter((row) => String(row.fields.issued) === issued).map((row) => row.clearanceText));
  if (texts.size !== 1) return { problem: 'signed clearances for this pull request do not agree' };
  // Every founder-approval signature delivered with these exact bytes. The decision verifies them; none is trusted here.
  const founderSignatures = [...new Set(verified
    .filter((row) => row.clearanceText === newest.clearanceText && typeof row.founderSignatureB64 === 'string')
    .map((row) => row.founderSignatureB64))];
  return { delivery: { ...newest, founderSignatures } };
}

export function parseGovernedQueue(text) {
  const entries = [];
  const problems = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([1-9][0-9]{0,6})(?:\s+depends:\s*([1-9][0-9]{0,6}(?:,[1-9][0-9]{0,6})*|-))?$/u.exec(line);
    if (!match) {
      problems.push(`bad queue line: ${line}`);
      continue;
    }
    const pr = Number(match[1]);
    if (seen.has(pr)) {
      problems.push(`pull request ${pr} is listed twice`);
      continue;
    }
    seen.add(pr);
    const depText = match[2] ?? '-';
    const depends = depText === '-' ? [] : depText.split(',').map(Number);
    if (depends.length > 0 && [...depends].sort((a, b) => a - b).join(',') !== depText) {
      problems.push(`depends for pull request ${pr} must be numerically sorted`);
    }
    entries.push({ pr, depends });
  }
  return { problems, entries };
}

/**
 * Walk the queue. `evaluate(entry, landed)` sees pull requests landed earlier
 * in this same walk. A refusal stops the walk when a later entry depends on it.
 */
export function planGovernedQueue(entries, landedOnMain, evaluate) {
  const landed = new Set(Array.isArray(landedOnMain) ? landedOnMain : []);
  const results = [];
  const list = Array.isArray(entries) ? entries : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const missing = (entry.depends ?? []).filter((id) => !landed.has(id));
    const decision = missing.length > 0
      ? { ok: false, problems: [`dependency not on main: ${missing.join(', ')}`] }
      : evaluate(entry, landed);
    results.push({
      pr: entry.pr,
      ok: decision?.ok === true,
      problems: decision?.problems ?? ['the queue entry produced no decision'],
      decision,
    });
    if (decision?.ok === true) {
      landed.add(entry.pr);
      continue;
    }
    const blocksLater = list.slice(index + 1).some((later) => (later.depends ?? []).includes(entry.pr));
    if (blocksLater) return { stopped: true, results };
  }
  return { stopped: false, results };
}

export function formatLandingRecord(record) {
  const checks = Array.isArray(record?.checkRunIds) && record.checkRunIds.length > 0 ? record.checkRunIds.join(',') : '-';
  const status = record?.status === 'final' ? 'final' : 'pending';
  const main = typeof record?.resultingMainSha === 'string' && record.resultingMainSha !== '' ? record.resultingMainSha : 'pending';
  return [
    'JULIUS GOVERNED LANDING',
    `status: ${status}`,
    `pr: ${record.pr}`,
    `head: ${record.head}`,
    `tree: ${record.tree}`,
    `base: ${record.base}`,
    `clearance-sha256: ${record.clearanceDigest}`,
    `check-runs: ${checks}`,
    `main: ${main}`,
    `method: ${record.method}`,
    '',
  ].join('\n');
}

/** The commit message is the audit record. A pull-request comment is not. */
export function parseAuditRecord(message) {
  if (typeof message !== 'string' || !message.includes('JULIUS GOVERNED LANDING\n')) return null;
  const text = `\n${message}`;
  const status = /\nstatus: (pending|final)\n/u.exec(text);
  const pr = /\npr: ([1-9][0-9]{0,6})\n/u.exec(text);
  const method = /\nmethod: (squash|fast-forward)\n/u.exec(text);
  const main = /\nmain: ([0-9a-f]{40}|pending)\n/u.exec(text);
  if (!status || !pr || !method || !main) return null;
  return { status: status[1], pr: Number(pr[1]), method: method[1], main: main[1] };
}

/**
 * `contains(ancestor, descendant)` is true when ancestor is descendant or a
 * first-parent ancestor of it. An audit counts only when that commit was
 * created by the App: committer id is the bot id, and GitHub reports the
 * signature verified and valid. A `main:` line in any other commit is not a sha.
 */
export function landedPullsFromAudits(audits, mainSha, contains, botId) {
  const landed = new Set();
  for (const audit of Array.isArray(audits) ? audits : []) {
    if (landingIdentityProblem({
      committerId: audit?.committerId,
      verificationVerified: audit?.verificationVerified === true,
      verificationReason: audit?.verificationReason,
      botId,
    })) continue;
    const record = parseAuditRecord(audit?.message);
    if (!record || typeof contains !== 'function') continue;
    const proven = record.method === 'squash'
      ? contains(audit.sha, mainSha) === true
      : record.main !== 'pending' && contains(record.main, mainSha) === true;
    if (proven) landed.add(record.pr);
  }
  return landed;
}

/** The create-commit body. GitHub signs an App commit only when author and committer are both omitted. */
export function governedCommitBody({ message, tree, parents }) {
  return { message, tree, parents };
}

export const GOVERNED_READ_PERMISSIONS = Object.freeze({
  contents: 'read',
  pull_requests: 'read',
  checks: 'read',
  actions: 'read',
  metadata: 'read',
  statuses: 'read',
});

/** workflows:write only when a changed path is under .github/workflows. statuses:read is always requested. */
export function governedWritePermissions(paths, { founderApproved = false } = {}) {
  const permissions = {
    contents: 'write',
    pull_requests: 'write',
    checks: 'read',
    actions: 'read',
    metadata: 'read',
    statuses: 'read',
  };
  // H1: workflows:write only after both the reviewer and the founder-approval signatures verified.
  if (founderApproved === true && (Array.isArray(paths) ? paths : []).some((path) => /^\.github\/workflows\//iu.test(path))) permissions.workflows = 'write';
  return permissions;
}

export const GOVERNED_WORKFLOW_REF = 'ohdieyuh-glitch/sunday-relay/.github/workflows/julius-governed-land.yml@refs/heads/main';

/** The job must be main, and the workflow file must be the one on that same commit. */
export function checkWorkflowOrigin({ ref, sha, workflowRef, workflowSha }) {
  const problems = [];
  if (ref !== 'refs/heads/main') problems.push(`the workflow runs from ${ref ?? 'an unreadable ref'}, not refs/heads/main`);
  if (workflowRef !== GOVERNED_WORKFLOW_REF) problems.push(`the workflow file is ${workflowRef ?? 'unreadable'}, not ${GOVERNED_WORKFLOW_REF}`);
  if (typeof sha !== 'string' || typeof workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(sha) || workflowSha !== sha) {
    problems.push('the workflow file is not the commit that is main');
  }
  return problems;
}

const appBypass = (actor, appId) => actor?.actor_type === 'Integration' && String(actor?.actor_id) === appId && actor?.bypass_mode === 'always';

/**
 * GitHub ruleset ref pattern. `~ALL` and `~DEFAULT_BRANCH` are the whole pattern.
 * `*` and `?` are fnmatch with FNM_PATHNAME: neither matches `/`. A trailing
 * `**` is two stars, so it acts like `*` and does not cross `/`. A character
 * class or an escape cannot be evaluated here and returns null, which the
 * caller treats as a refusal.
 */
export function refPatternMatches(pattern, ref) {
  if (pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return ref === 'refs/heads/main';
  if (typeof pattern !== 'string' || pattern === '' || typeof ref !== 'string') return null;
  if (/[[\]\\]/u.test(pattern)) return null;
  let source = '^';
  for (const char of pattern) {
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (/[.+^${}()|]/u.test(char)) source += `\\${char}`;
    else source += char;
  }
  try {
    return new RegExp(`${source}$`, 'u').test(ref);
  } catch {
    return null;
  }
}

/** Whether the snapshot's include and exclude patterns cover `ref`. Unevaluable patterns refuse. */
export function rulesetCoversRef(conditions, ref = 'refs/heads/main') {
  const include = conditions?.ref_name?.include;
  const exclude = conditions?.ref_name?.exclude ?? [];
  if (!Array.isArray(include) || include.length === 0 || !Array.isArray(exclude)) {
    return { ok: false, problem: `the main ruleset snapshot does not cover ${ref}` };
  }
  for (const pattern of [...include, ...exclude]) {
    if (refPatternMatches(pattern, ref) === null) {
      return { ok: false, problem: 'the main ruleset snapshot has a ref pattern that cannot be evaluated' };
    }
  }
  const hit = include.some((pattern) => refPatternMatches(pattern, ref) === true);
  const skip = exclude.some((pattern) => refPatternMatches(pattern, ref) === true);
  if (!hit || skip) return { ok: false, problem: `the main ruleset snapshot does not cover ${ref}` };
  return { ok: true };
}

const RULE_TYPES = ['deletion', 'non_fast_forward', 'creation', 'update'];

/**
 * The branch-rules list is what metadata can read. The snapshot is the admin's
 * out-of-band copy of the ruleset, including bypass actors, and it is part of
 * the trusted computing base. Live rules for the pinned ruleset id must match
 * the snapshot's rule types and parameters. Any other ruleset that appears on
 * main fails closed, whatever its source. A disabled ruleset is absent from
 * this list and is not a refusal. Bypass actors are compared to the App id
 * from the environment. They are not on the live response.
 */
export function branchRulesProblems(liveRules, snapshot, appId) {
  const id = String(appId ?? '').trim();
  if (!/^[1-9][0-9]{0,16}$/u.test(id)) return ['JULIUS_GOVERNED_LANDER_APP_ID is unset'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['the main ruleset snapshot could not be read'];
  if (!Number.isInteger(snapshot.id) || snapshot.id < 1) return ['the main ruleset snapshot has no pinned ruleset id'];
  if (snapshot.enforcement !== 'active') return ['the main ruleset snapshot is not active'];
  const mainCover = rulesetCoversRef(snapshot.conditions, 'refs/heads/main');
  if (!mainCover.ok) return [mainCover.problem];
  const auditCover = rulesetCoversRef(snapshot.conditions, 'refs/heads/julius-governed-audit/pr/1');
  if (!auditCover.ok) return ['the main ruleset snapshot does not cover refs/heads/julius-governed-audit/**'];
  const actors = snapshot.bypass_actors;
  if (!Array.isArray(actors) || actors.length !== 1 || !appBypass(actors[0], id)) {
    return ['the main ruleset snapshot does not name only the governed lander app as an always bypass'];
  }
  const snapshotRules = Array.isArray(snapshot.rules) ? snapshot.rules : [];
  const snapshotTypes = snapshotRules.map((rule) => rule?.type);
  if (snapshotTypes.length !== RULE_TYPES.length || RULE_TYPES.some((type) => !snapshotTypes.includes(type))) {
    return ['the main ruleset snapshot does not block deletion, force pushes, creation, and updates'];
  }
  if (!Array.isArray(liveRules)) return ['the main branch rules could not be read'];
  if (liveRules.some((rule) => rule?.ruleset_id !== snapshot.id)) {
    return ['an active ruleset other than the pinned main ruleset applies to main'];
  }
  if (liveRules.length !== snapshotRules.length) return ['the live main branch rules do not match the pinned ruleset snapshot'];
  for (const rule of snapshotRules) {
    const match = liveRules.find((row) => row?.type === rule.type);
    if (!match || JSON.stringify(match.parameters ?? {}) !== JSON.stringify(rule.parameters ?? {})) {
      return ['the live main branch rules do not match the pinned ruleset snapshot'];
    }
  }
  return [];
}

/**
 * A nonce tag counts as a spent clearance only when its target commit was
 * created by the App. Ruleset 25739940 (landing-nonce-tags) is disabled, so
 * anyone who can push can create `refs/tags/julius-landing-nonce-*`. Existence
 * alone is not a spend. A tag whose target is not an App-verified commit is a
 * refusal, and it is not recorded as a used nonce. The lander does not delete
 * or move the tag, so that pre-created tag blocks this nonce until it is removed.
 */
export function nonceTagProblem({ exists, nonce, committerId, verificationVerified, verificationReason, botId, unreadable } = {}) {
  if (exists !== true) return null;
  if (unreadable === true) return 'the nonce tag could not be read';
  const identity = landingIdentityProblem({ committerId, verificationVerified, verificationReason, botId });
  if (identity === null) return 'this clearance nonce was already used on main';
  if (identity === 'JULIUS_GOVERNED_LANDER_BOT_ID is unset') return identity;
  return `the nonce tag refs/tags/julius-landing-nonce-${nonce} already exists and was not created by the governed lander app`;
}

/**
 * Create `ref` at `sha`. A second attempt that finds the same sha is success.
 * A different sha is not rewritten. Callers create this ref only after main
 * has moved, so a failed move leaves nothing for the next attempt to collide with.
 */
export async function ensureAuditRef(ref, sha, io) {
  try {
    await io.create(ref, sha);
    return { ok: true };
  } catch {
    let existing = '';
    try {
      existing = await io.read(ref);
    } catch {
      return { ok: false, problem: 'the audit ref could not be created or read' };
    }
    if (existing === sha) return { ok: true, idempotent: true };
    return { ok: false, problem: `the audit ref ${ref} already points at ${existing || 'an unreadable commit'}, not ${sha}` };
  }
}

export const GOVERNED_ENVIRONMENT = 'governed-landing';

/**
 * H2. The App private key lives on the governed-landing environment. GitHub
 * auto-creates a referenced environment with no branch policy, so a workflow
 * on another branch could reach the key. Refuse unless the environment exists
 * with custom branch policies (not "protected branches") and exactly one
 * policy, the branch `main`.
 */
export function environmentPolicyProblems(environment, policies) {
  if (!environment || typeof environment !== 'object' || environment.name !== GOVERNED_ENVIRONMENT) {
    return [`the ${GOVERNED_ENVIRONMENT} environment could not be read`];
  }
  const policy = environment.deployment_branch_policy;
  if (!policy || policy.custom_branch_policies !== true || policy.protected_branches !== false) {
    return [`the ${GOVERNED_ENVIRONMENT} environment does not restrict deployments to main (no custom branch policy)`];
  }
  const rows = Array.isArray(policies?.branch_policies) ? policies.branch_policies : null;
  if (rows === null || policies.total_count !== rows.length) return [`the ${GOVERNED_ENVIRONMENT} deployment branch policies could not be read completely`];
  const named = rows.map((row) => `${row?.type ?? 'branch'}:${row?.name}`);
  if (named.length !== 1 || named[0] !== 'branch:main') {
    return [`the ${GOVERNED_ENVIRONMENT} environment deploys from ${named.join(', ') || 'no branch'}, not main only`];
  }
  return [];
}

/** Reads the environment and its branch policies through `read(path) -> { status, body }`. */
export async function readGovernedEnvironment(read) {
  try {
    const environment = await read(`/repos/${REPO}/environments/${GOVERNED_ENVIRONMENT}`);
    if (environment?.status !== 200) return { problems: [`the ${GOVERNED_ENVIRONMENT} environment could not be read (${environment?.status ?? 'no answer'})`] };
    const policies = await read(`/repos/${REPO}/environments/${GOVERNED_ENVIRONMENT}/deployment-branch-policies?per_page=100`);
    if (policies?.status !== 200) return { problems: [`the ${GOVERNED_ENVIRONMENT} deployment branch policies could not be read (${policies?.status ?? 'no answer'})`] };
    return { problems: environmentPolicyProblems(environment.body, policies.body) };
  } catch (error) {
    return { problems: [`the ${GOVERNED_ENVIRONMENT} environment could not be read: ${error instanceof Error ? error.message : 'unknown'}`] };
  }
}

/** The commits status API. 401 and 403 are the missing statuses:read permission, not an empty list. */
export function commitStatusPage(body, httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return { ok: false, problem: 'the commit status list could not be read: statuses:read is required' };
  if (httpStatus !== 200) return { ok: false, problem: 'the commit status list could not be read' };
  if (!Array.isArray(body?.statuses) || body.total_count !== body.statuses.length) return { ok: false, problem: 'the commit status list is incomplete' };
  return { ok: true, statuses: body.statuses };
}

export function githubAppJwt(appId, privateKeyPem, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: Math.floor(now / 1000) - 60,
    exp: Math.floor(now / 1000) + 540,
    iss: String(appId),
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

/**
 * H1. Paths a reviewer signature alone may not land: any founder-governed
 * path, any trusted file, any workflow, any checkpoint attestation file, and
 * anything the clearance lists in protected-paths. Those need the
 * founder-approval signature too. Ordinary paths are unchanged.
 */
export function founderApprovalRequiredPaths(files, fields) {
  const listed = splitClearanceList(fields?.['protected-paths']);
  const list = Array.isArray(files) ? files.filter((path) => typeof path === 'string') : [];
  const governed = list.filter((path) => HARD_FORBIDDEN_PATH.test(path)
    || TRUSTED_COMPUTING_BASE.includes(path)
    || path.toLowerCase().startsWith('.github/workflows/')
    || checkpointPairingRequired([path])
    || listed.includes(path));
  return [...new Set([...governed, ...listed])];
}

const sha256Hex = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');

/** One pull request against one signed clearance. Nothing here touches the network. */
export function evaluateGovernedLanding(input) {
  const parsed = parseClearance(input?.clearanceText);
  if (parsed.problems.length > 0) return { ok: false, problems: parsed.problems.map((problem) => `clearance format: ${problem}`) };
  if (typeof input?.signatureB64 !== 'string' || input.signatureB64.trim() === '') return { ok: false, problems: ['reviewer_signature_missing: the clearance carries no reviewer signature'] };
  const signatureProblems = verifyClearanceSignature(input.clearanceText, input?.signatureB64, input?.publicKeyPem);
  if (signatureProblems.length > 0) return { ok: false, problems: signatureProblems };
  const fields = parsed.fields;
  const problems = [];
  if (fields['landing-method'] !== 'squash' && fields['landing-method'] !== 'fast-forward') {
    problems.push('the clearance does not name a landing method');
  }
  if (fields['comments-digest'] !== COMMENTS_DIGEST_RULE) {
    problems.push(`the clearance does not sign the comments-digest rule (comments-digest: ${COMMENTS_DIGEST_RULE})`);
  }
  const windowProblem = judgeClearanceWindow(fields, input?.now);
  if (windowProblem) problems.push(windowProblem);
  if (String(input?.pr?.number) !== fields.pr) problems.push(`the clearance is for PR ${fields.pr}, not ${input?.pr?.number}`);
  if (input?.pr?.head?.sha !== fields.head) problems.push(`the PR head is ${input?.pr?.head?.sha}, the clearance names ${fields.head}`);
  if (input?.commit?.commit?.tree?.sha !== fields.tree) problems.push(`the head tree is ${input?.commit?.commit?.tree?.sha}, the clearance names ${fields.tree}`);
  if (input?.mainSha !== fields.base) problems.push(`main is ${input?.mainSha}, the clearance names base ${fields.base}`);
  if (input?.digest !== fields['bot-comments-sha256']) problems.push('the set of bot comments, inline comments or reviews differs from what the reviewer saw');
  if (nonceUsed(input?.commitMessages ?? [], fields.nonce)) {
    problems.push('this clearance nonce was already used on main');
  }
  const tagProblem = nonceTagProblem({
    exists: input?.nonceTagExists === true,
    nonce: fields.nonce,
    committerId: input?.nonceTagCommitterId,
    verificationVerified: input?.nonceTagVerificationVerified === true,
    verificationReason: input?.nonceTagVerificationReason,
    botId: input?.governedLanderBotId,
    unreadable: input?.nonceTagUnreadable === true,
  });
  if (tagProblem && !problems.includes(tagProblem)) problems.push(tagProblem);
  if (fields['binds-draft'] !== 'yes' && input?.pr?.draft !== false) problems.push('the pull request is a draft');
  if (input?.pr?.state !== 'open' || input?.pr?.merged === true) problems.push('the pull request is not open');
  if (input?.pr?.base?.ref !== 'main') problems.push('the PR does not target main');
  const auditHead = governedAuditBranchProblem(input?.pr?.head?.ref);
  const auditBase = governedAuditBranchProblem(input?.pr?.base?.ref);
  if (auditHead) problems.push(auditHead);
  if (auditBase) problems.push(auditBase);
  if (input?.pr?.head?.repo?.full_name !== REPO) problems.push('the PR head is not in this repository');
  if (input?.treeDiffComplete !== true) {
    problems.push('the diff of the signed base against the head tree is missing or truncated');
  }
  const files = Array.isArray(input?.files) ? input.files : [];
  if (files.length === 0) problems.push('the PR changes no files');
  const shape = governedLandingShapeProblem(files, fields['landing-method']);
  if (shape) problems.push(shape);
  const unauthorized = unauthorizedGovernedPaths(files, fields);
  if (unauthorized.length > 0) {
    problems.push(`the PR changes founder-governed paths: ${unauthorized.slice(0, 5).join(', ')} (not listed in the signed protected-paths)`);
  }
  const unused = unusedProtectedPaths(files, fields);
  if (unused.length > 0) problems.push(`the signed clearance lists protected paths the PR does not change: ${unused.join(', ')}`);
  const unusedExceptions = splitClearanceList(fields['governed-exceptions']).filter((path) => !files.includes(path));
  if (unusedExceptions.length > 0) problems.push(`the signed clearance lists exceptions the PR does not change: ${unusedExceptions.join(', ')}`);
  // H1: the founder-approval signature over these exact clearance bytes, against the key pinned on main.
  const founderPaths = founderApprovalRequiredPaths(files, fields);
  let founderSignatureB64 = null;
  if (founderPaths.length > 0) {
    const candidates = Array.isArray(input?.founderSignatures) ? input.founderSignatures.filter((value) => typeof value === 'string') : [];
    let why = founderApprovalProblem({ text: input.clearanceText, signatureB64: '', pem: input?.founderPublicKeyPem, anchor: input?.founderAnchor });
    for (const candidate of candidates) {
      const problem = founderApprovalProblem({ text: input.clearanceText, signatureB64: candidate, pem: input?.founderPublicKeyPem, anchor: input?.founderAnchor });
      if (problem === null) {
        founderSignatureB64 = candidate;
        break;
      }
      why = problem;
    }
    if (founderSignatureB64 === null) problems.push(`founder approval required for ${founderPaths.slice(0, 5).join(', ')}: ${why}`);
  }
  const depends = splitClearanceList(fields.depends).map(Number);
  const landed = input?.landedOnMain instanceof Set ? input.landedOnMain : new Set(input?.landedOnMain ?? []);
  const missing = depends.filter((id) => !landed.has(id));
  if (missing.length > 0) problems.push(`dependency not on main: ${missing.join(', ')}`);
  problems.push(...checkCi({
    checkRuns: Array.isArray(input?.checkRuns) ? input.checkRuns : [],
    statuses: Array.isArray(input?.statuses) ? input.statuses : [],
    self: input?.selfCheck ?? GOVERNED_SELF_CHECK,
    required: Array.isArray(input?.required) ? input.required : [],
  }));
  if (fields['landing-method'] === 'fast-forward' && input?.fastForward !== true) {
    problems.push('the pull request head is not a fast-forward of the signed base');
  }
  if (fields['landing-method'] === 'squash') {
    const compare = input?.compare;
    const descends = compare?.behind_by === 0 && (compare?.status === 'ahead' || compare?.status === 'identical');
    if (!descends) problems.push('the pull request head does not descend from the signed base');
  }
  if (checkpointPairingRequired(files)) {
    // The checkpoint directory at the head is what main will carry: the same shape every gate requires afterwards.
    const shape = attestationShapeProblem({ names: input?.checkpointNames, text: input?.attestationText });
    if (shape) problems.push(`the checkpoint directory at the head would be refused: ${shape}`);
    // A key rotation: the clearance above was signed by both keys pinned on main
    // (the old keys). The attestation is what the verifier checks after the move,
    // against the keys in the post-landing tree, so it is checked against those.
    // Their bytes are bound by the attestation's own trusted-file hashes.
    const headReviewerPem = typeof input?.headPublicKeyPem === 'string' ? input.headPublicKeyPem : input?.publicKeyPem;
    const headFounderPem = typeof input?.headFounderPublicKeyPem === 'string' ? input.headFounderPublicKeyPem : input?.founderPublicKeyPem;
    const reviewerRotates = headReviewerPem !== input?.publicKeyPem;
    const founderRotates = headFounderPem !== input?.founderPublicKeyPem;
    if (reviewerRotates && input?.treeHashes?.['.github/julius-landing/reviewer-ed25519.pub'] !== sha256Hex(headReviewerPem)) {
      problems.push('the rotated reviewer key is not the blob the attestation hashes');
    }
    if (founderRotates && input?.treeHashes?.[FOUNDER_APPROVAL_KEY_PATH] !== sha256Hex(headFounderPem)) {
      problems.push('the rotated founder-approval key is not the blob the attestation hashes');
    }
    const attestationProblems = checkpointAttestationProblems({
      text: input?.attestationText,
      signatureB64: input?.attestationSignatureB64,
      pem: headReviewerPem,
      treeHashes: input?.treeHashes,
      now: input?.now,
      founderSignatureB64: input?.attestationFounderSignatureB64,
      founderPem: headFounderPem,
      founderAnchor: input?.founderAnchor,
      founderPinned: !founderRotates,
    });
    if (attestationProblems.length > 0) problems.push('the checkpoint attestation was not verified', ...attestationProblems);
  }
  if (problems.length > 0) return { ok: false, problems };
  const checkRunIds = (input.checkRuns ?? [])
    .filter((run) => run?.name !== (input?.selfCheck ?? GOVERNED_SELF_CHECK) && Number.isInteger(run?.id))
    .map((run) => run.id);
  const clearanceDigest = createHash('sha256').update(input.clearanceText, 'utf8').digest('hex');
  const target = fields['landing-method'] === 'fast-forward' ? fields.head : null;
  const record = {
    status: 'pending',
    pr: Number(fields.pr),
    head: fields.head,
    tree: fields.tree,
    base: fields.base,
    clearanceDigest,
    checkRunIds,
    resultingMainSha: target ?? 'pending',
    method: fields['landing-method'],
  };
  let message = null;
  if (fields['landing-method'] === 'squash') {
    const pending = formatLandingRecord(record).trimEnd();
    message = buildLandingCommitMessage({
      clearanceText: input.clearanceText,
      signatureB64: String(input.signatureB64).trim(),
      freeText: `${squashTitle(fields.pr, fields.head)}\n\nLanded by the Julius governed landing workflow.\n\n${pending}`,
      ...(founderSignatureB64 === null ? {} : { founderSignatureB64 }),
    });
  }
  return {
    ok: true,
    problems: [],
    method: fields['landing-method'],
    fields,
    message,
    refUpdate: { sha: target, force: false },
    record,
    founderApproved: founderSignatureB64 !== null,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const entrypoint = (() => {
  if (!process.argv[1]) return '';
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return ''; }
})();

/**
 * The workflow entry. Every GitHub call goes through `fetchImpl` and every
 * governed file is read through `readLocal`, so tests can drive the whole run
 * against a fake GitHub. Returns the exit code instead of setting it.
 */
export async function runGovernedLand({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readLocal = (name) => readFileSync(join(here, name), 'utf8'),
  now = () => Date.now(),
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
} = {}) {
  const state = { exitCode: 0, notes: [] };
  const walked = await landQueue({ env, fetchImpl, readLocal, now, stdout, stderr, state });
  return { exitCode: state.exitCode, notes: state.notes, walked: walked ?? [] };
}

async function landQueue({ env, fetchImpl, readLocal, now, stdout, stderr, state }) {
  const fail = (problems) => {
    const text = problems.join('\n');
    state.notes.push(text);
    stderr(`${text}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    state.exitCode = 1;
  };
  const origin = checkWorkflowOrigin({
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
  });
  if (origin.length > 0) {
    fail(origin);
    return;
  }
  const appId = String(env.JULIUS_GOVERNED_LANDER_APP_ID ?? '').trim();
  const botId = String(env.JULIUS_GOVERNED_LANDER_BOT_ID ?? '').trim();
  if (!/^[1-9][0-9]{0,16}$/u.test(appId)) {
    fail(['JULIUS_GOVERNED_LANDER_APP_ID is unset']);
    return;
  }
  if (!/^[1-9][0-9]{0,16}$/u.test(botId)) {
    fail(['JULIUS_GOVERNED_LANDER_BOT_ID is unset']);
    return;
  }
  if (typeof env.JULIUS_GOVERNED_LANDER_TOKEN !== 'string' || env.JULIUS_GOVERNED_LANDER_TOKEN === '') {
    fail(['JULIUS_GOVERNED_LANDER_TOKEN is unset']);
    return;
  }
  const live = env.GITHUB_EVENT_NAME === 'schedule' || env.DRY_RUN === 'false';
  const privateKey = env.JULIUS_GOVERNED_LANDER_PRIVATE_KEY;
  if (live && (typeof privateKey !== 'string' || privateKey === '')) {
    fail(['JULIUS_GOVERNED_LANDER_PRIVATE_KEY is unset']);
    return;
  }
  const token = env.JULIUS_GOVERNED_LANDER_TOKEN;
  const apiWith = (bearer) => async (path, init = {}) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const error = new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} -> ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  };
  const api = apiWith(token);
  const pageUrl = (path, page) => `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
  const paged = (path) => readAllPages((page) => api(pageUrl(path, page)));
  const readRaw = async (path) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status, body };
  };
  const tip = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
  const runtime = checkRuntime({ ref: env.GITHUB_REF, sha: env.GITHUB_SHA, mainSha: tip });
  if (runtime.length > 0) {
    fail(runtime);
    return;
  }
  const queue = parseGovernedQueue(readLocal('governed-queue.txt'));
  if (queue.problems.length > 0) {
    fail(queue.problems);
    return;
  }
  const requested = String(env.PR ?? '').trim();
  let entries = queue.entries;
  if (requested !== '') {
    if (!/^[1-9][0-9]{0,6}$/u.test(requested)) {
      fail([`the pull request number ${requested} is not a positive integer`]);
      return;
    }
    entries = queue.entries.filter((entry) => entry.pr === Number(requested));
    if (entries.length !== 1) {
      fail([`pull request ${requested} is not in the governed queue`]);
      return;
    }
  }
  const requiredChecks = parseRequiredChecks(readLocal('required-checks.txt').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  if (requiredChecks.length === 0) {
    fail(['required-checks.txt is empty: refusing to land without a required-check list']);
    return;
  }
  const publicKeyPem = readLocal('reviewer-ed25519.pub');
  // H1. A missing founder-approval file is not an error here: a landing that needs it refuses with the reason.
  let founderPublicKeyPem = '';
  try { founderPublicKeyPem = readLocal('founder-approval-ed25519.pub'); } catch { founderPublicKeyPem = ''; }
  const founderAnchor = env.JULIUS_FOUNDER_APPROVAL_KEY_SHA256;
  let snapshot;
  try {
    snapshot = JSON.parse(readLocal('main-ruleset.json'));
  } catch {
    fail(['the main ruleset snapshot could not be read']);
    return;
  }
  let liveRules;
  try {
    liveRules = await api(`/repos/${REPO}/rules/branches/main`);
  } catch (error) {
    fail([`the main branch rules could not be read: ${error instanceof Error ? error.message : 'unknown'}`]);
    return;
  }
  const rulesetProblems = branchRulesProblems(liveRules, snapshot, appId);
  if (rulesetProblems.length > 0) {
    fail(rulesetProblems);
    return;
  }
  // H2: the private key is on the governed-landing environment. Refuse unless that
  // environment deploys from main only, before the key is used to mint anything.
  const environment = await readGovernedEnvironment((path) => readRaw(path));
  if (environment.problems.length > 0) {
    fail(environment.problems);
    return;
  }
  const bot = await api(`/user/${botId}`);
  if (String(bot?.id) !== botId || typeof bot?.login !== 'string' || !bot.login.endsWith('[bot]')) {
    fail([`JULIUS_GOVERNED_LANDER_BOT_ID ${botId} is not a GitHub App bot user`]);
    return;
  }
  const identity = { name: bot.login, email: `${botId}+${bot.login}@users.noreply.github.com` };
  const mintWriteToken = async (permissions) => {
    const jwt = githubAppJwt(appId, privateKey, now());
    const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const installation = await fetchImpl(`https://api.github.com/repos/${REPO}/installation`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!installation.ok) throw new Error(`GET /repos/${REPO}/installation -> ${installation.status}`);
    const installed = await installation.json();
    const minted = await fetchImpl(`https://api.github.com/app/installations/${installed.id}/access_tokens`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // One repository only: the installation could be widened later; the token must not follow it.
      body: JSON.stringify({ repositories: [REPO.split('/')[1]], permissions }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!minted.ok) throw new Error(`POST /app/installations/access_tokens -> ${minted.status}`);
    const body = await minted.json();
    if (typeof body?.token !== 'string' || body.token === '') throw new Error('POST /app/installations/access_tokens -> no token');
    return body.token;
  };
  const blobBytes = async (path, ref) => {
    const body = await api(`/repos/${REPO}/contents/${path}?ref=${ref}`);
    if (body?.encoding !== 'base64' || typeof body?.content !== 'string') throw new Error(`the blob ${path} at ${ref} could not be read`);
    return Buffer.from(body.content.replace(/\n/g, ''), 'base64');
  };
  const mainShaNow = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
  const audits = [];
  const provenAncestors = new Set();
  const seenAudits = new Set();
  /** Pull requests whose audit ref was missing but whose App-signed audit commit a nonce tag still names (H3). */
  const recoveredAudits = new Map();
  let nonceTagTargets = null;
  /**
   * H3. A run that moved main and then failed to create the audit ref left the
   * landing proven only by its nonce tag, whose target is the App-signed audit
   * commit. Read those targets once. A tag is attacker-creatable, so a target
   * counts only through the same App identity and ancestry checks as the ref.
   */
  const auditFromNonceTags = async (pr) => {
    if (nonceTagTargets === null) {
      const rows = await paged(`/repos/${REPO}/git/matching-refs/tags/julius-landing-nonce-`);
      nonceTagTargets = [...new Set(rows.map((row) => row?.object?.sha).filter((sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/u.test(sha)))];
    }
    for (const sha of nonceTagTargets) {
      const commit = await api(`/repos/${REPO}/commits/${sha}`);
      const record = parseAuditRecord(commit?.commit?.message ?? '');
      if (record?.pr === pr) return { sha, commit };
    }
    return null;
  };
  const readAudit = async (pr) => {
    if (seenAudits.has(pr)) return;
    seenAudits.add(pr);
    const response = await readRaw(`/repos/${REPO}/git/ref/heads/julius-governed-audit/pr/${pr}`);
    let sha;
    let commit;
    if (response.status === 404) {
      const found = await auditFromNonceTags(pr);
      if (found === null) return;
      sha = found.sha;
      commit = found.commit;
    } else if (response.status !== 200 || typeof response.body?.object?.sha !== 'string') {
      throw new Error(`GET /repos/${REPO}/git/ref/heads/julius-governed-audit/pr/${pr} -> ${response.status}`);
    } else {
      sha = response.body.object.sha;
      commit = await api(`/repos/${REPO}/commits/${sha}`);
    }
    const fromTag = response.status === 404;
    const audit = {
      sha,
      message: commit?.commit?.message ?? '',
      committerId: commit?.committer?.id,
      verificationVerified: commit?.commit?.verification?.verified === true,
      verificationReason: typeof commit?.commit?.verification?.reason === 'string' ? commit.commit.verification.reason : '',
    };
    audits.push(audit);
    if (landingIdentityProblem({
      committerId: audit.committerId,
      verificationVerified: audit.verificationVerified,
      verificationReason: audit.verificationReason,
      botId,
    })) return;
    const record = parseAuditRecord(audit.message);
    if (!record) return;
    if (record.pr !== pr) return;
    const ancestor = record.method === 'squash' ? sha : (record.main !== 'pending' ? record.main : '');
    if (ancestor === '') return;
    let proven = ancestor === mainShaNow;
    if (!proven) {
      const compared = await api(`/repos/${REPO}/compare/${ancestor}...${mainShaNow}`);
      proven = compared?.status === 'ahead' || compared?.status === 'identical';
    }
    if (!proven) return;
    provenAncestors.add(ancestor);
    if (fromTag) recoveredAudits.set(pr, sha);
  };
  try {
    for (const entry of entries) {
      await readAudit(entry.pr);
      for (const dep of entry.depends) await readAudit(dep);
    }
  } catch (error) {
    fail([`the governed audit record could not be read: ${error instanceof Error ? error.message : 'unknown'}`]);
    return;
  }
  const auditsLanded = () => landedPullsFromAudits(audits, mainShaNow, (ancestor) => provenAncestors.has(ancestor), botId);
  const landedOnMain = auditsLanded();
  const note = (text) => {
    state.notes.push(text);
    stdout(`${text}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };
  let refused = false;
  let finalizeFailed = false;
  let ambiguous = false;
  const walked = [];
  const landed = new Set(landedOnMain);
  // H3: re-create every audit ref a nonce tag proved missing. The landing itself is
  // already on main; only the record is restored, at the same App-signed commit.
  if (recoveredAudits.size > 0) {
    if (!live) {
      for (const [pr, sha] of recoveredAudits) note(`DRY RUN: would re-create refs/heads/julius-governed-audit/pr/${pr} at ${sha}`);
    } else {
      let recoveryWrite = null;
      try {
        recoveryWrite = apiWith(await mintWriteToken(governedWritePermissions([])));
      } catch (error) {
        note(`the audit ref recovery token could not be minted: ${error instanceof Error ? error.message : 'unknown'}`);
        finalizeFailed = true;
      }
      for (const [pr, sha] of recoveryWrite === null ? [] : recoveredAudits) {
        const placed = await ensureAuditRef(`refs/heads/julius-governed-audit/pr/${pr}`, sha, {
          create: (ref, commitSha) => recoveryWrite('/repos/ohdieyuh-glitch/sunday-relay/git/refs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref, sha: commitSha }),
          }),
          read: async (ref) => {
            const body = await api(`/repos/${REPO}/git/ref/${ref.slice('refs/'.length)}`);
            return typeof body?.object?.sha === 'string' ? body.object.sha : '';
          },
        });
        if (placed.ok) note(`recovered refs/heads/julius-governed-audit/pr/${pr} at ${sha}`);
        else {
          note(`landed, audit finalize failed: pull request ${pr}: ${placed.problem}`);
          finalizeFailed = true;
        }
      }
    }
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const missing = entry.depends.filter((id) => !landed.has(id));
    let decision;
    if (landed.has(entry.pr)) {
      // Already proven on main by an App-signed audit commit. Never landed twice.
      note(`pull request ${entry.pr} is already on main`);
      walked.push({ pr: entry.pr, ok: true, problems: [] });
      continue;
    }
    if (missing.length > 0) {
      decision = { ok: false, problems: [`dependency not on main: ${missing.join(', ')}`] };
    } else {
      const number = entry.pr;
      let moved = false;
      let phase = 'read';
      let landedSha = null;
      let updateAccepted = false;
      try {
      const pull = await api(`/repos/${REPO}/pulls/${number}`);
      const liveMain = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
      const liveHead = pull?.head?.sha;
      const liveCommit = typeof liveHead === 'string' ? await api(`/repos/${REPO}/commits/${liveHead}`) : null;
      const liveTree = liveCommit?.commit?.tree?.sha;
      const issueComments = await paged(`/repos/${REPO}/issues/${number}/comments`);
      const chosen = typeof liveHead === 'string' && typeof liveTree === 'string' && typeof liveMain === 'string'
        ? chooseClearanceDelivery(issueComments, publicKeyPem, { head: liveHead, tree: liveTree, base: liveMain })
        : { problem: 'the pull request head, tree, or main could not be read' };
      if (chosen.problem) {
        decision = { ok: false, problems: [chosen.problem] };
      } else {
        const clearance = parseClearance(chosen.delivery.clearanceText).fields;
        for (const dep of splitClearanceList(clearance.depends).map(Number)) await readAudit(dep);
        for (const id of auditsLanded()) landed.add(id);
        const head = clearance.head;
        const [commit, inlineComments, reviews, checkBody, compare] = await Promise.all([
          api(`/repos/${REPO}/commits/${head}`),
          paged(`/repos/${REPO}/pulls/${number}/comments`),
          paged(`/repos/${REPO}/pulls/${number}/reviews`),
          api(`/repos/${REPO}/commits/${head}/check-runs?per_page=100`),
          api(`/repos/${REPO}/compare/${clearance.base}...${head}`),
        ]);
        const statusResponse = await readRaw(`/repos/${REPO}/commits/${head}/status?per_page=100`);
        const statusPage = commitStatusPage(statusResponse.body, statusResponse.status);
        const tag = await fetchImpl(`https://api.github.com/repos/${REPO}/git/ref/tags/julius-landing-nonce-${clearance.nonce}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(30_000),
        });
        let tagBody = null;
        if (tag.status === 200) {
          try { tagBody = await tag.json(); } catch { tagBody = null; }
        }
        let nonceTagCommitterId;
        let nonceTagVerificationVerified = false;
        let nonceTagVerificationReason = '';
        let nonceTagUnreadable = tag.status !== 200 && tag.status !== 404;
        if (tag.status === 200) {
          const tagSha = tagBody?.object?.sha;
          if (typeof tagSha !== 'string') nonceTagUnreadable = true;
          else {
            const tagged = await api(`/repos/${REPO}/commits/${tagSha}`);
            nonceTagCommitterId = tagged?.committer?.id;
            nonceTagVerificationVerified = tagged?.commit?.verification?.verified === true;
            nonceTagVerificationReason = typeof tagged?.commit?.verification?.reason === 'string' ? tagged.commit.verification.reason : '';
          }
        }
        const checksComplete = Array.isArray(checkBody?.check_runs) && checkBody.total_count === checkBody.check_runs.length;
        const tagReadable = !nonceTagUnreadable;
        if (!checksComplete || !statusPage.ok || !tagReadable) {
          decision = { ok: false, problems: [
            ...(!checksComplete ? ['the check runs could not be read completely'] : []),
            ...(!statusPage.ok ? [statusPage.problem] : []),
            ...(!tagReadable ? ['the nonce tag could not be read'] : []),
          ] };
        } else {
        const compareFiles = Array.isArray(compare?.files) ? compare.files : null;
        const treeDiffComplete = compareFiles !== null && compareFiles.length < 300;
        const changedPaths = treeDiffComplete
          ? compareFiles.flatMap((file) => [file?.filename, file?.previous_filename].filter((path) => typeof path === 'string'))
          : [];
        let attestationText = '';
        let attestationSignatureB64 = '';
        let attestationFounderSignatureB64 = '';
        let headPublicKeyPem;
        let headFounderPublicKeyPem;
        const treeHashes = {};
        let checkpointNames = null;
        if (treeDiffComplete && checkpointPairingRequired(changedPaths)) {
          // Read the directory at the head, not the diff: a diff that deletes the old
          // attestation also names it, and the head is what main will carry.
          const listing = await readRaw(`/repos/${REPO}/contents/${CHECKPOINT_ATTESTATION_DIR}?ref=${head}`);
          if (listing.status === 404) checkpointNames = [];
          else if (listing.status === 200 && Array.isArray(listing.body) && listing.body.every((row) => row?.type === 'file' && typeof row?.name === 'string')) {
            checkpointNames = listing.body.map((row) => row.name).sort();
          }
          const texts = (checkpointNames ?? []).filter((name) => /^[0-9a-f]{40}\.txt$/u.test(name));
          const txtPath = texts.length === 1 ? `${CHECKPOINT_ATTESTATION_DIR}/${texts[0]}` : null;
          const sigName = texts.length === 1 ? texts[0].replace(/\.txt$/u, '.sig') : null;
          const sigPath = sigName !== null && (checkpointNames ?? []).includes(sigName) ? `${CHECKPOINT_ATTESTATION_DIR}/${sigName}` : null;
          if (txtPath !== null && sigPath !== null) {
            attestationText = (await blobBytes(txtPath, head)).toString('utf8');
            attestationSignatureB64 = (await blobBytes(sigPath, head)).toString('utf8').trim();
            const founderSigName = sigName.replace(/[.]sig$/u, '.founder.sig');
            if ((checkpointNames ?? []).includes(founderSigName)) {
              attestationFounderSignatureB64 = (await blobBytes(`${CHECKPOINT_ATTESTATION_DIR}/${founderSigName}`, head)).toString('utf8').trim();
            }
            for (const path of TRUSTED_COMPUTING_BASE) {
              const bytes = await blobBytes(path, head);
              treeHashes[path] = createHash('sha256').update(bytes).digest('hex');
              if (path === '.github/julius-landing/reviewer-ed25519.pub') headPublicKeyPem = bytes.toString('utf8');
              if (path === FOUNDER_APPROVAL_KEY_PATH) headFounderPublicKeyPem = bytes.toString('utf8');
            }
          }
        }
        const mainSha = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
        decision = evaluateGovernedLanding({
          clearanceText: chosen.delivery.clearanceText,
          signatureB64: chosen.delivery.signatureB64,
          founderSignatures: chosen.delivery.founderSignatures ?? [],
          publicKeyPem,
          founderPublicKeyPem,
          founderAnchor,
          headPublicKeyPem,
          headFounderPublicKeyPem,
          attestationFounderSignatureB64,
          now: now(),
          pr: pull,
          commit,
          files: changedPaths,
          treeDiffComplete,
          compare: { behind_by: compare?.behind_by, ahead_by: compare?.ahead_by, status: compare?.status },
          mainSha,
          digest: governedCommentsDigest({ issueComments, inlineComments, reviews, clearanceText: chosen.delivery.clearanceText }),
          commitMessages: [],
          nonceTagExists: tag.status === 200,
          nonceTagCommitterId,
          nonceTagVerificationVerified,
          nonceTagVerificationReason,
          nonceTagUnreadable,
          governedLanderBotId: botId,
          checkRuns: checkBody.check_runs,
          statuses: statusPage.statuses,
          required: requiredChecks,
          landedOnMain: landed,
          fastForward: compare?.status === 'ahead' && compare?.behind_by === 0 && compare?.ahead_by > 0,
          attestationText,
          attestationSignatureB64,
          treeHashes,
          checkpointNames,
        });
        decision.changedPaths = changedPaths;
        }
        if (decision.ok && live) {
          phase = 'write';
          const base = decision.fields.base;
          const tree = decision.fields.tree;
          const writeToken = await mintWriteToken(governedWritePermissions(decision.changedPaths, { founderApproved: decision.founderApproved === true }));
          const apiWrite = apiWith(writeToken);
          const identityProblemOf = (readBack) => landingIdentityProblem({
            committerId: readBack?.committer?.id,
            verificationVerified: readBack?.commit?.verification?.verified === true,
            verificationReason: typeof readBack?.commit?.verification?.reason === 'string' ? readBack.commit.verification.reason : '',
            botId,
          });
          let sha = null;
          let auditSha = null;
          const rememberSha = (value) => {
            sha = value;
            landedSha = value;
          };
          if (decision.method === 'squash') {
            const created = await apiWrite(`/repos/${REPO}/git/commits`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(governedCommitBody({ message: decision.message, tree, parents: [base] })),
            });
            rememberSha(created?.sha);
            const readBack = await api(`/repos/${REPO}/commits/${sha}`);
            const createdProblems = checkCreatedCommit({ created: readBack, sha, base, tree, message: decision.message, identity });
            const identityProblem = identityProblemOf(readBack);
            if (createdProblems.length > 0 || identityProblem) {
              decision = { ok: false, problems: [...createdProblems, ...(identityProblem ? [identityProblem] : [])] };
              rememberSha(null);
            } else {
              auditSha = sha;
            }
          } else {
            const headCommit = await api(`/repos/${REPO}/commits/${decision.fields.head}`);
            const headMessage = headCommit?.commit?.message;
            if (typeof headMessage === 'string' && headMessage.includes('BEGIN JULIUS LANDING')) {
              const headIdentity = identityProblemOf(headCommit);
              if (headIdentity) decision = { ok: false, problems: [headIdentity] };
            }
            if (decision.ok) {
              const mainCommit = await api(`/repos/${REPO}/git/commits/${base}`);
              const mainTree = mainCommit?.tree?.sha;
              const auditMessage = formatLandingRecord({ ...decision.record, status: 'pending', resultingMainSha: decision.fields.head });
              const created = await apiWrite(`/repos/${REPO}/git/commits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(governedCommitBody({ message: auditMessage, tree: mainTree, parents: [base] })),
              });
              auditSha = created?.sha;
              const readBack = await api(`/repos/${REPO}/commits/${auditSha}`);
              const problems = [];
              if (readBack?.parents?.length !== 1 || readBack.parents[0]?.sha !== base) problems.push('the audit commit does not have exactly one parent, the signed base');
              if (readBack?.commit?.tree?.sha !== mainTree) problems.push('the audit commit tree is not the tree of main before the move');
              const stored = readBack?.commit?.message;
              if (stored !== auditMessage && !(auditMessage.endsWith('\n') && stored === auditMessage.slice(0, -1))) problems.push('the audit commit message differs from the pending record');
              for (const who of ['author', 'committer']) {
                if (readBack?.commit?.[who]?.name !== identity.name || readBack?.commit?.[who]?.email !== identity.email) problems.push(`the audit commit ${who} is not ${identity.name}`);
              }
              const identityProblem = identityProblemOf(readBack);
              if (identityProblem) problems.push(identityProblem);
              if (problems.length > 0) {
                decision = { ok: false, problems };
                rememberSha(null);
              } else {
                rememberSha(decision.fields.head);
              }
            }
          }
          if (decision.ok) {
            try {
              await apiWrite('/repos/ohdieyuh-glitch/sunday-relay/git/refs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The tag names the App-signed audit commit (the landing for a squash, the
                // side record for a fast-forward), so a later run can recover a lost audit ref.
                body: JSON.stringify({ ref: `refs/tags/julius-landing-nonce-${decision.fields.nonce}`, sha: auditSha }),
              });
            } catch (error) {
              decision = { ok: false, problems: [`the nonce tag could not be created; main was not moved: ${error instanceof Error ? error.message : 'unknown'}`] };
            }
          }
          if (decision.ok) {
            try {
              await apiWrite('/repos/ohdieyuh-glitch/sunday-relay/git/refs/heads/main', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sha, force: false }),
              });
              updateAccepted = true;
            } catch (error) {
              // H3. Only a clean 4xx (not 408 or 429) means GitHub refused and main did not
              // move. Anything else may have been applied with its answer lost: re-read main.
              const status = Number(error?.status);
              const clean = Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
              let tip = null;
              try { tip = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha; } catch { tip = null; }
              const why = error instanceof Error ? error.message : 'unknown';
              if (tip === sha) {
                note(`LANDED (the PATCH response was lost: ${why})`);
                updateAccepted = true;
              } else if (clean && tip === base) {
                decision = { ok: false, problems: [`the ref update was refused; no retry and no force: ${why}`] };
              } else {
                ambiguous = true;
                decision = { ok: false, ambiguous: true, problems: [`ALERT: the ref update of main is in doubt (${why}); main is ${tip ?? 'unreadable'}, not ${sha} and ${clean ? '' : 'possibly '}not ${base}. No retry, no force; the clearance is spent. Check main before signing anything new.`] };
              }
            }
          }
          if (decision.ok) {
            let after = null;
            try { after = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha; } catch { after = null; }
            if (after !== sha) {
              ambiguous = true;
              decision = { ok: false, ambiguous: true, problems: [`ALERT: main is ${after ?? 'unreadable'} after the update, not ${sha}`] };
            } else {
              moved = true;
              const auditRef = `refs/heads/julius-governed-audit/pr/${decision.record.pr}`;
              const placed = await ensureAuditRef(auditRef, auditSha, {
                create: (ref, commitSha) => apiWrite('/repos/ohdieyuh-glitch/sunday-relay/git/refs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ref, sha: commitSha }),
                }),
                read: async (ref) => {
                  const name = ref.startsWith('refs/') ? ref.slice('refs/'.length) : ref;
                  const body = await api(`/repos/${REPO}/git/ref/${name}`);
                  return typeof body?.object?.sha === 'string' ? body.object.sha : '';
                },
              });
              decision = { ...decision, record: { ...decision.record, status: 'final', resultingMainSha: sha }, refUpdate: { sha, force: false } };
              if (!placed.ok) {
                note('landed, audit finalize failed');
                finalizeFailed = true;
              }
              try {
                const body = formatLandingRecord(decision.record);
                await apiWrite(`/repos/${REPO}/issues/${number}/comments`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ body }),
                });
                await apiWrite(`/repos/${REPO}/pulls/${number}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ state: 'closed' }),
                });
                note(body);
              } catch {
                note('landed, audit finalize failed');
                finalizeFailed = true;
              }
            }
          }
        } else if (decision.ok) {
          note(`DRY RUN: pull request ${number} would ${decision.method} with force false.\n${decision.method === 'squash' ? decision.message : decision.fields.head}`);
        }
      }
      } catch (error) {
        let confirmed = false;
        if (!moved && updateAccepted && typeof landedSha === 'string') {
          try {
            const after = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
            if (after === landedSha) moved = true;
            confirmed = true;
          } catch { confirmed = false; }
        }
        if (moved) {
          note('landed, audit finalize failed');
          finalizeFailed = true;
          decision = { ok: true, problems: [] };
        } else if (updateAccepted) {
          // GitHub accepted the update and main could not be confirmed either way.
          ambiguous = true;
          decision = { ok: false, ambiguous: true, problems: [`ALERT: the update of main was accepted and ${confirmed ? 'main is not the landing' : 'main could not be re-read'}: ${error instanceof Error ? error.message : 'unknown'}`] };
        } else {
          const why = phase === 'write' ? 'the landing stopped before main moved' : 'the pull request could not be read';
          decision = { ok: false, problems: [`${why}: ${error instanceof Error ? error.message : 'unknown'}`] };
        }
      }
    }
    walked.push({ pr: entry.pr, ok: decision.ok === true, problems: decision.problems ?? [] });
    if (decision.ok === true) {
      landed.add(entry.pr);
      continue;
    }
    refused = true;
    note(`refused pull request ${entry.pr}: ${(decision.problems ?? []).join('; ')}`);
    if (decision.ambiguous === true) {
      note('stopped: the state of main is in doubt');
      break;
    }
    const blocksLater = entries.slice(index + 1).some((later) => later.depends.includes(entry.pr));
    if (blocksLater) {
      note(`stopped: a later queue entry depends on pull request ${entry.pr}`);
      break;
    }
  }
  if (entries.length === 0) note('the governed queue is empty');
  // H3 exit contract, as the historical lander: 0 landed or nothing to do, 1 refused
  // (main did not move), 2 the state of main is in doubt, 3 landed but the audit
  // record could not be finalized (a later run re-creates it from the nonce tag).
  if (ambiguous) state.exitCode = 2;
  else if (finalizeFailed) state.exitCode = 3;
  else if (refused) state.exitCode = 1;
  else state.exitCode = 0;
  return walked;
}

if (entrypoint !== '' && import.meta.url === entrypoint && process.argv.includes('--require-environment')) {
  // The workflow runs this with the job token, before any step reads the App private key.
  const token = typeof process.env.GH_TOKEN === 'string' ? process.env.GH_TOKEN : '';
  const result = token === ''
    ? { problems: ['GH_TOKEN is unset: the governed-landing environment could not be read'] }
    : await readGovernedEnvironment(async (path) => {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { status: response.status, body };
    });
  const stream = result.problems.length === 0 ? process.stdout : process.stderr;
  stream.write(`${result.problems.length === 0 ? `the ${GOVERNED_ENVIRONMENT} environment deploys from main only` : result.problems.join('\n')}\n`);
  process.exitCode = result.problems.length === 0 ? 0 : 1;
} else if (entrypoint !== '' && import.meta.url === entrypoint) {
  const result = await runGovernedLand();
  process.exitCode = result.exitCode;
}
