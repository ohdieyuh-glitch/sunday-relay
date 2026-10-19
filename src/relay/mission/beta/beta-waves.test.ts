import { describe, expect, it } from 'vitest';

import {
  decideBetaAccess, projectWaveStatus,
  type BetaEnrollment, type BetaWaveConfig,
} from './beta-waves';

/**
 * CONTROLLED BETA WAVES.
 *
 * The point of these tests is that "no" has SEVEN different meanings and the
 * product must not collapse them. An operator who cannot tell "we never invited
 * them" from "we invited them and ran out of seats" cannot run a beta.
 */

const enrolled = (participantId: string, wave = 'wave_0' as const): BetaEnrollment =>
  ({ participantId, wave, enrolledAt: '2026-08-08T10:00:00.000Z' });

const openWave = (seats: number): BetaWaveConfig =>
  ({ wave: 'wave_0', state: 'open', seats });

/** Occupancy that agrees with the enrollment list, which is the normal case. */
const consistent = (n: number) => ({ wave_0: n });

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

describe('the refusals stay separate facts', () => {
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
    const four = ['a', 'b', 'c', 'd'].map((id) => enrolled(id));
    const status = projectWaveStatus(openWave(10), { wave_0: 4 }, four);
    expect(status).toMatchObject({
      wave: 'wave_0', state: 'open', seats: 10, seatsTaken: 4, seatsRemaining: 6, admitting: true,
    });
  });

  it('reports Unknown — never zero — when occupancy cannot be counted', () => {
    // "The wave is full" and "we cannot tell" are different facts, and only one
    // of them is a reason to stop inviting people.
    const status = projectWaveStatus(openWave(10), { wave_0: null }, [enrolled('a')]);
    expect(status.seatsTaken).toBeNull();
    expect(status.seatsRemaining).toBeNull();
    expect(status.seatsRemaining).not.toBe(0);
    expect(status.admitting).toBe(false);
  });

  it('a full wave remains open but stops admitting', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => enrolled(id));
    const status = projectWaveStatus(openWave(4), { wave_0: 4 }, four);
    expect(status.state).toBe('open');
    expect(status.seatsRemaining).toBe(0);
    expect(status.admitting).toBe(false);
  });

  it('an unopened wave never admits, however many seats it has', () => {
    const status = projectWaveStatus({ wave: 'wave_0', state: 'not_open', seats: 100 }, { wave_0: 0 }, []);
    expect(status.admitting).toBe(false);
  });
});

/* ================================ what review proved by RUNNING the module === */

describe('a seat belongs to when you enrolled, not to array order', () => {
  const alice: BetaEnrollment = { participantId: 'alice', wave: 'wave_0', enrolledAt: '2026-08-04T00:00:00.000Z' };
  const bob: BetaEnrollment = { participantId: 'bob', wave: 'wave_0', enrolledAt: '2026-08-05T00:00:00.000Z' };

  it.each([
    ['recorded order', [alice, bob]],
    ['reshuffled', [bob, alice]],
  ])('alice keeps the only seat (%s)', (_label, enrollments) => {
    // The first version used the array index, so alice lost her seat to bob
    // purely because a caller returned rows differently — a SELECT without
    // ORDER BY would have done it. `enrolledAt` was carried and never read.
    const seats = { waves: [openWave(1)], occupancy: consistent(2) };
    expect(decideBetaAccess({ participantId: 'alice', enrollments, ...seats }).admitted).toBe(true);
    const denied = decideBetaAccess({ participantId: 'bob', enrollments, ...seats });
    expect(denied.admitted).toBe(false);
    if (!denied.admitted) expect(denied.reason).toBe('wave_full');
  });

  it('two enrolments sharing a timestamp still resolve one stable way', () => {
    const at = '2026-08-04T00:00:00.000Z';
    const x: BetaEnrollment = { participantId: 'x', wave: 'wave_0', enrolledAt: at };
    const y: BetaEnrollment = { participantId: 'y', wave: 'wave_0', enrolledAt: at };
    const seats = { waves: [openWave(1)], occupancy: consistent(2) };
    const forward = decideBetaAccess({ participantId: 'x', enrollments: [x, y], ...seats });
    const reverse = decideBetaAccess({ participantId: 'x', enrollments: [y, x], ...seats });
    expect(forward.admitted).toBe(reverse.admitted);
  });

  it('a duplicate write does not evict a real participant', () => {
    // A retried enrolment used to consume a second seat and then tell the
    // operator "enrollment number 3" when only two people existed.
    const p1a: BetaEnrollment = { participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-04T00:00:00.000Z' };
    const p1b: BetaEnrollment = { ...p1a, enrolledAt: '2026-08-04T00:00:01.000Z' };
    const p2: BetaEnrollment = { participantId: 'p2', wave: 'wave_0', enrolledAt: '2026-08-05T00:00:00.000Z' };
    const decision = decideBetaAccess({
      participantId: 'p2', enrollments: [p1a, p1b, p2], waves: [openWave(2)], occupancy: consistent(2),
    });
    expect(decision.admitted).toBe(true);
  });
});

describe('the APPLICABLE enrollment wins, not the first one in the array', () => {
  it('a participant promoted from a closed wave into an open one is admitted', () => {
    // A plain `find` returned the first record across ALL waves, so anyone
    // carried forward was refused `wave_closed` forever.
    const enrollments: BetaEnrollment[] = [
      { participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-01T00:00:00.000Z' },
      { participantId: 'p1', wave: 'wave_1', enrolledAt: '2026-08-06T00:00:00.000Z' },
    ];
    const waves: BetaWaveConfig[] = [
      { wave: 'wave_0', state: 'closed', seats: 10 },
      { wave: 'wave_1', state: 'open', seats: 10 },
    ];
    for (const order of [enrollments, [...enrollments].reverse()]) {
      const d = decideBetaAccess({
        participantId: 'p1', enrollments: order, waves, occupancy: { wave_1: 1 },
      });
      expect(d.admitted).toBe(true);
      if (d.admitted) expect(d.wave).toBe('wave_1');
    }
  });
});

describe('the cap cannot silently vanish', () => {
  it('REFUSES when occupancy exceeds the enrollments it can see', () => {
    // The caller optimisation "fetch only this participant's enrollments"
    // admitted everyone while occupancy reported 1000 against 10 seats. A count
    // higher than the records we hold proves the list is partial.
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [{ participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-04T00:00:00.000Z' }],
      waves: [openWave(10)],
      occupancy: { wave_0: 1000 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) {
      expect(decision.reason).toBe('occupancy_unknown');
      expect(decision.detail).toContain('incomplete');
    }
  });

  it.each([
    ['NaN', Number.NaN],
    ['a string', '5' as never],
    ['negative', -5],
    ['fractional', 1.5],
  ])('treats %s occupancy as uncountable rather than admitting against it', (_l, taken) => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [{ participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-04T00:00:00.000Z' }],
      waves: [openWave(10)],
      occupancy: { wave_0: taken },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('occupancy_unknown');
  });

  it('a prototype member cannot satisfy the seat count', () => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [{ participantId: 'p1', wave: 'constructor' as never, enrolledAt: '2026-08-04T00:00:00.000Z' }],
      waves: [{ wave: 'constructor' as never, state: 'open', seats: 10 }],
      occupancy: {},
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('unknown_wave');
  });
});

describe('the operator board and the gate never disagree', () => {
  it('does not report free seats the gate will refuse', () => {
    // 12 enrollments against 10 seats used to show "6 free, admitting" while
    // every one of those six invitations was refused at the door.
    const enrollments: BetaEnrollment[] = Array.from({ length: 12 }, (_, i) => ({
      participantId: `p${String(i)}`,
      wave: 'wave_0' as const,
      enrolledAt: `2026-08-04T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    const status = projectWaveStatus(openWave(10), { wave_0: 4 }, enrollments);
    const lastAdmitted = decideBetaAccess({
      participantId: 'p11', enrollments, waves: [openWave(10)], occupancy: { wave_0: 4 },
    });
    // The gate refuses p11 (position 12 of 10 seats); the board must not
    // simultaneously advertise room.
    expect(lastAdmitted.admitted).toBe(false);
    // Twelve enrollments against ten seats: the board must say full, not free.
    expect(status.seatsTaken).toBe(12);
    expect(status.seatsRemaining).toBe(0);
    expect(status.admitting).toBe(false);
  });

  it('reports Unknown when occupancy contradicts the records', () => {
    const status = projectWaveStatus(openWave(10), { wave_0: 1000 }, []);
    expect(status.seatsTaken).toBeNull();
    expect(status.seatsRemaining).toBeNull();
    expect(status.admitting).toBe(false);
  });
});

describe('not_enrolled states a record, and passes no judgement', () => {
  it('contains no word implying we refused them', () => {
    const decision = decideBetaAccess({
      participantId: 'stranger', enrollments: [], waves: [openWave(10)], occupancy: consistent(0),
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) {
      expect(decision.detail).toContain('not a decision about them');
      expect(decision.detail).not.toMatch(/denied|refused|rejected|blocked|ineligible/i);
    }
  });
});

describe('a malformed record REFUSES; it never throws', () => {
  // Reading `enrolledAt` for ordering made validating it mandatory. Sorting on
  // an unwritten field threw a TypeError out of the gate AND the operator
  // board, so one bad row denied a verdict to every participant in the wave.
  // A crash is not a refusal — it is the absence of a verdict.
  const bad: BetaEnrollment[] = [
    { participantId: 'p1', wave: 'wave_0', enrolledAt: undefined as never },
    { participantId: 'p2', wave: 'wave_0', enrolledAt: null as never },
    { participantId: 'p3', wave: 'wave_0', enrolledAt: 7 as never },
    { participantId: undefined as never, wave: 'wave_0', enrolledAt: '2026-08-04T00:00:00.000Z' },
  ];

  it.each(bad.map((b, i) => [i, b] as const))('does not throw on malformed record %i', (_i, row) => {
    const good = enrolled('good');
    expect(() => decideBetaAccess({
      participantId: 'good', enrollments: [row, good], waves: [openWave(10)], occupancy: { wave_0: 1 },
    })).not.toThrow();
    expect(() => projectWaveStatus(openWave(10), { wave_0: 1 }, [row, good])).not.toThrow();
  });

  it('one bad row does not deny every OTHER participant in the wave', () => {
    const good = enrolled('good');
    const decision = decideBetaAccess({
      participantId: 'good',
      enrollments: [{ participantId: 'x', wave: 'wave_0', enrolledAt: null as never }, good],
      waves: [openWave(10)],
      occupancy: { wave_0: 1 },
    });
    expect(decision.admitted).toBe(true);
  });
});

describe('a malformed CAP is a config bug, not an uncountable cohort', () => {
  it.each([-3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses seats=%s by its own name', (seats) => {
    const decision = decideBetaAccess({
      participantId: 'p1',
      enrollments: [enrolled('p1')],
      waves: [{ wave: 'wave_0', state: 'open', seats }],
      occupancy: { wave_0: 1 },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('wave_misconfigured');
  });

  it('the board reports Unknown for a malformed cap rather than a number', () => {
    const status = projectWaveStatus(
      { wave: 'wave_0', state: 'open', seats: Number.NaN }, { wave_0: 1 }, [enrolled('p1')],
    );
    expect(status.seatsTaken).toBeNull();
    expect(status.seatsRemaining).toBeNull();
    expect(status.admitting).toBe(false);
  });
});

describe('the queue keeps the EARLIEST record, and does not depend on array order', () => {
  it('a duplicate keeps the earliest enrolledAt, so position does not move', () => {
    // Keeping the latest would silently change queue position.
    const early: BetaEnrollment = { participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-01T00:00:00.000Z' };
    const late: BetaEnrollment = { ...early, enrolledAt: '2026-08-09T00:00:00.000Z' };
    const other: BetaEnrollment = { participantId: 'p2', wave: 'wave_0', enrolledAt: '2026-08-05T00:00:00.000Z' };
    for (const order of [[early, late, other], [late, early, other], [other, late, early]]) {
      const d = decideBetaAccess({
        participantId: 'p1', enrollments: order, waves: [openWave(1)], occupancy: { wave_0: 2 },
      });
      // p1 enrolled first, so p1 holds the single seat in every ordering.
      expect(d.admitted).toBe(true);
    }
  });

  it('applicableEnrollment does not depend on array order either', () => {
    const a: BetaEnrollment = { participantId: 'p1', wave: 'wave_0', enrolledAt: '2026-08-01T00:00:00.000Z' };
    const b: BetaEnrollment = { participantId: 'p1', wave: 'wave_1', enrolledAt: '2026-08-02T00:00:00.000Z' };
    const waves: BetaWaveConfig[] = [
      { wave: 'wave_0', state: 'open', seats: 10 },
      { wave: 'wave_1', state: 'open', seats: 10 },
    ];
    const occupancy = { wave_0: 1, wave_1: 1 };
    const forward = decideBetaAccess({ participantId: 'p1', enrollments: [a, b], waves, occupancy });
    const reverse = decideBetaAccess({ participantId: 'p1', enrollments: [b, a], waves, occupancy });
    expect(forward).toEqual(reverse);
  });
});
