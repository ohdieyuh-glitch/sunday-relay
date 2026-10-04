/**
 * EOS IDENTITY — WHICH EOS PRODUCT USER A WONDERLAND PLAYER IS, PROVEN, NOT CLAIMED.
 *
 * A voice token is issued for an EOS ProductUserId (PUID). If the client could
 * simply NAME its PUID, any player could ask for tokens as someone else and sit
 * in their rooms, so the client proves it instead: it sends the EOS Connect ID
 * token its own SDK obtained at login, the bridge verifies the signature against
 * Epic's published keys (Node, `relay-bridge/wonderland-voice`), and this file
 * decides whether the VERIFIED claims bind THIS player to THAT PUID.
 *
 * WHAT IS CHECKED, and why each:
 *   alg      RS256 only; `none` and HMAC are refused before any key is looked up.
 *   iss      one of the configured issuers (Epic's, by default).
 *   sub      a well-formed PUID (32 lower-case hex): the identity being bound.
 *   pfdid    our deployment, and pfsid our sandbox, and pfpid our product:
 *            a token for another game, sandbox or deployment is not ours.
 *   aud/appid  our game client's id.
 *   exp/iat  not expired, not issued in the future (60 s of clock skew).
 * The claim NAMES follow Epic's EOS Connect ID-token documentation as known on
 * 2026-10-04; they are constants here so the founder's first live binding can
 * confirm or correct them in one place (CORE/SECOND, READY FOR LOCAL QUALIFICATION).
 *
 * Pure: time is injected (seconds); no crypto here.
 */

export const WONDERLAND_EOS_DEFAULT_ISSUERS = Object.freeze(['https://api.epicgames.dev/auth/v1/oauth']);
export const WONDERLAND_EOS_PUID = /^[0-9a-f]{32}$/u;
export const WONDERLAND_EOS_CLOCK_SKEW_SECONDS = 60;

export interface WonderlandEosExpectation {
  readonly issuers: readonly string[];
  readonly productId: string;
  readonly sandboxId: string;
  readonly deploymentId: string;
  readonly clientId: string;
}

export const WONDERLAND_EOS_CLAIM_REFUSALS = [
  'header_alg_not_rs256',
  'issuer_not_allowed',
  'subject_not_a_puid',
  'deployment_mismatch',
  'sandbox_mismatch',
  'product_mismatch',
  'client_mismatch',
  'expired',
  'issued_in_future',
  'claims_malformed',
] as const;
export type WonderlandEosClaimRefusal = (typeof WONDERLAND_EOS_CLAIM_REFUSALS)[number];

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const audiences = (value: unknown): readonly string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * DO THESE VERIFIED CLAIMS NAME A PUID OF OURS? Call only with a header and
 * payload whose signature has already been verified; this decides meaning, not
 * authenticity.
 */
export function checkWonderlandEosIdTokenClaims(input: {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly expect: WonderlandEosExpectation;
  readonly nowSeconds: number;
}): { readonly ok: true; readonly productUserId: string; readonly expiresAt: number } | { readonly ok: false; readonly reason: WonderlandEosClaimRefusal } {
  const { header, payload, expect } = input;
  if (header.alg !== 'RS256') return { ok: false, reason: 'header_alg_not_rs256' };
  const issuer = text(payload.iss);
  if (issuer === null || !expect.issuers.includes(issuer)) return { ok: false, reason: 'issuer_not_allowed' };
  const subject = text(payload.sub);
  if (subject === null || !WONDERLAND_EOS_PUID.test(subject)) return { ok: false, reason: 'subject_not_a_puid' };
  if (text(payload.pfdid) !== expect.deploymentId) return { ok: false, reason: 'deployment_mismatch' };
  if (text(payload.pfsid) !== expect.sandboxId) return { ok: false, reason: 'sandbox_mismatch' };
  if (text(payload.pfpid) !== expect.productId) return { ok: false, reason: 'product_mismatch' };
  const clients = [...audiences(payload.aud), ...audiences(payload.appid)];
  if (!clients.includes(expect.clientId)) return { ok: false, reason: 'client_mismatch' };
  const exp = payload.exp;
  const iat = payload.iat;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || typeof iat !== 'number' || !Number.isFinite(iat)) return { ok: false, reason: 'claims_malformed' };
  if (exp <= input.nowSeconds) return { ok: false, reason: 'expired' };
  if (iat > input.nowSeconds + WONDERLAND_EOS_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'issued_in_future' };
  return { ok: true, productUserId: subject, expiresAt: exp };
}

/**
 * ONE PLAYER, ONE PUID, AND NO PUID FOR TWO PLAYERS.
 *
 * A PUID already bound to ANOTHER player is refused: otherwise whoever presented
 * a stolen token second would take over the first player's voice identity. A
 * player may re-bind to a NEW PUID (a new EOS account); the store keeps the
 * history.
 */
export type WonderlandVoiceBindingDecision =
  | { readonly outcome: 'BIND' | 'UNCHANGED' | 'REBIND'; readonly previousProductUserId: string | null }
  | { readonly outcome: 'REFUSED'; readonly reason: 'puid_bound_to_another_player' };

export function decideWonderlandVoiceBinding(input: {
  readonly playerId: string;
  readonly productUserId: string;
  /** The PUID this player holds now, if any. */
  readonly currentForPlayer: string | null;
  /** The player who holds this PUID now, if any. */
  readonly currentHolder: string | null;
}): WonderlandVoiceBindingDecision {
  if (input.currentHolder !== null && input.currentHolder !== input.playerId) return { outcome: 'REFUSED', reason: 'puid_bound_to_another_player' };
  if (input.currentForPlayer === input.productUserId) return { outcome: 'UNCHANGED', previousProductUserId: input.currentForPlayer };
  return { outcome: input.currentForPlayer === null ? 'BIND' : 'REBIND', previousProductUserId: input.currentForPlayer };
}
