/**
 * SUNDAY RELAY — THE LOOP JOURNAL EVENT VOCABULARY.
 *
 * WHY A SEPARATE VOCABULARY, AND WHY THAT IS NOT A SECOND RUNTIME.
 *
 * Relay already has a durable journal: append-only NDJSON, gap-free sequences,
 * per-event checksums, digests of the reduced state before and after, sanitized
 * payloads, truncated-tail detection. Stage 2 uses ALL of it — the same file
 * format, the same integrity rules, the same atomic append, the same lock, the
 * same state root. What it does not use is the supervised MISSION reducer.
 *
 * `PERSISTED_EVENT_KINDS` and `RunLifecycleState` describe one specific
 * workflow: implementer reports, reviewer findings, repairs, re-reviews. A Loop
 * run has iterations, observations and limits. Folding Loop events into that
 * reducer would mean adding Loop fields to the supervised snapshot and Loop
 * cases to a reducer that four thousand tests depend on — coupling two
 * lifecycles that fail for unrelated reasons. So the FORMAT is shared and the
 * VOCABULARY is the Loop's own. One journal model, two reducers, no second set
 * of durability guarantees.
 *
 * PAYLOADS CARRY REFERENCES, NOT CONTENT. No prompt, no transcript, no raw
 * adapter output, no credential, no environment value. Evidence is referenced
 * by id so a journal line stays small enough to append at every boundary.
 *
 * PURE. The Node writer lives in `src/relay/persistence/`.
 */

import type { RelayLoopBlocker } from '../loop-blockers';
import { sanitizeLoopPayload } from './loop-runtime-redaction';
import type {
  RelayLoopAgentExecution,
  RelayLoopAssignment,
  RelayLoopCheckpointReason,
  RelayLoopDecision,
  RelayLoopObservation,
  RelayLoopRuntimeFailure,
  RelayLoopRuntimeState,
} from './loop-runtime-types';

/* ------------------------------------------------------------ versioning */

/**
 * The journal line's own schema version, separate from the run record's.
 *
 * They version independently because they change for different reasons: a new
 * event kind does not alter the shape of a reduced run, and a new run field
 * does not alter the lines already on disk. A reader that finds a version it
 * does not know REFUSES the line rather than guessing at it.
 */
export const RELAY_LOOP_EVENT_SCHEMA_V1 = 'relay-loop-event.v1' as const;
export const RELAY_LOOP_EVENT_SCHEMA_VERSION = RELAY_LOOP_EVENT_SCHEMA_V1;
export const SUPPORTED_LOOP_EVENT_SCHEMA_VERSIONS = [RELAY_LOOP_EVENT_SCHEMA_V1] as const;

/* --------------------------------------------------------------- kinds */

/**
 * Every durable boundary in a Loop run's life.
 *
 * The list is closed and ordered by when it happens. An action with no kind
 * here is an action the journal cannot record, which is the point: a runtime
 * cannot quietly do something the audit trail has no word for.
 */
export const RELAY_LOOP_EVENT_KINDS = [
  'loop.contract_confirmed',
  'loop.run_created',
  'loop.run_claimed',
  'loop.agent_assigned',
  'loop.iteration_started',
  'loop.agent_request_prepared',
  'loop.agent_execution_started',
  // The moment Relay learns WHO actually answered. Separate from the
  // assignment because the assignment is what was requested and this is what
  // was observed, and a run that cannot tell them apart cannot answer "which
  // model actually did this" after the fact.
  'loop.agent_identity_observed',
  'loop.output_observed',
  'loop.evidence_recorded',
  'loop.completion_claim_recorded',
  'loop.completion_evaluated',
  'loop.iteration_finished',
  'loop.next_iteration_scheduled',
  'loop.pause_requested',
  'loop.safe_checkpoint_reached',
  'loop.paused',
  'loop.resume_requested',
  'loop.resumed',
  'loop.stop_requested',
  'loop.stopped',
  'loop.limit_reached',
  'loop.blocked',
  'loop.failed',
  // A run-level wall-clock bound elapsed. Distinct from `loop.limit_reached`
  // with `duration`: that is a BUDGET the user set for total run time, this is
  // an iteration that overran its own bound. Both end the run; neither is
  // completion; and a user fixes them differently.
  'loop.timed_out',
  'loop.recovery_required',
  'loop.completed',
] as const;
export type RelayLoopEventKind = (typeof RELAY_LOOP_EVENT_KINDS)[number];

/* -------------------------------------------------------------- event */

/**
 * One journal line.
 *
 * Field-for-field the same discipline as `PersistedEvent`: monotonic gap-free
 * `sequence` starting at 1, digests of the reduced state either side, and a
 * checksum over everything. The checksum is computed by the persistence
 * adapter, which owns the hashing primitive; this layer declares the shape.
 */
export interface RelayLoopEvent {
  readonly schemaVersion: string;
  readonly eventId: string;
  /** Monotonic, gap-free, starting at 1 per run. */
  readonly sequence: number;
  readonly at: string;
  readonly runId: string;
  readonly loopId: string;
  readonly projectId: string;
  readonly kind: RelayLoopEventKind;
  /** A safe identity label — an adapter or Relay identity, never an account. */
  readonly actor: string;
  /**
   * The recovery generation the WRITER believed it held.
   *
   * A worker that was paused, lost its lease and woke up still holding
   * generation 3 will write generation 3 into a run that has since resumed at
   * 4. The reducer refuses that line. Without this field the stale worker's
   * event is indistinguishable from a current one, and the iteration it
   * describes gets counted twice — which is exactly the duplicate that
   * pause/resume is supposed to make impossible.
   */
  readonly recoveryGeneration: number;
  /**
   * The state the writer believed the run was in.
   *
   * `null` means the event asserts nothing about the prior state. Any other
   * value is checked against the reduced run and a mismatch is refused: it
   * means the writer decided on a picture of the world that had already moved,
   * so whatever it concluded was concluded from stale facts.
   */
  readonly expectedPreviousState: RelayLoopRuntimeState | null;
  /**
   * Request-level identity, for the events that answer a REQUEST — creating a
   * run, pausing, resuming, stopping. `null` for events that record something
   * the runtime observed rather than something it was asked to do.
   *
   * This is the half of idempotency that lives above the journal: two HTTP
   * retries of one pause carry one key, so the second is recognisable before
   * anything is appended. `loopEventIdentity` is the half below.
   */
  readonly idempotencyKey: string | null;
  /** Digest of the reduced state BEFORE this event. */
  readonly previousStateDigest: string;
  /** Digest of the reduced state AFTER this event. */
  readonly resultingStateDigest: string;
  readonly payload: RelayLoopEventPayload;
  /** sha-256 over the deterministic serialization of every field above. */
  readonly checksum: string;
}

export type RelayLoopEventInput = Omit<
  RelayLoopEvent,
  'schemaVersion' | 'eventId' | 'sequence' | 'previousStateDigest' | 'resultingStateDigest' | 'checksum'
>;

/**
 * The kinds that answer a request and therefore MUST carry an idempotency key.
 *
 * Everything else records an observation, which has no requester to deduplicate
 * against. A builder that omits a key on one of these refuses rather than
 * inventing one — an invented key deduplicates nothing.
 */
export const LOOP_EVENT_KINDS_REQUIRING_IDEMPOTENCY: readonly RelayLoopEventKind[] = [
  'loop.run_created',
  'loop.pause_requested',
  'loop.resume_requested',
  'loop.stop_requested',
];

/* ------------------------------------------------------------ payloads */

/**
 * Payloads, discriminated by kind.
 *
 * Typed rather than `Record<string, unknown>` so the reducer cannot read a
 * field the writer never wrote — the failure mode of an untyped journal is a
 * reducer that silently folds `undefined` into state and produces a digest
 * nobody can reproduce.
 */
export type RelayLoopEventPayload =
  | { readonly kind: 'loop.contract_confirmed'; readonly contractRef: string; readonly contractVersion: number; readonly bindingDigest: string; readonly confirmedBy: string }
  | {
    readonly kind: 'loop.run_created';
    readonly idempotencyKey: string;
    readonly creationSource: 'cli' | 'website' | 'api' | 'schedule';
    /** The schedule that produced this run, when one did. Absent on a journal
     *  written before the field existed, which reduces to `null`. */
    readonly scheduleId?: string | null;
    readonly createdBy: string;
  }
  | { readonly kind: 'loop.run_claimed'; readonly sessionId: string; readonly expiresAt: string; readonly recoveryGeneration: number }
  | { readonly kind: 'loop.agent_assigned'; readonly assignment: RelayLoopAssignment }
  | { readonly kind: 'loop.iteration_started'; readonly iterationId: string; readonly ordinal: number }
  | { readonly kind: 'loop.agent_request_prepared'; readonly iterationId: string; readonly inputRefs: readonly string[] }
  | { readonly kind: 'loop.agent_execution_started'; readonly iterationId: string; readonly executionId: string }
  // Every field is nullable and `null` means UNKNOWN. The reducer never fills
  // one of these from the requested side.
  | {
      readonly kind: 'loop.agent_identity_observed';
      readonly iterationId: string;
      readonly actualAdapterId: string | null;
      readonly actualAgentId: string | null;
      readonly actualModel: string | null;
    }
  | { readonly kind: 'loop.output_observed'; readonly observation: RelayLoopObservation }
  | { readonly kind: 'loop.evidence_recorded'; readonly iterationId: string; readonly evidenceRefs: readonly string[] }
  | { readonly kind: 'loop.completion_claim_recorded'; readonly iterationId: string; readonly observationId: string }
  | { readonly kind: 'loop.completion_evaluated'; readonly iterationId: string; readonly verdict: 'verified_complete' | 'claimed_complete' | 'incomplete'; readonly reasons: readonly string[] }
  | { readonly kind: 'loop.iteration_finished'; readonly iterationId: string; readonly execution: RelayLoopAgentExecution }
  | { readonly kind: 'loop.next_iteration_scheduled'; readonly decision: RelayLoopDecision }
  | { readonly kind: 'loop.pause_requested'; readonly requestedBy: string; readonly requestId: string }
  | { readonly kind: 'loop.safe_checkpoint_reached'; readonly reason: RelayLoopCheckpointReason; readonly iterationId: string | null }
  // `requestId` names the pause request this landing completes. Without it a
  // second pause is indistinguishable from a redelivery of the first, and a run
  // silently becomes pausable once.
  | { readonly kind: 'loop.paused'; readonly at: string; readonly requestId: string }
  | { readonly kind: 'loop.resume_requested'; readonly requestedBy: string; readonly requestId: string }
  | { readonly kind: 'loop.resumed'; readonly recoveryGeneration: number }
  | { readonly kind: 'loop.stop_requested'; readonly requestedBy: string; readonly requestId: string; readonly reason: string }
  | { readonly kind: 'loop.stopped'; readonly reason: string }
  | { readonly kind: 'loop.limit_reached'; readonly limit: 'iterations' | 'duration' | 'spend' | 'tokens' | 'provider_calls'; readonly detail: string }
  | { readonly kind: 'loop.blocked'; readonly blockers: readonly RelayLoopBlocker[] }
  | { readonly kind: 'loop.failed'; readonly failure: RelayLoopRuntimeFailure }
  | { readonly kind: 'loop.timed_out'; readonly detail: string; readonly iterationId: string | null }
  | { readonly kind: 'loop.recovery_required'; readonly reason: string; readonly uncertainIterationId: string | null }
  | { readonly kind: 'loop.completed'; readonly verdict: 'verified_complete'; readonly evidenceRefs: readonly string[] };

/* -------------------------------------------------- state consequences */

/**
 * The state each event drives the run to, when it drives one at all.
 *
 * `null` means the event RECORDS something without moving the run — observing
 * output does not by itself change what the run is doing. Keeping this as a
 * table rather than scattering assignments through the reducer is what lets a
 * test prove that no event kind can reach `completed` except
 * `loop.completed`.
 */
export const RELAY_LOOP_EVENT_STATE: Readonly<
  Record<RelayLoopEventKind, RelayLoopRuntimeState | null>
> = Object.freeze({
  // Confirmation ARRIVED; the server now validates what it was handed. The
  // run is not admitted until `loop.run_created`, so a contract that fails
  // validation never reaches a queue.
  'loop.contract_confirmed': 'validating',
  'loop.run_created': 'queued',
  'loop.run_claimed': null,
  'loop.agent_assigned': 'starting',
  'loop.iteration_started': 'running',
  'loop.agent_request_prepared': null,
  'loop.agent_execution_started': null,
  'loop.agent_identity_observed': null,
  'loop.output_observed': 'observing',
  'loop.evidence_recorded': null,
  'loop.completion_claim_recorded': null,
  'loop.completion_evaluated': 'completion_check',
  'loop.iteration_finished': null,
  'loop.next_iteration_scheduled': 'running',
  'loop.pause_requested': 'pausing',
  'loop.safe_checkpoint_reached': null,
  'loop.paused': 'paused',
  'loop.resume_requested': 'resuming',
  'loop.resumed': 'running',
  'loop.stop_requested': 'stopping',
  'loop.stopped': 'stopped',
  // A limit landing depends on WHICH limit, so the reducer reads the payload.
  'loop.limit_reached': null,
  'loop.blocked': null,
  'loop.failed': 'failed',
  'loop.timed_out': 'timed_out',
  'loop.recovery_required': 'recovery_required',
  'loop.completed': 'completed',
});

/**
 * Events that may legitimately repeat within one run.
 *
 * Everything else is once-per-(run, subject): appending a second
 * `loop.run_created` or a second `loop.iteration_started` for the same
 * iteration is a duplicate delivery, not a new fact, and the reducer rejects
 * it. This is the journal-level half of idempotency; the request-level half is
 * the idempotency key.
 */
export const REPEATABLE_LOOP_EVENT_KINDS: readonly RelayLoopEventKind[] = [
  'loop.iteration_started',
  'loop.agent_request_prepared',
  'loop.agent_execution_started',
  'loop.agent_identity_observed',
  'loop.output_observed',
  'loop.evidence_recorded',
  'loop.completion_claim_recorded',
  'loop.completion_evaluated',
  'loop.iteration_finished',
  'loop.next_iteration_scheduled',
  'loop.safe_checkpoint_reached',
  'loop.pause_requested',
  'loop.paused',
  'loop.resume_requested',
  'loop.resumed',
  'loop.stop_requested',
  'loop.limit_reached',
  'loop.blocked',
  'loop.failed',
  'loop.recovery_required',
  'loop.run_claimed',
];

/**
 * The identity of an event for duplicate detection: kind plus the subject it
 * speaks about. Two lines with the same identity are the same fact.
 *
 * EVERY REPEATABLE KIND MUST HAVE A REAL SUBJECT. A kind that falls through to
 * the default is identified by its name alone, which means the SECOND one is
 * always a duplicate — so listing such a kind as repeatable does nothing. That
 * is not a theoretical concern: `loop.resumed` without the generation in its
 * identity makes a run resumable exactly once, and the second resume is
 * rejected as a duplicate of the first. The subjects below are what make the
 * repeatable list mean something.
 */
export function loopEventIdentity(event: {
  readonly kind: RelayLoopEventKind;
  readonly payload: RelayLoopEventPayload;
  /** Used by the kinds whose subject IS the generation they were written in. */
  readonly recoveryGeneration?: number;
}): string {
  const p = event.payload;
  const generation = event.recoveryGeneration ?? 0;
  switch (p.kind) {
    case 'loop.iteration_started':
    case 'loop.agent_request_prepared':
    case 'loop.agent_identity_observed':
    case 'loop.completion_claim_recorded':
    case 'loop.completion_evaluated':
      return `${event.kind}:${p.iterationId}`;
    case 'loop.timed_out':
      return `${event.kind}:${p.iterationId ?? 'run'}`;
    // Evidence may be recorded more than once for one iteration, so the REFS
    // are part of the fact. The same refs twice is a duplicate; different refs
    // is something new.
    case 'loop.evidence_recorded':
      return `${event.kind}:${p.iterationId}:${[...p.evidenceRefs].join('|')}`;
    // A run may be claimed by successive sessions, and re-claimed after a
    // recovery. Same session at the same generation is the duplicate.
    case 'loop.run_claimed':
      return `${event.kind}:${p.sessionId}:${p.recoveryGeneration}`;
    // A run may be resumed many times; each resume reaches a NEW generation.
    case 'loop.resumed':
      return `${event.kind}:${p.recoveryGeneration}`;
    case 'loop.safe_checkpoint_reached':
      return `${event.kind}:${p.reason}:${p.iterationId ?? 'run'}`;
    case 'loop.blocked':
      return `${event.kind}:${p.blockers.map((b) => `${b.reason}/${b.checkId ?? ''}`).join(',')}`;
    case 'loop.agent_execution_started':
      return `${event.kind}:${p.executionId}`;
    case 'loop.iteration_finished':
      return `${event.kind}:${p.execution.executionId}`;
    case 'loop.output_observed':
      return `${event.kind}:${p.observation.observationId}`;
    case 'loop.next_iteration_scheduled':
      return `${event.kind}:${p.decision.decisionId}`;
    case 'loop.pause_requested':
    case 'loop.resume_requested':
    case 'loop.stop_requested':
    // A pause LANDING is identified by the request it completes, so a run may
    // be paused as often as it is asked to be.
    case 'loop.paused':
      return `${event.kind}:${p.requestId}`;
    // A run can need recovery more than once — crash, recover, crash again.
    // Each occurrence belongs to the generation it interrupted.
    case 'loop.recovery_required':
      return `${event.kind}:${generation}:${p.uncertainIterationId ?? 'run'}`;
    case 'loop.failed':
      return `${event.kind}:${p.failure.failureId}`;
    case 'loop.limit_reached':
      return `${event.kind}:${p.limit}`;
    default:
      // Once-per-run events are identified by kind alone.
      return event.kind;
  }
}

/* -------------------------------------------------------------- builder */

export interface BuildLoopEventInput {
  readonly base: RelayLoopEventInput;
  readonly sequence: number;
  readonly previousStateDigest: string;
  readonly resultingStateDigest: string;
  /** Injected — hashing belongs to the digest module, not to this one. */
  readonly digest: (value: unknown) => string;
}

export type BuildLoopEventResult =
  | { readonly ok: true; readonly event: RelayLoopEvent }
  | { readonly ok: false; readonly problem: string };

/**
 * Build one journal line, or refuse to.
 *
 * THE ONLY WAY A LOOP EVENT IS CONSTRUCTED. Three things happen here that must
 * never be left to a caller:
 *
 *   The payload is SANITIZED before it is checksummed, so the checksum covers
 *   the redacted content. Sanitizing afterwards would produce a line whose own
 *   integrity check fails, and a system that repairs that by re-signing has
 *   quietly made tampering survivable.
 *
 *   A request-shaped event without an idempotency key is REFUSED. Generating
 *   one here would produce a fresh key per retry, which is the same as having
 *   none while looking like it has one.
 *
 *   The payload discriminant must match the event kind. They are two fields
 *   holding one fact, and a line where they disagree is a line the reducer
 *   would read one way and a reader would read the other.
 */
export function buildLoopEvent(input: BuildLoopEventInput): BuildLoopEventResult {
  const { base } = input;
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    return { ok: false, problem: `Journal sequences are integers from 1; received ${input.sequence}.` };
  }
  if (!Number.isInteger(base.recoveryGeneration) || base.recoveryGeneration < 0) {
    return {
      ok: false,
      problem: `A recovery generation is a whole number from 0; received ${base.recoveryGeneration}.`,
    };
  }
  if (base.payload.kind !== base.kind) {
    return {
      ok: false,
      problem: `Event kind ${base.kind} carries a ${base.payload.kind} payload — they must agree.`,
    };
  }
  if (
    LOOP_EVENT_KINDS_REQUIRING_IDEMPOTENCY.includes(base.kind)
    && (base.idempotencyKey === null || base.idempotencyKey.trim() === '')
  ) {
    return {
      ok: false,
      problem: `${base.kind} answers a request and must carry the requester's idempotency key, so a retry is recognisable.`,
    };
  }

  const sansChecksum: Omit<RelayLoopEvent, 'checksum'> = {
    schemaVersion: RELAY_LOOP_EVENT_SCHEMA_VERSION,
    eventId: `lev-${base.runId}-${String(input.sequence).padStart(6, '0')}`,
    sequence: input.sequence,
    at: base.at,
    runId: base.runId,
    loopId: base.loopId,
    projectId: base.projectId,
    kind: base.kind,
    actor: base.actor,
    recoveryGeneration: base.recoveryGeneration,
    expectedPreviousState: base.expectedPreviousState,
    idempotencyKey: base.idempotencyKey,
    previousStateDigest: input.previousStateDigest,
    resultingStateDigest: input.resultingStateDigest,
    payload: sanitizeLoopPayload(base.payload),
  };
  return { ok: true, event: { ...sansChecksum, checksum: input.digest(sansChecksum) } };
}

/** Recompute a line's checksum and compare. The integrity half of a read. */
export function verifyLoopEventChecksum(
  event: RelayLoopEvent,
  digest: (value: unknown) => string,
): boolean {
  const { checksum, ...rest } = event;
  return typeof checksum === 'string' && checksum.length > 0 && digest(rest) === checksum;
}
