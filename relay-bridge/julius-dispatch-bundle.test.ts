import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bundleStep, compareJudgedToFile, createLocalWorkspaceFs, diffWorkspaceHashes, GIT_DIR_NAMED_EXCLUSIONS, hashWorkspace, J1_ARTIFACT_FILE, onlyArtifactChanged, trimmedBytes,
  type WorkspaceEntry, type WorkspaceFs,
} from './julius-dispatch-bundle';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

const memFs = (files: Record<string, string>, links: Record<string, string> = {}): WorkspaceFs => ({
  listEntries: async () => [
    ...Object.keys(files).map((path): WorkspaceEntry => ({ path, kind: 'file' })),
    ...Object.entries(links).map(([path, linkTarget]): WorkspaceEntry => ({ path, kind: 'symlink', linkTarget })),
  ],
  readFile: async (p) => { const v = files[p]; if (v === undefined) throw new Error('enoent'); return enc(v); },
});
const BASE = { 'data/legacy_ledger.csv': 'a,b\n1,2\n', 'data/posts.json': '[]', 'format.test.mjs': 'test' };

describe('C4 judged message against out/normalized.json (trimmed bytes)', () => {
  it('equal after trimming both sides; both hashes returned', () => {
    const r = compareJudgedToFile('  {"a":1}\n', enc('{"a":1}\r\n\r\n'));
    expect(r).toEqual({ ok: true, judgedSha256: sha('{"a":1}'), fileSha256: sha('{"a":1}'), failureClass: null });
  });
  it('a different byte is artifact_file_mismatch and both hashes are still recorded', () => {
    const r = compareJudgedToFile('{"a":1}', enc('{"a":2}'));
    expect(r).toEqual({ ok: false, judgedSha256: sha('{"a":1}'), fileSha256: sha('{"a":2}'), failureClass: 'artifact_file_mismatch' });
  });
  it('an absent file or one that is not valid UTF-8 is a mismatch with a null file hash', () => {
    expect(compareJudgedToFile('x', null)).toMatchObject({ ok: false, fileSha256: null, failureClass: 'artifact_file_mismatch' });
    expect(compareJudgedToFile('x', new Uint8Array([0xff, 0xfe]))).toMatchObject({ ok: false, fileSha256: null, failureClass: 'artifact_file_mismatch' });
    expect(() => trimmedBytes(new Uint8Array([0xff]))).toThrow();
  });
});

describe('C4 workspace before/after hash lists', () => {
  it('hashes every file path to the sha256 of its exact bytes', async () => {
    const list = (await hashWorkspace(memFs(BASE))).files;
    expect(list).toEqual({ 'data/legacy_ledger.csv': sha('a,b\n1,2\n'), 'data/posts.json': sha('[]'), 'format.test.mjs': sha('test') });
  });
  it('only out/normalized.json added: ok; modified: ok', async () => {
    const before = await hashWorkspace(memFs(BASE));
    const added = await hashWorkspace(memFs({ ...BASE, [J1_ARTIFACT_FILE]: '{}' }));
    expect(onlyArtifactChanged(before, added).ok).toBe(true);
    const modified = await hashWorkspace(memFs({ ...BASE, [J1_ARTIFACT_FILE]: '{"x":1}' }));
    expect(onlyArtifactChanged(added, modified).ok).toBe(true);
  });
  it('anything else changing fails: another file added, an input edited, an input removed, nothing changed, the artifact removed', async () => {
    const before = await hashWorkspace(memFs(BASE));
    const art = { [J1_ARTIFACT_FILE]: '{}' };
    expect(onlyArtifactChanged(before, await hashWorkspace(memFs({ ...BASE, ...art, 'out/extra.json': '1' }))).ok).toBe(false);
    expect(onlyArtifactChanged(before, await hashWorkspace(memFs({ ...BASE, ...art, 'data/posts.json': '[1]' }))).ok).toBe(false);
    const { 'format.test.mjs': _gone, ...fewer } = BASE;
    expect(onlyArtifactChanged(before, await hashWorkspace(memFs({ ...fewer, ...art }))).ok).toBe(false);
    expect(onlyArtifactChanged(before, before).ok).toBe(false);
    const withArt = await hashWorkspace(memFs({ ...BASE, ...art }));
    expect(onlyArtifactChanged(withArt, before).ok).toBe(false);
    expect(diffWorkspaceHashes(before.files, withArt.files)).toMatchObject({ added: [J1_ARTIFACT_FILE], removed: [], modified: [] });
  });
  it('bundleStep: a scope violation outranks a matching file; a mismatching file fails with artifact_file_mismatch; a clean pair passes', async () => {
    const before = await hashWorkspace(memFs(BASE));
    const good = await hashWorkspace(memFs({ ...BASE, [J1_ARTIFACT_FILE]: '{"a":1}' }));
    const ok = bundleStep({ judgedMessage: '{"a":1}\n', before, after: good, fileBytes: enc('{"a":1}') });
    expect(ok).toMatchObject({ ok: true, failureClass: null, changedPaths: [J1_ARTIFACT_FILE] });
    expect(bundleStep({ judgedMessage: '{"a":2}', before, after: good, fileBytes: enc('{"a":1}') })).toMatchObject({ ok: false, failureClass: 'artifact_file_mismatch', judgedSha256: sha('{"a":2}'), fileSha256: sha('{"a":1}') });
    const dirty = await hashWorkspace(memFs({ ...BASE, [J1_ARTIFACT_FILE]: '{"a":1}', 'data/posts.json': 'x' }));
    expect(bundleStep({ judgedMessage: '{"a":1}', before, after: dirty, fileBytes: enc('{"a":1}') })).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
  });
});

type Tree = Record<string, { name: string; kind: 'dir' | 'file' | 'link'; target?: string }[]>;
/** A fake node:fs surface over a directory map; links carry a target. */
const treeFs = (tree: Tree, contents: Record<string, string> = {}) => ({
  readdirSync: (p: string) => (tree[p] ?? []).map((e) => ({ name: e.name, isDirectory: () => e.kind === 'dir', isFile: () => e.kind === 'file', isSymbolicLink: () => e.kind === 'link' })),
  readlinkSync: (p: string) => { const parent = p.slice(0, p.lastIndexOf('/')); const name = p.slice(p.lastIndexOf('/') + 1); const e = (tree[parent] ?? []).find((x) => x.name === name); if (e?.target === undefined) throw new Error('not a link'); return e.target; },
  readFileSync: (p: string): Uint8Array => enc(contents[p] ?? 'x'),
  lstatSync: (p: string) => {
    const parent = p.slice(0, p.lastIndexOf('/')); const name = p.slice(p.lastIndexOf('/') + 1);
    const e = (tree[parent] ?? []).find((x) => x.name === name);
    const mode = e?.kind === 'dir' ? 0o755 : e?.kind === 'link' ? 0o777 : 0o644;
    return { mode };
  },
});

describe('C4 local workspace fs (injected fs surface, fakes only)', () => {
  it('lists files recursively, skips NOTHING (.git and node_modules included), refuses an escaping read', async () => {
    const tree: Tree = {
      '/w': [{ name: 'data', kind: 'dir' }, { name: '.git', kind: 'dir' }, { name: 'format.test.mjs', kind: 'file' }, { name: 'node_modules', kind: 'dir' }],
      '/w/data': [{ name: 'posts.json', kind: 'file' }],
      '/w/.git': [{ name: 'HEAD', kind: 'file' }],
      '/w/node_modules': [{ name: 'x.js', kind: 'file' }],
    };
    const reads: string[] = [];
    const fs = createLocalWorkspaceFs('/w', { ...treeFs(tree), readFileSync: (p) => { reads.push(p); return enc('x'); } });
    expect((await fs.listEntries()).map((e) => e.path)).toEqual(['.git', '.git/HEAD', 'data', 'data/posts.json', 'format.test.mjs', 'node_modules', 'node_modules/x.js']);
    await fs.readFile('data/posts.json');
    expect(reads).toEqual(['/w/data/posts.json']);
    await expect(fs.readFile('../etc/passwd')).rejects.toThrow('workspace_path_invalid');
    await expect(fs.readFile('/abs')).rejects.toThrow('workspace_path_invalid');
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/* M3 D1/D2: lists are auditable; nothing is skipped silently; symlinks count                                     */

const CLEAN: Tree = {
  '/w': [{ name: 'data', kind: 'dir' }, { name: 'out', kind: 'dir' }, { name: 'format.test.mjs', kind: 'file' }, { name: '.git', kind: 'dir' }],
  '/w/data': [{ name: 'posts.json', kind: 'file' }],
  '/w/out': [{ name: 'normalized.json', kind: 'file' }],
  '/w/.git': [{ name: 'HEAD', kind: 'file' }, { name: 'config', kind: 'file' }, { name: 'index', kind: 'file' }, { name: 'objects', kind: 'dir' }],
  '/w/.git/objects': [{ name: 'aa', kind: 'file' }],
};
const withExtra = (extra: Tree): Tree => { const t: Tree = JSON.parse(JSON.stringify(CLEAN)); for (const [k, v] of Object.entries(extra)) t[k] = [...(t[k] ?? []), ...v]; return t; };
const OPTS = { gitDir: '.git' } as const;
const run = async (before: Tree, after: Tree, judged = 'x', contents: Record<string, string> = {}) => {
  const b = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(before, contents)), OPTS);
  const a = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(after, contents)), OPTS);
  return { b, a, step: bundleStep({ judgedMessage: judged, before: b, after: a, fileBytes: enc('x') }) };
};
const NM = withExtra({ '/w': [{ name: 'node_modules', kind: 'dir' }], '/w/node_modules': [{ name: 'evil.js', kind: 'file' }] });
const LINK = withExtra({ '/w/data': [{ name: 'key', kind: 'link', target: '/etc/secret' }] });
const HOOK = withExtra({ '/w/.git': [{ name: 'hooks', kind: 'dir' }], '/w/.git/hooks': [{ name: 'pre-commit', kind: 'file' }] });

/** The GUARD under test as a reusable predicate: every hidden-write route must be reported. Returns the routes that were MISSED. */
async function missedHiddenWrites(makeFs: (tree: Tree, contents?: Record<string, string>) => WorkspaceFs): Promise<string[]> {
  const missed: string[] = [];
  const probe = async (name: string, before: Tree, after: Tree): Promise<void> => {
    const b = await hashWorkspace(makeFs(before), OPTS);
    const a = await hashWorkspace(makeFs(after, { '/w/out/normalized.json': 'the coder wrote this' }), OPTS);
    if (onlyArtifactChanged(b, a).ok) missed.push(name);
  };
  /* node_modules already exists, so hashing the directory entry alone cannot see a file planted inside it. */
  const nmPresent: Tree = { ...CLEAN, '/w': [...CLEAN['/w']!, { name: 'node_modules', kind: 'dir' }], '/w/node_modules': [] };
  await probe('node_modules write', nmPresent, NM);
  await probe('symlink added', CLEAN, LINK);
  await probe('dot-git hook planted', CLEAN, HOOK);
  return missed;
}

describe('D1 the before and after hash lists are persisted and hashed', () => {
  it('the snapshot carries the full list, its sha256 (canonical sorted [path,hash] JSON) and the named exclusions', async () => {
    const snap = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(CLEAN, { '/w/data/posts.json': 'P' })), OPTS);
    expect(snap.files['data/posts.json']).toBe(`${sha('P')}#mode:644`);
    expect(snap.files.data).toBe('dir:#mode:755');
    expect('.git' in snap.files).toBe(false);
    expect(snap.listSha256).toBe(sha(JSON.stringify(Object.entries(snap.files).sort())));
    expect(snap.excluded).toEqual([...GIT_DIR_NAMED_EXCLUSIONS]);
    expect(snap.gitTreeSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.keys(snap.files).some((p) => p.startsWith('.git/'))).toBe(false);
  });
  it('bundleStep returns both full lists, both list hashes and the git tree hashes, for the ledger', async () => {
    const { b, a, step } = await run(CLEAN, CLEAN);
    expect(step).toMatchObject({ beforeList: b.files, afterList: a.files, beforeListSha256: b.listSha256, afterListSha256: a.listSha256, gitTreeSha256Before: b.gitTreeSha256, gitTreeSha256After: a.gitTreeSha256, excluded: [...GIT_DIR_NAMED_EXCLUSIONS] });
  });
});

describe('D2 nothing is skipped silently', () => {
  it('a write under node_modules/ fails the scope check with workspace_scope_violation', async () => {
    const { step } = await run(CLEAN, NM);
    expect(step).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
    expect(step.changedPaths).toContain('node_modules/evil.js');
  });
  it('a symlink (added, or standing in for the artifact) fails; the link target is recorded', async () => {
    const added = await run(CLEAN, LINK);
    expect(added.step).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
    expect(added.a.files['data/key']).toBe('symlink:/etc/secret#mode:777');
    const asArtifact: Tree = JSON.parse(JSON.stringify(CLEAN)); asArtifact['/w/out'] = [{ name: 'normalized.json', kind: 'link', target: '/home/u/.keys/xai' }];
    const art = await run(CLEAN, asArtifact);
    expect(art.step).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
  });
  it('.git is a NAMED exclusion with its own tree hash: a planted hook fails, objects/ growth does not change it', async () => {
    const hook = await run(CLEAN, HOOK);
    expect(hook.step).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
    expect(hook.step.changedPaths).toContain('.git');
    expect(hook.step.gitTreeSha256Before).not.toBe(hook.step.gitTreeSha256After);
    const objects = await run(CLEAN, withExtra({ '/w/.git/objects': [{ name: 'bb', kind: 'file' }] }));
    expect(objects.step.gitTreeSha256Before).toBe(objects.step.gitTreeSha256After);
  });
  it('without the gitDir option a .git file is just a file in the list (no silent skip)', async () => {
    const snap = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(CLEAN)));
    expect(snap.excluded).toEqual([]);
    expect(snap.gitTreeSha256).toBeNull();
    expect(Object.keys(snap.files)).toContain('.git/HEAD');
    expect(Object.keys(snap.files)).toContain('.git');
  });
  it('an empty directory and a mode change are in the hash (neither is invisible)', async () => {
    const withEmpty: Tree = { ...CLEAN, '/w': [...CLEAN['/w']!, { name: 'empty', kind: 'dir' }], '/w/empty': [] };
    const bare = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(CLEAN)), OPTS);
    const emptied = await hashWorkspace(createLocalWorkspaceFs('/w', treeFs(withEmpty)), OPTS);
    expect(emptied.files.empty).toBe('dir:#mode:755');
    expect(emptied.listSha256).not.toBe(bare.listSha256);
    expect(onlyArtifactChanged(bare, emptied).ok).toBe(false);
    const modeFs = memFs(BASE);
    const plain = await hashWorkspace(modeFs);
    const chmod = await hashWorkspace({
      ...modeFs,
      listEntries: async () => (await modeFs.listEntries()).map((e) => ({ ...e, mode: e.path === 'data/posts.json' ? 0o600 : 0o644 })),
    });
    expect(chmod.files['data/posts.json']).toBe(`${sha('[]')}#mode:600`);
    expect(chmod.files['data/posts.json']).not.toBe(plain.files['data/posts.json']);
    expect(onlyArtifactChanged(plain, chmod).ok).toBe(false);
  });
  it('the header states the coverage, including the explicit .git exclusion', () => {
    const header = readFileSync(join(__dirname, 'julius-dispatch-bundle.ts'), 'utf8').slice(0, 1800);
    expect(header).toContain('including an empty one');
    expect(header).toContain('#mode:<octal>');
    expect(header).toContain("`.git/objects/` and `.git/index`");
    expect(header).toContain('When `gitDir` is absent, `.git` is hashed in the');
    expect(GIT_DIR_NAMED_EXCLUSIONS).toEqual(['.git/objects/', '.git/index']);
  });
});

describe('MUTANTS: each guard test fails when its guard is broken', () => {
  const real = (t: Tree, c?: Record<string, string>): WorkspaceFs => createLocalWorkspaceFs('/w', treeFs(t, c));
  const without = (drop: (e: WorkspaceEntry) => boolean) => (t: Tree, c?: Record<string, string>): WorkspaceFs => ({ ...real(t, c), listEntries: async () => (await real(t, c).listEntries()).filter((e) => !drop(e)) });
  it('the real walker misses no hidden-write route', async () => {
    expect(await missedHiddenWrites(real)).toEqual([]);
  });
  it('MUTANT walker that skips node_modules (the old behaviour) is caught by the same predicate', async () => {
    expect(await missedHiddenWrites(without((e) => e.path.startsWith('node_modules/')))).toEqual(['node_modules write']);
  });
  it('MUTANT walker that ignores symlinks (the old behaviour) is caught', async () => {
    expect(await missedHiddenWrites(without((e) => e.kind === 'symlink'))).toEqual(['symlink added']);
  });
  it('MUTANT walker that skips .git wholesale (the old behaviour) is caught', async () => {
    expect(await missedHiddenWrites(without((e) => e.path.startsWith('.git/')))).toEqual(['dot-git hook planted']);
  });
});

/* R2: only .git/objects/ and .git/index may be excluded; config, hooks, info and every ref are INSIDE the hashed set. */
describe('R2 the git tree hash covers config, hooks, info and refs', () => {
  const BASE_GIT: Tree = {
    ...CLEAN,
    '/w/.git': [
      { name: 'HEAD', kind: 'file' }, { name: 'config', kind: 'file' }, { name: 'index', kind: 'file' }, { name: 'objects', kind: 'dir' },
      { name: 'hooks', kind: 'dir' }, { name: 'info', kind: 'dir' }, { name: 'refs', kind: 'dir' },
    ],
    '/w/.git/hooks': [{ name: 'pre-commit', kind: 'file' }],
    '/w/.git/info': [{ name: 'exclude', kind: 'file' }],
    '/w/.git/refs': [{ name: 'heads', kind: 'dir' }],
    '/w/.git/refs/heads': [{ name: 'main', kind: 'file' }],
  };
  const ROUTES: Record<string, string> = {
    'git config edit': '/w/.git/config', 'hook file edit': '/w/.git/hooks/pre-commit', 'info/exclude edit': '/w/.git/info/exclude', 'ref edit': '/w/.git/refs/heads/main',
  };
  const AFTER_CONTENT = { '/w/out/normalized.json': 'art' };
  const ledger = async (makeFs: (t: Tree, c?: Record<string, string>) => WorkspaceFs, changed: string | null) => {
    const before = await hashWorkspace(makeFs(BASE_GIT, { '/w/out/normalized.json': '{}' }), OPTS);
    const after = await hashWorkspace(makeFs(BASE_GIT, { ...AFTER_CONTENT, ...(changed === null ? {} : { [changed]: 'CHANGED' }) }), OPTS);
    return { before, after, step: bundleStep({ judgedMessage: 'x', before, after, fileBytes: enc('x') }) };
  };
  /** The GUARD as a predicate: returns the routes whose change did NOT yield workspace_scope_violation. */
  async function missedGitRoutes(makeFs: (t: Tree, c?: Record<string, string>) => WorkspaceFs): Promise<string[]> {
    const missed: string[] = [];
    for (const [name, path] of Object.entries(ROUTES)) { const r = await ledger(makeFs, path); if (r.step.failureClass !== 'workspace_scope_violation') missed.push(name); }
    return missed;
  }
  const real = (t: Tree, c?: Record<string, string>): WorkspaceFs => createLocalWorkspaceFs('/w', treeFs(t, c));

  it('the exclusion list is EXACTLY .git/objects/ and .git/index, and it is returned in the bundle row', async () => {
    expect([...GIT_DIR_NAMED_EXCLUSIONS]).toEqual(['.git/objects/', '.git/index']);
    expect((await ledger(real, null)).step.excluded).toEqual(['.git/objects/', '.git/index']);
  });
  it('a change to .git/config, to a hook file, to .git/info/exclude and to a ref each yields workspace_scope_violation (and .git in the changed set)', async () => {
    for (const [name, path] of Object.entries(ROUTES)) {
      const r = await ledger(real, path);
      expect(r.step, name).toMatchObject({ ok: false, failureClass: 'workspace_scope_violation' });
      expect(r.step.changedPaths, name).toContain('.git');
      expect(r.step.gitTreeSha256Before, name).not.toBe(r.step.gitTreeSha256After);
    }
    expect(await missedGitRoutes(real)).toEqual([]);
  });
  it('the two named exclusions stay unhashed: a change to .git/index or a new object does not move the tree hash', async () => {
    expect((await ledger(real, '/w/.git/index')).step.gitTreeSha256Before).toBe((await ledger(real, '/w/.git/index')).step.gitTreeSha256After);
    expect((await ledger(real, '/w/.git/objects/aa')).step.gitTreeSha256Before).toBe((await ledger(real, '/w/.git/objects/aa')).step.gitTreeSha256After);
  });
  it('MUTANT walker that excludes all of .git is caught on every route', async () => {
    const noGit = (t: Tree, c?: Record<string, string>): WorkspaceFs => ({ ...real(t, c), listEntries: async () => (await real(t, c).listEntries()).filter((e) => !e.path.startsWith('.git/')) });
    expect(await missedGitRoutes(noGit)).toEqual(Object.keys(ROUTES));
  });
  it('MUTANT walkers that also drop only config, hooks, info or refs are each caught on their own route', async () => {
    const dropping = (prefix: string) => (t: Tree, c?: Record<string, string>): WorkspaceFs => ({ ...real(t, c), listEntries: async () => (await real(t, c).listEntries()).filter((e) => !e.path.startsWith(prefix)) });
    expect(await missedGitRoutes(dropping('.git/config'))).toEqual(['git config edit']);
    expect(await missedGitRoutes(dropping('.git/hooks/'))).toEqual(['hook file edit']);
    expect(await missedGitRoutes(dropping('.git/info/'))).toEqual(['info/exclude edit']);
    expect(await missedGitRoutes(dropping('.git/refs/'))).toEqual(['ref edit']);
  });
});
