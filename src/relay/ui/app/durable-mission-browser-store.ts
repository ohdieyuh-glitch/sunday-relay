import {
  createDurableMissionStore,
  createInMemoryDurableBacking,
  type DurableKeyValueBacking,
  type DurableMissionStorePort,
} from '../../mission/durable';

/**
 * THE BROWSER DURABLE-MISSION ADAPTER — IndexedDB.
 *
 * Deliberately NOT localStorage. The existing `persistence.ts` localStorage
 * envelope stays exactly as it is for the small app dataset, but a mission
 * record carries evidence references, action history and usage state, and
 * localStorage is a synchronous ~5MB string bucket with no transaction and no
 * durability signal — there is no honest moment at which it can say "this is
 * saved". IndexedDB gives a real transaction whose `complete` event is the
 * moment "Mission saved" becomes true.
 *
 * localStorage keeps only a tiny NON-SENSITIVE INDEX (mission ids and their
 * last checkpoint time) so the shell can show "you have an unfinished
 * mission" before IndexedDB opens. The index is a hint; the record is the
 * truth, and a hint that disagrees with the record loses.
 *
 * When IndexedDB is unavailable (private mode, an old runtime, jsdom under
 * test) the factory returns the VOLATILE in-memory backing, honestly labeled
 * — the product then reports that it cannot durably save, rather than
 * pretending it did.
 */

export const DURABLE_DB_NAME = 'sunday-relay.missions';
export const DURABLE_DB_VERSION = 1;
export const DURABLE_STORE_NAME = 'durable-missions';
/** Non-sensitive hint index only: mission ids + checkpoint times. */
export const DURABLE_INDEX_KEY = 'sunday-relay.missions.index.v1';

export interface DurableMissionIndexEntry {
  readonly missionId: string;
  readonly checkpointAt: string;
}

/* ------------------------------------------------------- the hint index */

export function readDurableIndex(backing?: Storage): readonly DurableMissionIndexEntry[] {
  const store = resolveLocalStorage(backing);
  if (store === null) return [];
  try {
    const raw = store.getItem(DURABLE_INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DurableMissionIndexEntry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as DurableMissionIndexEntry).missionId === 'string' &&
        typeof (entry as DurableMissionIndexEntry).checkpointAt === 'string',
    );
  } catch {
    return []; // a broken hint is simply no hint
  }
}

export function writeDurableIndex(
  entries: readonly DurableMissionIndexEntry[],
  backing?: Storage,
): void {
  const store = resolveLocalStorage(backing);
  if (store === null) return;
  try {
    store.setItem(DURABLE_INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* quota or denied — the record in IndexedDB remains the truth */
  }
}

function resolveLocalStorage(backing?: Storage): Storage | null {
  if (backing !== undefined) return backing;
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ IndexedDB */

type IndexedDbFactory = {
  open(name: string, version?: number): IDBOpenDBRequest;
};

function resolveIndexedDb(): IndexedDbFactory | null {
  try {
    const factory = (globalThis as { indexedDB?: IndexedDbFactory }).indexedDB;
    return factory !== undefined && factory !== null ? factory : null;
  } catch {
    return null;
  }
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(factory: IndexedDbFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DURABLE_DB_NAME, DURABLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DURABLE_STORE_NAME)) {
        db.createObjectStore(DURABLE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/** The IndexedDB backing. Every write awaits transaction `complete` — the
    only point at which the data is actually durable. */
export function createIndexedDbBacking(factory: IndexedDbFactory): DurableKeyValueBacking {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    if (dbPromise === null) dbPromise = openDatabase(factory);
    return dbPromise;
  };

  return {
    durability: 'durable',
    locationLabel: 'IndexedDB',

    async getText(key) {
      const database = await db();
      const tx = database.transaction(DURABLE_STORE_NAME, 'readonly');
      const value = await promisifyRequest<unknown>(tx.objectStore(DURABLE_STORE_NAME).get(key));
      return typeof value === 'string' ? value : null;
    },

    async putText(key, value) {
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(DURABLE_STORE_NAME, 'readwrite');
        // `complete` — not the put request's success — is durability.
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        tx.objectStore(DURABLE_STORE_NAME).put(value, key);
      });
    },

    async deleteKey(key) {
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(DURABLE_STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
        tx.objectStore(DURABLE_STORE_NAME).delete(key);
      });
    },

    async listKeys() {
      const database = await db();
      const tx = database.transaction(DURABLE_STORE_NAME, 'readonly');
      const keys = await promisifyRequest<IDBValidKey[]>(
        tx.objectStore(DURABLE_STORE_NAME).getAllKeys(),
      );
      return keys.filter((k): k is string => typeof k === 'string');
    },
  };
}

/**
 * The store the application uses. Pass `backing` in tests; production
 * resolves IndexedDB, and falls back to the honestly-labeled volatile
 * backing when there is none.
 */
export function createBrowserDurableMissionStore(
  backing?: DurableKeyValueBacking,
): DurableMissionStorePort {
  if (backing !== undefined) return createDurableMissionStore(backing);
  const factory = resolveIndexedDb();
  if (factory === null) return createDurableMissionStore(createInMemoryDurableBacking());
  return createDurableMissionStore(createIndexedDbBacking(factory));
}
