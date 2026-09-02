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
 * Cleanup deletes in the reverse of that order, receipts before sandboxes because
 * of the RESTRICT, and reports what it deleted and what, if anything, remains.
 *
 * Pure with respect to providers: this module reaches PostgreSQL and nothing else.
 */

import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';

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
});

const assertOwned = (identity: PreflightIdentity): void => {
  if (!identity.projectId.startsWith(PREFLIGHT_PROJECT_PREFIX) || !identity.projectId.endsWith(identity.nonce)) {
    throw new Error('preflight_identity_not_owned');
  }
};

/**
 * Seeds the ancestry the executor's sandbox record requires, in foreign-key order.
 * The tenant's player row is created only if absent and is never removed: the live
 * mission's own seed creates the same row, so it is shared, not owned.
 */
export async function seedPreflightIdentity(pool: Pool, identity: PreflightIdentity, options: { leaseMinutes?: number } = {}): Promise<void> {
  assertOwned(identity);
  const leaseMinutes = options.leaseMinutes ?? 15;
  await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.tenantId]);
  await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.projectId]);
  await pool.query(
    "INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,'OWNER') ON CONFLICT DO NOTHING",
    [identity.projectId, identity.tenantId],
  );
  await pool.query(
    "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb) ON CONFLICT DO NOTHING",
    [identity.missionId, identity.projectId, `preflight:${identity.nonce}`],
  );
  await pool.query(
    "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','preflight',$4,1,0) ON CONFLICT DO NOTHING",
    [identity.runId, identity.missionId, identity.projectId, identity.policyRevision],
  );
  // ACTIVE with a live lease held by a named owner: `request()` refuses anything less.
  await pool.query(
    `INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,worker_id,lease_owner,lease_generation,lease_expires_at)
     VALUES($1,$2,'CODING_AGENT','preflight','ACTIVE',0,$3,'julius-live-preflight',$4,clock_timestamp()+($5::text||' minutes')::interval) ON CONFLICT DO NOTHING`,
    [identity.taskId, identity.runId, identity.workerId, identity.leaseGeneration, String(leaseMinutes)],
  );
}

/**
 * Records ONE invocation through the production tool repository — REQUESTED, then
 * AUTHORIZED — exactly as the live composition does before it asks the executor for a
 * sandbox. The digest recorded is the digest the executor will be handed.
 */
export async function seedPreflightInvocation(
  pool: Pool,
  identity: PreflightIdentity,
  input: { invocationId: string; requestDigest: string; requestedAt: string },
): Promise<void> {
  assertOwned(identity);
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
      ['julius_tasks', 'DELETE FROM relay_wonderland.julius_tasks WHERE run_id=$1', [identity.runId]],
      ['julius_runs', 'DELETE FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [identity.runId, identity.projectId]],
      ['mission_contracts', 'DELETE FROM relay_wonderland.mission_contracts WHERE mission_id=$1 AND project_id=$2', [identity.missionId, identity.projectId]],
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
  const remaining = await pool.query<{ total: string }>(
    `SELECT (SELECT count(*) FROM relay_wonderland.julius_sandboxes WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1)
          + (SELECT count(*) FROM relay_wonderland.julius_tasks WHERE run_id=$2)
          + (SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$2)
          + (SELECT count(*) FROM relay_wonderland.mission_contracts WHERE mission_id=$3)
          + (SELECT count(*) FROM relay_wonderland.projects WHERE project_id=$1) AS total`,
    [identity.projectId, identity.runId, identity.missionId],
  );
  return { deleted, remaining: Number(remaining.rows[0]?.total ?? 0) };
}
