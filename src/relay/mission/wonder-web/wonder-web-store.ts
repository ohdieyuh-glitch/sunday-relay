import type { DurableKeyValueBacking } from '../durable/durable-store';
import type { WonderWebCreation, WonderWebCreationDraft } from './wonder-web-contracts';
import {
  readWonderWebCreation,
  sealWonderWebCreation,
  type WonderWebReadResult,
} from './wonder-web-record';

/**
 * WONDER WEB — the creation store.
 *
 * Built on the SAME `DurableKeyValueBacking` seam as the durable mission record
 * and the mission worktree record, so one backing serves all three: atomic files
 * in Node, IndexedDB in the browser, an in-memory map in tests. A creation is
 * stored once and referenced from everywhere else — the project does not keep a
 * second copy of it, because two copies of a record are two answers to the same
 * question.
 *
 * `listForOwner` exists because every read path in Wonder Web is owner-scoped.
 * Offering an unscoped `list()` as the primary way to enumerate creations is how
 * a surface ends up showing one user another user's work: the convenient call
 * would be the unsafe one. The unscoped listing is still available for the
 * evidence dump and for operators, under a name that says so.
 */

export interface WonderWebWriteResult {
  readonly ok: boolean;
  readonly record?: WonderWebCreation;
  readonly reason?: string;
}

export interface WonderWebStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(creationId: string): Promise<WonderWebReadResult>;
  write(draft: WonderWebCreationDraft): Promise<WonderWebWriteResult>;
  /** Every creation belonging to one account. The normal way to enumerate. */
  listForOwner(ownerUserId: string): Promise<readonly WonderWebCreation[]>;
  /** Every creation id, unscoped. For evidence dumps and operator tooling. */
  listAllIds(): Promise<readonly string[]>;
  /** Used only when a user deletes a creation. Corrupt records are kept. */
  remove(creationId: string): Promise<void>;
}

const KEY_PREFIX = 'wonder-web:';
const keyFor = (creationId: string): string => `${KEY_PREFIX}${creationId}`;

export function createWonderWebStore(backing: DurableKeyValueBacking): WonderWebStorePort {
  const readOne = async (creationId: string): Promise<WonderWebReadResult> => {
    let text: string | null;
    try {
      text = await backing.getText(keyFor(creationId));
    } catch (error) {
      return { ok: false, reason: 'corrupt', detail: safeReason(error) };
    }
    if (text === null) return { ok: false, reason: 'not_found' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'stored creation is not valid JSON' };
    }
    return readWonderWebCreation(parsed);
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
      const record = sealWonderWebCreation(draft);
      try {
        await backing.putText(keyFor(record.creationId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async listForOwner(ownerUserId) {
      const found: WonderWebCreation[] = [];
      for (const id of await allIds()) {
        const result = await readOne(id);
        // A record that will not read is not silently dropped from a listing as
        // if it never existed — but it is also not attributed to an owner it
        // cannot prove. It is omitted here and surfaced by the operator listing.
        if (result.ok && result.record.ownerUserId === ownerUserId) found.push(result.record);
      }
      // Newest first, with the id as a total tie-break so the order is stable
      // across machines when two creations share an instant.
      return found.sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.creationId < b.creationId ? 1 : -1
          : a.createdAt < b.createdAt ? 1 : -1,
      );
    },

    listAllIds: allIds,

    async remove(creationId) {
      try {
        await backing.deleteKey(keyFor(creationId));
      } catch {
        /* already gone, or storage denied */
      }
    },
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable creation write failed';
  }
  return 'durable creation write failed';
}
