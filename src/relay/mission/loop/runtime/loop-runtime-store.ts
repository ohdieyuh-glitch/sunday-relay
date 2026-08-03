/**
 * SUNDAY RELAY — THE LOOP RUN STORE.
 *
 * The seam between the pure Loop runtime and whatever actually holds the bytes.
 * The port is declared here with an in-memory backing, exactly as
 * `durable-store.ts` does for a mission; the Node backing that writes NDJSON
 * lines, rotates snapshots and takes a lock lives in `src/relay/persistence/`
 * and implements this same interface.
 *
 * THE ONE THING THIS FILE EXISTS TO GUARANTEE. A retry must not become a second
 * fact. Relay retries: a bridge redelivers, a button is pressed twice, a worker
 * wakes up unsure whether its last write landed. If `appendLoopRunEvent` let
 * any of those through, the run would count two iterations where one happened,
 * and its spend total would be wrong in the direction that costs money.
 *
 * So an append is refused BEFORE it is written, on three independent grounds:
 *
 *   IDEMPOTENCY KEY — the requester said "this is the same request as before".
 *   Checked first, because it is the only one that catches a retry whose
 *   payload was rebuilt with fresh ids.
 *
 *   LOGICAL IDENTITY — `loopEventIdentity` says two lines describe the same
 *   fact about the same subject, whatever their event ids are.
 *
 *   THE REDUCER — the event is folded against the current run before it is
 *   committed, and a refusal means nothing is appended at all. An event that
 *   the journal could not replay is never allowed into the journal.
 *
 * A duplicate is reported as a SUCCESS carrying the event that already exists,
 * not as an error. The caller asked for a fact to be recorded; it is recorded.
 * Returning a failure would push retry logic into every call site, which is
 * where duplicate suppression goes to die.
 *
 * PURE. No filesystem, no clock, no crypto — the digest is injected.
 */

import {
  buildLoopEvent,
  loopEventIdentity,
  type RelayLoopEvent,
  type RelayLoopEventInput,
} from './loop-runtime-events';
import {
  loadLoopRun,
  loopSnapshotFrom,
  replayLoopJournal,
  type LoopDigestFn,
  type LoopJournalIntegrity,
  type LoopLoadResult,
  type RelayLoopSnapshot,
} from './loop-runtime-reducer';
import type { RelayLoopRun } from './loop-runtime-types';

/* ---------------------------------------------------------------- port */

/**
 * Everything durably held about one run.
 *
 * The seed is stored beside the journal because replay needs a starting point
 * and re-deriving one from a contract that may since have moved would be
 * reconstructing history from today's facts.
 */
export interface LoopRunRecord {
  readonly runId: string;
  readonly seed: RelayLoopRun;
  readonly events: readonly RelayLoopEvent[];
  readonly snapshot: RelayLoopSnapshot | null;
  /** Rotated, never overwritten — a crash mid-write must leave one intact. */
  readonly previousSnapshot: RelayLoopSnapshot | null;
  /** The backing's verdict on its own bytes. In memory this is always `ok`;
   *  a file backing reports a torn or corrupt journal here. */
  readonly integrity: LoopJournalIntegrity;
}

export interface LoopRunStoreBacking {
  read(runId: string): LoopRunRecord | null;
  write(record: LoopRunRecord): void;
}

/* -------------------------------------------------------------- append */

export type LoopAppendResult =
  | {
      readonly ok: true;
      readonly event: RelayLoopEvent;
      readonly run: RelayLoopRun;
      /** True when this fact was already recorded and nothing was written. */
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly problem: string };

export interface LoopAppendInput {
  readonly runId: string;
  readonly base: RelayLoopEventInput;
  readonly digest: LoopDigestFn;
}

/**
 * Append one event, or recognise that it is already there, or refuse.
 *
 * Nothing is written until the event has been folded successfully. The two
 * builds are not waste: the reducer ignores digests entirely, so folding the
 * provisional event yields exactly the run the final one will produce, and that
 * is what lets the resulting-state digest be computed over a state that has
 * actually been reached rather than one that was assumed.
 */
export function appendLoopRunEvent(
  backing: LoopRunStoreBacking,
  input: LoopAppendInput,
): LoopAppendResult {
  const record = backing.read(input.runId);
  if (record === null) return { ok: false, problem: `There is no Loop run ${input.runId} to append to.` };
  if (record.integrity !== 'ok') {
    return {
      ok: false,
      problem:
        `The journal for ${input.runId} is ${record.integrity.replace(/_/g, ' ')}. Appending to a journal that does `
        + 'not read cleanly would build on a record nobody can vouch for.',
    };
  }

  const replayed = replayLoopJournal(record.seed, record.events);
  if (replayed.problems.length > 0 || replayed.run === null) {
    return {
      ok: false,
      problem: `The journal for ${input.runId} does not replay cleanly, so nothing may be appended to it. ${
        replayed.problems[0] ?? ''
      }`.trim(),
    };
  }
  const run = replayed.run;

  /* --- is this a retry of something already recorded? --- */

  const key = input.base.idempotencyKey;
  if (key !== null && key.trim() !== '') {
    const already = record.events.find((e) => e.idempotencyKey === key && e.kind === input.base.kind);
    if (already !== undefined) {
      return { ok: true, event: already, run, duplicate: true };
    }
  }

  const provisionalIdentity = loopEventIdentity({
    kind: input.base.kind,
    payload: input.base.payload,
    recoveryGeneration: input.base.recoveryGeneration,
  });
  const sameFact = record.events.find((e) => loopEventIdentity(e) === provisionalIdentity);
  if (sameFact !== undefined) {
    return { ok: true, event: sameFact, run, duplicate: true };
  }

  /* --- build, fold, and only then commit --- */

  const sequence = replayed.lastSequence + 1;
  const previousStateDigest = input.digest(run);
  const provisional = buildLoopEvent({
    base: input.base,
    sequence,
    previousStateDigest,
    resultingStateDigest: '',
    digest: input.digest,
  });
  if (!provisional.ok) return { ok: false, problem: provisional.problem };

  const folded = replayLoopJournal(record.seed, [...record.events, provisional.event]);
  if (folded.problems.length > 0 || folded.run === null) {
    return {
      ok: false,
      problem: folded.problems[0] ?? 'The event could not be folded into this run, so it was not appended.',
    };
  }

  const final = buildLoopEvent({
    base: input.base,
    sequence,
    previousStateDigest,
    resultingStateDigest: input.digest(folded.run),
    digest: input.digest,
  });
  if (!final.ok) return { ok: false, problem: final.problem };

  backing.write({ ...record, events: [...record.events, final.event] });
  return { ok: true, event: final.event, run: folded.run, duplicate: false };
}

/* ------------------------------------------------------------ read */

/** Read a run through the full fallback chain. */
export function readLoopRun(
  backing: LoopRunStoreBacking,
  runId: string,
  digest: LoopDigestFn,
): LoopLoadResult | null {
  const record = backing.read(runId);
  if (record === null) return null;
  return loadLoopRun({
    seed: record.seed,
    events: record.events,
    snapshot: record.snapshot,
    previousSnapshot: record.previousSnapshot,
    digest,
    journalIntegrity: record.integrity,
  });
}

/**
 * Take a snapshot, rotating the current one into the previous slot.
 *
 * The rotation is the entire point: overwriting in place means a crash halfway
 * through the write leaves ONE snapshot and it is the broken one. Rotating
 * leaves the last known-good copy untouched, which is what `loadLoopRun` falls
 * back to. A snapshot is refused when the journal does not replay, because a
 * snapshot of an unreadable journal is a confident copy of a guess.
 */
export function checkpointLoopRun(
  backing: LoopRunStoreBacking,
  runId: string,
  digest: LoopDigestFn,
): { readonly ok: true; readonly snapshot: RelayLoopSnapshot } | { readonly ok: false; readonly problem: string } {
  const record = backing.read(runId);
  if (record === null) return { ok: false, problem: `There is no Loop run ${runId} to checkpoint.` };
  const replayed = replayLoopJournal(record.seed, record.events);
  if (replayed.problems.length > 0 || replayed.run === null) {
    return {
      ok: false,
      problem: `The journal for ${runId} does not replay cleanly, so there is no state worth snapshotting.`,
    };
  }
  const snapshot = loopSnapshotFrom(replayed.run, replayed.lastSequence, digest);
  backing.write({ ...record, snapshot, previousSnapshot: record.snapshot });
  return { ok: true, snapshot };
}

/* ------------------------------------------------------------ in-memory */

/**
 * A backing that holds runs in a Map. For tests and the offline fake-agent
 * proof — it is durable across nothing, and says so by name.
 */
export function createInMemoryLoopBacking(
  initial: readonly LoopRunRecord[] = [],
): LoopRunStoreBacking & { snapshotOf(runId: string): LoopRunRecord | null } {
  const runs = new Map<string, LoopRunRecord>(initial.map((r) => [r.runId, r]));
  return {
    read: (runId) => runs.get(runId) ?? null,
    write: (record) => {
      runs.set(record.runId, record);
    },
    snapshotOf: (runId) => runs.get(runId) ?? null,
  };
}

/** Start a record for a run that has no journal yet. */
export function emptyLoopRunRecord(seed: RelayLoopRun): LoopRunRecord {
  return {
    runId: seed.runId,
    seed,
    events: [],
    snapshot: null,
    previousSnapshot: null,
    integrity: 'ok',
  };
}
