/**
 * A DETERMINISTIC IN-MEMORY GAUNTLET STORE.
 *
 * Models the two uniqueness rules the SQL declares — one gauntlet per subject
 * per run, one row per `(gauntletId, round, phase)` — plus the compare-and-set
 * on `version` that the machine already applies in memory. A settled round
 * stays settled, exactly as `completed_at IS NULL` in the WHERE clause makes
 * it.
 *
 * It is a TEST DOUBLE and an offline reference, never a production store: it
 * holds everything in a Map and forgets it when the process exits.
 */

import type {
  GauntletCommandRecord, GauntletPhase, GauntletRoundRecord, GauntletStore,
} from './gauntlet-command';

export interface GauntletMemoryStore extends GauntletStore {
  /** Simulate a process restart: the records survive. */
  restart(): void;
  all(): readonly GauntletCommandRecord[];
}

export function createGauntletMemoryStore(): GauntletMemoryStore {
  const gauntlets = new Map<string, GauntletCommandRecord>();
  const rounds = new Map<string, GauntletRoundRecord>();

  return {
    async create(record) {
      const bySubject = [...gauntlets.values()].find((row) =>
        row.runId === record.runId && row.subjectId === record.subjectId);
      if (bySubject !== undefined) return { created: false, record: { ...bySubject } };
      if (gauntlets.has(record.gauntletId)) {
        return { created: false, record: { ...gauntlets.get(record.gauntletId)! } };
      }
      gauntlets.set(record.gauntletId, { ...record });
      return { created: true, record: { ...record } };
    },

    async load(runId, gauntletId) {
      const record = gauntlets.get(gauntletId);
      return record !== undefined && record.runId === runId ? { ...record } : null;
    },

    async forSubject(runId, subjectId) {
      const record = [...gauntlets.values()].find((row) => row.runId === runId && row.subjectId === subjectId);
      return record ? { ...record } : null;
    },

    async save(record, expectedVersion) {
      const stored = gauntlets.get(record.gauntletId);
      if (stored === undefined || stored.version !== expectedVersion) return false;
      gauntlets.set(record.gauntletId, { ...record });
      return true;
    },

    async recordRound(round) {
      const key = `${round.gauntletId}::${round.round}::${round.phase}`;
      if (rounds.has(key)) return { recorded: false, duplicate: true };
      rounds.set(key, { ...round });
      return { recorded: true, duplicate: false };
    },

    async settleRound(input) {
      const key = `${input.gauntletId}::${input.round}::${input.phase as GauntletPhase}`;
      const round = rounds.get(key);
      if (round === undefined || round.completedAt !== null) return false;
      rounds.set(key, {
        ...round, outcome: input.outcome, durationMs: input.durationMs,
        usdMicros: input.usdMicros, findingIds: [...input.findingIds], completedAt: input.completedAt,
      });
      return true;
    },

    async roundsFor(gauntletId) {
      return [...rounds.values()]
        .filter((round) => round.gauntletId === gauntletId)
        .sort((a, b) => a.round - b.round || a.phase.localeCompare(b.phase))
        .map((round) => ({ ...round }));
    },

    restart() { /* records survive; there is no in-flight state to lose */ },
    all() { return [...gauntlets.values()].map((record) => ({ ...record })); },
  };
}
