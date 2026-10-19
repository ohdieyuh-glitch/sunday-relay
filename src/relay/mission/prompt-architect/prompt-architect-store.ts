import type { DurableKeyValueBacking } from '../durable/durable-store';
import {
  readArchitectRecord, sealArchitectRecord, type ArchitectReadResult,
} from './prompt-architect-record';
import type { PromptArchitectRecord, PromptArchitectRecordDraft } from './prompt-architect-contracts';

/** The prompt-architect store — a fourth key prefix on the SAME durable
    backing the mission, worktree and coding-agent records already use. */

export interface ArchitectWriteResult {
  readonly ok: boolean;
  readonly record?: PromptArchitectRecord;
  readonly reason?: string;
}

export interface PromptArchitectStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(missionId: string): Promise<ArchitectReadResult>;
  write(draft: PromptArchitectRecordDraft): Promise<ArchitectWriteResult>;
  list(): Promise<readonly string[]>;
  remove(missionId: string): Promise<void>;
}

const KEY_PREFIX = 'prompt-architect:';
const keyFor = (missionId: string): string => `${KEY_PREFIX}${missionId}`;

export function createPromptArchitectStore(
  backing: DurableKeyValueBacking,
): PromptArchitectStorePort {
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
        return { ok: false, reason: 'corrupt', detail: 'stored architect record is not valid JSON' };
      }
      return readArchitectRecord(parsed);
    },
    async write(draft) {
      const record = sealArchitectRecord(draft);
      try {
        await backing.putText(keyFor(record.missionId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },
    async list() {
      try {
        const keys = await backing.listKeys();
        return keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length));
      } catch {
        return [];
      }
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
    return message.length > 0 ? message : 'durable architect write failed';
  }
  return 'durable architect write failed';
}
