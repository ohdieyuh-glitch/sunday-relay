import { closeSync, mkdirSync, openSync, readdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
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
 * IDEMPOTENCY IS STRUCTURAL, NOT CHECKED. The file is created with `O_EXCL`, so
 * a second enrolment for the same participant CANNOT create a second record —
 * the filesystem refuses it, and the store reports `already_enrolled` with the
 * original instant. Review of the gate found read-time deduplication papering
 * over a retried write that had consumed a second seat and evicted a real
 * participant; a store that can only hold one record per participant removes
 * that failure rather than compensating for it. There is no read-modify-write
 * and therefore no lock: `O_EXCL` is the atomicity.
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
 * A WAVE DIRECTORY IS NAMED BY A CLOSED SET. `RELAY_BETA_WAVES` is the only
 * thing that can name a directory here, so no caller-supplied string reaches a
 * path.
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
   * How many enrolments the VOLUME holds for this wave.
   *
   * Deliberately not `list().length`: the gate reconciles this against the list
   * it was given, and a count derived from that same list could never disagree
   * with it. This one is a directory read.
   */
  countFor(wave: RelayBetaWave): number;
}

export function createBetaEnrolmentStore(options: { readonly root: string }): BetaEnrolmentStore {
  const dirFor = (wave: RelayBetaWave): string | null =>
    (KNOWN_WAVE.has(wave) ? join(options.root, ENROLMENTS_DIR, wave) : null);

  const readOne = (dir: string, file: string): BetaEnrollment | null => {
    const raw = readTextIfExists(join(dir, file));
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return null;
      const r = parsed as Record<string, unknown>;
      // A record that cannot be ordered is not returned at all. The gate
      // already refuses malformed rows; not handing them over means one
      // corrupt file cannot reach a decision in the first place.
      if (typeof r.participantId !== 'string' || r.participantId === '') return null;
      if (typeof r.enrolledAt !== 'string' || r.enrolledAt === '') return null;
      if (typeof r.wave !== 'string' || !KNOWN_WAVE.has(r.wave)) return null;
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

      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${participantId}.json`);
      const record: BetaEnrollment = { participantId, wave, enrolledAt: at };

      try {
        // `wx` — CREATE|EXCL. The second writer loses, atomically, in the
        // kernel. This is the idempotency; nothing above it re-checks.
        const fd = openSync(file, 'wx', 0o600);
        try {
          writeSync(fd, JSON.stringify(record));
        } finally {
          closeSync(fd);
        }
        fsyncDirBestEffort(dir);
        return { ok: true, outcome: 'created', enrollment: record };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          return { ok: false, problem: 'The enrolment could not be written durably.' };
        }
        const held = readOne(dir, `${participantId}.json`);
        if (held === null) {
          // The file exists and cannot be read as a record. Reporting
          // `already_enrolled` would attach a seat to a record nobody can
          // order; reporting `created` would claim a write that did not happen.
          return { ok: false, problem: 'An unreadable enrolment already occupies this participant.' };
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
        if (!file.endsWith('.json')) continue;
        const record = readOne(dir, file);
        if (record !== null) out.push(record);
      }
      return out;
    },

    countFor(wave) {
      const dir = dirFor(wave);
      if (dir === null) return 0;
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      } catch {
        // No directory yet is genuinely zero enrolments — not an unknown.
        return 0;
      }
    },
  };
}
