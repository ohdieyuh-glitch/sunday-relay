import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { brainAttemptScope } from '../mission/brain/brain-attempt-identity';
import type { BrainRecordDraft } from '../mission/brain/brain-ledger';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from './julius-brain-database';
import { JuliusBrainLedgerPostgresStore } from './julius-brain-ledger-postgres';

/**
 * THE BRAIN LEDGER, ON A REAL POSTGRESQL.
 *
 * `JULIUS_REAL_POSTGRES=1` (or `JULIUS_REAL_INFRA=1`) with `DATABASE_URL`
 * naming a server this may create a throwaway database on; todo otherwise. The
 * Brain is dedicated, so each proof gets its own database rather than a schema
 * inside somebody else's.
 */
const enabled = process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1';
const suite = enabled ? describe : describe.todo;

const NONCE = randomBytes(6).toString('hex');
const PROJECT = `prj-brain-${NONCE}`;
const MISSION = `mission:brain-${NONCE}`;
const RUN = `run:brain-${NONCE}`;
const SCOPE = brainAttemptScope({ runId: RUN, taskId: 'build-1', leaseGeneration: 2 });
const RECORDED_AT = '2026-09-22T10:00:00.000Z';

const draft = (patch: Partial<BrainRecordDraft> = {}): BrainRecordDraft => ({
  domain: 'MISSION_DECISION', kind: 'DECISION', scope: SCOPE, projectId: PROJECT, missionId: MISSION,
  author: 'JULIUS', authorId: 'julius', payload: { statement: 'accept the plan', reasonCode: 'TASK_VERIFIED' },
  evidenceIds: ['evidence:1'], occurredAt: '2026-09-22T09:59:00.000Z', idempotencyKey: `${NONCE}:decision:accept`,
  ...patch,
});

suite('the Project Brain ledger on a real PostgreSQL', () => {
  const database = `jbrain${NONCE}`;
  let admin: Pool | null = null;
  let pool: Pool | null = null;
  let store: JuliusBrainLedgerPostgresStore | null = null;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    await migrateJuliusBrainDatabase(pool, { environment: 'test' });
    store = new JuliusBrainLedgerPostgresStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
  }, 60_000);

  it('is dedicated, identified and current — and says so rather than guessing', async () => {
    const identity = await assertJuliusBrainDatabase(pool!, { environment: 'test' });
    expect(identity).toMatchObject({ environment: 'test', migrations: ['001_julius_brain_truth'] });
    expect(identity.databaseId).toMatch(/^[0-9a-f-]{36}$/u);
    // Development configuration cannot open it, and the reverse.
    await expect(assertJuliusBrainDatabase(pool!, { environment: 'production' })).rejects.toThrow(/julius_brain_database_environment_mismatch:test|not_encrypted/);
    // Migrating again is a no-op, and two processes racing it apply each migration once.
    const again = await Promise.all([migrateJuliusBrainDatabase(pool!, { environment: 'test' }), migrateJuliusBrainDatabase(pool!, { environment: 'test' })]);
    expect(again.map((result) => result.migrations)).toEqual([['001_julius_brain_truth'], ['001_julius_brain_truth']]);
    expect(again[0]!.databaseId).toBe(identity.databaseId);
    // A database holding the Julius runtime schema is not a Brain, and is refused for use.
    await pool!.query('CREATE SCHEMA IF NOT EXISTS relay_wonderland');
    await expect(assertJuliusBrainDatabase(pool!, { environment: 'test' })).rejects.toThrow('julius_brain_database_not_dedicated');
    await expect(migrateJuliusBrainDatabase(pool!, { environment: 'test' })).rejects.toThrow('julius_brain_database_not_dedicated');
    await pool!.query('DROP SCHEMA relay_wonderland');
  }, 60_000);

  it('records a fact, refuses a system that does not own it, and writes nothing when it refuses', async () => {
    const first = await store!.append({ projectId: PROJECT, draft: draft(), recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-1` });
    expect(first).toMatchObject({ outcome: 'APPENDED', record: { sequence: 1, status: 'FACT', previousHash: null } });

    const rendered = await store!.append({ projectId: PROJECT, recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-x`, draft: draft({ author: 'WONDERLAND', authorId: 'wonderland', idempotencyKey: `${NONCE}:rendered` }) });
    expect(rendered).toMatchObject({ outcome: 'REFUSED', reasonCode: 'not_an_author' });
    expect(await store!.records(PROJECT)).toHaveLength(1);

    // A proposal is recorded as a proposal, and is not a fact.
    const proposed = await store!.append({ projectId: PROJECT, recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-2`, draft: draft({ author: 'INDEPENDENT_REVIEWER', authorId: 'reviewer-1', idempotencyKey: `${NONCE}:proposal` }) });
    expect(proposed).toMatchObject({ outcome: 'APPENDED', record: { status: 'PROPOSAL', sequence: 2 } });
  }, 60_000);

  it('replays as a no-op, refuses a different statement under the same key, and keeps Unknown Unknown', async () => {
    const before = await store!.records(PROJECT);
    const replay = await store!.append({ projectId: PROJECT, draft: draft(), recordedAt: '2026-09-22T12:00:00.000Z', recordId: `${NONCE}-rec-replay` });
    expect(replay).toMatchObject({ outcome: 'DUPLICATE', record: { recordId: `${NONCE}-rec-1` } });
    expect(await store!.records(PROJECT)).toHaveLength(before.length);

    const conflict = await store!.append({ projectId: PROJECT, recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-conflict`, draft: draft({ payload: { statement: 'reject', reasonCode: 'BLOCKING_FINDINGS' } }) });
    expect(conflict).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_conflict' });

    // A time nobody stated stays NULL in the column, and reads back as null.
    const untimed = await store!.append({ projectId: PROJECT, recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-3`, draft: draft({ occurredAt: null, idempotencyKey: `${NONCE}:untimed`, kind: 'TRACE' }) });
    expect(untimed).toMatchObject({ outcome: 'APPENDED' });
    const stored = (await store!.records(PROJECT)).find((record) => record.recordId === `${NONCE}-rec-3`)!;
    expect(stored.occurredAt).toBeNull();
    expect(stored.recordedAt).toBe(RECORDED_AT);
  }, 60_000);

  it('concurrent appenders produce one unbroken chain, and it verifies after a cold read', async () => {
    const drafts = Array.from({ length: 8 }, (_, index) => draft({ idempotencyKey: `${NONCE}:concurrent:${index}`, kind: 'TRACE', payload: { statement: `concurrent ${index}` } }));
    const results = await Promise.all(drafts.map((item, index) => store!.append({ projectId: PROJECT, draft: item, recordedAt: RECORDED_AT, recordId: `${NONCE}-con-${index}` })));
    expect(results.every((result) => result.outcome === 'APPENDED')).toBe(true);

    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database}`;
    const cold = new Pool({ connectionString: url.toString(), max: 2 });
    try {
      const coldStore = new JuliusBrainLedgerPostgresStore(cold);
      const records = await coldStore.records(PROJECT);
      // Sequences are dense and unique, and every record follows the one before it.
      expect(records.map((record) => record.sequence)).toEqual(records.map((_, index) => index + 1));
      expect(new Set(records.map((record) => record.hash)).size).toBe(records.length);
      expect(await coldStore.verify(PROJECT)).toEqual({ ok: true, problems: [] });
    } finally {
      await cold.end();
    }
  }, 120_000);

  it('each project has its own history: two projects both have a first record', async () => {
    const other = `${PROJECT}-second`;
    const first = await store!.append({
      projectId: other, recordedAt: RECORDED_AT, recordId: `${NONCE}-other-1`,
      draft: draft({ projectId: other, idempotencyKey: `${NONCE}:other:1`, payload: { statement: 'another project entirely' } }),
    });
    expect(first).toMatchObject({ outcome: 'APPENDED', record: { sequence: 1, previousHash: null } });
    // The other project's ledger is untouched by it, and both verify on their own.
    expect((await store!.records(other)).map((record) => record.projectId)).toEqual([other]);
    expect(await store!.verify(other)).toEqual({ ok: true, problems: [] });
    expect(await store!.verify(PROJECT)).toEqual({ ok: true, problems: [] });
    expect((await store!.records(PROJECT)).some((record) => record.projectId === other)).toBe(false);
  }, 60_000);

  it('the database itself refuses an edit, a delete or a truncate', async () => {
    await expect(pool!.query('UPDATE julius_brain.records SET kind = $1 WHERE project_id = $2', ['TAMPERED', PROJECT])).rejects.toThrow(/julius_brain_immutable: UPDATE/);
    await expect(pool!.query('DELETE FROM julius_brain.records WHERE project_id = $1', [PROJECT])).rejects.toThrow(/julius_brain_immutable: DELETE/);
    await expect(pool!.query('TRUNCATE julius_brain.records')).rejects.toThrow(/julius_brain_immutable: TRUNCATE/);
    await expect(pool!.query("UPDATE julius_brain.database_identity SET environment = 'production'")).rejects.toThrow(/julius_brain_immutable: UPDATE/);
    // And the ledger still verifies afterwards.
    expect(await store!.verify(PROJECT)).toEqual({ ok: true, problems: [] });
  }, 60_000);

  it('truth changes by superseding: the older record stays, and both are still in the chain', async () => {
    const original = (await store!.records(PROJECT)).find((record) => record.idempotencyKey === `${NONCE}:decision:accept`)!;
    const revised = await store!.append({
      projectId: PROJECT, recordedAt: RECORDED_AT, recordId: `${NONCE}-rec-revised`,
      draft: draft({ idempotencyKey: `${NONCE}:decision:revised`, payload: { statement: 'repair first', reasonCode: 'BLOCKING_FINDINGS' }, supersedes: original.recordId }),
    });
    expect(revised).toMatchObject({ outcome: 'APPENDED', record: { supersedes: original.recordId } });
    const records = await store!.records(PROJECT);
    expect(records.find((record) => record.recordId === original.recordId)).toMatchObject({ payload: { statement: 'accept the plan' } });
    expect(await store!.verify(PROJECT)).toEqual({ ok: true, problems: [] });
  }, 60_000);
});
