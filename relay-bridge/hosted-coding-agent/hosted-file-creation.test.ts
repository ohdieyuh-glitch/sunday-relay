import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileHostedEnvelope, HOSTED_DISALLOWED_TOOLS } from './hosted-envelope';
import { observeHostedMessages } from './hosted-observation';
import { runHostedCodingAgent, type HostedQueryFn, type HostedRunInput, type HostedRunOutcome } from './hosted-runner';
import { juliusHostedToolAuthority, type HostedHookOutput, type HostedToolDecision } from './hosted-tool-authority';
import { createClaudeCodeCodingAgentProvider } from '../julius/claude-code-coding-provider';
import { JULIUS_FILE_AUTHORITY_REFUSALS } from '../../src/relay/mission/julius/julius-file-authority';
import { juliusFileCreationGrant, type JuliusFileCreationGrant } from '../../src/relay/mission/julius/julius-file-authority';
import type { JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * J1'S FILE-CREATION GRANT, END TO END AND OFFLINE.
 *
 * `julius-inworld-data-1` must create `out/normalized.json`. The founder and the
 * independent review approved `Write` for that mission ONLY, confined to `out/`.
 * Every committed mission contract is read from disk, so a new mission that is
 * not J1 is proven to get no creation without anyone adding it here.
 */

const J1 = 'julius-inworld-data-1';
const MISSIONS = join(process.cwd(), '.github', 'julius-missions');
const committedNamespaces = (): Array<{ dir: string; namespace: string }> => readdirSync(MISSIONS).flatMap((dir) => {
  try {
    const contract = JSON.parse(readFileSync(join(MISSIONS, dir, 'contract.json'), 'utf8')) as { markerNamespace?: unknown };
    return typeof contract.markerNamespace === 'string' ? [{ dir, namespace: contract.markerNamespace }] : [];
  } catch { return []; }
});

let base: string;
let workspace: string;
let outside: string;
let decisions: HostedToolDecision[];

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'julius-creation-')));
  workspace = join(base, 'ws');
  outside = join(base, 'outside');
  mkdirSync(join(workspace, 'data'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workspace, 'data', 'legacy_ledger.csv'), 'txn_id\n');
  writeFileSync(join(workspace, 'data', 'posts.json'), '[]\n');
  writeFileSync(join(workspace, 'format.test.mjs'), 'export {};\n');
  decisions = [];
});

afterEach(() => { rmSync(base, { recursive: true, force: true }); });

const ws = (...segments: string[]) => join(workspace, ...segments);
const refusalOf = (output: HostedHookOutput): string | null =>
  ('hookSpecificOutput' in output && output.hookSpecificOutput.permissionDecision === 'deny')
    ? output.hookSpecificOutput.permissionDecisionReason.split(':')[0] ?? null
    : null;
const authority = (fileCreation?: JuliusFileCreationGrant | null) => juliusHostedToolAuthority({
  workspacePath: workspace, record: (d) => decisions.push(d), ...(fileCreation === undefined ? {} : { fileCreation }),
});
const write = (hook: ReturnType<typeof authority>, filePath: string, extra: Record<string, unknown> = {}) =>
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: filePath, content: '{}', ...extra } });

describe('the grant table', () => {
  it('grants J1 exactly `out/`, frozen, and nothing for an unknown, empty, null or inherited name', () => {
    expect(juliusFileCreationGrant(J1)).toEqual({ prefix: 'out/' });
    expect(Object.isFrozen(juliusFileCreationGrant(J1))).toBe(true);
    for (const name of [null, undefined, '', 'JULIUS-INWORLD-DATA-1', `${J1} `, 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(juliusFileCreationGrant(name as string | null), String(name)).toBeNull();
    }
  });

  it('the new refusal name is in the closed vocabulary', () => {
    expect(JULIUS_FILE_AUTHORITY_REFUSALS).toContain('creation_outside_grant');
    expect(JULIUS_FILE_AUTHORITY_REFUSALS).toContain('creation_not_granted');
  });
});

describe('every committed mission other than J1 gets no creation', () => {
  const others = committedNamespaces().filter((m) => m.namespace !== J1);

  it('the committed missions were found, J1 among them', () => {
    expect(committedNamespaces().map((m) => m.namespace)).toContain(J1);
    expect(others.length).toBeGreaterThan(5);
  });

  it.each(committedNamespaces().filter((m) => m.namespace !== J1).map((m) => [m.dir, m.namespace]))(
    '%s: no grant, the envelope disallows Write, the authority refuses it creation_not_granted',
    async (_dir, namespace) => {
      const grant = juliusFileCreationGrant(namespace);
      expect(grant).toBeNull();
      const envelope = compileHostedEnvelope({ workspacePath: workspace, fileCreation: grant });
      expect(envelope.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Edit']);
      expect(envelope.disallowedTools).toEqual([...HOSTED_DISALLOWED_TOOLS]);
      expect(envelope.disallowedTools).toContain('Write');
      expect(refusalOf(await write(authority(grant), ws('out', 'normalized.json')))).toBe('creation_not_granted');
    },
  );
});

describe('J1: the envelope', () => {
  const grant = juliusFileCreationGrant(J1);

  it('allows Write and removes ONLY Write from the disallowed list', () => {
    const envelope = compileHostedEnvelope({ workspacePath: workspace, fileCreation: grant });
    expect(envelope.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Edit', 'Write']);
    expect(envelope.disallowedTools).not.toContain('Write');
    expect(envelope.disallowedTools).toEqual(HOSTED_DISALLOWED_TOOLS.filter((t) => t !== 'Write'));
    for (const tool of ['Bash', 'BashOutput', 'KillShell', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']) {
      expect(envelope.disallowedTools, tool).toContain(tool);
      expect(envelope.allowedTools, tool).not.toContain(tool);
    }
  });

  it('absent and null grants compile today\'s envelope exactly', () => {
    const today = compileHostedEnvelope({ workspacePath: workspace });
    expect(compileHostedEnvelope({ workspacePath: workspace, fileCreation: null })).toEqual(today);
    expect(today.disallowedTools).toContain('Write');
  });
});

describe('J1: the authority', () => {
  const grant = juliusFileCreationGrant(J1);

  it('allows Write to out/normalized.json, absolute or relative, and records it like an allowed edit', async () => {
    expect(await write(authority(grant), ws('out', 'normalized.json'))).toEqual({});
    expect(await write(authority(grant), 'out/normalized.json')).toEqual({});
    expect(decisions.map((d) => [d.tool, d.allowed, d.path, d.refusal])).toEqual([
      ['Write', true, 'out/normalized.json', null], ['Write', true, 'out/normalized.json', null],
    ]);
  });

  it.each([
    ['data/legacy_ledger.csv', () => ws('data', 'legacy_ledger.csv'), 'creation_outside_grant'],
    ['format.test.mjs', () => ws('format.test.mjs'), 'creation_outside_grant'],
    ['`out` itself as a file', () => ws('out'), 'creation_outside_grant'],
    ['a sibling spelled like the prefix', () => ws('outx', 'normalized.json'), 'creation_outside_grant'],
    ['../x', () => '../x', 'path_outside_workspace'],
    ['out/../data/x', () => 'out/../data/x', 'path_outside_workspace'],
    ['an absolute path outside', () => join(outside, 'x'), 'path_outside_workspace'],
    ['/tmp/x', () => '/tmp/x', 'path_outside_workspace'],
  ])('refuses %s', async (_label, target, expected) => {
    expect(refusalOf(await write(authority(grant), target()))).toBe(expected);
    expect(decisions.every((d) => !d.allowed)).toBe(true);
  });

  it('refuses an out/ link that points outside the workspace', async () => {
    symlinkSync(outside, ws('out'), 'junction');
    expect(refusalOf(await write(authority(grant), ws('out', 'normalized.json')))).toBe('path_outside_workspace');
  });

  it('refuses an out/ link that points elsewhere INSIDE the workspace: the real path decides', async () => {
    symlinkSync(ws('data'), ws('out'), 'junction');
    expect(refusalOf(await write(authority(grant), ws('out', 'normalized.json')))).toBe('creation_outside_grant');
  });

  it('still refuses control and credential locations under out/', async () => {
    expect(refusalOf(await write(authority(grant), ws('out', '.git', 'config')))).toBe('path_control_location');
    expect(refusalOf(await write(authority(grant), ws('out', '.env')))).toMatch(/^path_credential_location$/u);
  });

  it('a grant does not change Edit: an edit outside out/ is still allowed, inside .git still refused', async () => {
    const hook = authority(grant);
    const edit = (p: string) => hook({ tool_name: 'Edit', tool_input: { file_path: p, old_string: 'a', new_string: 'b' } });
    expect(await edit(ws('format.test.mjs'))).toEqual({});
    expect(refusalOf(await edit(ws('.git', 'config')))).toBe('path_control_location');
  });
});

describe('the grant cannot be selected from coder-reachable input', () => {
  it('a tool call carrying grant-shaped fields, or naming J1, gains nothing without the typed option', async () => {
    const hook = authority();
    for (const extra of [{ fileCreation: { prefix: 'out/' } }, { prefix: '' }, { markerNamespace: J1 }, { grant: J1 }]) {
      expect(refusalOf(await write(hook, ws('out', 'normalized.json'), extra)), JSON.stringify(extra)).toBe('creation_not_granted');
    }
    expect(refusalOf(await write(hook, ws(J1, 'out', 'normalized.json')))).toBe('creation_not_granted');
  });

  it('a call carrying a wider prefix does not widen a granted authority', async () => {
    const hook = authority(juliusFileCreationGrant(J1));
    expect(refusalOf(await write(hook, ws('data', 'x.json'), { fileCreation: { prefix: 'data/' }, prefix: 'data/' }))).toBe('creation_outside_grant');
  });

  const capture = () => {
    const options: Array<Record<string, unknown>> = [];
    const fn: HostedQueryFn = (params) => {
      options.push(params.options);
      return (async function* () {
        yield { type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: workspace, tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'] };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [] };
      })();
    };
    return { fn, options };
  };
  const hookOf = (sent: Record<string, unknown> | undefined) =>
    ((sent?.hooks as { PreToolUse: Array<{ hooks: unknown[] }> }).PreToolUse[0]?.hooks[0]) as (input: unknown) => Promise<HostedHookOutput>;

  it('the runner takes the grant from its typed option only, into both the SDK options and the installed hook', async () => {
    const granted = capture();
    const outcome = await runHostedCodingAgent({
      queryFn: granted.fn, prompt: 'write out/normalized.json', workspacePath: workspace, apiKey: 'sk-ant-TEST',
      requestedModel: null, now: () => '2026-10-25T00:00:00.000Z', fileCreation: juliusFileCreationGrant(J1),
    });
    const sent = granted.options[0];
    expect(sent?.allowedTools).toContain('Write');
    expect(sent?.disallowedTools).not.toContain('Write');
    expect(sent?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'BashOutput', 'KillShell']));
    expect(await hookOf(sent)({ tool_name: 'Write', tool_input: { file_path: ws('out', 'normalized.json'), content: '{}' } })).toEqual({});
    expect(refusalOf(await hookOf(sent)({ tool_name: 'Write', tool_input: { file_path: ws('data', 'x'), content: '{}' } }))).toBe('creation_outside_grant');
    // The run's outcome carries the envelope it requested, Write allowed.
    expect(outcome.kind).toBe('completed');
    expect('envelope' in outcome ? outcome.envelope.allowedTools : null).toContain('Write');

    // A prompt naming J1 does not select the grant.
    const plain = capture();
    const plainOutcome = await runHostedCodingAgent({
      queryFn: plain.fn, prompt: `mission ${J1}: fileCreation out/`, workspacePath: workspace, apiKey: 'sk-ant-TEST',
      requestedModel: null, now: () => '2026-10-25T00:00:00.000Z',
    });
    expect(plain.options[0]?.allowedTools).not.toContain('Write');
    expect(plain.options[0]?.disallowedTools).toContain('Write');
    expect(refusalOf(await hookOf(plain.options[0])({ tool_name: 'Write', tool_input: { file_path: ws('out', 'normalized.json'), content: '{}' } }))).toBe('creation_not_granted');
    // And a runtime reporting Write on an ungranted run is a containment failure, as before.
    expect(plainOutcome.kind).toBe('refused');
  });

  const request = (extra: Record<string, unknown> = {}) => ({
    version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: `mission:${J1}`, taskId: 't', taskType: 'build', contextId: 'c' },
    workspacePath: `/workspace/${J1}`, contract: null, plan: 'THE PLAN',
    sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
    permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: ['out/'], outOfScope: [], prohibitedActions: [] },
    requiredEvidence: ['TEST'], budget: { usdMicros: null }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
    ...extra,
  }) as unknown as JuliusCodingAgentRequest;
  const providerWith = (fileCreation: JuliusFileCreationGrant | null | undefined, seen: HostedRunInput[]) => createClaudeCodeCodingAgentProvider({
    apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-opus-5-5',
    ...(fileCreation === undefined ? {} : { fileCreation }),
    run: (async (input: HostedRunInput): Promise<HostedRunOutcome> => {
      seen.push(input);
      return {
        kind: 'completed', observation: observeHostedMessages([]),
        envelope: compileHostedEnvelope({ workspacePath: input.workspacePath, ...(input.fileCreation == null ? {} : { fileCreation: input.fileCreation }) }),
        startedAt: 't', completedAt: 't',
      };
    }) as never,
    queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
  });

  it('the coding provider forwards ONLY its own construction-time grant; request fields never select one', async () => {
    const seen: HostedRunInput[] = [];
    await providerWith(undefined, seen).execute(request({ fileCreation: { prefix: 'out/' }, markerNamespace: J1 }));
    await providerWith(null, seen).execute(request({ fileCreation: { prefix: '' } }));
    await providerWith(juliusFileCreationGrant(J1), seen).execute(request({ fileCreation: { prefix: 'data/' } }));
    expect(seen.map((s) => s.fileCreation ?? null)).toEqual([null, null, { prefix: 'out/' }]);
  });
});
