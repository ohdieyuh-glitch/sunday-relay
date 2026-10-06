/**
 * THE VOICE WALL'S BACKEND, IN PROCESS, FOR THE R16 HARNESS.
 *
 * The shipped bridge reaches Epic and only Epic: nothing points its EOS calls
 * anywhere else, and nothing ever may. So the voice half of R16 is proven in
 * process. The social and voice routes are composed here as `server.ts`
 * composes them (`wonderlandVoicePorts`): one session store; a social store and
 * an identity store; the game client's configuration read from an environment;
 * ID tokens checked by the real RS256 verifier; and, when voice is live, the
 * reconcile after every committed social command (the actor's rooms before the
 * answer, everyone else's after it). A fetch puts them behind
 * HTTP-shaped calls. Only Epic's trusted server is a fake, and it keeps the one
 * thing the wall is about: which product users each room admits now.
 *
 * `wallBreaches` reads that fake against the wall's definition, independently
 * of the planner, once the bridge has finished what it started: two players in
 * one room must be mutually visible and in the same instance or party now, and
 * no room holds three.
 *
 * NOT COMPOSED BY THE LIVE ROOT. Nothing on the live path imports this file; it
 * exists for tests.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
  createMemoryWonderlandSocialStore,
  wonderlandPartyOf,
  type WonderlandSocialStore,
} from '../src/relay/mission/wonderland-social';
import {
  createMemoryWonderlandVoiceIdentityStore,
  isWonderlandMutuallyVisible,
  type WonderlandVoiceIdentityStore,
} from '../src/relay/mission/wonderland-voice';
import { createBrowserSessionStore, type BrowserSessionStore } from './browser-session/grants';
import { handleWonderlandSocialRoute, type WonderlandSocialRoutePorts } from './wonderland-social-routes';
import {
  WONDERLAND_EOS_ENV,
  WONDERLAND_EOS_TRUSTED_ENV,
  readWonderlandEosClientConfig,
  verifyWonderlandEosIdToken,
  wonderlandEosExpectation,
  type WonderlandEosVoicePort,
  type WonderlandJwk,
} from './wonderland-voice/eos';
import {
  handleWonderlandVoiceRoute,
  isWonderlandVoiceRoute,
  reconcileWonderlandVoiceAfterCommand,
  settleWonderlandVoice,
  wonderlandVoiceAffected,
  type WonderlandVoiceRoutePorts,
} from './wonderland-voice-routes';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The environment a configured backend reads. The trusted pair is present so the composition is the live one; the fake never uses it. */
export const R16_VOICE_ENV: Readonly<Record<string, string>> = Object.freeze({
  [WONDERLAND_EOS_ENV.productId]: 'r16-product', [WONDERLAND_EOS_ENV.sandboxId]: 'r16-sandbox', [WONDERLAND_EOS_ENV.deploymentId]: 'r16-deployment',
  [WONDERLAND_EOS_ENV.clientId]: 'r16-client', [WONDERLAND_EOS_ENV.clientSecret]: 'r16-client-secret',
  [WONDERLAND_EOS_TRUSTED_ENV.clientId]: 'r16-trusted-id', [WONDERLAND_EOS_TRUSTED_ENV.clientSecret]: 'r16-trusted-secret',
});

/** One signing key for every backend this module makes, published to the verifier as Epic's key set would be. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: 'jwk' }) as WonderlandJwk), kid: 'r16-key', alg: 'RS256', use: 'sig' } as WonderlandJwk;
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A player's EOS product user id: deterministic, and shaped as Epic's are (32 hex). */
export const r16ProductUserIdOf = (playerId: string): string => sha256(`r16-puid:${playerId}`).slice(0, 32);

/** An EOS Connect ID token for `productUserId`, signed with the key the verifier is given: what a game client would carry. */
export function r16IdToken(productUserId: string, nowMs: number, over: Readonly<Record<string, unknown>> = {}): string {
  const nowS = Math.floor(nowMs / 1000);
  const payload = {
    iss: 'https://api.epicgames.dev/auth/v1/oauth', sub: productUserId,
    pfpid: R16_VOICE_ENV[WONDERLAND_EOS_ENV.productId], pfsid: R16_VOICE_ENV[WONDERLAND_EOS_ENV.sandboxId],
    pfdid: R16_VOICE_ENV[WONDERLAND_EOS_ENV.deploymentId], aud: R16_VOICE_ENV[WONDERLAND_EOS_ENV.clientId],
    exp: nowS + 3600, iat: nowS - 5, ...over,
  };
  const signing = `${b64({ alg: 'RS256', kid: 'r16-key', typ: 'JWT' })}.${b64(payload)}`;
  return `${signing}.${sign('RSA-SHA256', Buffer.from(signing), privateKey).toString('base64url')}`;
}

export interface R16FakeTrustedServer {
  /** Room → the product users it admits now: a token admits, a removal takes the admission back. */
  readonly members: ReadonlyMap<string, ReadonlySet<string>>;
  readonly calls: readonly { readonly op: 'token' | 'remove'; readonly roomId: string; readonly productUserId: string }[];
  readonly port: WonderlandEosVoicePort;
}

function fakeTrustedServer(): R16FakeTrustedServer {
  const members = new Map<string, Set<string>>();
  const calls: { op: 'token' | 'remove'; roomId: string; productUserId: string }[] = [];
  return {
    members,
    calls,
    port: {
      async roomToken({ roomId, productUserId }) {
        calls.push({ op: 'token', roomId, productUserId });
        if (!members.has(roomId)) members.set(roomId, new Set());
        members.get(roomId)!.add(productUserId);
        return { token: `r16-room-token:${sha256(`${roomId}:${productUserId}`).slice(0, 16)}`, clientBaseUrl: 'https://rtc.r16.test' };
      },
      async removeParticipant({ roomId, productUserId }) {
        calls.push({ op: 'remove', roomId, productUserId });
        members.get(roomId)?.delete(productUserId);
      },
    },
  };
}

export interface R16VoiceStores {
  readonly social: WonderlandSocialStore;
  readonly identities: WonderlandVoiceIdentityStore;
}

export interface R16VoiceBackendOptions {
  readonly origin: string;
  /** The backend's clock at the start, and how far each request moves it. */
  readonly t0: number;
  readonly stepMs: number;
  /** The durable stores, asked for again at every start. Memory by default; a restart keeps whatever they hold. */
  readonly stores?: () => R16VoiceStores;
  /** Whether EOS is configured on this backend. Off: every voice route answers as an unconfigured backend does. */
  readonly serveVoice?: boolean;
  /**
   * Whether a committed social command reconciles voice, as `server.ts` does when voice is live: the actor before the
   * answer, everyone else the command can move after it. `false` (nobody) and `'actor-only'` (nobody but the actor)
   * are faults, there only to prove the harness notices them.
   */
  readonly reconcile?: boolean | 'actor-only';
}

export function createR16VoiceBackend(options: R16VoiceBackendOptions) {
  const memory = options.stores === undefined
    ? { social: createMemoryWonderlandSocialStore(), identities: createMemoryWonderlandVoiceIdentityStore() }
    : null;
  const stores = options.stores ?? (() => memory!);
  const trusted = fakeTrustedServer();
  const known = new Set<string>();
  /** Removals after a command that failed where nobody could be told: the bridge logs their count. */
  const laterFailures: number[] = [];
  let now = options.t0;
  let sessions: BrowserSessionStore;
  let current: R16VoiceStores;
  let voicePorts: WonderlandVoiceRoutePorts;
  let socialPorts: WonderlandSocialRoutePorts;

  /** One start of the backend: fresh sessions (a restart revokes them all), the stores as they are, and the ports composed as `server.ts` composes them. */
  const start = (): void => {
    sessions = createBrowserSessionStore();
    current = stores();
    const config = readWonderlandEosClientConfig(R16_VOICE_ENV);
    if (!config.ok) throw new Error('r16_voice_env_incomplete');
    const served = options.serveVoice !== false;
    voicePorts = {
      sessions,
      allowNative: false,
      social: current.social,
      identities: current.identities,
      eos: served ? config : { ok: false, missing: [WONDERLAND_EOS_ENV.productId] },
      verifyIdToken: served
        ? (token: string) => verifyWonderlandEosIdToken({
          token, expect: wonderlandEosExpectation(config.config, R16_VOICE_ENV), nowSeconds: Math.floor(now / 1000), keys: async () => [JWK],
        })
        : null,
      voice: served ? trusted.port : null,
      digest: sha256,
    };
    const voiceLive = voicePorts.voice !== null && voicePorts.identities !== null;
    socialPorts = {
      store: current.social,
      sessions,
      allowNative: false,
      ...(voiceLive && options.reconcile !== false ? {
        afterCommand: async ({ actorId, command, before, after, at }) => reconcileWonderlandVoiceAfterCommand(
          voicePorts, actorId, options.reconcile === 'actor-only' ? [actorId] : wonderlandVoiceAffected(before, after, actorId, command), at,
          (failures) => { laterFailures.push(failures); }),
      } satisfies Pick<WonderlandSocialRoutePorts, 'afterCommand'> : {}),
    };
  };
  start();

  const fetch: typeof globalThis.fetch = async (input, init) => {
    now += options.stepMs;
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    const method = init?.method ?? 'GET';
    const result = isWonderlandVoiceRoute(url.pathname)
      ? await handleWonderlandVoiceRoute({ method, path: url.pathname, origin: headers.origin, authorization: headers.authorization, body, now }, voicePorts)
      : await handleWonderlandSocialRoute({
        method, path: url.pathname, url: `${url.pathname}${url.search}`, origin: headers.origin, authorization: headers.authorization, body, now,
      }, socialPorts);
    return new Response(JSON.stringify(result?.body ?? { error: { kind: 'not_found' } }), {
      status: result?.status ?? 404, headers: { 'content-type': 'application/json' },
    });
  };

  /** Sign players in, as pairing does: a fresh session each, bound to the origin. */
  const signIn = (playerIds: readonly string[]): Record<string, string> => Object.fromEntries(playerIds.map((playerId) => {
    const minted = sessions.mintIdentitySession({ origin: options.origin, now, participantId: playerId, scope: 'browser_control' });
    if (!minted.ok) throw new Error('r16_voice_mint_refused');
    known.add(playerId);
    return [playerId, minted.session.token];
  }));

  /**
   * WHAT THE TRUSTED SERVER ADMITS THAT THE WALL FORBIDS, once the bridge has
   * finished what it started: a room holding three, or two players who are not
   * mutually visible, or not in the same instance or party. Read from the
   * fake's memberships, never from the backend's own record of what it issued.
   */
  const wallBreaches = async (): Promise<string[]> => {
    await settleWonderlandVoice(voicePorts);
    const at = new Date(now).toISOString();
    const puids = await current.identities.productUserIdsOf([...known]);
    const playerOf = new Map(Object.entries(puids).map(([playerId, puid]) => [puid, playerId]));
    const breaches: string[] = [];
    for (const [roomId, admitted] of trusted.members) {
      const who = [...admitted].map((puid) => playerOf.get(puid) ?? `an unknown identity ${puid.slice(0, 6)}`).sort();
      if (who.length > 2) breaches.push(`${roomId.slice(0, 10)} admits ${String(who.length)}: ${who.join(', ')}`);
      for (let i = 0; i < who.length; i += 1) {
        for (let j = i + 1; j < who.length; j += 1) {
          const [x, y] = [who[i]!, who[j]!];
          const state = await current.social.voiceStateFor({ participantIds: [x, y], now: at });
          const instance = state.presence[x]?.instanceId;
          const party = wonderlandPartyOf(state, x)?.partyId;
          const together = (instance !== undefined && instance === state.presence[y]?.instanceId)
            || (party !== undefined && party === wonderlandPartyOf(state, y)?.partyId);
          if (!isWonderlandMutuallyVisible(state, x, y)) breaches.push(`${roomId.slice(0, 10)} admits ${x} and ${y}, who are not mutually visible`);
          else if (!together) breaches.push(`${roomId.slice(0, 10)} admits ${x} and ${y}, who share no instance or party`);
        }
      }
    }
    return breaches;
  };

  return {
    fetch,
    signIn,
    trusted,
    wallBreaches,
    laterFailures,
    /** Everything the bridge started, finished: what a command left for after its answer included. */
    settle: (): Promise<void> => settleWonderlandVoice(voicePorts),
    clock: (): number => now,
    advance: (ms: number): void => { now += ms; },
    /** The backend stops and starts again: every session is gone, the stores hold what they held, and Epic's rooms are Epic's. */
    restart: (): void => { start(); },
    stores: (): R16VoiceStores => current,
    /** ID tokens for these players, as their game clients would carry them. */
    idTokens: (playerIds: readonly string[]): Record<string, string> =>
      Object.fromEntries(playerIds.map((playerId) => [playerId, r16IdToken(r16ProductUserIdOf(playerId), now)])),
  };
}

export type R16VoiceBackend = ReturnType<typeof createR16VoiceBackend>;
