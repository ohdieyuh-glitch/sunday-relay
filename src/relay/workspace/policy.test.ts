import { describe, expect, it } from 'vitest';
import { classifyChangedPath, normalizePolicy, withBaselineProtection } from './protected-paths';
import { buildChildEnvironment, DEFAULT_WORKSPACE_COMMAND_POLICY, evaluateCommandRequest } from './command-policy';
import { boundOutput, sanitizeOutput } from './output-sanitizer';
import { evaluateCleanup } from './cleanup';
import { deriveRunBranch, validateBranchName } from './worktree-manager';

/**
 * Pure workspace policy tests (Prompt 7): path classification, command
 * approval, environment restriction, output bounding/sanitization, branch
 * validation, and cleanup decisions — no filesystem, no processes.
 */

const policy = () => {
  const normalized = normalizePolicy({
    protectedPaths: withBaselineProtection({ forbidden: ['secrets', 'deploy/production.yaml'], readOnly: ['README.md'] }),
    claimedWritePaths: ['src/app.txt', 'src/lib'],
  });
  if (!normalized.ok) throw new Error(normalized.errors.join('; '));
  return normalized.policy;
};

describe('protected paths and file claims', () => {
  it('classifies exact, directory, and segment-safe matches', () => {
    const p = policy();
    expect(classifyChangedPath('secrets/prod.env', p).classification).toBe('protected');
    expect(classifyChangedPath('secrets', p).classification).toBe('protected');
    expect(classifyChangedPath('deploy/production.yaml', p).classification).toBe('protected');
    expect(classifyChangedPath('README.md', p).classification).toBe('protected'); // read-only write
    expect(classifyChangedPath('secrets-archive.txt', p).classification).toBe('unclaimed'); // segment-safe
    expect(classifyChangedPath('src/app.txt', p).classification).toBe('claimed');
    expect(classifyChangedPath('src/lib/deep/file.ts', p).classification).toBe('claimed');
    expect(classifyChangedPath('src/other.txt', p).classification).toBe('unclaimed');
  });

  it('always protects .git via the baseline and never expands claims', () => {
    const p = policy();
    expect(classifyChangedPath('.git/config', p).classification).toBe('protected');
    // protection beats an overlapping claim: claiming secrets would not help
    const overlapping = normalizePolicy({
      protectedPaths: withBaselineProtection({ forbidden: ['secrets'], readOnly: [] }),
      claimedWritePaths: ['secrets/prod.env'],
    });
    if (!overlapping.ok) throw new Error('policy must normalize');
    expect(classifyChangedPath('secrets/prod.env', overlapping.policy).classification).toBe('protected');
  });

  it('rejects hostile path shapes: traversal, absolute, null bytes', () => {
    const p = policy();
    expect(classifyChangedPath('../outside.txt', p).classification).toBe('invalid');
    expect(classifyChangedPath('/etc/passwd', p).classification).toBe('invalid');
    expect(classifyChangedPath('a\0b', p).classification).toBe('invalid');
    expect(classifyChangedPath('src/../secrets/prod.env', p).classification).toBe('invalid');
  });

  it('rejects invalid policy input instead of silently dropping rules', () => {
    const bad = normalizePolicy({
      protectedPaths: { forbidden: ['../escape'], readOnly: [] },
      claimedWritePaths: [],
    });
    expect(bad.ok).toBe(false);
  });
});

describe('command policy', () => {
  const approve = (executable: string, args: string[], extra: Partial<Parameters<typeof evaluateCommandRequest>[1]> = {}) =>
    evaluateCommandRequest(DEFAULT_WORKSPACE_COMMAND_POLICY, { executable, args, ...extra });

  it('approves the minimal verification surface', () => {
    expect(approve('node', ['--version']).approved).toBe(true);
    expect(approve('npm', ['--version']).approved).toBe(true);
    expect(approve('git', ['status', '--porcelain=v1', '-z']).approved).toBe(true);
    expect(approve('git', ['rev-parse', 'HEAD']).approved).toBe(true);
    expect(approve('git', ['diff', '--name-only']).approved).toBe(true);
  });

  it('rejects shells, destructive tools, and unapproved executables', () => {
    for (const shell of ['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd.exe']) {
      expect(approve(shell, ['-c', 'true']).approved).toBe(false);
    }
    expect(approve('rm', ['-rf', '.']).approved).toBe(false);
    expect(approve('curl', ['http://x']).approved).toBe(false);
    expect(approve('python3', ['-c', 'pass']).approved).toBe(false);
  });

  it('rejects destructive and network git despite git being approved', () => {
    for (const args of [['push'], ['push', '--force'], ['reset', '--hard'], ['clean', '-fd'],
      ['checkout', 'main'], ['merge', 'x'], ['config', 'user.name', 'x'], ['remote', 'add', 'x', 'y'],
      ['fetch'], ['pull'], ['worktree', 'add', 'x'], ['branch', '-D', 'x'], ['commit', '-m', 'x']]) {
      const result = approve('git', args);
      expect(result.approved, `git ${args.join(' ')}`).toBe(false);
    }
    expect(approve('git', ['-c', 'core.editor=x', 'status']).approved).toBe(false);
    expect(approve('git', ['status', '--force']).approved).toBe(false);
  });

  it('rejects paths as executables, metacharacters, null bytes, oversized args', () => {
    expect(approve('/usr/bin/git', ['status']).approved).toBe(false);
    expect(approve('../git', ['status']).approved).toBe(false);
    expect(approve('git', ['status; rm -rf /']).approved).toBe(false);
    expect(approve('git', ['status', '| tee x']).approved).toBe(false);
    expect(approve('git', ['$(whoami)']).approved).toBe(false);
    expect(approve('git', ['`id`']).approved).toBe(false);
    expect(approve('git', ['a\0b']).approved).toBe(false);
    expect(approve('git', ['x'.repeat(600)]).approved).toBe(false);
    expect(approve('npm', ['publish']).approved).toBe(false);
    expect(approve('npm', ['install', 'left-pad']).approved).toBe(false);
  });

  it('bounds timeouts and output limits to policy maxima', () => {
    const capped = approve('node', ['--version'], { timeoutMs: 10_000_000, outputLimitBytes: 999_999_999 });
    expect(capped.timeoutMs).toBeLessThanOrEqual(DEFAULT_WORKSPACE_COMMAND_POLICY.maxTimeoutMs);
    expect(capped.outputLimitBytes).toBeLessThanOrEqual(DEFAULT_WORKSPACE_COMMAND_POLICY.maxOutputLimitBytes);
  });

  it('environment allowlist blocks provider secrets even when requested', () => {
    const approval = approve('node', ['--version'], {
      environmentKeys: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MY_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'PATH', 'HOME'],
    });
    expect(approval.grantedEnvironmentKeys).toContain('PATH');
    expect(approval.grantedEnvironmentKeys).not.toContain('ANTHROPIC_API_KEY');
    expect(approval.grantedEnvironmentKeys).not.toContain('OPENAI_API_KEY');
    expect(approval.grantedEnvironmentKeys).not.toContain('MY_TOKEN');
    expect(approval.grantedEnvironmentKeys).not.toContain('AWS_SECRET_ACCESS_KEY');

    const env = buildChildEnvironment(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-never', SUPABASE_SECRET: 'never' },
      [...approval.grantedEnvironmentKeys, 'ANTHROPIC_API_KEY'], // even a granted-list bug cannot leak
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET).toBeUndefined();
  });
});

describe('output bounding and sanitization', () => {
  it('truncates at the byte budget with an explicit mark', () => {
    const bounded = boundOutput('x'.repeat(5000), 1000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text).toContain('[TRUNCATED');
    expect(boundOutput('short', 1000).truncated).toBe(false);
  });

  it('redacts secret-shaped output', () => {
    const dirty = 'key sk-FAKETESTNOTREAL0007 and AKIAFAKETESTNOTREAL8 and ghp_FAKETESTNOTREAL0000000x done';
    const clean = sanitizeOutput(dirty);
    expect(clean.redactions).toBeGreaterThanOrEqual(3);
    expect(clean.text).not.toContain('sk-FAKETESTNOTREAL0007');
    expect(clean.text).not.toContain('AKIAFAKETESTNOTREAL8');
    expect(clean.text).toContain('[REDACTED:secret-shape]');
    expect(sanitizeOutput('normal build output').redactions).toBe(0);
  });
});

describe('branch validation', () => {
  it('derives a safe deterministic run branch', () => {
    const branch = deriveRunBranch('run_t0001');
    expect(branch.ok && branch.value).toBe('relay/run/t0001');
  });

  it('rejects branch-name injection shapes', () => {
    for (const name of ['-D', '--force', 'a..b', 'a//b', 'a b', 'a@{1}', 'x.lock', 'a/', 'a/./b', 'a\0b', '', 'a/-flag']) {
      expect(validateBranchName(name).ok, name).toBe(false);
    }
    expect(validateBranchName('relay/run/abc-123').ok).toBe(true);
  });
});

describe('cleanup decisions', () => {
  it('never removes without explicit authorization', () => {
    expect(evaluateCleanup({ status: 'completed', cleanupPolicy: 'remove_on_success' }, { authorizeRemoval: false }).action).toBe('preserve');
  });

  it('preserves failure/checkpoint/dirty states under preserve_on_failure even when authorized', () => {
    for (const status of ['failed', 'cancelled', 'dirty', 'checkpoint_required'] as const) {
      expect(evaluateCleanup({ status, cleanupPolicy: 'preserve_on_failure' }, { authorizeRemoval: true }).action).toBe('preserve');
    }
    expect(evaluateCleanup({ status: 'completed', cleanupPolicy: 'preserve_on_failure' }, { authorizeRemoval: true }).action).toBe('remove');
  });

  it('preserve_always always preserves; removed refuses', () => {
    expect(evaluateCleanup({ status: 'completed', cleanupPolicy: 'preserve_always' }, { authorizeRemoval: true }).action).toBe('preserve');
    expect(evaluateCleanup({ status: 'removed', cleanupPolicy: 'manual_cleanup' }, { authorizeRemoval: true }).action).toBe('refuse');
  });
});
