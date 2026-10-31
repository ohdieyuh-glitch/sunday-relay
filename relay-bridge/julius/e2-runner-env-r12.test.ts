/* Round 7 (PILOT R6-2 follow-up). Regression guard, not a fix: the env was already a key allowlist (E2_VERIFIER_ENV_KEYS); the trusted runner's environment can never carry NODE_TEST_CONTEXT (or any NODE_TEST_*)
   into a verifier, whatever the caller passes; with it a plain run would speak node's child-v8 protocol. */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2r12env-')));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
describe('runner env', () => {
  it('drops NODE_TEST_* from the options env and the per-call env', async () => {
    writeFileSync(join(dir, 'p.mjs'), "process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => k.startsWith('NODE_TEST'))));\n");
    const runner = G.spawnVerifierRunner({ timeoutMs: 20_000, env: { NODE_TEST_CONTEXT: 'child-v8', NODE_TEST_X: '1', KEEP: '1' } });
    const r = await runner(['node', 'p.mjs'], dir, { NODE_TEST_CONTEXT: 'child' });
    expect('stdoutTail' in r ? r.stdoutTail : null).toBe('[]');
    expect(G.E2_VERIFIER_ENV_KEYS.some((k) => k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS')).toBe(false);
  });
});
