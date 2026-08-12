import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildEphemeralGitAuth,
  envVarCredentialProvider,
  sanitizeRemoteUrl,
} from './repository-credential';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';

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
  it('removes user:password@ from an https URL', () => {
    const cleaned = sanitizeRemoteUrl(`https://x-access-token:${TOKEN}@github.com/o/r.git`);
    expect(cleaned).not.toContain(TOKEN);
    expect(cleaned).toContain('github.com/o/r');
  });
  it('leaves a clean URL unchanged', () => {
    expect(sanitizeRemoteUrl('https://github.com/o/r.git')).toContain('github.com/o/r');
  });
});
