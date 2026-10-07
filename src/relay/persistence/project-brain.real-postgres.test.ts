import { randomBytes } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { ProjectBrainPostgresStore, type ProjectBrainMutationOutcome } from './project-brain-postgres';
import {
  parseProjectBrainMutation,
  projectBrainCapabilitiesFor,
  type ProjectBrainCursor,
  type ProjectBrainMutationCommand,
  type ProjectBrainProvenance,
} from '../mission/project-brain/project-brain';

/**
 * THE PROJECT BRAIN STORE AGAINST A REAL POSTGRESQL.
 *
 * Every guarantee the store's header makes, said to the database itself:
 * atomicity, idempotent replay, version checks, concurrency, isolation, the
 * database refusing to rewrite history, the exactly-once feed, NOTIFY only after
 * COMMIT, and a write interrupted at each phase answering truthfully.
 *
 * Gated on JULIUS_TEST_DATABASE_URL (a THROWAWAY database; DATABASE_URL is never
 * read) and `todo` without it. Every project id is random, so the suite reruns
 * against a database that already holds its earlier runs.
 */

const databaseUrl = juliusTestDatabaseUrl();
// Real processes and a real database: CI runs this file with no timeout flag, so it states its own.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');

const PLAYER = (id: string): ProjectBrainProvenance => ({
  author: { kind: 'WONDERLAND_PLAYER', id },
  deliverer: { kind: 'WONDERLAND_CLIENT', id: `wonderland-session:${id}` },
});
const OWNER = projectBrainCapabilitiesFor('OWNER');
const EDITOR = projectBrainCapabilitiesFor('EDITOR');

const cmd = (input: Record<string, unknown>): ProjectBrainMutationCommand => {
  const parsed = parseProjectBrainMutation(input);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.message}`);
  return parsed.command;
};
const durable = (outcome: ProjectBrainMutationOutcome) => {
  if (!outcome.ok) throw new Error(`expected a durable write, got ${outcome.code}: ${outcome.message}`);
  return outcome.result;
};

async function seedProject(pool: Pool, input: { projectId: string; tenantId: string; role?: string; runs?: readonly string[] }): Promise<void> {
  await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [input.tenantId]);
  await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [input.projectId]);
  await pool.query('INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [input.projectId, input.tenantId, input.role ?? 'OWNER']);
  for (const runId of input.runs ?? []) {
    const missionId = `mission:${runId}`;
    await pool.query(`INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,$4::jsonb)`,
      [missionId, input.projectId, randomBytes(16).toString('hex'), JSON.stringify({ objective: `Objective of ${runId}`, limits: { spendUsd: 1, repairCycles: 1 } })]);
    await pool.query(`INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)
      VALUES($1,$2,$3,'READY','test','card:test:1',1,0)`, [runId, missionId, input.projectId]);
  }
}

/**
 * A pool whose clients call `before(sql, pid)` ahead of every statement, so a test
 * can interrupt a transaction exactly where it wants. The pid is the backend the
 * statement is about to run on, read once when the client is checked out.
 */
function interceptingPool(pool: Pool, before: (sql: string, pid: number) => Promise<void>): Pool {
  return {
    query: pool.query.bind(pool),
    connect: async () => {
      const client: PoolClient = await pool.connect();
      const original = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ pid: number }> }>;
      const pid = (await original('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      (client as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
        await before(sql, pid);
        return original(sql, values);
      };
      return client;
    },
  } as unknown as Pool;
}

suite('the Project Brain store over a real PostgreSQL', () => {
  let pool: Pool;
  let store: ProjectBrainPostgresStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 20 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    store = new ProjectBrainPostgresStore(pool);
  });
  afterAll(async () => pool?.end());

  it('a fresh database is migrated through 029 with the Project Brain tables and triggers', async () => {
    const versions = await pool.query<{ version: string }>(`SELECT version FROM relay_wonderland.schema_migrations WHERE version='029_julius_project_brain'`);
    expect(versions.rowCount).toBe(1);
    const tables = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='relay_wonderland' AND table_name LIKE 'project_brain_%' ORDER BY 1`);
    // 029's four tables, and (migration 034) the C.A.R.D., handoff and eval components beside them: the EXACT set, so a
    // table nobody reviewed cannot appear unnoticed.
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'project_brain_card_selection', 'project_brain_card_versions', 'project_brain_cards', 'project_brain_eval_versions', 'project_brain_evals',
      'project_brain_handoff_versions', 'project_brain_handoffs', 'project_brain_links', 'project_brain_member_versions', 'project_brain_mission_cards',
      'project_brain_mutations', 'project_brain_record_versions', 'project_brain_records',
    ]);
    const components = await pool.query(`SELECT version FROM relay_wonderland.schema_migrations WHERE version='034_project_brain_components'`);
    expect(components.rowCount, 'the components migration runs after 029 in the same chain').toBe(1);
    const triggers = await pool.query<{ tgname: string }>(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'project_brain_%' ORDER BY 1`);
    expect(triggers.rows.map((r) => r.tgname)).toEqual(expect.arrayContaining([
      'project_brain_event_notify', 'project_brain_links_immutable', 'project_brain_mutations_immutable', 'project_brain_records_guard', 'project_brain_versions_immutable',
    ]));
  });

  it('A CREATE is one atomic act: record, version, mutation and event, read back with author and deliverer', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a', runs: [`run:pb-${nonce()}`] });
    const result = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'USER_FACT', title: 'Wonderland runs on UE 5.8.' }) }));
    expect(result).toMatchObject({ operation: 'CREATE', version: 1, status: 'ACTIVE', eventType: 'project_brain.record.created', sequence: 1 });
    const counts = await pool.query(`SELECT
        (SELECT count(*) FROM relay_wonderland.project_brain_records WHERE record_id=$1)::int AS records,
        (SELECT count(*) FROM relay_wonderland.project_brain_record_versions WHERE record_id=$1)::int AS versions,
        (SELECT count(*) FROM relay_wonderland.project_brain_mutations WHERE record_id=$1)::int AS mutations,
        (SELECT count(*) FROM relay_wonderland.events WHERE event_id=$2)::int AS events`, [result.recordRef, result.eventId]);
    expect(counts.rows[0]).toEqual({ records: 1, versions: 1, mutations: 1, events: 1 });
    const document = (await store.readDocument({ projectId }))!;
    const item = document.sections.memory.find((value) => value.ref === result.recordRef)!;
    expect(item).toMatchObject({ title: 'Wonderland runs on UE 5.8.', status: 'ACTIVE', version: 1, author: { kind: 'WONDERLAND_PLAYER', id: 'player-a' } });
    expect(item.deliverer).toEqual({ kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:player-a' });
    expect(document.missions).toHaveLength(1);
    expect(document.missions[0]!.objective).toMatch(/^Objective of run:pb-/u);
  });

  it('a replayed key is answered from the log; the same key for a different change is a conflict; nothing doubles', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const key = `k-${nonce()}`;
    const command = cmd({ operation: 'CREATE', idempotencyKey: key, domain: 'PREFERENCE', title: 'See it in Unreal first.' });
    const first = await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER, command });
    const again = await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER, command });
    expect(first.ok && !first.replayed).toBe(true);
    expect(again.ok && again.replayed).toBe(true);
    expect(durable(again)).toEqual(durable(first));
    const conflict = await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: key, domain: 'PREFERENCE', title: 'Something else.' }) });
    expect(conflict).toMatchObject({ ok: false, status: 409, code: 'idempotency_conflict', durable: false });
    const rows = await pool.query('SELECT count(*)::int AS n FROM relay_wonderland.project_brain_records WHERE project_id=$1', [projectId]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('a change names the version it changes; a stale one is refused and nothing is overwritten', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const created = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'REQUIREMENT', title: 'Labels below bars.' }) }));
    const revised = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'REVISE', idempotencyKey: `k-${nonce()}`, recordId: created.recordRef, expectedVersion: 1, body: 'White bar beside blue.' }) }));
    expect(revised).toMatchObject({ version: 2, status: 'PROPOSED' });
    const stale = await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'SET_STATUS', idempotencyKey: `k-${nonce()}`, recordId: created.recordRef, expectedVersion: 1, status: 'ADOPTED' }) });
    expect(stale).toMatchObject({ ok: false, status: 409, code: 'version_conflict', details: { currentVersion: 2 } });
    const adopted = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'SET_STATUS', idempotencyKey: `k-${nonce()}`, recordId: created.recordRef, expectedVersion: 2, status: 'ADOPTED' }) }));
    expect(adopted).toMatchObject({ version: 3, status: 'ADOPTED' });
    const history = await pool.query<{ version: string; status: string; body: string }>(
      'SELECT version,status,body FROM relay_wonderland.project_brain_record_versions WHERE record_id=$1 ORDER BY version', [created.recordRef]);
    expect(history.rows.map((r) => [Number(r.version), r.status, r.body])).toEqual([[1, 'PROPOSED', ''], [2, 'PROPOSED', 'White bar beside blue.'], [3, 'ADOPTED', 'White bar beside blue.']]);
    // An editor may not adopt: the membership row decides, not the request.
    const proposal = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: EDITOR,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'CONSTRAINT', title: 'No Fable.' }) }));
    expect(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: EDITOR,
      command: cmd({ operation: 'SET_STATUS', idempotencyKey: `k-${nonce()}`, recordId: proposal.recordRef, expectedVersion: 1, status: 'ADOPTED' }) }))
      .toMatchObject({ ok: false, status: 403, code: 'capability_missing' });
  });

  it('concurrent writers: every create lands with a dense sequence, and exactly one of N racing changes to one version wins', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const creates = await Promise.all(Array.from({ length: 12 }, (_, i) => store.mutate({
      projectId, provenance: PLAYER(`player-${i % 3}`), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}-${i}`, domain: 'SCRATCHPAD', title: `note ${i}` }),
    })));
    expect(creates.every((outcome) => outcome.ok)).toBe(true);
    const sequences = creates.map((outcome) => durable(outcome).sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const target = durable(creates[0]!).recordRef;
    const racing = await Promise.all(Array.from({ length: 8 }, (_, i) => store.mutate({
      projectId, provenance: PLAYER('player-0'), capabilities: OWNER,
      command: cmd({ operation: 'REVISE', idempotencyKey: `k-${nonce()}-r${i}`, recordId: target, expectedVersion: 1, body: `writer ${i}` }),
    })));
    expect(racing.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(racing.filter((outcome) => !outcome.ok).every((outcome) => !outcome.ok && outcome.code === 'version_conflict')).toBe(true);
    const winner = racing.find((outcome) => outcome.ok)!;
    const row = await pool.query<{ version: string; body: string }>('SELECT version,body FROM relay_wonderland.project_brain_records WHERE record_id=$1', [target]);
    expect(Number(row.rows[0]!.version)).toBe(2);
    expect(winner.ok && winner.result.version).toBe(2);
  });

  it('duplicate concurrent requests with one key apply once, and every caller gets the same answer', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const command = cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'INSTRUCTION', title: 'Julius remains the mission authority.' });
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER, command })));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.filter((outcome) => outcome.ok && !outcome.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => durable(outcome).mutationId)).size).toBe(1);
    const counts = await pool.query(`SELECT (SELECT count(*) FROM relay_wonderland.project_brain_records WHERE project_id=$1)::int AS records,
      (SELECT count(*) FROM relay_wonderland.events WHERE project_id=$1)::int AS events`, [projectId]);
    expect(counts.rows[0]).toEqual({ records: 1, events: 1 });
  });

  it('isolation is deterministic: another project cannot read, change, reference or receive a record', async () => {
    const a = `prj-pb-a-${nonce()}`;
    const b = `prj-pb-b-${nonce()}`;
    const runA = `run:pb-${nonce()}`;
    const runA2 = `run:pb-${nonce()}`;
    const runB = `run:pb-${nonce()}`;
    await seedProject(pool, { projectId: a, tenantId: 'owner-a', runs: [runA, runA2] });
    await seedProject(pool, { projectId: b, tenantId: 'owner-b', runs: [runB] });
    const secret = durable(await store.mutate({ projectId: a, provenance: PLAYER('owner-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'USER_FACT', title: 'A-only fact.' }) }));
    const scoped = durable(await store.mutate({ projectId: a, provenance: PLAYER('owner-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'REQUIREMENT', runId: runA, title: 'Only for run A.' }) }));

    expect(JSON.stringify(await store.readDocument({ projectId: b }))).not.toContain('A-only fact.');
    expect(await store.mutate({ projectId: b, provenance: PLAYER('owner-b'), capabilities: OWNER,
      command: cmd({ operation: 'SET_STATUS', idempotencyKey: `k-${nonce()}`, recordId: secret.recordRef, expectedVersion: 1, status: 'WITHDRAWN' }) }))
      .toMatchObject({ ok: false, status: 404, code: 'record_not_found' });
    expect(await store.mutate({ projectId: b, provenance: PLAYER('owner-b'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'FINDING_RESPONSE', title: 'x', subjectRef: secret.recordRef }) }))
      .toMatchObject({ ok: false, status: 404, code: 'ref_not_found' });
    expect(await store.mutate({ projectId: b, provenance: PLAYER('owner-b'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'REQUIREMENT', runId: runA, title: 'x' }) }))
      .toMatchObject({ ok: false, status: 404, code: 'run_not_found' });
    expect(await store.readDocument({ projectId: b, runId: runA })).toBeNull();
    // Julius's context: A's runs see the project-wide fact; only run A sees the run-A requirement; B sees neither.
    const textOf = async (runId: string, projectId: string) => (await store.contextEntriesForRun(runId, projectId)).map((entry) => entry.text).join('\n');
    expect(await textOf(runA, a)).toContain('Only for run A.');
    expect(await textOf(runA, a)).toContain('A-only fact.');
    expect(await textOf(runA2, a)).toContain('A-only fact.');
    expect(await textOf(runA2, a)).not.toContain('Only for run A.');
    expect(await textOf(runB, b)).not.toMatch(/A-only fact\.|Only for run A\./u);
    expect(await textOf(runA, b)).toBe('');
    expect(scoped.runId).toBe(runA);
  });

  it('the database itself refuses to rewrite history', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const created = durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'WORKFLOW', title: 'Plan, build, prove.' }) }));
    await expect(pool.query('UPDATE relay_wonderland.project_brain_mutations SET operation=$2 WHERE mutation_id=$1', [created.mutationId, 'LINK'])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query('DELETE FROM relay_wonderland.project_brain_record_versions WHERE record_id=$1', [created.recordRef])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query('DELETE FROM relay_wonderland.project_brain_records WHERE record_id=$1', [created.recordRef])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query('UPDATE relay_wonderland.project_brain_records SET version=5 WHERE record_id=$1', [created.recordRef])).rejects.toThrow(/project_brain_version_skip/u);
    await expect(pool.query(`UPDATE relay_wonderland.project_brain_records SET version=2, author_id='someone-else' WHERE record_id=$1`, [created.recordRef])).rejects.toThrow(/project_brain_identity_change/u);
  });

  it('the feed replays Julius and Project Brain events exactly once, across pages, from any cursor', async () => {
    const projectId = `prj-pb-${nonce()}`;
    const runId = `run:pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a', runs: [runId] });
    const julius = new JuliusEventPostgresRepository(pool);
    for (let i = 0; i < 5; i += 1) {
      await julius.append({ eventId: `event:pb:${nonce()}`, runId, projectId, type: 'evidence.recorded', taskId: `t-${i}`, workerId: 'coder',
        correlationId: `t-${i}`, causationId: null, occurredAt: new Date().toISOString(), facts: { evidenceId: `ev-${i}` } });
    }
    for (let i = 0; i < 4; i += 1) {
      durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
        command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}-${i}`, domain: 'SCRATCHPAD', title: `n${i}` }) }));
    }
    const seen: string[] = [];
    let cursor: ProjectBrainCursor = {};
    for (let page = 0; page < 10; page += 1) {
      const next = await store.eventsAfter({ projectId, cursor, limit: 2 });
      if (next.events.length === 0) break;
      for (const event of next.events) seen.push(event.eventId);
      cursor = next.cursor;
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    const types = (await store.eventsAfter({ projectId, cursor: {} })).events.map((event) => event.type);
    expect(types.filter((type) => type === 'project_brain.evidence.recorded')).toHaveLength(5);
    expect(types.filter((type) => type === 'project_brain.record.created')).toHaveLength(4);
    const evidenceEvent = (await store.eventsAfter({ projectId, cursor: {} })).events.find((event) => event.type === 'project_brain.evidence.recorded')!;
    expect(evidenceEvent.refs).toEqual(expect.arrayContaining([`mission:${runId}`, 'evidence:ev-0']));
    expect(JSON.stringify(evidenceEvent)).not.toContain('facts');
    expect(await store.head(projectId)).toEqual(cursor);
    expect((await store.eventsAfter({ projectId, cursor })).events).toEqual([]);
  });

  it('a listener is woken only after COMMIT, and never for a rolled-back write', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const listener = new Client({ connectionString: databaseUrl! });
    await listener.connect();
    const heard: string[] = [];
    listener.on('notification', (message) => { if (message.payload === projectId) heard.push(message.channel); });
    await listener.query('LISTEN relay_project_brain');
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
          VALUES($1,$2,$3,999,'project_brain.record.created','PROJECT','{}',now())`, [`pb-rollback-${nonce()}`, `project-brain:${projectId}`, projectId]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(heard, 'nothing is announced before COMMIT').toEqual([]);
        await client.query('ROLLBACK');
      } finally { client.release(); }
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(heard, 'a rolled-back write is never announced').toEqual([]);
      durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
        command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'IDENTITY', title: 'Project: Wonderland' }) }));
      for (let i = 0; i < 20 && heard.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heard).toEqual(['relay_project_brain']);
    } finally {
      await listener.end();
    }
  });

  it('an interrupted write is reported as not durable, and nothing of it exists', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const admin = new Client({ connectionString: databaseUrl! });
    await admin.connect();
    try {
      const killing = new ProjectBrainPostgresStore(interceptingPool(pool, async (sql, pid) => {
        // The connection dies after the record is written and before the event is: mid-transaction.
        if (/^INSERT INTO relay_wonderland\.events/u.test(sql.trim())) await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      }));
      const outcome = await killing.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
        command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'USER_FACT', title: 'Interrupted.' }) });
      expect(outcome).toMatchObject({ ok: false, durable: false, code: 'project_brain_persistence_failed' });
      const left = await pool.query(`SELECT (SELECT count(*) FROM relay_wonderland.project_brain_records WHERE project_id=$1)::int AS records,
        (SELECT count(*) FROM relay_wonderland.project_brain_mutations WHERE project_id=$1)::int AS mutations,
        (SELECT count(*) FROM relay_wonderland.events WHERE project_id=$1)::int AS events`, [projectId]);
      expect(left.rows[0]).toEqual({ records: 0, mutations: 0, events: 0 });
    } finally {
      await admin.end();
    }
  });

  it('a COMMIT nobody confirmed is reported as UNKNOWN, and retrying the same key is safe', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a' });
    const admin = new Client({ connectionString: databaseUrl! });
    await admin.connect();
    try {
      const unconfirmed = new ProjectBrainPostgresStore(interceptingPool(pool, async (sql, pid) => {
        // The connection dies as COMMIT is about to be sent: the client cannot know what happened.
        if (sql.trim() === 'COMMIT') await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      }));
      const command = cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'USER_FACT', title: 'Maybe saved.' });
      const outcome = await unconfirmed.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER, command });
      expect(outcome).toMatchObject({ ok: false, durable: 'unknown', code: 'project_brain_commit_unknown', status: 503 });
      const retry = await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER, command });
      expect(retry.ok).toBe(true);
      const records = await pool.query('SELECT count(*)::int AS n FROM relay_wonderland.project_brain_records WHERE project_id=$1', [projectId]);
      expect(records.rows[0].n, 'applied exactly once').toBe(1);
    } finally {
      await admin.end();
    }
  });

  it('a new connection pool -- a restarted process -- reads the identical Brain', async () => {
    const projectId = `prj-pb-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'player-a', runs: [`run:pb-${nonce()}`] });
    durable(await store.mutate({ projectId, provenance: PLAYER('player-a'), capabilities: OWNER,
      command: cmd({ operation: 'CREATE', idempotencyKey: `k-${nonce()}`, domain: 'DECISION', title: 'Aurum skin for the companion.' }) }));
    const before = (await store.readDocument({ projectId }))!;
    const fresh = new Pool({ connectionString: databaseUrl! });
    try {
      const after = (await new ProjectBrainPostgresStore(fresh).readDocument({ projectId }))!;
      expect({ ...after, observedAt: before.observedAt }).toEqual(before);
    } finally {
      await fresh.end();
    }
  });
});
