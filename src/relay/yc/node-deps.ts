import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import type { YcGitResult, YcPreflightDeps } from './preflight';

/**
 * Real dependencies for the YC preflight (Prompt 8.7). This is the ONLY
 * file in `src/relay/yc/` permitted to touch child_process, and the only
 * subprocess it may ever start is READ-ONLY git — rev-parse, status,
 * merge-base — inside the CURRENT repository. No push, no reset, no
 * network, no provider binary, no write of any kind, and never a path
 * outside this checkout (the browser-frontend worktree is structurally
 * unreachable: relative paths only, no `..`).
 */

const READONLY_GIT_SUBCOMMANDS = new Set(['rev-parse', 'status', 'merge-base']);

/**
 * Argument vectors permitted in full, for subcommands whose OTHER forms write.
 * `git remote get-url origin` reads the configured URL; `git remote
 * add|set-url|rename|remove` mutate `.git/config`. Allowing `remote` by name
 * would allow those too, so the readable form is matched EXACTLY — fixed
 * length, element by element — and nothing else under `remote` is reachable.
 */
const EXACT_READONLY_GIT_FORMS: ReadonlyArray<readonly string[]> = [
  ['remote', 'get-url', 'origin'],
];

const isExactReadonlyForm = (args: readonly string[]): boolean =>
  EXACT_READONLY_GIT_FORMS.some(
    (form) => form.length === args.length && form.every((part, i) => part === args[i]),
  );

/**
 * Minimal git environment. We never inherit the raw process env: that keeps
 * provider API keys out of the child (least privilege) AND — critically —
 * drops `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` / `GIT_CONFIG_*`,
 * which would otherwise override `cwd` and silently point the "current
 * repository" checks at another tree (including the frontend worktree).
 * Mirrors the sanitized env every other git spawner in this repo uses.
 */
function gitEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) {
    const value = env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function safeRelative(relPath: string): string | null {
  if (relPath === '') return null;
  const normalized = normalize(relPath);
  // Reject absolute paths and any traversal — comparing against the path
  // SEPARATOR so a legitimate leading-dot name ('..config') is not mistaken
  // for a parent-dir escape.
  if (isAbsolute(normalized) || normalized === '..'
    || normalized.startsWith(`..${sep}`) || normalized.startsWith('../')) return null;
  return normalized;
}

export function createNodePreflightDeps(input: {
  env: Record<string, string | undefined>;
  columns: number | undefined;
  runPlainDemo: YcPreflightDeps['runPlainDemo'];
  root?: string;
}): YcPreflightDeps {
  const root = input.root ?? process.cwd();
  return {
    runGit(args): YcGitResult {
      if (args.length === 0 || !(READONLY_GIT_SUBCOMMANDS.has(args[0]) || isExactReadonlyForm(args))) {
        return { ok: false, stdout: '' };
      }
      try {
        const stdout = execFileSync('git', [...args], {
          cwd: root, env: gitEnv(input.env), encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
        });
        return { ok: true, stdout: stdout.trim() };
      } catch {
        return { ok: false, stdout: '' };
      }
    },
    fileExists(relPath): boolean {
      const safe = safeRelative(relPath);
      return safe === null ? false : existsSync(join(root, safe));
    },
    readTextFile(relPath): string | null {
      const safe = safeRelative(relPath);
      if (safe === null) return null;
      try { return readFileSync(join(root, safe), 'utf8'); } catch { return null; }
    },
    env: input.env,
    columns: input.columns,
    runPlainDemo: input.runPlainDemo,
  };
}
