import { randomBytes, randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_034 } from './wonderland-postgres';
import { PROJECT_BRAIN_READ_LIMITS, ProjectBrainPostgresStore } from './project-brain-postgres';
import { ProjectBrainComponentStore, projectBrainCardContentHash, type ProjectBrainComponentOutcome } from './project-brain-components-postgres';
import { ProjectBrainMembersStore, type ProjectBrainMemberOutcome } from './project-brain-members-postgres';
import { PROJECT_BRAIN_RECORD_DOMAINS, projectBrainCapabilitiesFor, type ProjectBrainMutationCommand, type ProjectBrainProvenance } from '../mission/project-brain/project-brain';
import {
  PROJECT_BRAIN_DEFAULT_CARD,
  parseProjectBrainComponentMutation,
  projectBrainEvalQualifies,
  type ProjectBrainComponentCommand,
} from '../mission/project-brain/project-brain-components';

/**
 * THE C.A.R.D., MISSION HANDOFF AND EVAL COMPONENTS AGAINST A REAL POSTGRESQL (migration 034).
 *
 * Each case is a founder gate said to the database: a C.A.R.D. that survives a restart with its whole history and a
 * mission pinned to the version it started under; no credential durable anywhere; /handoff changing nothing of the
 * mission; an eval that qualifies only the revision it judged; isolation, races, corruption and the database's own
 * guards. Gated on JULIUS_TEST_DATABASE_URL (a THROWAWAY database) and `todo` without it; every id is random.
 */

const databaseUrl = juliusTestDatabaseUrl();
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');

const PLAYER = (id: string): ProjectBrainProvenance => ({ author: { kind: 'WONDERLAND_PLAYER', id }, deliverer: { kind: 'WONDERLAND_CLIENT', id: `wonderland-session:${id}` } });
const RUNTIME: ProjectBrainProvenance = { author: { kind: 'JULIUS', id: 'julius' }, deliverer: { kind: 'JULIUS_RUNTIME', id: 'relay-bridge:julius' } };
const OPERATOR = (tenant: string): ProjectBrainProvenance => ({ author: { kind: 'FOUNDER', id: tenant }, deliverer: { kind: 'OPERATOR_API', id: 'relay-bridge:operator' } });
const OWNER = projectBrainCapabilitiesFor('OWNER');
const EDITOR = projectBrainCapabilitiesFor('EDITOR');

// Synthetic credentials, assembled at run time (the repository boundary scan refuses credential-shaped literals).
const FAKE_SK = ['sk', 'ant', 'api03', 'FAKETESTNOTREAL', 'Zq7Wm2Lp9Xr4'].join('-');
const FAKE_GH = ['ghp', `FAKETESTNOTREAL${'7'.repeat(12)}`].join('_');
const FAKE_RANDOM = ['Qx7', 'Lm2', 'Vb9', 'Rt4', 'Zk8', 'Wn3', 'Hp6'].join('');

const CARD = {
  name: 'Night shift', missionHandoff: 'angelic_twin_swords', skin: 'relay_og', outfit: '', primary: { key: 'WHITE', chosen: true },
  companions: [{ slot: 0, kind: 'LLM', providerId: 'openai', label: 'LLM Companion' }, { slot: 1, kind: 'AGENT', providerId: 'claude-code', label: 'Jhinn' }],
  capabilities: [{ kind: 'MCP', id: 'github-mcp-server', label: 'GitHub' }, { kind: 'SKILL', id: 'pdf', label: 'PDF' }],
};

const cmd = (input: Record<string, unknown>): ProjectBrainComponentCommand => {
  const parsed = parseProjectBrainComponentMutation(input);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.message}`);
  return parsed.command;
};
const brainDurableRef = (outcome: Awaited<ReturnType<ProjectBrainPostgresStore['mutate']>>): string => {
  if (!outcome.ok || outcome.result.recordRef === null) throw new Error(`expected a durable record, got ${JSON.stringify(outcome)}`);
  return outcome.result.recordRef;
};
const durable = (outcome: ProjectBrainComponentOutcome) => {
  if (!outcome.ok) throw new Error(`expected a durable write, got ${outcome.code}: ${outcome.message}`);
  return outcome.result;
};
const refusal = (outcome: ProjectBrainComponentOutcome) => (outcome.ok ? 'durable' : outcome.code);

async function seedProject(pool: Pool, input: { projectId: string; tenantId: string; role?: string; runs?: readonly string[]; state?: string }): Promise<void> {
  await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [input.tenantId]);
  await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [input.projectId]);
  await pool.query('INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [input.projectId, input.tenantId, input.role ?? 'OWNER']);
  for (const runId of input.runs ?? []) {
    const missionId = `mission:${runId}`;
    await pool.query(`INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,$4::jsonb)`,
      [missionId, input.projectId, randomBytes(16).toString('hex'), JSON.stringify({ objective: `Objective of ${runId}`, limits: { spendUsd: 1, repairCycles: 1 },
        workers: [{ role: 'PROMPT_ARCHITECT' }, { role: 'CODING_AGENT' }, { role: 'INDEPENDENT_REVIEWER' }] })]);
    await pool.query(`INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)
      VALUES($1,$2,$3,$4,'test','card:test:1',1,0)`, [runId, missionId, input.projectId, input.state ?? 'EXECUTING']);
  }
}

/**
 * JULIUS'S OWN WORK ON A RUN, as its runtime records it: an implement task and its repair, PASSED evidence, an acceptance
 * criterion it satisfies, a resolved reviewer finding, an ACCEPT decision, a VERIFIED repair cycle linking the finding to
 * the evidence, and the run's transitions ending in its current state. Coherent by construction (the coherence report
 * must stay ok). Returns the ids, so a reader can be held to every one of them.
 */
async function seedJuliusWork(pool: Pool, runId: string): Promise<{ task: string; repairTask: string; evidence: string; criterion: string; finding: string; decision: string; repair: string; transitions: string[]; subagent: string }> {
  const n = nonce();
  const ids = { task: `task-${n}`, repairTask: `task-repair-${n}`, evidence: `ev-${n}`, criterion: `crit-${n}`, finding: `find-${n}`, decision: `dec-${n}`, repair: `rep-${n}`,
    transitions: [`tr-${n}-1`, `tr-${n}-2`], subagent: `sub-${n}` };
  const at = '2026-10-04T02:00:00.000Z';
  for (const [task, ordinal] of [[ids.task, 0], [ids.repairTask, 1]] as const) {
    await pool.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal) VALUES($1,$2,'IMPLEMENTER','IMPLEMENT','SUCCEEDED',$3)`, [task, runId, ordinal]);
  }
  await pool.query(`INSERT INTO relay_wonderland.julius_evidence(evidence_id,run_id,task_id,worker_id,evidence_type,status,safe_summary,integrity_hash,occurred_at,idempotency_key)
    VALUES($1,$2,$3,'w1','TEST_RUN','PASSED','the suite passed','sha256:${'ab'.repeat(32)}',$4,$5)`, [ids.evidence, runId, ids.task, at, `ik-${n}`]);
  await pool.query(`INSERT INTO relay_wonderland.julius_acceptance_criteria(criterion_id,run_id,description,required_evidence_types,ordinal) VALUES($1,$2,'the suite passes','["TEST_RUN"]',0)`, [ids.criterion, runId]);
  await pool.query('INSERT INTO relay_wonderland.julius_criterion_evidence(run_id,criterion_id,evidence_id) VALUES($1,$2,$3)', [runId, ids.criterion, ids.evidence]);
  await pool.query(`INSERT INTO relay_wonderland.julius_reviewer_findings(finding_id,run_id,task_id,reviewer_worker_id,severity,category,claim,criterion_id,evidence_ids,blocking,status,created_at,updated_at)
    VALUES($1,$2,$3,'reviewer','HIGH','correctness','an edge case was missed',$4,$5::jsonb,true,'RESOLVED',$6,$6)`, [ids.finding, runId, ids.task, ids.criterion, JSON.stringify([ids.evidence]), at]);
  await pool.query(`INSERT INTO relay_wonderland.julius_repair_cycles(repair_id,run_id,original_task_id,repair_task_id,round,finding_ids,evidence_ids,budget_reservation_id,state)
    VALUES($1,$2,$3,$4,1,$5::jsonb,$6::jsonb,'budget-1','VERIFIED')`, [ids.repair, runId, ids.task, ids.repairTask, JSON.stringify([ids.finding]), JSON.stringify([ids.evidence])]);
  await pool.query(`INSERT INTO relay_wonderland.julius_verification_decisions(decision_id,run_id,task_id,action,reason_code,safe_summary,evidence_ids,policy_revision,occurred_at,idempotency_key)
    VALUES($1,$2,$3,'ACCEPT','criteria_met','every criterion has passed evidence',$4::jsonb,'policy:1',$5,$6)`, [ids.decision, runId, ids.repairTask, JSON.stringify([ids.evidence]), at, `dk-${n}`]);
  // The Compound Agent System: the implement task spawned a research sub-agent (its own task, depth 1, narrowed permissions).
  const child = `task-sub-${n}`;
  await pool.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal) VALUES($1,$2,$3,'CODING_AGENT','RESEARCH','SUCCEEDED',2)`, [child, runId, ids.task]);
  await pool.query(`INSERT INTO relay_wonderland.julius_subagents(request_id,run_id,project_id,parent_task_id,child_task_id,depth,capability,permissions,budget_reservation_id,state)
    SELECT $1,$2,r.project_id,$3,$4,1,'research','["read_repository"]','budget-sub','SUCCEEDED' FROM relay_wonderland.julius_runs r WHERE r.run_id=$2`, [ids.subagent, runId, ids.task, child]);
  for (const [i, [from, to]] of ([['CREATED', 'PLANNING'], ['PLANNING', 'EXECUTING']] as const).entries()) {
    await pool.query(`INSERT INTO relay_wonderland.julius_transitions(transition_id,run_id,from_state,to_state,reason_code,safe_summary,evidence_ids,runtime_version,occurred_at,sequence)
      VALUES($1,$2,$3,$4,'advance','the run advanced','[]','test',$5,$6)`, [ids.transitions[i], runId, from, to, at, (i + 1) * 3]);
  }
  return ids;
}

/** A pool whose clients run `before(sql, pid)` ahead of every statement: lets a test kill the backend at an exact point. */
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

/**
 * THE DATABASE'S OWN ANSWER, WITH THE STORE BYPASSED. The steps run in ONE transaction that is ALWAYS rolled back, so
 * nothing is ever written: the verdict is what the statement-time guards say (CHECKs, triggers, unique indexes) -- the
 * deferred references to the mutation log are checked only at COMMIT, which never comes. A refusal names its step, its
 * SQLSTATE, the constraint PostgreSQL reports (CHECK, unique, foreign key) and its message; ACCEPTED means every guard
 * let the steps through. Each DB BACKSTOP case below carries a CONTROL step that must be ACCEPTED, so a refusal is the
 * guard's, never a malformed row's.
 */
type Step = readonly [sql: string, values?: readonly unknown[]];
type Verdict = 'ACCEPTED' | { step: number; code: string | undefined; constraint: string | undefined; message: string };
async function rolledBack(pool: Pool, steps: readonly Step[]): Promise<Verdict> {
  const client = await pool.connect();
  let step = -1;
  try {
    await client.query('BEGIN');
    for (const [index, [sql, values]] of steps.entries()) {
      step = index;
      await client.query(sql, values === undefined ? [] : [...values]);
    }
    return 'ACCEPTED';
  } catch (error) {
    const failure = error as { code?: string; constraint?: string; message: string };
    return { step, code: failure.code, constraint: failure.constraint, message: failure.message };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
/** A refusal by a named database guard (a RAISE in a 034 trigger function): its SQLSTATE and the start of its message. */
const raised = (code: string, message: RegExp, step = 0) => ({ step, code, constraint: undefined, message: expect.stringMatching(message) });
/** A refusal by a named constraint: its SQLSTATE and the constraint's name. */
const violated = (code: string, constraint: string, step = 0) => ({ step, code, constraint });

/** Every row of Julius's own that describes one run, as text: what a handoff must leave byte-identical. */
async function juliusFingerprint(pool: Pool, runId: string): Promise<string> {
  // EVERY row of EVERY Julius table that carries this run, found from the catalog (a table added later is included without
  // editing this), as full row images: the mission, its contract (objective, policy, budget), and its tasks, evidence,
  // criteria, findings (reviewer), decisions, repairs, approvals, trajectory (provider), entries, claims, contracts...
  const tables = await pool.query<{ table_name: string }>(`SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
      WHERE c.table_schema='relay_wonderland' AND c.column_name='run_id' AND c.table_name LIKE 'julius\\_%' ORDER BY c.table_name`);
  const images: string[] = [];
  for (const { table_name: table } of tables.rows) {
    const rows = await pool.query<{ t: string | null }>(
      `SELECT json_agg(row_to_json(x)::text ORDER BY row_to_json(x)::text)::text AS t FROM relay_wonderland.${table} x WHERE run_id=$1`, [runId]);
    images.push(`${table}: ${rows.rows[0]?.t ?? '[]'}`);
  }
  const contract = await pool.query<{ t: string }>(
    'SELECT row_to_json(c)::text AS t FROM relay_wonderland.mission_contracts c JOIN relay_wonderland.julius_runs r ON r.mission_id=c.mission_id WHERE r.run_id=$1', [runId]);
  images.push(`mission_contracts: ${contract.rows[0]?.t}`);
  // The project's Brain statements: a handoff writes its own rows, never a statement, a version or a link.
  const statements = await pool.query<{ t: string | null }>(`SELECT json_agg(x.t ORDER BY x.t)::text AS t FROM (
      SELECT row_to_json(r)::text AS t FROM relay_wonderland.project_brain_records r JOIN relay_wonderland.julius_runs j ON j.project_id=r.project_id WHERE j.run_id=$1
      UNION ALL SELECT row_to_json(v)::text FROM relay_wonderland.project_brain_record_versions v JOIN relay_wonderland.julius_runs j ON j.project_id=v.project_id WHERE j.run_id=$1
      UNION ALL SELECT row_to_json(l)::text FROM relay_wonderland.project_brain_links l JOIN relay_wonderland.julius_runs j ON j.project_id=l.project_id WHERE j.run_id=$1) x`, [runId]);
  images.push(`project_brain statements: ${statements.rows[0]?.t ?? '[]'}`);
  return images.join('\n');
}

suite('the C.A.R.D., handoff and eval components over a real PostgreSQL', () => {
  let pool: Pool;
  let components: ProjectBrainComponentStore;
  let brain: ProjectBrainPostgresStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 20 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    components = new ProjectBrainComponentStore(pool);
    brain = new ProjectBrainPostgresStore(pool);
  });
  afterAll(async () => pool?.end());

  it('a fresh database is migrated through 034: the component tables, their guards and the deferred mutation references', async () => {
    const stamped = await pool.query("SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='034_project_brain_components'");
    expect(stamped.rowCount).toBe(1);
    const tables = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='relay_wonderland' AND table_name LIKE 'project_brain_%' ORDER BY 1`);
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'project_brain_card_selection', 'project_brain_card_versions', 'project_brain_cards', 'project_brain_eval_versions', 'project_brain_evals',
      'project_brain_handoff_versions', 'project_brain_handoffs', 'project_brain_links', 'project_brain_member_versions', 'project_brain_mission_cards',
      'project_brain_mutations', 'project_brain_record_versions', 'project_brain_records',
    ]);
    const deferred = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND condeferrable AND condeferred
      AND confrelid='relay_wonderland.project_brain_mutations'::regclass`);
    expect(deferred.rows[0]!.n, 'every component and membership reference to the mutation log is checked at the end of its transaction').toBe(9);
  });

  it('C.A.R.D. REAL PATH: create, select, modify, pin, switch, delete -- then a restarted process reads exactly that, history included', async () => {
    const projectId = `prj-card-${nonce()}`;
    const runId = `run:card-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const created = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `card-create-${nonce()}`, card: CARD }) }));
    const cardId = created.componentRef;
    expect(created).toMatchObject({ version: 1, state: 'LIVE' });
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `sel-1-${nonce()}`, cardRef: cardId, expectedSelectionVersion: 0 }) }));
    const modified = { ...CARD, primary: { key: 'BLACK', chosen: true } };
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_UPDATE', idempotencyKey: `stale-${nonce()}`, cardId, expectedVersion: 2, card: modified }) })), 'a stale writer overwrites nothing').toBe('version_conflict');
    expect(durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_UPDATE', idempotencyKey: `upd-${nonce()}`, cardId, expectedVersion: 1, card: modified }) })).version).toBe(2);
    // The mission starts: the runtime pins the selected card AT ITS CURRENT VERSION.
    const pin = durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `pin-${nonce()}`, runId }) }));
    expect(pin.state).toBe(`${cardId}@v2`);
    // A client can never pin, and a pin never moves.
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: OWNER, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `pin-p-${nonce()}`, runId }) }))).toBe('pin_not_permitted');
    expect(refusal(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `pin-2-${nonce()}`, runId }) }))).toBe('already_pinned');
    // Switching and editing cards mid-mission changes the NEXT mission's default, never the running one's envelope.
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_UPDATE', idempotencyKey: `upd-3-${nonce()}`, cardId, expectedVersion: 2, card: { ...modified, skin: 'relay_og_v2' } }) }));
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `sel-2-${nonce()}`, cardRef: 'pbcard:default', expectedSelectionVersion: 1 }) }));
    const pinned = await components.pinnedCard(projectId, runId);
    expect(pinned?.revision).toBe(`${cardId}@v2`);
    expect(pinned?.content.primary.key, 'the running mission still sees the version it started under').toBe('BLACK');
    expect(pinned?.content.skin).toBe('relay_og');
    // Delete it (the default is selected now, so the selection does not move); the pin still resolves.
    expect(durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_DELETE', idempotencyKey: `del-${nonce()}`, cardId, expectedVersion: 3 }) })).state).toBe('DELETED');
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `sel-3-${nonce()}`, cardRef: cardId, expectedSelectionVersion: 2 }) }))).toBe('card_deleted');

    // RESTART: a new pool is a new process's view of the same database.
    const restarted = new Pool({ connectionString: databaseUrl!, max: 2 });
    try {
      const reread = await new ProjectBrainComponentStore(restarted).read(projectId);
      const card = reread?.cards.find((c) => c.cardId === cardId);
      expect(card).toMatchObject({ state: 'DELETED', version: 4, name: 'Night shift' });
      expect(reread?.selection).toMatchObject({ cardRef: 'pbcard:default', version: 2 });
      expect(reread?.missionCards).toEqual([expect.objectContaining({ runId, cardRef: cardId, cardVersion: 2 })]);
      expect((await new ProjectBrainComponentStore(restarted).pinnedCard(projectId, runId))?.content.primary.key, 'deletion is a version: the pin still resolves').toBe('BLACK');
      const history = await restarted.query<{ version: string; state: string; skin: string }>(
        "SELECT version, state, content->>'skin' AS skin FROM relay_wonderland.project_brain_card_versions WHERE card_id=$1 ORDER BY version", [cardId]);
      expect(history.rows.map((r) => `${r.version}:${r.state}:${r.skin}`)).toEqual(['1:LIVE:relay_og', '2:LIVE:relay_og', '3:LIVE:relay_og_v2', '4:DELETED:relay_og_v2']);
      const document = await new ProjectBrainPostgresStore(restarted).readDocument({ projectId });
      expect(document?.componentsInstalled).toBe(true);
      expect(document?.sections.cards.map((i) => `${i.kind}:${i.ref}:${i.status}`).sort()).toEqual([
        `CARD:${cardId}:DELETED`, 'CARD_BUILT_IN:pbcard:default:LIVE', `MISSION_CARD_PIN:mission:${runId}#card:PINNED`,
      ].sort());
      expect(document?.sections.cards.find((i) => i.ref === 'pbcard:default')?.attributes.selected).toBe(true);
    } finally {
      await restarted.end();
    }
  });

  it('a mission never pinned runs under the built-in default; deleting the SELECTED card returns the selection to it in the same write', async () => {
    const projectId = `prj-card-default-${nonce()}`;
    const runId = `run:default-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    expect(durable(await components.mutateComponent({ projectId, provenance: OPERATOR('p1'), capabilities: OWNER, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `pin-${nonce()}`, runId }) })).state).toBe('pbcard:default@v1');
    expect((await components.pinnedCard(projectId, runId))?.contentHash).toBe(projectBrainCardContentHash(PROJECT_BRAIN_DEFAULT_CARD));
    const cardId = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `c-${nonce()}`, card: CARD }) })).componentRef;
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `s-${nonce()}`, cardRef: cardId, expectedSelectionVersion: 0 }) }));
    const deleted = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_DELETE', idempotencyKey: `d-${nonce()}`, cardId, expectedVersion: 1 }) }));
    expect(deleted.alsoChanged).toEqual(['selection:pbcard:default']);
    expect((await components.read(projectId))?.selection).toMatchObject({ cardRef: 'pbcard:default', version: 2 });
  });

  it('SECRET SAFETY: synthetic credentials through every card field are refused, and the literal is durable NOWHERE in the database', async () => {
    const projectId = `prj-card-secret-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    const attempts: Record<string, unknown>[] = [];
    for (const secret of [FAKE_SK, FAKE_GH, FAKE_RANDOM]) {
      attempts.push({ ...CARD, name: `key ${secret}`.slice(0, 64) });
      attempts.push({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: 'openai', label: secret.slice(0, 64) }] });
      attempts.push({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: secret.replace(/[^A-Za-z0-9._-]/gu, '').slice(0, 64), label: '' }] });
      attempts.push({ ...CARD, capabilities: [{ kind: 'API', id: secret.replace(/[^A-Za-z0-9._-]/gu, '').slice(0, 64), label: 'imported capability metadata' }] });
      attempts.push({ ...CARD, capabilities: [{ kind: 'MCP', id: 'github-mcp-server', label: secret.slice(0, 64) }] });
    }
    for (const card of attempts) {
      const parsed = parseProjectBrainComponentMutation({ operation: 'CARD_CREATE', idempotencyKey: `secret-${nonce()}`, card });
      expect(parsed.ok, JSON.stringify(card).slice(0, 80)).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe('credential_in_content');
    }
    // And the STORE refuses them too when a caller hands them over unparsed (a runtime caller skipping the door).
    for (const card of attempts) {
      const direct = await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
        command: { operation: 'CARD_CREATE', idempotencyKey: `secret-direct-${nonce()}`, card } as unknown as ProjectBrainComponentCommand });
      expect(direct.ok ? 'durable' : `${direct.code}/${String(direct.durable)}`).toBe('credential_in_content/false');
    }
    const cards = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.project_brain_cards WHERE project_id=$1', [projectId]);
    expect(cards.rows[0]!.n, 'nothing was stored for this project').toBe(0);
    const everything = await pool.query<{ t: string }>(`SELECT string_agg(row_to_json(x)::text, '\n') AS t FROM (
        SELECT content::text AS c FROM relay_wonderland.project_brain_cards UNION ALL SELECT content::text FROM relay_wonderland.project_brain_card_versions
        UNION ALL SELECT result::text FROM relay_wonderland.project_brain_mutations UNION ALL SELECT payload::text FROM relay_wonderland.events
        UNION ALL SELECT row_to_json(e)::text FROM relay_wonderland.project_brain_evals e UNION ALL SELECT row_to_json(h)::text FROM relay_wonderland.project_brain_handoffs h
        UNION ALL SELECT row_to_json(m)::text FROM relay_wonderland.project_brain_mission_cards m UNION ALL SELECT row_to_json(r)::text FROM relay_wonderland.project_brain_records r) x`);
    for (const secret of [FAKE_SK, FAKE_GH, FAKE_RANDOM]) expect(everything.rows[0]?.t ?? '', 'the literal never reached a durable row').not.toContain(secret);
  });

  it('/HANDOFF CONTINUITY: enter, return, repeat -- the mission is byte-identical; stale, repeated, duplicated and finished handoffs change nothing', async () => {
    const projectId = `prj-handoff-${nonce()}`;
    const runId = `run:handoff-${nonce()}`;
    const finished = `run:handoff-done-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [finished], state: 'COMPLETED' });
    // A mission WITH work, so "unchanged" is not vacuous: tasks, evidence, a criterion, a reviewer's finding, a repair, a
    // decision, an approval, a provider step, a Brain statement and a pinned card.
    const work = await seedJuliusWork(pool, runId);
    await pool.query(`INSERT INTO relay_wonderland.julius_approvals(approval_id,run_id,project_id,task_id,operation,policy_revision,reason_code,safe_rationale,state,requested_at,decided_at,decided_by,decision_reason,idempotency_key)
      VALUES($1,$2,$3,$4,'MERGE','policy:1','needs_approval','a merge needs the owner','APPROVED',$5,$5,'founder:owner','reviewed',$6)`,
      [`appr-${nonce()}`, runId, projectId, work.task, '2026-10-04T02:05:00.000Z', `ak-${nonce()}`]);
    await pool.query(`INSERT INTO relay_wonderland.julius_trajectory_events(trajectory_event_id,run_id,project_id,event_kind,task_id,worker_id,provider_id,runtime_version,policy_version,
        card_revision,mission_contract_revision,project_brain_revision,duration_ms,outcome,idempotency_key,occurred_at)
      VALUES($1,$2,$3,'PROVIDER_SELECTED',$4,'w1','provider-a','test','policy:1','card:test:1',1,0,900,'SELECTED',$5,'2026-10-04T02:06:00.000Z')`,
      [`traj-${nonce()}`, runId, projectId, work.task, `tk-${nonce()}`]);
    expect((await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: { operation: 'CREATE', idempotencyKey: `ho-st-${nonce()}`,
      domain: 'REQUIREMENT', scope: 'PROJECT', runId: null, title: 'Keep the logs', body: 'all of them', subjectRef: null, verdict: null, links: [] } })).ok).toBe(true);
    durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `ho-pin-${nonce()}`, runId }) }));
    const before = await juliusFingerprint(pool, runId);
    expect(before, 'the fingerprint holds the work it guards').toContain(work.evidence);
    expect(before).toContain('provider-a');
    expect(before).toContain('founder:owner');
    // The handoff's OWN record -- its state, its mutation in provenance, its event in activity -- is all that may differ.
    const HANDOFF_OWN = new Set(['MISSION_HANDOFF', 'MUTATION_HANDOFF_ENTER', 'MUTATION_HANDOFF_EXIT', 'project_brain.handoff.entered', 'project_brain.handoff.returned']);
    const presentation = async () => {
      const document = (await brain.readDocument({ projectId }))!;
      const sections = Object.fromEntries(Object.entries(document.sections).map(([name, items]) => [name, items.filter((entry) => !HANDOFF_OWN.has(entry.kind))]));
      return JSON.stringify({ missions: document.missions, sections, links: document.links, coherence: document.coherence });
    };
    const documentBefore = await presentation();
    const enterKey = `enter-${nonce()}`;
    const enter = () => components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: enterKey, runId, expectedVersion: 0 }) });
    const first = durable(await enter());
    expect(first).toMatchObject({ state: 'HANDED_OFF', version: 1 });
    const replay = await enter();
    expect(replay.ok && replay.replayed, 'a duplicated handoff event is answered from the log').toBe(true);
    expect(replay.ok && replay.result.mutationId).toBe(first.mutationId);
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `again-${nonce()}`, runId, expectedVersion: 1 }) })), 'a repeated /handoff').toBe('already_handed_off');
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_EXIT', idempotencyKey: `stale-${nonce()}`, runId, expectedVersion: 0 }) })), 'a stale handoff event').toBe('version_conflict');
    // RESTART DURING THE HANDOFF: another process reads the same state, then resumes it.
    const restarted = new Pool({ connectionString: databaseUrl!, max: 2 });
    try {
      const other = new ProjectBrainComponentStore(restarted);
      expect((await other.read(projectId, runId))?.handoffs).toEqual([expect.objectContaining({ runId, state: 'HANDED_OFF', version: 1, form: 'angelic_twin_swords' })]);
      durable(await other.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_EXIT', idempotencyKey: `exit-${nonce()}`, runId, expectedVersion: 1 }) }));
      durable(await other.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `re-enter-${nonce()}`, runId, expectedVersion: 2 }) }));
    } finally {
      await restarted.end();
    }
    expect(await juliusFingerprint(pool, runId), 'the same mission, objective, progress, provider, approvals, reviewer, budget and evidence').toBe(before);
    expect(await presentation(), 'the same Project Brain in every section but the handoff: only the presentation changed').toBe(documentBefore);
    const history = await pool.query<{ v: string }>("SELECT version || ':' || state AS v FROM relay_wonderland.project_brain_handoff_versions WHERE run_id=$1 ORDER BY version", [runId]);
    expect(history.rows.map((r) => r.v)).toEqual(['1:HANDED_OFF', '2:RETURNED', '3:HANDED_OFF']);
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `done-${nonce()}`, runId: finished, expectedVersion: 0 }) }))).toBe('mission_finished');
    const runs = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE project_id=$1', [projectId]);
    expect(runs.rows[0]!.n, 'a handoff never makes a mission').toBe(2);
  });

  it('EVALS: an eval qualifies only the exact revision it judged; the next one supersedes it; an owner invalidates; another run\'s evidence never qualifies', async () => {
    const projectId = `prj-eval-${nonce()}`;
    const runId = `run:eval-${nonce()}`;
    const otherRun = `run:eval-other-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId, otherRun] });
    const record = (subjectRevision: string, result: string, evidenceRefs: string[] = [`mission:${runId}`]) => components.mutateComponent({
      projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `eval-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision, criterion: 'the suite passes', result, evidenceRefs }),
    });
    const first = durable(await record('c1aaaaa', 'PASS'));
    const second = durable(await record('c2bbbbb', 'PASS'));
    expect(second.alsoChanged).toEqual([`superseded:${first.componentRef}`]);
    const rows = (await components.read(projectId))!.evals;
    const byId = new Map(rows.map((row) => [row.evalId, row]));
    expect(byId.get(first.componentRef)).toMatchObject({ status: 'SUPERSEDED', supersededBy: second.componentRef, version: 2 });
    expect(rows.filter((row) => projectBrainEvalQualifies(row, `mission:${runId}`, 'c2bbbbb')).map((row) => row.evalId)).toEqual([second.componentRef]);
    expect(rows.filter((row) => projectBrainEvalQualifies(row, `mission:${runId}`, 'c1aaaaa')), 'the old PASS qualifies nothing now').toEqual([]);
    expect(refusal(await record('c3ccccc', 'PASS', [`mission:${otherRun}`])), 'evidence from another mission').toBe('evidence_from_another_run');
    // Fail closed beyond the missions themselves: another run's statement, a project-wide statement and a card never qualify.
    const statement = async (run: string | null) => brainDurableRef(await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: OWNER,
      command: { operation: 'CREATE', idempotencyKey: `ev-st-${nonce()}`, domain: 'RESEARCH_NOTE', scope: run === null ? 'PROJECT' : 'MISSION', runId: run, title: 'a note', body: '', subjectRef: null, verdict: null, links: [] } }));
    const own = await statement(runId);
    for (const [why, ref] of [["another run's statement", await statement(otherRun)], ['a project-wide statement', await statement(null)]] as const) {
      expect(refusal(await record('c3ccccc', 'PASS', [ref])), why).toBe('evidence_from_another_run');
    }
    // A card is not evidence at all: the door refuses it before any store sees it (cards are not an EVAL_EVIDENCE_TYPE).
    // This case first ran on a real PostgreSQL at r7 and named the store's refusal for it, which the door never reaches.
    const asCard = parseProjectBrainComponentMutation({ operation: 'EVAL_RECORD', idempotencyKey: `card-${nonce()}`, runId,
      subjectRef: `mission:${runId}`, subjectRevision: 'c3ccccc', criterion: 'the suite passes', result: 'PASS', evidenceRefs: ['pbcard:default'] });
    expect(asCard.ok ? 'accepted' : asCard.code, 'a card').toBe('evidence_invalid');
    expect(refusal(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: OWNER,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `p-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c4', criterion: 'x', result: 'FAIL', evidenceRefs: [] }) }))).toBe('evaluator_required');
    expect(refusal(await components.mutateComponent({ projectId, provenance: OPERATOR('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_INVALIDATE', idempotencyKey: `inv-e-${nonce()}`, evalId: second.componentRef, expectedVersion: 1 }) }))).toBe('capability_missing');
    durable(await components.mutateComponent({ projectId, provenance: OPERATOR('p1'), capabilities: OWNER,
      command: cmd({ operation: 'EVAL_INVALIDATE', idempotencyKey: `inv-${nonce()}`, evalId: second.componentRef, expectedVersion: 1 }) }));
    const after = (await components.read(projectId))!.evals;
    expect(after.filter((row) => projectBrainEvalQualifies(row, `mission:${runId}`, 'c2bbbbb')), 'an invalidated eval qualifies nothing').toEqual([]);
    const currents = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.project_brain_evals WHERE project_id=$1 AND status='CURRENT'", [projectId]);
    expect(currents.rows[0]!.n).toBe(0);
    // ...while this mission's own statement does (the control: the refusals above are about WHOSE evidence, not about statements).
    const ownEval = durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `own-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c5eeeee', criterion: 'its own note', result: 'PASS', evidenceRefs: [own] }) }));
    expect((await components.read(projectId))!.evals.filter((row) => projectBrainEvalQualifies(row, `mission:${runId}`, 'c5eeeee')).map((row) => row.evalId)).toEqual([ownEval.componentRef]);
  });

  it('ISOLATION: another project cannot select, pin, hand off or judge with this project\'s ids -- they read as missing', async () => {
    const a = `prj-iso-a-${nonce()}`;
    const b = `prj-iso-b-${nonce()}`;
    const runA = `run:iso-${nonce()}`;
    await seedProject(pool, { projectId: a, tenantId: 'p1', runs: [runA] });
    await seedProject(pool, { projectId: b, tenantId: 'p1' });
    const cardA = durable(await components.mutateComponent({ projectId: a, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `iso-c-${nonce()}`, card: CARD }) })).componentRef;
    const inB = (command: Record<string, unknown>, provenance: ProjectBrainProvenance = PLAYER('p1')) => components.mutateComponent({ projectId: b, provenance, capabilities: OWNER, command: cmd(command) });
    expect(refusal(await inB({ operation: 'CARD_SELECT', idempotencyKey: `iso-s-${nonce()}`, cardRef: cardA, expectedSelectionVersion: 0 }))).toBe('card_not_found');
    expect(refusal(await inB({ operation: 'CARD_UPDATE', idempotencyKey: `iso-u-${nonce()}`, cardId: cardA, expectedVersion: 1, card: CARD }))).toBe('card_not_found');
    expect(refusal(await inB({ operation: 'MISSION_PIN_CARD', idempotencyKey: `iso-p-${nonce()}`, runId: runA }, RUNTIME))).toBe('run_not_found');
    expect(refusal(await inB({ operation: 'HANDOFF_ENTER', idempotencyKey: `iso-h-${nonce()}`, runId: runA, expectedVersion: 0 }))).toBe('run_not_found');
    expect(refusal(await inB({ operation: 'EVAL_RECORD', idempotencyKey: `iso-e-${nonce()}`, runId: null, subjectRef: `mission:${runA}`, subjectRevision: 'c1', criterion: 'x', result: 'FAIL', evidenceRefs: [] }, RUNTIME))).toBe('ref_not_found');
    expect((await components.read(b))?.cards).toEqual([]);
    // The database itself refuses a cross-project pin even with the store bypassed.
    await expect(pool.query(`INSERT INTO relay_wonderland.project_brain_mission_cards(run_id,project_id,card_ref,card_version,content_hash,mutation_id,pinned_at)
      VALUES($1,$2,'pbcard:default',1,$3,'pbm:none',now())`, [runA, b, 'a'.repeat(64)])).rejects.toThrow(/project_brain_cross_project/u);
  });

  it('RACES: concurrent selections and concurrent handoffs on one version -- exactly one wins, every other is refused by name', async () => {
    const projectId = `prj-race-${nonce()}`;
    const runId = `run:race-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const cards = await Promise.all(Array.from({ length: 4 }, () => components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `race-c-${nonce()}`, card: CARD }) })));
    const ids = cards.map((c) => durable(c).componentRef);
    const selects = await Promise.all(ids.map((cardRef) => components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `race-s-${nonce()}`, cardRef, expectedSelectionVersion: 0 }) })));
    expect(selects.filter((o) => o.ok)).toHaveLength(1);
    expect(selects.filter((o) => !o.ok).map(refusal)).toEqual(['version_conflict', 'version_conflict', 'version_conflict']);
    const handoffs = await Promise.all(Array.from({ length: 6 }, () => components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `race-h-${nonce()}`, runId, expectedVersion: 0 }) })));
    expect(handoffs.filter((o) => o.ok)).toHaveLength(1);
    expect(new Set(handoffs.filter((o) => !o.ok).map(refusal))).toEqual(new Set(['version_conflict']));
    const seq = await pool.query<{ s: string }>("SELECT string_agg(sequence::text, ',' ORDER BY sequence) AS s FROM relay_wonderland.events WHERE stream_id=$1", [`project-brain:${projectId}`]);
    expect(seq.rows[0]!.s, 'the stream stays dense: no event for a refused change').toBe('1,2,3,4,5,6');
  });

  it('CORRUPTION FAILS CLOSED: a card whose stored content no longer matches its hash is never read as valid, and never changed further', async () => {
    const projectId = `prj-corrupt-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    const cardId = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `cor-${nonce()}`, card: CARD }) })).componentRef;
    const client = await pool.connect();
    try {
      await client.query('SET session_replication_role = replica'); // bypass the guard, as a disk fault or a stray tool would
      await client.query(`UPDATE relay_wonderland.project_brain_cards SET content=jsonb_set(content,'{skin}','"tampered"') WHERE card_id=$1`, [cardId]);
      await client.query('SET session_replication_role = origin');
    } finally {
      client.release();
    }
    await expect(components.read(projectId)).rejects.toThrow(/project_brain_corrupt: project_brain_cards/u);
    await expect(brain.readDocument({ projectId })).rejects.toThrow(/project_brain_corrupt/u);
    const change = await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_UPDATE', idempotencyKey: `cor-u-${nonce()}`, cardId, expectedVersion: 1, card: { ...CARD, name: 'Renamed' } }) });
    expect(refusal(change)).toBe('project_brain_corrupt');
  });

  it('CORRUPTION FAILS CLOSED FOR RECORDS TOO: a tampered statement is never served, ranked into Julius\'s context, or revised', async () => {
    const projectId = `prj-corrupt-record-${nonce()}`;
    const runId = `run:corrupt-record-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const created = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: { operation: 'CREATE', idempotencyKey: `rec-${nonce()}`, domain: 'REQUIREMENT', scope: 'PROJECT', runId: null, title: 'Keep the logs', body: 'all of them', subjectRef: null, verdict: null, links: [] } });
    if (!created.ok) throw new Error(created.code);
    const recordId = created.result.recordRef!;
    const client = await pool.connect();
    try {
      await client.query('SET session_replication_role = replica');
      await client.query("UPDATE relay_wonderland.project_brain_records SET body='none of them' WHERE record_id=$1", [recordId]);
      await client.query('SET session_replication_role = origin');
    } finally {
      client.release();
    }
    await expect(brain.readDocument({ projectId })).rejects.toThrow(/project_brain_corrupt: project_brain_records/u);
    await expect(brain.contextEntriesForRun(runId, projectId), 'never ranked into a mission\'s context').rejects.toThrow(/project_brain_corrupt/u);
    const revise = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: { operation: 'REVISE', idempotencyKey: `rev-${nonce()}`, recordId, expectedVersion: 1, title: 'Keep some logs', body: null } });
    expect(revise.ok ? 'durable' : revise.code).toBe('project_brain_corrupt');
  });

  it('WRONG-SHAPED JSON FAILS CLOSED (PB-F5): a mission snapshot or a stored replay result of the wrong shape is corruption by name, never an empty value', async () => {
    const projectId = `prj-shape-${nonce()}`;
    const runId = `run:shape-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const tamper = async (sql: string, values: unknown[]) => {
      const client = await pool.connect();
      try {
        await client.query('SET session_replication_role = replica');
        await client.query(sql, values);
        await client.query('SET session_replication_role = origin');
      } finally {
        client.release();
      }
    };
    const snapshot = (value: unknown) => tamper(`UPDATE relay_wonderland.mission_contracts SET snapshot=$2::jsonb WHERE mission_id=$1`, [`mission:${runId}`, JSON.stringify(value)]);
    // The controls first: a stated scope reads as stated, and an optional key that is absent or null is "not stated".
    await snapshot({ objective: 'o', scope: { systemsInScope: ['relay'], systemsOutOfScope: [] } });
    expect((await brain.readRows({ projectId }))?.missions[0]?.policy.systemsInScope).toEqual(['relay']);
    await snapshot({ objective: 'o', scope: null });
    expect((await brain.readRows({ projectId }))?.missions[0]?.policy.systemsInScope).toEqual([]);
    for (const [why, value, column] of [
      ['a scope that is not an object', { objective: 'o', scope: 'everything' }, 'snapshot.scope'],
      ['a list holding a non-string', { objective: 'o', scope: { systemsInScope: ['relay', 3] } }, 'snapshot.scope.systemsInScope'],
      ['a permission list that is an object', { objective: 'o', requestedPermissions: { all: true } }, 'snapshot.requestedPermissions'],
      ['a snapshot that is a list', ['o'], 'snapshot'],
    ] as const) {
      await snapshot(value);
      await expect(brain.readDocument({ projectId }), why).rejects.toThrow(new RegExp(`project_brain_corrupt: mission_contracts mission:${runId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}: ${column.split('.').join('\\.')} `, 'u'));
    }
    await snapshot({ objective: 'o' });

    // An idempotent replay answers with the STORED result: a corrupt one is refused by name, never answered as an empty success.
    const command = { operation: 'CREATE', idempotencyKey: `shape-${nonce()}`, domain: 'RESEARCH_NOTE', scope: 'PROJECT', runId: null, title: 'a note', body: '', subjectRef: null, verdict: null, links: [] } as const;
    const first = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command });
    expect(first.ok).toBe(true);
    const replay = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command });
    expect(replay.ok && replay.replayed ? 'replayed' : 'not replayed', 'the control: an intact result replays').toBe('replayed');
    await tamper(`UPDATE relay_wonderland.project_brain_mutations SET result='[]'::jsonb WHERE project_id=$1 AND idempotency_key=$2`, [projectId, command.idempotencyKey]);
    const corrupt = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command });
    expect(corrupt.ok ? 'durable' : `${corrupt.code}/${String(corrupt.durable)}`).toBe('project_brain_corrupt/false');
  });

  it('THE FOUNDER\'S ROUND TRIP: every statement domain, adopted, revised, linked, with a card, a pin, a handoff and an eval -- a restarted process reads the IDENTICAL Brain', async () => {
    const projectId = `prj-roundtrip-${nonce()}`;
    const runId = `run:roundtrip-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const COMPANION: ProjectBrainProvenance = { author: { kind: 'COMPANION', id: 'c1' }, deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' } };
    const create = async (domain: string, provenance: ProjectBrainProvenance = PLAYER('p1'), extra: Partial<Record<string, unknown>> = {}) => {
      const command = { operation: 'CREATE', idempotencyKey: `rt-${domain}-${nonce()}`, domain, scope: 'PROJECT', runId: null, title: `${domain} statement`,
        body: `What the project was told about ${domain.toLowerCase()}.`, subjectRef: null, verdict: null, links: [], ...extra } as unknown as ProjectBrainMutationCommand;
      const outcome = await brain.mutate({ projectId, provenance, capabilities: OWNER, command });
      if (!outcome.ok) throw new Error(`${domain}: ${outcome.code}`);
      return outcome.result;
    };
    const ids: Record<string, string> = {};
    for (const domain of PROJECT_BRAIN_RECORD_DOMAINS) {
      if (domain === 'COMPANION_RESULT') ids[domain] = (await create(domain, COMPANION, { scope: 'MISSION', runId }))!.recordRef!;
      else if (domain === 'MEMORY_REVIEW') ids[domain] = (await create(domain, PLAYER('p1'), { subjectRef: `mission:${runId}`, verdict: 'ACCEPTED' }))!.recordRef!;
      else if (domain === 'FINDING_RESPONSE' || domain === 'GOVERNANCE_ACK') ids[domain] = (await create(domain, PLAYER('p1'), { subjectRef: `mission:${runId}` }))!.recordRef!;
      else ids[domain] = (await create(domain))!.recordRef!;
    }
    expect(Object.keys(ids).sort(), 'one durable statement in EVERY domain').toEqual([...PROJECT_BRAIN_RECORD_DOMAINS].sort());
    const adopted = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: OWNER, command: { operation: 'SET_STATUS', idempotencyKey: `rt-adopt-${nonce()}`, recordId: ids.REQUIREMENT!, expectedVersion: 1, status: 'ADOPTED' } });
    const revised = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: OWNER, command: { operation: 'REVISE', idempotencyKey: `rt-rev-${nonce()}`, recordId: ids.DECISION!, expectedVersion: 1, title: 'DECISION, revised', body: null } });
    const linked = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: OWNER, command: { operation: 'LINK', idempotencyKey: `rt-link-${nonce()}`, fromRef: ids.ACCEPTANCE_CRITERION!, relation: 'REFINES', toRef: ids.REQUIREMENT! } });
    expect([adopted.ok, revised.ok, linked.ok]).toEqual([true, true, true]);
    const cardId = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `rt-card-${nonce()}`, card: CARD }) })).componentRef;
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `rt-sel-${nonce()}`, cardRef: cardId, expectedSelectionVersion: 0 }) }));
    durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `rt-pin-${nonce()}`, runId }) }));
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `rt-ho-${nonce()}`, runId, expectedVersion: 0 }) }));
    durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `rt-ev-${nonce()}`, runId, subjectRef: ids.REQUIREMENT!, subjectRevision: 'c0ffee1', criterion: 'the requirement holds', result: 'PASS', evidenceRefs: [`mission:${runId}`] }) }));

    // ...and Julius's own work on the mission: tasks, evidence, a criterion, a finding, a repair, a decision, transitions.
    const work = await seedJuliusWork(pool, runId);

    const comparable = (document: unknown) => JSON.stringify({ ...(document as Record<string, unknown>), observedAt: null });
    const before = await brain.readDocument({ projectId });
    // CLEAN SHUTDOWN, then a new process's view of the same database.
    const restarted = new Pool({ connectionString: databaseUrl!, max: 2 });
    try {
      const after = await new ProjectBrainPostgresStore(restarted).readDocument({ projectId });
      expect(after, 'the exact durable state: every section, link, mission, count, cursor and revision').not.toBeNull();
      expect(comparable(after)).toBe(comparable(before));
      const sections = after!.sections;
      expect(sections.requirements.find((item) => item.ref === ids.REQUIREMENT)?.status).toBe('ADOPTED');
      expect(sections.decisions.find((item) => item.ref === ids.DECISION)).toMatchObject({ title: 'DECISION, revised', version: 2 });
      for (const [section, domain] of [['objective', 'OBJECTIVE_NOTE'], ['architecture', 'ARCHITECTURE_NOTE'], ['constraints', 'CONSTRAINT'], ['acceptanceCriteria', 'ACCEPTANCE_CRITERION'], ['research', 'RESEARCH_NOTE'], ['findings', 'FINDING_RESPONSE'], ['governance', 'GOVERNANCE_ACK']] as const) {
        expect(sections[section].some((item) => item.ref === ids[domain]), `${domain} reads back in ${section}`).toBe(true);
      }
      expect(after!.links.some((link) => link.fromRef === ids.ACCEPTANCE_CRITERION && link.toRef === ids.REQUIREMENT && link.relation === 'REFINES')).toBe(true);
      expect(sections.cards.find((item) => item.ref === cardId)?.attributes.selected).toBe(true);
      expect(sections.handoffs.find((item) => item.ref === `mission:${runId}#handoff`)?.status).toBe('HANDED_OFF');
      expect(sections.evals.filter((item) => item.kind === 'EVAL').map((item) => item.status)).toEqual(['CURRENT']);
      expect(after!.componentsInstalled).toBe(true);
      expect(after!.coherence.ok, JSON.stringify(after!.coherence)).toBe(true);
      // Julius's side of the same Brain, after the restart: the mission's objective, and every piece of its work by id.
      expect(after!.missions.find((mission) => mission.ref === `mission:${runId}`)?.objective).toBe(`Objective of ${runId}`);
      for (const [section, id] of [['acceptanceCriteria', work.criterion], ['findings', work.finding], ['decisions', work.decision], ['repairs', work.repair], ['evidence', work.evidence]] as const) {
        expect(sections[section].filter((item) => item.ref.includes(id)).length, `${id} reads back in ${section}`).toBeGreaterThan(0);
      }
      const repair = sections.repairs.find((item) => item.ref === `repair:${work.repair}`);
      expect(repair?.evidenceRefs, 'the repair keeps its links: the finding it answered and the evidence it was verified on').toEqual(
        expect.arrayContaining([`evidence:${work.evidence}`]));
      expect(JSON.stringify(repair)).toContain(work.finding);
      // The Compound Agent System's state: the worker topology the mission was given and the sub-agent it spawned.
      expect(sections.governance.find((item) => item.ref === `mission:${runId}#policy`)?.text).toContain('roles: PROMPT_ARCHITECT, CODING_AGENT, INDEPENDENT_REVIEWER');
      expect(sections.trace.find((item) => item.ref === `task:subagent:${work.subagent}`)).toMatchObject({ kind: 'SUBAGENT_SUCCEEDED', attributes: { capability: 'research', depth: 1 } });
      // The C.A.R.D.'s imported capability references and companion slots, by id only.
      expect(sections.cards.find((item) => item.ref === cardId)?.attributes).toMatchObject({
        capabilities: 'MCP:github-mcp-server SKILL:pdf', leftCompanion: 'openai', rightCompanion: 'claude-code' });
    } finally {
      await restarted.end();
    }
  });

  it('TRACEABILITY: every state change, provider step, approval, rejection and lifecycle act answers WHAT, WHO, WHEN, WHICH mission and WHICH table -- read by a restarted process', async () => {
    const projectId = `prj-trace-${nonce()}`;
    const runId = `run:trace-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const work = await seedJuliusWork(pool, runId);
    const at = '2026-10-04T02:10:00.000Z';
    const decidedAt = '2026-10-04T02:11:00.000Z';
    const step = `traj-${nonce()}`;
    await pool.query(`INSERT INTO relay_wonderland.julius_trajectory_events(trajectory_event_id,run_id,project_id,event_kind,task_id,worker_id,provider_id,runtime_version,policy_version,
        card_revision,mission_contract_revision,project_brain_revision,duration_ms,outcome,idempotency_key,occurred_at)
      VALUES($1,$2,$3,'PROVIDER_SELECTED',$4,'w1','provider-a','test','policy:1','card:test:1',1,0,1200,'SELECTED',$5,$6)`, [step, runId, projectId, work.task, `tk-${nonce()}`, at]);
    const approved = `appr-${nonce()}`;
    const denied = `deny-${nonce()}`;
    for (const [id, state] of [[approved, 'APPROVED'], [denied, 'DENIED']] as const) {
      await pool.query(`INSERT INTO relay_wonderland.julius_approvals(approval_id,run_id,project_id,task_id,operation,policy_revision,reason_code,safe_rationale,state,requested_at,decided_at,decided_by,decision_reason,idempotency_key)
        VALUES($1,$2,$3,$4,'MERGE','policy:1','needs_approval','a merge needs the owner',$5,$6,$7,'founder:owner','reviewed',$8)`, [id, runId, projectId, work.task, state, at, decidedAt, `ak-${nonce()}`]);
    }
    await pool.query(`UPDATE relay_wonderland.julius_runs SET lifecycle_reason='paused for review',lifecycle_actor='founder:owner',lifecycle_at=$2 WHERE run_id=$1`, [runId, at]);

    const restarted = new Pool({ connectionString: databaseUrl!, max: 2 });
    try {
      const document = (await new ProjectBrainPostgresStore(restarted).readDocument({ projectId }))!;
      const item = (section: keyof typeof document.sections, ref: string) => {
        const found = document.sections[section].find((candidate) => candidate.ref === ref);
        if (found === undefined) throw new Error(`${ref} is not in ${section}`);
        return found;
      };
      const answers = (found: ReturnType<typeof item>) => ({ what: found.title, who: `${found.author?.kind}:${found.author?.id}`, via: found.deliverer?.kind,
        when: found.recordedAt, mission: found.missionRef, table: found.sourceTable });
      expect(answers(item('trace', `transition:${work.transitions[1]}`))).toEqual(
        { what: 'PLANNING → EXECUTING', who: 'JULIUS:julius', via: 'JULIUS_RUNTIME', when: '2026-10-04T02:00:00.000Z', mission: `mission:${runId}`, table: 'julius_transitions' });
      const provider = item('trace', `trajectory:${step}`);
      expect({ ...answers(provider), who: provider.author?.id }).toEqual(
        { what: 'PROVIDER_SELECTED: SELECTED', who: 'w1', via: 'JULIUS_RUNTIME', when: at, mission: `mission:${runId}`, table: 'julius_trajectory_events' });
      expect(provider.attributes).toMatchObject({ providerId: 'provider-a', taskId: work.task, durationMs: 1200 });
      for (const [id, state] of [[approved, 'APPROVED'], [denied, 'DENIED']] as const) {
        const approval = item('governance', `approval:${id}`);
        expect({ status: approval.status, when: approval.recordedAt, decidedBy: approval.attributes.decidedBy, table: approval.sourceTable, mission: approval.missionRef }, `the ${state} decision`)
          .toEqual({ status: state, when: decidedAt, decidedBy: 'founder:owner', table: 'julius_approvals', mission: `mission:${runId}` });
      }
      expect(answers(item('governance', `mission:${runId}#lifecycle`))).toEqual(
        { what: 'EXECUTING by founder:owner', who: 'FOUNDER:founder:owner', via: 'OPERATOR_API', when: at, mission: `mission:${runId}`, table: 'julius_runs' });
      // WHY: the decision that accepted the work cites the evidence it rested on, and that evidence is held by this mission.
      expect(item('decisions', `decision:${work.decision}`).evidenceRefs).toEqual([`evidence:${work.evidence}`]);
      expect(document.coherence.ok, JSON.stringify(document.coherence)).toBe(true);
    } finally {
      await restarted.end();
    }
  });

  it('SECRET SAFETY ACROSS EVERY STATEMENT DOMAIN: a synthetic credential in any title or body is refused, and the literal is durable nowhere', async () => {
    const projectId = `prj-secret-records-${nonce()}`;
    const runId = `run:secret-records-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const COMPANION: ProjectBrainProvenance = { author: { kind: 'COMPANION', id: 'c1' }, deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' } };
    let attempts = 0;
    for (const domain of PROJECT_BRAIN_RECORD_DOMAINS) {
      for (const secret of [FAKE_SK, FAKE_GH]) {
        for (const field of ['title', 'body'] as const) {
          const command = { operation: 'CREATE', idempotencyKey: `sr-${nonce()}`, domain, scope: domain === 'COMPANION_RESULT' ? 'MISSION' : 'PROJECT',
            runId: domain === 'COMPANION_RESULT' ? runId : null, title: field === 'title' ? `key ${secret}` : 'a title', body: field === 'body' ? `the key is ${secret}` : '',
            subjectRef: ['MEMORY_REVIEW', 'FINDING_RESPONSE', 'GOVERNANCE_ACK'].includes(domain) ? `mission:${runId}` : null,
            verdict: domain === 'MEMORY_REVIEW' ? 'ACCEPTED' : null, links: [] } as unknown as ProjectBrainMutationCommand;
          // Straight to the store, as a caller inside the process would: the store must refuse what the door would.
          const outcome = await brain.mutate({ projectId, provenance: domain === 'COMPANION_RESULT' ? COMPANION : PLAYER('p1'), capabilities: OWNER, command });
          attempts += 1;
          expect(outcome.ok ? 'durable' : outcome.code, `${domain}.${field}`).toBe('credential_in_content');
        }
      }
    }
    expect(attempts).toBe(PROJECT_BRAIN_RECORD_DOMAINS.length * 4);
    const everything = await pool.query<{ t: string }>(`SELECT string_agg(x.c, '\n') AS t FROM (
        SELECT row_to_json(r)::text AS c FROM relay_wonderland.project_brain_records r UNION ALL SELECT row_to_json(v)::text FROM relay_wonderland.project_brain_record_versions v
        UNION ALL SELECT row_to_json(m)::text FROM relay_wonderland.project_brain_mutations m UNION ALL SELECT payload::text FROM relay_wonderland.events) x`);
    for (const secret of [FAKE_SK, FAKE_GH]) expect(everything.rows[0]?.t ?? '', 'the literal never reached a durable row').not.toContain(secret);
  });

  it('A STORE WITHOUT 034 says the components are NOT INSTALLED -- never an empty C.A.R.D. list -- and refuses component writes by name', async () => {
    const admin = new Pool({ connectionString: databaseUrl!, max: 1 });
    const name = `pb_no034_${nonce()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!); url.pathname = `/${name}`;
    const old = new Pool({ connectionString: url.toString(), max: 2 });
    try {
      // The chain's PREFIX up to 034 (never "every migration but 034": 035 follows 034, and its guard refuses a store
      // without 034). indexOf is checked first: -1 would make slice(0, -1) every migration but the last.
      const at = WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_034);
      expect(at, '034 is registered, after the migrations it needs').toBeGreaterThan(0);
      for (const sql of WONDERLAND_MIGRATIONS.slice(0, at)) await old.query(sql);
      const last = await old.query<{ v: string }>('SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations');
      expect(last.rows[0]!.v, 'the store stops right before 034').toBe('033_wonderland_social');
      const projectId = `prj-no034-${nonce()}`;
      await seedProject(old, { projectId, tenantId: 'p1', runs: [`run:no034-${nonce()}`] });
      const document = await new ProjectBrainPostgresStore(old).readDocument({ projectId });
      expect(document?.componentsInstalled).toBe(false);
      expect(document?.sections.cards).toEqual([]);
      const write = await new ProjectBrainComponentStore(old).mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `no034-${nonce()}`, card: CARD }) });
      expect(write.ok ? 'durable' : `${write.code}/${String(write.durable)}`).toBe('project_brain_components_not_installed/false');
    } finally {
      // pool.end() resolves before its idle clients have closed, so the DROP ... WITH (FORCE) below can reach a client that is
      // still closing, and pg-pool re-emits that 57P01 as the pool's 'error' (#344's class; CI run 37676864404, executor-private).
      // The terminate is this test's own teardown.
      old.on('error', () => undefined);
      await old.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('A STORE NEWER THAN THE CODE is neither read nor written: every path refuses project_brain_schema_newer by name; without the unknown version it reads again', async () => {
    const admin = new Pool({ connectionString: databaseUrl!, max: 1 });
    const name = `pb_newer_${nonce()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!); url.pathname = `/${name}`;
    const newer = new Pool({ connectionString: url.toString(), max: 2 });
    try {
      for (const sql of WONDERLAND_MIGRATIONS) await newer.query(sql);
      const projectId = `prj-newer-${nonce()}`;
      const runId = `run:newer-${nonce()}`;
      await seedProject(newer, { projectId, tenantId: 'p1', runs: [runId] });
      const records = new ProjectBrainPostgresStore(newer);
      const cards = new ProjectBrainComponentStore(newer);
      const note = (key: string) => records.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
        command: { operation: 'CREATE', idempotencyKey: key, domain: 'RESEARCH_NOTE', scope: 'PROJECT', runId: null, title: 'a note', body: '', subjectRef: null, verdict: null, links: [] } });
      expect((await note(`newer-0-${nonce()}`)).ok, 'the control: this build reads and writes its own schema').toBe(true);

      const future = '099_from_a_newer_build';
      await newer.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', [future]);
      const named = new RegExp(`project_brain_schema_newer: .*${future}`, 'u');
      await expect(records.readDocument({ projectId }), 'the document').rejects.toThrow(named);
      await expect(records.eventsAfter({ projectId, cursor: {} }), 'the live feed').rejects.toThrow(named);
      await expect(records.head(projectId), 'the feed head').rejects.toThrow(named);
      await expect(records.contextEntriesForRun(runId, projectId), 'Julius\'s mission context').rejects.toThrow(named);
      await expect(cards.read(projectId), 'the components').rejects.toThrow(named);
      await expect(cards.pinnedCard(projectId, runId), 'a pinned card').rejects.toThrow(named);
      const write = await note(`newer-1-${nonce()}`);
      expect(write.ok ? 'durable' : `${write.code}/${String(write.durable)}`, 'a record write').toBe('project_brain_schema_newer/false');
      const card = await cards.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `newer-c-${nonce()}`, card: CARD }) });
      expect(card.ok ? 'durable' : `${card.code}/${String(card.durable)}`, 'a component write').toBe('project_brain_schema_newer/false');
      const written = await newer.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.project_brain_mutations WHERE project_id=$1", [projectId]);
      expect(written.rows[0]!.n, 'nothing was written while the store was newer').toBe(1);

      await newer.query('DELETE FROM relay_wonderland.schema_migrations WHERE version=$1', [future]);
      expect((await records.readDocument({ projectId }))?.sections.research.length, 'the same store reads again once it is not newer').toBe(1);
    } finally {
      // pool.end() resolves before its idle clients have closed, so the DROP ... WITH (FORCE) below can reach a client that is
      // still closing, and pg-pool re-emits that 57P01 as the pool's 'error' (#344's class; CI run 37676864404, executor-private).
      // The terminate is this test's own teardown.
      newer.on('error', () => undefined);
      await newer.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('A LARGE PROJECT BRAIN: past every read limit the read stays bounded and names what it cut, coherence refuses to pass a cut set, the feed delivers every event once, and writes stay exact', async () => {
    const projectId = `prj-large-${nonce()}`;
    const runId = `run:large-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    // 1,100 statements through the REAL write path (each its own transaction, version, mutation row and event)...
    const RECORDS = 1100;
    for (let i = 0; i < RECORDS; i += 1) {
      const outcome = await brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
        command: { operation: 'CREATE', idempotencyKey: `large-${i}-${nonce()}`, domain: 'RESEARCH_NOTE', scope: 'PROJECT', runId: null, title: `note ${i}`, body: `finding number ${i}`, subjectRef: null, verdict: null, links: [] } });
      if (!outcome.ok) throw new Error(`record ${i}: ${outcome.code}`);
    }
    // ...and 600 pieces of Julius evidence on one run (past the 500-row limit).
    const task = `task-large-${nonce()}`;
    await pool.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal) VALUES($1,$2,'IMPLEMENTER','IMPLEMENT','SUCCEEDED',0)`, [task, runId]);
    await pool.query(`INSERT INTO relay_wonderland.julius_evidence(evidence_id,run_id,task_id,worker_id,evidence_type,status,safe_summary,occurred_at,idempotency_key)
      SELECT $1 || g, $2, $3, 'w1', 'TEST_RUN', 'PASSED', 'ok', now(), $1 || g FROM generate_series(1, 600) g`, [`ev-large-${nonce()}-`, runId, task]);

    const started = Date.now();
    const document = (await brain.readDocument({ projectId }))!;
    const elapsed = Date.now() - started;
    expect(elapsed, `a ${RECORDS}-statement Brain reads in ${elapsed} ms`).toBeLessThan(15_000);
    expect(JSON.stringify(document).length, 'the document stays bounded').toBeLessThan(8_000_000);
    expect(document.sections.research.length, 'at most the record limit').toBe(PROJECT_BRAIN_READ_LIMITS.records);
    expect(document.sections.evidence.length).toBe(PROJECT_BRAIN_READ_LIMITS.rows);
    expect(document.truncated, 'what was cut is named').toEqual(expect.arrayContaining(['records', 'evidence', 'events', 'mutations']));
    expect(document.coherence.ok, 'a window cannot prove an absence: the cut rules are skipped, so the report is not ok').toBe(false);
    expect(document.coherence.skipped.join(' ')).toContain('evidence');
    expect(document.coherence.violations).toEqual([]);
    // The newest come first: the last statement written is in the window.
    expect(document.sections.research.some((item) => item.title === `note ${RECORDS - 1}`)).toBe(true);

    // The feed: page by page from the start, every event of this project exactly once, in each stream's order.
    const total = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.events WHERE project_id=$1 AND visibility='PROJECT' AND (event_type LIKE 'julius.%' OR event_type LIKE 'project_brain.%')", [projectId]);
    const seen = new Set<string>();
    let cursor = {};
    for (let page = 0; page < 50; page += 1) {
      const next = await brain.eventsAfter({ projectId, cursor });
      expect(next.events.length).toBeLessThanOrEqual(200);
      for (const event of next.events) {
        expect(seen.has(event.eventId), `${event.eventId} delivered twice`).toBe(false);
        seen.add(event.eventId);
      }
      cursor = next.cursor;
      if (next.events.length === 0) break;
    }
    expect(seen.size, 'every event, once').toBe(total.rows[0]!.n);
    expect(seen.size).toBeGreaterThanOrEqual(RECORDS);

    // Writes stay exact at this size: the revision moves by one per change, and a stale version is still refused.
    const target = document.sections.research[0]!;
    const revise = (expectedVersion: number) => brain.mutate({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: { operation: 'REVISE', idempotencyKey: `large-rev-${nonce()}`, recordId: target.ref, expectedVersion, title: 'revised at scale', body: null } });
    const revisionBefore = (await brain.readRows({ projectId }))!.revision;
    expect((await revise(1)).ok).toBe(true);
    const stale = await revise(1);
    expect(stale.ok ? 'durable' : stale.code, 'a stale version at scale').toBe('version_conflict');
    expect((await brain.readRows({ projectId }))!.revision, 'one change, one revision').toBe(revisionBefore + 1);
  }, 240_000);

  it('MULTIPLAYER MEMBERSHIP: an owner admits an admin and members; each holds exactly its rights in the Brain; every change is versioned, audited and replay-safe', async () => {
    const projectId = `prj-members-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'owner-m', runs: [`run:members-${nonce()}`] });
    const members = new ProjectBrainMembersStore(pool);
    const as = (playerId: string) => ({ provenance: PLAYER(playerId), actorId: playerId, capabilities: projectBrainCapabilitiesFor('OWNER') });
    const change = (actor: string, command: Record<string, unknown>) => members.change({ projectId, ...as(actor), command: command as never });
    const result = (outcome: ProjectBrainMemberOutcome) => (outcome.ok ? 'durable' : outcome.code);
    const key = () => `mem-${nonce()}`;
    const roleOf = async (playerId: string) => brain.membershipRole({ projectId, playerId });

    // The owner admits an admin and a member.
    const admit = { operation: 'MEMBER_SET', idempotencyKey: key(), playerId: 'admin-m', role: 'ADMIN', expectedRole: null };
    expect(result(await change('owner-m', admit))).toBe('durable');
    const replay = await change('owner-m', admit);
    expect(replay.ok && replay.replayed, 'the same change sent twice is answered from the log').toBe(true);
    expect(result(await change('owner-m', { ...admit, role: 'MEMBER' })), 'a key reused for another change').toBe('idempotency_conflict');
    expect(result(await change('owner-m', { operation: 'MEMBER_SET', idempotencyKey: key(), playerId: 'member-1', role: 'MEMBER', expectedRole: null }))).toBe('durable');
    // The admin admits a member, but never an admin, and never touches the owner or itself.
    expect(result(await change('admin-m', { operation: 'MEMBER_SET', idempotencyKey: key(), playerId: 'member-2', role: 'MEMBER', expectedRole: null }))).toBe('durable');
    expect(result(await change('admin-m', { operation: 'MEMBER_SET', idempotencyKey: key(), playerId: 'admin-2', role: 'ADMIN', expectedRole: null }))).toBe('owner_required');
    expect(result(await change('admin-m', { operation: 'MEMBER_REMOVE', idempotencyKey: key(), playerId: 'owner-m', expectedRole: 'OWNER' }))).toBe('owner_is_permanent');
    expect(result(await change('admin-m', { operation: 'MEMBER_REMOVE', idempotencyKey: key(), playerId: 'admin-m', expectedRole: 'ADMIN' }))).toBe('own_membership');
    // A member manages nothing, whatever capabilities a caller claims for it: the store reads the member's role itself.
    expect(result(await change('member-1', { operation: 'MEMBER_SET', idempotencyKey: key(), playerId: 'friend', role: 'MEMBER', expectedRole: null }))).toBe('members_not_permitted');
    expect([await roleOf('admin-m'), await roleOf('member-1'), await roleOf('member-2'), await roleOf('friend')]).toEqual(['ADMIN', 'MEMBER', 'MEMBER', null]);

    // In the Brain: a member proposes; only the owner or the admin adopts; nobody rewrites another's statement.
    const proposal = await brain.mutate({ projectId, provenance: PLAYER('member-1'), capabilities: projectBrainCapabilitiesFor(await roleOf('member-1')),
      command: { operation: 'CREATE', idempotencyKey: key(), domain: 'REQUIREMENT', scope: 'PROJECT', runId: null, title: 'Keep the logs', body: '', subjectRef: null, verdict: null, links: [] } });
    if (!proposal.ok) throw new Error(proposal.code);
    const recordId = proposal.result.recordRef!;
    const adopt = (playerId: string, expectedVersion: number) => brain.mutate({ projectId, provenance: PLAYER(playerId), capabilities: projectBrainCapabilitiesFor('MEMBER'),
      command: { operation: 'SET_STATUS', idempotencyKey: key(), recordId, expectedVersion, status: 'ADOPTED' } });
    const memberAdopt = await adopt('member-2', 1);
    expect(memberAdopt.ok ? 'durable' : memberAdopt.code, 'a member never adopts').toBe('capability_missing');
    const adminAdopt = await brain.mutate({ projectId, provenance: PLAYER('admin-m'), capabilities: projectBrainCapabilitiesFor(await roleOf('admin-m')),
      command: { operation: 'SET_STATUS', idempotencyKey: key(), recordId, expectedVersion: 1, status: 'ADOPTED' } });
    expect(adminAdopt.ok, 'an admin adopts').toBe(true);
    const rewrite = await brain.mutate({ projectId, provenance: PLAYER('member-2'), capabilities: projectBrainCapabilitiesFor('MEMBER'),
      command: { operation: 'REVISE', idempotencyKey: key(), recordId, expectedVersion: 2, title: 'Keep no logs', body: null } });
    expect(rewrite.ok ? 'durable' : rewrite.code, 'a member never rewrites another\'s statement').not.toBe('durable');

    // Removal takes effect at once: the next lookup finds no membership, so every door reads the project as missing.
    expect(result(await change('admin-m', { operation: 'MEMBER_REMOVE', idempotencyKey: key(), playerId: 'member-2', expectedRole: 'MEMBER' }))).toBe('durable');
    expect(await roleOf('member-2')).toBeNull();
    expect(projectBrainCapabilitiesFor(await roleOf('member-2'))).toEqual([]);

    // The audit: every change a version naming its mutation, its author and the role before; the log and the stream agree.
    const history = await pool.query<{ v: string }>(`SELECT player_id || ':' || version || ':' || coalesce(previous_role,'-') || '>' || coalesce(role,'REMOVED') || ':' || changed_by_id AS v
      FROM relay_wonderland.project_brain_member_versions WHERE project_id=$1 ORDER BY changed_at, player_id, version`, [projectId]);
    expect(history.rows.map((row) => row.v)).toEqual(['admin-m:1:->ADMIN:owner-m', 'member-1:1:->MEMBER:owner-m', 'member-2:1:->MEMBER:admin-m', 'member-2:2:MEMBER>REMOVED:admin-m']);
    const logged = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.project_brain_mutations WHERE project_id=$1 AND operation IN ('MEMBER_SET','MEMBER_REMOVE')", [projectId]);
    const announced = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.events WHERE project_id=$1 AND event_type LIKE 'project_brain.member.%'", [projectId]);
    expect([logged.rows[0]!.n, announced.rows[0]!.n]).toEqual([4, 4]);
    const listed = await members.list(projectId);
    expect(listed?.map((member) => `${member.playerId}:${member.role}:${member.version ?? '-'}`)).toEqual(['admin-m:ADMIN:1', 'member-1:MEMBER:1', 'owner-m:OWNER:-']);
    // History is append-only in the database too.
    await expect(pool.query("UPDATE relay_wonderland.project_brain_member_versions SET role='ADMIN' WHERE project_id=$1", [projectId])).rejects.toThrow();
    await expect(pool.query('DELETE FROM relay_wonderland.project_brain_member_versions WHERE project_id=$1', [projectId])).rejects.toThrow();
  });

  it('FOUNDER MEMBER LIMITS ON A REAL STORE: a member contributes and resolves its own; it never resolves, supersedes or rewrites another\'s, never acknowledges governance, never skips a revision check', async () => {
    const projectId = `prj-member-limits-${nonce()}`;
    const runId = `run:member-limits-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'lim-owner', runs: [runId] });
    const members = new ProjectBrainMembersStore(pool);
    for (const [playerId, role] of [['lim-admin', 'ADMIN'], ['lim-a', 'MEMBER'], ['lim-b', 'MEMBER']] as const) {
      const outcome = await members.change({ projectId, provenance: PLAYER('lim-owner'), actorId: 'lim-owner', capabilities: projectBrainCapabilitiesFor('OWNER'),
        command: { operation: 'MEMBER_SET', idempotencyKey: `lim-${nonce()}`, playerId, role, expectedRole: null } });
      expect(outcome.ok).toBe(true);
    }
    const as = async (playerId: string, command: Record<string, unknown>) => {
      const outcome = await brain.mutate({ projectId, provenance: PLAYER(playerId), capabilities: projectBrainCapabilitiesFor(await brain.membershipRole({ projectId, playerId })),
        command: { idempotencyKey: `lim-${nonce()}`, ...command } as never });
      return outcome.ok ? 'durable' : outcome.code;
    };
    const created = async (playerId: string, domain: string) => {
      const outcome = await brain.mutate({ projectId, provenance: PLAYER(playerId), capabilities: projectBrainCapabilitiesFor(await brain.membershipRole({ projectId, playerId })),
        command: { operation: 'CREATE', idempotencyKey: `lim-${nonce()}`, domain, scope: 'PROJECT', runId: null, title: `${domain} by ${playerId}`, body: '',
          subjectRef: domain === 'FINDING_RESPONSE' || domain === 'GOVERNANCE_ACK' ? `mission:${runId}` : null, verdict: null, links: [] } as never });
      return outcome.ok ? outcome.result.recordRef! : outcome.code;
    };
    // A member contributes: a response to a finding, a decision.
    const response = await created('lim-a', 'FINDING_RESPONSE');
    const decision = await created('lim-a', 'DECISION');
    expect([response.startsWith('pbr:'), decision.startsWith('pbr:')]).toEqual([true, true]);
    // Another member resolves, supersedes or rewrites none of it.
    expect(await as('lim-b', { operation: 'SET_STATUS', recordId: response, expectedVersion: 1, status: 'RESOLVED' })).toBe('not_the_author');
    expect(await as('lim-b', { operation: 'SET_STATUS', recordId: decision, expectedVersion: 1, status: 'SUPERSEDED' })).toBe('not_the_author');
    expect(await as('lim-b', { operation: 'REVISE', recordId: decision, expectedVersion: 1, title: 'mine now', body: null })).toBe('not_the_author');
    // Its author does; a stale version is refused even for the author.
    expect(await as('lim-a', { operation: 'SET_STATUS', recordId: response, expectedVersion: 1, status: 'RESOLVED' })).toBe('durable');
    expect(await as('lim-a', { operation: 'REVISE', recordId: decision, expectedVersion: 7, title: 'late', body: null })).toBe('version_conflict');
    // The admin keeps canonical authority over another's statement.
    expect(await as('lim-admin', { operation: 'SET_STATUS', recordId: decision, expectedVersion: 1, status: 'SUPERSEDED' })).toBe('durable');
    // Governance is the owner's and the admin's.
    expect(await created('lim-a', 'GOVERNANCE_ACK')).toBe('governance_not_permitted');
    expect((await created('lim-admin', 'GOVERNANCE_ACK')).startsWith('pbr:')).toBe(true);
    // Every refused write left nothing: the log holds exactly the durable ones.
    const logged = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relay_wonderland.project_brain_mutations WHERE project_id=$1 AND operation IN ('CREATE','REVISE','SET_STATUS')", [projectId]);
    expect(logged.rows[0]!.n).toBe(5);
  });

  it('MEMBERSHIP RACES: two admins change one membership at once -- exactly one wins, the other is refused member_conflict; a revoked admin cannot act on a stale grant', async () => {
    const projectId = `prj-member-race-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'owner-r' });
    const members = new ProjectBrainMembersStore(pool);
    const change = (actor: string, command: Record<string, unknown>, capabilities = projectBrainCapabilitiesFor('OWNER')) =>
      members.change({ projectId, provenance: PLAYER(actor), actorId: actor, capabilities, command: command as never });
    for (const admin of ['admin-a', 'admin-b']) {
      const outcome = await change('owner-r', { operation: 'MEMBER_SET', idempotencyKey: `race-${nonce()}`, playerId: admin, role: 'ADMIN', expectedRole: null });
      expect(outcome.ok).toBe(true);
    }
    for (let round = 0; round < 5; round += 1) {
      const target = `racer-${round}-${nonce()}`;
      const outcomes = await Promise.all(['admin-a', 'admin-b'].map((admin) =>
        change(admin, { operation: 'MEMBER_SET', idempotencyKey: `race-${admin}-${nonce()}`, playerId: target, role: 'MEMBER', expectedRole: null })));
      expect(outcomes.map((outcome) => (outcome.ok ? 'durable' : outcome.code)).sort(), `round ${round}`).toEqual(['durable', 'member_conflict']);
      const versions = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.project_brain_member_versions WHERE project_id=$1 AND player_id=$2', [projectId, target]);
      expect(versions.rows[0]!.n, 'one change, one version').toBe(1);
    }
    // The owner revokes admin-b; admin-b's door still believes it holds brain:members. The store reads the role under the
    // lock, so the stale grant is worth nothing.
    expect((await change('owner-r', { operation: 'MEMBER_REMOVE', idempotencyKey: `race-${nonce()}`, playerId: 'admin-b', expectedRole: 'ADMIN' })).ok).toBe(true);
    const stale = await change('admin-b', { operation: 'MEMBER_SET', idempotencyKey: `race-${nonce()}`, playerId: 'late', role: 'MEMBER', expectedRole: null });
    expect(stale.ok ? 'durable' : stale.code).toBe('members_not_permitted');
  });

  it('MULTIPLAYER CONSISTENCY AND ISOLATION UNDER CONCURRENCY: four players write one Brain at once while another project is written beside it -- every statement lands once, under its author, and every reader sees the same Brain', async () => {
    const projectId = `prj-mp-${nonce()}`;
    const other = `prj-mp-other-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'mp-owner' });
    await seedProject(pool, { projectId: other, tenantId: 'mp-stranger' });
    const members = new ProjectBrainMembersStore(pool);
    for (const [playerId, role] of [['mp-admin', 'ADMIN'], ['mp-a', 'MEMBER'], ['mp-b', 'MEMBER']] as const) {
      const outcome = await members.change({ projectId, provenance: PLAYER('mp-owner'), actorId: 'mp-owner', capabilities: projectBrainCapabilitiesFor('OWNER'),
        command: { operation: 'MEMBER_SET', idempotencyKey: `mp-${nonce()}`, playerId, role, expectedRole: null } });
      expect(outcome.ok).toBe(true);
    }
    const PER = 12;
    const write = (project: string, playerId: string, i: number) => brain.mutate({ projectId: project, provenance: PLAYER(playerId), capabilities: projectBrainCapabilitiesFor('MEMBER'),
      command: { operation: 'CREATE', idempotencyKey: `mp-${playerId}-${i}-${nonce()}`, domain: 'RESEARCH_NOTE', scope: 'PROJECT', runId: null, title: `${playerId} note ${i}`, body: '', subjectRef: null, verdict: null, links: [] } });
    const writers = ['mp-owner', 'mp-admin', 'mp-a', 'mp-b'];
    const outcomes = await Promise.all([
      ...writers.flatMap((playerId) => Array.from({ length: PER }, (_, i) => write(projectId, playerId, i))),
      ...Array.from({ length: PER }, (_, i) => write(other, 'mp-stranger', i)),
    ]);
    expect(outcomes.filter((outcome) => !outcome.ok).map((outcome) => (outcome.ok ? '' : outcome.code))).toEqual([]);

    const readers = await Promise.all([brain.readDocument({ projectId }), new ProjectBrainPostgresStore(pool).readDocument({ projectId }), brain.readDocument({ projectId })]);
    const comparable = (document: unknown) => JSON.stringify({ ...(document as Record<string, unknown>), observedAt: null });
    expect(new Set(readers.map(comparable)).size, 'every reader sees the same Brain').toBe(1);
    const research = readers[0]!.sections.research;
    expect(research.length).toBe(writers.length * PER);
    for (const playerId of writers) {
      const theirs = research.filter((item) => item.title.startsWith(`${playerId} note `));
      expect(theirs.length, `${playerId}'s statements, each once`).toBe(PER);
      expect(new Set(theirs.map((item) => `${item.author?.kind}:${item.author?.id}`)), 'under their own name').toEqual(new Set([`WONDERLAND_PLAYER:${playerId}`]));
    }
    expect(research.some((item) => item.title.startsWith('mp-stranger')), 'nothing of the other project').toBe(false);
    const otherDocument = await brain.readDocument({ projectId: other });
    expect(otherDocument!.sections.research.length).toBe(PER);
    expect(otherDocument!.sections.research.every((item) => item.author?.id === 'mp-stranger')).toBe(true);
    // The event stream numbers every change once, without a gap, per project.
    const sequences = await pool.query<{ project_id: string; s: string }>(`SELECT project_id, string_agg(sequence::text, ',' ORDER BY sequence) AS s
      FROM relay_wonderland.events WHERE project_id = ANY($1::text[]) AND event_type LIKE 'project_brain.%' GROUP BY project_id`, [[projectId, other]]);
    for (const row of sequences.rows) {
      const numbers = row.s.split(',').map(Number);
      expect(numbers, `${row.project_id}: gapless from 1`).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it('MISSION COHERENCE FROM REAL ROWS: a COMPLETED mission with live work, evidence cited but not held and a state without its transition are each reported by reference', async () => {
    const projectId = `prj-incoherent-${nonce()}`;
    const runId = `run:incoherent-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId], state: 'COMPLETED' });
    const n = nonce();
    await pool.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal) VALUES($1,$2,'CODING_AGENT','IMPLEMENT','RUNNABLE',0)`, [`task-live-${n}`, runId]);
    await pool.query(`INSERT INTO relay_wonderland.julius_verification_decisions(decision_id,run_id,task_id,action,reason_code,safe_summary,evidence_ids,policy_revision,occurred_at,idempotency_key)
      VALUES($1,$2,$3,'COMPLETE','criteria_met','done',$4::jsonb,'policy:1',now(),$5)`, [`dec-${n}`, runId, `task-live-${n}`, JSON.stringify([`ev-missing-${n}`]), `dk-${n}`]);
    await pool.query(`INSERT INTO relay_wonderland.julius_transitions(transition_id,run_id,from_state,to_state,reason_code,safe_summary,evidence_ids,runtime_version,occurred_at,sequence)
      VALUES($1,$2,'PLANNING','EXECUTING','advance','the run advanced','[]','test',now(),2)`, [`tr-${n}`, runId]);
    const document = (await brain.readDocument({ projectId }))!;
    expect(document.coherence.ok).toBe(false);
    const found = document.coherence.violations.map((violation) => `${violation.rule} ${violation.refs.join(',')}`);
    expect(found).toEqual(expect.arrayContaining([
      `COMPLETE_WITH_ACTIVE_WORK task:task-live-${n}`,
      `EVIDENCE_NOT_PRESENT decision:dec-${n},evidence:ev-missing-${n}`,
      `NON_MONOTONIC_TRANSITIONS transition:tr-${n}`,
    ]));
    expect(document.coherence.skipped, 'nothing was cut, so nothing was skipped').toEqual([]);
  });

  it('CRASH AND INTERRUPTION ON THE COMPONENT AND MEMBERSHIP WRITE PATHS: a backend killed mid-write leaves nothing and says not durable; one killed at COMMIT says UNKNOWN, and the retry applies exactly once', async () => {
    const projectId = `prj-crash-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'crash-owner' });
    const admin = new Client({ connectionString: databaseUrl! });
    await admin.connect();
    const killAt = (match: (sql: string) => boolean) => interceptingPool(pool, async (sql, pid) => {
      if (match(sql.trim())) await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    });
    const counts = async () => (await pool.query(`SELECT
        (SELECT count(*) FROM relay_wonderland.project_brain_cards WHERE project_id=$1)::int AS cards,
        (SELECT count(*) FROM relay_wonderland.project_brain_card_versions WHERE project_id=$1)::int AS card_versions,
        (SELECT count(*) FROM relay_wonderland.project_members WHERE project_id=$1)::int AS members,
        (SELECT count(*) FROM relay_wonderland.project_brain_member_versions WHERE project_id=$1)::int AS member_versions,
        (SELECT count(*) FROM relay_wonderland.project_brain_mutations WHERE project_id=$1)::int AS mutations,
        (SELECT count(*) FROM relay_wonderland.events WHERE project_id=$1)::int AS events`, [projectId])).rows[0];
    const OWNER_P = PLAYER('crash-owner');
    try {
      const empty = await counts();
      // 1. Mid-transaction: after the component/member rows, before the event.
      const midEvent = (sql: string) => /^INSERT INTO relay_wonderland\.events/u.test(sql);
      const card = await new ProjectBrainComponentStore(killAt(midEvent)).mutateComponent({ projectId, provenance: OWNER_P, capabilities: OWNER,
        command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `crash-c-${nonce()}`, card: CARD }) });
      expect(card).toMatchObject({ ok: false, durable: false, code: 'project_brain_persistence_failed' });
      const member = await new ProjectBrainMembersStore(killAt(midEvent)).change({ projectId, provenance: OWNER_P, actorId: 'crash-owner', capabilities: OWNER,
        command: { operation: 'MEMBER_SET', idempotencyKey: `crash-m-${nonce()}`, playerId: 'crash-member', role: 'MEMBER', expectedRole: null } });
      expect(member).toMatchObject({ ok: false, durable: false, code: 'project_brain_persistence_failed' });
      expect(await counts(), 'nothing of either interrupted write exists').toEqual(empty);

      // 2. At COMMIT: nobody knows; the same key retried applies exactly once.
      const atCommit = (sql: string) => sql === 'COMMIT';
      const cardCommand = cmd({ operation: 'CARD_CREATE', idempotencyKey: `crash-c2-${nonce()}`, card: CARD });
      const unknownCard = await new ProjectBrainComponentStore(killAt(atCommit)).mutateComponent({ projectId, provenance: OWNER_P, capabilities: OWNER, command: cardCommand });
      expect(unknownCard).toMatchObject({ ok: false, durable: 'unknown', code: 'project_brain_commit_unknown' });
      expect((await components.mutateComponent({ projectId, provenance: OWNER_P, capabilities: OWNER, command: cardCommand })).ok, 'the retry').toBe(true);
      const memberCommand = { operation: 'MEMBER_SET', idempotencyKey: `crash-m2-${nonce()}`, playerId: 'crash-member', role: 'MEMBER', expectedRole: null } as const;
      const unknownMember = await new ProjectBrainMembersStore(killAt(atCommit)).change({ projectId, provenance: OWNER_P, actorId: 'crash-owner', capabilities: OWNER, command: memberCommand });
      expect(unknownMember).toMatchObject({ ok: false, durable: 'unknown', code: 'project_brain_commit_unknown' });
      expect((await new ProjectBrainMembersStore(pool).change({ projectId, provenance: OWNER_P, actorId: 'crash-owner', capabilities: OWNER, command: memberCommand })).ok, 'the retry').toBe(true);
      const after = await counts();
      expect({ cards: after.cards, member_versions: after.member_versions, mutations: after.mutations, events: after.events }, 'each applied exactly once')
        .toEqual({ cards: empty.cards + 1, member_versions: empty.member_versions + 1, mutations: empty.mutations + 2, events: empty.events + 2 });
      // 3. The pool recovers from the killed backends: the next read is whole.
      expect((await brain.readDocument({ projectId }))?.sections.cards.filter((item) => item.kind === 'CARD').length).toBe(1);
    } finally {
      await admin.end();
    }
  });

  it('THE DATABASE REFUSES TO REWRITE HISTORY: versions, pins and judgements are append-only; a deleted card and a settled eval never change', async () => {
    const projectId = `prj-guard-${nonce()}`;
    const runId = `run:guard-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const cardId = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `g-${nonce()}`, card: CARD }) })).componentRef;
    durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR, command: cmd({ operation: 'MISSION_PIN_CARD', idempotencyKey: `g-p-${nonce()}`, runId }) }));
    const evalId = durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `g-e-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c1', criterion: 'x', result: 'PASS', evidenceRefs: [`mission:${runId}`] }) })).componentRef;
    await expect(pool.query("UPDATE relay_wonderland.project_brain_card_versions SET name='x' WHERE card_id=$1", [cardId])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query('DELETE FROM relay_wonderland.project_brain_cards WHERE card_id=$1', [cardId])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query("UPDATE relay_wonderland.project_brain_cards SET version=version+2 WHERE card_id=$1", [cardId])).rejects.toThrow(/project_brain_version_skip/u);
    await expect(pool.query("UPDATE relay_wonderland.project_brain_mission_cards SET card_version=9 WHERE run_id=$1", [runId])).rejects.toThrow(/project_brain_immutable/u);
    await expect(pool.query("UPDATE relay_wonderland.project_brain_evals SET result='FAIL',version=version+1 WHERE eval_id=$1", [evalId])).rejects.toThrow(/project_brain_eval_rewrite/u);
    await expect(pool.query("UPDATE relay_wonderland.project_brain_evals SET status='CURRENT',version=version+1 WHERE eval_id=$1", [evalId])).rejects.toThrow(/project_brain_eval_status/u);
    // A PASS CITES EVIDENCE, at the database: refused by its own CHECK, at the statement, by name (M1). In autocommit the
    // deferred reference to 'pbm:none' would fail at COMMIT too ("violates foreign key constraint"), so matching the word
    // "violates" passed with this CHECK deleted. Here the transaction never commits, and the CONTROL row (the same, with
    // evidence) is accepted, so the refusal is the CHECK's alone.
    const passCiting = (evidence: string): Step => [`INSERT INTO relay_wonderland.project_brain_evals(eval_id,project_id,run_id,subject_ref,subject_revision,criterion,result,evidence_refs,status,version,
        evaluator_kind,evaluator_id,deliverer_kind,deliverer_id,recorded_at,updated_at,last_mutation_id)
      VALUES($1,$2,NULL,'mission:x','c1','y','PASS',$3::jsonb,'CURRENT',1,'JULIUS','j','JULIUS_RUNTIME','r',now(),now(),'pbm:none')`, [`pbeval:${randomUUID()}`, projectId, evidence]];
    expect(await rolledBack(pool, [passCiting('["mission:x"]')]), 'CONTROL: a PASS citing evidence passes every statement-time guard').toBe('ACCEPTED');
    expect(await rolledBack(pool, [passCiting('[]')]), 'a PASS citing nothing').toMatchObject(violated('23514', 'project_brain_evals_check'));
  });

  it('NO TRUNCATE REWRITES THE BRAIN: every Project Brain table refuses a TRUNCATE (with CASCADE too), by its OWN guard, and nothing is emptied', async () => {
    const projectId = `prj-trunc-${nonce()}`;
    const runId = `run:trunc-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `t-${nonce()}`, card: CARD }) }));
    const versionsBefore = Number((await pool.query('SELECT count(*) AS n FROM relay_wonderland.project_brain_card_versions WHERE project_id=$1', [projectId])).rows[0].n);
    expect(versionsBefore, 'the project holds history to lose').toBeGreaterThan(0);
    // Row triggers never see a TRUNCATE, so every table carries its own statement guard. Each TRUNCATE names ONE table
    // and CASCADEs: the named table's guard fires first, so the refusal must name THAT table. A table whose own guard
    // is gone would be refused only by a table it cascades to (another name), or not at all (a table nothing references).
    // Each runs in a transaction that is rolled back, so even a TRUNCATE that got through empties nothing for the others.
    const tables = ['project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links',
      'project_brain_cards', 'project_brain_card_versions', 'project_brain_card_selection', 'project_brain_mission_cards',
      'project_brain_handoffs', 'project_brain_handoff_versions', 'project_brain_evals', 'project_brain_eval_versions',
      'project_brain_member_versions'];
    const client = await pool.connect();
    try {
      for (const table of tables) {
        await client.query('BEGIN');
        try {
          await expect(client.query(`TRUNCATE relay_wonderland.${table} CASCADE`), `${table} refuses by its own guard`)
            .rejects.toThrow(new RegExp(`project_brain_truncate_refused: ${table} is Project Brain history`, 'u'));
        } finally {
          await client.query('ROLLBACK');
        }
      }
    } finally {
      client.release();
    }
    expect(Number((await pool.query('SELECT count(*) AS n FROM relay_wonderland.project_brain_card_versions WHERE project_id=$1', [projectId])).rows[0].n),
      'nothing was emptied').toBe(versionsBefore);
  });

  it("DB BACKSTOP (M2): an eval's judgement never changes, column by column -- each of its 11 identity and judgement columns is refused by the database itself, by name", async () => {
    const projectId = `prj-m2-${nonce()}`;
    const elsewhere = `prj-m2-else-${nonce()}`;
    const runId = `run:m2-${nonce()}`;
    const otherRun = `run:m2-other-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId, otherRun] });
    await seedProject(pool, { projectId: elsewhere, tenantId: 'p1' });
    const evalId = durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `m2-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c1aaaaa', criterion: 'the suite passes', result: 'PASS', evidenceRefs: [`mission:${runId}`] }) })).componentRef;
    // Each rewrite rides on the one move a CURRENT eval may make (to INVALIDATED, one version up), so with its column's
    // comparison gone the UPDATE would be ACCEPTED: each refusal below is that one comparison.
    const invalidating = (assignment: string, values: readonly unknown[] = []): Step =>
      [`UPDATE relay_wonderland.project_brain_evals SET ${assignment}status='INVALIDATED',version=version+1 WHERE eval_id=$1`, [evalId, ...values]];
    expect(await rolledBack(pool, [invalidating('')]), 'CONTROL: the move alone, nothing judged changed').toBe('ACCEPTED');
    const judged: ReadonlyArray<readonly [string, string, readonly unknown[]]> = [
      ['eval_id', 'eval_id=$2,', [`pbeval:${randomUUID()}`]],
      ['run_id', 'run_id=$2,', [otherRun]],
      ['run_id (to none)', 'run_id=NULL,', []],
      ['subject_ref', 'subject_ref=$2,', [`mission:${otherRun}`]],
      ['subject_revision (an old PASS re-pointed at new code)', "subject_revision='c9fffff',", []],
      ['criterion', "criterion='another criterion',", []],
      ['result', "result='FAIL',", []],
      ['evidence_refs', 'evidence_refs=$2::jsonb,', [JSON.stringify([`mission:${runId}`, `mission:${otherRun}`])]],
      ['evaluator_kind', "evaluator_kind='FOUNDER',", []],
      ['evaluator_id', "evaluator_id='someone-else',", []],
      ['recorded_at', "recorded_at=recorded_at+interval '1 second',", []],
    ];
    for (const [column, assignment, values] of judged) {
      expect(await rolledBack(pool, [invalidating(assignment, values)]), column).toMatchObject(raised('23514', /^project_brain_eval_rewrite: /u));
    }
    // ...and whose eval it is.
    expect(await rolledBack(pool, [invalidating('project_id=$2,', [elsewhere])]), 'project_id')
      .toMatchObject(raised('23514', /^project_brain_identity_change on project_brain_evals$/u));
    const stored = await pool.query<{ v: string }>('SELECT status || \':\' || version AS v FROM relay_wonderland.project_brain_evals WHERE eval_id=$1', [evalId]);
    expect(stored.rows[0]!.v, 'nothing was ever written').toBe('CURRENT:1');
  });

  it('DB BACKSTOP (M3): a settled eval never moves again -- SUPERSEDED and INVALIDATED are final at the database, and the store refuses eval_not_current by name', async () => {
    const projectId = `prj-m3-${nonce()}`;
    const runId = `run:m3-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId] });
    const record = async (subjectRevision: string) => durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `m3-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision, criterion: 'the suite passes', result: 'PASS', evidenceRefs: [`mission:${runId}`] }) })).componentRef;
    const superseded = await record('c1aaaaa');
    const invalidated = await record('c2bbbbb');
    durable(await components.mutateComponent({ projectId, provenance: OPERATOR('p1'), capabilities: OWNER,
      command: cmd({ operation: 'EVAL_INVALIDATE', idempotencyKey: `m3-inv-${nonce()}`, evalId: invalidated, expectedVersion: 1 }) }));
    const current = await record('c3ccccc');
    const states = async () => (await pool.query<{ v: string }>(
      "SELECT string_agg(eval_id || ' ' || status || ' ' || version || ' ' || coalesce(superseded_by, '-'), ',' ORDER BY eval_id) AS v FROM relay_wonderland.project_brain_evals WHERE project_id=$1", [projectId])).rows[0]!.v;
    const before = await states();
    expect(before.split(',').map((row) => row.split(' ').slice(1, 3).join(' ')).sort(), 'one of each').toEqual(['CURRENT 1', 'INVALIDATED 2', 'SUPERSEDED 2']);

    const move = (evalId: string, assignment: string): Step => [`UPDATE relay_wonderland.project_brain_evals SET ${assignment},version=version+1 WHERE eval_id=$1`, [evalId]];
    expect(await rolledBack(pool, [move(current, "status='INVALIDATED'")]), 'CONTROL: CURRENT -> INVALIDATED').toBe('ACCEPTED');
    const notAMove = raised('23514', /^project_brain_eval_status: /u);
    // Each of these satisfies every CHECK (SUPERSEDED exactly when superseded_by is set), so only the status guard refuses.
    expect(await rolledBack(pool, [move(superseded, "status='INVALIDATED',superseded_by=NULL")]), 'SUPERSEDED -> INVALIDATED').toMatchObject(notAMove);
    expect(await rolledBack(pool, [move(superseded, "status='SUPERSEDED'")]), 'SUPERSEDED -> SUPERSEDED, one version up').toMatchObject(notAMove);
    expect(await rolledBack(pool, [move(invalidated, `status='SUPERSEDED',superseded_by='${current}'`)]), 'INVALIDATED -> SUPERSEDED').toMatchObject(notAMove);
    expect(await rolledBack(pool, [move(invalidated, "status='INVALIDATED'")]), 'INVALIDATED -> INVALIDATED, one version up').toMatchObject(notAMove);
    expect(await rolledBack(pool, [move(invalidated, "status='CURRENT'")]), 'INVALIDATED -> CURRENT').toMatchObject(notAMove);
    expect(await rolledBack(pool, [move(current, "status='CURRENT'")]), 'CURRENT -> CURRENT, one version up').toMatchObject(notAMove);

    // THE STORE: invalidating a settled eval at its current version is refused by name before any write, and changes nothing.
    for (const [settled, evalId] of [['SUPERSEDED', superseded], ['INVALIDATED', invalidated]] as const) {
      const outcome = await components.mutateComponent({ projectId, provenance: OPERATOR('p1'), capabilities: OWNER,
        command: cmd({ operation: 'EVAL_INVALIDATE', idempotencyKey: `m3-again-${nonce()}`, evalId, expectedVersion: 2 }) });
      expect(outcome.ok ? 'durable' : `${outcome.code}/${String(outcome.durable)}`, settled).toBe('eval_not_current/false');
    }
    expect(await states(), 'no eval moved').toBe(before);
  });

  it('DB BACKSTOP (M5): one CURRENT eval per subject and criterion, and SUPERSEDED exactly when superseded_by is set -- each refused by its own constraint, by name', async () => {
    const projectId = `prj-m5e-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    const insertEval = (criterion: string, status = 'CURRENT', supersededBy: string | null = null): Step => [`INSERT INTO relay_wonderland.project_brain_evals(eval_id,project_id,run_id,subject_ref,subject_revision,criterion,result,evidence_refs,status,superseded_by,version,
        evaluator_kind,evaluator_id,deliverer_kind,deliverer_id,recorded_at,updated_at,last_mutation_id)
      VALUES($1,$2,NULL,'mission:x','c1',$3,'FAIL','[]'::jsonb,$4,$5,1,'JULIUS','j','JULIUS_RUNTIME','r',now(),now(),'pbm:none')`, [`pbeval:${randomUUID()}`, projectId, criterion, status, supersededBy]];
    const successor = `pbeval:${randomUUID()}`;
    expect(await rolledBack(pool, [insertEval('a'), insertEval('b')]), 'CONTROL: two CURRENT evals of two criteria').toBe('ACCEPTED');
    expect(await rolledBack(pool, [insertEval('a'), insertEval('a', 'SUPERSEDED', successor)]), 'CONTROL: a CURRENT eval beside a SUPERSEDED one').toBe('ACCEPTED');
    expect(await rolledBack(pool, [insertEval('a'), insertEval('a')]), 'two CURRENT evals of one subject and criterion')
      .toMatchObject(violated('23505', 'project_brain_evals_one_current', 1));
    expect(await rolledBack(pool, [insertEval('a', 'INVALIDATED')]), 'CONTROL: INVALIDATED, superseded by nothing').toBe('ACCEPTED');
    expect(await rolledBack(pool, [insertEval('a', 'SUPERSEDED')]), 'SUPERSEDED by nothing').toMatchObject(violated('23514', 'project_brain_evals_check1'));
    expect(await rolledBack(pool, [insertEval('a', 'INVALIDATED', successor)]), 'INVALIDATED, yet superseded').toMatchObject(violated('23514', 'project_brain_evals_check1'));
    // The report's form: a stored CURRENT eval set SUPERSEDED with no successor (a legal move for the status guard).
    expect(await rolledBack(pool, [insertEval('c'), [`UPDATE relay_wonderland.project_brain_evals SET status='SUPERSEDED',superseded_by=NULL,version=version+1
        WHERE project_id=$1 AND criterion='c'`, [projectId]]]), 'CURRENT -> SUPERSEDED by nothing').toMatchObject(violated('23514', 'project_brain_evals_check1', 1));
  });

  it("DB BACKSTOP (M5): a DELETED card never changes, and a card's identity (id, author, creation, project) never changes -- refused by the database with the store bypassed", async () => {
    const projectId = `prj-m5c-${nonce()}`;
    const elsewhere = `prj-m5c-else-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    await seedProject(pool, { projectId: elsewhere, tenantId: 'p1' });
    const create = async () => durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `m5c-${nonce()}`, card: CARD }) })).componentRef;
    const live = await create();
    const gone = await create();
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_DELETE', idempotencyKey: `m5c-del-${nonce()}`, cardId: gone, expectedVersion: 1 }) }));
    const update = (cardId: string, assignment: string, values: readonly unknown[] = []): Step =>
      [`UPDATE relay_wonderland.project_brain_cards SET ${assignment}version=version+1 WHERE card_id=$1`, [cardId, ...values]];
    expect(await rolledBack(pool, [update(live, "name='renamed',")]), 'CONTROL: a live card renamed, one version up').toBe('ACCEPTED');
    const deleted = raised('23514', /^project_brain_card_deleted: /u);
    expect(await rolledBack(pool, [update(gone, "name='renamed',")]), 'a deleted card renamed').toMatchObject(deleted);
    expect(await rolledBack(pool, [update(gone, "state='LIVE',")]), 'a deleted card brought back').toMatchObject(deleted);
    const identity: ReadonlyArray<readonly [string, string, readonly unknown[]]> = [
      ['card_id', 'card_id=$2,', [`pbcard:${randomUUID()}`]],
      ['author_kind', "author_kind='JULIUS',", []],
      ['author_id (whoever the author is holds CARD_UPDATE and CARD_DELETE)', "author_id='p2',", []],
      ['created_at', "created_at=created_at-interval '1 day',", []],
      ['project_id', 'project_id=$2,', [elsewhere]],
    ];
    for (const [column, assignment, values] of identity) {
      expect(await rolledBack(pool, [update(live, assignment, values)]), column).toMatchObject(raised('23514', /^project_brain_identity_change on project_brain_cards$/u));
    }
  });

  it('DB BACKSTOP (M5): the card selection, a handoff and an eval move forward one version at a time and are never deleted; a handoff never changes its run or project', async () => {
    const projectId = `prj-m5h-${nonce()}`;
    const elsewhere = `prj-m5h-else-${nonce()}`;
    const runId = `run:m5h-${nonce()}`;
    const otherRun = `run:m5h-other-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId, otherRun] });
    await seedProject(pool, { projectId: elsewhere, tenantId: 'p1' });
    const cardId = durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_CREATE', idempotencyKey: `m5h-c-${nonce()}`, card: CARD }) })).componentRef;
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'CARD_SELECT', idempotencyKey: `m5h-s-${nonce()}`, cardRef: cardId, expectedSelectionVersion: 0 }) }));
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `m5h-h-${nonce()}`, runId, expectedVersion: 0 }) }));
    const evalId = durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `m5h-e-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c1aaaaa', criterion: 'x', result: 'FAIL', evidenceRefs: [] }) })).componentRef;
    const on =(table: string, key: string, id: string) => ({
      update: (assignment: string, values: readonly unknown[] = []): Step => [`UPDATE relay_wonderland.${table} SET ${assignment} WHERE ${key}=$1`, [id, ...values]],
      remove: (): Step => [`DELETE FROM relay_wonderland.${table} WHERE ${key}=$1`, [id]],
    });
    const rows = [
      ['project_brain_card_selection', on('project_brain_card_selection', 'project_id', projectId), "card_ref='pbcard:default',version=version+1"],
      ['project_brain_handoffs', on('project_brain_handoffs', 'run_id', runId), "state='RETURNED',version=version+1"],
      ['project_brain_evals', on('project_brain_evals', 'eval_id', evalId), "status='INVALIDATED',version=version+1"],
    ] as const;
    for (const [table, row, forward] of rows) {
      expect(await rolledBack(pool, [row.update(forward)]), `CONTROL: ${table} moves one version up`).toBe('ACCEPTED');
      expect(await rolledBack(pool, [row.update('version=version+2')]), `${table}: a version skipped`)
        .toMatchObject(raised('23514', new RegExp(`^project_brain_version_skip: 1 -> 3 on ${table}$`, 'u')));
      expect(await rolledBack(pool, [row.remove()]), `${table}: deleted`)
        .toMatchObject(raised('42501', new RegExp(`^project_brain_immutable: DELETE on ${table}$`, 'u')));
      expect(await rolledBack(pool, [row.update('project_id=$2,version=version+1', [elsewhere])]), `${table}: moved to another project`)
        .toMatchObject(raised('23514', new RegExp(`^project_brain_identity_change on ${table}$`, 'u')));
    }
    const handoff = on('project_brain_handoffs', 'run_id', runId);
    expect(await rolledBack(pool, [handoff.update('run_id=$2,version=version+1', [otherRun])]), 'a handoff moved to another run')
      .toMatchObject(raised('23514', /^project_brain_identity_change on project_brain_handoffs$/u));
  });

  it('DB BACKSTOP (M5): handoff and eval history is append-only, and a run of another project never carries a handoff or an eval across', async () => {
    const projectId = `prj-m5r-${nonce()}`;
    const elsewhere = `prj-m5r-else-${nonce()}`;
    const runId = `run:m5r-${nonce()}`;
    const freshRun = `run:m5r-fresh-${nonce()}`;
    const foreignRun = `run:m5r-foreign-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1', runs: [runId, freshRun] });
    await seedProject(pool, { projectId: elsewhere, tenantId: 'p1', runs: [foreignRun] });
    durable(await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR,
      command: cmd({ operation: 'HANDOFF_ENTER', idempotencyKey: `m5r-h-${nonce()}`, runId, expectedVersion: 0 }) }));
    durable(await components.mutateComponent({ projectId, provenance: RUNTIME, capabilities: EDITOR,
      command: cmd({ operation: 'EVAL_RECORD', idempotencyKey: `m5r-e-${nonce()}`, runId, subjectRef: `mission:${runId}`, subjectRevision: 'c1aaaaa', criterion: 'x', result: 'FAIL', evidenceRefs: [] }) }));
    for (const table of ['project_brain_handoff_versions', 'project_brain_eval_versions']) {
      const held = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM relay_wonderland.${table} WHERE project_id=$1`, [projectId]);
      expect(held.rows[0]!.n, `${table} holds the history to rewrite`).toBe(1);
      expect(await rolledBack(pool, [[`UPDATE relay_wonderland.${table} SET author_id='someone-else' WHERE project_id=$1`, [projectId]]]), `${table}: rewritten`)
        .toMatchObject(raised('42501', new RegExp(`^project_brain_immutable: UPDATE on ${table}$`, 'u')));
      expect(await rolledBack(pool, [[`DELETE FROM relay_wonderland.${table} WHERE project_id=$1`, [projectId]]]), `${table}: deleted`)
        .toMatchObject(raised('42501', new RegExp(`^project_brain_immutable: DELETE on ${table}$`, 'u')));
    }
    const handoff = (run: string): Step => [`INSERT INTO relay_wonderland.project_brain_handoffs(run_id,project_id,state,form,version,updated_at,last_mutation_id)
      VALUES($1,$2,'HANDED_OFF','angelic_twin_swords',1,now(),'pbm:none')`, [run, projectId]];
    const evalOf = (run: string): Step => [`INSERT INTO relay_wonderland.project_brain_evals(eval_id,project_id,run_id,subject_ref,subject_revision,criterion,result,evidence_refs,status,version,
        evaluator_kind,evaluator_id,deliverer_kind,deliverer_id,recorded_at,updated_at,last_mutation_id)
      VALUES($1,$2,$3,$4,'c1','y','FAIL','[]'::jsonb,'CURRENT',1,'JULIUS','j','JULIUS_RUNTIME','r',now(),now(),'pbm:none')`, [`pbeval:${randomUUID()}`, projectId, run, `mission:${run}`]];
    const across = raised('23503', /^project_brain_cross_project: run .+ is not in project /u);
    expect(await rolledBack(pool, [handoff(freshRun)]), "CONTROL: a handoff on this project's own run").toBe('ACCEPTED');
    expect(await rolledBack(pool, [handoff(foreignRun)]), "a handoff on another project's run").toMatchObject(across);
    expect(await rolledBack(pool, [evalOf(freshRun)]), "CONTROL: an eval of this project's own run").toBe('ACCEPTED');
    expect(await rolledBack(pool, [evalOf(foreignRun)]), "an eval of another project's run").toMatchObject(across);
  });

  it('DB BACKSTOP (M5): a membership version records a change, never a no-op -- refused by its CHECK, by name', async () => {
    const projectId = `prj-m5m-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    const version = (role: string | null, previous: string | null): Step => [`INSERT INTO relay_wonderland.project_brain_member_versions(project_id,player_id,version,role,previous_role,mutation_id,changed_by_kind,changed_by_id,changed_at)
      VALUES($1,'m5-player',1,$2,$3,'pbm:none','WONDERLAND_PLAYER','p1',now())`, [projectId, role, previous]];
    expect(await rolledBack(pool, [version('MEMBER', null)]), 'CONTROL: admitted').toBe('ACCEPTED');
    expect(await rolledBack(pool, [version(null, 'MEMBER')]), 'CONTROL: removed').toBe('ACCEPTED');
    expect(await rolledBack(pool, [version('MEMBER', 'MEMBER')]), 'MEMBER -> MEMBER').toMatchObject(violated('23514', 'project_brain_member_versions_check'));
    expect(await rolledBack(pool, [version(null, null)]), 'removed -> removed').toMatchObject(violated('23514', 'project_brain_member_versions_check'));
  });

  it('DB BACKSTOP: a broken mutation reference is refused BEFORE COMMIT -- nothing saved and durable:false, never an unknown commit', async () => {
    const projectId = `prj-defer-${nonce()}`;
    await seedProject(pool, { projectId, tenantId: 'p1' });
    // Every statement as the store sends it, except the card row, made to name a mutation that is never written. The
    // reference is DEFERRED: only the store's SET CONSTRAINTS ALL IMMEDIATE checks it before COMMIT.
    let rewritten = 0;
    const broken = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client: PoolClient = await pool.connect();
        const original = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
          if (typeof sql === 'string' && sql.trimStart().startsWith('INSERT INTO relay_wonderland.project_brain_cards(') && values !== undefined) {
            rewritten += 1;
            return original(sql, values.map((value, index) => (index === 10 ? 'pbm:none' : value)));
          }
          return original(sql, values);
        };
        return client;
      },
    } as unknown as Pool;
    const command = cmd({ operation: 'CARD_CREATE', idempotencyKey: `defer-${nonce()}`, card: CARD });
    const outcome = await new ProjectBrainComponentStore(broken).mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command });
    expect(rewritten, 'the instrument reached the card row').toBe(1);
    expect(outcome.ok ? 'durable' : `${outcome.code}/${String(outcome.durable)}`).toBe('project_brain_persistence_failed/false');
    const written = await pool.query<{ cards: number; mutations: number }>(`SELECT
        (SELECT count(*) FROM relay_wonderland.project_brain_cards WHERE project_id=$1)::int AS cards,
        (SELECT count(*) FROM relay_wonderland.project_brain_mutations WHERE project_id=$1)::int AS mutations`, [projectId]);
    expect(written.rows[0], 'nothing was saved').toEqual({ cards: 0, mutations: 0 });
    // CONTROL: the same command through the plain pool is saved.
    expect((await components.mutateComponent({ projectId, provenance: PLAYER('p1'), capabilities: EDITOR, command })).ok, 'CONTROL').toBe(true);
  });
});
