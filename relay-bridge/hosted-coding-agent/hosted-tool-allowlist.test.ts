import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { juliusFileCreationGrant } from '../../src/relay/mission/julius/julius-file-authority';
import { createCoderSelfTest } from '../julius/coder-self-test';
import type { ShellEffectPort } from '../julius/executor-effects';
import {
  HOSTED_SELF_TEST_SERVER,
  HOSTED_SELF_TEST_TOOL_ID,
  runHostedCodingAgent,
  type HostedQueryFn,
  type HostedSdkHelpers,
  type HostedSelfTestTool,
} from './hosted-runner';

/**
 * THE CODER'S TOOLS, PINNED AT THE POINT OF USE (REVIEW condition on X-6).
 *
 * The LIVE step's process holds a contents:write job token, and the coder CLI is its same-uid host child. What keeps
 * the token out of the model's reach is that the model can make that CLI do nothing but the tools below. So this file
 * pins, on the options the REAL runner hands the SDK's `query` (a fake query, nothing spawned), the EXACT allowed
 * tool set, the exact disallowed set, the one MCP server (the self-test, only when offered), and the permission mode,
 * in all four shapes a mission can take. Adding any tool, any server or any bypass fails here.
 *
 * And it follows the self-test tool (the one tool that runs a command) to where it executes: its handler calls the
 * coder self-test port (relay-bridge/julius/coder-self-test.ts:58-72), whose only effect is `shell.run`; in the paid
 * composition that shell is the INDEPENDENT EXECUTOR (relay-bridge/julius-live-mission.ts:1065 createExecutorShellPort;
 * relay-bridge/julius/executor-effects.ts:189), which sends a `shell.bash` tool request to the executor container and
 * from there to the docker sandbox (src/relay/workspace/julius-tools/docker-sandbox-adapter.ts:153, --network none,
 * --cap-drop=ALL, its own pid namespace). Nothing on this path spawns a host process, and no environment travels.
 */

const SELF_TEST_TOOL = HOSTED_SELF_TEST_TOOL_ID;
const BASE_ALLOWED = ['Read', 'Glob', 'Grep', 'Edit'];
const BASE_DISALLOWED = ['Bash', 'BashOutput', 'KillShell', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'SlashCommand', 'TodoWrite'];
const CANARY = 'canary_self_test_token_ZZ9_x7Q2m4k8w1';

interface Seen { readonly options: Record<string, unknown> }

/** The SDK helpers, faked: a tool is its name and handler; a server is its name and tools. */
const helpers: HostedSdkHelpers = {
  tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
  createSdkMcpServer: (options) => ({ fake: 'sdk-mcp-server', ...options }),
};

async function optionsFor(input: { readonly creation: boolean; readonly selfTest: HostedSelfTestTool | null }): Promise<Record<string, unknown>> {
  const workspace = mkdtempSync(join(tmpdir(), 'j1-allowlist-'));
  const seen: Seen[] = [];
  const queryFn: HostedQueryFn = (params) => {
    seen.push({ options: params.options as Record<string, unknown> });
    return (async function* () { /* no messages */ })();
  };
  try {
    await runHostedCodingAgent({
      queryFn, prompt: 'P', workspacePath: workspace, apiKey: 'k', requestedModel: 'claude-opus-5-5', now: () => '2026-10-26T00:00:00Z',
      ...(input.creation ? { fileCreation: juliusFileCreationGrant('julius-inworld-data-1') } : {}),
      ...(input.selfTest === null ? {} : { selfTestTool: input.selfTest, sdkHelpers: helpers }),
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  expect(seen).toHaveLength(1);
  return seen[0]!.options;
}

const quietSelfTest: HostedSelfTestTool = { maxCalls: 2, run: async () => ({ n: 1, passed: true, exitCode: 0, refused: null, outputTail: '' }) };

describe('the coder\'s tools are an EXACT allowlist where the runner hands them to the SDK', () => {
  const cases = [
    { name: 'no creation, no self-test', creation: false, selfTest: false },
    { name: 'creation, no self-test', creation: true, selfTest: false },
    { name: 'no creation, self-test', creation: false, selfTest: true },
    { name: 'creation, self-test', creation: true, selfTest: true },
  ] as const;

  for (const shape of cases) {
    it(`${shape.name}: allowedTools, disallowedTools, mcpServers and the permission mode are exactly these`, async () => {
      const options = await optionsFor({ creation: shape.creation, selfTest: shape.selfTest ? quietSelfTest : null });
      expect(options.allowedTools).toEqual([...BASE_ALLOWED, ...(shape.creation ? ['Write'] : []), ...(shape.selfTest ? [SELF_TEST_TOOL] : [])]);
      expect(options.disallowedTools).toEqual(shape.creation ? BASE_DISALLOWED.filter((tool) => tool !== 'Write') : BASE_DISALLOWED);
      for (const tool of ['Bash', 'BashOutput', 'KillShell', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']) {
        expect(options.disallowedTools as string[], tool).toContain(tool);
      }
      if (shape.selfTest) {
        const servers = options.mcpServers as Record<string, { name: string; tools: { name: string }[] }>;
        expect(Object.keys(servers)).toEqual([HOSTED_SELF_TEST_SERVER]);
        expect(servers[HOSTED_SELF_TEST_SERVER]!.tools.map((tool) => tool.name)).toEqual([SELF_TEST_TOOL.split('__').pop()]);
      } else {
        expect('mcpServers' in options).toBe(false);
      }
      expect(options.permissionMode).toBe('acceptEdits');
      expect('allowDangerouslySkipPermissions' in options).toBe(false);
      expect(JSON.stringify(options)).not.toMatch(/bypassPermissions|dangerously/iu);
      expect(options.settingSources).toEqual([]);
      // No other key can carry a tool, a server, a plugin or a hook beyond the authority.
      expect(Object.keys(options).filter((key) => /tool|server|plugin|agent|command/iu.test(key)).sort())
        .toEqual(['allowedTools', 'disallowedTools', ...(shape.selfTest ? ['mcpServers'] : []), ...(Object.keys(options).includes('pathToClaudeCodeExecutable') ? ['pathToClaudeCodeExecutable'] : [])].sort());
      expect(Object.keys(options.hooks as Record<string, unknown>)).toEqual(['PreToolUse']);
    });
  }
});

describe('the self-test tool runs through the executor, never on the host, and carries no environment', () => {
  it('TOKEN CANARY: the handler\'s only effect is one executor shell request, with no env and no token', async () => {
    const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
    process.env.GITHUB_TOKEN = CANARY; process.env.GH_TOKEN = CANARY;
    const requests: unknown[] = [];
    const shell: ShellEffectPort = {
      run: async (request) => { requests.push(request); return { exitCode: 0, stdout: '', stderr: '' } as never; },
    } as ShellEffectPort;
    try {
      const selfTest = createCoderSelfTest({ shell, scope: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' }, testCommand: 'npm test', maxCalls: 2 });
      const options = await optionsFor({ creation: false, selfTest: selfTest.port });
      const server = (options.mcpServers as Record<string, { tools: { handler: (args: unknown, extra: unknown) => Promise<unknown> }[] }>)[HOSTED_SELF_TEST_SERVER]!;
      await server.tools[0]!.handler({}, {});
    } finally {
      for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
    expect(requests).toHaveLength(1);
    const request = requests[0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['command', 'invocationKey', 'projectId', 'runId', 'taskId', 'timeoutMs', 'workerId']);
    expect(JSON.stringify(requests)).not.toContain(CANARY);
  });

  it('the self-test port and the executor shell spawn nothing on the host and pass no environment; the paid composition wires the executor', () => {
    const read = (path: string): string => readFileSync(resolve(__dirname, path), 'utf8');
    const selfTest = read('../julius/coder-self-test.ts');
    const effects = read('../julius/executor-effects.ts');
    // Code only: executor-effects.ts's header says, in prose, that there is NO child_process fallback.
    const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    for (const [name, source] of [['coder-self-test.ts', code(selfTest)], ['executor-effects.ts', code(effects)]] as const) {
      expect(source, name).not.toMatch(/child_process|\bspawn\(|\bexecFile|\bexecSync|process\.env/u);
    }
    const shellPort = effects.slice(effects.indexOf('export function createExecutorShellPort('));
    expect(shellPort.slice(0, shellPort.indexOf("toolId: 'shell.bash'") + 200)).toContain("arguments: { command: input.command }");
    expect(read('../julius-live-mission.ts')).toMatch(/const shell = createExecutorShellPort\(/u);
    expect(read('../../src/relay/workspace/julius-tools/docker-sandbox-adapter.ts')).toContain("'--network','none'");
  });
});
