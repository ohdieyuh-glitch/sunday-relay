import { describe, expect, it } from 'vitest';

import {
  handleWonderlandReadinessRoute,
  judgeWonderlandLedger,
  readWonderlandReadinessReport,
  WONDERLAND_SHIPPED_CHAIN,
  wonderlandStoreFailureReason,
} from './wonderland-store-readiness';

/**
 * THE LEDGER, JUDGED AGAINST THE CHAIN THIS BUILD SHIPS, AND THE ROUTE THAT SAYS SO.
 *
 * Pure cases: no database. The real-PostgreSQL rehearsal
 * (`wonderland-hosted-store.real-postgres.test.ts`) runs the same judgement
 * over real ledgers, through the real bridge process.
 */

const CHAIN = ['001_a', '002_b', '003_c', '004_d'];

describe('the ledger, against the chain', () => {
  it('a fresh store is nothing applied and everything pending; a complete one is through the last stamp', () => {
    expect(judgeWonderlandLedger(new Set(), CHAIN)).toEqual({ applied: 0, expected: 4, through: null, pending: CHAIN, gapFree: true, unknown: [] });
    expect(judgeWonderlandLedger(new Set(CHAIN), CHAIN)).toEqual({ applied: 4, expected: 4, through: '004_d', pending: [], gapFree: true, unknown: [] });
    expect(judgeWonderlandLedger(new Set(['001_a', '002_b']), CHAIN)).toMatchObject({ through: '002_b', pending: ['003_c', '004_d'], gapFree: true });
  });

  it('a gap is a gap however the rest reads, and "through" is the last stamp before it', () => {
    expect(judgeWonderlandLedger(new Set(['001_a', '003_c', '004_d']), CHAIN)).toMatchObject({ applied: 3, through: '001_a', pending: ['002_b'], gapFree: false });
    expect(judgeWonderlandLedger(new Set(['002_b']), CHAIN)).toMatchObject({ through: null, gapFree: false });
  });

  it('a stamp this build neither ships nor stages is named, and the staged voice stamp is not', () => {
    expect(judgeWonderlandLedger(new Set([...CHAIN, '099_future']), CHAIN).unknown).toEqual(['099_future']);
    expect(judgeWonderlandLedger(new Set([...CHAIN, '035_wonderland_voice']), CHAIN).unknown).toEqual([]);
  });

  it('the shipped chain is the migrate() order, through social', () => {
    expect(WONDERLAND_SHIPPED_CHAIN[0]).toMatch(/^001_/u);
    expect(WONDERLAND_SHIPPED_CHAIN.at(-1)).toBe('033_wonderland_social');
    expect(new Set(WONDERLAND_SHIPPED_CHAIN).size).toBe(WONDERLAND_SHIPPED_CHAIN.length);
  });
});

describe('a failure is a code, never the driver\'s words', () => {
  it('keeps a driver code and drops every message', () => {
    expect(wonderlandStoreFailureReason(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
    expect(wonderlandStoreFailureReason(Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' }))).toBe('28P01');
    expect(wonderlandStoreFailureReason(new Error('wonderland_store_probe_timeout'))).toBe('TIMEOUT');
    expect(wonderlandStoreFailureReason(new Error('host db.internal.example said no'))).toBe('ERROR');
    expect(wonderlandStoreFailureReason({ code: 'not a code; DROP TABLE' })).toBe('ERROR');
  });
});

describe('the route', () => {
  const boot = { bootId: 'b0'.repeat(16), startedAt: '2026-10-04T12:00:00.000Z' };
  const read = async () => readWonderlandReadinessReport({ pool: null, missingConfig: ['JULIUS_DATABASE_URL', 'DATABASE_URL'], env: {}, boot });

  it('answers the operator, and only the operator, and only GET', async () => {
    expect(await handleWonderlandReadinessRoute({ method: 'GET', path: '/wonderland/social/me', operator: true }, read)).toBeNull();
    expect((await handleWonderlandReadinessRoute({ method: 'GET', path: '/wonderland/readiness', operator: false }, read))?.status).toBe(401);
    expect((await handleWonderlandReadinessRoute({ method: 'POST', path: '/wonderland/readiness', operator: true }, read))?.status).toBe(405);
    const answered = await handleWonderlandReadinessRoute({ method: 'GET', path: '/wonderland/readiness', operator: true }, read);
    expect(answered).toEqual({
      status: 200,
      body: {
        data: {
          version: 'wonderland-store-readiness.v1',
          database: { state: 'NOT_CONFIGURED', missingConfig: ['JULIUS_DATABASE_URL', 'DATABASE_URL'] },
          ledger: null,
          surfaces: { social: 'UNKNOWN', voiceSchema: 'UNKNOWN', eosClientConfig: 'NOT_CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' },
          sessions: 'IN_MEMORY_REVOKED_ON_RESTART',
          bridge: { commit: null, attestedBy: null, production: false, bootId: 'b0'.repeat(16), startedAt: '2026-10-04T12:00:00.000Z' },
        },
      },
    });
  });

  it('names the build its platform attests, whatever state the database is in', async () => {
    const commit = 'A1B2C3'.padEnd(40, 'F');
    const report = await readWonderlandReadinessReport({
      pool: null, missingConfig: ['JULIUS_DATABASE_URL'], env: { RAILWAY_GIT_COMMIT_SHA: ` ${commit} `, RAILWAY_ENVIRONMENT: 'production' }, boot,
    });
    expect(report.database.state).toBe('NOT_CONFIGURED');
    expect(report.bridge).toEqual({ commit: commit.toLowerCase(), attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, ...boot });
  });
});
