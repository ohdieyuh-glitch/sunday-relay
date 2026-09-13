#!/usr/bin/env node
/**
 * THE PAID PROVIDER SLOT — who may spend next, decided by a rule we wrote.
 *
 * `julius-first-live-mission.yml` is the only workflow here that can spend
 * provider money, and until this file it serialised paid runs with one shared
 * workflow-level concurrency group. GitHub keeps exactly ONE pending run per
 * group: a third dispatch silently CANCELS the one already waiting, and there
 * is no notion of priority. A lab experiment dispatched after the continuous
 * qualification could therefore evict the qualification from the queue without
 * anybody deciding that, and the only evidence would be a grey "cancelled".
 *
 * So admission is no longer delegated to the concurrency primitive. Every paid
 * run starts a small `paid-slot` job first; that job runs the repository trust
 * gate and then THIS script, which reads the workflow's own runs and waits
 * until the rule below says it is this run's turn. The paid job `needs:` it,
 * so nothing that can reach a provider starts before admission succeeded.
 *
 * THE RULE, in one paragraph. Only runs whose title says `mode=paid` compete.
 * A run HOLDS the slot while its `paid-slot` job has concluded `success` and
 * the run itself has not completed — it has been admitted and may be spending.
 * A run is WAITING while its `paid-slot` job has not completed. A run PROCEEDS
 * only when nobody holds the slot and it is first among all waiting runs under
 * `(lane rank, created at, run id)`. A waiting run never preempts a holder,
 * whatever its lane: a paid run that has been admitted holds a durable Julius
 * run and live sandboxes, and evicting it would leave both to be reconciled by
 * hand.
 *
 * FAIL CLOSED, EVERYWHERE. A listing that cannot be read is UNKNOWN, and
 * unknown is never "the slot is free": an API error resets the confirmation and
 * the loop waits. A run whose title cannot be parsed is not ignored — it waits
 * at the lowest priority, so a malformed dispatch can neither jump the queue
 * nor vanish from it. And a single PROCEED is not trusted either: the Actions
 * listing lags, so admission needs TWO consecutive PROCEED readings at least
 * fifteen seconds apart.
 *
 * NO DEPENDENCY, NO SECRET. Node 22's `fetch` and the job's own read-only
 * `github.token`. The token is sent as a header and never printed; errors carry
 * a code and a path, never a header or a response body.
 *
 * The decision functions are pure — no network, no clock, no environment — so
 * the tests prove the queue by calling them, and the CLI at the bottom is only
 * the part that asks GitHub and sleeps.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------ vocabulary --- */

/**
 * THE LANES, IN PRIORITY ORDER. Rank is the index, and lower goes first.
 *
 * `qualification` is the continuous qualification the product is being judged
 * on; `qualification-repair` is a paid rerun repairing one; `lab` is an
 * experiment; `regression` re-runs a mission that already has a paid history.
 * The deployment table in `julius-live-contract-check.mjs` says which lane a
 * mission may claim, so a lab mission cannot buy qualification priority by
 * typing the word.
 */
export const PAID_LANES = Object.freeze(['qualification', 'qualification-repair', 'lab', 'regression']);

/** The job, by its display name in the Actions API. The workflow test pins it. */
export const PAID_SLOT_JOB_NAME = 'paid-slot';
/** The provider-capable job, by its display name. */
export const PAID_JOB_NAME = 'Preflight, then the live mission';
/** The workflow file every read is scoped to. */
export const PAID_WORKFLOW_FILE = 'julius-first-live-mission.yml';

/** A dispatch key, as the workflow input gate also requires it. */
export const DISPATCH_KEY_PATTERN = /^[A-Za-z0-9._@#-]{8,96}$/u;
/**
 * What the run title carries when no key was given. Four characters, so it can
 * never collide with a real key, which the pattern above holds to eight or more.
 */
export const NO_DISPATCH_KEY = 'none';
/** What a preflight-only run's title carries when no lane was claimed. */
export const UNSPECIFIED_LANE = 'unspecified';

/** Below every real lane. An unparseable run waits here: never ignored, never ahead. */
const UNPARSEABLE_RANK = PAID_LANES.length;

/* --------------------------------------------------------------- parsing --- */

const TITLE = /^julius mission=([a-z0-9-]{1,64}) lane=([a-z-]{1,32}) mode=(paid|preflight) key=([^\s]{1,96})$/u;

/**
 * Read a run title written by the workflow's `run-name:`.
 *
 * Whole-string and exact, because the title is assembled from dispatch inputs
 * and a mission input containing ` mode=paid` must not be able to smuggle a
 * second assignment into it. Anything that is not exactly the grammar — an
 * unknown lane, a malformed key, extra words — is null, and null is handled by
 * the caller as "waiting, lowest priority", never as "not a paid run".
 */
export function parseRunTitle(title) {
  if (typeof title !== 'string') return null;
  const match = TITLE.exec(title);
  if (match === null) return null;
  const [, mission, lane, mode, rawKey] = match;
  // A DRY RUN NEED NOT CLAIM A LANE. It never enters the paid queue, so its
  // title may say `lane=unspecified` and still parse — otherwise every free
  // preflight would read as an unparseable run and appear in the queue report.
  // A PAID run with no lane is not a paid run this queue understands.
  if (!PAID_LANES.includes(lane) && !(lane === UNSPECIFIED_LANE && mode === 'preflight')) return null;
  let key;
  if (rawKey === NO_DISPATCH_KEY) key = null;
  else if (DISPATCH_KEY_PATTERN.test(rawKey)) key = rawKey;
  else return null;
  return { mission, lane, mode, key };
}

/** Priority of a lane; anything outside the vocabulary ranks below all of it. */
export function laneRank(lane) {
  const index = PAID_LANES.indexOf(lane);
  return index === -1 ? UNPARSEABLE_RANK : index;
}

/** `createdAt` as a number; unreadable sorts last rather than first. */
const createdAtMs = (value) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

/** The queue order: lane, then who asked first, then the run id as a total tiebreak. */
export function compareQueueEntries(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const at = createdAtMs(a.createdAt); const bt = createdAtMs(b.createdAt);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id - b.id;
}

const isRunId = (value) => Number.isSafeInteger(value) && value > 0;
const slotConcludedSuccess = (run) => run?.slotJob?.status === 'completed' && run.slotJob.conclusion === 'success';
const slotNotCompleted = (run) => run?.slotJob === null || run?.slotJob === undefined || run.slotJob.status !== 'completed';

/**
 * Classify every listed run into holders and waiters. Shared by the admission
 * decision and the status report, so the two can never describe the queue
 * differently.
 *
 * A HOLDER IS RECOGNISED WITHOUT ITS TITLE. Only a paid run ever runs the
 * `paid-slot` job, so a concluded-success slot on a live run is a run that was
 * admitted, and it holds the slot whether or not anyone can read its title.
 */
export function classifyPaidRuns(runs, { excludeId = null } = {}) {
  const holders = [];
  const waiting = [];
  for (const run of runs) {
    if (run.id === excludeId) continue;
    if (run.status === 'completed') continue;
    const parsed = parseRunTitle(run.title);
    if (slotConcludedSuccess(run)) {
      holders.push({ id: run.id, lane: parsed?.lane ?? null, parsed });
      continue;
    }
    if (parsed !== null && parsed.mode !== 'paid') continue;
    if (parsed === null || slotNotCompleted(run)) {
      waiting.push({ id: run.id, rank: parsed === null ? UNPARSEABLE_RANK : laneRank(parsed.lane), createdAt: run.createdAt, lane: parsed?.lane ?? null });
    }
  }
  holders.sort((a, b) => a.id - b.id);
  waiting.sort(compareQueueEntries);
  return { holders, waiting };
}

const wait = (reason, extra = {}) => ({ decision: 'WAIT', holder: null, ahead: [], reason, ...extra });

/**
 * THE ADMISSION DECISION. Pure: the same listing always gives the same answer.
 *
 * @param {object} input
 * @param {{ id: number, createdAt: string, status: string, title: string }} input.self
 * @param {Array<{ id: number, createdAt: string, status: string, title: string,
 *   slotJob: { status: string, conclusion: string | null } | null }>} input.runs
 * @returns {{ decision: 'PROCEED' } | { decision: 'WAIT', holder: number | null, ahead: number[], reason: string, queue?: number[] }
 *   | { decision: 'REFUSE_DUPLICATE', original: number }}
 */
export function decidePaidSlot(input) {
  const self = input?.self;
  const runs = input?.runs;
  if (self === null || typeof self !== 'object' || !isRunId(self.id)) return wait('self_unreadable');
  if (!Array.isArray(runs)) return wait('run_list_unreadable');
  // A row without an id or a status is a listing we did not understand, and a
  // listing we did not understand cannot prove the slot is free.
  for (const run of runs) {
    if (run === null || typeof run !== 'object' || !isRunId(run.id) || typeof run.status !== 'string') {
      return wait('run_list_malformed');
    }
  }
  const selfParsed = parseRunTitle(self.title);
  if (selfParsed === null || selfParsed.mode !== 'paid') return wait('self_title_unparseable');
  // LISTING LAG. A run that cannot see itself in the list is looking at a list
  // older than itself, which may be missing other runs as recent as it is.
  if (!runs.some((run) => run.id === self.id)) return wait('self_not_listed');

  /**
   * A DUPLICATE NEVER SPENDS.
   *
   * The dispatch client never sends two runs for one key, but a client that
   * crashed between an ambiguous failure and its reconciliation, or a human
   * pasting the same command twice, can. The EARLIEST live run for a key is the
   * one that counts; any later one refuses itself. A completed run that was
   * ADMITTED for the key has already had its chance to spend, so the key is
   * consumed — a deliberate retry bumps the attempt and gets a new key.
   */
  if (selfParsed.key !== null) {
    let original = null;
    for (const run of runs) {
      if (run.id === self.id) continue;
      const parsed = parseRunTitle(run.title);
      if (parsed === null || parsed.mode !== 'paid' || parsed.key !== selfParsed.key) continue;
      const liveAndEarlier = run.status !== 'completed' && run.id < self.id;
      const consumed = run.status === 'completed' && run.slotJob?.conclusion === 'success';
      if ((liveAndEarlier || consumed) && (original === null || run.id < original)) original = run.id;
    }
    if (original !== null) return { decision: 'REFUSE_DUPLICATE', original };
  }

  const { holders, waiting } = classifyPaidRuns(runs, { excludeId: self.id });
  const selfEntry = { id: self.id, rank: laneRank(selfParsed.lane), createdAt: self.createdAt, lane: selfParsed.lane };
  const queue = [...waiting, selfEntry].sort(compareQueueEntries);
  const position = queue.findIndex((entry) => entry.id === self.id);
  const ahead = queue.slice(0, position).map((entry) => entry.id);

  // NEVER PREEMPT A HOLDER. Priority orders the waiting room; it does not open
  // the door of a room somebody is already in.
  if (holders.length > 0) {
    return { decision: 'WAIT', holder: holders[0].id, ahead, reason: 'slot_held', queue: queue.map((entry) => entry.id) };
  }
  if (position === 0) return { decision: 'PROCEED' };
  return { decision: 'WAIT', holder: null, ahead, reason: 'not_first_in_queue', queue: queue.map((entry) => entry.id) };
}

/* ---------------------------------------------------------------- status --- */

/** The state vocabulary `status` prints. Closed. */
export const PAID_RUN_STATES = Object.freeze([
  'IDLE', 'QUALIFICATION_ACTIVE', 'LAB_ACTIVE', 'QUEUED', 'PREFLIGHT_BLOCKED', 'PROVIDER_BLOCKED',
]);

/**
 * Provider refusals that mean "this account cannot be served", recognised in a
 * LIVE step's job log. Read for a CLASS only — no matching line is ever printed.
 *
 * Narrow on purpose: a word like "quota" in an unrelated line must not turn a
 * mission failure into a provider verdict, so each rule needs the wording a
 * provider refusal actually carries.
 */
const PROVIDER_FAILURE_RULES = Object.freeze([
  ['AUTH_CONFIGURATION', /\bAUTH_CONFIGURATION\b/u],
  ['PROVIDER_UNAVAILABLE_NON_RETRYABLE', /\bPROVIDER_UNAVAILABLE\b[^\n]*\b(?:retryable[=:]\s*false|non-retryable|not retryable)\b/iu],
  ['INSUFFICIENT_QUOTA', /\binsufficient_quota\b/u],
  ['CREDIT_BALANCE', /\bcredit balance\b/iu],
  ['HTTP_401', /\b401\b[^\n]*\b(?:unauthori[sz]ed|invalid[ _-]api[ _-]key|authentication)\b/iu],
  ['HTTP_402', /\b402\b[^\n]*\b(?:payment required|billing|credit)\b/iu],
  ['HTTP_429_QUOTA', /\b429\b[^\n]*\b(?:quota|billing|credit|spend(?:ing)? limit)\b/iu],
]);

/** The provider class a LIVE log shows, or null. Never returns log content. */
export function classifyProviderFailure(logText) {
  if (typeof logText !== 'string' || logText === '') return null;
  for (const [name, rule] of PROVIDER_FAILURE_RULES) {
    if (rule.test(logText)) return name;
  }
  return null;
}

/**
 * THE ONE-WORD ANSWER TO "can a paid run start now, and if not, why".
 *
 * @param {object} input
 * @param {Array<object>} input.runs  Same shape as `decidePaidSlot`'s runs.
 * @param {null | { id: number, conclusion: string | null, failedStep: string | null,
 *   logsRead: boolean, providerClass: string | null }} input.lastCompleted
 *   The most recent COMPLETED paid run, or null if there is none.
 */
export function derivePaidRunState(input) {
  const runs = Array.isArray(input?.runs) ? input.runs : [];
  const { holders, waiting } = classifyPaidRuns(runs);
  const queue = waiting.map((entry) => entry.id);
  const base = { holder: holders[0]?.id ?? null, holderLane: holders[0]?.lane ?? null, queue, lastResult: null, lastLiveFailure: null };
  if (holders.length > 0) {
    // AN UNREADABLE HOLDER IS NOT THE QUALIFICATION. Only a title that says so
    // earns QUALIFICATION_ACTIVE; anything else holding the slot is reported as
    // the other kind of activity, with its lane printed as unknown.
    const lane = holders[0].lane;
    const state = lane === 'qualification' || lane === 'qualification-repair' ? 'QUALIFICATION_ACTIVE' : 'LAB_ACTIVE';
    return { state, ...base };
  }
  if (waiting.length > 0) return { state: 'QUEUED', ...base };

  const last = input?.lastCompleted ?? null;
  if (last === null) return { state: 'IDLE', ...base, lastResult: 'none' };
  const lastResult = `run=${last.id} conclusion=${last.conclusion ?? 'unknown'}${last.failedStep ? ` failed_step="${last.failedStep}"` : ''}`;
  if (last.conclusion === 'failure' && typeof last.failedStep === 'string') {
    if (last.failedStep.startsWith('Gate:') || last.failedStep.startsWith('Preflight:')) {
      return { state: 'PREFLIGHT_BLOCKED', ...base, lastResult };
    }
    if (last.failedStep.startsWith('LIVE:')) {
      // UNREAD IS NOT CLASSIFIED. Without the log, a live failure could be a
      // provider refusal or a mission bug, and this report does not guess.
      if (last.logsRead === true && typeof last.providerClass === 'string' && last.providerClass !== '') {
        return { state: 'PROVIDER_BLOCKED', ...base, lastResult, lastLiveFailure: last.providerClass };
      }
      return { state: 'IDLE', ...base, lastResult, lastLiveFailure: 'unclassified' };
    }
  }
  return { state: 'IDLE', ...base, lastResult };
}

/** First failed step across a run's jobs, admission job first. */
export function firstFailedStep(jobs) {
  if (!Array.isArray(jobs)) return null;
  const ordered = [...jobs].sort((a, b) => (a?.name === PAID_SLOT_JOB_NAME ? -1 : 0) - (b?.name === PAID_SLOT_JOB_NAME ? -1 : 0));
  for (const job of ordered) {
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      if (step?.conclusion === 'failure' && typeof step.name === 'string') return { job, step: step.name };
    }
  }
  return null;
}

/**
 * The models a workflow file pins, read as YAML KEYS rather than as text so a
 * comment naming a model is not mistaken for the setting.
 */
export function pinnedModelsFrom(workflowText) {
  const pick = (name) => {
    if (typeof workflowText !== 'string') return null;
    const match = new RegExp(`^\\s+${name}:\\s*['"]?([A-Za-z0-9._:/-]{1,80})['"]?\\s*$`, 'mu').exec(workflowText);
    return match ? match[1] : null;
  };
  return {
    architect: pick('OPENAI_PROMPT_ARCHITECT_MODEL'),
    coder: pick('RELAY_HOSTED_CODING_MODEL'),
    reviewerProvider: pick('RELAY_HERMES_PROVIDER'),
    reviewerModel: pick('RELAY_HERMES_MODEL'),
  };
}

/* ----------------------------------------------------------- the waiting --- */

/**
 * Wait for admission. Everything with a side effect is injected, so the loop's
 * fail-closed properties are tested with a fake clock rather than believed.
 *
 * Exit codes: 0 admitted, 3 duplicate dispatch, 4 waited too long.
 */
export async function waitForPaidSlot({
  readState, sleep, now, log,
  maxWaitMs = 340 * 60_000, pollMs = 20_000, confirmGapMs = 15_000, maxBackoffMs = 120_000,
}) {
  const startedAt = now();
  let firstProceedAt = null;
  let consecutiveErrors = 0;
  for (;;) {
    if (now() - startedAt > maxWaitMs) {
      log(`paid_slot_wait_exhausted: no admission within ${Math.round(maxWaitMs / 60_000)} minutes; nothing was spent`);
      return 4;
    }
    let decision;
    try {
      decision = decidePaidSlot(await readState());
      consecutiveErrors = 0;
    } catch (error) {
      // UNKNOWN IS NOT FREE. The confirmation is discarded with the reading,
      // so an error between two PROCEEDs cannot be stitched across.
      consecutiveErrors += 1;
      firstProceedAt = null;
      const code = error instanceof GitHubApiError ? error.code : 'github_api_unreadable';
      log(`paid_slot state=UNKNOWN error=${code} attempt=${consecutiveErrors}`);
      await sleep(Math.min(pollMs * 2 ** (consecutiveErrors - 1), maxBackoffMs));
      continue;
    }
    if (decision.decision === 'REFUSE_DUPLICATE') {
      log(`paid_slot_duplicate_dispatch: run ${decision.original} already carries this dispatch key; this run will not spend`);
      return 3;
    }
    if (decision.decision === 'PROCEED') {
      if (firstProceedAt === null) {
        firstProceedAt = now();
        log('paid_slot state=PROCEED_UNCONFIRMED holder=none queue=self-first (confirming against listing lag)');
      } else if (now() - firstProceedAt >= confirmGapMs) {
        log(`paid_slot state=ADMITTED holder=none confirmed_after_ms=${now() - firstProceedAt}`);
        return 0;
      } else {
        log('paid_slot state=PROCEED_UNCONFIRMED holder=none queue=self-first (second reading too soon)');
      }
    } else {
      firstProceedAt = null;
      const holder = decision.holder === null ? 'none' : String(decision.holder);
      const queue = Array.isArray(decision.queue) ? decision.queue.join(',') : 'unknown';
      log(`paid_slot state=WAIT reason=${decision.reason} holder=${holder} ahead=${decision.ahead.length === 0 ? 'none' : decision.ahead.join(',')} queue=${queue}`);
    }
    await sleep(pollMs);
  }
}

/* ------------------------------------------------------------- GitHub I/O --- */

/** An API failure carrying a safe code and nothing else: no header, no body. */
export class GitHubApiError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GitHubApiError';
    this.code = code;
  }
}

/**
 * A read-only GitHub client over `fetch`.
 *
 * CONDITIONAL REQUESTS, because several waiting runs polling every twenty
 * seconds would otherwise spend the job token's hourly budget: a `304 Not
 * Modified` is answered from the cached body and does not count against the
 * primary rate limit.
 */
export function createGitHubTransport({ token, fetchImpl = globalThis.fetch, apiBase = 'https://api.github.com' }) {
  if (typeof token !== 'string' || token.trim() === '') throw new GitHubApiError('github_token_missing');
  const cache = new Map();
  const headers = (extra = {}) => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'julius-paid-slot',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  });
  const request = async (path, extra) => {
    try {
      return await fetchImpl(`${apiBase}/${path}`, { headers: headers(extra), redirect: 'follow' });
    } catch {
      throw new GitHubApiError('github_api_unreachable');
    }
  };
  return {
    async getJson(path) {
      const cached = cache.get(path);
      const response = await request(path, cached ? { 'If-None-Match': cached.etag } : {});
      if (response.status === 304 && cached) return cached.body;
      if (!response.ok) throw new GitHubApiError(`github_api_http_${response.status}`);
      let body;
      try { body = await response.json(); } catch { throw new GitHubApiError('github_api_body_unreadable'); }
      const etag = response.headers?.get?.('etag');
      if (typeof etag === 'string' && etag !== '') cache.set(path, { etag, body });
      return body;
    },
    async getText(path) {
      const response = await request(path, { Accept: 'application/vnd.github.raw' });
      if (!response.ok) throw new GitHubApiError(`github_api_http_${response.status}`);
      try { return await response.text(); } catch { throw new GitHubApiError('github_api_body_unreadable'); }
    },
  };
}

const REPO = /^[\w.-]+\/[\w.-]+$/u;
const toRun = (row) => ({
  id: row?.id,
  createdAt: row?.created_at,
  startedAt: row?.run_started_at ?? null,
  status: row?.status,
  conclusion: row?.conclusion ?? null,
  title: row?.display_title,
  headSha: row?.head_sha ?? null,
  url: row?.html_url ?? null,
  slotJob: null,
});

/**
 * Every run of the paid workflow created in the lookback window, all pages.
 *
 * A WINDOW, NOT "THE FIRST HUNDRED". A holder created before a burst of dry runs
 * would fall off a fixed first page and the slot would read as free. Nothing in
 * this workflow can stay live for three days — the jobs are capped at 350 and
 * 120 minutes and GitHub abandons a job queued for a day — so 72 hours is a
 * window no live run can be outside. A listing longer than the page bound is an
 * error rather than a truncation.
 */
export async function listPaidWorkflowRuns(api, { repo, sinceIso, maxPages = 10 }) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await api.getJson(`repos/${repo}/actions/workflows/${PAID_WORKFLOW_FILE}/runs?per_page=100&page=${page}&created=${encodeURIComponent(`>=${sinceIso}`)}`);
    if (!Array.isArray(body?.workflow_runs) || !Number.isInteger(body?.total_count)) throw new GitHubApiError('github_run_list_unreadable');
    rows.push(...body.workflow_runs);
    if (rows.length >= body.total_count || body.workflow_runs.length < 100) return rows.map(toRun);
  }
  throw new GitHubApiError('github_run_list_truncated');
}

/** A run's jobs, latest attempt only. */
export async function jobsOf(api, repo, runId) {
  const body = await api.getJson(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  if (!Array.isArray(body?.jobs)) throw new GitHubApiError('github_job_list_unreadable');
  return body.jobs;
}

/** The `paid-slot` job of a job list, or null. Two of them is not a guess we make. */
export function slotJobFrom(jobs) {
  const matches = jobs.filter((job) => job?.name === PAID_SLOT_JOB_NAME);
  if (matches.length > 1) throw new GitHubApiError('github_slot_job_ambiguous');
  if (matches.length === 0) return null;
  return { status: matches[0].status, conclusion: matches[0].conclusion ?? null };
}

/**
 * Read everything `decidePaidSlot` needs, fetching jobs only for the runs whose
 * slot state can matter: live runs that are paid or unreadable, and completed
 * runs carrying this run's own key.
 */
export async function readPaidSlotState(api, { repo, runId, sinceIso }) {
  const selfRow = await api.getJson(`repos/${repo}/actions/runs/${runId}`);
  const self = toRun(selfRow);
  if (!isRunId(self.id)) throw new GitHubApiError('github_self_run_unreadable');
  const runs = await listPaidWorkflowRuns(api, { repo, sinceIso });
  const selfKey = parseRunTitle(self.title)?.key ?? null;
  for (const run of runs) {
    if (run.id === self.id) continue;
    const parsed = parseRunTitle(run.title);
    const live = run.status !== 'completed' && (parsed === null || parsed.mode === 'paid');
    const sameKey = selfKey !== null && parsed?.mode === 'paid' && parsed.key === selfKey;
    if (live || sameKey) run.slotJob = slotJobFrom(await jobsOf(api, repo, run.id));
  }
  return { self, runs };
}

/* ------------------------------------------------------------------- CLI --- */

const option = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

const realSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const lookbackIso = (nowMs) => new Date(nowMs - 72 * 3_600_000).toISOString().replace(/\.\d{3}Z$/u, 'Z');

async function runWait(argv, env) {
  const repo = option(argv, 'repo');
  const runId = Number(option(argv, 'run-id'));
  const maxWaitMinutes = option(argv, 'max-wait-minutes') === undefined ? 340 : Number(option(argv, 'max-wait-minutes'));
  if (typeof repo !== 'string' || !REPO.test(repo) || !isRunId(runId) || !Number.isFinite(maxWaitMinutes) || maxWaitMinutes <= 0) {
    process.stderr.write('usage: julius-paid-slot.mjs wait --repo <owner/repo> --run-id <id> [--max-wait-minutes N]\n');
    return 2;
  }
  let api;
  try { api = createGitHubTransport({ token: env.GH_TOKEN }); } catch (error) {
    process.stderr.write(`paid_slot_refused: ${error.code}\n`);
    return 2;
  }
  const log = (line) => process.stdout.write(`${line}\n`);
  return waitForPaidSlot({
    readState: () => readPaidSlotState(api, { repo, runId, sinceIso: lookbackIso(Date.now()) }),
    sleep: realSleep,
    now: () => Date.now(),
    log,
    maxWaitMs: maxWaitMinutes * 60_000,
  });
}

/**
 * `status`: what the paid slot is doing, for a human or a session deciding
 * whether to dispatch. Read-only; prints no token and no log line.
 */
export async function collectPaidRunStatus(api, { repo, nowMs, readLogs = false }) {
  const runs = await listPaidWorkflowRuns(api, { repo, sinceIso: lookbackIso(nowMs) });
  const jobsById = new Map();
  for (const run of runs) {
    const parsed = parseRunTitle(run.title);
    if (run.status !== 'completed' && (parsed === null || parsed.mode === 'paid')) {
      const jobs = await jobsOf(api, repo, run.id);
      jobsById.set(run.id, jobs);
      run.slotJob = slotJobFrom(jobs);
    }
  }
  const lastRun = runs
    .filter((run) => run.status === 'completed' && parseRunTitle(run.title)?.mode === 'paid')
    .sort((a, b) => b.id - a.id)[0] ?? null;
  let lastCompleted = null;
  if (lastRun !== null) {
    const jobs = await jobsOf(api, repo, lastRun.id);
    jobsById.set(lastRun.id, jobs);
    lastRun.slotJob = slotJobFrom(jobs);
    const failed = firstFailedStep(jobs);
    let providerClass = null;
    let logsRead = false;
    if (readLogs && failed !== null && failed.step.startsWith('LIVE:') && isRunId(failed.job?.id)) {
      providerClass = classifyProviderFailure(await api.getText(`repos/${repo}/actions/jobs/${failed.job.id}/logs`));
      logsRead = true;
    }
    lastCompleted = { id: lastRun.id, conclusion: lastRun.conclusion, failedStep: failed?.step ?? null, logsRead, providerClass };
  }
  const derived = derivePaidRunState({ runs, lastCompleted });
  const shown = runs.filter((run) => jobsById.has(run.id));
  const models = new Map();
  for (const run of shown) {
    if (typeof run.headSha !== 'string' || !/^[0-9a-f]{40}$/u.test(run.headSha) || models.has(run.headSha)) continue;
    try {
      const text = await api.getText(`repos/${repo}/contents/.github/workflows/${PAID_WORKFLOW_FILE}?ref=${run.headSha}`);
      models.set(run.headSha, pinnedModelsFrom(text));
    } catch {
      models.set(run.headSha, null);
    }
  }
  return { derived, shown, models };
}

export function renderPaidRunStatus({ derived, shown, models }) {
  const lines = [`PAID_RUN_STATE=${derived.state}`];
  lines.push(`holder=${derived.holder ?? 'none'} holder_lane=${derived.holder === null ? 'none' : (derived.holderLane ?? 'unknown')} queue=${derived.queue.length === 0 ? 'empty' : derived.queue.join(',')}`);
  if (derived.lastResult !== null) lines.push(`last_result=${derived.lastResult}`);
  if (derived.lastLiveFailure !== null) lines.push(`last_live_failure=${derived.lastLiveFailure}`);
  lines.push('run_id\tmission\tlane\tkey\thead_sha\tcreated\tstarted\tstatus/conclusion\tqueue_position\tarchitect\tcoder\treviewer');
  for (const run of shown) {
    const parsed = parseRunTitle(run.title);
    const position = derived.queue.indexOf(run.id);
    const pinned = typeof run.headSha === 'string' ? models.get(run.headSha) : null;
    const queuePosition = run.id === derived.holder ? 'holder' : position >= 0 ? String(position + 1) : '-';
    lines.push([
      run.id,
      parsed?.mission ?? 'unparseable',
      parsed?.lane ?? 'unknown',
      parsed === null ? 'unknown' : (parsed.key ?? 'none'),
      typeof run.headSha === 'string' ? run.headSha.slice(0, 12) : 'unknown',
      run.createdAt ?? 'unknown',
      run.startedAt ?? 'unknown',
      `${run.status}/${run.conclusion ?? '-'}`,
      queuePosition,
      pinned?.architect ?? 'unknown',
      pinned?.coder ?? 'unknown',
      pinned ? `${pinned.reviewerProvider ?? 'unknown'}/${pinned.reviewerModel ?? 'unknown'}` : 'unknown',
    ].join('\t'));
  }
  return lines;
}

async function runStatus(argv, env) {
  const repo = option(argv, 'repo') ?? env.GITHUB_REPOSITORY;
  if (typeof repo !== 'string' || !REPO.test(repo)) {
    process.stderr.write('usage: julius-paid-slot.mjs status --repo <owner/repo> [--logs]   (GH_TOKEN in the environment)\n');
    return 2;
  }
  try {
    const api = createGitHubTransport({ token: env.GH_TOKEN });
    const collected = await collectPaidRunStatus(api, { repo, nowMs: Date.now(), readLogs: argv.includes('--logs') });
    for (const line of renderPaidRunStatus(collected)) process.stdout.write(`${line}\n`);
    return 0;
  } catch (error) {
    process.stdout.write('PAID_RUN_STATE=UNKNOWN\n');
    process.stderr.write(`paid_slot_status_unreadable: ${error instanceof GitHubApiError ? error.code : 'github_api_unreadable'}\n`);
    return 1;
  }
}

async function main(argv, env) {
  const [command, ...rest] = argv;
  if (command === 'wait') return runWait(rest, env);
  if (command === 'status') return runStatus(rest, env);
  process.stderr.write('usage: julius-paid-slot.mjs <wait|status> ...\n');
  return 2;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
