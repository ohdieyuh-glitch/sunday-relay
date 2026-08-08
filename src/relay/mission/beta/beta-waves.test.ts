import { describe, expect, it } from 'vitest';

import {
  decideBetaAccess, projectWaveStatus,
  type BetaEnrollment, type BetaWaveConfig,
} from './beta-waves';

/**
 * CONTROLLED BETA WAVES.
 *
 * The point of these tests is that "no" has five different meanings and the
 * product must not collapse them. An operator who cannot tell "we never invited
 * them" from "we invited them and ran out of seats" cannot run a beta.
 */

const enrolled = (participantId: string, wave = 'wave_0' as const): BetaEnrollment =>
  ({ participantId, wave, enrolledAt: '2026-08-08T10:00:00.000Z' });

const openWave = (seats: number): BetaWaveConfig =>
  ({ wave: 'wave_0', state: 'open', seats });

describe('a wave admits only someone it actually holds a record for', () => {
  it('admits an enrolled participant inside the seats, and says when they enrolled', () => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [enrolled('p1')],
      waves: [openWave(10)],
      occupancy: { wave_0: 1 },
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.wave).toBe('wave_0');
      expect(decision.enrolledAt).toBe('2026-08-08T10:00:00.000Z');
    }
  });

  it('NOT ENROLLED is a fact about our records, not a refusal we made', () => {
    const decision = decideBetaAccess({
      participantId: 'stranger',
      enrollments: [enrolled('p1')],
      waves: [openWave(10)],
      occupancy: { wave_0: 1 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) {
      expect(decision.reason).toBe('not_enrolled');
      expect(decision.detail).toContain('not a decision about them');
    }
  });
});

describe('the five refusals stay five different facts', () => {
  it.each([
    ['not opened', 'not_open' as const, 'wave_not_open'],
    ['closed', 'closed' as const, 'wave_closed'],
  ])('a wave that is %s refuses with its own reason', (_label, state, expected) => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [enrolled('p1')],
      waves: [{ wave: 'wave_0', state, seats: 10 }],
      occupancy: { wave_0: 0 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe(expected);
  });

  it('an enrollment naming a wave this build lacks is not an instruction to admit', () => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [{ ...enrolled('p1'), wave: 'wave_9' as never }],
      waves: [openWave(10)],
      occupancy: { wave_0: 0 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('unknown_wave');
  });

  it('a participant beyond the seats is FULL, not un-enrolled', () => {
    const decision = decideBetaAccess({
      participantId: 'p3',
      enrollments: [enrolled('p1'), enrolled('p2'), enrolled('p3')],
      waves: [openWave(2)],
      occupancy: { wave_0: 3 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) {
      expect(decision.reason).toBe('wave_full');
      expect(decision.detail).toContain('number 3');
    }
  });

  it('someone inside the cap keeps their seat when the wave later overfills', () => {
    // Position in the wave's own enrollment list is the authority, so a seat is
    // not lost because somebody else opened the app first this morning.
    const enrollments = [enrolled('p1'), enrolled('p2'), enrolled('p3')];
    const first = decideBetaAccess({
      participantId: 'p1', enrollments, waves: [openWave(2)], occupancy: { wave_0: 3 },
    });
    expect(first.admitted).toBe(true);
  });
});

describe('UNKNOWN OCCUPANCY IS NOT AN EMPTY WAVE', () => {
  it.each([
    ['null', null],
    ['absent', undefined],
  ])('refuses rather than admitting against a count it does not have (%s)', (_label, taken) => {
    // Reading an uncountable cohort as empty is how a capped beta silently
    // becomes an uncapped one — the exact shape of the provider-call cap that
    // could never fire.
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [enrolled('p1')],
      waves: [openWave(10)],
      occupancy: taken === undefined ? {} : { wave_0: taken },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('occupancy_unknown');
  });
});

describe('what an operator is shown about a wave', () => {
  it('reports seats remaining, and that it is ADMITTING, when everything is known', () => {
    const status = projectWaveStatus(openWave(10), { wave_0: 4 });
    expect(status).toMatchObject({
      wave: 'wave_0', state: 'open', seats: 10, seatsTaken: 4, seatsRemaining: 6, admitting: true,
    });
  });

  it('reports Unknown — never zero — when occupancy cannot be counted', () => {
    // "The wave is full" and "we cannot tell" are different facts, and only one
    // of them is a reason to stop inviting people.
    const status = projectWaveStatus(openWave(10), { wave_0: null });
    expect(status.seatsTaken).toBeNull();
    expect(status.seatsRemaining).toBeNull();
    expect(status.seatsRemaining).not.toBe(0);
    expect(status.admitting).toBe(false);
  });

  it('a full wave remains open but stops admitting', () => {
    const status = projectWaveStatus(openWave(4), { wave_0: 4 });
    expect(status.state).toBe('open');
    expect(status.seatsRemaining).toBe(0);
    expect(status.admitting).toBe(false);
  });

  it('an unopened wave never admits, however many seats it has', () => {
    const status = projectWaveStatus({ wave: 'wave_0', state: 'not_open', seats: 100 }, { wave_0: 0 });
    expect(status.admitting).toBe(false);
  });
});
