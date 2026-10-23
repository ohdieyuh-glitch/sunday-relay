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

const PIN_LINE = /^(OPENAI_PROMPT_ARCHITECT_MODEL|RELAY_HOSTED_CODING_MODEL|RELAY_HERMES_PROVIDER|RELAY_HERMES_MODEL):\s*(\S+)\s*$/;

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
  const one = (name: string): string | null => found[name][0] ?? null;
  return {
    ok: true,
    pins: {
      architectModel: one('OPENAI_PROMPT_ARCHITECT_MODEL'),
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
