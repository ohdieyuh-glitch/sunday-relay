import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { guardBetaAdmission, participantFromBody } from './beta-guard';
import { BETA_ENABLED_ENV } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import type { BetaWaveConfig } from '../src/relay/mission/beta';

/**
 * THE ADMISSION GUARD.
 *
 * The gate decided, the store recorded, the routes answered — and none of it
 * stopped anybody doing anything until this. These tests hold the two halves:
 * with the beta OFF nothing changes, and with it ON nobody unnamed or
 * unadmitted reaches the pipeline that spends money.
 */

const T = '2026-08-08T10:00:00.000Z';
const ON: NodeJS.ProcessEnv = { [BETA_ENABLED_ENV]: '1' };
const OPEN_1: BetaWaveConfig[] = [{ wave: 'wave_0', state: 'open', seats: 1 }];

let root: string;
let store: ReturnType<typeof createBetaEnrolmentStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-beta-guard-'));
  store = createBetaEnrolmentStore({ root });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('with the beta OFF it is not a gate at all', () => {
  it('lets everything through, including an unnamed caller', () => {
    // Turning the beta on is what makes admission required. A bridge that
    // never opted in must behave exactly as it did.
    expect(guardBetaAdmission({ env: {}, participantId: null, store, waves: OPEN_1 })).toBeNull();
    expect(guardBetaAdmission({
      env: {}, participantId: 'nobody', store: null, waves: [],
    })).toBeNull();
  });
});

describe('with the beta ON, nobody unnamed or unadmitted gets through', () => {
  it('refuses a request that names no participant', () => {
    const result = guardBetaAdmission({ env: ON, participantId: null, store, waves: OPEN_1 });
    expect(result?.status).toBe(403);
    expect((result?.body as { error: { kind: string } }).error.kind).toBe('beta_admission_required');
  });

  it('admits an enrolled participant inside the cap', () => {
    store.enrol('alice', 'wave_0', T);
    expect(guardBetaAdmission({
      env: ON, participantId: 'alice', store, waves: OPEN_1,
    })).toBeNull();
  });

  it('refuses someone who never asked, and says which', () => {
    const result = guardBetaAdmission({ env: ON, participantId: 'stranger', store, waves: OPEN_1 });
    expect(result?.status).toBe(403);
    const error = (result?.body as { error: { kind: string; reason: string } }).error;
    expect(error.kind).toBe('beta_not_admitted');
    // The gate's OWN reason. "Never asked", "we are full" and "not open yet"
    // are three different things for the person turned away to do next.
    expect(error.reason).toBe('not_enrolled');
  });

  it('refuses the participant past the cap by name', () => {
    store.enrol('alice', 'wave_0', '2026-08-04T00:00:00.000Z');
    store.enrol('bob', 'wave_0', '2026-08-05T00:00:00.000Z');
    const result = guardBetaAdmission({ env: ON, participantId: 'bob', store, waves: OPEN_1 });
    const error = (result?.body as { error: { reason: string } }).error;
    expect(error.reason).toBe('wave_full');
  });

  it('refuses everyone while the wave has not been opened', () => {
    store.enrol('alice', 'wave_0', T);
    const result = guardBetaAdmission({
      env: ON, participantId: 'alice', store,
      waves: [{ wave: 'wave_0', state: 'not_open', seats: 100 }],
    });
    const error = (result?.body as { error: { reason: string } }).error;
    expect(error.reason).toBe('wave_not_open');
  });

  it('refuses when the beta is on and its records are unreachable', () => {
    // Admitting against no record at all is worse than refusing.
    const result = guardBetaAdmission({
      env: ON, participantId: 'alice', store: null, waves: OPEN_1,
    });
    expect(result?.status).toBe(503);
    expect((result?.body as { error: { kind: string } }).error.kind).toBe('beta_not_ready');
  });
});

describe('it adds a gate and never removes one', () => {
  it('admission is not permission — it returns null, and the route still does its own checks', () => {
    // The guard's only job is admission. Returning `null` means "the beta does
    // not stop this"; every existing authentication, permission and Mission
    // control still applies downstream, unchanged.
    store.enrol('alice', 'wave_0', T);
    const proceed = guardBetaAdmission({ env: ON, participantId: 'alice', store, waves: OPEN_1 });
    expect(proceed).toBeNull();
  });
});

describe('the participant a request claims is read, never trusted', () => {
  it.each([
    ['missing', undefined],
    ['not an object', 'alice'],
    ['not a string', { participantId: 42 }],
    ['blank', { participantId: '   ' }],
  ])('reads %s as no participant', (_l, body) => {
    expect(participantFromBody(body)).toBeNull();
  });

  it('trims a named participant', () => {
    expect(participantFromBody({ participantId: '  alice  ' })).toBe('alice');
  });

  it('a well-formed but unusable id still fails the GATE, not the reader', () => {
    // The reader does not validate shape — the store and gate do. An id that
    // cannot name a record is `not_enrolled`, which is the truth about it.
    const result = guardBetaAdmission({
      env: ON, participantId: '../../etc/passwd', store, waves: OPEN_1,
    });
    expect((result?.body as { error: { reason: string } }).error.reason).toBe('not_enrolled');
  });
});
