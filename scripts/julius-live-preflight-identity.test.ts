import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusToolRecoveryPostgresRepository } from '../src/relay/persistence/julius-tool-recovery-postgres';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/sandbox-limits';
import {
  PREFLIGHT_PROJECT_PREFIX,
  cleanupPreflightIdentity,
  preflightIdentityFor,
  preflightNonce,
  seedPreflightIdentity,
  seedPreflightInvocation,
  type PreflightIdentity,
} from './julius-live-preflight-identity';

/**
 * REGRESSION — GitHub Actions run 33635375764, free dry run #2, and its proof in
 * PR #214: the executor's own persistence refused the preflight's first sandbox
 * with SQLSTATE 23503 because the preflight had seeded none of the ancestry
 * `julius_sandboxes` references. These cases run against a REAL PostgreSQL
 * (the same migrations, the same repositories) and prove the fixture is a
 * legitimate participant: the executor's insert succeeds, every identity field
 * matches the seeded rows, the foreign keys are still enabled, removing any
 * required parent — the invocation above all — brings 23503 back, another
 * preflight's rows cannot satisfy this one by accident, concurrent preflights
 * do not collide, and cleanup removes exactly this preflight's rows.
 *
 * They run wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and
 * DATABASE_URL point at a migrated-or-empty PostgreSQL — the sibling
 * infrastructure workflow's `first-live-topology` job — and are `todo`
 * elsewhere, like the other real-infrastructure cases. No provider is involved.
 */

const enabled = process.env.JULIUS_REAL_POSTGRES === '1' || process.env.JULIUS_REAL_INFRA === '1';
const suite = enabled ? describe : describe.todo;

/** The executor's identifier grammar (executor-schema.ts `identifier`). Every fixture id must satisfy it. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TENANT = 'tenant';
const POLICY = 'card:julius-live:1';

/** The sandbox record the executor persists on `createSandbox`, built from a fixture the way the preflight builds it. */
const sandboxRecord = (identity: PreflightIdentity, invocationId: string, overrides: Partial<{ projectId: string; runId: string; taskId: string }> = {}) => ({
  sandboxId: invocationId, invocationId, tenantId: identity.tenantId,
  projectId: overrides.projectId ?? identity.projectId, runId: overrides.runId ?? identity.runId, taskId: overrides.taskId ?? identity.taskId,
  leaseGeneration: identity.leaseGeneration, policyRevision: identity.policyRevision,
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  state: 'CREATING' as const, workspaceRef: null, runtimeKind: 'docker-rootless-boundary',
  limits: EXECUTOR_SANDBOX_LIMITS, policy: EXECUTOR_SANDBOX_POLICY, safeFailure: null,
  runtimeInstanceId: 'executor-preflight-regression', containerId: null, imageDigest: `sha256:${'0'.repeat(64)}`,
  lastHeartbeatAt: new Date().toISOString(),
});

const sqlstate = async (attempt: () => Promise<unknown>): Promise<string | null> => {
  try { await attempt(); return null; } catch (error) { return String((error as { code?: unknown }).code ?? 'no-code'); }
};

suite('dry run 33635375764 — the preflight identity satisfies the executor’s foreign keys', () => {
  let pool: Pool;
  let store: JuliusToolRecoveryPostgresRepository;
  const fixtures: PreflightIdentity[] = [];
  const fixture = (): PreflightIdentity => {
    const identity = preflightIdentityFor({ tenantId: TENANT, nonce: preflightNonce(), policyRevision: POLICY });
    fixtures.push(identity);
    return identity;
  };
  const invocationId = (identity: PreflightIdentity, step: number): string => `preflight:${identity.nonce}:${step}`;
  const seedInvocation = (identity: PreflightIdentity, step: number): Promise<void> =>
    seedPreflightInvocation(pool, identity, { invocationId: invocationId(identity, step), requestDigest: 'a'.repeat(64), requestedAt: new Date().toISOString() });
  const rowsFor = async (identity: PreflightIdentity): Promise<number> => {
    const result = await pool.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM relay_wonderland.julius_sandboxes WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.julius_tasks WHERE run_id=$2)
            + (SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$2)
            + (SELECT count(*) FROM relay_wonderland.mission_contracts WHERE mission_id=$3)
            + (SELECT count(*) FROM relay_wonderland.project_members WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.projects WHERE project_id=$1) AS total`,
      [identity.projectId, identity.runId, identity.missionId],
    );
    return Number(result.rows[0]?.total ?? 0);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    store = new JuliusToolRecoveryPostgresRepository(pool);
  });
  afterAll(async () => {
    for (const identity of fixtures) await cleanupPreflightIdentity(pool, identity).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it('applies the migrations and keeps every foreign key on the sandbox table enabled', async () => {
    const versions = await pool.query<{ version: string }>('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version');
    expect(versions.rows.length).toBeGreaterThanOrEqual(21);
    const keys = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint WHERE contype='f' AND conrelid='relay_wonderland.julius_sandboxes'::regclass`,
    );
    // projects, julius_runs, julius_tasks, and the composite key to julius_tool_invocations.
    expect(keys.rows.length).toBeGreaterThanOrEqual(4);
    for (const key of keys.rows) expect(key.convalidated, `${key.conname} must be enforced`).toBe(true);
  });

  it('seeds the ancestry before the first create, and the executor’s own persistence then accepts the sandbox', async () => {
    const identity = fixture();
    for (const id of [identity.projectId, identity.missionId, identity.runId, identity.taskId, invocationId(identity, 1)]) {
      expect(id).toMatch(IDENTIFIER);
    }
    await seedPreflightIdentity(pool, identity);
    // Fixture rows exist BEFORE any create is attempted.
    expect(await rowsFor(identity)).toBe(5);
    await seedInvocation(identity, 1);
    const invocation = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [invocationId(identity, 1)]);
    expect(invocation.rows[0]?.state).toBe('AUTHORIZED');

    // The exact insert that dry run #2 died on, through the executor's own repository.
    expect(await store.save(sandboxRecord(identity, invocationId(identity, 1)))).toBe(true);
    const saved = await pool.query<Record<string, string>>(
      'SELECT tenant_id, project_id, run_id, task_id, invocation_id, policy_revision, state FROM relay_wonderland.julius_sandboxes WHERE sandbox_id=$1',
      [invocationId(identity, 1)],
    );
    // Every identity field the executor persisted is the seeded ancestry, field for field.
    expect(saved.rows[0]).toEqual({
      tenant_id: identity.tenantId, project_id: identity.projectId, run_id: identity.runId, task_id: identity.taskId,
      invocation_id: invocationId(identity, 1), policy_revision: identity.policyRevision, state: 'CREATING',
    });
  });

  it('MUTATION: without the invocation seed, the executor’s insert fails with 23503 exactly as dry run #2 did', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    // The ancestry is there; the invocation is not.
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 1))))).toBe('23503');
    // And with the invocation present the same record is accepted.
    await seedInvocation(identity, 1);
    expect(await store.save(sandboxRecord(identity, invocationId(identity, 1)))).toBe(true);
  });

  it('removing any other required parent brings 23503 back too', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    await seedInvocation(identity, 2);
    const missing = preflightIdentityFor({ tenantId: TENANT, nonce: `${preflightNonce()}-unseeded`, policyRevision: POLICY });
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { taskId: missing.taskId })))).toBe('23503');
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { runId: missing.runId })))).toBe('23503');
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { projectId: missing.projectId })))).toBe('23503');
  });

  it('another preflight’s rows cannot satisfy this one by accident', async () => {
    const first = fixture();
    const second = fixture();
    await seedPreflightIdentity(pool, first);
    await seedPreflightIdentity(pool, second);
    await seedInvocation(first, 3);
    // Second's ancestry with first's invocation: the composite key needs all five columns to agree.
    expect(await sqlstate(() => store.save(sandboxRecord(second, invocationId(first, 3))))).toBe('23503');
    // First's project, but second's run and task: refused as well.
    expect(await sqlstate(() => store.save(sandboxRecord(first, invocationId(first, 3), { runId: second.runId, taskId: second.taskId })))).toBe('23503');
  });

  it('concurrent preflights carry distinct identities and both are accepted', async () => {
    const [a, b] = [fixture(), fixture()];
    expect(a.nonce).not.toBe(b.nonce);
    for (const key of ['projectId', 'missionId', 'runId', 'taskId'] as const) expect(a[key]).not.toBe(b[key]);
    expect(a.projectId.startsWith(PREFLIGHT_PROJECT_PREFIX)).toBe(true);
    await Promise.all([seedPreflightIdentity(pool, a), seedPreflightIdentity(pool, b)]);
    await Promise.all([seedInvocation(a, 1), seedInvocation(b, 1)]);
    const [savedA, savedB] = await Promise.all([store.save(sandboxRecord(a, invocationId(a, 1))), store.save(sandboxRecord(b, invocationId(b, 1)))]);
    expect(savedA).toBe(true);
    expect(savedB).toBe(true);
  });

  it('cleanup removes exactly this preflight’s rows and leaves every other preflight untouched', async () => {
    const mine = fixture();
    const theirs = fixture();
    await seedPreflightIdentity(pool, mine);
    await seedPreflightIdentity(pool, theirs);
    await seedInvocation(mine, 1);
    await seedInvocation(theirs, 1);
    await store.save(sandboxRecord(mine, invocationId(mine, 1)));
    await store.save(sandboxRecord(theirs, invocationId(theirs, 1)));
    const theirsBefore = await rowsFor(theirs);
    const players = await pool.query('SELECT count(*) AS n FROM relay_wonderland.players WHERE player_id=$1', [TENANT]);

    const report = await cleanupPreflightIdentity(pool, mine);
    expect(report.remaining).toBe(0);
    expect(report.deleted.julius_sandboxes).toBe(1);
    expect(report.deleted.julius_tool_invocations).toBe(1);
    expect(report.deleted.projects).toBe(1);
    expect(await rowsFor(mine)).toBe(0);
    expect(await rowsFor(theirs), 'the other preflight must be untouched').toBe(theirsBefore);
    // The tenant's player row is shared with the mission and is never deleted.
    expect((await pool.query('SELECT count(*) AS n FROM relay_wonderland.players WHERE player_id=$1', [TENANT])).rows[0]).toEqual(players.rows[0]);
  });

  it('refuses to clean up an identity it does not own', async () => {
    const foreign = { ...fixture(), projectId: 'prj-julius-first-live' };
    await expect(cleanupPreflightIdentity(pool, foreign)).rejects.toThrow('preflight_identity_not_owned');
  });
});

describe('the preflight identity module reaches PostgreSQL and nothing else', () => {
  it('imports no provider, no executor secret and no docker binding', () => {
    const source = readFileSync(resolve(__dirname, 'julius-live-preflight-identity.ts'), 'utf8');
    expect(source).not.toMatch(/openai|anthropic|hermes|claude-agent-sdk|EXECUTOR_SIGNING_KEY_PATH|EXECUTOR_RECEIPT_ROOT|docker/iu);
    // Every identifier is scoped by the nonce, so no two preflights can collide and cleanup has a boundary.
    expect(source).toContain("projectId: `${PREFLIGHT_PROJECT_PREFIX}${input.nonce}`");
    expect(source).toMatch(/runId: `run:julius-preflight-\$\{input\.nonce\}`/u);
  });
});
