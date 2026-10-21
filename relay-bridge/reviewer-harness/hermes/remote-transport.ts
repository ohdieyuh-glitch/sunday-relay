import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import { NO_RUNTIME_EVIDENCE } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import {
  HERMES_FAILURE_KINDS, HERMES_REVIEW_STATUSES, HERMES_SERVICE_PROTOCOL,
  type HermesConnectionEvidence, type HermesFailureKind, type HermesReviewerTransport,
  type RemoteHermesCancelResult, type RemoteHermesReviewInput,
  type RemoteHermesReviewStart, type RemoteHermesReviewState,
} from './hermes-transport';
import { HERMES_PROVIDERS, type HermesProviderId } from './hermes-provider';

/**
 * THE REMOTE HERMES TRANSPORT — authenticated HTTP, and nothing else.
 *
 * This module deliberately imports no child_process, no discovery and no
 * profile builder. In remote mode the bridge is a CLIENT: Hermes lives in a
 * dedicated service that owns the binary, the provider credential and the
 * isolated profile. A bridge that could spawn would eventually be asked to,
 * and the whole point of the split is that it cannot.
 *
 * Every reply is validated before it becomes evidence. An unreachable service,
 * a wrong token, a mismatched protocol and a malformed body are four different
 * facts with four different fixes, so they get four different failure kinds
 * rather than one vague "not connected".
 *
 * NOTHING FROM UPSTREAM IS REFLECTED. A remote error body can quote the
 * request, and the request carries a bearer token — so responses are built
 * here from a fixed vocabulary, never passed through.
 */

/** Response bodies are capped before parsing; a service cannot flood the bridge. */
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    /**
     * `'manual'`, and the type admits nothing else. See `call()` — a followed
     * redirect is how a bearer token reaches an origin nobody allowlisted.
     * The wider union this used to carry made the docstring the only thing
     * standing between the credential and a redirect chain.
     */
    redirect?: 'manual';
  },
) => Promise<{
  ok: boolean;
  status: number;
  /** Present on a real Response; used to reject an oversized body before reading it. */
  headers?: { get(name: string): string | null };
  /** Present on a real Response; used to count WIRE BYTES while streaming. */
  body?: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}>;

export interface RemoteTransportConfig {
  readonly serviceUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => string;
}

type CallResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly kind: HermesFailureKind; readonly safeMessage: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const boolOf = (v: unknown): boolean => v === true;
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const KNOWN_FAILURE_KINDS: ReadonlySet<string> = new Set(HERMES_FAILURE_KINDS);

/**
 * A failure kind is a VOCABULARY, not free text.
 *
 * The run status is already validated against its known list; the kind was
 * not, so an arbitrary upstream string could be cast straight into the typed
 * union and travel on as if Relay had recognised it. A kind decides what an
 * operator is told to go and fix, which makes an unrecognised one worse than
 * none — so it is dropped here and the caller supplies its own honest default.
 */
const kindOrNull = (v: unknown): HermesFailureKind | null =>
  typeof v === 'string' && KNOWN_FAILURE_KINDS.has(v) ? (v as HermesFailureKind) : null;

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(HERMES_PROVIDERS);

/**
 * A provider is a closed vocabulary, exactly like the run status and the
 * failure kind. Absent, blank, mistyped or unrecognised all mean the same
 * thing here — Relay does not know — and none of them may become a default.
 */
const providerOrNull = (v: unknown): HermesProviderId | null =>
  typeof v === 'string' && KNOWN_PROVIDERS.has(v) ? (v as HermesProviderId) : null;

type ReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'too_large' | 'unreadable' };

/**
 * READ THE BODY IN WIRE BYTES, AND STOP AT THE CEILING.
 *
 * The cap used to be applied to `raw.length` AFTER `res.text()` had already
 * buffered the whole body: it bounded parsing, not memory, and it measured
 * UTF-16 code units, so a 256K-unit cap admitted up to ~1 MB of UTF-8.
 *
 * Now: a declared Content-Length over the ceiling is refused before a byte is
 * read; otherwise the stream is consumed incrementally and abandoned the
 * moment the running byte count crosses the ceiling — so a lying or absent
 * Content-Length cannot get past it either.
 */
async function readBounded(
  res: { headers?: { get(n: string): string | null }; body?: ReadableStream<Uint8Array> | null; text: () => Promise<string> },
  maxBytes: number,
): Promise<ReadResult> {
  const declared = res.headers?.get('content-length');
  if (declared !== null && declared !== undefined) {
    const n = Number(declared);
    // A declared length over the ceiling is refused before the body is read.
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: 'too_large' };
  }

  const stream = res.body;
  if (stream === null || stream === undefined || typeof stream.getReader !== 'function') {
    // No stream to read incrementally (a test double, or a runtime without
    // one). Measure BYTES, never string length.
    try {
      const text = await res.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, reason: 'too_large' };
      return { ok: true, text };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Abandon immediately; do not accumulate the rest.
        await reader.cancel().catch(() => { /* already gone */ });
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    // A timeout or cancellation mid-stream lands here.
    await reader.cancel().catch(() => { /* already gone */ });
    return { ok: false, reason: 'unreadable' };
  }
  // Decoded once, from complete bytes, so a multi-byte character split across
  // two chunks is never mangled.
  return { ok: true, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
}

/**
 * What each refusal kind MEANS to whoever has to act on it. The service takes
 * care to distinguish a decision from a wait; a single message template on
 * this side undid that one hop later.
 *
 * `capacity_exhausted` and `shutting_down` are temporary and clear without
 * anyone changing anything. Calling them "a decision by the service, not a
 * network fault" — the wording every kind used to get — is the precise
 * inversion of what `service.ts` says about them in the same codebase, and it
 * tells an operator to go and edit a request that was never the problem.
 */
const REFUSAL_GUIDANCE: Partial<Record<HermesFailureKind, string>> = {
  capacity_exhausted:
    'The service is at its concurrent-review ceiling. This is temporary and clears as running '
    + 'reviews finish; the same request may be sent again unchanged.',
  shutting_down:
    'The service is draining and is not accepting new reviews. This is temporary and clears when '
    + 'the deploy finishes; the same request may be sent again unchanged.',
  validation_failed:
    'The service understood the request and found it malformed. Sending it again unchanged will '
    + 'fail again.',
  not_found:
    'The service has no such run, or does not recognise that route. Sending it again unchanged '
    + 'will fail again; a route it does not recognise means these two builds disagree.',
  internal_error:
    'The service faulted while handling the request. It answered, so this is not a network '
    + 'problem — but retrying immediately is unlikely to help.',
};

/**
 * A refusal the service composed, recovered from an error status WITHOUT
 * reflecting upstream text.
 *
 * Only a protocol-valid body carrying a kind already in Relay's vocabulary is
 * honoured; the message is always written here. Everything else stays
 * `service_unreachable`, which is what an unexplained error status is.
 */
function refusalFromBody(status: number, text: string): CallResult | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!isRecord(parsed)) return null;
  if (strOrNull(parsed.protocol) !== HERMES_SERVICE_PROTOCOL) return null;
  const kind = kindOrNull(parsed.kind);
  if (kind === null) return null;
  return {
    ok: false, kind,
    safeMessage:
      `The Hermes Reviewer service answered HTTP ${status} (${kind}). `
      + (REFUSAL_GUIDANCE[kind]
        ?? 'This is a decision by the service, not a network fault.'),
  };
}

export function createRemoteHermesTransport(
  config: RemoteTransportConfig,
): HermesReviewerTransport {
  const now = config.now ?? (() => new Date().toISOString());
  const base = config.serviceUrl.replace(/\/$/, '');
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const call = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<CallResult> => {
    const controller = new AbortController();
    // A timeout and a refused connection are DIFFERENT facts with different
    // fixes: one means a service answered too slowly or wedged, the other that
    // nothing answered at all. Both surface as an exception here, so the only
    // way to keep them apart is to record which one we caused.
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          // The ONLY place the service token is used. Never logged, never
          // echoed, never returned.
          Authorization: `Bearer ${config.serviceToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        // NO CROSS-ORIGIN BEARER FORWARDING.
        //
        // The default is `follow`. A 302 from the Hermes service — or from
        // anything sitting in front of it — would send this request onward,
        // and the runtime's redirect handling is the only thing deciding
        // whether the `Authorization` header goes with it. That is a guarantee
        // held by somebody else's implementation detail. `manual` makes the
        // redirect visible here, and the check below refuses it outright: the
        // trusted-origin allowlist approved ONE origin, and a redirect is a
        // request to talk to a different one.
        redirect: 'manual',
      });

      // 3xx is refused rather than followed. The `Location` is never read and
      // never echoed — it names a host this bridge has not been told to trust.
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false, kind: 'service_unreachable',
          safeMessage:
            `The Hermes Reviewer service replied with a redirect (HTTP ${res.status}). Relay does not follow `
            + 'redirects for an authenticated service call: the credential is issued for one trusted origin, '
            + 'and a redirect asks for it to be sent to another.',
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false, kind: 'authentication_failed',
          safeMessage: 'The Hermes Reviewer service rejected the Relay Bridge credential.',
        };
      }
      if (!res.ok) {
        // A DELIBERATE REFUSAL IS NOT AN OUTAGE.
        //
        // This used to flatten every error status to `service_unreachable`,
        // so a service that authenticated the caller, understood the request
        // and declined it read as a network fault — sending an operator to
        // check connectivity that was working. The body is read under the
        // same byte ceiling and only a kind already in Relay's vocabulary is
        // honoured; no upstream text is reflected.
        const errBody = await readBounded(res, MAX_RESPONSE_BYTES);
        if (errBody.ok) {
          const refusal = refusalFromBody(res.status, errBody.text);
          if (refusal !== null) return refusal;
        }
        // Unexplained error status: status only. A body can quote the
        // request, which quotes the token.
        return {
          ok: false, kind: 'service_unreachable',
          safeMessage: `The Hermes Reviewer service returned HTTP ${res.status}.`,
        };
      }

      const read = await readBounded(res, MAX_RESPONSE_BYTES);
      if (!read.ok) {
        return read.reason === 'too_large'
          ? {
            ok: false, kind: 'malformed_response',
            safeMessage: 'The Hermes Reviewer service returned an oversized response.',
          }
          : {
            ok: false, kind: 'malformed_response',
            safeMessage: 'The Hermes Reviewer service response could not be read.',
          };
      }
      const raw = read.text;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          ok: false, kind: 'malformed_response',
          safeMessage: 'The Hermes Reviewer service returned a response Relay could not parse.',
        };
      }
      if (!isRecord(parsed)) {
        return {
          ok: false, kind: 'malformed_response',
          safeMessage: 'The Hermes Reviewer service returned a response of an unexpected shape.',
        };
      }
      // Protocol is checked before ANY field is trusted as evidence.
      const protocol = strOrNull(parsed.protocol);
      if (protocol !== HERMES_SERVICE_PROTOCOL) {
        return {
          ok: false, kind: 'protocol_mismatch',
          safeMessage:
            `The Hermes Reviewer service speaks a protocol this Relay Bridge does not accept `
            + `(expected ${HERMES_SERVICE_PROTOCOL}).`,
        };
      }
      return { ok: true, body: parsed };
    } catch {
      // AbortError and every transport failure land here. The cause is never
      // reflected: it can carry the URL, which names internal host layout.
      // Only WHICH of the two failures it was crosses this boundary.
      if (timedOut) {
        return {
          ok: false, kind: 'timed_out',
          safeMessage: `The Hermes Reviewer service did not answer within ${timeoutMs} ms.`,
        };
      }
      return {
        ok: false, kind: 'service_unreachable',
        safeMessage: 'Relay could not reach the Hermes Reviewer service.',
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const failedEvidence = (safeMessage: string): HarnessRuntimeEvidence => ({
    ...NO_RUNTIME_EVIDENCE,
    // A bridge DID answer — it is the Hermes service that could not be used.
    // Collapsing those two would send an operator to the wrong system.
    bridgeAvailable: true,
    checkedAt: now(),
    failureReason: safeMessage,
  });

  return {
    mode: 'remote',
    // This transport enforces NO aggregate ceiling. It is an HTTP client; the
    // service on the other end owns admission. Reporting `null` is the honest
    // answer, and it is why the service asks its engine instead of publishing
    // a module constant that would be wrong here.
    ceilings: null,

    async readiness(): Promise<HarnessRuntimeEvidence> {
      const r = await call('GET', '/v1/readiness');
      if (!r.ok) return failedEvidence(r.safeMessage);
      const e = isRecord(r.body.evidence) ? r.body.evidence : {};
      return {
        bridgeAvailable: true,
        installed: boolOf(e.installed),
        // The service never sends a binary path, and the bridge never stores
        // one: it is host layout that no caller needs.
        binaryPath: null,
        version: strOrNull(e.version),
        compatible: boolOf(e.compatible),
        machineInterface: strOrNull(e.machineInterface),
        machineInterfaceVerified: boolOf(e.machineInterfaceVerified),
        credentialPresent: boolOf(e.credentialPresent),
        modelVerified: boolOf(e.modelVerified),
        requestedModel: strOrNull(e.requestedModel),
        verifiedModelId: strOrNull(e.verifiedModelId),
        readOnlyEnforceable: boolOf(e.readOnlyEnforceable),
        checkedAt: now(),
        failureReason: strOrNull(e.failureReason),
      };
    },

    async testConnection(): Promise<HermesConnectionEvidence> {
      const r = await call('POST', '/v1/test-connection', {});
      if (!r.ok) {
        return {
          connected: false, runCreated: false, protocol: null, identity: null,
          failureKind: r.kind, safeMessage: r.safeMessage, checkedAt: now(),
        };
      }
      const claimedConnected = boolOf(r.body.connected);
      const identityRaw = isRecord(r.body.identity) ? r.body.identity : null;
      const provider = identityRaw === null ? null : providerOrNull(identityRaw.provider);

      // A PROVIDER IS NEVER INFERRED.
      //
      // This used to read `strOrNull(identity.provider) ?? 'xai'` behind a
      // cast, so an absent, blank, mistyped or unrecognised provider silently
      // became xAI — inference, in the one place the whole milestone promises
      // there is none, and it could carry an unknown string into the identity
      // model with the authority of a checked value.
      //
      // Now: an identity Relay cannot read is not a connected identity.
      if (claimedConnected && (identityRaw === null || provider === null)) {
        return {
          connected: false, runCreated: false, protocol: HERMES_SERVICE_PROTOCOL, identity: null,
          failureKind: 'provider_unverified',
          safeMessage:
            'The Hermes Reviewer service reported a connection without a provider identity Relay recognises.',
          checkedAt: now(),
        };
      }

      const connected = claimedConnected;
      const identity = identityRaw === null || provider === null ? null : {
        provider,
        requestedModel: strOrNull(identityRaw.requestedModel) ?? '',
        credentialPresent: boolOf(identityRaw.credentialPresent),
        verifiable: boolOf(identityRaw.verifiable),
        // Never defaulted from requestedModel — absent stays absent.
        verifiedModelId: strOrNull(identityRaw.verifiedModelId),
      };
      return {
        connected,
        // Verifying a connection never creates a run, whatever the service says.
        runCreated: false,
        protocol: HERMES_SERVICE_PROTOCOL,
        identity,
        failureKind: connected ? null : (kindOrNull(r.body.failureKind) ?? 'provider_unverified'),
        safeMessage: connected ? null : (strOrNull(r.body.safeMessage) ?? 'The Hermes Reviewer service is not connected.'),
        checkedAt: now(),
      };
    },

    async startReview(input: RemoteHermesReviewInput): Promise<RemoteHermesReviewStart> {
      const r = await call('POST', '/v1/reviews', {
        runId: input.runId,
        idempotencyKey: input.idempotencyKey,
        prompt: input.prompt,
        limits: input.limits,
      });
      if (!r.ok) {
        return {
          accepted: false, runId: input.runId, duplicate: false,
          failureKind: r.kind, safeMessage: r.safeMessage,
        };
      }
      return {
        accepted: boolOf(r.body.accepted),
        runId: strOrNull(r.body.runId) ?? input.runId,
        duplicate: boolOf(r.body.duplicate),
        failureKind: boolOf(r.body.accepted) ? null : (kindOrNull(r.body.failureKind) ?? 'malformed_response'),
        safeMessage: boolOf(r.body.accepted) ? null : (strOrNull(r.body.safeMessage) ?? 'The Hermes Reviewer service refused the review.'),
      };
    },

    async getReview(runId: string): Promise<RemoteHermesReviewState> {
      const r = await call('GET', `/v1/reviews/${encodeURIComponent(runId)}`);
      if (!r.ok) {
        return {
          runId, status: 'failed', protocol: null, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, model: null, source: 'unavailable' },
          failureKind: r.kind, safeMessage: r.safeMessage,
        };
      }
      const status = strOrNull(r.body.status);
      // The vocabulary itself, not a second hand-written copy of it: a status
      // added to the contract and forgotten here would be decoded as
      // `malformed_response`, which is the bridge calling the service broken
      // for speaking the agreed protocol.
      const known: readonly string[] = HERMES_REVIEW_STATUSES;
      if (status === null || !known.includes(status)) {
        return {
          runId, status: 'failed', protocol: HERMES_SERVICE_PROTOCOL, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, model: null, source: 'unavailable' },
          failureKind: 'malformed_response',
          safeMessage: 'The Hermes Reviewer service reported a run state Relay does not accept.',
        };
      }
      const u = isRecord(r.body.usage) ? r.body.usage : {};
      const inputTokens = numOrNull(u.inputTokens);
      const outputTokens = numOrNull(u.outputTokens);
      // The served model, decoded with the same discipline as the tokens:
      // absent stays absent. It is never defaulted from any requested or
      // configured model — this decoder has no access to one on purpose.
      const servedModel = strOrNull(u.model);
      return {
        runId,
        status: status as RemoteHermesReviewState['status'],
        protocol: HERMES_SERVICE_PROTOCOL,
        // Review text is carried ONLY for a genuinely completed run; a
        // cancelled or timed-out run has no verdict to report.
        reviewText: status === 'completed' ? strOrNull(r.body.reviewText) : null,
        usage: {
          inputTokens,
          outputTokens,
          model: servedModel,
          // Unreported usage stays Unknown. It never becomes zero. A report
          // that names only the model is still a report.
          source: inputTokens === null && outputTokens === null && servedModel === null
            ? 'unavailable'
            : 'harness_reported',
        },
        failureKind: status === 'timed_out' ? 'timed_out' : null,
        safeMessage: strOrNull(r.body.safeMessage),
      };
    },

    async cancelReview(runId: string): Promise<RemoteHermesCancelResult> {
      const r = await call('POST', `/v1/reviews/${encodeURIComponent(runId)}/cancel`, {});
      if (!r.ok) {
        return { requested: false, terminationConfirmed: false, safeMessage: r.safeMessage };
      }
      return {
        requested: boolOf(r.body.requested),
        // Confirmed only when the SERVICE observed the process stop. A
        // cancellation request is not a confirmed termination.
        terminationConfirmed: boolOf(r.body.terminationConfirmed),
        safeMessage: strOrNull(r.body.safeMessage),
      };
    },
  };
}
