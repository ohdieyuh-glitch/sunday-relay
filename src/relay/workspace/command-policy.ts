import type { ApprovedCommandRule, WorkspaceCommandPolicy, WorkspaceCommandRequest } from './contracts';

/**
 * Safe command policy (Prompt 7) — PURE evaluation, no process access.
 * Commands are executable + argument arrays only; nothing here or in the
 * runner ever touches a shell, so metacharacters cannot expand — they are
 * still rejected outright as hostile intent. Approval is allowlist-only,
 * and a hard denylist (shells, destructive Git, publication, deployment)
 * applies even over a misconfigured custom policy.
 */

/** Never approvable, regardless of configured rules. */
const DENIED_EXECUTABLES = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'cmd.exe',
  'powershell', 'powershell.exe', 'pwsh', 'eval', 'sudo', 'su',
  'rm', 'rmdir', 'del', 'dd', 'mkfs', 'chmod', 'chown',
  'curl', 'wget', 'ssh', 'scp', 'psql', 'mysql', 'dropdb',
]);

/** Git subcommands the RUNNER may never execute — worktree management goes
 * through the dedicated infrastructure path, never through agent commands. */
const DENIED_GIT_SUBCOMMANDS = new Set([
  'push', 'reset', 'clean', 'checkout', 'switch', 'restore', 'merge',
  'rebase', 'filter-branch', 'gc', 'config', 'remote', 'fetch', 'pull',
  'am', 'apply', 'worktree', 'branch', 'tag', 'commit', 'stash', 'submodule',
]);

/** Inspection-only Git surface available to approved commands. */
const ALLOWED_GIT_SUBCOMMANDS = new Set(['status', 'rev-parse', 'diff', 'log', 'show', '--version']);

/** npm subcommands that publish or mutate the environment are denied. */
const DENIED_NPM_SUBCOMMANDS = new Set(['publish', 'install', 'uninstall', 'link', 'config', 'login', 'adduser', 'exec']);

const SHELL_METACHARACTERS = /[;&|<>`$]/;

/** Environment keys that never reach a workspace process, whatever the
 * allowlist says — provider secrets are not inherited by default or by
 * request. Matched case-insensitively on the key NAME only. */
const DENIED_ENVIRONMENT_KEY_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|ANTHROPIC|OPENAI|SUPABASE|AWS_|GH_|GITHUB_|NPM_TOKEN|VERCEL|RAILWAY)/i;

const BASE_ENVIRONMENT_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT'];

export const DEFAULT_WORKSPACE_COMMAND_POLICY: WorkspaceCommandPolicy = {
  rules: [
    { executable: 'node', description: 'Node runtime identity check', allowedFirstArgs: ['--version'] },
    { executable: 'npm', description: 'npm identity check', allowedFirstArgs: ['--version'] },
    { executable: 'git', description: 'read-only repository inspection' },
  ],
  environmentAllowlist: [...BASE_ENVIRONMENT_KEYS],
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  defaultOutputLimitBytes: 256 * 1024,
  maxOutputLimitBytes: 1024 * 1024,
};

export interface CommandApproval {
  approved: boolean;
  reasons: string[];
  timeoutMs: number;
  outputLimitBytes: number;
  /** Environment keys the process will actually receive (names only). */
  grantedEnvironmentKeys: string[];
}

export function evaluateCommandRequest(
  policy: WorkspaceCommandPolicy,
  request: Pick<WorkspaceCommandRequest, 'executable' | 'args' | 'environmentKeys' | 'timeoutMs' | 'outputLimitBytes'>,
): CommandApproval {
  const reasons: string[] = [];
  const { executable, args } = request;

  if (typeof executable !== 'string' || executable.trim() === '') {
    reasons.push('executable must be a non-empty name.');
  } else {
    if (/[/\\]/.test(executable) || executable.includes('..') || executable.includes('\0')) {
      reasons.push('executable must be a bare name, never a path.');
    }
    if (DENIED_EXECUTABLES.has(executable.toLowerCase())) {
      reasons.push(`executable "${executable}" is denied (shells and destructive tools are never approved).`);
    }
  }

  const rule: ApprovedCommandRule | undefined = policy.rules.find((r) => r.executable === executable);
  if (!rule && reasons.length === 0) reasons.push(`executable "${executable}" is not in the approved command policy.`);

  if (!Array.isArray(args)) {
    reasons.push('args must be an array of strings.');
  } else {
    args.forEach((arg, i) => {
      if (typeof arg !== 'string') reasons.push(`arg ${i} must be a string.`);
      else {
        if (arg.includes('\0')) reasons.push(`arg ${i} contains a null byte.`);
        if (arg.includes('\n') || arg.includes('\r')) reasons.push(`arg ${i} contains a line break.`);
        if (arg.length > 500) reasons.push(`arg ${i} exceeds 500 chars.`);
        if (SHELL_METACHARACTERS.test(arg)) reasons.push(`arg ${i} contains shell metacharacters (no shell exists to interpret them; rejected as hostile).`);
      }
    });
  }

  if (Array.isArray(args) && args.every((a) => typeof a === 'string')) {
    if (executable === 'git') {
      const sub = args[0] ?? '';
      if (DENIED_GIT_SUBCOMMANDS.has(sub)) reasons.push(`git ${sub} is never approved for workspace commands.`);
      else if (!ALLOWED_GIT_SUBCOMMANDS.has(sub)) reasons.push(`git ${sub || '(none)'} is outside the read-only inspection surface.`);
      if (args.some((a) => a === '--force' || a === '-f')) reasons.push('force flags are never approved.');
      if (args.some((a) => a === '-c' || a.startsWith('--exec') || a.startsWith('--upload-pack') || a.startsWith('--receive-pack'))) {
        reasons.push('git configuration/exec injection flags are never approved.');
      }
    }
    if (executable === 'npm' && DENIED_NPM_SUBCOMMANDS.has(args[0] ?? '')) {
      reasons.push(`npm ${args[0]} is never approved for workspace commands.`);
    }
    if (rule?.allowedFirstArgs && !rule.allowedFirstArgs.includes(args[0] ?? '')) {
      reasons.push(`"${executable} ${args[0] ?? ''}" is not within this rule's approved arguments.`);
    }
  }

  const timeoutMs = Math.min(request.timeoutMs ?? policy.defaultTimeoutMs, policy.maxTimeoutMs);
  if ((request.timeoutMs ?? 1) <= 0) reasons.push('timeoutMs must be positive.');
  const outputLimitBytes = Math.min(request.outputLimitBytes ?? policy.defaultOutputLimitBytes, policy.maxOutputLimitBytes);

  const requestedKeys = [...BASE_ENVIRONMENT_KEYS, ...(request.environmentKeys ?? [])];
  const grantedEnvironmentKeys = requestedKeys.filter(
    (key) =>
      (BASE_ENVIRONMENT_KEYS.includes(key) || policy.environmentAllowlist.includes(key)) &&
      !DENIED_ENVIRONMENT_KEY_PATTERN.test(key),
  );

  return { approved: reasons.length === 0, reasons, timeoutMs, outputLimitBytes, grantedEnvironmentKeys };
}

/** Build the child environment from granted keys only — provider secrets
 * never pass, even when present in the parent environment. */
export function buildChildEnvironment(
  baseEnv: Record<string, string | undefined>,
  grantedKeys: string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of grantedKeys) {
    const value = baseEnv[key];
    if (value !== undefined && !DENIED_ENVIRONMENT_KEY_PATTERN.test(key)) env[key] = value;
  }
  return env;
}
