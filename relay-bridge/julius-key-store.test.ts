import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { envReadAliases } from './julius-dispatch-source-scan';
import { assertNoProviderKeysInEnv, createFileKeyStore, KeyStoreError, type KeyFileStat, type KeyStoreFs } from './julius-key-store';

const SECRET = 'canary_keystore_ZZ9_x7Q2m4k8w1';
const DIR = '/private/keys';
const OWNER = 1000;
const base = { repoRoot: '/repo', realpath: (p: string) => p, ownerUid: OWNER, platform: 'linux' as const };

interface Held { text: string; mode: number; uid: number; symlink: boolean }
interface FakeFs extends KeyStoreFs {
  readonly reads: number[];
  files: Record<string, Held>;
  /** Path text observed by a path read. The store must not use one: a swap after open stays on the path. */
  pathText(path: string): string;
}
const enoent = (path: string): Error => { const e = new Error(`ENOENT ${path}`) as Error & { code: string }; e.code = 'ENOENT'; return e; };
const statOf = (f: Held): KeyFileStat => ({
  isFile: () => !f.symlink, isSymbolicLink: () => f.symlink, mode: f.mode, uid: f.uid,
});
const fakeFs = (files: Record<string, { text: string; mode?: number; uid?: number; symlink?: boolean }>, over: Partial<KeyStoreFs> = {}): FakeFs => {
  let next = 0;
  const fds = new Map<number, Held>();
  const held: FakeFs = {
    reads: [],
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { text: v.text, mode: v.mode ?? 0o600, uid: v.uid ?? OWNER, symlink: v.symlink === true }])),
    pathText(path) { return held.files[path]?.text ?? ''; },
    lstatSync(path) { const f = held.files[path]; if (f === undefined) throw enoent(path); return statOf(f); },
    openSync(path) {
      const f = held.files[path];
      if (f === undefined) throw enoent(path);
      if (f.symlink) { const e = new Error('ELOOP') as Error & { code: string }; e.code = 'ELOOP'; throw e; }
      const fd = ++next;
      fds.set(fd, { ...f });
      return fd;
    },
    fstatSync(fd) { const f = fds.get(fd); if (f === undefined) throw enoent(String(fd)); return statOf(f); },
    readSync(fd) { held.reads.push(fd); const f = fds.get(fd); if (f === undefined) throw enoent(String(fd)); return f.text; },
    closeSync(fd) { fds.delete(fd); },
    ...over,
  };
  return held;
};
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { return e instanceof KeyStoreError ? e.code : `other:${String(e)}`; } return 'no_throw'; };
const storeOf = (fs: KeyStoreFs, over: Partial<Parameters<typeof createFileKeyStore>[0]> = {}) => createFileKeyStore({ dir: DIR, fs, ...base, ...over });

describe('KeyStore (file per key, private path outside the repo)', () => {
  it('reads the key at CALL time from the opened descriptor and never caches it', () => {
    const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: `${SECRET}\n` } });
    const store = storeOf(fs);
    expect(fs.reads).toEqual([]);
    expect(store.getKey('XAI_API_KEY')).toBe(SECRET);
    fs.files[`${DIR}/XAI_API_KEY`] = { text: 'rotated_value_0123456789', mode: 0o600, uid: OWNER, symlink: false };
    expect(store.getKey('XAI_API_KEY')).toBe('rotated_value_0123456789');
    delete fs.files[`${DIR}/XAI_API_KEY`];
    expect(codeOf(() => store.getKey('XAI_API_KEY'))).toBe('key_file_absent');
    expect(fs.reads).toHaveLength(2);
  });
  it('MUTANT: a stat-then-path-read would see a swap; the descriptor read does not', () => {
    const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: `${SECRET}\n` } });
    const opened = fs.openSync.bind(fs);
    fs.openSync = (path) => {
      const fd = opened(path);
      fs.files[path] = { text: 'SWAPPED_AFTER_OPEN', mode: 0o600, uid: OWNER, symlink: false };
      return fd;
    };
    expect(storeOf(fs).getKey('XAI_API_KEY')).toBe(SECRET);
    expect(fs.pathText(`${DIR}/XAI_API_KEY`)).toBe('SWAPPED_AFTER_OPEN');
  });
  it('an absent file, an unreadable file, an empty file, a too-open mode, a symlink and a wrong owner each refuse with a CODE', () => {
    const fs = fakeFs({
      [`${DIR}/EMPTY_KEY`]: { text: '  \n' },
      [`${DIR}/OPEN_KEY`]: { text: SECRET, mode: 0o644 },
      [`${DIR}/GROUP_KEY`]: { text: SECRET, mode: 0o640 },
      [`${DIR}/WORLD_KEY`]: { text: SECRET, mode: 0o604 },
      [`${DIR}/DENIED_KEY`]: { text: SECRET },
      [`${DIR}/LINK_KEY`]: { text: SECRET, symlink: true },
      [`${DIR}/ALIEN_KEY`]: { text: SECRET, uid: OWNER + 1 },
    });
    const denied: KeyStoreFs = {
      ...fs,
      readSync: (fd) => { if (fd !== 0) { const e = new Error(`EACCES ${SECRET}`) as Error & { code: string }; e.code = 'EACCES'; throw e; } return fs.readSync(fd); },
    };
    const realOpen = fs.openSync.bind(fs);
    let denyNext = false;
    denied.openSync = (path) => { if (path.endsWith('DENIED_KEY')) denyNext = true; return realOpen(path); };
    denied.readSync = (fd) => { if (denyNext) { denyNext = false; const e = new Error(`EACCES ${SECRET}`) as Error & { code: string }; e.code = 'EACCES'; throw e; } return fs.readSync(fd); };
    const store = storeOf(denied);
    expect(codeOf(() => store.getKey('NOPE_API_KEY'))).toBe('key_file_absent');
    expect(codeOf(() => store.getKey('DENIED_KEY'))).toBe('key_file_unreadable');
    expect(codeOf(() => store.getKey('EMPTY_KEY'))).toBe('key_file_empty');
    expect(codeOf(() => store.getKey('OPEN_KEY'))).toBe('key_file_mode_too_open');
    expect(codeOf(() => store.getKey('GROUP_KEY'))).toBe('key_file_mode_too_open');
    expect(codeOf(() => store.getKey('WORLD_KEY'))).toBe('key_file_mode_too_open');
    expect(codeOf(() => store.getKey('LINK_KEY'))).toBe('key_file_symlink');
    expect(codeOf(() => store.getKey('ALIEN_KEY'))).toBe('key_file_wrong_owner');
    for (const name of ['NOPE_API_KEY', 'DENIED_KEY', 'EMPTY_KEY', 'OPEN_KEY', 'LINK_KEY', 'ALIEN_KEY']) {
      try { store.getKey(name); } catch (e) { const text = `${(e as Error).message} ${JSON.stringify(e)} ${String((e as Error).stack)}`; expect(text).not.toContain(SECRET); expect(text).not.toContain(DIR); }
    }
  });
  it('MUTANT: an open that reports the path became a link (ELOOP or EPERM) is a symlink refusal, not a followed read', () => {
    for (const code of ['ELOOP', 'EPERM']) {
      const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: SECRET } });
      fs.openSync = () => { const e = new Error(code) as Error & { code: string }; e.code = code; throw e; };
      expect(codeOf(() => storeOf(fs).getKey('XAI_API_KEY')), code).toBe('key_file_symlink');
    }
  });
  it('the owner and mode checks are skipped only where the platform has no POSIX identities (win32)', () => {
    const fs = fakeFs({ [`${DIR}/OPEN_KEY`]: { text: SECRET, mode: 0o666, uid: 0 } });
    expect(storeOf(fs, { platform: 'win32' }).getKey('OPEN_KEY')).toBe(SECRET);
    expect(codeOf(() => storeOf(fs, { platform: 'darwin' }).getKey('OPEN_KEY'))).toBe('key_file_mode_too_open');
  });
  it('a name that could escape the directory is refused before any file is touched', () => {
    const fs = fakeFs({});
    const store = storeOf(fs);
    for (const bad of ['../x', 'a/b', 'a\\b', '', 'lower_case', 'X'.repeat(80), 'A B']) expect(codeOf(() => store.getKey(bad)), bad).toBe('key_name_invalid');
    expect(fs.reads).toEqual([]);
  });
  it('the inside-repo check always runs: a directory inside the repository is refused, and a missing root is not a way past it', () => {
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/relay-bridge/keys', fs: fakeFs({}), ...base, repoRoot: '/repo' }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/../private', fs: fakeFs({}), ...base }))).toBe('no_throw');
    expect(codeOf(() => createFileKeyStore({ dir: '', fs: fakeFs({}), ...base }))).toBe('key_dir_invalid');
    expect(codeOf(() => createFileKeyStore({ dir: DIR, fs: fakeFs({}), ...base, repoRoot: '  ' }))).toBe('key_dir_invalid');
  });
  it('D-3 a key directory that is a LINK into the repository is refused (injected realpath, both sides resolved)', () => {
    const map = (m: Record<string, string>) => (p: string): string => m[p] ?? p;
    expect(codeOf(() => createFileKeyStore({ dir: '/home/u/keylink', fs: fakeFs({}), ...base, realpath: map({ '/home/u/keylink': '/repo/secrets' }) }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/keys', fs: fakeFs({}), ...base, repoRoot: '/repolink', realpath: map({ '/repolink': '/repo' }) }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/mnt/alias/keys', fs: fakeFs({}), ...base, repoRoot: '/repolink', realpath: map({ '/repolink': '/repo', '/mnt/alias/keys': '/repo/keys' }) }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/home/u/keylink', fs: fakeFs({}), ...base, realpath: map({ '/home/u/keylink': '/private/keys' }) }))).toBe('no_throw');
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/keys', fs: fakeFs({}), ...base, realpath: map({ '/repo/keys': '/private/keys' }) }))).toBe('key_dir_inside_repo');
  });
  it('D-3 fails closed: a realpath that throws refuses with key_dir_invalid', () => {
    const boom = (): string => { throw new Error('EACCES'); };
    expect(codeOf(() => createFileKeyStore({ dir: '/private/keys', fs: fakeFs({}), ...base, realpath: boom }))).toBe('key_dir_invalid');
  });
  it('has() answers presence without returning or reading the value', () => {
    const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: SECRET }, [`${DIR}/LINK_KEY`]: { text: SECRET, symlink: true } });
    const store = storeOf(fs);
    expect(store.has('XAI_API_KEY')).toBe(true);
    expect(store.has('OPENAI_API_KEY')).toBe(false);
    expect(store.has('LINK_KEY')).toBe(false);
    expect(fs.reads).toEqual([]);
  });
});

describe('assertNoProviderKeysInEnv (the coder session inherits the bridge env)', () => {
  it('refuses when ANY logical key name is present in the env, even with an empty value; names the variables, never a value', () => {
    expect(assertNoProviderKeysInEnv({ PATH: '/bin' }, ['OPENAI_API_KEY', 'XAI_API_KEY'])).toEqual({ ok: true });
    const r = assertNoProviderKeysInEnv({ PATH: '/bin', XAI_API_KEY: SECRET }, ['OPENAI_API_KEY', 'XAI_API_KEY']);
    expect(r).toEqual({ ok: false, code: 'provider_key_in_env', names: ['XAI_API_KEY'] });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(assertNoProviderKeysInEnv({ OPENAI_API_KEY: '' }, ['OPENAI_API_KEY'])).toMatchObject({ ok: false });
    expect(assertNoProviderKeysInEnv({ OPENAI_API_KEY: undefined }, ['OPENAI_API_KEY'])).toEqual({ ok: true });
  });
  it('unrelated variable names do not trigger it (names only: values are never compared)', () => {
    expect(assertNoProviderKeysInEnv({ SOME_TOKEN: 'x' }, ['XAI_API_KEY'])).toEqual({ ok: true });
  });
});

describe('SOURCE SCAN: the key-store scan moved onto this file and catches env aliases', () => {
  const source = readFileSync(join(__dirname, 'julius-key-store.ts'), 'utf8');
  it('the key store reads no environment, including bracket access and a createRequire alias', () => {
    expect(envReadAliases(source)).toEqual([]);
  });
  it.each([
    ["process['env']", "const x = process['env'];"],
    ['process["env"]', 'const x = process["env"];'],
    ['process.env', 'const x = process.env;'],
    ['createRequire alias', "import { createRequire as makeRequire } from 'node:module'; const r = makeRequire(import.meta.url);"],
    ["require('process')", "const p = require('process');"],
    ['globalThis.process', 'const x = globalThis.process;'],
    ["globalThis['process']", "const x = globalThis['process'];"],
    ['global.process', 'const x = global.process;'],
  ])('MUTANT %s is caught', (_name, line) => {
    expect(envReadAliases(`${source}\n${line}`).length).toBeGreaterThan(0);
  });
  it('a comment that names the patterns is not a read', () => {
    expect(envReadAliases(`${source}\n// process.env createRequire\n/* process['env'] */`)).toEqual([]);
  });
});
