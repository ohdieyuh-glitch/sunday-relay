import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, type JuliusPaidRunArchiveExport } from '../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { LIVE_ATTEMPT_ALL_ENTRIES, writeLiveAttempt } from '../src/relay/mission/julius/julius-brain-live-attempt-fixtures';
import { verifyJuliusBrainLedger } from '../src/relay/mission/julius/julius-brain-projection';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainStore } from '../src/relay/mission/julius/julius-brain-store';
import { migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';

/**
 * ARCHIVE RECOVERY ON A REAL POSTGRESQL, WHEN THINGS GO WRONG.
 *
 *   - two recoveries of one attempt from separate pools at once;
 *   - the committing backend killed mid-transaction, after some records were
 *     inserted: nothing of the import survives, and a cold retry imports exactly
 *     what a clean import would;
 *   - with JULIUS_BRAIN_DRILL_RESTART set, the server itself is restarted between
 *     the crash and the retry (run this file alone: it restarts the server).
 *
 * `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL`; todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const ATTEMPT = 'workflow:34739303313/1';
const NOW = '2026-09-15T12:00:00.000Z';
const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
const quiet = (pool: Pool) => { pool.on('error', () => undefined); return pool; };

async function freshDatabase(label: string): Promise<string> {
  const name = `jbrecov${label}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

/** A Brain whose attempt 1 was half mirrored live before its runner went away. */
async function halfPreserved(store: JuliusBrainStore) {
  const service = createJuliusProjectBrainService({ store, clock: { now: () => NOW } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  await writeLiveAttempt(julius, ATTEMPT, { entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2) });
}
const importInto = (store: JuliusBrainStore, archive: JuliusPaidRunArchiveExport = paidRunArchive()) =>
  importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: NOW });

/**
 * What the store sees as its pool: reads pass straight through; the transaction
 * connection is killed from outside at its Nth record insert, as a crashed
 * process or a dropped server would kill it.
 */
function killedAtInsert(url: string, admin: Pool, insert: number) {
  const pool = quiet(new Pool({ connectionString: url, max: 2 }));
  let inserts = 0;
  let killed = false;
  const facade = {
    query: (...args: unknown[]) => (pool.query as (...a: unknown[]) => Promise<unknown>)(...args),
    connect: async (): Promise<PoolClient> => {
      const client = await pool.connect();
      client.on('error', () => undefined);
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      return Object.assign(Object.create(client) as PoolClient, {
        query: async (...args: unknown[]) => {
          if (typeof args[0] === 'string' && args[0].includes('INSERT INTO julius_brain.records') && (inserts += 1) === insert) {
            await admin.query('SELECT pg_terminate_backend($1)', [pid]);
            killed = true;
          }
          return query(...args);
        },
        release: (error?: Error | boolean) => client.release(error),
      });
    },
  };
  return { store: new JuliusBrainPostgresStore(facade as unknown as Pool), killed: () => killed, end: () => pool.end() };
}

suite('archive recovery on a real PostgreSQL, under crashes and races', () => {
  it('two recoveries of one attempt from separate pools at once: one imports, one finds it imported, one history', async () => {
    const url = await freshDatabase('race');
    const setup = new Pool({ connectionString: url, max: 2 });
    await migrateJuliusBrainDatabase(setup, { environment: 'test' });
    await halfPreserved(new JuliusBrainPostgresStore(setup));
    const pools = [new Pool({ connectionString: url, max: 2 }), new Pool({ connectionString: url, max: 2 })];
    try {
      const results = await Promise.all(pools.map((pool) => importInto(new JuliusBrainPostgresStore(pool), JSON.parse(JSON.stringify(paidRunArchive())))));
      expect(results.map((result) => result.outcome).sort()).toEqual(['ALREADY_IMPORTED', 'IMPORTED']);
      const store = new JuliusBrainPostgresStore(setup);
      const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
      const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
      expect(entities.filter((state) => state.body.traceClass === 'RECOVERY')).toHaveLength(1);
      expect(verifyJuliusBrainLedger(BRAIN, records).ok).toBe(true);
      // Exactly the history one import writes, in memory, from the same start.
      const memory = createJuliusBrainMemoryStore();
      await halfPreserved(memory);
      expect((await importInto(memory)).outcome).toBe('IMPORTED');
      expect(records).toEqual(await readAllJuliusBrainRecords(memory, BRAIN, PROJECT));
    } finally {
      await Promise.all([...pools, setup].map((pool) => pool.end()));
    }
  }, 60_000);

  it('the committing backend killed mid-transaction: nothing of the import survives; a cold retry (after a server restart when configured) imports exactly once', async () => {
    const url = await freshDatabase('crash');
    const admin = quiet(new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }));
    const setup = new Pool({ connectionString: url, max: 2 });
    await migrateJuliusBrainDatabase(setup, { environment: 'test' });
    await halfPreserved(new JuliusBrainPostgresStore(setup));
    const before = await new JuliusBrainPostgresStore(setup).head(BRAIN, PROJECT);
    const beforeCounts = (await setup.query<{ records: string; entities: string; links: string }>('SELECT (SELECT count(*) FROM julius_brain.records) AS records, (SELECT count(*) FROM julius_brain.entities) AS entities, (SELECT count(*) FROM julius_brain.links) AS links')).rows[0];
    await setup.end();

    const crashing = killedAtInsert(url, admin, 12);
    await expect(importInto(crashing.store)).rejects.toThrow();
    expect(crashing.killed()).toBe(true);
    await crashing.end().catch(() => undefined);

    let restarted = false;
    if ((process.env.JULIUS_BRAIN_DRILL_RESTART ?? '') !== '') {
      const startedBefore = (await admin.query<{ at: string }>('SELECT pg_postmaster_start_time()::text AS at')).rows[0]!.at;
      await admin.end();
      execSync(process.env.JULIUS_BRAIN_DRILL_RESTART!, { stdio: 'ignore' });
      for (let tries = 0; ; tries += 1) {
        const probe = quiet(new Pool({ connectionString: url, max: 1 }));
        try {
          const at = (await probe.query<{ at: string }>('SELECT pg_postmaster_start_time()::text AS at')).rows[0]!.at;
          restarted = at !== startedBefore;
          break;
        } catch (error) {
          if (tries > 60) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        } finally { await probe.end().catch(() => undefined); }
      }
      expect(restarted).toBe(true);
    } else {
      await admin.end();
    }

    // Cold: a new pool, as a new process would open.
    const cold = new Pool({ connectionString: url, max: 2 });
    try {
      const store = new JuliusBrainPostgresStore(cold);
      expect(await store.head(BRAIN, PROJECT)).toEqual(before);
      const afterCrash = (await cold.query('SELECT (SELECT count(*) FROM julius_brain.records) AS records, (SELECT count(*) FROM julius_brain.entities) AS entities, (SELECT count(*) FROM julius_brain.links) AS links')).rows[0];
      expect(afterCrash).toEqual(beforeCounts);
      expect((await cold.query("SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'")).rows[0]).toEqual({ open: 0 });

      expect(await importInto(store)).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED' } });
      expect(await importInto(store)).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0 });
      const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
      expect(verifyJuliusBrainLedger(BRAIN, records).ok).toBe(true);
      const memory = createJuliusBrainMemoryStore();
      await halfPreserved(memory);
      await importInto(memory);
      expect(records).toEqual(await readAllJuliusBrainRecords(memory, BRAIN, PROJECT));
      process.stdout.write(`[recovery-postgres] killed at insert 12; retry ${restarted ? 'after a verified server restart' : 'from a cold pool (no server restart configured)'}\n`);
    } finally {
      await cold.end();
    }
  }, 120_000);
});
