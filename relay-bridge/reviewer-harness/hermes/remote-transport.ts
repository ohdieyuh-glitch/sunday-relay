import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import { NO_RUNTIME_EVIDENCE } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import {
  HERMES_SERVICE_PROTOCOL,
  type HermesConnectionEvidence, type HermesFailureKind, type HermesReviewerTransport,
  type RemoteHermesCancelResult, type RemoteHermesReviewInput,
  type RemoteHermesReviewStart, type RemoteHermesReviewState,
} from './hermes-transport';

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
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

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
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
      });

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false, kind: 'authentication_failed',
          safeMessage: 'The Hermes Reviewer service rejected the Relay Bridge credential.',
        };
      }
      if (!res.ok) {
        // Status only. A body can quote the request, which quotes the token.
        return {
          ok: false, kind: 'service_unreachable',
          safeMessage: `The Hermes Reviewer service returned HTTP ${res.status}.`,
        };
      }

      const raw = await res.text();
      if (raw.length > MAX_RESPONSE_BYTES) {
        return {
          ok: false, kind: 'malformed_response',
          safeMessage: 'The Hermes Reviewer service returned an oversized response.',
        };
      }
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
      // AbortError and every transport failure land here. The cause is not
      // reflected: it can carry the URL, which names internal host layout.
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
      const connected = boolOf(r.body.connected);
      const identityRaw = isRecord(r.body.identity) ? r.body.identity : null;
      const identity = identityRaw === null ? null : {
        provider: (strOrNull(identityRaw.provider) ?? 'xai') as 'anthropic' | 'xai',
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
        failureKind: connected ? null : ((strOrNull(r.body.failureKind) ?? 'provider_unverified') as HermesFailureKind),
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
        failureKind: boolOf(r.body.accepted) ? null : ((strOrNull(r.body.failureKind) ?? 'malformed_response') as HermesFailureKind),
        safeMessage: boolOf(r.body.accepted) ? null : (strOrNull(r.body.safeMessage) ?? 'The Hermes Reviewer service refused the review.'),
      };
    },

    async getReview(runId: string): Promise<RemoteHermesReviewState> {
      const r = await call('GET', `/v1/reviews/${encodeURIComponent(runId)}`);
      if (!r.ok) {
        return {
          runId, status: 'failed', protocol: null, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, source: 'unavailable' },
          failureKind: r.kind, safeMessage: r.safeMessage,
        };
      }
      const status = strOrNull(r.body.status);
      const known = ['running', 'completed', 'failed', 'cancelled', 'timed_out'];
      if (status === null || !known.includes(status)) {
        return {
          runId, status: 'failed', protocol: HERMES_SERVICE_PROTOCOL, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, source: 'unavailable' },
          failureKind: 'malformed_response',
          safeMessage: 'The Hermes Reviewer service reported a run state Relay does not accept.',
        };
      }
      const u = isRecord(r.body.usage) ? r.body.usage : {};
      const inputTokens = numOrNull(u.inputTokens);
      const outputTokens = numOrNull(u.outputTokens);
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
          // Unreported usage stays Unknown. It never becomes zero.
          source: inputTokens === null && outputTokens === null ? 'unavailable' : 'harness_reported',
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
