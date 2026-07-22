import { describe, expect, it } from 'vitest';
import { validateBranchName, defaultBranchForRun } from './worktree-manager';
import {
  buildChildEnvironment, DEFAULT_WORKSPACE_COMMAND_POLICY, evaluateCommandRequest,
} from './command-policy';
import { classifyChangedPath, normalizePolicy, withBaselineProtection } from './protected-paths';
import { boundOutput, sanitizeOutput } from './output-sanitizer';
import { decideCleanup } from './cleanup';
import type { WorkspaceCommandPolicy } from './contracts';

/** Pure workspace policy tests — no filesystem, no processes, no git. */

describe('branch-name safety', () => {
  it('accepts safe run branches and the deterministic default', () => {
    expect(validateBranchName('relay/run/abc-123').ok).toBe(true);
    expect(defaultBranchForRun('run_abc-123')).toBe('relay/run/abc-123');
    expect(defaultBranchForRun('run_x!y?z')).toBe('relay/run/xyz');
  });

  it('rejects injection and malformed refs', () => {
    for (const bad of [
      '', ' ', 'bad;rm -rf', 'bad`cmd`', 'bad$(cmd)', '-leading-dash', 'has space',
      'a..b', 'a//b', 'a@{now}', 'ends/', 'ends.', 'ends.lock', 'seg/-dash', 'nul\0byte',
    ]) {
      expect(validateBranchName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('command policy', () => {
  const evaluate = (executable: string, args: string[], extra: Record<string, unknown> = {}) =>
    evaluateCommandRequest(DEFAULT_WORKSPACE_COMMAND_POLICY, { executable, args, ...extra });

  it('approves the minimal proof set', () => {
    expect(evaluate('node', ['--version']).approved).toBe(true);
    expect(evaluate('npm', ['--version']).approved).toBe(true);
    expect(evaluate('git', ['status', '--porcelain']).approved).toBe(true);
    expect(evaluate('git', ['rev-parse', 'HEAD']).approved).toBe(true);
    expect(evaluate('git', ['diff', '--name-only']).approved).toBe(true);
  });

  it('rejects shells, destructive tools, paths, and unknown executables', () => {
    for (const [exe, args] of [
      ['bash', ['-c', 'ls']], ['sh', ['-c', 'ls']], ['powershell', ['-Command', 'ls']],
      ['rm', ['-rf', '.']], ['curl', ['http://x']], ['sudo', ['ls']],
      ['/usr/bin/node', ['--version']], ['../node', ['--version']], ['made-up-tool', []],
    ] as Array<[string, string[]]>) {
      expect(evaluate(exe, args).approved, exe).toBe(false);
    }
  });

  it('rejects shell metacharacters even though no shell exists to interpret them', () => {
    for (const arg of ['a;b', 'a|b', 'a&&b', 'a>b', 'a<b', 'a`b`', 'a$(b)', '$HOME']) {
      expect(evaluate('git', ['status', arg]).approved, arg).toBe(false);
    }
    expect(evaluate('git', ['status', 'nul\0byte']).approved).toBe(false);
    expect(evaluate('git', ['status', 'line\nbreak']).approved).toBe(false);
  });

  it('denies push, reset, clean, force, config injection, and npm publish', () => {
    for (const args of [
      ['push'], ['push', '--force'], ['reset', '--hard'], ['clean', '-fd'],
      ['checkout', 'main'], ['merge', 'x'], ['rebase', 'x'], ['fetch'], ['pull'],
      ['worktree', 'add', 'x'], ['branch', '-D', 'x'], ['commit', '-m', 'x'],
    ]) {
      expect(evaluate('git', args).approved, args.join(' ')).toBe(false);
    }
    expect(evaluate('git', ['status', '--force']).approved).toBe(false);
    expect(evaluate('git', ['-c', 'core.editor=x']).approved).toBe(false);
    expect(evaluate('npm', ['publish']).approved).toBe(false);
    expect(evaluate('npm', ['install', 'left-pad']).approved).toBe(false);
  });

  it('enforces allowedFirstArgs and clamps timeout/output to policy maxima', () => {
    expect(evaluate('node', ['-e', 'code']).approved).toBe(false); // only --version by default
    const clamped = evaluate('node', ['--version'], { timeoutMs: 10_000_000, outputLimitBytes: 10_000_000_000 });
    expect(clamped.timeoutMs).toBe(DEFAULT_WORKSPACE_COMMAND_POLICY.maxTimeoutMs);
    expect(clamped.outputLimitBytes).toBe(DEFAULT_WORKSPACE_COMMAND_POLICY.maxOutputLimitBytes);
  });

  it('environment allowlist blocks provider secrets even when explicitly requested', () => {
    const policy: WorkspaceCommandPolicy = {
      ...DEFAULT_WORKSPACE_COMMAND_POLICY,
      environmentAllowlist: [...DEFAULT_WORKSPACE_COMMAND_POLICY.environmentAllowlist, 'RELAY_DEBUG', 'MY_API_KEY', 'ANTHROPIC_API_KEY'],
    };
    const approval = evaluateCommandRequest(policy, {
      executable: 'node', args: ['--version'],
      environmentKeys: ['RELAY_DEBUG', 'MY_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'NOT_ALLOWLISTED'],
    });
    expect(approval.grantedEnvironmentKeys).toContain('RELAY_DEBUG');
    expect(approval.grantedEnvironmentKeys).toContain('PATH');
    for (const denied of ['MY_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'NOT_ALLOWLISTED']) {
      expect(approval.grantedEnvironmentKeys, denied).not.toContain(denied);
    }
    const env = buildChildEnvironment(
      { PATH: '/usr/bin', RELAY_DEBUG: '1', MY_API_KEY: 'sk-FAKETESTNOTREAL0003', OPENAI_API_KEY: 'x' },
      ['PATH', 'RELAY_DEBUG', 'MY_API_KEY', 'OPENAI_API_KEY'],
    );
    expect(env).toEqual({ PATH: '/usr/bin', RELAY_DEBUG: '1' });
  });
});

describe('protected paths and claims', () => {
  const normalized = normalizePolicy({
    protectedPaths: withBaselineProtection({ forbidden: ['secrets', '.env'], readOnly: ['README.md', 'docs/policy'] }),
    claimedWritePaths: ['src/access', 'notes.md'],
  });
  if (!normalized.ok) throw new Error('fixture policy must normalize');
  const classify = (path: string) => classifyChangedPath(path, normalized.policy).classification;

  it('classifies protected, claimed, and unclaimed changes segment-safely', () => {
    expect(classify('secrets/prod.env')).toBe('protected');
    expect(classify('secrets')).toBe('protected');
    expect(classify('.env')).toBe('protected');
    expect(classify('.git/config')).toBe('protected'); // baseline
    expect(classify('README.md')).toBe('protected'); // read-only
    expect(classify('docs/policy/rules.md')).toBe('protected');
    expect(classify('secrets-archive/old.txt')).toBe('unclaimed'); // NOT a segment match
    expect(classify('README.md.bak')).toBe('unclaimed');
    expect(classify('src/access/policy.ts')).toBe('claimed');
    expect(classify('notes.md')).toBe('claimed');
    expect(classify('src/other/file.ts')).toBe('unclaimed');
  });

  it('rejects hostile path shapes and invalid policy inputs', () => {
    expect(classify('../outside')).toBe('invalid');
    expect(classify('/absolute/path')).toBe('invalid');
    expect(classify('nul\0byte')).toBe('invalid');
    const bad = normalizePolicy({ protectedPaths: { forbidden: ['../up'], readOnly: [] }, claimedWritePaths: ['/abs'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBe(2);
  });
});

describe('output sanitization and bounding', () => {
  it('redacts secret shapes', () => {
    const noisy = [
      'key sk-FAKETESTNOTREAL0004 leaked', 'aws AKIAFAKETESTNOTREAL9', 'gh ghp_FAKETESTNOTREAL00000000x',
      'BEGIN RSA PRIVATE KEY', 'api_key = FAKEVALUE123', 'plain output stays',
    ].join('\n');
    const { text, redactions } = sanitizeOutput(noisy);
    expect(redactions).toBeGreaterThanOrEqual(5);
    expect(text).not.toContain('sk-FAKETESTNOTREAL0004');
    expect(text).not.toContain('AKIAFAKETESTNOTREAL9');
    expect(text).toContain('plain output stays');
    expect(text).toContain('[REDACTED:secret-shape]');
  });

  it('bounds output at the byte budget with an explicit truncation mark', () => {
    const bounded = boundOutput('x'.repeat(1000), 100);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text).toContain('[TRUNCATED');
    expect(boundOutput('short', 100)).toEqual({ text: 'short', truncated: false });
  });
});

describe('cleanup decisions', () => {
  it('preserves conservatively and removes only when authorized and permitted', () => {
    expect(decideCleanup({ policy: 'preserve_always', status: 'completed', authorizeRemoval: true }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'manual_cleanup', status: 'ready', authorizeRemoval: false }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'preserve_on_failure', status: 'failed', authorizeRemoval: true }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'preserve_on_checkpoint', status: 'checkpoint_required', authorizeRemoval: true }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'preserve_on_checkpoint', status: 'cancelled', authorizeRemoval: true }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'remove_on_success', status: 'failed', authorizeRemoval: true }).action).toBe('preserve');
    expect(decideCleanup({ policy: 'remove_on_success', status: 'completed', authorizeRemoval: true }).action).toBe('remove');
    expect(decideCleanup({ policy: 'manual_cleanup', status: 'ready', authorizeRemoval: true }).action).toBe('remove');
  });
});
