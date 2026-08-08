import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createCronScheduler, cronSchedulerEnabled, schedulerIntervalSeconds,
  type SchedulerPassReport,
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
    binding: { workClass: 'read_only', overlapPolicy: 'parallel_with_limit' },
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
