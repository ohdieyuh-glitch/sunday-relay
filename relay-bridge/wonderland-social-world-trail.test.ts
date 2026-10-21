import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { WORLD_TRAIL_MAX_AGE_MS, WORLD_TRAIL_MAX_ENTRIES } from '../src/relay/social/world-presence';
import { GOLDEN_CALLS, runGoldenScenario, type GoldenCall } from './wonderland-social-world-golden.test';
import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * THE TRANSPORT RING THROUGH THE REAL ROUTES (r16reh18 PROTOTYPE, before the reviewer's T1 ruling; not evidence). The wire names
 * `sinceMs`, `asOfMs` and `trail` are PROVISIONAL: the T1 design doc fixes them.
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');

const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': { sessionId: 't1', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-nova': { sessionId: 't2', participantId: 'usr_nova', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

function relay(store: SocialStore = createInMemorySocialStore()) {
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
    identify: async (participantId) => ({ userId: participantId, displayName: participantId.replace('usr_', ''), handle: `@${participantId.replace('usr_', '')}` }),
    store,
  };
  const call = async (token: string, method: 'GET' | 'POST', path: string, body: unknown, ms: number) => {
    const result = await handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${token}`, origin: undefined, body, now: T0 + ms }, deps);
    if (result === null) throw new Error(`not a social route: ${path}`);
    return result as { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  };
  return { call, store };
}

const pos = (x: number) => ({ x, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', skinId: 'shadow_flame' });

/** A world answer with the ring's additions taken out: what today's answer would be. */
function withoutRing(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRing);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => k !== 'asOfMs' && k !== 'trail').map(([k, v]) => [k, withoutRing(v)]));
  }
  return value;
}

describe('the ring through the real routes', () => {
  it("RING-W01 with sinceMs on every report, every answer of the golden scenario is today's bytes plus asOfMs and trail, and nothing else", async () => {
    const recorded = readFileSync(join(__dirname, 'wonderland-social-world-golden.fixture.txt'), 'utf8').split('\n').filter((l) => l.length > 0);
    const opted: GoldenCall[] = GOLDEN_CALLS.map(([token, method, path, body, ms]) => (path === '/world/state' && body !== null && typeof body === 'object' ? [token, method, path, { ...body, sinceMs: 0 }, ms] : [token, method, path, body, ms]));
    const lines = await runGoldenScenario(opted);
    expect(lines.length).toBe(recorded.length);
    let trails = 0;
    let asOf = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = JSON.parse(lines[i]);
      if (lines[i].includes('"trail":')) trails += 1;
      if (lines[i].includes('"asOfMs":')) asOf += 1;
      expect(`${i}: ${JSON.stringify(withoutRing(parsed))}`).toBe(`${i}: ${recorded[i]}`);
    }
    expect(trails).toBeGreaterThan(0);
    expect(asOf).toBeGreaterThan(0);
  });

  it('RING-W02 after a backend restart (a new store) the first answer with sinceMs is 200, with asOfMs and no trail', async () => {
    const r = relay();
    await r.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
    for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', '/world/state', pos(ms), ms);
    const restarted = relay();
    await restarted.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 400);
    await restarted.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 401);
    await restarted.call('tok-nova', 'POST', '/world/state', pos(500), 500);
    const answer = await restarted.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: T0 + 300 }, 550);
    expect(answer.status).toBe(200);
    expect(answer.body.data.asOfMs).toBe(T0 + 550);
    expect(answer.body.data.avatars.map((a: any) => [a.userId, a.x, a.trail])).toEqual([['usr_nova', 500, undefined]]);
  });

  it('RING-W03 a garbage sinceMs through the routes is never an error, and the report it rides on is still stored', async () => {
    for (const sinceMs of ['abc', -1, 1e308, 1.5, {}, [1], true, null, -0]) {
      const r = relay();
      await r.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
      await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
      const answer = await r.call('tok-kai', 'POST', '/world/state', { ...pos(42), sinceMs }, 100);
      expect(answer.status).toBe(200);
      const seen = await r.call('tok-nova', 'GET', '/world', null, 150);
      expect(seen.body.data.avatars.map((a: any) => [a.userId, a.x])).toEqual([['usr_kai', 42]]);
    }
  });

  it('RING-W04 the client loop: a viewer polling three times slower than the subject reports, echoing asOfMs, learns every stored report once, in order', async () => {
    const r = relay();
    await r.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
    const events: Array<{ ms: number; who: 'nova' | 'kai' }> = [];
    for (let k = 0; k < 60; k += 1) events.push({ ms: 1000 + k * 100 + 7, who: 'nova' });
    for (let k = 0; k < 20; k += 1) events.push({ ms: 1000 + k * 300 + 53, who: 'kai' });
    events.sort((a, b) => a.ms - b.ms);
    const stored: number[] = [];
    const learned: number[] = [];
    let since: number | undefined;
    for (const e of events) {
      if (e.who === 'nova') {
        await r.call('tok-nova', 'POST', '/world/state', pos(e.ms), e.ms);
        stored.push(T0 + e.ms);
        continue;
      }
      const answer = await r.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: since ?? 0 }, e.ms);
      const nova = answer.body.data.avatars.find((a: any) => a.userId === 'usr_nova');
      const asOf: number = answer.body.data.asOfMs;
      if (nova !== undefined) {
        for (const p of nova.trail ?? []) learned.push(asOf - p.ageMs);
        if (!learned.includes(nova.reportedAtMs)) learned.push(nova.reportedAtMs);
      }
      since = asOf;
    }
    const firstView = T0 + 1053;
    const reachable = stored.filter((t) => t <= T0 + 1000 + 19 * 300 + 53 && t >= firstView - WORLD_TRAIL_MAX_AGE_MS);
    expect(learned).toEqual([...new Set(learned)]);
    expect(learned).toEqual([...learned].sort((a, b) => a - b));
    expect(learned).toEqual(reachable);
  });

  it(`RING-W05 a viewer that stalls is served at most ${WORLD_TRAIL_MAX_ENTRIES - 1} trail reports, none older than ${WORLD_TRAIL_MAX_AGE_MS} ms`, async () => {
    const r = relay();
    await r.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
    const first = await r.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: 0 }, 50);
    for (let ms = 100; ms <= 3000; ms += 100) await r.call('tok-nova', 'POST', '/world/state', pos(ms), ms);
    const answer = await r.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: first.body.data.asOfMs }, 3050);
    const trail = answer.body.data.avatars[0].trail as Array<{ ageMs: number }>;
    expect(trail.length).toBe(WORLD_TRAIL_MAX_ENTRIES - 1);
    expect(trail.every((p) => p.ageMs <= WORLD_TRAIL_MAX_AGE_MS)).toBe(true);
  });

  it('RING-W06 through the routes, nothing a subject reported while blocked reaches the viewer after the block ends, whatever its cursor', async () => {
    const r = relay();
    await r.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
    for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', '/world/state', pos(ms), ms);
    expect((await r.call('tok-kai', 'POST', '/blocks', { targetId: 'usr_nova' }, 350)).status).toBe(200);
    for (const ms of [400, 500, 600]) await r.call('tok-nova', 'POST', '/world/state', pos(ms), ms);
    const during = await r.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: 0 }, 650);
    expect(during.body.data.avatars).toEqual([]);
    expect((await r.call('tok-kai', 'POST', '/blocks/usr_nova/remove', {}, 700)).status).toBe(200);
    await r.call('tok-nova', 'POST', '/world/state', pos(800), 800);
    const after = await r.call('tok-kai', 'POST', '/world/state', { ...pos(1), sinceMs: 0 }, 850);
    expect(after.body.data.avatars.map((a: any) => [a.userId, a.x, a.trail])).toEqual([['usr_nova', 800, undefined]]);
  });
});
