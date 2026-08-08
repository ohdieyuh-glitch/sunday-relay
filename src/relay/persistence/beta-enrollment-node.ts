import {
  closeSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, realpathSync,
  unlinkSync, writeSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { fsyncDirBestEffort, readTextIfExists } from './atomic-file';
import type { BetaEnrollment, RelayBetaWave } from '../mission/beta';
import { RELAY_BETA_WAVES } from '../mission/beta';

/**
 * SUNDAY RELAY — WHERE A BETA ENROLMENT ACTUALLY LIVES.
 *
 * The Wave 0 gate (`mission/beta`) decides who is admitted; until now nothing
 * recorded anyone. This is the record, and it follows its siblings: the durable
 * volume is the authority, no database, no queue.
 *
 * ONE FILE PER PARTICIPANT PER WAVE, and the shape is the whole design:
 *
 *   <root>/beta-enrollments/<wave>/<participantId>.json
 *
 * IDEMPOTENCY IS STRUCTURAL, NOT CHECKED. The record is written to a temp file,
 * fsynced, then `linkSync`ed into place — the same all-or-nothing, exclusive,
 * durable primitive `cron-claim-node.ts` uses, and for the same three reviewed
 * reasons. `linkSync` fails `EEXIST`, so a second enrolment for the same
 * participant CANNOT create a second record, and the store reports
 * `already_enrolled` with the original instant.
 *
 * THE FIRST VERSION CLAIMED TO FOLLOW ITS SIBLINGS AND DID NOT. It created the
 * file with `O_EXCL` and wrote the contents in place afterwards, fsyncing
 * neither. Review proved the consequence: one genuinely failed write left a
 * zero-byte file that permanently blocked that participant AND refused every
 * other member of the wave forever, with no repair path anywhere in the
 * product. The name was made durable while the contents were not, so the crash
 * window was every unflushed write, not a narrow one.
 *
 * Review of the gate had separately found read-time deduplication papering over
 * a retried write that consumed a second seat and evicted a real participant; a
 * store that can only hold one record per participant removes that failure
 * rather than compensating for it. There is no read-modify-write and therefore
 * no lock — the exclusive link is the atomicity.
 *
 * AND THE COUNT IS INDEPENDENT OF THE LIST, which is the property the gate's
 * reconciliation needs and could not previously get. `countFor` is a directory
 * listing — it counts what is ON THE VOLUME, not what some caller assembled.
 * Review named the hazard exactly: an `occupancy` derived from the same array
 * the caller passes as `enrollments` makes the reconciliation a permanent
 * no-op, and the cap silently stops existing. Here the two answers come from
 * two different reads of the same durable truth, so they can genuinely
 * disagree — and when they do, the gate refuses.
 *
 * A WAVE DIRECTORY IS NAMED BY A CLOSED SET, and the resolved path is re-checked
 * against the resolved root. `RELAY_BETA_WAVES` is the only thing that can name
 * a directory, and a regex on an id is not containment — `cron-schedule-node.ts`
 * records that lesson from its own review, where a planted symlink let it write
 * outside the state root.
 */

const ENROLMENTS_DIR = 'beta-enrollments';

/**
 * What may name a participant on disk.
 *
 * The same shape the schedule store uses, for the same reason: an id that
 * cannot be a path segment is refused as the VALIDATION failure it is, rather
 * than discovered later as a storage conflict. No dot, so `..` cannot form; no
 * separator, so no directory can be escaped.
 */
const SAFE_PARTICIPANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isUsableParticipantId(participantId: string): boolean {
  return SAFE_PARTICIPANT_ID.test(participantId);
}

const KNOWN_WAVE = new Set<string>(RELAY_BETA_WAVES);

export type EnrolResult =
  | { readonly ok: true; readonly outcome: 'created' | 'already_enrolled'; readonly enrollment: BetaEnrollment }
  | { readonly ok: false; readonly problem: string };

export interface BetaEnrolmentStore {
  /**
   * Record an enrolment, or report the one already held.
   *
   * NEVER OVERWRITES. A participant's first enrolment instant is the one that
   * orders the wave's queue, so a retry that replaced it would move their seat.
   */
  enrol(participantId: string, wave: RelayBetaWave, at: string): EnrolResult;
  /** Every enrolment in the wave. Unordered — the gate orders by `enrolledAt`. */
  list(wave: RelayBetaWave): readonly BetaEnrollment[];
  /**
   * How many enrolments the VOLUME holds for this wave, or `null` when it
   * cannot be counted.
   *
   * Deliberately not `list().length`: the gate reconciles this against the list
   * it was given, and a count derived from that same list could never disagree
   * with it. This one is a directory read.
   *
   * `null`, NOT `0`, FOR AN UNREADABLE DIRECTORY. The first version swallowed
   * every error and answered zero, which review proved admits past the cap:
   * with `EACCES` or fd exhaustion the gate's reconciliation became
   * unsatisfiable and the cap silently stopped existing. Only `ENOENT` is
   * genuinely zero — a wave nobody has joined.
   */
  countFor(wave: RelayBetaWave): number | null;
}

export function createBetaEnrolmentStore(options: { readonly root: string }): BetaEnrolmentStore {
  /**
   * The wave's directory, CONTAINED rather than merely well-named.
   *
   * A regex on an id is not containment. `cron-schedule-node.ts` records the
   * same lesson from its own review — a symlink planted in the directory and
   * the store happily wrote outside the state root — so the resolved path is
   * re-checked against the resolved root here too.
   */
  const dirFor = (wave: RelayBetaWave): string | null => {
    if (!KNOWN_WAVE.has(wave)) return null;
    let root: string;
    try {
      root = realpathSync(options.root);
    } catch {
      root = options.root;
    }
    const dir = join(root, ENROLMENTS_DIR, wave);
    let resolved = dir;
    try {
      resolved = realpathSync(dir);
    } catch {
      // Not created yet: the joined path is inside by construction.
      return dir;
    }
    return (`${resolved}${sep}`).startsWith(`${root}${sep}`) ? resolved : null;
  };

  const readOne = (dir: string, file: string): BetaEnrollment | null => {
    // The read itself is inside the try: an unreadable file or a directory
    // named like a record used to THROW out of `list`, which denied a verdict
    // to every participant in the wave. A crash is not a refusal.
    try {
      const raw = readTextIfExists(join(dir, file));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return null;
      const r = parsed as Record<string, unknown>;
      // A record that cannot be ordered is not returned at all. The gate
      // already refuses malformed rows; not handing them over means one
      // corrupt file cannot reach a decision in the first place.
      if (typeof r.participantId !== 'string' || r.participantId === '') return null;
      if (typeof r.enrolledAt !== 'string' || r.enrolledAt === '') return null;
      if (typeof r.wave !== 'string' || !KNOWN_WAVE.has(r.wave)) return null;
      // THE RECORD MUST BE THE ONE THE FILENAME NAMES. Without this the store
      // handed one participant another's identity and enrolment instant, with
      // `ok: true` — free on any case-insensitive filesystem, where `Alice`
      // and `alice` collide.
      if (`${r.participantId}.json` !== file) return null;
      return {
        participantId: r.participantId,
        wave: r.wave as RelayBetaWave,
        enrolledAt: r.enrolledAt,
      };
    } catch {
      return null;
    }
  };

  return {
    enrol(participantId, wave, at) {
      if (!isUsableParticipantId(participantId)) {
        return { ok: false, problem: `"${participantId}" is not a usable participant id.` };
      }
      const dir = dirFor(wave);
      if (dir === null) return { ok: false, problem: `"${wave}" is not a wave this build has.` };
      if (typeof at !== 'string' || at === '') {
        // The instant ORDERS the queue, so a record without one is unusable
        // and is refused rather than written and skipped later.
        return { ok: false, problem: 'An enrolment instant is required; it orders the wave.' };
      }

      const file = join(dir, `${participantId}.json`);
      const record: BetaEnrollment = { participantId, wave, enrolledAt: at };
      // A DISTINCT TEMP PER WRITER, so two concurrent enrolments for the same
      // participant cannot share one and tear each other's contents.
      const temp = join(dir, `${participantId}.json.tmp-${String(process.pid)}-${at.replace(/[:.]/g, '-')}`);

      try {
        // INSIDE the try: a read-only or full volume is a refusal this Result
        // type exists to carry, not an exception thrown through it.
        mkdirSync(dir, { recursive: true, mode: 0o700 });

        const fd = openSync(temp, 'wx', 0o600);
        try {
          // ALL-OR-NOTHING and DURABLE before it is visible under its real
          // name. A short write is a failed write, not a truncated record
          // announced as created.
          const payload = JSON.stringify(record);
          const written = writeSync(fd, payload, null, 'utf8');
          if (written !== Buffer.byteLength(payload, 'utf8')) {
            throw new Error('short write');
          }
          try { fsyncSync(fd); } catch { /* flush unsupported on this fs */ }
        } finally {
          closeSync(fd);
        }

        try {
          // EXCLUSIVE. `linkSync` fails EEXIST, and the file it publishes is
          // already complete — so a loser never observes a half-written record.
          linkSync(temp, file);
        } finally {
          try { unlinkSync(temp); } catch { /* tidy-up only */ }
        }
        fsyncDirBestEffort(dir);
        return { ok: true, outcome: 'created', enrollment: record };
      } catch (error) {
        // Never leave a temp behind to be counted or read as a record.
        try { unlinkSync(temp); } catch { /* already gone */ }
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          return { ok: false, problem: 'The enrolment could not be written durably.' };
        }
        const held = readOne(dir, `${participantId}.json`);
        if (held === null) {
          return { ok: false, problem: 'An enrolment already occupies this participant and cannot be read.' };
        }
        return { ok: true, outcome: 'already_enrolled', enrollment: held };
      }
    },

    list(wave) {
      const dir = dirFor(wave);
      if (dir === null) return [];
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        return [];
      }
      const out: BetaEnrollment[] = [];
      for (const file of files) {
        // `.json` only, so a temp file mid-write is never read as a record.
        if (!file.endsWith('.json')) continue;
        const record = readOne(dir, file);
        if (record !== null) out.push(record);
      }
      return out;
    },

    countFor(wave) {
      const dir = dirFor(wave);
      // An uncontained or unknown wave is not zero seats — it is unanswerable.
      if (dir === null) return null;
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      } catch (error) {
        // ONLY "it does not exist yet" is genuinely zero. Everything else —
        // EACCES, EMFILE, EIO — is a count we do not have, and answering zero
        // to those is how a capped beta silently becomes uncapped.
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
      }
    },
  };
}
