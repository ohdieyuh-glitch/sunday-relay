#!/usr/bin/env node
/**
 * GRADE ONE PAID J1 RUN WITH THE PINNED HIDDEN CHECKER.
 *
 * Runs in its own job, on a fresh runner, with no provider credential and no
 * environment. Its inputs are three directories the workflow prepared:
 *
 *   --staging <dir>        contract.json, checker/check.mjs, checker/oracle.mjs and
 *                          seed/data/{legacy_ledger.csv,posts.json}, staged from git
 *                          objects at the run's own commit. Never the coder workspace.
 *   --final-message <dir>  the live job's `<task>.raw.txt` + `<task>.manifest.json`.
 *   --evidence <dir>       the live job's redacted evidence (tasks.tsv is read).
 *   --out <file>           checker-verdict.txt, the only output.
 *
 * The verdict is a closed set: PASS, FAIL, NOT_RUN. Only the checker's own PASS
 * line, with its pinned self-hash and the judged hash equal to the manifest,
 * is PASS. The exit code is non-zero ONLY for a pin mismatch, an integrity
 * mismatch, a missing final message, or a checker crash. A FAIL exits 0: a run
 * whose artifact failed is still a run, and it must stay visible as FAIL.
 *
 * The attempt graded is chosen from the run's durable task rows, never by a
 * guess: the one SUCCEEDED Coding Agent build that no repair supersedes. None
 * is NOT_RUN no_completed_build. More than one is NOT_RUN ambiguous_attempt.
 * The raw file is deleted once it has been read.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

/** Equal to the constants in relay-bridge/julius-inworld-checker.ts; a drift test holds them together. */
export const J1_GRADE_PINS = Object.freeze({
  contractSha256: 'bfa90f50f70916ff52180a94537f243300da8dcc51ee06d3952b0f18876226aa',
  combinedSha256: '0ca020dbfd2f971a8c112444961aa57ea0d113b0c1d86336f420fcae126eafd3',
  checkerFileSha256: '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e',
  oracleSha256: '50328c58bd828ce2595c977cb1b1ff973481215425b8192e9d341c3e70357323',
});
export const J1_PIN_FILES = Object.freeze(['contract.json', 'checker/check.mjs', 'checker/oracle.mjs', 'seed/data/legacy_ledger.csv', 'seed/data/posts.json']);

export const VERDICTS = Object.freeze(['PASS', 'FAIL', 'NOT_RUN']);
export const NOT_RUN_REASONS = Object.freeze([
  'pin_mismatch', 'no_completed_build', 'ambiguous_attempt', 'final_message_missing',
  'integrity_mismatch', 'checker_crashed', 'evidence_unreadable', 'run_not_completed',
]);

const BUILD_TYPES = new Set(['build', 'repair:build']);
const TASK_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function combinedPin(entries) {
  const h = createHash('sha256');
  for (const [name, bytes] of entries) h.update(`${name}\n${sha256(bytes)}\n`);
  return h.digest('hex');
}

/** `psql -A -F '\t'`: a header row, the rows, and a `(N rows)` footer. */
export function parsePsqlTsv(text) {
  const lines = String(text).split(/\r?\n/u).filter((line) => line !== '' && !/^\(\d+ rows?\)$/u.test(line));
  if (lines.length === 0) return null;
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
  });
}

/**
 * The attempt graded: in the ONE run whose durable state is COMPLETED, the one
 * SUCCEEDED Coding Agent build that no same-role repair names as its parent,
 * and whose repair chain traces back to that run's own first build. The run's
 * state row names no task, so the run id is the binding: a build of another
 * run never counts. Anything else is refused, never resolved by a choice.
 */
export function selectGradedAttempt(tasks, runs) {
  if (!Array.isArray(runs)) return { ok: false, reason: 'evidence_unreadable' };
  const completed = runs.filter((r) => r.state === 'COMPLETED');
  if (completed.length === 0) return { ok: false, reason: 'run_not_completed' };
  if (completed.length > 1) return { ok: false, reason: 'ambiguous_attempt' };
  const runId = completed[0].run_id;
  const builds = tasks.filter((t) => t.run_id === runId && t.role === 'CODING_AGENT' && BUILD_TYPES.has(t.task_type));
  const byId = new Map(builds.map((t) => [t.task_id, t]));
  // The runtime's own rule (julius-repair-lineage.ts isJuliusRepairOf): a repair names its parent,
  // keeps its role, and carries the planner's id `repair:<parent>:<round>:task`. A row without that
  // shape supersedes nothing, so it cannot redirect what is graded.
  const isRepairOf = (child, parent) => parent !== undefined && child.task_type === 'repair:build' && child.role === parent.role
    && child.task_id.startsWith(`repair:${parent.task_id}:`) && /^[1-9]\d*$/u.test(child.task_id.slice(`repair:${parent.task_id}:`.length, -':task'.length))
    && child.task_id.endsWith(':task');
  const superseded = new Set(builds.filter((t) => isRepairOf(t, byId.get(t.parent_task_id))).map((t) => t.parent_task_id));
  const leaves = builds.filter((t) => t.state === 'SUCCEEDED' && !superseded.has(t.task_id));
  if (leaves.length === 0) return { ok: false, reason: 'no_completed_build' };
  if (leaves.length > 1) return { ok: false, reason: 'ambiguous_attempt', taskIds: leaves.map((t) => t.task_id) };
  // The chain: repair:build -> its parent -> ... -> the run's first build, with no parent.
  const seen = new Set();
  let cursor = leaves[0];
  while (cursor.task_type === 'repair:build') {
    if (seen.has(cursor.task_id)) return { ok: false, reason: 'ambiguous_attempt' };
    seen.add(cursor.task_id);
    const parent = byId.get(cursor.parent_task_id);
    if (!isRepairOf(cursor, parent)) return { ok: false, reason: 'ambiguous_attempt' };
    cursor = parent;
  }
  if (cursor.task_type !== 'build' || cursor.parent_task_id !== '') return { ok: false, reason: 'ambiguous_attempt' };
  return { ok: true, taskId: leaves[0].task_id, taskType: leaves[0].task_type, runId };
}

/** The checker's own protocol (check.mjs): checker_sha256=, judged_trimmed_sha256=, then PASS or FAIL. */
export function judgeCheckerRun(run, expected) {
  if (run.error !== undefined || run.signal !== null || (run.status !== 0 && run.status !== 1)) return { verdict: 'NOT_RUN', reason: 'checker_crashed' };
  const lines = String(run.stdout ?? '').split(/\r?\n/u).filter((line) => line !== '');
  const field = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
  if (field('checker_sha256') !== expected.checkerFileSha256) return { verdict: 'NOT_RUN', reason: 'pin_mismatch' };
  if (field('judged_trimmed_sha256') !== expected.trimmedSha256) return { verdict: 'NOT_RUN', reason: 'integrity_mismatch' };
  const last = lines[lines.length - 1];
  if (run.status === 0 && last === 'PASS') return { verdict: 'PASS', reason: null };
  if (run.status === 1 && last === 'FAIL') {
    const failed = lines.find((line) => line.startsWith('FAILED_SECTIONS: '))?.slice('FAILED_SECTIONS: '.length) ?? '';
    return { verdict: 'FAIL', reason: null, failedSections: failed };
  }
  return { verdict: 'NOT_RUN', reason: 'checker_crashed' };
}

export function verdictText(v) {
  const lines = [
    'schema=julius-inworld-verdict.v1',
    `verdict=${VERDICTS.includes(v.verdict) ? v.verdict : 'NOT_RUN'}`,
    `reason=${v.reason ?? 'none'}`,
    `run_id=${v.runId ?? 'none'}`,
    `task_id=${v.taskId ?? 'none'}`,
    `task_type=${v.taskType ?? 'none'}`,
    `judged_trimmed_sha256=${v.trimmedSha256 ?? 'none'}`,
    `raw_sha256=${v.rawSha256 ?? 'none'}`,
    `game_digest=${v.trimmedSha256 ? v.trimmedSha256.slice(0, 12) : 'none'}`,
    `checker_sha256=${v.checkerSha256 ?? 'none'}`,
    `combined_pin=${v.combinedPin ?? 'none'}`,
    `grader_sha256=${v.graderSha256 ?? 'none'}`,
    `failed_sections=${v.failedSections ?? 'none'}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function gradeInworld(opts) {
  const base = { graderSha256: opts.graderSha256 ?? null };
  // 1. Pins, on the staged bytes, before anything runs.
  let entries;
  try {
    entries = J1_PIN_FILES.map((name) => [name, readFileSync(join(opts.staging, name))]);
  } catch {
    return { exit: 2, verdict: { ...base, verdict: 'NOT_RUN', reason: 'pin_mismatch' } };
  }
  const pinned = {
    contract: sha256(entries[0][1]), checker: sha256(entries[1][1]), oracle: sha256(entries[2][1]), combined: combinedPin(entries),
  };
  const pinRecord = { ...base, checkerSha256: pinned.checker, combinedPin: pinned.combined };
  if (pinned.contract !== J1_GRADE_PINS.contractSha256 || pinned.checker !== J1_GRADE_PINS.checkerFileSha256
    || pinned.oracle !== J1_GRADE_PINS.oracleSha256 || pinned.combined !== J1_GRADE_PINS.combinedSha256) {
    return { exit: 2, verdict: { ...pinRecord, verdict: 'NOT_RUN', reason: 'pin_mismatch' } };
  }
  // 2. The attempt, from the run's durable task rows.
  let tasks = null;
  let runs = null;
  try {
    tasks = parsePsqlTsv(readFileSync(join(opts.evidence, 'tasks.tsv'), 'utf8'));
    runs = parsePsqlTsv(readFileSync(join(opts.evidence, 'runs.tsv'), 'utf8'));
  } catch { tasks = null; }
  if (tasks === null || runs === null) return { exit: 0, verdict: { ...pinRecord, verdict: 'NOT_RUN', reason: 'evidence_unreadable' } };
  const attempt = selectGradedAttempt(tasks, runs);
  if (!attempt.ok) return { exit: 0, verdict: { ...pinRecord, verdict: 'NOT_RUN', reason: attempt.reason } };
  if (!TASK_ID.test(attempt.taskId)) return { exit: 0, verdict: { ...pinRecord, verdict: 'NOT_RUN', reason: 'evidence_unreadable' } };
  const stem = attempt.taskId.replace(/:/gu, '_');
  const rawPath = join(opts.finalMessage, `${stem}.raw.txt`);
  const manifestPath = join(opts.finalMessage, `${stem}.manifest.json`);
  const withTask = { ...pinRecord, taskId: attempt.taskId, taskType: attempt.taskType, runId: attempt.runId };
  // 3. The final message, checked against its manifest. Missing is a failed step.
  if (!existsSync(rawPath) || !existsSync(manifestPath)) return { exit: 3, verdict: { ...withTask, verdict: 'NOT_RUN', reason: 'final_message_missing' } };
  let raw;
  let manifest;
  try {
    raw = readFileSync(rawPath);
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { exit: 3, verdict: { ...withTask, verdict: 'NOT_RUN', reason: 'final_message_missing' } };
  }
  const trimmedSha256 = sha256(raw);
  const rawSha256 = typeof manifest?.rawSha256 === 'string' && SHA.test(manifest.rawSha256) ? manifest.rawSha256 : null;
  const withHashes = { ...withTask, trimmedSha256, rawSha256 };
  if (manifest?.schema !== 'julius-final-message.v1' || manifest.taskId !== attempt.taskId || manifest.runId !== attempt.runId || manifest.trimmedSha256 !== trimmedSha256 || rawSha256 === null) {
    return { exit: 2, verdict: { ...withHashes, verdict: 'NOT_RUN', reason: 'integrity_mismatch' } };
  }
  // 4. The checker, as its own process, with only PATH and the temp dir in its env, in the staging dir.
  // The command is a literal, and every path is relative to the staging dir it runs in, so the
  // repository boundary scan can read exactly what runs. The hash is J1_GRADE_PINS.checkerFileSha256
  // (a test holds the two equal).
  const judgedCopy = join(opts.staging, 'final-message.txt');
  let run;
  try {
    writeFileSync(judgedCopy, raw, { mode: 0o600 });
    run = spawnSync('node', [
      'checker/check.mjs', 'final-message.txt', 'seed/data/legacy_ledger.csv', 'seed/data/posts.json',
      '--expect-self-sha256', '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e'
    ], {
      cwd: opts.staging, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), TEMP: opts.staging, TMPDIR: opts.staging, HOME: opts.staging },
    });
  } finally {
    // 5. The raw text is not kept past grading.
    try { rmSync(judgedCopy, { force: true }); } catch { /* the job's runner is discarded with it */ }
    try { rmSync(rawPath, { force: true }); } catch { /* the job's runner is discarded with it */ }
  }
  const judged = judgeCheckerRun(run, { checkerFileSha256: J1_GRADE_PINS.checkerFileSha256, trimmedSha256 });
  const verdict = { ...withHashes, ...judged };
  const exit = judged.verdict === 'NOT_RUN' && (judged.reason === 'checker_crashed' || judged.reason === 'pin_mismatch' || judged.reason === 'integrity_mismatch') ? 2 : 0;
  return { exit, verdict };
}

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

function runningAsMain() {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return false;
  try { return import.meta.url === pathToFileURL(realpathSync(entry)).href; } catch { return false; }
}

if (runningAsMain()) {
  const argv = process.argv.slice(2);
  const staging = arg('--staging', argv);
  const finalMessage = arg('--final-message', argv);
  const evidence = arg('--evidence', argv);
  const out = arg('--out', argv);
  if (staging === null || finalMessage === null || evidence === null || out === null) {
    process.stderr.write('usage: julius-inworld-grade.mjs --staging <dir> --final-message <dir> --evidence <dir> --out <file>\n');
    process.exit(64);
  }
  const graderSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
  const result = gradeInworld({ staging: resolve(staging), finalMessage: resolve(finalMessage), evidence: resolve(evidence), graderSha256 });
  const text = verdictText(result.verdict);
  writeFileSync(out, text);
  process.stdout.write(text);
  process.exit(result.exit);
}
