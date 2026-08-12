import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';

/**
 * THE REPOSITORY CREDENTIAL SEAM.
 *
 * The one place a repository credential is resolved and handed to a git
 * operation, isolated so the SOURCE of the credential can change without any
 * caller changing. Today it reads the env var the registration NAMES
 * (`GITHUB_TOKEN` for the private-beta proof). The canonical long-term source is
 * a GitHub App INSTALLATION token — short-lived, repository-scoped,
 * permission-scoped, revocable — and this interface is what that issuer will
 * implement. Relay is deliberately NOT architected around a permanent founder
 * PAT: the PAT is a temporary supplier behind this seam, nothing more.
 *
 * THE TOKEN NEVER LEAVES MEMORY IN A FORM THAT PERSISTS.
 *   - never embedded in a repository URL,
 *   - never written to `.git/config`,
 *   - never written to disk,
 *   - never handed to a git credential cache/store,
 *   - never placed in a command-line argument,
 *   - never printed, logged, put in a thrown error, an attestation, a browser
 *     response, or Project Brain,
 *   - and no length/hash/equality signal about it is exposed.
 * It reaches git through an ASKPASS helper that reads it from the CHILD's
 * environment, and the child's environment exists only for that one git call.
 */

/** A resolved credential — carried in memory, never surfaced. */
export interface RepositoryCredential {
  /** The secret material. Only `buildEphemeralGitAuth` may read it. */
  readonly token: string;
  /** Provenance, safe to record. NEVER the value. */
  readonly source: 'env_var';
  readonly envVarName: string;
}

/**
 * Resolves the credential a target authorizes. Returns null when the target
 * names no credential, or the named env var is absent/empty — fail-closed, so a
 * private operation without a credential fails rather than proceeds unauthed.
 */
export interface RepositoryCredentialProvider {
  resolve(target: MissionRepositoryTarget): RepositoryCredential | null;
}

/**
 * The current supplier: the named environment variable, read server-side. This
 * is the seam a GitHub-App installation-token issuer replaces — the callers
 * (clone, push) never learn which supplier answered.
 */
export function envVarCredentialProvider(env: NodeJS.ProcessEnv): RepositoryCredentialProvider {
  return {
    resolve(target) {
      const name = target.credential.envVarName;
      if (name === null) return null;
      const value = env[name];
      if (typeof value !== 'string' || value.trim() === '') return null;
      return { token: value, source: 'env_var', envVarName: name };
    },
  };
}

/**
 * The token-less ASKPASS helper. It carries NO secret — it echoes an env var
 * the child is given for one call. GitHub accepts `x-access-token` as the
 * username for both a PAT and an App installation token, with the token as the
 * password, so the same helper serves the temporary and the canonical supplier.
 */
const ASKPASS_SCRIPT = `#!/bin/sh
# Relay ephemeral git-askpass — contains no secret; reads the child environment.
case "$1" in
  Username*|username*) printf %s 'x-access-token' ;;
  *) printf %s "$RELAY_GIT_ASKPASS_TOKEN" ;;
esac
`;

/** The env-var name the helper reads. Not the value. */
const ASKPASS_TOKEN_ENV = 'RELAY_GIT_ASKPASS_TOKEN';

export interface EphemeralGitAuth {
  /**
   * Extra env for THIS git child only. Holds the token under
   * `RELAY_GIT_ASKPASS_TOKEN` and points `GIT_ASKPASS` at the token-less helper.
   * Never merge this into the parent `process.env`.
   */
  readonly extraEnv: Record<string, string>;
  /**
   * `-c` arguments that must lead every authed git command: they disable every
   * credential store/cache and the system config, so nothing about the token is
   * persisted by git itself.
   */
  readonly configArgs: readonly string[];
  /** Removes the temp helper. Call in a `finally`, always. */
  readonly dispose: () => void;
}

/**
 * Build the ephemeral auth for one repository operation.
 *
 * With a credential: writes the token-less helper to a fresh 0700 temp dir,
 * points `GIT_ASKPASS` at it, and puts the token in the child env only. With no
 * credential: returns the config disables and NO askpass — combined with
 * `GIT_TERMINAL_PROMPT=0` (set by `runGit`'s `gitEnv`), an operation needing a
 * credential fails closed instead of prompting or reaching unauthenticated.
 */
export function buildEphemeralGitAuth(credential: RepositoryCredential | null): EphemeralGitAuth {
  const configArgs = [
    '-c', 'credential.helper=',            // no store/cache writes the token anywhere
    '-c', 'credential.useHttpPath=true',
  ] as const;

  if (credential === null) {
    return { extraEnv: {}, configArgs: [...configArgs], dispose: () => {} };
  }

  const dir = mkdtempSync(join(tmpdir(), 'relay-git-askpass-'));
  const helper = join(dir, 'askpass.sh');
  writeFileSync(helper, ASKPASS_SCRIPT, { mode: 0o700 });
  chmodSync(helper, 0o700);

  return {
    extraEnv: {
      GIT_ASKPASS: helper,
      [ASKPASS_TOKEN_ENV]: credential.token,
      GIT_CONFIG_NOSYSTEM: '1',
    },
    configArgs: [...configArgs],
    dispose: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — the helper holds no secret anyway */
      }
    },
  };
}

/**
 * Remove any `user:pass@` userinfo from a URL before it is logged, thrown or
 * persisted. Relay never PUTS a credential in a URL, so this is defence in
 * depth: a URL that arrives with userinfo (from a registration, a redirect)
 * still never carries it into an error message or an attestation.
 */
export function sanitizeRemoteUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    // Not a parseable URL — strip a `scheme://user:pass@host` prefix textually.
    return raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*@/, '$1');
  }
}
