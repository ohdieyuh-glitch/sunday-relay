import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  bundleStep, compareJudgedToFile, createLocalWorkspaceFs, diffWorkspaceHashes, hashWorkspace, J1_ARTIFACT_FILE, onlyArtifactChanged, trimmedBytes,
  type WorkspaceFs,
} from './julius-dispatch-bundle';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

const memFs = (files: Record<string, string>): WorkspaceFs => ({
  listFiles: async () => Object.keys(files),
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
    const list = await hashWorkspace(memFs(BASE));
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
    expect(diffWorkspaceHashes(before, withArt)).toMatchObject({ added: [J1_ARTIFACT_FILE], removed: [], modified: [] });
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

describe('C4 local workspace fs (injected fs surface, fakes only)', () => {
  it('lists files recursively, skips .git and node_modules, refuses an escaping read', async () => {
    const tree: Record<string, { name: string; dir: boolean }[]> = {
      '/w': [{ name: 'data', dir: true }, { name: '.git', dir: true }, { name: 'format.test.mjs', dir: false }, { name: 'node_modules', dir: true }],
      '/w/data': [{ name: 'posts.json', dir: false }],
    };
    const reads: string[] = [];
    const fs = createLocalWorkspaceFs('/w', {
      readdirSync: (p) => (tree[p] ?? []).map((e) => ({ name: e.name, isDirectory: () => e.dir, isFile: () => !e.dir })),
      readFileSync: (p) => { reads.push(p); return enc('x'); },
    });
    expect(await fs.listFiles()).toEqual(['data/posts.json', 'format.test.mjs']);
    await fs.readFile('data/posts.json');
    expect(reads).toEqual(['/w/data/posts.json']);
    await expect(fs.readFile('../etc/passwd')).rejects.toThrow('workspace_path_invalid');
    await expect(fs.readFile('/abs')).rejects.toThrow('workspace_path_invalid');
  });
});
