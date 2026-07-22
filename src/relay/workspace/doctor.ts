import { execFileSync } from 'node:child_process';
import { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';

/**
 * Workspace doctor (Prompt 7) — read-only, truthful capability report for
 * the isolated-worktree foundation. Distinguishes live LOCAL workspace
 * infrastructure from (still unavailable) live AI agent execution.
 */

export interface WorkspaceDoctorReport {
  lines: string[];
  ready: boolean;
}

export function workspaceDoctorReport(): WorkspaceDoctorReport {
  const checks: Array<[string, string]> = [];
  let gitOk = false;
  let gitVersion = 'unavailable';
  try {
    gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim();
    const match = gitVersion.match(/(\d+)\.(\d+)/);
    gitOk = !!match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 5));
  } catch {
    gitOk = false;
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeOk = nodeMajor >= 18;

  checks.push(['Git', gitOk ? `${gitVersion} (worktrees supported)` : `${gitVersion} (NEED git >= 2.5)`]);
  checks.push(['Node runtime', nodeOk ? `v${process.versions.node} (supported)` : `v${process.versions.node} (UNSUPPORTED — need >= 18)`]);
  checks.push(['Worktree management', 'live local (real git worktrees, pinned revisions)']);
  checks.push(['Command execution', 'live local, policy-restricted (shell: false, bounded)']);
  checks.push(['Approved executables', DEFAULT_WORKSPACE_COMMAND_POLICY.rules.map((r) => r.executable).join(', ')]);
  checks.push(['Shell interpolation', 'disabled by construction (argument arrays only)']);
  checks.push(['Environment inheritance', 'allowlist only — provider secrets never inherited']);
  checks.push(['Workspace root', '<source parent>/.relay-workspaces/<project>/<run>/<task>']);
  checks.push(['Source worktree', 'never modified (inspect-only; worktree bookkeeping in .git only)']);
  checks.push(['Git push', 'prohibited by policy']);
  checks.push(['Destructive git commands', 'prohibited by policy']);
  checks.push(['Cleanup', 'conservative (preserve on failure/checkpoint; removal needs authorization)']);
  checks.push(['Workspace provenance', 'live (LOCAL infrastructure — not AI execution)']);
  checks.push(['Coding Agent execution', 'unavailable']);
  checks.push(['Real Claude Code adapter', 'DEFERRED (next phase)']);
  checks.push(['Real Codex adapter', 'DEFERRED']);
  checks.push(['Provider calls', 'none']);
  checks.push(['Durable run persistence', 'unavailable (volatile registry)']);
  const ready = gitOk && nodeOk;
  checks.push(['Workspace readiness', ready ? 'ready' : 'NOT READY']);
  return {
    lines: ['RELAY WORKSPACE DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(28)} ${v}`)],
    ready,
  };
}
