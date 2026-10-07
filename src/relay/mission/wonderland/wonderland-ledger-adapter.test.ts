import { describe, expect, it } from 'vitest';

import { JULIUS_RUNTIME_VERSION } from '../julius/julius-runtime';
import {
  JULIUS_LEDGER_TYPE_PREFIX,
  WONDERLAND_LEDGER_REFUSALS,
  WONDERLAND_LEDGER_ROW_FIELDS,
  readWonderlandLedgerBatch,
  readWonderlandLedgerRow,
} from './wonderland-ledger-adapter';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';
import { juliusTransitionState } from './wonderland-julius-normalizer';
import { readJuliusState } from './wonderland-julius-state';
import { normalizeJuliusOperationalEvent } from './wonderland-julius-normalizer';

/**
 * READING THE LEDGER AS THE PERSISTENCE LAYER ACTUALLY WRITES IT.
 *
 * Every payload below is copied from the shape the real writers produce —
 * `JuliusEventPostgresRepository.append` for the flat one,
 * `JuliusPostgresRepository.event` for the nested one — rather than from this
 * repository's development fixture. That is the entire point: the fixture
 * carries `facts.to` and passes, and production does not carry it at all, so a
 * test built on the fixture would have gone on being green while the seam lost
 * precision on the two event types that carry the run's state machine.
 */

const PROJECT = 'project-1';
const RUN = 'run-1';
const AT = '2026-09-07T10:00:00.000Z';

/** Exactly what `JuliusEventPostgresRepository.append` stores. */
const flatRow = (overrides: Partial<WonderlandLedgerRow> = {}): WonderlandLedgerRow => ({
  eventId: 'julius-evt-1',
  streamId: RUN,
  projectId: PROJECT,
  sequence: 3,
  eventType: 'julius.task.claimed',
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    runId: RUN,
    projectId: PROJECT,
    type: 'task.claimed',
    taskId: 'task-7',
    workerId: 'worker-2',
    correlationId: 'corr-1',
    causationId: null,
    occurredAt: AT,
    facts: { role: 'CODING_AGENT', attempt: 1 },
  },
  ...overrides,
});

/** Exactly what `JuliusPostgresRepository.event` stores for a transition. */
const nestedTransitionRow = (
  to: string,
  overrides: Partial<WonderlandLedgerRow> = {},
): WonderlandLedgerRow => ({
  eventId: 'julius:cmd-9',
  streamId: RUN,
  projectId: PROJECT,
  sequence: 4,
  eventType: 'julius.run.transitioned',
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: 'julius:cmd-9',
    projectId: PROJECT,
    streamId: RUN,
    type: 'julius.run.transitioned',
    occurredAt: AT,
    // No `facts` key anywhere. The transition IS the payload.
    payload: {
      transitionId: 't-1',
      missionId: 'mission-1',
      from: 'READY',
      to,
      reasonCode: 'DISPATCH',
      safeSummary: 'Work began.',
      evidenceIds: [],
      occurredAt: AT,
      runtimeVersion: JULIUS_RUNTIME_VERSION,
    },
  },
  ...overrides,
});

/** And what it stores for `run.created`, where the state key is `state`. */
const nestedCreatedRow = (): WonderlandLedgerRow => ({
  eventId: 'julius:cmd-1',
  streamId: RUN,
  projectId: PROJECT,
  sequence: 1,
  eventType: 'julius.run.created',
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: 'julius:cmd-1',
    projectId: PROJECT,
    streamId: RUN,
    type: 'julius.run.created',
    occurredAt: AT,
    payload: {
      runId: RUN,
      missionId: 'mission-1',
      state: 'CREATED',
      runtimeVersion: JULIUS_RUNTIME_VERSION,
    },
  },
});

const ok = (row: WonderlandLedgerRow) => {
  const reading = readWonderlandLedgerRow(row);
  if (!reading.ok) throw new Error(`expected a reading, got ${reading.refusal}`);
  return reading;
};

describe('the row shape', () => {
  it('lists its fields exactly once and names every refusal', () => {
    expect(new Set(WONDERLAND_LEDGER_ROW_FIELDS).size).toBe(WONDERLAND_LEDGER_ROW_FIELDS.length);
    expect(new Set(WONDERLAND_LEDGER_REFUSALS).size).toBe(WONDERLAND_LEDGER_REFUSALS.length);
    expect(JULIUS_LEDGER_TYPE_PREFIX).toBe('julius.');
  });
});

describe('the FLAT shape, written by the event repository', () => {
  it('passes the operational event through, facts and all', () => {
    const { event, shape } = ok(flatRow());
    expect(shape).toBe('flat');
    expect(event.type).toBe('task.claimed');
    expect(event.runId).toBe(RUN);
    expect(event.taskId).toBe('task-7');
    expect(event.workerId).toBe('worker-2');
    expect(event.facts.role).toBe('CODING_AGENT');
  });

  it('strips the ledger prefix, so the type is the catalogue`s own word', () => {
    expect(ok(flatRow()).event.type).toBe('task.claimed');
    expect(ok(flatRow()).event.type).not.toContain('julius.');
  });

  it('drops non-scalar facts, matching the writer`s own validator', () => {
    const row = flatRow({
      payload: {
        ...(flatRow().payload as Record<string, unknown>),
        facts: { role: 'CODING_AGENT', nested: { a: 1 }, list: [1], bad: Number.NaN, n: 2 },
      },
    });
    expect(ok(row).event.facts).toEqual({ role: 'CODING_AGENT', n: 2 });
  });
});

/* ------------------------------------------- the shape that was silently lost */

describe('the NESTED shape, written by the run repository', () => {
  it('carries NO facts key at all — the thing the fixture hid', () => {
    const payload = nestedTransitionRow('EXECUTING').payload as Record<string, unknown>;
    expect('facts' in payload).toBe(false);
    expect((payload.payload as Record<string, unknown>).to).toBe('EXECUTING');
  });

  it('lifts the transition`s `to` into facts, where the reader already looks', () => {
    const { event, shape } = ok(nestedTransitionRow('EXECUTING'));
    expect(shape).toBe('nested');
    expect(event.type).toBe('run.transitioned');
    expect(event.facts.to).toBe('EXECUTING');
    expect(event.facts.from).toBe('READY');
    expect(event.facts.reasonCode).toBe('DISPATCH');
  });

  it('restores julius_run_state precision, which is the whole defect', () => {
    // WITHOUT the adapter the event has no facts, so `juliusTransitionState`
    // finds nothing and the reading falls back to the event's NAME. With it,
    // the kernel's own state travels and the precise source is used.
    const { event } = ok(nestedTransitionRow('REVIEWING'));
    expect(juliusTransitionState(event)).toBe('REVIEWING');

    const world = normalizeJuliusOperationalEvent({
      event,
      sequence: 1,
      eventId: 'w-1',
    });
    expect(world).not.toBeNull();
    const reading = readJuliusState(world!);
    expect(reading?.source).toBe('julius_run_state');
    expect(reading?.visualState).toBe('independent_review');
  });

  it('proves the degradation it prevents, by reading the raw row unadapted', () => {
    // The same row as the persistence layer writes it, handed straight to the
    // normalizer's own reader: no facts, so no kernel state.
    const raw = nestedTransitionRow('REVIEWING').payload as Record<string, unknown>;
    const unadapted = {
      eventId: 'x', runId: RUN, projectId: PROJECT, type: 'run.transitioned' as const,
      taskId: null, workerId: null, correlationId: 'c', causationId: null,
      occurredAt: AT, facts: (raw.facts ?? {}) as Record<string, never>,
    };
    expect(juliusTransitionState(unadapted)).toBeNull();
  });

  it('normalises run.created`s `state` onto `to`, so there is one reader', () => {
    const { event } = ok(nestedCreatedRow());
    expect(event.type).toBe('run.created');
    expect(event.facts.to).toBe('CREATED');
    expect(juliusTransitionState(event)).toBe('CREATED');
  });

  it('falls back to the row`s own identity when the payload omits it', () => {
    const { event } = ok(nestedTransitionRow('EXECUTING'));
    expect(event.runId).toBe(RUN);
    expect(event.projectId).toBe(PROJECT);
  });
});

/* --------------------------------------------------------------- refusals */

describe('what it refuses', () => {
  it('refuses a row that is not Julius`s, which the replay query does not filter', () => {
    const reading = readWonderlandLedgerRow(
      flatRow({ eventType: 'presence.joined', eventId: 'w-1' }),
    );
    expect(reading.ok).toBe(false);
    expect(reading.ok === false && reading.refusal).toBe('not_julius');
  });

  it('refuses a prefixed type the catalogue does not model', () => {
    const reading = readWonderlandLedgerRow(flatRow({ eventType: 'julius.autonomy.changed' }));
    expect(reading.ok === false && reading.refusal).toBe('unknown_type');
  });

  it('refuses an unreadable payload rather than inventing one', () => {
    for (const payload of [null, 'text', 7, ['a'], undefined]) {
      const reading = readWonderlandLedgerRow(flatRow({ payload }));
      expect(reading.ok === false && reading.refusal).toBe('unreadable_payload');
    }
  });

  it('refuses a row with no run to belong to', () => {
    const reading = readWonderlandLedgerRow(
      flatRow({ streamId: '', payload: { projectId: PROJECT, facts: {} } }),
    );
    expect(reading.ok === false && reading.refusal).toBe('identity_missing');
  });
});

describe('reading a page', () => {
  it('keeps Julius rows, drops the rest, and counts refusals by KIND', () => {
    // A page that is mostly `not_julius` is a project sharing a table and is
    // normal; one `unknown_type` is Julius having shipped something this build
    // does not model, which is worth going to look at.
    const batch = readWonderlandLedgerBatch([
      flatRow({ sequence: 1 }),
      nestedTransitionRow('EXECUTING', { sequence: 2 }),
      flatRow({ sequence: 3, eventType: 'battle.created', eventId: 'b-1' }),
      flatRow({ sequence: 4, eventType: 'presence.joined', eventId: 'p-1' }),
      flatRow({ sequence: 5, eventType: 'julius.not.a.type' }),
    ]);
    expect(batch.events.length).toBe(2);
    expect(batch.sequences).toEqual([1, 2]);
    expect(batch.flat).toBe(1);
    expect(batch.nested).toBe(1);
    expect(batch.refused.not_julius).toBe(2);
    expect(batch.refused.unknown_type).toBe(1);
  });

  it('keeps sequences aligned with events, so a cursor can advance', () => {
    const batch = readWonderlandLedgerBatch([
      flatRow({ eventType: 'presence.joined', sequence: 1, eventId: 'p' }),
      flatRow({ sequence: 9 }),
    ]);
    expect(batch.events.length).toBe(batch.sequences.length);
    expect(batch.sequences).toEqual([9]);
  });

  it('handles a page with nothing of ours without pretending otherwise', () => {
    const batch = readWonderlandLedgerBatch([
      flatRow({ eventType: 'presence.joined', eventId: 'a' }),
      flatRow({ eventType: 'battle.completed', eventId: 'b' }),
    ]);
    expect(batch.events).toEqual([]);
    expect(batch.refused.not_julius).toBe(2);
  });
});
