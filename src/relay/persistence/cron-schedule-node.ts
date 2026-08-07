import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendLineDurable, readTextIfExists, writeFileAtomic } from './atomic-file';
import { planScheduleEdit } from '../mission/loop/cron/cron-versioning';
import type { CronContractVersion, VersionedRun } from '../mission/loop/cron/cron-versioning';

/**
 * SUNDAY RELAY — WHERE A CRON SCHEDULE ACTUALLY LIVES.
 *
 * CRON_LOOPS.md approved the shape and forbade the alternatives: "Relay's
 * journal and snapshots remain the source of truth. Always." No database, no
 * queue. So a schedule is a directory holding an append-only version journal
 * and a derived snapshot, exactly like a Loop run.
 *
 * THIS IS THE STORE THE TICK ENDPOINT HAS BEEN MISSING. Until now every
 * schedule field arrived in the request body, which meant Relay could run a
 * caller-declared schedule but had no schedules of its own — nothing to list,
 * nothing to pause, and nothing for the version, approval and breaker
 * decisions to attach to. Those decisions were all built and all unreachable.
 *
 * THE JOURNAL IS THE AUTHORITY, THE SNAPSHOT IS A CACHE. Every version is
 * appended before the snapshot is rewritten, so a crash between them leaves a
 * complete journal and a stale snapshot — recoverable — rather than a
 * snapshot claiming a version the journal never recorded. `readSchedule`
 * rebuilds from the journal and never trusts the snapshot's contents.
 *
 * AN EDIT GOES THROUGH THE PURE DECISION. `planScheduleEdit` decides whether
 * an edit is legal and what the next version is; this module only persists
 * what that decision produced. Two implementations of one rule is the
 * divergence bug this repository keeps naming, and an authority rule is the
 * worst place to have two.
 */

const SCHEDULES_DIR = 'cron-schedules';
const VERSIONS_JOURNAL = 'versions.ndjson';
const SNAPSHOT = 'snapshot.json';

/** The same shape the claim adapter enforces, for the same reason: a
 *  schedule id becomes a path segment. */
const SAFE_SCHEDULE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface CronScheduleRecord {
  readonly scheduleId: string;
  /** Every version, oldest first. The journal, replayed. */
  readonly history: readonly CronContractVersion[];
  /** True when an operator paused it. Paused schedules are never evaluated. */
  readonly paused: boolean;
}

export type ScheduleStoreOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

export interface CronScheduleStore {
  /** Create a schedule with its first version. Refuses if it already exists. */
  create(scheduleId: string, first: CronContractVersion): ScheduleStoreOutcome<CronScheduleRecord>;
  /** Replay the journal. `null` when the schedule does not exist. */
  read(scheduleId: string): CronScheduleRecord | null;
  /** Every schedule id on disk, sorted. */
  list(): readonly string[];
  /**
   * Append a new version, through `planScheduleEdit`. The runs are passed so
   * the decision can refuse an edit that would orphan one.
   */
  edit(
    scheduleId: string,
    proposed: Omit<CronContractVersion, 'version'>,
    runs: readonly VersionedRun[],
  ): ScheduleStoreOutcome<CronScheduleRecord>;
  /** Pause or resume. Recorded in the journal like everything else. */
  setPaused(scheduleId: string, paused: boolean, at: string): ScheduleStoreOutcome<CronScheduleRecord>;
}

type JournalLine =
  | { readonly kind: 'version'; readonly version: CronContractVersion }
  | { readonly kind: 'paused'; readonly paused: boolean; readonly at: string };

export function createCronScheduleStore(options: { root: string }): CronScheduleStore {
  const root = join(options.root, SCHEDULES_DIR);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const dirFor = (scheduleId: string): string | null =>
    SAFE_SCHEDULE_ID.test(scheduleId) ? join(root, scheduleId) : null;

  const replay = (dir: string): CronScheduleRecord | null => {
    const raw = readTextIfExists(join(dir, VERSIONS_JOURNAL));
    if (raw === null) return null;
    const history: CronContractVersion[] = [];
    let paused = false;
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: JournalLine;
      try {
        parsed = JSON.parse(line) as JournalLine;
      } catch {
        // A torn tail is the last line only — appendLineDurable fsyncs each
        // one — so a line that will not parse ends the replay rather than
        // discrediting the versions already read.
        break;
      }
      if (parsed.kind === 'version') history.push(parsed.version);
      else if (parsed.kind === 'paused') paused = parsed.paused;
    }
    if (history.length === 0) return null;
    return {
      scheduleId: dir.slice(dir.lastIndexOf('/') + 1),
      history,
      paused,
    };
  };

  const writeSnapshot = (dir: string, record: CronScheduleRecord): void => {
    // AFTER the journal append, never before: a snapshot ahead of the journal
    // would claim a version no replay can produce.
    writeFileAtomic(join(dir, SNAPSHOT), JSON.stringify(record));
  };

  const refuse = <T>(problem: string): ScheduleStoreOutcome<T> => ({ ok: false, problem });

  return {
    create(scheduleId, first) {
      const dir = dirFor(scheduleId);
      if (dir === null) {
        return refuse(`"${scheduleId}" is not a usable schedule id; it becomes a path segment.`);
      }
      if (existsSync(join(dir, VERSIONS_JOURNAL))) {
        return refuse(`A schedule named ${scheduleId} already exists. Creating would overwrite its `
          + 'version history, which is the evidence explaining every run it has produced.');
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendLineDurable(
        join(dir, VERSIONS_JOURNAL),
        JSON.stringify({ kind: 'version', version: first } satisfies JournalLine),
      );
      const record = { scheduleId, history: [first], paused: false };
      writeSnapshot(dir, record);
      return { ok: true, value: record };
    },

    read(scheduleId) {
      const dir = dirFor(scheduleId);
      return dir === null ? null : replay(dir);
    },

    list() {
      if (!existsSync(root)) return [];
      return readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && SAFE_SCHEDULE_ID.test(e.name))
        .filter((e) => existsSync(join(root, e.name, VERSIONS_JOURNAL)))
        .map((e) => e.name)
        .sort();
    },

    edit(scheduleId, proposed, runs) {
      const dir = dirFor(scheduleId);
      if (dir === null) return refuse(`"${scheduleId}" is not a usable schedule id.`);
      const current = replay(dir);
      if (current === null) return refuse(`There is no schedule named ${scheduleId} to edit.`);

      // THE ONE DECISION, not a second copy of it.
      const decision = planScheduleEdit({ history: current.history, proposed, runs });
      if (!decision.ok) return refuse(`${decision.refusal}: ${decision.problem}`);

      appendLineDurable(
        join(dir, VERSIONS_JOURNAL),
        JSON.stringify({ kind: 'version', version: decision.plan.nextVersion } satisfies JournalLine),
      );
      const record = { scheduleId, history: decision.plan.history, paused: current.paused };
      writeSnapshot(dir, record);
      return { ok: true, value: record };
    },

    setPaused(scheduleId, paused, at) {
      const dir = dirFor(scheduleId);
      if (dir === null) return refuse(`"${scheduleId}" is not a usable schedule id.`);
      const current = replay(dir);
      if (current === null) return refuse(`There is no schedule named ${scheduleId} to pause.`);
      appendLineDurable(
        join(dir, VERSIONS_JOURNAL),
        JSON.stringify({ kind: 'paused', paused, at } satisfies JournalLine),
      );
      const record = { ...current, paused };
      writeSnapshot(dir, record);
      return { ok: true, value: record };
    },
  };
}
