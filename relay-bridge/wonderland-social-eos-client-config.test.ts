import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore } from '../src/relay/social/social-store';
import { createInMemoryVoiceBindings } from '../src/relay/social/voice-binding';
import { EOS_CLIENT_CONFIG_SCHEMA, hashId, type EosGameClientConfig } from './eos-voice';
import {
  createSessionRateLimit,
  EOS_CLIENT_CONFIG_RATE,
  handleSocialRoute,
  type PartyVoiceTokenMinter,
  type SocialRouteDeps,
  type SessionRateDecision,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * GET /wonderland/social/voice/eos-client-config (MAIN's internal review a6d5842c, M4): the route that hands a signed-in player the
 * GAME client's five EOS values, a client secret among them. What the shipped client relies on is pinned here (CORE's client
 * contract, 10-07: CLIENT_BACKEND_CONTRACT.md 3a and MISMATCHES.md C): the schema tag and five non-empty strings, the gates,
 * 503 without the game config / the minter / the bindings / the limiter, 429 on the 7th call in a minute for ONE session,
 * no-store, and a log line that names only the hashed player. Every value is planted at run time.
 */

const T0 = Date.parse('2026-10-07T12:00:00.000Z');
const PATH = '/wonderland/social/voice/eos-client-config';
const hex = (n: number) => randomBytes(n).toString('hex');

/** A session token "usr_x" is player usr_x in session usr_x; "usr_x#2" is the same player in another session. */
const facts = (token: string): SocialSessionFacts | null =>
  token.startsWith('usr_') ? { sessionId: token, participantId: token.split('#')[0], capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social', issuedAtMs: T0 } : null;

/** The game client's config as the bridge holds it (loadEosGameClientConfig freezes it), planted at run time. */
const plantedGameConfig = (): EosGameClientConfig =>
  Object.freeze({ productId: hex(16), sandboxId: hex(16), deploymentId: hex(16), clientId: `xyza${hex(14)}`, clientSecret: `planted-game-${hex(16)}` });

/** The config route never mints: a minter that would say so. */
const minter: PartyVoiceTokenMinter = {
  providerId: 'eos',
  mint: async () => {
    throw new Error('the config route never mints');
  },
  removeFromRoom: async () => undefined,
};

type Answer = { status: number; body: { data?: Record<string, unknown>; error?: { kind: string; message: string } }; headers?: Readonly<Record<string, string>> };

function world(over: Partial<SocialRouteDeps> = {}) {
  const log: string[] = [];
  const config = plantedGameConfig();
  const deps: SocialRouteDeps = {
    verifySession: (token) => facts(token),
    sessionIssuedAt: null,
    identify: async (id) => ({ userId: id, displayName: id, handle: `@${id}` }),
    store: createInMemorySocialStore(),
    voice: minter,
    voiceBindings: createInMemoryVoiceBindings(),
    eosClientConfig: config,
    eosClientConfigAllowed: createSessionRateLimit(EOS_CLIENT_CONFIG_RATE.limit, EOS_CLIENT_CONFIG_RATE.windowMs),
    log: (line) => log.push(line),
    ...over,
  };
  const get = (token: string | null, now: number, origin?: string) =>
    handleSocialRoute({ method: 'GET', path: PATH, authorization: token === null ? undefined : `Relay-Session ${token}`, origin, body: null, now }, deps) as Promise<Answer>;
  return { deps, config, log, get };
}

describe('GET /voice/eos-client-config: what a signed-in desktop client is handed (review a6d5842c, M4)', () => {
  it("exactly six keys: the schema tag and the GAME client's five values, all non-empty strings; no-store; the log names only the hashed player", async () => {
    const w = world();
    const r = await w.get('usr_kai', T0);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data ?? {}).sort()).toEqual(['clientId', 'clientSecret', 'deploymentId', 'productId', 'sandboxId', 'schema']);
    expect(r.body.data).toEqual({ schema: EOS_CLIENT_CONFIG_SCHEMA, ...w.config });
    expect(EOS_CLIENT_CONFIG_SCHEMA).toBe('wonderland-eos-client-config.v1'); // the tag the client checks before it reads a value
    for (const [key, value] of Object.entries(r.body.data ?? {})) expect(typeof value === 'string' && value.length > 0, key).toBe(true);
    expect(r.headers).toMatchObject({ 'cache-control': 'no-store', pragma: 'no-cache' });
    expect(w.log).toEqual([`eos client config served to ${hashId('usr_kai')}`]);
    for (const line of w.log) for (const raw of [...Object.values(w.config), 'usr_kai']) expect(line).not.toContain(raw);
  });

  it('at most six a minute per SESSION: the seventh is 429 (no config, no-store, not logged as served); another session is not charged; a minute on it serves again', async () => {
    const w = world();
    for (let i = 0; i < EOS_CLIENT_CONFIG_RATE.limit; i += 1) expect((await w.get('usr_kai', T0 + i * 1000)).status, `call ${i + 1}`).toBe(200);
    expect(EOS_CLIENT_CONFIG_RATE).toEqual({ limit: 6, windowMs: 60_000 });
    const seventh = await w.get('usr_kai', T0 + 6000);
    expect(seventh.status).toBe(429);
    expect(seventh.body.error?.kind).toBe('rate_limited');
    expect(seventh.body.data).toBeUndefined();
    expect(JSON.stringify(seventh.body)).not.toContain(w.config.clientSecret);
    expect(seventh.headers?.['cache-control']).toBe('no-store');
    // Retry-After, as every other social 429 (CORE's client contract, 10-07): the first call leaves the window at T0 + 60 s
    expect(seventh.headers?.['retry-after']).toBe('54');
    expect(seventh.body.error?.message).toBe('Too many requests for the voice config; try again in 54 s.');
    expect((await w.get('usr_kai', T0 + 59_999)).headers?.['retry-after']).toBe('1');
    expect(w.log).toHaveLength(6);
    // the limit is the session's: the same player's other session, and another player, are served at the same instant
    expect((await w.get('usr_kai#2', T0 + 6000)).status).toBe(200);
    expect((await w.get('usr_nova', T0 + 6000)).status).toBe(200);
    // once the first call has left the window (the refused seventh was not counted), the session is served again
    expect((await w.get('usr_kai', T0 + 60_001)).status).toBe(200);
  });

  it("every 503 says WHICH piece is missing -- no game config, no rate limit, no voice provider, no binding store (035 not served) -- each its own sentence, the status 503 (CORE's client review 10-07); no-store, nothing served, logged or charged", async () => {
    const NO_GAME_CONFIG = "VOICE TRANSPORT PENDING: the game client's EOS config is not loaded on this server.";
    const cases: Array<[string, Partial<SocialRouteDeps>, string]> = [
      ['no game config', { eosClientConfig: null }, NO_GAME_CONFIG],
      ['no game config (absent)', { eosClientConfig: undefined }, NO_GAME_CONFIG],
      ['no rate limit', { eosClientConfigAllowed: null }, 'VOICE TRANSPORT PENDING: the voice config rate limit is not configured on this server.'],
      ['no voice provider', { voice: null }, 'VOICE TRANSPORT PENDING: no voice provider is configured on this server.'],
      ['no binding store (migration 035 not served)', { voiceBindings: null }, 'VOICE TRANSPORT PENDING: no voice binding store is configured on this server.'],
    ];
    const said = new Set<string>();
    for (const [label, over, message] of cases) {
      let charged = 0;
      const counting = (): SessionRateDecision => {
        charged += 1;
        return { ok: true };
      };
      const w = world({ eosClientConfigAllowed: counting, ...over });
      const r = await w.get('usr_kai', T0);
      expect(r.status, label).toBe(503);
      expect(r.body, label).toEqual({ error: { kind: 'voice_unavailable', message } });
      expect(JSON.stringify(r.body), label).not.toContain(w.config.clientSecret);
      expect(r.headers?.['cache-control'], label).toBe('no-store');
      expect(w.log, label).toEqual([]);
      expect(charged, label).toBe(0);
      said.add(message);
    }
    expect(said.size, 'four missing pieces, four sentences').toBe(4);
    // several missing at once: the game config is named first (without it, af2eb058 m-c starts no voice provider either)
    const both = world({ eosClientConfig: null, voice: null });
    expect((await both.get('usr_kai', T0)).body.error?.message).toBe(NO_GAME_CONFIG);
    // the control: the same world with everything present serves, and charges the limit once
    let charged = 0;
    const counting = (): SessionRateDecision => {
      charged += 1;
      return { ok: true };
    };
    expect((await world({ eosClientConfigAllowed: counting }).get('usr_kai', T0)).status).toBe(200);
    expect(charged).toBe(1);
  });

  it('the gates come first: no session or a dead one is 401, a browser origin 403, no social capability 403, no player 403 -- nothing served, logged or charged', async () => {
    let charged = 0;
    const counting = (): SessionRateDecision => {
      charged += 1;
      return { ok: true };
    };
    const w = world({ eosClientConfigAllowed: counting });
    expect((await w.get(null, T0)).status).toBe(401);
    expect((await w.get('not-a-session', T0)).status).toBe(401);
    const browser = await w.get('usr_kai', T0, 'https://evil.example');
    expect([browser.status, browser.body.error?.kind]).toEqual([403, 'desktop_only']);
    const noSocial = world({ eosClientConfigAllowed: counting, verifySession: () => ({ sessionId: 's', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [] }) });
    const refused = await noSocial.get('usr_kai', T0);
    expect([refused.status, refused.body.error?.kind]).toEqual([403, 'not_permitted']);
    const unknown = world({ eosClientConfigAllowed: counting, identify: async () => null });
    const nobody = await unknown.get('usr_kai', T0);
    expect([nobody.status, nobody.body.error?.kind]).toEqual([403, 'unknown_player']);
    for (const [r, config] of [[browser, w.config], [refused, noSocial.config], [nobody, unknown.config]] as const) {
      expect(r.body.data).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toContain(config.clientSecret);
    }
    expect(charged).toBe(0);
    expect([...w.log, ...noSocial.log, ...unknown.log]).toEqual([]);
  });
});
