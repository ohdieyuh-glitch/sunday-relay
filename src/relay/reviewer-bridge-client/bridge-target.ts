import type { BridgeError, BridgeResult } from './bridge-contracts';

/**
 * WHERE THE BRIDGE IS, AND WHETHER IT IS SAFE TO TALK TO.
 *
 * A bridge token is a bearer credential. Sending one to the wrong origin, or
 * over cleartext to a remote host, hands it to whoever is listening — so the
 * target is validated BEFORE any request is built, and a configured remote
 * bridge never silently degrades to localhost.
 *
 * Plain HTTP is permitted for loopback only, because that is genuinely how
 * local development works and forcing TLS there would push operators toward
 * disabling verification instead.
 */

export const BRIDGE_URL_ENV = 'RELAY_BRIDGE_URL';
export const BRIDGE_TOKEN_ENV = 'RELAY_BRIDGE_TOKEN';

/** The one route family. A second namespace would be a second contract. */
export const BRIDGE_API_BASE = '/relay-api';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || /^127\./.test(host);
}

export interface BridgeTarget {
  /** Origin + path prefix, trailing slash normalised away. */
  readonly baseUrl: string;
  readonly origin: string;
  readonly loopback: boolean;
}

const fail = (kind: BridgeError['kind'], message: string): BridgeResult<never> =>
  ({ ok: false, error: { kind, message } });

/**
 * Validates and normalises the configured bridge URL.
 *
 * Deliberately strict, and deliberately silent about nothing: each rejection
 * names the rule it broke, because an operator who mistypes a scheme should
 * not have to guess.
 */
export function resolveBridgeTarget(raw: string | undefined | null): BridgeResult<BridgeTarget> {
  const value = (raw ?? '').trim();
  if (value === '') {
    return fail(
      'configuration_missing',
      `No Relay Bridge is configured. Set ${BRIDGE_URL_ENV} to reach a live Reviewer.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('invalid_bridge_url', `${BRIDGE_URL_ENV} is not a valid absolute URL.`);
  }

  // A credential in the URL would be logged by every proxy in the path, and
  // would also be a second, unmanaged place a secret can live.
  if (url.username !== '' || url.password !== '') {
    return fail('invalid_bridge_url', `${BRIDGE_URL_ENV} must not embed credentials.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('invalid_bridge_url', `${BRIDGE_URL_ENV} must use http or https.`);
  }
  if (url.search !== '' || url.hash !== '') {
    return fail('invalid_bridge_url', `${BRIDGE_URL_ENV} must not carry a query string or fragment.`);
  }

  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === 'http:' && !loopback) {
    return fail(
      'insecure_remote_url',
      `${BRIDGE_URL_ENV} uses plain HTTP to a remote host. A bridge token must not travel in cleartext — use https.`,
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, value: { baseUrl: `${url.origin}${path}`, origin: url.origin, loopback } };
}

/** The token, read from the environment only. Never returned to a caller. */
export function resolveBridgeToken(raw: string | undefined | null): BridgeResult<string> {
  const value = (raw ?? '').trim();
  if (value === '') {
    return fail(
      'configuration_missing',
      `No Relay Bridge token is configured. Set ${BRIDGE_TOKEN_ENV} to authenticate.`,
    );
  }
  return { ok: true, value };
}

/**
 * Redacts anything token-shaped from text that is about to be shown.
 *
 * The client already avoids putting the token in messages; this is the second
 * lock, for text that came back from a server we do not control.
 */
export function redactBridgeSecrets(text: string, token?: string | null): string {
  let out = text;
  if (token !== undefined && token !== null && token.length >= 4) {
    out = out.split(token).join('[redacted]');
  }
  return out
    .replace(/(Authorization\s*[:=]\s*)(\S+)/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(xai|sk|rlb)-[A-Za-z0-9._-]{8,}/gi, '[redacted]');
}
