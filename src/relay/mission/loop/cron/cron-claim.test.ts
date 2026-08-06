import { describe, expect, it } from 'vitest';

import { claimOccurrence, type OccurrenceClaimPort } from './cron-claim';
import type { CronOccurrence } from './cron-occurrences';

/**
 * CLAIM BEFORE EFFECT.
 *
 * What is tested is the sequence and its crash honesty: the marker is the
 * at-most-once authority, a journal failure after the marker is a REPORTED
 * gap and never an unclaim, and the lock releases on every path — a claim
 * protocol that leaks its lock turns one crashed pass into a stuck schedule.
 */

const occurrence = (id = 'occ_1'): CronOccurrence => ({
  occurrenceId: id,
  scheduleId: 'sched_1',
  contractVersion: 1,
  intendedLocalMinute: '2026-08-06T08:00',
  resolvedUtcInstant: '2026-08-06T15:00:00.000Z',
  dstShifted: false,
  repeatedLocalTime: false,
});

function harness(script: {
  lock?: 'held' | 'unavailable';
  markerExists?: boolean;
  markerWrite?: 'ok' | 'throws';
  journal?: 'ok' | 'throws';
} = {}) {
  const events: string[] = [];
  const port: OccurrenceClaimPort = {
    acquireOccurrenceLock(id) {
      if (script.lock === 'unavailable') return null;
      events.push(`lock:${id}`);
      return { release: () => { events.push(`release:${id}`); } };
    },
    claimMarkerExists: () => script.markerExists ?? false,
    writeClaimMarker(o) {
      if (script.markerWrite === 'throws') throw new Error('volume full');
      events.push(`marker:${o.occurrenceId}`);
    },
    appendTriggerClaimed(o) {
      if (script.journal === 'throws') throw new Error('journal io');
      events.push(`journal:${o.occurrenceId}`);
    },
    now: () => '2026-08-06T15:01:00.000Z',
  };
  return { port, events };
}

describe('the approved sequence', () => {
  it('claims: lock, marker check, marker, journal, release — in that order', () => {
    const { port, events } = harness();
    expect(claimOccurrence(port, occurrence()))
      .toEqual({ kind: 'claimed', journalRecorded: true });
    expect(events).toEqual(['lock:occ_1', 'marker:occ_1', 'journal:occ_1', 'release:occ_1']);
  });

  it('an existing marker is already_handled — nothing written, lock released', () => {
    // A retry, a duplicate delivery, a second worker or a manual run-now:
    // at most one Cron Loop Run per trigger is exactly this exit.
    const { port, events } = harness({ markerExists: true });
    expect(claimOccurrence(port, occurrence())).toEqual({ kind: 'already_handled' });
    expect(events).toEqual(['lock:occ_1', 'release:occ_1']);
  });

  it('an unavailable lock is its own answer, not a guess', () => {
    const { port } = harness({ lock: 'unavailable' });
    expect(claimOccurrence(port, occurrence())).toEqual({ kind: 'lock_unavailable' });
  });
});

describe('crash honesty', () => {
  it('a failed marker write is NOT a claim, and a retry is safe', () => {
    const { port, events } = harness({ markerWrite: 'throws' });
    const outcome = claimOccurrence(port, occurrence());
    expect(outcome.kind).toBe('claim_failed');
    if (outcome.kind === 'claim_failed') expect(outcome.problem).toContain('volume full');
    expect(events).toEqual(['lock:occ_1', 'release:occ_1']);
  });

  it('a journal failure AFTER the marker stays claimed with the gap REPORTED', () => {
    // Mutation check: treating the journal failure as claim_failed would let
    // a retry double-dispatch a claimed occurrence — the marker already
    // holds; and swallowing it as journalRecorded:true is a record silently
    // missing an event it owes.
    const { port, events } = harness({ journal: 'throws' });
    expect(claimOccurrence(port, occurrence()))
      .toEqual({ kind: 'claimed', journalRecorded: false });
    expect(events).toEqual(['lock:occ_1', 'marker:occ_1', 'release:occ_1']);
  });

  it('the lock releases on EVERY path, including the throwing ones', () => {
    for (const script of [
      {}, { markerExists: true }, { markerWrite: 'throws' as const }, { journal: 'throws' as const },
    ]) {
      const { port, events } = harness(script);
      claimOccurrence(port, occurrence());
      expect(events.filter((e) => e.startsWith('release:'))).toHaveLength(1);
    }
  });
});
