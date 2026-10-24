// Governed landing. Pure decisions live in the exports. The CLI at the bottom
// reads GitHub and writes only after every decision is a pass. The ref update
// is non-forced. Crypto and the clearance parser stay in land-lib.mjs.
import { createHash, createSign } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
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
  TRUSTED_COMPUTING_BASE,
  checkpointAttestationProblems,
  checkpointPairingRequired,
  governedLandingShapeProblem,
  judgeClearanceWindow,
  landingIdentityProblem,
} from '../../scripts/julius-main-provenance-trust.mjs';

export const GOVERNED_SELF_CHECK = 'Land a governed pull request';
const BEGIN = '-----BEGIN JULIUS CLEARANCE-----\n';
const BETWEEN = '-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n';
const SIGNATURE_END = '\n-----END JULIUS CLEARANCE SIGNATURE-----';

/** Every clearance block in the comment bodies. The signature, not the commenter, is the authority. */
export function extractClearanceDeliveries(bodies) {
  const deliveries = [];
  for (const body of Array.isArray(bodies) ? bodies : []) {
    let rest = String(body ?? '');
    while (rest.includes(BEGIN)) {
      const start = rest.indexOf(BEGIN);
      const after = rest.slice(start + BEGIN.length);
      const mid = after.indexOf(BETWEEN);
      if (mid < 0) break;
      const clearanceText = after.slice(0, mid);
      const signed = after.slice(mid + BETWEEN.length);
      const end = signed.indexOf(SIGNATURE_END);
      if (end < 0) break;
      const signatureB64 = signed.slice(0, end);
      if (!signatureB64.includes('\n') && signatureB64 !== '') deliveries.push({ clearanceText, signatureB64 });
      rest = signed.slice(end + SIGNATURE_END.length);
    }
  }
  return deliveries;
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
  if (verified.length === 0) return { problem: 'no signed clearance is on the pull request' };
  verified.sort((left, right) => {
    const issued = String(left.fields.issued).localeCompare(String(right.fields.issued));
    if (issued !== 0) return issued;
    return left.id - right.id;
  });
  const newest = verified[verified.length - 1];
  const issued = String(newest.fields.issued);
  const texts = new Set(verified.filter((row) => String(row.fields.issued) === issued).map((row) => row.clearanceText));
  if (texts.size !== 1) return { problem: 'signed clearances for this pull request do not agree' };
  return { delivery: newest };
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
export function governedWritePermissions(paths) {
  const permissions = {
    contents: 'write',
    pull_requests: 'write',
    checks: 'read',
    actions: 'read',
    metadata: 'read',
    statuses: 'read',
  };
  if ((Array.isArray(paths) ? paths : []).some((path) => /^\.github\/workflows\//iu.test(path))) permissions.workflows = 'write';
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
 * `*` and `?` are fnmatch. A character class or an escape cannot be evaluated
 * here and returns null, which the caller treats as a refusal.
 */
export function refPatternMatches(pattern, ref) {
  if (pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return ref === 'refs/heads/main';
  if (typeof pattern !== 'string' || pattern === '' || typeof ref !== 'string') return null;
  if (/[[\]\\]/u.test(pattern)) return null;
  let source = '^';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
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

const RULE_TYPES = ['deletion', 'non_fast_forward', 'update'];

/**
 * The branch-rules list is what metadata can read. The snapshot is the admin's
 * out-of-band copy of the ruleset, including bypass actors, and it is part of
 * the trusted computing base. Live rules for the pinned ruleset id must match
 * the snapshot's rule types and parameters. Bypass actors are compared to the
 * App id from the environment. They are not on the live response.
 */
export function branchRulesProblems(liveRules, snapshot, appId) {
  const id = String(appId ?? '').trim();
  if (!/^[1-9][0-9]{0,16}$/u.test(id)) return ['JULIUS_GOVERNED_LANDER_APP_ID is unset'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['the main ruleset snapshot could not be read'];
  if (!Number.isInteger(snapshot.id) || snapshot.id < 1) return ['the main ruleset snapshot has no pinned ruleset id'];
  if (snapshot.enforcement !== 'active') return ['the main ruleset snapshot is not active'];
  const mainCover = rulesetCoversRef(snapshot.conditions, 'refs/heads/main');
  if (!mainCover.ok) return [mainCover.problem];
  const auditCover = rulesetCoversRef(snapshot.conditions, 'refs/julius-governed-audit/pr/1');
  if (!auditCover.ok) return ['the main ruleset snapshot does not cover refs/julius-governed-audit/**'];
  const actors = snapshot.bypass_actors;
  if (!Array.isArray(actors) || actors.length !== 1 || !appBypass(actors[0], id)) {
    return ['the main ruleset snapshot does not name only the governed lander app as an always bypass'];
  }
  const snapshotRules = Array.isArray(snapshot.rules) ? snapshot.rules : [];
  const snapshotTypes = snapshotRules.map((rule) => rule?.type);
  if (snapshotTypes.length !== RULE_TYPES.length || RULE_TYPES.some((type) => !snapshotTypes.includes(type))) {
    return ['the main ruleset snapshot does not block deletion, force pushes, and updates'];
  }
  if (!Array.isArray(liveRules)) return ['the main branch rules could not be read'];
  const live = liveRules.filter((rule) => rule?.ruleset_id === snapshot.id);
  if (live.length !== snapshotRules.length) return ['the live main branch rules do not match the pinned ruleset snapshot'];
  for (const rule of snapshotRules) {
    const match = live.find((row) => row?.type === rule.type);
    if (!match || JSON.stringify(match.parameters ?? {}) !== JSON.stringify(rule.parameters ?? {})) {
      return ['the live main branch rules do not match the pinned ruleset snapshot'];
    }
  }
  return [];
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

/** One pull request against one signed clearance. Nothing here touches the network. */
export function evaluateGovernedLanding(input) {
  const parsed = parseClearance(input?.clearanceText);
  if (parsed.problems.length > 0) return { ok: false, problems: parsed.problems.map((problem) => `clearance format: ${problem}`) };
  const signatureProblems = verifyClearanceSignature(input.clearanceText, input?.signatureB64, input?.publicKeyPem);
  if (signatureProblems.length > 0) return { ok: false, problems: signatureProblems };
  const fields = parsed.fields;
  const problems = [];
  if (fields['landing-method'] !== 'squash' && fields['landing-method'] !== 'fast-forward') {
    problems.push('the clearance does not name a landing method');
  }
  const windowProblem = judgeClearanceWindow(fields, input?.now);
  if (windowProblem) problems.push(windowProblem);
  if (String(input?.pr?.number) !== fields.pr) problems.push(`the clearance is for PR ${fields.pr}, not ${input?.pr?.number}`);
  if (input?.pr?.head?.sha !== fields.head) problems.push(`the PR head is ${input?.pr?.head?.sha}, the clearance names ${fields.head}`);
  if (input?.commit?.commit?.tree?.sha !== fields.tree) problems.push(`the head tree is ${input?.commit?.commit?.tree?.sha}, the clearance names ${fields.tree}`);
  if (input?.mainSha !== fields.base) problems.push(`main is ${input?.mainSha}, the clearance names base ${fields.base}`);
  if (input?.digest !== fields['bot-comments-sha256']) problems.push('the set of bot comments, inline comments or reviews differs from what the reviewer saw');
  if (nonceUsed(input?.commitMessages ?? [], fields.nonce) || input?.nonceTagExists === true) {
    problems.push('this clearance nonce was already used on main');
  }
  if (fields['binds-draft'] !== 'yes' && input?.pr?.draft !== false) problems.push('the pull request is a draft');
  if (input?.pr?.state !== 'open' || input?.pr?.merged === true) problems.push('the pull request is not open');
  if (input?.pr?.base?.ref !== 'main') problems.push('the PR does not target main');
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
    const attestationProblems = checkpointAttestationProblems({
      text: input?.attestationText,
      signatureB64: input?.attestationSignatureB64,
      pem: input?.publicKeyPem,
      treeHashes: input?.treeHashes,
      now: input?.now,
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
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const entrypoint = (() => {
  if (!process.argv[1]) return '';
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return ''; }
})();

async function runCli() {
  const env = process.env;
  const fail = (problems) => {
    const text = problems.join('\n');
    process.stderr.write(`${text}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    process.exitCode = 1;
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
    const response = await fetch(`https://api.github.com${path}`, {
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
    const response = await fetch(`https://api.github.com${path}`, {
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
  const queue = parseGovernedQueue(readFileSync(join(here, 'governed-queue.txt'), 'utf8'));
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
  const requiredChecks = parseRequiredChecks(readFileSync(join(here, 'required-checks.txt'), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  if (requiredChecks.length === 0) {
    fail(['required-checks.txt is empty: refusing to land without a required-check list']);
    return;
  }
  const publicKeyPem = readFileSync(join(here, 'reviewer-ed25519.pub'), 'utf8');
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(join(here, 'main-ruleset.json'), 'utf8'));
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
  const bot = await api(`/user/${botId}`);
  if (String(bot?.id) !== botId || typeof bot?.login !== 'string' || !bot.login.endsWith('[bot]')) {
    fail([`JULIUS_GOVERNED_LANDER_BOT_ID ${botId} is not a GitHub App bot user`]);
    return;
  }
  const identity = { name: bot.login, email: `${botId}+${bot.login}@users.noreply.github.com` };
  const mintWriteToken = async (permissions) => {
    const jwt = githubAppJwt(appId, privateKey);
    const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const installation = await fetch(`https://api.github.com/repos/${REPO}/installation`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!installation.ok) throw new Error(`GET /repos/${REPO}/installation -> ${installation.status}`);
    const installed = await installation.json();
    const minted = await fetch(`https://api.github.com/app/installations/${installed.id}/access_tokens`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
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
  const readAudit = async (pr) => {
    if (seenAudits.has(pr)) return;
    seenAudits.add(pr);
    const response = await readRaw(`/repos/${REPO}/git/ref/julius-governed-audit/pr/${pr}`);
    if (response.status === 404) return;
    if (response.status !== 200 || typeof response.body?.object?.sha !== 'string') {
      throw new Error(`GET /repos/${REPO}/git/ref/julius-governed-audit/pr/${pr} -> ${response.status}`);
    }
    const sha = response.body.object.sha;
    const commit = await api(`/repos/${REPO}/commits/${sha}`);
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
    const ancestor = record.method === 'squash' ? sha : (record.main !== 'pending' ? record.main : '');
    if (ancestor === '') return;
    if (ancestor === mainShaNow) {
      provenAncestors.add(ancestor);
      return;
    }
    const compared = await api(`/repos/${REPO}/compare/${ancestor}...${mainShaNow}`);
    if (compared?.status === 'ahead' || compared?.status === 'identical') provenAncestors.add(ancestor);
  };
  try {
    for (const entry of entries) {
      for (const dep of entry.depends) await readAudit(dep);
    }
  } catch (error) {
    fail([`the governed audit record could not be read: ${error instanceof Error ? error.message : 'unknown'}`]);
    return;
  }
  const auditsLanded = () => landedPullsFromAudits(audits, mainShaNow, (ancestor) => provenAncestors.has(ancestor), botId);
  const landedOnMain = auditsLanded();
  const note = (text) => {
    process.stdout.write(`${text}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };
  let refused = false;
  let finalizeFailed = false;
  const walked = [];
  const landed = new Set(landedOnMain);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const missing = entry.depends.filter((id) => !landed.has(id));
    let decision;
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
        const tag = await fetch(`https://api.github.com/repos/${REPO}/git/ref/tags/julius-landing-nonce-${clearance.nonce}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(30_000),
        });
        const checksComplete = Array.isArray(checkBody?.check_runs) && checkBody.total_count === checkBody.check_runs.length;
        const tagReadable = tag.status === 200 || tag.status === 404;
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
        const treeHashes = {};
        if (treeDiffComplete && checkpointPairingRequired(changedPaths)) {
          const txtPath = changedPaths.find((path) => /^\.github\/julius-landing\/checkpoints\/[0-9a-f]{40}\.txt$/iu.test(path));
          const sigPath = changedPaths.find((path) => /^\.github\/julius-landing\/checkpoints\/[0-9a-f]{40}\.sig$/iu.test(path));
          if (typeof txtPath === 'string' && typeof sigPath === 'string') {
            attestationText = (await blobBytes(txtPath, head)).toString('utf8');
            attestationSignatureB64 = (await blobBytes(sigPath, head)).toString('utf8').trim();
            for (const path of TRUSTED_COMPUTING_BASE) {
              treeHashes[path] = createHash('sha256').update(await blobBytes(path, head)).digest('hex');
            }
          }
        }
        const mainSha = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
        decision = evaluateGovernedLanding({
          clearanceText: chosen.delivery.clearanceText,
          signatureB64: chosen.delivery.signatureB64,
          publicKeyPem,
          now: Date.now(),
          pr: pull,
          commit,
          files: changedPaths,
          treeDiffComplete,
          compare: { behind_by: compare?.behind_by, ahead_by: compare?.ahead_by, status: compare?.status },
          mainSha,
          digest: botCommentsDigest({ issueComments, inlineComments, reviews }),
          commitMessages: [],
          nonceTagExists: tag.status === 200,
          checkRuns: checkBody.check_runs,
          statuses: statusPage.statuses,
          required: requiredChecks,
          landedOnMain: landed,
          fastForward: compare?.status === 'ahead' && compare?.behind_by === 0 && compare?.ahead_by > 0,
          attestationText,
          attestationSignatureB64,
          treeHashes,
        });
        decision.changedPaths = changedPaths;
        }
        if (decision.ok && live) {
          phase = 'write';
          const base = decision.fields.base;
          const tree = decision.fields.tree;
          const writeToken = await mintWriteToken(governedWritePermissions(decision.changedPaths));
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
                body: JSON.stringify({ ref: `refs/julius-governed-audit/pr/${decision.record.pr}`, sha: auditSha }),
              });
            } catch (error) {
              decision = { ok: false, problems: [`the audit record could not be created; main was not moved: ${error instanceof Error ? error.message : 'unknown'}`] };
            }
          }
          if (decision.ok) {
            try {
              await apiWrite('/repos/ohdieyuh-glitch/sunday-relay/git/refs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: `refs/tags/julius-landing-nonce-${decision.fields.nonce}`, sha }),
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
              decision = { ok: false, problems: [`the ref update was refused; no retry and no force: ${error instanceof Error ? error.message : 'unknown'}`] };
            }
          }
          if (decision.ok) {
            const after = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
            if (after !== sha) {
              decision = { ok: false, problems: [`main is ${after} after the update, not ${sha}`] };
            } else {
              moved = true;
              decision = { ...decision, record: { ...decision.record, status: 'final', resultingMainSha: sha }, refUpdate: { sha, force: false } };
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
        if (!moved && updateAccepted && typeof landedSha === 'string') {
          try {
            const after = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
            if (after === landedSha) moved = true;
          } catch { /* unconfirmed: this stays a refusal */ }
        }
        if (moved) {
          note('landed, audit finalize failed');
          finalizeFailed = true;
          decision = { ok: true, problems: [] };
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
    const blocksLater = entries.slice(index + 1).some((later) => later.depends.includes(entry.pr));
    if (blocksLater) {
      note(`stopped: a later queue entry depends on pull request ${entry.pr}`);
      break;
    }
  }
  if (entries.length === 0) note('the governed queue is empty');
  if (finalizeFailed && !refused) process.exitCode = 0;
  if (refused) process.exitCode = 1;
  return walked;
}

if (entrypoint !== '' && import.meta.url === entrypoint) {
  await runCli();
}
