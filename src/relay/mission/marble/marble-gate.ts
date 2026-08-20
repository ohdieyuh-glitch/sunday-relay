import type {
  MarbleEvent,
  MarbleEventType,
  MarbleGenerationOperation,
  MarbleGenerationRequest,
  MarbleModel,
} from './marble-contracts';

/**
 * MARBLE COST AND SECURITY GATE.
 *
 * Marble generation costs the founder money, so the default in every direction
 * is NO: the feature is off unless switched on, a request is a draft unless
 * approved, and the provider is the mock unless a live one is deliberately
 * supplied. Every one of those is fail-closed — a missing setting reads as
 * "not allowed", never as "assume yes".
 *
 * PURE. Configuration arrives as a plain object because the domain may not
 * read `process.env`; the composition root does that and passes it in.
 */

/* ----------------------------------------------------------- the flag */

export interface MarbleConfig {
  /** MARBLE_ENABLED. Absent or anything but an explicit true reads as off. */
  readonly enabled: boolean;
  /**
   * Whether a live provider may be used at all. Separate from `enabled` on
   * purpose: the feature being available and real money being spendable are
   * different decisions, and collapsing them is how a dry run becomes a bill.
   */
  readonly liveGenerationAllowed: boolean;
  /** Whether a credential is present. NEVER the credential itself. */
  readonly credentialConfigured: boolean;
  /** Ceiling on how many live generations this project may have outstanding. */
  readonly maxConcurrentLive: number;
}

/**
 * Read a config from a string map, fail-closed.
 *
 * Only the exact string "true" enables anything. "1", "yes", "TRUE" and a
 * typo all read as off, because a guard whose cheapest bypass is a plausible
 * misspelling is not a guard.
 */
export function readMarbleConfig(env: Readonly<Record<string, string | undefined>>): MarbleConfig {
  const on = (k: string) => env[k] === 'true';
  const key = env.WORLDLABS_API_KEY;
  const max = Number.parseInt(env.MARBLE_MAX_CONCURRENT ?? '', 10);
  return {
    enabled: on('MARBLE_ENABLED'),
    liveGenerationAllowed: on('MARBLE_LIVE_GENERATION_ALLOWED'),
    credentialConfigured: typeof key === 'string' && key.trim() !== '',
    maxConcurrentLive: Number.isFinite(max) && max > 0 ? max : 1,
  };
}

/* -------------------------------------------------------- the approval */

/**
 * What the founder is being asked to approve.
 *
 * REQUESTED, not actual. Relay does not know what a generation will cost and
 * says so rather than printing a number it made up: `estimatedUnits` is what
 * the caller declared it expects to consume, and `estimateSource` says where
 * that came from. An estimate with no source is not shown as a cost.
 */
export interface MarbleApprovalAsk {
  readonly requestId: string;
  readonly projectId: string;
  readonly regionId: string;
  readonly model: MarbleModel;
  readonly promptSummary: string;
  readonly estimatedUnits: number | null;
  readonly estimateSource: 'provider_quote' | 'caller_declared' | 'unknown';
  readonly reusesExistingWorld: string | null;
}

export interface MarbleGateDecision {
  readonly allowed: boolean;
  /** Machine-readable reason. Empty when allowed. */
  readonly refusal:
    | ''
    | 'feature_disabled'
    | 'live_generation_not_allowed'
    | 'no_credential'
    | 'not_approved'
    | 'already_submitted'
    | 'concurrency_limit'
    | 'duplicate_request';
  readonly detail: string;
}

const ALLOW: MarbleGateDecision = { allowed: true, refusal: '', detail: '' };

/**
 * The one place that decides whether a REAL, billable generation may be sent.
 *
 * Called with everything it needs rather than reaching for it, so it can be
 * tested exhaustively and so there is no second path to the provider that
 * skipped a check. If this returns anything but allowed, no request is made.
 */
export function decideMarbleGate(input: {
  readonly config: MarbleConfig;
  readonly operation: MarbleGenerationOperation;
  readonly liveInFlight: number;
  /** Dedupe keys already generated for this project, if any. */
  readonly existingWorldByDedupe?: Readonly<Record<string, string>>;
}): MarbleGateDecision {
  const { config, operation, liveInFlight } = input;

  if (!config.enabled) {
    return { allowed: false, refusal: 'feature_disabled', detail: 'MARBLE_ENABLED is not true' };
  }
  if (!config.liveGenerationAllowed) {
    return {
      allowed: false,
      refusal: 'live_generation_not_allowed',
      detail: 'live generation requires MARBLE_LIVE_GENERATION_ALLOWED=true',
    };
  }
  if (!config.credentialConfigured) {
    return {
      allowed: false,
      refusal: 'no_credential',
      detail: 'no World Labs credential is configured on the server',
    };
  }
  // ALREADY-SUBMITTED IS CHECKED FIRST, and the order is the point.
  //
  // A submitted operation is not in state `approved`, so an approval-first
  // check reports it as `not_approved` — which is true of the state machine and
  // deeply misleading to a human. It sends someone to approve it again and
  // resend, which is precisely the double-bill this gate exists to prevent. The
  // more specific and more expensive mistake gets named first. Caught by a test
  // that expected the useful answer rather than the reachable one.
  if (operation.operationId !== null) {
    return {
      allowed: false,
      refusal: 'already_submitted',
      detail: `operation already has provider id ${operation.operationId}; poll it, do not resend`,
    };
  }
  if (operation.state !== 'approved' || !operation.approvedBy) {
    return {
      allowed: false,
      refusal: 'not_approved',
      detail: `operation is ${operation.state}; explicit founder approval is required`,
    };
  }
  const existing = input.existingWorldByDedupe?.[operation.dedupeKey];
  if (existing) {
    return {
      allowed: false,
      refusal: 'duplicate_request',
      detail: `an identical request already produced world ${existing}; reuse it`,
    };
  }
  if (liveInFlight >= config.maxConcurrentLive) {
    return {
      allowed: false,
      refusal: 'concurrency_limit',
      detail: `${liveInFlight} live generation(s) already in flight`,
    };
  }
  return ALLOW;
}

/** Move a draft to awaiting approval. */
export function requestMarbleApproval(
  op: MarbleGenerationOperation,
): MarbleGenerationOperation {
  if (op.state !== 'draft') throw new Error(`cannot request approval from state ${op.state}`);
  return { ...op, state: 'awaiting_approval' };
}

/**
 * Record an explicit approval.
 *
 * `approvedBy` is required and must be a real identity, because "approved" with
 * nobody attached is exactly the audit hole this gate exists to close.
 */
export function approveMarbleGeneration(
  op: MarbleGenerationOperation,
  approvedBy: string,
  atIso: string,
): MarbleGenerationOperation {
  if (op.state !== 'awaiting_approval') {
    throw new Error(`cannot approve from state ${op.state}`);
  }
  if (!approvedBy.trim()) throw new Error('approvedBy is required');
  return { ...op, state: 'approved', approvedBy, approvedAtIso: atIso };
}

/* ------------------------------------------------------ secret hygiene */

/**
 * Anything that looks like a World Labs credential, so it can be kept out of
 * events, logs and anything a browser can read.
 *
 * Matches on SHAPE rather than on a variable name, because the leak that
 * matters is a key pasted into a prompt or echoed in an error body, and that
 * one never arrives labelled.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bwl[_-][A-Za-z0-9]{16,}\b/g,
  /\bWLT-Api-Key\s*:\s*\S+/gi,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
];

export function redactMarbleSecrets(text: string): string {
  let out = text;
  for (const re of CREDENTIAL_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/**
 * Fields a browser may never be given.
 *
 * The credential is server-side only. This list exists so a projection can be
 * checked against it structurally rather than by remembering.
 */
export const MARBLE_SERVER_ONLY_FIELDS: readonly string[] = [
  'apiKey',
  'WORLDLABS_API_KEY',
  'WLT-Api-Key',
  'credential',
  'authorization',
];

/**
 * True when a payload carries anything the browser must not see. Key names are
 * compared case-insensitively, and values are scanned for credential shapes.
 */
export function leaksMarbleSecret(payload: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return CREDENTIAL_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(v));
    if (typeof v !== 'object') return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (MARBLE_SERVER_ONLY_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase())) return true;
      if (walk(val)) return true;
    }
    return false;
  };
  return walk(payload);
}

/* ------------------------------------------------------------ evidence */

/**
 * Build a durable event. Detail values are redacted on the way in, so a
 * provider error body containing a key cannot become a permanent record of it.
 */
export function marbleEvent(
  type: MarbleEventType,
  req: Pick<MarbleGenerationRequest, 'requestId' | 'projectId' | 'regionId'>,
  atIso: string,
  detail: Readonly<Record<string, string | number | boolean | null>> = {},
): MarbleEvent {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail)) {
    clean[k] = typeof v === 'string' ? redactMarbleSecrets(v) : v;
  }
  return {
    type,
    requestId: req.requestId,
    projectId: req.projectId,
    regionId: req.regionId,
    atIso,
    detail: clean,
  };
}
