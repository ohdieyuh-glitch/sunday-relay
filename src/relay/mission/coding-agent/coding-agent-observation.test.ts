import { describe, expect, it } from 'vitest';
import { NO_CAPABILITIES, UNKNOWN_USAGE } from './coding-agent-contracts';
import {
  runtimeRecordFromObservation,
  usageFromRuntimeReport,
  type CodingAgentRunObservation,
} from './coding-agent-observation';
import { projectCodingAgentRuntime } from './coding-agent-projection';
import { sealCodingAgentRecord } from './coding-agent-record';

/**
 * The receipt for one observed run. These tests exist because the Prompt
 * Architect shipped a receipt that asserted the model it REQUESTED, and the
 * Coding Agent must not repeat it: requested and actual stay separate, a
 * process exit is not a verdict, and unknown never becomes zero.
 */

const NOW = '2026-08-02T10:00:00.000Z';

const observation = (over: Partial<CodingAgentRunObservation> = {}): CodingAgentRunObservation => ({
  missionId: 'live-proof-1',
  projectId: 'relay-coding-agent-live-proof',
  requestedRuntime: 'Claude Code',
  requestedModel: null,
  adapterId: 'claude-code-local',
  actualRuntime: 'Claude Code',
  actualModel: 'claude-sonnet-4-5-20250929',
  runtimeVersion: '2.1.220',
  launchVerified: true,
  runId: 'run_1',
  sessionRefRedacted: '…abc123',
  capabilities: NO_CAPABILITIES,
  worktreeRef: '/tmp/relay-ws/run-1',
  startedAt: '2026-08-02T09:59:00.000Z',
  endedAt: NOW,
  exitCode: 0,
  signal: null,
  cancellationRequested: false,
  timedOut: false,
  terminationConfirmed: false,
  spawnFailed: false,
  filesChanged: ['src/normalize.js'],
  filesInspected: ['src/normalize.js'],
  commandsStarted: 1,
  commandsCompleted: 1,
  testsRun: 1,
  testStatus: 'passed',
  outputRefs: [],
  evidenceRefs: [],
  warnings: [],
  usage: UNKNOWN_USAGE,
  stopReason: null,
  now: NOW,
  ...over,
});

describe('runtimeRecordFromObservation — identity', () => {
  it('keeps requested and actual model separate and never falls back', () => {
    const record = runtimeRecordFromObservation(
      observation({ requestedModel: 'sonnet', actualModel: 'claude-sonnet-4-5-20250929' }),
    );
    expect(record.identity.requestedModel).toBe('sonnet');
    expect(record.identity.actualModel).toBe('claude-sonnet-4-5-20250929');
  });

  it('records Unknown when the runtime named no model, even though one was asked for', () => {
    const record = runtimeRecordFromObservation(observation({ requestedModel: 'opus', actualModel: null }));
    expect(record.identity.actualModel).toBeNull();
    // The projection both surfaces render must print Unknown, not 'opus'.
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(record), { bridgeAvailable: true });
    expect(view.modelLabel).toBe('Unknown');
    expect(view.requestedRuntime).toBe('Claude Code');
  });

  it('is offline provenance when nothing launched, however clean the inputs look', () => {
    const record = runtimeRecordFromObservation(
      observation({ launchVerified: false, actualRuntime: null, actualModel: null }),
    );
    expect(record.provenance).toBe('offline');
    expect(record.identity.executionMode).toBe('offline');
    expect(record.connectionState).toBe('disconnected');
  });
});

describe('runtimeRecordFromObservation — a process exit is not a verdict', () => {
  it('marks a completed run only when it launched and exited with nothing refused', () => {
    const record = runtimeRecordFromObservation(observation());
    expect(record.connectionState).toBe('completed');
    expect(record.processState).toBe('exited');
    expect(record.blockedReason).toBeNull();
  });

  it('blocks a run Relay refused even though the process exited 0', () => {
    const record = runtimeRecordFromObservation(
      observation({ exitCode: 0, stopReason: 'The Coding Agent reached outside the isolated workspace (1 target(s)).' }),
    );
    expect(record.connectionState).toBe('blocked');
    expect(record.blockedReason).toContain('outside the isolated workspace');
    // A blocked run is never rendered as a completion.
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(record), { bridgeAvailable: true });
    expect(view.connectionLabel).toBe('Blocked');
    expect(view.outcomeLabel).toContain('outside the isolated workspace');
  });

  it('records a cancelled run as stopped, and does not claim termination it never saw', () => {
    const record = runtimeRecordFromObservation(
      observation({ cancellationRequested: true, terminationConfirmed: false, exitCode: null }),
    );
    expect(record.connectionState).toBe('stopped');
    expect(record.terminationConfirmed).toBe(false);
    expect(record.processState).toBe('unknown');
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(record), { bridgeAvailable: true });
    expect(view.cancellationLabel).toBe('Requested — awaiting confirmation');
  });

  it('records a timeout as stopped with confirmed termination when the runner saw it stop', () => {
    const record = runtimeRecordFromObservation(observation({ timedOut: true, terminationConfirmed: true }));
    expect(record.connectionState).toBe('stopped');
    expect(record.terminationConfirmed).toBe(true);
    expect(record.processState).toBe('terminated');
  });

  it('reports a launched run with no exit status as disconnected, never completed', () => {
    const record = runtimeRecordFromObservation(observation({ exitCode: null }));
    expect(record.connectionState).toBe('disconnected');
    expect(record.disconnectionReason).toContain('could not confirm');
  });

  it('blocks a run whose process never started', () => {
    const record = runtimeRecordFromObservation(
      observation({ spawnFailed: true, launchVerified: false, exitCode: null, stopReason: 'Claude process did not complete normally.' }),
    );
    expect(record.connectionState).toBe('blocked');
    expect(record.processState).toBe('none');
  });
});

describe('usageFromRuntimeReport — unknown is never zero', () => {
  it('stays unavailable when the runtime reported nothing', () => {
    expect(usageFromRuntimeReport({ inputTokens: null, outputTokens: null, reportedCostUsd: null }))
      .toEqual(UNKNOWN_USAGE);
  });

  it('renders Unknown rather than 0 for a run with no reported usage', () => {
    const record = runtimeRecordFromObservation(observation());
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(record), { bridgeAvailable: true });
    expect(view.usageLabel).toBe('Unknown');
  });

  it('carries a runtime-reported cost without floating-point drift', () => {
    const usage = usageFromRuntimeReport({ inputTokens: null, outputTokens: null, reportedCostUsd: 0.0123 });
    expect(usage.source).toBe('runtime_reported');
    expect(usage.reportedCostMicros).toBe('12300');
    expect(usage.currency).toBe('USD');
    // Relay does not invent token counts it was never given.
    expect(usage.inputTokens).toBeNull();
  });

  it('carries reported token counts', () => {
    const usage = usageFromRuntimeReport({ inputTokens: 12, outputTokens: 3, reportedCostUsd: null });
    expect(usage.source).toBe('runtime_reported');
    expect(usage.inputTokens).toBe(12);
    expect(usage.reportedCostMicros).toBeNull();
  });
});

describe('the receipt is durable', () => {
  it('seals to a checksum the store and the browser both verify', () => {
    const sealed = sealCodingAgentRecord(runtimeRecordFromObservation(observation()));
    expect(sealed.checksum.length).toBeGreaterThan(0);
    const resealed = sealCodingAgentRecord(runtimeRecordFromObservation(observation()));
    expect(resealed.checksum).toBe(sealed.checksum);
  });
});
