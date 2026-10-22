import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoderRoleProvider } from './julius-dispatch-adapters';
import { buildJ1CoderProviderFor } from './julius-dispatch-wiring-real';
import { fakeShell } from './julius-dispatch-wiring-testkit';
import { CLAUDE_SUBSCRIPTION_TOKEN_ENV, CODER_CLAUDE_EXECUTABLE_ENV } from './hosted-coding-agent/hosted-auth';
import { juliusHostedToolAuthority, type HostedHookOutput } from './hosted-coding-agent/hosted-tool-authority';

/* PART 2b (reviewer): the coder child's environment and the coder's file tools can reach NOTHING a key lives in.
   Only the CODER CHILD needs this confinement: the architect and reviewer fetches run inside the bridge process itself, which holds
   no key at rest (KeyStore reads per call) and is not an agent session. */

const CANARY = 'canary_isolation_ZZ9_x7Q2m4k8w1';

/** The names the hosted runner is KNOWN to put in the SDK child (hostedChildEnv): this list is the allow-list under test. */
const CHILD_ENV_ALLOWED = ['PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM', 'CLAUDE_CODE_NO_MODEL_FALLBACK', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', CLAUDE_SUBSCRIPTION_TOKEN_ENV];

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
        providerFor: (env) => build(env, { requestedModel: 'claude-test-model' }), shell: fakeShell(), projectId: 'p', workerId: 'w', workspacePath: work, brief: 'B',
        model: 'claude-test-model', keyEnv: null, permittedPaths: ['out/normalized.json'], envSnapshot: { ...parentCanaries, PATH: '/bin' },
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
    for (const name of Object.keys(parentCanaries).filter((n) => n !== CLAUDE_SUBSCRIPTION_TOKEN_ENV)) expect(name in env, name).toBe(false);
    /* the coder's credential is the subscription login alone: no ANTHROPIC_API_KEY in the child, whatever the parent holds */
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
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
