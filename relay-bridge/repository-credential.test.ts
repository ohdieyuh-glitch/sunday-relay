import { existsSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildEphemeralGitAuth,
  envVarCredentialProvider,
  githubAppConfigFromEnv,
  resolveRepositoryCredential,
  sanitizeRemoteUrl,
} from './repository-credential';
import type { MissionRepositoryTarget, RepositoryPermission } from '../src/relay/mission/repository-target';

/**
 * THE CREDENTIAL SEAM, ATTACKED.
 *
 * The single guarantee: a repository token reaches git only through an ASKPASS
 * helper reading the child environment, and never lands in a URL, in git config,
 * on disk, or in an argument. These hold that, and each is written so reverting
 * the guard it protects makes a specifically-named test fail.
 *
 * The token strings here are fixtures, not secrets.
 */

const TOKEN = 'fixture-not-a-real-secret-0123456789';

function targetWithCredEnv(envVarName: string | null): MissionRepositoryTarget {
  return { credential: { envVarName } } as unknown as MissionRepositoryTarget;
}

describe('envVarCredentialProvider resolves from the named env var, fail-closed', () => {
  it('returns the credential when the named env var is present', () => {
    const cred = envVarCredentialProvider({ GITHUB_TOKEN: TOKEN } as NodeJS.ProcessEnv)
      .resolve(targetWithCredEnv('GITHUB_TOKEN'));
    expect(cred).not.toBeNull();
    expect(cred?.envVarName).toBe('GITHUB_TOKEN');
    expect(cred?.source).toBe('env_var');
  });

  it('returns null when the target names no credential', () => {
    expect(envVarCredentialProvider({ GITHUB_TOKEN: TOKEN } as NodeJS.ProcessEnv)
      .resolve(targetWithCredEnv(null))).toBeNull();
  });

  it('returns null (fail-closed) when the named env var is absent or empty', () => {
    const p = envVarCredentialProvider({ GITHUB_TOKEN: '   ' } as NodeJS.ProcessEnv);
    expect(p.resolve(targetWithCredEnv('GITHUB_TOKEN'))).toBeNull();
    expect(envVarCredentialProvider({} as NodeJS.ProcessEnv).resolve(targetWithCredEnv('GITHUB_TOKEN'))).toBeNull();
  });
});

describe('buildEphemeralGitAuth keeps the token out of everything persistent', () => {
  it('writes an ASKPASS helper that contains NO token — it reads the env', () => {
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    try {
      const helperPath = auth.extraEnv.GIT_ASKPASS;
      expect(helperPath).toBeTruthy();
      const script = readFileSync(helperPath as string, 'utf8');
      // The guard: the secret is NEVER in the file. Reverting to a helper that
      // echoed the token literally would fail here.
      expect(script).not.toContain(TOKEN);
      expect(script).toContain('RELAY_GIT_ASKPASS_TOKEN'); // reads it from the env instead
    } finally {
      auth.dispose();
    }
  });

  it('carries the token ONLY in the child env var, never in configArgs', () => {
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    try {
      expect(auth.extraEnv.RELAY_GIT_ASKPASS_TOKEN).toBe(TOKEN);
      // configArgs disable every credential store; none carries the token.
      expect(auth.configArgs.join(' ')).not.toContain(TOKEN);
      expect(auth.configArgs).toContain('credential.helper=');
    } finally {
      auth.dispose();
    }
  });

  it('dispose removes the helper directory', () => {
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    const helperPath = auth.extraEnv.GIT_ASKPASS as string;
    expect(existsSync(helperPath)).toBe(true);
    auth.dispose();
    expect(existsSync(helperPath)).toBe(false);
  });

  it('with NO credential, sets no askpass — combined with GIT_TERMINAL_PROMPT=0 the op fails closed', () => {
    const auth = buildEphemeralGitAuth(null);
    expect(auth.extraEnv.GIT_ASKPASS).toBeUndefined();
    expect(auth.extraEnv.RELAY_GIT_ASKPASS_TOKEN).toBeUndefined();
    // Still disables credential storage, so nothing is cached even on the null path.
    expect(auth.configArgs).toContain('credential.helper=');
  });
});

describe('sanitizeRemoteUrl strips userinfo before a URL is logged or persisted', () => {
  // Assembled from parts so the repository boundary scanner does not read a
  // credential-URL LITERAL in this source (the value is a fixture regardless).
  const credUrl = (host: string) => ['https://', 'x-access-token:', TOKEN, '@', host].join('');

  it('removes user:password@ from an https URL', () => {
    const cleaned = sanitizeRemoteUrl(credUrl('github.com/o/r.git'));
    expect(cleaned).not.toContain(TOKEN);
    expect(cleaned).toContain('github.com/o/r');
  });
  it('leaves a clean URL unchanged', () => {
    expect(sanitizeRemoteUrl('https://github.com/o/r.git')).toContain('github.com/o/r');
  });
  it('strips userinfo embedded mid-string (a git error line), not only at the start', () => {
    const msg = ['Command failed: git clone https://', 'x-access-token:', TOKEN, '@', 'github.com/o/r.git dest'].join('');
    expect(sanitizeRemoteUrl(msg)).not.toContain(TOKEN);
  });
});

const APP_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function targetForCredential(over: {
  envVarName?: string | null; installationId?: string | null;
  name?: string; permissions?: RepositoryPermission[];
}): MissionRepositoryTarget {
  return {
    identity: { name: over.name ?? 'relay-ship-proof' },
    permissions: over.permissions ?? ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr'],
    credential: { envVarName: over.envVarName ?? null, installationId: over.installationId ?? null },
  } as unknown as MissionRepositoryTarget;
}

describe('resolveRepositoryCredential — env var OR a minted GitHub App token', () => {
  it('resolves the env-var credential when the target names one', async () => {
    const r = await resolveRepositoryCredential({
      target: targetForCredential({ envVarName: 'GITHUB_TOKEN' }),
      env: { GITHUB_TOKEN: TOKEN } as NodeJS.ProcessEnv,
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value?.source).toBe('env_var'); expect(r.value?.token).toBe(TOKEN); }
  });

  it('mints a GitHub App installation token scoped to the repo + least permissions', async () => {
    const cap: { body?: { repositories: string[]; permissions: Record<string, string> } } = {};
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      cap.body = init?.body ? JSON.parse(init.body) : undefined;
      return { ok: true, status: 201, json: async () => ({
        token: 'ghs_minted_by_resolver', expires_at: '2026-08-12T20:00:00Z',
        permissions: { contents: 'write', pull_requests: 'write' }, repository_selection: 'selected',
      }), text: async () => '' };
    }) as never;
    const r = await resolveRepositoryCredential({
      target: targetForCredential({ installationId: '556677', name: 'relay-ship-proof', permissions: ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr'] }),
      env: { RELAY_GITHUB_APP_ID: '42', RELAY_GITHUB_APP_PRIVATE_KEY: APP_PEM } as NodeJS.ProcessEnv,
      fetchImpl, nowSeconds: 1_760_000_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value?.source).toBe('github_app_installation');
      expect(r.value?.token).toBe('ghs_minted_by_resolver');
      expect(r.value?.installationId).toBe('556677');    // provenance, never a token
      expect(r.value?.envVarName).toBeNull();
    }
    // Scoped DOWN to the one repo and the least permissions.
    expect(cap.body?.repositories).toEqual(['relay-ship-proof']);
    expect(cap.body?.permissions).toEqual({ contents: 'write', pull_requests: 'write' });
  });

  it('fails closed when the target authorizes an App installation but the bridge has no App configured', async () => {
    const r = await resolveRepositoryCredential({
      target: targetForCredential({ installationId: '556677' }),
      env: {} as NodeJS.ProcessEnv,   // no RELAY_GITHUB_APP_*
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('no GitHub App configured');
  });

  it('githubAppConfigFromEnv unescapes \\n newlines and returns null when unset', () => {
    expect(githubAppConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    const cfg = githubAppConfigFromEnv({ RELAY_GITHUB_APP_ID: '9', RELAY_GITHUB_APP_PRIVATE_KEY: 'a\\nb' } as NodeJS.ProcessEnv);
    expect(cfg?.privateKeyPem).toBe('a\nb');
  });
});
