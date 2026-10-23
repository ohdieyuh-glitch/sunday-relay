import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { juliusSpentTagMessage } from '../../src/relay/mission/julius/julius-spend-ceiling';
import { readJuliusPriorRunSpend, readJuliusSpentTagLedger, type SqlQueryable } from './julius-prior-spend';

function pool(handler: (sql: string, values: readonly unknown[] | undefined) => { rows: Record<string, unknown>[] }): SqlQueryable {
  return {
    async query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      return handler(sql, values) as { rows: T[] };
    },
  };
}

describe('prior spend is read from the durable ledger or reported unreadable', () => {
  it('an empty local database is an absent durable record, not a verified zero', async () => {
    const result = await readJuliusPriorRunSpend(pool(() => ({ rows: [] })), {
      missionId: 'julius-live-mission-5', projectId: 'project-1',
    });
    expect(result).toEqual({ readable: true, priorRuns: [], durableRecord: 'ABSENT' });
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
    const tags = entry.indexOf('readJuliusSpentTagLedger(');
    expect(tags).toBeGreaterThan(-1);
    expect(tags).toBeLessThan(create);
    expect(entry).toContain('JULIUS_QUALIFYING_PAIR_NAMESPACES');
    expect(entry).toContain('spendCeilingUsdMicros: spendAuthorization.spendCeilingUsdMicros');
    expect(entry).not.toContain('contract.limits?.spendUsd ?? 5) * 1_000_000');
  });
});

const HEX = '0123456789abcdef01234567';
const TOKEN = 'ghs_test_not_a_real_token';

function github(handler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    return handler(href, init);
  }) as typeof fetch;
}

describe('the spent-tag listing is the durable record the cap reads', () => {
  it('an empty listing is a verified zero, and the token stays out of the url', async () => {
    const seen: string[] = [];
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github((url, init) => {
        seen.push(url);
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
        expect(url).not.toContain(TOKEN);
        return new Response('[]', { status: 200 });
      }),
    });
    expect(seen).toEqual(['https://api.github.com/repos/ohdieyuh-glitch/sunday-relay/git/matching-refs/tags/julius-run-spent-']);
    expect(result).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
  });

  it('reads an annotated ceiling, skips this run\'s own tag, and fails closed on a bad response', async () => {
    const prior = 'abcdef0123456789abcdef01';
    const message = juliusSpentTagMessage({
      runId: `run:${prior}`, namespace: 'julius-live-mission-5', reservedUsdMicros: 30_000_000,
    });
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      excludeRunId: `run:${HEX}`,
      fetchImpl: github((url) => {
        if (url.endsWith('/julius-run-spent-')) {
          return new Response(JSON.stringify([
            { ref: `refs/tags/julius-run-spent-${HEX}`, object: { type: 'commit', sha: 'a'.repeat(40) } },
            { ref: `refs/tags/julius-run-spent-${prior}`, object: { type: 'tag', sha: 'b'.repeat(40) } },
          ]), { status: 200 });
        }
        expect(url).toBe(`https://api.github.com/repos/ohdieyuh-glitch/sunday-relay/git/tags/${'b'.repeat(40)}`);
        return new Response(JSON.stringify({ message }), { status: 200 });
      }),
    });
    expect(result).toEqual({
      readable: true,
      durableRecord: 'PRESENT',
      priorRuns: [{
        runId: `run:${prior}`, knownUsdMicros: 30_000_000, unknownCostComponents: 0,
        unverifiableApiSpend: false, spendVerified: true,
      }],
    });

    const broken = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => new Response('no', { status: 500 })),
    });
    expect(broken).toEqual({ readable: false });
    const dropped = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => { throw new Error('network down'); }),
    });
    expect(dropped).toEqual({ readable: false });
    const missing = await readJuliusSpentTagLedger({
      repository: '',
      token: '',
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => { throw new Error('must not be called'); }),
    });
    expect(missing).toEqual({ readable: false });
  });

  it('does not follow a next link off api.github.com', async () => {
    const seen: string[] = [];
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github((url) => {
        seen.push(url);
        return new Response('[]', {
          status: 200,
          headers: { link: '<https://example.invalid/tags>; rel="next"' },
        });
      }),
    });
    expect(seen).toHaveLength(1);
    expect(result).toEqual({ readable: false });
  });
});
