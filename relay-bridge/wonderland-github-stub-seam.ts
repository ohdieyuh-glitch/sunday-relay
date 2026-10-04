import { juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';

/**
 * WHERE THE DESKTOP SIGN-IN ASKS GITHUB -- and the ONE development exception.
 *
 * In every real deployment the device flow talks to https://github.com and https://api.github.com. For CORE's two-client
 * rehearsal BEFORE the founder's real identities exist, a loopback GitHub stub (scripts/github-device-stub.mjs) may stand in,
 * when -- and only when -- ALL of these hold, checked when the bridge is built:
 *   - WONDERLAND_SOCIAL_GITHUB_STUB names http://127.0.0.1:<port> and nothing else (no other host, no path, no https);
 *   - NODE_ENV is not `production`;
 *   - the bridge's database is a throwaway portable PostgreSQL on loopback: 127.0.0.1 on the port R16_THROWAWAY_PG_PORT names
 *     (default 54329, CORE's portable instance; Second's rehearsals set 54339). The port is never 5432 (the Docker Julius
 *     store's) and never privileged, and the database is never one named `julius`.
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

/** Which loopback port the throwaway rehearsal PostgreSQL listens on. */
export const THROWAWAY_PG_PORT_ENV = 'R16_THROWAWAY_PG_PORT';
export const DEFAULT_THROWAWAY_PG_PORT = 54329;

/** The throwaway port: R16_THROWAWAY_PG_PORT when it is a plain unprivileged port other than the live store's; unset = 54329. */
export function throwawayPgPort(env: NodeJS.ProcessEnv): number {
  const raw = env[THROWAWAY_PG_PORT_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_THROWAWAY_PG_PORT;
  const port = /^\d{4,5}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error(`${THROWAWAY_PG_PORT_ENV} must be an unprivileged loopback port other than 5432: refusing to start.`);
  }
  return port;
}

const REAL: GitHubRoots = Object.freeze({ oauthRoot: 'https://github.com', apiRoot: 'https://api.github.com', stub: false });
const throwawayDb = (pgPort: number): RegExp => new RegExp(`^postgres(ql)?://[^@/]*@127\\.0\\.0\\.1:${pgPort}/(?!julius$)[A-Za-z0-9_]+$`);

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
  const pgPort = throwawayPgPort(env);
  const database = juliusRuntimeDatabaseUrl(env);
  if (database === null || !throwawayDb(pgPort).test(database)) {
    throw new Error(`${GITHUB_STUB_ENV} is allowed only with the throwaway database on 127.0.0.1:${pgPort}: refusing to start.`);
  }
  const root = `http://127.0.0.1:${port}`;
  return { oauthRoot: root, apiRoot: root, stub: true };
}
