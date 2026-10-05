#!/usr/bin/env node
/**
 * THE ONE WAY A SESSION DISPATCHES A PAID JULIUS RUN.
 *
 * `julius-first-live-mission.yml` already refuses to spend unless its own gates
 * pass, and its `paid-slot` job already serialises paid runs. What neither can
 * do is stop a CLIENT from asking twice. A TLS reset after GitHub accepted the
 * dispatch, retried by a shell loop or a CLI, is two paid runs of one mission;
 * two sessions dispatching the same mission a minute apart is the same thing.
 * This client makes the request idempotent from the outside:
 *
 *   1. It names the attempt. The dispatch key is `<mission>@<main sha12>#<lane>#a<n>`,
 *      carried into the run's title, so "is this exact attempt already running?"
 *      is a question GitHub can answer.
 *   2. It asks before it dispatches. A live run with the key → report it and
 *      dispatch nothing. A completed paid run with the key → the attempt is
 *      consumed; a deliberate retry bumps `--attempt`.
 *   3. It proves the rig for free first. A paid dispatch requires a successful
 *      preflight (same mission, same main) — dispatched and awaited here if
 *      none exists — so a run that cannot pass preflight never enters the paid
 *      queue at all.
 *   4. It RECONCILES AFTER AN AMBIGUOUS FAILURE. Any failed dispatch call is
 *      followed by looking for the key before anything is retried, so a request
 *      GitHub accepted and whose answer was lost is found, not repeated.
 *
 * The workflow's `paid-slot` job refuses a second run carrying an earlier run's
 * key, so even a client that bypassed this file cannot make one key spend twice.
 *
 * Everything with a side effect — `gh`, `git`, the clock, the contract checker —
 * is injected, so each of those properties is proven with fakes rather than
 * believed. No token is read or printed here: `gh` holds its own.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISPATCH_KEY_PATTERN, PAID_LANES, PAID_WORKFLOW_FILE, parseRunTitle } from './julius-paid-slot.mjs';

export const CONFIRM_LIVE_PHRASE = 'RUN LIVE MISSION';
const MISSION = /^[a-z0-9-]{1,64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

/* ------------------------------------------------------------------ pure --- */

/** The attempt's name. Deterministic: the same mission, main, lane and attempt give the same key. */
export function dispatchKey({ mission, mainSha, lane, attempt, paid }) {
  if (!MISSION.test(mission ?? '')) throw new Error('dispatch_mission_invalid');
  if (!SHA.test(mainSha ?? '')) throw new Error('dispatch_main_sha_invalid');
  if (!PAID_LANES.includes(lane)) throw new Error('dispatch_lane_invalid');
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 99) throw new Error('dispatch_attempt_invalid');
  const key = `${mission}@${mainSha.slice(0, 12)}#${lane}#a${attempt}${paid ? '' : '#preflight'}`;
  if (!DISPATCH_KEY_PATTERN.test(key)) throw new Error('dispatch_key_unrepresentable');
  return key;
}

/** Runs whose title carries exactly this key, newest first. */
export function runsWithKey(runs, key) {
  return runs
    .filter((run) => parseRunTitle(run.title)?.key === key)
    .sort((a, b) => b.id - a.id);
}

/**
 * What an existing run with this key means for a new dispatch.
 *   NONE      no run carries the key; dispatching is allowed
 *   IN_FLIGHT a run with the key is queued or running; report it, dispatch nothing
 *   CONSUMED  a run with the key completed; this attempt is spent
 */
export function keyState(runs, key) {
  const matching = runsWithKey(runs, key);
  const live = matching.find((run) => run.status !== 'completed');
  if (live) return { state: 'IN_FLIGHT', run: live };
  if (matching.length > 0) return { state: 'CONSUMED', run: matching[0] };
  return { state: 'NONE', run: null };
}

/**
 * The most recent preflight for this mission AT THIS MAIN. A preflight of an
 * older main proves an older rig, so it does not count.
 */
export function latestPreflight(runs, { mission, mainSha }) {
  return runs
    .filter((run) => {
      const parsed = parseRunTitle(run.title);
      return parsed !== null && parsed.mode === 'preflight' && parsed.mission === mission && run.headSha === mainSha;
    })
    .sort((a, b) => b.id - a.id)[0] ?? null;
}

/** The workflow inputs for one dispatch, as `gh workflow run -f` arguments. */
export function dispatchArgs({ mission, lane, key, paid, acknowledgeRerun, maxTicks, hermesRef, carrySourceRun }) {
  const args = ['workflow', 'run', PAID_WORKFLOW_FILE, '--ref', 'main',
    '-f', `mission=${mission}`, '-f', `lane=${lane}`, '-f', `dispatch_key=${key}`];
  if (paid) args.push('-f', `confirm_live=${CONFIRM_LIVE_PHRASE}`);
  if (acknowledgeRerun) args.push('-f', 'acknowledge_rerun=RERUN PAID MISSION');
  if (maxTicks !== undefined) args.push('-f', `max_ticks=${maxTicks}`);
  if (hermesRef !== undefined) args.push('-f', `hermes_ref=${hermesRef}`);
  // DECISION C: a WITH arm's preflight and its paid run both name the paired WITHOUT arm's run.
  if (carrySourceRun !== undefined) args.push('-f', `carry_source_run=${carrySourceRun}`);
  return args;
}

/** A workflow run id, as the paid workflow's `carry_source_run` input accepts one. */
export const CARRY_SOURCE_RUN_PATTERN = /^[0-9]{1,20}$/u;

/* ----------------------------------------------------------------- effects --- */

const toRun = (row) => ({
  id: row?.id, status: row?.status, conclusion: row?.conclusion ?? null,
  title: row?.display_title, headSha: row?.head_sha ?? null, url: row?.html_url ?? null,
});

/**
 * Talk to GitHub through an injected `gh`. Each call returns `{ code, stdout }`;
 * a non-zero code is a failure whose OUTCOME IS UNKNOWN, never a known "no".
 */
export function createGitHub({ gh, repo }) {
  const json = (args, code) => {
    const result = gh(args);
    if (result.code !== 0) throw new Error(code);
    try { return JSON.parse(result.stdout); } catch { throw new Error(`${code}_unparseable`); }
  };
  return {
    mainSha() {
      const body = json(['api', `repos/${repo}/commits/main`], 'github_main_unreadable');
      if (!SHA.test(body?.sha ?? '')) throw new Error('github_main_unreadable');
      return body.sha;
    },
    acceptedCheckpoints(sha) {
      const body = json(['api', `repos/${repo}/actions/artifacts?per_page=10&name=julius-accepted-main-${sha}`], 'github_checkpoints_unreadable');
      if (!Array.isArray(body?.artifacts)) throw new Error('github_checkpoints_unreadable');
      return body.artifacts.filter((artifact) => artifact?.expired === false).length;
    },
    runs() {
      const body = json(['api', `repos/${repo}/actions/workflows/${PAID_WORKFLOW_FILE}/runs?per_page=100`], 'github_runs_unreadable');
      if (!Array.isArray(body?.workflow_runs)) throw new Error('github_runs_unreadable');
      return body.workflow_runs.map(toRun);
    },
    run(id) {
      return toRun(json(['api', `repos/${repo}/actions/runs/${id}`], 'github_run_unreadable'));
    },
    dispatch(args) {
      return gh(args).code === 0;
    },
  };
}

/**
 * Dispatch one run, idempotently. Returns `{ outcome, run?, reason? }` where
 * outcome is DISPATCHED, ALREADY_IN_FLIGHT or REFUSED.
 *
 * AN AMBIGUOUS FAILURE IS RECONCILED BEFORE IT IS RETRIED. After any failed
 * dispatch call the key is looked for over `reconcileMs`; only when no run
 * carries it is the request sent again, and never more than `maxDispatches`
 * times in all.
 */
export async function dispatchOnce({ github, key, args, sleep, log, reconcileMs = 90_000, pollMs = 10_000, maxDispatches = 3 }) {
  const first = keyState(github.runs(), key);
  if (first.state === 'IN_FLIGHT') return { outcome: 'ALREADY_IN_FLIGHT', run: first.run };
  if (first.state === 'CONSUMED') return { outcome: 'REFUSED', reason: 'attempt_already_consumed', run: first.run };

  for (let attempt = 1; attempt <= maxDispatches; attempt += 1) {
    const accepted = github.dispatch(args);
    log(`dispatch_request attempt=${attempt} key=${key} answered=${accepted ? 'accepted' : 'unknown'}`);
    // Accepted or not, the run is found by its key — a listing lags a dispatch
    // either way, and an "unknown" answer may have created the run.
    for (let waited = 0; waited <= reconcileMs; waited += pollMs) {
      let state;
      try { state = keyState(github.runs(), key); } catch { state = null; }
      if (state?.state === 'IN_FLIGHT' || state?.state === 'CONSUMED') {
        return { outcome: 'DISPATCHED', run: state.run };
      }
      await sleep(pollMs);
    }
    log(`dispatch_reconcile key=${key} found=none after ${Math.round(reconcileMs / 1000)}s`);
  }
  return { outcome: 'REFUSED', reason: 'dispatch_unconfirmed_after_retries' };
}

/** Wait for a run to complete. */
async function awaitCompletion({ github, id, sleep, log, pollMs = 30_000, maxMs = 60 * 60_000 }) {
  for (let waited = 0; waited <= maxMs; waited += pollMs) {
    let run = null;
    try { run = github.run(id); } catch { run = null; }
    if (run?.status === 'completed') return run;
    log(`waiting run=${id} status=${run?.status ?? 'unknown'}`);
    await sleep(pollMs);
  }
  return null;
}

/**
 * The whole client. Refusals happen BEFORE the paid dispatch, and every one
 * names its reason.
 */
export async function runPaidDispatch(options, deps) {
  const { mission, lane, attempt = 1, paid = false, acknowledgeRerun = false, maxTicks, hermesRef, dryPlan = false, carrySourceRun } = options;
  const { github, checkContract, sleep, log } = deps;
  const refuse = (reason, extra = {}) => ({ outcome: 'REFUSED', reason, ...extra });

  if (!MISSION.test(mission ?? '')) return refuse('mission_invalid');
  if (!PAID_LANES.includes(lane)) return refuse('lane_invalid');
  if (carrySourceRun !== undefined && !CARRY_SOURCE_RUN_PATTERN.test(carrySourceRun)) return refuse('carry_source_run_invalid');

  const mainSha = github.mainSha();
  if (github.acceptedCheckpoints(mainSha) < 1) return refuse('main_not_accepted', { mainSha });
  const contract = checkContract({ mission, lane, mainSha });
  if (!contract.ok) return refuse('contract_refused', { mainSha, detail: contract.detail });

  const common = { mission, lane, acknowledgeRerun, maxTicks, hermesRef, carrySourceRun };
  const preflightKey = dispatchKey({ mission, mainSha, lane, attempt, paid: false });
  const paidKey = paid ? dispatchKey({ mission, mainSha, lane, attempt, paid: true }) : null;

  if (dryPlan) {
    const runs = github.runs();
    return {
      outcome: 'PLAN', mainSha,
      preflight: { key: preflightKey, latest: latestPreflight(runs, { mission, mainSha }) },
      paid: paidKey === null ? null : { key: paidKey, state: keyState(runs, paidKey).state },
    };
  }

  if (!paid) {
    const result = await dispatchOnce({ github, key: preflightKey, sleep, log, args: dispatchArgs({ ...common, key: preflightKey, paid: false }) });
    return { ...result, mainSha, key: preflightKey };
  }

  // A PAID ATTEMPT THAT IS ALREADY IN FLIGHT OR SPENT IS ANSWERED FIRST, before
  // any preflight is bought for it.
  const existing = keyState(github.runs(), paidKey);
  if (existing.state === 'IN_FLIGHT') return { outcome: 'ALREADY_IN_FLIGHT', run: existing.run, mainSha, key: paidKey };
  if (existing.state === 'CONSUMED') return refuse('attempt_already_consumed', { run: existing.run, mainSha, key: paidKey });

  let preflight = latestPreflight(github.runs(), { mission, mainSha });
  if (preflight === null || (preflight.status === 'completed' && preflight.conclusion !== 'success')) {
    if (preflight !== null) log(`preflight run=${preflight.id} concluded ${preflight.conclusion}; a new preflight is required`);
    const started = await dispatchOnce({ github, key: preflightKey, sleep, log, args: dispatchArgs({ ...common, key: preflightKey, paid: false }) });
    if (started.outcome === 'REFUSED' && started.reason === 'attempt_already_consumed') {
      return refuse('preflight_blocked', { mainSha, run: started.run, detail: 'this attempt\'s preflight already failed; fix the rig and bump --attempt' });
    }
    if (started.outcome === 'REFUSED') return refuse('preflight_undispatchable', { mainSha, detail: started.reason });
    preflight = started.run;
  }
  if (preflight.status !== 'completed') {
    const done = await awaitCompletion({ github, id: preflight.id, sleep, log });
    if (done === null) return refuse('preflight_unfinished', { mainSha, run: preflight });
    preflight = done;
  }
  if (preflight.conclusion !== 'success') return refuse('preflight_blocked', { mainSha, run: preflight });
  log(`preflight run=${preflight.id} succeeded at main ${mainSha.slice(0, 12)}`);

  const result = await dispatchOnce({ github, key: paidKey, sleep, log, args: dispatchArgs({ ...common, key: paidKey, paid: true }) });
  return { ...result, mainSha, key: paidKey };
}

/* --------------------------------------------------------------------- CLI --- */

const option = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

/** `gh` through execFile: no shell, arguments passed as a vector. */
const realGh = (args) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false });
  return { code: result.status ?? 1, stdout: result.stdout ?? '' };
};

/**
 * THE CONTRACT IS CHECKED AS MAIN HAS IT, by main's own checker — both read out
 * of git at the exact SHA, never from whatever the local working tree holds.
 */
const checkContractAtMain = ({ mission, lane, mainSha }) => {
  const dir = mkdtempSync(join(tmpdir(), 'julius-paid-dispatch-'));
  try {
    const show = (path) => execFileSync('git', ['show', `${mainSha}:${path}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    try { execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore' }); } catch { /* the show below decides */ }
    let checker; let contract;
    try {
      checker = show('scripts/julius-live-contract-check.mjs');
      contract = show(`.github/julius-missions/${mission}/contract.json`);
    } catch {
      return { ok: false, detail: `mission_fixture_missing_at_main: .github/julius-missions/${mission}/contract.json` };
    }
    writeFileSync(join(dir, 'check.mjs'), checker);
    writeFileSync(join(dir, 'contract.json'), contract);
    const result = spawnSync(process.execPath, [join(dir, 'check.mjs'), join(dir, 'contract.json'), '--lane', lane], { encoding: 'utf8', shell: false });
    const refusals = (result.stdout ?? '').split('\n').filter((line) => line.startsWith('  - ')).join('; ');
    return result.status === 0 ? { ok: true } : { ok: false, detail: refusals || 'contract_check_failed' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

async function main(argv) {
  const mission = option(argv, 'mission');
  const lane = option(argv, 'lane');
  const attempt = option(argv, 'attempt') === undefined ? 1 : Number(option(argv, 'attempt'));
  const repo = option(argv, 'repo') ?? 'ohdieyuh-glitch/sunday-relay';
  if (!MISSION.test(mission ?? '') || !PAID_LANES.includes(lane) || !Number.isSafeInteger(attempt)) {
    process.stderr.write('usage: julius-paid-dispatch.mjs --mission <slug> --lane <qualification|qualification-repair|lab|regression> [--attempt N] [--paid] [--acknowledge-rerun] [--max-ticks N] [--hermes-ref SHA] [--carry-source-run RUN_ID] [--dry-plan] [--repo owner/repo]\n');
    return 2;
  }
  const log = (line) => process.stdout.write(`${line}\n`);
  try {
    const result = await runPaidDispatch({
      mission, lane, attempt,
      paid: argv.includes('--paid'),
      acknowledgeRerun: argv.includes('--acknowledge-rerun'),
      maxTicks: option(argv, 'max-ticks'),
      hermesRef: option(argv, 'hermes-ref'),
      carrySourceRun: option(argv, 'carry-source-run'),
      dryPlan: argv.includes('--dry-plan'),
    }, {
      github: createGitHub({ gh: realGh, repo }),
      checkContract: checkContractAtMain,
      sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
      log,
    });
    log(`DISPATCH_OUTCOME=${result.outcome}`);
    for (const [field, value] of Object.entries(result)) {
      if (field === 'outcome') continue;
      log(`${field}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : value}`);
    }
    return result.outcome === 'REFUSED' ? 1 : 0;
  } catch (error) {
    log('DISPATCH_OUTCOME=UNKNOWN');
    process.stderr.write(`paid_dispatch_unreadable: ${error instanceof Error ? error.message : 'unknown'}\n`);
    return 1;
  }
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
