import { juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';

/**
 * WHERE THE DESKTOP SIGN-IN ASKS GITHUB -- and the ONE development exception.
 *
 * In every real deployment the device flow talks to https://github.com and https://api.github.com. For CORE's two-client
 * rehearsal BEFORE the founder's real identities exist, a loopback GitHub stub (scripts/github-device-stub.mjs) may stand in,
 * when -- and only when -- ALL of these hold, checked when the bridge is built:
 *   - WONDERLAND_SOCIAL_GITHUB_STUB names http://127.0.0.1:<port> and nothing else (no other host, no path, no https);
 *   - NODE_ENV is not `production`;
 *   - the bridge's database is the throwaway portable PostgreSQL, 127.0.0.1:54329.
 * Anything else with the variable set REFUSES TO START. Identities from the stub are NOT REAL: they are progress evidence
 * and never count toward R16, whose gate needs two real GitHub accounts.
 */

export interface GitHubRoots {
  readonly oauthRoot: string;
  readonly apiRoot: string;
  /** True only for the development stub. */
  readonly stub: boolean;
}

export const GITHUB_STUB_ENV = 'WONDERLAND_SOCIAL_GITHUB_STUB';
export const GITHUB_STUB_BANNER = 'GITHUB STUB ACTIVE: identities are NOT real (development rehearsal only; never R16 evidence)';

const REAL: GitHubRoots = Object.freeze({ oauthRoot: 'https://github.com', apiRoot: 'https://api.github.com', stub: false });
const THROWAWAY_DB = /^postgres(ql)?:\/\/[^@/]*@127\.0\.0\.1:54329\/[A-Za-z0-9_]+$/;

export function githubRootsForNativeSignIn(env: NodeJS.ProcessEnv): GitHubRoots {
  const raw = env[GITHUB_STUB_ENV];
  if (raw === undefined || raw.trim() === '') return REAL;
  if (env.NODE_ENV === 'production') {
    throw new Error(`${GITHUB_STUB_ENV} is set in production: refusing to start (the GitHub stub is a development rehearsal only).`);
  }
  const match = /^http:\/\/127\.0\.0\.1:(\d{2,5})\/?$/.exec(raw.trim());
  const port = match === null ? 0 : Number(match[1]);
  if (match === null || port < 1024 || port > 65535) {
    throw new Error(`${GITHUB_STUB_ENV} must be http://127.0.0.1:<port> (loopback only): refusing to start.`);
  }
  const database = juliusRuntimeDatabaseUrl(env);
  if (database === null || !THROWAWAY_DB.test(database)) {
    throw new Error(`${GITHUB_STUB_ENV} is allowed only with the throwaway database on 127.0.0.1:54329: refusing to start.`);
  }
  const root = `http://127.0.0.1:${port}`;
  return { oauthRoot: root, apiRoot: root, stub: true };
}
