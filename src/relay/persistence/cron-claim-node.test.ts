import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { claimOccurrence } from '../mission/loop/cron/cron-claim';
import type { CronOccurrence } from '../mission/loop/cron/cron-occurrences';
import { createCronClaimNodePort, CLAIM_MARKER_FILE, TRIGGER_JOURNAL_FILE } from './cron-claim-node';

/**
 * THE FILE-BACKED CLAIM ADAPTER, driven through the REAL pure sequence.
 * What is pinned: exclusivity (the second claim of one occurrence is
 * already_handled, across two separate port instances — two processes'
 * worth of state), the O_EXCL marker (a bare-metal double write fails), and
 * the path-shape refusal mapping to claim_failed.
 */

const occ = (id = 'occ_abc123'): CronOccurrence => ({
  occurrenceId: id,
  scheduleId: 'sched_1',
  contractVersion: 1,
  intendedLocalMinute: '2026-08-06T08:00',
  resolvedUtcInstant: '2026-08-06T15:00:00.000Z',
  dstShifted: false,
  repeatedLocalTime: false,
});

const NOW = () => '2026-08-06T15:01:00.000Z';

describe('claim-before-effect on real disk', () => {
  it('claims once, then answers already_handled — even from a second port instance', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const portA = createCronClaimNodePort({ stateRoot, now: NOW });
    const portB = createCronClaimNodePort({ stateRoot, now: NOW });

    expect(claimOccurrence(portA, occ())).toEqual({ kind: 'claimed', journalRecorded: true });
    expect(claimOccurrence(portB, occ())).toEqual({ kind: 'already_handled' });

    const dir = join(stateRoot, 'cron-occurrences', 'occ_abc123');
    const marker = JSON.parse(readFileSync(join(dir, CLAIM_MARKER_FILE), 'utf8'));
    expect(marker.occurrence.occurrenceId).toBe('occ_abc123');
    expect(marker.claimedAt).toBe(NOW());
    const journal = readFileSync(join(dir, TRIGGER_JOURNAL_FILE), 'utf8').trim().split('\n');
    expect(journal).toHaveLength(1);
    expect(JSON.parse(journal[0] as string).kind).toBe('cron.trigger_claimed');
  });

  it('the marker is O_EXCL: a bare double write fails even without the lock', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    port.writeClaimMarker(occ(), NOW());
    expect(() => port.writeClaimMarker(occ(), NOW())).toThrow();
  });

  it('a path-shaped occurrence id is refused and maps to claim_failed, touching nothing', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    const outcome = claimOccurrence(port, occ('../../escape'));
    expect(outcome.kind).toBe('claim_failed');
    if (outcome.kind === 'claim_failed') expect(outcome.problem).toContain('refusing to touch disk');
  });

  it('a lock held by a LIVE owner refuses the claim — the lock is real, not decorative', () => {
    // Mutation check: gutting acquireOccurrenceLock (no acquireRunLock call)
    // claims straight past this held lock — review proved all prior tests
    // survived exactly that mutant, so the lock integration was pinned by
    // nothing.
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const dir = join(stateRoot, 'cron-occurrences', 'occ_held');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lock'), JSON.stringify({
      pid: process.pid, hostname: hostname(),
      acquiredAt: '2026-08-06T14:00:00.000Z', purpose: 'someone-else-mid-claim',
    }));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    expect(claimOccurrence(port, occ('occ_held'))).toEqual({ kind: 'lock_unavailable' });
    expect(existsSync(join(dir, CLAIM_MARKER_FILE))).toBe(false);
  });

  it('an existence CHECK creates nothing on disk', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    expect(port.claimMarkerExists('occ_ghost')).toBe(false);
    expect(existsSync(join(stateRoot, 'cron-occurrences', 'occ_ghost'))).toBe(false);
  });

  it('a successful claim leaves the marker and journal, and NO temp litter', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    expect(claimOccurrence(port, occ()).kind).toBe('claimed');
    const names = readdirSync(join(stateRoot, 'cron-occurrences', 'occ_abc123')).sort();
    expect(names).toEqual([CLAIM_MARKER_FILE, TRIGGER_JOURNAL_FILE]);
  });

  it('two occurrences never share state', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'relay-cron-claim-'));
    const port = createCronClaimNodePort({ stateRoot, now: NOW });
    expect(claimOccurrence(port, occ('occ_one')).kind).toBe('claimed');
    expect(claimOccurrence(port, occ('occ_two')).kind).toBe('claimed');
    expect(claimOccurrence(port, occ('occ_one')).kind).toBe('already_handled');
  });
});
