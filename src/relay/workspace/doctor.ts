import { execFileSync } from 'node:child_process';

/**
 * Workspace doctor (Prompt 7) — truthful, read-only capability report for
 * the isolated-worktree foundation. States plainly what is live local
 * infrastructure and what remains unavailable (no agent, no providers).
 */

export function workspaceDoctorReport(): { lines: string[]; exitCode: number } {
  const checks: Array<[string, string]> = [];
  let ready = true;

  let gitVersion = 'unavailable';
  try {
    gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    ready = false;
  }
  const versionMatch = /git version (\d+)\.(\d+)/.exec(gitVersion);
  const worktreeCapable = versionMatch !== null &&
    (Number(versionMatch[1]) > 2 || (Number(versionMatch[1]) === 2 && Number(versionMatch[2]) >= 5));
  if (!worktreeCapable) ready = false;

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 18) ready = false;

  checks.push(['Git', gitVersion]);
  checks.push(['Git worktree support', worktreeCapable ? 'available (>= 2.5)' : 'UNAVAILABLE']);
  checks.push(['Node runtime', `v${process.versions.node}${nodeMajor >= 18 ? ' (supported)' : ' (UNSUPPORTED)'}`]);
  checks.push(['Worktree management', 'live local (policy-restricted)']);
  checks.push(['Command execution', 'live local, allowlist-only, shell disabled']);
  checks.push(['Source worktree writes', 'prohibited by design']);
  checks.push(['Git push', 'prohibited by policy']);
  checks.push(['Destructive git commands', 'prohibited by policy']);
  checks.push(['Provider secret inheritance', 'blocked (env allowlist + denylist)']);
  checks.push(['Coding Agent execution', 'UNAVAILABLE (no adapter yet)']);
  checks.push(['Claude Code adapter', 'UNAVAILABLE (next phase)']);
  checks.push(['Codex adapter', 'UNAVAILABLE']);
  checks.push(['Provider calls', 'none']);
  checks.push(['Deployment', 'disabled']);
  checks.push(['Durable run persistence', 'UNAVAILABLE (volatile registry)']);
  checks.push(['Workspace readiness', ready ? 'ready' : 'NOT READY']);

  return {
    lines: ['RELAY WORKSPACE DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(28)} ${v}`)],
    exitCode: ready ? 0 : 8,
  };
}
