import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JuliusCodingAgentProvider } from '../src/relay/mission/julius/julius-coding-agent';
import { createFileDispatchLedger } from './julius-dispatch';
import { createLocalWorkspaceFs } from './julius-dispatch-bundle';
import { createFileKeyStore } from './julius-key-store';
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

/** What stops a real ShellEffectPort for J1 (read from executor-effects.ts and julius-live-mission.ts). Not a TODO list to guess at. */
export const J1_SHELL_PORT_MISSING: readonly string[] = Object.freeze([
  'createExecutorShellPort needs a PostgreSQL Pool, JuliusToolPostgresRepository and JuliusToolSettlementPostgresRepository (a Julius store); J1 has none by design.',
  'It needs a TaskClaimSource: claims are recorded by the Julius run loop, which J1 does not run; with none every effect throws executor_claim_missing.',
  'It UPDATEs relay_wonderland.julius_tasks and INSERTs budget_reservations for the task and execution; J1 creates no task rows, so the outbox claim cannot match (executor_dispatch_unclaimed).',
  'It needs a RemoteExecutorControlPlane (JULIUS_EXECUTOR_ENDPOINT, JULIUS_SCOPED_CREDENTIALS, EXECUTOR_KEY_ID, JULIUS_PUBLIC_KEY_PATH, JULIUS_CALLER_ID) and a running sandbox executor; none is verified here.',
  'The workspace the executor sees is prepared from workspaceSourceRef (a git source); who creates the J1 workspace with data/legacy_ledger.csv, data/posts.json and format.test.mjs is undecided.',
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
    keyStoreFor: (dir) => createFileKeyStore({ dir, fs: { readFileSync: (p) => readFileSync(p, 'utf8'), statSync: (p) => statSync(p) }, platform: process.platform, repoRoot: keyDirForbiddenUnder }),
    workspaceFs: (root) => createLocalWorkspaceFs(root, { readdirSync: (p, o) => readdirSync(p, o), readlinkSync: (p) => readlinkSync(p), readFileSync: (p) => readFileSync(p) }),
    now,
    log,
  };
}
