import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './main';
import { createNodeCodingAgentStore } from '../persistence';
import {
  NO_CAPABILITIES,
  idleCodingAgentRecord,
  projectCodingAgentRuntime,
  renderCodingAgentStatusLines,
  runtimeRecordFromObservation,
  usageFromRuntimeReport,
} from '../mission';

/**
 * These tests PROBE THE REAL INSTALLED CLI (`--version`, `--help`,
 * `auth status`) — they never run a model, but three subprocesses cost more
 * than vitest's 5s default, so the probing cases carry an explicit budget.
 *
 * `relay mission coding-agent status|inspect|stop` — read-only status plus a
 * recorded stop REQUEST. No arbitrary Claude CLI passthrough exists, and the
 * printed wording comes from the projection the website also renders.
 */

const roots: string[] = [];
const stateRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-ca-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = '2026-08-01T12:00:00.000Z';
/**
 * Explicit budget for cases that shell out to the installed Claude CLI.
 *
 * Each such case spawns THREE real subprocesses (`--version`, `--help`,
 * `auth status`), each bounded by the probe's own 15s timeout — so a single
 * case can legitimately need ~45s before the probe itself gives up. Six cases
 * in this file now do that, and under full-suite CPU contention on a machine
 * where Claude is actually installed, 60s was still not enough.
 *
 * The budget is deliberately well clear of 3 x 15s rather than tuned to the
 * last observed duration: a timeout that sits just above the worst run is a
 * flake waiting to happen, and a flaky gate teaches people to re-run instead
 * of to look. On CI, where the Claude CLI is not installed, the probe resolves
 * no executable and these cases finish in milliseconds.
 */
const PROBES = 120_000;

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runCli(args, {
    out: (line: string) => lines.push(line),
    isTTY: false,
    env: { ...process.env, NO_COLOR: '1' } as NodeJS.ProcessEnv,
  });
  return { code, out: lines.join('\n') };
}

describe('relay mission coding-agent', () => {
  it('reports an unstarted runtime without claiming a connection', async () => {
    const { out } = await run(['mission', 'coding-agent', 'status', 'm1', '--state-root', stateRoot()]);
    expect(out).toContain('CODING AGENT — m1');
    expect(out).toContain('Claude Code (requested)');
    // Nothing ran: actual identity and model stay Unknown.
    expect(out).toContain('Actual:       Unknown');
    expect(out).toContain('Model:        Unknown');
    expect(out).toContain('Launch:       not verified');
    expect(out).toContain('Usage:        Unknown');
    expect(out).not.toContain('Connection:   Connected');
  }, PROBES);

  it('matches the website projection line for line', async () => {
    const root = stateRoot();
    const store = createNodeCodingAgentStore(root);
    const written = await store.write(
      idleCodingAgentRecord({ missionId: 'm1', projectId: 'p1', now: NOW }),
    );
    expect(written.ok).toBe(true);
    const { out } = await run(['mission', 'coding-agent', 'status', 'm1', '--state-root', root]);
    const expected = renderCodingAgentStatusLines(
      'm1',
      projectCodingAgentRuntime(written.record ?? null, { bridgeAvailable: true }),
    );
    for (const line of expected) expect(out).toContain(line.trim());
  }, PROBES);

  it('inspect reports the REAL installed runtime and its probed capabilities', async () => {
    const { out } = await run(['mission', 'coding-agent', 'inspect', 'm1', '--state-root', stateRoot()]);
    expect(out).toContain('Installed runtime:');
    expect(out).toContain('Capabilities:');
    // Every advertised capability is a probe result, so each is YES or NO.
    expect(out).toMatch(/\[(YES|NO )\] supportsLiveExecution/);
    expect(out).toMatch(/\[(YES|NO )\] supportsCancellation/);
  }, PROBES);

  it('stop records a request and preserves work, without claiming termination', async () => {
    const root = stateRoot();
    const store = createNodeCodingAgentStore(root);
    await store.write(idleCodingAgentRecord({ missionId: 'm1', projectId: 'p1', now: NOW }));
    const { out } = await run(['mission', 'coding-agent', 'stop', 'm1', '--state-root', root]);
    expect(out).toContain('Stop requested');
    expect(out).toContain('preserved');
    const read = await store.read('m1');
    expect(read.ok && read.record.cancellationRequested).toBe(true);
    // A request is not a confirmation.
    expect(read.ok && read.record.terminationConfirmed).toBe(false);
  });

  it('stop refuses when no run is recorded', async () => {
    const { out } = await run(['mission', 'coding-agent', 'stop', 'nope', '--state-root', stateRoot()]);
    expect(out).toContain('No Coding Agent run is recorded');
  });

  it('exposes no raw Claude passthrough', async () => {
    const { out } = await run(['mission', 'coding-agent', 'exec', 'm1']);
    expect(out).toContain('requires status, inspect, or stop');
  });

  it('makes no provider call to produce status', async () => {
    // The status path probes --version/--help/auth only; it never runs a model.
    const { code } = await run(['mission', 'coding-agent', 'status', 'm1', '--state-root', stateRoot()]);
    expect(code).toBe(0);
  }, PROBES);
});

/**
 * The receipt a live proof leaves behind. Written by the CLI composition root
 * from OBSERVED facts, read back by the same command the founder runs — so a
 * proof that really happened can be re-read after the terminal is closed.
 */
describe('the live-proof receipt round-trips into the status command', () => {
  it('renders the model the runtime reported, separately from the one requested', async () => {
    const root = stateRoot();
    const store = createNodeCodingAgentStore(root);
    const written = await store.write(
      runtimeRecordFromObservation({
        missionId: 'live-proof-1',
        projectId: 'relay-coding-agent-live-proof',
        requestedRuntime: 'Claude Code',
        requestedModel: 'sonnet',
        adapterId: 'claude-code-local',
        actualRuntime: 'Claude Code',
        actualModel: 'claude-sonnet-4-5-20250929',
        runtimeVersion: '2.1.220',
        launchVerified: true,
        runId: 'run_1',
        sessionRefRedacted: '…abc123',
        capabilities: NO_CAPABILITIES,
        worktreeRef: null,
        startedAt: NOW,
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
        usage: usageFromRuntimeReport({ inputTokens: null, outputTokens: null, reportedCostUsd: null }),
        stopReason: null,
        now: NOW,
      }),
    );
    expect(written.ok).toBe(true);

    const { out } = await run(['mission', 'coding-agent', 'status', 'live-proof-1', '--state-root', root]);
    expect(out).toContain('Claude Code (requested)');
    expect(out).toContain('Actual:       Claude Code');
    expect(out).toContain('Model:        claude-sonnet-4-5-20250929');
    expect(out).toContain('Connection:   Completed');
    expect(out).toContain('Launch:       verified');
    expect(out).toContain('Files:        1 changed');
    expect(out).toContain('Tests:        passed (1 run)');
    // The runtime reported no token usage, so it stays Unknown — not 0.
    expect(out).toContain('Usage:        Unknown');
    // The alias that was requested is never shown as the model that answered.
    expect(out).not.toContain('Model:        sonnet');
  }, PROBES);

  it('a run Relay refused reads back as blocked, never as completed', async () => {
    const root = stateRoot();
    const store = createNodeCodingAgentStore(root);
    await store.write(
      runtimeRecordFromObservation({
        missionId: 'escaped-1',
        projectId: 'relay-coding-agent-live-proof',
        requestedRuntime: 'Claude Code',
        requestedModel: null,
        adapterId: 'claude-code-local',
        actualRuntime: 'Claude Code',
        actualModel: 'claude-sonnet-4-5-20250929',
        runtimeVersion: '2.1.220',
        launchVerified: true,
        runId: 'run_2',
        sessionRefRedacted: '…def456',
        capabilities: NO_CAPABILITIES,
        worktreeRef: null,
        startedAt: NOW,
        endedAt: NOW,
        // The process exited perfectly. Relay still refused the result.
        exitCode: 0,
        signal: null,
        cancellationRequested: false,
        timedOut: false,
        terminationConfirmed: false,
        spawnFailed: false,
        filesChanged: [],
        filesInspected: ['src/normalize.js'],
        commandsStarted: 0,
        commandsCompleted: 0,
        testsRun: 0,
        testStatus: 'not_run',
        outputRefs: [],
        evidenceRefs: [],
        warnings: ['Read: /etc/passwd'],
        usage: usageFromRuntimeReport({ inputTokens: null, outputTokens: null, reportedCostUsd: null }),
        stopReason: 'The Coding Agent reached outside the isolated workspace (1 target(s)).',
        now: NOW,
      }),
    );
    const { out } = await run(['mission', 'coding-agent', 'status', 'escaped-1', '--state-root', root]);
    expect(out).toContain('Connection:   Blocked');
    expect(out).toContain('outside the isolated workspace');
    expect(out).not.toContain('Connection:   Completed');
  }, PROBES);
});
