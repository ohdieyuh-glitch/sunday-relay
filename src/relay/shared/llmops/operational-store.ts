/**
 * SUNDAY RELAY — THE OPERATIONAL STORE
 *
 * The producer reads one run. This accumulates them, which is the difference
 * between a model and an instrument: until something folds observations
 * together across runs, every surface can only truthfully report that nothing
 * is being measured — and both of ours did, for two milestones.
 *
 * WHAT IT REFUSES.
 *
 * - **To claim durability it does not have.** The backing declares itself
 *   `durable` or `volatile-test-only` and the store carries that label out
 *   verbatim. A surface reading an in-memory store must be able to say so; a
 *   dashboard that survives nothing while implying it survives everything is
 *   worse than no dashboard.
 * - **To grow without bound.** A record that accumulates forever eventually
 *   costs more to read than the answer is worth. It keeps the newest
 *   observations and COUNTS what it dropped, because percentiles over a
 *   silently truncated window describe the window, not the system.
 * - **To lose a write quietly.** Every call returns a result. A caller that
 *   ignores it has chosen to; a store that swallowed it would have chosen for
 *   them.
 * - **To pretend a race did not happen.** Read-modify-write on a key/value
 *   backing is last-write-wins. Calls through ONE store instance are
 *   serialised per project, so the common case is safe. Two processes writing
 *   the same project are NOT, and `concurrencyScope` says which you have.
 */

import type { RelayOperationalRecord } from './llmops-contracts';
import { emptyOperationalRecord } from './llmops-contracts';
import { ingest } from './operational-intake';
import type { RunObservation } from './run-observation';

/** The minimal async key/value surface, structurally — see `mission/durable`. */
export interface OperationalBacking {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  getText(key: string): Promise<string | null>;
  putText(key: string, value: string): Promise<void>;
}

/**
 * How many observations a project's record keeps.
 *
 * Latency is capped higher than errors because percentiles need a population
 * and errors are counted, not distributed. Both are bounded because neither
 * should be able to make reading a project's health a large operation.
 */
export const MAX_LATENCY_SAMPLES = 500;
export const MAX_ERROR_EVENTS = 200;

export interface OperationalStoreStatus {
  /** Carried from the backing verbatim. Never upgraded, never assumed. */
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  /**
   * `process` means writes through THIS instance are serialised per project.
   * It does not mean two processes are safe — they are not, and nothing here
   * can make them so over a key/value seam with no compare-and-set.
   */
  readonly concurrencyScope: 'process';
}

export type OperationalWriteResult =
  | { readonly ok: true; readonly record: RelayOperationalRecord }
  | { readonly ok: false; readonly reason: string };

export type OperationalReadResult =
  | { readonly ok: true; readonly record: RelayOperationalRecord | null }
  | { readonly ok: false; readonly reason: string };

export interface OperationalStore {
  readonly status: OperationalStoreStatus;
  /** Folds one observation in. Returns the record as it now stands. */
  record(projectId: string, observation: RunObservation): Promise<OperationalWriteResult>;
  /** `null` means NOTHING HAS BEEN RECORDED — not an empty record. */
  read(projectId: string): Promise<OperationalReadResult>;
}

const keyFor = (projectId: string): string => `relay.operations.${projectId}`;

/**
 * Keep the newest `limit`, and say how many were dropped.
 *
 * The count matters more than it looks: a p95 computed over a truncated window
 * is a p95 of the window. A reader who knows 4000 samples were dropped knows to
 * read it as recent-history rather than as the project's history.
 */
function keepNewest<T>(items: readonly T[], limit: number): { kept: T[]; dropped: number } {
  if (items.length <= limit) return { kept: [...items], dropped: 0 };
  return { kept: items.slice(items.length - limit), dropped: items.length - limit };
}

/** A stored record, shape-checked. Anything unrecognised is treated as absent. */
function parseRecord(text: string, projectId: string): RelayOperationalRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<RelayOperationalRecord>;
  if (candidate.projectId !== projectId) return null;
  if (!Array.isArray(candidate.latency) || !Array.isArray(candidate.errors)) return null;
  if (!Array.isArray(candidate.waits) || !Array.isArray(candidate.evaluations)) return null;
  if (!Array.isArray(candidate.repairLoops)) return null;
  if (typeof candidate.attempts !== 'object' || candidate.attempts === null) return null;
  return candidate as RelayOperationalRecord;
}

export function createOperationalStore(backing: OperationalBacking): OperationalStore {
  // One promise chain per project. Two runs finishing at the same instant would
  // otherwise both read the old record and the second would overwrite the
  // first's observation — silently, and exactly when the system is busiest.
  const chains = new Map<string, Promise<unknown>>();

  const serialise = async <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const previous = chains.get(projectId) ?? Promise.resolve();
    const next = previous.then(work, work);
    // Kept even on rejection so a failed write cannot wedge the chain.
    chains.set(projectId, next.then(() => undefined, () => undefined));
    return next;
  };

  const readRaw = async (projectId: string): Promise<RelayOperationalRecord | null> => {
    const text = await backing.getText(keyFor(projectId));
    return text === null ? null : parseRecord(text, projectId);
  };

  return {
    status: {
      durability: backing.durability,
      locationLabel: backing.locationLabel,
      concurrencyScope: 'process',
    },

    async read(projectId) {
      try {
        return { ok: true, record: await readRaw(projectId) };
      } catch (error) {
        // A read that failed is not a project with no data, and the caller is
        // told which it got.
        return { ok: false, reason: describe(error) };
      }
    },

    async record(projectId, observation) {
      return serialise(projectId, async () => {
        try {
          const existing = await readRaw(projectId) ?? emptyOperationalRecord(projectId);
          const folded = ingest(existing, {
            latency: observation.latency,
            errors: observation.errors,
            attemptsObserved: observation.attemptsObserved,
            observedAt: observation.observedAt,
          });

          const latency = keepNewest(folded.latency, MAX_LATENCY_SAMPLES);
          const errors = keepNewest(folded.errors, MAX_ERROR_EVENTS);
          const bounded: RelayOperationalRecord = {
            ...folded,
            latency: latency.kept,
            errors: errors.kept,
            // Accumulated, not replaced: the count is of everything ever
            // dropped for this project, which is what a reader needs to judge
            // whether the window is representative.
            droppedLatency: folded.droppedLatency + latency.dropped,
            droppedErrors: folded.droppedErrors + errors.dropped,
          };

          await backing.putText(keyFor(projectId), JSON.stringify(bounded));
          return { ok: true as const, record: bounded };
        } catch (error) {
          return { ok: false as const, reason: describe(error) };
        }
      });
    },
  };
}

const describe = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);
