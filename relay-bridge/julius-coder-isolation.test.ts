import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoderRoleProvider, J1_CODER_KEY_ENV, J1_CODER_MODEL } from './julius-dispatch-adapters';
import { buildJ1CoderProviderFor } from './julius-dispatch-wiring-real';
import { fakeShell } from './julius-dispatch-wiring-testkit';
import { createLocalShellPort, J1_INDEX_HASH_COMMAND, J1_SEED_COMMAND, type J1SeedFile, type LocalSeedFs, type LocalSpawn } from './julius-local-shell-port';
import { juliusAttemptStartCommand } from './julius/coder-workspace';
import { CLAUDE_SUBSCRIPTION_TOKEN_ENV, CODER_CLAUDE_EXECUTABLE_ENV } from './hosted-coding-agent/hosted-auth';
import { juliusHostedToolAuthority, type HostedHookOutput } from './hosted-coding-agent/hosted-tool-authority';
import { HOSTED_ALLOWED_TOOLS, HOSTED_DISALLOWED_TOOLS, hostedChildEnv } from './hosted-coding-agent/hosted-envelope';

/* PART 2b (reviewer): the coder child's environment and the coder's file tools can reach NOTHING a key lives in.
   Only the CODER CHILD needs this confinement: the architect and reviewer fetches run inside the bridge process itself, which holds
   no key at rest (KeyStore reads per call) and is not an agent session. */

const CANARY = 'canary_isolation_ZZ9_x7Q2m4k8w1';

/** The names the hosted runner puts in the SDK child in Anthropic API mode (`hostedChildEnv`). HOME stays: the runner sets it. The J1 adapter allow-list does not. */
const CHILD_ENV_ALLOWED = ['ANTHROPIC_API_KEY', 'PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM', 'CLAUDE_CODE_NO_MODEL_FALLBACK', 'CLAUDE_CODE_MAX_RETRIES', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'];

describe('2b(a) the coder child env is an EXPLICIT allow-list, through the REAL runner path', () => {
  it('parent canaries (key-like and not key-like) never reach the SDK child env; only the allow-listed names do', async () => {
    const parentCanaries: Record<string, string> = {
      OPENAI_API_KEY: CANARY, XAI_API_KEY: CANARY, ANTHROPIC_API_KEY: CANARY, GITHUB_TOKEN: CANARY, DATABASE_URL: CANARY, JULIUS_J1_KEY_DIR: `/keys/${CANARY}`,
      PLAIN_NAME_NOT_KEYLIKE: CANARY, MY_CANARY_SETTING: CANARY, AWS_SECRET_ACCESS_KEY: CANARY, [CLAUDE_SUBSCRIPTION_TOKEN_ENV]: 'sub_token_value_not_a_provider_key',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(parentCanaries)) { saved[k] = process.env[k]; process.env[k] = v; }
    saved.PATH = process.env.PATH; saved.HOME = process.env.HOME; saved[CODER_CLAUDE_EXECUTABLE_ENV] = process.env[CODER_CLAUDE_EXECUTABLE_ENV];
    process.env.PATH ??= '/bin'; process.env.HOME ??= '/home/u'; delete process.env[CODER_CLAUDE_EXECUTABLE_ENV];
    const work = mkdtempSync(join(tmpdir(), 'j1-iso-work-'));
    const seen: { env: Record<string, string>; options: Record<string, unknown> }[] = [];
    try {
      const build = buildJ1CoderProviderFor({
        // the fake PROCESS: records exactly what the real runner hands the SDK, then ends the stream
        queryLoader: async () => (params: { prompt: string; options: Record<string, unknown> }) => {
          seen.push({ env: params.options.env as Record<string, string>, options: params.options });
          return (async function* () { /* no messages */ })();
        },
      });
      const role = createCoderRoleProvider({
        providerFor: (env) => build(env, { requestedModel: J1_CODER_MODEL }), shell: fakeShell(), projectId: 'p', workerId: 'w', workspacePath: work, brief: 'B',
        model: J1_CODER_MODEL, keyEnv: J1_CODER_KEY_ENV, permittedPaths: ['out/normalized.json'], envSnapshot: { ...parentCanaries, PATH: '/bin' },
      });
      await role.call({ role: 'coder', runId: 'run:1', dispatchId: 'd1', missionId: 'm1', apiKey: '', architectText: 'PLAN', coderArtifact: null, coderEvidence: null });
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(work, { recursive: true, force: true });
    }
    expect(seen).toHaveLength(1);
    const env = seen[0]!.env;
    expect(Object.keys(env).filter((k) => !CHILD_ENV_ALLOWED.includes(k))).toEqual([]);
    expect(JSON.stringify(env)).not.toContain(CANARY);
    for (const name of Object.keys(parentCanaries).filter((n) => n !== 'ANTHROPIC_API_KEY')) expect(name in env, name).toBe(false);
    /* This local builder passes an empty key. The parent canary must not be copied, and API mode drops the subscription token. */
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(CLAUDE_SUBSCRIPTION_TOKEN_ENV in env).toBe(false);
    /* and the run carried the hook that confines the file tools */
    expect(JSON.stringify(Object.keys(seen[0]!.options))).toContain('hooks');
  });
});

describe('2b(b) the PreToolUse authority denies a canary file outside the workspace (real decision function, real temp dirs, no SDK)', () => {
  const root = mkdtempSync(join(tmpdir(), 'j1-conf-'));
  const work = join(root, 'work');
  const outside = join(root, 'private-keys');
  mkdirSync(work); mkdirSync(outside);
  mkdirSync(join(work, 'out'));
  writeFileSync(join(work, 'out', 'normalized.json'), '{}');
  const keyFile = join(outside, 'XAI_API_KEY');
  writeFileSync(keyFile, CANARY);
  const authority = juliusHostedToolAuthority({ workspacePath: work });
  const call = (tool: string, input: Record<string, unknown>): Promise<HostedHookOutput> => authority({ tool_name: tool, tool_input: input });
  const denied = (out: HostedHookOutput): boolean => 'hookSpecificOutput' in out && out.hookSpecificOutput.permissionDecision === 'deny';

  /* each tool, with the path spelled the way that tool takes it */
  const probes = (path: string): Record<string, Record<string, unknown>> => ({
    Read: { file_path: path }, Edit: { file_path: path, old_string: CANARY, new_string: 'x' },
    Glob: { pattern: '*', path }, Grep: { pattern: CANARY, path },
  });

  it('control: a path inside the workspace is not denied for Read, Glob and Grep, and Edit of the artifact is permitted', async () => {
    expect(denied(await call('Read', { file_path: join(work, 'out', 'normalized.json') }))).toBe(false);
    expect(denied(await call('Glob', { pattern: '*.json', path: join(work, 'out') }))).toBe(false);
    expect(denied(await call('Grep', { pattern: 'x', path: work }))).toBe(false);
    expect(denied(await call('Edit', { file_path: join(work, 'out', 'normalized.json'), old_string: '{}', new_string: '{"a":1}' }))).toBe(false);
  });
  it('the key file by its ABSOLUTE path outside the workspace: denied for Read, Glob, Grep and Edit', async () => {
    for (const [tool, input] of Object.entries(probes(keyFile))) expect(denied(await call(tool, input)), tool).toBe(true);
    expect(denied(await call('Glob', { pattern: `${outside.split('\\').join('/')}/*` }))).toBe(true);
  });
  it('the key file via ".." from inside the workspace: denied for Read, Glob, Grep and Edit', async () => {
    const viaDotDot = `${work}/out/../../private-keys/XAI_API_KEY`;
    for (const [tool, input] of Object.entries(probes(viaDotDot))) expect(denied(await call(tool, input)), tool).toBe(true);
    expect(denied(await call('Glob', { pattern: '../private-keys/*' }))).toBe(true);
  });
  it('the key file via a SYMLINK (or directory junction) inside the workspace: denied for Read, Glob, Grep and Edit', async (ctx) => {
    const fileLink = join(work, 'innocent.txt');
    const dirLink = join(work, 'linked-dir');
    let made = false;
    try { symlinkSync(keyFile, fileLink, 'file'); made = true; } catch { /* needs privilege on Windows */ }
    try { symlinkSync(outside, dirLink, process.platform === 'win32' ? 'junction' : 'dir'); made = true; } catch { /* idem */ }
    if (!made) ctx.skip();
    let ran = 0;
    if (existsSync(fileLink)) for (const [tool, input] of Object.entries(probes(fileLink))) { expect(denied(await call(tool, input)), `${tool} via file link`).toBe(true); ran += 1; }
    if (existsSync(dirLink)) for (const [tool, input] of Object.entries(probes(join(dirLink, 'XAI_API_KEY')))) { expect(denied(await call(tool, input)), `${tool} via dir link`).toBe(true); ran += 1; }
    expect(ran, 'at least one link kind was actually created and probed').toBeGreaterThanOrEqual(4);
  });
  it('N-gap: link/../x is denied by the explicit ".." guard ALONE (lexical resolution says inside, realpath containment would allow it)', async (ctx) => {
    const sub = join(outside, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), CANARY);           // the kernel's answer to link/../secret.txt
    const link = join(work, 'dirlink');
    try { symlinkSync(sub, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch { ctx.skip(); }
    const spelled = `${work}/dirlink/../secret.txt`;
    // the isolating facts: the lexical answer is a path inside the workspace that does not exist, so real-path containment alone would accept it
    expect(resolve(spelled).startsWith(resolve(work))).toBe(true);
    expect(existsSync(resolve(spelled))).toBe(false);
    for (const [tool, input] of Object.entries(probes(spelled))) expect(denied(await call(tool, input)), tool).toBe(true);
    expect(denied(await call('Glob', { pattern: 'dirlink/../*' }))).toBe(true);
  });
  it('MUTANT: an authority that allows everything would NOT deny the key file, so the assertions above would fail against it', async () => {
    const allowAll = async (): Promise<HostedHookOutput> => ({});
    expect(denied(await allowAll())).toBe(false);
    expect(denied(await call('Read', { file_path: keyFile }))).toBe(true);
  });
  it('a creation tool (Write) is refused even inside the workspace', async () => {
    expect(denied(await call('Write', { file_path: join(work, 'out', 'new.json'), content: 'x' }))).toBe(true);
  });
});

describe('2b the pre-seeded placeholder is exactly the two bytes {} (no trailing newline)', () => {
  it('sha256 of the placeholder', () => {
    expect(createHash('sha256').update('{}').digest('hex')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });
});

describe('R4 the SDK cwd equals the shell port workspace (real J1 coder path, fake query, no SDK, nothing spawned)', () => {
  const enc = (v: string): Uint8Array => new TextEncoder().encode(v);
  const sha = (v: string): string => createHash('sha256').update(v).digest('hex');
  const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/').replace(/\/+$/u, '').toLowerCase();
  const SEEDS: J1SeedFile[] = [
    { name: 'data/legacy_ledger.csv', bytes: enc('a,b'), sha256: sha('a,b') },
    { name: 'data/posts.json', bytes: enc('[]'), sha256: sha('[]') },
    { name: 'format.test.mjs', bytes: enc('test'), sha256: sha('test') },
  ];
  it('the options the real runner hands the query have cwd == the port workspace, tools Read/Glob/Grep/Edit, and Write disallowed', async () => {
    const WS = join(tmpdir(), 'j1-r4-workspace');
    const files = new Set<string>(); const dirs = new Set<string>([WS, '/opt/git/cmd']);
    const fs: LocalSeedFs = {
      listDir: () => [], exists: (p) => files.has(p) || dirs.has(p), removeRecursive: () => undefined, mkdirp: (p) => { dirs.add(p); }, writeFile: (p) => { files.add(p); },
    };
    const spawnCwds: string[] = [];
    const spawn: LocalSpawn = async (_file, args, opts) => {
      spawnCwds.push(opts.cwd);
      const command = args[1] ?? '';
      const stdout = command === J1_INDEX_HASH_COMMAND ? 'ABSENT' : command === J1_SEED_COMMAND ? `SEEDED ${'a'.repeat(40)}
` : command === juliusAttemptStartCommand(null) ? `HEAD ${'a'.repeat(40)}
BASE ${'b'.repeat(40)}
START ${'c'.repeat(40)}
` : '';
      return { exitCode: 0, stdout, stderr: '', timedOut: false };
    };
    const port = createLocalShellPort({ cwd: WS, bashPath: '/opt/git/usr/bin/bash', bashSha256: sha('git bash'), readFileBytes: () => enc('git bash'), gitDir: '/opt/git/cmd', spawn, fs, seedFiles: SEEDS, baseEnv: { PATH: '/bin' } });
    const captured: Record<string, unknown>[] = [];
    const build = buildJ1CoderProviderFor({
      queryLoader: async () => (params: { prompt: string; options: Record<string, unknown> }) => { captured.push(params.options); return (async function* () { /* no messages */ })(); },
    });
    const role = createCoderRoleProvider({
      providerFor: (env) => build(env, { requestedModel: J1_CODER_MODEL }), shell: port, projectId: 'p', workerId: 'w', workspacePath: WS, brief: 'B',
      model: J1_CODER_MODEL, keyEnv: J1_CODER_KEY_ENV, permittedPaths: ['out/normalized.json'], envSnapshot: { PATH: '/bin' },
    });
    await role.call({ role: 'coder', runId: 'run:1', dispatchId: 'd1', missionId: 'm1', apiKey: '', architectText: 'PLAN', coderArtifact: null, coderEvidence: null });
    expect(captured).toHaveLength(1);
    expect(spawnCwds.length).toBeGreaterThan(0);
    for (const c of spawnCwds) expect(norm(String(captured[0]!.cwd))).toBe(norm(c));
    expect(norm(String(captured[0]!.cwd))).toBe(norm(WS));
    expect([...(captured[0]!.allowedTools as string[])].sort()).toEqual(['Edit', 'Glob', 'Grep', 'Read']);
    expect(captured[0]!.disallowedTools as string[]).toContain('Write');
    expect(captured[0]!.allowedTools as string[]).not.toContain('Write');
  });
  it('MUTANT: a different SDK cwd would be caught by the same comparison', () => {
    expect(norm('/other/dir')).not.toBe(norm(join(tmpdir(), 'j1-r4-workspace')));
  });
});

/* X-6 (REVIEW): the LIVE step's process holds a contents:write GITHUB_TOKEN. The coder CLI is a same-uid HOST child
   of that process, so the token is reachable only through what the model can make that CLI do. These cases prove
   each route is closed: the child env has no token; the file tools cannot read /proc (an ancestor's environ, its
   own, or a glob/grep over it); no execution tool is allowed; and every command the coder runs (including the
   self-test) runs in the executor's container, which has its own pid namespace and no network. */
describe('X-6 CANARY: the coder cannot reach the LIVE step\'s job token', () => {
  const root = mkdtempSync(join(tmpdir(), 'j1-x6-'));
  const work = join(root, 'work');
  mkdirSync(join(work, 'out'), { recursive: true });
  writeFileSync(join(work, 'out', 'normalized.json'), '{}');
  const authority = juliusHostedToolAuthority({ workspacePath: work });
  const denied = async (tool: string, input: Record<string, unknown>): Promise<boolean> => {
    const out = await authority({ tool_name: tool, tool_input: input });
    return 'hookSpecificOutput' in out && out.hookSpecificOutput.permissionDecision === 'deny';
  };

  it('the file tools refuse every /proc route to an environ: own, parent, init, any pid, by glob and by grep', async () => {
    for (const path of ['/proc/self/environ', '/proc/1/environ', `/proc/${String(process.ppid)}/environ`, `/proc/${String(process.pid)}/environ`, '/proc/self/root/proc/1/environ']) {
      expect(await denied('Read', { file_path: path }), `Read ${path}`).toBe(true);
      expect(await denied('Grep', { pattern: 'GITHUB_TOKEN', path }), `Grep ${path}`).toBe(true);
      expect(await denied('Edit', { file_path: path, old_string: 'a', new_string: 'b' }), `Edit ${path}`).toBe(true);
    }
    expect(await denied('Glob', { pattern: '/proc/*/environ' })).toBe(true);
    expect(await denied('Glob', { pattern: '*/environ', path: '/proc' })).toBe(true);
    expect(await denied('Grep', { pattern: 'GITHUB_TOKEN', path: '/proc' })).toBe(true);
    expect(await denied('Read', { file_path: `${work}/../../../../../../proc/self/environ` })).toBe(true);
    // Control: the workspace itself is readable, so the denials above are the authority's, not a broken harness.
    expect(await denied('Read', { file_path: join(work, 'out', 'normalized.json') })).toBe(false);
  });

  it('the child env carries no token, and no execution tool is allowed to the coder', () => {
    const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
    process.env.GITHUB_TOKEN = CANARY; process.env.GH_TOKEN = CANARY;
    try {
      const env = hostedChildEnv({ apiKey: 'k', path: process.env.PATH, home: process.env.HOME, model: J1_CODER_MODEL });
      expect(JSON.stringify(env)).not.toContain(CANARY);
      expect(Object.keys(env).filter((name) => /TOKEN|GITHUB|GH_/u.test(name))).toEqual([]);
    } finally {
      for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
    for (const tool of ['Bash', 'BashOutput', 'KillShell', 'Task', 'WebFetch', 'NotebookEdit']) {
      expect(HOSTED_DISALLOWED_TOOLS, tool).toContain(tool);
      expect(HOSTED_ALLOWED_TOOLS, tool).not.toContain(tool);
    }
  });

  it('every coder command runs in the executor container: its own pid namespace (never --pid host), no network, no host /proc', () => {
    const adapter = readFileSync(resolve(__dirname, '../src/relay/workspace/julius-tools/docker-sandbox-adapter.ts'), 'utf8');
    expect(adapter).toContain("'--network','none'");
    expect(adapter).toContain("'--cap-drop=ALL'");
    expect(adapter).not.toMatch(/'--pid'|--pid=|pid=host|--ipc=host|\/proc:|--privileged/u);
    const selfTest = readFileSync(resolve(__dirname, 'julius/coder-self-test.ts'), 'utf8');
    expect(selfTest).toContain('inside the sandbox');
    rmSync(root, { recursive: true, force: true });
  });
});
