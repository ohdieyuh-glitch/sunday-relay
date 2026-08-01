/**
 * xAI MODEL VERIFICATION — server-side, and only when explicitly asked.
 *
 * A model name in Relay's source proves nothing. This asks the AUTHENTICATED
 * ACCOUNT which models it may use and confirms the requested one is among
 * them. It is the only place Relay learns that, and it runs from exactly two
 * callers: an explicit Test connection, and the readiness gate of an already
 * authorized run. Rendering a page, opening the catalog or starting the bridge
 * never reaches it.
 *
 * It is a LISTING call, not inference: it consumes no tokens and is recorded
 * separately from a Reviewer execution so a preflight can never be mistaken
 * for a review.
 *
 * NO FALLBACK. If the requested model is not listed, this reports it and the
 * run is blocked. Relay never substitutes a neighbouring model, a cheaper one
 * or "the latest available" — a silent substitution would make every identity
 * field downstream a lie.
 */

import { safeText } from '../../redact';

export const XAI_DEFAULT_BASE_URL = 'https://api.x.ai/v1';
export const XAI_API_KEY_ENV = 'XAI_API_KEY';
export const XAI_BASE_URL_ENV = 'XAI_BASE_URL';
export const XAI_PROVIDER_ID = 'xai';

export interface XaiModelRecord {
  readonly id: string;
  readonly created: number | null;
  readonly ownedBy: string | null;
}

export type XaiVerification =
  | {
    readonly kind: 'verified';
    readonly requestedModel: string;
    /** The canonical id the provider returned — never the requested string. */
    readonly verifiedModelId: string;
    readonly availableModels: readonly string[];
    readonly checkedAt: string;
  }
  | {
    readonly kind: 'model_unavailable';
    readonly requestedModel: string;
    readonly availableModels: readonly string[];
    readonly checkedAt: string;
    readonly safeMessage: string;
  }
  | {
    readonly kind: 'credentials_missing';
    readonly safeMessage: string;
  }
  | {
    readonly kind: 'unreachable';
    readonly checkedAt: string;
    /** Sanitised: a provider error never reaches a user verbatim. */
    readonly safeMessage: string;
  };

export interface XaiConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly requestedModel: string | null;
  readonly timeoutMs: number;
}

/**
 * Reads the credential from the SERVER process only. The value is returned
 * into a config object that callers must never serialise; `describeXaiConfig`
 * is the only thing safe to log or return.
 */
export function loadXaiConfig(env: NodeJS.ProcessEnv = process.env): XaiConfig {
  const raw = env[XAI_API_KEY_ENV];
  const key = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  const base = env[XAI_BASE_URL_ENV];
  return {
    apiKey: key,
    baseUrl: typeof base === 'string' && base.trim() !== '' ? base.trim() : XAI_DEFAULT_BASE_URL,
    requestedModel: env.RELAY_REVIEWER_MODEL?.trim() || null,
    timeoutMs: Number(env.RELAY_REVIEWER_MODEL_TIMEOUT_MS ?? 20_000),
  };
}

/**
 * The only representation of the credential that may leave this module: whether
 * one is present. Never its value, never its length, never a hash — a hash
 * would let two deployments be compared for equality.
 */
export function describeXaiConfig(cfg: XaiConfig): {
  credentialPresent: boolean; baseUrl: string; requestedModel: string | null;
} {
  return {
    credentialPresent: cfg.apiKey !== null,
    baseUrl: cfg.baseUrl,
    requestedModel: cfg.requestedModel,
  };
}

/** Parses `GET /v1/models`. Anything unexpected yields no models, never a guess. */
export function parseModelList(body: unknown): XaiModelRecord[] {
  if (body === null || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.trim() === '') return [];
    return [{
      id: o.id,
      created: typeof o.created === 'number' ? o.created : null,
      ownedBy: typeof o.owned_by === 'string' ? o.owned_by : null,
    }];
  });
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Confirms the requested model is available to THIS key.
 *
 * `requestedModel` is required: this function will not pick one. A caller that
 * has no configured model is not "ready with a default" — it is unverified.
 */
export async function verifyXaiModel(input: {
  config: XaiConfig;
  fetchImpl?: FetchLike;
  now?: () => string;
}): Promise<XaiVerification> {
  const now = input.now ?? (() => new Date().toISOString());
  const cfg = input.config;

  if (cfg.apiKey === null) {
    return {
      kind: 'credentials_missing',
      safeMessage: `No ${XAI_API_KEY_ENV} is configured on the Relay Bridge. The browser never holds this credential.`,
    };
  }
  if (cfg.requestedModel === null || cfg.requestedModel === '') {
    return {
      kind: 'unreachable',
      checkedAt: now(),
      safeMessage: 'No Reviewer model is configured on the Relay Bridge, and Relay will not choose one.',
    };
  }

  const doFetch = input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: {
        // The ONLY place the credential is used. It is never logged, never
        // echoed into an error, and never persisted.
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        kind: 'unreachable',
        checkedAt: now(),
        // Status only. A provider error body can quote the request, which can
        // quote the header.
        safeMessage: `The model provider rejected the verification request (HTTP ${res.status}).`,
      };
    }
    const models = parseModelList(await res.json());
    const available = models.map((m) => m.id);
    const match = models.find((m) => m.id === cfg.requestedModel);
    if (match === undefined) {
      return {
        kind: 'model_unavailable',
        requestedModel: cfg.requestedModel,
        availableModels: available,
        checkedAt: now(),
        safeMessage:
          `The authenticated account cannot use ${safeText(cfg.requestedModel)}. `
          + 'Relay does not substitute another model.',
      };
    }
    return {
      kind: 'verified',
      requestedModel: cfg.requestedModel,
      verifiedModelId: match.id,
      availableModels: available,
      checkedAt: now(),
    };
  } catch {
    return {
      kind: 'unreachable',
      checkedAt: now(),
      safeMessage: 'Relay could not reach the model provider to verify the requested model.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The run-time guard. A response whose model differs from the verified one
 * invalidates the run rather than being accepted as an interesting fact.
 */
export function modelMatchesVerified(
  verifiedModelId: string | null,
  reportedModel: string | null,
): { ok: boolean; reason: string | null } {
  if (verifiedModelId === null) {
    return { ok: false, reason: 'Relay has no verified model to compare the response against.' };
  }
  if (reportedModel === null) return { ok: true, reason: null }; // Unknown stays Unknown.
  if (reportedModel === verifiedModelId) return { ok: true, reason: null };
  return {
    ok: false,
    reason:
      `The response reported model ${safeText(reportedModel)}, not the verified `
      + `${safeText(verifiedModelId)}. Relay invalidated the run.`,
  };
}
