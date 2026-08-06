import {
  closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { acquireRunLock } from './lock';
import { appendLineDurable, fsyncDirBestEffort } from './atomic-file';
import type { OccurrenceClaimPort } from '../mission/loop/cron/cron-claim';

/**
 * SUNDAY RELAY — THE FILE-BACKED OCCURRENCE CLAIM ADAPTER.
 *
 * `cron-claim.ts` holds the sequence; this holds the disk. Its whole job is
 * honouring the port contract's two hard obligations:
 *
 * - **The marker write is EXCLUSIVE**, not merely atomic: O_EXCL (`wx`), the
 *   same primitive the run lock rests on. A temp+rename would overwrite an
 *   existing marker and quietly re-arm the double claim the marker exists to
 *   prevent — the port doc forbids it by name.
 * - **The occurrence lock IS the guarded run lock** (`lock.ts`), against the
 *   occurrence's own directory — stale reclaim, displacement restore and all.
 *   Every marker writer must come through it.
 *
 * An occurrence id is used as a path segment, so anything but the
 * evaluator's `occ_<hex>` shape is refused by THROWING — the pure layer maps
 * a throwing port to `claim_failed`, which is exactly what a path-traversal
 * shaped id deserves.
 */

const SAFE_OCCURRENCE_ID = /^occ_[A-Za-z0-9]{1,64}$/;

export const CLAIM_MARKER_FILE = 'claimed.json';
export const TRIGGER_JOURNAL_FILE = 'triggers.ndjson';

export interface CronClaimNodeOptions {
  /** The Relay state root; occurrences live under `cron-occurrences/`. */
  readonly stateRoot: string;
  readonly now: () => string;
}

export function createCronClaimNodePort(options: CronClaimNodeOptions): OccurrenceClaimPort {
  const dirFor = (occurrenceId: string): string => {
    if (!SAFE_OCCURRENCE_ID.test(occurrenceId)) {
      throw new Error(`"${occurrenceId}" is not an evaluator-shaped occurrence id; refusing to touch disk with it.`);
    }
    const dir = join(options.stateRoot, 'cron-occurrences', occurrenceId);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  return {
    acquireOccurrenceLock(occurrenceId) {
      const acquired = acquireRunLock(dirFor(occurrenceId), 'cron-occurrence-claim', options.now);
      if (!acquired.ok) return null;
      return { release: () => { acquired.value.lock.release(); } };
    },

    claimMarkerExists(occurrenceId) {
      if (!SAFE_OCCURRENCE_ID.test(occurrenceId)) {
        throw new Error(`"${occurrenceId}" is not an evaluator-shaped occurrence id; refusing to touch disk with it.`);
      }
      // An existence CHECK creates nothing — review found the first version
      // littering one directory per id ever inspected, and inspectLock's
      // read-only precedent is the rule here.
      return existsSync(join(options.stateRoot, 'cron-occurrences', occurrenceId, CLAIM_MARKER_FILE));
    },

    writeClaimMarker(occurrence, at) {
      // ALL-OR-NOTHING and EXCLUSIVE and DURABLE, each for a reviewed
      // reason. Durable: this marker is the at-most-once authority, and an
      // authority a crash can vanish re-arms the double dispatch it exists
      // to prevent — the first version fsynced the subordinate journal but
      // not this. All-or-nothing: a torn direct write left a marker that
      // answered already_handled to the retry the claim_failed outcome had
      // just promised was safe. Exclusive: linkSync fails EEXIST, the same
      // no-clobber primitive the guarded lock restore uses — a second
      // writer loses even if a lock were ever wrongly held twice.
      const dir = dirFor(occurrence.occurrenceId);
      const markerPath = join(dir, CLAIM_MARKER_FILE);
      const tempPath = join(dir, `${CLAIM_MARKER_FILE}.tmp-${process.pid}-${at.replace(/[:.]/g, '-')}`);
      const fd = openSync(tempPath, 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ occurrence, claimedAt: at }), null, 'utf8');
        try { fsyncSync(fd); } catch { /* flush unsupported on this platform/fs */ }
      } finally {
        closeSync(fd);
      }
      try {
        linkSync(tempPath, markerPath);
      } finally {
        try { unlinkSync(tempPath); } catch { /* tidy-up only */ }
      }
      fsyncDirBestEffort(dir);
    },

    appendTriggerClaimed(occurrence, at) {
      appendLineDurable(
        join(dirFor(occurrence.occurrenceId), TRIGGER_JOURNAL_FILE),
        JSON.stringify({ kind: 'cron.trigger_claimed', occurrence, at }),
      );
    },

    now: options.now,
  };
}
