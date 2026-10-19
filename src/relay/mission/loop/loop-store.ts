/**
 * SUNDAY RELAY — THE LOOP PERSISTENCE CONTRACT.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. This is the SHAPE a durable Loop takes and
 * the PORT through which it is read and written. It is not a store: no
 * implementation here touches a filesystem, a journal or a browser database,
 * and none ever will — the mission layer is a pure leaf projection.
 *
 * It exists now, in the command stage, for one reason: Stage 2's runtime needs
 * something to implement against, and a shape agreed before the runtime is
 * written is a shape both surfaces can share. The same reasoning put
 * `DurableMissionRecord` beside the mission wire contracts rather than inside
 * `src/relay/persistence` — the record is domain vocabulary, and each surface
 * supplies its own storage adapter.
 *
 * IT REUSES THE EXISTING BACKING SEAM. `DurableKeyValueBacking` already serves
 * the durable mission record and the mission-worktree store: atomic files in
 * Node, IndexedDB in the browser, an in-memory map in tests. A second seam
 * would mean a second set of durability guarantees to reason about, so there
 * is one.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: credentials, provider tokens, raw
 * secrets, environment values, hidden reasoning, transcripts or full prompts.
 * Large evidence is REFERENCED, never copied — a Loop record must stay small
 * enough to write at every safe boundary.
 */

import type { DurableKeyValueBacking } from '../durable/durable-store';
import { stableDigest } from '../mission';
import type { RelayLoopBlocker } from './loop-blockers';
import type { RelayLoopContract, RelayLoopState } from './loop-contract';

/* ------------------------------------------------------------ versioning */

export const RELAY_LOOP_RECORD_SCHEMA_V1 = 'relay-loop-record.v1' as const;
export const RELAY_LOOP_RECORD_SCHEMA_VERSION = RELAY_LOOP_RECORD_SCHEMA_V1;
/** Every version this build can READ. Older ones migrate forward. */
export const SUPPORTED_LOOP_RECORD_SCHEMA_VERSIONS = [RELAY_LOOP_RECORD_SCHEMA_V1] as const;
export type RelayLoopRecordSchemaVersion =
  (typeof SUPPORTED_LOOP_RECORD_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ the record */

/**
 * A reference to one iteration. The iteration's own evidence, capsules and
 * trace entries live where they already live; this is an identifier and an
 * outcome, so a Loop record does not grow without bound.
 *
 * `outcome: 'unknown'` is the value that forces inspection instead of replay,
 * exactly as `DurableActionRecord.outcome` does for a mission.
 */
export interface RelayLoopIterationRef {
  readonly iterationId: string;
  readonly ordinal: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'unknown';
  /** Known spend in integer micros. `null` is Unknown and must stay Unknown
   *  through recovery — a missing cost never becomes zero. */
  readonly spendMicros: string | null;
  readonly evidenceRefs: readonly string[];
}

/**
 * The session that currently claims this Loop, with a lease expiry.
 *
 * Structurally `DurableOwnerLease`, restated here rather than imported so the
 * Loop record can version independently of the mission record. The FIELDS are
 * deliberately identical: two ownership guards with different shapes would be
 * two things to get right.
 */
export interface RelayLoopOwnerLease {
  readonly sessionId: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

export interface RelayLoopRecord {
  readonly schemaVersion: RelayLoopRecordSchemaVersion;
  readonly loopId: string;
  readonly projectId: string;
  /** Reference + version of the Loop Contract. The contract itself is NOT
   *  copied — it is read from where it is stored, and its versions are
   *  immutable. */
  readonly contractRef: string;
  readonly contractVersion: number;
  /** The digest the contract carried when this record was written. A mismatch
   *  on read means the contract moved under the Loop, which is what makes a
   *  stale resume detectable instead of silently wrong. */
  readonly contractBindingDigest: string;

  readonly state: RelayLoopState;
  readonly iterations: readonly RelayLoopIterationRef[];
  readonly lastIteration: RelayLoopIterationRef | null;
  /** The iteration in flight, if any. An entry here with an `unknown` outcome
   *  is what forces inspection rather than replay. */
  readonly inFlightIteration: RelayLoopIterationRef | null;

  readonly blockers: readonly RelayLoopBlocker[];
  /** Aggregate known spend in integer micros. `null` is Unknown. */
  readonly knownSpendMicros: string | null;
  readonly consecutiveFailures: number;

  /** Why the Loop stopped, when it stopped at all. */
  readonly interruptionReason: string | null;
  readonly owner: RelayLoopOwnerLease | null;
  /**
   * Monotonic. Increments on every accepted resume, so a stale worker that
   * resumes an older generation is detected instead of duplicating work.
   */
  readonly recoveryGeneration: number;

  readonly provenance: 'live' | 'offline' | 'simulated';
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Digest over every field above, sorted. Computed at write time. */
  readonly checksum: string;
}

export type RelayLoopRecordDraft = Omit<RelayLoopRecord, 'schemaVersion' | 'checksum'>;

/* --------------------------------------------------------------- sealing */

/** Everything except the checksum, in a stable shape for digesting. */
function digestFields(draft: RelayLoopRecordDraft): Record<string, unknown> {
  return {
    schemaVersion: RELAY_LOOP_RECORD_SCHEMA_VERSION,
    loopId: draft.loopId,
    projectId: draft.projectId,
    contractRef: draft.contractRef,
    contractVersion: draft.contractVersion,
    contractBindingDigest: draft.contractBindingDigest,
    state: draft.state,
    iterations: draft.iterations,
    lastIteration: draft.lastIteration,
    inFlightIteration: draft.inFlightIteration,
    blockers: draft.blockers,
    knownSpendMicros: draft.knownSpendMicros,
    consecutiveFailures: draft.consecutiveFailures,
    interruptionReason: draft.interruptionReason,
    owner: draft.owner,
    recoveryGeneration: draft.recoveryGeneration,
    provenance: draft.provenance,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

/** Seal a draft: stamp the schema version and compute the checksum. */
export function sealLoopRecord(draft: RelayLoopRecordDraft): RelayLoopRecord {
  return {
    ...draft,
    schemaVersion: RELAY_LOOP_RECORD_SCHEMA_VERSION,
    checksum: stableDigest(digestFields(draft)),
  };
}

export type LoopReadResult =
  | { readonly ok: true; readonly record: RelayLoopRecord }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'corrupt' | 'unsupported_version';
      readonly detail?: string;
    };

/**
 * Read a stored value back as a record.
 *
 * A tampered or truncated record is `corrupt`, never a partially-trusted
 * record: a Loop whose checksum does not verify is one whose state nobody can
 * vouch for, and resuming it would be resuming a guess. An unknown schema
 * version is its own reason, because "written by a newer build" and "damaged"
 * call for different answers from the user.
 */
export function readLoopRecord(value: unknown): LoopReadResult {
  if (value === null || typeof value !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored Loop record is not an object' };
  }
  const candidate = value as Partial<RelayLoopRecord>;
  if (typeof candidate.schemaVersion !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'stored Loop record has no schema version' };
  }
  if (!(SUPPORTED_LOOP_RECORD_SCHEMA_VERSIONS as readonly string[]).includes(candidate.schemaVersion)) {
    return {
      ok: false,
      reason: 'unsupported_version',
      detail: `Loop record schema "${candidate.schemaVersion}" is not readable by this build.`,
    };
  }
  if (typeof candidate.checksum !== 'string' || typeof candidate.loopId !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'stored Loop record is missing required fields' };
  }
  const { schemaVersion: _v, checksum, ...rest } = candidate as RelayLoopRecord;
  const expected = stableDigest(digestFields(rest as RelayLoopRecordDraft));
  if (expected !== checksum) {
    return { ok: false, reason: 'corrupt', detail: 'stored Loop record failed its checksum' };
  }
  return { ok: true, record: candidate as RelayLoopRecord };
}

/* ------------------------------------------------------------- the port */

export interface LoopWriteResult {
  readonly ok: boolean;
  readonly record?: RelayLoopRecord;
  readonly reason?: string;
}

/**
 * The Loop store port. One record per Loop, one store.
 *
 * `durability` is part of the port rather than an implementation detail,
 * because a surface must be able to SAY that its state is volatile. A test
 * backing that reported itself durable would let a demo claim persistence it
 * does not have.
 */
export interface RelayLoopStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(loopId: string): Promise<LoopReadResult>;
  write(draft: RelayLoopRecordDraft): Promise<LoopWriteResult>;
  list(): Promise<readonly string[]>;
  /** A corrupt record is KEPT so it can still be inspected. */
  remove(loopId: string): Promise<void>;
}

const KEY_PREFIX = 'loop:';
const keyFor = (loopId: string): string => `${KEY_PREFIX}${loopId}`;

function safeReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown storage error';
}

/**
 * Build a Loop store over any durable key/value backing.
 *
 * The backing decides durability and location; this decides shape, sealing and
 * verification. Nothing here logs a value, and a storage failure surfaces as a
 * reason rather than a thrown error — the same discipline the worktree and
 * durable-mission stores already follow.
 */
export function createRelayLoopStore(backing: DurableKeyValueBacking): RelayLoopStorePort {
  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,

    async read(loopId) {
      let text: string | null;
      try {
        text = await backing.getText(keyFor(loopId));
      } catch (error) {
        return { ok: false, reason: 'corrupt', detail: safeReason(error) };
      }
      if (text === null) return { ok: false, reason: 'not_found' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, reason: 'corrupt', detail: 'stored Loop record is not valid JSON' };
      }
      return readLoopRecord(parsed);
    },

    async write(draft) {
      const record = sealLoopRecord(draft);
      try {
        await backing.putText(keyFor(record.loopId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async list() {
      const keys = await backing.listKeys();
      return keys
        .filter((key) => key.startsWith(KEY_PREFIX))
        .map((key) => key.slice(KEY_PREFIX.length));
    },

    async remove(loopId) {
      await backing.deleteKey(keyFor(loopId));
    },
  };
}

/**
 * Does this record's contract still bind?
 *
 * A Loop resumed against a contract whose binding fields changed is a Loop
 * doing work nobody approved. Detecting that is the whole point of carrying
 * the digest.
 */
export function contractStillBinds(
  record: RelayLoopRecord,
  contract: RelayLoopContract,
): boolean {
  return (
    record.contractVersion === contract.version &&
    record.contractBindingDigest === contract.bindingDigest
  );
}
