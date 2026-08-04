import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import type { SafeProviderIdentity } from './hermes-provider';

/**
 * THE HERMES TRANSPORT SEAM — pure contract and pure selection.
 *
 * The bug this exists to remove: the bridge probed for a Hermes executable on
 * its OWN PATH. That is correct on a developer laptop and nonsense in a
 * Railway container, where the honest answer to "is Hermes installed?" is "no,
 * and it never will be" — yet the reply told a founder to install Hermes and
 * put it on PATH, which no amount of installing on their Chromebook could
 * satisfy.
 *
 * A transport makes WHERE Hermes runs an explicit choice:
 *
 *   local   the bridge spawns Hermes itself. Unchanged behaviour, for
 *           development on a machine that really has it.
 *   remote  the bridge calls a dedicated Hermes Reviewer service over
 *           authenticated private HTTP and never spawns anything.
 *
 * THE RULE THAT MATTERS MOST: remote NEVER falls back to local. A production
 * bridge that quietly probed its own PATH after a remote failure would report
 * "install Hermes" for what is actually an unreachable service or a bad token
 * — turning a precise, fixable fault into a misleading one. Fail closed, and
 * say which failure it was.
 */

/** Bumped when the bridge↔service wire contract changes incompatibly. */
export const HERMES_SERVICE_PROTOCOL = 'relay-hermes-reviewer.v1' as const;
export type HermesServiceProtocol = typeof HERMES_SERVICE_PROTOCOL;

export const HERMES_MODE_ENV = 'RELAY_HERMES_MODE';
export const HERMES_SERVICE_URL_ENV = 'RELAY_HERMES_SERVICE_URL';
export const HERMES_SERVICE_TOKEN_ENV = 'RELAY_HERMES_SERVICE_TOKEN';
export const HERMES_EXECUTABLE_ENV = 'RELAY_HERMES_EXECUTABLE';

export const HERMES_MODES = ['local', 'remote'] as const;
export type HermesMode = (typeof HERMES_MODES)[number];

/**
 * Categorised failure states. A caller gets one of these rather than a raw
 * upstream error, because an upstream body can quote the request, and the
 * request carries a token.
 */
export const HERMES_FAILURE_KINDS = [
  'configuration_missing',
  'authentication_failed',
  'service_unreachable',
  'incompatible_runtime',
  'interface_unverified',
  'readonly_unverified',
  'credentials_missing',
  'provider_unverified',
  'model_unverified',
  'protocol_mismatch',
  'malformed_response',
  'timed_out',
  /**
   * The service was reached, authenticated, understood the request — and
   * DECLINED it. A deliberate refusal is not an outage: it will not fix itself
   * and retrying it is a new paid call, whereas `service_unreachable` invites
   * an operator to go and check networking that is working perfectly.
   */
  'review_refused',
  /**
   * The service was reached, authenticated, understood the request — and had
   * no capacity for it. Distinct from `review_refused` because the fix is
   * different in kind: a refusal will not resolve itself and retrying it is a
   * new paid call, whereas capacity clears on its own as runs finish. Merging
   * them would tell an operator to change the request when they should simply
   * wait.
   */
  'capacity_exhausted',
] as const;
export type HermesFailureKind = (typeof HERMES_FAILURE_KINDS)[number];

export interface HermesConnectionEvidence {
  readonly connected: boolean;
  /** Always false on this path: verifying a connection creates no run. */
  readonly runCreated: false;
  readonly protocol: HermesServiceProtocol | null;
  readonly identity: SafeProviderIdentity | null;
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
  readonly checkedAt: string;
}

export interface RemoteHermesReviewInput {
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly limits: {
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly maxTurns: number;
    readonly maxPromptBytes: number;
  };
}

export interface RemoteHermesReviewStart {
  readonly accepted: boolean;
  readonly runId: string;
  /** True when an existing run was returned for a repeated key. */
  readonly duplicate: boolean;
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
}

export interface RemoteHermesReviewState {
  readonly runId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  readonly protocol: HermesServiceProtocol | null;
  /** Present only once a review really finished. */
  readonly reviewText: string | null;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    /** 'unavailable' keeps Unknown as Unknown; it never becomes zero. */
    readonly source: 'harness_reported' | 'unavailable';
  };
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
}

export interface RemoteHermesCancelResult {
  readonly requested: boolean;
  /** Confirmed only when the service observed the process actually stop. */
  readonly terminationConfirmed: boolean;
  readonly safeMessage: string | null;
}

/**
 * What a transport must be able to answer. Deliberately small: it is an
 * execution boundary, not a second Reviewer domain model. Run truth still
 * lives in Relay Core.
 */
export interface HermesReviewerTransport {
  readonly mode: HermesMode;
  readiness(): Promise<HarnessRuntimeEvidence>;
  testConnection(): Promise<HermesConnectionEvidence>;
  startReview(input: RemoteHermesReviewInput): Promise<RemoteHermesReviewStart>;
  getReview(runId: string): Promise<RemoteHermesReviewState>;
  cancelReview(runId: string): Promise<RemoteHermesCancelResult>;
  /**
   * Cancel every live run. Optional because only an in-process engine can
   * honour it; a remote client asks the service, which cancels its own.
   */
  cancelAll?(): Promise<void>;
}

/* ------------------------------------------------------- mode selection --- */

export type HermesModeSelection =
  | { readonly ok: true; readonly mode: 'local'; readonly executableOverride: string | null }
  | { readonly ok: true; readonly mode: 'remote'; readonly serviceUrl: string; readonly serviceToken: string }
  | { readonly ok: false; readonly kind: 'configuration_missing'; readonly safeMessage: string };

/**
 * THE TRUSTED-ORIGIN GATE (independent review, F2).
 *
 * The previous `validServiceUrl` was documented as "a private-network URL the
 * bridge may call. Nothing else is accepted." It checked the PROTOCOL and
 * nothing else, so with `production: true` an operator-set
 * `https://attacker.example.com/hermes` was accepted — and the bridge then
 * sent its bearer token there. Not directly exploitable, because the value is
 * operator-set rather than attacker-set; a defect all the same, and precisely
 * the class this repository's own `nixpacks.toml` warns about: a comment
 * claiming a gate the code does not implement is trusted by the next change.
 *
 * The gate now exists.
 *
 * PRODUCTION: the URL's origin must appear, exactly, in
 * `RELAY_HERMES_TRUSTED_ORIGINS`. Exact origin match — scheme, host and port,
 * compared after WHATWG normalisation. No suffix matching, because
 * `evil-relay.internal` ends with `relay.internal`; no wildcards, because a
 * wildcard is how an allowlist stops being one; no bare-host entries, because
 * a host without a scheme silently admits plaintext `http:`.
 *
 * FAIL CLOSED. Production with no trusted origins configured is a
 * configuration error, not an implicit "allow everything". That is the whole
 * behaviour of the repaired gate: absent policy denies.
 *
 * DEVELOPMENT: loopback only, stated explicitly rather than left as "anything
 * goes outside production". A developer pointing the bridge at a public host
 * without an allowlist entry is doing the production-shaped thing on a laptop,
 * and gets the production-shaped refusal. An explicit allowlist still works
 * outside production, so a real staging host remains reachable by naming it.
 */
export const HERMES_TRUSTED_ORIGINS_ENV = 'RELAY_HERMES_TRUSTED_ORIGINS';

/** Hosts that are unambiguously this machine. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** `https://host:port` — never a path, never a query, never credentials. */
export function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Embedded credentials in a service URL are refused outright: they would
    // be a second, unmanaged secret travelling in configuration.
    if (url.username !== '' || url.password !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Parse the allowlist into exact, normalised origins. A malformed entry is
 *  dropped rather than approximated — a half-understood allowlist entry is
 *  worse than a missing one. */
export function parseTrustedOrigins(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => originOf(entry))
    .filter((entry): entry is string => entry !== null);
}

export type ServiceUrlVerdict =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly safeMessage: string };

/**
 * Decide whether the bridge may send its bearer token to this URL.
 *
 * The rejected URL is never echoed in a message: it names internal host
 * layout, and this text reaches logs and operators.
 */
export function checkServiceUrl(input: {
  readonly raw: string;
  readonly production: boolean;
  readonly trustedOrigins: readonly string[];
}): ServiceUrlVerdict {
  const origin = originOf(input.raw);
  if (origin === null) {
    return {
      ok: false,
      safeMessage: `${HERMES_SERVICE_URL_ENV} is not a usable http(s) URL without embedded credentials.`,
    };
  }

  /**
   * A QUERY OR FRAGMENT ON THE SERVICE URL SILENTLY MISROUTES EVERY REQUEST.
   *
   * `remote-transport.call()` builds each endpoint by concatenation:
   * `${serviceUrl.replace(/\/$/, '')}${path}`. Concatenation is not URL
   * resolution, so a base carrying `?` or `#` swallows the path that follows:
   *
   *   'https://h/mcp#f'      + '/v1/readiness'  ->  path /mcp,  fragment 'f/v1/readiness'
   *   'https://h/mcp?x=1'    + '/v1/readiness'  ->  path /mcp,  query 'x=1/v1/readiness'
   *
   * Every call then reaches the WRONG endpoint and the service answers 404 —
   * or worse, something else answers 200. Origin-only allowlisting cannot see
   * this, because the origin of all three is identical. Refusing here is the
   * check that catches it, and it belongs on the service URL rather than in
   * `originOf`, which is deliberately path-insensitive so an allowlist ENTRY
   * may be written with or without a trailing path.
   *
   * THE CHECK IS ON THE RAW STRING, NOT THE PARSED URL, and that distinction
   * is load-bearing. `new URL('https://h#').hash` is `''` — the parser drops
   * an empty fragment — but the raw string still carries the `#`, and the raw
   * string is what gets concatenated. Testing `parsed.hash` would pass
   * `https://h#` and `https://h?` straight through to misroute every call to
   * `/`. A percent-encoded `%23` or `%3F` inside a path is untouched, because
   * only a literal delimiter truncates a concatenation.
   */
  if (input.raw.includes('#') || input.raw.includes('?')) {
    return {
      ok: false,
      safeMessage:
        `${HERMES_SERVICE_URL_ENV} must not carry a query or a fragment. Endpoint paths are appended to it, `
        + 'so either one would silently redirect every service call to a different path.',
    };
  }

  if (input.trustedOrigins.includes(origin)) return { ok: true, origin };

  if (input.production) {
    return {
      ok: false,
      safeMessage: input.trustedOrigins.length === 0
        ? `A production Relay Bridge must list the Hermes service origin in ${HERMES_TRUSTED_ORIGINS_ENV}. `
          + 'None is configured, so no origin is trusted and the bearer token is sent nowhere.'
        : `The configured ${HERMES_SERVICE_URL_ENV} origin is not in ${HERMES_TRUSTED_ORIGINS_ENV}.`,
    };
  }
  if (isLoopbackOrigin(origin)) return { ok: true, origin };
  return {
    ok: false,
    safeMessage:
      `Outside production, ${HERMES_SERVICE_URL_ENV} must be a loopback origin, or its exact origin must be `
      + `listed in ${HERMES_TRUSTED_ORIGINS_ENV}.`,
  };
}

/**
 * Choose a transport from the environment, failing closed.
 *
 * `production` matters: leaving the mode unset is a reasonable convenience on
 * a developer machine that really does have Hermes, and is not reasonable in
 * production, where an unset mode previously meant "probe this container's
 * PATH" — the original bug. In production an unset mode is a configuration
 * error, stated as one.
 */
export function selectHermesMode(input: {
  env: NodeJS.ProcessEnv;
  production: boolean;
}): HermesModeSelection {
  const raw = (input.env[HERMES_MODE_ENV] ?? '').trim();

  if (raw === '') {
    if (input.production) {
      return {
        ok: false, kind: 'configuration_missing',
        safeMessage:
          `No ${HERMES_MODE_ENV} is configured. A production Relay Bridge must be told explicitly whether the `
          + 'Hermes Reviewer runs locally or as a dedicated service; it will not guess.',
      };
    }
    // Development default, documented: the historical behaviour.
    return { ok: true, mode: 'local', executableOverride: readExecutable(input.env) };
  }

  if (!(HERMES_MODES as readonly string[]).includes(raw)) {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `${HERMES_MODE_ENV} must be one of: ${HERMES_MODES.join(', ')}.`,
    };
  }

  if (raw === 'local') {
    return { ok: true, mode: 'local', executableOverride: readExecutable(input.env) };
  }

  // remote — every piece is required, and none is inferred.
  //
  // EVERY problem is reported, not the first. Adding the trusted-origin gate
  // made this matter: an untrusted origin AND a missing token used to surface
  // one at a time, so an operator fixed one, redeployed, and discovered the
  // other — which is exactly the failure `loadServiceConfig` already avoids by
  // returning every problem it finds. A refusal is a refusal either way; the
  // only thing at stake is how many restarts it takes to act on it.
  const serviceUrl = (input.env[HERMES_SERVICE_URL_ENV] ?? '').trim();
  const serviceToken = (input.env[HERMES_SERVICE_TOKEN_ENV] ?? '').trim();
  const problems: string[] = [];

  if (serviceUrl === '') {
    problems.push(`${HERMES_MODE_ENV} is remote but no ${HERMES_SERVICE_URL_ENV} is configured.`);
  } else {
    // The bearer token goes to this origin, so the origin is checked before
    // the configuration is accepted — never after it has been used.
    const urlVerdict = checkServiceUrl({
      raw: serviceUrl,
      production: input.production,
      trustedOrigins: parseTrustedOrigins(input.env[HERMES_TRUSTED_ORIGINS_ENV]),
    });
    if (!urlVerdict.ok) problems.push(urlVerdict.safeMessage);
  }
  if (serviceToken === '') {
    problems.push(`${HERMES_MODE_ENV} is remote but no ${HERMES_SERVICE_TOKEN_ENV} is configured.`);
  }
  if (problems.length > 0) {
    return { ok: false, kind: 'configuration_missing', safeMessage: problems.join(' ') };
  }
  return { ok: true, mode: 'remote', serviceUrl, serviceToken };
}

function readExecutable(env: NodeJS.ProcessEnv): string | null {
  const raw = (env[HERMES_EXECUTABLE_ENV] ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * A URL string existing is not a healthy service.
 *
 * Kept as its own function so the point is impossible to miss at a call site:
 * selection proves the bridge is CONFIGURED to reach a service, and says
 * nothing about whether one answered.
 */
export function selectionProvesReachability(): false {
  return false;
}
