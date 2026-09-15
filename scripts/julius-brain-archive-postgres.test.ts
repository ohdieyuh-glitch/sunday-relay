import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, juliusArchiveEntityId, planJuliusPaidRunArchiveImport } from '../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { selectJuliusBrainEntitiesForMode } from '../src/relay/mission/julius/julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from '../src/relay/mission/julius/julius-brain-store';
import { LocalJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';

/**
 * THE ARCHIVE IMPORT, ON A REAL POSTGRESQL. `JULIUS_REAL_POSTGRES=1` with
 * `DATABASE_URL`; todo otherwise. Each test takes a fresh database.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;

const BRAIN = 'brain:julius';
const PROJECT = 'prj-julius-live-4';
const JULIUS = juliusPrincipal('JULIUS', 'julius');

async function freshDatabase(label: string): Promise<string> {
  const name = `jbarch${label}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function prepared(url: string, max = 8) {
  const pool = new Pool({ connectionString: url, max });
  await new TransactionalWonderlandDatabase(pool).migrate();
  await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [PROJECT]);
  const store = new JuliusBrainPostgresStore(pool);
  await createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T10:00:00.000Z' } }).initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  return { pool, store };
}

suite('the paid-run archive import on a real PostgreSQL', () => {
  it('writes exactly what the in-memory model writes, and a cold connection selects the same under every mode', async () => {
    const url = await freshDatabase('parity');
    const { pool, store } = await prepared(url);
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jbarch-cas-')));
    try {
      const memory = createJuliusBrainMemoryStore();
      await createJuliusProjectBrainService({ store: memory, clock: { now: () => '2026-09-15T10:00:00.000Z' } }).initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
      const archive = paidRunArchive();
      const onPostgres = await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: '2026-09-15T10:00:00.000Z' });
      const inMemory = await importJuliusPaidRunArchive({ store: memory, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: '2026-09-15T10:00:00.000Z' });
      expect(onPostgres).toEqual(inMemory);
      expect(await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainRecords(memory, BRAIN, PROJECT));
    } finally { await pool.end(); }

    // A cold pool, as a restarted process would open.
    const cold = new Pool({ connectionString: url, max: 2 });
    try {
      const entities = await readAllJuliusBrainEntities(new JuliusBrainPostgresStore(cold), BRAIN, PROJECT);
      const fresh = selectJuliusBrainEntitiesForMode(entities, { mode: 'FRESH', missionId: 'mission:julius-live-4', runId: 'run:julius-live-4:now' });
      const learning = selectJuliusBrainEntitiesForMode(entities, { mode: 'LEARNING', missionId: 'mission:julius-live-4', runId: 'run:julius-live-4:now', learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } });
      expect(fresh).toMatchObject({ outcome: 'SELECTED', admitted: [] });
      expect(learning.outcome === 'SELECTED' && learning.admitted.map((item) => item.entity.kind)).toEqual(['FINDING']);
      expect((await new JuliusBrainPostgresStore(cold).head(BRAIN, PROJECT))!.sequence).toBe(entities.length);
    } finally { await cold.end(); }
  }, 180_000);

  it('concurrent imports of one archive from separate connections: one import, the rest already imported, no duplicate rows', async () => {
    const url = await freshDatabase('race');
    const { pool } = await prepared(url, 2);
    await pool.end();
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jbarch-race-')));
    const archive = paidRunArchive();
    const pools = Array.from({ length: 6 }, () => new Pool({ connectionString: url, max: 1 }));
    try {
      const results = await Promise.all(pools.map((racer) => importJuliusPaidRunArchive({
        store: new JuliusBrainPostgresStore(racer), brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: '2026-09-15T10:00:00.000Z',
      })));
      expect(results.map((result) => result.outcome).sort()).toEqual(['ALREADY_IMPORTED', 'ALREADY_IMPORTED', 'ALREADY_IMPORTED', 'ALREADY_IMPORTED', 'ALREADY_IMPORTED', 'IMPORTED']);
      const stored = await pools[0]!.query('SELECT count(*)::int AS n FROM relay_wonderland.julius_brain_records WHERE brain_id=$1', [BRAIN]);
      const planned = planJuliusPaidRunArchiveImport(archive, { contentHash: `sha256:${'0'.repeat(64)}`, byteSize: 1, storageRef: 'x' }).drafts.length;
      expect(stored.rows[0].n).toBe(planned);
    } finally { await Promise.all(pools.map((racer) => racer.end())); }
  }, 180_000);

  it('an archive spanning several commit groups arrives whole or not at all', async () => {
    const url = await freshDatabase('large');
    const { pool, store } = await prepared(url, 2);
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jbarch-large-')));
    // 1,200 more timeline events: well past one 400-draft group.
    const large = (attempt: number) => paidRunArchive({ attempt, mutate: (body) => ({
      ...body,
      events: [...body.events, ...Array.from({ length: 1_200 }, (_, i) => ({ sequence: 5 + i, eventType: 'tool.progress', taskId: 'build-1', occurredAt: body.events[3]!.occurredAt, facts: { step: i } }))],
    }) });
    try {
      const first = large(1);
      const planned = planJuliusPaidRunArchiveImport(first, { contentHash: `sha256:${'0'.repeat(64)}`, byteSize: 1, storageRef: 'x' }).drafts.length;
      expect(planned).toBeGreaterThan(1_200);
      // Something already holds the id of the LAST event, so the refusal lands in the final group.
      const julius = (await createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T10:00:00.000Z' } }).open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
      await julius.create('CONSTRAINT', { statement: 'squatting', status: 'ACTIVE' }, { key: 'squat', entityId: juliusArchiveEntityId(first.run, 'events', '1204') });
      const head = await store.head(BRAIN, PROJECT);
      const refused = await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: first, content, recordedAt: '2026-09-15T10:00:00.000Z' });
      expect(refused).toMatchObject({ outcome: 'REFUSED', reasonCode: 'entity_already_exists' });
      expect((refused as { group: number }).group).toBeGreaterThan(0);
      expect(await store.head(BRAIN, PROJECT)).toEqual(head);
      const count = async () => (await pool.query('SELECT count(*)::int AS n FROM relay_wonderland.julius_brain_records WHERE brain_id=$1', [BRAIN])).rows[0].n as number;
      expect(await count()).toBe(head!.sequence);

      // The next attempt holds no conflicting id, and every one of its records lands.
      const second = await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: large(2), content, recordedAt: '2026-09-15T10:00:00.000Z' });
      expect(second).toMatchObject({ outcome: 'IMPORTED', appended: planned, duplicates: 0 });
      expect(await count()).toBe(head!.sequence + planned);
    } finally { await pool.end(); }
  }, 300_000);
});
