import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './main';
import { createNodeReviewerHarnessStore } from '../persistence';
import {
  idleHarnessRecord, projectReviewerHarness, renderReviewerStatusLines,
} from '../mission';

/** The Reviewer CLI: catalog truth, read-only status, and a recorded stop
    request. No harness passthrough, zero provider calls. */

const roots: string[] = [];
const stateRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-rev-'));
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

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runCli(args, {
    out: (line: string) => lines.push(line),
    isTTY: false,
    env: { ...process.env, NO_COLOR: '1' } as NodeJS.ProcessEnv,
  });
  return { code, out: lines.join('\n') };
}

describe('relay reviewer harnesses', () => {
  it('lists every catalog entry with a truthful status and no Connected', async () => {
    const { out } = await run(['reviewer', 'harnesses']);
    for (const name of ['Hermes', 'Buzz Agent / Buzz ACP', 'Vellum', 'TrustClaw',
      'PicoClaw', 'ZeroClaw', 'Agent Zero']) {
      expect(out).toContain(name);
    }
    expect(out).toContain('Coming soon');
    expect(out).toContain('Experimental');
    expect(out).not.toContain('Connected');
    // Exactly ONE entry claims an adapter — the harness Relay implements.
    expect(out.match(/adapter:     available/g) ?? []).toHaveLength(1);
    expect(out.match(/adapter:     none/g) ?? []).toHaveLength(6);
    // Installation is a probe result the CLI catalog never asserts statically.
    expect(out).not.toContain('installed:   installed');
    expect(out).toContain('capabilities: none verified');
    // And nothing is startable from static catalog data alone.
    expect(out).not.toContain('startable:   yes');
    expect(out.match(/startable:   no/g) ?? []).toHaveLength(7);
  });

  it('refuses an unknown reviewer action rather than guessing', async () => {
    const { out } = await run(['reviewer', 'launch']);
    expect(out).toContain('reviewer requires an action: harnesses or pair-browser.');
  });
});

describe('relay mission reviewer', () => {
  it('reports no review without claiming a harness or a verdict', async () => {
    const { out } = await run(['mission', 'reviewer', 'status', 'm1', '--state-root', stateRoot()]);
    expect(out).toContain('REVIEWER — m1');
    expect(out).toContain('Harness:      Unknown');
    expect(out).toContain('Model:        Unknown');
    expect(out).toContain('Validated:    Not determined');
    expect(out).toContain('Independence: Unknown');
    expect(out).not.toContain('Connected');
  });

  it('matches the website projection line for line', async () => {
    const root = stateRoot();
    const store = createNodeReviewerHarnessStore(root);
    const written = await store.write(
      idleHarnessRecord({ missionId: 'm1', projectId: 'p1', missionContractRef: 'c1', now: NOW }),
    );
    expect(written.ok).toBe(true);
    const { out } = await run(['mission', 'reviewer', 'status', 'm1', '--state-root', root]);
    const expected = renderReviewerStatusLines(
      'm1', projectReviewerHarness(written.record ?? null, { bridgeAvailable: false }),
    );
    for (const line of expected) expect(out).toContain(line.trim());
  });

  it('inspect explains why independence is unknown', async () => {
    const root = stateRoot();
    const store = createNodeReviewerHarnessStore(root);
    await store.write(idleHarnessRecord({ missionId: 'm1', projectId: 'p1', missionContractRef: 'c1', now: NOW }));
    const { out } = await run(['mission', 'reviewer', 'inspect', 'm1', '--state-root', root]);
    expect(out).toContain('Independence reasons:');
    expect(out).toContain('no reviewer identity evidence has been recorded');
  });

  it('stop records a request and preserves findings', async () => {
    const root = stateRoot();
    const store = createNodeReviewerHarnessStore(root);
    await store.write(idleHarnessRecord({ missionId: 'm1', projectId: 'p1', missionContractRef: 'c1', now: NOW }));
    const { out } = await run(['mission', 'reviewer', 'stop', 'm1', '--state-root', root]);
    expect(out).toContain('Stop requested');
    expect(out).toContain('preserved');
    const read = await store.read('m1');
    expect(read.ok && read.record.cancellationRequested).toBe(true);
    // A request is not a confirmation.
    expect(read.ok && read.record.cancellationConfirmed).toBe(false);
  });

  it('exposes no harness passthrough', async () => {
    const { out } = await run(['mission', 'reviewer', 'exec', 'm1']);
    expect(out).toContain('requires status, inspect, stop, test-connection, start, or retry');
  });
});
