import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCronScheduler, cronSchedulerEnabled, schedulerIntervalSeconds,
  schedulerLookbackMinutes, type SchedulerPassReport,
} from './cron-scheduler';
import { createCronTickService, type CronTickService } from './cron-service';

/**
 * THE TIMER THAT MAKES A CRON LOOP RECURRING.
 *
 * Driven by `runOnce` rather than by waiting: a test that sleeps for an
 * interval proves the clock works, not that the pass does.
 */

const T0 = '2026-08-06T12:00:30.000Z';
const STORED = {
  version: 1,
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  contractRef: 'contract-ref',
  contractBindingDigest: 'digest-1',
  projectId: 'prj_cron',
  workspaceId: null,
  loopId: 'lpe_cron',
  authoredBy: 'founder',
  authoredAt: '2026-08-01T10:00:00.000Z',
};

let root: string;
let service: CronTickService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-cron-sched-'));
  service = createCronTickService({ root, now: () => T0 });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const scheduler = (overrides: Partial<Parameters<typeof createCronScheduler>[0]> = {}) =>
  createCronScheduler({
    ticks: service,
    now: () => T0,
    intervalSeconds: 3600,
    lookbackMinutes: 180,
    ...overrides,
  });

describe('an automatic pass creates records and dispatches nothing', () => {
  it('ticks a stored schedule without anybody asking', () => {
    expect(service.schedules.create('sched-a', STORED).ok).toBe(true);
    const s = scheduler();
    const report = s.runOnce();
    s.stop();

    expect(report.refusal).toBeNull();
    expect(report.ticked).toBe(1);
    // 09:30 through 12:00:30 with an hourly schedule: 10, 11 and 12.
    expect(report.runsCreated).toBe(3);
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
  });

  it('a SECOND pass creates nothing — the claim marker already answered', () => {
    // The lookback deliberately overlaps the previous pass. That costs nothing
    // because a replayed occurrence is already_handled, which is what lets a
    // missed pass be caught up by the next one.
    expect(service.schedules.create('sched-a', STORED).ok).toBe(true);
    const s = scheduler();
    expect(s.runOnce().runsCreated).toBe(3);
    const second = s.runOnce();
    s.stop();
    expect(second.ticked).toBe(1);
    expect(second.runsCreated).toBe(0);
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
  });

  it('skips a paused schedule and a corrupt one, and names both', () => {
    expect(service.schedules.create('sched-a', STORED).ok).toBe(true);
    expect(service.schedules.create('sched-p', { ...STORED, loopId: 'lpe_p' }).ok).toBe(true);
    expect(service.schedules.setPaused('sched-p', true, T0).ok).toBe(true);
    expect(service.schedules.create('sched-c', { ...STORED, loopId: 'lpe_c' }).ok).toBe(true);
    writeFileSync(
      join(root, 'cron-schedules', 'sched-c', 'versions.ndjson'),
      'torn\n{"kind":"version","version":2}\n',
    );

    const s = scheduler();
    const report = s.runOnce();
    s.stop();
    expect(report.ticked).toBe(1);
    expect(report.skipped).toBe(2);
    expect(service.store.runIdsForLoop('lpe_p') ?? []).toHaveLength(0);
    expect(service.store.runIdsForLoop('lpe_c') ?? []).toHaveLength(0);
  });

  it('does not count a REFUSED tick as one it performed', () => {
    // The evaluator refuses a zone it cannot resolve. Counting the attempt
    // would report work that never happened — and a pass whose numbers include
    // its failures is a pass nobody can read.
    expect(service.schedules.create('sched-mars', {
      ...STORED, timeZone: 'Mars/Olympus_Mons', loopId: 'lpe_mars',
    }).ok).toBe(true);
    expect(service.schedules.create('sched-a', STORED).ok).toBe(true);

    const s = scheduler();
    const report = s.runOnce();
    s.stop();
    expect(report.ticked).toBe(1);
    expect(report.refused).toEqual(['sched-mars']);
    expect(report.runsCreated).toBe(3);
    expect(service.store.runIdsForLoop('lpe_mars') ?? []).toHaveLength(0);
  });

  it('clamps its lookback to the version, so it cannot replay the past', () => {
    // A version cannot own a moment that predates it. The lookback reaches
    // back three hours; the schedule was authored one minute ago.
    expect(service.schedules.create('sched-new', {
      ...STORED, authoredAt: '2026-08-06T11:59:30.000Z',
    }).ok).toBe(true);
    const s = scheduler();
    const report = s.runOnce();
    s.stop();
    expect(report.ticked).toBe(1);
    // Only 12:00 is inside the clamped window; 10:00 and 11:00 predate it.
    expect(report.runsCreated).toBe(1);
  });

  it('refuses to run two passes at once, and says which', () => {
    expect(service.schedules.create('sched-a', STORED).ok).toBe(true);
    const reentrant: SchedulerPassReport[] = [];
    const s = scheduler({
      // Re-entering from inside a pass is the shape a slow pass takes when the
      // interval fires again underneath it.
      onPass: () => { if (reentrant.length === 0) reentrant.push(s.runOnce()); },
    });
    s.runOnce();
    s.stop();
    expect(reentrant).toHaveLength(1);
    expect(reentrant[0]?.refusal).toBe('pass_in_flight');
    expect(reentrant[0]?.ticked).toBe(0);
    // …and the schedule was ticked exactly once, not twice.
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
  });

  it('is OFF unless switched on, and reads a malformed interval as the default', () => {
    expect(cronSchedulerEnabled({})).toBe(false);
    expect(cronSchedulerEnabled({ RELAY_LOOP_CRON_SCHEDULER_ENABLED: 'true' })).toBe(false);
    expect(cronSchedulerEnabled({ RELAY_LOOP_CRON_SCHEDULER_ENABLED: '1' })).toBe(true);
    // Zero would spin the loop and NaN would never fire; both fall back.
    for (const raw of [undefined, '', 'soon', '0', '-5', '1.5']) {
      expect(schedulerIntervalSeconds({ RELAY_LOOP_CRON_SCHEDULER_INTERVAL_SECONDS: raw }), String(raw))
        .toBe(60);
    }
    expect(schedulerIntervalSeconds({ RELAY_LOOP_CRON_SCHEDULER_INTERVAL_SECONDS: '30' })).toBe(30);
  });
});

/* ============================================ what review found it hiding === */

describe('the pass limit defers work rather than starving it', () => {
  it('reaches every schedule across passes, instead of the same first few forever', () => {
    // Review's finding: the store lists ids SORTED and the pass always walked
    // from the beginning, so with more schedules than the limit the tail was
    // never ticked once — while the report called it `skipped`, as though the
    // next pass would take it.
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    for (const id of ids) {
      expect(service.schedules.create(id, { ...STORED, loopId: `lpe_${id}` }).ok).toBe(true);
    }

    const s = scheduler({ maxPerPass: 2 });
    const reached = new Set<string>();
    for (let pass = 0; pass < 3; pass += 1) {
      const report = s.runOnce();
      expect(report.truncated).toBe(true);
      for (const id of ids) {
        if ((service.store.runIdsForLoop(`lpe_${id}`) ?? []).length > 0) reached.add(id);
      }
    }
    s.stop();
    // Three passes of two: every schedule has now had its turn.
    expect([...reached].sort()).toEqual(ids);
  });

  it('names the schedules it deferred, so a log cannot read as a clean pass', () => {
    for (const id of ['s1', 's2', 's3']) {
      expect(service.schedules.create(id, { ...STORED, loopId: `lpe_${id}` }).ok).toBe(true);
    }
    const s = scheduler({ maxPerPass: 1 });
    const report = s.runOnce();
    s.stop();
    expect(report.ticked).toBe(1);
    expect(report.truncated).toBe(true);
    // The ids themselves, not merely a count: "nothing ran" and "two Cron
    // Loops were deferred" are the same number and different facts.
    expect(report.deferred).toEqual(['s2', 's3']);
  });

  it('a cursor naming a deleted schedule starts over rather than skipping past it', () => {
    for (const id of ['s1', 's2']) {
      expect(service.schedules.create(id, { ...STORED, loopId: `lpe_${id}` }).ok).toBe(true);
    }
    const s = scheduler({ maxPerPass: 1 });
    s.runOnce();
    // s1 was reached, so the cursor names it. Delete it before the next pass.
    expect(service.schedules.remove('s1', T0).ok).toBe(true);
    const second = s.runOnce();
    s.stop();
    expect(second.ticked).toBe(1);
    expect((service.store.runIdsForLoop('lpe_s2') ?? []).length).toBeGreaterThan(0);
  });
});

describe('the timer refuses exactly what the operator tick refuses', () => {
  // Review reproduced the disagreement: three schedules the endpoint answers
  // 422 for produced nine runs under the timer, at instants that drift an hour
  // twice a year. The store does not validate zones — deliberately — so the
  // gate has to be applied at every point of USE.
  it.each([
    ['a fixed offset', 'Etc/GMT+5'],
    ['a frozen legacy zone', 'SystemV/EST5'],
    ['a single-word name', 'EST'],
  ])('refuses %s rather than running it unattended', (_label, timeZone) => {
    expect(service.schedules.create('sched-bad', {
      ...STORED, timeZone, loopId: 'lpe_bad',
    }).ok).toBe(true);

    const s = scheduler();
    const report = s.runOnce();
    s.stop();
    expect(report.refused).toEqual(['sched-bad']);
    expect(report.ticked).toBe(0);
    expect(service.store.runIdsForLoop('lpe_bad') ?? []).toHaveLength(0);
  });
});

describe('a pass is bounded in the direction that costs', () => {
  it('stops adding to a Loop whose undispatched backlog reached the ceiling', () => {
    // The execution count every overlap policy needs is read by walking the
    // Loop's run records and replaying each journal. Nothing advances a
    // scheduled run and nothing prunes one, so an unbounded backlog is an
    // unbounded stall on the loop that answers HTTP.
    //
    // A MOVING CLOCK, deliberately: with a frozen one every later pass replays
    // one already-claimed window and creates nothing, which would prove the
    // fixture rather than the ceiling.
    let minutes = 0;
    const movingService = createCronTickService({
      root, now: () => new Date(Date.parse(T0) + minutes * 60_000).toISOString(),
    });
    expect(movingService.schedules.create('sched-a', STORED).ok).toBe(true);
    const s = createCronScheduler({
      ticks: movingService,
      now: () => new Date(Date.parse(T0) + minutes * 60_000).toISOString(),
      intervalSeconds: 3600,
      lookbackMinutes: 180,
      // The shipped ceiling is 200; reaching it here would spend the whole
      // test budget proving arithmetic. The BEHAVIOUR is what is under test.
      maxUndispatchedRunsPerLoop: 10,
    });

    let refusedAt: number | null = null;
    for (let pass = 0; pass < 40 && refusedAt === null; pass += 1) {
      const report = s.runOnce();
      if (report.refused.includes('sched-a')) refusedAt = pass;
      minutes += 120; // two more hourly occurrences become due each pass
    }
    s.stop();
    // It must refuse rather than grow forever, and the backlog must be bounded.
    expect(refusedAt).not.toBeNull();
    const backlog = (movingService.store.runIdsForLoop('lpe_cron') ?? []).length;
    expect(backlog).toBeGreaterThanOrEqual(10);
    expect(backlog).toBeLessThan(40);

    // And it STAYS refused rather than resuming once more time passes: the
    // backlog is what bounds it, and nothing in this build reduces one.
    minutes += 10_000;
    const later = s.runOnce();
    expect(later.refused).toContain('sched-a');
  }, 30_000);

  it('reads each Loop execution count once per pass, however many schedules share it', () => {
    // Two schedules, one Loop. The answer cannot change mid-pass: a pass is
    // synchronous and nothing in it starts a run.
    for (const id of ['s1', 's2']) {
      expect(service.schedules.create(id, STORED).ok).toBe(true);
    }
    let reads = 0;
    const counting: CronTickService = {
      ...service,
      activeRunsFor: (loopId: string) => { reads += 1; return service.activeRunsFor(loopId); },
    };
    const s = createCronScheduler({
      ticks: counting, now: () => T0, intervalSeconds: 3600, lookbackMinutes: 180,
    });
    s.runOnce();
    s.stop();
    expect(reads).toBe(1);
  });
});

describe('a pass says what it did not do', () => {
  it('derives a lookback that covers the interval, so the gap between passes is not lost', () => {
    // Review set the interval to 600s against a fixed 15-minute lookback and
    // measured half the due occurrences never created — the backlog aged out
    // of the window between passes, and no field said so.
    expect(schedulerLookbackMinutes(60, 11520)).toBe(15);
    expect(schedulerLookbackMinutes(600, 11520)).toBe(20);
    expect(schedulerLookbackMinutes(3600, 11520)).toBe(120);
    // The evaluator's own limit is still the ceiling: a wider window would be
    // refused per schedule and report work it never had a chance to do.
    expect(schedulerLookbackMinutes(3600, 30)).toBe(30);
  });

  it('reports a refusal through onPass, not only through the return value', () => {
    // Both early returns used to skip `onPass`, so the deployment's only
    // consumer could never see the field documented as "set when the pass
    // could not be planned at all".
    const seen: SchedulerPassReport[] = [];
    const s = scheduler({ lookbackMinutes: 0, onPass: (r) => seen.push(r) });
    const report = s.runOnce();
    s.stop();
    expect(report.refusal).toBe('unusable_lookback');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.refusal).toBe('unusable_lookback');
  });

  it('a throwing pass is reported, not swallowed into a silence that looks healthy', () => {
    // The timer's catch used to be empty. A scheduler whose every pass failed
    // — an unmounted volume, changed permissions — then logged exactly what a
    // healthy idle bridge logs, forever.
    const problems: string[] = [];
    const exploding: CronTickService = {
      ...service,
      listSchedules: () => { throw new Error('volume went away'); },
    };
    vi.useFakeTimers();
    try {
      const s = createCronScheduler({
        ticks: exploding,
        now: () => T0,
        intervalSeconds: 1,
        onError: (m) => problems.push(m),
      });
      vi.advanceTimersByTime(1000);
      s.stop();
    } finally {
      vi.useRealTimers();
    }
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('volume went away');
    // And it stays a caller's problem when called directly, rather than being
    // hidden from a host that wants to handle it.
    const direct = createCronScheduler({
      ticks: exploding, now: () => T0, intervalSeconds: 3600,
    });
    expect(() => direct.runOnce()).toThrow();
    direct.stop();
  });
});
