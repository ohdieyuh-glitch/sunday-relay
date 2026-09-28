import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusAdmittedClaimFor } from '../mission/julius/julius-claim-ledger';
import { promoteJuliusMemoryClaim } from '../mission/julius/julius-memory-trust';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE CLAIM STORE ON REAL POSTGRESQL: append-only standings, current-by-highest
 * revision, replay writes nothing, history survives, a stranger project sees
 * nothing. Runs wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and
 * DATABASE_URL are set; `todo` everywhere else, so an absent database is a
 * skipped proof and never a passing one.
 */

const enabled = (process.env.JULIUS_REAL_POSTGRES === '1' || process.env.JULIUS_REAL_INFRA === '1')
  && Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.todo;

suite('the claim store on real PostgreSQL', () => {
  let pool: Pool;
  let claims: JuliusClaimPostgresRepository;
  const id = randomBytes(4).toString('hex');
  const projectId = `prj-claims-${id}`;
  const runId = `run:claims-${id}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // The run's ancestry, as the bootstrap seeds it: a project and a mission
    // contract, which `julius_runs` references.
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [projectId]);
    await pool.query(
      `INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY','hash','{}') ON CONFLICT DO NOTHING`,
      [`mission:claims-${id}`, projectId],
    );
    await pool.query(
      `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)
       VALUES($1,$2,$3,'EXECUTING','1','card',1,0)`,
      [runId, `mission:claims-${id}`, projectId],
    );
    claims = new JuliusClaimPostgresRepository(pool);
  });
  afterAll(async () => pool?.end());

  it('records an admission, refuses its replay, records a promotion, and serves the current standing with its history', async () => {
    const admitted = juliusAdmittedClaimFor({
      runId, projectId, taskId: 'build-1', workerId: 'coder', entryId: `entry:${id}:evidence`, kind: 'EVIDENCE',
      safeText: 'node --test: 4 passed.', evidenceIds: ['evidence:test-1'], occurredAt: '2026-09-27T10:00:00.000Z',
    });
    expect(await claims.recordClaimStanding({ runId, projectId, claim: admitted, reason: 'ADMITTED', occurredAt: '2026-09-27T10:00:00.000Z' })).toBe(true);
    expect(await claims.recordClaimStanding({ runId, projectId, claim: admitted, reason: 'ADMITTED', occurredAt: '2026-09-27T10:00:01.000Z' }),
      'the same standing again is not a new standing').toBe(false);

    const promoted = promoteJuliusMemoryClaim(admitted, { to: 'VERIFIED', by: 'reviewer', evidence: [{ kind: 'REVIEW', id: 'evidence:review-1' }], at: '2026-09-27T11:00:00.000Z' });
    expect(promoted.outcome).toBe('OK');
    if (promoted.outcome !== 'OK') return;
    expect(await claims.recordClaimStanding({ runId, projectId, claim: promoted.claim, reason: 'REVIEW_ACCEPTED', occurredAt: '2026-09-27T11:00:00.000Z' })).toBe(true);

    const current = await claims.claimsForRun(runId, projectId);
    expect(current).toHaveLength(1);
    expect(current[0]).toEqual(promoted.claim);

    const history = await claims.claimStandingHistory(admitted.claimId, projectId);
    expect(history.map((claim) => claim.trust)).toEqual(['SUPPORTED', 'VERIFIED']);
    expect(history[1]!.evidence).toEqual([{ kind: 'EVIDENCE', id: 'evidence:test-1' }, { kind: 'REVIEW', id: 'evidence:review-1' }]);

    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_claim_standings WHERE claim_id = $1', [admitted.claimId]);
    expect(rows.rows[0]!.n, 'two standings, two rows, nothing updated in place').toBe(2);
  });

  it('refuses a claim for a run this project does not hold, and shows another project nothing', async () => {
    const stranger = juliusAdmittedClaimFor({
      runId: 'run:nowhere', projectId, taskId: null, workerId: 'coder', entryId: `entry:${id}:stray`, kind: 'HANDOFF',
      safeText: 'x', evidenceIds: [], occurredAt: '2026-09-27T10:00:00.000Z',
    });
    expect(await claims.recordClaimStanding({ runId: 'run:nowhere', projectId, claim: stranger, reason: 'ADMITTED', occurredAt: '2026-09-27T10:00:00.000Z' })).toBe(false);
    expect(await claims.claimsForRun(runId, 'prj-someone-else')).toEqual([]);
  });
});
