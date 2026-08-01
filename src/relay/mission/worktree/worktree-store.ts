import type { DurableKeyValueBacking } from '../durable/durable-store';
import { readWorktreeRecord, sealWorktreeRecord, type WorktreeReadResult } from './worktree-record';
import type { MissionWorktreeRecord, MissionWorktreeRecordDraft } from './worktree-contracts';

/**
 * The mission-worktree store. Deliberately built on the SAME
 * `DurableKeyValueBacking` seam the durable mission record already uses, so
 * one backing serves both: atomic files in Node, IndexedDB in the browser,
 * an in-memory map in tests. There is one record per mission and one store —
 * the record is referenced from elsewhere, never copied into a second store.
 */

export interface WorktreeWriteResult {
  readonly ok: boolean;
  readonly record?: MissionWorktreeRecord;
  readonly reason?: string;
}

export interface MissionWorktreeStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(missionId: string): Promise<WorktreeReadResult>;
  write(draft: MissionWorktreeRecordDraft): Promise<WorktreeWriteResult>;
  list(): Promise<readonly string[]>;
  /** Used only when a user removes a worktree. A corrupt record is kept so
      it can still be inspected. */
  remove(missionId: string): Promise<void>;
}

const KEY_PREFIX = 'worktree:';
const keyFor = (missionId: string): string => `${KEY_PREFIX}${missionId}`;

export function createMissionWorktreeStore(
  backing: DurableKeyValueBacking,
): MissionWorktreeStorePort {
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
        return { ok: false, reason: 'corrupt', detail: 'stored worktree record is not valid JSON' };
      }
      return readWorktreeRecord(parsed);
    },

    async write(draft) {
      const record = sealWorktreeRecord(draft);
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
        /* already gone, or storage denied */
      }
    },
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable worktree write failed';
  }
  return 'durable worktree write failed';
}
