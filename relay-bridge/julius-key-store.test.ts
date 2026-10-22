import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertNoProviderKeysInEnv, createFileKeyStore, KeyStoreError, type KeyStoreFs } from './julius-key-store';

const SECRET = 'canary_keystore_ZZ9_x7Q2m4k8w1';
const DIR = '/private/keys';

interface FakeFs extends KeyStoreFs { readonly reads: string[]; files: Record<string, { text: string; mode: number }> }
const fakeFs = (files: Record<string, { text: string; mode?: number }>, over: Partial<KeyStoreFs> = {}): FakeFs => {
  const held: FakeFs = {
    reads: [],
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { text: v.text, mode: v.mode ?? 0o600 }])),
    readFileSync(path) { held.reads.push(path); const f = held.files[path]; if (f === undefined) { const e = new Error(`ENOENT ${path}`) as Error & { code: string }; e.code = 'ENOENT'; throw e; } return f.text; },
    statSync(path) { const f = held.files[path]; if (f === undefined) { const e = new Error(`ENOENT ${path}`) as Error & { code: string }; e.code = 'ENOENT'; throw e; } return { isFile: () => true, mode: f.mode }; },
    ...over,
  };
  return held;
};
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { return e instanceof KeyStoreError ? e.code : `other:${String(e)}`; } return 'no_throw'; };

describe('KeyStore (file per key, private path outside the repo)', () => {
  it('reads the key at CALL time on every call and never caches it', () => {
    const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: `${SECRET}\n` } });
    const store = createFileKeyStore({ dir: DIR, fs, platform: 'linux' });
    expect(fs.reads).toEqual([]);
    expect(store.getKey('XAI_API_KEY')).toBe(SECRET);
    fs.files[`${DIR}/XAI_API_KEY`] = { text: 'rotated_value_0123456789', mode: 0o600 };
    expect(store.getKey('XAI_API_KEY')).toBe('rotated_value_0123456789');
    delete fs.files[`${DIR}/XAI_API_KEY`];
    expect(codeOf(() => store.getKey('XAI_API_KEY'))).toBe('key_file_absent');
    expect(fs.reads).toHaveLength(2);
  });
  it('an absent file, an unreadable file, an empty file and a too-open mode each refuse with a CODE; no message carries the path or the value', () => {
    const fs = fakeFs({ [`${DIR}/EMPTY_KEY`]: { text: '  \n' }, [`${DIR}/OPEN_KEY`]: { text: SECRET, mode: 0o644 }, [`${DIR}/DENIED_KEY`]: { text: SECRET } });
    const denied = { ...fs, readFileSync: (p: string) => { if (p.endsWith('DENIED_KEY')) { const e = new Error(`EACCES ${p} ${SECRET}`) as Error & { code: string }; e.code = 'EACCES'; throw e; } return fs.readFileSync(p); } };
    const store = createFileKeyStore({ dir: DIR, fs: denied, platform: 'linux' });
    expect(codeOf(() => store.getKey('NOPE_API_KEY'))).toBe('key_file_absent');
    expect(codeOf(() => store.getKey('DENIED_KEY'))).toBe('key_file_unreadable');
    expect(codeOf(() => store.getKey('EMPTY_KEY'))).toBe('key_file_empty');
    expect(codeOf(() => store.getKey('OPEN_KEY'))).toBe('key_file_mode_too_open');
    for (const name of ['NOPE_API_KEY', 'DENIED_KEY', 'EMPTY_KEY', 'OPEN_KEY']) {
      try { store.getKey(name); } catch (e) { const text = `${(e as Error).message} ${JSON.stringify(e)} ${String((e as Error).stack)}`; expect(text).not.toContain(SECRET); expect(text).not.toContain(DIR); }
    }
  });
  it('the mode check is skipped only where the platform has no POSIX modes (win32)', () => {
    const fs = fakeFs({ [`${DIR}/OPEN_KEY`]: { text: SECRET, mode: 0o666 } });
    expect(createFileKeyStore({ dir: DIR, fs, platform: 'win32' }).getKey('OPEN_KEY')).toBe(SECRET);
    expect(codeOf(() => createFileKeyStore({ dir: DIR, fs, platform: 'darwin' }).getKey('OPEN_KEY'))).toBe('key_file_mode_too_open');
  });
  it('a name that could escape the directory is refused before any file is touched', () => {
    const fs = fakeFs({});
    const store = createFileKeyStore({ dir: DIR, fs, platform: 'linux' });
    for (const bad of ['../x', 'a/b', 'a\\b', '', 'lower_case', 'X'.repeat(80), 'A B']) expect(codeOf(() => store.getKey(bad)), bad).toBe('key_name_invalid');
    expect(fs.reads).toEqual([]);
  });
  it('a key directory inside the repository is refused at construction', () => {
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/relay-bridge/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: (p) => p }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/../private', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: (p) => p }))).toBe('no_throw');
    expect(codeOf(() => createFileKeyStore({ dir: '', fs: fakeFs({}), platform: 'linux' }))).toBe('key_dir_invalid');
  });
  it('D-3 a key directory that is a LINK into the repository is refused (injected realpath, both sides resolved)', () => {
    const map = (m: Record<string, string>) => (p: string): string => m[p] ?? p;
    // a link outside the repo whose target is inside it
    expect(codeOf(() => createFileKeyStore({ dir: '/home/u/keylink', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: map({ '/home/u/keylink': '/repo/secrets' }) }))).toBe('key_dir_inside_repo');
    // the repo root itself reached through a link
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repolink', realpath: map({ '/repolink': '/repo' }) }))).toBe('key_dir_inside_repo');
    expect(codeOf(() => createFileKeyStore({ dir: '/mnt/alias/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repolink', realpath: map({ '/repolink': '/repo', '/mnt/alias/keys': '/repo/keys' }) }))).toBe('key_dir_inside_repo');
    // a real private directory, even through a link, is accepted
    expect(codeOf(() => createFileKeyStore({ dir: '/home/u/keylink', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: map({ '/home/u/keylink': '/private/keys' }) }))).toBe('no_throw');
    // the lexical check still applies when the real path happens to look fine
    expect(codeOf(() => createFileKeyStore({ dir: '/repo/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: map({ '/repo/keys': '/private/keys' }) }))).toBe('key_dir_inside_repo');
  });
  it('D-3 fails closed: a realpath that throws, or a repoRoot without a realpath, refuses with key_dir_invalid', () => {
    const boom = (): string => { throw new Error('EACCES'); };
    expect(codeOf(() => createFileKeyStore({ dir: '/private/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo', realpath: boom }))).toBe('key_dir_invalid');
    expect(codeOf(() => createFileKeyStore({ dir: '/private/keys', fs: fakeFs({}), platform: 'linux', repoRoot: '/repo' }))).toBe('key_dir_invalid');
  });
  it('has() answers presence without returning or caching the value', () => {
    const fs = fakeFs({ [`${DIR}/XAI_API_KEY`]: { text: SECRET } });
    const store = createFileKeyStore({ dir: DIR, fs, platform: 'linux' });
    expect(store.has('XAI_API_KEY')).toBe(true);
    expect(store.has('OPENAI_API_KEY')).toBe(false);
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

describe('SOURCE SCAN: no process.env key read', () => {
  const code = (file: string): string => readFileSync(join(__dirname, file), 'utf8').split(/\r?\n/u).filter((l) => !/^\s*(\*|\/\/|\/\*)/u.test(l)).join('\n');
  it('the key store, the wiring and the controller read no key from process.env; the controller reads keys only through the store when one is given', () => {
    for (const file of ['julius-key-store.ts', 'julius-dispatch-wiring.ts', 'julius-dispatch-wiring-core.ts', 'julius-dispatch-wiring-real.ts', 'julius-dispatch-adapters.ts', 'julius-dispatch.ts']) {
      expect(code(file), file).not.toMatch(/process\.env|process\[\s*['"]env['"]\s*\]/u);
    }
    expect(code('julius-dispatch.ts')).toMatch(/keyStore\.getKey\(/u);
  });
});
