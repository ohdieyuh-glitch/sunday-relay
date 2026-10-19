import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';
import { fail, ok, relayError, type RelayResult } from '../src/relay/protocol/errors';
import {
  githubAppPermissionsFor,
  issueInstallationToken,
  type IssueInstallationTokenInput,
} from './github-app-installation';

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
  /** Provenance, safe to record. NEVER the value. An env var (founder PAT) or a
   *  short-lived GitHub App installation token (the user-safe path). */
  readonly source: 'env_var' | 'github_app_installation';
  /** For an env_var credential, the variable name; null for an App installation. */
  readonly envVarName: string | null;
  /** For a github_app_installation, the installation id (provenance, never a token). */
  readonly installationId?: string | null;
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
 * The env-var supplier: the named environment variable, read server-side. The
 * founder-PAT path, kept for the operator flow and as a fallback; the user-safe
 * path is a GitHub App installation (see `resolveRepositoryCredential`).
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

/** The GitHub App the bridge holds, read server-side. The private key is held
 *  ONLY in memory here and never surfaced — the same discipline as a repo token. */
export interface GitHubAppServerConfig {
  readonly appId: string;
  readonly privateKeyPem: string;
}

/**
 * Read the GitHub App config from server-side env: `RELAY_GITHUB_APP_ID` and
 * `RELAY_GITHUB_APP_PRIVATE_KEY` (PEM; env stores often escape newlines as `\n`,
 * which are restored). Returns null when the App is not configured — the bridge
 * then has no user-safe credential path and says so, rather than falling back.
 */
export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv): GitHubAppServerConfig | null {
  const appId = env.RELAY_GITHUB_APP_ID;
  const keyRaw = env.RELAY_GITHUB_APP_PRIVATE_KEY;
  if (typeof appId !== 'string' || appId.trim() === '') return null;
  if (typeof keyRaw !== 'string' || keyRaw.trim() === '') return null;
  const privateKeyPem = keyRaw.includes('\\n') ? keyRaw.replace(/\\n/g, '\n') : keyRaw;
  return { appId: appId.trim(), privateKeyPem };
}

/**
 * THE ONE CREDENTIAL RESOLUTION callers should use — env var OR a GitHub App
 * installation token minted FRESH at the point of use (clone, push), scoped to
 * this repo and the least permissions the target holds. Async, because minting
 * an App token is a network call; a repo's token is short-lived, so it is minted
 * per operation rather than cached across a Mission's lifetime. Returns null when
 * the target names no credential — a private op then fails closed downstream via
 * `GIT_TERMINAL_PROMPT=0`.
 */
export async function resolveRepositoryCredential(input: {
  readonly target: MissionRepositoryTarget;
  readonly env: NodeJS.ProcessEnv;
  readonly fetchImpl?: IssueInstallationTokenInput['fetchImpl'];
  readonly nowSeconds?: number;
}): Promise<RelayResult<RepositoryCredential | null>> {
  const cb = input.target.credential;
  if (cb.installationId !== null && cb.installationId !== undefined) {
    const appConfig = githubAppConfigFromEnv(input.env);
    if (appConfig === null) {
      return fail(relayError('validation-failed',
        'This repository authorizes a GitHub App installation, but the bridge has no GitHub App configured.'));
    }
    const minted = await issueInstallationToken({
      appIdentity: appConfig,
      installationId: cb.installationId,
      repositories: [input.target.identity.name],
      permissions: githubAppPermissionsFor(input.target.permissions),
      fetchImpl: input.fetchImpl,
      nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    });
    if (!minted.ok) return minted;
    return ok({
      token: minted.value.token,
      source: 'github_app_installation',
      envVarName: null,
      installationId: cb.installationId,
    });
  }
  return ok(envVarCredentialProvider(input.env).resolve(input.target));
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
    // Not a parseable URL (e.g. a git error string that embeds one) — strip any
    // `scheme://user:pass@host` ANYWHERE in the text, not only at the start, so a
    // URL embedded mid-message is redacted too. Defence in depth: registration
    // already forbids userinfo in a cloneUrl.
    return raw.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/g, '$1');
  }
}
