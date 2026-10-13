/**
 * THE PREFLIGHT'S DISPOSABLE IDENTITY IN THE DURABLE SCHEMA.
 *
 * Free dry run #2 (GitHub Actions run 33635375764) failed at its very first
 * `createSandbox`: the executor's own persistence refused to record the sandbox
 * with PostgreSQL SQLSTATE 23503, a foreign-key violation. The preflight had
 * invented a project, a run, a task and an invocation and seeded none of them,
 * while `relay_wonderland.julius_sandboxes` references all four —
 * `projects`, `julius_runs`, `julius_tasks`, and, as a composite key,
 * `julius_tool_invocations`. The executor was right to refuse; the probe was
 * not a legitimate participant in the schema it was probing.
 *
 * This module makes it one, the way the proven sibling harness and the live
 * mission are: the ancestry is seeded FIRST, in foreign-key order, and the
 * invocation goes through the production tool repository, not around it. Every
 * identifier carries one nonce, so concurrent or stale preflights cannot
 * collide and cleanup has an exact ownership boundary: rows whose project is
 * this nonce's project, and nothing else.
 *
 * THE FOREIGN-KEY GRAPH, from the migrations (001, 011, 019, 020):
 *
 *   players(player_id)                       ← the tenant; shared with the mission, never deleted here
 *   projects(project_id)
 *   project_members(project_id, player_id)   ← JuliusToolPostgresRepository.request refuses a non-member tenant
 *   mission_contracts(mission_id → projects)
 *   julius_runs(run_id → mission_contracts, → projects; card_revision must equal the policy revision)
 *   julius_tasks(task_id → julius_runs; ACTIVE with a live lease, the worker and lease generation the request names)
 *   julius_tool_invocations(… → projects, julius_runs, julius_tasks)   via request() + authorize()
 *   julius_sandboxes(project_id, run_id, task_id, (tenant,project,run,task,invocation) → invocations)   ← the executor writes this
 *   julius_tool_execution_receipts(→ invocations CASCADE, → sandboxes RESTRICT)                          ← and this
 *
 * AND WHAT A SETTLEMENT NEEDS. Paid run 36568129865 failed where no preflight had
 * ever gone: the executor stored a NUL-bearing close-out result, and nothing
 * provider-free had ever SETTLED one. So the preflight settles every effect it
 * runs, through the production settlement repository, and that repository needs
 * the rest of the live shape (migrations 001, 003, 011, 015):
 *
 *   agents(agent_id → players) and card_versions(→ agents, → players)
 *   execution_sessions(→ mission_contracts, projects, players, agents, card_versions)
 *   budget_reservations(→ execution_sessions CASCADE), one per invocation   ← the settlement commits it
 *   julius_evidence, julius_trajectory_events(→ julius_tasks, no cascade), events(→ projects),
 *   outbox(→ events CASCADE), stream_sequences(keyed by run), julius_tool_settlements(→ budget_reservations)
 *
 * Cleanup deletes in the reverse of that order, receipts before sandboxes because
 * of the RESTRICT, settlements before the reservations they name, trajectory rows
 * before the tasks they name, and reports what it deleted and what, if anything, remains.
 *
 * THE DISPATCH CLAIM. Recording the invocation is not enough: the executor's
 * `authorizeExecution` joins the invocation and admits it only DISPATCHING (or
 * RUNNING) with the dispatch generation the request names — the claim the live
 * dispatcher makes through `claimDispatch`. PR #214's host-visible entry proved
 * it: with the invocation left AUTHORIZED the executor answered
 * `sandbox_execution_authority_lost`. Unscoped, the production `claimDispatch`
 * claims up to N pending invocations of ANY run, which a probe on a shared
 * database must never do, so the claim here is its own statement: the same state
 * change scoped to this one invocation and this nonce's project, and nothing else
 * can be touched by it. It predates the scoped form defect B gave `claimDispatch`
 * (one invocation, named with its project).
 *
 * Pure with respect to providers: this module reaches PostgreSQL and nothing else.
 */

import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { TransactionalWonderlandDatabase, type ReviewedBootstrapIdentity } from '../src/relay/persistence/wonderland-postgres';

export interface PreflightIdentity {
  readonly nonce: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly leaseGeneration: number;
  readonly policyRevision: string;
  /** The execution session the settlement's budget reservations belong to. */
  readonly executionId: string;
  readonly agentId: string;
  readonly cardVersionId: string;
}

/**
 * Brings the database up to the checked-in migration set, and reports exactly
 * what it did.
 *
 * THE SENTINEL THIS REPLACES WAS A TWO-ANSWER GUARD ON A QUESTION WITH MANY.
 * It asked whether `julius_sandboxes.sandbox_policy` existed — the artefact of
 * whichever migration was last when the guard was written — and skipped the
 * whole set when it did. Adding migration 022 made that lie in the dangerous
 * direction: a database already at 021 answered "present", so the new column
 * was never created and the recovery sweep that depends on it would have
 * failed on every pass. `migrate()` now applies only the versions
 * `schema_migrations` does not already hold, so it is safe to call against an
 * empty database, a partially migrated one, or a current one — and there is no
 * sentinel left to go stale.
 */
export async function migrateIfNeeded(
  pool: Pool,
  // ONLY the reviewed EMPTY-store bootstrap passes this (julius-bootstrap-empty-store.ts), after verifying the store's identity
  // and emptiness itself; every other caller leaves it out, so a protected store refuses (protected-store.ts).
  options: { readonly reviewedBootstrap?: ReviewedBootstrapIdentity } = {},
): Promise<{ readonly alreadyPresent: number; readonly applied: readonly string[] }> {
  const database = new TransactionalWonderlandDatabase(pool);
  const before = await database.appliedMigrationVersions();
  await database.migrate(options);
  const after = await database.appliedMigrationVersions();
  // WHAT HAPPENED, NOT A VERDICT ABOUT IT. A boolean here made the caller
  // report "empty database" for a database that held 21 migrations and
  // received one — which is exactly the state the version ledger was
  // introduced to serve, described to the operator as its opposite.
  return {
    alreadyPresent: before.size,
    applied: [...after].filter((version) => !before.has(version)).sort(),
  };
}

/** The prefix every preflight-owned identifier carries. Cleanup refuses to touch anything without it. */
export const PREFLIGHT_PROJECT_PREFIX = 'prj-julius-preflight-';

/** Milliseconds base-36 plus 32 random bits: unique per invocation, readable in a log, and valid in every identifier grammar the executor applies. */
export const preflightNonce = (): string => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

export const preflightIdentityFor = (input: { tenantId: string; nonce: string; policyRevision: string }): PreflightIdentity => ({
  nonce: input.nonce,
  tenantId: input.tenantId,
  projectId: `${PREFLIGHT_PROJECT_PREFIX}${input.nonce}`,
  missionId: `mission:julius-preflight-${input.nonce}`,
  runId: `run:julius-preflight-${input.nonce}`,
  taskId: `task:julius-preflight-${input.nonce}`,
  workerId: 'julius-live-preflight',
  leaseGeneration: 1,
  policyRevision: input.policyRevision,
  executionId: `execution:julius-preflight-${input.nonce}`,
  agentId: `agent:julius-preflight-${input.nonce}`,
  cardVersionId: `card-version:julius-preflight-${input.nonce}`,
});

/**
 * Ownership is the nonce, on EVERY identifier. A hand-built identity carrying an owned
 * project but a real run would otherwise attach a preflight task to that run at seed time
 * and reach its tasks at cleanup, so every key must be the nonce's: the four the executor
 * sees, and the three the settlement's budget needs.
 */
const assertOwned = (identity: PreflightIdentity): void => {
  const owned = identity.projectId === `${PREFLIGHT_PROJECT_PREFIX}${identity.nonce}`
    && identity.missionId === `mission:julius-preflight-${identity.nonce}`
    && identity.runId === `run:julius-preflight-${identity.nonce}`
    && identity.taskId === `task:julius-preflight-${identity.nonce}`
    && identity.executionId === `execution:julius-preflight-${identity.nonce}`
    && identity.agentId === `agent:julius-preflight-${identity.nonce}`
    && identity.cardVersionId === `card-version:julius-preflight-${identity.nonce}`
    && /^[A-Za-z0-9-]{4,64}$/u.test(identity.nonce);
  if (!owned) throw new Error('preflight_identity_not_owned');
};

/**
 * Seeds the ancestry the executor's sandbox record requires, in foreign-key order.
 * The tenant's player row is created only if absent and is never removed: the live
 * mission's own seed creates the same row, so it is shared, not owned.
 */
export async function seedPreflightIdentity(pool: Pool, identity: PreflightIdentity, options: { leaseMinutes?: number } = {}): Promise<void> {
  assertOwned(identity);
  // The task lease must outlive every executor request the preflight will make; the caller
  // sizes it from its request timeout, and 15 minutes is the floor.
  const leaseMinutes = Math.max(15, Math.ceil(options.leaseMinutes ?? 15));
  // One transaction: a preflight that dies mid-seed leaves either the whole ancestry or none of it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.tenantId]);
    await client.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.projectId]);
    await client.query(
      "INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,'OWNER') ON CONFLICT DO NOTHING",
      [identity.projectId, identity.tenantId],
    );
    await client.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb) ON CONFLICT DO NOTHING",
      [identity.missionId, identity.projectId, `preflight:${identity.nonce}`],
    );
    // The execution session a settlement commits its budget against, and the agent and card
    // version it names: nonce-scoped like everything else, owned by the shared tenant row.
    await client.query('INSERT INTO relay_wonderland.agents(agent_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [identity.agentId, identity.tenantId]);
    await client.query(
      "INSERT INTO relay_wonderland.card_versions(card_version_id,agent_id,owner_id,version,snapshot) VALUES($1,$2,$3,1,'{}'::jsonb) ON CONFLICT DO NOTHING",
      [identity.cardVersionId, identity.agentId, identity.tenantId],
    );
    await client.query(
      `INSERT INTO relay_wonderland.execution_sessions(execution_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint)
       VALUES($1,$2,$3,$4,$5,$6,'RUNNING','preflight-sandbox','{}'::jsonb,'{}'::jsonb) ON CONFLICT DO NOTHING`,
      [identity.executionId, identity.missionId, identity.projectId, identity.tenantId, identity.agentId, identity.cardVersionId],
    );
    await client.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','preflight',$4,1,0) ON CONFLICT DO NOTHING",
      [identity.runId, identity.missionId, identity.projectId, identity.policyRevision],
    );
    // ACTIVE with a live lease held by a named owner: `request()` refuses anything less.
    await client.query(
      `INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,worker_id,lease_owner,lease_generation,lease_expires_at)
       VALUES($1,$2,'CODING_AGENT','preflight','ACTIVE',0,$3,'julius-live-preflight',$4,clock_timestamp()+($5::text||' minutes')::interval) ON CONFLICT DO NOTHING`,
      [identity.taskId, identity.runId, identity.workerId, identity.leaseGeneration, String(leaseMinutes)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Records ONE invocation through the production tool repository — REQUESTED, then
 * AUTHORIZED — exactly as the live composition does before it asks the executor for a
 * sandbox, then claims its dispatch (see the header) and returns the dispatch
 * generation the executor must be handed. The digest recorded is the digest the
 * executor will be handed. The budget reservation the settlement commits is made
 * first, as the live shell port makes it.
 */
export async function seedPreflightInvocation(
  pool: Pool,
  identity: PreflightIdentity,
  input: { invocationId: string; requestDigest: string; requestedAt: string; timeoutMs?: number },
): Promise<{ dispatchGeneration: number }> {
  assertOwned(identity);
  await pool.query(
    `INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,tool_calls,runtime_ms,expires_at)
     VALUES($1,$2,$3,'tool',$4,'RESERVED',1,$5,now()+interval '60 minutes') ON CONFLICT DO NOTHING`,
    [`budget:${input.invocationId}`, identity.executionId, identity.workerId, input.invocationId, input.timeoutMs ?? 30_000],
  );
  const tools = new JuliusToolPostgresRepository(pool);
  await tools.request({
    invocationId: input.invocationId, idempotencyKey: input.invocationId, requestDigest: input.requestDigest,
    tenantId: identity.tenantId, projectId: identity.projectId, runId: identity.runId, taskId: identity.taskId,
    workerId: identity.workerId, leaseGeneration: identity.leaseGeneration, policyRevision: identity.policyRevision,
    toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: input.requestedAt,
  });
  const authorized = await tools.authorize({
    invocationId: input.invocationId, tenantId: identity.tenantId, projectId: identity.projectId,
    requestDigest: input.requestDigest, policyRevision: identity.policyRevision,
    budgetReservationId: `budget:${input.invocationId}`, authorizedAt: input.requestedAt,
  });
  if (!authorized) throw new Error('preflight_invocation_not_authorized');
  // The dispatch claim, for THIS invocation only: the outbox entry becomes CLAIMED and the
  // invocation DISPATCHING with its generation advanced — the state `claimDispatch` leaves
  // behind, reached without the fleet-wide sweep an unscoped `claimDispatch` performs.
  const claimedUntil = new Date(Date.parse(input.requestedAt) + 600_000).toISOString();
  const claimed = await pool.query<{ dispatch_generation: string }>(
    `WITH claimed AS (
       UPDATE relay_wonderland.julius_tool_outbox o SET state='CLAIMED',claimed_by=$2,claimed_until=$3,attempts=o.attempts+1
       WHERE o.invocation_id=$1 AND o.project_id=$4 AND o.state='PENDING' RETURNING o.invocation_id)
     UPDATE relay_wonderland.julius_tool_invocations i
     SET state='DISPATCHING',dispatch_generation=i.dispatch_generation+1,dispatch_claimed_by=$2,dispatch_claimed_until=$3
     FROM claimed c WHERE i.invocation_id=c.invocation_id AND i.project_id=$4 AND i.state='AUTHORIZED'
     RETURNING i.dispatch_generation`,
    [input.invocationId, identity.workerId, claimedUntil, identity.projectId],
  );
  if (claimed.rowCount !== 1) throw new Error('preflight_invocation_not_dispatched');
  return { dispatchGeneration: Number(claimed.rows[0]?.dispatch_generation) };
}

export interface PreflightCleanupReport {
  readonly deleted: Readonly<Record<string, number>>;
  /** Rows that still carry this preflight's project after cleanup. Zero is the only acceptable answer. */
  readonly remaining: number;
}

/**
 * Removes everything this preflight created, in reverse foreign-key order, inside one
 * transaction. The boundary is the nonce's project: every statement names it, so a row
 * belonging to the mission, or to another preflight, is unreachable from here.
 */
export async function cleanupPreflightIdentity(pool: Pool, identity: PreflightIdentity): Promise<PreflightCleanupReport> {
  assertOwned(identity);
  const client = await pool.connect();
  const deleted: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    const steps: ReadonlyArray<readonly [string, string, readonly unknown[]]> = [
      ['julius_tool_execution_receipts', 'DELETE FROM relay_wonderland.julius_tool_execution_receipts WHERE project_id=$1', [identity.projectId]],
      ['julius_tool_settlements', 'DELETE FROM relay_wonderland.julius_tool_settlements WHERE project_id=$1', [identity.projectId]],
      ['julius_sandboxes', 'DELETE FROM relay_wonderland.julius_sandboxes WHERE project_id=$1', [identity.projectId]],
      ['julius_tool_outbox', 'DELETE FROM relay_wonderland.julius_tool_outbox WHERE project_id=$1', [identity.projectId]],
      ['julius_tool_invocations', 'DELETE FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1', [identity.projectId]],
      // What a settlement (and a terminal transition) writes beside the invocation.
      ['julius_trajectory_events', 'DELETE FROM relay_wonderland.julius_trajectory_events WHERE run_id=$1 AND project_id=$2', [identity.runId, identity.projectId]],
      ['julius_evidence', 'DELETE FROM relay_wonderland.julius_evidence e USING relay_wonderland.julius_runs r WHERE e.run_id=r.run_id AND r.run_id=$1 AND r.project_id=$2', [identity.runId, identity.projectId]],
      ['outbox', 'DELETE FROM relay_wonderland.outbox WHERE project_id=$1', [identity.projectId]],
      ['events', 'DELETE FROM relay_wonderland.events WHERE project_id=$1', [identity.projectId]],
      ['stream_sequences', 'DELETE FROM relay_wonderland.stream_sequences WHERE stream_id=$1', [identity.runId]],
      ['budget_reservations', 'DELETE FROM relay_wonderland.budget_reservations WHERE execution_id=$1', [identity.executionId]],
      ['execution_sessions', 'DELETE FROM relay_wonderland.execution_sessions WHERE execution_id=$1 AND project_id=$2', [identity.executionId, identity.projectId]],
      ['julius_tasks', 'DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.run_id=$1 AND r.project_id=$2', [identity.runId, identity.projectId]],
      ['julius_runs', 'DELETE FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [identity.runId, identity.projectId]],
      ['mission_contracts', 'DELETE FROM relay_wonderland.mission_contracts WHERE mission_id=$1 AND project_id=$2', [identity.missionId, identity.projectId]],
      ['card_versions', 'DELETE FROM relay_wonderland.card_versions WHERE card_version_id=$1 AND agent_id=$2', [identity.cardVersionId, identity.agentId]],
      ['agents', 'DELETE FROM relay_wonderland.agents WHERE agent_id=$1', [identity.agentId]],
      ['project_members', 'DELETE FROM relay_wonderland.project_members WHERE project_id=$1', [identity.projectId]],
      ['projects', 'DELETE FROM relay_wonderland.projects WHERE project_id=$1', [identity.projectId]],
    ];
    for (const [table, sql, values] of steps) {
      const result = await client.query(sql, [...values]);
      deleted[table] = result.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // Every table a preflight can leave a row in, by its ownership key.
  const remaining = await pool.query<{ total: string }>(
    `SELECT (SELECT count(*) FROM relay_wonderland.julius_tool_execution_receipts WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_tool_settlements WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_sandboxes WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_tool_outbox WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_trajectory_events WHERE run_id=$2)
          + (SELECT count(*) FROM relay_wonderland.julius_evidence WHERE run_id=$2)
          + (SELECT count(*) FROM relay_wonderland.outbox WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.events WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.stream_sequences WHERE stream_id=$2)
          + (SELECT count(*) FROM relay_wonderland.budget_reservations WHERE execution_id=$4)
          + (SELECT count(*) FROM relay_wonderland.execution_sessions WHERE execution_id=$4)
          + (SELECT count(*) FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE r.run_id=$2 AND r.project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.mission_contracts WHERE mission_id=$3 AND project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.card_versions WHERE card_version_id=$5)
          + (SELECT count(*) FROM relay_wonderland.agents WHERE agent_id=$6)
          + (SELECT count(*) FROM relay_wonderland.project_members WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.projects WHERE project_id=$1) AS total`,
    [identity.projectId, identity.runId, identity.missionId, identity.executionId, identity.cardVersionId, identity.agentId],
  );
  return { deleted, remaining: Number(remaining.rows[0]?.total ?? 0) };
}
