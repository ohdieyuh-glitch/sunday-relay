import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appendJuliusEventWithin, juliusEventPayload } from './julius-event-postgres';
import { JuliusEventIdConflict, type JuliusOperationalEvent } from '../mission/julius';

/**
 * THE POSTGRESQL HALF, WITHOUT A DATABASE.
 *
 * The append that a decision performs inside its own transaction is the same
 * append the event port performs in one of its own — same identity comparison,
 * same typed conflict, same run-ownership check, same outbox row. Proving that
 * end to end needs real PostgreSQL and does so in CI; proving it HERE is what
 * makes the rule checkable on every run, on a laptop, in seconds.
 *
 * The second half checks the wiring structurally: that the decision's write is
 * the thing that calls it. A function that is correct and unreached fixes
 * nothing.
 */

const EVENT: JuliusOperationalEvent = {
  eventId: 'event:1', runId: 'run-1', projectId: 'prj-1', type: 'verification.decided',
  taskId: 'task-1', workerId: null, correlationId: 'corr-1', causationId: null,
  occurredAt: '2099-01-01T00:00:00.000Z', facts: { action: 'ACCEPT' },
};

/** A transaction that answers from a script and remembers what it was asked. */
const fakeClient = (rows: { existing?: { sequence: string; payload: unknown }; runOwned?: boolean }) => {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  return {
    queries,
    query: async (sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes('FROM relay_wonderland.events WHERE event_id')) {
        return { rows: rows.existing === undefined ? [] : [rows.existing], rowCount: rows.existing === undefined ? 0 : 1 };
      }
      if (sql.includes('FROM relay_wonderland.julius_runs WHERE run_id')) {
        return { rows: (rows.runOwned ?? true) ? [{ ok: 1 }] : [], rowCount: (rows.runOwned ?? true) ? 1 : 0 };
      }
      if (sql.includes('stream_sequences')) return { rows: [{ sequence: '7' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
};

describe('an event appended inside someone elses transaction', () => {
  it('writes the event and its outbox row, and takes no transaction of its own', async () => {
    const client = fakeClient({});
    const outcome = await appendJuliusEventWithin(client, EVENT);
    expect(outcome).toEqual({ recorded: true, sequence: 7 });

    const sql = client.queries.map((query) => query.sql).join(' | ');
    expect(sql, 'the event row').toContain('INSERT INTO relay_wonderland.events');
    expect(sql, 'the outbox row: an event written inside a decision is still a published event').toContain('INSERT INTO relay_wonderland.outbox');
    expect(sql, 'the run must be owned by the project').toContain('FROM relay_wonderland.julius_runs WHERE run_id');
    expect(sql, 'it must not open or close a transaction — it is inside one').not.toMatch(/BEGIN|COMMIT|ROLLBACK/u);
  });

  it('is idempotent for a replay of the same event, and writes nothing', async () => {
    const client = fakeClient({ existing: { sequence: '3', payload: juliusEventPayload(EVENT) } });
    expect(await appendJuliusEventWithin(client, EVENT)).toEqual({ recorded: false, sequence: 3 });
    expect(client.queries.map((query) => query.sql).join(' | ')).not.toContain('INSERT INTO relay_wonderland.events');
  });

  it('refuses a different event under a used id, with the typed conflict', async () => {
    const client = fakeClient({ existing: { sequence: '3', payload: juliusEventPayload({ ...EVENT, facts: { action: 'REPAIR' } }) } });
    const error = await appendJuliusEventWithin(client, EVENT).then(() => null, (raised: unknown) => raised);
    expect(error).toBeInstanceOf(JuliusEventIdConflict);
    expect((error as JuliusEventIdConflict).eventId).toBe('event:1');
  });

  it('refuses an event for a run this project does not own', async () => {
    const client = fakeClient({ runOwned: false });
    await expect(appendJuliusEventWithin(client, EVENT)).rejects.toThrow('julius_run_not_found');
  });

  it('refuses an event the validator would refuse, before it writes anything', async () => {
    const client = fakeClient({});
    await expect(appendJuliusEventWithin(client, { ...EVENT, eventId: '  ' })).rejects.toThrow('julius_event_identity_required');
    expect(client.queries, 'nothing was asked of the transaction').toHaveLength(0);
  });
});

describe('the decision write is what calls it', () => {
  it('appends the decisions events inside the decisions own transaction', () => {
    const source = readFileSync(join(process.cwd(), 'src/relay/persistence/julius-postgres.ts'), 'utf8');
    const decision = source.slice(source.indexOf('async appendDecision('));
    const body = decision.slice(0, decision.indexOf('\n  async '));
    expect(body, 'the events go in with the decision').toContain('for(const event of input.events??[])await appendJuliusEventWithin(client,event);');
    expect(body, 'and inside the transaction that carries the decision and the release').toContain('return this.transaction(');
    // The release happens before them and the whole thing is one commit, so an
    // event that cannot be written takes the decision and the release with it.
    expect(body.indexOf('appendJuliusEventWithin'), 'after the release, inside the same transaction')
      .toBeGreaterThan(body.indexOf("SET state='RUNNABLE'"));
  });
});
