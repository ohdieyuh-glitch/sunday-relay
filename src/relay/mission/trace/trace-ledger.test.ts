import { describe, expect, it } from 'vitest';

import {
  appendTraceEvent,
  appendTraceEventBatch,
  completeTrace,
  createTrace,
  sealTrace,
} from './trace-ledger';
import { InMemoryTraceRepository } from './trace-repository';
import { verifyTraceIntegrity } from './trace-integrity';
import {
  agentClaimDraft,
  capsuleDraft,
  commandDraft,
  newTraceFixture,
  secretShapedEventMetadata,
  statusDraft,
  traceCreationInput,
  TRACE_T1,
  TRACE_T2,
  TRACE_T3,
  TRACE_T4,
  TRACE_T5,
  FIXTURE_TRACE_ID,
} from './trace-fixtures';
import { isValidHashFormat } from './trace-hashing';

describe('trace creation and genesis', () => {
  it('creates a trace with exactly one valid genesis event', () => {
    const repository = new InMemoryTraceRepository();
    const created = createTrace(repository, traceCreationInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const { manifest, genesis } = created.value;
    expect(genesis.sequence).toBe(1);
    expect(genesis.previousEventHash).toBeNull();
    expect(genesis.eventType).toBe('trace_created');
    expect(isValidHashFormat(genesis.eventHash)).toBe(true);
    expect(manifest.genesisEventId).toBe(genesis.eventId);
    expect(manifest.genesisHash).toBe(genesis.eventHash);
    expect(manifest.lifecycleStatus).toBe('open');
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.canonicalizationVersion).toBe('1');
    expect(manifest.hashAlgorithm).toBe('SHA-256');
    expect(repository.listEvents(FIXTURE_TRACE_ID)).toHaveLength(1);
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });

  it('rejects a duplicate trace id', () => {
    const { repository } = newTraceFixture();
    const again = createTrace(repository, traceCreationInput({ genesisEventId: 'evt-other' }));
    expect(!again.ok && again.error.code).toBe('DUPLICATE_TRACE_ID');
  });

  it('rejects a missing project id', () => {
    const repository = new InMemoryTraceRepository();
    const result = createTrace(repository, traceCreationInput({ projectId: '' }));
    expect(!result.ok && result.error.code).toBe('MISSING_PROJECT_ID');
  });

  it.each([
    ['trace schema', { schemaVersion: '2.0.0' }, 'UNSUPPORTED_TRACE_SCHEMA'],
    ['canonicalization', { canonicalizationVersion: '9' }, 'UNSUPPORTED_CANONICALIZATION_VERSION'],
    ['hash algorithm', { hashAlgorithm: 'MD5' }, 'UNSUPPORTED_HASH_ALGORITHM'],
  ] as const)('rejects an unsupported %s version', (_label, over, code) => {
    const repository = new InMemoryTraceRepository();
    const result = createTrace(repository, traceCreationInput(over));
    expect(!result.ok && result.error.code).toBe(code);
    expect(repository.hasTrace(FIXTURE_TRACE_ID)).toBe(false);
  });

  it('never mutates the creation input', () => {
    const repository = new InMemoryTraceRepository();
    const input = traceCreationInput();
    const snapshot = JSON.stringify(input);
    createTrace(repository, input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('single append', () => {
  it('allocates the next sequence and links the previous hash', () => {
    const { repository, manifest } = newTraceFixture();
    const genesisHash = repository.getHead(FIXTURE_TRACE_ID)?.eventHash;

    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sequence).toBe(2);
    expect(appended.value.previousEventHash).toBe(genesisHash);
    expect(isValidHashFormat(appended.value.eventHash)).toBe(true);
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });

  it('a caller cannot choose sequence, previous hash, or event hash', () => {
    const { repository } = newTraceFixture();
    const draft = {
      ...statusDraft('evt-forge', 'execution', 'not_started', 'running', TRACE_T1),
      // These are not part of the draft type; a determined caller passing them
      // anyway must have them ignored, not honoured.
      sequence: 99,
      previousEventHash: 'f'.repeat(64),
      eventHash: 'e'.repeat(64),
    } as never;
    const appended = appendTraceEvent(repository, { traceId: FIXTURE_TRACE_ID, draft });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sequence).toBe(2);
    expect(appended.value.previousEventHash).not.toBe('f'.repeat(64));
    expect(appended.value.eventHash).not.toBe('e'.repeat(64));
  });

  it('rejects a duplicate event id', () => {
    const { repository } = newTraceFixture();
    appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    const again = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-1', 'outcome', 'unknown', 'partial', TRACE_T2),
    });
    expect(!again.ok && again.error.code).toBe('DUPLICATE_EVENT_ID');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(2);
  });

  it.each([
    ['trace identity', { traceId: 'trace-other' }, 'TRACE_IDENTITY_MISMATCH'],
    ['project scope', { projectId: 'project-other' }, 'TRACE_SCOPE_MISMATCH'],
    ['mission scope', { missionId: 'mission-other' }, 'TRACE_SCOPE_MISMATCH'],
    ['event family', { eventFamily: 'tool' as const }, 'INVALID_EVENT_FAMILY'],
    ['event type', { eventType: 'invented_event' }, 'INVALID_EVENT_TYPE'],
    ['source product', { sourceProduct: 'skynet' as never }, 'INVALID_SOURCE_PRODUCT'],
    ['source service', { sourceService: '' }, 'INVALID_SOURCE_SERVICE'],
    ['actor id', { actorId: '' }, 'INVALID_ACTOR'],
    ['actor type', { actorType: 'wizard' as never }, 'INVALID_ACTOR'],
    ['source trust', { sourceTrust: 'absolute' as never }, 'INVALID_SOURCE_TRUST'],
    ['mission revision', { missionRevision: -1 }, 'INVALID_MISSION_REVISION'],
    ['task revision', { taskRevision: 1.5 }, 'INVALID_TASK_REVISION'],
  ])('rejects an invalid %s', (_label, over, code) => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: {
        ...statusDraft('evt-bad', 'execution', 'not_started', 'running', TRACE_T1),
        ...(over as Record<string, unknown>),
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
  });

  it('rejects a ledger-controlled event type from a caller', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: {
        ...statusDraft('evt-fake-seal', 'execution', 'not_started', 'running', TRACE_T1),
        eventFamily: 'trace',
        eventType: 'trace_sealed',
      },
    });
    expect(!result.ok && result.error.code).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects a second genesis event', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      allowLedgerControlledType: true,
      draft: {
        ...statusDraft('evt-genesis-2', 'execution', 'not_started', 'running', TRACE_T1),
        eventFamily: 'trace',
        eventType: 'trace_created',
      },
    });
    // Stored or not, the chain must never verify with two genesis events.
    if (result.ok) {
      const manifest = repository.getManifest(FIXTURE_TRACE_ID);
      const report = verifyTraceIntegrity(manifest!, repository.listEvents(FIXTURE_TRACE_ID));
      expect(report.valid).toBe(false);
      expect(report.reason).toBe('invalid_genesis');
    }
  });

  it('rejects a timestamp regression', () => {
    const { repository } = newTraceFixture();
    appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T3),
    });
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-2', 'outcome', 'unknown', 'partial', TRACE_T1),
    });
    expect(!result.ok && result.error.code).toBe('TIMESTAMP_REGRESSION');
  });

  it('rejects an append to a trace that does not exist', () => {
    const repository = new InMemoryTraceRepository();
    const result = appendTraceEvent(repository, {
      traceId: 'trace-ghost',
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(!result.ok && result.error.code).toBe('TRACE_NOT_FOUND');
  });

  it('stored events are deeply frozen, including nested metadata', () => {
    const { repository } = newTraceFixture();
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
        metadata: { nested: { deep: 'value' } },
      }),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(Object.isFrozen(appended.value)).toBe(true);
    expect(Object.isFrozen(appended.value.metadata)).toBe(true);
    expect(() => {
      (appended.value as { sequence: number }).sequence = 99;
    }).toThrow();
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-1')?.sequence).toBe(2);
  });
});

describe('stale-head protection', () => {
  it('accepts an append whose expected head matches', () => {
    const { repository } = newTraceFixture();
    const head = repository.getHead(FIXTURE_TRACE_ID);
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: head,
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a competing writer that read the SAME head', () => {
    const { repository } = newTraceFixture();
    // Both writers read the same head…
    const headSeenByA = repository.getHead(FIXTURE_TRACE_ID);
    const headSeenByB = repository.getHead(FIXTURE_TRACE_ID);

    const writerA = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: headSeenByA,
      draft: statusDraft('evt-a', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(writerA.ok).toBe(true);

    const writerB = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: headSeenByB,
      draft: statusDraft('evt-b', 'outcome', 'unknown', 'partial', TRACE_T2),
    });
    expect(writerB.ok).toBe(false);
    if (writerB.ok) return;
    expect(writerB.error.code).toBe('STALE_TRACE_HEAD');

    // The first append survived; the rejected one created nothing.
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(2);
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-b')).toBeNull();
    const manifest = repository.getManifest(FIXTURE_TRACE_ID);
    expect(verifyTraceIntegrity(manifest!, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });

  it('rejects a stale expected sequence even when the hash is right', () => {
    const { repository } = newTraceFixture();
    const head = repository.getHead(FIXTURE_TRACE_ID);
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: { ...head!, sequence: 99 },
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(!result.ok && result.error.code).toBe('STALE_TRACE_HEAD');
  });

  it('an omitted expected head skips the check (single-writer callers)', () => {
    const { repository } = newTraceFixture();
    expect(
      appendTraceEvent(repository, {
        traceId: FIXTURE_TRACE_ID,
        draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
      }).ok,
    ).toBe(true);
  });
});

describe('atomic batch append', () => {
  it('appends a contiguous, correctly chained batch', () => {
    const { repository, manifest } = newTraceFixture();
    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        commandDraft('evt-2', 'command_received', TRACE_T2),
        capsuleDraft('evt-3', 'execution_capsule_prepared', TRACE_T3),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((e) => e.sequence)).toEqual([2, 3, 4]);
    expect(result.value[1].previousEventHash).toBe(result.value[0].eventHash);
    expect(result.value[2].previousEventHash).toBe(result.value[1].eventHash);
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
    for (const event of result.value) expect(Object.isFrozen(event)).toBe(true);
  });

  it('one invalid draft rejects the ENTIRE batch and stores nothing', () => {
    const { repository } = newTraceFixture();
    const before = repository.listEvents(FIXTURE_TRACE_ID);
    const beforeJson = JSON.stringify(before);

    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-good', 'execution', 'not_started', 'running', TRACE_T1),
        { ...statusDraft('evt-bad', 'outcome', 'unknown', 'partial', TRACE_T2), eventType: 'not_a_type' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_EVENT_TYPE');
    expect(result.error.reason).toMatch(/batch rejected at draft 1/u);

    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-good')).toBeNull();
    expect(JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID))).toBe(beforeJson);
  });

  it('rejects a duplicate id INSIDE the batch', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-dup', 'execution', 'not_started', 'running', TRACE_T1),
        statusDraft('evt-dup', 'outcome', 'unknown', 'partial', TRACE_T2),
      ],
    });
    expect(!result.ok && result.error.code).toBe('DUPLICATE_EVENT_ID');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
  });

  it('rejects a batch whose id collides with a stored event', () => {
    const { repository } = newTraceFixture();
    appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
    });
    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [statusDraft('evt-1', 'outcome', 'unknown', 'partial', TRACE_T2)],
    });
    expect(!result.ok && result.error.code).toBe('DUPLICATE_EVENT_ID');
  });

  it('rejects an entire batch on a stale expected head', () => {
    const { repository } = newTraceFixture();
    const staleHead = repository.getHead(FIXTURE_TRACE_ID);
    appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-first', 'execution', 'not_started', 'running', TRACE_T1),
    });
    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: staleHead,
      drafts: [
        commandDraft('evt-x', 'command_received', TRACE_T2),
        commandDraft('evt-y', 'command_validated', TRACE_T3),
      ],
    });
    expect(!result.ok && result.error.code).toBe('STALE_TRACE_HEAD');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(2);
  });

  it('rejects an empty batch', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEventBatch(repository, { traceId: FIXTURE_TRACE_ID, drafts: [] });
    expect(!result.ok && result.error.code).toBe('EVENT_BATCH_REJECTED');
  });

  it('never mutates the input drafts', () => {
    const { repository } = newTraceFixture();
    const drafts = [
      statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
      commandDraft('evt-2', 'command_received', TRACE_T2),
    ];
    const snapshot = JSON.stringify(drafts);
    appendTraceEventBatch(repository, { traceId: FIXTURE_TRACE_ID, drafts });
    expect(JSON.stringify(drafts)).toBe(snapshot);
  });
});

describe('completion and sealing', () => {
  function openTraceWithWork() {
    const fixture = newTraceFixture();
    appendTraceEventBatch(fixture.repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        agentClaimDraft('evt-2', 'agent_final_report_received', TRACE_T2),
        statusDraft('evt-3', 'execution', 'running', 'completed', TRACE_T3),
      ],
    });
    return fixture;
  }

  it('completes a trace without sealing it and without verifying the mission', () => {
    const { repository } = openTraceWithWork();
    const completed = completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T4,
      sourceService: 'relay-trace-service',
      reason: 'operational execution ended',
    });
    expect(completed.ok).toBe(true);
    const manifest = repository.getManifest(FIXTURE_TRACE_ID);
    expect(manifest?.lifecycleStatus).toBe('completed');
    expect(manifest?.lifecycleStatus).not.toBe('sealed');
  });

  it('a completed trace still accepts late approval, release, and cost events', () => {
    const { repository } = openTraceWithWork();
    completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T4,
      sourceService: 'relay-trace-service',
      reason: 'done',
    });

    const late = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        {
          ...commandDraft('evt-approval', 'command_approval_received', TRACE_T4),
          eventFamily: 'approval',
          metadata: { approvalId: 'approval-1' },
        },
        {
          ...capsuleDraft('evt-cost', 'cost_receipt_reference_linked', TRACE_T4),
          eventFamily: 'economics',
          sourceService: 'relay-cost-service',
          actorId: 'relay-cost-service',
          actorType: 'system',
          metadata: { costReceiptId: 'receipt-1' },
        },
        statusDraft('evt-release', 'release', 'not_eligible', 'human_approval_required', TRACE_T5, {
          metadata: {
            dimension: 'release',
            previousStatus: 'not_eligible',
            nextStatus: 'human_approval_required',
          },
        }),
      ],
    });
    expect(late.ok).toBe(true);
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('completed');
  });

  it('a completed trace rejects a non-permitted late event', () => {
    const { repository } = openTraceWithWork();
    completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T4,
      sourceService: 'relay-trace-service',
      reason: 'done',
    });
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: capsuleDraft('evt-late-run', 'agent_execution_started', TRACE_T5),
    });
    expect(!result.ok && result.error.code).toBe('TRACE_SEAL_REJECTED');
  });

  it('seals a valid trace, records the prior head, and rejects later appends', () => {
    const { repository, manifest } = openTraceWithWork();
    const headBefore = repository.getHead(FIXTURE_TRACE_ID);
    const countBefore = repository.eventCount(FIXTURE_TRACE_ID);

    const sealed = sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'mission archived',
    });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    expect(sealed.value.eventType).toBe('trace_sealed');
    expect(sealed.value.metadata.previousHeadHash).toBe(headBefore?.eventHash);
    expect(sealed.value.metadata.finalEventCountBeforeSeal).toBe(countBefore);
    expect(sealed.value.metadata.verifiedIntegrity).toBe(true);
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('sealed');

    const after = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-after-seal', 'outcome', 'unknown', 'partial', TRACE_T5),
    });
    expect(!after.ok && after.error.code).toBe('TRACE_SEALED');

    // The sealed trace still verifies and stays inspectable.
    const report = verifyTraceIntegrity(
      repository.getManifest(FIXTURE_TRACE_ID)!,
      repository.listEvents(FIXTURE_TRACE_ID),
    );
    expect(report.valid).toBe(true);
    expect(repository.listEvents(FIXTURE_TRACE_ID).length).toBe(countBefore + 1);
    expect(manifest.traceId).toBe(FIXTURE_TRACE_ID);
  });

  it('rejects a duplicate seal', () => {
    const { repository } = openTraceWithWork();
    sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    const again = sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal-2',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived again',
    });
    expect(!again.ok && again.error.code).toBe('TRACE_SEALED');
  });

  it('a completed trace may be sealed, and completion never seals by itself', () => {
    const { repository } = openTraceWithWork();
    completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T4,
      sourceService: 'relay-trace-service',
      reason: 'done',
    });
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('completed');
    const sealed = sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    expect(sealed.ok).toBe(true);
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('sealed');
  });
});

describe('redaction inside the ledger', () => {
  it('redacts before hashing, and the stored hash verifies against the redacted form', () => {
    const { repository, manifest } = newTraceFixture();
    const metadata = secretShapedEventMetadata();
    const snapshot = JSON.stringify(metadata);

    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: capsuleDraft('evt-secret', 'tool_reference_linked', TRACE_T1, {
        eventFamily: 'tool',
        metadata,
      }),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    const stored = JSON.stringify(appended.value);
    expect(stored).not.toContain('sk-fixture0123456789abcdefghij');
    expect(stored).not.toContain('fixture-token-0123456789abcd');
    expect(stored).not.toContain('fixtureSecret123456');
    expect(stored).toContain('[redacted]');
    // The env var NAME is useful evidence and may remain.
    expect(stored).toContain('ANTHROPIC_API_KEY');
    expect(appended.value.redactionStatus).toBe('redacted');

    // The caller's object is untouched…
    expect(JSON.stringify(metadata)).toBe(snapshot);
    // …and the chain verifies using only the stored, redacted event.
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });

  it('records not_required when nothing needed redaction', () => {
    const { repository } = newTraceFixture();
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-clean', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.redactionStatus).toBe('not_required');
  });

  it('rejects metadata that cannot be canonicalized', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: statusDraft('evt-bad-meta', 'execution', 'not_started', 'running', TRACE_T1, {
        metadata: { value: Number.NaN },
      }),
    });
    expect(!result.ok && result.error.code).toBe('UNSUPPORTED_METADATA_VALUE');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
  });
});
