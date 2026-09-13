import { contentFingerprint } from '../evidence';
import {
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_READ_CAPABILITIES,
  LIVE_REACH_SOURCES,
  checkRetrievalBudget,
  emptyMeter,
  recordRetrieval,
  type LiveReachReadCapability,
  type LiveReachSource,
  type RetrievalBudget,
  type RetrievalMeter,
  type RetrievalRecord,
} from '../live-reach';

/**
 * GOVERNED RESEARCH — the mission's own authority over what its workers may
 * look at, and the only door through which any of them reaches outside.
 *
 * All three persistent slots — Prompt Architect, Coding Agent, Independent
 * Reviewer — are peers here, and that is the point. A coder with a shell and
 * an architect reduced to a prompt generator is not three intelligences; it is
 * one agent with two commentators. So there is ONE research mechanism, every
 * slot uses it, and no slot has a private path to the network.
 *
 * WHAT THIS MODULE IS. The mission's authority, stated as data and evaluated
 * purely: which sources, which read capabilities, which hosts, how much
 * retrieval each slot may spend. It decides BEFORE a socket opens.
 *
 * WHAT THIS MODULE IS NOT. It performs no retrieval, opens no connection and
 * knows nothing about HTTP. Live Reach already does that, already refuses
 * loopback, link-local, private and cloud-metadata addresses, already checks
 * every resolved address rather than the convenient one, and already re-checks
 * every redirect hop. Building a second network guard here would produce two
 * guards, one of them weaker, and the weaker one would eventually be the one
 * in the path. This module adds the thing Live Reach genuinely does not have:
 * a per-mission SOURCE AND HOST ALLOWLIST. `McpNetworkPolicy` governs address
 * CLASSES and nothing narrower — under it, `https://anything-public.example`
 * is as permitted as a vendor's own documentation.
 *
 * THE ALLOWLIST IS MISSION AUTHORITY.
 *
 *   - A worker's request cannot carry one. There is no field for it on
 *     `JuliusResearchRequest`, so "also allow this host" is not a sentence a
 *     model can say to this function.
 *   - Retrieved content cannot carry one either, because nothing downstream of
 *     a retrieval feeds back into a policy. Evidence is data all the way out.
 *   - A sealed policy is frozen and fingerprinted. If the object in the path
 *     is not the object the mission sealed, `authorizeJuliusResearch` refuses
 *     with `policy_tampered` rather than deciding under it.
 *
 * The fingerprint is FNV-1a, and this module says so rather than implying a
 * seal it does not have: it detects CHANGE, not a determined forger. The real
 * guarantee is structural — freezing, and the absence of any widening verb in
 * the module's own surface. There is deliberately no `widenJuliusResearchPolicy`,
 * no `allowHost`, no `addSource`. To research somewhere new, the mission is
 * re-sealed by whoever holds mission authority, on the record.
 *
 * Pure: no Node, no network, no clock. `now` arrives as an ISO string and every
 * decision is a function of its arguments, so the browser, the CLI and the
 * bridge reach the same verdict about the same request.
 */

export const JULIUS_RESEARCH_POLICY_VERSION = 'julius-research-policy.v1';

/* ------------------------------------------------------------ the slots */

/**
 * The three peer slots, each metered separately.
 *
 * Provenance is recorded PER SLOT and never pooled. A mission that spent all
 * its retrieval on the coder's questions and none on the reviewer's looks
 * identical to a balanced one in a single total; separated, the shape of the
 * mission is visible, and the effort-parity telemetry can read it.
 */
export const JULIUS_RESEARCH_ROLES = [
  'PROMPT_ARCHITECT',
  'CODING_AGENT',
  'INDEPENDENT_REVIEWER',
] as const;
export type JuliusResearchRole = (typeof JULIUS_RESEARCH_ROLES)[number];

export const isJuliusResearchRole = (value: string): value is JuliusResearchRole =>
  (JULIUS_RESEARCH_ROLES as readonly string[]).includes(value);

/* --------------------------------------------------------- the outcomes */

/**
 * WHAT HAPPENED TO A RESEARCH REQUEST — eight answers, never collapsed into
 * "no evidence".
 *
 * The distinction is not bookkeeping. Each one implies a different next move,
 * and a worker told only "nothing found" cannot make any of them:
 *
 *   observed             retrieved, and nothing in it looked like an
 *                        instruction. Evidence exists.
 *   injection_signaled   retrieved, AND the content carried instruction-shaped
 *                        phrases. Evidence also exists — this is not a failure
 *                        and the observation is not discarded. It is a
 *                        different KIND of success, recorded so the requesting
 *                        worker and the Reviewer both see that hostile text was
 *                        present, and so `juliusResearchMayCorroborate` can
 *                        refuse to let it settle a disagreement.
 *   policy_refused       the mission never authorized this. Retrying is
 *                        pointless; asking the mission is the move.
 *   budget_exhausted     authorized, but this slot or this mission has spent
 *                        its retrieval allowance. Later in this mission will
 *                        not help either.
 *   unreachable          nobody answered. Relay cannot tell whether the host
 *                        saw it, and the meter charges it anyway.
 *   unauthenticated      the host answered and wants a session Relay does not
 *                        hold and will not hold. A different source is the move.
 *   throttled            the host answered and said not so fast. Its own words
 *                        are kept.
 *   unsupported_content  the host answered with something Relay will not put in
 *                        front of a model — a binary, an unsupported type. The
 *                        reference survives; the bytes do not.
 */
export const JULIUS_RESEARCH_OUTCOMES = [
  'observed',
  'injection_signaled',
  'policy_refused',
  'budget_exhausted',
  'unreachable',
  'unauthenticated',
  'throttled',
  'unsupported_content',
] as const;
export type JuliusResearchOutcome = (typeof JULIUS_RESEARCH_OUTCOMES)[number];

/** The two outcomes that produced an observation. */
export const JULIUS_RESEARCH_OBSERVED_OUTCOMES: readonly JuliusResearchOutcome[] =
  Object.freeze(['observed', 'injection_signaled']);

export const juliusResearchProducedEvidence = (outcome: JuliusResearchOutcome): boolean =>
  JULIUS_RESEARCH_OBSERVED_OUTCOMES.includes(outcome);

/**
 * May this observation help settle a disagreement between sources?
 *
 * Instruction-shaped content may be perfectly true and is kept either way. It
 * may not be the thing that TIPS a conflict, because the cheapest attack on a
 * corroboration rule is to publish the corroboration.
 */
export const juliusResearchMayCorroborate = (outcome: JuliusResearchOutcome): boolean =>
  outcome === 'observed';

/** Why Relay itself refused, before anything was attempted. */
export const JULIUS_RESEARCH_REFUSALS = [
  'research_not_authorized',
  'role_not_authorized',
  'reference_unparsable',
  'scheme_not_allowed',
  'source_not_allowed',
  'capability_not_allowed',
  'host_not_allowed',
  'policy_tampered',
  /**
   * The mission allowlisted this host and Relay's ADDRESS policy still refused
   * it — a name that resolves to a private, loopback, link-local or cloud
   * metadata address, or a redirect toward one. Mission authority names hosts;
   * it has never been able to authorize an address class, and this is the code
   * that says which of the two said no.
   */
  'network_policy_refused',
  /**
   * The source or capability is not switched on, not ready, or has no backend
   * in this deployment. Nothing about the mission's policy is wrong; the
   * machinery underneath it cannot serve the request today.
   */
  'capability_unavailable',
  'mission_budget_exhausted',
  'role_budget_exhausted',
  'byte_budget_unenforceable',
  'byte_budget_exhausted',
] as const;
export type JuliusResearchRefusal = (typeof JULIUS_RESEARCH_REFUSALS)[number];

/* ---------------------------------------------------------- the policy */

/**
 * One source, the read capabilities permitted on it, and the hosts it may
 * reach.
 *
 * ACTION CAPABILITIES ARE NOT RESEARCH and cannot appear here. Posting,
 * replying, following and deleting are external mutations performed as an
 * account; research is looking. `sealJuliusResearchPolicy` rejects an
 * allowance naming one outright rather than refusing it per request, because a
 * mission document that CLAIMS a worker may post is already wrong even if no
 * worker ever tries.
 */
export interface JuliusResearchAllowance {
  readonly source: LiveReachSource;
  readonly capabilities: readonly LiveReachReadCapability[];
  /**
   * Exact hosts (`docs.python.org`) or single-wildcard suffixes
   * (`*.python.org`).
   *
   * A suffix does NOT match its own apex: `*.python.org` permits
   * `docs.python.org` and refuses `python.org`. A mission that wants both says
   * both. The alternative — a wildcard that silently includes the apex — is
   * the reading that surprises somebody later, and surprise in an allowlist is
   * a hole.
   */
  readonly hosts: readonly string[];
}

export interface JuliusResearchPolicy {
  readonly version: typeof JULIUS_RESEARCH_POLICY_VERSION;
  readonly missionId: string;
  readonly allowances: readonly JuliusResearchAllowance[];
  /** Which slots may research at all. A slot absent here is refused by name. */
  readonly roles: readonly JuliusResearchRole[];
  /** The whole mission's ceiling, across all three slots. */
  readonly missionBudget: RetrievalBudget;
  /** Each slot's own ceiling. A slot may not spend another slot's allowance. */
  readonly roleBudget: RetrievalBudget;
  readonly fingerprint: string;
}

/** A mission that authorizes no research at all. The default, and honest. */
export function noJuliusResearch(missionId: string): JuliusResearchPolicy {
  return sealJuliusResearchPolicy({
    missionId,
    allowances: [],
    roles: [],
    missionBudget: { maxRetrievals: 0, maxBytes: null },
    roleBudget: { maxRetrievals: 0, maxBytes: null },
  });
}

export interface JuliusResearchPolicyDraft {
  readonly missionId: string;
  readonly allowances: readonly JuliusResearchAllowance[];
  readonly roles: readonly JuliusResearchRole[];
  readonly missionBudget: RetrievalBudget;
  readonly roleBudget: RetrievalBudget;
}

/* ------------------------------------------------------- host matching */

/** Lowercase, drop the root dot. Nothing else — no punycode, no resolution. */
const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/\.$/u, '');

/** A DNS name, in the only shape an allowlist entry may take. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

const isHostName = (host: string): boolean => {
  if (host.length === 0 || host.length > 253) return false;
  // An address is not a name. Address classes are Live Reach's business, and
  // a literal in a research allowlist is nearly always somebody reaching for
  // something that has no name because it is not meant to be reached.
  if (IPV4_LITERAL.test(host) || host.includes(':')) return false;
  const labels = host.split('.');
  return labels.length >= 2 && labels.every((label) => HOST_LABEL.test(label));
};

/**
 * Does this host fall under this allowlist entry?
 *
 * The three ways a naive suffix check leaks, all closed here:
 *   `evilpython.org`      must not match `*.python.org`  (label boundary)
 *   `python.org.evil.com` must not match `*.python.org`  (suffix, not substring)
 *   `python.org`          must not match `*.python.org`  (apex is not a child)
 */
export function juliusResearchHostMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern);
  const h = normalizeHost(host);
  if (p.length === 0 || h.length === 0) return false;
  if (!p.startsWith('*.')) return p === h;
  const suffix = p.slice(2);
  if (suffix.length === 0) return false;
  return h.length > suffix.length + 1 && h.endsWith(`.${suffix}`);
}

/**
 * THE HOST A WORKER ASKED FOR, IN THE ONE SHAPE SAFE TO RECORD.
 *
 * Paid run 34757974058 recorded four research refusals with no reason and no
 * target, so nobody could say whether the workers asked for a host the mission
 * never granted or Relay refused one it had. The durable row now names the host
 * the ask reached for, and ONLY the host: a path or a query is the worker's own
 * text and can carry anything, while the host is the part of a reference the
 * allowlist decides on. It is read exactly as `authorizeJuliusResearch` reads
 * it, so the recorded host is the one the policy compared.
 *
 * NULL WHEN THERE IS NO NAME: an unparsable reference or an address literal.
 * Unknown is not a host, and an address is not a name.
 */
export function juliusResearchRequestedHost(reference: string): string | null {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return null;
  }
  const host = normalizeHost(url.hostname);
  return isHostName(host) ? host : null;
}

/* ------------------------------------------------------------ sealing */

const FINGERPRINT_OF = (draft: JuliusResearchPolicyDraft): string => contentFingerprint(JSON.stringify([
  JULIUS_RESEARCH_POLICY_VERSION,
  draft.missionId,
  [...draft.roles].sort(),
  draft.allowances.map((allowance) => [
    allowance.source,
    [...allowance.capabilities].sort(),
    [...allowance.hosts].map(normalizeHost).sort(),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  [draft.missionBudget.maxRetrievals, draft.missionBudget.maxBytes],
  [draft.roleBudget.maxRetrievals, draft.roleBudget.maxBytes],
]));

/**
 * Validate, normalize, freeze and fingerprint.
 *
 * Everything wrong with a policy is wrong HERE, where mission authority is
 * being exercised and a human can be told. A policy that reached the request
 * path and failed there would fail as "research refused", which reads like the
 * mission working as intended rather than a mission document with a mistake
 * in it.
 */
export function sealJuliusResearchPolicy(draft: JuliusResearchPolicyDraft): JuliusResearchPolicy {
  if (draft.missionId.trim().length === 0) throw new Error('research_policy_mission_required');

  for (const role of draft.roles) {
    if (!isJuliusResearchRole(role)) throw new Error('research_policy_role_unknown');
  }

  const seenSources = new Set<string>();
  const allowances = draft.allowances.map((allowance): JuliusResearchAllowance => {
    if (!(LIVE_REACH_SOURCES as readonly string[]).includes(allowance.source)) {
      throw new Error('research_policy_source_unknown');
    }
    if (seenSources.has(allowance.source)) throw new Error('research_policy_source_duplicated');
    seenSources.add(allowance.source);

    if (allowance.capabilities.length === 0) throw new Error('research_policy_capability_required');
    for (const capability of allowance.capabilities) {
      if ((LIVE_REACH_ACTION_CAPABILITIES as readonly string[]).includes(capability)) {
        // Research is looking. A mission cannot authorize a worker to act on
        // the world by putting the verb in a research allowlist.
        throw new Error('research_policy_action_capability');
      }
      if (!(LIVE_REACH_READ_CAPABILITIES as readonly string[]).includes(capability)) {
        throw new Error('research_policy_capability_unknown');
      }
    }

    if (allowance.hosts.length === 0) throw new Error('research_policy_host_required');
    const hosts = allowance.hosts.map((raw) => {
      const host = normalizeHost(raw);
      if (host === '*' || host === '') throw new Error('research_policy_host_too_broad');
      if (host.includes('/') || host.includes('@') || host.includes(' ') || host.includes(':')) {
        // A URL, a port or userinfo in a host slot. Whoever wrote it meant
        // something, and matching it against a hostname would mean something
        // else. Refuse rather than silently never match.
        throw new Error('research_policy_host_not_a_name');
      }
      if (host.startsWith('*.')) {
        const suffix = host.slice(2);
        // `*.com` is not an allowlist. Two labels is the shortest thing that
        // names somebody rather than a whole namespace.
        //
        // SAID PLAINLY: this is not a public-suffix check, and `*.co.uk` gets
        // through it. A pure domain module has no suffix list and inventing a
        // partial one would be worse than none — it would read as complete.
        // The mission author is the authority on what its own allowlist means,
        // and the Reviewer sees the sealed policy.
        if (suffix.split('.').length < 2) throw new Error('research_policy_host_too_broad');
        if (!isHostName(suffix)) throw new Error('research_policy_host_not_a_name');
        return host;
      }
      if (!isHostName(host)) throw new Error('research_policy_host_not_a_name');
      return host;
    });

    return Object.freeze({
      source: allowance.source,
      capabilities: Object.freeze([...allowance.capabilities].sort()) as readonly LiveReachReadCapability[],
      hosts: Object.freeze([...hosts].sort()),
    });
  });

  for (const budget of [draft.missionBudget, draft.roleBudget]) {
    if (budget.maxRetrievals !== null && (!Number.isInteger(budget.maxRetrievals) || budget.maxRetrievals < 0)) {
      throw new Error('research_policy_budget_invalid');
    }
    if (budget.maxBytes !== null && (!Number.isInteger(budget.maxBytes) || budget.maxBytes < 0)) {
      throw new Error('research_policy_budget_invalid');
    }
  }

  const normalized: JuliusResearchPolicyDraft = {
    missionId: draft.missionId,
    allowances,
    roles: Object.freeze([...draft.roles].sort()),
    missionBudget: Object.freeze({ ...draft.missionBudget }),
    roleBudget: Object.freeze({ ...draft.roleBudget }),
  };

  return Object.freeze({
    version: JULIUS_RESEARCH_POLICY_VERSION,
    missionId: normalized.missionId,
    allowances: Object.freeze(normalized.allowances),
    roles: normalized.roles,
    missionBudget: normalized.missionBudget,
    roleBudget: normalized.roleBudget,
    fingerprint: FINGERPRINT_OF(normalized),
  });
}

/** Is this the policy the mission sealed, byte for byte? */
export function juliusResearchPolicyIntact(policy: JuliusResearchPolicy): boolean {
  if (policy.version !== JULIUS_RESEARCH_POLICY_VERSION) return false;
  return FINGERPRINT_OF({
    missionId: policy.missionId,
    allowances: policy.allowances,
    roles: policy.roles,
    missionBudget: policy.missionBudget,
    roleBudget: policy.roleBudget,
  }) === policy.fingerprint;
}

/* ---------------------------------------------------------- the ledger */

/**
 * What each slot has spent, kept apart.
 *
 * Three meters and no fourth: the mission's total is DERIVED, so it can never
 * drift from the sum of its parts the way a separately-incremented total does.
 */
export interface JuliusResearchLedger {
  readonly missionId: string;
  readonly byRole: Readonly<Record<JuliusResearchRole, RetrievalMeter>>;
}

export function emptyJuliusResearchLedger(missionId: string): JuliusResearchLedger {
  const byRole = {} as Record<JuliusResearchRole, RetrievalMeter>;
  for (const role of JULIUS_RESEARCH_ROLES) byRole[role] = emptyMeter(missionId);
  return Object.freeze({ missionId, byRole: Object.freeze(byRole) });
}

export function recordJuliusResearch(
  ledger: JuliusResearchLedger,
  role: JuliusResearchRole,
  record: RetrievalRecord,
): JuliusResearchLedger {
  return Object.freeze({
    missionId: ledger.missionId,
    byRole: Object.freeze({
      ...ledger.byRole,
      [role]: recordRetrieval(ledger.byRole[role], record),
    }),
  });
}

/**
 * The mission's spend, folded from the three.
 *
 * `bytes` stays null until something is measured, and the fold preserves that:
 * three null sums make a null sum, not a zero.
 */
export function juliusMissionResearchMeter(ledger: JuliusResearchLedger): RetrievalMeter {
  let counted = 0;
  let unknownEffect = 0;
  let bytes: number | null = null;
  let unsized = 0;
  const bySource: Record<string, { counted: number; unknownEffect: number }> = {};
  let lastRetryAfter: string | null = null;
  let lastRetryAfterAt: string | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const role of JULIUS_RESEARCH_ROLES) {
    const meter = ledger.byRole[role];
    counted += meter.counted;
    unknownEffect += meter.unknownEffect;
    if (meter.bytes !== null) bytes = (bytes ?? 0) + meter.bytes;
    unsized += meter.unsized;
    for (const [source, usage] of Object.entries(meter.bySource)) {
      const prior = bySource[source] ?? { counted: 0, unknownEffect: 0 };
      bySource[source] = {
        counted: prior.counted + usage.counted,
        unknownEffect: prior.unknownEffect + usage.unknownEffect,
      };
    }
    // The newest throttle across the three slots wins, decided by WHEN it was
    // recorded rather than by which slot the fold happened to read first — a
    // total whose answer depends on iteration order is not a total.
    if (
      meter.lastRetryAfter !== null && meter.lastAt !== null
      && (lastRetryAfterAt === null || meter.lastAt > lastRetryAfterAt)
    ) {
      lastRetryAfter = meter.lastRetryAfter;
      lastRetryAfterAt = meter.lastAt;
    }
    if (meter.firstAt !== null && (firstAt === null || meter.firstAt < firstAt)) firstAt = meter.firstAt;
    if (meter.lastAt !== null && (lastAt === null || meter.lastAt > lastAt)) lastAt = meter.lastAt;
  }

  return {
    missionId: ledger.missionId,
    counted,
    unknownEffect,
    bytes,
    unsized,
    bySource,
    lastRetryAfter,
    firstAt,
    lastAt,
  };
}

/* --------------------------------------------------------- the request */

/**
 * What a worker may ask for.
 *
 * Note what is absent and cannot be added: no policy, no allowlist, no budget,
 * no override, no role claim of its own choosing. `role` is supplied by the
 * dispatcher from the task being executed, not by the model — a worker cannot
 * ask as somebody else because it never writes this field.
 *
 * `reference` is an absolute `https://` URL. A source-native identifier that
 * is not a URL is refused as `reference_unparsable` rather than guessed at:
 * guessing which host an opaque id belongs to is exactly how an allowlist gets
 * bypassed by a resolver nobody audited.
 */
export interface JuliusResearchRequest {
  readonly missionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly role: JuliusResearchRole;
  readonly source: LiveReachSource;
  readonly capability: LiveReachReadCapability;
  readonly reference: string;
  /** What the worker is trying to find out. Recorded with the evidence. */
  readonly purpose: string;
  readonly requestedAt: string;
}

export type JuliusResearchAuthorization =
  | {
    readonly ok: true;
    readonly role: JuliusResearchRole;
    readonly source: LiveReachSource;
    readonly capability: LiveReachReadCapability;
    /** The host the URL actually resolves to textually, after normalization. */
    readonly host: string;
    /** The allowlist entry that permitted it, for the record. */
    readonly matchedHost: string;
    readonly url: string;
    readonly policyFingerprint: string;
  }
  | {
    readonly ok: false;
    readonly outcome: 'policy_refused' | 'budget_exhausted';
    readonly refusal: JuliusResearchRefusal;
    readonly detail: string;
    readonly policyFingerprint: string;
  };

/**
 * May this worker look at this, right now?
 *
 * ORDER IS DELIBERATE. Policy is decided before budget, always. A request the
 * mission would never permit must not come back as "budget exhausted", because
 * that reads as "try later" for something that will never be allowed, and the
 * worker would spend its next turn waiting instead of asking the mission.
 *
 * A REFUSAL SPENDS NOTHING. Nothing here touches the ledger — `recordRetrieval`
 * already ignores `not_attempted`, and this function does not even call it.
 * The caller records only what it actually attempted.
 */
export function authorizeJuliusResearch(input: {
  readonly request: JuliusResearchRequest;
  readonly policy: JuliusResearchPolicy;
  readonly ledger: JuliusResearchLedger;
}): JuliusResearchAuthorization {
  const { request, policy, ledger } = input;
  const refuse = (
    refusal: JuliusResearchRefusal,
    detail: string,
    outcome: 'policy_refused' | 'budget_exhausted' = 'policy_refused',
  ): JuliusResearchAuthorization => ({
    ok: false, outcome, refusal, detail, policyFingerprint: policy.fingerprint,
  });

  if (!juliusResearchPolicyIntact(policy)) {
    return refuse(
      'policy_tampered',
      'The research policy in the request path is not the policy this mission sealed. '
      + 'No retrieval is authorized under a policy whose contents cannot be vouched for.',
    );
  }
  if (policy.missionId !== request.missionId) {
    return refuse(
      'policy_tampered',
      `This policy was sealed for mission ${policy.missionId} and the request is for ${request.missionId}.`,
    );
  }
  if (policy.allowances.length === 0 || policy.roles.length === 0) {
    return refuse(
      'research_not_authorized',
      'This mission authorizes no external research. Widening that is the mission\'s decision, not a worker\'s.',
    );
  }
  if (!policy.roles.includes(request.role)) {
    return refuse(
      'role_not_authorized',
      `This mission does not authorize research by the ${request.role} slot.`,
    );
  }

  let url: URL;
  try {
    url = new URL(request.reference);
  } catch {
    return refuse(
      'reference_unparsable',
      'A research reference must be an absolute URL. A source-native identifier is not resolved here, '
      + 'because guessing which host an opaque id belongs to is how an allowlist gets bypassed.',
    );
  }
  if (url.protocol !== 'https:') {
    return refuse(
      'scheme_not_allowed',
      `Research is https only; this reference is ${url.protocol.replace(':', '')}.`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    return refuse(
      'reference_unparsable',
      'A research reference may not carry inline credentials.',
    );
  }

  const allowance = policy.allowances.find((entry) => entry.source === request.source);
  if (allowance === undefined) {
    return refuse(
      'source_not_allowed',
      `This mission does not authorize the ${request.source} source.`,
    );
  }
  if (!allowance.capabilities.includes(request.capability)) {
    return refuse(
      'capability_not_allowed',
      `This mission authorizes ${allowance.capabilities.join(', ')} on ${request.source}, not ${request.capability}.`,
    );
  }

  const host = normalizeHost(url.hostname);
  const matchedHost = allowance.hosts.find((pattern) => juliusResearchHostMatches(pattern, host));
  if (matchedHost === undefined) {
    return refuse(
      'host_not_allowed',
      `${host} is not on this mission's ${request.source} allowlist.`,
    );
  }

  // Budget last, and the slot's own before the mission's: a slot that has spent
  // its share should be told that, not told the mission is out when two other
  // slots still have theirs.
  const roleVerdict = checkRetrievalBudget(ledger.byRole[request.role], policy.roleBudget);
  if (!roleVerdict.ok) {
    return refuse(
      roleVerdict.refusal === 'retrieval_budget_exhausted' ? 'role_budget_exhausted' : roleVerdict.refusal,
      `${request.role}: ${roleVerdict.detail}`,
      'budget_exhausted',
    );
  }
  const missionVerdict = checkRetrievalBudget(juliusMissionResearchMeter(ledger), policy.missionBudget);
  if (!missionVerdict.ok) {
    return refuse(
      missionVerdict.refusal === 'retrieval_budget_exhausted' ? 'mission_budget_exhausted' : missionVerdict.refusal,
      `This mission: ${missionVerdict.detail}`,
      'budget_exhausted',
    );
  }

  return {
    ok: true,
    role: request.role,
    source: request.source,
    capability: request.capability,
    host,
    matchedHost,
    url: url.toString(),
    policyFingerprint: policy.fingerprint,
  };
}
