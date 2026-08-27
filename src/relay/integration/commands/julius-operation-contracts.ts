/**
 * RELAY-SIDE COMMAND CONTRACTS — user intent, typed and bounded.
 *
 * THE ONE RULE THIS LAYER ENFORCES, restated from Relay's existing command
 * protocol because it is the same rule:
 *
 *   a user command is a REQUEST for a state transition — never the transition
 *   itself.
 *
 * Relay owns the left-hand side of that sentence: parse the intent, validate
 * its SHAPE, and hand Julius a typed operation request. Julius owns the
 * right-hand side entirely — whether policy permits the operation, how many
 * gauntlet rounds actually run, what a repair transition does, how budget is
 * enforced, when a sub-agent may spawn. None of that is here, and adding it
 * here would be Relay keeping a second copy of rules it does not own.
 *
 * SHAPE IS NOT POLICY, and the distinction is load-bearing. Relay refuses
 * `--rounds banana` and `--rounds -3` because those are not numbers of rounds.
 * It does NOT refuse `--rounds 4` on the grounds that a C.A.R.D. allows three:
 * that is a policy decision, Julius makes it, and a Relay-side copy of the
 * limit would go stale silently and start refusing operations the product
 * permits.
 *
 * EVERY OPERATION MAY BE DENIED. `RelayJuliusOperationOutcome` models refusal
 * as a value rather than an exception, so a surface cannot render an
 * acknowledgement it never received. This matters most for Unchained: Relay
 * may REQUEST it and must never assume it succeeded.
 *
 * PURE. No Node, no network, no clock.
 */

import type { CompoundAgentSlot } from '../compound-agent';

export const RELAY_JULIUS_OPERATION_VERSION = 'relay-julius-operation.v1' as const;

/* ------------------------------------------------------------ operations */

export const RELAY_JULIUS_OPERATIONS = [
  'START_GAUNTLET',
  'SET_AUTONOMY_MODE',
  'REQUEST_SUBAGENT',
  'PAUSE_RUN',
  'RESUME_RUN',
  'CANCEL_RUN',
  'SUBMIT_APPROVAL',
] as const;
export type RelayJuliusOperation = (typeof RELAY_JULIUS_OPERATIONS)[number];

/**
 * THE AUTONOMY LEVELS A RUN MAY BE ASKED TO MOVE TO.
 *
 * This is REQUEST VOCABULARY. Julius's C.A.R.D. policy engine is authoritative
 * on what each level permits and on whether a run may move to one at all;
 * Relay names the level and nothing else. In particular Relay defines no
 * Unchained SEMANTICS — no bound is relaxed, no checkpoint is skipped, and no
 * Relay code path behaves differently because this value was requested.
 *
 * NOT THE SAME AXIS AS `RelayMode`. Relay's guided/semi/autonomous decides
 * when Relay stops to ask a human; this decides how far Julius may run without
 * returning. Mapping one onto the other would invent a rule neither layer
 * states, so they are kept separate — with the ONE coherence check that
 * `requestedAutonomyIsCoherent` expresses below.
 */
export const JULIUS_AUTONOMY_LEVELS = ['SUPERVISED', 'AUTONOMOUS', 'UNCHAINED'] as const;
export type JuliusAutonomyLevel = (typeof JULIUS_AUTONOMY_LEVELS)[number];

/**
 * WIRE-SANITY BOUNDS, WHICH ARE NOT POLICY LIMITS.
 *
 * A request field has to be bounded or a single command can carry an integer
 * nothing downstream can hold. These numbers are the point past which a value
 * is CERTAINLY a mistake rather than a request — they are not a statement that
 * anything below them is permitted, and Julius refuses whatever its policy
 * refuses regardless of what passes here.
 */
export const OPERATION_REQUEST_BOUNDS = Object.freeze({
  maxGauntletRounds: 1_000,
  maxSubagentDepth: 32,
  maxSubagentCount: 256,
  /** Free text a human typed: a reason, a task description. */
  maxTextLength: 2_000,
  /** An opaque identifier minted elsewhere. */
  maxIdentifierLength: 200,
});

/* -------------------------------------------------------------- envelope */

/**
 * What every operation carries.
 *
 * `runId` is validated as a BOUNDED OPAQUE STRING and not against Relay's
 * `run_` prefix convention. Julius mints its own run identifiers, and
 * imposing Relay's prefix on them would be Relay inventing a rule about
 * somebody else's ids — the same mistake avoided by comparing C.A.R.D.
 * revisions for equality rather than ordering.
 */
export interface RelayJuliusOperationEnvelope {
  readonly operationVersion: typeof RELAY_JULIUS_OPERATION_VERSION;
  /** Client-supplied; makes a retried submit safe to repeat. */
  readonly requestId: string;
  readonly runId: string;
  /** The participant or operator who issued it. Never a credential. */
  readonly issuedBy: string;
  readonly issuedAt: string;
  /** Secret-redacted text the user typed, kept for the audit trail. */
  readonly sourceText: string;
}

/* ------------------------------------------------------------- requests */

/**
 * `maxRounds: null` means NOT REQUESTED — the user asked for a gauntlet and
 * named no ceiling, so Julius's policy default applies. It never means zero
 * and never means unlimited, and Relay does not substitute a number for it.
 */
export interface StartGauntletRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'START_GAUNTLET';
  readonly requestedLimits: { readonly maxRounds: number | null };
}

export interface SetAutonomyModeRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'SET_AUTONOMY_MODE';
  readonly requestedMode: JuliusAutonomyLevel;
}

/**
 * A REQUEST FOR A CHILD, not a child.
 *
 * Relay creates no worker. It names what capability is wanted, what the task
 * is, optionally which permanent role would suit it, and optionally the bounds
 * the CALLER is willing to accept. Julius authorizes, bounds and spawns —
 * including narrowing anything requested here.
 */
export interface RequestSubagentRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'REQUEST_SUBAGENT';
  readonly parentTaskId: string;
  readonly requestedCapability: string;
  readonly requestedTask: string;
  /** A preference, never an assignment. `null` means "Julius decides". */
  readonly rolePreference: CompoundAgentSlot | null;
  readonly requestedBounds: {
    readonly maxDepth: number | null;
    readonly maxChildren: number | null;
  };
}

export interface PauseRunRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'PAUSE_RUN';
  readonly reason: string;
}

export interface ResumeRunRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'RESUME_RUN';
}

export interface CancelRunRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'CANCEL_RUN';
  readonly reason: string;
}

export interface SubmitApprovalRequest extends RelayJuliusOperationEnvelope {
  readonly operation: 'SUBMIT_APPROVAL';
  readonly approvalId: string;
  readonly decision: 'APPROVE' | 'DENY';
  readonly reason: string;
}

export type RelayJuliusOperationRequest =
  | StartGauntletRequest
  | SetAutonomyModeRequest
  | RequestSubagentRequest
  | PauseRunRequest
  | ResumeRunRequest
  | CancelRunRequest
  | SubmitApprovalRequest;

/* -------------------------------------------------------------- outcomes */

/**
 * ACCEPTANCE IS AN ACKNOWLEDGEMENT, NOT A RESULT.
 *
 * `accepted: true` says Julius took the request. It does not say the gauntlet
 * cleared, the mode changed, or the sub-agent ran — those are later facts that
 * arrive as events. Naming the field `accepted` rather than `ok` is what stops
 * a surface from rendering "Unchained enabled" when all it knows is that a
 * request was received.
 */
export type RelayJuliusOperationOutcome =
  | { readonly accepted: true; readonly acknowledgedAt: string; readonly safeSummary: string }
  | {
    readonly accepted: false;
    readonly reasonCode: string;
    readonly safeMessage: string;
    readonly retryable: boolean;
  };

export interface JuliusOperationPort {
  readonly operationVersion: typeof RELAY_JULIUS_OPERATION_VERSION;
  submit(request: RelayJuliusOperationRequest): Promise<RelayJuliusOperationOutcome>;
}

/**
 * The honest answer for a deployment with no Julius runtime attached: the
 * request parsed and validated, and it went nowhere.
 */
export function unwiredJuliusOperationPort(): JuliusOperationPort {
  return {
    operationVersion: RELAY_JULIUS_OPERATION_VERSION,
    submit: async () => ({
      accepted: false,
      reasonCode: 'julius_runtime_not_wired',
      safeMessage: 'No Julius runtime is attached to this deployment. The command was parsed and validated; it was not submitted anywhere.',
      retryable: false,
    }),
  };
}

/* ------------------------------------------------------- coherence check */

/**
 * THE ONE RELAY-SIDE COHERENCE RULE ABOUT AUTONOMY.
 *
 * `guided` is the mode in which the user asked to be consulted. Asking, in the
 * same run, to be left alone entirely is not a policy question — it is an
 * incoherent request, and Relay refuses to COMPOSE it rather than sending
 * Julius a contradiction to adjudicate.
 *
 * That is the whole rule. It says nothing about what UNCHAINED permits, does
 * not relax any bound, and does not imply that a coherent request will be
 * granted: Julius's policy engine remains authoritative and may deny an
 * UNCHAINED request from any mode, including `autonomous`.
 */
export function requestedAutonomyIsCoherent(
  requested: JuliusAutonomyLevel,
  executionMode: 'guided' | 'semi' | 'autonomous',
): boolean {
  return !(requested === 'UNCHAINED' && executionMode === 'guided');
}
