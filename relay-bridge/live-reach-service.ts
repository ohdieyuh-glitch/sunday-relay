import {
  evaluateLiveReach,
  backendCandidates,
  findSource,
  resolveReadiness,
  type BackendProbe,
  type LiveReachAttempt,
  type LiveReachCapability,
  type LiveReachRefusal,
  type LiveReachSettings,
  type LiveReachSource,
} from '../src/relay/mission/live-reach';
import {
  normalizeObservation,
  type EvidenceArtifact,
  type EvidenceAuthority,
  type EvidenceSanitization,
} from '../src/relay/mission/evidence';
import { liveFetch, probeReachability, type LiveFetchOutcome } from '../src/relay/connectors/live-reach/live-fetch';
import {
  checkRetrievalBudget, emptyMeter, recordRetrieval, reportUsage,
  type MeteredOutcome, type ReportedUsage, type RetrievalBudget, type RetrievalMeter, type RetrievalRecord,
} from '../src/relay/mission/live-reach/live-reach-metering';
import { detectInjectionSignals, redactText } from '../src/relay/mcp/policy/mcp-sanitize';

/**
 * LIVE REACH — the composition root.
 *
 * The domain knows the rules, the connector knows how to fetch, and neither
 * knows the other exists: adapters may not import `/mission`, and the domain
 * has no network. This file is the only place they meet, which is also the
 * only place the whole path can be got wrong — so it is the place the path is
 * tested end to end.
 *
 * THE ORDER IS THE PRODUCT.
 *
 *   1  permission      is this capability supported, switched on, ready, and
 *                      authorised by THIS Mission?
 *   2  candidates      ordered backends, preferred first.
 *   3  execution       Relay's own bounded fetch, inside the network policy.
 *   4  fallback        the next candidate, and only for reads.
 *   5  sanitization    redact, then scan for instruction-shaped phrases.
 *   6  normalization   an EvidenceArtifact, with the backend that ACTUALLY
 *                      served it and whether a fallback happened.
 *
 * A refusal at step 1 dispatches nothing. That is what makes a disabled
 * capability a real refusal rather than a hidden control: the switch is read
 * before the request exists.
 */

/* -------------------------------------------------------------- events */

/**
 * Structured events, as drafts.
 *
 * Returned rather than written, because this service does not own a ledger and
 * building a second event platform is exactly what the direction forbids. The
 * caller appends them to whatever record it already keeps.
 */
export const LIVE_REACH_EVENTS = [
  'EVIDENCE_REQUESTED',
  'EVIDENCE_REFUSED',
  'EVIDENCE_SOURCE_SELECTED',
  'EVIDENCE_RETRIEVAL_STARTED',
  'EVIDENCE_RETRIEVED',
  'EVIDENCE_RETRIEVAL_FAILED',
  'EVIDENCE_FALLBACK_USED',
  'CAPABILITY_READY',
  'CAPABILITY_DEGRADED',
  'CAPABILITY_UNAVAILABLE',
] as const;
export type LiveReachEventKind = (typeof LIVE_REACH_EVENTS)[number];

export interface LiveReachEvent {
  readonly kind: LiveReachEventKind;
  readonly at: string;
  readonly source: LiveReachSource;
  readonly capability: LiveReachCapability;
  readonly backendId: string | null;
  /** Safe to display. Never a credential, never raw response text. */
  readonly detail: string;
}

/* ------------------------------------------------------------- results */

export type LiveReachResult =
  | {
    readonly ok: true;
    readonly artifact: EvidenceArtifact;
    readonly attempt: LiveReachAttempt;
    readonly events: readonly LiveReachEvent[];
  }
  | {
    readonly ok: false;
    readonly refusal: LiveReachRefusal;
    readonly detail: string;
    /** Null when nothing was attempted — a refusal is not a failed attempt. */
    readonly attempt: LiveReachAttempt | null;
    readonly events: readonly LiveReachEvent[];
  };

export interface LiveReachRetrieveRequest {
  readonly missionId: string;
  readonly projectId: string;
  readonly source: string;
  readonly capability: LiveReachCapability;
  /** The URL or source-native reference being read. */
  readonly reference: string;
  readonly query?: string | null;
  /** Whether THIS Mission authorises this act. Supplied, never inferred. */
  readonly missionAuthorises: boolean;
  readonly settings?: LiveReachSettings;
  /** Probes already taken for this deployment. Readiness is read from these. */
  readonly probes?: readonly BackendProbe[];
  readonly preferredBackendId?: string;
  /** How much weight this source class carries. Defaults per source class. */
  readonly authority?: EvidenceAuthority;
  /**
   * A cap on what this mission may retrieve. Absent means no cap — which is
   * the state Relay shipped in, and it is now a decision rather than a gap.
   */
  readonly budget?: RetrievalBudget;
}

export interface LiveReachServiceDeps {
  /** ISO now. Injected so the whole path is deterministic under test. */
  readonly now: () => string;
  /** Evidence ids. Injected for the same reason. */
  readonly nextEvidenceId: () => string;
  readonly fetchImpl?: typeof fetch;
  readonly resolver?: { resolve(hostname: string): Promise<readonly string[]> };
}

/**
 * Default authority by source class.
 *
 * A project's own release notes are the thing itself; a page on the open web
 * is a report about something; a social post is discussion. The caller may
 * override, because a vendor's own blog post is primary about its own product
 * and this table cannot know that.
 */
function defaultAuthority(source: LiveReachSource): EvidenceAuthority {
  switch (source) {
    case 'github': return 'primary';
    case 'rss': return 'secondary';
    case 'web': return 'secondary';
    default: return 'community';
  }
}

/** Map a fetch outcome onto the probe vocabulary the readiness model speaks. */
function outcomeToProbe(outcome: LiveFetchOutcome): BackendProbe['result'] {
  switch (outcome.kind) {
    case 'observed': return 'observed';
    case 'unauthenticated': return 'unauthenticated';
    case 'throttled': return 'throttled';
    case 'refused': return 'unconfigured';
    default: return 'unreachable';
  }
}

export interface LiveReachService {
  retrieve(request: LiveReachRetrieveRequest): Promise<LiveReachResult>;
  /** A side-effect-free probe, so READY can be earned rather than assumed. */
  probe(input: {
    source: LiveReachSource;
    capability: LiveReachCapability;
    url: string;
  }): Promise<BackendProbe>;
  /**
   * What this mission has spent on retrieval — the `usage` verb, made real.
   *
   * A mission that has retrieved nothing reports an empty meter rather than
   * nothing at all, so a surface can distinguish "no retrievals" from "no such
   * mission" without guessing.
   */
  usage(missionId: string): ReportedUsage;
}

export function createLiveReachService(deps: LiveReachServiceDeps): LiveReachService {
  const fetchOptions = {
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
  };

  /**
   * Per-mission meters, held for the process lifetime.
   *
   * NOT DURABLE, and the consequence is stated rather than hidden: a bridge
   * restart forgets what a mission has already retrieved, so a budget is
   * enforced within a process rather than across one. That is worth having —
   * the alternative today is no enforcement at all — and it is a smaller claim
   * than the store would make.
   */
  const meters = new Map<string, RetrievalMeter>();
  const meterFor = (missionId: string): RetrievalMeter =>
    meters.get(missionId) ?? emptyMeter(missionId);
  const meter = (missionId: string, record: RetrievalRecord): void => {
    meters.set(missionId, recordRetrieval(meterFor(missionId), record));
  };

  return {
    usage(missionId) {
      return reportUsage(meterFor(missionId));
    },

    async probe(input) {
      const result = await probeReachability({ url: input.url, ...fetchOptions });
      const candidates = backendCandidates(input.source, input.capability);
      return {
        // The probe describes the backend that would actually serve this
        // capability, so readiness and retrieval speak about the same thing.
        backendId: candidates[0]?.backendId ?? 'none',
        capability: input.capability,
        result,
        probedAt: deps.now(),
      };
    },

    async retrieve(request) {
      const events: LiveReachEvent[] = [];
      const at = deps.now();
      const definition = findSource(request.source);
      const source = (definition?.source ?? 'web') as LiveReachSource;

      const push = (kind: LiveReachEventKind, backendId: string | null, detail: string): void => {
        events.push({ kind, at: deps.now(), source, capability: request.capability, backendId, detail });
      };

      push('EVIDENCE_REQUESTED', null, `${request.capability} on ${request.source}`);

      const probes = request.probes ?? [];
      const readiness = definition === null
        ? 'capability_unsupported'
        : resolveReadiness({
          source,
          capability: request.capability,
          probes,
          ...(request.preferredBackendId === undefined
            ? {}
            : { preferredBackendId: request.preferredBackendId }),
        });

      const decision = evaluateLiveReach({
        source: request.source,
        capability: request.capability,
        ...(request.settings === undefined ? {} : { settings: request.settings }),
        missionAuthorises: request.missionAuthorises,
        ready: readiness === 'ready',
      });

      if (!decision.allowed) {
        push('EVIDENCE_REFUSED', null, decision.detail);
        // NOTHING WAS ATTEMPTED. `attempt: null` says so; a refusal is not a
        // failed request, and reporting one as the other would put a
        // never-sent call in the audit record.
        return { ok: false, refusal: decision.refusal, detail: decision.detail, attempt: null, events };
      }

      /**
       * THE CAP IS CHECKED HERE — after permission, before any socket.
       *
       * After permission, because a request this mission was never allowed to
       * make should be refused for THAT reason: reporting a budget refusal
       * over a forbidden source would tell an operator to raise a cap when the
       * real answer is that the capability is off.
       *
       * Before the fetch, because a budget enforced afterwards is a report.
       */
      if (request.budget !== undefined) {
        const verdict = checkRetrievalBudget(meterFor(request.missionId), request.budget);
        if (!verdict.ok) {
          push('EVIDENCE_REFUSED', null, verdict.detail);
          // Nothing was attempted, so `attempt` stays null — the same rule the
          // permission refusal above follows.
          return { ok: false, refusal: verdict.refusal, detail: verdict.detail, attempt: null, events };
        }
      }

      const candidates = backendCandidates(
        source,
        request.capability,
        request.preferredBackendId,
      );
      const requestedBackendId = candidates[0]?.backendId ?? 'none';
      push('EVIDENCE_SOURCE_SELECTED', requestedBackendId, `preferred backend ${requestedBackendId}`);

      let lastDetail = 'no backend attempted';
      for (const [index, backend] of candidates.entries()) {
        push('EVIDENCE_RETRIEVAL_STARTED', backend.backendId, `attempting ${backend.backendId}`);
        const outcome = await liveFetch({ url: request.reference, ...fetchOptions });

        if (outcome.kind !== 'observed') {
          // METERED EVEN THOUGH IT FAILED. A 429 or a 401 is the host telling
          // us it saw the request, and its limit counted it; `refused` never
          // reaches here because a policy refusal returns above. `unreachable`
          // is recorded as unconfirmed rather than as spent or free.
          meter(request.missionId, {
            source,
            outcome: outcome.kind as MeteredOutcome,
            bytes: null,
            at: deps.now(),
            ...(outcome.kind === 'throttled' ? { retryAfter: outcome.retryAfter } : {}),
          });
          lastDetail = outcome.detail;
          push('EVIDENCE_RETRIEVAL_FAILED', backend.backendId, outcome.detail);
          push(
            outcome.kind === 'throttled' ? 'CAPABILITY_DEGRADED' : 'CAPABILITY_UNAVAILABLE',
            backend.backendId,
            outcome.detail,
          );
          continue;
        }

        meter(request.missionId, {
          source, outcome: 'observed', bytes: outcome.bytes, at: deps.now(),
        });

        const fallbackOccurred = index > 0;
        if (fallbackOccurred) {
          push('EVIDENCE_FALLBACK_USED', backend.backendId,
            `${requestedBackendId} did not serve the request; ${backend.backendId} did`);
        }

        /**
         * SANITIZE BEFORE ANYTHING SEES IT.
         *
         * Redaction first, then the scan, so the signals describe the text
         * that is actually STORED rather than a version nobody kept.
         *
         * Stated precisely because it was nearly overstated: this ordering is
         * defence in depth and its effect is NOT observable today.
         * `detectInjectionSignals` returns fixed labels, never excerpts, so
         * scanning before or after redaction yields the same set — checked
         * against the real function rather than assumed. It becomes
         * load-bearing the day that detector reports matched text.
         */
        const redaction = redactText(outcome.body);
        const signals = detectInjectionSignals(redaction.text);
        const redacted = redaction.redactionsApplied > 0;
        const sanitization: EvidenceSanitization = redacted && outcome.truncated
          ? 'redacted_and_truncated'
          : redacted
            ? 'redacted'
            : outcome.truncated ? 'truncated' : 'clean';

        const attempt: LiveReachAttempt = {
          source,
          capability: request.capability,
          requestedBackendId,
          actualBackendId: backend.backendId,
          fallbackOccurred,
          startedAt: at,
          completedAt: deps.now(),
        };

        const artifact = normalizeObservation(deps.nextEvidenceId(), {
          missionId: request.missionId,
          projectId: request.projectId,
          source,
          capability: request.capability,
          reference: outcome.finalUrl,
          title: null,
          author: null,
          publishedAt: outcome.serverPublishedAt,
          retrievedAt: attempt.completedAt ?? at,
          query: request.query ?? null,
          content: redaction.text,
          sanitization,
          injectionSignals: signals,
          authority: request.authority ?? defaultAuthority(source),
          attempt,
        });

        push('EVIDENCE_RETRIEVED', backend.backendId,
          `${String(outcome.bytes)} bytes, freshness ${artifact.age.freshness}`);
        push('CAPABILITY_READY', backend.backendId, 'observed answering');
        return { ok: true, artifact, attempt, events };
      }

      // Every candidate failed. The attempt is REAL and recorded with no
      // actual backend, which is different from a refusal that never ran.
      const attempt: LiveReachAttempt = {
        source,
        capability: request.capability,
        requestedBackendId,
        actualBackendId: null,
        fallbackOccurred: candidates.length > 1,
        startedAt: at,
        completedAt: deps.now(),
      };
      return {
        ok: false,
        refusal: 'not_ready',
        detail: lastDetail,
        attempt,
        events,
      };
    },
  };
}

/** Re-exported so a caller can record probe results without a second mapping. */
export { outcomeToProbe };
