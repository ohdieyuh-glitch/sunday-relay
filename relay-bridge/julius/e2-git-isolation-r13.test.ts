/* Round 8 (Skywalker ba9ee244 R7-2, R7-4), through the FULL gate: grafts, replace refs, alternates and shallow must not
   forge ancestry or go unrecorded; a worktree .gitattributes (untracked) must not change the recorded patch. */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as G from './e2-evidence-gate';
import { MODEL, RUN, START, anchorOf, call, git, liveCapture, makeRepo, tail } from './e2-test-kit';
import { pinT, recordGitDiffT } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-iso13-')));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const TB = "import t from 'node:test'; import a from 'node:assert'; \nt('one', () => a.strictEqual(1, 1));\n";
const BASEF = { 'a.js': 'function a(){\n return 1;\n}\n'.repeat(5), 't.test.mjs': TB };
const HEADF = { 'a.js': 'function a(){\n return 2;\n}\n'.repeat(5) };
let k = 0;
async function gate(o: { head2?: (r: string, b: string) => string; hook?: (r: string) => void } = {}) {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  let { base, head } = makeRepo(repo, BASEF, HEADF, W);
  if (o.head2) head = o.head2(repo, base);
  o.hook?.(repo);
  const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
  const spec = await pinT({ testCommand: 'node --test t.test.mjs', workspace: repo, base }, runner);
  if ('refused' in spec) return { refused: spec.refused, diff: null };
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const diff = await recordGitDiffT({ base, head, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `s${k}.jsonl`, START + call('c0', 'edit_file', { path: 'a.js' }) + tail());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, diff };
}
const orphan = (r: string): string => { git(r, 'checkout', '-q', '--orphan', 'o'); git(r, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'orphan'); return git(r, 'rev-parse', 'HEAD'); };

describe('R7-2: ancestry cannot be forged and history rewrites are refused', () => {
  it('control: a clean head passes; an orphan head is not a descendant', async () => {
    expect((await gate()).reasons).toEqual([]);
    expect((await gate({ head2: (r) => orphan(r) })).reasons).toContain('e2_diff_not_descendant');
  }, 60_000);
  it('.git/info/grafts claiming base as the orphan parent: not a descendant, and refused as not isolated', async () => {
    const r = await gate({ head2: (repo, b) => { const h = orphan(repo); W(join(repo, '.git/info/grafts'), `${h} ${b}\n`); return h; } });
    expect(r.reasons).toContain('e2_diff_not_descendant');
    expect(r.reasons).toContain('e2_diff_not_isolated');
    expect(r.diff?.ancestry).toBe(false);
  }, 60_000);
  it('a replace ref (git replace --graft) is ignored and refused', async () => {
    const r = await gate({ head2: (repo, b) => { const h = orphan(repo); git(repo, 'replace', '--graft', h, b); return h; } });
    expect(r.reasons).toContain('e2_diff_not_descendant');
    expect(r.reasons).toContain('e2_diff_not_isolated');
  }, 60_000);
  it('objects/info/alternates present: refused as not isolated', async () => {
    const other = join(root, 'alt'); mkdirSync(other); git(other, 'init', '-q');
    const r = await gate({ hook: (repo) => W(join(repo, '.git/objects/info/alternates'), `${join(other, '.git/objects')}\n`) });
    expect(r.reasons).toContain('e2_diff_not_isolated');
  }, 60_000);
  it('.git/shallow present: refused as not isolated', async () => {
    const r = await gate({ hook: (repo) => W(join(repo, '.git/shallow'), `${git(repo, 'rev-parse', 'HEAD~1')}\n`) });
    expect(r.reasons).toContain('e2_diff_not_isolated');
  }, 60_000);
});

describe('R7-4: worktree .gitattributes cannot change the recorded patch, and is recorded', () => {
  it('`* -diff`, `a.js binary` and `* diff=x` in an untracked .gitattributes leave the diff sha unchanged', async () => {
    const clean = await gate();
    for (const attrs of ['* -diff\n', 'a.js binary\n', '* diff=x\n', 'sub/x -diff\n']) {
      const r = await gate({ hook: (repo) => { W(join(repo, '.gitattributes'), attrs); W(join(repo, 'sub/.gitattributes'), attrs); } });
      expect(r.diff?.sha256, attrs).toBe(clean.diff?.sha256);
      expect(r.diff?.attributeFiles, attrs).toEqual(['.gitattributes', 'sub/.gitattributes']);
    }
    expect(clean.diff?.attributeFiles).toEqual([]);
  }, 120_000);
});

describe('Round 8 mutation kills: every isolation finding is recorded', () => {
  it('info/attributes, http-alternates and a packed-refs replace entry each give e2_diff_not_isolated', async () => {
    const cases: Array<[string, (repo: string) => void]> = [
      ['info/attributes', (repo) => W(join(repo, '.git/info/attributes'), '* -diff\n')],
      ['objects/info/http-alternates', (repo) => W(join(repo, '.git/objects/info/http-alternates'), 'http://x/\n')],
      ['packed-refs:refs/replace', (repo) => W(join(repo, '.git/packed-refs'), `# pack-refs with: peeled\n${git(repo, 'rev-parse', 'HEAD')} refs/replace/${git(repo, 'rev-parse', 'HEAD~1')}\n`)],
    ];
    for (const [finding, hook] of cases) {
      const r = await gate({ hook });
      expect(r.diff?.isolationFindings, finding).toEqual([finding]);
      expect(r.reasons, finding).toContain('e2_diff_not_isolated');
    }
  }, 120_000);
});
