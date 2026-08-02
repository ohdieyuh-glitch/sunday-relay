import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deterministic fake Claude executable generator (Prompt 8) — OFFLINE ONLY.
 * Produces a standalone Node script that mimics
 * `claude -p --output-format stream-json` for a configured scenario,
 * emitting NDJSON on stdout and (for the success path) making a REAL file
 * edit in its cwd so the full pipeline — stream parsing, session capture,
 * workspace inspection, Relay verification — can be proven with NO provider
 * call. This is a fake; tests using it are never described as live Claude.
 */

export type FakeScenario =
  | 'success'
  | 'success_resume'
  | 'malformed_line'
  | 'missing_init'
  | 'missing_session'
  | 'wrong_session_on_resume'
  | 'max_turns'
  | 'execution_error'
  | 'timeout'
  | 'cancellation'
  | 'output_overflow'
  | 'hidden_reasoning'
  | 'report_wrong_task'
  | 'report_unclaimed_file'
  | 'manual_action_request'
  /** Reports reading an ABSOLUTE path outside the workspace, so the scope
   * audit's containment gate can be proven with no provider call. */
  | 'read_outside_workspace';

export interface FakeSpec {
  scenario: FakeScenario;
  sessionId: string;
  /** For resume mismatch: the id the resumed run reports instead. */
  wrongResumeSessionId?: string;
  taskId: string;
  runId: string;
  /** Path (workspace-relative) the fake edits for success paths. */
  editPath: string;
  editContent: string;
  /** For report_unclaimed_file: an extra file the fake writes but does not
   * claim (or claims a different path than it edits). */
  unclaimedEditPath?: string;
  /** For read_outside_workspace: the absolute path the fake REPORTS reading.
   * Nothing is actually read — the scenario proves Relay's detection, and a
   * fake must never touch a real file outside its own workspace. */
  outsideReadPath?: string;
  /** Override the report status/fields. */
  reportStatus?: 'completed' | 'blocked' | 'failed';
  manualActionRequest?: unknown;
  sleepMs?: number;
}

/** Generate the fake script text with the spec baked in. */
export function fakeClaudeSource(spec: FakeSpec): string {
  return `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const SPEC = ${JSON.stringify(spec)};

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
const argv = process.argv.slice(2);
const isResume = argv.includes('-r') || argv.includes('--resume');

// Drain stdin (the Relay prompt) without acting on it.
try { require('node:fs').readFileSync(0, 'utf8'); } catch (e) { /* no stdin */ }

const sessionId = (SPEC.scenario === 'wrong_session_on_resume' && isResume)
  ? (SPEC.wrongResumeSessionId || '00000000-0000-0000-0000-000000000000')
  : SPEC.sessionId;

function reportBlock(status, filesChanged, taskIdOverride) {
  const report = {
    attempt: isResume ? 2 : 1,
    status: status, summary: 'Fake Claude applied the requested change.',
    filesRead: [SPEC.editPath], filesChanged: filesChanged,
    commandsClaimed: [], testsClaimed: [], remainingIssues: [],
    manualActionRequest: SPEC.manualActionRequest || null,
  };
  // Only bake an id when deliberately testing a wrong-task mismatch; the
  // parser otherwise fills taskId/runId from the dispatched expectation.
  if (taskIdOverride) report.taskId = taskIdOverride;
  return 'Done.\\nRELAY_AGENT_EXECUTION_REPORT_V1\\n' + JSON.stringify(report);
}

function writeEdit(rel, content) {
  const abs = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function slowExitThenNever(ms) {
  // Stay alive so Relay's timeout/cancellation can terminate us.
  setInterval(function keepAlive() {}, 1000);
}

switch (SPEC.scenario) {
  case 'missing_init':
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'no init' }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 1, duration_ms: 5 });
    break;
  case 'missing_session':
    emit({ type: 'system', subtype: 'init', model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'no session id', num_turns: 1, duration_ms: 5 });
    break;
  case 'malformed_line':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    process.stdout.write('{ this is not valid json\\n');
    writeEdit(SPEC.editPath, SPEC.editContent);
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: SPEC.editPath } }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 2, duration_ms: 9 });
    break;
  case 'hidden_reasoning':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET internal chain of thought that must never surface' }, { type: 'text', text: 'working' }] }, session_id: sessionId });
    writeEdit(SPEC.editPath, SPEC.editContent);
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: SPEC.editPath } }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 2, duration_ms: 9 });
    break;
  case 'max_turns':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    emit({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: sessionId, num_turns: 6, duration_ms: 20 });
    break;
  case 'execution_error':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, num_turns: 1, duration_ms: 8 });
    break;
  case 'timeout':
  case 'cancellation':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    slowExitThenNever(SPEC.sleepMs || 60000);
    break;
  case 'output_overflow': {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    const big = 'x'.repeat(4096);
    for (let i = 0; i < 4096; i++) emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: big }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 1, duration_ms: 5 });
    break;
  }
  case 'report_wrong_task':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    writeEdit(SPEC.editPath, SPEC.editContent);
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath], 'tsk_wrongtask'), num_turns: 1, duration_ms: 5 });
    break;
  case 'report_unclaimed_file':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    writeEdit(SPEC.unclaimedEditPath || 'package.json', '{"tampered":true}\\n');
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: SPEC.unclaimedEditPath || 'package.json' } }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 1, duration_ms: 5 });
    break;
  case 'manual_action_request':
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Edit'] });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('blocked', []), num_turns: 1, duration_ms: 5 });
    break;
  case 'read_outside_workspace':
    // Reports a read OUTSIDE the workspace and otherwise behaves perfectly:
    // valid stream, correct edit, clean exit, honest-looking report. Relay
    // must still refuse it, which is the whole point of the gate.
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Read', 'Edit'] });
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't0', name: 'Read', input: { file_path: SPEC.outsideReadPath || '/etc/hosts' } }] }, session_id: sessionId });
    writeEdit(SPEC.editPath, SPEC.editContent);
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: SPEC.editPath } }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock('completed', [SPEC.editPath]), num_turns: 2, duration_ms: 12 });
    break;
  case 'success':
  case 'success_resume':
  default:
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', cwd: process.cwd(), tools: ['Read', 'Edit', 'Grep'] });
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't0', name: 'Read', input: { file_path: SPEC.editPath } }] }, session_id: sessionId });
    writeEdit(SPEC.editPath, SPEC.editContent);
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: SPEC.editPath } }] }, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: reportBlock(SPEC.reportStatus || 'completed', [SPEC.editPath]), num_turns: 2, duration_ms: 12, total_cost_usd: 0.01 });
    break;
}
`;
}

/** Write the fake executable into a directory and make it runnable. */
export function writeFakeClaude(dir: string, spec: FakeSpec, fileName = 'fake-claude.cjs'): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, fakeClaudeSource(spec));
  chmodSync(filePath, 0o755);
  return filePath;
}
