import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOSTED_RUN_SCHEMA, isTerminal, newHostedRun,
  type HostedRunRecord,
} from './hosted-run-record';

/**
 * DURABLE HOSTED RUN STORAGE, on the mounted volume.
 *
 * A hosted run outlives the request that started it and can outlive the
 * process, so the record is written to disk before anything launches. Writes
 * go to a temporary file and are renamed into place, because a crash halfway
 * through serialising a record must not leave a half-written one that reads
 * back as a corrupt run.
 *
 * DUPLICATE EXECUTION IS PREVENTED HERE, not in the route. The idempotency key
 * is the filename-safe index: a repeated key returns the run that already
 * exists instead of starting a second paid execution. Doing it at the storage
 * layer means a retry of the HTTP request — a double-click, a proxy replay, a
 * client timeout — cannot bill the founder twice, regardless of which caller
 * made it.
 */

export interface HostedRunStore {
  readonly durable: boolean;
  readonly locationLabel: string;
  /** The run for this key, when one already exists. */
  findByIdempotencyKey(key: string): HostedRunRecord | null;
  read(runId: string): HostedRunRecord | null;
  write(record: HostedRunRecord): void;
  list(): readonly HostedRunRecord[];
  /** Runs that were active when the process died. */
  activeRuns(): readonly HostedRunRecord[];
}

const DIR = 'hosted-coding-runs';
/** Keys and ids are hashed into a safe filename rather than trusted as one. */
const safeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

function readRecord(path: string): HostedRunRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HostedRunRecord;
    // A record written by a future schema is not read as if it were this one.
    return parsed.schemaVersion === HOSTED_RUN_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A store on the mounted volume. `stateRoot === null` yields a volatile
 * in-memory store that SAYS it is volatile, so a bridge without a mount does
 * not silently pretend its runs are durable.
 */
export function createHostedRunStore(stateRoot: string | null): HostedRunStore {
  if (stateRoot === null) {
    const memory = new Map<string, HostedRunRecord>();
    return {
      durable: false,
      locationLabel: 'in-memory (no durable volume is mounted)',
      findByIdempotencyKey: (key) =>
        [...memory.values()].find((r) => r.idempotencyKey === key) ?? null,
      read: (runId) => memory.get(runId) ?? null,
      write: (record) => { memory.set(record.runId, record); },
      list: () => [...memory.values()],
      activeRuns: () => [...memory.values()].filter((r) => !isTerminal(r.state)),
    };
  }

  const root = join(stateRoot, DIR);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const all = (): HostedRunRecord[] => {
    let names: string[];
    try {
      names = readdirSync(root).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    return names
      .map((n) => readRecord(join(root, n)))
      .filter((r): r is HostedRunRecord => r !== null);
  };

  return {
    durable: true,
    locationLabel: 'mounted volume',
    findByIdempotencyKey: (key) => all().find((r) => r.idempotencyKey === key) ?? null,
    read: (runId) => readRecord(join(root, `${safeName(runId)}.json`)),
    write: (record) => {
      const target = join(root, `${safeName(record.runId)}.json`);
      const temp = `${target}.tmp`;
      // Write-then-rename: a crash mid-write leaves the previous record
      // intact rather than a half-serialised one.
      writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
      renameSync(temp, target);
    },
    list: all,
    activeRuns: () => all().filter((r) => !isTerminal(r.state)),
  };
}

export interface StartDecision {
  readonly kind: 'start' | 'duplicate' | 'refused';
  readonly record: HostedRunRecord | null;
  readonly status: number;
  readonly message: string | null;
}

/**
 * Decide whether a start request may launch anything.
 *
 * A repeated idempotency key returns the existing run rather than launching a
 * second one — that is the duplicate-execution guard, and it returns the run
 * so a retried HTTP call still gets a useful answer instead of an error.
 *
 * A second CONCURRENT run is refused outright: this bridge runs one hosted
 * Coding Agent at a time, because two agents editing disposable workspaces
 * against one credential is spend nobody authorised.
 */
export function decideHostedStart(input: {
  store: HostedRunStore;
  runId: string;
  missionId: string;
  idempotencyKey: string;
  requestedModel: string | null;
  now: string;
}): StartDecision {
  const existing = input.store.findByIdempotencyKey(input.idempotencyKey);
  if (existing !== null) {
    return {
      kind: 'duplicate',
      record: existing,
      status: 200,
      message: null,
    };
  }
  const active = input.store.activeRuns();
  if (active.length > 0) {
    return {
      kind: 'refused',
      record: null,
      status: 409,
      message: `A hosted Coding Agent run (${active[0].runId}) is already in flight. Stop it before starting another.`,
    };
  }
  return {
    kind: 'start',
    record: newHostedRun({
      runId: input.runId,
      missionId: input.missionId,
      idempotencyKey: input.idempotencyKey,
      requestedModel: input.requestedModel,
      now: input.now,
    }),
    status: 200,
    message: null,
  };
}

/**
 * Classify a run found active at startup.
 *
 * Relay restarted and cannot confirm the process that was running, so the run
 * becomes `failed` with a truthful reason. It is never replayed and never
 * relaunched — an unconfirmable hosted run that quietly restarted would spend
 * money nobody asked for a second time.
 */
export function recoverHostedRun(record: HostedRunRecord, now: string): HostedRunRecord {
  if (isTerminal(record.state)) return record;
  return {
    ...record,
    state: 'failed',
    endedAt: now,
    failureReason:
      'The Relay Bridge restarted and cannot confirm the hosted Coding Agent process that was running. '
      + 'Nothing was replayed and no new run was started.',
    updatedAt: now,
  };
}
