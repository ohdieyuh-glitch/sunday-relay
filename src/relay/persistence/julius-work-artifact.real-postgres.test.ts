import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { JuliusPostgresRepository } from './julius-postgres';
import { JuliusWorkArtifactPostgresRepository } from './julius-work-artifact-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JuliusWorkArtifactConflict, juliusWorkArtifactId, type JuliusTask, type JuliusWorkArtifactRecord, type JuliusWorkArtifactScope } from '../mission/julius';
import { createJuliusDurableArtifacts } from '../../../relay-bridge/julius/durable-artifacts';
import { LocalJuliusArtifactStore } from '../workspace/julius-tools/local-artifact-store';

/**
 * THE RECORD OF WHICH BODY BELONGS TO WHICH ATTEMPT, ON THE REAL SCHEMA (PR 12).
 *
 * PR 12 puts `JuliusWorkArtifactPostgresRepository` on every live dispatch: it is
 * the row a later process reads to find a body, and the only thing that makes an
 * artifact reference resolve after a restart. Until this suite it had never
 * touched PostgreSQL on any branch (the PR286 review's P1-1). These hold its
 * rules against the SQL production runs:
 *   - a row is written once and read back by its exact attempt;
 *   - the same bytes again are a replay, not a second row;
 *   - different bytes under a used id are refused by name, and the first record stands;
 *   - another project reads nothing;
 *   - the database itself refuses a row whose run or task does not exist;
 *   - two attempts of one task hold two rows;
 *   - a SEPARATE OS PROCESS, with its own pool, resolves a body this process
 *     wrote after this process's pool is closed: the restart the record exists for.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY database (never
 * DATABASE_URL), and is `todo` elsewhere. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

suite('the work-artifact record on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-wa-${nonce}`;
  const other = `prj-wa-other-${nonce}`;
  const mission = `mission-wa-${nonce}`;
  const run = `run:wa-${nonce}`;
  const taskId = `build:${nonce}`;
  let pool: Pool;
  let records: JuliusWorkArtifactPostgresRepository;

  const scope = (overrides: Partial<JuliusWorkArtifactScope> = {}): JuliusWorkArtifactScope => ({
    projectId: project, runId: run, taskId, leaseGeneration: 1, kind: 'DIFF', ...overrides,
  });
  const recordFor = (at: JuliusWorkArtifactScope, body: string): JuliusWorkArtifactRecord => ({
    ...at,
    artifactId: juliusWorkArtifactId(at),
    role: 'CODING_AGENT',
    contentType: 'text/plain; charset=utf-8',
    byteSize: Buffer.byteLength(body, 'utf8'),
    contentHash: sha256(body),
    storageRef: `store:${nonce}:${String(at.leaseGeneration)}:${at.kind}`,
    occurredAt: '2099-01-01T00:00:00.000Z',
  });
  const rowsFor = async (at: JuliusWorkArtifactScope): Promise<number> => Number((await pool.query(
    'SELECT count(*)::int AS n FROM relay_wonderland.julius_work_artifacts WHERE artifact_id=$1', [juliusWorkArtifactId(at)],
  )).rows[0].n);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    records = new JuliusWorkArtifactPostgresRepository(pool);
    for (const id of [project, other]) await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [id]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `work-artifact:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','work-artifact','card-r1',1,1)",
      [run, mission, project],
    );
    const task: JuliusTask = {
      taskId, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
      taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'RUNNABLE',
    };
    await new JuliusPostgresRepository(pool).addTask({ commandId: `wa:${taskId}`, runId: run, projectId: project, task });
  });

  afterAll(async () => {
    // Nothing was created when the pool never opened; otherwise remove exactly this proof's rows.
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.julius_work_artifacts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.project_id=$1',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const id of [project, other]) {
      for (const sql of statements) await pool.query(sql, [id]).catch(() => undefined);
    }
    await pool?.end().catch(() => undefined);
  });

  it('records an attempt\'s body row and reads it back by that exact attempt', async () => {
    const at = scope({ kind: 'PLAN' });
    const record = recordFor(at, 'the plan, attempt one');
    expect(await records.recordWorkArtifact(record)).toEqual({ recorded: true });
    expect(await records.workArtifact(at)).toEqual(record);
    expect(await records.workArtifact(scope({ kind: 'PLAN', leaseGeneration: 2 })), 'another attempt has no body').toBeNull();
  });

  it('the same bytes written again are the same artifact: a replay, never a second row', async () => {
    const at = scope({ kind: 'TEST_OUTPUT' });
    const record = recordFor(at, 'exit=0\n12 passed');
    expect(await records.recordWorkArtifact(record)).toEqual({ recorded: true });
    expect(await records.recordWorkArtifact(record)).toEqual({ recorded: false });
    expect(await rowsFor(at)).toBe(1);
  });

  it('different bytes under a used id are refused by name, and the first record stands', async () => {
    const at = scope({ kind: 'GUIDANCE' });
    const first = recordFor(at, 'the guidance that was given');
    expect(await records.recordWorkArtifact(first)).toEqual({ recorded: true });
    await expect(records.recordWorkArtifact(recordFor(at, 'a rewrite of what was given'))).rejects.toBeInstanceOf(JuliusWorkArtifactConflict);
    expect(await records.workArtifact(at), 'nothing replaced the record of what the attempt produced').toEqual(first);
    expect(await rowsFor(at)).toBe(1);
  });

  it('another project reads nothing, though the run and the attempt are the same', async () => {
    const at = scope({ kind: 'BASE_REVISION' });
    expect(await records.recordWorkArtifact(recordFor(at, 'abc123'))).toEqual({ recorded: true });
    expect(await records.workArtifact({ ...at, projectId: other })).toBeNull();
    expect(await records.workArtifactsForRun({ projectId: other, runId: run })).toEqual([]);
  });

  it('the database refuses a row whose run or task does not exist (the foreign keys hold)', async () => {
    await expect(records.recordWorkArtifact(recordFor(scope({ runId: `run:absent-${nonce}` }), 'orphan')))
      .rejects.toMatchObject({ code: '23503' });
    await expect(records.recordWorkArtifact(recordFor(scope({ taskId: `build:absent-${nonce}` }), 'orphan')))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('two attempts of one task hold two rows, and neither replaces the other', async () => {
    const first = recordFor(scope({ leaseGeneration: 1 }), 'diff, round one');
    const second = recordFor(scope({ leaseGeneration: 2 }), 'diff, round two');
    expect(await records.recordWorkArtifact(first)).toEqual({ recorded: true });
    expect(await records.recordWorkArtifact(second)).toEqual({ recorded: true });
    expect(await records.workArtifact(scope({ leaseGeneration: 1 }))).toEqual(first);
    expect(await records.workArtifact(scope({ leaseGeneration: 2 }))).toEqual(second);
  });

  it('a restart: a SEPARATE OS process with its own pool resolves the body this one wrote, after this one\'s pool closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'julius-work-artifact-root-'));
    const scratch = mkdtempSync(join(tmpdir(), 'julius-work-artifact-child-'));
    try {
      const at = scope({ kind: 'TEST_OUTPUT', leaseGeneration: 7 });
      const body = `exit=0\nwritten by pid ${String(process.pid)}, ${nonce}\n`;
      // THE WRITER: the production composition over its OWN pool, closed before anyone reads.
      const writerPool = new Pool({ connectionString: databaseUrl! });
      const written = await createJuliusDurableArtifacts({
        content: new LocalJuliusArtifactStore(root),
        records: new JuliusWorkArtifactPostgresRepository(writerPool),
        tenancy: { tenantId: 'tenant' },
      }).put({ ...at, role: 'CODING_AGENT', occurredAt: '2099-01-01T00:00:00.000Z' }, body);
      await writerPool.end();
      expect(written.contentHash).toBe(sha256(body));

      // THE READER: a separate OS process running the SAME production modules,
      // bundled from source here so no test double can stand in for them.
      const source = (path: string) => resolve(__dirname, path).split('\\').join('/');
      const entry = join(scratch, 'reader.ts');
      writeFileSync(entry, [
        `import { Pool } from 'pg';`,
        `import { JuliusWorkArtifactPostgresRepository } from '${source('./julius-work-artifact-postgres')}';`,
        `import { createJuliusDurableArtifacts } from '${source('../../../relay-bridge/julius/durable-artifacts')}';`,
        `import { LocalJuliusArtifactStore } from '${source('../workspace/julius-tools/local-artifact-store')}';`,
        `async function main(): Promise<void> {`,
        `  const pool = new Pool({ connectionString: process.env.JULIUS_READER_DATABASE_URL });`,
        `  const durable = createJuliusDurableArtifacts({`,
        `    content: new LocalJuliusArtifactStore(process.env.JULIUS_READER_ROOT as string),`,
        `    records: new JuliusWorkArtifactPostgresRepository(pool),`,
        `    tenancy: { tenantId: 'tenant' },`,
        `  });`,
        `  const body = await durable.get(JSON.parse(process.env.JULIUS_READER_SCOPE as string));`,
        `  await pool.end();`,
        `  process.stdout.write(JSON.stringify({ pid: process.pid, body }));`,
        `}`,
        `main().catch((error) => { process.stderr.write(String(error && error.stack || error)); process.exit(1); });`,
      ].join('\n'));
      const bundle = join(scratch, 'reader.cjs');
      // `pg` stays EXTERNAL, as in every bundle this repository builds (its optional cloud transport does
      // not bundle), and the entry lives outside the repository, so the child is pointed at the
      // repository's own node_modules to load it. Measured: without NODE_PATH the child cannot load pg.
      buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['pg', 'pg-native'], logLevel: 'silent' });
      const child = spawnSync(process.execPath, [bundle], {
        encoding: 'utf8', timeout: 60_000,
        env: {
          ...process.env, NODE_PATH: resolve(__dirname, '../../../node_modules'),
          JULIUS_READER_DATABASE_URL: databaseUrl!, JULIUS_READER_ROOT: root, JULIUS_READER_SCOPE: JSON.stringify(at),
        },
      });
      expect(child.status, child.stderr).toBe(0);
      const answer = JSON.parse(child.stdout) as { pid: number; body: string | null };
      expect(answer.pid, 'a different OS process').not.toBe(process.pid);
      expect(answer.body, 'the body, verified against its digest, from a process that never wrote it').toBe(body);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  it('the latest attempt is the higher lease generation, whichever was written first', async () => {
    // latestWorkArtifact decides which attempt's body a later read is handed
    // (durable-artifacts latest()). Insertion order must not be what decides it,
    // so the lower generation is written first for one task and last for
    // another; 9 and 10 also tell a numeric order from a text one ('9' > '10').
    for (const [suffix, ordinal, order] of [['up', 2, [9, 10]], ['down', 3, [10, 9]]] as const) {
      const latestTask = `${taskId}:latest-${suffix}`;
      const task: JuliusTask = {
        taskId: latestTask, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
        taskType: 'build', role: 'CODING_AGENT', ordinal, state: 'RUNNABLE',
      };
      await new JuliusPostgresRepository(pool).addTask({ commandId: `wa:${latestTask}`, runId: run, projectId: project, task });
      const written = new Map<number, JuliusWorkArtifactRecord>();
      for (const generation of order) {
        const at = scope({ taskId: latestTask, leaseGeneration: generation });
        const record = { ...recordFor(at, `diff, generation ${String(generation)} (${suffix})`), storageRef: `store:${nonce}:${latestTask}:${String(generation)}` };
        expect(await records.recordWorkArtifact(record)).toEqual({ recorded: true });
        written.set(generation, record);
      }
      expect(
        await records.latestWorkArtifact({ projectId: project, runId: run, taskId: latestTask, kind: 'DIFF' }),
        `written ${order.join(' then ')}`,
      ).toEqual(written.get(10));
    }
  });
});
