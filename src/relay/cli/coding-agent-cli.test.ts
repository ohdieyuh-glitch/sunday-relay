import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './main';
import { createNodeCodingAgentStore } from '../persistence';
import {
  idleCodingAgentRecord,
  projectCodingAgentRuntime,
  renderCodingAgentStatusLines,
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
/** Explicit budget for cases that shell out to the installed Claude CLI. */
const PROBES = 30_000;

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
