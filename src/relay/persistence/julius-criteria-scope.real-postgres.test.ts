import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { createPostgresMissionSeedStore } from '../../../relay-bridge/julius/mission-seed';
import { JuliusReadPostgresRepository } from './julius-read-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import {
  juliusCriteriaScopeCases,
  type JuliusCriteriaScopeStore,
} from './julius-criteria-scope-conformance';

/**
 * THE CRITERIA-SCOPE CONTRACT, AGAINST THE STORE THAT BROKE IT.
 *
 * This is where the defect lived. `criterion_id` was the primary key ON ITS OWN and
 * the seed insert used a bare `ON CONFLICT DO NOTHING`, so the second run ever to
 * use an id got no criteria — silently, across every project and tenant. Migration
 * 028 re-keys the table on `(run_id, criterion_id)` and the insert now names that
 * target.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof and never a passing one.
 * It must NEVER read DATABASE_URL, which on this workstation points at the live
 * Julius store.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

suite('a criterion belongs to a run: real PostgreSQL', () => {
  let pool: Pool;
  /** One namespace per run of this suite, so repeated runs never collide. */
  const id = randomBytes(4).toString('hex');

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  }, 120_000);

  afterAll(async () => { await pool?.end(); });

  const store = (): JuliusCriteriaScopeStore => {
    const seeds = createPostgresMissionSeedStore(pool);
    const reads = new JuliusReadPostgresRepository(pool);
    // The conformance ids are fixed by design — two names any two missions would
    // plausibly pick. Namespacing them per suite run is what lets this file be run
    // twice against the same database without the first run's rows answering for
    // the second, which is the very confusion the defect was made of.
    const scope = (value: string): string => `${value}-${id}`;
    return {
      async createRun(runId, projectId) {
        // The full base a bootstrap would leave: the card version and the contract
        // snapshot are NOT decoration — `card_versions.card_version_id` is NOT NULL,
        // and omitting `cardRevision` failed every case here for a reason that had
        // nothing to do with criteria.
        await seeds.ensureBase({
          tenantId: `tenant-${id}`, projectId: scope(projectId),
          missionId: `mission:${scope(projectId)}`, executionId: `exec:${scope(runId)}`,
          cardRevision: 'card-1', missionSnapshot: { objective: 'criteria scope' },
          canonicalHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        });
        await pool.query(
          `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision,version,created_at,updated_at)
           VALUES($1,$2,$3,'READY','1','card-1',1,0,1,now(),now()) ON CONFLICT (run_id) DO NOTHING`,
          // ONE MISSION PER PROJECT, SEVERAL RUNS UNDER IT — which is the real shape
          // of a rerun, and the shape the defect destroyed: a rerun reuses the
          // contract, so it reuses every criterion id.
          [scope(runId), `mission:${scope(projectId)}`, scope(projectId)],
        );
      },
      async seed(runId, criteria) {
        await seeds.insertCriteria(scope(runId), criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          description: criterion.description,
          requiredEvidenceTypes: criterion.requiredEvidenceTypes,
        })));
      },
      async read(runId, projectId) {
        return reads.criteriaForRun(scope(runId), scope(projectId));
      },
    };
  };

  for (const scenario of juliusCriteriaScopeCases((actual, message) => expect(actual, message))) {
    it(scenario.name, async () => { await scenario.run(store()); }, 60_000);
  }

  it('the table is keyed on (run_id, criterion_id), which is what makes all of the above possible', async () => {
    // `::text[]` because an un-cast `array_agg` came back as the literal
    // '{run_id,criterion_id}' rather than a parsed array, and an assertion that
    // compares a string to an array fails for a reason that has nothing to do with
    // the schema it is meant to be checking.
    const result = await pool.query<{ columns: string[] }>(
      `SELECT array_agg(a.attname ORDER BY k.ord)::text[] AS columns
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = 'relay_wonderland.julius_acceptance_criteria'::regclass
          AND c.contype = 'p'`,
    );
    expect(result.rows[0]?.columns,
      'a single-column key here is the defect itself, so the schema is asserted and not assumed',
    ).toEqual(['run_id', 'criterion_id']);
  }, 60_000);
});
