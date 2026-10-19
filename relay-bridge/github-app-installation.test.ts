import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { mintAppJwt } from './github-app-identity';
import {
  githubAppPermissionsFor,
  issueInstallationToken,
  type InstallationToken,
} from './github-app-installation';
import type { RepositoryPermission } from '../src/relay/mission/repository-target';

/**
 * THE GITHUB APP INSTALLATION-TOKEN SEAM.
 *
 * The one guarantee: the App private key and the installation token reach GitHub
 * and the credential seam, and NOWHERE else — never a URL, log, error, or return
 * value they should not be in. And the token is scoped DOWN to one repo and the
 * least permissions the Mission needs. These hold both.
 *
 * The keys/tokens here are generated/fixtures, not secrets.
 */

const NOW = 1_760_000_000; // fixed injected clock (seconds)
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

describe('mintAppJwt produces a real, verifiable RS256 App JWT', () => {
  it('is three segments, RS256, iss=appId, ~10min ttl, and verifies against the public key', () => {
    const r = mintAppJwt({ appId: '123456', privateKeyPem: PEM }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [h, p, s] = r.value.split('.');
    expect(decodeSegment(h!).alg).toBe('RS256');
    const payload = decodeSegment(p!);
    expect(payload.iss).toBe('123456');
    expect(payload.iat as number).toBeLessThan(NOW);        // backdated for clock skew
    expect(payload.exp as number).toBeGreaterThan(NOW);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(10 * 60);
    // The signature genuinely verifies — this is a real JWT, not a fabrication.
    const signingInput = `${h}.${p}`;
    const okSig = cryptoVerify('sha256', Buffer.from(signingInput, 'utf8'), publicKey, Buffer.from(s!, 'base64url'));
    expect(okSig).toBe(true);
  });

  it('never embeds the private key in the JWT', () => {
    const r = mintAppJwt({ appId: '123456', privateKeyPem: PEM }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toContain('PRIVATE KEY');
  });

  it('fails closed on a missing/invalid key or app id, and the error carries no key', () => {
    const noId = mintAppJwt({ appId: '   ', privateKeyPem: PEM }, NOW);
    expect(noId.ok).toBe(false);
    const noKey = mintAppJwt({ appId: '1', privateKeyPem: 'not-a-key' }, NOW);
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error.message).not.toContain('not-a-key');
  });
});

describe('githubAppPermissionsFor scopes DOWN to least privilege', () => {
  const perm = (ps: RepositoryPermission[]) => githubAppPermissionsFor(ps);
  it('read-only → contents:read, no pull_requests', () => {
    expect(perm(['read', 'write_worktree'])).toEqual({ contents: 'read' });
  });
  it('commit/push → contents:write', () => {
    expect(perm(['read', 'write_worktree', 'commit', 'push_feature_branch']).contents).toBe('write');
  });
  it('create_pr → pull_requests:write; merge_pr → contents:write + pull_requests:write', () => {
    expect(perm(['read', 'create_pr']).pull_requests).toBe('write');
    const m = perm(['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr']);
    expect(m).toEqual({ contents: 'write', pull_requests: 'write' });
  });
});

describe('issueInstallationToken mints a scoped token and never leaks the secret', () => {
  const goodFetch = (captured: { url?: string; body?: unknown; auth?: string }) =>
    (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      captured.url = url;
      captured.body = init?.body ? JSON.parse(init.body) : undefined;
      captured.auth = init?.headers?.Authorization;
      return {
        ok: true, status: 201,
        json: async () => ({
          token: 'ghs_fixtureInstallationToken', expires_at: '2026-08-12T19:00:00Z',
          permissions: { contents: 'write', pull_requests: 'write' }, repository_selection: 'selected',
        }),
        text: async () => '',
      };
    });

  it('scopes the request to the named repo + permissions, authenticates with the JWT (not the key)', async () => {
    const cap: { url?: string; body?: unknown; auth?: string } = {};
    const r = await issueInstallationToken({
      appIdentity: { appId: '123456', privateKeyPem: PEM },
      installationId: '99887766',
      repositories: ['relay-ship-proof'],
      permissions: { contents: 'write', pull_requests: 'write' },
      fetchImpl: goodFetch(cap), nowSeconds: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t: InstallationToken = r.value;
      expect(t.token).toBe('ghs_fixtureInstallationToken');
      expect(t.repositorySelection).toBe('selected');
    }
    // Request was scoped down, and the Authorization is a Bearer JWT, never the key.
    expect(cap.url).toContain('/app/installations/99887766/access_tokens');
    expect((cap.body as { repositories: string[] }).repositories).toEqual(['relay-ship-proof']);
    expect(cap.auth).toMatch(/^Bearer /);
    expect(cap.auth).not.toContain('PRIVATE KEY');
  });

  it('refuses an unscoped mint (no repositories) and a bad installation id', async () => {
    const base = {
      appIdentity: { appId: '1', privateKeyPem: PEM }, permissions: {}, nowSeconds: NOW,
      fetchImpl: goodFetch({}),
    };
    expect((await issueInstallationToken({ ...base, installationId: '1', repositories: [] })).ok).toBe(false);
    expect((await issueInstallationToken({ ...base, installationId: 'abc', repositories: ['r'] })).ok).toBe(false);
  });

  it('a GitHub refusal returns an error carrying neither the token nor the JWT', async () => {
    const badFetch = (async () => ({
      ok: false, status: 403,
      json: async () => ({ message: 'Bad credentials', token: 'ghs_should_not_appear' }),
      text: async () => 'Bad credentials',
    })) as unknown as Parameters<typeof issueInstallationToken>[0]['fetchImpl'];
    const r = await issueInstallationToken({
      appIdentity: { appId: '1', privateKeyPem: PEM }, installationId: '5', repositories: ['r'],
      permissions: {}, fetchImpl: badFetch, nowSeconds: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain('ghs_');
      expect(r.error.message).not.toContain('PRIVATE KEY');
      expect(r.error.message).toContain('403');
    }
  });
});
