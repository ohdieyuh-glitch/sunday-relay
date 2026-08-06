import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { acquireRunLock } from './lock';
import { appendLineDurable } from './atomic-file';
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
      return existsSync(join(dirFor(occurrenceId), CLAIM_MARKER_FILE));
    },

    writeClaimMarker(occurrence, at) {
      // O_EXCL: a second writer fails here even if a lock was ever wrongly
      // held twice — at-most-once does not rest on the lock alone.
      const fd = openSync(join(dirFor(occurrence.occurrenceId), CLAIM_MARKER_FILE), 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ occurrence, claimedAt: at }), null, 'utf8');
      } finally {
        closeSync(fd);
      }
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
