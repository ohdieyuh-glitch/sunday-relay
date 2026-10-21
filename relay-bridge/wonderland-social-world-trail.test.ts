import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { WORLD_TRAIL_MAX_AGE_MS, WORLD_TRAIL_MAX_ENTRIES } from '../src/relay/social/world-presence';
import { GOLDEN_CALLS, runGoldenScenario, type GoldenCall } from './wonderland-social-world-golden.test';
import {
  budgetClassesOf,
  createCommandBudgets,
  createPresenceLease,
  endSocialPresence,
  handleSocialRoute,
  type PresenceLease,
  type SocialRouteDeps,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY, SOCIAL_OPERATIONS } from './wonderland-social-scope';

/*
 * THE TRANSPORT RING THROUGH THE REAL ROUTES, to TRANSPORT_RING_DESIGN_T1_v1.md (0a710c29); a PROTOTYPE before the reviewer's T1
 * ruling, not evidence. The cursor is the URL query `?sinceMs=<whole number>`, never a body field (void2 B_WLWORLD_FIELDS).
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');

const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': { sessionId: 't1', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-nova': { sessionId: 't2', participantId: 'usr_nova', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

function relay(store: SocialStore = createInMemorySocialStore(), extra: Partial<SocialRouteDeps> = {}) {
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
    identify: async (participantId) => ({ userId: participantId, displayName: participantId.replace('usr_', ''), handle: `@${participantId.replace('usr_', '')}` }),
    store,
    ...extra,
  };
  const call = async (token: string, method: 'GET' | 'POST', path: string, body: unknown, ms: number) => {
    const result = await handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${token}`, origin: undefined, body, now: T0 + ms }, deps);
    if (result === null) throw new Error(`not a social route: ${path}`);
    return result as { status: number; headers?: Record<string, string>; body: { data?: any; error?: { kind: string; message: string } } };
  };
  const both = async () => {
    await call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0);
    await call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 1);
  };
  return { call, store, both };
}

const pos = (x: number) => ({ x, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', skinId: 'shadow_flame' });
const state = (since?: string | number) => (since === undefined ? '/world/state' : `/world/state?sinceMs=${since}`);

/** A world answer with the ring's additions taken out: what today's answer would be. */
function withoutRing(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRing);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => k !== 'asOfMs' && k !== 'trail').map(([k, v]) => [k, withoutRing(v)]));
  }
  return value;
}

const recorded = () => readFileSync(join(__dirname, 'wonderland-social-world-golden.fixture.txt'), 'utf8').split('\n').filter((l) => l.length > 0);

describe('the ring through the real routes', () => {
  it("RING-W01 R29 with ?sinceMs=0 on every report, every answer of the golden scenario is today's bytes plus asOfMs and trail, and nothing else", async () => {
    const fixture = recorded();
    const opted: GoldenCall[] = GOLDEN_CALLS.map(([token, method, path, body, ms]) => [token, method, path === '/world/state' ? state(0) : path, body, ms]);
    const lines = await runGoldenScenario(opted);
    expect(lines.length).toBe(fixture.length);
    let trails = 0;
    let asOf = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes('"trail":')) trails += 1;
      if (lines[i].includes('"asOfMs":')) asOf += 1;
      expect(`${i}: ${JSON.stringify(withoutRing(JSON.parse(lines[i])))}`).toBe(`${i}: ${fixture[i]}`);
    }
    expect(trails).toBeGreaterThan(0);
    expect(asOf).toBeGreaterThan(0);
  });

  it("R30 an old body, and a body field sinceMs (ignored), give today's answer exactly: every golden answer byte for byte", async () => {
    const fixture = recorded();
    for (const sinceMs of [0, '0', 123]) {
      const bodied: GoldenCall[] = GOLDEN_CALLS.map(([token, method, path, body, ms]) => [token, method, path, path === '/world/state' && body !== null && typeof body === 'object' ? { ...body, sinceMs } : body, ms]);
      expect(await runGoldenScenario(bodied)).toEqual(fixture);
    }
  });

  it('RING-W02 R23 after a backend restart (a new store) the first answer with a cursor is 200, with asOfMs and no trail', async () => {
    const r = relay();
    await r.both();
    for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    const restarted = relay();
    await restarted.call('tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 400);
    await restarted.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 401);
    await restarted.call('tok-nova', 'POST', state(), pos(500), 500);
    const answer = await restarted.call('tok-kai', 'POST', state(T0 + 300), pos(1), 550);
    expect(answer.status).toBe(200);
    expect(answer.body.data.asOfMs).toBe(T0 + 550);
    expect(answer.body.data.avatars.map((a: any) => [a.userId, a.x, a.trail])).toEqual([['usr_nova', 500, undefined]]);
  });

  it("RING-W03 R31 a malformed query value is today's answer -- never a 400 -- and the report it rides on is still stored", async () => {
    for (const since of ['-5', '1.5', '1e3', 'abc', '', '1234567890123456', '%2D5', '0x10', '+5']) {
      const a = relay();
      const b = relay();
      for (const r of [a, b]) {
        await r.both();
        for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
      }
      const bad = await a.call('tok-kai', 'POST', state(since), pos(42), 350);
      const today = await b.call('tok-kai', 'POST', state(), pos(42), 350);
      expect(bad.status, since).toBe(200);
      expect(JSON.stringify(bad.body), since).toBe(JSON.stringify(today.body));
      const seen = await a.call('tok-nova', 'GET', '/world', null, 400);
      expect(seen.body.data.avatars.map((x: any) => [x.userId, x.x])).toEqual([['usr_kai', 42]]);
    }
  });

  it('RING-W04 the client loop: a viewer polling three times slower than the subject reports, echoing asOfMs, learns every stored report at least once, and exactly once after its dedupe by (userId, asOfMs - ageMs)', async () => {
    const r = relay();
    await r.both();
    const events: Array<{ ms: number; who: 'nova' | 'kai' }> = [];
    for (let k = 0; k < 60; k += 1) events.push({ ms: 1000 + k * 100 + 7, who: 'nova' });
    for (let k = 0; k < 20; k += 1) events.push({ ms: 1000 + k * 300 + 53, who: 'kai' });
    events.sort((a, b) => a.ms - b.ms);
    const stored: number[] = [];
    const received: number[] = [];
    const applied: number[] = [];
    let lastServerMs = -1;
    let since: number | undefined;
    for (const e of events) {
      if (e.who === 'nova') {
        await r.call('tok-nova', 'POST', state(), pos(e.ms), e.ms);
        stored.push(T0 + e.ms);
        continue;
      }
      const answer = await r.call('tok-kai', 'POST', state(since ?? 0), pos(1), e.ms);
      const nova = answer.body.data.avatars.find((a: any) => a.userId === 'usr_nova');
      const asOf: number = answer.body.data.asOfMs;
      if (nova !== undefined) {
        // the client's rule (T1 v1 section 4.2): a trail point at or below the last server time applied for that player is a repeat
        for (const p of nova.trail ?? []) {
          const key = asOf - p.ageMs;
          received.push(key);
          if (key <= lastServerMs) continue;
          applied.push(key);
          lastServerMs = key;
        }
        received.push(nova.reportedAtMs);
        if (nova.reportedAtMs > lastServerMs) {
          applied.push(nova.reportedAtMs);
          lastServerMs = nova.reportedAtMs;
        }
      }
      since = asOf;
    }
    const reachable = stored.filter((t) => t <= T0 + 1000 + 19 * 300 + 53);
    expect([...new Set(received)].sort((a, b) => a - b)).toEqual(reachable);
    expect(applied).toEqual(reachable);
  });

  it(`RING-W05 a viewer that stalls is served at most ${WORLD_TRAIL_MAX_ENTRIES - 1} trail reports, none older than ${WORLD_TRAIL_MAX_AGE_MS} ms`, async () => {
    const r = relay();
    await r.both();
    const first = await r.call('tok-kai', 'POST', state(0), pos(1), 50);
    for (let ms = 100; ms <= 3000; ms += 100) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    const answer = await r.call('tok-kai', 'POST', state(first.body.data.asOfMs), pos(1), 3050);
    const trail = answer.body.data.avatars[0].trail as Array<{ ageMs: number }>;
    expect(trail.length).toBe(WORLD_TRAIL_MAX_ENTRIES - 1);
    expect(trail.every((p) => p.ageMs <= WORLD_TRAIL_MAX_AGE_MS)).toBe(true);
  });

  it('RING-W06 R08 through the routes, nothing a subject reported before or while blocked reaches the viewer after the block ends, whatever its cursor', async () => {
    const r = relay();
    await r.both();
    for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    expect((await r.call('tok-kai', 'POST', '/blocks', { targetId: 'usr_nova' }, 350)).status).toBe(200);
    for (const ms of [400, 500, 600]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    expect((await r.call('tok-kai', 'POST', state(0), pos(1), 650)).body.data.avatars).toEqual([]);
    expect((await r.call('tok-kai', 'POST', '/blocks/usr_nova/remove', {}, 700)).status).toBe(200);
    await r.call('tok-nova', 'POST', state(), pos(800), 800);
    const after = await r.call('tok-kai', 'POST', state(0), pos(1), 850);
    expect(after.body.data.avatars.map((a: any) => [a.userId, a.x, a.trail])).toEqual([['usr_nova', 800, undefined]]);
  });

  it('R29 POST /world/state?sinceMs=<n> end to end: the body is the seven report fields, the budget class is still `report`, and over budget is 429 with nothing run', async () => {
    const op = SOCIAL_OPERATIONS.find((o) => o.id === 'world.state');
    expect(op === undefined ? null : budgetClassesOf(op)).toEqual(['report']);
    const r = relay(createInMemorySocialStore(), { commandBudgets: createCommandBudgets() });
    await r.both();
    expect(Object.keys(pos(1)).sort()).toEqual(['motion', 'skinId', 'speed', 'x', 'y', 'yaw', 'z']);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) statuses.push((await r.call('tok-kai', 'POST', state(0), pos(i), 100)).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const refused = await r.call('tok-kai', 'POST', state(0), pos(999), 100);
    expect(refused.status).toBe(429);
    expect(refused.body.data).toBeUndefined();
    expect(refused.headers?.['retry-after']).toBeDefined();
    const seen = await r.call('tok-nova', 'GET', '/world', null, 150);
    expect(seen.body.data.avatars.map((x: any) => x.x)).toEqual([0]);   // the refused report was never run
  });

  it('R32 a sign-out, a lapsed lease, and {connected:false} without a leave: the ring follows the figure exactly; a rejoin restarts it', async () => {
    const lease: PresenceLease = createPresenceLease(5_000);
    const r = relay(createInMemorySocialStore(), { presenceLease: lease });
    await r.both();
    const nova = async (ms: number) => (await r.call('tok-kai', 'POST', state(0), pos(1), ms)).body.data.avatars.find((a: any) => a.userId === 'usr_nova');
    for (const ms of [100, 200, 300]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    // the client's goodbye, without a leave: the figure stays (the filter never reads connected), and its trail with it
    await r.call('tok-nova', 'POST', '/presence', { connected: false }, 350);
    expect((await nova(380))?.trail?.map((p: any) => p.x)).toEqual([100, 200]);
    // a sign-out: presence false, then the leave -- no figure, no trail
    await endSocialPresence(r.store, 'usr_nova', T0 + 400);
    expect(await nova(450)).toBeUndefined();
    // the rejoin restarts the ring: nothing from before it
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 500);
    for (const ms of [600, 700]) await r.call('tok-nova', 'POST', state(), pos(ms), ms);
    expect((await nova(750))?.trail?.map((p: any) => p.x)).toEqual([600]);
    // a lapsed lease: Nova silent past it; Kai's next call ends her presence through the sign-out path
    expect(await nova(700 + 5_000 + 1_100)).toBeUndefined();
    await r.call('tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 7_000);
    await r.call('tok-nova', 'POST', state(), pos(7_100), 7_100);
    const back = await nova(7_150);
    expect([back?.x, back?.trail]).toEqual([7_100, undefined]);
  });
});
