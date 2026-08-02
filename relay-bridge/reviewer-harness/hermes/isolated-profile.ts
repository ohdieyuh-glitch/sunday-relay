/**
 * THE ISOLATED HERMES PROFILE.
 *
 * Relay never runs the Reviewer against the operator's own `~/.hermes`. It
 * builds a throwaway HERMES_HOME containing the minimum needed for one
 * read-only review, so the Reviewer inherits no personal memory, no
 * conversations, no skills, no SOUL.md, no MCP servers, no messaging
 * integrations, no cron jobs and no fallback providers — because none of those
 * exist in the home it is given.
 *
 * READ-ONLY IS STRUCTURAL, NOT PROMPTED. The profile disables every built-in
 * toolset, so the model is handed no file, terminal, code-execution, web,
 * X-search, browser, delegation or computer-use tool at all. There is no tool
 * to misuse and no prompt instruction to talk it out of. `hermes tools list`
 * under this profile reports every toolset disabled, which the adapter's tests
 * assert directly.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerEnvNames, type HermesProviderId } from './hermes-provider';

/**
 * Every built-in toolset this Hermes exposes. The Reviewer gets NONE of them.
 * A toolset added by a future Hermes is caught by the adapter's own check
 * (`unknownToolsets`), which blocks rather than silently granting it.
 */
export const DISABLED_TOOLSETS: readonly string[] = Object.freeze([
  'web', 'browser', 'terminal', 'file', 'code_execution', 'vision', 'video',
  'image_gen', 'video_gen', 'x_search', 'tts', 'skills', 'todo', 'memory',
  'context_engine', 'session_search', 'clarify', 'delegation', 'cronjob',
  'homeassistant', 'spotify', 'yuanbao', 'computer_use',
]);

/** Toolsets that would let a Reviewer act rather than read. */
export const WRITE_CAPABLE_TOOLSETS: readonly string[] = Object.freeze([
  'terminal', 'file', 'code_execution', 'browser', 'computer_use', 'delegation',
  'cronjob', 'memory', 'skills', 'web', 'x_search',
]);

export interface IsolatedProfile {
  readonly home: string;
  /** An empty scratch directory: the Reviewer has no path into the project. */
  readonly cwd: string;
  readonly configPath: string;
  readonly usageFilePath: string;
  readonly dispose: () => void;
}

function yamlList(values: readonly string[]): string {
  return values.map((v) => `    - ${v}`).join('\n');
}

/**
 * The minimum config for one review. Note what is ABSENT: no `providers:`
 * fallback chain, no `mcp_servers`, no hooks, no plugins — an absent section
 * cannot be routed through.
 */
export function isolatedConfigYaml(): string {
  return [
    '# Relay-owned Reviewer profile. Generated per run; never the operator\'s.',
    'agent:',
    '  disabled_toolsets:',
    yamlList(DISABLED_TOOLSETS),
    '  max_turns: 1',
    'mcp_servers: {}',
    'plugins: []',
    'hooks: {}',
    'hooks_auto_accept: false',
    'memory:',
    '  enabled: false',
    'checkpoints:',
    '  enabled: false',
    '',
  ].join('\n');
}

/**
 * Creates the profile with owner-only permissions. The directory is 0700 and
 * the config 0600, so a credential Hermes may later write into its own
 * protected `.env` cannot be read by another user on the host.
 */
export function createIsolatedProfile(root?: string): IsolatedProfile {
  const base = root ?? tmpdir();
  const home = mkdtempSync(join(base, 'relay-hermes-profile-'));
  chmodSync(home, 0o700);

  const cwd = join(home, 'scratch');
  mkdirSync(cwd, { recursive: true });
  chmodSync(cwd, 0o700);

  const configPath = join(home, 'config.yaml');
  writeFileSync(configPath, isolatedConfigYaml(), { encoding: 'utf8', mode: 0o600 });
  chmodSync(configPath, 0o600);

  const usageFilePath = join(home, 'usage.json');

  return {
    home,
    cwd,
    configPath,
    usageFilePath,
    dispose: () => {
      // Removes ONLY the Relay-owned profile. The operator's own Hermes home
      // is never a candidate: this path was minted by mkdtemp above.
      try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

/**
 * The environment the Hermes child receives — an ALLOWLIST, not a filtered
 * copy of the parent. Anything not named here (including every other provider
 * credential the bridge process may hold) simply is not present.
 *
 * The provider key is passed through the ENVIRONMENT only. It never appears in
 * argv, where it would be visible in the host process table.
 */
export function isolatedChildEnv(input: {
  profile: IsolatedProfile;
  /**
   * WHICH PROVIDER THIS RUN IS FOR. The variable names are derived from it and
   * cannot be supplied by the caller.
   *
   * They used to be caller-supplied, and the runner's only call site passed
   * the xAI names unconditionally — so an Anthropic-configured Reviewer sent
   * its Anthropic secret to the child as `XAI_API_KEY`, with no
   * `ANTHROPIC_API_KEY` present. The run could not authenticate, and a secret
   * for one vendor travelled under another vendor's name.
   */
  provider: HermesProviderId;
  /** The provider credential, read from the owning process only. */
  apiKey: string | null;
  baseUrl: string | null;
  path?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: input.path ?? process.env.PATH ?? '',
    HOME: input.profile.home,
    HERMES_HOME: input.profile.home,
    // Belt and braces alongside the profile: rules and hook prompts off.
    HERMES_IGNORE_RULES: '1',
    // A non-interactive child must never wait on a terminal prompt.
    NO_COLOR: '1',
    TERM: 'dumb',
  };
  const names = providerEnvNames(input.provider);
  if (input.apiKey !== null && input.apiKey !== '') env[names.credential] = input.apiKey;
  if (input.baseUrl !== null && input.baseUrl !== '') env[names.baseUrl] = input.baseUrl;
  return env;
}

/** Any toolset this build reports that the profile does not know to disable. */
export function unknownToolsets(reported: readonly string[]): string[] {
  const known = new Set(DISABLED_TOOLSETS);
  return reported.filter((t) => !known.has(t));
}
