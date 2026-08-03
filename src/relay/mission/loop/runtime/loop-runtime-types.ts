/**
 * SUNDAY RELAY — THE LOOP RUNTIME DOMAIN.
 *
 * The durable shape of ONE EXECUTION of a Loop. Stage 1 gave a Loop its
 * grammar and its contract; this gives it a run.
 *
 * PURE. No filesystem, no clock, no network, no provider, no Node builtin. The
 * mission layer is a leaf projection and a structural test holds it there, so
 * everything here is data and total functions over data. The Node adapter that
 * writes these to a journal lives in `src/relay/persistence/`, exactly as
 * `durable-mission-file.ts` does for `DurableMissionRecord`.
 *
 * THE DISTINCTION THIS FILE EXISTS TO PRESERVE. Twelve facts are kept
 * separately that a careless model would collapse into four:
 *
 *   requested role          vs  resolved role
 *   requested agent config  vs  actual executing adapter  vs  actual identity
 *   requested model         vs  actual reported model
 *   configured limits       vs  actual usage
 *   model claim  vs  observed result  vs  attested evidence  vs  verified evidence
 *
 * Every `actual*` field starts `null` and is only ever filled from something
 * OBSERVED. None is ever prefilled from the requested side — that single rule
 * is what makes "who actually ran this, and on what model" answerable after a
 * restart instead of merely plausible.
 */

import type { AqualaTraceSourceTrust } from '../../trace/trace-types';
import type { RelayAgentRole } from '../../agent-operating';
import type { RelayLoopBlocker } from '../loop-blockers';
import type { RelayLoopState } from '../loop-contract';

/* ------------------------------------------------------------ versioning */

export const RELAY_LOOP_RUN_SCHEMA_V1 = 'relay-loop-run.v1' as const;
export const RELAY_LOOP_RUN_SCHEMA_VERSION = RELAY_LOOP_RUN_SCHEMA_V1;
export const SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS = [RELAY_LOOP_RUN_SCHEMA_V1] as const;
export type RelayLoopRunSchemaVersion = (typeof SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS)[number];

/* ----------------------------------------------------------------- state */

/**
 * The states the STAGE 2 runtime can actually reach.
 *
 * A deliberate SUBSET of `RELAY_LOOP_STATES`. The full vocabulary also carries
 * `decomposing`, `reviewing`, `repairing` and `converging`, which belong to
 * multi-agent and swarm stages that do not exist. Declaring the reachable set
 * here — and proving in a test that the transition table never leaves it —
 * means a Stage 2 run cannot land in a state whose behaviour nobody wrote.
 */
export const RELAY_LOOP_RUNTIME_STATES = [
  'draft',
  'validating',
  'awaiting_confirmation',
  'queued',
  'starting',
  'planning',
  'running',
  'observing',
  'completion_check',
  'waiting_approval',
  'waiting_budget',
  'waiting_dependency',
  'rate_limited',
  'backing_off',
  'pausing',
  'paused',
  'resuming',
  'stopping',
  'stopped',
  'completed',
  'iteration_exhausted',
  'duration_exhausted',
  'budget_exhausted',
  'token_exhausted',
  'provider_call_exhausted',
  'timed_out',
  'failed',
  'recovery_required',
] as const satisfies readonly RelayLoopState[];

export type RelayLoopRuntimeState = (typeof RELAY_LOOP_RUNTIME_STATES)[number];

/* ------------------------------------------------------------- identity */

/**
 * Who was asked to work, and who actually did.
 *
 * `requestedRole` comes from the command; `resolvedRole` from the registry.
 * Everything prefixed `actual` is OBSERVED — `null` until something was seen,
 * and `null` again after a restart that cannot confirm it. A restart never
 * infers an actual identity from configuration.
 */
export interface RelayLoopAssignment {
  /** What the user's command targeted. */
  readonly requestedRole: RelayAgentRole;
  /** What the registry staffed. Stage 2 requires these to be equal — a
   *  substitution is a different Loop than the one that was approved. */
  readonly resolvedRole: RelayAgentRole;
  /** The adapter configuration the run asked for, by id — never its values. */
  readonly requestedAdapterId: string;
  /** The adapter that actually answered. `null` until observed. */
  readonly actualAdapterId: string | null;
  /** The agent identity actually observed working. NEVER prefilled. */
  readonly actualAgentId: string | null;
  /** The model the run asked for. `null` means the run expressed no preference. */
  readonly requestedModel: string | null;
  /** The model the adapter REPORTED running. `null` is Unknown, not a default. */
  readonly actualModel: string | null;
  readonly assignedAt: string;
}

/* -------------------------------------------------------------- budget */

/**
 * Every bound, and what has actually been consumed against it.
 *
 * Consumption fields are `string | null` in integer micros / integer counts:
 * `null` is UNKNOWN and must stay Unknown. An adapter that cannot report tokens
 * leaves `tokensUsed` null, and a policy that requires known usage refuses
 * rather than treating Unknown as zero. That rule is enforced in
 * `loop-runtime-budget`, not here; this is the record it reads.
 */
export interface RelayLoopBudgetState {
  readonly maxIterations: number | null;
  readonly iterationsStarted: number;
  readonly iterationsCompleted: number;

  readonly maxTotalDurationMinutes: number | null;
  readonly startedAt: string | null;

  /** Integer micros. `null` limit means unbounded; `null` spend means Unknown. */
  readonly maxSpendMicros: string | null;
  readonly knownSpendMicros: string | null;
  /** True once ANY iteration reported unknown cost. A Loop that cannot account
   *  for its own spending must say so rather than showing a confident total. */
  readonly spendHasUnknownComponent: boolean;
  readonly currency: string | null;

  readonly maxTotalTokens: number | null;
  readonly tokensUsed: number | null;
  readonly tokensHaveUnknownComponent: boolean;

  readonly maxProviderCalls: number | null;
  readonly providerCallsUsed: number;

  readonly maxConsecutiveFailures: number;
  readonly consecutiveFailures: number;
}

/* --------------------------------------------------------- observations */

/**
 * ONE THING THE RUNTIME SAW, with the trust level it actually carries.
 *
 * An observation is not evidence and not a verdict. A model asserting "the
 * tests pass" is `claim`; Relay running the tests is `verified`. The trust
 * level is recorded here, never inferred later from how confident the text
 * sounded.
 */
export interface RelayLoopObservation {
  readonly observationId: string;
  readonly iterationId: string;
  readonly kind:
    | 'completion_claim'
    | 'progress_report'
    | 'evidence_produced'
    | 'refusal'
    | 'malformed_output'
    | 'adapter_failure';
  readonly sourceTrust: AqualaTraceSourceTrust;
  /** Safe summary. Never raw model output, never a transcript. */
  readonly summary: string;
  /** References into the evidence/capsule/trace systems — never copies. */
  readonly evidenceRefs: readonly string[];
  /** Acceptance criteria this observation speaks to, when it speaks to any. */
  readonly criterionIds: readonly string[];
  readonly observedAt: string;
}

/** What the runtime decided to do next, and why. Deterministic, never free text
 *  from a model. */
export interface RelayLoopDecision {
  readonly decisionId: string;
  readonly iterationId: string | null;
  readonly action:
    | 'continue'
    | 'complete'
    | 'pause'
    | 'stop'
    | 'fail'
    | 'exhausted'
    | 'require_recovery'
    | 'wait';
  readonly reason: string;
  readonly nextState: RelayLoopRuntimeState;
  readonly decidedAt: string;
}

/* ---------------------------------------------------------- executions */

/**
 * One dispatch through the agent port.
 *
 * `outcome: 'unknown'` is the value that forces inspection instead of replay,
 * matching `DurableActionRecord`. An execution whose outcome nobody can confirm
 * is never automatically re-run — replaying a paid or externally mutating
 * operation on a guess is the specific failure this field prevents.
 */
export interface RelayLoopAgentExecution {
  readonly executionId: string;
  readonly iterationId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome:
    | 'completed'
    | 'failed'
    | 'timeout'
    | 'cancelled'
    | 'crashed'
    | 'malformed_output'
    | 'refused'
    | 'adapter_unavailable'
    | 'unknown';
  /**
   * Adapter-reported usage. Every field `null` when the adapter cannot say.
   *
   * `modelUnits` IS the token count, and it is not called `tokens` for a
   * concrete reason: this object is written into a journal payload, and the
   * shared redaction rules drop any key containing "token" because that is
   * overwhelmingly a credential. A field named `tokens` is silently deleted on
   * the way to disk and the count then reads as absent — so the accounting
   * quietly breaks in the direction of a wrong number. Renaming the field this
   * side of the boundary is safer than loosening a credential filter that
   * protects every durable record in Relay.
   */
  readonly usage: {
    readonly costMicros: string | null;
    readonly currency: string | null;
    /** Model tokens consumed. `null` is Unknown. */
    readonly modelUnits: number | null;
    readonly providerCalls: number | null;
  };
  /** Safe failure summary. `null` on success. */
  readonly failureSummary: string | null;
}

/* --------------------------------------------------------- iterations */

export interface RelayLoopIteration {
  readonly iterationId: string;
  /** 1-based, gap-free, monotonic. The ordinal IS the ordering. */
  readonly ordinal: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly state: 'running' | 'observed' | 'decided' | 'completed' | 'failed' | 'unknown';
  readonly assignment: RelayLoopAssignment;
  readonly execution: RelayLoopAgentExecution | null;
  readonly observations: readonly RelayLoopObservation[];
  readonly decision: RelayLoopDecision | null;
  /** Input references handed to the agent — never the prompt itself. */
  readonly inputRefs: readonly string[];
  readonly outputRefs: readonly string[];
}

/* -------------------------------------------------------- checkpoints */

/**
 * The safe boundaries at which a Loop run may be checkpointed. Closed set, in
 * the spirit of `DURABLE_CHECKPOINT_REASONS`: a keystroke or a token arriving
 * is not a checkpoint.
 */
export const RELAY_LOOP_CHECKPOINT_REASONS = [
  'run_created',
  'iteration_boundary',
  'observation_recorded',
  'decision_recorded',
  'pause_requested',
  'safe_pause_reached',
  'resume_accepted',
  'stop_requested',
  'limit_reached',
  'terminal_state',
] as const;
export type RelayLoopCheckpointReason = (typeof RELAY_LOOP_CHECKPOINT_REASONS)[number];

export interface RelayLoopCheckpoint {
  readonly reason: RelayLoopCheckpointReason;
  readonly at: string;
  /** The iteration in flight when the checkpoint was taken, if any. */
  readonly iterationId: string | null;
}

/* ------------------------------------------------------------- failure */

export interface RelayLoopRuntimeFailure {
  readonly failureId: string;
  readonly kind:
    | 'adapter_failure'
    /** The agent declined. Recorded as its own kind because a refusal is a
     *  real answer, and reporting it as an adapter fault would send someone to
     *  debug infrastructure that worked correctly. */
    | 'agent_refused'
    | 'malformed_output'
    | 'timeout'
    | 'limit_violation'
    | 'invalid_transition'
    | 'contract_moved'
    | 'persistence_failure'
    | 'authorization_failure';
  /** Safe, deterministic. Never a stack trace, never raw adapter output. */
  readonly summary: string;
  readonly iterationId: string | null;
  readonly at: string;
  /** Whether the runtime may keep going. A failure that is not recoverable
   *  ends the run rather than being retried into a loop of its own. */
  readonly recoverable: boolean;
}

/* ------------------------------------------------------------ ownership */

/** Structurally `DurableOwnerLease` / `RelayLoopOwnerLease`. Restated so a run
 *  can version independently; the fields are identical on purpose. */
export interface RelayLoopRunLease {
  readonly sessionId: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

/* ----------------------------------------------------------- the run */

export interface RelayLoopRun {
  readonly schemaVersion: RelayLoopRunSchemaVersion;
  readonly runId: string;
  readonly loopId: string;
  readonly projectId: string;
  readonly workspaceId: string | null;
  /** Reference + version of the contract this run executes. The contract is
   *  NOT copied; a moved contract is detected by the digest. */
  readonly contractRef: string;
  readonly contractVersion: number;
  readonly contractBindingDigest: string;

  readonly state: RelayLoopRuntimeState;
  readonly assignment: RelayLoopAssignment | null;
  readonly iterations: readonly RelayLoopIteration[];
  readonly currentIterationId: string | null;
  readonly budget: RelayLoopBudgetState;
  readonly blockers: readonly RelayLoopBlocker[];
  readonly failures: readonly RelayLoopRuntimeFailure[];
  readonly lastCheckpoint: RelayLoopCheckpoint | null;

  /** Why the run left `running`, when it did. */
  readonly interruptionReason: string | null;
  readonly owner: RelayLoopRunLease | null;
  /** Monotonic; increments on every accepted resume so a stale worker holding
   *  an older generation is detected instead of duplicating work. */
  readonly recoveryGeneration: number;

  /** Who confirmed the contract. An identity label, never an account record. */
  readonly createdBy: string;
  readonly creationSource: 'cli' | 'website' | 'api' | 'schedule';
  /** Binds one confirmation attempt to at most one run. */
  readonly idempotencyKey: string;
  readonly provenance: 'live' | 'offline' | 'simulated';
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A freshly created run, before any event has been folded into it. */
export function emptyLoopBudget(input: {
  readonly maxIterations: number | null;
  readonly maxTotalDurationMinutes: number | null;
  readonly maxSpendMicros: string | null;
  readonly currency: string | null;
  readonly maxTotalTokens: number | null;
  readonly maxProviderCalls: number | null;
  readonly maxConsecutiveFailures: number;
}): RelayLoopBudgetState {
  return {
    maxIterations: input.maxIterations,
    iterationsStarted: 0,
    iterationsCompleted: 0,
    maxTotalDurationMinutes: input.maxTotalDurationMinutes,
    startedAt: null,
    maxSpendMicros: input.maxSpendMicros,
    // Zero SPEND is a real measurement here: nothing has run, so nothing has
    // been spent. Unknown only appears once an adapter fails to report.
    knownSpendMicros: '0',
    spendHasUnknownComponent: false,
    currency: input.currency,
    maxTotalTokens: input.maxTotalTokens,
    tokensUsed: 0,
    tokensHaveUnknownComponent: false,
    maxProviderCalls: input.maxProviderCalls,
    providerCallsUsed: 0,
    maxConsecutiveFailures: input.maxConsecutiveFailures,
    consecutiveFailures: 0,
  };
}
