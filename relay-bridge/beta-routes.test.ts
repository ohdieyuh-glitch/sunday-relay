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

  it('a repeat request is recorded once and says so', async () => {
    await call('POST', '/beta/request', { body: { participantId: 'alice' } });
    const again = await call('POST', '/beta/request', {
      body: { participantId: 'alice' }, now: '2026-08-09T00:00:00.000Z',
    });
    const data = (again?.body as { data: Record<string, unknown> }).data;
    expect(data.alreadyRequested).toBe(true);
    // The ORIGINAL instant — a retry must not move a participant's place.
    expect(data.requestedAt).toBe(T);
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
    expect(store.countFor('wave_0')).toBe(101);

    const hundredth = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'p099' },
    });
    expect((hundredth?.body as { data: { admitted: boolean } }).data.admitted).toBe(true);

    const overflow = await call('POST', '/beta/access', {
      ...asOperator, body: { participantId: 'p100' },
    });
    const data = (overflow?.body as { data: Record<string, unknown> }).data;
    expect(data.admitted).toBe(false);
    expect(data.reason).toBe('wave_full');
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
