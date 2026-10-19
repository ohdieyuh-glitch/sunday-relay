/**
 * SUNDAY RELAY — THE SINGLE-AGENT PORT.
 *
 * The one seam through which a Loop iteration reaches an agent. Everything
 * behind it is an implementation detail: Claude Code, a Codex reviewer, a
 * hosted bridge, a fake. Nothing in this file names any of them, and nothing
 * downstream of it may branch on which one answered.
 *
 * WHY THE PORT REPORTS IDENTITY RATHER THAN THE ENGINE ASSUMING IT. The engine
 * knows what it ASKED for: a role, an adapter id, maybe a model. It cannot know
 * what actually ran. Only the adapter can say, and often it cannot either — a
 * bridge may not report a model, a fake has no model at all. So every `actual*`
 * field on the result is nullable and `null` means UNKNOWN, never "the same as
 * requested". An engine that filled these in from its own request would produce
 * a run whose provenance looks complete and is fiction.
 *
 * WHY USAGE IS A UNION AND NOT A NUMBER. `{ known: false }` is a real answer.
 * An adapter that cannot report cost must be able to say so without the runtime
 * substituting zero, because zero is a claim about money that nobody made. The
 * limit checker refuses rather than guesses when a policy needs a number and
 * the adapter had none.
 *
 * WHY OUTCOMES ARE CLASSIFIED HERE. Refusal, malformed output, timeout,
 * cancellation, crash and unavailability are SIX different things that a
 * boolean `success` would flatten into one. They lead to different next moves —
 * a refusal is information, a crash is a recovery case, an unavailable adapter
 * is not the agent's fault — and a run that cannot tell them apart cannot
 * explain itself afterwards.
 *
 * PURE. This declares the shape. Every implementation, including the Node ones
 * that will follow, lives outside the mission layer.
 */

import type { AqualaTraceSourceTrust } from '../../trace/trace-types';
import type { RelayAgentRole } from '../../agent-operating';

/* --------------------------------------------------------------- usage */

/**
 * What one dispatch consumed.
 *
 * Discriminated so Unknown cannot be read as a number by accident. The known
 * branch carries integer micros as a string, matching the rest of Relay's
 * money handling — a float would make two runs that spent the same amount
 * disagree about it.
 */
export type RelayLoopAgentUsage =
  | {
      readonly known: true;
      readonly costMicros: string;
      readonly currency: string;
      readonly tokens: number;
      readonly providerCalls: number;
    }
  | {
      readonly known: false;
      /** Why the adapter could not say. Shown to a human, never inferred. */
      readonly reason: string;
      /** Partial knowledge is still knowledge: an adapter may know it made two
       *  calls while having no idea what they cost. `null` stays Unknown. */
      readonly providerCalls: number | null;
      readonly tokens: number | null;
    };

/* ------------------------------------------------------------- outcomes */

/**
 * How one dispatch ended. Closed set — an adapter that invents a seventh
 * outcome cannot be represented, which is deliberate.
 */
export const RELAY_LOOP_AGENT_OUTCOMES = [
  /** The agent ran and produced a structured result. Says nothing about
   *  whether the WORK is done — that is completion evaluation's job. */
  'completed',
  /** The agent declined. A refusal is a real answer and is not a failure. */
  'refused',
  /** The agent answered in a shape the runtime cannot read. */
  'malformed_output',
  /** The bounded time for this iteration elapsed. */
  'timeout',
  /** Relay asked it to stop and it did. */
  'cancelled',
  /** The agent's process died. */
  'crashed',
  /** The adapter could not be reached at all — nothing was dispatched. */
  'adapter_unavailable',
  /** Something happened and Relay does not know what. The value that forces
   *  inspection instead of a retry. */
  'unknown',
] as const;
export type RelayLoopAgentOutcome = (typeof RELAY_LOOP_AGENT_OUTCOMES)[number];

/** Outcomes after which NOTHING was dispatched, so a retry is safe. */
export const SAFE_TO_RETRY_OUTCOMES: readonly RelayLoopAgentOutcome[] = ['adapter_unavailable'];

/* -------------------------------------------------------------- request */

export interface RelayLoopAgentRequest {
  readonly runId: string;
  readonly iterationId: string;
  /** 1-based. Handed to the adapter so a fake can be scripted per iteration
   *  and a real adapter can label its own telemetry. */
  readonly ordinal: number;
  /** Binds this dispatch to one logical attempt. An adapter that sees the same
   *  key twice must return the SAME result rather than working twice. */
  readonly idempotencyKey: string;
  readonly requestedRole: RelayAgentRole;
  readonly resolvedRole: RelayAgentRole;
  readonly requestedAdapterId: string;
  readonly requestedModel: string | null;
  /** References to the objective, the criteria and prior evidence. NEVER the
   *  prompt itself — the port passes pointers, and the adapter resolves them. */
  readonly inputRefs: readonly string[];
  /** The wall-clock bound for this ONE iteration, in milliseconds. */
  readonly deadlineMs: number;
}

/* --------------------------------------------------------------- result */

/**
 * One thing the agent reported.
 *
 * `trust` is the adapter's honest assessment of its OWN output, and the only
 * value an adapter may self-assign is `claim`. Anything higher has to come from
 * something Relay did — running a check, resolving an attestation — so an
 * adapter returning `verified` for its own say-so is a bug the completion
 * evaluator refuses to honour.
 */
export interface RelayLoopAgentFinding {
  readonly kind: 'completion_claim' | 'progress_report' | 'evidence_produced' | 'repair_requested' | 'refusal';
  readonly trust: AqualaTraceSourceTrust;
  /** Safe summary. Sanitized again on the way to the journal. */
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly criterionIds: readonly string[];
}

export interface RelayLoopAgentResult {
  readonly outcome: RelayLoopAgentOutcome;
  /** What actually answered. `null` is Unknown and is never backfilled. */
  readonly actualAdapterId: string | null;
  readonly actualAgentId: string | null;
  readonly actualModel: string | null;
  readonly findings: readonly RelayLoopAgentFinding[];
  readonly usage: RelayLoopAgentUsage;
  /** Safe, deterministic. Never a stack trace, never raw adapter output. */
  readonly failureSummary: string | null;
  /** True when the adapter parked at a safe boundary because Relay asked. */
  readonly checkpointed: boolean;
}

/* ---------------------------------------------------------------- status */

export type RelayLoopAgentStatus =
  | { readonly state: 'running'; readonly since: string }
  | { readonly state: 'finished'; readonly result: RelayLoopAgentResult }
  /** Relay asked and the adapter could not say. NOT the same as "not running":
   *  an operation that may still be in flight is never retried on a guess. */
  | { readonly state: 'unobservable'; readonly reason: string };

/* ------------------------------------------------------------------ port */

/**
 * What every Loop adapter must be able to do.
 *
 * Injected everywhere, so the engine's tests never touch a process. The
 * optional members are optional because they are genuinely not universal: an
 * adapter that cannot park at a checkpoint should say so by not implementing
 * `requestSafeCheckpoint`, rather than implementing it as a lie that returns
 * true.
 */
export interface RelayLoopAgentPort {
  /** A stable identity for THIS adapter implementation. */
  readonly adapterId: string;
  /** The roles it can staff. The engine refuses a role that is not listed
   *  rather than dispatching and hoping. */
  readonly supportedRoles: readonly RelayAgentRole[];

  /** Run ONE bounded iteration. Resolves with a classified result; it does not
   *  throw for an agent-level failure, because a refusal is data. */
  begin(request: RelayLoopAgentRequest): Promise<RelayLoopAgentResult>;

  /** What is happening right now. Used only after a restart, to decide whether
   *  an in-flight dispatch can be read rather than guessed. */
  observe?(iterationId: string): Promise<RelayLoopAgentStatus>;

  /** Ask the agent to stop. Cancellation is NEVER completion. */
  cancel?(iterationId: string, reason: string): Promise<void>;

  /** Ask the agent to park at its next safe boundary. Absent when the adapter
   *  has no such notion. */
  requestSafeCheckpoint?(iterationId: string): Promise<boolean>;
}

/** Can this port staff the role the run resolved to? */
export function portSupportsRole(port: RelayLoopAgentPort, role: RelayAgentRole): boolean {
  return port.supportedRoles.includes(role);
}
