import { githubOAuthConfigFromEnv } from './github-oauth';

/**
 * GITHUB-APP CONFIGURATION DETECTION — for the unauthenticated `/relay-api/health`.
 *
 * A running deployment must be able to DETECT its GitHub-App configuration state
 * without exposing any secret. Every field here is a BOOLEAN or a CODE derived
 * from the PRESENCE and SHAPE of an environment variable — never its value. No
 * client secret, private key, install URL, or callback URL is ever echoed; a
 * caller learns "ready / not ready" and, for the callback, "valid / why not",
 * and nothing more.
 *
 * Pure: it reads the injected `env` and touches no clock, no network, no disk.
 */

/**
 * The validity of the registered OAuth callback URL, as a CODE. `ok` only when
 * it is an absolute `https://` URL whose path ends with the registered callback
 * path. A bare host (no scheme) — which is what a misconfigured production
 * deployment carries today, and which breaks OAuth — surfaces as
 * `not_absolute_https`; a valid `https` origin pointed at the wrong path is
 * `wrong_path`; an unset value is `missing`. The URL itself is NEVER returned.
 */
export type CallbackUrlCode = 'ok' | 'not_absolute_https' | 'wrong_path' | 'missing';

export interface GithubAppReadiness {
  /** CLIENT_ID + CLIENT_SECRET present — the bridge can begin user sign-in. */
  readonly githubSignInReady: boolean;
  /** APP_ID + PRIVATE_KEY present — the bridge can mint installation tokens.
   *  Presence only; the key is never read here and never surfaced. */
  readonly githubAppReady: boolean;
  /** INSTALL_URL present and non-empty — the bridge can begin an app install. */
  readonly githubInstallReady: boolean;
  /** Whether the registered callback URL is valid, as a code — never the value. */
  readonly githubCallbackUrl: CallbackUrlCode;
}

/** The path every valid callback URL must end with. */
const CALLBACK_PATH_SUFFIX = '/relay-api/auth/github/callback';

const present = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Classify the callback URL WITHOUT revealing it. The value is only ever tested
 * for shape (scheme, path suffix); it is never placed in the returned code.
 */
function callbackUrlCode(raw: string | undefined): CallbackUrlCode {
  if (typeof raw !== 'string' || raw.trim() === '') return 'missing';
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // A bare host with no scheme — exactly what production has set today —
    // cannot be parsed as an absolute URL and lands here. OAuth cannot work
    // against it, and that must read as NOT ok.
    return 'not_absolute_https';
  }
  if (url.protocol !== 'https:') return 'not_absolute_https';
  // A trailing slash is normalized away so `/callback/` and `/callback` agree.
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.endsWith(CALLBACK_PATH_SUFFIX)) return 'wrong_path';
  return 'ok';
}

/**
 * Compute the GitHub-App readiness codes/booleans from env presence + shape.
 * Returns codes only; asserting the returned object carries no secret VALUE is
 * a property of the type, not a hope.
 */
export function githubAppReadiness(env: NodeJS.ProcessEnv): GithubAppReadiness {
  return {
    githubSignInReady: githubOAuthConfigFromEnv(env) !== null,
    githubAppReady:
      present(env.RELAY_GITHUB_APP_ID) && present(env.RELAY_GITHUB_APP_PRIVATE_KEY),
    githubInstallReady: present(env.RELAY_GITHUB_APP_INSTALL_URL),
    githubCallbackUrl: callbackUrlCode(env.RELAY_GITHUB_APP_CALLBACK_URL),
  };
}
