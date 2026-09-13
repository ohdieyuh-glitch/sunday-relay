import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { discoverJuliusPythonExecutable } from '../src/relay/workspace/julius-tools/python-runner';

/**
 * THE BRAIN + PYTHON DRILL, RUN FOR REAL: separate processes, a real PostgreSQL
 * (optionally restarted), cross-process cancellation and a crashed host.
 * Needs `JULIUS_REAL_POSTGRES=1`, `DATABASE_URL` and a CPython 3.11+; otherwise
 * it is reported todo, never green.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1')
  && (process.env.DATABASE_URL ?? '') !== '' && discoverJuliusPythonExecutable() !== null;
const suite = enabled ? describe : describe.todo;
const run = promisify(execFile);

suite('the Brain + Python drill across processes', () => {
  it('reconstructs the mission after a restart, cancels across processes, and settles a crashed host DISCONNECTED', async () => {
    const database = `jbpyflow${Date.now().toString(36)}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try { await admin.query(`CREATE DATABASE ${database}`); } finally { await admin.end(); }
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database}`;
    await run('npm', ['run', 'julius:brain:python-drill:build', '--silent'], { shell: process.platform === 'win32', timeout: 180_000 });
    const out = await run(process.execPath, ['dist-relay-bridge/julius-brain-python-flow-drill.cjs'], {
      env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
    }).catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`drill failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); });
    expect(out.stdout).toContain('JULIUS BRAIN + PYTHON DRILL VERIFIED');
    const report = JSON.parse(out.stdout.slice(0, out.stdout.lastIndexOf('JULIUS BRAIN + PYTHON DRILL')));
    expect(report.checks).toEqual({ separateProcesses: true, identicalReconstruction: true, serverRestartHonest: true, crossProcessCancel: true, hostCrash: true });
    expect(report.restart).toBe(process.env.JULIUS_BRAIN_DRILL_RESTART ? 'POSTGRESQL SERVER RESTART' : 'PROCESS RESTART ONLY');
  }, 1_000_000);
});
