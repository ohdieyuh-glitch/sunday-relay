/**
 * THE CLOUD-AGENT WORKSPACE SYNC COMMANDS, AND THE ONLY WAY A SHELL PORT MAY RECOGNISE THEM.
 *
 * Three fixed command shapes (base revision, fetch the agent's branch into a private ref, apply it to the working tree as a
 * patch). Every interpolated value is validated before it is placed, and {@link matchGrokWorkspaceCommand} accepts a command
 * only when it is EXACTLY what a generator here produces for strictly validated arguments: a full-match parse, then a
 * regeneration and a string-equality check (round trip). Nothing near a generator's output — an extra argument, a
 * metacharacter, another binary, another repository — matches. No kernel import: the local shell port can depend on it.
 */

const SHA40 = /^[0-9a-f]{40}$/u;
const SAFE_OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;

/** A conservative subset of git's ref rules: no leading dash, no `..`, no `//`, no `@{`, no trailing `/` or `.lock`. */
export function isSafeBranchName(branch: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(branch) && !branch.includes('..') && !branch.includes('//')
    && !branch.endsWith('/') && !branch.endsWith('.lock') && !branch.endsWith('.');
}
/** An owner or repository name: a `.git` suffix (any case) is refused, so the URL is never `<repo>.git.git` or a near-alias. */
export const isSafeOwnerRepo = (v: string): boolean => SAFE_OWNER_REPO.test(v) && v !== '.' && v !== '..' && !v.toLowerCase().endsWith('.git');

const q = (value: string): string => `'${value.replace(/'/gu, `'\\''`)}'`;
export const GROK_FETCHED_REF = 'refs/julius/grok-coder/fetched';
const GIT = 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.allow=never -c protocol.https.allow=always';

/** The fixed command shapes the workspace port issues. Each generator THROWS on an unvalidated argument. */
export const grokWorkspaceCommands = Object.freeze({
  /**
   * F13: where the shell port really runs, read-only: the physical working directory and git's top level. The port runs
   * this before every other command and refuses unless BOTH equal its configured `workspacePath` exactly.
   */
  workspaceRoot: (): string => ['set -eu', 'printf \'PWD %s\\n\' "$(pwd -P)"', `printf 'TOP %s\\n' "$(${GIT} rev-parse --show-toplevel)"`].join('\n'),
  baseRevision: (): string => `${GIT} rev-parse --verify 'HEAD^{commit}'`,
  fetchBranch: (owner: string, repo: string, branch: string, base: string): string => {
    if (!isSafeOwnerRepo(owner) || !isSafeOwnerRepo(repo) || !isSafeBranchName(branch) || !SHA40.test(base)) throw new Error('grok_workspace_command_argument_unsafe');
    return [
      'set -eu',
      `${GIT} fetch --no-tags --no-recurse-submodules --quiet -- ${q(`https://github.com/${owner}/${repo}.git`)} ${q(`+refs/heads/${branch}:${GROK_FETCHED_REF}`)}`,
      `head="$(${GIT} rev-parse --verify '${GROK_FETCHED_REF}^{commit}')"`,
      `${GIT} merge-base --is-ancestor ${base} "$head"`,
      'printf \'HEAD %s\\n\' "$head"',
      // --raw (with full object ids) carries both modes and the status, so a symlink (120000), a gitlink (160000) or a type
      // change (T) is visible to the scope check, which refuses them; --no-renames keeps one path per line.
      `${GIT} -c core.quotePath=true diff --raw --no-renames --no-abbrev ${base} "$head"`,
    ].join('\n');
  },
  applyFetched: (base: string, head: string): string => {
    if (!SHA40.test(base) || !SHA40.test(head)) throw new Error('grok_workspace_command_argument_unsafe');
    return [
      'set -euo pipefail',
      // --no-ext-diff --no-textconv: the patch is git's own binary diff of the two commits, never the output of a configured
      // external diff driver or a textconv filter (a hostile .gitattributes or config could otherwise rewrite what is applied).
      `${GIT} diff --no-ext-diff --no-textconv --binary --no-renames ${base} ${head} | ${GIT} apply --check --whitespace=nowarn -`,
      `${GIT} diff --no-ext-diff --no-textconv --binary --no-renames ${base} ${head} | ${GIT} apply --whitespace=nowarn -`,
      'echo APPLIED',
    ].join('\n');
  },
});

export type GrokWorkspaceCommandMatch =
  | { readonly kind: 'workspaceRoot' }
  | { readonly kind: 'baseRevision' }
  | { readonly kind: 'fetchBranch'; readonly owner: string; readonly repo: string; readonly branch: string; readonly base: string }
  | { readonly kind: 'applyFetched'; readonly base: string; readonly head: string };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** A template regex built FROM the generator, so the recogniser cannot drift from what is issued. */
const templateRe = (template: string, slots: Readonly<Record<string, string>>): RegExp => {
  let re = escapeRe(template);
  for (const [token, group] of Object.entries(slots)) re = re.split(escapeRe(token)).join(group);
  return new RegExp(`^${re}$`, 'u');
};
const OWNER_G = '([A-Za-z0-9][A-Za-z0-9_.-]{0,99})';
const BRANCH_G = '([A-Za-z0-9][A-Za-z0-9._/-]{0,199})';
const SHA_G = '([0-9a-f]{40})';
const T_OWNER = 'Owner0placeholder';
const T_REPO = 'Repo0placeholder';
const T_BRANCH = 'Branch0placeholder';
const T_BASE = '0'.repeat(39) + '1';
const T_HEAD = '0'.repeat(39) + '2';
const FETCH_RE = templateRe(grokWorkspaceCommands.fetchBranch(T_OWNER, T_REPO, T_BRANCH, T_BASE), { [T_OWNER]: OWNER_G, [T_REPO]: OWNER_G, [T_BRANCH]: BRANCH_G, [T_BASE]: SHA_G });
const APPLY_RE = templateRe(grokWorkspaceCommands.applyFetched(T_BASE, T_HEAD), { [T_BASE]: SHA_G, [T_HEAD]: SHA_G });

/**
 * Recognises a sync command, or returns null. Accepts only a command byte-identical to the generator's output for arguments
 * that pass validation; a template slot that repeats (the base SHA in fetch, both SHAs in apply) must repeat identically.
 */
export function matchGrokWorkspaceCommand(command: string): GrokWorkspaceCommandMatch | null {
  if (typeof command !== 'string' || command.length > 4096) return null;
  if (command === grokWorkspaceCommands.workspaceRoot()) return { kind: 'workspaceRoot' };
  if (command === grokWorkspaceCommands.baseRevision()) return { kind: 'baseRevision' };
  const roundTrip = (build: () => string): boolean => { try { return build() === command; } catch { return false; } };
  const f = FETCH_RE.exec(command);
  if (f !== null) {
    const [, owner, repo, branch, base1, base2] = f;
    if (owner === undefined || repo === undefined || branch === undefined || base1 === undefined || base1 !== base2) return null;
    return roundTrip(() => grokWorkspaceCommands.fetchBranch(owner, repo, branch, base1)) ? { kind: 'fetchBranch', owner, repo, branch, base: base1 } : null;
  }
  const a = APPLY_RE.exec(command);
  if (a !== null) {
    const [, b1, h1, b2, h2] = a;
    if (b1 === undefined || h1 === undefined || b1 !== b2 || h1 !== h2) return null;
    return roundTrip(() => grokWorkspaceCommands.applyFetched(b1, h1)) ? { kind: 'applyFetched', base: b1, head: h1 } : null;
  }
  return null;
}
