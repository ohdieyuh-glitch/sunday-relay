import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { juliusPrincipal, juliusWorkerPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from '../src/relay/mission/julius/julius-brain-store';
import { LocalJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { BRAIN_DRILL, steppingClock, summariseBrain, writeBrainScenario } from './julius-project-brain-drill';

/**
 * THE PROJECT BRAIN, AGAINST A REAL POSTGRESQL.
 *
 * Env-gated like every real-infrastructure proof here — `JULIUS_REAL_POSTGRES=1`
 * with `DATABASE_URL` — and written as a guarded suite so a disabled run is
 * reported as todo, never as a pass. Every test takes a fresh database, so the
 * suite can share a server with other work without touching its data.
 *
 * `JULIUS_BRAIN_DRILL_RESTART` (for example `docker restart <container>`)
 * additionally restarts the PostgreSQL SERVER between the writing and the
 * reading process; the drill only claims a server restart it observed.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const run = promisify(execFile);

async function freshDatabase(label: string): Promise<string> {
  const name = `jbrain${label}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function migrated(url: string): Promise<Pool> {
  const pool = new Pool({ connectionString: url, max: 16 });
  await migrateJuliusBrainDatabase(pool, { environment: 'test' });
  return pool;
}

const JULIUS = juliusPrincipal('JULIUS', 'julius');
const CODER = juliusWorkerPrincipal('coder-1', 'CODING_AGENT');

suite('Project Brain on a real PostgreSQL', () => {
  it('migrates once, and migrating again applies nothing', async () => {
    const pool = await migrated(await freshDatabase('mig'));
    try {
      const again = await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      expect(again.applied).toEqual([]);
      expect(again.migrations).toEqual(['001_julius_brain_ledger', '002_julius_brain_python_executions', '003_julius_brain_content', '004_julius_brain_immutability']);
      expect((await assertJuliusBrainDatabase(pool, { environment: 'test' })).databaseId).toBe(again.databaseId);
    } finally { await pool.end(); }
  }, 120_000);

  it('produces exactly the records and state the in-memory model produces', async () => {
    const pool = await migrated(await freshDatabase('parity'));
    const cas = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jbrain-cas-')));
    try {
      const postgres = new JuliusBrainPostgresStore(pool);
      const memory = createJuliusBrainMemoryStore();
      await writeBrainScenario(createJuliusProjectBrainService({ store: postgres, clock: steppingClock() }), cas);
      await writeBrainScenario(createJuliusProjectBrainService({ store: memory, clock: steppingClock() }), cas);
      const { brainId, projectId } = BRAIN_DRILL;
      expect(await readAllJuliusBrainRecords(postgres, brainId, projectId)).toEqual(await readAllJuliusBrainRecords(memory, brainId, projectId));
      expect(await readAllJuliusBrainEntities(postgres, brainId, projectId)).toEqual(await readAllJuliusBrainEntities(memory, brainId, projectId));
      const summary = await summariseBrain(postgres, cas);
      expect(summary.ledgerVerified).toBe(true);
      expect({ ...summary, pid: 0 }).toEqual({ ...(await summariseBrain(memory, cas)), pid: 0 });
    } finally { await pool.end(); }
  }, 120_000);

  it('serialises contention: gap-free sequences, one winner per version, one record per key', async () => {
    const pool = await migrated(await freshDatabase('race'));
    try {
      const store = new JuliusBrainPostgresStore(pool);
      const service = createJuliusProjectBrainService({ store, clock: steppingClock() });
      const { brainId, projectId, missionId } = BRAIN_DRILL;
      await service.initialize({ brainId, projectId, title: 'race', principal: JULIUS });
      const julius = (await service.open({ brainId, projectId, principal: JULIUS }))!;
      const coder = (await service.open({ brainId, projectId, principal: CODER }))!;
      const scope = { missionId };

      const creates = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        julius.create('CONSTRAINT', { statement: `constraint ${i}`, status: 'ACTIVE' }, { key: `c${i}`, scope })));
      expect(creates.every((result) => result.outcome === 'COMMITTED')).toBe(true);
      expect(creates.map((result) => result.outcome === 'COMMITTED' ? result.receipts[0]!.sequence : 0).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      const target = creates[0]!.outcome === 'COMMITTED' ? creates[0]!.receipts[0]!.entityId : '';
      const revisions = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        julius.revise(target, { statement: `revision ${i}`, status: 'ACTIVE' }, { key: `r${i}`, expectedVersion: 1 })));
      expect(revisions.filter((result) => result.outcome === 'COMMITTED')).toHaveLength(1);
      expect(revisions.filter((result) => result.outcome === 'REFUSED' && result.reasonCode === 'version_conflict')).toHaveLength(7);

      const evidenceBody = { evidenceClass: 'OBSERVATION', claim: 'same', summary: 'same', status: 'PASSED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null };
      const replays = await Promise.all(Array.from({ length: 8 }, () =>
        coder.create('EVIDENCE', evidenceBody, { key: 'shared-key', scope, occurredAt: '2026-09-13T09:30:00.000Z' })));
      const receipts = replays.map((result) => result.outcome === 'COMMITTED' ? result.receipts[0]!.outcome : result.reasonCode);
      expect(receipts.filter((outcome) => outcome === 'APPENDED')).toHaveLength(1);
      expect(receipts.filter((outcome) => outcome === 'DUPLICATE')).toHaveLength(7);

      const count = await pool.query('SELECT count(*)::int AS n FROM julius_brain.records WHERE brain_id=$1', [brainId]);
      expect(count.rows[0].n).toBe(10);
      expect((await julius.verify()).ok).toBe(true);
    } finally { await pool.end(); }
  }, 120_000);

  it('a refused batch leaves no row behind', async () => {
    const pool = await migrated(await freshDatabase('atomic'));
    try {
      const store = new JuliusBrainPostgresStore(pool);
      const service = createJuliusProjectBrainService({ store, clock: steppingClock() });
      const { brainId, projectId, missionId } = BRAIN_DRILL;
      await service.initialize({ brainId, projectId, title: 'atomic', principal: JULIUS });
      const julius = (await service.open({ brainId, projectId, principal: JULIUS }))!;
      const result = await julius.commit([
        julius.draft('CONSTRAINT', { statement: 'kept?', status: 'ACTIVE' }, { key: 'a', scope: { missionId } }),
        julius.draft('CONSTRAINT', { statement: 'token=abcdefghijklmnop', status: 'ACTIVE' }, { key: 'b', scope: { missionId } }),
      ]);
      expect(result).toMatchObject({ outcome: 'REFUSED', index: 1, reasonCode: 'credential_shaped_content' });
      for (const table of ['records', 'entities', 'links']) {
        expect((await pool.query(`SELECT count(*)::int AS n FROM julius_brain.${table}`)).rows[0].n, table).toBe(0);
      }
      expect(await store.head(brainId, projectId)).toMatchObject({ sequence: 0 });
    } finally { await pool.end(); }
  }, 120_000);

  it('restores a ledger into a fresh database with identical state, and refuses to overwrite', async () => {
    const source = await migrated(await freshDatabase('src'));
    const target = await migrated(await freshDatabase('dst'));
    const cas = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jbrain-cas-')));
    try {
      const from = new JuliusBrainPostgresStore(source);
      const to = new JuliusBrainPostgresStore(target);
      await writeBrainScenario(createJuliusProjectBrainService({ store: from, clock: steppingClock() }), cas);
      const { brainId, projectId } = BRAIN_DRILL;
      const identity = (await from.loadBrain(brainId, projectId))!;
      const records = await readAllJuliusBrainRecords(from, brainId, projectId);
      expect(await to.restore(identity, records)).toMatchObject({ outcome: 'RESTORED' });
      expect(await to.restore(identity, records)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'brain_exists' });
      expect(await readAllJuliusBrainEntities(to, brainId, projectId)).toEqual(await readAllJuliusBrainEntities(from, brainId, projectId));
      expect(await to.head(brainId, projectId)).toEqual(await from.head(brainId, projectId));
    } finally { await source.end(); await target.end(); }
  }, 120_000);

  it('process A writes and exits; process B reconstructs the same Brain, provenance and artifacts', async () => {
    const url = await freshDatabase('drill');
    // The npm script builds the drill and runs it, as the other drills' tests do.
    const out = await run('npm', ['run', '--silent', 'julius:brain:drill'], {
      env: { ...process.env, JULIUS_BRAIN_DATABASE_URL: url }, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32',
    }).catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`drill failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); });
    expect(out.stdout).toContain('JULIUS PROJECT BRAIN DURABILITY VERIFIED');
    const report = JSON.parse(out.stdout.slice(0, out.stdout.lastIndexOf('JULIUS PROJECT BRAIN')));
    expect(report.checks).toMatchObject({
      separateProcesses: true, identicalReconstruction: true, ledgerVerified: true, checkpointRederived: true,
      artifactsResolve: true, supersessionPreserved: true, repairProvenance: true,
    });
    if (process.env.JULIUS_BRAIN_DRILL_RESTART) {
      expect(report.restart).toBe('POSTGRESQL SERVER RESTART');
      expect(report.checks.serverRestarted).toBe(true);
    } else {
      expect(report.restart).toBe('PROCESS RESTART ONLY');
    }
    expect(report.read.recordCount).toBeGreaterThanOrEqual(26);
  }, 900_000);
});
