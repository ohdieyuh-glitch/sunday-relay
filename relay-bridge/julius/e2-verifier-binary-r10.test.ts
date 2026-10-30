/* Round 5 R4-1 (PILOT 44c062b9): a coder-committed node_modules/.bin/vitest must never run as a julius_observed verifier.
   Choice: npm/npx/tsc forms are DROPPED (the resolved binary lives in untracked node_modules, which cannot be pinned to
   base); only `node <file>` and `node --test <files>` remain. A diff touching node_modules is e2_verifier_binary_untrusted. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r10b-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('R4-1: coder-committed binaries', () => {
  it('PILOT world: npx vitest run / npm test / npm run test / tsc are refused at spec time and the coder binary never runs; the full gate refuses', async () => {
    const repo = join(root, 'nm'); mkdirSync(repo);
    const mark = join(root, 'mark');
    const { base, head } = makeRepo(repo, { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }), 'a.txt': '1\n', 't.test.js': "require('node:test')('x', () => {});\n" },
      { 'a.txt': '2\n', 'node_modules/.bin/vitest': `#!/bin/sh\necho ran > ${mark}\nexit 0\n`, 'node_modules/.bin/tsc': `#!/bin/sh\necho ran > ${mark}\nexit 0\n` }, W);
    chmodSync(join(repo, 'node_modules/.bin/vitest'), 0o755); chmodSync(join(repo, 'node_modules/.bin/tsc'), 0o755);
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    for (const tc of ['npx vitest run', 'npm test', 'npm run test', 'npx tsc --noEmit', 'tsc --noEmit']) {
      expect(G.pinVerifierSpec({ testCommand: tc, workspace: repo, base }), tc).toEqual({ refused: 'spec_program_untrusted' });
      expect(G.isVerifierCommandAllowed(tc.split(' '), repo), tc).toBe(false);
      const r = await runner(tc.split(' '), repo);
      expect('cause' in r ? r.cause : null, tc).toBe('refused');
    }
    expect(existsSync(mark)).toBe(false);
    /* Full gate on the same world with a legal node --test spec: the diff adds node_modules, so the verifier is untrusted. */
    const verifierSpec = G.pinVerifierSpec({ testCommand: 'node --test t.test.js', workspace: repo, base }) as G.E2VerifierSpec;
    expect('refused' in verifierSpec).toBe(false);
    const p = { verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }), diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL };
    const { lines, evidence } = await liveCapture(root, 'nm.jsonl', GOOD());
    const g = G.e2Gate({ streamLines: lines, anchor: G.externalAnchor('workflow_output', evidence.finalHash), ...p });
    expect(g.ok).toBe(false);
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_binary_untrusted');
    expect(existsSync(mark)).toBe(false);
  });
});
