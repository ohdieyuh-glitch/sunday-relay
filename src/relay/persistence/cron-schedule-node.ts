import { closeSync, existsSync, mkdirSync, openSync, readdirSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { appendLineDurable, fsyncDirBestEffort, readTextIfExists, writeFileAtomic } from './atomic-file';
import { acquireRunLock } from './lock';
import { planScheduleEdit } from '../mission/loop/cron/cron-versioning';
import { readIsoInstantWithOffset } from '../mission/loop/runtime/loop-scheduler';
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
 *
 * AND IT FOLLOWS ITS SIBLINGS RATHER THAN INVENTING WEAKER RULES. Review
 * found the first version diverging from the very modules it cited as
 * precedent, in three ways that each turned corruption into a confident wrong
 * answer: a malformed INTERIOR line truncated the history instead of
 * reporting corruption (so the next edit minted a DUPLICATE version — the
 * exact ambiguity `planScheduleEdit` exists to refuse); a symlinked schedule
 * directory wrote outside the state root; and nothing took a lock, so two
 * writers could brick a schedule permanently. `loop-run-node.ts` and
 * `cron-claim-node.ts` already solved all three.
 */

const SCHEDULES_DIR = 'cron-schedules';
const VERSIONS_JOURNAL = 'versions.ndjson';
const SNAPSHOT = 'snapshot.json';

/** The same shape the claim adapter enforces, for the same reason: a
 *  schedule id becomes a path segment. */
const SAFE_SCHEDULE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Whether an id can name a schedule at all. Exported so a surface can refuse
 *  an unusable id as the VALIDATION failure it is, rather than discovering it
 *  as a storage conflict — and so there is one definition of the rule instead
 *  of a copy that drifts. */
export function isUsableScheduleId(scheduleId: string): boolean {
  return SAFE_SCHEDULE_ID.test(scheduleId);
}

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

/**
 * What a read found. `corrupt` is NOT `missing`: a journal whose interior is
 * damaged has a history nobody can state, and answering with the prefix would
 * report a schedule as being at a version its own record cannot support.
 */
export type ScheduleReadResult =
  | { readonly kind: 'found'; readonly record: CronScheduleRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt'; readonly problem: string };

export interface CronScheduleStore {
  /** Create a schedule with its first version. Refuses if it already exists. */
  create(scheduleId: string, first: CronContractVersion): ScheduleStoreOutcome<CronScheduleRecord>;
  /** Replay the journal. `null` for missing OR corrupt — use `inspect` when
   *  the difference matters, which it does before writing anything. */
  read(scheduleId: string): CronScheduleRecord | null;
  /** The full answer, including corruption, which `read` cannot express. */
  inspect(scheduleId: string): ScheduleReadResult;
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

/**
 * Why this version cannot be stored, or `null` if it can.
 *
 * ONE DEFINITION, used by `create`, by `edit`, and by `replay`. It began on the
 * create path only, and review found the consequence twice: an edit could
 * append what a create refuses, and — once the BINDING moved into the version —
 * a schedule written before that field existed replayed with `undefined`
 * attribution, claimed its occurrences durably, created nothing, and answered
 * 200. A field the tick depends on must be real everywhere the record can enter
 * the system, including from a journal written by an older build.
 */
export function versionProblem(version: CronContractVersion): string | null {
  if (!Number.isInteger(version.version) || version.version < 0) {
    return `version must be a non-negative integer; got ${String(version.version)}.`;
  }
  if (typeof version.authoredBy !== 'string' || version.authoredBy.trim() === '') {
    return 'the first version must record who authored it, exactly as an edit must.';
  }
  // The route used to require these; now they come from here, so this is
  // where they must be real. Review found a version storable with an empty
  // contractRef flowing straight into run bindings.
  for (const field of [
    'cronExpression', 'timeZone', 'contractRef', 'contractBindingDigest',
    // The BINDING is stored, so it must be real here for the same reason: the
    // run this schedule creates is attributed through it, and an absent project
    // or Loop id would attribute a run to nowhere while the occurrence it came
    // from is durably consumed.
    'projectId', 'loopId',
  ] as const) {
    if (typeof version[field] !== 'string' || version[field].trim() === '') {
      return `${field} must not be empty.`;
    }
  }
  // `authoredAt` is load-bearing too: it CLAMPS the tick window, so a version
  // that cannot say when it was authored cannot say which moments it owns.
  if (readIsoInstantWithOffset(version.authoredAt) === null) {
    return 'authoredAt must be an ISO-8601 instant carrying an explicit UTC offset.';
  }
  // `workspaceId` is legitimately absent — a project-level schedule has none —
  // but ABSENT is `null`, never undefined and never an empty string pretending
  // to be a workspace.
  if (version.workspaceId !== null
    && (typeof version.workspaceId !== 'string' || version.workspaceId.trim() === '')) {
    return 'workspaceId must be a real workspace or null, never an empty string or absent.';
  }
  return null;
}

export function createCronScheduleStore(options: { root: string }): CronScheduleStore {
  const root = join(options.root, SCHEDULES_DIR);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  /**
   * The directory, or null when the id or the resolved path escapes.
   * A regex on the id is NOT containment: review wrote a symlink into the
   * schedules directory and this module happily wrote a journal outside the
   * state root. `loop-run-node.ts` realpaths and re-checks; so does this now.
   */
  const dirFor = (scheduleId: string): string | null => {
    if (!SAFE_SCHEDULE_ID.test(scheduleId)) return null;
    const canonicalRoot = realpathSync(root);
    const dir = join(canonicalRoot, scheduleId);
    if (!(dir + sep).startsWith(canonicalRoot + sep)) return null;
    if (existsSync(dir)) {
      const real = realpathSync(dir);
      if (!(real + sep).startsWith(canonicalRoot + sep)) return null;
    }
    return dir;
  };

  const replay = (dir: string, scheduleId: string): ScheduleReadResult => {
    const raw = readTextIfExists(join(dir, VERSIONS_JOURNAL));
    if (raw === null) return { kind: 'missing' };
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    const history: CronContractVersion[] = [];
    let paused = false;
    for (const [index, line] of lines.entries()) {
      const isLast = index === lines.length - 1;
      let parsed: JournalLine;
      try {
        parsed = JSON.parse(line) as JournalLine;
      } catch {
        // ONLY A TORN TAIL IS RECOVERABLE. Anything earlier is corruption —
        // the sibling's rule, verbatim. Truncating there let the next edit
        // mint a second version N, which is the ambiguity the edit decision
        // exists to refuse.
        if (isLast) break;
        return {
          kind: 'corrupt',
          problem: `Malformed interior line ${index + 1} of the version journal. Only a torn final `
            + 'line is recoverable; earlier damage means the history cannot be stated.',
        };
      }
      if (parsed.kind === 'version') history.push(parsed.version);
      else if (parsed.kind === 'paused') paused = parsed.paused;
    }
    const numbers = new Set<number>();
    for (const version of history) {
      // A line whose `version` is not an object at all reached `.version` and
      // threw out of `inspect` — a crash where the store's own word is
      // `corrupt`. Pre-existing, and exactly the class this validation closes.
      if (version === null || typeof version !== 'object') {
        return {
          kind: 'corrupt',
          problem: 'A version line records no version object, so the history cannot be stated.',
        };
      }
      if (numbers.has(version.version)) {
        // planScheduleEdit calls this unambiguously fatal; a schedule too
        // ambiguous to edit must not be tickable either.
        return {
          kind: 'corrupt',
          problem: `Version ${version.version} appears more than once, so which one governs cannot `
            + 'be stated.',
        };
      }
      numbers.add(version.version);
    }
    if (history.length === 0) {
      return {
        kind: 'corrupt',
        problem: 'The version journal exists but records no version. A schedule with no history '
          + 'cannot be read, edited or paused, and it is not absent either.',
      };
    }
    // A VERSION THIS BUILD CANNOT STATE IS CORRUPT, NOT USABLE. A journal
    // written before a required field existed replays into a record whose
    // missing value is load-bearing: the binding keys the occurrence claim, so
    // ticking such a schedule marked its occurrences handled durably, created
    // no run, and answered 200 — consuming the window irreversibly while
    // reporting success. `corrupt` is the store's existing word for "found and
    // unusable", and the tick already answers 409 for it.
    for (const version of history) {
      const problem = versionProblem(version);
      if (problem !== null) {
        return {
          kind: 'corrupt',
          problem: `Version ${String(version.version)} cannot be stated by this build: ${problem} `
            + 'It is refused rather than run with attribution nobody wrote. No endpoint can '
            + 'repair it — creating over it conflicts, pausing and editing read it first — so the '
            + 'record has to be removed from the state root by hand.',
        };
      }
    }
    return { kind: 'found', record: { scheduleId, history, paused } };
  };

  const writeSnapshot = (dir: string, record: CronScheduleRecord): void => {
    // AFTER the journal append, never before: a snapshot ahead of the journal
    // would claim a version no replay can produce.
    writeFileAtomic(join(dir, SNAPSHOT), JSON.stringify(record));
  };

  const refuse = <T>(problem: string): ScheduleStoreOutcome<T> => ({ ok: false, problem });

  /** Every write holds the guarded run lock, as `cron-claim-node.ts` does.
   *  Without one, two writers replay the same history and both append version
   *  N+1 — and the duplicate bricks the schedule permanently. */
  const underLock = <T>(
    dir: string,
    at: string,
    body: () => ScheduleStoreOutcome<T>,
  ): ScheduleStoreOutcome<T> => {
    const acquired = acquireRunLock(dir, 'cron-schedule-write', () => at);
    if (!acquired.ok) {
      return refuse('The schedule is being written by another process, or its lock cannot be read. '
        + 'Nothing was changed.');
    }
    try {
      return body();
    } finally {
      try { acquired.value.lock.release(); } catch { /* contained */ }
    }
  };


  return {
    create(scheduleId, first) {
      const dir = dirFor(scheduleId);
      if (dir === null) {
        return refuse(`"${scheduleId}" is not a usable schedule id, or it resolves outside the `
          + 'state root.');
      }
      const invalid = versionProblem(first);
      if (invalid !== null) {
        // `edit` refuses an unattributed version; `create` used to accept one,
        // so a schedule could begin with a version nobody signed.
        return refuse(`The first version is not usable: ${invalid}`);
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      return underLock(dir, first.authoredAt, () => {
        const journal = join(dir, VERSIONS_JOURNAL);
        // O_EXCL, not existsSync: the check-then-write was a race where the
        // sibling claim adapter deliberately uses an exclusive create.
        try {
          closeSync(openSync(journal, 'wx', 0o600));
        } catch {
          return refuse(`A schedule named ${scheduleId} already exists. Creating would overwrite `
            + 'its version history, which is the evidence explaining every run it has produced.');
        }
        appendLineDurable(
          journal,
          JSON.stringify({ kind: 'version', version: first } satisfies JournalLine),
        );
        // The journal's own directory entry must be durable too, or the file
        // can vanish and take the authority with it.
        fsyncDirBestEffort(dir);
        const record = { scheduleId, history: [first], paused: false };
        writeSnapshot(dir, record);
        return { ok: true, value: record };
      });
    },

    inspect(scheduleId) {
      const dir = dirFor(scheduleId);
      if (dir === null) return { kind: 'missing' };
      return replay(dir, scheduleId);
    },

    read(scheduleId) {
      const dir = dirFor(scheduleId);
      if (dir === null) return null;
      const result = replay(dir, scheduleId);
      return result.kind === 'found' ? result.record : null;
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
      // BEFORE THE LOCK, because `underLock` writes this instant verbatim as
      // the lock owner's `acquiredAt`, and the stale-reclaim logic reads it. A
      // full validation cannot run yet — the planner assigns the version number
      // — but the one field the lock itself consumes can.
      if (readIsoInstantWithOffset(proposed.authoredAt) === null) {
        return refuse('authoredAt must be an ISO-8601 instant carrying an explicit UTC offset.');
      }
      return underLock(dir, proposed.authoredAt, () => {
        const current = replay(dir, scheduleId);
        if (current.kind === 'corrupt') return refuse(current.problem);
        if (current.kind === 'missing') {
          return refuse(`There is no schedule named ${scheduleId} to edit.`);
        }

        // THE ONE DECISION, not a second copy of it.
        const decision = planScheduleEdit({ history: current.record.history, proposed, runs });
        if (!decision.ok) return refuse(`${decision.refusal}: ${decision.problem}`);

        // THE SAME BAR AS CREATE, applied to what is actually about to be
        // appended — the planner assigns the version number, so the proposal
        // cannot be checked before it runs. An edit could otherwise append what
        // a create refuses, and the head is what the tick reads: a blank
        // project or Loop id would reach it through this door and attribute
        // runs to nowhere. Review found the identical split once before, for
        // `contractRef`.
        const invalid = versionProblem(decision.plan.nextVersion);
        if (invalid !== null) return refuse(invalid);

        appendLineDurable(
          join(dir, VERSIONS_JOURNAL),
          JSON.stringify({ kind: 'version', version: decision.plan.nextVersion } satisfies JournalLine),
        );
        const record = {
          scheduleId,
          history: decision.plan.history,
          paused: current.record.paused,
        };
        writeSnapshot(dir, record);
        return { ok: true, value: record };
      });
    },

    setPaused(scheduleId, paused, at) {
      const dir = dirFor(scheduleId);
      if (dir === null) return refuse(`"${scheduleId}" is not a usable schedule id.`);
      // BEFORE THE LOCK, for the reason `edit` does it: `underLock` writes this
      // instant verbatim as the lock owner's `acquiredAt`, and the stale-reclaim
      // path interpolates it into a quarantine filename. Every caller in this
      // repository passes the server clock, so this guards the store's API
      // rather than a reachable defect — but `create` and `edit` both check it
      // and this was the sibling left out.
      if (readIsoInstantWithOffset(at) === null) {
        return refuse('the pause instant must be an ISO-8601 instant carrying an explicit UTC offset.');
      }
      return underLock(dir, at, () => {
        const current = replay(dir, scheduleId);
        if (current.kind === 'corrupt') return refuse(current.problem);
        if (current.kind === 'missing') {
          return refuse(`There is no schedule named ${scheduleId} to pause.`);
        }
        appendLineDurable(
          join(dir, VERSIONS_JOURNAL),
          JSON.stringify({ kind: 'paused', paused, at } satisfies JournalLine),
        );
        const record = { ...current.record, paused };
        writeSnapshot(dir, record);
        return { ok: true, value: record };
      });
    },
  };
}
