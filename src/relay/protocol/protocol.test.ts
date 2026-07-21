import { describe, expect, it } from 'vitest';
import { RELAY_PROTOCOL_VERSION, checkProtocolVersion } from './version';
import { checkFreeId, checkId, createRandomIdFactory } from './ids';
import { COMMAND_TYPES, parseCommand, parseEvent, parseQuery, parseReport, RELAY_EVENT_KINDS } from './envelopes';
import { makeCommand, makeReport, deterministicIds, fixedId } from '../testing/factories';
import { RELAY_ERROR_CODES } from './errors';

const T0 = '2026-07-21T22:00:00.000Z';

describe('protocol version', () => {
  it('accepts the matching version and rejects unsupported/missing/malformed', () => {
    expect(checkProtocolVersion(RELAY_PROTOCOL_VERSION)).toBeNull();
    expect(checkProtocolVersion('relay.protocol.v2')?.code).toBe('protocol-mismatch');
    expect(checkProtocolVersion(undefined)?.code).toBe('protocol-mismatch');
    expect(checkProtocolVersion(42)?.code).toBe('protocol-mismatch');
    // Never silently coerced at any envelope boundary:
    const cmd = makeCommand('pause-run', { runId: fixedId('run') });
    expect(parseCommand({ ...cmd, protocolVersion: 'relay.protocol.v9' }).ok).toBe(false);
    expect(parseReport(makeReport('implementation', { summary: 's', changedFiles: [] }, { protocolVersion: undefined as never })).ok).toBe(false);
  });
});

describe('identifiers', () => {
  it('validates prefixed and free-form ids', () => {
    expect(checkId('run_abc123', 'run', 'runId')).toBeNull();
    expect(checkId('tsk_abc', 'run', 'runId')?.code).toBe('validation-failed');
    expect(checkId('', 'run', 'runId')?.code).toBe('validation-failed');
    expect(checkId('run_', 'run', 'runId')?.code).toBe('validation-failed');
    expect(checkFreeId('any-client-id', 'commandId')).toBeNull();
    expect(checkFreeId('', 'commandId')?.code).toBe('validation-failed');
  });

  it('production factory mints valid prefixed ids; deterministic factory is reproducible', () => {
    const prod = createRandomIdFactory();
    expect(checkId(prod.next('run'), 'run', 'runId')).toBeNull();
    const a = deterministicIds();
    const b = deterministicIds();
    expect(a.next('evt')).toBe(b.next('evt'));
    expect(a.next('evt')).toBe('evt_t0002');
  });
});

describe('commands', () => {
  const VALID_PAYLOADS: Record<string, Record<string, unknown>> = {
    'create-project': { name: 'P', objective: 'O' },
    'create-run': { projectId: fixedId('prj'), objective: 'O' },
    'submit-objective': { runId: fixedId('run'), objective: 'O' },
    'import-blueprint': {
      runId: fixedId('run'),
      blueprint: {
        architectDisplayName: 'ChatGPT (imported)',
        content: {
          objectiveRestatement: 'r', approach: 'a', taskBreakdown: ['t'],
          acceptanceCriteria: ['c'], risks: [], constraints: [],
        },
      },
    },
    'accept-blueprint': { runId: fixedId('run'), blueprintId: fixedId('blu') },
    'compile-handoff': { runId: fixedId('run'), taskId: fixedId('tsk') },
    'dispatch-task': { runId: fixedId('run'), taskId: fixedId('tsk'), packageId: fixedId('pkg') },
    'submit-report': { runId: fixedId('run'), reportId: fixedId('rpt') },
    'request-verification': { runId: fixedId('run'), taskId: fixedId('tsk'), policyId: fixedId('pol'), scope: 'initial' },
    'dispatch-revision': {
      runId: fixedId('run'),
      taskId: fixedId('tsk'),
      revisionContract: {
        packageId: fixedId('pkg'), parentPackageId: fixedId('pkg', 'parent'),
        findingsTargeted: ['R1'],
        narrowScope: { sameTask: true, sameFiles: true, sameAssignment: true },
        conditionsChecked: Array.from({ length: 15 }, (_, i) => ({ condition: `c${i}`, satisfied: true })),
      },
    },
    'pause-run': { runId: fixedId('run') },
    'resume-run': { runId: fixedId('run') },
    'cancel-run': { runId: fixedId('run'), reason: 'operator stop' },
    'respond-checkpoint': { runId: fixedId('run'), checkpointId: fixedId('ckp'), response: 'approve' },
    'answer-open-question': { questionId: fixedId('oqn'), answer: 'yes' },
    'set-budget': { runId: fixedId('run'), budget: { maxUsd: 1 } },
    'assign-agent': { runId: fixedId('run'), role: 'reviewer', adapterId: 'sim-reviewer' },
    'approve-completion': { runId: fixedId('run') },
  };

  it('accepts a valid command of every type', () => {
    for (const type of COMMAND_TYPES) {
      const result = parseCommand(makeCommand(type, VALID_PAYLOADS[type]));
      expect(result.ok, `command ${type}`).toBe(true);
    }
  });

  it('rejects invalid payload combinations per family', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk') }], // no RevisionContract
      ['dispatch-task', { runId: fixedId('run') }], // no task/package refs
      ['request-verification', { runId: fixedId('run'), taskId: fixedId('tsk'), scope: 'initial' }], // no policy
      ['resume-run', {}], // no run reference
      ['cancel-run', { runId: fixedId('run') }], // no reason
      ['accept-blueprint', { runId: fixedId('run') }],
    ];
    for (const [type, payload] of bad) {
      const result = parseCommand(makeCommand(type as never, payload));
      expect(result.ok, `command ${type} should fail`).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid-command');
    }
  });

  it('rejects unknown envelope fields (strict schema) and malformed envelopes', () => {
    const cmd = makeCommand('pause-run', { runId: fixedId('run') });
    expect(parseCommand({ ...cmd, sneaky: true }).ok).toBe(false);
    expect(parseCommand('not-an-object').ok).toBe(false);
    expect(parseCommand({ ...cmd, provenance: undefined }).ok).toBe(false);
  });
});

describe('reports', () => {
  it('accepts a valid report of every type; blueprint binds at run level', () => {
    expect(parseReport(makeReport('implementation', { summary: 's', changedFiles: ['a.ts'] })).ok).toBe(true);
    expect(
      parseReport(
        makeReport('review', { verdict: 'changes_requested', findings: [{ id: 'R1', severity: 'major', title: 't', detail: 'd' }] }),
      ).ok,
    ).toBe(true);
    expect(
      parseReport(makeReport('repair', { summary: 's', resolvedFindings: [{ id: 'R1', resolution: 'r' }], changedFiles: [] })).ok,
    ).toBe(true);
    expect(
      parseReport(
        makeReport('verification-output', {
          checks: [{ id: 'c', label: 'l', status: 'passed', detail: '' }],
          repoRevision: 'rev-1',
        }),
      ).ok,
    ).toBe(true);
    const blueprint = makeReport('blueprint', {
      architectDisplayName: 'Simulated Architect',
      content: { objectiveRestatement: 'r', approach: 'a', taskBreakdown: ['t'], acceptanceCriteria: ['c'], risks: [], constraints: [] },
    });
    expect(parseReport(blueprint).ok).toBe(true);
  });

  it('non-blueprint reports require taskId + packageId (the handoff being answered)', () => {
    const report = makeReport('implementation', { summary: 's', changedFiles: [] });
    delete (report as Record<string, unknown>).packageId;
    const result = parseReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('packageId');
  });

  it('rejects invalid payloads: changes_requested with zero findings; junk shapes', () => {
    const zeroFindings = parseReport(makeReport('review', { verdict: 'changes_requested', findings: [] }));
    expect(zeroFindings.ok).toBe(false);
    expect(parseReport(makeReport('implementation', { changedFiles: 'not-an-array' })).ok).toBe(false);
    expect(parseReport(makeReport('implementation', { summary: 's', changedFiles: [] }, { provenance: undefined as never })).ok).toBe(false);
  });

  it('rejects hidden-reasoning fields on untrusted payloads', () => {
    const sneaky = makeReport('implementation', {
      summary: 's',
      changedFiles: [],
      metadata: { anything: 'preserved here is fine' },
      notes: 'ok',
    });
    (sneaky.payload as Record<string, unknown>).chainOfThought = 'secret plan';
    const result = parseReport(sneaky);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details?.join('\n')).toContain('hidden reasoning');
  });
});

describe('events and queries', () => {
  const validEvent = {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    eventId: fixedId('evt'),
    sequence: 1,
    at: T0,
    projectId: fixedId('prj'),
    source: 'relay-core',
    kind: 'run.created',
    provenance: 'simulated',
    classification: 'historical',
    safeSummary: 'Run created.',
    payload: {},
  };

  it('accepts a valid normalized event and round-trips through JSON', () => {
    const parsed = parseEvent(validEvent);
    expect(parsed.ok).toBe(true);
    const reparsed = parseEvent(JSON.parse(JSON.stringify(validEvent)));
    expect(reparsed.ok).toBe(true);
    if (parsed.ok && reparsed.ok) expect(reparsed.value).toEqual(parsed.value);
  });

  it('rejects invalid events: unknown kind, missing provenance, bad classification, junk sequence', () => {
    expect(parseEvent({ ...validEvent, kind: 'run.mystery' }).ok).toBe(false);
    expect(parseEvent({ ...validEvent, provenance: undefined }).ok).toBe(false);
    expect(parseEvent({ ...validEvent, classification: 'sort-of-true' }).ok).toBe(false);
    expect(parseEvent({ ...validEvent, sequence: 0 }).ok).toBe(false);
    expect(parseEvent({ ...validEvent, extraTopLevel: 1 }).ok).toBe(false);
  });

  it('kind taxonomy covers every documented category', () => {
    for (const prefix of ['run.', 'architect.', 'handoff.', 'agent.', 'reviewer.', 'verification.', 'ledger.', 'task.', 'file_claim.', 'usage.', 'budget.', 'policy.', 'audit.']) {
      expect(RELAY_EVENT_KINDS.some((k) => k.startsWith(prefix)), `kinds for ${prefix}`).toBe(true);
    }
  });

  it('parses queries and rejects unknown query types', () => {
    expect(parseQuery({ protocolVersion: RELAY_PROTOCOL_VERSION, queryId: 'q1', queryType: 'run-status', params: {} }).ok).toBe(true);
    expect(parseQuery({ protocolVersion: RELAY_PROTOCOL_VERSION, queryId: 'q1', queryType: 'everything', params: {} }).ok).toBe(false);
  });
});

describe('structured errors', () => {
  it('declares every required error code', () => {
    for (const code of [
      'protocol-mismatch', 'validation-failed', 'invalid-command', 'invalid-report', 'invalid-event',
      'illegal-transition', 'not-found', 'duplicate-command', 'duplicate-event', 'duplicate-idempotency-key',
      'revision-limit-exceeded', 'immutable', 'permission-denied', 'budget-exceeded', 'stale-ledger-version',
      'stale-context', 'sequence-violation', 'evidence-required', 'reviewer-independence', 'claim-promotion',
      'unsupported-enforcement', 'ledger-version-conflict', 'invalidated-by-decision',
    ]) {
      expect(RELAY_ERROR_CODES).toContain(code);
    }
  });
});
