import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JuliusCodingAgentProvider } from '../src/relay/mission/julius/julius-coding-agent';
import { createFileDispatchLedger } from './julius-dispatch';
import { createLocalWorkspaceFs } from './julius-dispatch-bundle';
import { createFileKeyStore } from './julius-key-store';
import { createLocalShellPort } from './julius-local-shell-port';
import { isSecretLikeEnvName } from './julius-dispatch-adapters';
import type { J1WiringDeps } from './julius-dispatch-wiring';
import { createClaudeCodeCodingAgentProvider } from './julius/claude-code-coding-provider';

/**
 * The REAL effects for `createJ1LiveDispatchFromEnv`: file reads, one child process, global fetch, the file ledger, a temp file.
 * Constructing this object performs none of them. It reads no environment variable.
 *
 * PROVIDED (construct-only): the Claude Code coding provider builder (`buildJ1CoderProviderFor`). Building it spawns nothing; the SDK
 * is loaded lazily inside `execute`, which no code here calls.
 * NOT PROVIDED, ON PURPOSE: the executor shell port. It is `null`, so a live composition built from these deps REFUSES
 * (`dep_shell_absent`) until a reviewed change supplies it. See `J1_SHELL_PORT_MISSING` for exactly what is missing.
 * The run lookup is no dependency: J1 creates its own run, and the wiring answers from the frozen mission record.
 */

/**
 * The credential mode of the J1 coder: the Claude SUBSCRIPTION login, with NO API key (G3-1). The hosted runner then omits the key
 * from the child entirely (`hostedChildEnv`); the key argument below is the empty string, never a value.
 */
export const J1_CODER_AUTH_MODE = 'CLAUDE_SUBSCRIPTION' as const;

/**
 * WHAT IS STILL OPEN ABOUT THE J1 SHELL (the executor-based port, createExecutorShellPort, is NOT used: it needs a Julius store, task rows and a
 * remote sandbox that J1 does not have). The local port (julius-local-shell-port.ts) runs only the bridge's generated attempt commands.
 */
export const J1_SHELL_PORT_MISSING: readonly string[] = Object.freeze([
  'The local port runs bash on the bridge host as the bridge user (no sandbox): its safety is the exact-string allow-list, the minimal env and the git config pin; it is not the PR #208 executor.',
  'The attempt commands use the fixed path /tmp/julius-attempt-index for their temporary index: single-writer only (one J1 attempt at a time on the host).',
  'The configured JULIUS_J1_CODER_WORKSPACE_PATH is reseeded at the start of EVERY attempt, and only if it is empty or carries the bridge marker (.git/j1-bridge-workspace); an existing non-empty directory must be removed by the operator once.',
  'The hosted coder session is told the workspace path by the request (workspacePath = the configured path): nothing here proves the real SDK session runs with that cwd until a paid run.',
]);

/**
 * Builds the coder provider factory the wiring hands to `createCoderRoleProvider`. Construct-only: it returns a function; calling that
 * function returns a provider object; nothing is spawned or loaded until `execute` runs.
 *
 * WHAT THE ENV ARGUMENT IS, HONESTLY. The hosted runner builds the SDK child environment itself (`hostedChildEnv`: PATH, HOME, CI,
 * NO_COLOR, TERM, model slots, and the subscription token from the PARENT process). It accepts no environment, so the allow-listed env
 * the adapter hands here cannot be applied to the child; it is only CHECKED (a key-like name is refused). The key argument is empty.
 */
export function buildJ1CoderProviderFor(options: {
  readonly run?: Parameters<typeof createClaudeCodeCodingAgentProvider>[0]['run'];
  readonly queryLoader?: Parameters<typeof createClaudeCodeCodingAgentProvider>[0]['queryLoader'];
} = {}): (env: Readonly<Record<string, string>>, ctx: { readonly requestedModel: string }) => JuliusCodingAgentProvider {
  return (env, ctx) => {
    if (typeof ctx.requestedModel !== 'string' || ctx.requestedModel.trim() === '') throw new Error('coder_requested_model_absent');
    if (Object.keys(env).some((name) => isSecretLikeEnvName(name))) throw new Error('coder_env_contains_secret_name');
    return createClaudeCodeCodingAgentProvider({
      apiKey: '', requestedModel: ctx.requestedModel, authMode: J1_CODER_AUTH_MODE,
      ...(options.run === undefined ? {} : { run: options.run }),
      ...(options.queryLoader === undefined ? {} : { queryLoader: options.queryLoader }),
    });
  };
}

/** keyDirForbiddenUnder: a key directory inside this path (default: the bridge's working directory, i.e. the repository) is refused. */
export function realJ1WiringDeps(log: (line: string) => void, now: () => number = Date.now, checkerBaseEnv: Readonly<Record<string, string | undefined>> = {}, keyDirForbiddenUnder: string = process.cwd()): J1WiringDeps {
  return {
    readFileSync: (path) => readFileSync(path),
    fetchImpl: async (url, init) => {
      const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, ...(init.signal === undefined ? {} : { signal: init.signal }) });
      return { ok: res.ok, status: res.status, text: () => res.text() };
    },
    /* The child gets EXACTLY the env the adapter built (allow-list); never the parent's. */
    runProcess: (command, args, env) => new Promise((resolve) => {
      execFile(command, [...args], { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: { ...env } }, (error, stdout, stderr) => {
        const code = error === null ? 0 : (error as NodeJS.ErrnoException & { code?: unknown }).code;
        resolve({ exitCode: typeof code === 'number' ? code : error === null ? 0 : null, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' });
      });
    }),
    stageFiles: async (files) => {
      const dir = mkdtempSync(join(tmpdir(), 'j1-checker-stage-'));
      try { chmodSync(dir, 0o700); } catch { /* platform without POSIX modes: mkdtemp already gave a fresh user-private temp dir */ }
      const paths = files.map((f) => { const p = join(dir, f.name); writeFileSync(p, f.bytes, { mode: 0o600 }); return p; });
      return { paths, cleanup: async () => { rmSync(dir, { recursive: true, force: true }); } };
    },
    readStagedFile: async (path) => readFileSync(path),
    realpath: async (path) => realpathSync.native(path),
    checkerBaseEnv,
    writeArtifact: async (text) => {
      const dir = mkdtempSync(join(tmpdir(), 'j1-artifact-'));
      const path = join(dir, 'artifact.txt');
      writeFileSync(path, text, 'utf8');
      return { path, cleanup: async () => { rmSync(dir, { recursive: true, force: true }); } };
    },
    openLedger: (file) => createFileDispatchLedger({ file }),
    coderProviderFor: buildJ1CoderProviderFor(),
    shell: null,
    /* The LOCAL port (julius-local-shell-port.ts): bridge-generated attempt commands only, in the configured private workspace. Construct-only. */
    shellFor: ({ workspacePath, bashPath, bashSha256, gitDir, seedFiles }) => createLocalShellPort({
      cwd: workspacePath, bashPath, bashSha256, gitDir, seedFiles, readFileBytes: (p) => readFileSync(p),
      fs: {
        listDir: (p) => readdirSync(p), exists: (p) => existsSync(p), removeRecursive: (p) => rmSync(p, { recursive: true, force: true }),
        mkdirp: (p) => { mkdirSync(p, { recursive: true }); }, writeFile: (p, bytes) => writeFileSync(p, bytes),
      },
      spawn: (file, args, options) => new Promise((resolve) => {
        execFile(file, [...args], { cwd: options.cwd, env: { ...options.env }, timeout: options.timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
          const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
          resolve({ exitCode: e === null ? 0 : typeof e.code === 'number' ? e.code : null, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '', timedOut: e !== null && e.killed === true });
        });
      }),
    }),
    keyStoreFor: (dir) => createFileKeyStore({ dir, fs: { readFileSync: (p) => readFileSync(p, 'utf8'), statSync: (p) => statSync(p) }, platform: process.platform, repoRoot: keyDirForbiddenUnder, realpath: (p) => realpathSync(p) }),
    pathExists: (p) => existsSync(p),
    workspaceFs: (root) => createLocalWorkspaceFs(root, { readdirSync: (p, o) => readdirSync(p, o), readlinkSync: (p) => readlinkSync(p), readFileSync: (p) => readFileSync(p) }),
    now,
    log,
  };
}
