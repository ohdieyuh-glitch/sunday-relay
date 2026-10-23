import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Workspace tests spawn git, and `runGit` forwards HOME. A developer gitconfig
 * (fsmonitor, url.insteadOf, gpgsign, hooks) is therefore part of the suite.
 * Point every test git at an empty home and an empty global and system config.
 */

let homeDir: string | null = null;

function emptyHome(): string {
  if (homeDir === null) homeDir = mkdtempSync(join(tmpdir(), 'relay-git-home-'));
  return homeDir;
}

export function hermeticGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: emptyHome(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (process.env.LANG !== undefined) env.LANG = process.env.LANG;
  if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
  return { ...env, ...extra };
}

/** Replace this process's HOME before any git spawn. `runGit` forwards HOME only. */
export function installHermeticGitHome(): void {
  const env = hermeticGitEnv();
  process.env.HOME = env.HOME ?? '';
  process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL ?? '';
  process.env.GIT_CONFIG_SYSTEM = env.GIT_CONFIG_SYSTEM ?? '';
  process.env.GIT_CONFIG_NOSYSTEM = env.GIT_CONFIG_NOSYSTEM ?? '';
  process.env.GIT_TERMINAL_PROMPT = env.GIT_TERMINAL_PROMPT ?? '';
}
