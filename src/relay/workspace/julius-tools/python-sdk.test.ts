import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from './python-runner';

/**
 * The Python SDK's own unit tests, run as part of the ordinary suite so a
 * change to the SDK cannot land green in TypeScript and red in Python. Reports
 * todo without a CPython 3.11+, never a pass.
 */
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();
const suite = python !== null && sdkRoot !== null ? describe : describe.todo;

suite('the Julius Python SDK', () => {
  it('passes its unit tests (python -m unittest discover -s relay-python/tests)', () => {
    const run = spawnSync(python!, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], { cwd: sdkRoot!, encoding: 'utf8', timeout: 120_000, windowsHide: true });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/Ran \d+ tests/);
    expect(output).toContain('OK');
  }, 150_000);
});
