import { describe, expect, it } from 'vitest';

import { WFS_STORE_CASES, type WfsStoreHarness } from '../persistence/wonderfs-store-conformance';
import { openWfsMemoryStore, wfsMemoryBacking } from './wonderfs-memory-store';
import { WFS_MAIN_BRANCH, type WfsPrincipal } from './index';

/**
 * THE WONDERFS STORE CONTRACT ON THE IN-MEMORY STORE (R0b). The same cases (persistence/wonderfs-store-conformance.ts) run against
 * real PostgreSQL in wonderfs-postgres.real-postgres.test.ts (CI); here they run every time, over the memory store the bridge's
 * handler tests and the dev server use. Each case gets a fresh backing; `open()` twice is two "bridges" over it.
 */

function memoryHarness(): WfsStoreHarness {
  const backing = wfsMemoryBacking();
  const admin = openWfsMemoryStore({ backing });
  return {
    open: (options = {}) => openWfsMemoryStore({ backing, ...options }),
    seed: async (projectId, members) => admin.seedProject(projectId, members),
    setRole: async (projectId, playerId, productRole) => admin.setMemberRole(projectId, playerId, productRole),
  };
}

const NOW = '2026-10-12T09:00:00.000Z';
const owner: WfsPrincipal = { kind: 'human', id: 'usr_owner', onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null };

describe('the WonderFS store contract on the IN-MEMORY store (the same cases run on real PostgreSQL in CI)', () => {
  for (const c of WFS_STORE_CASES) it(c.name, () => c.run(memoryHarness()), 120_000);
});

describe('the in-memory store itself', () => {
  it('two stores over one backing are two bridges over one database: a change through one is read through the other', async () => {
    const backing = wfsMemoryBacking();
    const one = openWfsMemoryStore({ backing });
    const two = openWfsMemoryStore({ backing });
    one.seedProject('prj-1', { usr_owner: 'OWNER' });
    expect((await one.createProject('prj-1', NOW)).ok).toBe(true);
    const r = await two.commit('prj-1', { requestId: 'req-mem-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW);
    expect(r.ok && r.value.status).toBe('committed');
    const head = await one.head('prj-1');
    expect(head.ok && head.value.main.headRev).toBe(1);
    // CONTROL: a store over ANOTHER backing sees none of it
    const elsewhere = openWfsMemoryStore();
    expect((await elsewhere.head('prj-1')).ok).toBe(false);
  });

  it('hands out copies: a caller editing an event body or a blob it read changes nothing stored', async () => {
    const store = openWfsMemoryStore();
    store.seedProject('prj-1', { usr_owner: 'OWNER' });
    await store.createProject('prj-1', NOW);
    const put = await store.putBlob('prj-1', new TextEncoder().encode('bytes'));
    if (!put.ok) throw new Error(put.error.message);
    await store.commit('prj-1', { requestId: 'req-mem-0002', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'b.txt', kind: 'file', ...put.value }] }, NOW);
    const events = await store.events('prj-1', { afterSeq: 0 });
    if (!events.ok) throw new Error(events.error.message);
    (events.value.events[0].body as Record<string, unknown>).rev = 99;
    const read = await store.readBlob('prj-1', put.value.sha256);
    read![0] = 0;
    const again = await store.events('prj-1', { afterSeq: 0 });
    expect(again.ok && again.value.events[0].body).toEqual({ branchId: WFS_MAIN_BRANCH, rev: 1, commitId: expect.any(String) });
    const verify = await store.verifyBlob('prj-1', put.value.sha256);
    expect(verify.ok && verify.value).toEqual({ status: 'intact', size: 5 });
  });

  it('a member role is written as the PRODUCT stores it; removing it from an unknown project is a programming error, loudly', () => {
    const store = openWfsMemoryStore();
    expect(() => store.setMemberRole('prj-unknown', 'usr_owner', 'OWNER')).toThrow(/no product project/u);
  });
});
