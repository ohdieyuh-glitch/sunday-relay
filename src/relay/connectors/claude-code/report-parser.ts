import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import { REPORT_MARKER } from './prompt-compiler';

/**
 * Agent Execution Report parser (Prompt 8) — PURE. Extracts and strictly
 * validates the RELAY_AGENT_EXECUTION_REPORT_V1 block from Claude's final
 * result text. The report is an UNVERIFIED CLAIM: parsing it never makes
 * anything true. Relay's workspace inspection is the authoritative source
 * of actual changed paths — a malformed report is an adapter failure, and a
 * successful report is never invented.
 */

export interface AgentExecutionReport {
  taskId: string;
  runId: string;
  attempt: number;
  status: 'completed' | 'blocked' | 'failed';
  summary: string;
  filesRead: string[];
  filesChanged: string[];
  commandsClaimed: unknown[];
  testsClaimed: unknown[];
  remainingIssues: string[];
  manualActionRequest: unknown;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function parseAgentExecutionReport(
  finalText: string | null,
  expected: { taskId: string; runId: string },
): RelayResult<AgentExecutionReport> {
  if (typeof finalText !== 'string' || finalText.trim() === '') {
    return fail(relayError('invalid-report', 'No final result text to parse a report from.'));
  }
  const markerIndex = finalText.lastIndexOf(REPORT_MARKER);
  if (markerIndex === -1) {
    return fail(relayError('invalid-report', 'Required report marker is absent — treated as an adapter failure.'));
  }
  const after = finalText.slice(markerIndex + REPORT_MARKER.length);
  const start = after.indexOf('{');
  if (start === -1) return fail(relayError('invalid-report', 'No JSON object follows the report marker.'));

  // Balanced-brace scan (ignores braces inside strings) so trailing prose
  // after the JSON object does not break parsing.
  let depth = 0, end = -1, inString = false, escape = false;
  for (let i = start; i < after.length; i++) {
    const ch = after[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return fail(relayError('invalid-report', 'Report JSON object is not closed.'));

  let raw: unknown;
  try {
    raw = JSON.parse(after.slice(start, end + 1));
  } catch {
    return fail(relayError('invalid-report', 'Report JSON is malformed.'));
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail(relayError('invalid-report', 'Report is not a JSON object.'));
  }
  const r = raw as Record<string, unknown>;

  const errors: string[] = [];
  if (typeof r.status !== 'string' || !['completed', 'blocked', 'failed'].includes(r.status)) {
    errors.push('status must be completed|blocked|failed.');
  }
  if (typeof r.summary !== 'string' || r.summary.trim() === '') errors.push('summary must be a non-empty string.');
  if (!isStringArray(r.filesChanged)) errors.push('filesChanged must be an array of strings.');
  if (r.filesRead !== undefined && !isStringArray(r.filesRead)) errors.push('filesRead must be an array of strings.');
  if (typeof r.attempt !== 'number') errors.push('attempt must be a number.');
  if (errors.length > 0) return fail(relayError('invalid-report', 'Report failed validation.', { details: errors }));

  // Association is checked but a mismatch is a REJECTION, never a rewrite.
  if (typeof r.taskId === 'string' && r.taskId !== expected.taskId) {
    return fail(relayError('invalid-report', 'Report task id does not match the dispatched task.'));
  }
  if (typeof r.runId === 'string' && r.runId !== expected.runId) {
    return fail(relayError('invalid-report', 'Report run id does not match the dispatched run.'));
  }

  return ok({
    taskId: expected.taskId,
    runId: expected.runId,
    attempt: r.attempt as number,
    status: r.status as AgentExecutionReport['status'],
    summary: r.summary as string,
    filesRead: isStringArray(r.filesRead) ? r.filesRead : [],
    filesChanged: r.filesChanged as string[],
    commandsClaimed: Array.isArray(r.commandsClaimed) ? r.commandsClaimed : [],
    testsClaimed: Array.isArray(r.testsClaimed) ? r.testsClaimed : [],
    remainingIssues: isStringArray(r.remainingIssues) ? r.remainingIssues : [],
    manualActionRequest: r.manualActionRequest ?? null,
  });
}
