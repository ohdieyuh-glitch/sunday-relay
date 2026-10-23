import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readJuliusPriorRunSpend, type SqlQueryable } from './julius-prior-spend';

function pool(handler: (sql: string, values: readonly unknown[] | undefined) => { rows: Record<string, unknown>[] }): SqlQueryable {
  return {
    async query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      return handler(sql, values) as { rows: T[] };
    },
  };
}

describe('prior spend is read from the durable ledger or reported unreadable', () => {
  it('an empty mission is a successful read of no prior run', async () => {
    const result = await readJuliusPriorRunSpend(pool(() => ({ rows: [] })), {
      missionId: 'julius-live-mission-5', projectId: 'project-1',
    });
    expect(result).toEqual({ readable: true, priorRuns: [] });
  });

  it('folds settled API bills and leaves a run with no settlements unverified', async () => {
    const result = await readJuliusPriorRunSpend(pool((sql) => {
      if (sql.includes('julius_runs')) return { rows: [{ run_id: 'run-billed' }, { run_id: 'run-empty' }] };
      return {
        rows: [{
          run_id: 'run-billed', task_id: 'build-1',
          facts: { role: 'CODING_AGENT', costBasis: 'PROVIDER_REPORTED', usdMicros: 2_000_000, billingPath: 'API_BILLED' },
        }],
      };
    }), { missionId: 'm', projectId: 'p' });
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.priorRuns).toEqual([
      { runId: 'run-billed', knownUsdMicros: 2_000_000, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: true },
      { runId: 'run-empty', knownUsdMicros: 0, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: false },
    ]);
  });

  it('a thrown query is unreadable, not an empty history', async () => {
    const result = await readJuliusPriorRunSpend({
      query: async () => { throw new Error('connection refused'); },
    }, { missionId: 'm', projectId: 'p' });
    expect(result).toEqual({ readable: false });
  });

  it('the live entry authorizes spend before it creates a run or assembles the runtime', () => {
    const entry = readFileSync('relay-bridge/julius-live-mission.ts', 'utf8');
    const authorize = entry.indexOf('const spendAuthorization = authorizeJuliusLiveSpend(');
    const create = entry.indexOf('const submitted = await bootstrap.submit(request)');
    const assemble = entry.indexOf('const runtime = assembleLiveJuliusRuntime(');
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(create);
    expect(create).toBeLessThan(assemble);
    expect(entry).toContain('spendCeilingUsdMicros: spendAuthorization.spendCeilingUsdMicros');
    expect(entry).not.toContain('contract.limits?.spendUsd ?? 5) * 1_000_000');
  });
});
