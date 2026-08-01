import type { DurableKeyValueBacking } from '../durable/durable-store';
import {
  readCodingAgentRecord,
  sealCodingAgentRecord,
  type CodingAgentReadResult,
} from './coding-agent-record';
import type {
  CodingAgentRuntimeRecord,
  CodingAgentRuntimeRecordDraft,
} from './coding-agent-contracts';

/**
 * The coding-agent runtime store, built on the SAME key/value backing the
 * durable mission record and the worktree record already use. Three key
 * prefixes, one set of atomic-write and retention rules — not three
 * competing stores.
 */

export interface CodingAgentWriteResult {
  readonly ok: boolean;
  readonly record?: CodingAgentRuntimeRecord;
  readonly reason?: string;
}

export interface CodingAgentStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(missionId: string): Promise<CodingAgentReadResult>;
  write(draft: CodingAgentRuntimeRecordDraft): Promise<CodingAgentWriteResult>;
  list(): Promise<readonly string[]>;
  remove(missionId: string): Promise<void>;
}

const KEY_PREFIX = 'coding-agent:';
const keyFor = (missionId: string): string => `${KEY_PREFIX}${missionId}`;

export function createCodingAgentStore(backing: DurableKeyValueBacking): CodingAgentStorePort {
  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,

    async read(missionId) {
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
        return { ok: false, reason: 'corrupt', detail: 'stored runtime record is not valid JSON' };
      }
      return readCodingAgentRecord(parsed);
    },

    async write(draft) {
      const record = sealCodingAgentRecord(draft);
      try {
        await backing.putText(keyFor(record.missionId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async list() {
      let keys: readonly string[];
      try {
        keys = await backing.listKeys();
      } catch {
        return [];
      }
      return keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length));
    },

    async remove(missionId) {
      try {
        await backing.deleteKey(keyFor(missionId));
      } catch {
        /* already gone */
      }
    },
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable runtime write failed';
  }
  return 'durable runtime write failed';
}
