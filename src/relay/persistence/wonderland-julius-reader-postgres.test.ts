import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { WonderlandJuliusReaderPostgres } from './wonderland-julius-reader-postgres';
import { WONDERLAND_JULIUS_PAGE_LIMIT } from '../../../relay-bridge/wonderland-julius-routes';
import type { WonderlandJuliusReader } from '../../../relay-bridge/wonderland-julius-routes';

/**
 * THE READER, AGAINST THE SHAPES THE SCHEMA ACTUALLY RETURNS.
 *
 * There is no Postgres here, so what these tests can prove is the part that is
 * actually easy to get wrong and impossible to see: WHICH statements are issued,
 * what is bound into them, and what happens to the rows on the way out. Every
 * stub row is spelled the way `pg` really hands one over — `bigint` as a string,
 * `timestamptz` as something `new Date()` parses, `count(*)` as a string.
 *
 * The one thing NOT proven here is that the SQL is valid against the real
 * schema, and no stub can prove that. It is claimed nowhere.
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';

interface Issued {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A pool that answers each query from a matcher, and records what was asked. */
const pool = (answers: readonly { match: RegExp; rows: readonly unknown[] }[]) => {
  const issued: Issued[] = [];
  const fake = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      issued.push({ sql, values });
      const answer = answers.find((a) => a.match.test(sql));
      return { rows: answer?.rows ?? [], rowCount: answer?.rows.length ?? 0 };
    },
  };
  return { issued, reader: new WonderlandJuliusReaderPostgres(fake as unknown as Pool) };
};

const runRow = (over: Record<string, unknown> = {}) => ({
  state: 'EXECUTING',
  version: '7',
  mission_id: 'mission-1',
  card_revision: 'card:v3',
  at_sequence: '42',
  active_tasks: '2',
  pending_approvals: '0',
  observed_at: AT,
  ...over,
});

const eventRow = (sequence: number, type: string, inner: Record<string, unknown> = {}) => ({
  revision: '7',
  event_id: `event-${sequence}`,
  stream_id: RUN,
  project_id: PROJECT,
  sequence: String(sequence),
  event_type: `julius.${type}`,
  occurred_at: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    occurredAt: AT,
    payload: { runId: RUN, ...inner },
  },
});

/* ------------------------------------------------------------ the port */

describe('the reader satisfies the port without importing it', () => {
  it('is structurally a WonderlandJuliusReader', () => {
    // The assignment IS the assertion: if the class stops matching the port,
    // tsc rejects this line. Persistence never imports the Bridge at runtime —
    // this is a type-only import, which is what keeps the direction one-way.
    const reader: WonderlandJuliusReader = new WonderlandJuliusReaderPostgres({} as Pool);
    expect(typeof reader.hydrate).toBe('function');
    expect(typeof reader.events).toBe('function');
  });
});

/* --------------------------------------------------------- the hydration */

describe('hydrating a run', () => {
  it('reads the state, the version and the position in ONE statement', async () => {
    // The defect this prevents: a version from one moment and a sequence from
    // another describe a run that never existed, and the position is only worth
    // anything because it says which events the state already includes.
    const { issued, reader } = pool([
      { match: /FROM relay_wonderland\.julius_runs r/, rows: [runRow()] },
      { match: /FROM relay_wonderland\.events/, rows: [] },
    ]);
    const hydration = await reader.hydrate({
      projectId: PROJECT, runId: RUN, worldSessionId: 'world-1',
    });

    const runQuery = issued[0];
    expect(runQuery.sql).toContain('relay_wonderland.julius_runs');
    expect(runQuery.sql).toContain('MAX(e.sequence)');
    expect(runQuery.sql).toContain('julius_tasks');
    expect(runQuery.sql).toContain('julius_approvals');
    // One statement, so one consistent view of all four facts.
    expect(runQuery.sql.split(';').filter((part) => part.trim() !== '').length).toBe(1);

    expect(hydration?.run.revision).toBe(7);
    expect(hydration?.run.atSequence).toBe(42);
    expect(hydration?.run.state).toBe('EXECUTING');
    expect(hydration?.run.activeTasks).toBe(2);
    expect(hydration?.run.pendingApprovals).toBe(0);
    expect(hydration?.worldSessionId).toBe('world-1');
  });

  it('scopes by project as well as by run, in the WHERE clause', async () => {
    // Not filtered afterwards. A run belonging to another project produces no
    // row at all, so there is no branch on which its state could be read.
    const { issued, reader } = pool([]);
    await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(issued[0].sql).toMatch(/WHERE r\.run_id=\$1 AND r\.project_id=\$2/);
    expect(issued[0].values).toEqual([RUN, PROJECT]);
  });

  it('answers null for a run this project does not have', async () => {
    const { reader } = pool([]);
    expect(await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null })).toBeNull();
  });

  it('refuses a state the kernel cannot hold rather than coercing it', async () => {
    // The visual mapping is total over `JULIUS_MISSION_STATES` and nothing
    // else. A row holding something outside it — an older build, a restore, a
    // hand edit — must not be pushed through it.
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow({ state: 'ASCENDED' })] },
    ]);
    expect(await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null })).toBeNull();
  });

  it('leaves the position null when the run has no events, and never guesses', async () => {
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow({ at_sequence: null })] },
    ]);
    const hydration = await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(hydration?.run.atSequence).toBeNull();
  });

  it('reads bigints and counts as the driver actually returns them', async () => {
    // `pg` hands back `bigint` and `count(*)` as STRINGS. A reader that passed
    // them through would put "7" where a number belongs and every comparison
    // downstream would be a string comparison.
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow({ version: '900719925474099', at_sequence: '1000' })] },
    ]);
    const hydration = await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(hydration?.run.revision).toBe(900719925474099);
    expect(typeof hydration?.run.revision).toBe('number');
    expect(typeof hydration?.run.atSequence).toBe('number');
  });
});

/* ----------------------------------------------- what it does not claim */

describe('what the hydration refuses to make up', () => {
  const hydrate = async () => {
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow()] },
      { match: /FROM relay_wonderland\.events/, rows: [] },
    ]);
    return reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
  };

  it('draws the meters UNKNOWN, because no authority reports into them', async () => {
    const hydration = await hydrate();
    for (const meter of [hydration?.usage.compoundAgent, hydration?.usage.singleAgent]) {
      // Every figure, not one of them: a meter that knew its capacity and not
      // its usage would draw a full bar.
      expect(meter?.capacityUnits.known).toBe(false);
      expect(meter?.usedUnits.known).toBe(false);
      expect(meter?.remainingUnits.known).toBe(false);
      // And no tier is invented either, since a tier changes the arc's length.
      expect(meter?.tierId).toBeNull();
    }
    expect(hydration?.usageStatus.reading).not.toBe('known');
  });

  it('cites no Project Brain, rather than citing an empty one', async () => {
    const hydration = await hydrate();
    // `contentHash` blank is what `wonderlandBrainWasReported` reads as "no
    // authority said anything" — as opposed to "a retrieval happened and found
    // nothing", which is a different and much stronger claim.
    expect(hydration?.brain.contentHash).toBe('');
  });

  it('carries the C.A.R.D. revision and leaves every slot NULL', async () => {
    // `julius_runs.card_revision` is free text with no foreign key, and nothing
    // in this layer reads `card_versions`. The revision is a real opaque
    // handle; the slots are unknown, and `false` would draw three unfilled
    // roles as an observation.
    const hydration = await hydrate();
    expect(hydration?.card.cardRevision).toBe('card:v3');
    expect(hydration?.card.hasPromptArchitect).toBeNull();
    expect(hydration?.card.hasCodingAgent).toBeNull();
    expect(hydration?.card.hasIndependentReviewer).toBeNull();
  });

  it('carries no provider or model name anywhere in the payload', async () => {
    const hydration = await hydrate();
    const serialised = JSON.stringify(hydration).toLowerCase();
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'xai', 'gemini']) {
      expect(serialised).not.toContain(name);
    }
  });
});

/* ------------------------------------------------------ the activity fold */

describe('the activity fold', () => {
  it('is bounded by the position the SAME statement reported', async () => {
    // Unbounded, the fold could see events written since the run row was read.
    // The client would be told about them here and receive them again in the
    // tail, and the subagent counters — which move up as well as down, unlike
    // the signals — would be applied twice.
    const { issued, reader } = pool([
      { match: /julius_runs r/, rows: [runRow({ at_sequence: '42' })] },
      { match: /FROM relay_wonderland\.events/, rows: [] },
    ]);
    await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });

    const fold = issued[1];
    expect(fold.sql).toContain('sequence<=$3');
    expect(fold.values).toEqual([RUN, PROJECT, 42]);
  });

  it('does not read a single event when there is no position to bound it', async () => {
    const { issued, reader } = pool([
      { match: /julius_runs r/, rows: [runRow({ at_sequence: null })] },
    ]);
    await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(issued.length).toBe(1);
  });

  it('folds signals the run actually raised', async () => {
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow()] },
      {
        match: /FROM relay_wonderland\.events/,
        rows: [
          eventRow(1, 'approval.requested', { approvalId: 'a-1', taskId: 'task-1' }),
          eventRow(2, 'subagent.spawned', { subagentId: 's-1', taskId: 'task-1' }),
        ],
      },
    ]);
    const hydration = await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(hydration?.activity.signals).toContain('awaiting_approval');
    expect(hydration?.activity.activeSubagents).toBe(1);
  });

  it('passes over a row the catalogue does not model without stopping', async () => {
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow()] },
      {
        match: /FROM relay_wonderland\.events/,
        rows: [
          { ...eventRow(1, 'not.a.real.type') },
          eventRow(2, 'approval.requested', { approvalId: 'a-1', taskId: 'task-1' }),
        ],
      },
    ]);
    const hydration = await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    expect(hydration?.activity.signals).toContain('awaiting_approval');
  });

  it('is consistent with the hydration it belongs to', async () => {
    const { reader } = pool([
      { match: /julius_runs r/, rows: [runRow()] },
      { match: /FROM relay_wonderland\.events/, rows: [eventRow(1, 'run.created', { missionId: 'm' })] },
    ]);
    const hydration = await reader.hydrate({ projectId: PROJECT, runId: RUN, worldSessionId: null });
    // The route re-verifies exactly this; a reader whose parts disagreed about
    // the run or the project would be refused there rather than here.
    expect(hydration?.activity.projectId).toBe(hydration?.projectId);
    expect(hydration?.activity.runId).toBe(hydration?.run.runId);
  });
});

/* ------------------------------------------------------------ the events */

describe('reading the tail', () => {
  it('returns raw rows and the run version from ONE statement', async () => {
    const { issued, reader } = pool([
      { match: /LEFT JOIN LATERAL/, rows: [eventRow(43, 'run.transitioned', { to: 'REVIEWING' })] },
    ]);
    const page = await reader.events({
      projectId: PROJECT, runId: RUN, afterSequence: 42, limit: WONDERLAND_JULIUS_PAGE_LIMIT,
    });

    expect(issued.length).toBe(1);
    expect(page.revision).toBe(7);
    expect(page.rows.length).toBe(1);
    expect(page.rows[0].eventId).toBe('event-43');
    expect(page.rows[0].sequence).toBe(43);
    expect(typeof page.rows[0].sequence).toBe('number');
    expect(page.rows[0].occurredAt).toBe(AT);
  });

  it('still reports the revision when the page is empty', async () => {
    // The reason the query is anchored on the RUN and joins the events, rather
    // than the other way round: an events-anchored query returns nothing at the
    // end of a stream and leaves the caller inventing a revision.
    const { reader } = pool([
      {
        match: /LEFT JOIN LATERAL/,
        rows: [{
          revision: '9', event_id: null, stream_id: null, project_id: null,
          sequence: null, event_type: null, payload: null, occurred_at: null,
        }],
      },
    ]);
    const page = await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 99, limit: 10 });
    expect(page.revision).toBe(9);
    expect(page.rows).toEqual([]);
  });

  it('binds the cursor and the limit rather than interpolating them', async () => {
    const { issued, reader } = pool([]);
    await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 42, limit: 500 });
    expect(issued[0].values).toEqual([RUN, PROJECT, 42, 500]);
    expect(issued[0].sql).not.toContain('42');
    expect(issued[0].sql).toContain('sequence>$3');
    expect(issued[0].sql).toContain('LIMIT $4');
  });

  it('scopes to the project and to Julius rows only', async () => {
    const { issued, reader } = pool([]);
    await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 0, limit: 10 });
    expect(issued[0].sql).toContain('project_id=r.project_id');
    expect(issued[0].sql).toContain(`event_type LIKE 'julius.%'`);
  });

  it('returns an empty page and reaches nothing when the run has gone', async () => {
    // A run deleted between two requests. The revision it is paired with can
    // reach no client, because there are no rows for it to be attached to.
    const { reader } = pool([]);
    const page = await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 0, limit: 10 });
    expect(page.rows).toEqual([]);
    expect(page.revision).toBe(0);
  });

  it('parses a payload the driver handed back as text', async () => {
    const row = eventRow(1, 'run.created', { missionId: 'm' });
    const { reader } = pool([
      { match: /LEFT JOIN LATERAL/, rows: [{ ...row, payload: JSON.stringify(row.payload) }] },
    ]);
    const page = await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 0, limit: 10 });
    expect((page.rows[0].payload as { schemaVersion: string }).schemaVersion).toBe('relay-julius-event.v1');
  });

  it('survives one unparseable payload rather than failing the page', async () => {
    const { reader } = pool([
      { match: /LEFT JOIN LATERAL/, rows: [{ ...eventRow(1, 'run.created'), payload: '{not json' }] },
    ]);
    const page = await reader.events({ projectId: PROJECT, runId: RUN, afterSequence: 0, limit: 10 });
    // The row survives to the ledger adapter, which refuses it by name. One bad
    // row must not take down a whole page.
    expect(page.rows.length).toBe(1);
    expect(page.rows[0].payload).toEqual({});
  });
});
