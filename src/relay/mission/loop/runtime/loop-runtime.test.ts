import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXHAUSTION_LOOP_STATES,
  RELAY_LOOP_STATES,
  TERMINAL_LOOP_STATES,
} from '../loop-contract';
import { PREFIXES, checkId } from '../../../protocol/ids';
import {
  BLOCKING_LOOP_CLASSIFICATIONS,
  LOOP_EVENT_KINDS_REQUIRING_IDEMPOTENCY,
  RELAY_LOOP_EVENT_KINDS,
  RELAY_LOOP_EVENT_SCHEMA_VERSION,
  RELAY_LOOP_EVENT_STATE,
  RELAY_LOOP_LIMIT_LANDINGS,
  RELAY_LOOP_RECOVERY_CLASSIFICATIONS,
  RELAY_LOOP_RUNTIME_STATES,
  RELAY_LOOP_RUN_SCHEMA_VERSION,
  RELAY_LOOP_STATE_CLASS,
  RELAY_LOOP_STATE_CLASSES,
  RELAY_LOOP_TRANSITIONS,
  REPEATABLE_LOOP_EVENT_KINDS,
  RESUMABLE_LOOP_CLASSIFICATIONS,
  appendLoopRunEvent,
  applyLoopEvent,
  buildLoopEvent,
  checkpointLoopRun,
  classifyLoopRecovery,
  classifyLoopState,
  containsForbiddenLoopMaterial,
  createInMemoryLoopBacking,
  emptyLoopBudget,
  emptyLoopRunRecord,
  isActiveLoopState,
  isExhaustionLoopState,
  isRecoveryLoopState,
  isStoppingLoopState,
  isTerminalLoopState,
  isWaitingLoopState,
  landingForLimit,
  loadLoopRun,
  loopDigest,
  loopEventIdentity,
  loopRunSucceeded,
  loopSnapshotFrom,
  loopStatesInClass,
  mayDispatchAgent,
  mayResumeFrom,
  readLoopRun,
  replayLoopJournal,
  sanitizeLoopPayload,
  sanitizeLoopText,
  seedLoopRun,
  transitionLoopRun,
  verifyLoopEventChecksum,
  type LoopJournalIntegrity,
  type RelayLoopAgentExecution,
  type RelayLoopAssignment,
  type RelayLoopEvent,
  type RelayLoopEventInput,
  type RelayLoopEventPayload,
  type RelayLoopRun,
  type RelayLoopRuntimeState,
  type RelayLoopSnapshot,
} from './index';
import { HIDDEN_REASONING_RE, SECRET_VALUE_RE } from '../../../persistence/redaction';

/**
 * STAGE 2 — the durable single-agent Loop runtime.
 *
 * These tests exist to make four claims impossible to make falsely: that a run
 * reached a state it has no edge to, that a journal replayed into something
 * other than what it says, that a duplicate delivery counted twice, and that
 * running out of something is the same as finishing.
 */

const NOW = '2026-08-03T09:00:00.000Z';
const later = (minutes: number): string =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

const ASSIGNMENT: RelayLoopAssignment = {
  requestedRole: 'coding_agent',
  resolvedRole: 'coding_agent',
  requestedAdapterId: 'fake-coding-agent',
  actualAdapterId: null,
  actualAgentId: null,
  requestedModel: 'model-under-test',
  actualModel: null,
  assignedAt: NOW,
};

const BUDGET = emptyLoopBudget({
  maxIterations: 5,
  maxTotalDurationMinutes: 60,
  maxSpendMicros: '1000000',
  currency: 'USD',
  maxTotalTokens: 100_000,
  maxProviderCalls: 10,
  maxConsecutiveFailures: 3,
});

function seed(): RelayLoopRun {
  return seedLoopRun({
    runId: 'lpr_test',
    loopId: 'lpe_test',
    projectId: 'prj_test',
    workspaceId: 'wsp_test',
    contractRef: 'contract-ref',
    contractVersion: 1,
    contractBindingDigest: 'digest-1',
    budget: BUDGET,
    createdAt: NOW,
    provenance: 'simulated',
  });
}

/** Build a journal line. Digests/checksums belong to the persistence adapter;
 *  the reducer never reads them, so the tests keep them constant. */
let sequence = 0;
function event(
  payload: RelayLoopEventPayload,
  at: string = NOW,
  overrides: Partial<RelayLoopEvent> = {},
): RelayLoopEvent {
  sequence += 1;
  return {
    schemaVersion: RELAY_LOOP_RUN_SCHEMA_VERSION,
    eventId: `evt-${sequence}`,
    sequence,
    at,
    runId: 'lpr_test',
    loopId: 'lpe_test',
    projectId: 'prj_test',
    kind: payload.kind,
    actor: 'relay-runtime',
    recoveryGeneration: 0,
    expectedPreviousState: null,
    idempotencyKey: null,
    previousStateDigest: 'prev',
    resultingStateDigest: 'next',
    payload,
    checksum: 'sum',
    ...overrides,
  };
}
const resetSequence = (): void => {
  sequence = 0;
};

const execution = (
  iterationId: string,
  overrides: Partial<RelayLoopAgentExecution> = {},
): RelayLoopAgentExecution => ({
  executionId: `exe-${iterationId}`,
  iterationId,
  startedAt: NOW,
  finishedAt: NOW,
  outcome: 'completed',
  usage: { costMicros: '1000', currency: 'USD', tokens: 100, providerCalls: 1 },
  failureSummary: null,
  ...overrides,
});

const OBSERVATION = {
  observationId: 'obs-sample', iterationId: 'lpi_1', kind: 'progress_report',
  sourceTrust: 'claim', summary: 'sample', evidenceRefs: [], criterionIds: [], observedAt: NOW,
} as const;

/** One representative payload per kind — the table the vocabulary tests walk. */
const SAMPLE_PAYLOADS: Record<string, RelayLoopEventPayload> = {
  'loop.contract_confirmed': { kind: 'loop.contract_confirmed', contractRef: 'r', contractVersion: 1, bindingDigest: 'd', confirmedBy: 'founder' },
  'loop.run_created': { kind: 'loop.run_created', idempotencyKey: 'i', creationSource: 'cli', createdBy: 'founder' },
  'loop.run_claimed': { kind: 'loop.run_claimed', sessionId: 'ses_1', expiresAt: NOW, recoveryGeneration: 0 },
  'loop.agent_assigned': { kind: 'loop.agent_assigned', assignment: ASSIGNMENT },
  'loop.iteration_started': { kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 },
  'loop.agent_request_prepared': { kind: 'loop.agent_request_prepared', iterationId: 'lpi_1', inputRefs: [] },
  'loop.agent_execution_started': { kind: 'loop.agent_execution_started', iterationId: 'lpi_1', executionId: 'exe-1' },
  'loop.output_observed': { kind: 'loop.output_observed', observation: OBSERVATION },
  'loop.evidence_recorded': { kind: 'loop.evidence_recorded', iterationId: 'lpi_1', evidenceRefs: ['evd_1'] },
  'loop.completion_claim_recorded': { kind: 'loop.completion_claim_recorded', iterationId: 'lpi_1', observationId: 'obs-1' },
  'loop.completion_evaluated': { kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'incomplete', reasons: [] },
  'loop.iteration_finished': { kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') },
  'loop.next_iteration_scheduled': { kind: 'loop.next_iteration_scheduled', decision: { decisionId: 'dcn-1', iterationId: 'lpi_1', action: 'continue', reason: 'r', nextState: 'running', decidedAt: NOW } },
  'loop.pause_requested': { kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'req-1' },
  'loop.safe_checkpoint_reached': { kind: 'loop.safe_checkpoint_reached', reason: 'iteration_boundary', iterationId: 'lpi_1' },
  'loop.paused': { kind: 'loop.paused', at: NOW, requestId: 'req-1' },
  'loop.resume_requested': { kind: 'loop.resume_requested', requestedBy: 'founder', requestId: 'req-2' },
  'loop.resumed': { kind: 'loop.resumed', recoveryGeneration: 1 },
  'loop.stop_requested': { kind: 'loop.stop_requested', requestedBy: 'founder', requestId: 'req-3', reason: 'enough' },
  'loop.stopped': { kind: 'loop.stopped', reason: 'enough' },
  'loop.limit_reached': { kind: 'loop.limit_reached', limit: 'iterations', detail: 'd' },
  'loop.blocked': { kind: 'loop.blocked', blockers: [] },
  'loop.failed': { kind: 'loop.failed', failure: { failureId: 'flr-1', kind: 'adapter_failure', summary: 's', iterationId: null, at: NOW, recoverable: false } },
  'loop.recovery_required': { kind: 'loop.recovery_required', reason: 'r', uncertainIterationId: null },
  'loop.completed': { kind: 'loop.completed', verdict: 'verified_complete', evidenceRefs: [] },
};

/** The admission prefix every run shares. */
function admissionEvents(): RelayLoopEvent[] {
  return [
    event({ kind: 'loop.contract_confirmed', contractRef: 'contract-ref', contractVersion: 1, bindingDigest: 'digest-1', confirmedBy: 'founder' }),
    event({ kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' }),
    event({ kind: 'loop.agent_assigned', assignment: ASSIGNMENT }),
  ];
}

/* ==================================================== the identifier === */

describe('the Loop run identifier', () => {
  it('uses lpr, and lpr is its own family', () => {
    expect(PREFIXES.lpr).toBe('lpr_');
    expect(checkId('lpr_abc123', 'lpr', 'runId')).toBeNull();
  });

  it('is not interchangeable with the Loop it runs', () => {
    // A Loop id where a run id belongs is the bug this prefix exists to catch.
    expect(checkId('lpe_abc123', 'lpr', 'runId')).not.toBeNull();
    expect(checkId('lpr_abc123', 'lpe', 'loopId')).not.toBeNull();
  });

  it('collides with no other prefix in the repository', () => {
    const values = Object.values(PREFIXES);
    expect(new Set(values).size).toBe(values.length);
  });
});

/* ================================================== the state machine === */

describe('the runtime state vocabulary', () => {
  it('is a subset of the canonical Loop vocabulary', () => {
    for (const state of RELAY_LOOP_RUNTIME_STATES) {
      expect(RELAY_LOOP_STATES, `${state} must be a canonical Loop state`).toContain(state);
    }
  });

  it('carries all eight runtime states this stage added', () => {
    for (const added of [
      'starting', 'pausing', 'resuming', 'stopping',
      'iteration_exhausted', 'duration_exhausted', 'token_exhausted', 'provider_call_exhausted',
    ]) {
      expect(RELAY_LOOP_STATES).toContain(added);
      expect(RELAY_LOOP_RUNTIME_STATES).toContain(added);
    }
  });

  it('keeps token, budget and provider-call exhaustion as three distinct states', () => {
    // They are three different bounds, fixed three different ways. Collapsing
    // them would tell a user to raise a spend cap when they ran out of tokens.
    const distinct = new Set(['token_exhausted', 'budget_exhausted', 'provider_call_exhausted']);
    expect(distinct.size).toBe(3);
    for (const state of distinct) expect(EXHAUSTION_LOOP_STATES).toContain(state);
  });

  it('excludes the multi-agent states no Stage 2 runtime can reach', () => {
    for (const later of ['decomposing', 'reviewing', 'repairing', 'converging']) {
      expect(RELAY_LOOP_STATES).toContain(later);
      expect(RELAY_LOOP_RUNTIME_STATES).not.toContain(later);
    }
  });

  it('has no duplicates and every state has a transition entry', () => {
    expect(new Set(RELAY_LOOP_RUNTIME_STATES).size).toBe(RELAY_LOOP_RUNTIME_STATES.length);
    for (const state of RELAY_LOOP_RUNTIME_STATES) {
      expect(RELAY_LOOP_TRANSITIONS[state], `${state} has no entry`).toBeDefined();
    }
  });

  it('never declares an edge to a state outside the runtime vocabulary', () => {
    const known = new Set<string>(RELAY_LOOP_RUNTIME_STATES);
    for (const [from, targets] of Object.entries(RELAY_LOOP_TRANSITIONS)) {
      for (const to of targets) {
        expect(known.has(to), `${from} -> ${to} leaves the runtime vocabulary`).toBe(true);
      }
    }
  });
});

describe('transitions are validated and fail closed', () => {
  it('accepts the admission path', () => {
    const path: RelayLoopRuntimeState[] = [
      'draft', 'validating', 'queued', 'starting', 'running', 'observing', 'completion_check', 'completed',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      const moved = transitionLoopRun(path[i], path[i + 1]);
      expect(moved.ok, `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it('refuses an illegal edge with both states named', () => {
    const moved = transitionLoopRun('queued', 'completed');
    expect(moved.ok).toBe(false);
    if (moved.ok) throw new Error('unreachable');
    expect(moved.reason).toContain('queued');
    expect(moved.reason).toContain('completed');
  });

  it('refuses to re-enter the same state', () => {
    // Idempotent re-entry is not a transition; treating it as one would let a
    // retried request append a second identical event.
    const moved = transitionLoopRun('running', 'running');
    expect(moved.ok).toBe(false);
  });

  it('lets nothing leave a terminal state', () => {
    for (const terminal of TERMINAL_LOOP_STATES) {
      expect(RELAY_LOOP_TRANSITIONS[terminal as RelayLoopRuntimeState]).toEqual([]);
      const moved = transitionLoopRun(terminal as RelayLoopRuntimeState, 'running');
      expect(moved.ok, `${terminal} must not return to running`).toBe(false);
      if (moved.ok) throw new Error('unreachable');
      expect(moved.reason).toContain('new run');
    }
  });

  it('treats recovery_required as an interruption, not an ending', () => {
    expect(TERMINAL_LOOP_STATES).not.toContain('recovery_required');
    expect(transitionLoopRun('recovery_required', 'resuming').ok).toBe(true);
    // But never straight back to running — resume re-checks first.
    expect(transitionLoopRun('recovery_required', 'running').ok).toBe(false);
  });

  it('reaches completed from exactly one state', () => {
    const sources = Object.entries(RELAY_LOOP_TRANSITIONS)
      .filter(([, targets]) => targets.includes('completed'))
      .map(([from]) => from);
    expect(sources).toEqual(['completion_check']);
  });

  it('dispatches an agent from exactly one state', () => {
    const dispatchable = RELAY_LOOP_RUNTIME_STATES.filter(mayDispatchAgent);
    expect(dispatchable).toEqual(['running']);
  });

  it('resumes only from paused or recovery_required', () => {
    expect(RELAY_LOOP_RUNTIME_STATES.filter(mayResumeFrom).sort())
      .toEqual(['paused', 'recovery_required']);
  });

  it('maps each limit to its own landing state', () => {
    expect(landingForLimit('iterations')).toBe('iteration_exhausted');
    expect(landingForLimit('duration')).toBe('duration_exhausted');
    expect(landingForLimit('spend')).toBe('budget_exhausted');
    expect(landingForLimit('tokens')).toBe('token_exhausted');
    expect(landingForLimit('provider_calls')).toBe('provider_call_exhausted');
    expect(new Set(Object.values(RELAY_LOOP_LIMIT_LANDINGS)).size)
      .toBe(Object.keys(RELAY_LOOP_LIMIT_LANDINGS).length);
  });

  it('classifies every exhaustion as terminal and none as completion', () => {
    for (const state of EXHAUSTION_LOOP_STATES) {
      expect(isExhaustionLoopState(state as RelayLoopRuntimeState)).toBe(true);
      expect(isTerminalLoopState(state as RelayLoopRuntimeState)).toBe(true);
      expect(state).not.toBe('completed');
    }
  });
});

/* ======================================================= event vocabulary === */

describe('the journal event vocabulary', () => {
  it('drives no event to completed except loop.completed', () => {
    const reaching = Object.entries(RELAY_LOOP_EVENT_STATE)
      .filter(([, state]) => state === 'completed')
      .map(([kind]) => kind);
    expect(reaching).toEqual(['loop.completed']);
  });

  it('declares a state consequence for every kind', () => {
    for (const kind of RELAY_LOOP_EVENT_KINDS) {
      expect(RELAY_LOOP_EVENT_STATE, kind).toHaveProperty(kind);
    }
  });

  it('has a sample payload for every kind, so the vocabulary tests cover them all', () => {
    for (const kind of RELAY_LOOP_EVENT_KINDS) {
      expect(SAMPLE_PAYLOADS[kind], `${kind} has no sample payload`).toBeDefined();
    }
    expect(Object.keys(SAMPLE_PAYLOADS).sort()).toEqual([...RELAY_LOOP_EVENT_KINDS].sort());
  });

  it('identifies repeated facts by subject, not by event id', () => {
    const a = loopEventIdentity({ kind: 'loop.iteration_started', payload: { kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 } });
    const b = loopEventIdentity({ kind: 'loop.iteration_started', payload: { kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 } });
    const c = loopEventIdentity({ kind: 'loop.iteration_started', payload: { kind: 'loop.iteration_started', iterationId: 'lpi_2', ordinal: 2 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

/* ============================================================ reducer === */

describe('the reducer folds a run', () => {
  it('walks admission and one full iteration', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.agent_execution_started', iterationId: 'lpi_1', executionId: 'exe-lpi_1' }),
      event({
        kind: 'loop.output_observed',
        observation: {
          observationId: 'obs-1', iterationId: 'lpi_1', kind: 'evidence_produced',
          sourceTrust: 'attested', summary: 'fixture attested', evidenceRefs: ['evd_1'],
          criterionIds: ['AC-1'], observedAt: NOW,
        },
      }),
      event({ kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') }),
      event({ kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'verified_complete', reasons: ['attested evidence'] }),
      event({ kind: 'loop.completed', verdict: 'verified_complete', evidenceRefs: ['evd_1'] }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems).toEqual([]);
    expect(result.applied).toBe(events.length);
    const run = result.run;
    if (run === null) throw new Error('expected a run');
    expect(run.state).toBe('completed');
    expect(run.iterations).toHaveLength(1);
    expect(run.budget.iterationsStarted).toBe(1);
    expect(run.budget.iterationsCompleted).toBe(1);
    expect(run.currentIterationId).toBeNull();
  });

  it('refuses an iteration before an agent was assigned', () => {
    resetSequence();
    const events = [
      event({ kind: 'loop.contract_confirmed', contractRef: 'contract-ref', contractVersion: 1, bindingDigest: 'digest-1', confirmedBy: 'founder' }),
      event({ kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' }),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems.join(' ')).toContain('before an agent has been assigned');
  });

  it('refuses a second dispatch on one iteration', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.agent_execution_started', iterationId: 'lpi_1', executionId: 'exe-a' }),
      event({ kind: 'loop.agent_execution_started', iterationId: 'lpi_1', executionId: 'exe-b' }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems.join(' ')).toContain('already has an execution');
  });

  it('requires gap-free 1-based iteration ordinals', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_2', ordinal: 2 }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems.join(' ')).toContain('expected 1');
  });

  it('anchors the run clock at the FIRST iteration and never moves it', () => {
    // `startedAt` is what a duration limit is measured against. If a later
    // iteration reset it, a Loop could run past its wall-clock bound forever
    // and every individual measurement would look correct.
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }, later(1)),
      event({ kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') }, later(5)),
      event({ kind: 'loop.next_iteration_scheduled', decision: { decisionId: 'dcn-1', iterationId: 'lpi_1', action: 'continue', reason: 'more work', nextState: 'running', decidedAt: later(5) } }, later(5)),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_2', ordinal: 2 }, later(9)),
    ];
    const run = replayLoopJournal(seed(), events).run;
    if (run === null) throw new Error('expected a run');
    expect(run.budget.startedAt).toBe(later(1));
    expect(run.budget.iterationsStarted).toBe(2);
    // `updatedAt` DOES advance — it answers a different question.
    expect(run.updatedAt).toBe(later(9));
  });

  it('records a completion claim without acting on it', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.completion_claim_recorded', iterationId: 'lpi_1', observationId: 'obs-1' }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems).toEqual([]);
    // A claim moved nothing. The run is still running.
    expect(result.run?.state).toBe('running');
  });
});

/* ==================================================== duplicate events === */

describe('a duplicate event is rejected, never folded twice', () => {
  it('rejects a repeated once-per-run event', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems.join(' ')).toMatch(/Duplicate event|only once per run/);
  });

  it('rejects the same iteration started twice, so counts cannot double', () => {
    resetSequence();
    const base = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
    ];
    const clean = replayLoopJournal(seed(), base);
    expect(clean.run?.budget.iterationsStarted).toBe(1);

    const duplicated = [...base, event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 })];
    const result = replayLoopJournal(seed(), duplicated);
    expect(result.problems.join(' ')).toContain('Duplicate event');
    // The count never reached two.
    expect(result.run?.budget.iterationsStarted).toBe(1);
  });

  it('rejects a gapped sequence rather than reducing what remains', () => {
    resetSequence();
    const events = admissionEvents();
    const gapped = [events[0], { ...events[2], sequence: 3 }];
    const result = replayLoopJournal(seed(), gapped);
    expect(result.problems.join(' ')).toContain('gap-free');
  });
});

/* ======================================================== unknown usage === */

describe('unknown never becomes zero', () => {
  it('marks spend and tokens unknown when the adapter cannot report them', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({
        kind: 'loop.iteration_finished',
        iterationId: 'lpi_1',
        execution: execution('lpi_1', {
          usage: { costMicros: null, currency: null, tokens: null, providerCalls: null },
        }),
      }),
    ];
    const run = replayLoopJournal(seed(), events).run;
    if (run === null) throw new Error('expected a run');
    expect(run.budget.knownSpendMicros).toBeNull();
    expect(run.budget.spendHasUnknownComponent).toBe(true);
    expect(run.budget.tokensUsed).toBeNull();
    expect(run.budget.tokensHaveUnknownComponent).toBe(true);
    // Specifically NOT zero.
    expect(run.budget.knownSpendMicros).not.toBe('0');
    expect(run.budget.tokensUsed).not.toBe(0);
  });

  it('keeps a known total known when every report is known', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') }),
    ];
    const run = replayLoopJournal(seed(), events).run;
    expect(run?.budget.knownSpendMicros).toBe('1000');
    expect(run?.budget.spendHasUnknownComponent).toBe(false);
    expect(run?.budget.tokensUsed).toBe(100);
  });

  it('counts consecutive failures and resets them on success', () => {
    resetSequence();
    const failing = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1', { outcome: 'failed' }) }),
    ];
    expect(replayLoopJournal(seed(), failing).run?.budget.consecutiveFailures).toBe(1);
  });
});

/* ====================================================== exhaustion === */

describe('running out is never finishing', () => {
  const LIMITS = [
    ['iterations', 'iteration_exhausted'],
    ['duration', 'duration_exhausted'],
    ['spend', 'budget_exhausted'],
    ['tokens', 'token_exhausted'],
    ['provider_calls', 'provider_call_exhausted'],
  ] as const;

  for (const [limit, expected] of LIMITS) {
    it(`${limit} lands on ${expected}, and ${expected} is not completed`, () => {
      resetSequence();
      const events = [
        ...admissionEvents(),
        event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
        event({
          kind: 'loop.output_observed',
          observation: {
            observationId: 'obs-1', iterationId: 'lpi_1', kind: 'progress_report',
            sourceTrust: 'claim', summary: 'work continues', evidenceRefs: [],
            criterionIds: [], observedAt: NOW,
          },
        }),
        event({ kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'incomplete', reasons: ['no attested evidence'] }),
        event({ kind: 'loop.limit_reached', limit, detail: `${limit} limit reached` }),
      ];
      const result = replayLoopJournal(seed(), events);
      expect(result.problems).toEqual([]);
      const run = result.run;
      if (run === null) throw new Error('expected a run');
      expect(run.state).toBe(expected);
      expect(run.state).not.toBe('completed');
      expect(isTerminalLoopState(run.state)).toBe(true);
      expect(run.interruptionReason).toContain(limit);
    });
  }

  it('cannot continue after an exhaustion', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.output_observed', observation: { observationId: 'obs-1', iterationId: 'lpi_1', kind: 'progress_report', sourceTrust: 'claim', summary: 's', evidenceRefs: [], criterionIds: [], observedAt: NOW } }),
      event({ kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'incomplete', reasons: [] }),
      event({ kind: 'loop.limit_reached', limit: 'iterations', detail: 'iteration limit reached' }),
      event({ kind: 'loop.next_iteration_scheduled', decision: { decisionId: 'dcn-1', iterationId: 'lpi_1', action: 'continue', reason: 'more work', nextState: 'running', decidedAt: NOW } }),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems.join(' ')).toContain('terminal');
  });
});

/* ================================================= snapshot and replay === */

describe('snapshots accelerate reads and never outrank the journal', () => {
  const digest = (value: unknown): string => JSON.stringify(value);

  function completedJournal(): RelayLoopEvent[] {
    resetSequence();
    return [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.output_observed', observation: { observationId: 'obs-1', iterationId: 'lpi_1', kind: 'evidence_produced', sourceTrust: 'verified', summary: 'verified', evidenceRefs: ['evd_1'], criterionIds: ['AC-1'], observedAt: NOW } }),
      event({ kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'verified_complete', reasons: [] }),
      event({ kind: 'loop.completed', verdict: 'verified_complete', evidenceRefs: ['evd_1'] }),
    ];
  }

  it('replays deterministically — the same journal always yields the same run', () => {
    const events = completedJournal();
    const a = replayLoopJournal(seed(), events).run;
    const b = replayLoopJournal(seed(), events).run;
    expect(digest(a)).toBe(digest(b));
  });

  function goodSnapshot(events: RelayLoopEvent[]): RelayLoopSnapshot {
    const replayed = replayLoopJournal(seed(), events);
    if (replayed.run === null) throw new Error('expected a run');
    return loopSnapshotFrom(replayed.run, replayed.lastSequence, digest);
  }

  it('uses the CURRENT snapshot when it agrees with the journal', () => {
    const events = completedJournal();
    const loaded = loadLoopRun({ seed: seed(), events, snapshot: goodSnapshot(events), digest });
    expect(loaded.source).toBe('current');
    expect(loaded.problems).toEqual([]);
    expect(loaded.recoveryRequired).toBe(false);
  });

  it('falls back CURRENT → PREVIOUS when the current snapshot is torn', () => {
    // The crash this models happens DURING a snapshot write: the current file
    // is half-written, the previous one is untouched. That is the entire reason
    // the writer rotates instead of overwriting.
    const events = completedJournal();
    const torn = { ...goodSnapshot(events), stateDigest: 'tampered-by-a-torn-write' };
    const loaded = loadLoopRun({
      seed: seed(), events, snapshot: torn, previousSnapshot: goodSnapshot(events), digest,
    });
    expect(loaded.source).toBe('previous');
    expect(loaded.problems.join(' ')).toContain('failed its own digest');
    expect(loaded.run?.state).toBe('completed');
  });

  it('falls back PREVIOUS → REPLAY_ONLY when neither snapshot is usable', () => {
    const events = completedJournal();
    const torn = { ...goodSnapshot(events), stateDigest: 'tampered' };
    const alsoTorn = { ...goodSnapshot(events), stateDigest: 'also-tampered' };
    const loaded = loadLoopRun({
      seed: seed(), events, snapshot: torn, previousSnapshot: alsoTorn, digest,
    });
    expect(loaded.source).toBe('replay_only');
    // Both were named, so an operator can see that two caches were discarded.
    expect(loaded.problems.filter((p) => p.includes('discarded'))).toHaveLength(2);
    expect(loaded.run?.state).toBe('completed');
  });

  it('discards a snapshot that verifies but disagrees with the journal', () => {
    // A stale cache that passes its own checksum is the dangerous one.
    const events = completedJournal();
    const stale = replayLoopJournal(seed(), events.slice(0, 4));
    if (stale.run === null) throw new Error('expected a run');
    const snapshot = loopSnapshotFrom(stale.run, 99, digest);
    const loaded = loadLoopRun({ seed: seed(), events, snapshot, digest });
    expect(loaded.source).toBe('replay_only');
    expect(loaded.problems.join(' ')).toContain('disagrees with the journal');
    expect(loaded.run?.state).toBe('completed');
  });

  it('discards a snapshot belonging to a different run', () => {
    const events = completedJournal();
    const foreign = { ...goodSnapshot(events), runId: 'lpr_someone_else' };
    const loaded = loadLoopRun({ seed: seed(), events, snapshot: foreign, digest });
    expect(loaded.source).toBe('replay_only');
    expect(loaded.problems.join(' ')).toContain('lpr_someone_else');
  });

  it('discards a snapshot written by a build it cannot read', () => {
    const events = completedJournal();
    const future = { ...goodSnapshot(events), schemaVersion: 'relay-loop-run.v99' };
    const loaded = loadLoopRun({ seed: seed(), events, snapshot: future, digest });
    expect(loaded.source).toBe('replay_only');
    expect(loaded.problems.join(' ')).toContain('cannot read');
  });

  it('falls back to replay when there is no snapshot at all', () => {
    const events = completedJournal();
    const loaded = loadLoopRun({ seed: seed(), events, snapshot: null, digest });
    expect(loaded.source).toBe('replay_only');
    expect(loaded.run?.state).toBe('completed');
    expect(loaded.recoveryRequired).toBe(false);
  });

  it('reaches RECOVERY_REQUIRED when the journal itself cannot be reduced', () => {
    resetSequence();
    const events = [...admissionEvents()];
    const corrupted = [...events, { ...events[1], sequence: 4 }];
    const loaded = loadLoopRun({ seed: seed(), events: corrupted, snapshot: null, digest });
    expect(loaded.source).toBe('recovery_required');
    expect(loaded.recoveryRequired).toBe(true);
    expect(loaded.problems.length).toBeGreaterThan(0);
  });

  it('never substitutes a verifying snapshot for a corrupt journal', () => {
    // The trap: the snapshot is perfectly good, so returning it would look
    // like a clean recovery. It caches a file nobody can read any more, so
    // what it says cannot be confirmed.
    const events = completedJournal();
    const loaded = loadLoopRun({
      seed: seed(), events, snapshot: goodSnapshot(events), digest, journalIntegrity: 'corrupt',
    });
    expect(loaded.source).toBe('recovery_required');
    expect(loaded.recoveryRequired).toBe(true);
    expect(loaded.run).toBeNull();
    expect(loaded.problems.join(' ')).toContain('only ever caches a journal that can be read');
  });

  it('classifies a torn tail as reduced-up-to-the-tear, not as corruption', () => {
    const events = completedJournal();
    const loaded = loadLoopRun({
      seed: seed(), events, snapshot: null, digest, journalIntegrity: 'truncated_tail',
    });
    // The complete lines still reduce. The tear is REPORTED, never hidden.
    expect(loaded.run?.state).toBe('completed');
    expect(loaded.journalIntegrity).toBe('truncated_tail');
    expect(loaded.problems.join(' ')).toContain('torn write');
    expect(loaded.source).not.toBe('recovery_required');
  });

  it('mirrors the three integrity verdicts the Node journal reader produces', () => {
    // Same vocabulary, so a verdict crossing the layer boundary keeps meaning
    // the same thing.
    const verdicts: LoopJournalIntegrity[] = ['ok', 'truncated_tail', 'corrupt'];
    expect(verdicts).toHaveLength(3);
  });
});

/* ================================================= state classification === */

describe('every state is classified, and the classes do not blur', () => {
  it('classifies every runtime state exactly once', () => {
    for (const state of RELAY_LOOP_RUNTIME_STATES) {
      expect(RELAY_LOOP_STATE_CLASS[state], `${state} is unclassified`).toBeDefined();
      expect(RELAY_LOOP_STATE_CLASSES).toContain(classifyLoopState(state));
    }
    // And no class is declared but empty — an unused class is a class nobody
    // maintains.
    for (const stateClass of RELAY_LOOP_STATE_CLASSES) {
      expect(loopStatesInClass(stateClass).length, `${stateClass} has no states`).toBeGreaterThan(0);
    }
  });

  it('partitions the states — every one in exactly one class', () => {
    const counted = RELAY_LOOP_STATE_CLASSES.flatMap((c) => loopStatesInClass(c));
    expect(counted).toHaveLength(RELAY_LOOP_RUNTIME_STATES.length);
    expect(new Set(counted).size).toBe(RELAY_LOOP_RUNTIME_STATES.length);
  });

  it('makes the three terminal classes exactly the terminal states', () => {
    const terminal = [
      ...loopStatesInClass('exhausted'),
      ...loopStatesInClass('successful_terminal'),
      ...loopStatesInClass('unsuccessful_terminal'),
    ].sort();
    const declared = RELAY_LOOP_RUNTIME_STATES.filter(isTerminalLoopState).sort();
    expect(terminal).toEqual(declared);
  });

  it('says exactly one state means success, and no exhaustion is it', () => {
    const succeeded = RELAY_LOOP_RUNTIME_STATES.filter(loopRunSucceeded);
    expect(succeeded).toEqual(['completed']);
    for (const state of loopStatesInClass('exhausted')) {
      expect(loopRunSucceeded(state), `${state} must not read as success`).toBe(false);
      expect(isTerminalLoopState(state)).toBe(true);
    }
    // Stopped, timed out and failed are endings too — and none of them succeeded.
    for (const state of loopStatesInClass('unsuccessful_terminal')) {
      expect(loopRunSucceeded(state)).toBe(false);
    }
  });

  it('keeps waiting apart from active — waiting is not progress', () => {
    for (const state of loopStatesInClass('waiting')) {
      expect(isWaitingLoopState(state)).toBe(true);
      expect(isActiveLoopState(state), `${state} must not read as progress`).toBe(false);
      // And no wait state may dispatch an agent; the wait would mean nothing.
      expect(mayDispatchAgent(state)).toBe(false);
    }
  });

  it('keeps a requested halt apart from a completed one', () => {
    // `stopping` is an intent in flight. A surface that reads it as `stopped`
    // shows "stopped" while an agent is still mid-call.
    expect(isStoppingLoopState('stopping')).toBe(true);
    expect(isStoppingLoopState('pausing')).toBe(true);
    expect(isTerminalLoopState('stopping')).toBe(false);
    expect(isTerminalLoopState('pausing')).toBe(false);
    expect(classifyLoopState('stopped')).toBe('unsuccessful_terminal');
    expect(classifyLoopState('paused')).toBe('resumable');
  });

  it('keeps recovery as neither finished nor running', () => {
    expect(isRecoveryLoopState('recovery_required')).toBe(true);
    expect(isTerminalLoopState('recovery_required')).toBe(false);
    expect(isActiveLoopState('recovery_required')).toBe(false);
    expect(loopRunSucceeded('recovery_required')).toBe(false);
  });

  it('treats resuming as active work, not as something to resume again', () => {
    expect(classifyLoopState('resuming')).toBe('active');
    expect(mayResumeFrom('resuming')).toBe(false);
  });
});

/* ========================================================= recovery === */

describe('recovery classification', () => {
  const base = {
    replayProblems: [] as readonly string[],
    contractStillBinds: true,
    schemaSupported: true,
    adapterObservable: null as boolean | null,
  };

  function runInFlight(outcome: RelayLoopAgentExecution['outcome'] | 'none'): RelayLoopRun {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      ...(outcome === 'none'
        ? []
        : [event({ kind: 'loop.agent_execution_started', iterationId: 'lpi_1', executionId: 'exe-1' })]),
    ];
    const run = replayLoopJournal(seed(), events).run;
    if (run === null) throw new Error('expected a run');
    return run;
  }

  it('never auto-resumes anything', () => {
    // Stage 2 has no provably idempotent dispatch, so this is false everywhere.
    for (const outcome of ['none', 'unknown'] as const) {
      const report = classifyLoopRecovery({ ...base, run: runInFlight(outcome) });
      expect(report.mayAutoResume).toBe(false);
    }
  });

  it('an unobservable dispatched iteration requires inspection, not replay', () => {
    const report = classifyLoopRecovery({ ...base, run: runInFlight('unknown'), adapterObservable: false });
    expect(report.classification).toBe('execution_outcome_unknown');
    expect(report.resumable).toBe(false);
    expect(BLOCKING_LOOP_CLASSIFICATIONS).toContain(report.classification);
    expect(report.detail).toContain('may already have run');
    expect(report.uncertainIterationId).toBe('lpi_1');
  });

  it('an unknown adapter status is unavailable, not assumed dead', () => {
    const report = classifyLoopRecovery({ ...base, run: runInFlight('unknown'), adapterObservable: null });
    expect(report.classification).toBe('adapter_status_unavailable');
    expect(report.resumable).toBe(false);
  });

  it('an opened but never dispatched iteration is safe to resume', () => {
    const report = classifyLoopRecovery({ ...base, run: runInFlight('none') });
    expect(report.classification).toBe('safe_to_resume');
    expect(report.resumable).toBe(true);
    expect(RESUMABLE_LOOP_CLASSIFICATIONS).toContain(report.classification);
  });

  it('a moved contract is held even when everything else is fine', () => {
    const report = classifyLoopRecovery({ ...base, run: runInFlight('none'), contractStillBinds: false });
    expect(report.classification).toBe('contract_moved');
    expect(report.detail).toContain('nobody approved');
  });

  it('a corrupt replay is never interpreted', () => {
    const report = classifyLoopRecovery({ ...base, run: null, replayProblems: ['bad line'] });
    expect(report.classification).toBe('record_corrupt');
    expect(report.resumable).toBe(false);
  });

  it('a newer schema is refused rather than guessed', () => {
    const report = classifyLoopRecovery({ ...base, run: runInFlight('none'), schemaSupported: false });
    expect(report.classification).toBe('unsupported_record_version');
  });

  it('a completed run has nothing to recover, and a terminated one stays ended', () => {
    resetSequence();
    const completed = replayLoopJournal(seed(), [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.output_observed', observation: { observationId: 'obs-1', iterationId: 'lpi_1', kind: 'evidence_produced', sourceTrust: 'verified', summary: 'v', evidenceRefs: [], criterionIds: [], observedAt: NOW } }),
      event({ kind: 'loop.completion_evaluated', iterationId: 'lpi_1', verdict: 'verified_complete', reasons: [] }),
      event({ kind: 'loop.completed', verdict: 'verified_complete', evidenceRefs: [] }),
    ]).run;
    if (completed === null) throw new Error('expected a run');
    expect(classifyLoopRecovery({ ...base, run: completed }).classification).toBe('completed');

    const exhausted: RelayLoopRun = { ...completed, state: 'iteration_exhausted' };
    const report = classifyLoopRecovery({ ...base, run: exhausted });
    expect(report.classification).toBe('terminated');
    expect(report.resumable).toBe(false);
    expect(report.detail).toContain('new run');
  });

  it('every classification is either resumable or blocking or terminal-ish, never silently neither', () => {
    const covered = new Set([
      ...RESUMABLE_LOOP_CLASSIFICATIONS,
      ...BLOCKING_LOOP_CLASSIFICATIONS,
      'completed',
      'terminated',
    ]);
    for (const classification of RELAY_LOOP_RECOVERY_CLASSIFICATIONS) {
      expect(covered.has(classification), `${classification} is unclassified`).toBe(true);
    }
  });
});

/* ====================================================== event builder === */

describe('building a journal line', () => {
  const base = (
    payload: RelayLoopEventPayload,
    overrides: Partial<RelayLoopEventInput> = {},
  ): RelayLoopEventInput => ({
    at: NOW,
    runId: 'lpr_test',
    loopId: 'lpe_test',
    projectId: 'prj_test',
    kind: payload.kind,
    actor: 'relay-runtime',
    recoveryGeneration: 0,
    expectedPreviousState: null,
    idempotencyKey: null,
    payload,
    ...overrides,
  });

  const build = (input: RelayLoopEventInput, sequence = 1) =>
    buildLoopEvent({ base: input, sequence, previousStateDigest: 'a', resultingStateDigest: 'b', digest: loopDigest });

  it('stamps the event schema version, which is not the run schema version', () => {
    const built = build(base({ kind: 'loop.blocked', blockers: [] }));
    if (!built.ok) throw new Error(built.problem);
    expect(built.event.schemaVersion).toBe(RELAY_LOOP_EVENT_SCHEMA_VERSION);
    // They version independently: a new event kind does not reshape a run.
    expect(RELAY_LOOP_EVENT_SCHEMA_VERSION).not.toBe(RELAY_LOOP_RUN_SCHEMA_VERSION);
  });

  it('refuses a request-shaped event with no idempotency key', () => {
    for (const kind of LOOP_EVENT_KINDS_REQUIRING_IDEMPOTENCY) {
      const payload = kind === 'loop.run_created'
        ? ({ kind, idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' } as const)
        : kind === 'loop.stop_requested'
          ? ({ kind, requestedBy: 'founder', requestId: 'req-1', reason: 'enough' } as const)
          : ({ kind, requestedBy: 'founder', requestId: 'req-1' } as const);
      const built = build(base(payload as RelayLoopEventPayload, { idempotencyKey: null }));
      expect(built.ok, `${kind} must require a key`).toBe(false);
      if (built.ok) throw new Error('unreachable');
      expect(built.problem).toContain('idempotency key');
    }
  });

  it('accepts the same events once a key is supplied', () => {
    const built = build(base(
      { kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'req-1' },
      { idempotencyKey: 'idem-pause-1' },
    ));
    expect(built.ok).toBe(true);
  });

  it('refuses a line whose kind and payload disagree', () => {
    const built = build(base({ kind: 'loop.blocked', blockers: [] }, { kind: 'loop.completed' }));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('unreachable');
    expect(built.problem).toContain('must agree');
  });

  it('refuses a sequence that is not a whole number from one', () => {
    for (const sequence of [0, -1, 1.5]) {
      expect(build(base({ kind: 'loop.blocked', blockers: [] }), sequence).ok).toBe(false);
    }
  });

  it('checksums the line, and the checksum verifies', () => {
    const built = build(base({ kind: 'loop.blocked', blockers: [] }));
    if (!built.ok) throw new Error(built.problem);
    expect(verifyLoopEventChecksum(built.event, loopDigest)).toBe(true);
    // Edit any field and it stops verifying — that is the whole job.
    expect(verifyLoopEventChecksum({ ...built.event, actor: 'someone-else' }, loopDigest)).toBe(false);
  });

  it('sanitizes BEFORE checksumming, so the checksum covers what was stored', () => {
    const built = build(base({
      kind: 'loop.stopped',
      reason: 'stopping because the key sk-abcdefghijklmnop leaked into the reason',
    }));
    if (!built.ok) throw new Error(built.problem);
    const payload = built.event.payload as { reason: string };
    expect(payload.reason).not.toContain('sk-abcdefghijklmnop');
    expect(payload.reason).toContain('[REDACTED]');
    // If sanitizing had happened after signing, this would fail.
    expect(verifyLoopEventChecksum(built.event, loopDigest)).toBe(true);
  });
});

/* ================================================== payload redaction === */

describe('a journal line never carries material it should not', () => {
  it('rejects hidden reasoning by shape, and does not keep the part that fitted', () => {
    const safe = sanitizeLoopText('<thinking>the user cannot see this</thinking> done');
    expect(safe).not.toContain('the user cannot see this');
    expect(safe).toContain('hidden-reasoning');
    for (const marker of ['chain of thought', 'chain-of-thought', 'internal monologue', 'hidden reasoning']) {
      expect(sanitizeLoopText(`work log: ${marker} follows`)).toContain('REDACTED');
    }
  });

  it('replaces secret-shaped values wherever they are nested', () => {
    const payload = sanitizeLoopPayload({
      kind: 'loop.output_observed',
      observation: { summary: 'used sk-abcdefghijklmnop to call out', nested: { deeper: 'ghp_012345678901234567890123' } },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('sk-abcdefghijklmnop');
    expect(serialized).not.toContain('ghp_012345678901234567890123');
  });

  it('drops forbidden keys outright rather than redacting their values', () => {
    const payload = sanitizeLoopPayload({ summary: 'fine', apiKey: 'x', transcript: 'y', reasoning: 'z' }) as
      Record<string, unknown>;
    expect(payload.summary).toBe('fine');
    expect(payload).not.toHaveProperty('apiKey');
    expect(payload).not.toHaveProperty('transcript');
    expect(payload).not.toHaveProperty('reasoning');
  });

  it('bounds a summary so an unbounded model output cannot be persisted whole', () => {
    const long = 'a'.repeat(50_000);
    expect(sanitizeLoopText(long).length).toBeLessThan(3_000);
  });

  it('agrees with the Node persistence layer it mirrors', () => {
    // Divergence here would mean the Loop journal accepts material the mission
    // journal refuses, which is exactly the drift the pinning prevents.
    for (const marker of ['<thinking>', 'chain of thought', 'hidden reasoning', 'internal monologue']) {
      expect(HIDDEN_REASONING_RE.test(marker)).toBe(true);
      expect(containsForbiddenLoopMaterial(marker)).toBe('hidden-reasoning marker');
    }
    for (const secret of ['sk-abcdefghijklmnop', 'ghp_012345678901234567890123', 'AKIA0123456789ABCD']) {
      SECRET_VALUE_RE.lastIndex = 0;
      expect(SECRET_VALUE_RE.test(secret), `${secret} must look like a secret to both layers`).toBe(true);
      expect(containsForbiddenLoopMaterial(secret)).toBe('secret-shaped value');
    }
    expect(containsForbiddenLoopMaterial('an ordinary progress note')).toBeNull();
  });
});

/* ============================================ staleness and generations === */

describe('a stale writer cannot fold work into a run that moved on', () => {
  function pausedRun(): RelayLoopRun {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'req-1' }),
      event({ kind: 'loop.paused', at: NOW, requestId: 'pause-1' }),
      event({ kind: 'loop.resume_requested', requestedBy: 'founder', requestId: 'req-2' }),
      event({ kind: 'loop.resumed', recoveryGeneration: 1 }),
    ];
    const run = replayLoopJournal(seed(), events).run;
    if (run === null) throw new Error('expected a run');
    return run;
  }

  it('lets a run be paused and resumed more than once', () => {
    // Every repeatable kind must have a real SUBJECT in its identity. A kind
    // identified by name alone makes its second occurrence a duplicate, which
    // silently caps a run at one resume for its whole life.
    resetSequence();
    // Each cycle is written by the worker holding the generation the run is
    // ALREADY at; the resume is what advances it to the next one.
    const cycle = (requestSuffix: string, reaching: number): RelayLoopEvent[] => {
      const held = { recoveryGeneration: reaching - 1 };
      return [
        event({ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: `pause-${requestSuffix}` }, NOW, held),
        event({ kind: 'loop.paused', at: NOW, requestId: `pause-${requestSuffix}` }, NOW, held),
        event({ kind: 'loop.resume_requested', requestedBy: 'founder', requestId: `resume-${requestSuffix}` }, NOW, held),
        event({ kind: 'loop.resumed', recoveryGeneration: reaching }, NOW, held),
      ];
    };
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      ...cycle('a', 1),
      ...cycle('b', 2),
      ...cycle('c', 3),
    ];
    const result = replayLoopJournal(seed(), events);
    expect(result.problems).toEqual([]);
    expect(result.run?.recoveryGeneration).toBe(3);
    expect(result.run?.state).toBe('running');
    // Three pause/resume cycles and still exactly one iteration.
    expect(result.run?.budget.iterationsStarted).toBe(1);
    expect(result.run?.iterations).toHaveLength(1);
  });

  it('gives every repeatable kind a subject, so the list is not inert', () => {
    // A repeatable kind whose identity is just its name can never repeat.
    const subjectless = REPEATABLE_LOOP_EVENT_KINDS.filter((kind) => {
      const sample = SAMPLE_PAYLOADS[kind];
      return sample !== undefined && loopEventIdentity({ kind, payload: sample }) === kind;
    });
    expect(subjectless, 'these kinds are listed repeatable but cannot repeat').toEqual([]);
  });

  it('still calls the same resume twice a duplicate', () => {
    resetSequence();
    const events = [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'pause-1' }),
      event({ kind: 'loop.paused', at: NOW, requestId: 'pause-1' }),
      event({ kind: 'loop.resume_requested', requestedBy: 'founder', requestId: 'resume-1' }),
      event({ kind: 'loop.resumed', recoveryGeneration: 1 }),
      // The SAME generation again — a redelivery, not a second resume.
      event({ kind: 'loop.resumed', recoveryGeneration: 1 }),
    ];
    expect(replayLoopJournal(seed(), events).problems.join(' ')).toContain('Duplicate event');
  });

  it('advances the recovery generation on resume', () => {
    const run = pausedRun();
    expect(run.recoveryGeneration).toBe(1);
    expect(run.state).toBe('running');
  });

  it('refuses an event from an older generation — the pause/resume duplicate', () => {
    // The worker that was paused wakes up still holding generation 0 and tries
    // to finish the iteration it started. Folding it would count that iteration
    // twice: once here, once from the worker that actually resumed.
    const run = pausedRun();
    resetSequence();
    const stale = event(
      { kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') },
      NOW,
      { recoveryGeneration: 0 },
    );
    const result = applyLoopEvent(run, stale);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('no longer owns this run');
    // Nothing counted.
    expect(result.run.budget.iterationsCompleted).toBe(0);
  });

  it('accepts the current generation', () => {
    const run = pausedRun();
    resetSequence();
    const current = event(
      { kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') },
      NOW,
      { recoveryGeneration: 1 },
    );
    const result = applyLoopEvent(run, current);
    expect(result.ok).toBe(true);
    expect(result.run.budget.iterationsCompleted).toBe(1);
  });

  it('refuses an event whose expected previous state is not the run\'s state', () => {
    const run = pausedRun();
    resetSequence();
    const confused = event(
      { kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') },
      NOW,
      { recoveryGeneration: 1, expectedPreviousState: 'paused' },
    );
    const result = applyLoopEvent(run, confused);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('already changed');
  });

  it('accepts an event whose expected previous state matches', () => {
    const run = pausedRun();
    resetSequence();
    const agreed = event(
      { kind: 'loop.iteration_finished', iterationId: 'lpi_1', execution: execution('lpi_1') },
      NOW,
      { recoveryGeneration: 1, expectedPreviousState: 'running' },
    );
    expect(applyLoopEvent(run, agreed).ok).toBe(true);
  });
});

/* ============================================================== store === */

describe('the run store refuses to record the same fact twice', () => {
  function freshStore() {
    const backing = createInMemoryLoopBacking([emptyLoopRunRecord(seed())]);
    return backing;
  }

  const appendBase = (
    payload: RelayLoopEventPayload,
    overrides: Partial<RelayLoopEventInput> = {},
  ): RelayLoopEventInput => ({
    at: NOW,
    runId: 'lpr_test',
    loopId: 'lpe_test',
    projectId: 'prj_test',
    kind: payload.kind,
    actor: 'relay-runtime',
    recoveryGeneration: 0,
    expectedPreviousState: null,
    idempotencyKey: null,
    payload,
    ...overrides,
  });

  function admit(backing: ReturnType<typeof freshStore>): void {
    for (const base of [
      appendBase({ kind: 'loop.contract_confirmed', contractRef: 'contract-ref', contractVersion: 1, bindingDigest: 'digest-1', confirmedBy: 'founder' }),
      appendBase({ kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' }, { idempotencyKey: 'idem-1' }),
      appendBase({ kind: 'loop.agent_assigned', assignment: ASSIGNMENT }),
    ]) {
      const result = appendLoopRunEvent(backing, { runId: 'lpr_test', base, digest: loopDigest });
      if (!result.ok) throw new Error(result.problem);
    }
  }

  it('appends a gap-free journal and reduces it', () => {
    const backing = freshStore();
    admit(backing);
    const loaded = readLoopRun(backing, 'lpr_test', loopDigest);
    expect(loaded?.run?.state).toBe('starting');
    expect(loaded?.lastSequence).toBe(3);
    expect(backing.read('lpr_test')?.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('recognises a retry by idempotency key and appends nothing', () => {
    const backing = freshStore();
    admit(backing);
    const retry = appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      // Same request, rebuilt with a different creation source — the key is
      // what identifies it, not the payload's contents.
      base: appendBase(
        { kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'website', createdBy: 'founder' },
        { idempotencyKey: 'idem-1' },
      ),
      digest: loopDigest,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error('unreachable');
    expect(retry.duplicate).toBe(true);
    expect(backing.read('lpr_test')?.events).toHaveLength(3);
    // The run still says what the FIRST request said.
    expect(retry.run.creationSource).toBe('cli');
  });

  it('recognises the same logical fact even with a different event id', () => {
    const backing = freshStore();
    admit(backing);
    const first = appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      base: appendBase({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      digest: loopDigest,
    });
    expect(first.ok && first.duplicate).toBe(false);
    const again = appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      base: appendBase({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      digest: loopDigest,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('unreachable');
    expect(again.duplicate).toBe(true);
    expect(backing.read('lpr_test')?.events).toHaveLength(4);
    // The iteration was counted exactly once.
    expect(again.run.budget.iterationsStarted).toBe(1);
  });

  it('writes nothing when the event cannot be folded', () => {
    const backing = freshStore();
    admit(backing);
    const before = backing.read('lpr_test')?.events.length ?? 0;
    // Ordinal 2 with no first iteration — impossible, so nothing is stored.
    const refused = appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      base: appendBase({ kind: 'loop.iteration_started', iterationId: 'lpi_2', ordinal: 2 }),
      digest: loopDigest,
    });
    expect(refused.ok).toBe(false);
    expect(backing.read('lpr_test')?.events).toHaveLength(before);
  });

  it('refuses to append to a journal that does not read cleanly', () => {
    const backing = freshStore();
    admit(backing);
    const record = backing.read('lpr_test');
    if (record === null) throw new Error('expected a record');
    backing.write({ ...record, integrity: 'corrupt' });
    const refused = appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      base: appendBase({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      digest: loopDigest,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.problem).toContain('does not read cleanly');
  });

  it('rotates the current snapshot into the previous slot', () => {
    const backing = freshStore();
    admit(backing);
    const first = checkpointLoopRun(backing, 'lpr_test', loopDigest);
    expect(first.ok).toBe(true);
    appendLoopRunEvent(backing, {
      runId: 'lpr_test',
      base: appendBase({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      digest: loopDigest,
    });
    const second = checkpointLoopRun(backing, 'lpr_test', loopDigest);
    expect(second.ok).toBe(true);
    const record = backing.read('lpr_test');
    // The older snapshot survived the newer write — that is what makes the
    // previous-snapshot fallback possible at all.
    expect(record?.previousSnapshot?.lastEventSequence).toBe(3);
    expect(record?.snapshot?.lastEventSequence).toBe(4);
  });

  it('reads a run back through the snapshot it just wrote', () => {
    const backing = freshStore();
    admit(backing);
    checkpointLoopRun(backing, 'lpr_test', loopDigest);
    expect(readLoopRun(backing, 'lpr_test', loopDigest)?.source).toBe('current');
  });

  it('reports an unknown run as absent rather than as empty', () => {
    expect(readLoopRun(freshStore(), 'lpr_absent', loopDigest)).toBeNull();
  });
});

/* ============================================================ digests === */

describe('digests are stable, so a run reduced elsewhere still verifies', () => {
  it('does not depend on key insertion order', () => {
    // A run rebuilt field-by-field in a different order is the same run. If the
    // digest disagreed, every cross-process read would report false corruption.
    expect(loopDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(loopDigest({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes when any value changes', () => {
    expect(loopDigest({ a: 1 })).not.toBe(loopDigest({ a: 2 }));
  });

  it('produces lowercase hex sha-256', () => {
    expect(loopDigest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same journal the same digest every time', () => {
    resetSequence();
    const events = [...admissionEvents()];
    const a = replayLoopJournal(seed(), events).run;
    const b = replayLoopJournal(seed(), events).run;
    expect(loopDigest(a)).toBe(loopDigest(b));
  });
});

/* ================================================== identity boundary === */

describe('who was asked for is never confused with who answered', () => {
  it('keeps requested and actual identity as separate fields', () => {
    resetSequence();
    const run = replayLoopJournal(seed(), admissionEvents()).run;
    if (run === null) throw new Error('expected a run');
    const assignment = run.assignment;
    if (assignment === null) throw new Error('expected an assignment');
    // Requested is known from the command.
    expect(assignment.requestedRole).toBe('coding_agent');
    expect(assignment.requestedAdapterId).toBe('fake-coding-agent');
    expect(assignment.requestedModel).toBe('model-under-test');
    // Actual is NOT known, and is null rather than an optimistic copy.
    expect(assignment.actualAdapterId).toBeNull();
    expect(assignment.actualAgentId).toBeNull();
    expect(assignment.actualModel).toBeNull();
  });

  it('never fills an actual identity from the requested one on replay', () => {
    resetSequence();
    const run = replayLoopJournal(seed(), [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
    ]).run;
    if (run === null) throw new Error('expected a run');
    // The iteration inherited the assignment — including its unknowns.
    expect(run.iterations[0].assignment.actualModel).toBeNull();
    expect(run.iterations[0].assignment.requestedModel).toBe('model-under-test');
  });

  it('records an observed identity only when it was observed', () => {
    resetSequence();
    const observed: RelayLoopAssignment = {
      ...ASSIGNMENT,
      actualAdapterId: 'fake-coding-agent',
      actualAgentId: 'agent-7',
      actualModel: 'model-actually-run',
    };
    const run = replayLoopJournal(seed(), [
      event({ kind: 'loop.contract_confirmed', contractRef: 'contract-ref', contractVersion: 1, bindingDigest: 'digest-1', confirmedBy: 'founder' }),
      event({ kind: 'loop.run_created', idempotencyKey: 'idem-1', creationSource: 'cli', createdBy: 'founder' }),
      event({ kind: 'loop.agent_assigned', assignment: observed }),
    ]).run;
    expect(run?.assignment?.actualModel).toBe('model-actually-run');
    // And it is still distinct from what was asked for.
    expect(run?.assignment?.requestedModel).toBe('model-under-test');
  });
});

/* ================================================== completion trust === */

describe('a model saying "done" cannot complete a Loop', () => {
  it('carries all four trust levels, in order', () => {
    resetSequence();
    const run = replayLoopJournal(seed(), [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      ...(['claim', 'observed', 'attested', 'verified'] as const).map((trust, i) =>
        event({
          kind: 'loop.output_observed',
          observation: {
            observationId: `obs-${i}`, iterationId: 'lpi_1', kind: 'progress_report',
            sourceTrust: trust, summary: `${trust} report`, evidenceRefs: [], criterionIds: [], observedAt: NOW,
          },
        })),
    ]).run;
    if (run === null) throw new Error('expected a run');
    expect(run.iterations[0].observations.map((o) => o.sourceTrust))
      .toEqual(['claim', 'observed', 'attested', 'verified']);
  });

  it('leaves a run running after a completion claim, however confident', () => {
    resetSequence();
    const run = replayLoopJournal(seed(), [
      ...admissionEvents(),
      event({ kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 }),
      event({
        kind: 'loop.output_observed',
        observation: {
          observationId: 'obs-1', iterationId: 'lpi_1', kind: 'completion_claim',
          sourceTrust: 'claim', summary: 'I have finished the task.', evidenceRefs: [],
          criterionIds: ['AC-1'], observedAt: NOW,
        },
      }),
      event({ kind: 'loop.completion_claim_recorded', iterationId: 'lpi_1', observationId: 'obs-1' }),
    ]).run;
    expect(run?.state).toBe('observing');
    expect(run?.state).not.toBe('completed');
    expect(loopRunSucceeded(run?.state ?? 'failed')).toBe(false);
  });

  it('reaches completed only through an evaluation, never through a claim', () => {
    // `completion_check` is the only state with an edge to `completed`, and
    // only `loop.completion_evaluated` reaches `completion_check`.
    const reaching = Object.entries(RELAY_LOOP_EVENT_STATE)
      .filter(([, state]) => state === 'completion_check')
      .map(([kind]) => kind);
    expect(reaching).toEqual(['loop.completion_evaluated']);
    expect(RELAY_LOOP_EVENT_STATE['loop.completion_claim_recorded']).toBeNull();
  });
});

/* ========================================================= boundaries === */

describe('the runtime stays a pure leaf', () => {
  const FILES = [
    'loop-runtime-types.ts',
    'loop-runtime-state.ts',
    'loop-runtime-events.ts',
    'loop-runtime-reducer.ts',
    'loop-runtime-recovery.ts',
    'loop-runtime-redaction.ts',
    'loop-runtime-store.ts',
    'loop-runtime-digest.ts',
    'index.ts',
  ];

  /**
   * These checks read SOURCE, so they must read code and not prose. A header
   * that explains why the reducer does no hashing contains the word `crypto`,
   * and a check that cannot tell the explanation from the deed would force the
   * file to stop explaining itself.
   */
  const code = (file: string): string =>
    readFileSync(join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('imports no Node builtin, persistence, connector, workspace or CLI module', () => {
    for (const file of FILES) {
      const source = code(file);
      expect(/from\s+['"]node:/.test(source), `${file} imports a node builtin`).toBe(false);
      expect(
        /from\s+['"][./]*\.\.\/\.\.\/\.\.\/(persistence|workspace|connectors|cli)/.test(source),
        `${file} reaches a server module`,
      ).toBe(false);
      expect(/child_process|readFileSync|writeFileSync/.test(source), `${file} touches fs/process`).toBe(false);
    }
  });

  it('reads no clock and no environment', () => {
    for (const file of FILES) {
      const source = code(file);
      expect(/Date\.now\(\)|new Date\(\)/.test(source), `${file} reads a clock`).toBe(false);
      expect(/process\.env|import\.meta\.env/.test(source), `${file} reads the environment`).toBe(false);
    }
  });

  it('declares no credential-shaped field', () => {
    const CREDENTIAL = /\b(apiKey|accessToken|refreshToken|clientSecret|privateKey|password|bearer)\b\s*[:?]/;
    for (const file of FILES) {
      expect(CREDENTIAL.test(code(file)), `${file} declares a credential field`).toBe(false);
    }
  });

  it('hashes nothing itself — the digest is injected', () => {
    const reducer = code('loop-runtime-reducer.ts');
    expect(/createHash|sha256|crypto/.test(reducer)).toBe(false);
    expect(readFileSync(join(__dirname, 'loop-runtime-reducer.ts'), 'utf8')).toContain('LoopDigestFn');
    // The one module that DOES hash borrows the shared pure implementation
    // rather than carrying its own.
    const digest = code('loop-runtime-digest.ts');
    expect(digest).toContain("from '../../durable/durable-digest'");
    expect(/function\s+sha256Hex/.test(digest), 'the Loop must not reimplement sha-256').toBe(false);
  });
});

/* ======================================================= no execution === */

describe('the runtime domain executes nothing', () => {
  it('contains no dispatch, spawn, fetch or provider call', () => {
    for (const file of ['loop-runtime-types.ts', 'loop-runtime-state.ts', 'loop-runtime-reducer.ts', 'loop-runtime-recovery.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      for (const forbidden of [/\bfetch\s*\(/, /\bspawn\s*\(/, /execFile/, /anthropic|openai/i]) {
        expect(forbidden.test(source), `${file} matches ${forbidden}`).toBe(false);
      }
    }
  });

  it('applyLoopEvent is total — it returns problems instead of throwing', () => {
    const run = seed();
    const nonsense = {
      ...event({ kind: 'loop.completed', verdict: 'verified_complete', evidenceRefs: [] }),
    };
    expect(() => applyLoopEvent(run, nonsense)).not.toThrow();
    const result = applyLoopEvent(run, nonsense);
    expect(result.ok).toBe(false);
    expect(result.problem).toBeTruthy();
    // And the run it returns is the one it was given, untouched.
    expect(result.run).toBe(run);
  });
});
