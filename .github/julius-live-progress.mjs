#!/usr/bin/env node
/**
 * THE PAID RUN'S LIVE PROGRESS, AS COMMIT STATUSES THE WONDERLAND BRIDGE CAN READ.
 *
 * Started in the background by the paid job, before `LIVE: run the first real
 * Julius mission`, and stopped right after it. Best-effort: nothing here can
 * fail or slow the mission. Every ≥10 s it reads ONE allowlisted projection of
 * the Julius store in this job (the active task's role, task type, state and
 * ordinal, and the run's repair rounds) through a read-only `psql` session,
 * and posts it as the `julius-live-progress` commit status on the run's head
 * sha. The bridge accepts only github-actions[bot] statuses in the exact v1
 * grammar bound to this run, attempt 1 and this wlj.
 *
 * WHAT IS NEVER PUBLISHED: task text, evidence, output, provider payloads,
 * secrets. Each value goes through a closed table; anything outside it is
 * `other` (or `x` for a round count above 3). Every description is checked
 * against the v1 grammar and ≤140 characters, and against the same
 * credential patterns the evidence gates refuse, before it is posted.
 *
 * NOT A VERDICT. The last status is `success` with the word `ended`, whatever
 * the mission's outcome: completion and the grade come only from the evidence
 * reader and the hidden checker. Never infer either from this status.
 *
 * TOKEN. GH_TOKEN is this job's token with `statuses: write`, passed to this
 * process only. It is used by `fetch` here and never handed to a child: the
 * one child, `docker exec … psql`, gets an environment without it. A same-user
 * process on the runner could read /proc/<pid>/environ; the token's only write
 * is commit statuses, which no gate trusts (the lander gates on required check
 * runs), so the worst it allows is noise on other commits.
 *
 * REPAIR ROUNDS follow the runtime's own rule (src/relay/mission/julius/
 * julius-repair-lineage.ts, `repairRoundsBefore`): every repair task minted is
 * one round. Counted per run, not per work unit; J1 is one unit, and a
 * multi-unit mission could read high. Published for any active task.
 */

import { spawn } from 'node:child_process';

export const CONTEXT = 'julius-live-progress';
export const GRAMMAR = /^v1 r(\d{1,20})\.a1\.([0-9a-f]{8}) s(\d{1,6}) (idle|ended|(architect|coder|reviewer|other):(plan|build|review|research|repair_plan|repair_build|repair_guidance|repair_rebuttal|repair_audit|other):(blocked|runnable|active|succeeded|failed|cancelled|skipped|other) o(\d{1,4}) c([0-3x]))$/u;
export const DESCRIPTION_MAX = 140;
export const MIN_INTERVAL_MS = 10_000;
export const MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;

const ROLES = { PROMPT_ARCHITECT: 'architect', CODING_AGENT: 'coder', INDEPENDENT_REVIEWER: 'reviewer' };
const TASK_TYPES = {
  plan: 'plan', build: 'build', review: 'review', research: 'research',
  'repair:plan': 'repair_plan', 'repair:build': 'repair_build', 'repair:guidance': 'repair_guidance',
  'repair:rebuttal': 'repair_rebuttal', 'repair:audit': 'repair_audit',
};
const STATES = { BLOCKED: 'blocked', RUNNABLE: 'runnable', ACTIVE: 'active', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELLED: 'cancelled', SKIPPED: 'skipped' };
const WLJ = /^wlj_([0-9a-f]{8})-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/** The ONE query: allowlisted columns of this run's tasks, read-only, bound by a psql variable. */
export const TASK_QUERY = [
  'SET default_transaction_read_only = on;',
  "SELECT role, task_type, state, ordinal FROM relay_wonderland.julius_tasks WHERE run_id = :'wlj' ORDER BY ordinal;",
].join('\n');

/** The same shapes the evidence gates refuse to publish. */
export function credentialShaped(value) {
  return /sk-/u.test(value)
    || /gh[pousr]_/u.test(value)
    || /github_pat_/u.test(value)
    || /xai-/u.test(value)
    || /BEGIN [A-Z ]*PRIVATE KEY/u.test(value)
    || /Bearer /u.test(value);
}

/** `psql -A -t -F '\t'` rows: role, task_type, state, ordinal. A malformed row is dropped. */
export function parseTaskRows(stdout) {
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/u)) {
    if (line === '' || line === 'SET') continue;
    const cells = line.split('\t');
    if (cells.length !== 4 || !/^\d{1,9}$/u.test(cells[3] ?? '')) continue;
    rows.push({ role: cells[0], taskType: cells[1], state: cells[2], ordinal: Number(cells[3]) });
  }
  return rows;
}

/** The newest ACTIVE task and the run's repair rounds up to it, from the rows alone. Null when nothing is active. */
export function snapshotOf(rows) {
  const active = rows.filter((row) => row.state === 'ACTIVE').sort((a, b) => b.ordinal - a.ordinal)[0];
  if (active === undefined) return null;
  const rounds = rows.filter((row) => typeof row.taskType === 'string' && row.taskType.startsWith('repair:') && row.ordinal <= active.ordinal).length;
  return {
    role: ROLES[active.role] ?? 'other',
    taskType: TASK_TYPES[active.taskType] ?? 'other',
    state: STATES[active.state] ?? 'other',
    ordinal: Math.min(active.ordinal, 9999),
    cycle: rounds > 3 ? 'x' : String(rounds),
  };
}

/** The v1 description, or null when it would break the grammar, the length, or the credential scan. */
export function describe({ runId, wlj8, seq, snapshot, marker }) {
  const body = marker === 'ended' ? 'ended'
    : snapshot === null ? 'idle'
      : `${snapshot.role}:${snapshot.taskType}:${snapshot.state} o${snapshot.ordinal} c${snapshot.cycle}`;
  const text = `v1 r${runId}.a1.${wlj8} s${seq} ${body}`;
  if (text.length > DESCRIPTION_MAX || !GRAMMAR.test(text) || credentialShaped(text)) return null;
  return text;
}

/** Read and validate the environment. Null (with a reason word) when this run must not publish at all. */
export function configFrom(env) {
  const wlj = WLJ.exec(env.WLJ ?? '');
  if (wlj === null) return { refused: 'wlj_invalid' };
  if (!RUN_ID.test(env.RUN_ID ?? '')) return { refused: 'run_id_invalid' };
  if (env.RUN_ATTEMPT !== '1') return { refused: 'attempt_not_1' };
  if (!SHA40.test(env.HEAD_SHA ?? '')) return { refused: 'head_sha_invalid' };
  if (!REPO.test(env.GITHUB_REPOSITORY ?? '')) return { refused: 'repo_invalid' };
  if ((env.GH_TOKEN ?? '') === '') return { refused: 'token_missing' };
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(env.PG_CONTAINER ?? '')) return { refused: 'container_invalid' };
  return {
    refused: null,
    wlj: env.WLJ,
    wlj8: wlj[1],
    runId: env.RUN_ID,
    headSha: env.HEAD_SHA,
    repo: env.GITHUB_REPOSITORY,
    token: env.GH_TOKEN,
    container: env.PG_CONTAINER,
    pg: { PGUSER: env.PGUSER ?? '', PGDATABASE: env.PGDATABASE ?? '', PGPASSWORD: env.PGPASSWORD ?? '' },
  };
}

/** One read of the store. The child's environment carries the database login only, never GH_TOKEN. */
export function readTasks(config, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const child = spawnImpl('docker', [
      'exec', '-i', '-e', 'PGPASSWORD', config.container,
      'psql', '-U', config.pg.PGUSER, '-d', config.pg.PGDATABASE, '-A', '-t', '-F', '\t', '-v', `wlj=${config.wlj}`, '-v', 'ON_ERROR_STOP=1',
    ], { env: { PATH: process.env.PATH ?? '', PGPASSWORD: config.pg.PGPASSWORD }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.stdout.on('data', (chunk) => { if (out.length < 1_000_000) out += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? parseTaskRows(out) : null); });
    child.stdin.end(TASK_QUERY);
  });
}

export async function postStatus(config, description, state, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${config.repo}/statuses/${config.headSha}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ state, context: CONTEXT, description }),
  });
  return response.status === 201;
}

/** The loop: post on change, at most every MIN_INTERVAL_MS; `ended` once on stop; exit after MAX_RUNTIME_MS. */
export async function run(env, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(`${line}\n`));
  const config = configFrom(env);
  if (config.refused !== null) {
    log(`live_progress skipped reason=${config.refused}`);
    return;
  }
  const read = deps.readTasks ?? ((c) => readTasks(c));
  const post = deps.postStatus ?? ((c, d, s) => postStatus(c, d, s));
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const stopped = deps.stopped ?? (() => false);
  const started = now();
  let seq = 0;
  let last = '';
  const publish = async (snapshot, marker, state) => {
    const description = describe({ runId: config.runId, wlj8: config.wlj8, seq: seq + 1, snapshot, marker });
    if (description === null) {
      log('live_progress skipped reason=refused_description');
      return;
    }
    try {
      if (await post(config, description, state)) {
        seq += 1;
        log(`live_progress posted s${seq}`);
      } else {
        log('live_progress skipped reason=post_refused');
      }
    } catch {
      log('live_progress skipped reason=post_failed');
    }
  };
  while (!stopped() && now() - started < MAX_RUNTIME_MS && seq < 999_998) {
    const rows = await read(config);
    if (rows === null) {
      log('live_progress skipped reason=store_unreadable');
    } else {
      const snapshot = snapshotOf(rows);
      const key = snapshot === null ? 'idle' : JSON.stringify(snapshot);
      if (key !== last) {
        await publish(snapshot, null, 'pending');
        last = key;
      }
    }
    await sleep(MIN_INTERVAL_MS);
  }
  await publish(null, 'ended', 'success');
}

const invoked = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/gu, '/').replace(/^([A-Za-z]:)/u, '/$1')}`).href;
if (invoked) {
  let stop = false;
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });
  run(process.env, { stopped: () => stop }).then(() => process.exit(0), () => process.exit(0));
}
