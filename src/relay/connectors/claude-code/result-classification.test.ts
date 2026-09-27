import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_RESULT_CLASSES,
  CLAUDE_CODE_RESULT_SUBTYPES,
  CLAUDE_CODE_TERMINAL_REASONS,
  claudeCodeResultRefusalReason,
  claudeCodeResultRefused,
  classifyClaudeCodeResult,
  readClaudeCodeErrorFlag,
  readClaudeCodeTerminalReason,
} from './result-classification';
import { createStreamParser, type ParsedStreamState } from './stream-parser';
import { toObservedRun } from './run-observation-adapter';
import { normalizeClaudeRun, type NormalizeContext } from './event-normalizer';
import type { ClaudeRunOutcome } from './process-runner';

/**
 * A RESULT IS A SUCCESS ONLY WHEN EVERY FIELD SAYS SO.
 *
 * Both Claude Code surfaces decided from `is_error` alone, so an error subtype
 * beside `is_error: false` — or beside no flag at all — was a completed session.
 */

const ERROR_SUBTYPES = CLAUDE_CODE_RESULT_SUBTYPES.filter((subtype) => subtype !== 'success');

describe('the classifier reads every field of the result', () => {
  it('trusts only success, is_error false, and a completed or absent terminal reason', () => {
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false })).toBe('SUCCESS');
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false, terminalReason: null })).toBe('SUCCESS');
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false, terminalReason: 'completed' })).toBe('SUCCESS');
  });

  it('an error subtype is that error whatever is_error says', () => {
    const expected: Record<string, string> = {
      error_during_execution: 'EXECUTION_ERROR',
      error_max_turns: 'MAX_TURNS',
      error_max_budget_usd: 'BUDGET_STOP',
      error_max_structured_output_retries: 'STRUCTURED_OUTPUT_RETRIES_EXHAUSTED',
    };
    for (const subtype of ERROR_SUBTYPES) {
      for (const isError of [true, false, null]) {
        for (const terminalReason of [null, 'completed']) {
          const fields = { resultSubtype: subtype, isError, terminalReason };
          expect(classifyClaudeCodeResult(fields), `${subtype} / is_error ${String(isError)} / ${String(terminalReason)}`).toBe(expected[subtype]);
          expect(claudeCodeResultRefused(fields)).toBe(true);
        }
      }
    }
  });

  it('a success that did not say it was not an error is not a success', () => {
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: null })).toBe('ERROR_FLAG_UNREPORTED');
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: true })).toBe('REPORTED_ERROR');
  });

  it('a success that ended for any other terminal reason is refused, including one it does not know', () => {
    for (const reason of CLAUDE_CODE_TERMINAL_REASONS.filter((item) => item !== 'completed')) {
      expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false, terminalReason: reason }), reason)
        .toBe('TERMINAL_REASON_NOT_COMPLETED');
    }
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false, terminalReason: 'unrecognised' }))
      .toBe('TERMINAL_REASON_NOT_COMPLETED');
    expect(classifyClaudeCodeResult({ resultSubtype: 'success', isError: false, terminalReason: 'something_new' }))
      .toBe('TERMINAL_REASON_NOT_COMPLETED');
  });

  it('refuses a subtype it does not know rather than trusting it', () => {
    expect(classifyClaudeCodeResult({ resultSubtype: 'error_invented_later', isError: false })).toBe('UNKNOWN_SUBTYPE');
    expect(classifyClaudeCodeResult({ resultSubtype: 'Success', isError: false })).toBe('UNKNOWN_SUBTYPE');
    expect(classifyClaudeCodeResult({ resultSubtype: '', isError: false })).toBe('UNKNOWN_SUBTYPE');
  });

  it('no result is NO_RESULT, and refused only when a result record was seen', () => {
    expect(classifyClaudeCodeResult({ resultSubtype: null, isError: null })).toBe('NO_RESULT');
    expect(claudeCodeResultRefused({ resultSubtype: null, isError: null })).toBe(false);
    // A result record that carried a flag and no subtype still arrived, and is not a success.
    expect(claudeCodeResultRefused({ resultSubtype: null, isError: false })).toBe(true);
    expect(claudeCodeResultRefused({ resultSubtype: null, isError: true })).toBe(true);
    expect(claudeCodeResultRefused({ resultSubtype: 'success', isError: false })).toBe(false);
  });

  it('is total: every combination maps to exactly one class of the vocabulary', () => {
    const subtypes = [null, ...CLAUDE_CODE_RESULT_SUBTYPES, 'error_unknown'];
    for (const resultSubtype of subtypes) {
      for (const isError of [true, false, null]) {
        for (const terminalReason of [undefined, null, ...CLAUDE_CODE_TERMINAL_REASONS, 'unrecognised']) {
          const resultClass = classifyClaudeCodeResult({ resultSubtype, isError, terminalReason });
          expect(CLAUDE_CODE_RESULT_CLASSES).toContain(resultClass);
          expect(claudeCodeResultRefusalReason({ resultSubtype, isError, terminalReason }) === null).toBe(resultClass === 'SUCCESS');
        }
      }
    }
  });
});

describe('the runtime\'s strings are matched, never forwarded', () => {
  it('reads is_error as true, false or unreported — never defaulted to false', () => {
    expect(readClaudeCodeErrorFlag(true)).toBe(true);
    expect(readClaudeCodeErrorFlag(false)).toBe(false);
    for (const value of [undefined, null, 'false', 0, 1, {}]) expect(readClaudeCodeErrorFlag(value)).toBeNull();
  });

  it('reads terminal_reason as a vocabulary member, unrecognised, or absent', () => {
    expect(readClaudeCodeTerminalReason(undefined)).toBeNull();
    expect(readClaudeCodeTerminalReason(null)).toBeNull();
    expect(readClaudeCodeTerminalReason('completed')).toBe('completed');
    expect(readClaudeCodeTerminalReason('hook_stopped')).toBe('hook_stopped');
    expect(readClaudeCodeTerminalReason('sk-ant-api03-SECRET quoted back')).toBe('unrecognised');
    expect(readClaudeCodeTerminalReason(7)).toBe('unrecognised');
  });

  it('a refusal reason never quotes a subtype or terminal reason it does not know', () => {
    const hostile = 'sk-ant-api03-SECRET quoted back';
    expect(claudeCodeResultRefusalReason({ resultSubtype: hostile, isError: false })).not.toContain('SECRET');
    expect(claudeCodeResultRefusalReason({ resultSubtype: 'success', isError: false, terminalReason: hostile })).not.toContain('SECRET');
  });
});

describe('the vocabulary is the SDK\'s', () => {
  it('names exactly the terminal reasons and result subtypes the installed SDK declares', () => {
    const sdk = readFileSync(join(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts'), 'utf8');
    const terminal = /export declare type TerminalReason = ([^;]+);/u.exec(sdk);
    expect(terminal, 'the SDK no longer declares TerminalReason where this test reads it').not.toBeNull();
    const declared = [...terminal![1]!.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1]).sort();
    expect([...CLAUDE_CODE_TERMINAL_REASONS].sort()).toEqual(declared);
    const errorSubtypes = /export declare type SDKResultError = \{\s*type: 'result';\s*subtype: ([^;]+);/u.exec(sdk);
    expect(errorSubtypes).not.toBeNull();
    const declaredSubtypes = ['success', ...[...errorSubtypes![1]!.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1])].sort();
    expect([...CLAUDE_CODE_RESULT_SUBTYPES].sort()).toEqual(declaredSubtypes);
  });
});

describe('the local stream parser keeps what the result said', () => {
  const stream = (result: Record<string, unknown>): string => [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', cwd: '/w' }),
    JSON.stringify({ type: 'result', session_id: 's1', num_turns: 1, ...result }),
  ].join('\n').concat('\n');

  it('an absent is_error is unreported, not false', () => {
    const parser = createStreamParser();
    parser.push(stream({ subtype: 'success', result: 'x' }));
    const state = parser.end();
    expect(state.isError).toBeNull();
    expect(claudeCodeResultRefused(state)).toBe(true);
  });

  it('keeps terminal_reason, and an error subtype beside is_error:false is refused', () => {
    const parser = createStreamParser();
    parser.push(stream({ subtype: 'error_max_turns', is_error: false, terminal_reason: 'max_turns' }));
    const state = parser.end();
    expect(state.isError).toBe(false);
    expect(state.terminalReason).toBe('max_turns');
    expect(classifyClaudeCodeResult(state)).toBe('MAX_TURNS');
    expect(claudeCodeResultRefused(state)).toBe(true);
  });
});

describe('the local surface reads the same classifier: the run record and the event stream', () => {
  const state = (result: Partial<ParsedStreamState>): ParsedStreamState => ({
    initSeen: true, sessionId: 's1', model: 'm', cwd: '/w', toolActivity: [], finalResult: 'report',
    resultSubtype: 'success', isError: false, terminalReason: null,
    usage: { numTurns: 2, durationMs: 1_000, apiDurationMs: 800, reportedCostUsd: 0.01 },
    unknownRecordCount: 0, malformedLineCount: 0, thinkingBlocksOmitted: 0, assistantTextChunks: [],
    ...result,
  });
  const run = (parsed: ParsedStreamState): ClaudeRunOutcome => ({
    parsed, stderr: '', exitCode: 0, signal: null, startedAt: '2026-09-17T12:00:00.000Z', completedAt: '2026-09-17T12:00:01.000Z',
    durationMs: 1_000, timedOut: false, cancelled: false, outputTruncated: false, termination: 'not_required', redactions: 0,
  } as ClaudeRunOutcome);
  const ctx = {
    projectId: 'prj', runId: 'run', taskId: 'tsk', workspaceId: 'ws', adapterId: 'claude-code', attempt: 1, now: '2026-09-17T12:00:01.000Z',
  } as unknown as NormalizeContext;
  const refused: readonly Partial<ParsedStreamState>[] = [
    { resultSubtype: 'error_max_turns', isError: false },
    { resultSubtype: 'success', isError: null },
    { resultSubtype: 'success', isError: false, terminalReason: 'hook_stopped' },
    { resultSubtype: 'error_invented_later', isError: false },
  ];

  it('the run record calls a refused result a reported error, and only a success completed', () => {
    for (const result of refused) {
      expect(toObservedRun(run(state(result))).termination, JSON.stringify(result)).toBe('reported_error');
    }
    expect(toObservedRun(run(state({}))).termination).toBe('completed');
    expect(toObservedRun(run(state({ terminalReason: 'completed' }))).termination).toBe('completed');
  });

  it('the event stream says the process failed, and never that a report was created', () => {
    for (const result of refused) {
      const kinds = normalizeClaudeRun(ctx, state(result), run(state(result))).map((event) => event.kind);
      expect(kinds, JSON.stringify(result)).toContain('agent.process_failed');
      expect(kinds, JSON.stringify(result)).not.toContain('agent.report_created');
    }
    const healthy = normalizeClaudeRun(ctx, state({}), run(state({}))).map((event) => event.kind);
    expect(healthy).toContain('agent.report_created');
    expect(healthy).not.toContain('agent.process_failed');
  });
});
