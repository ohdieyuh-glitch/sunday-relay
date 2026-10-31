/* Round 4 R3-9: the runner resolves close to its deadline even when an escaped grandchild holds the pipes. */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { spawnVerifierRunner } from './e2-evidence-gate';

let dir = '';
const kill = (p: string): void => { try { if (existsSync(p)) process.kill(Number(readFileSync(p, 'utf8')), 'SIGKILL'); } catch { /* gone */ } };
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2-dl-r9-')));
  /* argv[2] pid file, argv[3] ms the leader lingers before exiting; the setsid-escaped grandchild holds stdout. */
  writeFileSync(join(dir, 'late.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }); writeFileSync(process.argv[2], String(c.pid)); c.unref();
setTimeout(() => {}, Number(process.argv[3]));\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('R3-9 deadline', () => {
  it('a leader exiting at ~1200 ms with timeoutMs 1500 resolves near 1500 ms, not deadline + grace', async () => {
    const pid = join(dir, 'p1');
    const t = Date.now();
    try {
      const r = await spawnVerifierRunner({ timeoutMs: 1500 })(['node', 'late.mjs', pid, '1200'], dir);
      const took = Date.now() - t;
      expect(r.exitCode).toBeNull();
      /* deadline and clamped grace fire at the same instant: either cause is a correct report. */
      expect(['timeout', 'pipes_held_after_exit']).toContain('cause' in r ? r.cause : null);
      expect(took).toBeLessThan(2300);
    } finally { kill(pid); }
  });
  it('a leader exiting at once with held pipes resolves after the short grace with its own cause', async () => {
    const pid = join(dir, 'p2');
    const t = Date.now();
    try {
      const r = await spawnVerifierRunner({ timeoutMs: 20000 })(['node', 'late.mjs', pid, '0'], dir);
      const took = Date.now() - t;
      expect(r.exitCode).toBeNull();
      expect('cause' in r ? r.cause : null).toBe('pipes_held_after_exit');
      expect(took).toBeLessThan(1600);
    } finally { kill(pid); }
  });
});
