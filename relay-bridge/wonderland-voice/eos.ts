import { createPublicKey, verify as verifySignature } from 'node:crypto';

/** One RSA key as Epic publishes it (a JWK): enough for `createPublicKey({ format: 'jwk' })`. */
export interface WonderlandJwk { readonly kty: string; readonly kid?: string; readonly n?: string; readonly e?: string; readonly alg?: string; readonly use?: string }

import {
  WONDERLAND_EOS_DEFAULT_ISSUERS,
  WONDERLAND_EOS_PUID,
  checkWonderlandEosIdTokenClaims,
  type WonderlandEosClaimRefusal,
  type WonderlandEosExpectation,
} from '../../src/relay/mission/wonderland-voice';

/**
 * EPIC ONLINE SERVICES, FROM THE BRIDGE: configuration, identity, and voice rooms.
 *
 * TWO CREDENTIALS, NEVER CONFUSED.
 *   - The GAME CLIENT's (`WONDERLAND_EOS_CLIENT_ID` / `_SECRET`, a client policy
 *     for game clients): the minimum a packaged game needs to start the EOS SDK.
 *     It is delivered AT RUNTIME to an authenticated player and never baked into
 *     a package or written to disk by the backend.
 *   - The TRUSTED SERVER's (`WONDERLAND_EOS_TRUSTED_CLIENT_ID` / `_SECRET`): what
 *     the backend uses to mint voice room tokens. It never leaves the backend:
 *     `readWonderlandEosClientConfig` does not read those variables at all, and a
 *     test fills them with markers and proves no client-facing value carries one.
 *
 * NETWORK IS INJECTED. Every call to Epic goes through a `fetch` the caller
 * passes, so the tests run with no network and a deployment without EOS
 * configured never calls anything. The Web API shapes (OAuth client
 * credentials, `rtc/v1/{deployment}/room/{room}`) follow Epic's documentation as
 * known on 2026-10-04; the first live call is the confirmation (READY FOR
 * LOCAL QUALIFICATION).
 */

export const WONDERLAND_EOS_ENV = Object.freeze({
  productId: 'WONDERLAND_EOS_PRODUCT_ID',
  sandboxId: 'WONDERLAND_EOS_SANDBOX_ID',
  deploymentId: 'WONDERLAND_EOS_DEPLOYMENT_ID',
  clientId: 'WONDERLAND_EOS_CLIENT_ID',
  clientSecret: 'WONDERLAND_EOS_CLIENT_SECRET',
});
export const WONDERLAND_EOS_TRUSTED_ENV = Object.freeze({
  clientId: 'WONDERLAND_EOS_TRUSTED_CLIENT_ID',
  clientSecret: 'WONDERLAND_EOS_TRUSTED_CLIENT_SECRET',
});
export const WONDERLAND_EOS_ISSUERS_ENV = 'WONDERLAND_EOS_ID_TOKEN_ISSUERS';
export const WONDERLAND_EOS_API_BASE = 'https://api.epicgames.dev';

export interface WonderlandEosClientConfig {
  readonly productId: string;
  readonly sandboxId: string;
  readonly deploymentId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

type Env = Readonly<Record<string, string | undefined>>;
const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/** The game client's minimum configuration, or exactly which variables are missing. Never a partial config. */
export function readWonderlandEosClientConfig(env: Env):
  | { readonly ok: true; readonly config: WonderlandEosClientConfig }
  | { readonly ok: false; readonly missing: readonly string[] } {
  const missing = Object.values(WONDERLAND_EOS_ENV).filter((name) => !present(env[name]));
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: Object.freeze({
      productId: env[WONDERLAND_EOS_ENV.productId]!.trim(),
      sandboxId: env[WONDERLAND_EOS_ENV.sandboxId]!.trim(),
      deploymentId: env[WONDERLAND_EOS_ENV.deploymentId]!.trim(),
      clientId: env[WONDERLAND_EOS_ENV.clientId]!.trim(),
      clientSecret: env[WONDERLAND_EOS_ENV.clientSecret]!.trim(),
    }),
  };
}

/** What a verified Connect ID token must say to be ours. */
export function wonderlandEosExpectation(config: WonderlandEosClientConfig, env: Env): WonderlandEosExpectation {
  const issuers = present(env[WONDERLAND_EOS_ISSUERS_ENV])
    ? env[WONDERLAND_EOS_ISSUERS_ENV]!.split(',').map((issuer) => issuer.trim()).filter((issuer) => issuer !== '')
    : [...WONDERLAND_EOS_DEFAULT_ISSUERS];
  return { issuers, productId: config.productId, sandboxId: config.sandboxId, deploymentId: config.deploymentId, clientId: config.clientId };
}

export type WonderlandFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ readonly status: number; json(): Promise<unknown> }>;

const base64url = (value: string): Buffer => Buffer.from(value.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64');

/**
 * VERIFY AN EOS CONNECT ID TOKEN: the RS256 signature against Epic's published
 * key with the token's `kid`, then the claims (`checkWonderlandEosIdTokenClaims`).
 * The algorithm is checked BEFORE a key is looked up, so `none` and HMAC never
 * reach a verifier. A key set that cannot be fetched is a refusal, never a pass.
 */
export async function verifyWonderlandEosIdToken(input: {
  readonly token: string;
  readonly expect: WonderlandEosExpectation;
  readonly nowSeconds: number;
  readonly keys: () => Promise<readonly WonderlandJwk[]>;
}): Promise<{ readonly ok: true; readonly productUserId: string } | { readonly ok: false; readonly reason: WonderlandEosClaimRefusal | 'token_malformed' | 'key_unknown' | 'signature_invalid' | 'keys_unavailable' }> {
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) return { ok: false, reason: 'token_malformed' };
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64url(parts[0]!).toString('utf8')) as Record<string, unknown>;
    payload = JSON.parse(base64url(parts[1]!).toString('utf8')) as Record<string, unknown>;
  } catch { return { ok: false, reason: 'token_malformed' }; }
  if (header === null || typeof header !== 'object' || payload === null || typeof payload !== 'object') return { ok: false, reason: 'token_malformed' };
  if (header.alg !== 'RS256') return { ok: false, reason: 'header_alg_not_rs256' };
  let keys: readonly WonderlandJwk[];
  try { keys = await input.keys(); } catch { return { ok: false, reason: 'keys_unavailable' }; }
  const jwk = keys.find((key) => (key as { kid?: unknown }).kid === header.kid && (key.kty === 'RSA'));
  if (jwk === undefined) return { ok: false, reason: 'key_unknown' };
  let valid = false;
  try {
    valid = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as never, format: 'jwk' }), base64url(parts[2]!));
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'signature_invalid' };
  const claims = checkWonderlandEosIdTokenClaims({ header, payload, expect: input.expect, nowSeconds: input.nowSeconds });
  return claims.ok ? { ok: true, productUserId: claims.productUserId } : claims;
}

/** Epic's published keys, cached for a while, re-fetched on an unknown kid at most once per refresh window. */
export function createWonderlandEosKeySet(fetcher: WonderlandFetch, url = `${WONDERLAND_EOS_API_BASE}/auth/v1/oauth/jwks`, ttlMs = 60 * 60_000, now: () => number = Date.now) {
  let cached: { keys: readonly WonderlandJwk[]; at: number } | null = null;
  return async (): Promise<readonly WonderlandJwk[]> => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.keys;
    const response = await fetcher(url);
    if (response.status !== 200) throw new Error(`wonderland_eos_jwks_status_${String(response.status)}`);
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('wonderland_eos_jwks_malformed');
    cached = { keys: body.keys as WonderlandJwk[], at: now() };
    return cached.keys;
  };
}

/**
 * THE TRUSTED SERVER'S VOICE PORT. `roomToken` asks Epic for one participant's
 * token for one room (creating the room on first use); `removeParticipant` takes
 * a participant out of a room, which is how a block or a hide is enforced on a
 * token already issued.
 */
export interface WonderlandEosVoicePort {
  roomToken(input: { readonly roomId: string; readonly productUserId: string }): Promise<{ readonly token: string; readonly clientBaseUrl: string }>;
  removeParticipant(input: { readonly roomId: string; readonly productUserId: string }): Promise<void>;
}

export function createWonderlandEosVoicePort(input: {
  readonly fetcher: WonderlandFetch;
  readonly deploymentId: string;
  readonly trustedClientId: string;
  readonly trustedClientSecret: string;
  readonly apiBase?: string;
  readonly now?: () => number;
}): WonderlandEosVoicePort {
  const apiBase = input.apiBase ?? WONDERLAND_EOS_API_BASE;
  const now = input.now ?? Date.now;
  let access: { token: string; expiresAt: number } | null = null;
  const bearer = async (): Promise<string> => {
    if (access !== null && access.expiresAt - 30_000 > now()) return access.token;
    const response = await input.fetcher(`${apiBase}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${input.trustedClientId}:${input.trustedClientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials&deployment_id=${encodeURIComponent(input.deploymentId)}`,
    });
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (response.status !== 200 || typeof body.access_token !== 'string') throw new Error(`wonderland_eos_oauth_status_${String(response.status)}`);
    access = { token: body.access_token, expiresAt: now() + (typeof body.expires_in === 'number' ? body.expires_in * 1000 : 60_000) };
    return access.token;
  };
  const roomUrl = (roomId: string): string =>
    `${apiBase}/rtc/v1/${encodeURIComponent(input.deploymentId)}/room/${encodeURIComponent(roomId)}`;
  return {
    async roomToken({ roomId, productUserId }) {
      if (!WONDERLAND_EOS_PUID.test(productUserId)) throw new Error('wonderland_eos_puid_invalid');
      const response = await input.fetcher(roomUrl(roomId), {
        method: 'POST',
        headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ participants: [{ puid: productUserId, hardMuted: false }] }),
      });
      const body = (await response.json()) as { clientBaseUrl?: unknown; participants?: Array<{ puid?: unknown; token?: unknown }> };
      const mine = Array.isArray(body.participants) ? body.participants.find((participant) => participant.puid === productUserId) : undefined;
      if (response.status !== 200 || typeof body.clientBaseUrl !== 'string' || typeof mine?.token !== 'string') {
        throw new Error(`wonderland_eos_room_token_status_${String(response.status)}`);
      }
      return { token: mine.token, clientBaseUrl: body.clientBaseUrl };
    },
    async removeParticipant({ roomId, productUserId }) {
      const response = await input.fetcher(`${roomUrl(roomId)}/participants/${encodeURIComponent(productUserId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${await bearer()}` },
      });
      // Gone already is the outcome wanted; anything else is a failure the caller must see.
      if (response.status !== 200 && response.status !== 204 && response.status !== 404) {
        throw new Error(`wonderland_eos_remove_status_${String(response.status)}`);
      }
    },
  };
}
