import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewReportFinding, ReviewReportVerdict } from './contracts';

/**
 * Deterministic FAKE Codex executable (Prompt 8.3) — used by the offline
 * contract verifier and unit tests. It NEVER calls a provider. Like a real
 * reviewer, it reads the review contract from stdin and echoes the exact
 * review id / mission id / task id / revisions / workspace revision back in
 * its report (so the report matches whatever ids Relay minted at runtime); the
 * VERDICT and findings come from the scripted spec. These are FAKE-EXECUTABLE
 * tests, never live Codex tests. Only the explicit `modify_workspace` scenario
 * writes into the workspace (to prove Relay's before/after gate rejects a
 * misbehaving reviewer); every other scenario is read-only.
 */

export type FakeReviewerScenario =
  | 'approved'
  | 'changes_required'
  | 'blocked'
  | 'needs_human'
  | 'unknown_events'
  | 'missing_init'
  | 'missing_session'
  | 'wrong_session_on_resume'
  | 'malformed_report'
  | 'secret_output'
  | 'hidden_reasoning'
  | 'timeout'
  | 'cancellation'
  | 'output_overflow'
  | 'process_error'
  | 'modify_workspace'
  | 'wrong_id_field';

export interface FakeReviewerSpec {
  scenario: FakeReviewerScenario;
  sessionId: string;
  /** Session id the fake emits on resume (defaults to sessionId). */
  emittedResumeSessionId?: string;
  verdict?: ReviewReportVerdict;
  summary?: string;
  findings?: ReviewReportFinding[];
  /** For wrong_id_field: which field to corrupt and to what. */
  corruptField?: 'reviewId' | 'missionId' | 'taskId' | 'reviewedMissionRevision' | 'reviewedTaskRevision' | 'reviewedWorkspaceRevision';
  corruptValue?: string | number;
  /** Relative path the modify_workspace scenario writes into cwd. */
  modifyPath?: string;
}

export function fakeCodexSource(spec: FakeReviewerSpec): string {
  return `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const SPEC = ${JSON.stringify(spec)};

function findFlag(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const isResume = process.argv.includes('resume');
const outputPath = findFlag('--output-last-message');
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', run);
process.stdin.resume();

function parseContract(text) {
  const m = (re) => { const r = text.match(re); return r ? r[1] : ''; };
  return {
    reviewId: m(/REVIEW ID: (\\S+)/),
    missionId: m(/MISSION: (\\S+) \\(revision \\d+\\)/),
    missionRevision: Number(m(/MISSION: \\S+ \\(revision (\\d+)\\)/) || '1'),
    taskId: m(/TASK: (\\S+) \\(revision \\d+\\)/),
    taskRevision: Number(m(/TASK: \\S+ \\(revision (\\d+)\\)/) || '1'),
    workspaceRevision: m(/WORKSPACE REVISION UNDER REVIEW: (\\S+)/),
  };
}

function buildReport() {
  const c = parseContract(stdin);
  const report = {
    reviewId: c.reviewId, missionId: c.missionId, taskId: c.taskId,
    reviewedMissionRevision: c.missionRevision, reviewedTaskRevision: c.taskRevision,
    reviewedWorkspaceRevision: c.workspaceRevision,
    reviewerRole: 'independent_coding_reviewer',
    verdict: SPEC.verdict || 'changes_required',
    summary: SPEC.summary || 'Independent review of the changed dispatch guard.',
    findings: SPEC.findings || [],
    evidenceReviewed: ['git diff', 'node --test test/dispatch.test.js'],
    limitations: ['Reviewed only the claimed changed file.'],
  };
  if (SPEC.corruptField) report[SPEC.corruptField] = SPEC.corruptValue;
  return report;
}

function writeReport() {
  if (!outputPath) return;
  if (SPEC.scenario === 'malformed_report') { fs.writeFileSync(outputPath, '{ this is not: json'); return; }
  fs.writeFileSync(outputPath, JSON.stringify(buildReport()));
}

function run() {
  if (SPEC.scenario === 'process_error') {
    emit({ type: 'error', message: 'reviewer failed to start the model turn' });
    process.exit(2);
    return;
  }
  if (SPEC.scenario === 'timeout' || SPEC.scenario === 'cancellation') {
    setInterval(() => {}, 1000);
    emit({ type: 'session.created', session_id: SPEC.sessionId });
    return;
  }

  if (SPEC.scenario !== 'missing_init') {
    const sid = isResume ? (SPEC.emittedResumeSessionId || SPEC.sessionId) : SPEC.sessionId;
    if (SPEC.scenario === 'missing_session') emit({ type: 'session.created' });
    else emit({ type: 'session.created', session_id: sid, model: 'codex-fake' });
  }

  emit({ type: 'item.completed', item: { role: 'assistant', text: 'Inspecting the actual changed files (git diff).' } });
  emit({ type: 'command', command: 'git diff' });
  emit({ type: 'item.completed', item: { role: 'assistant', text: 'Inspecting verification evidence and tests.' } });

  if (SPEC.scenario === 'unknown_events') {
    emit({ type: 'future.unknown.event.v9', detail: 'safe to ignore' });
    emit({ type: 'another_unknown', foo: 'bar' });
  }
  if (SPEC.scenario === 'hidden_reasoning') {
    emit({ type: 'reasoning', text: 'SECRET internal chain of thought that must be dropped.' });
  }
  if (SPEC.scenario === 'secret_output') {
    emit({ type: 'item.completed', item: { role: 'assistant', text: 'leaked key sk-FAKETESTNOTREAL0000 here' } });
  }
  if (SPEC.scenario === 'output_overflow') {
    // Buffer far more than the stdout limit via async writes, then stay alive
    // (do NOT exit — process.exit would discard the buffered output) so Relay
    // observes the overflow and terminates us.
    const big = 'x'.repeat(4096);
    for (let i = 0; i < 800; i++) emit({ type: 'item.completed', item: { role: 'assistant', text: big } });
    setInterval(() => {}, 1000);
    return;
  }
  if (SPEC.scenario === 'modify_workspace') {
    try { fs.writeFileSync(SPEC.modifyPath || 'reviewer-scratch.txt', 'the reviewer should not have written this'); } catch (e) {}
  }

  writeReport();

  if (SPEC.scenario !== 'malformed_report' && SPEC.scenario !== 'secret_output') {
    emit({ type: 'item.completed', item: { role: 'assistant', text: 'RELAY_REVIEW_REPORT_V1\\n' + JSON.stringify(buildReport()) } });
  }
  emit({ type: 'turn.completed' });
  process.exit(0);
}
`;
}

export function writeFakeCodex(dir: string, spec: FakeReviewerSpec, fileName = 'fake-codex.cjs'): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, fakeCodexSource(spec), 'utf8');
  chmodSync(filePath, 0o755);
  return filePath;
}

/* --------------------------- canned findings ------------------------ */

/** The blocking finding the seeded defect should elicit — used to script the
 * fake's changes_required / blocked reports. */
export const SEEDED_BLOCKING_FINDING: ReviewReportFinding = {
  severity: 'high',
  title: 'Provider dispatch remains possible when only one safety control is active.',
  description: 'isDispatchBlocked uses && instead of ||, so a rate-limited actor or an active spending breaker alone does not block dispatch. The tests omit the single-condition cases.',
  evidence: ['src/dispatch.js returns rateLimited && spendingBreakerActive', 'test/dispatch.test.js covers only neither/both'],
  affectedFiles: ['src/dispatch.js'],
  affectedCriterionIds: ['AC-1'],
  requiredAction: 'Change && to || and add tests for rate-limit-only and breaker-only.',
  blocking: true,
};
