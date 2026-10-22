import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createFrozenReviewerChecker, type FrozenCheckerRun } from './julius-frozen-checker';

const sha = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
const CHECKER_BYTES = 'checker-bytes';
const LEDGER_BYTES = 'ledger-bytes';
const POSTS_BYTES = 'posts-bytes';
const PIN = sha(CHECKER_BYTES);
const ARTIFACT = '{"a":1}';

interface Calls { args: readonly string[][]; recorded: { exitCode: number | null; stdout: string }[]; cleaned: number }

function make(over: { stdout?: (judged: string) => string; exitCode?: number | null; files?: Record<string, string>; throws?: boolean; ledgerPin?: string } = {}) {
  const calls: Calls = { args: [], recorded: [], cleaned: 0 };
  const files: Record<string, string> = over.files ?? { '/c/checker.mjs': CHECKER_BYTES, '/c/ledger.csv': LEDGER_BYTES, '/c/posts.json': POSTS_BYTES };
  const checker = createFrozenReviewerChecker({
    nodePath: 'node', checkerPath: '/c/checker.mjs', checkerSha256: PIN,
    ledgerPath: '/c/ledger.csv', ledgerSha256: over.ledgerPin ?? sha(LEDGER_BYTES), postsPath: '/c/posts.json', postsSha256: sha(POSTS_BYTES),
    readFileBytes: async (p) => { if (files[p] === undefined) throw new Error('nope'); return new TextEncoder().encode(files[p]); },
    writeArtifact: async () => ({ path: '/tmp/artifact.txt', cleanup: async () => { calls.cleaned += 1; } }),
    run: async (_cmd, args): Promise<FrozenCheckerRun> => {
      calls.args = [...calls.args, [...args]];
      if (over.throws === true) throw new Error('spawn failed');
      const judged = sha(ARTIFACT);
      return { exitCode: over.exitCode === undefined ? 0 : over.exitCode, stdout: (over.stdout ?? ((j: string) => `checker_sha256=${PIN}\njudged_trimmed_sha256=${j}\nPASS\n`))(judged) };
    },
    record: (e) => { calls.recorded.push({ exitCode: e.exitCode, stdout: e.stdout }); },
  });
  return { checker, calls };
}

describe('frozen reviewer checker adapter (fake process only)', () => {
  it('passes only when exit 0, the last line is PASS, the checker sha and the judged hash match; always passes --expect-self-sha256', async () => {
    const { checker, calls } = make();
    const r = await checker.check({ runId: 'r1', artifactText: `  ${ARTIFACT}\n` });
    expect(r.pass).toBe(true);
    expect(calls.args[0]).toEqual(['/c/checker.mjs', '/tmp/artifact.txt', '/c/ledger.csv', '/c/posts.json', '--expect-self-sha256', PIN]);
    expect(calls.recorded[0].exitCode).toBe(0);
    expect(calls.recorded[0].stdout).toContain('PASS');
    expect(calls.cleaned).toBe(1);
  });
  it('refuses when ANY of the checker, ledger or posts bytes differ from their pin, without running', async () => {
    for (const key of ['/c/checker.mjs', '/c/ledger.csv', '/c/posts.json']) {
      const { checker, calls } = make({ files: { '/c/checker.mjs': CHECKER_BYTES, '/c/ledger.csv': LEDGER_BYTES, '/c/posts.json': POSTS_BYTES, [key]: 'tampered' } });
      const r = await checker.check({ runId: 'r1', artifactText: ARTIFACT });
      expect(r.pass, key).toBe(false);
      expect(r.output, key).toMatch(/pin_mismatch/);
      expect(calls.args, key).toHaveLength(0);
    }
    const missing = make({ files: { '/c/checker.mjs': CHECKER_BYTES } });
    expect((await missing.checker.check({ runId: 'r1', artifactText: ARTIFACT })).output).toBe('frozen_checker_ledger_unreadable');
  });
  it('is not a pass on any exit other than 0 even if PASS is printed', async () => {
    for (const exitCode of [1, 2, 3, null]) {
      const { checker } = make({ exitCode });
      expect((await checker.check({ runId: 'r1', artifactText: ARTIFACT })).pass, String(exitCode)).toBe(false);
    }
  });
  it('is not a pass when the last line is not exactly PASS, the checker sha differs, or the judged hash differs', async () => {
    expect((await make({ stdout: (j) => `checker_sha256=${PIN}\njudged_trimmed_sha256=${j}\nFAILED_SECTIONS: records\nFAIL\n` }).checker.check({ runId: 'r', artifactText: ARTIFACT })).pass).toBe(false);
    expect((await make({ stdout: (j) => `checker_sha256=${sha('other')}\njudged_trimmed_sha256=${j}\nPASS\n` }).checker.check({ runId: 'r', artifactText: ARTIFACT })).pass).toBe(false);
    expect((await make({ stdout: () => `checker_sha256=${PIN}\njudged_trimmed_sha256=${sha('different')}\nPASS\n` }).checker.check({ runId: 'r', artifactText: ARTIFACT })).pass).toBe(false);
    expect((await make({ stdout: () => `checker_sha256=${PIN}\nPASS\n` }).checker.check({ runId: 'r', artifactText: ARTIFACT })).pass).toBe(false);
    expect((await make({ stdout: (j) => `checker_sha256=${PIN}\njudged_trimmed_sha256=${j}\nPASS extra\n` }).checker.check({ runId: 'r', artifactText: ARTIFACT })).pass).toBe(false);
  });
  it('a spawn failure is a clean refusal and the temp file is still cleaned', async () => {
    const { checker, calls } = make({ throws: true });
    expect(await checker.check({ runId: 'r', artifactText: ARTIFACT })).toEqual({ pass: false, output: 'frozen_checker_run_failed' });
    expect(calls.cleaned).toBe(1);
  });
  it('returns the exit code and the full stdout as output so the ledger hash covers both', async () => {
    const { checker } = make();
    const r = await checker.check({ runId: 'r', artifactText: ARTIFACT });
    expect(r.output).toMatch(/^exit=0\ncheckerS|^exit=0\nchecker_sha256=/);
  });
  it('construction refuses a malformed pin', () => {
    expect(() => createFrozenReviewerChecker({
      nodePath: 'node', checkerPath: 'c', checkerSha256: 'abc', ledgerPath: 'l', ledgerSha256: sha('l'), postsPath: 'p', postsSha256: sha('p'),
      readFileBytes: async () => new Uint8Array(), writeArtifact: async () => ({ path: 'x', cleanup: async () => undefined }), run: async () => ({ exitCode: 0, stdout: '' }),
    })).toThrow('frozen_checker_checkerSha256_invalid');
  });
});
