/**
 * OBSERVE THE CODING AGENT'S LOGIN IN THE CODING AGENT'S OWN ENVIRONMENT.
 *
 * The earlier probe asked the `claude` on the operator's PATH, in the PARENT's
 * environment, whether a stored login existed. That cannot answer for a GitHub
 * runner — no `claude` on PATH, no stored login — and it was never the same
 * question as "what will the child authenticate with": the child is started by the
 * Agent SDK, from the executable the SDK bundles, with the environment
 * `hostedChildEnv` composed.
 *
 * So this runs `auth status --json` with EXACTLY that executable and EXACTLY that
 * environment, and hands the stdout to the pure `classifyClaudeAuthStatus`. The raw
 * output is never returned, logged or stored; stderr is discarded unread. No model
 * is called: `auth status` is a local query (measured 2026-09-29: it answered for a
 * placeholder token offline, which is also why it proves the PATH and not that a
 * token is live — the workflow's subscription smoke is what proves that).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { CODER_CLAUDE_EXECUTABLE_ENV, classifyClaudeAuthStatus, type ClaudeLoginObservation } from './hosted-auth';

export { CODER_CLAUDE_EXECUTABLE_ENV };

const SDK_PLATFORM_PREFIX = '@anthropic-ai/claude-agent-sdk';

/**
 * The candidates the Agent SDK itself tries, in its own order (sdk.mjs 0.3.220:
 * glibc before musl on Linux, `.exe` on Windows).
 */
export function sdkExecutableCandidates(platform: string = process.platform, arch: string = process.arch): readonly string[] {
  const suffix = platform === 'win32' ? '.exe' : '';
  const packages = platform === 'linux'
    ? [`${SDK_PLATFORM_PREFIX}-linux-${arch}`, `${SDK_PLATFORM_PREFIX}-linux-${arch}-musl`]
    : [`${SDK_PLATFORM_PREFIX}-${platform}-${arch}`];
  return packages.map((name) => `${name}/claude${suffix}`);
}

/**
 * The executable the Coding Agent will run: the explicit override when set, else
 * the SDK's bundled binary. Null when neither exists — which the caller reports as
 * an unobservable login, never as a pass.
 */
export function resolveCoderClaudeExecutable(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env[CODER_CLAUDE_EXECUTABLE_ENV];
  if (explicit !== undefined && explicit.trim() !== '') return existsSync(explicit) ? explicit : null;
  const requireFrom = createRequire(join(process.cwd(), 'noop.js'));
  for (const candidate of sdkExecutableCandidates()) {
    try {
      const resolved = requireFrom.resolve(candidate);
      if (existsSync(resolved)) return resolved;
    } catch {
      /* not installed for this platform */
    }
  }
  return null;
}

export type LoginSpawn = (executable: string, args: readonly string[], env: Record<string, string>) => string | null;

const spawnAuthStatus: LoginSpawn = (executable, args, env) => {
  const result = spawnSync(executable, [...args], {
    env, encoding: 'utf8', timeout: 30_000, windowsHide: true,
    // stderr is discarded unread: nothing a CLI prints there may reach a record.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error !== undefined) return null;
  return typeof result.stdout === 'string' ? result.stdout : null;
};

/**
 * Run `auth status --json` in the child's composed environment and classify it.
 * An executable that is missing or cannot start is `not_logged_in` — fail closed.
 */
export function observeCoderLogin(input: {
  readonly executable: string | null;
  readonly childEnv: Record<string, string>;
  readonly spawn?: LoginSpawn;
}): ClaudeLoginObservation {
  if (input.executable === null) return classifyClaudeAuthStatus(null);
  const spawn = input.spawn ?? spawnAuthStatus;
  return classifyClaudeAuthStatus(spawn(input.executable, ['auth', 'status', '--json'], input.childEnv));
}
