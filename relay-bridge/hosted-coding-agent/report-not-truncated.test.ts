import { describe, expect, it } from 'vitest';

import { observeHostedMessages } from './hosted-observation';
import { REPORT_MARKER } from '../../src/relay/connectors/claude-code/prompt-compiler';
import { parseAgentExecutionReport } from '../../src/relay/connectors/claude-code/report-parser';

/**
 * A REAL REPORT IS LONGER THAN THE DISPLAY LIMIT.
 *
 * The hosted surface captured the agent's final result through `safeText` —
 * the sanitizer for short event strings, which collapses whitespace and
 * truncates at 600 characters. Relay's structured execution report is longer
 * than that, so every hosted run was guillotined mid-JSON before the parser
 * saw it. The mission died with "Report JSON object is not closed", or with
 * "Required report marker is absent" when the cut landed earlier.
 *
 * Both refusals were correct about the text they were handed and wrong about
 * the agent, which had done the work: `result=success turns=5 toolsUsed=3`.
 *
 * The existing tests passed because their fixtures were SHORT. A report that
 * fits under the limit cannot detect a limit. This one is deliberately over
 * it, which is the only shape that fails against the old code.
 */

/** A report with the shape the prompt asks for, longer than the 600 cap. */
const realisticReport = (): string => {
  const summary = 'Implemented the guard and added a failing-first test. '.repeat(8);
  return [
    'I inspected the fixture, added the version guard, and re-ran the test.',
    '',
    REPORT_MARKER,
    JSON.stringify({
      attempt: 1,
      status: 'completed',
      summary,
      filesChanged: ['src/normalize.js'],
      testsRun: true,
      notes: 'The guard refuses an unknown schema version.',
    }),
  ].join('\n');
};

describe('the hosted surface preserves the report it is given', () => {
  const text = realisticReport();

  it('uses a fixture that is actually longer than the display cap', () => {
    // Guards the guard: a shorter fixture would pass against the old code and
    // prove nothing, which is exactly why this went undetected.
    expect(text.length).toBeGreaterThan(600);
  });

  it('captures the final result verbatim', () => {
    const observed = observeHostedMessages([
      { type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 5 },
    ]);
    expect(observed.finalText).toBe(text);
  });

  it('the captured text still PARSES as a report', () => {
    // The property that matters end to end: what the hosted surface hands the
    // parser is something the parser accepts.
    const observed = observeHostedMessages([
      { type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 5 },
    ]);
    const parsed = parseAgentExecutionReport(observed.finalText, { taskId: 't', runId: 'r' });
    expect(parsed.ok).toBe(true);
  });

  it('a truncated report is REFUSED, so the parser is still strict', () => {
    // The fix must not make Relay accept a damaged report. Cutting the same
    // text at the old boundary still fails.
    const cut = text.slice(0, 599);
    expect(parseAgentExecutionReport(cut, { taskId: 't', runId: 'r' }).ok).toBe(false);
  });

  it('reports nothing as null rather than an empty string', () => {
    const observed = observeHostedMessages([
      { type: 'result', subtype: 'success', is_error: false, num_turns: 1 },
    ]);
    expect(observed.finalText).toBeNull();
  });
});
