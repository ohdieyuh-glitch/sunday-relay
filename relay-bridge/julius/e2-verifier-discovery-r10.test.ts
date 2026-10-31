/* Round 5, Skywalker 44c062b9 M1/M2: bare `node --test` (5 real missions) is mapped to the test files TRACKED AT BASE
   (node's default discovery patterns), each pinned; files the coder adds are not run; a changed base test is pin_changed. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { makeRepo } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r10d-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const T = "import test from 'node:test'; test('x', () => {});\n";

describe('M1/M2: bare node --test runs only the base-tracked test set', () => {
  it('maps to the base files, pins them, ignores coder-added tests and node_modules', async () => {
    const repo = join(root, 'd'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'a.txt': '1\n', 'x.test.mjs': T, 'test/y.mjs': "import test from 'node:test'; test('y', () => {});\n", 'lib/z_test.mjs': T, 'src/plain.js': '1;\n', 'node_modules/q/w.test.mjs': T },
      { 'a.txt': '2\n', 'new.test.mjs': "import t from 'node:test'; t('evil', () => {});\n" }, W);
    const spec = G.pinVerifierSpec({ testCommand: 'node --test', workspace: repo, base }) as G.E2VerifierSpec;
    expect('refused' in spec).toBe(false);
    expect(spec.commands).toEqual([['node', '--test', '--test-reporter=tap', 'lib/z_test.mjs', 'test/y.mjs', 'x.test.mjs']]);
    expect(spec.minTests).toEqual([3]);
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const ev = await G.recordVerifierReexec({ spec, cwd: repo, runner });
    expect(ev?.commands[0]?.testSummary).toEqual({ tests: 3, pass: 3, fail: 0 });
    W(join(repo, 'x.test.mjs'), 'process.exit(0)\n');
    expect((await G.recordVerifierReexec({ spec, cwd: repo, runner }))?.refusal).toBe('pin_changed');
  }, 60_000);
  it('a base with no test files is refused with a name', () => {
    const repo = join(root, 'e'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'a.txt': '1\n' }, { 'a.txt': '2\n' }, W);
    expect(G.pinVerifierSpec({ testCommand: 'node --test', workspace: repo, base })).toEqual({ refused: 'spec_file_not_at_base' });
  });
});
