/**
 * SUNDAY RELAY — THE LOOP REDUCER, SNAPSHOT AND REPLAY.
 *
 * The journal is the authority. This is the only thing that reads it, and
 * `replayLoopJournal(events)` is a pure function: the same lines always produce
 * the same run, on any machine, in any process, at any time. A snapshot is a
 * cache of that answer and is never trusted over it — `loadLoopRun` always
 * returns what the journal reduces to, and reports which snapshot, if any, was
 * found to agree with it.
 *
 * THREE REFUSALS THAT KEEP REPLAY HONEST.
 *
 * A DUPLICATE event is rejected, not folded. A retried request, a re-delivered
 * bridge message and a double-clicked button all produce the same line twice;
 * folding it twice would double an iteration count or a spend total. Identity
 * is (kind, subject) — see `loopEventIdentity` — so the second copy is
 * recognisable even with a different eventId.
 *
 * An OUT-OF-ORDER or GAPPED sequence is rejected. Sequences are gap-free from
 * 1; a missing line means the journal is not the whole story, and reducing what
 * remains would produce a confident wrong answer.
 *
 * An ILLEGAL TRANSITION is rejected by the same table the runtime uses. The
 * journal cannot contain a move the state machine forbids, so a tampered or
 * corrupted line cannot walk a run into `completed`.
 *
 * UNKNOWN STAYS UNKNOWN. When an execution reports `costMicros: null`, the run
 * does not add zero — it marks `spendHasUnknownComponent` and leaves the known
 * total where it was. A Loop that cannot account for its spending says so.
 *
 * PURE. No clock, no I/O, no crypto: the digest function is injected, because
 * hashing belongs to the persistence layer and the browser must be able to
 * replay a run without importing Node's crypto.
 */

import type { RelayLoopBlocker } from '../loop-blockers';
import type { RelayLoopAssignment } from './loop-runtime-types';
import {
  REPEATABLE_LOOP_EVENT_KINDS,
  RELAY_LOOP_EVENT_STATE,
  loopEventIdentity,
  type RelayLoopEvent,
  type RelayLoopEventKind,
  type RelayLoopEventPayload,
} from './loop-runtime-events';
import { landingForLimit, transitionLoopRun } from './loop-runtime-state';
import {
  RELAY_LOOP_RUN_SCHEMA_VERSION,
  SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS,
  type RelayLoopIteration,
  type RelayLoopObservation,
  type RelayLoopRun,
  type RelayLoopRuntimeState,
} from './loop-runtime-types';

/* ---------------------------------------------------------------- seed */

/**
 * The state a run starts from before ANY event is folded.
 *
 * Deliberately not a valid run: it has no id and is in `draft`. Only
 * `loop.run_created` gives it identity, which means a journal whose first line
 * is anything else is detectably wrong rather than quietly half-initialised.
 */
export function seedLoopRun(input: {
  readonly runId: string;
  readonly loopId: string;
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly contractRef: string;
  readonly contractVersion: number;
  readonly contractBindingDigest: string;
  readonly budget: RelayLoopRun['budget'];
  readonly createdAt: string;
  readonly provenance: RelayLoopRun['provenance'];
}): RelayLoopRun {
  return {
    schemaVersion: RELAY_LOOP_RUN_SCHEMA_VERSION,
    runId: input.runId,
    loopId: input.loopId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    contractRef: input.contractRef,
    contractVersion: input.contractVersion,
    contractBindingDigest: input.contractBindingDigest,
    state: 'draft',
    assignment: null,
    iterations: [],
    currentIterationId: null,
    budget: input.budget,
    blockers: [],
    failures: [],
    lastCheckpoint: null,
    interruptionReason: null,
    owner: null,
    recoveryGeneration: 0,
    createdBy: '',
    creationSource: 'api',
    idempotencyKey: '',
    provenance: input.provenance,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/* ------------------------------------------------------------- helpers */

const addKnown = (total: string | null, delta: string | null | undefined): string | null => {
  // Unknown propagates. `null + anything` is still unknown, and a known total
  // plus an unknown delta is no longer a total anybody can stand behind.
  if (total === null || !isKnownAmount(delta)) return null;
  return (BigInt(total) + BigInt(delta)).toString();
};

/**
 * Is this a usable number?
 *
 * `undefined` matters as much as `null` here. A journal payload can lose a
 * field — redaction drops credential-shaped keys, and a torn or foreign line
 * can simply lack one — and the arithmetic that follows must not turn a missing
 * value into `NaN`. A `NaN` total is worse than an unknown one: it is a number,
 * so it compares, it serializes, and it silently defeats every limit check it
 * touches. Anything that is not a finite number is UNKNOWN.
 */
function isKnownCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isKnownAmount(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/** Add a count, propagating Unknown rather than inventing a total. */
function addCount(total: number | null, delta: number | null | undefined): number | null {
  if (total === null || !isKnownCount(delta)) return null;
  return total + delta;
}

function replaceIteration(
  iterations: readonly RelayLoopIteration[],
  iterationId: string,
  update: (iteration: RelayLoopIteration) => RelayLoopIteration,
): readonly RelayLoopIteration[] {
  return iterations.map((it) => (it.iterationId === iterationId ? update(it) : it));
}

const findIteration = (run: RelayLoopRun, id: string): RelayLoopIteration | undefined =>
  run.iterations.find((it) => it.iterationId === id);

/* ------------------------------------------------------------- reducer */

export interface LoopApplyResult {
  readonly ok: boolean;
  readonly run: RelayLoopRun;
  /** Why the event was refused. `null` when it was applied. */
  readonly problem: string | null;
}

/**
 * STRUCTURAL PRECONDITIONS — truths about the payload that hold regardless of
 * what state the run is in.
 *
 * These are checked BEFORE the transition table, and the order is the whole
 * point. A journal line that starts an iteration for a run with no assigned
 * agent is impossible for a specific reason, and an operator needs that reason.
 * Checking the transition first would report the same line as "cannot move from
 * queued to running" — true, derived, and useless for working out what is
 * actually wrong with the record.
 */
function checkLoopPrecondition(
  run: RelayLoopRun,
  payload: RelayLoopEventPayload,
): string | null {
  const needsIteration = (id: string, verb: string): string | null =>
    findIteration(run, id) === undefined ? `No iteration ${id} to ${verb}.` : null;

  switch (payload.kind) {
    case 'loop.iteration_started': {
      if (run.assignment === null) {
        return 'An iteration cannot start before an agent has been assigned.';
      }
      const expected = run.iterations.length + 1;
      if (payload.ordinal !== expected) {
        return `Iteration ordinals are gap-free and 1-based: expected ${expected}, received ${payload.ordinal}.`;
      }
      return null;
    }
    case 'loop.agent_request_prepared':
      return needsIteration(payload.iterationId, 'prepare a request for');
    case 'loop.agent_identity_observed':
      return needsIteration(payload.iterationId, 'record an observed identity for');
    case 'loop.agent_execution_started': {
      const missing = needsIteration(payload.iterationId, 'execute');
      if (missing !== null) return missing;
      const iteration = findIteration(run, payload.iterationId);
      if (iteration !== undefined && iteration.execution !== null) {
        return `Iteration ${payload.iterationId} already has an execution — a second dispatch would duplicate work.`;
      }
      return null;
    }
    case 'loop.output_observed':
      return needsIteration(payload.observation.iterationId, 'observe');
    case 'loop.evidence_recorded':
      return needsIteration(payload.iterationId, 'record evidence for');
    case 'loop.completion_evaluated':
      return needsIteration(payload.iterationId, 'evaluate completion for');
    case 'loop.iteration_finished':
      return needsIteration(payload.execution.iterationId, 'finish');
    default:
      return null;
  }
}

/**
 * Fold ONE event into a run.
 *
 * Returns the unchanged run plus a problem rather than throwing, because a
 * corrupt journal line is data to report, not an exception to unwind through.
 */
export function applyLoopEvent(run: RelayLoopRun, event: RelayLoopEvent): LoopApplyResult {
  const refuse = (problem: string): LoopApplyResult => ({ ok: false, run, problem });
  const payload = event.payload;

  /* --- the writer's picture of the world must still be the current one --- */

  // A stale worker is the reason pause/resume needs a generation at all: it
  // wakes up holding an old one and writes an event describing work the run has
  // already moved past. Folding it would duplicate an iteration.
  if (event.recoveryGeneration < run.recoveryGeneration) {
    return refuse(
      `This event was written at recovery generation ${event.recoveryGeneration} but the run has reached `
      + `${run.recoveryGeneration}. It comes from a worker that no longer owns this run, so it was not folded.`,
    );
  }
  if (event.expectedPreviousState !== null && event.expectedPreviousState !== run.state) {
    return refuse(
      `This event was written believing the run was ${event.expectedPreviousState}, but it is ${run.state}. `
      + 'Whatever it concluded was concluded from facts that had already changed.',
    );
  }

  /* --- structural preconditions, before any state is moved --- */
  const precondition = checkLoopPrecondition(run, payload);
  if (precondition !== null) return refuse(precondition);

  /* --- state consequence, checked against the one transition table --- */
  let nextState: RelayLoopRuntimeState | null = RELAY_LOOP_EVENT_STATE[event.kind];
  if (event.kind === 'loop.limit_reached' && payload.kind === 'loop.limit_reached') {
    nextState = landingForLimit(payload.limit);
  }
  let state = run.state;
  if (nextState !== null && nextState !== run.state) {
    const moved = transitionLoopRun(run.state, nextState);
    if (!moved.ok) return refuse(moved.reason);
    state = moved.state;
  }

  let next: RelayLoopRun = { ...run, state, updatedAt: event.at };

  switch (payload.kind) {
    case 'loop.contract_confirmed':
      next = {
        ...next,
        contractRef: payload.contractRef,
        contractVersion: payload.contractVersion,
        contractBindingDigest: payload.bindingDigest,
      };
      break;

    case 'loop.run_created':
      next = {
        ...next,
        idempotencyKey: payload.idempotencyKey,
        creationSource: payload.creationSource,
        createdBy: payload.createdBy,
      };
      break;

    case 'loop.run_claimed':
      next = {
        ...next,
        owner: { sessionId: payload.sessionId, claimedAt: event.at, expiresAt: payload.expiresAt },
        recoveryGeneration: payload.recoveryGeneration,
      };
      break;

    case 'loop.agent_assigned':
      next = { ...next, assignment: payload.assignment };
      break;

    case 'loop.iteration_started': {
      // The assignment and the ordinal were proved by `checkLoopPrecondition`.
      const assignment = next.assignment as NonNullable<RelayLoopRun['assignment']>;
      const iteration: RelayLoopIteration = {
        iterationId: payload.iterationId,
        ordinal: payload.ordinal,
        startedAt: event.at,
        finishedAt: null,
        state: 'running',
        assignment,
        execution: null,
        observations: [],
        decision: null,
        inputRefs: [],
        outputRefs: [],
      };
      next = {
        ...next,
        iterations: [...next.iterations, iteration],
        currentIterationId: payload.iterationId,
        budget: {
          ...next.budget,
          iterationsStarted: next.budget.iterationsStarted + 1,
          startedAt: next.budget.startedAt ?? event.at,
        },
      };
      break;
    }

    case 'loop.agent_request_prepared':
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, payload.iterationId, (it) => ({
          ...it,
          inputRefs: [...it.inputRefs, ...payload.inputRefs],
        })),
      };
      break;

    case 'loop.agent_execution_started': {
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, payload.iterationId, (it) => ({
          ...it,
          execution: {
            executionId: payload.executionId,
            iterationId: payload.iterationId,
            startedAt: event.at,
            finishedAt: null,
            // In flight. `unknown` is the truthful outcome until it finishes —
            // and it is exactly what forces inspection if the process dies now.
            outcome: 'unknown',
            usage: { costMicros: null, currency: null, modelUnits: null, providerCalls: null },
            failureSummary: null,
          },
        })),
      };
      break;
    }

    case 'loop.agent_identity_observed': {
      // ONLY ever fills from what was observed. A `null` in the payload means
      // the adapter could not say, and leaves the field as it was — it never
      // overwrites something already observed, and it never reaches across to
      // the requested side for a value.
      const fill = (existing: string | null, seen: string | null): string | null => seen ?? existing;
      const observed = (a: RelayLoopAssignment): RelayLoopAssignment => ({
        ...a,
        actualAdapterId: fill(a.actualAdapterId, payload.actualAdapterId),
        actualAgentId: fill(a.actualAgentId, payload.actualAgentId),
        actualModel: fill(a.actualModel, payload.actualModel),
      });
      next = {
        ...next,
        assignment: next.assignment === null ? null : observed(next.assignment),
        iterations: replaceIteration(next.iterations, payload.iterationId, (it) => ({
          ...it,
          assignment: observed(it.assignment),
        })),
      };
      break;
    }

    case 'loop.timed_out':
      next = { ...next, interruptionReason: payload.detail, currentIterationId: null };
      break;

    case 'loop.output_observed': {
      const observation: RelayLoopObservation = payload.observation;
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, observation.iterationId, (it) => ({
          ...it,
          state: 'observed',
          observations: [...it.observations, observation],
          outputRefs: [...it.outputRefs, ...observation.evidenceRefs],
        })),
      };
      break;
    }

    case 'loop.evidence_recorded':
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, payload.iterationId, (it) => ({
          ...it,
          outputRefs: [...it.outputRefs, ...payload.evidenceRefs],
        })),
      };
      break;

    case 'loop.completion_claim_recorded':
      // A claim is RECORDED, never acted on. It moves no state and satisfies
      // nothing; `loop.completion_evaluated` is what decides.
      break;

    case 'loop.completion_evaluated':
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, payload.iterationId, (it) => ({
          ...it,
          state: 'decided',
        })),
      };
      break;

    case 'loop.iteration_finished': {
      const exec = payload.execution;
      const failed = exec.outcome !== 'completed';
      const usage = exec.usage;
      next = {
        ...next,
        iterations: replaceIteration(next.iterations, exec.iterationId, (it) => ({
          ...it,
          finishedAt: event.at,
          state: exec.outcome === 'completed' ? 'completed' : exec.outcome === 'unknown' ? 'unknown' : 'failed',
          execution: exec,
        })),
        currentIterationId: null,
        budget: {
          ...next.budget,
          iterationsCompleted: next.budget.iterationsCompleted + (exec.outcome === 'completed' ? 1 : 0),
          knownSpendMicros: addKnown(next.budget.knownSpendMicros, usage.costMicros ?? null),
          spendHasUnknownComponent:
            next.budget.spendHasUnknownComponent || !isKnownAmount(usage.costMicros),
          currency: next.budget.currency ?? usage.currency ?? null,
          tokensUsed: addCount(next.budget.tokensUsed, usage.modelUnits),
          tokensHaveUnknownComponent:
            next.budget.tokensHaveUnknownComponent || !isKnownCount(usage.modelUnits),
          providerCallsUsed:
            next.budget.providerCallsUsed + (isKnownCount(usage.providerCalls) ? usage.providerCalls : 0),
          consecutiveFailures: failed ? next.budget.consecutiveFailures + 1 : 0,
        },
      };
      break;
    }

    case 'loop.next_iteration_scheduled':
      next = {
        ...next,
        iterations:
          payload.decision.iterationId === null
            ? next.iterations
            : replaceIteration(next.iterations, payload.decision.iterationId, (it) => ({
                ...it,
                decision: payload.decision,
              })),
      };
      break;

    case 'loop.safe_checkpoint_reached':
      next = {
        ...next,
        lastCheckpoint: { reason: payload.reason, at: event.at, iterationId: payload.iterationId },
      };
      break;

    case 'loop.pause_requested':
    case 'loop.paused':
    case 'loop.resume_requested':
      break;

    case 'loop.resumed':
      next = { ...next, recoveryGeneration: payload.recoveryGeneration, interruptionReason: null };
      break;

    case 'loop.stop_requested':
      next = { ...next, interruptionReason: payload.reason };
      break;

    case 'loop.stopped':
      next = { ...next, interruptionReason: payload.reason, currentIterationId: null };
      break;

    case 'loop.limit_reached':
      next = { ...next, interruptionReason: payload.detail, currentIterationId: null };
      break;

    case 'loop.blocked':
      next = { ...next, blockers: payload.blockers as readonly RelayLoopBlocker[] };
      break;

    case 'loop.failed':
      next = {
        ...next,
        failures: [...next.failures, payload.failure],
        interruptionReason: payload.failure.summary,
        currentIterationId: null,
      };
      break;

    case 'loop.recovery_required':
      next = { ...next, interruptionReason: payload.reason };
      break;

    case 'loop.completed':
      next = { ...next, currentIterationId: null, blockers: [] };
      break;
  }

  return { ok: true, run: next, problem: null };
}

/* -------------------------------------------------------------- replay */

export interface LoopReplayResult {
  /** `null` when the journal could not be reduced at all. */
  readonly run: RelayLoopRun | null;
  readonly problems: readonly string[];
  /** Events accepted. Fewer than the input length means some were refused. */
  readonly applied: number;
  readonly lastSequence: number;
}

/**
 * Replay a whole journal.
 *
 * Stops at the FIRST problem rather than skipping past it. A journal with a bad
 * line in the middle is not a journal missing one fact — it is a journal whose
 * remainder describes a run that never existed, and continuing would
 * manufacture exactly the confident wrong answer this system exists to avoid.
 */
export function replayLoopJournal(
  seed: RelayLoopRun,
  events: readonly RelayLoopEvent[],
): LoopReplayResult {
  const problems: string[] = [];
  const seen = new Set<string>();
  let run = seed;
  let applied = 0;
  let lastSequence = 0;

  for (const event of events) {
    if (event.sequence !== lastSequence + 1) {
      problems.push(
        `Journal sequence is gap-free from 1: expected ${lastSequence + 1}, found ${event.sequence}.`,
      );
      break;
    }
    const identity = loopEventIdentity(event);
    const repeatable = REPEATABLE_LOOP_EVENT_KINDS.includes(event.kind as RelayLoopEventKind);
    if (seen.has(identity)) {
      problems.push(
        `Duplicate event ${identity} at sequence ${event.sequence} — the same fact recorded twice.`,
      );
      break;
    }
    if (!repeatable && seen.has(event.kind)) {
      problems.push(`Event ${event.kind} may occur only once per run (sequence ${event.sequence}).`);
      break;
    }
    seen.add(identity);

    const result = applyLoopEvent(run, event);
    if (!result.ok) {
      problems.push(`Sequence ${event.sequence} (${event.kind}): ${result.problem ?? 'refused'}`);
      break;
    }
    run = result.run;
    applied += 1;
    lastSequence = event.sequence;
  }

  // A run that accepted nothing is not a partially-known run — it is the seed,
  // which has no identity. Reporting it as a run would be reporting a fiction.
  return { run: applied === 0 && problems.length > 0 ? null : run, problems, applied, lastSequence };
}

/* ------------------------------------------------------------ snapshot */

export interface RelayLoopSnapshot {
  readonly schemaVersion: string;
  readonly runId: string;
  /** The sequence this snapshot reflects. Replay from here needs only later
   *  events — the snapshot is an optimisation, never an authority. */
  readonly lastEventSequence: number;
  readonly run: RelayLoopRun;
  /** Digest of `run`. A snapshot whose digest does not verify is discarded and
   *  the journal is replayed in full. */
  readonly stateDigest: string;
}

export type LoopDigestFn = (value: unknown) => string;

export function loopSnapshotFrom(
  run: RelayLoopRun,
  lastEventSequence: number,
  digest: LoopDigestFn,
): RelayLoopSnapshot {
  return {
    schemaVersion: RELAY_LOOP_RUN_SCHEMA_VERSION,
    runId: run.runId,
    lastEventSequence,
    run,
    stateDigest: digest(run),
  };
}

/**
 * What the READER made of the raw journal file before any of it was reduced.
 *
 * The same three verdicts the Node journal reader already produces, restated
 * here because this layer must act on them and may not import the reader:
 *
 *   `truncated_tail` — the process died mid-append. Every complete line before
 *   the tear is valid, so the run reduces truthfully up to that point and the
 *   MISSING part is reported rather than papered over.
 *
 *   `corrupt` — a line that is not the last one is unreadable. That is not a
 *   run with a gap; it is a file that no longer describes any run, and no
 *   snapshot may stand in for it.
 */
export type LoopJournalIntegrity = 'ok' | 'truncated_tail' | 'corrupt';

/**
 * WHICH SOURCE ANSWERED, in the order they are tried.
 *
 * `current` → `previous` → `replay_only` → `recovery_required`. The last one is
 * not a source at all: it is the admission that none of the three could produce
 * an answer worth standing behind.
 */
export type LoopSnapshotSource = 'current' | 'previous' | 'replay_only' | 'recovery_required';

export interface LoopLoadResult {
  readonly run: RelayLoopRun | null;
  readonly source: LoopSnapshotSource;
  readonly problems: readonly string[];
  /** True when nothing here may be acted on without a human looking first. */
  readonly recoveryRequired: boolean;
  readonly journalIntegrity: LoopJournalIntegrity;
  readonly lastSequence: number;
}

/** Why a snapshot could not be used, or `null` when it can. */
function loopSnapshotProblem(
  snapshot: RelayLoopSnapshot,
  journalRun: RelayLoopRun,
  digest: LoopDigestFn,
): string | null {
  if (!(SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS as readonly string[]).includes(snapshot.schemaVersion)) {
    return `it was written by a build using schema ${snapshot.schemaVersion}, which this one cannot read`;
  }
  if (snapshot.runId !== journalRun.runId) {
    return `it belongs to run ${snapshot.runId}, not ${journalRun.runId}`;
  }
  if (digest(snapshot.run) !== snapshot.stateDigest) {
    return 'it failed its own digest';
  }
  if (digest(snapshot.run) !== digest(journalRun)) {
    return 'it disagrees with the journal';
  }
  return null;
}

/**
 * Load a run: current snapshot → previous snapshot → full replay → recovery.
 *
 * THE JOURNAL ALWAYS PRODUCES THE ANSWER. That is worth being blunt about,
 * because it is the opposite of what a cache usually does. A snapshot here is
 * CORROBORATION, not a shortcut: the run that comes back is always the one the
 * journal reduces to, and `source` reports only which snapshot was found to
 * agree with it. Stage 2 is offline with bounded journals, so the cost of
 * always replaying is small — and the alternative, returning a snapshot's run
 * without reading the journal, means a stale-but-well-formed cache can hand
 * back a run that finished differently. That trade is not worth making, and
 * pretending a snapshot was verified when it was merely trusted is worse.
 *
 * The previous snapshot exists for one specific event: a crash DURING the
 * snapshot write. The current file is then torn while the previous one is
 * intact, which is exactly why the writer rotates rather than overwrites.
 */
export function loadLoopRun(input: {
  readonly seed: RelayLoopRun;
  readonly events: readonly RelayLoopEvent[];
  /** The newest snapshot. */
  readonly snapshot: RelayLoopSnapshot | null;
  /** The last known-good snapshot, kept because the newest one can be torn. */
  readonly previousSnapshot?: RelayLoopSnapshot | null;
  readonly digest: LoopDigestFn;
  /** The reader's verdict on the raw file. Defaults to `ok`. */
  readonly journalIntegrity?: LoopJournalIntegrity;
}): LoopLoadResult {
  const journalIntegrity = input.journalIntegrity ?? 'ok';
  const problems: string[] = [];

  // A corrupt journal is not repaired by a snapshot that happens to verify. The
  // snapshot is a cache of a file that can no longer be read, so what it caches
  // cannot be confirmed — and an unconfirmable run is a recovery case.
  if (journalIntegrity === 'corrupt') {
    return {
      run: null,
      source: 'recovery_required',
      problems: [
        'The journal did not read cleanly, so this run cannot be reconstructed. No snapshot was used in its place, '
        + 'because a snapshot only ever caches a journal that can be read.',
      ],
      recoveryRequired: true,
      journalIntegrity,
      lastSequence: 0,
    };
  }

  if (journalIntegrity === 'truncated_tail') {
    problems.push(
      'The journal ends in a torn write. Everything before the tear is intact and was replayed; whatever the '
      + 'unfinished line was about is not known.',
    );
  }

  const full = replayLoopJournal(input.seed, input.events);
  if (full.problems.length > 0 || full.run === null) {
    return {
      run: full.run,
      source: 'recovery_required',
      problems: [...problems, ...full.problems],
      recoveryRequired: true,
      journalIntegrity,
      lastSequence: full.lastSequence,
    };
  }

  const journalRun = full.run;
  const candidates: readonly (readonly [RelayLoopSnapshot | null, 'current' | 'previous'])[] = [
    [input.snapshot, 'current'],
    [input.previousSnapshot ?? null, 'previous'],
  ];

  for (const [candidate, label] of candidates) {
    if (candidate === null) continue;
    const problem = loopSnapshotProblem(candidate, journalRun, input.digest);
    if (problem === null) {
      return {
        run: journalRun,
        source: label,
        problems,
        recoveryRequired: false,
        journalIntegrity,
        lastSequence: full.lastSequence,
      };
    }
    problems.push(`The ${label} snapshot was discarded because ${problem}; the journal was replayed in full.`);
  }

  return {
    run: journalRun,
    source: 'replay_only',
    problems,
    recoveryRequired: false,
    journalIntegrity,
    lastSequence: full.lastSequence,
  };
}
