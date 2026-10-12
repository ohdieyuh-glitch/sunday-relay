import { describe, expect, it } from 'vitest';
import { PRIVATE_SERVER_POLICY } from '../src/relay/social/private-server-lifecycle';
import { createInMemoryPrivateServerRegistry } from '../src/relay/social/private-server-registry';
import { createInMemorySocialStore } from '../src/relay/social/social-store';
import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * THE FOUNDER'S PRIVATE-SERVER RULES (2026-10-11) THROUGH THE REAL ROUTES: the request's time is the BRIDGE's clock (`now`, set by
 * server.ts from Date.now()), never anything in the body; a cooldown is a 409 whose message the client shows verbatim; records that
 * cannot be read are a 503 that opens nothing. The session store and account lookup are stand-ins, as in wonderland-social-routes.test.ts.
 */

const T0 = Date.parse('2026-10-12T08:00:00.000Z');
const W = PRIVATE_SERVER_POLICY.freeActiveWindowMs;
const C = PRIVATE_SERVER_POLICY.freeCooldownMs;
const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': { sessionId: 's1', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

function bridge() {
  const registry = createInMemoryPrivateServerRegistry();
  const store = createInMemorySocialStore(undefined, { privateServers: registry });
  let clock = T0;
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
    identify: async (participantId) => ({ userId: participantId, displayName: 'Kai', handle: '@kai' }),
    store,
  };
  const post = async (path: string, body: unknown, at: number) => {
    clock = at;
    const result = await handleSocialRoute({ method: 'POST', path: `/wonderland/social${path}`, authorization: 'Relay-Session tok-kai', origin: undefined, body, now: clock }, deps);
    if (result === null) throw new Error(`not a social route: ${path}`);
    return result as { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  };
  return { registry, post };
}

describe('private servers through the routes', () => {
  it('a Free player opens one (200), with the closing time from the BRIDGE clock; a body\'s time / tier / state is ignored', async () => {
    const b = bridge();
    const r = await b.post('/world/join', { target: 'PRIVATE', name: 'Lab', now: '2031-01-01T00:00:00.000Z', nowMs: T0 + 1e9, tier: 'MAX', activeUntil: 9e15 }, T0);
    expect(r.status).toBe(200);
    expect(r.body.data.context.lifecycle).toEqual({ status: 'ACTIVE', closesAtIso: new Date(T0 + W).toISOString(), closesInMs: W, tier: 'FREE' });
    expect(b.registry.stored('usr_kai')).toMatchObject({ cycleTier: 'FREE', activatedAtMs: T0, activeUntilMs: T0 + W });
  });

  it('during the cooldown the open is a 409 whose message names when it opens again; after it, 200 again', async () => {
    const b = bridge();
    await b.post('/world/join', { target: 'PRIVATE' }, T0);
    const resting = await b.post('/world/join', { target: 'PRIVATE', nowMs: T0 + W + C + 1 }, T0 + W + 1000);
    expect(resting.status).toBe(409);
    expect(resting.body.error?.message).toContain(new Date(T0 + W + C).toISOString().slice(0, 16).replace('T', ' '));
    expect((await b.post('/world/join', { target: 'PRIVATE' }, T0 + W + C)).status).toBe(200);
  });

  it('records that cannot be read: 503 (an outage, retry), and the player is in no private server', async () => {
    const b = bridge();
    b.registry.failReads(true);
    const r = await b.post('/world/join', { target: 'PRIVATE' }, T0);
    expect(r.status).toBe(503);
    b.registry.failReads(false);
    expect(b.registry.stored('usr_kai')).toBeNull();
  });
});
