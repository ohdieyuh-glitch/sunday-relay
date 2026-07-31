import { readDurableRecord, sealDurableRecord, type DurableReadResult } from './durable-record';
import type {
  DurableMissionRecord,
  DurableMissionRecordDraft,
} from './durable-contracts';

/**
 * THE ONE DURABLE-MISSION PERSISTENCE PORT.
 *
 * Async on purpose: IndexedDB (browser) and fsync'd file writes (Node) are
 * both asynchronous in practice, and the whole truthfulness contract depends
 * on knowing WHEN a write is durable. A caller may only report "Mission
 * saved" after the returned promise resolves `ok`.
 *
 * Adapters implement four operations and nothing else. Everything above them
 * — sealing, validation, checkpoint policy, recovery classification — is pure
 * and shared, so the browser and Node behave identically on the same bytes.
 */

export interface DurableWriteOk {
  readonly ok: true;
  readonly record: DurableMissionRecord;
}
export interface DurableWriteFailed {
  readonly ok: false;
  /** Safe, human-readable. Never a stack trace, never a credential. */
  readonly reason: string;
}
export type DurableWriteResult = DurableWriteOk | DurableWriteFailed;

export interface DurableMissionStorePort {
  /** Honest label — a volatile adapter may never claim durability. */
  readonly durability: 'durable' | 'volatile-test-only';
  /** Where records live, for display only (e.g. 'IndexedDB', a state root). */
  readonly locationLabel: string;
  /** Reads and VALIDATES: version → shape → checksum. */
  read(missionId: string): Promise<DurableReadResult>;
  /** Seals and writes. Resolves only after the write is durable. */
  write(draft: DurableMissionRecordDraft): Promise<DurableWriteResult>;
  /** Mission ids with an incomplete record, newest checkpoint first. */
  list(): Promise<readonly string[]>;
  /**
   * Removes a record. Used ONLY when the user stops a mission — corrupt
   * records are never auto-deleted, so recovery can still inspect them.
   */
  remove(missionId: string): Promise<void>;
}

/* ---------------------------------------------------------- key/value seam */

/**
 * The minimal async key/value surface an adapter needs. IndexedDB, a
 * filesystem directory and an in-memory Map all satisfy it, which is why
 * one store implementation serves all three.
 */
export interface DurableKeyValueBacking {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  getText(key: string): Promise<string | null>;
  putText(key: string, value: string): Promise<void>;
  deleteKey(key: string): Promise<void>;
  listKeys(): Promise<readonly string[]>;
}

const KEY_PREFIX = 'mission:';

const keyFor = (missionId: string): string => `${KEY_PREFIX}${missionId}`;

/**
 * The shared store implementation. Every adapter is this function plus a
 * backing — so validation, sealing and error handling can never diverge
 * between the browser and Node.
 */
export function createDurableMissionStore(
  backing: DurableKeyValueBacking,
): DurableMissionStorePort {
  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,

    async read(missionId: string): Promise<DurableReadResult> {
      let text: string | null;
      try {
        text = await backing.getText(keyFor(missionId));
      } catch (error) {
        return { ok: false, reason: 'corrupt', detail: safeReason(error) };
      }
      if (text === null) return { ok: false, reason: 'not_found' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Malformed JSON is CORRUPT, never "no mission". The bytes stay on
        // disk so the user can still inspect or export them.
        return { ok: false, reason: 'corrupt', detail: 'stored record is not valid JSON' };
      }
      return readDurableRecord(parsed);
    },

    async write(draft: DurableMissionRecordDraft): Promise<DurableWriteResult> {
      const record = sealDurableRecord(draft);
      try {
        await backing.putText(keyFor(record.missionId), JSON.stringify(record));
      } catch (error) {
        // The caller must show "Save delayed" — never "Mission saved".
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async list(): Promise<readonly string[]> {
      let keys: readonly string[];
      try {
        keys = await backing.listKeys();
      } catch {
        return [];
      }
      return keys
        .filter((k) => k.startsWith(KEY_PREFIX))
        .map((k) => k.slice(KEY_PREFIX.length));
    },

    async remove(missionId: string): Promise<void> {
      try {
        await backing.deleteKey(keyFor(missionId));
      } catch {
        /* already gone, or storage denied — nothing to undo */
      }
    },
  };
}

/** Never leak an exception's internals into a user-visible reason. */
function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable write failed';
  }
  return 'durable write failed';
}

/* ------------------------------------------------------------ in-memory */

/**
 * The volatile adapter, used by tests and by any runtime with no storage at
 * all. It labels itself `volatile-test-only` exactly like the existing
 * in-memory relay stores, so nothing can mistake it for durability.
 *
 * `failWrites` exists so the "Save delayed" path is testable without
 * corrupting a real store.
 */
export function createInMemoryDurableBacking(options: {
  failWrites?: boolean;
  seed?: Readonly<Record<string, string>>;
} = {}): DurableKeyValueBacking & { failWrites: boolean } {
  const map = new Map<string, string>(Object.entries(options.seed ?? {}));
  return {
    durability: 'volatile-test-only',
    locationLabel: 'in-memory (not durable)',
    failWrites: options.failWrites ?? false,
    async getText(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async putText(key, value) {
      if (this.failWrites) throw new Error('storage unavailable');
      map.set(key, value);
    },
    async deleteKey(key) {
      map.delete(key);
    },
    async listKeys() {
      return [...map.keys()];
    },
  };
}
