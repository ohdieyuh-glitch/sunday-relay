import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../../src/relay/persistence/julius-test-database';

/**
 * THE `report_reason` COLUMN OF THE EVIDENCE BUNDLE'S scope.tsv, EVALUATED BY POSTGRESQL.
 *
 * `.github/julius-live-evidence-dump.sh` projects `julius.coder.report.refused` with ONE bounded reason column: the closed snake_case token Julius itself wrote, 1-64
 * characters of [a-z0-9_], and EMPTY for anything else and for every other event type. The text of that expression is pinned statically in coder-self-test.test.ts; this
 * suite runs the SAME text against a real database with hostile values, so the claim "it comes out empty" is PostgreSQL's, not a reading of the script.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database (the gate of the other real-postgres suites) and is `todo` everywhere else.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

const ROOT = join(__dirname, '..', '..');
const dump = readFileSync(join(ROOT, '.github', 'julius-live-evidence-dump.sh'), 'utf8');
const start = dump.indexOf("CASE WHEN e.event_type='julius.coder.report.refused'");
const end = dump.indexOf('AS report_reason', start);
/** The expression exactly as the dump script writes it, up to and excluding its alias. */
const EXPRESSION = start >= 0 && end > start ? dump.slice(start, end).trim() : '';

suite('the scope.tsv report_reason expression, run by PostgreSQL', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl as string, max: 1 }); });
  afterAll(async () => { await pool.end(); });

  const evaluate = async (eventType: string, facts: Record<string, unknown> | null): Promise<string | null> => {
    const payload = facts === null ? {} : { taskId: 't', facts };
    const result = await pool.query(`SELECT ${EXPRESSION} AS report_reason FROM (SELECT $1::text AS event_type, $2::jsonb AS payload) e`, [eventType, JSON.stringify(payload)]);
    return (result.rows[0] as { report_reason: string | null }).report_reason;
  };
  const REFUSED = 'julius.coder.report.refused';

  it('the expression was found in the dump script', () => {
    expect(EXPRESSION.startsWith('CASE WHEN')).toBe(true);
    expect(EXPRESSION.endsWith('END')).toBe(true);
  });

  it('a closed-alphabet token of 1-64 characters comes through unchanged, at both ends of the length bound', async () => {
    expect(await evaluate(REFUSED, { reasonCode: 'coding_agent_report_unknown_field' })).toBe('coding_agent_report_unknown_field');
    expect(await evaluate(REFUSED, { reasonCode: 'a' })).toBe('a');
    expect(await evaluate(REFUSED, { reasonCode: 'x'.repeat(64) })).toBe('x'.repeat(64));
    expect(await evaluate(REFUSED, { reasonCode: 'reason_2' })).toBe('reason_2');
  });

  it('every hostile value comes out empty: uppercase, a path, spaces, punctuation, 65 characters, empty, a number, a missing fact', async () => {
    const hostile: unknown[] = [
      'Coding_Agent_Report', 'CODING_AGENT', 'C:/Users/someone/file.txt', '../../etc/passwd', 'a/b', 'has space', 'semi;colon', 'quote\'s', 'dash-ed', 'dot.ted',
      'x'.repeat(65), 'x'.repeat(500), '', ' ', 'caf\u00e9', '\u00e9', 'line\nbreak', 'tab\tbed', 'a$b', 'a`b`',
    ];
    for (const value of hostile) expect(await evaluate(REFUSED, { reasonCode: value }), JSON.stringify(value)).toBeNull();
    expect(await evaluate(REFUSED, { reasonCode: 7 }), 'a number is not a token').toBe('7');
    expect(await evaluate(REFUSED, {}), 'no reasonCode fact').toBeNull();
    expect(await evaluate(REFUSED, null), 'no facts at all').toBeNull();
    expect(await evaluate(REFUSED, { reasonCode: null }), 'a JSON null').toBeNull();
  });

  it('every OTHER event type comes out empty even with a perfectly valid token', async () => {
    for (const type of ['julius.coder.scope.violated', 'julius.coder.implementation.recorded', 'julius.coder.attempt.workspace', 'julius.worker.channel.refused', 'julius.coder.report.refused.extra', '']) {
      expect(await evaluate(type, { reasonCode: 'coding_agent_report_unknown_field' }), type).toBeNull();
    }
  });
});
