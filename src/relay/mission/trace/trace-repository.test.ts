import { describe, expect, it } from 'vitest';

import { InMemoryTraceRepository } from './trace-repository';
import { appendTraceEventBatch, createTrace, sealTrace } from './trace-ledger';
import {
  agentClaimDraft,
  capsuleDraft,
  commandDraft,
  newTraceFixture,
  statusDraft,
  traceCreationInput,
  FIXTURE_MISSION_ID,
  FIXTURE_PROJECT_ID,
  FIXTURE_TRACE_ID,
  TRACE_T1,
  TRACE_T2,
  TRACE_T3,
  TRACE_T4,
  TRACE_T5,
} from './trace-fixtures';

function populated() {
  const fixture = newTraceFixture();
  const appended = appendTraceEventBatch(fixture.repository, {
    traceId: FIXTURE_TRACE_ID,
    drafts: [
      statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
      commandDraft('evt-2', 'command_received', TRACE_T2),
      capsuleDraft('evt-3', 'execution_capsule_prepared', TRACE_T3),
      agentClaimDraft('evt-4', 'agent_final_report_received', TRACE_T4),
    ],
  });
  if (!appended.ok) throw new Error(appended.error.reason);
  return fixture;
}

describe('trace repository reads', () => {
  it('gets the manifest, an event by id, the head, and the ordered list', () => {
    const { repository } = populated();

    expect(repository.getManifest(FIXTURE_TRACE_ID)?.traceId).toBe(FIXTURE_TRACE_ID);
    expect(repository.getManifest('trace-ghost')).toBeNull();
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-2')?.eventType).toBe('command_received');
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-missing')).toBeNull();
    expect(repository.listEvents(FIXTURE_TRACE_ID).map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(repository.getHead(FIXTURE_TRACE_ID)?.eventId).toBe('evt-4');
    expect(repository.getHeadEvent(FIXTURE_TRACE_ID)?.sequence).toBe(5);
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(5);
  });

  it('lists traces by project, mission, and task', () => {
    const { repository } = populated();
    const second = createTrace(
      repository,
      traceCreationInput({
        traceId: 'trace-other',
        genesisEventId: 'evt-genesis-2',
        missionId: 'mission-other',
        taskId: 'task-other',
      }),
    );
    expect(second.ok).toBe(true);

    expect(repository.listTracesByProject(FIXTURE_PROJECT_ID)).toHaveLength(2);
    expect(repository.listTracesByProject('project-none')).toHaveLength(0);
    expect(repository.listTracesByMission(FIXTURE_MISSION_ID).map((t) => t.traceId)).toEqual([
      FIXTURE_TRACE_ID,
    ]);
    expect(repository.listTracesByTask('task-other').map((t) => t.traceId)).toEqual(['trace-other']);
  });

  it('indexes events by capsule, command, and family', () => {
    const { repository } = populated();
    expect(repository.listEventsByCapsule(FIXTURE_TRACE_ID, 'cap-claude-impl').map((e) => e.eventId)).toEqual([
      'evt-3',
      'evt-4',
    ]);
    expect(repository.listEventsByCommand(FIXTURE_TRACE_ID, 'cmd-auth-1').map((e) => e.eventId)).toEqual([
      'evt-2',
    ]);
    expect(repository.listEventsByFamily(FIXTURE_TRACE_ID, 'command')).toHaveLength(1);
    expect(repository.listEventsByFamily(FIXTURE_TRACE_ID, 'trace')).toHaveLength(1);
    expect(repository.listEventsByFamily(FIXTURE_TRACE_ID, 'report')).toHaveLength(1);
  });

  it('indexes match what a fresh scan of the events produces', () => {
    const { repository } = populated();
    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(repository.listEventsByFamily(FIXTURE_TRACE_ID, 'execution')).toEqual(
      events.filter((e) => e.eventFamily === 'execution'),
    );
    expect(repository.listEventsByCapsule(FIXTURE_TRACE_ID, 'cap-claude-impl')).toEqual(
      events.filter((e) => e.capsuleId === 'cap-claude-impl'),
    );
  });
});

describe('immutability and append-only guarantees', () => {
  it('stored events and manifests cannot be mutated through returned references', () => {
    const { repository } = populated();

    const manifest = repository.getManifest(FIXTURE_TRACE_ID)!;
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(() => {
      (manifest as { lifecycleStatus: string }).lifecycleStatus = 'sealed';
    }).toThrow();
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('open');

    const event = repository.getEvent(FIXTURE_TRACE_ID, 'evt-2')!;
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(() => {
      (event as { actorId: string }).actorId = 'attacker';
    }).toThrow();
    expect(() => {
      (event.metadata as Record<string, unknown>).injected = true;
    }).toThrow();
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-2')?.actorId).toBe('user-founder');
  });

  it('mutating the RETURNED event list never reorders or truncates the ledger', () => {
    const { repository } = populated();
    const events = repository.listEvents(FIXTURE_TRACE_ID);
    events.pop();
    events.reverse();
    expect(repository.listEvents(FIXTURE_TRACE_ID).map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('exposes no update, replace, delete, or reorder API', () => {
    const repository = new InMemoryTraceRepository();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repository));
    expect(
      surface.some((name) => /delete|remove|replace|reorder|clear|drop|rewrite|patch|set[A-Z]/u.test(name)),
    ).toBe(false);
    expect(surface.sort()).toEqual([
      'appendEvent',
      'constructor',
      'createTrace',
      'eventCount',
      'getEvent',
      'getHead',
      'getHeadEvent',
      'getManifest',
      'hasTrace',
      'listEvents',
      'listEventsByCapsule',
      'listEventsByCommand',
      'listEventsByFamily',
      'listTracesByMission',
      'listTracesByProject',
      'listTracesByTask',
      'updateLifecycle',
    ]);
  });

  it('the raw appendEvent guard rejects a non-contiguous sequence', () => {
    const { repository } = populated();
    const head = repository.getHeadEvent(FIXTURE_TRACE_ID)!;
    const result = repository.appendEvent({ ...head, eventId: 'evt-jump', sequence: 99 });
    expect(!result.ok && result.error.code).toBe('INVALID_EVENT_SEQUENCE');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(5);
  });

  it('the raw appendEvent guard rejects a duplicate id and an unknown trace', () => {
    const { repository } = populated();
    const head = repository.getHeadEvent(FIXTURE_TRACE_ID)!;
    const duplicate = repository.appendEvent({ ...head, sequence: 6 });
    expect(!duplicate.ok && duplicate.error.code).toBe('DUPLICATE_EVENT_ID');

    const unknown = repository.appendEvent({ ...head, traceId: 'trace-ghost', eventId: 'evt-x', sequence: 1 });
    expect(!unknown.ok && unknown.error.code).toBe('TRACE_NOT_FOUND');
  });

  it('a failed operation preserves the repository byte-for-byte', () => {
    const { repository } = populated();
    const before = JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID));
    repository.appendEvent({ ...repository.getHeadEvent(FIXTURE_TRACE_ID)!, sequence: 42 });
    expect(JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID))).toBe(before);
  });
});

describe('sealed and integrity-failed traces stay inspectable', () => {
  it('a sealed trace can still be read in full', () => {
    const { repository } = populated();
    sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('sealed');
    expect(repository.listEvents(FIXTURE_TRACE_ID)).toHaveLength(6);
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-1')).not.toBeNull();
    expect(repository.listEventsByFamily(FIXTURE_TRACE_ID, 'trace')).toHaveLength(2);
  });

  it('an integrity-failed trace remains readable', () => {
    const { repository } = populated();
    repository.updateLifecycle(FIXTURE_TRACE_ID, 'integrity_failed');
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('integrity_failed');
    expect(repository.listEvents(FIXTURE_TRACE_ID)).toHaveLength(5);
  });

  it('source products accumulate on the manifest as products contribute', () => {
    const { repository } = populated();
    const before = repository.getManifest(FIXTURE_TRACE_ID)!.sourceProducts;
    expect(before).toEqual(['sunday_relay']);

    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        {
          ...commandDraft('evt-manual', 'command_approval_received', TRACE_T5),
          eventFamily: 'approval',
          sourceProduct: 'manual',
          sourceService: 'relay-approval-service',
          actorId: 'user-founder',
          actorType: 'user',
          metadata: { approvalId: 'approval-1' },
        },
      ],
    });
    expect(repository.getManifest(FIXTURE_TRACE_ID)!.sourceProducts).toEqual([
      'sunday_relay',
      'manual',
    ]);
  });
});
