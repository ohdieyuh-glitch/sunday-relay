import { describe, expect, it } from 'vitest';
import {
  CODING_AGENT_CAPABILITIES,
  NO_CAPABILITIES,
  UNKNOWN_USAGE,
  type CodingAgentRuntimeRecordDraft,
} from './coding-agent-contracts';
import {
  classifyRecoveredRuntime,
  idleCodingAgentRecord,
  readCodingAgentRecord,
  sealCodingAgentRecord,
  verifyCodingAgentChecksum,
} from './coding-agent-record';
import {
  BRIDGE_REQUIRED_LABEL,
  SIMULATED_RUNTIME_LABEL,
  notificationForRuntime,
  projectCodingAgentRuntime,
  renderCodingAgentStatusLines,
} from './coding-agent-projection';

/**
 * The canonical Coding Agent runtime record and the ONE projection both
 * surfaces render. Pure: no process, no clock, no provider — every
 * assertion here holds identically in Node and in the browser.
 */

const NOW = '2026-08-01T12:00:00.000Z';

function draft(overrides: Partial<CodingAgentRuntimeRecordDraft> = {}): CodingAgentRuntimeRecordDraft {
  return {
    ...idleCodingAgentRecord({ missionId: 'mission-1', projectId: 'rly-020', now: NOW }),
    ...overrides,
  };
}

function running(overrides: Partial<CodingAgentRuntimeRecordDraft> = {}): CodingAgentRuntimeRecordDraft {
  const base = draft();
  return {
    ...base,
    identity: {
      ...base.identity,
      actualRuntime: 'Claude Code',
      runtimeVersion: '2.1.220',
      actualModel: null,
      executionMode: 'live',
      runId: 'run-1',
      launchVerified: true,
    },
    capabilities: { ...NO_CAPABILITIES, supportsLiveExecution: true, supportsCancellation: true },
    connectionState: 'connected',
    processState: 'running',
    worktreeRef: 'worktree:rly-020:mission-1',
    startedAt: NOW,
    provenance: 'live',
    ...overrides,
  };
}

/* ----------------------------------------------------------- the record */

describe('the canonical runtime record', () => {
  it('starts truthfully idle: nothing connected, nothing claimed', () => {
    const idle = sealCodingAgentRecord(draft());
    expect(idle.connectionState).toBe('not_connected');
    expect(idle.identity.launchVerified).toBe(false);
    expect(idle.identity.actualRuntime).toBeNull();
    expect(idle.identity.actualModel).toBeNull();
    expect(idle.usage).toEqual(UNKNOWN_USAGE);
    expect(idle.capabilities).toEqual(NO_CAPABILITIES);
  });

  it('keeps requested and actual identity SEPARATE', () => {
    const record = sealCodingAgentRecord(running());
    expect(record.identity.requestedRuntime).toBe('Claude Code');
    expect(record.identity.actualRuntime).toBe('Claude Code');
    // A requested model is never copied into the actual model.
    const withRequest = sealCodingAgentRecord(running({
      identity: { ...running().identity, requestedModel: 'opus', actualModel: null },
    }));
    expect(withRequest.identity.requestedModel).toBe('opus');
    expect(withRequest.identity.actualModel).toBeNull();
    expect(projectCodingAgentRuntime(withRequest).modelLabel).toBe('Unknown');
  });

  it('rejects a tampered record and reports a future schema as unsupported', () => {
    const sealed = sealCodingAgentRecord(running());
    expect(verifyCodingAgentChecksum(sealed)).toBe(true);
    const tampered = { ...sealed, connectionState: 'completed' as const };
    expect(verifyCodingAgentChecksum(tampered)).toBe(false);
    const corrupt = readCodingAgentRecord(tampered);
    if (corrupt.ok || corrupt.reason !== 'corrupt') throw new Error('tampering must be caught');

    const future = { ...sealed, schemaVersion: 'relay-coding-agent-runtime.v99' };
    const unsupported = readCodingAgentRecord(future);
    if (unsupported.ok || unsupported.reason !== 'unsupported_version') {
      throw new Error('a future record must be unsupported, not corrupt');
    }
    expect(unsupported.detail).toContain('v99');
  });

  it('unknown usage must be null — a record with zeroed unknowns is not equivalent', () => {
    const sealed = sealCodingAgentRecord(running());
    expect(sealed.usage.inputTokens).toBeNull();
    expect(sealed.usage.reportedCostMicros).toBeNull();
    expect(JSON.stringify(sealed)).not.toContain('"inputTokens":0');
  });
});

/* -------------------------------------------------------------- recovery */

describe('recovery classification', () => {
  it('an active run whose process cannot be confirmed becomes DISCONNECTED, never completed', () => {
    const before = sealCodingAgentRecord(running({
      evidence: { ...running().evidence, commandsStarted: 3, commandsCompleted: 2, filesChanged: ['a.ts'] },
    }));
    const after = classifyRecoveredRuntime({ record: before, processStillOwned: false, now: NOW });
    expect(after.connectionState).toBe('disconnected');
    expect(after.connectionState).not.toBe('completed');
    expect(after.processState).toBe('unknown');
    expect(after.disconnectionReason).toContain('cannot confirm');
    expect(after.disconnectionReason).toContain('no new process was started');
    // Completed evidence is preserved untouched.
    expect(after.evidence.commandsCompleted).toBe(2);
    expect(after.evidence.filesChanged).toEqual(['a.ts']);
  });

  it('keeps an active run when the process is proven still ours', () => {
    const before = sealCodingAgentRecord(running());
    const after = classifyRecoveredRuntime({ record: before, processStillOwned: true, now: NOW });
    expect(after.connectionState).toBe('connected');
  });

  it('leaves a finished run exactly as it was', () => {
    const done = sealCodingAgentRecord(running({
      connectionState: 'completed', processState: 'exited', exitCode: 0, endedAt: NOW,
    }));
    const after = classifyRecoveredRuntime({ record: done, processStillOwned: false, now: NOW });
    expect(after.connectionState).toBe('completed');
    expect(after.exitCode).toBe(0);
  });
});

/* ------------------------------------------------------------ projection */

describe('the shared projection', () => {
  it('offline without a bridge says so and offers no Start', () => {
    const view = projectCodingAgentRuntime(null, { bridgeAvailable: false });
    expect(view.connectionState).toBe('bridge_required');
    expect(view.connectionLabel).toBe('Relay Bridge required');
    expect(view.outcomeLabel).toBe(BRIDGE_REQUIRED_LABEL);
    expect(view.canStart).toBe(false);
    expect(view.canStop).toBe(false);
    expect(view.summary).toContain('Relay Bridge required');
    // Never claims a connection or a version it has not seen.
    expect(view.versionLabel).toBe('Unknown');
    expect(view.launchVerified).toBe(false);
  });

  it('with a bridge but no run: Not connected, Start permitted', () => {
    const view = projectCodingAgentRuntime(null, { bridgeAvailable: true });
    expect(view.connectionLabel).toBe('Not connected');
    expect(view.canStart).toBe(true);
  });

  it('shows Connected only for a verified launch', () => {
    const verified = projectCodingAgentRuntime(sealCodingAgentRecord(running()));
    expect(verified.connectionLabel).toBe('Connected');
    expect(verified.launchVerified).toBe(true);
    expect(verified.versionLabel).toBe('2.1.220');
    expect(verified.canStop).toBe(true);
  });

  it('renders unknown usage as Unknown, never zero', () => {
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(running()));
    expect(view.usageLabel).toBe('Unknown');
    expect(view.usageLabel).not.toContain('0');
  });

  it('a disconnection never reads as a completion', () => {
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(running({
      connectionState: 'disconnected',
      processState: 'unknown',
      disconnectionReason: 'Relay restarted and cannot confirm the process.',
    })));
    expect(view.connectionLabel).toBe('Disconnected');
    expect(view.outcomeLabel).toContain('cannot confirm');
    expect(view.outcomeLabel).not.toContain('successfully');
    expect(view.blocking).toBe(true);
  });

  it('a stop is only "confirmed" when termination was observed', () => {
    const pending = projectCodingAgentRuntime(sealCodingAgentRecord(running({
      connectionState: 'stopped', cancellationRequested: true, terminationConfirmed: false,
    })));
    expect(pending.outcomeLabel).toContain('not yet confirmed');
    const confirmed = projectCodingAgentRuntime(sealCodingAgentRecord(running({
      connectionState: 'stopped', cancellationRequested: true, terminationConfirmed: true,
    })));
    expect(confirmed.outcomeLabel).toContain('Termination confirmed');
    expect(confirmed.outcomeLabel).toContain('preserved');
  });

  it('advertises only the capabilities the record carries', () => {
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(running()));
    expect(view.capabilityLabels).toEqual(['Live execution', 'Cancellation']);
    const none = projectCodingAgentRuntime(sealCodingAgentRecord(draft()));
    expect(none.capabilityLabels).toEqual([]);
    expect(CODING_AGENT_CAPABILITIES).toHaveLength(8);
  });

  it('discloses a simulated runtime', () => {
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(running({ provenance: 'simulated' })));
    expect(view.disclosure).toBe(SIMULATED_RUNTIME_LABEL);
  });
});

/* --------------------------------------------------------- notifications */

describe('notifications follow verified facts', () => {
  it('started requires a verified launch', () => {
    const unverified = sealCodingAgentRecord(running({
      identity: { ...running().identity, launchVerified: false },
    }));
    expect(notificationForRuntime(unverified)).toBeNull();
    const verified = sealCodingAgentRecord(running());
    expect(notificationForRuntime(verified)?.title).toBe('Coding Agent started');
  });

  it('completed requires an actual process exit', () => {
    const stillRunning = sealCodingAgentRecord(running({ connectionState: 'completed', processState: 'running' }));
    expect(notificationForRuntime(stillRunning)).toBeNull();
    const exited = sealCodingAgentRecord(running({ connectionState: 'completed', processState: 'exited' }));
    expect(notificationForRuntime(exited)?.title).toBe('Coding Agent completed');
  });

  it('stopped requires confirmed termination', () => {
    const pending = sealCodingAgentRecord(running({ connectionState: 'stopped', terminationConfirmed: false }));
    expect(notificationForRuntime(pending)).toBeNull();
    const confirmed = sealCodingAgentRecord(running({ connectionState: 'stopped', terminationConfirmed: true }));
    expect(notificationForRuntime(confirmed)?.title).toBe('Coding Agent stopped');
  });

  it('disconnection is critical and carries the exact reason', () => {
    const record = sealCodingAgentRecord(running({
      connectionState: 'disconnected', disconnectionReason: 'process ownership could not be verified',
    }));
    const note = notificationForRuntime(record);
    expect(note?.title).toBe('Coding Agent disconnected');
    expect(note?.kind).toBe('critical');
    expect(note?.body).toBe('process ownership could not be verified');
  });

  it('a dedupe key is stable per run, so a re-render cannot re-announce', () => {
    const record = sealCodingAgentRecord(running());
    expect(notificationForRuntime(record)?.key).toBe(notificationForRuntime(record)?.key);
    expect(notificationForRuntime(record)?.key).toContain('mission-1');
  });
});

/* ---------------------------------------------------- surfaces agree */

describe('website and CLI agree', () => {
  it('every CLI line comes from the shared view', () => {
    const view = projectCodingAgentRuntime(sealCodingAgentRecord(running()));
    const out = renderCodingAgentStatusLines('mission-1', view).join('\n');
    expect(out).toContain(view.connectionLabel);
    expect(out).toContain(view.versionLabel);
    expect(out).toContain(view.modelLabel);
    expect(out).toContain(view.usageLabel);
    expect(out).toContain(view.outcomeLabel);
  });

  it('the CLI states the same bridge requirement the website does', () => {
    const view = projectCodingAgentRuntime(null, { bridgeAvailable: false });
    const out = renderCodingAgentStatusLines('mission-1', view).join('\n');
    expect(out).toContain('Relay Bridge required');
    expect(out).toContain('Unknown');
  });
});

describe('boundary', () => {
  it('the pure module reaches no process, git, clock or network', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;
    const combined = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .join('\n');
    expect(combined).not.toMatch(/from\s+['"]node:/);
    expect(combined).not.toMatch(/child_process|execFile|spawn\(/);
    expect(combined).not.toMatch(/Date\.now\s*\(|new Date\(\)/);
    expect(combined).not.toMatch(/\bfetch\s*\(|relay-api/);
    // The provider-neutral record must not hard-code Claude beyond a default.
    expect(combined).not.toMatch(/anthropic\.com|ANTHROPIC_API_KEY/);
  });
});
