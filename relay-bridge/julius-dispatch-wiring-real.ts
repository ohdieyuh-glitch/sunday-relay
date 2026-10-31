import { execFile } from 'node:child_process';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileDispatchLedger } from './julius-dispatch';
import { createLocalWorkspaceFs } from './julius-dispatch-bundle';
import { createFileKeyStore } from './julius-key-store';
import { createLocalShellPort } from './julius-local-shell-port';
import { isSecretLikeEnvName } from './julius-dispatch-adapters';
import type { J1WiringDeps } from './julius-dispatch-wiring';
import { J1_ANTHROPIC_ORIGIN, J1_OPENAI_ORIGIN, J1_XAI_ORIGIN, pinnedProviderUrl } from './julius-xai-direct-reviewer';
import type { JuliusCodingAgentProvider } from '../src/relay/mission/julius/julius-coding-agent';
import { createClaudeCodeCodingAgentProvider } from './julius/claude-code-coding-provider';
import { CURSOR_API_ORIGIN } from './julius/cursor-cloud-agents-transport';
import {
  GROK_BOT_CODER_PROVIDER_KIND, createGrokBotCodingAgentProvider, grokBotCoderConfigRefusal,
  type CodingAgentTransport, type GrokBotCoderConfig, type GrokBotReviewerPin, type GrokBotWorkspacePort,
} from './julius/grok-bot-coding-provider';

/**
 * The REAL effects for `createJ1LiveDispatchFromEnv`: file reads, one child process, global fetch, the file ledger, a temp file.
 * Constructing this object performs none of them. It reads no environment variable.
 *
 * PROVIDED (construct-only): the Anthropic API coding provider builder (`buildJ1CoderProviderFor`). Building it spawns nothing; the SDK
 * is loaded lazily inside `execute`, which no code here calls. This builder is not the spend path: the paid workflow supplies the key.
 * NOT PROVIDED, ON PURPOSE: the executor shell port. It is `null`, so a live composition built from these deps REFUSES
 * (`dep_shell_absent`) until a reviewed change supplies it. See `J1_SHELL_PORT_MISSING` for exactly what is missing.
 * The run lookup is no dependency: J1 creates its own run, and the wiring answers from the frozen mission record.
 */

/**
 * The credential mode of the J1 coder: the Anthropic API (`claude-opus-5-5`, key name `ANTHROPIC_API_KEY`). This local builder
 * passes an empty key argument. The gated workflow is the only path that spends; a live dispatch on this controller returns before any provider call.
 */
export const J1_CODER_AUTH_MODE = 'ANTHROPIC_API' as const;

const PINNED_FETCH_ORIGINS = [J1_XAI_ORIGIN, J1_OPENAI_ORIGIN, J1_ANTHROPIC_ORIGIN] as const;

/** The Cursor Cloud Agents API origin. OFF unless a caller passes `allowCursorCloudAgents: true`; `realJ1WiringDeps` never does. */
export const J1_CURSOR_API_ORIGIN = CURSOR_API_ORIGIN;

/**
 * The real transport accepts only the three pinned provider origins and never follows a redirect. The Cursor origin is a fourth,
 * explicit opt-in (default off, so the default is unchanged); it is the Grok Bot coder's transport host, never a fallback.
 */
export function j1PinnedFetchUrl(raw: string, options: { readonly allowCursorCloudAgents?: boolean } = {}): string {
  let matched: string | null = null;
  const origins: readonly string[] = options.allowCursorCloudAgents === true ? [...PINNED_FETCH_ORIGINS, J1_CURSOR_API_ORIGIN] : PINNED_FETCH_ORIGINS;
  for (const origin of origins) {
    try { matched = pinnedProviderUrl(origin, raw); break; } catch { matched = null; }
  }
  if (matched === null) throw new Error('provider_base_url_unpinned');
  return matched;
}

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
 * WHAT THE ENV ARGUMENT IS, HONESTLY. The hosted runner builds the SDK child environment itself (`hostedChildEnv`). It accepts no
 * environment, so the allow-listed env the adapter hands here cannot be applied to the child; it is only CHECKED (a key-like name is
 * refused). The key argument is empty: this builder does not hold a provider key.
 */
export type J1CoderOccupant = 'claude-code-hosted' | typeof GROK_BOT_CODER_PROVIDER_KIND;

/**
 * What the coder hook is given per dispatch. `reviewer` (N1) is the WIRED reviewer pin, which the J1 core is meant to pass
 * as `{ modelId: reviewerModel, modelFamily: <the reviewer's vendor family> }` from its own `JULIUS_J1_REVIEWER_MODEL` pin.
 * PILOT L-4: core does NOT pass it yet (julius-dispatch-wiring-core.ts passes only `{ requestedModel: coderModel }`); that
 * wiring is open. The Claude occupant ignores `reviewer`; the Grok Bot occupant REQUIRES it and refuses
 * (`coder_grok_reviewer_pin_absent`) without it, so today the grok occupant cannot run from core: fail closed.
 */
export interface J1CoderProviderContext {
  readonly requestedModel: string;
  readonly reviewer?: GrokBotReviewerPin;
}
/** The context the Grok Bot occupant needs: the reviewer pin is not optional. */
export type J1GrokCoderProviderContext = J1CoderProviderContext & { readonly reviewer: GrokBotReviewerPin };

export function buildJ1CoderProviderFor(options: {
  readonly run?: Parameters<typeof createClaudeCodeCodingAgentProvider>[0]['run'];
  readonly queryLoader?: Parameters<typeof createClaudeCodeCodingAgentProvider>[0]['queryLoader'];
  /**
   * Who occupies the coder slot. Default (absent): the hosted Claude coder, exactly as before. `grok_bot_cloud_agent` builds the
   * Grok Bot coder from `grokBot` and NOTHING else: absent or refused deps throw at build time; there is no Claude fallback.
   */
  readonly occupant?: J1CoderOccupant;
  readonly grokBot?: {
    readonly config: GrokBotCoderConfig;
    readonly transport: CodingAgentTransport;
    readonly workspace: GrokBotWorkspacePort;
    readonly log?: (line: string) => void;
  };
} = {}): (env: Readonly<Record<string, string>>, ctx: J1CoderProviderContext) => JuliusCodingAgentProvider {
  if (options.occupant === GROK_BOT_CODER_PROVIDER_KIND) {
    const deps = options.grokBot;
    return (env, ctx) => {
      if (typeof ctx.requestedModel !== 'string' || ctx.requestedModel.trim() === '') throw new Error('coder_requested_model_absent');
      if (Object.keys(env).some((name) => isSecretLikeEnvName(name))) throw new Error('coder_env_contains_secret_name');
      if (deps === undefined) throw new Error('coder_grok_bot_deps_absent');
      const reviewer = ctx.reviewer ?? null;
      const refusal = grokBotCoderConfigRefusal(deps.config, reviewer);
      if (refusal !== null) throw new Error(refusal.providerFailureClass);
      if (deps.config.pinnedModelId !== ctx.requestedModel) throw new Error('coder_requested_model_not_pinned');
      return createGrokBotCodingAgentProvider({
        config: deps.config, reviewerPin: reviewer, transport: deps.transport, workspace: deps.workspace,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      });
    };
  }
  if (options.occupant !== undefined && options.occupant !== 'claude-code-hosted') {
    return () => { throw new Error('coder_occupant_unknown'); };
  }
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
      const allowedUrl = j1PinnedFetchUrl(url);
      const res = await fetch(allowedUrl, { method: init.method, headers: init.headers, body: init.body, redirect: 'error', ...(init.signal === undefined ? {} : { signal: init.signal }) });
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
    keyStoreFor: (dir) => createFileKeyStore({
      dir,
      fs: {
        lstatSync: (p) => lstatSync(p),
        openSync: (p) => openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW),
        fstatSync: (fd) => fstatSync(fd),
        readSync: (fd) => readFileSync(fd, 'utf8'),
        closeSync: (fd) => { closeSync(fd); },
      },
      platform: process.platform,
      repoRoot: keyDirForbiddenUnder,
      realpath: (p) => realpathSync(p),
      ownerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
    }),
    pathExists: (p) => existsSync(p),
    workspaceFs: (root) => createLocalWorkspaceFs(root, { readdirSync: (p, o) => readdirSync(p, o), readlinkSync: (p) => readlinkSync(p), readFileSync: (p) => readFileSync(p), lstatSync: (p) => lstatSync(p) }),
    now,
    log,
  };
}
