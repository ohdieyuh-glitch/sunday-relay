import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type {
  CapabilitySupport, ClaudeAuthClassification, ClaudeCodeCapabilityProfile,
} from './contracts';

/**
 * Claude Code capability probe (Prompt 8) — READ-ONLY. Resolves the
 * installed executable, reads its --version and --help, and derives the
 * supported programmatic flag surface by scanning help text. Runs
 * `claude auth status` for a SAFE authentication classification only.
 *
 * Hard guarantees: never calls a model, never prints or returns credential
 * values (tokens, email, org, billing), distinguishes installed from
 * authenticated, and marks anything it cannot confirm as 'unverified'.
 */

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * The environment the probe hands the runtime. It stays deliberately tiny and
 * forwards no credential-shaped variable, but it does include the XDG
 * config-discovery paths.
 *
 * The reason is CONSISTENCY, not speed. The probe decides which capabilities
 * Relay advertises and whether the auth profile is approved; the run then
 * happens under `buildClaudeEnvironment`, which passes these paths. A founder
 * whose config lives at a non-default `XDG_CONFIG_HOME` would otherwise have
 * the probe read one configuration and the run use another — and Relay would
 * be reporting on a machine that does not exist.
 *
 * `PROBE_ENV_KEYS` is therefore required to stay a strict SUBSET of that
 * PASSTHROUGH set, which `claude-code.test.ts` asserts: the probe may never
 * see more than the run.
 */
export const PROBE_ENV_KEYS = [
  'PATH', 'HOME', 'LANG', 'TMPDIR',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
] as const;

const readOnlyEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of PROBE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
};

function tryExec(executable: string, args: string[]): string | null {
  try {
    return execFileSync(executable, args, {
      encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER,
      env: readOnlyEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/** Resolve the Claude executable by scanning PATH directly (no shell, no
 * external resolver binary). Follows the final symlink so a version-pinned
 * launcher reports its real target. */
export function resolveClaudeExecutable(explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? realpathSync(explicit) : null;
  const dirs = (process.env.PATH ?? '').split(delimiter).filter((d) => d.length > 0);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

const has = (help: string, flag: string): boolean => help.includes(flag);

export function probeClaudeCapabilities(now: string, explicitPath?: string): ClaudeCodeCapabilityProfile {
  const executablePath = resolveClaudeExecutable(explicitPath);
  const base: ClaudeCodeCapabilityProfile = {
    executablePath,
    version: null,
    nonInteractiveSupported: false, streamJsonSupported: false, explicitResumeSupported: false,
    maxTurnsSupported: false, allowedToolsSupported: false, disallowedToolsSupported: false,
    toolsRestrictionSupported: false, permissionModeSupported: false, systemPromptSupported: false,
    appendSystemPromptSupported: false, structuredSchemaSupported: false,
    mcpIsolationSupported: 'unverified', settingsIsolationSupported: 'unverified',
    cancellationSupported: false, probedAt: now, provenance: 'live',
  };
  if (!executablePath) return base;

  const version = tryExec(executablePath, ['--version']);
  const help = tryExec(executablePath, ['--help']) ?? '';
  const mcpIsolation: CapabilitySupport = has(help, '--strict-mcp-config') ? 'available' : 'unverified';
  const settingsIsolation: CapabilitySupport =
    has(help, '--safe-mode') || has(help, '--setting-sources') ? 'available' : 'unverified';

  return {
    ...base,
    version: version ? version.trim().split(/\s+/)[0] : null,
    nonInteractiveSupported: has(help, '--print'),
    streamJsonSupported: has(help, 'stream-json'),
    explicitResumeSupported: has(help, '--resume') && has(help, '--session-id'),
    maxTurnsSupported: has(help, '--max-turns'),
    allowedToolsSupported: has(help, '--allowedTools') || has(help, '--allowed-tools'),
    disallowedToolsSupported: has(help, '--disallowedTools') || has(help, '--disallowed-tools'),
    toolsRestrictionSupported: has(help, '--tools'),
    permissionModeSupported: has(help, '--permission-mode'),
    systemPromptSupported: has(help, '--system-prompt'),
    appendSystemPromptSupported: has(help, '--append-system-prompt'),
    structuredSchemaSupported: has(help, '--json-schema'),
    mcpIsolationSupported: mcpIsolation,
    settingsIsolationSupported: settingsIsolation,
    // Process termination is always available on Node; the runner escalates
    // SIGTERM -> SIGKILL and reports confirmation honestly.
    cancellationSupported: true,
  };
}

/** Redact anything email/token/org shaped from a raw string. */
const redact = (raw: string): string =>
  raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/sk-[A-Za-z0-9-]{8,}/g, '[redacted]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '[redacted-uuid]');

/**
 * Classify Claude authentication from `claude auth status --json` WITHOUT
 * retaining email, org, or token material. Never calls a model. Returns
 * approvedForLiveRun=true ONLY for a logged-in first-party subscription.
 */
export function classifyClaudeAuth(now: string, executablePath: string | null): ClaudeAuthClassification {
  const fallback: ClaudeAuthClassification = {
    loggedIn: false, sourceClass: 'unknown', approvedForLiveRun: false,
    subscriptionLabel: 'unknown', classifiedAt: now,
  };
  if (!executablePath) return { ...fallback, sourceClass: 'not_logged_in' };

  // Provider env overrides are checked FIRST: their presence means an
  // API-billed / third-party path even if a login also exists.
  if (process.env.CLAUDE_CODE_USE_BEDROCK) return { ...fallback, sourceClass: 'bedrock', classifiedAt: now };
  if (process.env.CLAUDE_CODE_USE_VERTEX) return { ...fallback, sourceClass: 'vertex', classifiedAt: now };
  if (process.env.ANTHROPIC_BASE_URL) return { ...fallback, sourceClass: 'gateway', classifiedAt: now };
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { ...fallback, sourceClass: 'api_key', classifiedAt: now };
  }

  const raw = tryExec(executablePath, ['auth', 'status', '--json']) ?? tryExec(executablePath, ['auth', 'status']);
  if (!raw) return { ...fallback, sourceClass: 'unknown', classifiedAt: now };

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Non-JSON output: classify coarsely from redacted text, store nothing.
    const safe = redact(raw).toLowerCase();
    const loggedIn = safe.includes('logged in') || safe.includes('"loggedin":true');
    return { ...fallback, loggedIn, sourceClass: loggedIn ? 'unknown' : 'not_logged_in', classifiedAt: now };
  }

  const loggedIn = parsed.loggedIn === true;
  const method = String(parsed.authMethod ?? '').toLowerCase();
  const apiProvider = String(parsed.apiProvider ?? '').toLowerCase();
  const subscription = String(parsed.subscriptionType ?? 'unknown').toLowerCase();
  const subscriptionLabel = ['max', 'pro', 'team', 'enterprise'].includes(subscription) ? subscription : 'unknown';

  let sourceClass: ClaudeAuthClassification['sourceClass'] = 'unknown';
  if (!loggedIn) sourceClass = 'not_logged_in';
  else if (method.includes('claude.ai') || apiProvider === 'firstparty') sourceClass = 'local_subscription';
  else if (method.includes('api') || apiProvider === 'anthropic') sourceClass = 'api_key';
  else if (apiProvider.includes('bedrock')) sourceClass = 'bedrock';
  else if (apiProvider.includes('vertex')) sourceClass = 'vertex';

  return {
    loggedIn,
    sourceClass,
    approvedForLiveRun: loggedIn && sourceClass === 'local_subscription',
    subscriptionLabel,
    classifiedAt: now,
  };
}
