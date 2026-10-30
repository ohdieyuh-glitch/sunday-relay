import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { E2_VERIFIER_PATH, isVerifierCommandAllowed, recordVerifierReexec, spawnVerifierRunner } from './e2-evidence-gate';

/* PILOT 43b93a4e N-3 / mutant M9, Skywalker 43b93a4e N3 (trivial verifiers) and the verifier-hang item, failing-first. */
const NODE = process.execPath;
let dir = '';
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (p: string): Promise<number> => { for (let i = 0; i < 100 && !existsSync(p); i += 1) await new Promise((r) => setTimeout(r, 50)); return Number(readFileSync(p, 'utf8')); };
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2r5-')));
  writeFileSync(join(dir, 'ok.mjs'), 'process.stdout.write("ok")\n');
  writeFileSync(join(dir, 'env.mjs'), 'process.stdout.write(process.env.PATH ?? "")\n');
  /* M9: a grandchild in the SAME process group with stdio ignored keeps running after the leader exits. */
  writeFileSync(join(dir, 'straggler.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' }); writeFileSync(process.argv[2], String(c.pid)); c.unref();\n`);
  /* Hang: a grandchild in a NEW session (setsid escape) holds stdout open after the leader exits. */
  writeFileSync(join(dir, 'escape.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }); writeFileSync(process.argv[2], String(c.pid)); c.unref();\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('PILOT N-3: the program allowlist', () => {
  it('allows node with a script file (round 5 R4-1 dropped npx vitest run, npx tsc/tsc --noEmit and npm test)', () => {
    for (const a of [['npx', 'vitest', 'run'], ['npx', 'tsc', '--noEmit'], ['tsc', '--noEmit'], ['npm', 'test']]) expect(isVerifierCommandAllowed(a, dir), a.join(' ')).toBe(false);
    for (const a of [[NODE, join(dir, 'ok.mjs')], ['node', 'ok.mjs']]) {
      expect(isVerifierCommandAllowed(a, dir), a.join(' ')).toBe(true);
    }
    /* 5366ad30 R3-4 / Skywalker M1: git verifiers and `tsc -p .` (no --noEmit) are no longer verifiers. */
    for (const a of [['tsc', '-p', '.'], ['git', 'diff', '--stat'], ['git', 'merge-base', '--is-ancestor', 'a', 'b']]) expect(isVerifierCommandAllowed(a, dir), a.join(' ')).toBe(false);
  });
  it('refuses inline code, wrappers, shells under any spelling, git aliases and trivially-true commands', () => {
    for (const a of [[NODE, '-e', '0'], ['node', '--eval', '0'], ['node', '-p', '1'], ['node', '--input-type=module'], ['node'], ['python', '-c', 'x'], ['python3', 'x.py'], ['perl', '-e', '1'],
      ['timeout', '5', 'node', 'ok.mjs'], ['nice', 'node', 'ok.mjs'], ['setsid', 'node', 'ok.mjs'], ['git', '-c', 'alias.x=!sh', 'x'], ['git', '-C', '/', 'diff'], ['git', '--exec-path=/tmp', 'diff'], ['git', 'x'],
      ['bash.exe', '-c', 'x'], ['sh.exe'], ['powershell.exe'], ['wsl.exe'], ['C:\\Windows\\System32\\cmd.exe'], ['true'], [':'], ['exit', '0'], ['/bin/true'], ['npm', 'run', 'anything'], ['npm', 'test', '--script-shell=/bin/sh'],
      ['npx', 'cowsay'], ['/tmp/evil/node', 'ok.mjs'], ['node', 'missing.mjs']]) {
      expect(isVerifierCommandAllowed(a, dir), a.join(' ')).toBe(false);
    }
  });
  it('node -e stays refused even when a file named -e exists in the cwd', () => {
    writeFileSync(join(dir, '-e'), 'process.exit(0)\n');
    expect(isVerifierCommandAllowed(['node', '-e', '0'], dir)).toBe(false);
    expect(isVerifierCommandAllowed([NODE, '-e'], dir)).toBe(false);
  });
  it('recordVerifierReexec refuses a non-allowlisted command before running anything', async () => {
    let ran = 0;
    const runner = async () => { ran += 1; return { exitCode: 0, stdout: '', stderr: '' }; };
    for (const c of [[['true']], [[':']], [[NODE, '-e', '0']], [['timeout', '1', NODE, 'ok.mjs']]]) expect(await recordVerifierReexec({ commands: c, cwd: dir, runner })).toBeNull();
    expect(ran).toBe(0);
  });
  it('PATH is never taken from options or per-call env', async () => {
    const r = await recordVerifierReexec({ commands: [[NODE, join(dir, 'env.mjs')]], cwd: dir, runner: spawnVerifierRunner({ env: { PATH: '/tmp/evil' } }) });
    expect(r?.commands[0]?.exitCode).toBe(0);
    expect(typeof E2_VERIFIER_PATH).toBe('string');
    expect(r?.commands[0]?.stdoutSha256).toBe(createHash('sha256').update(E2_VERIFIER_PATH).digest('hex'));
    const evil = spawnVerifierRunner();
    const out = await evil([NODE, join(dir, 'env.mjs')], dir, { PATH: '/tmp/evil', Path: '/tmp/evil' });
    expect('stdoutSha256' in out && out.stdoutSha256).toBe(createHash('sha256').update(E2_VERIFIER_PATH).digest('hex'));
  });
});

describe('kill on exit (mutant M9) and the hard deadline', () => {
  it('a same-group grandchild with stdio ignored is dead after the runner resolves', async () => {
    const pidFile = join(dir, 'm9.pid');
    const r = await spawnVerifierRunner({ timeoutMs: 10_000 })([NODE, join(dir, 'straggler.mjs'), pidFile], dir);
    expect(r.exitCode).toBe(0);
    const pid = await waitFor(pidFile);
    await new Promise((res) => setTimeout(res, 100));
    expect(alive(pid)).toBe(false);
  });
  it('a setsid-escaped grandchild holding stdout cannot hang the runner past its deadline', async () => {
    const pidFile = join(dir, 'esc.pid');
    const t0 = Date.now();
    const r = await spawnVerifierRunner({ timeoutMs: 1000 })([NODE, join(dir, 'escape.mjs'), pidFile], dir);
    const pid = await waitFor(pidFile);
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(r.exitCode).toBeNull();
    expect((r as { cause?: string }).cause).toBe('pipes_held_after_exit'); // R3-9: the leader exited; this is the post-exit grace, not the deadline
  }, 15_000);
});

describe('win32 (NOT PROVEN ON WINDOWS: unit-tested with an injected platform only)', () => {
  it('a timeout kills the tree with taskkill /PID <pid> /T /F', async () => {
    const calls: string[][] = [];
    const fakeSpawn = ((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      const c = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; unref: () => void };
      c.pid = 4242; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.unref = () => {};
      return c;
    }) as unknown as typeof import('node:child_process').spawn;
    const r = await spawnVerifierRunner({ timeoutMs: 50, platform: 'win32', spawnImpl: fakeSpawn })([NODE, join(dir, 'ok.mjs')], dir);
    expect(r.exitCode).toBeNull();
    expect(calls.some((c) => c[0]?.toLowerCase().endsWith('taskkill.exe') || c[0] === 'taskkill')).toBe(true);
    expect(calls.find((c) => /taskkill/iu.test(c[0] ?? ''))?.slice(1)).toEqual(['/PID', '4242', '/T', '/F']);
  });
});
