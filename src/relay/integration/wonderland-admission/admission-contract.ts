/**
 * WONDERLAND ADMISSION CONTRACT — the shapes the J1 client already classifies.
 *
 * This module does not dispatch, spend, or retry. It names the wire contract
 * Cosmo's client at a821a467 implements in `ClassifyDispatchAnswer`
 * (`wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp`) and the
 * refusal kinds `relay-bridge/julius-dispatch.ts` at 31bfc58b already uses.
 *
 * PURE. No Node, no network, no clock, no provider.
 */

/** Bridge run-id rule at 31bfc58b (`RUN_ID`). A Wonderland id must also be strict. */
export const BRIDGE_RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/;

/** Canonical lowercase UUIDv4. The variant nibble is 8, 9, a, or b. */
export const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Client-minted run id: `wlj_` plus a canonical UUIDv4. Also passes `BRIDGE_RUN_ID`. */
export const WONDERLAND_RUN_ID = /^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Server run id minted by `createLiveJuliusBootstrapPort`: `run:` and 24
 * lowercase hex characters. The validator is private in
 * `relay-bridge/julius/mission-contract.ts` (`BOOTSTRAP_RUN_ID`). That file
 * is Julius-owned, so this is the same pattern, not an import. YUJI: confirm
 * bootstrap will require this id on an admitted pair.
 */
export const JULIUS_BOOTSTRAP_RUN_ID = /^run:[0-9a-f]{24}$/;

/** `x-relay-idempotency-key` at 31bfc58b. A Wonderland key is a canonical UUIDv4, which matches. */
export const J1_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,80}$/;

/** Client trigger id and the log-line hash the dispatch body must carry. */
export const CLIENT_TRIGGER_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Paid-slot dispatch key (`scripts/julius-paid-slot.mjs`). A sha256 hex key
 * fits. The adapter uses the key hash, never a second key space.
 */
export const PAID_SLOT_DISPATCH_KEY = /^[A-Za-z0-9._@#-]{8,96}$/;

/** Workflow mission slug, the same grammar the paid workflow's title uses. */
export const MISSION_SLUG = /^[a-z0-9-]{1,64}$/;

/** The only workflow that may spend. Named, never started, by this module. */
export const PAID_WORKFLOW_FILE = 'julius-first-live-mission.yml';

/** The admission script that workflow runs. Named, never spawned, by this module. */
export const PAID_SLOT_SCRIPT = 'scripts/julius-paid-slot.mjs';

/**
 * Kinds the client treats as a conclusive 429 refusal (r2 `ClassifyDispatchAnswer`).
 * Any other 429 kind, including `julius_dispatch_busy`, is no answer.
 */
export const CAP_REFUSAL_KINDS = Object.freeze([
  'julius_dispatch_cap_reached',
  'julius_dispatch_mission_cap_reached',
] as const);

export type CapRefusalKind = (typeof CAP_REFUSAL_KINDS)[number];

/** Present so tests can name it. The adapter never returns this kind. */
export const BUSY_KIND = 'julius_dispatch_busy';

/**
 * Client resend schedule at a821a467 (`NextResend`). Documented here so a
 * server change cannot drift from it. Nothing in this package waits, sleeps,
 * or sends the schedule.
 */
export const CLIENT_RESEND_BASE_DELAY_MS = 2_000;
export const CLIENT_RESEND_GROWTH = 2;
export const CLIENT_RESEND_MAX_DELAY_MS = 30_000;
export const CLIENT_RESEND_MAX_COUNT = 8;
export const CLIENT_RESEND_MAX_TOTAL_WAIT_MS = 180_000;

/** Delay before resend `index` (0-based), matching the client's doubling cap. */
export function clientResendDelayMs(index: number): number {
  if (!Number.isInteger(index) || index < 0) return CLIENT_RESEND_MAX_DELAY_MS;
  const grown = CLIENT_RESEND_BASE_DELAY_MS * CLIENT_RESEND_GROWTH ** index;
  return grown > CLIENT_RESEND_MAX_DELAY_MS ? CLIENT_RESEND_MAX_DELAY_MS : grown;
}

export type DispatchAnswerClass = 'Accepted' | 'Refused' | 'NoAnswer';

/**
 * The client's classifier, restated. A 2xx with no error object is Accepted.
 * A 429 is Refused only for the two cap kinds. A 4xx or 5xx that carries an
 * error kind is Refused. Anything else — a bare 5xx, `julius_dispatch_busy`,
 * an unlisted 429 kind, a body with no kind — is NoAnswer.
 */
export function classifyDispatchAnswer(
  httpStatus: number,
  hasError: boolean,
  errorKind: string,
): DispatchAnswerClass {
  const noError = !hasError && errorKind === '';
  const errorWithKind = hasError && errorKind !== '';
  if (httpStatus >= 200 && httpStatus <= 299 && noError) return 'Accepted';
  if (httpStatus === 429 && errorWithKind) {
    for (const kind of CAP_REFUSAL_KINDS) {
      if (errorKind === kind) return 'Refused';
    }
    return 'NoAnswer';
  }
  if (httpStatus >= 400 && httpStatus <= 599 && errorWithKind) return 'Refused';
  return 'NoAnswer';
}

export function errorKindOf(body: unknown): { hasError: boolean; kind: string } {
  if (body === null || typeof body !== 'object' || !('error' in body)) return { hasError: false, kind: '' };
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object' || !('kind' in error)) return { hasError: true, kind: '' };
  const kind = (error as { kind?: unknown }).kind;
  return { hasError: true, kind: typeof kind === 'string' ? kind : '' };
}

export interface ReviewedModelPins {
  readonly architectModel: string | null;
  readonly codingModel: string | null;
  readonly reviewerProvider: string | null;
  readonly reviewerModel: string | null;
}

const PIN_LINE = /^(OPENAI_PROMPT_ARCHITECT_MODEL|RELAY_ANTHROPIC_ARCHITECT_MODEL|RELAY_HOSTED_CODING_MODEL|RELAY_HERMES_PROVIDER|RELAY_HERMES_MODEL):\s*(\S+)\s*$/;

/**
 * Read the three role pins from the paid workflow's env block. Missing stays
 * null. A duplicated name fails the whole read. No model string is filled in
 * by this function.
 */
export function parseWorkflowModelPins(source: string): { ok: true; pins: ReviewedModelPins } | { ok: false; problem: string; pins: ReviewedModelPins } {
  const empty: ReviewedModelPins = {
    architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null,
  };
  const found: Record<string, string[]> = {
    OPENAI_PROMPT_ARCHITECT_MODEL: [],
    RELAY_ANTHROPIC_ARCHITECT_MODEL: [],
    RELAY_HOSTED_CODING_MODEL: [],
    RELAY_HERMES_PROVIDER: [],
    RELAY_HERMES_MODEL: [],
  };
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const match = PIN_LINE.exec(trimmed);
    if (match === null) continue;
    found[match[1]].push(match[2]);
  }
  const duplicated = Object.entries(found).filter(([, values]) => values.length > 1).map(([name]) => name);
  if (duplicated.length > 0) {
    return { ok: false, problem: `duplicated workflow pin: ${duplicated.join(',')}`, pins: empty };
  }
  // ONE ARCHITECT PIN. The J1 Agentic Architect is pinned by RELAY_ANTHROPIC_ARCHITECT_MODEL;
  // a workflow that pinned both architects would not say which one ran.
  if (found.OPENAI_PROMPT_ARCHITECT_MODEL.length > 0 && found.RELAY_ANTHROPIC_ARCHITECT_MODEL.length > 0) {
    return { ok: false, problem: 'duplicated workflow pin: two architect models', pins: empty };
  }
  const one = (name: string): string | null => found[name][0] ?? null;
  return {
    ok: true,
    pins: {
      architectModel: one('RELAY_ANTHROPIC_ARCHITECT_MODEL') ?? one('OPENAI_PROMPT_ARCHITECT_MODEL'),
      codingModel: one('RELAY_HOSTED_CODING_MODEL'),
      reviewerProvider: one('RELAY_HERMES_PROVIDER'),
      reviewerModel: one('RELAY_HERMES_MODEL'),
    },
  };
}

export interface PaidWorkflowTicket {
  /** Always the existing paid workflow. Never invoked here. */
  readonly workflowFile: typeof PAID_WORKFLOW_FILE;
  readonly admissionScript: typeof PAID_SLOT_SCRIPT;
  /**
   * Empty on purpose. The workflow spends only when a person types
   * `RUN LIVE MISSION`. This ticket never carries that phrase.
   */
  readonly confirmLive: '';
  readonly dispatchKey: string;
  readonly mission: string | null;
  readonly lane: '';
  readonly submitted: false;
  readonly gatesRemaining: readonly string[];
}

export const GATES_REMAINING: readonly string[] = Object.freeze([
  'workflow_dispatch is the only trigger',
  'confirm_live must be typed exactly RUN LIVE MISSION by a person',
  'GitHub Environment julius-live-validation',
  'contract check before the live entrypoint',
  'entrypoint --confirm-live',
  'paid-slot admission in scripts/julius-paid-slot.mjs',
]);

export function paidWorkflowTicket(input: { dispatchKey: string; mission: string | null }): PaidWorkflowTicket {
  return {
    workflowFile: PAID_WORKFLOW_FILE,
    admissionScript: PAID_SLOT_SCRIPT,
    confirmLive: '',
    dispatchKey: input.dispatchKey,
    mission: input.mission,
    lane: '',
    submitted: false,
    gatesRemaining: GATES_REMAINING,
  };
}

/**
 * GitHub's hosted-job cap. It is not the admission clock. A job that can
 * spend starts when the operator claim records dispatch, and this cap is
 * measured from that dispatch.
 */
export const GITHUB_HOSTED_JOB_CAP_MS = 360 * 60_000;

/**
 * The paid-slot wait (`timeout-minutes: 350` on the `paid-slot` job).
 * It starts at the recorded dispatch time. It does not start at Accepted.
 */
export const PAID_SLOT_WINDOW_MS = 350 * 60_000;

/**
 * The held phase before the operator claim (L-6).
 *
 * A single 360-minute admission window that started at Accepted also had to
 * cover the manual claim and this 350-minute slot wait, which left about
 * 5 minutes. This window is that held phase alone. It starts at Accepted
 * (`receivedAt`). It does not contain the slot wait, and it spends nothing.
 */
export const AWAITING_OPERATOR_WINDOW_MS = GITHUB_HOSTED_JOB_CAP_MS;

/**
 * Closed status `state` values the status route may return.
 *
 * Writers:
 * - the admission store: `RESERVED`, `ADMISSION_HELD`, `LEDGER_UNWRITTEN`,
 *   `INTERRUPTED`, `FAILED` (projected below)
 * - the held phase before the claim: `awaiting_operator`, until
 *   `AWAITING_OPERATOR_WINDOW_MS` after Accepted
 * - the operator claim: `dispatching` (its reservation, written before it
 *   spawns `gh workflow run`; not a dispatch), then `dispatched` (only after
 *   that child exited 0 with no halt), `dispatch_failed`, `already_spent`
 * - `status --watch`: only a member of this list other than `unknown`
 *
 * `unknown` is the route's answer when a stored token is outside this list.
 * It is never a terminal state.
 */
export const WONDERLAND_STATUS_STATES = [
  'held',
  'reserved',
  'awaiting_operator',
  'ledger_unwritten',
  'interrupted',
  'failed',
  'dispatching',
  'dispatched',
  'dispatch_failed',
  'already_spent',
  'unknown',
] as const;

export type WonderlandStatusState = (typeof WONDERLAND_STATUS_STATES)[number];

/**
 * Closed status `cause` values. The claim tool records
 * `RUN_ID_ALREADY_SPENT`, `SPENT_TAG_UNVERIFIED`, and
 * `gh_workflow_run_failed`. `AWAITING_OPERATOR_EXPIRED` is the non-paid end
 * of the held phase: the workflow was not started. `status --watch` may
 * record only a member of this list, and only through the transition below.
 */
export const WONDERLAND_STATUS_CAUSES = [
  'RUN_ID_ALREADY_SPENT',
  'SPENT_TAG_UNVERIFIED',
  'gh_workflow_run_failed',
  'AWAITING_OPERATOR_EXPIRED',
] as const;

export type WonderlandStatusCause = (typeof WONDERLAND_STATUS_CAUSES)[number];

/**
 * States a record does not leave. `unknown` is absent on purpose: an
 * unrecognized stored token is not a finished run. `awaiting_operator` is
 * absent on purpose: the operator can still claim.
 */
export const WONDERLAND_STATUS_TERMINAL_STATES = [
  'ledger_unwritten',
  'interrupted',
  'failed',
  'dispatch_failed',
  'already_spent',
] as const;

export type WonderlandStatusTerminalState = (typeof WONDERLAND_STATUS_TERMINAL_STATES)[number];

const STATUS_STATE_SET: ReadonlySet<string> = new Set(WONDERLAND_STATUS_STATES);
const STATUS_CAUSE_SET: ReadonlySet<string> = new Set(WONDERLAND_STATUS_CAUSES);
const TERMINAL_STATE_SET: ReadonlySet<string> = new Set(WONDERLAND_STATUS_TERMINAL_STATES);

export interface WonderlandStatusProjection {
  readonly state: WonderlandStatusState;
  readonly cause?: WonderlandStatusCause;
}

export function isWonderlandStatusState(value: string): value is WonderlandStatusState {
  return STATUS_STATE_SET.has(value);
}

export function isWonderlandStatusCause(value: string): value is WonderlandStatusCause {
  return STATUS_CAUSE_SET.has(value);
}

/** `unknown` is never terminal. */
export function isWonderlandStatusTerminal(state: WonderlandStatusState): boolean {
  return state !== 'unknown' && TERMINAL_STATE_SET.has(state);
}

/** Admission-store state, as the status route spells it. Anything else is `unknown`. */
export function wonderlandStatusStateFromAdmission(state: string): WonderlandStatusState {
  switch (state) {
    case 'RESERVED':
      return 'reserved';
    case 'ADMISSION_HELD':
      return 'held';
    case 'LEDGER_UNWRITTEN':
      return 'ledger_unwritten';
    case 'INTERRUPTED':
      return 'interrupted';
    case 'FAILED':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Validate a stored state and cause. A state outside the union, or a cause
 * outside the union, is `state: "unknown"` with no cause. A stored `unknown`
 * also drops its cause.
 */
export function projectWonderlandStatus(input: {
  readonly state: string;
  readonly cause: string | null;
}): WonderlandStatusProjection {
  if (!isWonderlandStatusState(input.state) || input.state === 'unknown') return { state: 'unknown' };
  if (input.cause === null || input.cause === '') return { state: input.state };
  if (!isWonderlandStatusCause(input.cause)) return { state: 'unknown' };
  return { state: input.state, cause: input.cause };
}

/**
 * Admission terminals, in both spellings. After a recorded dispatch these
 * states, and a cause of the same name, are not a legal write.
 */
export const POST_DISPATCH_ADMISSION_TERMINAL_STATES = [
  'INTERRUPTED',
  'FAILED',
  'interrupted',
  'failed',
] as const;

export const POST_DISPATCH_ADMISSION_TERMINAL_CAUSES = [
  'INTERRUPTED',
  'FAILED',
  'interrupted',
  'failed',
] as const;

/** Terminal outcomes the slot and the spent-tag path may still record after dispatch. */
export const SLOT_SPENT_TAG_TERMINAL_STATES = [
  'dispatch_failed',
  'already_spent',
] as const satisfies readonly WonderlandStatusTerminalState[];

const POST_DISPATCH_ADMISSION_STATE_SET: ReadonlySet<string> = new Set(POST_DISPATCH_ADMISSION_TERMINAL_STATES);
const POST_DISPATCH_ADMISSION_CAUSE_SET: ReadonlySet<string> = new Set(POST_DISPATCH_ADMISSION_TERMINAL_CAUSES);
const SLOT_SPENT_TAG_TERMINAL_SET: ReadonlySet<string> = new Set(SLOT_SPENT_TAG_TERMINAL_STATES);

export type WonderlandStatusTransitionRefusal = 'post_dispatch_admission_terminal_refused';

export type WonderlandStatusTransition =
  | { readonly ok: true; readonly projection: WonderlandStatusProjection }
  | { readonly ok: false; readonly reason: WonderlandStatusTransitionRefusal };

/**
 * The only write of a status. Once the operator claim has recorded dispatch,
 * `INTERRUPTED` / `FAILED` (either spelling) and a cause of those names are
 * refused. A terminal write after that point has to be a slot or spent-tag
 * outcome (`dispatch_failed`, `already_spent`). The awaiting-operator expiry
 * is not one of those: it is a pre-claim, non-paid cause.
 */
export function applyWonderlandStatusTransition(input: {
  readonly dispatched: boolean;
  readonly proposedState: string;
  readonly proposedCause: string | null;
}): WonderlandStatusTransition {
  const cause = input.proposedCause === '' ? null : input.proposedCause;
  const admissionTerminal = POST_DISPATCH_ADMISSION_STATE_SET.has(input.proposedState)
    || (cause !== null && POST_DISPATCH_ADMISSION_CAUSE_SET.has(cause));
  const normalized = normalizeProposedState(input.proposedState);
  const projection = projectWonderlandStatus({ state: normalized, cause });
  const slotTerminal = SLOT_SPENT_TAG_TERMINAL_SET.has(projection.state);
  const operatorExpiry = cause === 'AWAITING_OPERATOR_EXPIRED' || projection.cause === 'AWAITING_OPERATOR_EXPIRED';
  if (input.dispatched && (admissionTerminal || operatorExpiry || (isWonderlandStatusTerminal(projection.state) && !slotTerminal))) {
    return { ok: false, reason: 'post_dispatch_admission_terminal_refused' };
  }
  return { ok: true, projection };
}

function normalizeProposedState(state: string): string {
  switch (state) {
    case 'INTERRUPTED':
      return 'interrupted';
    case 'FAILED':
      return 'failed';
    case 'RESERVED':
      return 'reserved';
    case 'ADMISSION_HELD':
      return 'held';
    case 'LEDGER_UNWRITTEN':
      return 'ledger_unwritten';
    default:
      return state;
  }
}

export type WonderlandAdmissionClock =
  | { readonly kind: 'awaiting_operator'; readonly expiresAtMs: number }
  | {
    readonly kind: 'operator_expired';
    readonly projection: WonderlandStatusProjection;
    readonly expiredAtMs: number;
  }
  | {
    readonly kind: 'slot';
    readonly startsAtMs: number;
    readonly endsAtMs: number;
    readonly elapsed: boolean;
  }
  | { readonly kind: 'unreadable' };

/**
 * Two clocks. Before the claim, the held phase is `awaiting_operator` from
 * Accepted until `AWAITING_OPERATOR_WINDOW_MS`. The comparison is the slot
 * script's: still open at exactly the window, expired on the next millisecond.
 * After the claim, the slot window starts at the recorded dispatch time.
 * A dispatch wins over an awaiting-operator expiry: the claim was recorded.
 */
export function evaluateWonderlandAdmissionClock(input: {
  readonly acceptedAtMs: number;
  readonly nowMs: number;
  readonly dispatchedAtMs: number | null;
}): WonderlandAdmissionClock {
  if (input.dispatchedAtMs !== null) {
    if (!Number.isFinite(input.dispatchedAtMs) || !Number.isFinite(input.nowMs)) return { kind: 'unreadable' };
    const endsAtMs = input.dispatchedAtMs + PAID_SLOT_WINDOW_MS;
    return {
      kind: 'slot',
      startsAtMs: input.dispatchedAtMs,
      endsAtMs,
      elapsed: input.nowMs - input.dispatchedAtMs > PAID_SLOT_WINDOW_MS,
    };
  }
  if (!Number.isFinite(input.acceptedAtMs) || !Number.isFinite(input.nowMs)) return { kind: 'unreadable' };
  const expiresAtMs = input.acceptedAtMs + AWAITING_OPERATOR_WINDOW_MS;
  if (input.nowMs - input.acceptedAtMs > AWAITING_OPERATOR_WINDOW_MS) {
    const transition = applyWonderlandStatusTransition({
      dispatched: false,
      proposedState: 'failed',
      proposedCause: 'AWAITING_OPERATOR_EXPIRED',
    });
    if (!transition.ok) return { kind: 'unreadable' };
    return { kind: 'operator_expired', projection: transition.projection, expiredAtMs: expiresAtMs + 1 };
  }
  return { kind: 'awaiting_operator', expiresAtMs };
}

export type UnclaimedHeldPhase =
  | {
    readonly kind: 'awaiting_operator';
    readonly projection: WonderlandStatusProjection;
    readonly updatedAt: string;
  }
  | {
    readonly kind: 'operator_expired';
    readonly projection: WonderlandStatusProjection;
    readonly updatedAt: string;
  }
  | {
    readonly kind: 'unreadable';
    readonly projection: WonderlandStatusProjection;
    readonly updatedAt: string;
  };

/**
 * The held phase before any claim. `receivedAt` is Accepted. `nowMs` is the
 * server clock. An unreadable clock stays `held` and is not expiry.
 */
export function projectUnclaimedHeldPhase(receivedAt: string, nowMs: number): UnclaimedHeldPhase {
  const phase = evaluateWonderlandAdmissionClock({
    acceptedAtMs: Date.parse(receivedAt),
    nowMs,
    dispatchedAtMs: null,
  });
  if (phase.kind === 'awaiting_operator') {
    return { kind: 'awaiting_operator', projection: { state: 'awaiting_operator' }, updatedAt: receivedAt };
  }
  if (phase.kind === 'operator_expired') {
    return {
      kind: 'operator_expired',
      projection: phase.projection,
      updatedAt: new Date(phase.expiredAtMs).toISOString(),
    };
  }
  return {
    kind: 'unreadable',
    projection: projectWonderlandStatus({
      state: wonderlandStatusStateFromAdmission('ADMISSION_HELD'),
      cause: null,
    }),
    updatedAt: receivedAt,
  };
}
