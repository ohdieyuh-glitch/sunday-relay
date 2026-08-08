import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  betaEnabled, betaWaveZeroState, handleBetaRoute, isBetaRoute,
  BETA_ENABLED_ENV, BETA_WAVE_0_OPEN_ENV,
} from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import type { BetaWaveConfig } from '../src/relay/mission/beta';

/**
 * THE BETA ADMISSION ROUTES.
 *
 * The security shape is the split: anyone may ASK, only an operator may learn
 * the ANSWER, and asking never admits. These tests exist to hold that line —
 * a public route that could admit, or that leaked the roster, would turn a
 * controlled beta into an open one.
 */

const TOKEN = 'operator-token';
const T = '2026-08-08T10:00:00.000Z';
const ENABLED: NodeJS.ProcessEnv = { [BETA_ENABLED_ENV]: '1', RELAY_BRIDGE_API_TOKEN: TOKEN };
const OPEN_100: BetaWaveConfig[] = [{ wave: 'wave_0', state: 'open', seats: 100 }];

let root: string;
let store: ReturnType<typeof createBetaEnrolmentStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-beta-routes-'));
  store = createBetaEnrolmentStore({ root });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const call = (
  method: string, path: string,
  over: Partial<Parameters<typeof handleBetaRoute>[0]> = {},
  s: typeof store | null = store,
) => handleBetaRoute({
  method, path, authorization: undefined, body: undefined,
  env: ENABLED, now: T, waves: OPEN_100, ...over,
}, s);

const asOperator = { authorization: `Bearer ${TOKEN}` };

describe('anyone may ask, and asking admits nobody', () => {
  it('records a public request without granting anything', async () => {
    const result = await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    expect(result?.status).toBe(200);
    const data = (result?.body as { data: Record<string, unknown> }).data;
    expect(data.recorded).toBe(true);
    // THE LOAD-BEARING ASSERTION. A public route that could admit would make
    // the cap decorative.
    expect(data.admitted).toBe(false);
    expect(String(data.note)).toContain('not granted');
    expect(store.countFor('wave_0')).toBe(1);
  });

  it('needs no operator token — that is what "public signup" means', async () => {
    const result = await call('POST', '/beta/request', { body: { participantId: 'stranger' } });
    expect(result?.status).toBe(200);
  });

  it('a repeat request is recorded once', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    const again = await call('POST', '/beta/request', {
      body: { participantId: 'alice' }, now: '2026-08-09T00:00:00.000Z',
    });
    const data = (again?.body as { data: Record<string, unknown> }).data;
    expect(data.recorded).toBe(true);
    expect(store.countFor('wave_0')).toBe(1);
  });

  it('the caller cannot choose their wave', async () => {
    // Naming your own wave means naming the one with room, and the cap decides
    // nothing. The body is read for a participant id and nothing else.
    await call('POST', '/beta/request', {
      body: { participantId: 'alice', wave: 'wave_3' },
    });
    expect(store.countFor('wave_0')).toBe(1);
    expect(store.countFor('wave_3')).toBe(0);
  });

  it.each([
    ['missing', {}],
    ['not a string', { participantId: 42 }],
    ['a path escape', { participantId: '../../etc/passwd' }],
    ['empty', { participantId: '   ' }],
  ])('refuses %s rather than storing it', async (_l, body) => {
    const result = await call('POST', '/beta/request', { body });
    expect(result?.status).toBe(422);
    expect(store.countFor('wave_0')).toBe(0);
  });
});

describe('only an operator may learn the answer', () => {
  it.each([
    ['POST', '/beta/access'],
    ['GET', '/beta/status'],
  ])('refuses %s %s without a token', async (method, path) => {
    const result = await call(method, path, { body: { participantId: 'alice' } });
    expect(result?.status).toBe(401);
  });

  it('answers the gate for an operator', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    const result = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'alice' },
    });
    expect((result?.body as { data: { admitted: boolean } }).data.admitted).toBe(true);
  });

  it('refuses someone who never asked, as a records fact', async () => {
    const result = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'nobody' },
    });
    const data = (result?.body as { data: Record<string, unknown> }).data;
    expect(data.admitted).toBe(false);
    expect(data.reason).toBe('not_enrolled');
  });
});

describe('the 100-seat cap is enforced by the route, not merely configured', () => {
  it('admits the hundredth and refuses the hundred-and-first', async () => {
    for (let i = 0; i < 101; i += 1) {
      await call('POST', '/beta/request', {
        body: { participantId: `p${String(i).padStart(3, '0')}` },
        // Distinct instants, so the queue order is the request order.
        now: `2026-08-08T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      });
    }
    // THE HUNDRED-AND-FIRST NEVER GOT A RECORD. The cap is now enforced at
    // signup too, so a stranger cannot consume a seat they can never use.
    expect(store.countFor('wave_0')).toBe(100);
    expect((store.list('wave_0') ?? []).some((e) => e.participantId === 'p100')).toBe(false);

    const hundredth = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'p099' },
    });
    expect((hundredth?.body as { data: { admitted: boolean } }).data.admitted).toBe(true);

    // And the gate agrees about the one that was turned away at the door.
    const overflow = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'p100' },
    });
    const data = (overflow?.body as { data: Record<string, unknown> }).data;
    expect(data.admitted).toBe(false);
    expect(data.reason).toBe('not_enrolled');
  });
});

describe('it is off, and not ready, unless it truly is', () => {
  it('refuses every route when the flag is absent', async () => {
    for (const [m, p] of [['POST', '/beta/request'], ['POST', '/beta/access'], ['GET', '/beta/status']]) {
      const result = await call(m, p, { env: { RELAY_BRIDGE_API_TOKEN: TOKEN } });
      expect(result?.status).toBe(403);
    }
    expect(betaEnabled({})).toBe(false);
    expect(betaEnabled({ [BETA_ENABLED_ENV]: 'true' })).toBe(false);
    expect(betaEnabled({ [BETA_ENABLED_ENV]: '1' })).toBe(true);
  });

  it('answers not_ready without a store rather than pretending to record', async () => {
    const result = await call('POST', '/beta/request', { body: { participantId: 'alice' } }, null);
    expect(result?.status).toBe(503);
    expect((result?.body as { error: { kind: string } }).error.kind).toBe('beta_not_ready');
  });

  it('admits nobody when no wave is configured', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    const result = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'alice' }, waves: [],
    });
    const data = (result?.body as { data: Record<string, unknown> }).data;
    expect(data.admitted).toBe(false);
    // Absent config cannot honestly mean anything but "no wave to admit to".
    expect(data.reason).toBe('unknown_wave');
  });

  it('names a wave the deployment never configured rather than showing it closed', async () => {
    const result = await call('GET', '/beta/status', asOperator);
    const data = (result?.body as { data: { unconfigured: string[] } }).data;
    expect(data.unconfigured).toEqual(['wave_1', 'wave_2', 'wave_3']);
  });

  it('claims no path it does not serve', () => {
    expect(isBetaRoute('/beta/request')).toBe(true);
    expect(isBetaRoute('/loop/status')).toBe(false);
  });
});

describe('opening the wave is a deliberate act, never a side effect of deploying', () => {
  it('an unset variable means NOT OPEN, which admits nobody', () => {
    // The only thing a missing decision can honestly mean.
    expect(betaWaveZeroState({})).toBe('not_open');
    expect(betaWaveZeroState({ [BETA_WAVE_0_OPEN_ENV]: '' })).toBe('not_open');
    expect(betaWaveZeroState({ [BETA_WAVE_0_OPEN_ENV]: 'true' })).toBe('not_open');
    expect(betaWaveZeroState({ [BETA_WAVE_0_OPEN_ENV]: 'yes' })).toBe('not_open');
  });

  it('only an exact 1 opens it, and "closed" closes it', () => {
    expect(betaWaveZeroState({ [BETA_WAVE_0_OPEN_ENV]: '1' })).toBe('open');
    expect(betaWaveZeroState({ [BETA_WAVE_0_OPEN_ENV]: 'closed' })).toBe('closed');
  });

  it('a not_open wave records requests and admits nobody', async () => {
    // The public path still works — people may ask before it opens — and the
    // gate refuses every one of them until someone opens it.
    const waves: BetaWaveConfig[] = [{ wave: 'wave_0', state: 'not_open', seats: 100 }];
    await call('POST', '/beta/request', { body: { participantId: 'alice' }, waves });
    expect(store.countFor('wave_0')).toBe(1);
    const result = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'alice' }, waves,
    });
    const data = (result?.body as { data: Record<string, unknown> }).data;
    expect(data.admitted).toBe(false);
    expect(data.reason).toBe('wave_not_open');
  });
});

describe('strangers cannot consume the wave, and cannot read it back', () => {
  const SEATS_3: BetaWaveConfig[] = [{ wave: 'wave_0', state: 'open', seats: 3 }];

  it('refuses a NEW request once the wave is full, instead of recording it', async () => {
    // Review filled all 100 production seats anonymously in 671ms; every real
    // customer was then number 101, forever, with no in-product remedy.
    for (const id of ['a', 'b', 'c']) {
      await call('POST', '/beta/request', { body: { participantId: id }, waves: SEATS_3 });
    }
    expect(store.countFor('wave_0')).toBe(3);

    const overflow = await call('POST', '/beta/request', {
      body: { participantId: 'bot' }, waves: SEATS_3,
    });
    expect(overflow?.status).toBe(429);
    // THE SEAT WAS NOT TAKEN. A refusal that still records is not a refusal.
    expect(store.countFor('wave_0')).toBe(3);
    expect((store.list('wave_0') ?? []).some((e) => e.participantId === 'bot')).toBe(false);
  });

  it('answers a full wave the SAME WAY for members and strangers', async () => {
    // Skipping the cap for an existing holder was kind and made the route a
    // membership oracle the moment the wave filled — a state an attacker can
    // create in three seconds, after which 200-versus-429 answered "is this id
    // enrolled?" for free and without writing anything. A member loses nothing
    // by being refused here: they already hold their seat, and this route
    // grants nothing either way.
    for (const id of ['a', 'b', 'c']) {
      await call('POST', '/beta/request', { body: { participantId: id }, waves: SEATS_3 });
    }
    const member = await call('POST', '/beta/request', {
      body: { participantId: 'a' }, waves: SEATS_3,
    });
    const stranger = await call('POST', '/beta/request', {
      body: { participantId: 'zz' }, waves: SEATS_3,
    });
    expect(member?.status).toBe(429);
    expect(member?.status).toBe(stranger?.status);
    expect(member?.body).toEqual(stranger?.body);
    // And neither took a seat.
    expect(store.countFor('wave_0')).toBe(3);
  });

  it('cannot be used to ask whether someone is already in the beta', async () => {
    // The old body differed on `alreadyRequested` and echoed the STORED
    // instant, so anyone could ask "is <id> enrolled, and when did they join?"
    // — and `enrolledAt` orders the queue, so that leaked their seat position.
    await call('POST', '/beta/request', { body: { participantId: 'known' } });
    const known = await call('POST', '/beta/request', {
      body: { participantId: 'known' }, now: '2026-12-25T00:00:00.000Z',
    });
    const unknown = await call('POST', '/beta/request', {
      body: { participantId: 'unknown' }, now: '2026-12-25T00:00:00.000Z',
    });
    expect(known?.body).toEqual(unknown?.body);
    // And it echoes the REQUEST's instant, never the stored one.
    expect((known?.body as { data: { receivedAt: string } }).data.receivedAt)
      .toBe('2026-12-25T00:00:00.000Z');
  });

  it('records nothing against a count it does not have', async () => {
    const blind = { ...store, countFor: () => null };
    const result = await call('POST', '/beta/request', {
      body: { participantId: 'alice' },
    }, blind as typeof store);
    expect(result?.status).toBe(503);
  });
});

describe('a seat can be given back, through a route an operator can reach', () => {
  it('frees a seat, and the next person gets in', async () => {
    // `store.remove` existed and nothing called it, so "a seat can be given
    // back" was true of a function and false of the product.
    const SEATS_1: BetaWaveConfig[] = [{ wave: 'wave_0', state: 'open', seats: 1 }];
    await call('POST', '/beta/request', { body: { participantId: 'squatter' }, waves: SEATS_1 });

    const blocked = await call('POST', '/beta/request', {
      body: { participantId: 'real' }, waves: SEATS_1,
    });
    expect(blocked?.status).toBe(429);

    const removed = await call('POST', '/beta/remove', {
      ...asOperator, body: { participantId: 'squatter', wave: 'wave_0' }, waves: SEATS_1,
    });
    expect((removed?.body as { data: { removed: boolean; seatsTaken: number } }).data)
      .toMatchObject({ removed: true, seatsTaken: 0 });

    const admitted = await call('POST', '/beta/request', {
      body: { participantId: 'real' }, waves: SEATS_1,
    });
    expect(admitted?.status).toBe(200);
  });

  it('is operator-only — a stranger cannot free somebody else\'s seat', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    const result = await call('POST', '/beta/remove', {
      body: { participantId: 'alice', wave: 'wave_0' },
    });
    expect(result?.status).toBe(401);
    expect(store.countFor('wave_0')).toBe(1);
  });

  it('removing someone who was never there is the truth, not an error', async () => {
    const result = await call('POST', '/beta/remove', {
      ...asOperator, body: { participantId: 'ghost', wave: 'wave_0' },
    });
    expect(result?.status).toBe(200);
    expect((result?.body as { data: { removed: boolean } }).data.removed).toBe(false);
  });

  it('refuses a wave outside the closed set', async () => {
    const result = await call('POST', '/beta/remove', {
      ...asOperator, body: { participantId: 'alice', wave: 'wave_9' },
    });
    expect(result?.status).toBe(422);
  });
});

describe('an operator can turn away a caller they know is hostile', () => {
  it('blocks, frees their seat, and refuses them indistinguishably from a full wave', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'mallory' } });
    expect(store.countFor('wave_0')).toBe(1);

    const blocked = await call('POST', '/beta/block', {
      ...asOperator, body: { participantId: 'mallory' },
    });
    const data = (blocked?.body as { data: { blocked: boolean; seatsFreed: string[] } }).data;
    expect(data.blocked).toBe(true);
    // A block that left the seat held would stop the caller and keep the damage.
    expect(data.seatsFreed).toEqual(['wave_0']);
    expect(store.countFor('wave_0')).toBe(0);

    const again = await call('POST', '/beta/request', { body: { participantId: 'mallory' } });
    const fresh = await call('POST', '/beta/request', { body: { participantId: 'ok' } });
    expect(again?.status).toBe(429);
    // INDISTINGUISHABLE FROM A FULL WAVE on purpose: a distinct "you are
    // blocked" is a free oracle, and it tells them to come back as someone else.
    expect(store.countFor('wave_0')).toBe(1); // only `ok` got in
    expect(fresh?.status).toBe(200);
  });

  it('is operator-only', async () => {
    const result = await call('POST', '/beta/block', { body: { participantId: 'x' } });
    expect(result?.status).toBe(401);
  });

  it('unblocking lets them back in', async () => {
    await call('POST', '/beta/block', { ...asOperator, body: { participantId: 'm' } });
    expect((await call('POST', '/beta/request', { body: { participantId: 'm' } }))?.status).toBe(429);
    await call('POST', '/beta/unblock', { ...asOperator, body: { participantId: 'm' } });
    expect((await call('POST', '/beta/request', { body: { participantId: 'm' } }))?.status).toBe(200);
  });
});

describe('the route CONSULTS the limiter — wiring, not just the unit', () => {
  it('refuses when the limiter refuses, and records nothing', async () => {
    // THREE CONTROLS IN THIS FEATURE SHIPPED WITH THEIR TOP-LEVEL WIRING
    // MISSING: `store.remove` with no caller, `participantId` with no host,
    // and the limiter's own call site unpinned. Mutation showed "the route
    // never applies the rate limit" passing every test. This is the cheapest
    // way to stop the fourth.
    const refusing = { check: () => ({ allowed: false, limit: 'per_key' as const, retryAfterSeconds: 42 }) };
    const result = await call('POST', '/beta/request', {
      body: { participantId: 'alice' },
      rateLimit: { limiter: refusing, clientKey: '1.2.3.4', nowMs: 0 },
    });
    expect(result?.status).toBe(429);
    const error = (result?.body as { error: { kind: string; retryAfterSeconds: number } }).error;
    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(42);
    // Refused before any volume write.
    expect(store.countFor('wave_0')).toBe(0);
  });

  it('passes the claimed client key through, so the limiter can tell callers apart', async () => {
    const seen: string[] = [];
    const spy = {
      check: (key: string) => {
        seen.push(key);
        return { allowed: true, limit: null, retryAfterSeconds: 0 };
      },
    };
    await call('POST', '/beta/request', {
      body: { participantId: 'alice' },
      rateLimit: { limiter: spy, clientKey: '9.9.9.9', nowMs: 0 },
    });
    expect(seen).toEqual(['9.9.9.9']);
  });
});
