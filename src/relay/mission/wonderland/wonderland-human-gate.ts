/**
 * WHAT A RUN IS WAITING FOR A PERSON TO DO.
 *
 * The Julius kernel already implements the whole intervention protocol, and
 * this file adds no part of it. `evaluateJuliusPolicy` answers REQUIRE_APPROVAL;
 * `requestApprovalAndBlock` writes the gate and makes the run non-claimable in
 * one transaction; `decideApproval` records WHO decided and refuses a decision
 * nobody can be named for; the run then resumes. AUTONOMOUS → BLOCKED_ON_HUMAN
 * → a typed contract → a verified answer → RESUME exists, durably, and is
 * tested where it lives.
 *
 * WHAT DID NOT EXIST IS THE PROJECTION. A world was told `pendingApprovals: 3`
 * and shown `awaiting_approval` on the activity axis, and that is the whole of
 * it: three of something, somewhere. It could not say WHAT is being waited on,
 * so the one moment in a run where a person is required was also the moment the
 * world had least to say about it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A WORKER NEVER COMMANDS A PERSON, AND THIS SHAPE IS WHY IT CANNOT.
 *
 * A worker asks C.A.R.D. whether an operation is permitted. That is a question
 * about a CAPABILITY BOUNDARY, and the answer is a policy decision, not a
 * message to anybody. Julius — and only Julius — turns REQUIRE_APPROVAL into a
 * gate, owns the record, and owns the resume. Nothing a worker produces reaches
 * this contract: not a prompt, not a rationale it wrote, not a sentence
 * addressed to a founder. Every field below comes from the POLICY EVALUATION
 * and the kernel's own bookkeeping.
 *
 * That is also why the gate carries no prose. `julius_approvals.safe_rationale`
 * is a real column and a genuinely safe sentence, and it still does not cross:
 * a game client is the least trusted process in the system, the one a player
 * can attach a debugger to, and a sentence is the one field on this record that
 * could be made to carry something a person wrote. The OPERATION says what is
 * gated, in Relay's own closed vocabulary, and that is what a world needs to
 * draw. The sentence belongs on Relay's own surface, where the person who can
 * actually answer the gate is standing.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { exactKeys } from './wonderland-contracts';
import type { JuliusPolicyOperation } from '../julius/julius-policy';

export const WONDERLAND_HUMAN_GATE_SCHEMA_V1 = 'relay-wonderland-human-gate.v1' as const;
export type WonderlandHumanGateSchemaVersion = typeof WONDERLAND_HUMAN_GATE_SCHEMA_V1;

/**
 * The operations C.A.R.D. can gate, mirroring `JuliusPolicyOperation`.
 *
 * SAFE TO CARRY BECAUSE IT IS CLOSED AND IT IS OURS. These are Relay's words
 * for kinds of action — spawn a sub-agent, touch the network, mutate the
 * filesystem — not any provider's product names and not anybody's prose. The
 * `_KernelOperationsAreCovered` assertion below is what keeps them the kernel's
 * words rather than a copy that drifted: an operation added to the policy and
 * not to this list stops the build.
 */
export const WONDERLAND_GATED_OPERATIONS = [
  'DISPATCH_WORKER',
  'USE_CAPABILITY',
  'USE_PROVIDER',
  'USE_TOOL',
  'READ_FILESYSTEM',
  'EXECUTE_PROCESS',
  'ACCESS_NETWORK',
  'MUTATE_FILESYSTEM',
  'SPAWN_SUBAGENT',
  'CONTINUE_ITERATIVE_REVIEW',
  'FALLBACK_PROVIDER',
  'AUTOMATIC_RETRY',
  'UNCHAINED_CONTINUATION',
] as const;
export type WonderlandGatedOperation = (typeof WONDERLAND_GATED_OPERATIONS)[number];

/**
 * BOTH DIRECTIONS, AND BOTH MATTER.
 *
 * The first says every kernel operation has a member here — a gate this build
 * cannot name would arrive and be refused, so a world would show fewer gates
 * than are open, which reads as a run that is merely slow. The second says this
 * list invents nothing the kernel cannot produce, so a world cannot draw a
 * boundary that does not exist.
 */
const _KernelOperationsAreCovered: WonderlandGatedOperation extends JuliusPolicyOperation
  ? JuliusPolicyOperation extends WonderlandGatedOperation
    ? true
    : never
  : never = true;
void _KernelOperationsAreCovered;

/**
 * ONE OPEN GATE, as a world may know it.
 *
 * IT CARRIES ITS OWN IDENTITY, like the citation does and for the same reason.
 * A hydration is adopted wholesale, so a gate assembled into an otherwise
 * correct payload would put another run's held decision onto this world with
 * nothing downstream to contradict it. Carrying the project and the run makes
 * that checkable at the boundary rather than trusted.
 */
export interface WonderlandHumanGate {
  readonly schemaVersion: WonderlandHumanGateSchemaVersion;
  readonly projectId: string;
  readonly runId: string;
  /** Opaque handle. The world groups by it and never parses it. */
  readonly gateId: string;
  /** Null for a gate on the RUN rather than on one task. Never a blank. */
  readonly taskId: string | null;
  /** What is gated. Relay's own closed vocabulary; never a provider's name. */
  readonly operation: WonderlandGatedOperation;
  /**
   * The policy's machine name for why, e.g. `CARD_APPROVAL_REQUIRED`.
   *
   * A STABLE TOKEN, NOT A SENTENCE, and the distinction is the same one the
   * event catalogue makes: a reason code is a name a program compares, and how
   * a surface words it belongs to whatever draws it. It is carried as text
   * rather than as an enum because the kernel's column is free text and a
   * mirrored enum would refuse a code this build has not seen — which would
   * hide a gate rather than show an unfamiliar one.
   */
  readonly reasonCode: string;
  /** When the gate opened. How long a person has been waited on. */
  readonly requestedAtIso: string;
}

export const WONDERLAND_HUMAN_GATE_FIELDS = exactKeys<WonderlandHumanGate>()([
  'schemaVersion',
  'projectId',
  'runId',
  'gateId',
  'taskId',
  'operation',
  'reasonCode',
  'requestedAtIso',
] as const);

/**
 * The shape this module accepts, declared here rather than imported.
 *
 * The same inversion the citation and the C.A.R.D. scope use. If this took a
 * `JuliusApprovalRecord` it would be handed `safeRationale`, `decisionReason`
 * and `decidedBy` on every call, and the only thing between a person's name and
 * a game client would be this function remembering not to copy it. With a
 * narrower parameter none of them is ever in scope.
 */
export interface WonderlandHumanGateInput {
  readonly projectId: string;
  readonly runId: string;
  readonly gateId: string;
  readonly taskId?: string | null;
  readonly operation: string;
  readonly reasonCode: string;
  readonly requestedAtIso: string;
}

const OPERATIONS: ReadonlySet<string> = new Set<string>(WONDERLAND_GATED_OPERATIONS);

/**
 * A reason code, or the empty string.
 *
 * BOUNDED AND SHAPE-CHECKED, because this is the one text field that crosses
 * and free text in a machine-name slot is how prose would arrive if it ever
 * did. A code is `SCREAMING_SNAKE`, digits and dots allowed, and anything else
 * — a space, a full stop, a lowercase word — is not a code and is dropped
 * rather than drawn. Empty means the kernel reported one this build will not
 * repeat, which is visible as an absence rather than as a sentence.
 */
const REASON_CODE = /^[A-Z0-9][A-Z0-9._]{0,63}$/;
const reasonCode = (value: string): string => (REASON_CODE.test(value) ? value : '');

/**
 * Narrow one open gate into what a world may know. THE ONLY CONSTRUCTOR.
 *
 * Returns null for an operation this build cannot name. That is a REFUSAL and
 * not a silent drop: `scopeWonderlandHumanGates` counts what it refused, so a
 * world shows "a gate this client cannot describe" rather than one fewer gate.
 * The difference matters — one gate fewer looks like a run that is merely
 * slower, and a person would never be told they are being waited on.
 */
export function scopeWonderlandHumanGate(
  input: WonderlandHumanGateInput,
): WonderlandHumanGate | null {
  if (!OPERATIONS.has(input.operation)) return null;
  const taskId = typeof input.taskId === 'string' && input.taskId.trim() !== ''
    ? input.taskId
    : null;
  return Object.freeze({
    schemaVersion: WONDERLAND_HUMAN_GATE_SCHEMA_V1,
    projectId: input.projectId,
    runId: input.runId,
    gateId: input.gateId,
    taskId,
    operation: input.operation as WonderlandGatedOperation,
    reasonCode: reasonCode(input.reasonCode),
    requestedAtIso: input.requestedAtIso,
  });
}

/** What a run is waiting on, and what this build could not describe. */
export interface WonderlandHumanGates {
  readonly gates: readonly WonderlandHumanGate[];
  /**
   * Gates that exist and could not be narrowed — an operation whose name this
   * build does not carry.
   *
   * REPORTED RATHER THAN SUBTRACTED, exactly as an unknown Project Brain kind
   * is counted in the total and in no bucket. A world that quietly showed one
   * gate fewer would be drawing a run that is not waiting on anybody.
   */
  readonly undescribed: number;
}

export function scopeWonderlandHumanGates(
  inputs: readonly WonderlandHumanGateInput[],
): WonderlandHumanGates {
  const gates: WonderlandHumanGate[] = [];
  let undescribed = 0;
  for (const input of inputs) {
    const gate = scopeWonderlandHumanGate(input);
    if (gate === null) undescribed += 1;
    else gates.push(gate);
  }
  return Object.freeze({ gates: Object.freeze(gates), undescribed });
}

/** No gate is open, and somebody looked. Distinct from nobody having looked. */
export const noWonderlandHumanGates = (): WonderlandHumanGates =>
  Object.freeze({ gates: Object.freeze([]), undescribed: 0 });

/**
 * Whether a gate belongs to the run a hydration is about.
 *
 * Used by the wrapper's verdict. A gate that names another project or run is a
 * held decision from somewhere else, and a world adopting it would show a
 * person being waited on for something they cannot see.
 */
export const wonderlandHumanGateBelongs = (
  gate: WonderlandHumanGate,
  projectId: string,
  runId: string,
): boolean =>
  gate.schemaVersion === WONDERLAND_HUMAN_GATE_SCHEMA_V1 &&
  gate.projectId === projectId &&
  gate.runId === runId;
