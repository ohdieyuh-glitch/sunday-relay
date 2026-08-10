/**
 * LIVE REACH — current external information, as a Relay capability.
 *
 * A model carries training knowledge that may be stale. A Mission that needs
 * to know what is true NOW needs an observation, not a recollection. Live
 * Reach is the part of Relay's Evidence & Retrieval architecture that fetches
 * those observations and hands them back as attributable evidence.
 *
 * IT IS NOT A NEW SUBSYSTEM. It is a source class beside the others — the
 * Project Brain, the repository, documents, ordinary web retrieval — and it
 * runs through the MCP Gateway, the existing permission model and the existing
 * network policy. Nothing here owns Mission truth, permissions or completion.
 *
 * TWO IDEAS ADAPTED FROM AGENT REACH, and one correction.
 *
 * Agent Reach (`Panniantong/Agent-Reach`) contributes its routing shape — a
 * source has an ORDERED list of candidate backends, and switching backends
 * means reordering the list rather than rewriting code — and its readiness
 * taxonomy, which exists because `which()` finding a binary is not proof that
 * the binary runs. Both are recorded in `docs/relay/AGENT_REACH_EVALUATION.md`
 * with citations.
 *
 * The correction is ours and it is load-bearing: Agent Reach has no write
 * operations at all, so it never had to ask whether fallback is safe. For a
 * READ it usually is. For an EXTERNAL MUTATION it is how the same post gets
 * published twice. See `mayFallBackAfter`.
 *
 * Nothing in this file performs I/O, reads a clock, or touches Node. Times
 * arrive as ISO strings from the caller, the same rule the rest of
 * `src/relay/mission` holds, so the browser and the CLI reach identical
 * conclusions about the same record.
 */

/* ------------------------------------------------------------- sources */

/**
 * The source classes Relay models.
 *
 * A source appearing here is NOT a claim that Relay can reach it. It is the
 * vocabulary; `LiveReachReadiness` is the claim, and it is answered per
 * deployment by a probe. Several of these will honestly report
 * `authentication_required` forever on a host with no connected account.
 */
export const LIVE_REACH_SOURCES = [
  'web',
  'github',
  'rss',
  'youtube',
  'x',
  'reddit',
  'linkedin',
  'instagram',
  'facebook',
] as const;
export type LiveReachSource = (typeof LIVE_REACH_SOURCES)[number];

/* -------------------------------------------------------- capabilities */

/**
 * READ capabilities — Relay's "eyes".
 *
 * Retrieval only. Every one of these produces an observation that becomes an
 * Evidence Artifact; none of them changes anything outside Relay.
 */
export const LIVE_REACH_READ_CAPABILITIES = [
  'search',
  'read_item',
  'read_comments',
  'read_profile',
  'read_feed',
  'read_media',
] as const;
export type LiveReachReadCapability = (typeof LIVE_REACH_READ_CAPABILITIES)[number];

/**
 * ACTION capabilities — external mutations performed as an account.
 *
 * Listed so the permission model and the settings surface have one vocabulary.
 * A capability being NAMED here is not a claim that any backend implements it:
 * a source exposes only what one of its backends actually supports, and
 * `supportedCapabilities` derives that from the registry rather than from this
 * list.
 */
export const LIVE_REACH_ACTION_CAPABILITIES = [
  'post',
  'reply',
  'comment',
  'message',
  'follow',
  'unfollow',
  'like',
  'delete',
  'apply',
] as const;
export type LiveReachActionCapability = (typeof LIVE_REACH_ACTION_CAPABILITIES)[number];

export type LiveReachCapability = LiveReachReadCapability | LiveReachActionCapability;

const ACTION_SET: ReadonlySet<string> = new Set(LIVE_REACH_ACTION_CAPABILITIES);

/** Whether a capability mutates something outside Relay. */
export function isActionCapability(capability: LiveReachCapability): boolean {
  return ACTION_SET.has(capability);
}

/* ----------------------------------------------------------- readiness */

/**
 * What a deployment can honestly say about a source.
 *
 * `ready` is the ONLY state that claims a capability works, and it is reached
 * by observing it, never by finding configuration. The rest each name what is
 * missing, because "not ready" is not one fact — a missing credential and an
 * unreachable service call for different actions from the founder.
 */
export const LIVE_REACH_READINESS = [
  /** A probe ran and the capability answered. */
  'ready',
  /** The backend exists and needs an account Relay does not have. */
  'authentication_required',
  /** The backend exists and needs configuration Relay does not have. */
  'configuration_required',
  /** Registered, reachable in principle, not answering now. */
  'backend_unavailable',
  /** Answering, but refusing for volume. Real, and temporary. */
  'rate_limited',
  /** No registered backend performs this capability for this source. */
  'capability_unsupported',
  /** Nothing has been probed. NOT a synonym for unavailable. */
  'unknown',
] as const;
export type LiveReachReadiness = (typeof LIVE_REACH_READINESS)[number];

export const LIVE_REACH_READINESS_LABEL: Readonly<Record<LiveReachReadiness, string>> =
  Object.freeze({
    ready: 'READY',
    authentication_required: 'AUTHENTICATION REQUIRED',
    configuration_required: 'CONFIGURATION REQUIRED',
    backend_unavailable: 'BACKEND UNAVAILABLE',
    rate_limited: 'RATE LIMITED',
    capability_unsupported: 'CAPABILITY UNSUPPORTED',
    unknown: 'UNKNOWN',
  });

/**
 * What a probe observed about ONE backend.
 *
 * Adapted from Agent Reach's `probe.py`, which exists because three different
 * failures look identical to `which()`. The same distinction matters for a
 * network backend: reachable-but-unauthenticated, reachable-but-throttled and
 * unreachable are three different sentences to a founder.
 *
 * PROBES MUST BE SIDE-EFFECT FREE. Agent Reach documents the reason in its own
 * retry loop: a retry re-runs the command verbatim, so a non-idempotent probe
 * repeats its effect. A probe that posts is not a probe.
 */
export const BACKEND_PROBE_RESULTS = [
  'observed',
  'unauthenticated',
  'unconfigured',
  'unreachable',
  'throttled',
  'unsupported',
  'not_probed',
] as const;
export type BackendProbeResult = (typeof BACKEND_PROBE_RESULTS)[number];

export interface BackendProbe {
  readonly backendId: string;
  readonly capability: LiveReachCapability;
  readonly result: BackendProbeResult;
  /** ISO instant the probe ran, from the caller. Null when never probed. */
  readonly probedAt: string | null;
  /** Safe, human-readable detail. Never a credential, never raw output. */
  readonly detail?: string;
}

/* ------------------------------------------------------------ backends */

/**
 * One way to serve a capability for a source.
 *
 * `relayNative` marks a backend Relay implements and executes itself, inside
 * its own bounded transport. A backend that is NOT Relay-native runs somebody
 * else's runtime, and the evaluation of Agent Reach is why that distinction is
 * a field rather than a footnote: its retrieval model is "the agent runs a CLI
 * with the platform's cookies in its environment", which Relay does not do.
 */
export interface LiveReachBackend {
  readonly backendId: string;
  readonly displayName: string;
  /** Capabilities this backend actually implements. */
  readonly operations: readonly LiveReachCapability[];
  readonly requiresAuthentication: boolean;
  /**
   * Server-side configuration this backend reads, as NAMES.
   *
   * Domain-side only. The browser is never handed these — that boundary is
   * held by `browser-isolation.test.ts`, which walks the real import graph.
   */
  readonly requiredConfig: readonly string[];
  readonly relayNative: boolean;
  /** Why this backend exists, and what it cannot do. Shown to operators. */
  readonly notes: readonly string[];
}

export interface LiveReachSourceDefinition {
  readonly source: LiveReachSource;
  readonly displayName: string;
  /**
   * ORDERED candidates: `backends[0]` is preferred and the rest are fallbacks.
   *
   * Agent Reach's phrasing, kept because it is right: switching backends means
   * reordering this list or applying an operator override, never rewriting a
   * call site.
   */
  readonly backends: readonly LiveReachBackend[];
  /** Stated plainly where a source cannot be reached without an account. */
  readonly accessNote: string;
}

/* --------------------------------------------- requested versus actual */

/**
 * Which backend was ASKED FOR and which one actually ran.
 *
 * Relay's standing rule, applied here. A fallback that silently substitutes a
 * backend produces evidence whose provenance is a guess, and an action whose
 * audit record names the wrong system.
 */
export interface LiveReachAttempt {
  readonly source: LiveReachSource;
  readonly capability: LiveReachCapability;
  /** The backend Relay intended to use — the head of the candidate list. */
  readonly requestedBackendId: string;
  /**
   * The backend that actually executed, or `null` when nothing ran.
   * Null is not a synonym for the requested one.
   */
  readonly actualBackendId: string | null;
  readonly fallbackOccurred: boolean;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

/* -------------------------------------------------- action outcome law */

/**
 * How much Relay knows about an external mutation that was attempted.
 *
 * The middle two states are the entire point. A request that failed while
 * being written to the socket definitely did not post. A request that timed
 * out after the bytes left definitely might have. Collapsing those two into
 * "failed" is how a retry publishes the same thing twice.
 */
export const ACTION_OUTCOMES = [
  /** Nothing was sent. */
  'not_attempted',
  /** It failed BEFORE the external system could have acted. */
  'failed_before_action',
  /** Sent, and the result is genuinely not known. Stays unknown. */
  'unknown',
  /** Confirmed by the external system. */
  'succeeded',
  /** The external system answered, and refused. */
  'refused',
] as const;
export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];

/**
 * May Relay try the next backend after this outcome?
 *
 * Only when the action provably did not happen. `unknown` must never fall
 * through: the honest response to "did my post go out?" is to say it is
 * unknown and stop, not to post again and find out.
 *
 * This is the rule Agent Reach never needed, because it has no writes.
 */
export function mayFallBackAfter(outcome: ActionOutcome): boolean {
  return outcome === 'not_attempted' || outcome === 'failed_before_action';
}

/* ------------------------------------------------------------ refusals */

/**
 * Why a Live Reach request was refused, as codes.
 *
 * Codes rather than sentences so the bridge can report them on an
 * unauthenticated surface without leaking configuration, exactly as the role
 * slot refusals already do.
 */
export const LIVE_REACH_REFUSALS = [
  'source_unknown',
  'capability_unsupported',
  'integration_disabled',
  'read_disabled',
  'actions_disabled',
  'capability_disabled',
  'not_ready',
  'mission_does_not_authorize',
  'no_account_bound',
  'rate_limited',
  'network_policy_refused',
  /**
   * The mission's own retrieval cap, spent. Distinct from `rate_limited`,
   * which is somebody ELSE's limit reported back to us — one is Relay's
   * decision and one is a host's, and an operator needs to know which.
   */
  'retrieval_budget_exhausted',
  /**
   * A byte cap that cannot bind, because at least one read reported no size.
   * Refusing here rather than passing keeps a cap from looking enforced when
   * the total it sits over cannot account for everything that was read.
   */
  'byte_budget_unenforceable',
  'byte_budget_exhausted',
] as const;
export type LiveReachRefusal = (typeof LIVE_REACH_REFUSALS)[number];
