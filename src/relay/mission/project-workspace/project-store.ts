import type { DurableKeyValueBacking } from '../durable/durable-store';
import { hasCapability, type WonderlandProject, type WonderlandProjectDraft } from './project-contracts';
import {
  readWonderlandProject,
  sealWonderlandProject,
  type WonderlandProjectReadResult,
} from './project-record';

/**
 * THE PROJECT STORE — the promise that Tuesday finds Monday's work.
 *
 * Same `DurableKeyValueBacking` seam as every other durable record here, so one
 * backing serves all of them: atomic files in Node, IndexedDB in the browser, a
 * map in tests.
 *
 * `listFor` is membership-scoped rather than owner-scoped, because a
 * collaborator's projects are theirs to see too — and it is the only listing
 * offered by default, so the convenient call is the safe one. The unscoped
 * listing exists for operators and evidence dumps under a name that says so.
 */

export interface WonderlandProjectWriteResult {
  readonly ok: boolean;
  readonly record?: WonderlandProject;
  readonly reason?: string;
}

export interface WonderlandProjectStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(projectId: string): Promise<WonderlandProjectReadResult>;
  write(draft: WonderlandProjectDraft): Promise<WonderlandProjectWriteResult>;
  /** Every project this account may view. The normal way to enumerate. */
  listFor(userId: string): Promise<readonly WonderlandProject[]>;
  /** Every project id, unscoped. Operators and evidence dumps only. */
  listAllIds(): Promise<readonly string[]>;
  remove(projectId: string): Promise<void>;
}

const KEY_PREFIX = 'wonderland-project:';
const keyFor = (projectId: string): string => `${KEY_PREFIX}${projectId}`;

export function createWonderlandProjectStore(
  backing: DurableKeyValueBacking,
): WonderlandProjectStorePort {
  const readOne = async (projectId: string): Promise<WonderlandProjectReadResult> => {
    let text: string | null;
    try {
      text = await backing.getText(keyFor(projectId));
    } catch (error) {
      return { ok: false, reason: 'corrupt', detail: safeReason(error) };
    }
    if (text === null) return { ok: false, reason: 'not_found' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'stored project is not valid JSON' };
    }
    return readWonderlandProject(parsed);
  };

  const allIds = async (): Promise<readonly string[]> => {
    let keys: readonly string[];
    try {
      keys = await backing.listKeys();
    } catch {
      return [];
    }
    return keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length));
  };

  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,
    read: readOne,

    async write(draft) {
      const record = sealWonderlandProject(draft);
      try {
        await backing.putText(keyFor(record.projectId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async listFor(userId) {
      const found: WonderlandProject[] = [];
      for (const id of await allIds()) {
        const result = await readOne(id);
        if (result.ok && hasCapability(result.record, userId, 'view_project')) {
          found.push(result.record);
        }
      }
      return found.sort((a, b) =>
        a.updatedAt === b.updatedAt
          ? a.projectId < b.projectId ? 1 : -1
          : a.updatedAt < b.updatedAt ? 1 : -1,
      );
    },

    listAllIds: allIds,

    async remove(projectId) {
      try {
        await backing.deleteKey(keyFor(projectId));
      } catch {
        /* already gone, or storage denied */
      }
    },
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable project write failed';
  }
  return 'durable project write failed';
}
