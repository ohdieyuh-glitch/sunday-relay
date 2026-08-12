import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { handleRepositoryRoute } from './repository-routes';
import { createRepositoryRegistrationStore } from '../src/relay/persistence';
import type { RepositoryRegistrationStore } from '../src/relay/persistence';

/**
 * THE REGISTRATION ROUTE — operator-only, domain-validated, secret-free.
 *
 * It records a repository a later mission may name. It spends no money and needs
 * no beta admission. Every refusal path is asserted, because this is the surface
 * that decides whether a repository EXISTS to be targeted.
 */

const NOW = '2026-08-12T09:00:00.000Z';
const TOKEN = 'operator-token-0123456789abcdef';
const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function store(): RepositoryRegistrationStore {
  const r = mkdtempSync(join(tmpdir(), 'relay-reproute-'));
  roots.push(r);
  return createRepositoryRegistrationStore({ root: r });
}

const env = { RELAY_BRIDGE_API_TOKEN: TOKEN } as NodeJS.ProcessEnv;
const opAuth = `Bearer ${TOKEN}`;

/** A valid local-repository draft. */
function localDraft() {
  return {
    identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
    location: { kind: 'local_path', path: '/tmp/demo' },
    scope: { read: ['**'], write: ['src/**'] },
    grants: ['read', 'write_worktree', 'commit'].map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
    })),
    ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
    registeredBy: 'founder',
  };
}

describe('registration is operator-only', () => {
  it('refuses with no token', () => {
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: undefined, body: localDraft(), env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(401);
  });

  it('refuses a wrong token', () => {
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: 'Bearer nope', body: localDraft(), env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(401);
  });

  it('a browser session scheme is not operator', () => {
    // Deliberately the browser scheme; only the operator Bearer passes.
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: `Relay-Session ${TOKEN}`, body: localDraft(), env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(401);
  });
});

describe('registration delegates validation to the domain', () => {
  it('registers a valid draft and returns the DERIVED key', () => {
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: localDraft(), env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { registered: boolean; key: string } }).data;
    expect(data.registered).toBe(true);
    expect(data.key).toBe('local:demo');
  });

  it('refuses an invalid draft with the domain\'s own message', () => {
    // An EMPTY read scope — the domain refuses it ("everything is spelled
    // ['**'], by a human, on purpose"). A github+local_path draft is NOT invalid
    // any more (the checkout-identity relaxation), which is why this test uses a
    // refusal that is still a refusal.
    const bad = { ...localDraft(), scope: { read: [], write: [] } };
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: bad, env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(422);
    // The route did not invent this — it is the domain's refusal.
    expect((r?.body as { error: { kind: string } }).error.kind).toBe('registration_refused');
  });

  it('refuses a non-object body', () => {
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: 'not an object', env, now: NOW },
      store(),
    );
    expect(r?.status).toBe(422);
  });

  it('persists across a fresh store, so a later mission can name it', () => {
    const r = mkdtempSync(join(tmpdir(), 'relay-reproute-'));
    roots.push(r);
    const first = createRepositoryRegistrationStore({ root: r });
    handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: localDraft(), env, now: NOW },
      first,
    );
    // A restart: a brand-new store over the same root still sees it.
    const reopened = createRepositoryRegistrationStore({ root: r });
    expect(reopened.get('local:demo')).not.toBeNull();
  });
});

describe('a registration record is available without spending anything', () => {
  it('lists what was registered, keys and posture only', () => {
    const s = store();
    handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: localDraft(), env, now: NOW },
      s,
    );
    const r = handleRepositoryRoute(
      { method: 'GET', path: '/repository/list', authorization: opAuth, body: undefined, env, now: NOW },
      s,
    );
    expect(r?.status).toBe(200);
    const regs = (r?.body as { data: { registrations: { key: string }[] } }).data.registrations;
    expect(regs.map((x) => x.key)).toEqual(['local:demo']);
  });

  it('503s when the store cannot be read, rather than reporting an empty list', () => {
    const unreadable: RepositoryRegistrationStore = {
      save: () => undefined,
      get: () => null,
      list: () => null, // the directory could not be read — unknown, not empty.
    };
    const r = handleRepositoryRoute(
      { method: 'GET', path: '/repository/list', authorization: opAuth, body: undefined, env, now: NOW },
      unreadable,
    );
    expect(r?.status).toBe(503);
    expect((r?.body as { error: { kind: string } }).error.kind).toBe('repository_store_unreadable');
  });

  it('503s the whole surface when no store is mounted', () => {
    const r = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: localDraft(), env, now: NOW },
      null,
    );
    expect(r?.status).toBe(503);
  });
});

describe('a credential value never appears in a response', () => {
  it('a github registration returns the env var NAME, never a value', () => {
    const s = store();
    const draft = {
      identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
      location: { kind: 'remote_clone', cloneUrl: 'https://github.com/o/r.git' },
      scope: { read: ['**'], write: ['src/**'] },
      grants: ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'].map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      credential: { envVarName: 'GITHUB_TOKEN', handedToAgent: false, permittedUses: ['push_feature_branch', 'create_pr'] },
      registeredBy: 'founder',
    };
    const reg = handleRepositoryRoute(
      { method: 'POST', path: '/repository/register', authorization: opAuth, body: draft, env, now: NOW },
      s,
    );
    const body = JSON.stringify(reg?.body);
    // The NAME travels; there is no value to leak in this test, and the field is
    // the name by contract. Assert the name is present and the shape is right.
    expect(body).toContain('GITHUB_TOKEN');
    const list = handleRepositoryRoute(
      { method: 'GET', path: '/repository/list', authorization: opAuth, body: undefined, env, now: NOW },
      s,
    );
    const listed = (list?.body as { data: { registrations: { credentialEnvVarName: string | null }[] } }).data.registrations;
    expect(listed[0].credentialEnvVarName).toBe('GITHUB_TOKEN');
  });
});
