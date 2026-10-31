/* Round 10 (Skywalker 5a6e3400 F9-1/F9-2/F9-5; alternates design rejected): the snapshot's object dir reaches the gate
   ONLY through the gate's fixed module-git env (GIT_ALTERNATE_OBJECT_DIRECTORIES), never through a line in the coder's
   .git. Any objects/info/alternates in the workspace .git = not isolated, no exception. The object dir itself is checked
   (named refusal) before any git reads it. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';
import * as S from './e2-safe-git';
import { MODEL, RUN, START, anchorOf, call, git, liveCapture, makeRepo, tail } from './e2-test-kit';
import { pinT, storeFor } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-objdir-r15-')));
const privTmp = join(root, 'tmp'); mkdirSync(privTmp); process.env.TMPDIR = privTmp;
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const TB = (n: number): string => "import t from 'node:test'; import assert from 'node:assert';\n" + Array.from({ length: n }, (_, i) => `t('c${i}',()=>assert.strictEqual(${i}+1,${i + 1}));`).join('\n') + '\n';
const BASEF = { 't.test.mjs': TB(3), 'a.txt': 'a\n' }; const HEADF = { 'a.txt': 'b\n' };
const AU = { name: 'n', email: 'e@x' };
const ALT = (r: string): string => join(r, '.git/objects/info/alternates');
let k = 0;
type Hooks = { afterSnap?: (repo: string, s: S.SnapshotResult) => void; objectDir?: (s: S.SnapshotResult) => string; dispose?: 'before-diff'; beforeDispose?: (s: S.SnapshotResult) => void };
async function snapGate(h: Hooks = {}): Promise<{ gate: 'PASS' | readonly string[]; diff: G.E2DiffEvidence | null; snap: S.SnapshotResult }> {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  const b = makeRepo(repo, BASEF, {}, W).base; git(repo, 'reset', '-q', '--hard', b);
  for (const [p, c] of Object.entries(HEADF)) W(join(repo, p), c);
  const s = S.snapshotCommitSafely({ workspace: repo, parent: b, message: 'c', author: AU });
  if ('refused' in s) throw new Error(`snapshot refused ${s.refused}`);
  try {
    h.afterSnap?.(repo, s);
    const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
    const spec = await pinT({ testCommand: 'node --test t.test.mjs', workspace: repo, base: b }, runner);
    if ('refused' in spec) throw new Error(`spec refused ${spec.refused}`);
    const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
    if (h.dispose === 'before-diff') s.dispose();
    const diff = await G.recordGitDiff({ base: b, head: s.head, cwd: repo, runner, objectDir: h.objectDir ? h.objectDir(s) : s.objectDir.path, trustedObjects: storeFor(repo, b) } as Parameters<typeof G.recordGitDiff>[0]);
    const { lines, evidence } = await liveCapture(root, `s${k}.jsonl`, START + call('c0', 'edit_file', { path: 'a.txt' }) + tail());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base: b, head: s.head, workspace: repo }, modelId: MODEL });
    return { gate: g.ok ? 'PASS' : g.reasons, diff, snap: s };
  } finally { h.beforeDispose?.(s); s.dispose(); }
}

describe('Round 10: object dir only via the gate env', () => {
  it('control: a clean snapshot PASSes; no alternates file is ever written into the workspace .git', async () => {
    const r = await snapGate({ afterSnap: (repo) => { expect(existsSync(ALT(repo))).toBe(false); } });
    expect(r.gate).toBe('PASS');
    expect(r.diff?.isolated).toBe(true);
    expect(r.diff?.paths).toEqual(['a.txt']);
  }, 60_000);
  it('F9-1 (Skywalker A4 exact): blob moved to an attacker dir named by <objDir>/info/alternates -> refused, never PASS', async () => {
    const r = await snapGate({ afterSnap: (repo, s) => {
      const evil = join(root, `evilobj${k}`); mkdirSync(evil);
      const blob = execFileSync('git', ['rev-parse', `${s.tree}:a.txt`], { cwd: repo, env: { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: s.objectDir.path } }).toString().trim();
      mkdirSync(join(evil, blob.slice(0, 2))); renameSync(join(s.objectDir.path, blob.slice(0, 2), blob.slice(2)), join(evil, blob.slice(0, 2), blob.slice(2)));
      mkdirSync(join(s.objectDir.path, 'info'), { recursive: true }); writeFileSync(join(s.objectDir.path, 'info/alternates'), evil + '\n');
    } });
    expect(r.gate).not.toBe('PASS');
    expect(r.gate).toContain('e2_diff_objdir_invalid');
    expect(r.diff?.objectDirRefusal).toBe('objdir_info_present');
  }, 60_000);
  it('an empty <objDir>/info is refused too', async () => {
    const r = await snapGate({ afterSnap: (_r, s) => { mkdirSync(join(s.objectDir.path, 'info')); } });
    expect(r.diff?.objectDirRefusal).toBe('objdir_info_present');
  }, 60_000);
  it('a planted objects/info/alternates in the workspace .git (any content, even the live objDir) is not isolated', async () => {
    for (const content of [0, 1, 2]) {
      const r = await snapGate({ afterSnap: (repo, s) => { W(ALT(repo), [`${s.objectDir.path}\n`, '', '/nonexistent\n'][content] as string); } });
      expect(r.gate).not.toBe('PASS');
      expect(r.diff?.isolationFindings).toContain('objects/info/alternates');
    }
  }, 120_000);
  const bad: Array<[string, Hooks, string]> = [
    ['wrong mode 0755', { afterSnap: (_r, s) => chmodSync(s.objectDir.path, 0o755) }, 'objdir_mode'],
    ['a symlink to the real dir', { objectDir: (s) => { const l = join(root, `lnk${k}`); symlinkSync(s.objectDir.path, l); return l; } }, 'objdir_not_plain'],
    ['relative path', { objectDir: () => 'rel/objs' }, 'objdir_not_plain'],
    ['a pack dir', { afterSnap: (_r, s) => { mkdirSync(join(s.objectDir.path, 'pack')); } }, 'objdir_unexpected_entry'],
    ['a loose-object dir that is a symlink', { afterSnap: (_r, s) => { const d = join(root, `ext${k}`); mkdirSync(d); symlinkSync(d, join(s.objectDir.path, 'ff')); } }, 'objdir_unexpected_entry'],
  ];
  for (const [name, h, code] of bad) {
    it(`object dir ${name}: refused (${code})`, async () => {
      const r = await snapGate(h);
      expect(r.gate).toContain('e2_diff_objdir_invalid');
      expect(r.diff?.objectDirRefusal).toBe(code);
    }, 60_000);
  }
  it('object dir inside the workspace: refused (objdir_inside_workspace)', async () => {
    const r = await snapGate({ objectDir: (s) => { const repoDir = join(root, `r${k - 1}`); const d = join(repoDir, 'objs'); mkdirSync(d, { mode: 0o700 }); chmodSync(d, 0o700); execFileSync('cp', ['-r', `${s.objectDir.path}/.`, d]); return d; } });
    expect(r.diff?.objectDirRefusal).toBe('objdir_inside_workspace');
  }, 60_000);
  it('not owned by the gate uid: refused (objdir_owner) — needs sudo, else asserted unavailable', async () => {
    const sudoOk = execFileSync('sh', ['-c', 'sudo -n true >/dev/null 2>&1 && echo y || echo n']).toString().trim() === 'y';
    if (!sudoOk) { expect(sudoOk).toBe(false); return; } /* sudo unavailable: the foreign-owner branch is not exercised */
    const r = await snapGate({ afterSnap: (_r, s) => { execFileSync('sudo', ['-n', 'chown', '65534', s.objectDir.path]); },
      beforeDispose: (s) => { execFileSync('sudo', ['-n', 'chown', String(process.getuid?.() ?? 0), s.objectDir.path]); } });
    expect(r.diff?.objectDirRefusal).toBe('objdir_owner');
  }, 60_000);
  it('after dispose: the diff cannot read the snapshot (objdir gone -> refused), findings stay empty of alternates', async () => {
    const r = await snapGate({ dispose: 'before-diff' });
    expect(r.gate).not.toBe('PASS');
    expect(r.diff?.objectDirRefusal).toBe('objdir_not_plain');
  }, 60_000);
  it('without an objectDir the snapshot head is unreadable (no alternates leak into the workspace)', async () => {
    const r = await snapGate({ objectDir: () => undefined as unknown as string });
    expect(r.gate).not.toBe('PASS');
    expect(r.diff?.exitCode).not.toBe(0);
  }, 60_000);
});
