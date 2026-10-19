import type { DurableKeyValueBacking } from '../durable/durable-store';
import { readHarnessRecord, sealHarnessRecord, type HarnessReadResult } from './harness-record';
import type { ReviewerHarnessRecord, ReviewerHarnessRecordDraft } from './harness-contracts';

/** The reviewer-harness store — a fifth key prefix on the SAME durable
    backing the mission, worktree, coding-agent and architect records use. */

export interface HarnessWriteResult {
  readonly ok: boolean;
  readonly record?: ReviewerHarnessRecord;
  readonly reason?: string;
}

export interface ReviewerHarnessStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(missionId: string): Promise<HarnessReadResult>;
  write(draft: ReviewerHarnessRecordDraft): Promise<HarnessWriteResult>;
  list(): Promise<readonly string[]>;
  remove(missionId: string): Promise<void>;
}

const KEY_PREFIX = 'reviewer-harness:';
const keyFor = (missionId: string): string => `${KEY_PREFIX}${missionId}`;

export function createReviewerHarnessStore(
  backing: DurableKeyValueBacking,
): ReviewerHarnessStorePort {
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
        return { ok: false, reason: 'corrupt', detail: 'stored reviewer record is not valid JSON' };
      }
      return readHarnessRecord(parsed);
    },
    async write(draft) {
      const record = sealHarnessRecord(draft);
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
    return message.length > 0 ? message : 'durable reviewer write failed';
  }
  return 'durable reviewer write failed';
}
