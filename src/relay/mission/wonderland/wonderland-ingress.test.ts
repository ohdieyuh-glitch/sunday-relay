import { describe, expect, it } from 'vitest';

import { emptyJuliusActivity } from './wonderland-julius-activity';
import { openWonderlandCursor } from './wonderland-ordering';
import { adoptWonderlandSnapshot, wonderlandRunSnapshot } from './wonderland-rehydration';
import {
  WONDERLAND_INGRESS_REFUSALS,
  ingestWonderlandRows,
  summarizeWonderlandIngress,
  wonderlandIngressScope,
} from './wonderland-ingress';
import type { WonderlandIngressGrant } from './wonderland-ingress';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';

/** A row shaped the way `julius-postgres.ts` really writes one. */
const row = (
  sequence: number,
  type: string,
  inner: Record<string, unknown> = {},
  over: Partial<WonderlandLedgerRow> = {},
): WonderlandLedgerRow => ({
  eventId: `event-${sequence}`,
  streamId: RUN,
  projectId: PROJECT,
  sequence,
  eventType: `julius.${type}`,
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    occurredAt: AT,
    payload: { runId: RUN, ...inner },
  },
  ...over,
});

const grant: WonderlandIngressGrant = { projectId: PROJECT, runId: RUN };

const ingest = (
  rows: readonly WonderlandLedgerRow[],
  over: Partial<Parameters<typeof ingestWonderlandRows>[0]> = {},
) =>
  ingestWonderlandRows({
    grant,
    rows,
    revision: 5,
    cursor: openWonderlandCursor({ projectId: PROJECT, runId: RUN }),
    activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
    ...over,
  });

/* ------------------------------------------------------------- the scope */

describe('a session sees only what it was granted', () => {
  it('refuses another project as a SECURITY refusal, not a routing one', () => {
    const result = ingest([row(1, 'run.transitioned', { to: 'EXECUTING' }, { projectId: 'project-beta' })]);
    expect(result.refusals.unauthorized_project).toBe(1);
    expect(result.refusals.out_of_order).toBe(0);
    expect(result.deliveries).toEqual([]);
  });

  it('refuses another run when the grant names one', () => {
    const result = ingest([row(1, 'run.transitioned', { to: 'EXECUTING' }, { streamId: 'run-2' })]);
    expect(result.refusals.unauthorized_run).toBe(1);
    expect(result.deliveries).toEqual([]);
  });

  it('watches a whole project when the grant names no run', () => {
    const result = ingest([row(1, 'run.transitioned', { to: 'EXECUTING' }, { streamId: 'run-9' })], {
      grant: { projectId: PROJECT, runId: null },
    });
    expect(result.refusals.unauthorized_run).toBe(0);
    expect(result.deliveries.length).toBe(1);
  });

  it('grants nothing to a session with no project', () => {
    // Silence about identity is not permission, here as everywhere.
    expect(wonderlandIngressScope({ projectId: '', runId: null }, row(1, 'run.created'))).toBe(
      'unauthorized_project',
    );
    expect(wonderlandIngressScope({ projectId: '   ', runId: null }, row(1, 'run.created'))).toBe(
      'unauthorized_project',
    );
  });

  it('grants nothing even when the ROW names no project either', () => {
    // The case the blank check actually guards: comparing two blanks finds
    // them equal, so without it an ungranted session would be handed a
    // nameless row. Every other row is refused by the comparison alone, which
    // makes this the only test that can see the check at all.
    const nameless = { ...row(1, 'run.created'), projectId: '' };
    expect(wonderlandIngressScope({ projectId: '', runId: null }, nameless)).toBe(
      'unauthorized_project',
    );
  });

  it('scopes on the ROW, not on the payload', () => {
    // The row's column is what the database indexed and what a query filtered
    // on. The payload is content, written by another subsystem, and a scope
    // check that trusted it could be told anything.
    const lying = row(1, 'run.transitioned', { to: 'EXECUTING' }, { projectId: 'project-beta' });
    (lying.payload as { projectId: string }).projectId = PROJECT;
    expect(wonderlandIngressScope(grant, lying)).toBe('unauthorized_project');
  });

  it('never mutates the client on a refusal, activity included', () => {
    // The rows are chosen to RAISE SIGNALS if they were ever folded.
    // `run.transitioned` raises none, so a version of this test built from
    // transitions would pass with the scope check moved after the fold — and
    // an ungranted project's swarm would show on this world's activity axis.
    const before = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const result = ingest(
      [
        row(1, 'subagent.spawned', {}, { projectId: 'project-beta' }),
        row(2, 'approval.requested', {}, { streamId: 'run-2' }),
      ],
      { cursor: before },
    );
    expect(result.activity.activeSubagents).toBe(0);
    expect(result.cursor.sequence).toBe(before.sequence);
    expect(result.cursor.revision).toBe(before.revision);
    expect(result.cursor.applied).toBe(0);
    expect(result.activity.signals).toEqual([]);
  });
});

/* ------------------------------------------------------- the five stages */

describe('decode, validate, order, fold', () => {
  it('applies a readable, drawable, in-order row', () => {
    const result = ingest([row(1, 'run.transitioned', { to: 'EXECUTING' })]);
    expect(result.deliveries.length).toBe(1);
    expect(result.deliveries[0].envelope.state).toBe('coding');
    expect(result.cursor.applied).toBe(1);
    expect(result.cursor.sequence).toBe(1);
  });

  it('counts a row it cannot decode apart from one it cannot draw', () => {
    const result = ingest([
      row(1, 'run.transitioned', { to: 'EXECUTING' }),
      { ...row(2, 'run.created'), eventType: 'battle.presence.joined' },
      row(3, 'budget.reserved'),
      row(4, 'finding.recorded'),
    ]);
    expect(result.deliveries.length).toBe(1);
    expect(result.refusals.unreadable).toBe(1);
    expect(result.refusals.silent).toBe(1);
    expect(result.refusals.no_state).toBe(1);
  });

  it('refuses an out-of-order row and says which axis refused it', () => {
    const result = ingest([
      row(9, 'run.transitioned', { to: 'EXECUTING' }),
      row(4, 'run.transitioned', { to: 'PLANNING' }),
    ]);
    expect(result.deliveries.length).toBe(1);
    expect(result.refusals.out_of_order).toBe(1);
    expect(result.orderingVerdicts.stale_sequence).toBe(1);
    expect(result.orderingVerdicts.applied).toBe(1);
  });

  it('refuses a duplicate delivery of the same event', () => {
    const first = ingest([row(3, 'run.transitioned', { to: 'EXECUTING' })]);
    const again = ingest([row(3, 'run.transitioned', { to: 'EXECUTING' })], {
      cursor: first.cursor,
      activity: first.activity,
    });
    expect(again.deliveries).toEqual([]);
    expect(again.orderingVerdicts.duplicate).toBe(1);
  });

  it('folds activity from events that produce NO envelope', () => {
    // `finding.recorded` and both subagent events say nothing about the phase
    // and everything about what is going on. A pipeline that only folded what
    // it could draw would drop exactly the signals the second axis carries.
    const result = ingest([
      row(1, 'subagent.spawned'),
      row(2, 'subagent.spawned'),
      row(3, 'approval.requested'),
    ]);
    expect(result.deliveries).toEqual([]);
    expect(result.activity.signals).toContain('swarming');
    expect(result.activity.signals).toContain('awaiting_approval');
    expect(result.activity.activeSubagents).toBe(2);
  });

  it('ships the activity fold AS OF each delivery, not a delta', () => {
    // A delta would need the receiver to have applied every previous one, which
    // a client that just reconnected has not.
    const result = ingest([
      row(1, 'subagent.spawned'),
      row(2, 'run.transitioned', { to: 'EXECUTING' }),
    ]);
    expect(result.deliveries.length).toBe(1);
    expect(result.deliveries[0].activity.signals).toContain('swarming');
  });

  it('carries one revision across a batch, because only a transition bumps it', () => {
    const result = ingest([
      row(1, 'run.transitioned', { to: 'PLANNING' }),
      row(2, 'review.started'),
    ], { revision: 12 });
    expect(result.deliveries.map((d) => d.envelope.revision)).toEqual([12, 12]);
    expect(result.cursor.revision).toBe(12);
  });
});

/* ------------------------------------------------------- the reconnect */

describe('a reconnect resumes rather than replays', () => {
  it('hears the tail after a positioned snapshot and refuses what it absorbed', () => {
    const recovered = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: PROJECT, runId: RUN }),
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 10,
        atSequence: 100,
        observedAtIso: AT,
      }),
    );
    expect(recovered.verdict).toBe('adopted');

    const result = ingest(
      [
        // Already inside the snapshot.
        row(80, 'review.started'),
        // Genuinely new, at the SAME revision because no transition happened.
        row(101, 'review.started'),
      ],
      { cursor: recovered.cursor, revision: 10 },
    );
    expect(result.deliveries.map((d) => d.envelope.sequence)).toEqual([101]);
    expect(result.orderingVerdicts.stale_sequence).toBe(1);
  });
});

/* ---------------------------------------------------- the operator's line */

describe('what an operator is shown', () => {
  it('summarises with counts and closed vocabulary only', () => {
    const result = ingest([
      row(1, 'run.transitioned', { to: 'EXECUTING' }, { projectId: 'project-beta' }),
      row(2, 'run.transitioned', { to: 'EXECUTING' }),
      row(3, 'budget.reserved'),
    ]);
    const line = summarizeWonderlandIngress(result);
    expect(line).toContain('applied=1');
    expect(line).toContain('unauthorized_project=1');
    expect(line).toContain('silent=1');
    // Nothing a payload wrote can reach a log line through this.
    expect(line).not.toContain(PROJECT);
    expect(line).not.toContain(RUN);
    for (const word of line.split(' ')) {
      const [name] = word.split('=');
      expect(
        name === 'applied' || name === 'gaps' ||
          (WONDERLAND_INGRESS_REFUSALS as readonly string[]).includes(name),
      ).toBe(true);
    }
  });

  it('names a gap without filling it', () => {
    const result = ingest([
      row(1, 'run.transitioned', { to: 'PLANNING' }),
      row(40, 'run.transitioned', { to: 'EXECUTING' }),
    ]);
    expect(result.cursor.gaps).toBe(1);
    expect(summarizeWonderlandIngress(result)).toContain('gaps=1');
    // Both still applied: a gap is reported, never repaired by invention.
    expect(result.deliveries.length).toBe(2);
  });
});
