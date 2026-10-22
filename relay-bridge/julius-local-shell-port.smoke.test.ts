import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { juliusAttemptCloseCommand, juliusAttemptStartCommand, parseJuliusAttemptClose, parseJuliusAttemptStart } from './julius/coder-workspace';
import { realJ1WiringDeps } from './julius-dispatch-wiring-real';

/** NO-SPEND REAL-SPAWN SMOKE of the local shell port: bash + git only, in a temp dir, no provider, no network. */
const MISSION = resolve(__dirname, 'julius-inworld-mission', 'julius-inworld-data-1');
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const seed = (name: 'data/legacy_ledger.csv' | 'data/posts.json' | 'format.test.mjs', rel: string) => {
  const bytes = new Uint8Array(readFileSync(join(MISSION, rel)));
  return { name, bytes, sha256: sha(bytes) };
};

// Opt-in only (spawns bash + git in a temp dir; no provider, no network): J1_REAL_SMOKE=1 npx vitest run relay-bridge/julius-local-shell-port.smoke.test.ts
describe.skipIf(process.env.J1_REAL_SMOKE !== '1')('local shell port: real bash + git smoke (no spend)', () => {
  it('seeds, starts, observes a coder-style Edit of the placeholder, and closes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'j1-smoke-'));
    const out: string[] = [];
    try {
      const deps = realJ1WiringDeps((l) => out.push(l), Date.now, { PATH: process.env.PATH });
      const port = deps.shellFor!({ workspacePath: cwd, bashPath: process.env.J1_BASH_PATH ?? 'C:/Program Files/Git/bin/bash.exe', seedFiles: [seed('data/legacy_ledger.csv', 'seed/data/legacy_ledger.csv'), seed('data/posts.json', 'seed/data/posts.json'), seed('format.test.mjs', 'seed/format.test.mjs')] });
      const req = (command: string) => ({ runId: 'r', projectId: 'p', taskId: 't', workerId: 'w', invocationKey: `k${Math.random()}`, command, timeoutMs: 60_000 });
      const start = await port.run(req(juliusAttemptStartCommand(null)));
      out.push(`START status=${start.status} exit=${String(start.exitCode)} stdout=${JSON.stringify(start.stdout.slice(0, 200))} stderr=${JSON.stringify(start.stderr.slice(0, 300))}`);
      expect(start.status).toBe('SUCCEEDED');
      const trees = parseJuliusAttemptStart(start.stdout, null);
      expect(trees.baseTree).not.toBeNull();
      // the placeholder is on disk and is the two bytes {}
      expect(readFileSync(join(cwd, 'out', 'normalized.json'), 'utf8')).toBe('{}');
      // a coder-style Edit
      writeFileSync(join(cwd, 'out', 'normalized.json'), '{"schema":"inworld-ledger.v1"}');
      const close = await port.run(req(juliusAttemptCloseCommand({ baseTree: trees.baseTree!, startTree: trees.startTree! })));
      out.push(`CLOSE status=${close.status} exit=${String(close.exitCode)} stderr=${JSON.stringify(close.stderr.slice(0, 300))}`);
      expect(close.status).toBe('SUCCEEDED');
      const parsed = parseJuliusAttemptClose(close.stdout, true);
      out.push(`CLOSE parsed changes=${JSON.stringify(parsed.status.changes)}`);
      expect(parsed.status.changes.length).toBe(1);
      // an arbitrary command is refused and nothing runs
      const bad = await port.run(req('echo hello > /tmp/j1-should-not-exist'));
      out.push(`REFUSE status=${bad.status} stderr=${bad.stderr}`);
      expect(bad.status).toBe('FAILED');
      expect(bad.stderr).toContain('command_not_allowed');
    } finally {
      writeFileSync(join(tmpdir(), 'j1-smoke-report.txt'), out.join('\n'));
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}.home`, { recursive: true, force: true });
    }
  });
});
