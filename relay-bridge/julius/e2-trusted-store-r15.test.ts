/* Round 10 (Skywalker 5a6e3400 amendment + PILOT R9-1): the TRUSTED SEED STORE design. A gate-owned object store is built
   from the mission seed before any coder code runs. The spec pin, the base run and the base side of every diff read only
   that store; the head side is only the snapshot's throwaway dir. The coder's .git/objects is never a source or an
   alternate for a gate git call, so planted or corrupted coder objects cannot change the recorded bytes, and a
   coder-made commit is never evidence. Each variant has a control: the recorded diff is byte-for-byte the honest diff. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';
import * as S from './e2-safe-git';
import { MODEL, RUN, START, anchorOf, call, git, liveCapture, makeRepo, tail } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-trusted-r15-')));
const privTmp = join(root, 'tmp'); mkdirSync(privTmp); process.env.TMPDIR = privTmp;
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const AU = { name: 'n', email: 'e@x' };
/* The pinned test asserts out.txt === 'GOOD\n' (Skywalker's r91 shape); base out.txt = OLD. */
const PINNED = "import test from 'node:test'; import assert from 'node:assert'; import { readFileSync } from 'node:fs';\n"
  + [0, 1, 2].map((i) => `test('c${i}',()=>assert.strictEqual(readFileSync(new URL('./out.txt', import.meta.url),'utf8'),'GOOD\\n'));`).join('\n') + '\n';
const TRIVIAL = "import test from 'node:test';\n" + [0, 1, 2].map((i) => `test('c${i}',()=>{});`).join('\n') + '\n';
const BASEF = { 't.test.mjs': PINNED, 'out.txt': 'OLD\n' };
const hashOf = (repo: string, c: string): string => execFileSync('git', ['hash-object', '--stdin'], { cwd: repo, input: c }).toString().trim();
function plant(repo: string, oid: string, bytes: string): void {
  const d = join(repo, '.git/objects', oid.slice(0, 2)); mkdirSync(d, { recursive: true });
  const f = join(d, oid.slice(2)); if (existsSync(f)) chmodSync(f, 0o644);
  writeFileSync(f, deflateSync(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(bytes)}\0`), Buffer.from(bytes)])));
}
let k = 0;
const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
/** The honest diff bytes' sha for base -> head contents (a clean twin repo; the diff has no commit ids in it). */
async function honestSha(head: Record<string, string>): Promise<string> {
  const t = join(root, `twin${k++}`); mkdirSync(t); const { base, head: h } = makeRepo(t, BASEF, head, W);
  const d = await G.recordGitDiff({ base, head: h, cwd: t, runner }); return d?.sha256 as string;
}
type Store = { readonly objects: string; readonly dispose: () => void };
const build = (seed: string, base: string): Store | null => {
  const f = (S as unknown as { buildTrustedSeedStore?: (i: { seed: string; base: string }) => Store | { refused: string } }).buildTrustedSeedStore;
  if (f === undefined) return null; /* pre-fix: no store, the coder's .git is read (failing-first) */
  const r = f({ seed, base }); if ('refused' in r) throw new Error(r.refused); return r;
};
type Flow = { coder?: (repo: string, base: string) => void; pinAfterCoder?: true; useCoderCommit?: true; allowHeadNotParent?: true };
async function flow(o: Flow = {}): Promise<{ gate: 'PASS' | readonly string[]; diff: G.E2DiffEvidence | null; spec?: string; snap?: string }> {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  const base = makeRepo(repo, BASEF, {}, W).base; git(repo, 'reset', '-q', '--hard', base);
  const store = build(repo, base); /* before any coder code */
  const trusted = store === null ? {} : { trustedObjects: store.objects };
  const pin = () => G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base, ...trusted } as Parameters<typeof G.pinVerifierSpecWithBaseRun>[0], runner);
  let spec = o.pinAfterCoder ? null : await pin();
  try {
    W(join(repo, 'out.txt'), 'GOOD\n'); /* the coder's honest answer */
    o.coder?.(repo, base);
    spec ??= await pin();
    if ('refused' in spec) return { gate: [spec.refused], diff: null, spec: spec.refused };
    let head: string; let objectDir: string | undefined; let dispose = (): void => {};
    if (o.useCoderCommit) head = git(repo, 'rev-parse', 'HEAD');
    else {
      const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU, ...(o.allowHeadNotParent ? { allowHeadNotParent: true as const } : {}), ...trusted } as Parameters<typeof S.snapshotCommitSafely>[0]);
      if ('refused' in s) return { gate: [s.refused], diff: null, snap: s.refused };
      head = s.head; objectDir = s.objectDir.path; dispose = s.dispose;
    }
    try {
      const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
      const diff = await G.recordGitDiff({ base, head, cwd: repo, runner, ...(objectDir === undefined ? {} : { objectDir }), ...trusted } as Parameters<typeof G.recordGitDiff>[0]);
      const { lines, evidence } = await liveCapture(root, `s${k++}.jsonl`, START + call('c0', 'edit_file', { path: 'out.txt' }) + tail());
      const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
      return { gate: g.ok ? 'PASS' : g.reasons, diff };
    } finally { dispose(); }
  } finally { store?.dispose(); }
}

describe('trusted seed store: the primitive', () => {
  it('buildTrustedSeedStore: 0700, owned by the gate uid, outside the seed, holds base, no alternates; dispose removes it', () => {
    const repo = join(root, `p${k++}`); mkdirSync(repo); const base = makeRepo(repo, BASEF, {}, W).base;
    const s = (S as unknown as { buildTrustedSeedStore: (i: { seed: string; base: string }) => Store & { storeDir: string; base: string; tree: string } }).buildTrustedSeedStore({ seed: repo, base });
    expect(statSync(s.storeDir).mode & 0o777).toBe(0o700);
    expect(statSync(s.storeDir).uid).toBe(process.getuid?.());
    expect(s.storeDir.startsWith(repo)).toBe(false);
    expect(s.base).toBe(base);
    expect(existsSync(join(s.objects, 'info/alternates'))).toBe(false);
    expect(execFileSync('git', ['cat-file', '-t', base], { cwd: repo, env: { ...process.env, GIT_OBJECT_DIRECTORY: s.objects } }).toString().trim()).toBe('commit');
    s.dispose(); s.dispose(); expect(existsSync(s.storeDir)).toBe(false);
  });
  it('a base not in the seed is refused (store_base_missing)', () => {
    const repo = join(root, `p${k++}`); mkdirSync(repo); makeRepo(repo, BASEF, {}, W);
    expect(S.buildTrustedSeedStore({ seed: repo, base: 'f'.repeat(40) })).toEqual({ refused: 'store_base_missing' });
  });
  it('a gate without the trusted store refuses (e2_objects_untrusted): coder-store evidence never passes', async () => {
    const t = join(root, `p${k++}`); mkdirSync(t); const { base, head } = makeRepo(t, BASEF, { 'out.txt': 'GOOD\n' }, W);
    const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: t, base }, runner);
    if ('refused' in spec) throw new Error(spec.refused);
    const reexec = await G.recordVerifierReexec({ spec, cwd: t, runner });
    const diff = await G.recordGitDiff({ base, head, cwd: t, runner });
    const { lines, evidence } = await liveCapture(root, `s${k++}.jsonl`, START + call('c0', 'edit_file', { path: 'out.txt' }) + tail());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base, head, workspace: t }, modelId: MODEL });
    expect(g.ok ? 'PASS' : g.reasons).toContain('e2_objects_untrusted');
  }, 60_000);
});

describe('variants (each with its control: the recorded diff is the honest -OLD +GOOD diff)', () => {
  it('control: honest flow PASSes 3/3 and records the honest diff', async () => {
    const r = await flow();
    expect(r.gate).toBe('PASS');
    expect(r.diff?.sha256).toBe(await honestSha({ 'out.txt': 'GOOD\n' }));
  }, 60_000);
  it('(a) PILOT R9-1: corrupt GOOD object planted in the coder store -> still the honest diff (never EVIL)', async () => {
    const r = await flow({ coder: (repo) => plant(repo, hashOf(repo, 'GOOD\n'), 'EVIL-UNTESTED-CONTENT\n') });
    expect(r.gate).toBe('PASS');
    expect(r.diff?.sha256).toBe(await honestSha({ 'out.txt': 'GOOD\n' }));
  }, 60_000);
  it('(b) base blob corrupted in the coder store after the store was built -> still the honest base side', async () => {
    const r = await flow({ coder: (repo) => plant(repo, hashOf(repo, 'OLD\n'), 'EVIL-BASE-CONTENT\n') });
    expect(r.gate).toBe('PASS');
    expect(r.diff?.sha256).toBe(await honestSha({ 'out.txt': 'GOOD\n' }));
  }, 60_000);
  it('(c) pinned test base object swapped for a trivial test after the coder ran, worktree trivial, answer WRONG -> refused (pin from the store)', async () => {
    const r = await flow({ pinAfterCoder: true, coder: (repo) => {
      plant(repo, hashOf(repo, PINNED), TRIVIAL); W(join(repo, 't.test.mjs'), TRIVIAL); W(join(repo, 'out.txt'), 'WRONG\n');
    } });
    expect(r.gate).not.toBe('PASS');
  }, 60_000);
  it('(c) control: worktree keeping the original test with the wrong answer fails the tests', async () => {
    const r = await flow({ pinAfterCoder: true, coder: (repo) => { W(join(repo, 'out.txt'), 'WRONG\n'); } });
    expect(r.gate).not.toBe('PASS');
  }, 60_000);
  it('(d) coder-made commit whose GOOD object is then corrupted: the commit itself is not evidence (unreadable without the coder store)', async () => {
    const r = await flow({ useCoderCommit: true, coder: (repo) => {
      git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'coder');
      plant(repo, hashOf(repo, 'GOOD\n'), 'EVIL-UNTESTED-CONTENT\n');
    } });
    expect(r.gate).not.toBe('PASS');
  }, 60_000);
  it('(d) the same worktree through the snapshot path (allowHeadNotParent) records the honest diff', async () => {
    const r = await flow({ allowHeadNotParent: true, coder: (repo) => {
      git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'coder');
      plant(repo, hashOf(repo, 'GOOD\n'), 'EVIL-UNTESTED-CONTENT\n');
    } });
    expect(r.gate).toBe('PASS');
    expect(r.diff?.sha256).toBe(await honestSha({ 'out.txt': 'GOOD\n' }));
  }, 60_000);
});

describe("R9-3: another repo's objects dir, a symlinked store, or objects/info cannot make anything accepted", () => {
  const setup = async () => {
    const repo = join(root, `q${k++}`); mkdirSync(repo); const base = makeRepo(repo, BASEF, {}, W).base; git(repo, 'reset', '-q', '--hard', base);
    const other = join(root, `o${k++}`); mkdirSync(other); makeRepo(other, BASEF, {}, W);
    const store = S.buildTrustedSeedStore({ seed: repo, base }); if ('refused' in store) throw new Error(store.refused);
    return { repo, base, other, store };
  };
  const pinWith = (repo: string, base: string, trustedObjects: string) => G.pinVerifierSpec({ testCommand: 'node --test t.test.mjs', workspace: repo, base, trustedObjects });
  it("another repo's .git/objects (0755; 0700 + info/alternates): spec and diff refused", async () => {
    const { repo, base, other, store } = await setup();
    try {
      const oo = join(other, '.git/objects');
      expect(pinWith(repo, base, oo)).toEqual({ refused: 'spec_trusted_store_invalid' });
      chmodSync(oo, 0o700); W(join(oo, 'info/alternates'), `${join(repo, '.git/objects')}\n`);
      expect(pinWith(repo, base, oo)).toEqual({ refused: 'spec_trusted_store_invalid' });
      expect(G.checkTrustedObjects(oo, repo)).toBe('objdir_info_present');
      W(join(store.objects, 'info/alternates'), `${join(repo, '.git/objects')}\n`);
      expect(G.checkTrustedObjects(store.objects, repo)).toBe('objdir_info_present');
      rmSync(join(store.objects, 'info/alternates'));
      W(join(store.objects, 'info/http-alternates'), 'http://x/\n');
      expect(G.checkTrustedObjects(store.objects, repo)).toBe('objdir_info_present');
    } finally { store.dispose(); }
  });
  it('a symlink to the real store, the workspace .git/objects, and a store inside the workspace are refused', async () => {
    const { repo, base, store } = await setup();
    try {
      const link = join(root, `l${k++}`); execFileSync('ln', ['-s', store.objects, link]);
      expect(G.checkTrustedObjects(link, repo)).toBe('objdir_not_plain');
      expect(pinWith(repo, base, link)).toEqual({ refused: 'spec_trusted_store_invalid' });
      const own = join(repo, '.git/objects'); chmodSync(own, 0o700);
      expect(G.checkTrustedObjects(own, repo)).toBe('objdir_inside_workspace');
      const runner2 = G.spawnVerifierRunner({ timeoutMs: 60_000 });
      W(join(repo, 'out.txt'), 'GOOD\n');
      const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU, trustedObjects: store.objects });
      if ('refused' in s) throw new Error(s.refused);
      try {
        for (const bad of [link, own]) {
          const d = await G.recordGitDiff({ base, head: s.head, cwd: repo, runner: runner2, objectDir: s.objectDir.path, trustedObjects: bad });
          expect(d?.objectDirRefusal, bad).not.toBeNull(); expect(d?.argv).toEqual([]);
        }
        const good = await G.recordGitDiff({ base, head: s.head, cwd: repo, runner: runner2, objectDir: s.objectDir.path, trustedObjects: store.objects });
        expect(good?.objectDirRefusal).toBeNull(); expect(good?.exitCode).toBe(0); /* control */
      } finally { s.dispose(); }
    } finally { store.dispose(); }
  }, 60_000);
  it('control: the real store passes checkTrustedObjects and pins the spec', async () => {
    const { repo, base, store } = await setup();
    try { expect(G.checkTrustedObjects(store.objects, repo)).toBeNull(); expect('refused' in pinWith(repo, base, store.objects)).toBe(false); } finally { store.dispose(); }
  });
});

describe('mutation kill tests (Round 10)', () => {
  it('T11: a seed whose base tree is malformed (duplicate entries; fetch accepts it) is refused by the store fsck (store_failed)', () => {
    const repo = join(root, `m${k++}`); mkdirSync(repo); git(repo, 'init', '-q');
    const b = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'a\n' }).toString().trim();
    const e = Buffer.concat([Buffer.from('100644 a\0'), Buffer.from(b, 'hex')]);
    const t = execFileSync('git', ['hash-object', '--literally', '-t', 'tree', '-w', '--stdin'], { cwd: repo, input: Buffer.concat([e, e]) }).toString().trim();
    const c = git(repo, 'commit-tree', t, '-m', 'm'); git(repo, 'update-ref', 'refs/heads/main', c);
    expect(S.buildTrustedSeedStore({ seed: repo, base: c })).toEqual({ refused: 'store_failed' });
  });
  it('T14: with the trusted store, a parent that exists only in the coder store (a coder-made commit) is safe_git_parent_invalid', () => {
    const repo = join(root, `m${k++}`); mkdirSync(repo); const base = makeRepo(repo, BASEF, {}, W).base; git(repo, 'reset', '-q', '--hard', base);
    const store = S.buildTrustedSeedStore({ seed: repo, base }); if ('refused' in store) throw new Error(store.refused);
    try {
      W(join(repo, 'out.txt'), 'GOOD\n'); git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'coder');
      const coder = git(repo, 'rev-parse', 'HEAD');
      expect(S.snapshotCommitSafely({ workspace: repo, parent: coder, message: 'c', author: AU, trustedObjects: store.objects })).toEqual({ refused: 'safe_git_parent_invalid' });
      const ok = S.snapshotCommitSafely({ workspace: repo, parent: coder, message: 'c', author: AU }); /* control: without the store the coder store is read */
      expect('refused' in ok).toBe(false); if (!('refused' in ok)) ok.dispose();
    } finally { store.dispose(); }
  });
});
