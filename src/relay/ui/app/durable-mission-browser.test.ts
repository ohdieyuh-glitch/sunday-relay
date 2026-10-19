/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DURABLE_INDEX_KEY,
  createBrowserDurableMissionStore,
  createIndexedDbBacking,
  readDurableIndex,
  writeDurableIndex,
} from './durable-mission-browser-store';
import {
  DURABLE_MISSION_SCHEMA_VERSION,
  createDurableMissionStore,
  createInMemoryDurableBacking,
  type DurableKeyValueBacking,
  type DurableMissionRecordDraft,
} from '../../mission/durable';

/**
 * The BROWSER durable-mission adapter.
 *
 * jsdom ships no IndexedDB and this repository installs no polyfill, so the
 * IndexedDB code path is exercised against a small faithful fake of the
 * pieces the adapter actually uses (open → upgrade → transaction →
 * `complete`), and the rest of the behaviour is proven through the shared
 * port. That is the same shape the repository already uses for storage:
 * declare a port, inject the backing, test both implementations against it.
 */

afterEach(() => {
  window.localStorage.clear();
});

const NOW = '2026-08-01T10:00:00.000Z';

function draft(overrides: Partial<DurableMissionRecordDraft> = {}): DurableMissionRecordDraft {
  return {
    schemaVersion: DURABLE_MISSION_SCHEMA_VERSION,
    missionId: 'mission-b1',
    projectId: 'rly-004',
    missionContractRef: 'rly-004:mission-b1',
    missionContractRevision: 'r1',
    assignments: [],
    missionState: 'coding',
    stage: 'coding_agent_working',
    currentTaskRef: null,
    lastCompletedAction: null,
    inFlightAction: null,
    evidence: {
      filesReportedChanged: [],
      commandsReported: [],
      testStatus: 'not_run',
      evidenceRefs: [],
      traceLedgerRefs: [],
      executionCapsuleRefs: [],
      findingRefs: [],
      repairRefs: [],
      handoffRefs: [],
      approvalRefs: [],
    },
    usage: {
      costReceiptRefs: [],
      knownCostMicros: null,
      currency: null,
      budgetStatus: null,
      usageProvenance: 'offline',
    },
    interruptionReason: null,
    provenance: 'offline',
    createdAt: NOW,
    updatedAt: NOW,
    checkpointReason: 'mission_execution_began',
    checkpointAt: NOW,
    recoveryGeneration: 0,
    owner: null,
    ...overrides,
  };
}

/* ------------------------------------------------- a faithful IDB fake */

/** Minimal IndexedDB stand-in: enough of the real event flow that the
    adapter's `complete`-means-durable contract is genuinely exercised. */
function createFakeIndexedDb() {
  const data = new Map<string, string>();
  const settle = (fn: () => void): void => { queueMicrotask(fn); };

  const objectStore = {
    get(key: string) {
      const request: Record<string, unknown> = { result: data.get(key) ?? undefined, error: null };
      settle(() => (request.onsuccess as (() => void) | undefined)?.());
      return request as unknown as IDBRequest<unknown>;
    },
    put(value: string, key: string) {
      data.set(key, value);
      return {} as IDBRequest<IDBValidKey>;
    },
    delete(key: string) {
      data.delete(key);
      return {} as IDBRequest<undefined>;
    },
    getAllKeys() {
      const request: Record<string, unknown> = { result: [...data.keys()], error: null };
      settle(() => (request.onsuccess as (() => void) | undefined)?.());
      return request as unknown as IDBRequest<IDBValidKey[]>;
    },
  };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    transaction() {
      const tx: Record<string, unknown> = { error: null, objectStore: () => objectStore };
      settle(() => (tx.oncomplete as (() => void) | undefined)?.());
      return tx as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  return {
    data,
    factory: {
      open() {
        const request: Record<string, unknown> = { result: db, error: null };
        settle(() => (request.onsuccess as (() => void) | undefined)?.());
        return request as unknown as IDBOpenDBRequest;
      },
    },
  };
}

/* ------------------------------------------------------------- tests */

describe('browser durable-mission store', () => {
  it('round-trips a record through the IndexedDB backing', async () => {
    const fake = createFakeIndexedDb();
    const store = createDurableMissionStore(createIndexedDbBacking(fake.factory));
    expect(store.durability).toBe('durable');
    expect(store.locationLabel).toBe('IndexedDB');
    const written = await store.write(draft());
    expect(written.ok).toBe(true);
    const read = await store.read('mission-b1');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('record must be readable');
    expect(read.record.missionId).toBe('mission-b1');
  });

  it('SURVIVES AN APPLICATION REMOUNT — a new store instance reads the same bytes', async () => {
    const fake = createFakeIndexedDb();
    const first = createDurableMissionStore(createIndexedDbBacking(fake.factory));
    await first.write(draft({ stage: 'before-remount' }));

    // A remount builds an entirely new store over the same storage.
    const second = createDurableMissionStore(createIndexedDbBacking(fake.factory));
    const read = await second.read('mission-b1');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('the record must survive a remount');
    expect(read.record.stage).toBe('before-remount');
  });

  it('lists and removes records', async () => {
    const fake = createFakeIndexedDb();
    const store = createDurableMissionStore(createIndexedDbBacking(fake.factory));
    await store.write(draft());
    await store.write(draft({ missionId: 'mission-b2' }));
    expect([...(await store.list())].sort()).toEqual(['mission-b1', 'mission-b2']);
    await store.remove('mission-b1');
    expect(await store.list()).toEqual(['mission-b2']);
  });

  it('falls back to an HONESTLY LABELED volatile store when IndexedDB is absent', () => {
    // jsdom has no indexedDB — exactly the production private-mode case.
    const store = createBrowserDurableMissionStore();
    expect(store.durability).toBe('volatile-test-only');
    expect(store.locationLabel).toContain('not durable');
  });

  it('a write failure reports failure rather than claiming a save', async () => {
    const failing: DurableKeyValueBacking = {
      durability: 'durable',
      locationLabel: 'IndexedDB',
      async getText() { return null; },
      async putText() { throw new Error('QuotaExceededError'); },
      async deleteKey() { /* no-op */ },
      async listKeys() { return []; },
    };
    const store = createDurableMissionStore(failing);
    const result = await store.write(draft());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('a failed write must not report success');
    expect(result.reason).toContain('Quota');
  });
});

describe('the localStorage hint index', () => {
  it('holds only mission ids and checkpoint times — never the record', () => {
    writeDurableIndex([{ missionId: 'mission-b1', checkpointAt: NOW }]);
    const raw = window.localStorage.getItem(DURABLE_INDEX_KEY) ?? '';
    expect(raw).toContain('mission-b1');
    // The whole record — evidence, assignments, usage — is NOT in localStorage.
    expect(raw).not.toContain('evidence');
    expect(raw).not.toContain('assignments');
    expect(raw).not.toContain('checksum');
    expect(raw.length).toBeLessThan(200);
  });

  it('reads back what it wrote, and treats a broken hint as no hint', () => {
    writeDurableIndex([{ missionId: 'mission-b1', checkpointAt: NOW }]);
    expect(readDurableIndex()).toEqual([{ missionId: 'mission-b1', checkpointAt: NOW }]);
    window.localStorage.setItem(DURABLE_INDEX_KEY, '{ not json');
    expect(readDurableIndex()).toEqual([]);
    window.localStorage.setItem(DURABLE_INDEX_KEY, JSON.stringify([{ nope: true }]));
    expect(readDurableIndex()).toEqual([]);
  });

  it('survives storage being denied', () => {
    const denied = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    } as unknown as Storage;
    expect(readDurableIndex(denied)).toEqual([]);
    expect(() => writeDurableIndex([{ missionId: 'x', checkpointAt: NOW }], denied)).not.toThrow();
  });
});

describe('port conformance', () => {
  it('the in-memory and IndexedDB backings behave identically through the port', async () => {
    const fake = createFakeIndexedDb();
    const stores = [
      createDurableMissionStore(createInMemoryDurableBacking()),
      createDurableMissionStore(createIndexedDbBacking(fake.factory)),
    ];
    for (const store of stores) {
      expect((await store.read('missing')).ok).toBe(false);
      const written = await store.write(draft());
      expect(written.ok).toBe(true);
      const read = await store.read('mission-b1');
      expect(read.ok).toBe(true);
      if (!read.ok || !written.ok) throw new Error('both backings must round-trip');
      expect(read.record.checksum).toBe(written.record.checksum);
    }
  });
});
