// Governed landing. Pure decisions live in the exports. The CLI at the bottom
// reads GitHub and writes only after every decision is a pass. The ref update
// is non-forced. Crypto and the clearance parser stay in land-lib.mjs.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LANDER_APP_ID,
  LANDER_IDENTITY,
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
  unauthorizedGovernedPaths,
  unusedProtectedPaths,
  verifyClearanceSignature,
} from './land-lib.mjs';
import { judgeClearanceWindow } from '../../scripts/julius-main-provenance-trust.mjs';

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

/** Exactly one delivery whose signature verifies. Zero or several is a refusal. */
export function chooseClearanceDelivery(bodies, publicKeyPem) {
  const verified = [];
  for (const delivery of extractClearanceDeliveries(bodies)) {
    const parsed = parseClearance(delivery.clearanceText);
    if (parsed.problems.length > 0) continue;
    if (verifyClearanceSignature(delivery.clearanceText, delivery.signatureB64, publicKeyPem).length > 0) continue;
    verified.push(delivery);
  }
  if (verified.length !== 1) {
    return {
      problem: verified.length === 0
        ? 'no signed clearance is on the pull request'
        : 'more than one signed clearance is on the pull request',
    };
  }
  return { delivery: verified[0] };
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
  return [
    'JULIUS GOVERNED LANDING',
    `pr: ${record.pr}`,
    `head: ${record.head}`,
    `tree: ${record.tree}`,
    `base: ${record.base}`,
    `clearance-sha256: ${record.clearanceDigest}`,
    `check-runs: ${checks}`,
    `main: ${record.resultingMainSha}`,
    `method: ${record.method}`,
    '',
  ].join('\n');
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
  if (input?.pr?.draft === true && fields['binds-draft'] !== 'yes') problems.push('the pull request is a draft');
  if (input?.pr?.state !== 'open' || input?.pr?.merged === true) problems.push('the pull request is not open');
  if (input?.pr?.base?.ref !== 'main') problems.push('the PR does not target main');
  if (input?.pr?.head?.repo?.full_name !== REPO) problems.push('the PR head is not in this repository');
  if (input?.fileRows !== input?.pr?.changed_files) {
    problems.push(`the files list is incomplete: read ${input?.fileRows} rows, the PR reports ${input?.pr?.changed_files} changed files`);
  }
  const changedFiles = input?.pr?.changed_files;
  if (!Number.isInteger(changedFiles) || changedFiles >= 300 || changedFiles < 1) {
    problems.push('the PR changes 300 or more files, or the count is unknown; a governed landing is refused');
  }
  const files = Array.isArray(input?.files) ? input.files : [];
  if (files.length === 0) problems.push('the PR changes no files');
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
  if (fields['landing-method'] === 'squash') {
    const parents = input?.commit?.parents ?? [];
    if (parents.length !== 1 || parents[0]?.sha !== fields.base) {
      problems.push('a squash landing requires the cleared head to be one commit on the signed base');
    }
  }
  if (fields['landing-method'] === 'fast-forward' && input?.fastForward !== true) {
    problems.push('the pull request head is not a fast-forward of the signed base');
  }
  if (problems.length > 0) return { ok: false, problems };
  let message = null;
  if (fields['landing-method'] === 'squash') {
    message = buildLandingCommitMessage({ clearanceText: input.clearanceText, signatureB64: String(input.signatureB64).trim() });
  }
  const checkRunIds = (input.checkRuns ?? [])
    .filter((run) => run?.name !== (input?.selfCheck ?? GOVERNED_SELF_CHECK) && Number.isInteger(run?.id))
    .map((run) => run.id);
  const target = fields['landing-method'] === 'fast-forward' ? fields.head : null;
  return {
    ok: true,
    problems: [],
    method: fields['landing-method'],
    fields,
    message,
    refUpdate: { sha: target, force: false },
    record: {
      pr: Number(fields.pr),
      head: fields.head,
      tree: fields.tree,
      base: fields.base,
      clearanceDigest: createHash('sha256').update(input.clearanceText, 'utf8').digest('hex'),
      checkRunIds,
      resultingMainSha: target,
      method: fields['landing-method'],
    },
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
  if (env.JULIUS_LANDER_APP_ID !== LANDER_APP_ID) {
    fail([env.JULIUS_LANDER_APP_ID ? `JULIUS_LANDER_APP_ID is ${env.JULIUS_LANDER_APP_ID}, not the pinned lander app ${LANDER_APP_ID}` : 'JULIUS_LANDER_APP_ID is unset']);
    return;
  }
  if (typeof env.JULIUS_LANDER_TOKEN !== 'string' || env.JULIUS_LANDER_TOKEN === '') {
    fail(['JULIUS_LANDER_TOKEN is unset']);
    return;
  }
  const live = env.GITHUB_EVENT_NAME === 'schedule' || env.DRY_RUN === 'false';
  const token = env.JULIUS_LANDER_TOKEN;
  const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
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
  const pageUrl = (path, page) => `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
  const paged = (path) => readAllPages((page) => api(pageUrl(path, page)));
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
  const messages = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = await api(`/repos/${REPO}/commits?sha=main&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) {
      fail(['a main history page was not a list']);
      return;
    }
    messages.push(...rows.map((row) => row?.commit?.message ?? ''));
    if (rows.length < 100) break;
    if (page === 10) {
      fail(['main history did not finish within 10 pages; refusing']);
      return;
    }
  }
  const landedOnMain = new Set();
  for (const entry of queue.entries) {
    if (messages.some((message) => String(message).includes(`Landed PR #${entry.pr} `))) landedOnMain.add(entry.pr);
  }
  const note = (text) => {
    process.stdout.write(`${text}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };
  let refused = false;
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
      try {
      const pull = await api(`/repos/${REPO}/pulls/${number}`);
      const issueComments = await paged(`/repos/${REPO}/issues/${number}/comments`);
      const chosen = chooseClearanceDelivery(issueComments.map((comment) => comment?.body), publicKeyPem);
      if (chosen.problem) {
        decision = { ok: false, problems: [chosen.problem] };
      } else {
        const clearance = parseClearance(chosen.delivery.clearanceText).fields;
        const head = clearance.head;
        const [commit, files, inlineComments, reviews, checkBody, statusBody, compare] = await Promise.all([
          api(`/repos/${REPO}/commits/${head}`),
          paged(`/repos/${REPO}/pulls/${number}/files`),
          paged(`/repos/${REPO}/pulls/${number}/comments`),
          paged(`/repos/${REPO}/pulls/${number}/reviews`),
          api(`/repos/${REPO}/commits/${head}/check-runs?per_page=100`),
          api(`/repos/${REPO}/commits/${head}/status?per_page=100`),
          api(`/repos/${REPO}/compare/${clearance.base}...${head}`),
        ]);
        const tag = await fetch(`https://api.github.com/repos/${REPO}/git/ref/tags/julius-landing-nonce-${clearance.nonce}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(30_000),
        });
        const checksComplete = Array.isArray(checkBody?.check_runs) && checkBody.total_count === checkBody.check_runs.length;
        const statusesComplete = Array.isArray(statusBody?.statuses) && statusBody.total_count === statusBody.statuses.length;
        if (!checksComplete || !statusesComplete || (tag.status !== 200 && tag.status !== 404)) {
          decision = { ok: false, problems: ['the check runs, statuses, or nonce tag could not be read completely'] };
        } else {
        const mainSha = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
        decision = evaluateGovernedLanding({
          clearanceText: chosen.delivery.clearanceText,
          signatureB64: chosen.delivery.signatureB64,
          publicKeyPem,
          now: Date.now(),
          pr: pull,
          commit,
          files: files.flatMap((file) => [file?.filename, file?.previous_filename].filter((path) => typeof path === 'string')),
          fileRows: files.length,
          mainSha,
          digest: botCommentsDigest({ issueComments, inlineComments, reviews }),
          commitMessages: messages,
          nonceTagExists: tag.status === 200,
          checkRuns: checkBody.check_runs,
          statuses: statusBody.statuses,
          required: requiredChecks,
          landedOnMain: landed,
          fastForward: compare?.status === 'ahead' && compare?.behind_by === 0 && compare?.ahead_by > 0,
        });
        }
        if (decision.ok && live) {
          const base = decision.fields.base;
          const tree = decision.fields.tree;
          let sha = decision.method === 'fast-forward' ? decision.fields.head : null;
          if (decision.method === 'squash') {
            const created = await api(`/repos/${REPO}/git/commits`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: decision.message, tree, parents: [base], author: LANDER_IDENTITY, committer: LANDER_IDENTITY }),
            });
            sha = created?.sha;
            const readBack = await api(`/repos/${REPO}/commits/${sha}`);
            const createdProblems = checkCreatedCommit({ created: readBack, sha, base, tree, message: decision.message });
            if (createdProblems.length > 0) {
              decision = { ok: false, problems: createdProblems };
              sha = null;
            }
          }
          if (decision.ok) {
            const nonce = decision.fields.nonce;
            try {
              await api('/repos/ohdieyuh-glitch/sunday-relay/git/refs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: `refs/tags/julius-landing-nonce-${nonce}`, sha }),
              });
            } catch (error) {
              decision = { ok: false, problems: [`the nonce tag could not be created; main was not moved: ${error instanceof Error ? error.message : 'unknown'}`] };
            }
          }
          if (decision.ok) {
            try {
              await api('/repos/ohdieyuh-glitch/sunday-relay/git/refs/heads/main', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sha, force: false }),
              });
            } catch (error) {
              decision = { ok: false, problems: [`the ref update was refused; no retry and no force: ${error instanceof Error ? error.message : 'unknown'}`] };
            }
          }
          if (decision.ok) {
            const after = (await api('/repos/ohdieyuh-glitch/sunday-relay/git/ref/heads/main')).object.sha;
            if (after !== sha) {
              decision = { ok: false, problems: [`main is ${after} after the update, not ${sha}`] };
            } else {
              decision = { ...decision, record: { ...decision.record, resultingMainSha: sha }, refUpdate: { sha, force: false } };
              const body = formatLandingRecord(decision.record);
              await api(`/repos/${REPO}/issues/${number}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
              });
              await api(`/repos/${REPO}/pulls/${number}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: 'closed' }),
              });
              note(body);
            }
          }
        } else if (decision.ok) {
          note(`DRY RUN: pull request ${number} would ${decision.method} with force false.\n${decision.method === 'squash' ? decision.message : decision.fields.head}`);
        }
      }
      } catch (error) {
        decision = { ok: false, problems: [`the pull request could not be read: ${error instanceof Error ? error.message : 'unknown'}`] };
      }
    }
    walked.push({ pr: entry.pr, ok: decision.ok === true, problems: decision.problems ?? [] });
    if (decision.ok === true) {
      landed.add(entry.pr);
      messages.push(`Landed PR #${entry.pr} `);
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
  if (refused) process.exitCode = 1;
  return walked;
}

if (entrypoint !== '' && import.meta.url === entrypoint) {
  await runCli();
}
