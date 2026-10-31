/* Round 7 R6-7 (Skywalker 70f96cfe): the workspace's own .git/config is coder-writable (live-workspace.sh chmods .git
   a+rwX). Every gate git call now pins core.hooksPath, core.fsmonitor, core.sshCommand and protocol.allow, on top of
   --no-ext-diff / --no-textconv; a malicious config (fsmonitor, hooksPath, diff driver + textconv, external diff,
   sshCommand) must execute nothing during the gate's git calls. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { makeRepo } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r12g-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('R6-7: gate git calls ignore a malicious workspace .git/config', () => {
  it('e2GitPins carries the four execution pins', () => {
    const p = G.e2GitPins(root).join(' ');
    for (const k of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.sshCommand=/bin/false', 'protocol.allow=never']) expect(p).toContain(`-c ${k}`);
  });
  it('fsmonitor, hooks, diff driver/textconv, external diff and sshCommand run nothing during spec, base run and diff', async () => {
    const repo = join(root, 'r'); mkdirSync(repo);
    const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 't.test.mjs': "import t from 'node:test'; t('x', () => {});\n" }, { 'a.txt': '2\n' }, W);
    const marker = join(root, 'PWNED');
    const evil = join(root, 'evil.sh');
    writeFileSync(evil, `#!/bin/sh\necho "$0 $*" >> ${marker}\nexit 0\n`); chmodSync(evil, 0o755);
    const hooks = join(root, 'hooks'); mkdirSync(hooks);
    for (const h of ['post-checkout', 'pre-commit', 'post-index-change', 'reference-transaction', 'fsmonitor-watchman']) { writeFileSync(join(hooks, h), `#!/bin/sh\n${evil} hook-${h}\n`); chmodSync(join(hooks, h), 0o755); }
    appendFileSync(join(repo, '.git/config'), `[core]\n\tfsmonitor = ${evil}\n\thooksPath = ${hooks}\n\tsshCommand = ${evil}\n\tpager = ${evil}\n[diff]\n\texternal = ${evil}\n[diff "evil"]\n\ttextconv = ${evil}\n\tcommand = ${evil}\n`);
    writeFileSync(join(repo, '.git/info/attributes'), '* diff=evil\n');
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base }, runner);
    expect('refused' in spec).toBe(false);
    const diff = await G.recordGitDiff({ base, head, cwd: repo, runner });
    expect(diff).not.toBeNull();
    expect(existsSync(marker) ? 'executed' : 'clean').toBe('clean');
  }, 60_000);
});
