import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRepositoryRegistrationStore } from './repository-registration-node';
import { createRepositoryRegistration } from '../mission/repository-target';
import type { RepositoryPermission, RepositoryRegistration } from '../mission/repository-target';

/**
 * THE DURABLE REGISTRATION STORE.
 *
 * Registration is the authorization spine; a store that loses it on restart, or
 * trusts a corrupt file, or answers "no registrations" for a directory it could
 * not read, would be worse than no store. These hold each of those.
 */

const NOW = '2026-08-12T09:00:00.000Z';
const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'relay-regstore-'));
  roots.push(r);
  return r;
}

function registration(name: string, over: { provider?: 'local' | 'github' } = {}): RepositoryRegistration {
  const provider = over.provider ?? 'local';
  const grants: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit'];
  const result = createRepositoryRegistration({
    draft: {
      identity: provider === 'local'
        ? { provider: 'local', host: null, owner: null, name, defaultBranch: 'main' }
        : { provider: 'github', host: 'github.com', owner: 'o', name, defaultBranch: 'main' },
      location: provider === 'local'
        ? { kind: 'local_path', path: `/tmp/${name}` }
        : { kind: 'remote_clone', cloneUrl: `https://github.com/o/${name}.git` },
      scope: { read: ['**'], write: ['src/**'] },
      grants: grants.map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('a registration survives a restart', () => {
  it('is readable by a brand-new store instance over the same root', () => {
    const r = root();
    const reg = registration('demo');
    createRepositoryRegistrationStore({ root: r }).save(reg);

    // A second store, as a restart would create — no shared memory.
    const reopened = createRepositoryRegistrationStore({ root: r });
    const got = reopened.get(reg.key);
    expect(got).not.toBeNull();
    expect(got?.key).toBe(reg.key);
    expect(got?.identity.name).toBe('demo');
    expect(got?.grants.map((g) => g.permission)).toContain('commit');
  });

  it('lists every registration, and by value not by shared reference', () => {
    const r = root();
    const store = createRepositoryRegistrationStore({ root: r });
    store.save(registration('one'));
    store.save(registration('two', { provider: 'github' }));
    const listed = createRepositoryRegistrationStore({ root: r }).list();
    expect(listed).not.toBeNull();
    expect(listed?.map((x) => x.identity.name).sort()).toEqual(['one', 'two']);
  });

  it('a re-registration REPLACES the prior file for the same key', () => {
    const r = root();
    const store = createRepositoryRegistrationStore({ root: r });
    store.save(registration('demo'));
    // Same identity → same key; a wider scope is a human re-registration.
    const wider = { ...registration('demo'), scope: { read: ['**'], write: ['**'] } };
    store.save(wider);
    const files = readdirSync(join(r, 'repository-registrations')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(store.get(wider.key)?.scope.write).toEqual(['**']);
  });
});

describe('the store never trusts a file it cannot verify', () => {
  it('returns null for an absent key', () => {
    expect(createRepositoryRegistrationStore({ root: root() }).get('local:nope')).toBeNull();
  });

  it('returns null for a file whose stored key does not derive from its identity', () => {
    /**
     * The tamper/corruption case. A file that claims key `local:trusted` but
     * carries the identity of `local:other` must not be honoured — a capability
     * read from an unverified file is not a capability.
     */
    const r = root();
    const dir = join(r, 'repository-registrations');
    mkdirSync(dir, { recursive: true });
    const reg = registration('other');
    const tampered = { ...reg, key: 'local:trusted' };
    writeFileSync(join(dir, `${encodeURIComponent('local:trusted')}.json`), JSON.stringify(tampered));
    expect(createRepositoryRegistrationStore({ root: r }).get('local:trusted')).toBeNull();
  });

  it('returns null for a truncated / non-JSON file', () => {
    const r = root();
    const dir = join(r, 'repository-registrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${encodeURIComponent('local:demo')}.json`), '{ "key": "local:demo", ');
    expect(createRepositoryRegistrationStore({ root: r }).get('local:demo')).toBeNull();
  });

  it('SKIPS a corrupt file in list rather than dropping the whole list', () => {
    const r = root();
    const store = createRepositoryRegistrationStore({ root: r });
    store.save(registration('good'));
    const dir = join(r, 'repository-registrations');
    writeFileSync(join(dir, 'corrupt.json'), 'not json at all');
    const listed = store.list();
    expect(listed).not.toBeNull();
    expect(listed?.map((x) => x.identity.name)).toEqual(['good']);
  });
});

describe('unknown is not empty', () => {
  it('list() returns [] for a never-created store', () => {
    expect(createRepositoryRegistrationStore({ root: root() }).list()).toEqual([]);
  });

  it('list() returns null when the directory cannot be read', () => {
    /**
     * A path that EXISTS AS A FILE where the directory should be: `readdirSync`
     * throws ENOTDIR, which is "unknown", not "empty". Admitting a Mission
     * against unknown = none is the failure this distinction prevents.
     */
    const r = root();
    // Create the registrations path as a FILE, not a directory.
    writeFileSync(join(r, 'repository-registrations'), 'i am not a directory');
    expect(createRepositoryRegistrationStore({ root: r }).list()).toBeNull();
  });
});
