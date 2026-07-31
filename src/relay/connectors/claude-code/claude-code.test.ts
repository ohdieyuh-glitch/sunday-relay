import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeEnvironment, apiKeyEnvironmentDetected } from './environment';
import { compileClaudePermissions, toolPolicyArgs, FORBIDDEN_TOOLS } from './permission-compiler';
import { compileClaudePrompt, compileRevisionPrompt, REPORT_MARKER } from './prompt-compiler';
import { parseAgentExecutionReport } from './report-parser';
import { createStreamParser, streamIsStructurallyValid } from './stream-parser';
import { createSessionManager, type SessionAssociation } from './session-manager';
import { assessProjectSettings } from './config';
import { classifyClaudeAuth, resolveClaudeExecutable } from './capability-probe';
import { runClaudeContractVerification } from './contract-verify';
import type { AgentHandoffPackage } from '../../protocol/contracts';
import type { ClaudeCodeCapabilityProfile } from './contracts';

/**
 * Claude Code adapter unit tests (Prompt 8) — pure modules + the full
 * offline contract harness. No provider call is ever made.
 */

const CAPS: ClaudeCodeCapabilityProfile = {
  executablePath: '/fake/claude', version: '2.1.0', nonInteractiveSupported: true, streamJsonSupported: true,
  explicitResumeSupported: true, maxTurnsSupported: false, allowedToolsSupported: true, disallowedToolsSupported: true,
  toolsRestrictionSupported: true, permissionModeSupported: true, systemPromptSupported: true,
  appendSystemPromptSupported: true, structuredSchemaSupported: true, mcpIsolationSupported: 'available',
  settingsIsolationSupported: 'available', cancellationSupported: true, probedAt: 't', provenance: 'live',
};

const pkg = (): AgentHandoffPackage => ({
  packageId: 'pkg_x' as never, protocolVersion: 'relay.protocol.v1', projectId: 'prj_x' as never,
  runId: 'run_x' as never, taskId: 'tsk_x' as never, targetAdapterId: 'claude-code-local', role: 'coding-agent',
  objective: 'Implement the normalizer.', responsibilityBoundary: 'Edit only src/normalize.js.',
  contextRefs: ['baseRevision:abc'], requiredInputs: ['src/normalize.js'],
  permittedTools: [{ value: 'Edit', enforcement: 'advisory' }],
  permittedFiles: [{ value: 'src/normalize.js', enforcement: 'advisory' }],
  prohibitedActions: [{ value: 'protected:.git', enforcement: 'enforced' }],
  dependencies: [], acceptanceCriteria: ['tests pass'], requiredEvidence: ['node --test'],
  budget: {}, stoppingCondition: { description: 'stop when done' }, expectedReportType: 'implementation',
  contextVersion: 0 as never, ledgerVersion: 0 as never, baseRevision: 'abc', createdAt: 't',
  idempotencyKey: 'idk' as never,
});

describe('environment filtering', () => {
  it('strips provider credentials and third-party secrets, keeps base vars', () => {
    const base = {
      PATH: '/usr/bin', HOME: '/home/u', LANG: 'C',
      ANTHROPIC_API_KEY: 'sk-should-not-pass', ANTHROPIC_AUTH_TOKEN: 'tok', // relay-boundary:allow-fixture — synthetic, asserts the adapter refuses it
      OPENAI_API_KEY: 'x', AWS_SECRET_ACCESS_KEY: 'y', MY_SERVICE_TOKEN: 'z',
    };
    const { env, grantedKeys, strippedKeys } = buildClaudeEnvironment(base);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.MY_SERVICE_TOKEN).toBeUndefined();
    expect(grantedKeys).toContain('PATH');
    expect(strippedKeys).toContain('ANTHROPIC_API_KEY');
  });

  it('detects an API-key environment by name only', () => {
    expect(apiKeyEnvironmentDetected({ ANTHROPIC_API_KEY: 'x' })).toBe(true);
    expect(apiKeyEnvironmentDetected({ CLAUDE_CODE_USE_BEDROCK: '1' })).toBe(true);
    expect(apiKeyEnvironmentDetected({ PATH: '/usr/bin' })).toBe(false);
  });
});

describe('permission compiler', () => {
  it('allows read/edit only, never Bash/network/MCP, uses acceptEdits', () => {
    const policy = compileClaudePermissions({ pkg: pkg(), capabilities: CAPS });
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'Edit']));
    expect(policy.allowedTools).not.toContain('Bash');
    expect(policy.allowedTools).not.toContain('Write'); // no file creation by default
    expect(policy.disallowedTools).toEqual(expect.arrayContaining([...FORBIDDEN_TOOLS]));
    expect(policy.permissionMode).toBe('acceptEdits');
    expect(policy.editPathScopingEnforced).toBe(false);
  });

  it('adds Write only when file creation is required', () => {
    const policy = compileClaudePermissions({ pkg: pkg(), capabilities: CAPS, requiresFileCreation: true });
    expect(policy.availableTools).toContain('Write');
  });

  it('emits tool-restriction args and never a skip-permissions flag', () => {
    const policy = compileClaudePermissions({ pkg: pkg(), capabilities: CAPS });
    const args = toolPolicyArgs(policy, CAPS);
    expect(args).toContain('--tools');
    expect(args).toContain('--disallowedTools');
    expect(args).toContain('--permission-mode');
    expect(args.join(' ')).not.toContain('dangerously-skip-permissions');
  });
});

describe('prompt compiler', () => {
  const ctx = () => ({
    pkg: pkg(), runId: 'run_x', taskId: 'tsk_x', workspaceRelativeRoot: '.',
    readOnlyFiles: ['test'], protectedFiles: ['package.json', '.git'],
    relayVerificationCommands: ['node --test test/normalize.test.js'],
    limits: { maxTurns: null, maxRuntimeMs: 360000, maxStdoutBytes: 1, maxStderrBytes: 1, maxNormalizedEvents: 1, maxAutomaticRepairs: 1 as const, maxLiveCallsPerRun: 2 },
  });

  it('preserves responsibility, claims, protected paths, evidence, and the report marker', () => {
    const prompt = compileClaudePrompt(ctx());
    expect(prompt).toContain('Edit only src/normalize.js.');
    expect(prompt).toContain('Implement the normalizer.');
    expect(prompt).toContain('src/normalize.js');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('node --test test/normalize.test.js');
    expect(prompt).toContain(REPORT_MARKER);
    expect(prompt).toContain('Do not deploy, push, commit');
    expect(prompt).toContain('Do not access parent directories');
    expect(prompt).toContain('A completion statement is a claim, not proof.');
  });

  it('excludes transcript/ledger dumps and secrets', () => {
    const prompt = compileClaudePrompt(ctx());
    expect(prompt.toLowerCase()).not.toContain('transcript');
    expect(prompt.toLowerCase()).not.toContain('chain of thought');
  });

  it('revision prompt is narrow: attempt 2, findings only, unchanged constraints', () => {
    const revision = compileRevisionPrompt({
      revision: {} as never, runId: 'run_x', taskId: 'tsk_x',
      findingSummaries: ['fix the off-by-one'], relayVerificationCommands: ['node --test'],
    });
    expect(revision).toContain('ONE focused repair');
    expect(revision).toContain('fix the off-by-one');
    expect(revision).toContain('attempt 2');
    expect(revision).toContain('do not modify unclaimed or protected files');
    expect(revision).not.toContain('Implement the normalizer.'); // not the whole original prompt
  });
});

describe('report parser', () => {
  const report = (extra: Record<string, unknown> = {}) =>
    `Done.\n${REPORT_MARKER}\n${JSON.stringify({ attempt: 1, status: 'completed', summary: 's', filesRead: ['a'], filesChanged: ['src/normalize.js'], commandsClaimed: [], testsClaimed: [], remainingIssues: [], manualActionRequest: null, ...extra })}`;

  it('parses a valid report and tolerates trailing prose', () => {
    const result = parseAgentExecutionReport(report() + '\nthanks!', { taskId: 'tsk_x', runId: 'run_x' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.filesChanged).toEqual(['src/normalize.js']);
  });

  it('rejects a missing marker, malformed JSON, wrong task, and bad status', () => {
    expect(parseAgentExecutionReport('no marker here', { taskId: 'tsk_x', runId: 'run_x' }).ok).toBe(false);
    expect(parseAgentExecutionReport(`${REPORT_MARKER}\n{ broken`, { taskId: 'tsk_x', runId: 'run_x' }).ok).toBe(false);
    expect(parseAgentExecutionReport(report({ taskId: 'tsk_other' }), { taskId: 'tsk_x', runId: 'run_x' }).ok).toBe(false);
    expect(parseAgentExecutionReport(report({ status: 'great' }), { taskId: 'tsk_x', runId: 'run_x' }).ok).toBe(false);
    expect(parseAgentExecutionReport(null, { taskId: 'tsk_x', runId: 'run_x' }).ok).toBe(false);
  });
});

describe('stream parser', () => {
  it('parses NDJSON incrementally across partial chunks and blank lines', () => {
    const parser = createStreamParser();
    parser.push('{"type":"sys');
    parser.push('tem","subtype":"init","session_id":"s1","model":"m"}\n\n');
    parser.push('{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"src/a.js"}}]},"session_id":"s1"}\n');
    parser.push('{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","num_turns":2}\n');
    const state = parser.end();
    expect(state.initSeen).toBe(true);
    expect(state.sessionId).toBe('s1');
    expect(state.model).toBe('m');
    expect(state.toolActivity[0]).toEqual({ tool: 'Edit', targets: ['src/a.js'] });
    expect(state.resultSubtype).toBe('success');
    expect(streamIsStructurallyValid(state).ok).toBe(true);
  });

  it('omits hidden reasoning, counts unknown and malformed records, never crashing', () => {
    const parser = createStreamParser();
    parser.push('{"type":"system","subtype":"init","session_id":"s1"}\n');
    parser.push('{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"SECRET"}]},"session_id":"s1"}\n');
    parser.push('{"type":"future_record_type","data":1}\n');
    parser.push('not json at all\n');
    parser.push('{"type":"result","subtype":"success","is_error":false,"result":"x","session_id":"s1"}\n');
    const state = parser.end();
    expect(state.thinkingBlocksOmitted).toBe(1);
    expect(state.unknownRecordCount).toBe(1);
    expect(state.malformedLineCount).toBe(1);
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  it('flags structurally invalid streams (missing init / session / result)', () => {
    const noInit = createStreamParser();
    noInit.push('{"type":"result","subtype":"success","session_id":"s1"}\n');
    expect(streamIsStructurallyValid(noInit.end()).ok).toBe(false);
  });
});

describe('session manager', () => {
  const assoc: SessionAssociation = {
    projectId: 'prj_x' as never, runId: 'run_x' as never, taskId: 'tsk_x' as never,
    workspaceId: 'wsp_x' as never, adapterId: 'claude-code-local',
  };
  it('captures once, resumes the exact session, rejects wrong ids and a second repair', () => {
    const sessions = createSessionManager(() => 't');
    expect(sessions.capture(assoc, 'sess-1').ok).toBe(true);
    expect(sessions.capture(assoc, 'sess-1').ok).toBe(false); // duplicate
    const plan = sessions.prepareResume(assoc);
    expect(plan.ok && plan.value.claudeSessionId).toBe('sess-1');
    expect(sessions.confirmResume(assoc, 'other').ok).toBe(false); // wrong id
    expect(sessions.confirmResume(assoc, 'sess-1').ok).toBe(true);
    expect(sessions.prepareResume(assoc).ok).toBe(false); // second repair
  });
  it('never stores a token — only the session id and association', () => {
    const sessions = createSessionManager(() => 't');
    sessions.capture(assoc, 'sess-1');
    const serialized = JSON.stringify(sessions.list());
    expect(serialized).toContain('sess-1');
    expect(serialized.toLowerCase()).not.toContain('token');
  });
});

describe('project settings assessment', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  it('treats a clean directory as clean and CLAUDE.md alone as clean', () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-cfg-'));
    expect(assessProjectSettings(dir, 't').risk).toBe('clean');
  });
});

describe('capability probe helpers', () => {
  it('classifies an API-key environment as disallowed', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      const auth = classifyClaudeAuth('t', '/fake/claude');
      expect(auth.sourceClass).toBe('api_key');
      expect(auth.approvedForLiveRun).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
  it('returns null for a non-existent explicit executable', () => {
    expect(resolveClaudeExecutable('/nonexistent/claude/binary')).toBeNull();
  });
});

describe('offline contract harness (full pipeline, no provider call)', () => {
  it('passes every contract check', async () => {
    const { checks, failures } = await runClaudeContractVerification();
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    expect(failed, failed.join('\n')).toEqual([]);
    expect(failures).toBe(0);
  }, 60_000);
});
