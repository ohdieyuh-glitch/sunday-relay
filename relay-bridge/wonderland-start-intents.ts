/**
 * A-9: THE DURABLE START INTENT AND ITS RECOVERY WORKER (Wonderland Start v2).
 *
 * Off unless JULIUS_WONDERLAND_START_ACK is exactly `1` (with
 * JULIUS_WONDERLAND_START and JULIUS_WONDERLAND_START_V2). Unset, POST /start
 * and /status answer exactly as before this file existed.
 *
 * With the flag, POST /start (after every synchronous check the route already
 * makes) writes one record to `<store>.start-intents.json` under the store's
 * write lock (temp file, fsync, rename, directory fsync) and answers 202
 * `ack: "accepted"` at once. The saved intent is a durable acknowledgment of
 * the request, not of the dispatch: no gate has run yet and nothing has been
 * spent. The UNCHANGED claim core then runs in the background with the same
 * input and the same Start binding as the synchronous v2 Start; its answer is
 * saved on the intent (`settled`) and shown on /status `start.request`.
 *
 * RULES (docs/JULIUS_WONDERLAND_CONTRACT.md R1-R4):
 * - R1. An intent never authorizes spend. It is never a spend reservation and
 *   never consent. The claim core is the only gate, and it re-runs every gate
 *   (lane grant, workflow and contract at main, rerun gate, in-flight guard,
 *   spent tag, the reservation re-check under the lock) on every run.
 * - R2. While a Start is live for a mission, a Start with another key is 409
 *   `julius_start_in_progress`.
 * - R3. A Start for a mission the journal already holds a claim for never
 *   writes an intent: the claim core replays the claim, so nothing dispatches.
 * - R4. The journal wins: the intent never shows a state more started than the
 *   journal, and no intent is resumed or re-run once the journal has a claim.
 *
 * THE RECOVERY WORKER (JULIUS_WONDERLAND_START_RESUME=1, with the ack flag;
 * JULIUS_WONDERLAND_START_RESUME_DISABLED=1 wins over everything). At boot and
 * then every 30 s, in the bridge that holds `<store>.bridge.lock`, it resumes
 * an `accepted` intent with no live task only when ALL hold: the flags are on
 * now (re-read every pass, never stored); the repository and lane are set now;
 * the intent is at most 10 minutes old; it carries no rerun phrase (that
 * phrase comes only from a live request body); it has never been resumed
 * (`resumeAttempts` 0); the journal has no claim for its mission, its server
 * run or its key; and NO claim anywhere in the store is unreconciled
 * (`dispatching`, attempted or not, or `dispatch_failed` with
 * `gh_workflow_run_failed`). Under the same write lock a client retry takes,
 * it then (1) writes `resumeAttempts: 1` and `resumedAt` to the intent, (2)
 * appends and fsyncs one line (intent id and age) to
 * `<store>.start-resumes.log`, and only then (3) calls the claim core. A
 * failed write at (1) or (2) refuses the resume. The log is evidence only:
 * nothing here ever reads it, so a missing or corrupt log cannot allow a
 * resume, and it is never restored. /status shows the resume from the intent's
 * own `resumeAttempts`/`resumedAt`.
 *
 * Nothing here runs `gh`, builds an argv, or writes the admission store or its
 * operator journal.
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

import { openAdmissionFile, resolveAdmissionStorePath, type ClaimEvent, type OperatorDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import { OPERATOR_DISPATCH_CONFIRMATION, OPERATOR_LANES, type ClaimResult, type OperatorClaimTool } from '../src/relay/integration/wonderland-admission/operator-claim';
import {
  START_ACK_FLAG,
  startHttp,
  startKeyHash as hashStartKey,
  WONDERLAND_START_FLAG,
  WONDERLAND_START_V2_FLAG,
  type WonderlandStartsInFlight,
} from './wonderland-mission-start-route';

export { START_ACK_FLAG };
export const START_RESUME_FLAG = 'JULIUS_WONDERLAND_START_RESUME';
export const START_RESUME_KILL_SWITCH = 'JULIUS_WONDERLAND_START_RESUME_DISABLED';
export const START_INTENTS_SCHEMA = 'wonderland-start-intents.v1';
export const START_RESUME_LOG_SCHEMA = 'wonderland-start-resume.v1';
/** An intent older than this (bridge clock, from `acceptedAt`) is never resumed or re-run: a new click, a new key. */
export const START_INTENT_WINDOW_MS = 600_000;
export const START_RESUME_INTERVAL_MS = 30_000;

type Env = Readonly<Record<string, string | undefined>>;
type Http = { status: number; body: unknown };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const WLJ = /^wlj_[0-9a-f-]{36}$/u;
const SERVER_RUN = /^[A-Za-z0-9_:.-]{1,200}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u;
const TRIGGER = /^[A-Za-z0-9_-]{8,64}$/u;
const STARTED: ReadonlySet<string> = new Set(['dispatching', 'dispatched']);

export type StartIntentState = 'accepted' | 'settled';

/** The claim core's answer, as the Start route would have sent it. */
export interface StartOutcome {
  readonly httpStatus: number;
  readonly body: Record<string, unknown>;
}

export interface StartIntent {
  readonly wljRunId: string;
  readonly serverRunId: string;
  /** sha256 of the Start's idempotency key. Also the intent's id. */
  readonly startKeyHash: string;
  readonly clientTriggerId: string;
  /** sha256 over confirm, acknowledgeRerun (or null) and clientTriggerId. */
  readonly bodyDigest: string;
  /** The body carried the rerun phrase. Such an intent is never resumed: the phrase is never stored or replayed. */
  readonly rerunAcknowledged: boolean;
  readonly acceptedAt: string;
  readonly state: StartIntentState;
  readonly outcome: StartOutcome | null;
  readonly updatedAt: string;
  /** 0 or 1. Written BEFORE the claim core is called on a resume. */
  readonly resumeAttempts: number;
  readonly resumedAt: string | null;
  /** Why a marked resume did not call the claim core, or null. */
  readonly resumeRefused: string | null;
}

export function startIntentsPath(storePath: string): string {
  return `${storePath}.start-intents.json`;
}

export function startResumesLogPath(storePath: string): string {
  return `${storePath}.start-resumes.log`;
}

export function startAckEnabled(env: Env): boolean {
  return env[WONDERLAND_START_FLAG] === '1' && env[WONDERLAND_START_V2_FLAG] === '1' && env[START_ACK_FLAG] === '1';
}

export function startResumeEnabled(env: Env): boolean {
  return env[START_RESUME_KILL_SWITCH] !== '1' && startAckEnabled(env) && env[START_RESUME_FLAG] === '1';
}

export function startBodyDigest(confirm: string, acknowledgeRerun: string | null, clientTriggerId: string): string {
  return createHash('sha256').update(JSON.stringify([confirm, acknowledgeRerun, clientTriggerId]), 'utf8').digest('hex');
}

// ---------------------------------------------------------------- the file

export type StartIntentsRead = { readonly ok: true; readonly intents: readonly StartIntent[] } | { readonly ok: false };

/** The intents file. Absent is empty. Anything else that is not exactly this schema is unreadable (fail closed). */
export function readStartIntents(storePath: string): StartIntentsRead {
  const path = startIntentsPath(storePath);
  if (!existsSync(path)) return { ok: true, intents: [] };
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(value) || value.schema !== START_INTENTS_SCHEMA || !Array.isArray(value.intents)) return { ok: false };
    const intents: StartIntent[] = [];
    for (const item of value.intents) {
      const intent = asIntent(item);
      if (intent === null) return { ok: false };
      intents.push(intent);
    }
    if (new Set(intents.map((intent) => intent.wljRunId)).size !== intents.length) return { ok: false };
    return { ok: true, intents };
  } catch {
    return { ok: false };
  }
}

function asIntent(value: unknown): StartIntent | null {
  if (!isObject(value)) return null;
  const v = value;
  const str = (key: string, re: RegExp) => typeof v[key] === 'string' && re.test(v[key] as string);
  const nullableIso = (key: string) => v[key] === null || str(key, ISO);
  if (!str('wljRunId', WLJ) || !str('serverRunId', SERVER_RUN) || !str('startKeyHash', HEX64) || !str('clientTriggerId', TRIGGER)
    || !str('bodyDigest', HEX64) || !str('acceptedAt', ISO) || !str('updatedAt', ISO) || !nullableIso('resumedAt')
    || typeof v.rerunAcknowledged !== 'boolean'
    || (v.state !== 'accepted' && v.state !== 'settled')
    || (v.resumeAttempts !== 0 && v.resumeAttempts !== 1)
    || (v.resumeRefused !== null && typeof v.resumeRefused !== 'string')) return null;
  let outcome: StartOutcome | null = null;
  if (v.outcome !== null) {
    if (!isObject(v.outcome) || !isObject(v.outcome.body)) return null;
    const status = v.outcome.httpStatus;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) return null;
    outcome = { httpStatus: status, body: v.outcome.body };
  }
  if ((v.state === 'settled') !== (outcome !== null)) return null;
  return {
    wljRunId: v.wljRunId as string,
    serverRunId: v.serverRunId as string,
    startKeyHash: v.startKeyHash as string,
    clientTriggerId: v.clientTriggerId as string,
    bodyDigest: v.bodyDigest as string,
    rerunAcknowledged: v.rerunAcknowledged as boolean,
    acceptedAt: v.acceptedAt as string,
    state: v.state as StartIntentState,
    outcome,
    updatedAt: v.updatedAt as string,
    resumeAttempts: v.resumeAttempts as number,
    resumedAt: v.resumedAt as string | null,
    resumeRefused: v.resumeRefused as string | null,
  };
}

/** Temp file, fsync, rename, directory fsync. The caller holds the store's write lock. */
export function writeStartIntents(storePath: string, intents: readonly StartIntent[]): void {
  const path = startIntentsPath(storePath);
  const tmp = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ schema: START_INTENTS_SCHEMA, intents })}\n`, null, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    try { closeSync(fd); } catch { /* closing */ }
    try { unlinkSync(tmp); } catch { /* absent */ }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* absent */ }
    throw error;
  }
  fsyncDirectory(dirname(path));
}

/**
 * Append one resume line and fsync it. Evidence only: nothing in the bridge
 * reads this file, it never gates a decision, and it is never restored. A
 * throw here refuses the resume.
 */
export function appendStartResumeLine(storePath: string, line: { readonly wljRunId: string; readonly intentId: string; readonly intentAgeMs: number; readonly at: string }): void {
  const path = startResumesLogPath(storePath);
  const created = !existsSync(path);
  const fd = openSync(path, 'a', 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ schema: START_RESUME_LOG_SCHEMA, ...line })}\n`, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created) fsyncDirectory(dirname(path));
}

function fsyncDirectory(dir: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Run `job` holding the store's write lock, in this process's queue for the
 * store: the same lock and queue the claim core and a client retry take. The
 * job gets the admission journal as read under that lock.
 */
function withStoreLock<T>(storePath: string, job: (journal: OperatorDocument) => T): Promise<T> {
  return openAdmissionFile(storePath).exclusive((io) => Promise.resolve(job(io.read())));
}

function resolvedStore(raw: string): string | null {
  const located = resolveAdmissionStorePath(raw);
  return located.ok ? located.path : null;
}

// ---------------------------------------------------------------- journal facts

function claimsOf(journal: OperatorDocument, wlj: string, serverRunId: string): readonly ClaimEvent[] {
  return journal.claims.filter((event) => event.wonderlandRunId === wlj || event.serverRunId === serverRunId);
}

/** The latest event of every claim in the store that may still have reached GitHub without a known outcome. */
export function unreconciledClaimInStore(journal: OperatorDocument): boolean {
  const latest = new Map<string, ClaimEvent>();
  for (const event of journal.claims) latest.set(`${event.wonderlandRunId}\n${event.serverRunId}`, event);
  for (const event of latest.values()) {
    if (event.state === 'dispatching') return true;
    if (event.state === 'dispatch_failed' && event.dispatchError === 'gh_workflow_run_failed') return true;
  }
  return false;
}

// ---------------------------------------------------------------- the coordinator

export interface StartAcceptInput {
  readonly wljRunId: string;
  readonly serverRunId: string;
  readonly repo: string;
  readonly lane: string;
  readonly storePath: string;
  readonly rerunConfirmation: string | null;
  readonly startKey: string;
  readonly clientTriggerId: string;
  readonly nowMs: number;
  /** The synchronous v2 Start (the claim core, awaited), used when the journal already holds a claim: it replays. */
  readonly replay: () => Promise<Http>;
}

export interface StartRequestView {
  readonly state: 'accepted' | 'claiming' | 'settled' | 'interrupted';
  readonly startKeyHash: string;
  readonly acceptedAt: string;
  readonly outcome: StartOutcome | null;
  readonly resumed: boolean;
  readonly resumedAt: string | null;
  readonly resumeRefused?: string;
}

export interface StartResumePassResult {
  readonly resumed: readonly string[];
  readonly refused: readonly string[];
  readonly reason: 'disabled' | 'not_configured' | 'unreadable' | 'unreconciled_claim_in_store' | 'ran';
}

export interface WonderlandStartRequests {
  accept(input: StartAcceptInput): Promise<Http>;
  /** /status: the intent for this mission, with the journal winning (R4). Reads only. */
  view(storePath: string, wlj: string, serverRunId: string | null, claim: ClaimEvent | null, nowMs: number, env: Env): { readonly request: StartRequestView | null; readonly unreadable: boolean };
  /** One recovery pass. Exposed for the worker and for tests. */
  resumePass(env: Env, nowMs: number): Promise<StartResumePassResult>;
  /** Start the worker: one pass now, then every {@link START_RESUME_INTERVAL_MS}. Returns a stop. */
  startWorker(env: () => Env, nowMs?: () => number): () => void;
  /** Tests: wait until no background claim is running. */
  idle(): Promise<void>;
  live(wlj: string): string | null;
}

interface LiveTask {
  readonly startKeyHash: string;
  readonly source: 'client' | 'client_retry' | 'resume';
  promise: Promise<void>;
}

export interface StartRequestsIo {
  readonly writeIntents?: typeof writeStartIntents;
  readonly appendResumeLine?: typeof appendStartResumeLine;
}

const err = (status: number, kind: string, message: string, extra: Record<string, unknown> = {}): Http => ({ status, body: { error: { kind, message }, ...extra } });

export function createWonderlandStartRequests(deps: {
  readonly claimTool: (storePath: string) => OperatorClaimTool;
  readonly startsInFlight?: WonderlandStartsInFlight;
  /** The store this bridge serves, for the worker. Read from the env at each pass when absent. */
  readonly storePath?: () => string;
  /** Tests only: fault injection for the two durable writes. Production passes neither. */
  readonly io?: StartRequestsIo;
}): WonderlandStartRequests {
  const writeIntents = deps.io?.writeIntents ?? writeStartIntents;
  const appendLine = deps.io?.appendResumeLine ?? appendStartResumeLine;
  const tasks = new Map<string, LiveTask>();
  /** Outcomes this process saved or could not save: a settle that failed to write is never resumed here. */
  const settledHere = new Map<string, { startKeyHash: string; outcome: StartOutcome }>();

  const ackBody = (intent: StartIntent, replayed: boolean): Record<string, unknown> => ({
    wljRunId: intent.wljRunId,
    ack: 'accepted',
    state: 'accepted',
    startKeyHash: intent.startKeyHash,
    acceptedAt: intent.acceptedAt,
    replayed,
    workflowRunId: null,
    dispatchedAt: null,
  });

  const settle = async (storePath: string, intent: StartIntent, outcome: StartOutcome, nowMs: number): Promise<void> => {
    settledHere.set(intent.wljRunId, { startKeyHash: intent.startKeyHash, outcome });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const done = await withStoreLock(storePath, () => {
          const read = readStartIntents(storePath);
          if (!read.ok) return true;
          const current = read.intents.find((item) => item.wljRunId === intent.wljRunId);
          if (current === undefined || current.startKeyHash !== intent.startKeyHash) return true;
          const settled: StartIntent = { ...current, state: 'settled', outcome, updatedAt: new Date(nowMs).toISOString() };
          writeIntents(storePath, read.intents.map((item) => (item.wljRunId === intent.wljRunId ? settled : item)));
          return true;
        });
        if (done) return;
      } catch {
        await new Promise((resolve) => { setTimeout(resolve, 100 * (attempt + 1)); });
      }
    }
  };

  /** Start the background claim. Called while holding the store lock, so the task is registered before anyone else looks. */
  const launch = (storePath: string, intent: StartIntent, source: LiveTask['source'], repo: string, lane: string, rerunConfirmation: string | null, nowMs: number): void => {
    const tool = deps.claimTool(storePath);
    deps.startsInFlight?.enter(intent.wljRunId);
    const task: LiveTask = { startKeyHash: intent.startKeyHash, source, promise: Promise.resolve() };
    const run = async (): Promise<void> => {
      let outcome: StartOutcome;
      try {
        const result: ClaimResult = await tool.claim({
          wonderlandRunId: intent.wljRunId,
          serverRunId: intent.serverRunId,
          repo,
          lane,
          workflowSource: '',
          dispatch: true,
          confirmation: OPERATOR_DISPATCH_CONFIRMATION,
          rerunConfirmation,
          start: { startKeyHash: intent.startKeyHash, clientTriggerId: intent.clientTriggerId },
        });
        const http = startHttp(intent.wljRunId, result);
        outcome = { httpStatus: http.status, body: http.body as Record<string, unknown> };
      } catch {
        outcome = { httpStatus: 503, body: { error: { kind: 'julius_start_unavailable', message: 'The claim could not run. Check /status before trying again.' } } };
      } finally {
        deps.startsInFlight?.leave(intent.wljRunId);
      }
      await settle(storePath, intent, outcome, Date.now() > nowMs ? Date.now() : nowMs);
    };
    task.promise = run()
      .catch(() => undefined)
      .finally(() => {
        if (tasks.get(intent.wljRunId) === task) tasks.delete(intent.wljRunId);
      });
    tasks.set(intent.wljRunId, task);
  };

  const settledFor = (intent: StartIntent): StartOutcome | null => {
    if (intent.outcome !== null) return intent.outcome;
    const here = settledHere.get(intent.wljRunId);
    return here !== undefined && here.startKeyHash === intent.startKeyHash ? here.outcome : null;
  };

  const resumable = (intent: StartIntent, journal: OperatorDocument | null, nowMs: number, env: Env): boolean => {
    if (!startResumeEnabled(env)) return false;
    if (intent.state !== 'accepted' || settledFor(intent) !== null) return false;
    if (tasks.has(intent.wljRunId)) return false;
    if (intent.rerunAcknowledged) return false;
    if (intent.resumeAttempts >= 1) return false;
    const age = nowMs - Date.parse(intent.acceptedAt);
    if (!(age >= 0 && age <= START_INTENT_WINDOW_MS)) return false;
    if (journal !== null) {
      if (claimsOf(journal, intent.wljRunId, intent.serverRunId).length > 0) return false;
      if (journal.claims.some((event) => event.startKeyHash === intent.startKeyHash)) return false;
    }
    return true;
  };

  const api: WonderlandStartRequests = {
    async accept(input) {
      const storePath = resolvedStore(input.storePath);
      if (storePath === null) return err(503, 'julius_start_unavailable', 'The Start could not be saved. Nothing was claimed or dispatched.');
      const keyHash = hashStartKey(input.startKey);
      const digest = startBodyDigest(OPERATOR_DISPATCH_CONFIRMATION, input.rerunConfirmation, input.clientTriggerId);
      const nowIso = new Date(input.nowMs).toISOString();
      type Decision =
        | { kind: 'replay' } | { kind: 'unavailable' } | { kind: 'key_reused' } | { kind: 'expired'; intent: StartIntent }
        | { kind: 'in_progress'; startKeyHash: string } | { kind: 'join' | 'rerun' | 'accepted'; intent: StartIntent }
        | { kind: 'settled'; outcome: StartOutcome };
      let decision: Decision;
      try {
        decision = await withStoreLock(storePath, (journal): Decision => {
          // R3 / R4: a claim in the journal is the answer. The claim core replays it; no intent is written.
          if (claimsOf(journal, input.wljRunId, input.serverRunId).length > 0) return { kind: 'replay' };
          const read = readStartIntents(storePath);
          if (!read.ok) return { kind: 'unavailable' };
          const current = read.intents.find((intent) => intent.wljRunId === input.wljRunId) ?? null;
          const live = tasks.get(input.wljRunId);
          if (current !== null && current.startKeyHash === keyHash) {
            if (current.bodyDigest !== digest || current.serverRunId !== input.serverRunId) return { kind: 'key_reused' };
            if (live !== undefined && live.startKeyHash === keyHash) return { kind: 'join', intent: current };
            const outcome = settledFor(current);
            if (outcome !== null) return { kind: 'settled', outcome };
            const age = input.nowMs - Date.parse(current.acceptedAt);
            if (!(age >= 0 && age <= START_INTENT_WINDOW_MS)) return { kind: 'expired', intent: current };
            if (live !== undefined) return { kind: 'in_progress', startKeyHash: live.startKeyHash };
            // The same request again, after this process lost its task (a restart): run the claim core again.
            launch(storePath, current, 'client_retry', input.repo, input.lane, input.rerunConfirmation, input.nowMs);
            return { kind: 'rerun', intent: current };
          }
          if (live !== undefined) return { kind: 'in_progress', startKeyHash: live.startKeyHash };
          const intent: StartIntent = {
            wljRunId: input.wljRunId,
            serverRunId: input.serverRunId,
            startKeyHash: keyHash,
            clientTriggerId: input.clientTriggerId,
            bodyDigest: digest,
            rerunAcknowledged: input.rerunConfirmation !== null,
            acceptedAt: nowIso,
            state: 'accepted',
            outcome: null,
            updatedAt: nowIso,
            resumeAttempts: 0,
            resumedAt: null,
            resumeRefused: null,
          };
          writeIntents(storePath, [...read.intents.filter((item) => item.wljRunId !== input.wljRunId), intent]);
          settledHere.delete(input.wljRunId);
          launch(storePath, intent, 'client', input.repo, input.lane, input.rerunConfirmation, input.nowMs);
          return { kind: 'accepted', intent };
        });
      } catch {
        return err(503, 'julius_start_unavailable', 'The Start could not be saved. Nothing was claimed or dispatched.');
      }
      switch (decision.kind) {
        case 'replay': return input.replay();
        case 'unavailable': return err(503, 'julius_start_unavailable', 'The saved Start requests could not be read. Nothing was claimed or dispatched.');
        case 'key_reused': return err(409, 'julius_start_key_reused', 'This idempotency key was used for a different Start body. Nothing was claimed or dispatched.');
        case 'in_progress': return err(409, 'julius_start_in_progress', 'A Start for this mission is still running. Poll /status; do not send a new key.', { startKeyHash: decision.startKeyHash });
        case 'expired':
          return err(409, 'julius_start_interrupted', 'This Start was interrupted before it claimed anything and is older than 10 minutes. Nothing was dispatched. Start again with a new key.', {
            startKeyHash: decision.intent.startKeyHash, acceptedAt: decision.intent.acceptedAt,
          });
        case 'settled': return { status: decision.outcome.httpStatus, body: { ...decision.outcome.body, replayed: true } };
        case 'join':
        case 'rerun': return { status: 202, body: ackBody(decision.intent, true) };
        case 'accepted': return { status: 202, body: ackBody(decision.intent, false) };
      }
    },

    view(rawStore, wlj, serverRunId, claim, nowMs, env) {
      const storePath = resolvedStore(rawStore);
      if (storePath === null || serverRunId === null) return { request: null, unreadable: false };
      const read = readStartIntents(storePath);
      if (!read.ok) return { request: null, unreadable: true };
      const intent = read.intents.find((item) => item.wljRunId === wlj && item.serverRunId === serverRunId);
      if (intent === undefined) return { request: null, unreadable: false };
      const outcome = settledFor(intent);
      const live = tasks.get(wlj);
      let state: StartRequestView['state'];
      let shown: StartOutcome | null = outcome;
      if (live !== undefined && live.startKeyHash === intent.startKeyHash) {
        state = 'claiming';
        shown = null;
      } else if (outcome !== null) {
        // R4: an outcome that says started, with no claim in the journal, is not shown as started.
        const said = typeof outcome.body.state === 'string' ? outcome.body.state : null;
        if (said !== null && STARTED.has(said) && claim === null) {
          state = 'interrupted';
          shown = null;
        } else {
          state = 'settled';
        }
      } else if (claim === null && resumable(intent, null, nowMs, env)) {
        state = 'accepted';
      } else {
        state = 'interrupted';
      }
      return {
        request: {
          state,
          startKeyHash: intent.startKeyHash,
          acceptedAt: intent.acceptedAt,
          outcome: shown,
          resumed: intent.resumeAttempts >= 1,
          resumedAt: intent.resumedAt,
          ...(intent.resumeRefused === null ? {} : { resumeRefused: intent.resumeRefused }),
        },
        unreadable: false,
      };
    },

    async resumePass(env, nowMs) {
      const none = (reason: StartResumePassResult['reason']): StartResumePassResult => ({ resumed: [], refused: [], reason });
      if (!startResumeEnabled(env)) return none('disabled');
      const repo = (env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
      const lane = (env.JULIUS_WONDERLAND_START_LANE ?? '').trim();
      const rawStore = deps.storePath?.() ?? (env.JULIUS_WONDERLAND_ADMISSION_STORE ?? '').trim();
      const storePath = resolvedStore(rawStore);
      if (!REPO.test(repo) || !(OPERATOR_LANES as readonly string[]).includes(lane) || storePath === null) return none('not_configured');
      const resumed: string[] = [];
      const refused: string[] = [];
      let reason: StartResumePassResult['reason'] = 'ran';
      try {
        await withStoreLock(storePath, (journal) => {
          const read = readStartIntents(storePath);
          if (!read.ok) { reason = 'unreadable'; return; }
          // The $60 ceiling: nothing resumes while any claim in the store may have reached GitHub unreconciled.
          if (unreconciledClaimInStore(journal)) { reason = 'unreconciled_claim_in_store'; return; }
          let intents = [...read.intents];
          for (const intent of read.intents) {
            if (!startResumeEnabled(env) || !resumable(intent, journal, nowMs, env)) continue;
            const at = new Date(nowMs).toISOString();
            const marked: StartIntent = { ...intent, resumeAttempts: 1, resumedAt: at, updatedAt: at };
            intents = intents.map((item) => (item.wljRunId === intent.wljRunId ? marked : item));
            // (1) The one attempt is spent, durably, before anything else.
            try {
              writeIntents(storePath, intents);
            } catch {
              refused.push(intent.startKeyHash);
              return;
            }
            // (2) The evidence line, fsync'd, before the claim core. A failure refuses this resume.
            try {
              appendLine(storePath, { wljRunId: intent.wljRunId, intentId: intent.startKeyHash, intentAgeMs: nowMs - Date.parse(intent.acceptedAt), at });
            } catch {
              refused.push(intent.startKeyHash);
              const noted: StartIntent = { ...marked, resumeRefused: 'resume_log_unwritable' };
              try { writeIntents(storePath, intents.map((item) => (item.wljRunId === intent.wljRunId ? noted : item))); } catch { /* the attempt stays spent */ }
              return;
            }
            // (3) The unchanged claim core, with the flags and authorization read now, never from the intent.
            launch(storePath, marked, 'resume', repo, lane, null, nowMs);
            resumed.push(intent.startKeyHash);
            return;
          }
        });
      } catch {
        return { resumed, refused, reason: 'unreadable' };
      }
      return { resumed, refused, reason };
    },

    startWorker(env, nowMs = () => Date.now()) {
      let running = false;
      const pass = () => {
        if (running) return;
        running = true;
        void api.resumePass(env(), nowMs()).catch(() => undefined).finally(() => { running = false; });
      };
      const boot = setImmediate(pass);
      const timer = setInterval(pass, START_RESUME_INTERVAL_MS);
      timer.unref?.();
      return () => { clearImmediate(boot); clearInterval(timer); };
    },

    async idle() {
      while (tasks.size > 0) await Promise.all([...tasks.values()].map((task) => task.promise));
    },

    live(wlj) {
      return tasks.get(wlj)?.startKeyHash ?? null;
    },
  };
  return api;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
