import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { participantIdForIdentity } from '../relay-bridge/github-auth-routes';
import { CODER_WORKER, architectWorker, reviewerWorker } from '../relay-bridge/julius/live-composition';
import { JULIUS_CAPABILITY_DRILLS, capabilityDrill, drillDrivenFiles, importClosure } from './julius-drill-closure.mjs';
import { ACCOUNT_PARTICIPANT_ID, BUNDLE_MANIFEST, evaluate, type BetaGateReport, type BetaVerdict } from './wonderland-beta-gate.mjs';
// The gate's newer exports, read through the namespace so this file still loads
// (and its cases go red one by one) against a gate that predates them.
import * as gateModule from './wonderland-beta-gate.mjs';

/**
 * THE GATE, HELD TO ITS OWN RULE.
 *
 * What is worth testing here is not that sixteen rows appear. It is that the
 * gate CANNOT be talked into an optimistic answer: no repository state, however
 * complete, may produce a PASS for a capability that runs at mission time. Every
 * PASS has to be read out of a real run BOUND to this checkout — a manifest
 * naming this commit, a paid mode and one run — and credited to a real
 * provider; every CAPABILITY PROVEN has to be read out of a drill that RAN,
 * whose attestation still matches every file that drill drives.
 *
 * The bundles below are written in the shapes the live workflow's dump now
 * writes — `run_id` on every run-scoped table, `bundle-manifest.txt`, the
 * worker-diagnostics identity columns, receipt scopes that are the sha256 of
 * the invocation ids — and the failing one is paid run 34037313976.
 */

const REPO = join(__dirname, '..');
/** The commit this checkout is at: a bundle is bound only to the tree that reads it. */
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();

const tsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header.join('\t'), ...rows.map((row) => row.join('\t')), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n');
/** A fixture row: named columns, and an absent (or undefined) key is an empty cell, as psql writes a NULL. */
type Row = Readonly<Record<string, string | undefined>>;
/** Rows as objects, so a fixture names the columns it means. */
const table = (header: readonly string[], rows: readonly Row[]): string =>
  tsv(header, rows.map((row) => header.map((column) => row[column] ?? '')));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const RUN = 'run:4bf13d0e833a042c74f57555';
const MISSION = 'mission:julius-live-2';

/* The columns the dump writes today, `run_id` included wherever the table carries one. */
const RUNS = ['run_id', 'mission_id', 'state', 'card_revision', 'created_at', 'updated_at'];
const TASKS = ['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id', 'run_id'];
const EVIDENCE = ['evidence_id', 'evidence_type', 'status', 'safe_summary', 'occurred_at', 'run_id', 'task_id', 'integrity_hash'];
const DECISIONS = ['decision_id', 'task_id', 'action', 'reason_code', 'occurred_at', 'run_id', 'evidence_ids'];
const FINDINGS = ['finding_id', 'blocking', 'status', 'claim', 'run_id', 'task_id', 'evidence_ids'];
const INVOCATIONS = ['invocation_id', 'tool_id', 'state', 'requested_at', 'run_id', 'task_id', 'exit_code', 'recovery_state', 'completed_at'];
const FAILURES = ['run_id', 'sequence', 'task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'];
const DIAGNOSTICS = ['run_id', 'sequence', 'task_id', 'role', 'stage', 'transport', 'provider', 'served_model', 'requested_model', 'response_id', 'executor_refusal', 'permission_denials', 'outcome', 'event_type', 'served_model_basis'];
const TRAJECTORY = ['event_kind', 'task_id', 'worker_id', 'provider_id', 'outcome', 'safe_facts', 'occurred_at', 'run_id'];
const SCOPE = ['run_id', 'sequence', 'task_id', 'event_type', 'rule', 'attributed_to', 'scope_checked', 'scope_violations', 'own_scope_violations', 'occurred_at'];
const BRAIN = ['entry_id', 'entry_kind', 'worker_id', 'task_id', 'revision', 'created_at', 'run_id'];
const SESSIONS = ['execution_id', 'mission_id', 'project_id', 'player_id', 'agent_id', 'state'];
const CONTRACTS = ['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at', 'run_id'];
const CONTRACT_EVENTS = ['run_id', 'sequence', 'task_id', 'event_type', 'reason_code', 'contract_task_id', 'contract_id', 'contract_revision', 'binding_digest', 'recorded_revision', 'current_revision', 'review_revision', 'implementation_revision', 'role', 'occurred_at'];
const BUDGET = ['run_id', 'sequence', 'task_id', 'event_type', 'role', 'reservation_id'];
const INTEGRITY = ['run_id', 'reservation_id', 'role', 'settled_rows'];

interface Task { readonly id: string; readonly type: string; readonly role: string; readonly state: string; readonly ordinal: number; readonly parent?: string }
const taskRows = (tasks: readonly Task[], runId = RUN) => tasks.map((task) => ({
  task_id: task.id, task_type: task.type, role: task.role, state: task.state, ordinal: String(task.ordinal), parent_task_id: task.parent ?? '', run_id: runId,
}));

/**
 * WHAT A REAL PROVIDER LEAVES BEHIND — read off paid run 36568129865's own
 * bundle: the architect answered over OpenAI with a `resp_…` id, the coder over
 * the hosted Agent SDK with a session id and (since the served-model fix) an
 * attested model, the reviewer through Hermes over xAI. Every live adapter id
 * ends `-live`.
 */
const IDENTITY = {
  PROMPT_ARCHITECT: { stage: 'plan', transport: 'openai', provider: 'openai', served_model: 'gpt-5.6-sol', requested_model: 'gpt-5.6-sol', response_id: 'resp_09a38b3a1d0b1afc016abbaf8d0bd087d0b5ab9228267b97d6', served_model_basis: '', adapter: 'openai-architect-live', worker: 'prompt-architect-openai' },
  CODING_AGENT: { stage: 'build', transport: 'hosted', provider: 'anthropic', served_model: 'claude-fable-5', requested_model: 'claude-fable-5', response_id: '1885b47b-420e-4349-858a-f7c9b50ebc87', served_model_basis: 'attested', adapter: 'claude-agent-sdk-hosted-live', worker: 'coding-agent-claude-hosted' },
  INDEPENDENT_REVIEWER: { stage: 'build', transport: 'local', provider: 'xai', served_model: 'grok-build-0.1', requested_model: 'grok-build-0.1', response_id: '', served_model_basis: '', adapter: 'hermes-local-live', worker: 'independent-reviewer-hermes' },
} as const;
type Role = keyof typeof IDENTITY;
const isRole = (role: string): role is Role => role in IDENTITY;

const diagnosticsFor = (tasks: readonly Task[], runId = RUN, over: (task: Task) => Row = () => ({})) => tasks
  .filter((task) => isRole(task.role) && (task.state === 'SUCCEEDED' || task.state === 'FAILED'))
  .map((task, index) => {
    const id = IDENTITY[task.role as Role];
    return {
      run_id: runId, sequence: String(10 + index), task_id: task.id, role: task.role, stage: id.stage, transport: id.transport,
      provider: id.provider, served_model: id.served_model, requested_model: id.requested_model, response_id: id.response_id,
      permission_denials: task.role === 'CODING_AGENT' ? '0' : '', outcome: task.state === 'SUCCEEDED' ? 'succeeded' : 'failed',
      event_type: task.state === 'SUCCEEDED' ? 'julius.worker.completed' : 'julius.task.failed', served_model_basis: id.served_model_basis,
      ...over(task),
    };
  });
const trajectoryFor = (tasks: readonly Task[], runId = RUN) => tasks.filter((task) => isRole(task.role)).flatMap((task) => {
  const id = IDENTITY[task.role as Role];
  return [
    { event_kind: 'WORKER_SELECTED', task_id: task.id, worker_id: id.worker, outcome: 'SELECTED', safe_facts: JSON.stringify({ role: task.role, adapterId: id.adapter }), occurred_at: 't', run_id: runId },
    { event_kind: 'PROVIDER_SELECTED', task_id: task.id, worker_id: id.worker, provider_id: id.provider, outcome: 'SELECTED', safe_facts: '{}', occurred_at: 't', run_id: runId },
  ];
});

/** The provenance the dump writes first. Bound to THIS checkout, a paid mode and `RUN`, unless told otherwise. */
const manifest = (over: Readonly<Record<string, string>> = {}): string => Object.entries({
  manifest_version: '1', source: 'github-actions', commit: HEAD, tree: 'unknown', tracked_changes: '0',
  mode: 'paid', mode_basis: 'dispatch_confirm_live', julius_run_id: RUN,
  workflow_run_id: '36568129865', workflow_run_attempt: '1', event: 'workflow_dispatch', ...over,
}).map(([key, value]) => `${key}=${value}\n`).join('');

interface Bundle {
  /** What `gh run download` produces: the parent of `julius-live-evidence`. */
  readonly dir: string;
  readonly write: (name: string, text: string) => void;
  readonly drop: (name: string) => void;
}
function bundle(files: Readonly<Record<string, string>>): Bundle {
  const dir = mkdtempSync(join(tmpdir(), 'beta-gate-'));
  const root = join(dir, 'julius-live-evidence');
  mkdirSync(root);
  const write = (name: string, text: string) => writeFileSync(join(root, name), text);
  for (const [name, text] of Object.entries(files)) write(name, text);
  return { dir, write, drop: (name) => rmSync(join(root, name), { force: true }) };
}

/* ------------------------------------------- paid run 34037313976, as recorded */

const PLAN = `${RUN}:plan`;
const PLAN_REVIEW = `${RUN}:plan:review`;
const BUILD = `${RUN}:build`;
const BUILD_REVIEW = `${RUN}:build:review`;
const REPAIR = `repair:${RUN}:build:1:task`;
const REPAIR_REVIEW = `${REPAIR}:review`;
/** The entrypoint's own lines, as `julius-live-evidence.mjs` keeps them: the accepted run, its RESULT, and the run it names. */
const accepted = (runId = RUN, result = 'FAILED after 5 ticks') =>
  `# evidence\n\nRun ${runId} accepted in state READY; driving the Julius run loop.\nRESULT: ${result}\n  run: ${runId}\n`;
/** An account as GitHub sign-in mints it (`participantIdForIdentity`): the only account this repository creates. */
const ACCOUNT = 'ghu-583231';

const FAILING_TASKS: readonly Task[] = [
  { id: PLAN, type: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED', ordinal: 0 },
  { id: `repair:${RUN}:plan:1:task`, type: 'repair:plan', role: 'CODING_AGENT', state: 'FAILED', ordinal: 1, parent: PLAN },
  { id: BUILD, type: 'build', role: 'CODING_AGENT', state: 'FAILED', ordinal: 1 },
  { id: PLAN_REVIEW, type: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 1, parent: PLAN },
];

/** Paid run 34037313976, as its artifact recorded it — now in the shape the dump writes. */
function failingBundle(): string {
  return bundle({
    [BUNDLE_MANIFEST]: manifest(),
    'runs.tsv': table(RUNS, [{ run_id: RUN, mission_id: MISSION, state: 'FAILED', card_revision: 'card:julius-live:1' }]),
    'tasks.tsv': table(TASKS, taskRows(FAILING_TASKS)),
    'failures.tsv': table(FAILURES, [
      { run_id: RUN, sequence: '20', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.task.failed', julius_code: 'WORKER_EXECUTION_FAILURE', failure_class: 'coder_cost_exceeded', error_retryable: 'false' },
      { run_id: RUN, sequence: '12', task_id: PLAN_REVIEW, role: 'INDEPENDENT_REVIEWER', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'review_timeout', error_retryable: 'true' },
      { run_id: RUN, sequence: '18', task_id: `repair:${RUN}:plan:1:task`, role: 'CODING_AGENT', event_type: 'julius.task.failed', julius_code: 'PROVIDER_UNAVAILABLE', error_retryable: 'false' },
    ]),
    'decisions.tsv': table(DECISIONS, [{ decision_id: 'decision:1', task_id: PLAN, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN }]),
    'findings.tsv': table(FINDINGS, [{ finding_id: 'finding:1', blocking: 't', status: 'OPEN', claim: '[blocking] No edit occurred.', run_id: RUN, task_id: PLAN }]),
    'evidence.tsv': table(EVIDENCE, [
      { evidence_id: `${PLAN}:1:0`, evidence_type: 'ARTIFACT', status: 'PASSED', safe_summary: 'Validated architect plan stored for this run.', run_id: RUN, task_id: PLAN },
      // The reviewer answered — about an empty diff, which is the run's whole
      // tragedy, but it answered and Julius could act on what it said.
      { evidence_id: `${PLAN_REVIEW}:3:0`, evidence_type: 'REVIEW_FINDING', status: 'FAILED', safe_summary: '[blocking] No edit occurred.', run_id: RUN, task_id: PLAN_REVIEW },
    ]),
    'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(FAILING_TASKS)),
    'trajectory.tsv': table(TRAJECTORY, trajectoryFor(FAILING_TASKS)),
    'receipt-ids.txt': ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)].join('\n'),
    'live-mission.evidence.txt': accepted(),
  }).dir;
}

/* ------------------------------------ the same mission, completed through a repair */

/**
 * THE REPAIRED RUN. The coder's first build leaves the mission's own spec test
 * red (it starts red by design), the reviewer REJECTS it, a repair round fixes
 * it, the re-review ACCEPTS, and the run COMPLETES — every task on a real
 * provider, every tool effect receipted and settled.
 */
const COMPLETING_TASKS: readonly Task[] = [
  { id: PLAN, type: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED', ordinal: 0 },
  { id: PLAN_REVIEW, type: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 1, parent: PLAN },
  { id: BUILD, type: 'build', role: 'CODING_AGENT', state: 'SUCCEEDED', ordinal: 1 },
  { id: BUILD_REVIEW, type: 'review:build', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 2, parent: BUILD },
  { id: REPAIR, type: 'repair:build', role: 'CODING_AGENT', state: 'SUCCEEDED', ordinal: 3, parent: BUILD },
  { id: REPAIR_REVIEW, type: 'review:repair:build', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 4, parent: REPAIR },
];
const invocation = (id: string, task: string, state: string, exit: string) =>
  ({ invocation_id: id, tool_id: 'shell.bash', state, requested_at: 't', run_id: RUN, task_id: task, exit_code: exit, recovery_state: 'NONE', completed_at: 't' });
const COMPLETING_INVOCATIONS = [
  invocation(`${BUILD}:base:g1`, BUILD, 'SUCCEEDED', '0'),
  // THE SPEC TEST STARTS RED. Run, receipted, settled with its exit code: the
  // repair loop's business, never a boundary breach.
  invocation(`${BUILD}:test:g1`, BUILD, 'FAILED', '1'),
  invocation(`${REPAIR}:base:g1`, REPAIR, 'SUCCEEDED', '0'),
  invocation(`${REPAIR}:test:g1`, REPAIR, 'SUCCEEDED', '0'),
];
/** Receipt scopes are the sha256 of the invocation id the executor was handed; two more are a preflight's. */
const receiptsFor = (invocations: readonly { readonly invocation_id: string }[]) =>
  [...invocations.map((row) => sha256(row.invocation_id)), 'a'.repeat(64), 'b'.repeat(64)].join('\n');
const toolEvidence = (row: { readonly invocation_id: string; readonly task_id: string; readonly state: string }) =>
  ({ evidence_id: `tool:${row.invocation_id}`, evidence_type: 'COMMAND_EXECUTION', status: row.state === 'SUCCEEDED' ? 'PASSED' : 'FAILED', safe_summary: 'Executor ran a shell effect.', run_id: RUN, task_id: row.task_id });

function completingFiles(): Record<string, string> {
  return {
    [BUNDLE_MANIFEST]: manifest(),
    'runs.tsv': table(RUNS, [{ run_id: RUN, mission_id: MISSION, state: 'COMPLETED', card_revision: 'card:julius-live:1' }]),
    'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS)),
    'failures.tsv': table(FAILURES, [
      { run_id: RUN, sequence: '30', task_id: BUILD_REVIEW, role: 'INDEPENDENT_REVIEWER', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'review_timeout', error_retryable: 'true' },
    ]),
    'decisions.tsv': table(DECISIONS, [
      { decision_id: 'decision:1', task_id: PLAN, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN },
      { decision_id: 'decision:2', task_id: BUILD, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN },
      { decision_id: 'decision:3', task_id: REPAIR, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN },
    ]),
    'findings.tsv': table(FINDINGS, [{ finding_id: 'finding:1', blocking: 't', status: 'OPEN', claim: '[blocking] The change is untested.', run_id: RUN, task_id: BUILD }]),
    'evidence.tsv': table(EVIDENCE, [
      { evidence_id: `${PLAN}:1:0`, evidence_type: 'ARTIFACT', status: 'PASSED', safe_summary: 'Validated architect plan stored for this run.', run_id: RUN, task_id: PLAN },
      { evidence_id: `${PLAN_REVIEW}:1:0`, evidence_type: 'REVIEW_FINDING', status: 'PASSED', safe_summary: 'Independent review approved the change.', run_id: RUN, task_id: PLAN_REVIEW },
      { evidence_id: `${BUILD}:1:0`, evidence_type: 'TEST', status: 'FAILED', safe_summary: 'node --test: exit 1.', run_id: RUN, task_id: BUILD },
      // A REJECTING review: one FAILED row per finding.
      { evidence_id: `${BUILD_REVIEW}:1:0`, evidence_type: 'REVIEW_FINDING', status: 'FAILED', safe_summary: '[blocking] The change is untested.', run_id: RUN, task_id: BUILD_REVIEW },
      { evidence_id: `${REPAIR}:1:0`, evidence_type: 'TEST', status: 'PASSED', safe_summary: 'node --test: exit 0.', run_id: RUN, task_id: REPAIR },
      // An APPROVING review: one PASSED row, which a probe counting findings
      // would have scored as a failure.
      { evidence_id: `${REPAIR_REVIEW}:1:0`, evidence_type: 'REVIEW_FINDING', status: 'PASSED', safe_summary: 'Independent review approved the change.', run_id: RUN, task_id: REPAIR_REVIEW },
      ...COMPLETING_INVOCATIONS.map(toolEvidence),
    ]),
    'tool-invocations.tsv': table(INVOCATIONS, COMPLETING_INVOCATIONS),
    'receipt-ids.txt': receiptsFor(COMPLETING_INVOCATIONS),
    'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(COMPLETING_TASKS)),
    'trajectory.tsv': table(TRAJECTORY, trajectoryFor(COMPLETING_TASKS)),
    'scope.tsv': table(SCOPE, [BUILD, REPAIR].map((task, index) => ({
      run_id: RUN, sequence: String(40 + index), task_id: task, event_type: 'julius.coder.implementation.recorded',
      scope_checked: 'true', scope_violations: '0', own_scope_violations: '0', occurred_at: 't',
    }))),
    'live-mission.evidence.txt': accepted(RUN, 'COMPLETED after 9 ticks'),
  };
}
function completingBundle(): string {
  return bundle(completingFiles()).dir;
}
/** The completing run with some files replaced (`null` drops the file). */
function completingWith(files: Readonly<Record<string, string | null>>): Bundle {
  const made = bundle(completingFiles());
  for (const [name, text] of Object.entries(files)) {
    if (text === null) made.drop(name);
    else made.write(name, text);
  }
  return made;
}

const verdictFor = (report: BetaGateReport, id: string): BetaVerdict =>
  report.results.find((row) => row.id === id)!.verdict;
const rowFor = (report: BetaGateReport, id: string) => report.results.find((row) => row.id === id)!;

describe('the Wonderland Beta Gate', () => {
  const VERDICTS: readonly BetaVerdict[] = ['PASS', 'CAPABILITY PROVEN', 'FAIL', 'NOT BUILT'];

  it('answers with exactly four values, whatever it is pointed at', () => {
    for (const report of [evaluate(null), evaluate(failingBundle()), evaluate(completingBundle())]) {
      expect(report.results.length, 'the sixteen declared capabilities').toBe(16);
      for (const row of report.results) {
        expect(VERDICTS, `${row.id} answered ${row.verdict}`).toContain(row.verdict);
        expect(row.basis.length, `${row.id} must name what it read`).toBeGreaterThan(0);
        expect(row.capabilityBasis.length, `${row.id} must say why the capability axis answered`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * THE LOAD-BEARING PROPERTY. This repository is fully built and its suite is
   * green; if a green suite could produce a PASS, the gate would report beta
   * readiness for a product that has never completed a mission.
   */
  it('cannot pass a single runtime capability without real run evidence', () => {
    const report = evaluate(null);
    expect(report.evidence, 'no bundle was read').toBeNull();
    expect(report.binding.bound).toBe(false);
    expect(report.results.filter((row) => row.verdict === 'PASS'), 'nothing may pass on repository state alone').toEqual([]);
  });

  it('reads paid run 34037313976 exactly as its artifact recorded it', () => {
    const report = evaluate(failingBundle());
    expect(report.binding.bound, report.binding.reason ?? '').toBe(true);
    expect(verdictFor(report, 'JULIUS MISSION START')).toBe('PASS');
    expect(verdictFor(report, 'PROMPT ARCHITECT')).toBe('PASS');
    expect(verdictFor(report, 'INDEPENDENT REVIEWER'), 'the reviewer answered, whatever it was handed').toBe('PASS');
    expect(verdictFor(report, 'VERIFICATION')).toBe('PASS');
    expect(verdictFor(report, 'FAILURE RECOVERY'), 'the review timeout was retried and then succeeded').toBe('PASS');
    expect(verdictFor(report, 'CODING AGENT'), 'the build task FAILED on coder_cost_exceeded').toBe('FAIL');
    expect(verdictFor(report, 'REPAIR LOOP'), 'its one repair was minted on the wrong role and FAILED').toBe('FAIL');
    expect(verdictFor(report, 'VERIFIED COMPLETION')).toBe('FAIL');
    /**
     * WONDER WEB OUTPUT IS NO LONGER A CONSTANT.
     *
     * `src/relay/mission/wonder-web/index.ts` now exists, so the `anyOf` probe
     * finds the module and the row became the real probe this gate always
     * intended it to be. FAIL is the honest verdict and not a regression: the
     * surface is built, this bundle carries no `wonder-web.tsv`, and "we have
     * the code" was never a pass here. It reaches PASS when a completed run's
     * output is actually opened and dumped.
     */
    expect(verdictFor(report, 'WONDER WEB OUTPUT')).toBe('FAIL');
    expect(rowFor(report, 'CODING AGENT').basis, 'and it says which class stopped it').toContain('coder_cost_exceeded');
  });

  it('names the top three gaps in creation-path order, not in severity guesswork', () => {
    const report = evaluate(failingBundle());
    // TASK CONTRACT LOCK sits second because paid run 34037313976 had no task
    // contract at all — the capability did not exist when it ran — and the gate
    // reports that rather than skipping a row the bundle predates. Reading it as
    // a gap is correct: the reviewer that produced six findings against a plan
    // was grading against prose, which is precisely what this row detects.
    expect(report.gaps.map((row) => row.id)).toEqual(['CODING AGENT', 'TASK CONTRACT LOCK', 'REPAIR LOOP']);
    expect(report.gaps.length, 'three, never more').toBeLessThanOrEqual(3);
  });

  /**
   * THE REPAIRED RUN. Same mission, same three roles; the coder's result is
   * banked instead of refused, the reviewer sends it back once, and the repair
   * is accepted. Three verdicts move, and nothing else has to.
   */
  it('turns the three creation-path gaps to PASS when the mission actually completes', () => {
    const report = evaluate(completingBundle());
    expect(verdictFor(report, 'CODING AGENT')).toBe('PASS');
    expect(verdictFor(report, 'REPAIR LOOP')).toBe('PASS');
    expect(verdictFor(report, 'VERIFIED COMPLETION')).toBe('PASS');
    expect(report.gaps.map((row) => row.id), 'and the remaining gaps are off the creation path')
      .toEqual(['TASK CONTRACT LOCK', 'ACCOUNT / ONBOARDING', 'WONDER WEB OUTPUT']);
  });

  /**
   * THE PROJECT BRAIN'S THREE ANSWERS. A bundle with no dump cannot say; a
   * bundle holding only bootstrap seeds says the run wrote nothing back; a
   * bundle holding a worker's own entry says it did. Only the last is a PASS,
   * and the middle one is the state this repository is actually in.
   */
  it('tells a seeded Project Brain from one a run wrote back to', () => {
    const withBrain = (rows: readonly Row[]): string =>
      completingWith({ 'project-brain.tsv': table(BRAIN, rows.map((row) => ({ run_id: RUN, ...row }))) }).dir;
    const seededOnly = evaluate(withBrain([
      { entry_id: 'brain-1', entry_kind: 'CONSTRAINT', worker_id: 'relay-bootstrap', revision: '1', created_at: 't' },
      { entry_id: 'brain-2', entry_kind: 'CONSTRAINT', worker_id: 'relay-bootstrap', revision: '2', created_at: 't' },
    ]));
    expect(verdictFor(seededOnly, 'PROJECT BRAIN PERSISTENCE'), 'a read-only seed is not persistence').toBe('FAIL');
    expect(rowFor(seededOnly, 'PROJECT BRAIN PERSISTENCE').basis).toContain('the run wrote none back');

    const writtenBack = evaluate(withBrain([
      { entry_id: 'brain-1', entry_kind: 'CONSTRAINT', worker_id: 'relay-bootstrap', revision: '1', created_at: 't' },
      { entry_id: 'brain-2', entry_kind: 'DECISION', worker_id: 'coding-agent-claude-hosted', task_id: BUILD, revision: '2', created_at: 't' },
    ]));
    expect(verdictFor(writtenBack, 'PROJECT BRAIN PERSISTENCE')).toBe('PASS');
    expect(rowFor(writtenBack, 'PROJECT BRAIN PERSISTENCE').basis).toContain('DECISION');

    const empty = evaluate(withBrain([]));
    expect(verdictFor(empty, 'PROJECT BRAIN PERSISTENCE'), 'not even the seed persisted').toBe('FAIL');
    expect(rowFor(empty, 'PROJECT BRAIN PERSISTENCE').basis).toContain('empty');
  });

  /**
   * AN UNREADABLE TABLE IS NOT AN EMPTY ONE.
   *
   * The dump script writes the literal `unavailable` into a file whose query it
   * could not run — free dry runs #1 and #2 shipped exactly that. Read as text
   * it is one line, and one line parses to zero rows, so without this the gate
   * would report "the Project Brain is empty: not even the mission seed
   * persisted" about a table it never managed to read. Opposite facts.
   */
  it('reads an unavailable dump as unknown, never as empty', () => {
    const brain = rowFor(evaluate(completingWith({ 'project-brain.tsv': 'unavailable\n' }).dir), 'PROJECT BRAIN PERSISTENCE');
    expect(brain.verdict, 'unreadable is still not a pass').toBe('FAIL');
    expect(brain.basis, 'but it must not claim the table was empty').toContain('no readable');
    expect(brain.basis).not.toContain('empty');
  });

  /**
   * ACCOUNT / ONBOARDING IS A GATE, NOT A CONSTANT.
   *
   * It shipped as a row that returned FAIL down every branch — no evidence
   * shape could have passed it, which makes it a hard-coded verdict wearing a
   * probe's clothes. The durable fact that decides it is
   * `execution_sessions.player_id`: the operator identity both bounded missions
   * run under is not an account, and anything else is.
   */
  it('flips ACCOUNT / ONBOARDING on the account the mission actually ran for', () => {
    const withSessions = (players: readonly string[]): string => completingWith({
      'sessions.tsv': table(SESSIONS, players.map((player, index) => ({
        execution_id: `exec-${index}`, mission_id: MISSION, project_id: 'prj-julius-live-2', player_id: player, agent_id: `agent:${player}`, state: 'RUNNING',
      }))),
    }).dir;
    const account = (players: readonly string[]) => rowFor(evaluate(withSessions(players)), 'ACCOUNT / ONBOARDING');
    expect(account(['tenant']).mission, 'the operator identity is not an account').toBe('NOT EXERCISED');
    // X3 (falsification): the row was a two-name deny-list, so a contract naming
    // its tenant anything but `tenant` or `operator` read as a person signing up.
    for (const renamed of ['founder', 'player:ada', 'ghu-', 'ghu-12a']) {
      expect(account([renamed]).mission, `${renamed} is an operator-named tenant, not an account`).toBe('NOT EXERCISED');
    }
    // X3, second review: and the account SHAPE is typable too — player_id is the
    // contract's tenantId verbatim — so without a record the sign-in itself
    // wrote, an account-shaped owner is UNKNOWN, never a sign-up.
    for (const players of [[ACCOUNT], ['tenant', ACCOUNT]]) {
      const row = account(players);
      expect(row.mission, players.join(', ')).toBe('UNKNOWN');
      expect(row.verdict).toBe('FAIL');
      expect(row.basis).toContain('player_id is the contract\'s tenantId, which the operator types');
    }
    expect(rowFor(evaluate(completingBundle()), 'ACCOUNT / ONBOARDING').basis,
      'and a bundle that cannot say must say it cannot, not fail for a reason it never checked')
      .toContain('no readable execution-session dump');
  });

  it('an account is exactly the participant id GitHub sign-in mints — the gate and the account system agree', () => {
    const minted = participantIdForIdentity({ id: 583231, login: 'ada', type: 'User' });
    expect(minted, 'the fixtures use the shape the account system writes').toBe(ACCOUNT);
    expect(ACCOUNT_PARTICIPANT_ID.test(minted)).toBe(true);
    expect(ACCOUNT_PARTICIPANT_ID.test('tenant')).toBe(false);
  });

  it('still refuses to call that beta ready, because capabilities remain unproven', () => {
    const report = evaluate(completingBundle());
    expect(report.results.every((row) => row.verdict === 'PASS'), 'a completing mission is not a beta').toBe(false);
  });

  /**
   * NO PROBE IS A CONSTANT — the structural version of the ACCOUNT fix.
   *
   * For every capability whose implementation exists, some evidence bundle must
   * make it PASS. One bound bundle in which everything went right — a real
   * account, a crash that was recovered, a retry that succeeded, a rejection
   * that was repaired, a contract the build ran under, every reservation
   * settled once, every effect receipted — proves all of them at once, and
   * would have failed the day ACCOUNT was written.
   *
   * WONDER WEB OUTPUT is the exception: its module exists and no bundle dumps
   * what it opened yet. If someone dumps it, this test demands a pass for it.
   */
  it('every capability that is built can be reached: one good run passes every one of them', () => {
    const lock = `sha256:${'b'.repeat(64)}`;
    const made = completingWith({
      'failures.tsv': table(FAILURES, [
        // A retryable failure that then succeeded — FAILURE RECOVERY.
        { run_id: RUN, sequence: '30', task_id: BUILD_REVIEW, role: 'INDEPENDENT_REVIEWER', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'review_timeout', error_retryable: 'true' },
        // A recovery sweep that requeued an expired lease, and the task then SUCCEEDED — RESTART / RECOVERY.
        { run_id: RUN, sequence: '25', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.recovery.action', reason_code: 'LEASE_EXPIRED', recovery_action: 'REQUEUE' },
      ]),
      // A worker wrote back to the Project Brain, and a real account owns the run.
      'project-brain.tsv': table(BRAIN, [
        { entry_id: 'brain-1', entry_kind: 'CONSTRAINT', worker_id: 'relay-bootstrap', revision: '1', created_at: 't', run_id: RUN },
        { entry_id: 'brain-2', entry_kind: 'DECISION', worker_id: 'coding-agent-claude-hosted', task_id: BUILD, revision: '2', created_at: 't', run_id: RUN },
      ]),
      'sessions.tsv': table(SESSIONS, [{ execution_id: 'exec-1', mission_id: MISSION, project_id: 'prj-julius-live-2', player_id: ACCOUNT, agent_id: `agent:${ACCOUNT}`, state: 'RUNNING' }]),
      // And the build ran under terms that were agreed before it started.
      'task-contracts.tsv': table(CONTRACTS, [
        { contract_id: `contract:${BUILD}`, contract_revision: '1', task_id: BUILD, state: 'SUPERSEDED', binding_digest: `sha256:${'a'.repeat(64)}`, locked_at: 't1', locked_by_evaluator_id: 'reviewer:hermes', created_at: 't0', run_id: RUN },
        { contract_id: `contract:${BUILD}`, contract_revision: '2', task_id: BUILD, state: 'LOCKED', binding_digest: lock, locked_at: 't2', locked_by_evaluator_id: 'reviewer:hermes', created_at: 't1', run_id: RUN },
      ]),
      // And the build and its review were CLAIMED under that lock.
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        { run_id: RUN, sequence: '1', task_id: BUILD, event_type: 'julius.contract.locked', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: '2', binding_digest: lock, occurred_at: 't2' },
        { run_id: RUN, sequence: '2', task_id: BUILD, event_type: 'julius.task.claimed', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: '2', binding_digest: lock, role: 'CODING_AGENT', occurred_at: 't3' },
        { run_id: RUN, sequence: '3', task_id: BUILD_REVIEW, event_type: 'julius.task.claimed', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: '2', binding_digest: lock, role: 'INDEPENDENT_REVIEWER', occurred_at: 't4' },
      ]),
      // And every reservation was settled exactly once.
      'budget.tsv': table(BUDGET, [{ run_id: RUN, sequence: '9', task_id: BUILD, event_type: 'julius.budget.settled', role: 'CODING_AGENT', reservation_id: 'reservation:build' }]),
      'settlement-integrity.tsv': table(INTEGRITY, []),
    });
    const report = evaluate(made.dir);
    expect(report.binding.bound, report.binding.reason ?? '').toBe(true);
    const notPassing = report.results.filter((row) => row.verdict !== 'PASS');
    /**
     * TWO ROWS WAIT FOR A PRODUCER, AND SAY SO. ACCOUNT / ONBOARDING needs a
     * record the account system itself wrote (the session's owner is typed by
     * the operator), and WONDER WEB OUTPUT needs a dump query that writes what
     * Wonder Web opened. Neither exists in the dump; each row names what it is
     * waiting for rather than passing on what anyone can type.
     */
    expect(notPassing.map((row) => `${row.id}: ${row.verdict} ${row.mission}`),
      'every other built capability must have SOME evidence that reaches PASS; a row that cannot is a constant, not a probe')
      .toEqual(['ACCOUNT / ONBOARDING: FAIL UNKNOWN', 'WONDER WEB OUTPUT: FAIL UNKNOWN']);
    expect(rowFor(report, 'ACCOUNT / ONBOARDING').basis).toContain('no account record the sign-in itself wrote');
    expect(rowFor(report, 'WONDER WEB OUTPUT').basis).toContain('writes wonder-web.tsv');
    expect(report.gaps.map((row) => row.id), 'and the only gaps left are the two nobody dumps yet').toEqual(['ACCOUNT / ONBOARDING', 'WONDER WEB OUTPUT']);
  });

  /**
   * LOCKED IS NOT RUN UNDER. The bundles below carry a contract locked before
   * the build and would have passed the row on the lock table alone; each is
   * exactly the run the stale-handoff and reviewer-binding guards exist to
   * refuse, and the gate must read them as the guards would.
   */
  const locked = (revision: string, digest: string) => table(CONTRACTS, [
    { contract_id: `contract:${BUILD}`, contract_revision: revision, task_id: BUILD, state: 'LOCKED', binding_digest: digest, locked_at: 't2', locked_by_evaluator_id: 'reviewer:hermes', created_at: 't1', run_id: RUN },
  ]);
  const claim = (task: string, revision: string, digest: string, role: string) =>
    ({ run_id: RUN, task_id: task, event_type: 'julius.task.claimed', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: revision, binding_digest: digest, role, occurred_at: 't3' });

  it('a build claimed under an older revision than the lock turns TASK CONTRACT LOCK to FAIL', () => {
    const made = completingWith({
      'task-contracts.tsv': locked('2', `sha256:${'b'.repeat(64)}`),
      'contract-events.tsv': table(CONTRACT_EVENTS, [claim(BUILD, '1', `sha256:${'a'.repeat(64)}`, 'CODING_AGENT')]),
    });
    const row = rowFor(evaluate(made.dir), 'TASK CONTRACT LOCK');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('claimed under revision 1 while revision 2 is the lock');
  });

  it('a binding refusal on the build turns TASK CONTRACT LOCK to FAIL even though the lock looks perfect', () => {
    const made = completingWith({
      'task-contracts.tsv': locked('2', `sha256:${'b'.repeat(64)}`),
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        claim(BUILD, '1', `sha256:${'a'.repeat(64)}`, 'CODING_AGENT'),
        { run_id: RUN, task_id: BUILD, event_type: 'julius.contract.refused', reason_code: 'binding_stale', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, recorded_revision: '1', current_revision: '2', role: 'CODING_AGENT', occurred_at: 't4' },
      ]),
    });
    const row = rowFor(evaluate(made.dir), 'TASK CONTRACT LOCK');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('binding_stale');
  });

  it('a contract-events dump with NO claim row for the build turns TASK CONTRACT LOCK to FAIL — absence is not agreement', () => {
    const made = completingWith({
      'task-contracts.tsv': locked('2', `sha256:${'b'.repeat(64)}`),
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        { run_id: RUN, task_id: BUILD, event_type: 'julius.contract.locked', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: '2', binding_digest: `sha256:${'b'.repeat(64)}`, occurred_at: 't2' },
      ]),
    });
    const row = rowFor(evaluate(made.dir), 'TASK CONTRACT LOCK');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('carries no recorded contract binding on its claim');
  });

  it('a review claimed under a different revision than the build turns TASK CONTRACT LOCK to FAIL, naming the review', () => {
    const made = completingWith({
      'task-contracts.tsv': locked('2', `sha256:${'b'.repeat(64)}`),
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        claim(BUILD, '2', `sha256:${'b'.repeat(64)}`, 'CODING_AGENT'),
        claim(BUILD_REVIEW, '3', `sha256:${'c'.repeat(64)}`, 'INDEPENDENT_REVIEWER'),
      ]),
    });
    const row = rowFor(evaluate(made.dir), 'TASK CONTRACT LOCK');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain(`review ${BUILD_REVIEW} was claimed under revision 3 while revision 2 is the lock`);
  });

  it('a build claimed under the right revision but a different digest turns TASK CONTRACT LOCK to FAIL — two records agreeing on a number is not agreement', () => {
    const made = completingWith({
      'task-contracts.tsv': locked('2', `sha256:${'b'.repeat(64)}`),
      'contract-events.tsv': table(CONTRACT_EVENTS, [claim(BUILD, '2', `sha256:${'a'.repeat(64)}`, 'CODING_AGENT')]),
    });
    const row = rowFor(evaluate(made.dir), 'TASK CONTRACT LOCK');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain(`build ${BUILD} was claimed under a digest that is not the lock's`);
  });

  /**
   * THIS CASE ASSERTED PASS until the lock-ordering check. Without the claim
   * rows neither the binding the build ran under nor whether the lock came
   * before it can be shown, and "a contract agreed after the fact" is the one
   * thing this row exists to refuse — so the weaker proof is no proof.
   */
  it('a bundle without the contract-events dump cannot show the lock came first, and says so', () => {
    const row = rowFor(evaluate(completingWith({ 'task-contracts.tsv': locked('1', `sha256:${'b'.repeat(64)}`) }).dir), 'TASK CONTRACT LOCK');
    expect(row.mission).toBe('UNKNOWN');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('not measurable');
  });

  /**
   * X1 (falsification): THE LOCK MUST COME BEFORE THE WORK. A contract whose
   * lock instant is later than the build's claim was agreed after the fact,
   * whatever the claim's revision and digest say; and the ledger's order is
   * held too where the lock event is dumped.
   */
  it('a contract locked after the build was claimed turns TASK CONTRACT LOCK to FAIL', () => {
    const digest = `sha256:${'b'.repeat(64)}`;
    const contract = table(CONTRACTS, [{ contract_id: `contract:${BUILD}`, contract_revision: '2', task_id: BUILD, state: 'LOCKED', binding_digest: digest, locked_at: '2026-09-29 12:40:00.000+00', locked_by_evaluator_id: 'independent-reviewer-hermes', created_at: '2026-09-29 12:32:02.711+00', run_id: RUN }]);
    const byInstant = rowFor(evaluate(completingWith({
      'task-contracts.tsv': contract,
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        { ...claim(BUILD, '2', digest, 'CODING_AGENT'), sequence: '38', occurred_at: '2026-09-29 12:33:45.196+00' },
        { ...claim(BUILD_REVIEW, '2', digest, 'INDEPENDENT_REVIEWER'), sequence: '52', occurred_at: '2026-09-29 12:41:00.000+00' },
      ]),
    }).dir), 'TASK CONTRACT LOCK');
    expect(byInstant.verdict).toBe('FAIL');
    expect(byInstant.basis).toContain('the terms were agreed after the work began');
    const byLedger = rowFor(evaluate(completingWith({
      'task-contracts.tsv': locked('2', digest),
      'contract-events.tsv': table(CONTRACT_EVENTS, [
        { ...claim(BUILD, '2', digest, 'CODING_AGENT'), sequence: '30' },
        { run_id: RUN, sequence: '33', task_id: BUILD, event_type: 'julius.contract.locked', contract_task_id: BUILD, contract_id: `contract:${BUILD}`, contract_revision: '2', binding_digest: digest },
        { ...claim(BUILD_REVIEW, '2', digest, 'INDEPENDENT_REVIEWER'), sequence: '40' },
      ]),
    }).dir), 'TASK CONTRACT LOCK');
    expect(byLedger.verdict).toBe('FAIL');
    expect(byLedger.basis).toContain('before the lock at 33');
  });

  /**
   * MUTATION. A gate that reported PASS whenever the code exists — the shape
   * every optimistic readiness document takes — would call this repository beta
   * ready today, with no mission ever completed.
   */
  it('MUTATION: passing on existence alone would declare beta readiness with zero completed missions', () => {
    const real = evaluate(null).results;
    const optimistic = real.map((row) => (row.verdict === 'FAIL' ? 'PASS' : row.verdict));
    expect(optimistic.filter((verdict) => verdict === 'PASS').length, 'the mutant answer: everything that exists')
      .toBe(real.filter((row) => row.verdict !== 'NOT BUILT').length);
    expect(real.filter((row) => row.verdict === 'PASS').length, 'the real one, with no mission ever completed').toBe(0);
  });
});

/**
 * THE SECOND QUESTION: WHAT IS JULIUS READY TO DO?
 *
 * Everything above reads one mission. These read the other axis — the one that
 * exists because a flawless mission never crashes, and a gate with a single
 * boolean must then either call recovery unproven (false: the drill proves it)
 * or require a healthy paid run to break itself for a point (worse).
 *
 * The fixtures below FABRICATE drill attestations, which is exactly what they
 * must do: what is under test is the gate's reader, not Julius's readiness. The
 * digests are computed from the real files in this tree — EVERY file the named
 * drill's build reaches, read by the same closure reader the gate uses —
 * because that binding, a proof expiring the moment any code it drove changes,
 * is the property that keeps a capability proof from becoming folklore.
 */
const PROOF_COLUMNS = [
  'capability', 'drill', 'outcome', 'steps', 'infrastructure',
  'exercised_path', 'exercised_digest', 'transcript', 'recorded_at',
];
const digest = (path: string) => `sha256:${createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex')}`;
const transcriptFor = (steps: number, verdict = 'JULIUS RESTART RECOVERY VERIFIED') =>
  [...Array.from({ length: steps }, (_, index) => `  [PASS] ${index + 1}. step ${index + 1}`), '', verdict, ''].join('\n');
/** The files the gate itself says a row is built on — never a list retyped here. */
const implementedBy = (id: string): readonly string[] => evaluate(null).results.find((row) => row.id === id)!.implementedBy;
/** Every file a drill's build reaches, from the same reader the gate uses. */
const drivenBy = (drill: string): readonly string[] => {
  const found = drillDrivenFiles(REPO, drill);
  return 'error' in found ? [] : found.files;
};
/** Each drilled capability's one drill command, from the table the drills and the gate both read. */
const DRILL_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(JULIUS_CAPABILITY_DRILLS).map((capability) => [capability, capabilityDrill(capability)!.command]),
);

interface ProofOptions {
  readonly capability?: string;
  readonly drill?: string;
  readonly outcome?: string;
  readonly steps?: number;
  /** Extra files attested beside the drill's own closure (by default, the row's probe files). */
  readonly paths?: readonly string[];
  /** Files left out of the attestation. */
  readonly omit?: readonly string[];
  /** Attest only `paths`, not the drill's closure — the shape every ledger had before closures. */
  readonly closure?: boolean;
  /** Digests recorded instead of the file's real one, by path. */
  readonly recorded?: Readonly<Record<string, string>>;
  readonly transcript?: string | null;
  readonly transcriptSteps?: number;
  readonly transcriptVerdict?: string;
}

/** Writes an attestation into a directory (a bundle's `julius-live-evidence`, or any other) and returns it. */
function attest(root: string, options: ProofOptions = {}): string {
  const capability = options.capability ?? 'RESTART / RECOVERY';
  // By default, what the capability's own drill writes: its command, its transcript file, its closing sentence.
  const own = capabilityDrill(capability) ?? capabilityDrill('RESTART / RECOVERY')!;
  const drill = options.drill ?? own.command;
  const probe = options.paths ?? implementedBy(capability);
  const paths = [...new Set([...(options.closure === false ? [] : drivenBy(drill)), ...probe])]
    .filter((path) => !(options.omit ?? []).includes(path));
  const steps = options.steps ?? 10;
  const transcriptName = options.transcript === undefined ? own.transcript : options.transcript;
  // MERGED, as the drills merge: one ledger holds every drill that wrote into the directory.
  const ledger = join(root, 'capability-proofs.tsv');
  const kept = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').slice(1).filter((line) => line !== '' && !/^\(\d+ rows?\)$/u.test(line)).map((line) => line.split('\t'))
    : [];
  writeFileSync(ledger, tsv(PROOF_COLUMNS, [...kept, ...paths.map((path) => [
    capability, drill, options.outcome ?? 'VERIFIED', String(steps), 'real-postgres,two-processes',
    path, options.recorded?.[path] ?? digest(path), transcriptName ?? '', '2026-09-08T00:00:00.000Z',
  ])]));
  if (transcriptName !== null) {
    writeFileSync(join(root, transcriptName), transcriptFor(options.transcriptSteps ?? steps, options.transcriptVerdict ?? `${own.name} VERIFIED`));
  }
  return root;
}
/** Writes an attestation INTO a bundle and returns the bundle. */
const withProof = (dir: string, options: ProofOptions = {}): string => {
  attest(join(dir, 'julius-live-evidence'), options);
  return dir;
};

describe('the Beta Gate’s capability axis', () => {
  /**
   * THE FOUNDER'S SENTENCE, LITERALLY. A mission in which nothing was
   * interrupted must not be made to say it recovered, and must not be made to
   * say recovery is unproven either.
   */
  it('reports RESTART / RECOVERY as CAPABILITY PROVEN — NOT EXERCISED THIS MISSION on a flawless run', () => {
    const row = rowFor(evaluate(withProof(completingBundle())), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('CAPABILITY PROVEN');
    expect(row.mission, 'and the mission axis still says, truthfully, that nothing restarted').toBe('NOT EXERCISED');
    expect(row.capability).toBe('PROVEN');
    expect(row.basis).toContain('NOT EXERCISED THIS MISSION');
    expect(row.basis).toContain('nothing was interrupted in this run');
    expect(row.basis, 'and it names the drill that did prove it').toContain('npm run julius:recovery-drill');
  });

  /**
   * AND THE MEANINGS DO NOT COLLAPSE. A run that DID crash and recover is a
   * different fact from one that never had to. The recovery action is the
   * production value (`REQUEUE`, not the `REQUEUED` this fixture once used,
   * which no runtime writes), and the requeued task then SUCCEEDED.
   */
  it('still reports a mission that DID crash and recover as having done so', () => {
    const made = completingWith({
      'failures.tsv': table(FAILURES, [{ run_id: RUN, sequence: '25', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.recovery.action', reason_code: 'LEASE_EXPIRED', recovery_action: 'REQUEUE' }]),
    });
    const row = rowFor(evaluate(withProof(made.dir)), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('PASS');
    expect(row.mission).toBe('EXERCISED');
    expect(row.basis).toContain('requeued and then SUCCEEDED');
    expect(row.basis, 'a run that recovered does not report itself as not having').not.toContain('NOT EXERCISED');
  });

  /**
   * THE LAUNDRY RULE. A capability this run exercised AND BROKE reads FAIL
   * however good the drill is. The retried task is one the run holds and that
   * ended FAILED: a retry for a task the bundle does not hold is a bundle that
   * cannot say, not a failure.
   */
  it('never lets a drill rescue a capability this run exercised and broke', () => {
    // The build was retried once (the first `retry.scheduled` the run went on
    // from), failed again, and the second retry was declined: exhausted.
    const made = completingWith({
      'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.map((task) => (task.id === BUILD ? { ...task, state: 'FAILED' } : task)))),
      'failures.tsv': table(FAILURES, [
        { run_id: RUN, sequence: '30', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true' },
        { run_id: RUN, sequence: '36', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true' },
        { run_id: RUN, sequence: '37', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.task.failed', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true', reason_code: 'RETRY_ATTEMPTS_EXHAUSTED' },
      ]),
    });
    const row = rowFor(evaluate(withProof(made.dir, { capability: 'FAILURE RECOVERY' })), 'FAILURE RECOVERY');
    expect(row.verdict, 'a drill proves the path, not this run').toBe('FAIL');
    expect(row.mission).toBe('FAILED');
    expect(row.basis).toContain('was retried 1 time(s), and still ended FAILED (RETRY_ATTEMPTS_EXHAUSTED)');
    expect(row.capability, 'and the proof is still reported as sound — it simply does not apply').toBe('PROVEN');
  });

  /**
   * AND NO DRILL WALKS THE MISSION'S OWN PATH FOR IT. The nine capabilities a
   * run must physically walk and account for admit no capability proof at all,
   * so 16/16 cannot be reached by drilling.
   */
  it('refuses a drill attestation for a capability the mission itself must walk', () => {
    const row = rowFor(evaluate(withProof(failingBundle(), { capability: 'VERIFIED COMPLETION', drill: 'npm run lifecycle-drill' })), 'VERIFIED COMPLETION');
    expect(row.verdict, 'the run ended FAILED and no drill changes that').toBe('FAIL');
    expect(row.capability).toBe('NOT ADMISSIBLE');
    expect(row.capabilityBasis, 'and the gate says the evidence was seen and refused, rather than dropping it')
      .toContain('a mission must walk it itself');
    expect(row.capabilityBasis).toContain('an attestation is present and inadmissible');
  });

  it('lets no drill lift a mission-required row even where the mission is merely silent', () => {
    // A bundle with no architect task at all: the mission is silent, not broken.
    const made = completingWith({ 'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.filter((task) => task.role !== 'PROMPT_ARCHITECT'))) });
    const row = rowFor(evaluate(withProof(made.dir, { capability: 'PROMPT ARCHITECT', drill: 'npm run architect-drill' })), 'PROMPT ARCHITECT');
    expect(row.mission).toBe('NOT EXERCISED');
    expect(row.verdict).toBe('FAIL');
  });

  /**
   * CURRENCY. A proof describes the code it drove. Edit that code and the proof
   * describes something that is no longer here — so it expires, loudly, naming
   * the file that moved.
   */
  it('expires a drill attestation whose subject has changed since it ran', () => {
    const target = implementedBy('RESTART / RECOVERY');
    expect(target.length, 'the row must name more than one file for this to mean anything').toBeGreaterThan(1);
    const row = rowFor(evaluate(withProof(completingBundle(), { recorded: { [target.at(-1)!]: `sha256:${'0'.repeat(64)}` } })), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.capability).toBe('STALE');
    expect(row.basis).toContain(target.at(-1)!);
    expect(row.basis).toContain('has changed since the drill ran');
  });

  /**
   * THE WHOLE DRILL, NOT ITS LABEL. The recovery drill drives the run loop, the
   * task pipeline, the repositories and the live composition on its way to the
   * two files its row names. Leave any one of them out of the attestation and
   * the proof cannot show that code is unchanged.
   */
  it('refuses an attestation that leaves out a file its drill drives', () => {
    const target = implementedBy('RESTART / RECOVERY');
    const row = rowFor(evaluate(withProof(completingBundle(), { omit: [target[1]!] })), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.capability).toBe('UNPROVEN');
    expect(row.capabilityBasis).toContain('of them are not attested');
    expect(row.capabilityBasis).toContain(target[1]!);
  });

  /**
   * COVERAGE, AND BEFORE IT, IDENTITY. A drill for something else cannot be
   * pointed at this row. It used to be refused for not covering the row's
   * files — the recovery drill does not import the Project Brain's memory
   * module — but coverage alone let the three drills, which import nearly the
   * same pipeline, prove one another's rows. A row with no drill of its own
   * (PROJECT BRAIN PERSISTENCE has none) is now refused before any file is
   * read, whether the attestation leaves the row's files out or names them.
   */
  it('refuses a drill pointed at a row whose files it does not drive', () => {
    const brain = implementedBy('PROJECT BRAIN PERSISTENCE');
    for (const paths of [[], brain]) {
      const row = rowFor(evaluate(withProof(completingBundle(), {
        capability: 'PROJECT BRAIN PERSISTENCE', drill: 'npm run julius:recovery-drill', paths,
      })), 'PROJECT BRAIN PERSISTENCE');
      expect(row.capability).toBe('UNPROVEN');
      expect(row.capabilityBasis).toContain('no Julius capability drill exercises PROJECT BRAIN PERSISTENCE');
    }
  });

  it('expires an attestation naming a file that is no longer here, and says which', () => {
    const gone = 'src/relay/mission/julius/julius-recovery-deleted.ts';
    const row = rowFor(evaluate(withProof(completingBundle(), {
      paths: [...implementedBy('RESTART / RECOVERY'), gone], recorded: { [gone]: `sha256:${'0'.repeat(64)}` },
    })), 'RESTART / RECOVERY');
    expect(row.capability).toBe('STALE');
    expect(row.capabilityBasis).toContain('is no longer in this repository');
  });

  /**
   * ONE DRILL, ONE STORY. Reading the step count and transcript out of the
   * first row alone would let every row after it say anything.
   */
  it('refuses a ledger whose rows disagree about the run they describe', () => {
    const dir = completingBundle();
    const target = implementedBy('RESTART / RECOVERY');
    writeFileSync(join(dir, 'julius-live-evidence', 'capability-proofs.tsv'), tsv(PROOF_COLUMNS,
      target.map((path, index) => ['RESTART / RECOVERY', 'npm run julius:recovery-drill', 'VERIFIED',
        index === 0 ? '10' : '4', 'real-postgres', path, digest(path), 'julius-recovery-drill.transcript.txt',
        '2026-09-08T00:00:00.000Z'])));
    writeFileSync(join(dir, 'julius-live-evidence', 'julius-recovery-drill.transcript.txt'), transcriptFor(10));
    const row = rowFor(evaluate(dir), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.capabilityBasis).toContain('its rows disagree about steps');
  });

  it('refuses an attestation that names a path outside this repository', () => {
    const row = rowFor(evaluate(withProof(completingBundle(), {
      paths: ['../../etc/passwd'], recorded: { '../../etc/passwd': `sha256:${'0'.repeat(64)}` },
    })), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.capabilityBasis).toContain('which is not a file in this repository');
  });

  /**
   * TRANSCRIPT. The gate reads the drill's own words and holds them to the
   * count the drill declared, rather than trusting the word VERIFIED in a cell
   * beside them. Four ways that fails, four different sentences.
   */
  it('holds the drill to its own transcript', () => {
    const cases: readonly [ProofOptions, string][] = [
      [{ outcome: 'FAILED' }, 'the drill recorded FAILED, not VERIFIED'],
      [{ transcript: null }, 'it names the transcript (none), and npm run julius:recovery-drill writes julius-recovery-drill.transcript.txt'],
      [{ transcriptSteps: 7 }, 'it declares 10 step(s) and its transcript shows 7'],
      [{ transcriptVerdict: 'mostly fine' }, 'does not end on JULIUS RESTART RECOVERY VERIFIED'],
      // The falsifications' regex findings: capitals ending in VERIFIED, negated
      // (round 1), and the negations a word list did not name (round 2). The
      // drill's own sentence, whole, is the only verdict that reads verified —
      // and another drill's sentence is not this drill's.
      ...[
        'JULIUS RESTART RECOVERY NOT VERIFIED', 'JULIUS RESTART RECOVERY DRILL FAILED VERIFIED',
        'JULIUS RESTART RECOVERY CANNOT BE VERIFIED', 'JULIUS RESTART RECOVERY NEVER VERIFIED', 'DRILL ABORTED BEFORE IT VERIFIED',
        'DRILL FAILURE VERIFIED', 'JULIUS RESTART RECOVERY UN VERIFIED', 'JULIUS FAILURE RECOVERY VERIFIED',
      ].map((transcriptVerdict): [ProofOptions, string] => [{ transcriptVerdict }, 'does not end on JULIUS RESTART RECOVERY VERIFIED']),
    ];
    for (const [options, expected] of cases) {
      const row = rowFor(evaluate(withProof(completingBundle(), options)), 'RESTART / RECOVERY');
      expect(row.verdict, expected).toBe('FAIL');
      expect(row.capabilityBasis).toContain(expected);
    }
    // Named rightly and missing is not the same failure as named wrongly.
    const missing = withProof(completingBundle());
    rmSync(join(missing, 'julius-live-evidence', 'julius-recovery-drill.transcript.txt'));
    expect(rowFor(evaluate(missing), 'RESTART / RECOVERY').capabilityBasis).toContain('its transcript julius-recovery-drill.transcript.txt is not in this bundle');
  });

  it('refuses a transcript carrying a failed step, whatever the ledger says', () => {
    const dir = withProof(completingBundle());
    writeFileSync(join(dir, 'julius-live-evidence', 'julius-recovery-drill.transcript.txt'),
      `${transcriptFor(9)}\n  [FAIL] 10. the fresh process never found the run\nJULIUS RESTART RECOVERY VERIFIED\n`);
    const row = rowFor(evaluate(dir), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.capabilityBasis).toContain('its transcript records 1 failed step(s)');
  });

  /**
   * A BUNDLE THAT CANNOT SAY IS NOT RESCUED — this case asserted the OPPOSITE
   * until GATE_AUDIT.md P1-1: a `failures.tsv` the dump could not read, beside a
   * current drill, read CAPABILITY PROVEN. "Nobody could look" is not "nothing
   * happened": the run may have crashed and failed to recover, and a drill
   * proving the path says nothing about what this run did. The capability axis
   * still reads PROVEN, and the row says both things.
   */
  it('says a bundle could not say, and does not let a drill stand in for it', () => {
    const made = completingWith({ 'failures.tsv': 'unavailable\n' });
    const row = rowFor(evaluate(withProof(made.dir)), 'RESTART / RECOVERY');
    expect(row.verdict).toBe('FAIL');
    expect(row.mission).toBe('UNKNOWN');
    expect(row.capability, 'the drill is sound; it simply may not stand in').toBe('PROVEN');
    expect(row.basis).toContain('THIS MISSION CANNOT SAY WHETHER IT WAS EXERCISED');
    expect(row.basis).toContain('never for one that cannot say');
    expect(row.basis, 'and it does not claim a run it could not read never recovered').not.toContain('NOT EXERCISED THIS MISSION');
  });

  it('reads an attestation supplied beside the bundle rather than inside it', () => {
    const outside = attest(mkdtempSync(join(tmpdir(), 'beta-gate-drills-')));
    const bundleOnly = completingBundle();
    expect(rowFor(evaluate(bundleOnly), 'RESTART / RECOVERY').verdict, 'without it, nothing').toBe('FAIL');
    const report = evaluate(bundleOnly, { capabilityDir: outside });
    expect(rowFor(report, 'RESTART / RECOVERY').verdict).toBe('CAPABILITY PROVEN');
    expect(report.capabilitySource).toBe(outside);
  });

  /**
   * THE LOAD-BEARING PROPERTY, RESTATED FOR THE NEW AXIS. A drill's SOURCE
   * sitting in this tree is not a drill that ran.
   */
  it('cannot capability-prove anything from repository state alone', () => {
    const report = evaluate(null);
    expect(report.capabilitySource).toBeNull();
    expect(report.results.filter((row) => row.verdict === 'CAPABILITY PROVEN'), 'a drill that exists is not a drill that ran').toEqual([]);
    expect(report.summary.provenByDrill).toBe(0);
  });

  /**
   * NO CAPABILITY PROOF IS A CONSTANT — the capability-axis twin of the
   * reachability test above. For every row a drill in this repository claims,
   * a full attestation reaches PROVEN. The drill-admissible rows NO drill
   * claims cannot be proven by one — a proof must name a drill this repository
   * builds, and that drill must import the row's files — so they are named
   * here: writing a drill for one of them is what moves it.
   */
  it('every row a drill in this repository claims can actually be proven by one', () => {
    const admissible = evaluate(null).results.filter((row) => !row.missionRequired && row.verdict !== 'NOT BUILT');
    expect(admissible.length, 'and there are several, or this test proves nothing').toBeGreaterThan(3);
    for (const row of admissible) {
      const report = evaluate(withProof(completingBundle(), { capability: row.id }));
      expect(rowFor(report, row.id).capability, `${row.id}: ${rowFor(report, row.id).capabilityBasis}`)
        .toBe(row.id in DRILL_OF ? 'PROVEN' : 'UNPROVEN');
    }
    expect(admissible.filter((row) => !(row.id in DRILL_OF)).map((row) => row.id), 'the admissible rows no drill claims yet')
      .toEqual(['ACCOUNT / ONBOARDING', 'WONDER WEB OUTPUT', 'PROJECT BRAIN PERSISTENCE', 'PERMISSIONS / MISSION BOUNDARIES']);
  });

  /**
   * MUTATION: THE CURRENCY CHECK IS LOAD-BEARING. Drop it — accept any
   * attestation whose outcome cell reads VERIFIED — and a drill run against
   * code that has since been rewritten still reports the capability proven.
   */
  it('MUTATION: without the digest binding, a drill from a rewritten tree would still read PROVEN', () => {
    const zeroed = Object.fromEntries(implementedBy('RESTART / RECOVERY').map((path) => [path, `sha256:${'0'.repeat(64)}`]));
    const stale = withProof(completingBundle(), { recorded: zeroed });
    const row = rowFor(evaluate(stale), 'RESTART / RECOVERY');
    expect(row.capability, 'the real gate').toBe('STALE');
    expect(row.verdict).toBe('FAIL');
    const ledger = readFileSync(join(stale, 'julius-live-evidence', 'capability-proofs.tsv'), 'utf8');
    expect(ledger, 'which every row still claims').toContain('VERIFIED');
  });

  /**
   * BOTH QUESTIONS, ANSWERED SEPARATELY. The summary is where a reader looks
   * first, so it must never present one number that means either thing.
   */
  it('summarises what the run proved and what Julius is ready to do as different counts', () => {
    const report = evaluate(withProof(completingBundle()));
    const s = report.summary;
    expect(s.total).toBe(16);
    expect(s.exercised + s.failed + s.notExercised + s.unknown, 'the mission axis partitions every built row')
      .toBe(s.total - s.notBuilt);
    expect(s.provenByMission + s.provenByDrill + s.unproven + s.notBuilt, 'and the verdict partitions all of them').toBe(s.total);
    expect(s.provenByDrill, 'recovery, proven by drill and not by this run').toBe(1);
    expect(s.provenByMission).toBe(report.results.filter((row) => row.verdict === 'PASS').length);
  });

  /**
   * SETTLEMENT INTEGRITY: a reservation settled twice is counted twice.
   *
   * `cost-accounting.tsv` sums every settled row and never deduplicates, so the
   * dump lists any reservation settled more than once, and this row FAILS on it.
   * An unreadable file is UNKNOWN and never a pass. A drill evaluation, which has
   * no mission bundle at all, leaves the drill rows exactly as they were.
   */
  const settledOnce = (): Bundle => completingWith({
    'budget.tsv': table(BUDGET, [
      { run_id: RUN, sequence: '4', task_id: BUILD, event_type: 'julius.budget.reserved', role: 'CODING_AGENT', reservation_id: 'reservation:build' },
      { run_id: RUN, sequence: '9', task_id: BUILD, event_type: 'julius.budget.settled', role: 'CODING_AGENT', reservation_id: 'reservation:build' },
    ]),
    'settlement-integrity.tsv': table(INTEGRITY, []),
  });

  it('SETTLEMENT INTEGRITY passes when every reservation settled at most once, and names the count', () => {
    const row = rowFor(evaluate(settledOnce().dir), 'SETTLEMENT INTEGRITY');
    expect(row.verdict).toBe('PASS');
    expect(row.basis).toContain('1 settlement(s) across 1 reservation(s), none settled twice');
  });

  it('SETTLEMENT INTEGRITY FAILS on a reservation settled twice, and names it', () => {
    const made = settledOnce();
    made.write('settlement-integrity.tsv', table(INTEGRITY, [{ run_id: RUN, reservation_id: 'reservation:review', role: 'INDEPENDENT_REVIEWER', settled_rows: '2' }]));
    const row = rowFor(evaluate(made.dir), 'SETTLEMENT INTEGRITY');
    expect(row.verdict).toBe('FAIL');
    expect(row.mission).toBe('FAILED');
    expect(row.basis).toContain('reservation:review (INDEPENDENT_REVIEWER) x2');
  });

  it('SETTLEMENT INTEGRITY is UNKNOWN, never a pass, when the dump could not be read or is absent', () => {
    const unreadable = settledOnce();
    unreadable.write('settlement-integrity.tsv', 'unavailable\n');
    for (const dir of [unreadable.dir, completingBundle()]) {
      const row = rowFor(evaluate(dir), 'SETTLEMENT INTEGRITY');
      expect(row.mission, 'nobody looked is not the same as nothing found').toBe('UNKNOWN');
      expect(row.verdict).toBe('FAIL');
    }
  });

  it('SETTLEMENT INTEGRITY with no settlement at all was not exercised, and a drill cannot stand in for it', () => {
    const made = completingWith({ 'budget.tsv': table(BUDGET, []), 'settlement-integrity.tsv': table(INTEGRITY, []) });
    const row = rowFor(evaluate(made.dir), 'SETTLEMENT INTEGRITY');
    expect(row.mission).toBe('NOT EXERCISED');
    expect(row.capability).toBe('NOT ADMISSIBLE');
    expect(row.verdict).toBe('FAIL');
  });

  /**
   * THE CONTRACT julius-real-infra HOLDS THE GATE TO, pinned. After its drills
   * run, the workflow calls `evaluate(null, { capabilityDir })` and requires the
   * CAPABILITY axis of these three rows to read PROVEN. With no mission bundle
   * the mission axis is UNKNOWN, so the VERDICT is FAIL (a drill does not stand
   * in for a bundle that is not there) — which is why the workflow reads the
   * axis, and this test pins both halves.
   */
  it('a DRILL evaluation, exactly as julius-real-infra calls it, leaves the drill rows PROVEN on the capability axis', () => {
    const outside = mkdtempSync(join(tmpdir(), 'beta-gate-drills-'));
    // Each drill with its own transcript file and closing sentence, as the three drills write them.
    for (const capability of Object.keys(DRILL_OF)) attest(outside, { capability });
    const report = evaluate(null, { capabilityDir: outside });
    for (const capability of Object.keys(DRILL_OF)) {
      const row = rowFor(report, capability);
      expect(row.capability, `${capability}: ${row.capabilityBasis}`).toBe('PROVEN');
      expect(row.mission, 'there is no mission to have exercised it').toBe('UNKNOWN');
      expect(row.verdict).toBe('FAIL');
    }
    expect(rowFor(report, 'SETTLEMENT INTEGRITY').mission, 'and a mission row reads the missing bundle as unknown, not as a failure').toBe('UNKNOWN');
    const workflow = readFileSync(join(REPO, '.github', 'workflows', 'julius-real-infra.yml'), 'utf8');
    expect(workflow, 'the workflow reads the capability axis, which is what stays PROVEN').toContain('row.capability !== "PROVEN"');
    expect(workflow).toContain('evaluate(null, { capabilityDir: "/tmp/julius-capability-proofs" })');
  });
});

/**
 * GATE_AUDIT.md (2026-09-29), HELD. Each finding the audit reproduced against
 * the stack, in the shape of its fixture, BOUND — a manifest naming this
 * checkout, a paid mode and one run, `run_id` on every table — so that what is
 * measured is the row's own reading and not the binding's. Every case here read
 * PASS or CAPABILITY PROVEN before its fix.
 */
describe('the gate audit, finding by finding', () => {
  /* ------------------------------------------------ P0-1 · provider identity */

  const PROVIDER_ROWS = ['PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER', 'VERIFIED COMPLETION'];

  it('P0-1 (F3): the repair drill\'s own database, dumped as a mission, reads NOT A REAL PROVIDER on every role row', () => {
    const drill = 'run:repair-drill';
    const tasks: readonly Task[] = [
      { id: `${drill}:plan`, type: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED', ordinal: 0 },
      { id: `${drill}:build`, type: 'build', role: 'CODING_AGENT', state: 'SUCCEEDED', ordinal: 1 },
      { id: `${drill}:plan:review`, type: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 1, parent: `${drill}:plan` },
      { id: `${drill}:build:review`, type: 'review:build', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 2, parent: `${drill}:build` },
    ];
    const made = completingWith({
      [BUNDLE_MANIFEST]: manifest({ julius_run_id: drill }),
      'runs.tsv': table(RUNS, [{ run_id: drill, mission_id: 'mission:repair-drill', state: 'COMPLETED' }]),
      'tasks.tsv': table(TASKS, taskRows(tasks, drill)),
      'evidence.tsv': table(EVIDENCE, [
        { evidence_id: `${drill}:plan:1:0`, evidence_type: 'ARTIFACT', status: 'PASSED', run_id: drill, task_id: `${drill}:plan` },
        { evidence_id: `${drill}:plan:review:1:0`, evidence_type: 'REVIEW_FINDING', status: 'PASSED', run_id: drill, task_id: `${drill}:plan:review` },
        { evidence_id: `${drill}:build:review:1:0`, evidence_type: 'REVIEW_FINDING', status: 'PASSED', run_id: drill, task_id: `${drill}:build:review` },
      ]),
      'decisions.tsv': table(DECISIONS, [
        { decision_id: 'd1', task_id: `${drill}:plan`, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: drill },
        { decision_id: 'd2', task_id: `${drill}:build`, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: drill },
      ]),
      // Exactly what a drill leaves: scripted adapters, `providerId: 'drill'`, and no diagnostics.
      'trajectory.tsv': table(TRAJECTORY, tasks.flatMap((task) => [
        { event_kind: 'WORKER_SELECTED', task_id: task.id, worker_id: 'w', safe_facts: JSON.stringify({ role: task.role, adapterId: `${task.role === 'CODING_AGENT' ? 'coder' : task.role === 'PROMPT_ARCHITECT' ? 'architect' : 'reviewer'}-adapter` }), run_id: drill },
        { event_kind: 'PROVIDER_SELECTED', task_id: task.id, worker_id: 'w', provider_id: 'drill', safe_facts: '{}', run_id: drill },
      ])),
      'worker-diagnostics.tsv': table(DIAGNOSTICS, []),
      'failures.tsv': table(FAILURES, []),
      'live-mission.evidence.txt': accepted(drill, 'COMPLETED after 6 ticks'),
    });
    const report = evaluate(made.dir);
    expect(report.binding.bound, report.binding.reason ?? '').toBe(true);
    for (const id of PROVIDER_ROWS) {
      const row = rowFor(report, id);
      expect(row.verdict, `${id}: ${row.basis}`).toBe('FAIL');
      expect(row.mission).toBe('FAILED');
      expect(row.basis).toContain('NOT A REAL PROVIDER');
    }
  });

  it('P0-1: a bundle whose diagnostics name no provider credits no role, and says it cannot say', () => {
    const report = evaluate(completingWith({ 'worker-diagnostics.tsv': table(DIAGNOSTICS, []), 'trajectory.tsv': table(TRAJECTORY, []) }).dir);
    for (const id of [...PROVIDER_ROWS, 'REPAIR LOOP']) {
      const row = rowFor(report, id);
      expect(row.mission, `${id}: ${row.basis}`).toBe('UNKNOWN');
      expect(row.verdict).toBe('FAIL');
      expect(row.basis).toContain('no worker-diagnostics row names it');
    }
  });

  it('P0-1: the repository\'s own fakes are refused by name — the fake architect, the fake Claude Code, a scripted adapter', () => {
    const fake = (over: (task: Task) => Row) =>
      evaluate(completingWith({ 'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(COMPLETING_TASKS, RUN, over)) }).dir);
    const architect = rowFor(fake((task) => (task.role === 'PROMPT_ARCHITECT' ? { served_model: 'fake-architect-model', response_id: 'resp_fake_success' } : {})), 'PROMPT ARCHITECT');
    expect(architect.verdict).toBe('FAIL');
    expect(architect.basis).toContain('NOT A REAL PROVIDER');
    expect(architect.basis).toContain('fake-architect-model');
    const coder = rowFor(fake((task) => (task.role === 'CODING_AGENT' ? { served_model: 'fake-model' } : {})), 'CODING AGENT');
    expect(coder.basis).toContain('NOT A REAL PROVIDER');
    const scripted = evaluate(completingWith({
      'trajectory.tsv': table(TRAJECTORY, trajectoryFor(COMPLETING_TASKS).map((row) => (row.event_kind === 'WORKER_SELECTED' && row.task_id === PLAN_REVIEW
        ? { ...row, safe_facts: JSON.stringify({ role: 'INDEPENDENT_REVIEWER', adapterId: 'reviewer-adapter' }) } : row))),
    }).dir);
    expect(rowFor(scripted, 'INDEPENDENT REVIEWER').basis).toContain('adapter reviewer-adapter, not the live hermes-local-live');
    expect(rowFor(scripted, 'VERIFIED COMPLETION').verdict).toBe('FAIL');
  });

  it('P0-1: a coder whose served model the result did not attest, or an architect with no response id, is UNKNOWN', () => {
    const unattested = evaluate(completingWith({
      'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(COMPLETING_TASKS, RUN, (task) => (task.role === 'CODING_AGENT' ? { served_model: '', served_model_basis: 'no_output_turns' } : {}))),
    }).dir);
    expect(rowFor(unattested, 'CODING AGENT').mission).toBe('UNKNOWN');
    expect(rowFor(unattested, 'CODING AGENT').basis).toContain('served_model_basis no_output_turns');
    expect(rowFor(unattested, 'VERIFIED COMPLETION').verdict).toBe('FAIL');
    const silent = evaluate(completingWith({
      'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(COMPLETING_TASKS, RUN, (task) => (task.role === 'PROMPT_ARCHITECT' ? { response_id: '' } : {}))),
    }).dir);
    expect(rowFor(silent, 'PROMPT ARCHITECT').mission).toBe('UNKNOWN');
    expect(rowFor(silent, 'PROMPT ARCHITECT').basis).toContain('no provider response id');
  });

  it('P0-1 control: a mission run on real providers, bound to this checkout, still reads PASS on every role row', () => {
    const report = evaluate(completingBundle());
    for (const id of [...PROVIDER_ROWS, 'REPAIR LOOP']) expect(verdictFor(report, id), rowFor(report, id).basis).toBe('PASS');
    expect(rowFor(report, 'PROMPT ARCHITECT').basis).toContain('openai/gpt-5.6-sol over openai');
  });

  /* -------------------------------------------------------- P0-2 · binding */

  const passes = (report: BetaGateReport) => report.results.filter((row) => row.verdict === 'PASS').map((row) => row.id);

  it('P0-2: a bundle with no manifest proves nothing — and keeps its failures', () => {
    const complete = evaluate(completingWith({ [BUNDLE_MANIFEST]: null }).dir);
    expect(complete.binding.bound).toBe(false);
    expect(passes(complete)).toEqual([]);
    expect(rowFor(complete, 'PROJECT CREATION').basis).toContain(`UNBOUND — the bundle carries no ${BUNDLE_MANIFEST}`);
    const broken = evaluate(bundle({ ...Object.fromEntries(Object.entries({})) }).dir);
    expect(passes(broken)).toEqual([]);
    const failing = failingBundle();
    rmSync(join(failing, 'julius-live-evidence', BUNDLE_MANIFEST));
    expect(rowFor(evaluate(failing), 'CODING AGENT').mission, 'an unbound bundle still says what broke').toBe('FAILED');
  });

  it('P0-2: a bundle produced at another commit, in preflight mode, or about a run it does not hold proves nothing', () => {
    const cases: readonly [Readonly<Record<string, string>>, string][] = [
      [{ commit: '1ea4a75a'.padEnd(40, '0') }, 'it was produced at 1ea4a75a0000 and is being read at'],
      [{ mode: 'preflight', mode_basis: 'workflow_dispatch_not_confirmed_live' }, 'mode=preflight'],
      [{ mode: 'unknown', mode_basis: 'undeclared' }, 'mode=unknown'],
      [{ julius_run_id: 'none' }, 'names no Julius run'],
      [{ julius_run_id: 'run:elsewhere' }, 'names run run:elsewhere, which runs.tsv does not hold'],
    ];
    for (const [over, reason] of cases) {
      const report = evaluate(completingWith({ [BUNDLE_MANIFEST]: manifest(over) }).dir);
      expect(report.binding.bound, reason).toBe(false);
      expect(report.binding.reason).toContain(reason);
      expect(passes(report), reason).toEqual([]);
    }
  });

  it('P0-2: a bundle whose tables do not name their run, or whose entrypoint accepted another run, proves nothing', () => {
    const legacy = evaluate(completingWith({ 'tasks.tsv': tsv(TASKS.slice(0, -1), taskRows(COMPLETING_TASKS).map((row) => TASKS.slice(0, -1).map((column) => row[column as keyof typeof row]))) }).dir);
    expect(legacy.binding.reason).toContain('tasks.tsv carries no run_id column');
    expect(passes(legacy)).toEqual([]);
    const other = evaluate(completingWith({ 'live-mission.evidence.txt': accepted('run:someone-else', 'COMPLETED') }).dir);
    expect(other.binding.reason).toContain('the entrypoint accepted run:someone-else');
    expect(passes(other)).toEqual([]);
  });

  it('P0-2 (F9): a ledger that attests only the row\'s own files is not proof of a drill that drives a whole pipeline', () => {
    const forged = attest(mkdtempSync(join(tmpdir(), 'beta-gate-forged-')), { closure: false });
    const row = rowFor(evaluate(completingBundle(), { capabilityDir: forged }), 'RESTART / RECOVERY');
    expect(row.capability).toBe('UNPROVEN');
    expect(row.capabilityBasis).toContain('of them are not attested');
    expect(row.verdict).toBe('FAIL');
  });

  it('P0-2: a proof goes STALE when ANY file its drill drives changes, not only the row\'s own', () => {
    const probe = new Set(implementedBy('REPAIR LOOP'));
    const pipeline = drivenBy('npm run julius:repair-loop-drill').find((path) => path.endsWith('julius-task-pipeline.ts'))!;
    expect(probe.has(pipeline), 'the pipeline is not a file the row names').toBe(false);
    const row = rowFor(evaluate(withProof(completingWith({ 'decisions.tsv': table(DECISIONS, []), 'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.filter((task) => !task.id.startsWith('repair:')))) }).dir, {
      capability: 'REPAIR LOOP', recorded: { [pipeline]: `sha256:${'0'.repeat(64)}` },
    })), 'REPAIR LOOP');
    expect(row.capability).toBe('STALE');
    expect(row.capabilityBasis).toContain(`${pipeline} has changed since the drill ran`);
  });

  it('P0-2: an attestation naming a drill this repository cannot build proves nothing', () => {
    // Refused as not the row's own drill before its build is even looked for;
    // `drillEntry` refuses it on its own too (julius-drill-support.test.ts).
    const row = rowFor(evaluate(withProof(completingBundle(), { drill: 'npm run julius:no-such-drill' })), 'RESTART / RECOVERY');
    expect(row.capability).toBe('UNPROVEN');
    expect(row.capabilityBasis).toContain('npm run julius:no-such-drill: it is not RESTART / RECOVERY\'s drill');
  });

  /* --------------------------------------------- P0-3 · restart / recovery */

  it('P0-3 (F1): the terminal sweep closing an unsettled invocation is an integrity FAILURE, never a recovery', () => {
    const made = completingWith({
      'failures.tsv': table(FAILURES, [{ run_id: RUN, sequence: '51', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.recovery.action', julius_code: 'TOOL_INVOCATION_UNRESOLVED', failure_class: 'infrastructure_evidence_integrity', reason_code: 'RUN_TERMINAL_WITH_UNSETTLED_TOOL_INVOCATION', recovery_action: 'CLOSE_UNSETTLED_TOOL_INVOCATION' }]),
    });
    const row = rowFor(evaluate(withProof(made.dir)), 'RESTART / RECOVERY');
    expect(row.verdict, 'and no drill rescues it').toBe('FAIL');
    expect(row.mission).toBe('FAILED');
    expect(row.basis).toContain('INTEGRITY FAILURE');
    expect(row.basis).toContain('TOOL_INVOCATION_UNRESOLVED');
  });

  it('P0-3 (F1b): a sweep that FAILED the task it reclaimed did not recover it', () => {
    for (const reason of ['RECOVERY_LIMIT_REACHED', 'RETRIES_EXHAUSTED']) {
      const made = completingWith({
        'failures.tsv': table(FAILURES, [{ run_id: RUN, sequence: '49', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.recovery.action', reason_code: reason, recovery_action: 'FAIL_TASK' }]),
      });
      const row = rowFor(evaluate(withProof(made.dir)), 'RESTART / RECOVERY');
      expect(row.mission, reason).toBe('FAILED');
      expect(row.basis).toContain(`(${reason}): recovery gave up`);
    }
  });

  it('P0-3: a REQUEUE counts only when the task then SUCCEEDED', () => {
    const requeued = (state: string) => evaluate(completingWith({
      'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.map((task) => (task.id === PLAN ? { ...task, state } : task)))),
      'failures.tsv': table(FAILURES, [{ run_id: RUN, sequence: '5', task_id: PLAN, role: 'PROMPT_ARCHITECT', event_type: 'julius.recovery.action', reason_code: 'LEASE_EXPIRED', recovery_action: 'REQUEUE' }]),
    }).dir);
    expect(rowFor(requeued('SUCCEEDED'), 'RESTART / RECOVERY').verdict).toBe('PASS');
    expect(rowFor(requeued('FAILED'), 'RESTART / RECOVERY').mission).toBe('FAILED');
    expect(rowFor(requeued('RUNNABLE'), 'RESTART / RECOVERY').mission).toBe('UNKNOWN');
  });

  /* --------------------------------------------------- P0-4 · repair loop */

  const noRepairTasks = COMPLETING_TASKS.filter((task) => !task.id.startsWith('repair:'));

  it('P0-4 (F2): a rejected build whose repair was refused is a broken loop, and no drill rescues it', () => {
    for (const refusal of ['REPAIR_UNROUTABLE', 'REPAIR_BUDGET_DENIED', 'repair_round_limit']) {
      const made = completingWith({
        'runs.tsv': table(RUNS, [{ run_id: RUN, mission_id: MISSION, state: 'FAILED' }]),
        'tasks.tsv': table(TASKS, taskRows(noRepairTasks)),
        'decisions.tsv': table(DECISIONS, [
          { decision_id: 'd1', task_id: PLAN, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN },
          { decision_id: 'd2', task_id: BUILD, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN },
        ]),
        'failures.tsv': table(FAILURES, [{ run_id: RUN, sequence: '60', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.run.failed', reason_code: refusal }]),
      });
      const row = rowFor(evaluate(withProof(made.dir, { capability: 'REPAIR LOOP' })), 'REPAIR LOOP');
      expect(row.verdict, refusal).toBe('FAIL');
      expect(row.mission).toBe('FAILED');
      expect(row.basis).toContain(`the repair was refused: ${refusal}`);
      expect(row.capability, 'the drill is sound and does not apply').toBe('PROVEN');
    }
  });

  it('P0-4: a REPAIR decision with no accepted repair behind it is FAILED, however the run got there', () => {
    const rejectedAgain = evaluate(completingWith({
      'decisions.tsv': table(DECISIONS, [
        { decision_id: 'd1', task_id: PLAN, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN },
        { decision_id: 'd2', task_id: BUILD, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN },
        { decision_id: 'd3', task_id: REPAIR, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN },
      ]),
    }).dir);
    expect(rowFor(rejectedAgain, 'REPAIR LOOP').mission, 'the re-review rejected the repair again (boundary hunt B20)').toBe('FAILED');
    expect(rowFor(rejectedAgain, 'REPAIR LOOP').basis).toContain('not accepted');
    const never = evaluate(completingWith({ 'tasks.tsv': table(TASKS, taskRows(noRepairTasks)) }).dir);
    expect(rowFor(never, 'REPAIR LOOP').basis).toContain('was sent back for repair and no repair task exists');
  });

  it('P0-4 + P1-1 (F7): an unreadable task dump is UNKNOWN for the repair loop, and no drill rescues it', () => {
    const row = rowFor(evaluate(withProof(completingWith({ 'tasks.tsv': 'unavailable\n' }).dir, { capability: 'REPAIR LOOP' })), 'REPAIR LOOP');
    expect(row.mission).toBe('UNKNOWN');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('tasks.tsv is unreadable');
  });

  /* -------------------------------------- P0-5 + B2 · permissions and boundaries */

  it('P0-5 (F4): a dry run reads no PASS, and a dump with zero invocations or none readable is UNKNOWN', () => {
    const dry = evaluate(completingWith({
      [BUNDLE_MANIFEST]: manifest({ mode: 'preflight', mode_basis: 'workflow_dispatch_not_confirmed_live', julius_run_id: 'none' }),
      'runs.tsv': table(RUNS, []), 'tasks.tsv': table(TASKS, []), 'tool-invocations.tsv': table(INVOCATIONS, []),
      'worker-diagnostics.tsv': table(DIAGNOSTICS, []), 'evidence.tsv': table(EVIDENCE, []), 'decisions.tsv': table(DECISIONS, []),
      'receipt-ids.txt': ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)].join('\n'),
    }).dir);
    expect(passes(dry)).toEqual([]);
    expect(rowFor(dry, 'PERMISSIONS / MISSION BOUNDARIES').mission).toBe('UNKNOWN');
    const zero = evaluate(completingWith({ 'tool-invocations.tsv': table(INVOCATIONS, []) }).dir);
    expect(rowFor(zero, 'PERMISSIONS / MISSION BOUNDARIES').mission, 'paid mode, nothing ran: nothing was checked').toBe('UNKNOWN');
    expect(rowFor(zero, 'PERMISSIONS / MISSION BOUNDARIES').basis).toContain('a bundle that checked nothing cannot pass');
    const unreadable = evaluate(completingWith({ 'tool-invocations.tsv': 'unavailable\n' }).dir);
    expect(rowFor(unreadable, 'PERMISSIONS / MISSION BOUNDARIES').mission, 'F4b').toBe('UNKNOWN');
    const noDiagnostics = evaluate(completingWith({ 'worker-diagnostics.tsv': 'unavailable\n' }).dir);
    expect(rowFor(noDiagnostics, 'PERMISSIONS / MISSION BOUNDARIES').basis).toContain('worker-diagnostics.tsv is unreadable');
  });

  it('B2: a repaired run whose first test FAILED, receipted and settled with its exit code, passes the boundary row', () => {
    const row = rowFor(evaluate(completingBundle()), 'PERMISSIONS / MISSION BOUNDARIES');
    expect(row.verdict, row.basis).toBe('PASS');
    expect(row.basis).toContain('1 ended non-zero with an exit code recorded');
    expect(row.basis, 'and the preflight\'s receipt scopes are not counted as this run\'s').toContain('2 other receipt scope(s)');
  });

  it('B2: a forbidden-path edit FAILS the boundary row, from the scope events or from Julius\'s own scope evidence', () => {
    const scoped = evaluate(completingWith({
      'scope.tsv': table(SCOPE, [{ run_id: RUN, sequence: '41', task_id: BUILD, event_type: 'julius.coder.scope.violated', rule: 'OUT_OF_SCOPE', attributed_to: 'ATTEMPT' }]),
    }).dir);
    expect(rowFor(scoped, 'PERMISSIONS / MISSION BOUNDARIES').mission).toBe('FAILED');
    expect(rowFor(scoped, 'PERMISSIONS / MISSION BOUNDARIES').basis).toContain(`${BUILD} OUT_OF_SCOPE`);
    // The dump's own shape, footer included: a table without `(N rows)` is one the dump never finished.
    const evidenceLines = completingFiles()['evidence.tsv'].split('\n').slice(0, -1);
    const evidenced = evaluate(completingWith({
      'evidence.tsv': [...evidenceLines, [`${BUILD}:1:scope`, 'DIFF', 'FAILED', 'Julius scope check', 't', RUN, BUILD, ''].join('\t'), `(${evidenceLines.length} rows)`].join('\n'),
    }).dir);
    expect(rowFor(evidenced, 'PERMISSIONS / MISSION BOUNDARIES').mission).toBe('FAILED');
  });

  it('B2: an invocation left open, closed unknown, denied, or settled without a receipt FAILS the boundary row', () => {
    const cases: readonly [Readonly<Record<string, string>>, string][] = [
      [{ state: 'DISPATCHING', exit_code: '', completed_at: '' }, 'left unsettled'],
      [{ state: 'FAILED', exit_code: '', recovery_state: 'UNKNOWN_OUTCOME' }, 'closed with an UNKNOWN outcome'],
      [{ state: 'DENIED', exit_code: '' }, 'DENIED by policy'],
    ];
    for (const [over, reason] of cases) {
      const invocations = COMPLETING_INVOCATIONS.map((row) => (row.invocation_id === `${BUILD}:test:g1` ? { ...row, ...over } : row));
      const row = rowFor(evaluate(completingWith({ 'tool-invocations.tsv': table(INVOCATIONS, invocations) }).dir), 'PERMISSIONS / MISSION BOUNDARIES');
      expect(row.mission, reason).toBe('FAILED');
      expect(row.basis).toContain(reason);
    }
    const unsigned = rowFor(evaluate(completingWith({ 'receipt-ids.txt': ['a'.repeat(64)].join('\n') }).dir), 'PERMISSIONS / MISSION BOUNDARIES');
    expect(unsigned.mission).toBe('FAILED');
    expect(unsigned.basis).toContain('no executor receipt scope of their own');
    const denied = rowFor(evaluate(completingWith({
      'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(COMPLETING_TASKS, RUN, (task) => (task.id === BUILD ? { permission_denials: '2' } : {}))),
    }).dir), 'PERMISSIONS / MISSION BOUNDARIES');
    expect(denied.basis).toContain('reported a permission denial');
  });

  /* --------------------------------------------------- P1-2 · every instance */

  it('P1-2 (F6): a successful plan review does not carry a FAILED build review', () => {
    const tasks: readonly Task[] = [
      ...COMPLETING_TASKS.filter((task) => task.id === PLAN || task.id === PLAN_REVIEW || task.id === BUILD),
      { id: BUILD_REVIEW, type: 'review:build', role: 'INDEPENDENT_REVIEWER', state: 'FAILED', ordinal: 2, parent: BUILD },
    ];
    const made = completingWith({
      'runs.tsv': table(RUNS, [{ run_id: RUN, mission_id: MISSION, state: 'FAILED' }]),
      'tasks.tsv': table(TASKS, taskRows(tasks)),
      'decisions.tsv': table(DECISIONS, [{ decision_id: 'd1', task_id: PLAN, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN }]),
    });
    const row = rowFor(evaluate(made.dir), 'INDEPENDENT REVIEWER');
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain(`${BUILD_REVIEW} FAILED`);
  });

  it('P1-2: a failed review that a LATER review of the same work repaired does not fail the row', () => {
    const tasks = COMPLETING_TASKS.map((task) => (task.id === BUILD_REVIEW ? { ...task, state: 'FAILED' } : task));
    const row = rowFor(evaluate(completingWith({ 'tasks.tsv': table(TASKS, taskRows(tasks)) }).dir), 'INDEPENDENT REVIEWER');
    expect(row.verdict, row.basis).toBe('PASS');
  });

  it('P1-2: a plan with no artifact of its own, and reviewed work nobody decided, both FAIL', () => {
    const artifactElsewhere = evaluate(completingWith({
      'evidence.tsv': table(EVIDENCE, [
        { evidence_id: `${BUILD}:9:0`, evidence_type: 'ARTIFACT', status: 'PASSED', run_id: RUN, task_id: BUILD },
        ...[PLAN_REVIEW, BUILD_REVIEW, REPAIR_REVIEW].map((task) => ({ evidence_id: `${task}:1:0`, evidence_type: 'REVIEW_FINDING', status: 'PASSED', run_id: RUN, task_id: task })),
        ...COMPLETING_INVOCATIONS.map(toolEvidence),
      ]),
    }).dir);
    expect(rowFor(artifactElsewhere, 'PROMPT ARCHITECT').basis).toContain(`${PLAN} SUCCEEDED with no accepted plan artifact of its own`);
    const undecided = evaluate(completingWith({
      'decisions.tsv': table(DECISIONS, [
        { decision_id: 'd1', task_id: PLAN, action: 'ACCEPT', reason_code: 'TASK_VERIFIED', run_id: RUN },
        { decision_id: 'd2', task_id: BUILD, action: 'REPAIR', reason_code: 'BLOCKING_FINDINGS', run_id: RUN },
      ]),
    }).dir);
    expect(rowFor(undecided, 'VERIFICATION').mission).toBe('FAILED');
    expect(rowFor(undecided, 'VERIFICATION').basis).toContain(`${REPAIR} was reviewed successfully and verification recorded no decision`);
  });

  /* ------------------------------------------------------ P1-3 · run scoping */

  it('P1-3 (F5): an older COMPLETED run in the same database does not decide this run\'s completion', () => {
    const older = 'run:recovery-drill';
    const made = bundle({
      [BUNDLE_MANIFEST]: manifest(),
      'runs.tsv': table(RUNS, [
        { run_id: older, mission_id: 'mission:recovery-drill', state: 'COMPLETED', created_at: '2026-09-29 12:00:00+00' },
        { run_id: RUN, mission_id: MISSION, state: 'FAILED', created_at: '2026-09-29 12:31:08+00' },
      ]),
      'tasks.tsv': table(TASKS, [...taskRows(FAILING_TASKS), ...taskRows(COMPLETING_TASKS.map((task) => ({ ...task, id: task.id.replace(RUN, older) })), older)]),
      'failures.tsv': table(FAILURES, [{ run_id: older, sequence: '3', task_id: `${older}:plan`, event_type: 'julius.recovery.action', reason_code: 'LEASE_EXPIRED', recovery_action: 'REQUEUE' }]),
      'live-mission.evidence.txt': accepted(),
    });
    const report = evaluate(made.dir);
    expect(report.binding.runId).toBe(RUN);
    expect(rowFor(report, 'VERIFIED COMPLETION').mission).toBe('FAILED');
    expect(rowFor(report, 'VERIFIED COMPLETION').basis).toContain(`run ${RUN} ended FAILED`);
    expect(rowFor(report, 'RESTART / RECOVERY').mission, 'the older run\'s requeue is not this run\'s recovery').toBe('NOT EXERCISED');
    expect(rowFor(report, 'CODING AGENT').mission, 'nor are its succeeded builds this run\'s').toBe('FAILED');
  });

  /* ------------------------------------------- P1-1 (F8) · a retry that never was */

  /**
   * F8, AS THE FALSIFICATION CORRECTED IT. The audit wanted "retryable, never
   * retried" to read FAILED. It is the run's POLICY: with automatic retry off
   * the coordinator schedules nothing, and a SUPERVISED run declines the retry
   * the coordinator scheduled (`SUPERVISED_STOP`) and waits for a person. Both
   * are correct runs, so the row reads NOT EXERCISED — and says why, rather
   * than the old "nothing failed retryably" — and only a retry that RAN and
   * still failed is FAILED.
   */
  it('P1-1 (F8): a retryable failure the run\'s policy never retried is a policy stop, not a failed recovery', () => {
    const failedBuild = (failures: readonly Row[]) => completingWith({
      'runs.tsv': table(RUNS, [{ run_id: RUN, mission_id: MISSION, state: 'FAILED' }]),
      'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.map((task) => (task.id === BUILD ? { ...task, state: 'FAILED' } : task)))),
      'failures.tsv': table(FAILURES, failures),
    }).dir;
    const noAutomaticRetry = rowFor(evaluate(withProof(failedBuild([
      { run_id: RUN, sequence: '46', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.task.failed', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true' },
    ]), { capability: 'FAILURE RECOVERY' })), 'FAILURE RECOVERY');
    expect(noAutomaticRetry.mission).toBe('NOT EXERCISED');
    expect(noAutomaticRetry.basis).toContain(`${BUILD} failed retryably (worker_timeout) and no retry ran`);
    expect(noAutomaticRetry.basis).toContain('a policy stop, not a recovery that failed');
    expect(noAutomaticRetry.verdict, 'a genuine NOT EXERCISED is what a drill may stand in for').toBe('CAPABILITY PROVEN');
    const supervised = rowFor(evaluate(failedBuild([
      { run_id: RUN, sequence: '45', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true' },
      { run_id: RUN, sequence: '46', task_id: BUILD, role: 'CODING_AGENT', event_type: 'julius.task.failed', julius_code: 'TIMEOUT', failure_class: 'worker_timeout', error_retryable: 'true', reason_code: 'SUPERVISED_STOP' },
    ])), 'FAILURE RECOVERY');
    expect(supervised.mission, 'a scheduled retry the policy declined never ran').toBe('NOT EXERCISED');
    expect(supervised.basis).toContain('(SUPERVISED_STOP)');
  });

  /* ------------------------------------------ the falsification (FALSIFICATION.md) */

  /**
   * F10a: A FAILED MISSION PRINTED `BETA: READY`. Two runs in one database: an
   * older, COMPLETED one, and the one the entrypoint accepted, whose own RESULT
   * line says FAILED. The gate read `runs[0]` — the older — for every row. The
   * run is now the accepted one (manifest, or the one accepted line), never an
   * ordering, and VERIFIED COMPLETION requires that run's own RESULT to say
   * COMPLETED.
   */
  it('F10a: a two-run bundle is read as the accepted run, whose RESULT is required and must agree', () => {
    const older = 'run:0a0000000000000000000001';
    const latest = 'run:f00000000000000000000002';
    const made = bundle({
      'runs.tsv': table(RUNS, [
        { run_id: older, mission_id: 'mission:julius-live-6', state: 'COMPLETED', created_at: '2026-09-29 11:00:00+00' },
        { run_id: latest, mission_id: 'mission:julius-live-6', state: 'FAILED', created_at: '2026-09-29 12:31:08+00' },
      ]),
      'tasks.tsv': table(TASKS, taskRows(COMPLETING_TASKS.map((task) => ({ ...task, id: task.id.replace(RUN, older), parent: task.parent?.replace(RUN, older) })), older)),
      'live-mission.evidence.txt': 'Run run:f00000000000000000000002 accepted in state READY; driving the Julius run loop.\nRESULT: FAILED after 2 ticks\n',
    });
    const report = evaluate(made.dir);
    expect(report.binding.runId, 'the accepted run, not the oldest').toBe(latest);
    expect(rowFor(report, 'VERIFIED COMPLETION').mission).toBe('FAILED');
    expect(rowFor(report, 'VERIFIED COMPLETION').basis).toContain(`run ${latest} ended FAILED`);
    expect(report.results.filter((row) => row.verdict === 'PASS')).toEqual([]);
    // And a bound run whose table says COMPLETED while its entrypoint said otherwise, or said nothing.
    const disagrees = rowFor(evaluate(completingWith({ 'live-mission.evidence.txt': accepted(RUN, 'FAILED after 7 ticks') }).dir), 'VERIFIED COMPLETION');
    expect(disagrees.mission).toBe('FAILED');
    expect(disagrees.basis).toContain('RESULT: FAILED');
    const stalled = rowFor(evaluate(completingWith({ 'live-mission.evidence.txt': accepted(RUN, 'COMPLETED (stalled before terminal state) after 32 ticks') }).dir), 'VERIFIED COMPLETION');
    expect(stalled.mission).toBe('FAILED');
    const silent = rowFor(evaluate(completingWith({ 'live-mission.evidence.txt': `Run ${RUN} accepted in state READY; driving the Julius run loop.\n` }).dir), 'VERIFIED COMPLETION');
    expect(silent.mission).toBe('UNKNOWN');
    expect(silent.basis).toContain("the entrypoint's RESULT line for it is absent");
    const twoResults = rowFor(evaluate(completingWith({ 'live-mission.evidence.txt': `${accepted(RUN, 'COMPLETED after 9 ticks')}RESULT: COMPLETED after 3 ticks\n  run: run:another\n` }).dir), 'VERIFIED COMPLETION');
    expect(twoResults.mission, 'a RESULT naming another run unbinds the bundle').toBe('UNKNOWN');
    expect(twoResults.basis).toContain("the entrypoint's RESULT names run:another");
  });

  /**
   * X2: A TYPED LEDGER ROW PROVED A CAPABILITY THAT HAS NO DRILL. ACCOUNT /
   * ONBOARDING and WONDER WEB OUTPUT — the two rows that keep every genuine
   * bundle NOT READY — read CAPABILITY PROVEN from a hand-typed row naming
   * "no such drill". A proof must name a drill this repository builds whose
   * closure imports the row's files, and no drill imports these.
   */
  it('X2: a hand-typed ledger cannot prove a row no drill exists for, bundle or no bundle', () => {
    const typed = mkdtempSync(join(tmpdir(), 'beta-gate-typed-'));
    const rows: string[][] = [];
    for (const capability of ['ACCOUNT / ONBOARDING', 'WONDER WEB OUTPUT', 'PERMISSIONS / MISSION BOUNDARIES', 'PROJECT BRAIN PERSISTENCE']) {
      for (const path of implementedBy(capability)) {
        rows.push([capability, 'no such drill', 'VERIFIED', '1', 'typed by hand', path, digest(path), 'forged.transcript.txt', '2026-09-29T00:00:00.000Z']);
      }
    }
    writeFileSync(join(typed, 'capability-proofs.tsv'), tsv(PROOF_COLUMNS, rows));
    writeFileSync(join(typed, 'forged.transcript.txt'), '  [PASS] 1. typed by hand\n\nFORGED VERIFIED\n');
    for (const dir of [null, completingBundle()]) {
      const report = evaluate(dir, { capabilityDir: typed });
      for (const capability of ['ACCOUNT / ONBOARDING', 'WONDER WEB OUTPUT', 'PERMISSIONS / MISSION BOUNDARIES', 'PROJECT BRAIN PERSISTENCE']) {
        const row = rowFor(report, capability);
        expect(row.capability, `${capability}: ${row.capabilityBasis}`).toBe('UNPROVEN');
        expect(row.capabilityBasis).toContain(`no Julius capability drill exercises ${capability}`);
        expect(row.verdict).not.toBe('CAPABILITY PROVEN');
      }
    }
  });

  /**
   * F4c: EVERY DUMP UNAVAILABLE READ PASS on the boundary row — "0 tool
   * invocation(s) all SUCCEEDED" beside a receipt list. Unavailable and zero
   * rows never share an answer: unavailable is UNKNOWN.
   */
  it('F4c: a bundle whose every dump is unavailable passes nothing, the boundary row included', () => {
    const files = completingFiles();
    const gone = Object.fromEntries(Object.keys(files).filter((name) => name.endsWith('.tsv')).map((name) => [name, 'unavailable\n']));
    const report = evaluate(completingWith(gone).dir);
    expect(report.results.filter((row) => row.verdict === 'PASS').map((row) => row.id)).toEqual([]);
    const boundary = rowFor(report, 'PERMISSIONS / MISSION BOUNDARIES');
    expect(boundary.mission).toBe('UNKNOWN');
    expect(boundary.basis).toContain('tool-invocations.tsv is unreadable');
  });
});

/**
 * REVIEW_SECOND_JULIUS.md (2026-09-29), HELD. The second review's falsification
 * built 154 fixtures against 1bbd18a7; these are its findings in the shape of
 * those fixtures, BOUND to this checkout, and every case below read PASS (or
 * CAPABILITY PROVEN) before its fix. The first three are the ones an HONEST
 * paid run can trigger, which is why attempt 2 is read with them fixed.
 */
describe('the second review, finding by finding', () => {
  const permissions = (dir: string) => rowFor(evaluate(dir), 'PERMISSIONS / MISSION BOUNDARIES');
  /** What a dump killed after the redirect opened leaves behind: nothing, or the header and nothing after it. */
  const cutShort = (header: readonly string[]) => `${header.join('\t')}\n`;
  /** The three drills, each attested as it attests itself: its own command, transcript file and closing sentence. */
  const withDrills = (dir: string): string => {
    for (const capability of Object.keys(DRILL_OF)) attest(join(dir, 'julius-live-evidence'), { capability });
    return dir;
  };

  /* ------------------------------------------------ P2-E · PERMISSIONS */

  /**
   * Q18. The terminal sweep turns an unsettled REQUESTED invocation CANCELLED
   * and writes its CLOSE_UNSETTLED_TOOL_INVOCATION into `failures.tsv`. With
   * that file readable the row FAILS; with it unreadable the row read PASS,
   * because `failures.tsv` was the one input it read a failure from and never
   * listed among the inputs it could not do without.
   */
  it('P2-E (Q18): with failures.tsv unreadable the sweep\'s UNKNOWN_OUTCOME closure is hidden, so the row is UNKNOWN, never PASS', () => {
    const swept = [...COMPLETING_INVOCATIONS, { ...invocation(`${BUILD}:late:g1`, BUILD, 'CANCELLED', ''), completed_at: '' }];
    const closure = {
      run_id: RUN, sequence: '90', task_id: BUILD, event_type: 'julius.recovery.action', julius_code: 'TOOL_INVOCATION_UNRESOLVED',
      failure_class: 'infrastructure_evidence_integrity', reason_code: 'RUN_TERMINAL_WITH_UNSETTLED_TOOL_INVOCATION', recovery_action: 'CLOSE_UNSETTLED_TOOL_INVOCATION',
    };
    const readable = permissions(completingWith({ 'tool-invocations.tsv': table(INVOCATIONS, swept), 'failures.tsv': table(FAILURES, [closure]) }).dir);
    expect(readable.mission).toBe('FAILED');
    expect(readable.basis).toContain('closed with an UNKNOWN outcome');
    for (const hidden of ['unavailable\n', '', cutShort(FAILURES), null]) {
      const row = permissions(completingWith({ 'tool-invocations.tsv': table(INVOCATIONS, swept), 'failures.tsv': hidden }).dir);
      expect(row.mission, `failures.tsv as ${JSON.stringify(hidden)}`).toBe('UNKNOWN');
      expect(row.basis).toContain('failures.tsv is unreadable');
    }
  });

  it('P2-E (Q07): invocations that never executed, or in a state none can be in, are not a boundary that held', () => {
    const cancelled = permissions(completingWith({
      'tool-invocations.tsv': table(INVOCATIONS, [invocation(`${BUILD}:base:g1`, BUILD, 'CANCELLED', '')]),
      'receipt-ids.txt': receiptsFor([]),
    }).dir);
    expect(cancelled.mission).toBe('UNKNOWN');
    expect(cancelled.basis).toContain('none of the 1 tool invocation(s)');
    expect(cancelled.basis).toContain('a bundle that checked nothing cannot pass');
    const strange = permissions(completingWith({
      'tool-invocations.tsv': table(INVOCATIONS, [...COMPLETING_INVOCATIONS, invocation(`${BUILD}:odd:g1`, BUILD, 'LOST', '0')]),
    }).dir);
    expect(strange.mission).toBe('UNKNOWN');
    expect(strange.basis).toContain('no tool invocation can be in');
  });

  /**
   * Q10d. "Unchecked" fired only on an explicit `scope_checked=false`, so a
   * `scope.tsv` with a header and no row read PASS beside a coder that changed
   * the workspace, and so did the path where Julius could not read the coder's
   * implementation and wrote no implementation row at all.
   */
  it('P2-E (Q10d): a coder whose change set is not on record as captured and checked leaves the row UNKNOWN, never PASS', () => {
    const implementation = (task: string, over: Row = {}): Row => ({
      run_id: RUN, sequence: '40', task_id: task, event_type: 'julius.coder.implementation.recorded',
      scope_checked: 'true', scope_violations: '0', own_scope_violations: '0', occurred_at: 't', ...over,
    });
    const headerOnly = permissions(completingWith({ 'scope.tsv': table(SCOPE, []) }).dir);
    expect(headerOnly.mission).toBe('UNKNOWN');
    expect(headerOnly.basis).toContain(`${BUILD} SUCCEEDED with no implementation record in scope.tsv`);
    const refused = permissions(completingWith({
      'scope.tsv': table(SCOPE, [implementation(BUILD), { run_id: RUN, sequence: '41', task_id: REPAIR, event_type: 'julius.coder.report.refused', occurred_at: 't' }]),
    }).dir);
    expect(refused.mission).toBe('UNKNOWN');
    expect(refused.basis).toContain(`${REPAIR}'s implementation could not be read`);
    for (const checked of ['', 'null', 'false']) {
      const row = permissions(completingWith({ 'scope.tsv': table(SCOPE, [implementation(BUILD, { scope_checked: checked }), implementation(REPAIR)]) }).dir);
      expect(row.mission, `scope_checked=${checked || '(empty)'}`).toBe('UNKNOWN');
      expect(row.basis).toContain(`${BUILD}'s change set was not checked against a scope`);
    }
    const CAPTURED = [...SCOPE, 'workspace_captured', 'attempt_captured'];
    const uncaptured = permissions(completingWith({
      'scope.tsv': table(CAPTURED, [implementation(BUILD, { workspace_captured: 'false' }), implementation(REPAIR, { workspace_captured: 'true' })]),
    }).dir);
    expect(uncaptured.mission).toBe('UNKNOWN');
    expect(uncaptured.basis).toContain(`${BUILD}'s workspace was not captured`);

    // A coder task that FAILED having reported no implementation changed nothing
    // Julius could have checked, and does not hold the row back; one whose
    // attempt left a workspace nobody captured does.
    const abandoned: Task = { id: `${RUN}:build:abandoned`, type: 'build', role: 'CODING_AGENT', state: 'FAILED', ordinal: 5 };
    const tasks = [...COMPLETING_TASKS, abandoned];
    const withAbandoned = (scope: readonly Row[]) => completingWith({
      'tasks.tsv': table(TASKS, taskRows(tasks)), 'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnosticsFor(tasks)),
      'trajectory.tsv': table(TRAJECTORY, trajectoryFor(tasks)), 'scope.tsv': table(CAPTURED, scope),
    }).dir;
    const control = permissions(withAbandoned([implementation(BUILD), implementation(REPAIR)]));
    expect(control.verdict, control.basis).toBe('PASS');
    const lostAttempt = permissions(withAbandoned([implementation(BUILD), implementation(REPAIR),
      { run_id: RUN, sequence: '50', task_id: abandoned.id, event_type: 'julius.coder.attempt.workspace', attempt_captured: 'false', occurred_at: 't' }]));
    expect(lostAttempt.mission).toBe('UNKNOWN');
    expect(lostAttempt.basis).toContain(`${abandoned.id}'s attempt left a workspace nobody captured`);
    // And which coder tasks had to be checked is read from tasks.tsv, so without it the row cannot say.
    const noTasks = permissions(completingWith({ 'tasks.tsv': 'unavailable\n' }).dir);
    expect(noTasks.mission).toBe('UNKNOWN');
    expect(noTasks.basis).toContain('tasks.tsv is unreadable');
  });

  /* ------------------------------------------------ P2-F · zero bytes */

  /**
   * Z1-Z3. `dump` opens the redirect before psql says anything, so a dump
   * killed there leaves ZERO BYTES, which read as a table with no rows:
   * SETTLEMENT INTEGRITY PASS on a zero-byte `settlement-integrity.tsv`, the
   * three drill rows NOT EXERCISED (so the drills stood in) and PERMISSIONS
   * PASS on a zero-byte `failures.tsv`. Zero bytes, whitespace, and a header
   * the dump never finished with its `(N rows)` footer are all UNREADABLE.
   */
  it('P2-F (Z1): SETTLEMENT INTEGRITY reads a zero-byte or unfinished dump as UNKNOWN, and only the dump\'s own zero as none', () => {
    const settledOnce = (integrity: string | null) => completingWith({
      'budget.tsv': table(BUDGET, [
        { run_id: RUN, sequence: '4', task_id: BUILD, event_type: 'julius.budget.reserved', role: 'CODING_AGENT', reservation_id: 'reservation:build' },
        { run_id: RUN, sequence: '9', task_id: BUILD, event_type: 'julius.budget.settled', role: 'CODING_AGENT', reservation_id: 'reservation:build' },
      ]),
      'settlement-integrity.tsv': integrity,
    }).dir;
    const stated = rowFor(evaluate(settledOnce(table(INTEGRITY, []))), 'SETTLEMENT INTEGRITY');
    expect(stated.verdict, 'header and `(0 rows)`: the dump looked and found none').toBe('PASS');
    for (const broken of ['', ' \n\n', cutShort(INTEGRITY)]) {
      const row = rowFor(evaluate(settledOnce(broken)), 'SETTLEMENT INTEGRITY');
      expect(row.mission, `settlement-integrity.tsv as ${JSON.stringify(broken)}`).toBe('UNKNOWN');
      expect(row.verdict).toBe('FAIL');
      expect(row.basis).toContain('no readable settlement-integrity dump');
    }
  });

  it('P2-F (Z2): a zero-byte or unfinished failures.tsv leaves the drill rows UNKNOWN, and no drill stands in', () => {
    const stated = evaluate(withDrills(completingWith({ 'failures.tsv': table(FAILURES, []) }).dir));
    expect(rowFor(stated, 'RESTART / RECOVERY').verdict, 'the dump\'s own zero: nothing failed, and the drill stands in').toBe('CAPABILITY PROVEN');
    expect(rowFor(stated, 'FAILURE RECOVERY').verdict).toBe('CAPABILITY PROVEN');
    for (const broken of ['', cutShort(FAILURES)]) {
      const report = evaluate(withDrills(completingWith({ 'failures.tsv': broken }).dir));
      for (const id of ['RESTART / RECOVERY', 'FAILURE RECOVERY', 'REPAIR LOOP', 'PERMISSIONS / MISSION BOUNDARIES']) {
        const row = rowFor(report, id);
        expect(row.mission, `${id} over failures.tsv as ${JSON.stringify(broken)}`).toBe('UNKNOWN');
        expect(row.verdict).toBe('FAIL');
      }
    }
  });

  it('P2-F (Z3): a zero-byte or unfinished scope.tsv leaves PERMISSIONS UNKNOWN, and so does a receipt listing that says nothing', () => {
    for (const broken of ['', cutShort(SCOPE)]) {
      const row = permissions(completingWith({ 'scope.tsv': broken }).dir);
      expect(row.mission, `scope.tsv as ${JSON.stringify(broken)}`).toBe('UNKNOWN');
      expect(row.basis).toContain('scope.tsv is unreadable');
    }
    // `ls … > receipt-ids.txt || true` leaves zero bytes both when the executor
    // holds no receipt and when the listing failed: which of the two is unknown,
    // so neither is read as "every invocation unreceipted".
    for (const silent of ['', '\n \n']) {
      const row = permissions(completingWith({ 'receipt-ids.txt': silent }).dir);
      expect(row.mission, `receipt-ids.txt as ${JSON.stringify(silent)}`).toBe('UNKNOWN');
      expect(row.basis).toContain('receipt-ids.txt is unreadable');
    }
  });

  /**
   * THE RULE, EXPLICIT. A dumped table is read only when psql's own footer
   * closes it and it holds at least the rows the footer states: a cell of free
   * text can carry a newline, which only adds lines, while fewer rows than
   * stated, a footer in the middle (two outputs run together) or rows after
   * `(0 rows)` are a table nobody can vouch for.
   */
  it('P2-F: a table is complete only when psql\'s footer closes it and every row it states is there', () => {
    const settledRow = [RUN, '9', BUILD, 'julius.budget.settled', 'CODING_AGENT', 'reservation:build'].join('\t');
    const settlement = (budget: string) => rowFor(evaluate(completingWith({ 'budget.tsv': budget, 'settlement-integrity.tsv': table(INTEGRITY, []) }).dir), 'SETTLEMENT INTEGRITY');
    const cases: readonly [string, string][] = [
      [[BUDGET.join('\t'), settledRow, '(2 rows)'].join('\n'), 'fewer rows than the footer states'],
      [[BUDGET.join('\t'), settledRow, '(1 row)', settledRow.replace('reservation:build', 'reservation:plan'), '(1 row)'].join('\n'), 'two outputs run together'],
      [[BUDGET.join('\t'), settledRow, '(0 rows)'].join('\n'), 'a row the footer says is not there'],
      [[BUDGET.join('\t'), '(0 rows)', settledRow].join('\n'), 'a row after the footer'],
      [[BUDGET.join('\t'), settledRow].join('\n'), 'no footer at all'],
    ];
    for (const [budget, what] of cases) {
      const row = settlement(budget);
      expect(row.mission, what).toBe('UNKNOWN');
      expect(row.basis, what).toContain('the budget dump is unreadable');
    }
    expect(settlement([BUDGET.join('\t'), settledRow, '(1 row)'].join('\n')).verdict, 'the whole table').toBe('PASS');
    // A free-text cell that carries a newline adds a line and loses nothing the gate reads.
    const evidenceLines = completingFiles()['evidence.tsv'].split('\n').slice(0, -1);
    const multiline = evaluate(completingWith({
      'evidence.tsv': [...evidenceLines, [`${BUILD}:1:note`, 'DIFF', 'PASSED', 'first line\nsecond line', 't', RUN, BUILD, ''].join('\t'), `(${evidenceLines.length} rows)`].join('\n'),
    }).dir);
    for (const id of ['PROMPT ARCHITECT', 'INDEPENDENT REVIEWER', 'PERMISSIONS / MISSION BOUNDARIES']) {
      expect(rowFor(multiline, id).verdict, `${id}: ${rowFor(multiline, id).basis}`).toBe('PASS');
    }
  });

  /* ------------------------------------------------ P3 · RESULT lines */

  /**
   * S6. A named `RESULT: COMPLETED` beside an unattributed `RESULT: FAILED`
   * read VERIFIED COMPLETION PASS: the line that named no run was not counted.
   * It could be this run's, so the bundle cannot say how this run ended.
   */
  it('P3 (S6): a RESULT line that names no run, or two for this run that disagree, leave VERIFIED COMPLETION UNKNOWN', () => {
    const completion = (text: string) => rowFor(evaluate(completingWith({ 'live-mission.evidence.txt': text }).dir), 'VERIFIED COMPLETION');
    const acceptedLine = `Run ${RUN} accepted in state READY; driving the Julius run loop.\n`;
    const s6 = completion(`${accepted(RUN, 'COMPLETED after 9 ticks')}RESULT: FAILED after 2 ticks\n`);
    expect(s6.mission).toBe('UNKNOWN');
    expect(s6.basis).toContain('`RESULT: FAILED after 2 ticks` names no run');
    const above = completion(`${acceptedLine}RESULT: FAILED after 2 ticks\nRESULT: COMPLETED after 9 ticks\n  run: ${RUN}\n`);
    expect(above.mission, 'a run: line belongs to the RESULT right above it, not to one further up').toBe('UNKNOWN');
    const unnamedTwin = completion(`${acceptedLine}RESULT: COMPLETED after 9 ticks\nRESULT: COMPLETED after 9 ticks\n  run: ${RUN}\n`);
    expect(unnamedTwin.mission, 'the first names no run of its own, whatever it agrees with').toBe('UNKNOWN');
    const disagree = completion(`${accepted(RUN, 'COMPLETED after 9 ticks')}RESULT: FAILED after 9 ticks\n  run: ${RUN}\n`);
    expect(disagree.mission).toBe('UNKNOWN');
    expect(disagree.basis).toContain('its RESULT lines disagree');
    const blocked = completion(`${accepted(RUN, 'COMPLETED after 9 ticks')}RESULT: BLOCKED — nothing was submitted and no provider was contacted.\n`);
    expect(blocked.mission, 'a RESULT line of another shape is still a RESULT line').toBe('UNKNOWN');
    const alone = completion(`${acceptedLine}RESULT: COMPLETED after 9 ticks\n`);
    expect(alone.mission, 'even alone, a RESULT that names no run is not shown to be this run\'s').toBe('UNKNOWN');
    const twice = completion(`${accepted(RUN, 'COMPLETED after 9 ticks')}RESULT: COMPLETED after 9 ticks\n  run: ${RUN}\n`);
    expect(twice.verdict, `the same answer twice is one answer: ${twice.basis}`).toBe('PASS');
  });

  /* ------------------------------------------------ P1-D · an allowlist, not a denylist */

  /**
   * P01, P02, P10. P0-1 was a denylist of stand-in words: FakeOpenAI,
   * MockProvider, `test` and an adapter named `stubbed-live` passed, and the
   * adapter rule was skipped whenever the trajectory could not be read. Only
   * the live composition's own worker, adapter and provider for the role are
   * real now, on every attempt of the task; what cannot be checked is UNKNOWN.
   */
  it('P1-D (P01, P02, P10): only the live composition\'s own worker, adapter and provider are real, on every attempt', () => {
    const architect = (diagnostics: readonly Row[] | null, trajectory: (row: Row) => Row = (row) => row) => rowFor(evaluate(completingWith({
      'worker-diagnostics.tsv': table(DIAGNOSTICS, diagnostics ?? diagnosticsFor(COMPLETING_TASKS)),
      'trajectory.tsv': table(TRAJECTORY, trajectoryFor(COMPLETING_TASKS).map((row) => (row.task_id === PLAN ? trajectory(row) : row))),
    }).dir), 'PROMPT ARCHITECT');
    const answeredBy = (over: Row) => diagnosticsFor(COMPLETING_TASKS, RUN, (task) => (task.id === PLAN ? over : {}));
    // What answered, in the diagnostics: a provider the composition does not give the role, however it is spelled.
    for (const provider of ['FakeOpenAI', 'MockProvider', 'test', 'DrillProvider', 'sandbox', 'OpenAI']) {
      const row = architect(answeredBy({ provider }));
      expect(row.mission, provider).toBe('FAILED');
      expect(row.basis).toContain(`its provider ${provider} is not the one the live composition gives PROMPT_ARCHITECT (openai)`);
    }
    expect(architect(answeredBy({ transport: 'sandbox' })).basis).toContain('its transport sandbox is none the runtime has');
    // Where the runtime sent it, in the trajectory: the provider, the adapter and the worker.
    const routed = architect(null, (row) => (row.event_kind === 'PROVIDER_SELECTED' ? { ...row, provider_id: 'MockProvider' } : row));
    expect(routed.mission).toBe('FAILED');
    expect(routed.basis).toContain('the trajectory routed it to MockProvider, and the live composition routes PROMPT_ARCHITECT only to openai');
    for (const adapter of ['stubbed-live', 'test-live', 'FakeArchitect-live', 'openai-architect-Live']) {
      const row = architect(null, (entry) => (entry.event_kind === 'WORKER_SELECTED' ? { ...entry, safe_facts: JSON.stringify({ role: 'PROMPT_ARCHITECT', adapterId: adapter }) } : entry));
      expect(row.mission, adapter).toBe('FAILED');
      expect(row.basis).toContain(`adapter ${adapter}, not the live openai-architect-live`);
    }
    expect(architect(null, (row) => ({ ...row, worker_id: 'prompt-architect-fake' })).basis)
      .toContain('worker prompt-architect-fake, not the live prompt-architect-openai');
    // An earlier attempt answered by a stand-in taints the task, even when the last attempt was real.
    const earlier: Row = { run_id: RUN, sequence: '5', task_id: PLAN, role: 'PROMPT_ARCHITECT', stage: 'plan', transport: 'local', provider: 'drill', served_model: 'gpt-5.6-sol', outcome: 'failed', event_type: 'julius.task.failed' };
    const tainted = architect([earlier, ...diagnosticsFor(COMPLETING_TASKS)]);
    expect(tainted.mission).toBe('FAILED');
    expect(tainted.basis).toContain('its provider drill is not the one the live composition gives PROMPT_ARCHITECT');

    // WHAT CANNOT BE CHECKED IS UNKNOWN, NEVER A PASS.
    const unread = evaluate(completingWith({ 'trajectory.tsv': 'unavailable\n' }).dir);
    for (const id of ['PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER', 'VERIFIED COMPLETION']) {
      expect(rowFor(unread, id).mission, id).toBe('UNKNOWN');
      expect(rowFor(unread, id).basis).toContain('trajectory.tsv is unreadable');
    }
    const unselected = architect(null, (row) => (row.event_kind === 'WORKER_SELECTED' ? { ...row, event_kind: 'CONTEXT_COMPILED' } : row));
    expect(unselected.mission).toBe('UNKNOWN');
    expect(unselected.basis).toContain('the trajectory records no worker selection for it');
    const unparsed = architect(null, (row) => (row.event_kind === 'WORKER_SELECTED' ? { ...row, safe_facts: '{"role":"PROMPT_ARCHITECT","adapterId":' } : row));
    expect(unparsed.mission).toBe('UNKNOWN');
    expect(unparsed.basis).toContain('its worker selection names no readable adapter');
    const noBasis = rowFor(evaluate(completingWith({
      'worker-diagnostics.tsv': table(DIAGNOSTICS.filter((column) => column !== 'served_model_basis'), diagnosticsFor(COMPLETING_TASKS)),
    }).dir), 'CODING AGENT');
    expect(noBasis.mission, 'a dump without the attestation column cannot attest the coder\'s model').toBe('UNKNOWN');
    expect(noBasis.basis).toContain('carries no served_model_basis column');
    // CONTROL: the identities paid run 36568129865 actually recorded still pass.
    for (const id of ['PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER', 'VERIFIED COMPLETION']) {
      expect(verdictFor(evaluate(completingBundle()), id), id).toBe('PASS');
    }
  });

  it('P1-D: the allowlist is the live composition\'s own constants, read from this checkout, never retyped', () => {
    const live = gateModule.liveIdentities();
    if ('error' in live) throw new Error(live.error);
    for (const [role, worker] of [['PROMPT_ARCHITECT', architectWorker({})], ['CODING_AGENT', CODER_WORKER]] as const) {
      expect(live.roles[role].workerId, role).toBe(worker.workerId);
      expect(live.roles[role].adapterId, role).toBe(worker.adapterId);
      expect(live.roles[role].providers, role).toEqual([worker.providerId]);
    }
    // `reviewerWorker(providerId)`: the composition takes the reviewer's provider
    // from RELAY_HERMES_PROVIDER, which both launchers set to xai.
    const reviewer = reviewerWorker('xai');
    expect(live.roles.INDEPENDENT_REVIEWER.workerId).toBe(reviewer.workerId);
    expect(live.roles.INDEPENDENT_REVIEWER.adapterId).toBe(reviewer.adapterId);
    expect(live.roles.INDEPENDENT_REVIEWER.providers).toEqual(['xai']);
    for (const launcher of gateModule.LIVE_LAUNCHERS) {
      expect(readFileSync(join(REPO, launcher), 'utf8'), `${launcher} sets the reviewer's provider`).toMatch(/RELAY_HERMES_PROVIDER\s*[:=]\s*xai\s*$/mu);
    }
    expect([...live.transports].sort(), 'the runtime\'s own transport enum (julius-router.ts)').toEqual(['hosted', 'local', 'openai', 'remote']);
  });

  /* ------------------------------------------------ P1-C · each row, its own drill */

  /**
   * X2-recovery-drill-claims-failrec-and-repair, X2-relay-bridge-server-as-drill.
   * The three drills drive nearly the same pipeline, so the recovery drill's
   * genuine attestation, relabelled, "proved" FAILURE RECOVERY and REPAIR LOOP;
   * and `drillEntry` took any npm script with a build, the relay bridge server
   * included. A row is proven only by its own drill, with that drill's own
   * transcript file closing on the sentence only that drill writes.
   */
  it('P1-C (X2): a drill proves only its own capability — never a relabelled one, never a server run as a "drill"', () => {
    const relabelled = mkdtempSync(join(tmpdir(), 'beta-gate-relabelled-'));
    for (const capability of Object.keys(DRILL_OF)) {
      attest(relabelled, { capability, drill: DRILL_OF['RESTART / RECOVERY'], transcript: 'julius-recovery-drill.transcript.txt', transcriptVerdict: 'JULIUS RESTART RECOVERY VERIFIED' });
    }
    const report = evaluate(null, { capabilityDir: relabelled });
    expect(rowFor(report, 'RESTART / RECOVERY').capability, 'its own row it still proves').toBe('PROVEN');
    for (const capability of ['FAILURE RECOVERY', 'REPAIR LOOP']) {
      const row = rowFor(report, capability);
      expect(row.capability, `${capability}: ${row.capabilityBasis}`).toBe('UNPROVEN');
      expect(row.capabilityBasis).toContain(`it is not ${capability}'s drill (${DRILL_OF[capability]})`);
    }
    // The bridge SERVER, attested over everything its own build reaches — which
    // includes the recovery files, so coverage alone once let it "prove" the row.
    const scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts as Record<string, string>;
    const serverEntry = /\besbuild\s+(\S+\.[cm]?tsx?)\s/u.exec(`${scripts['relay:bridge:build']} `)?.[1] ?? '';
    expect(importClosure(REPO, serverEntry), 'the server build reaches the recovery files').toEqual(expect.arrayContaining([...implementedBy('RESTART / RECOVERY')]));
    const server = mkdtempSync(join(tmpdir(), 'beta-gate-server-'));
    attest(server, { capability: 'RESTART / RECOVERY', drill: 'npm run relay:bridge', closure: false, paths: importClosure(REPO, serverEntry) });
    const served = rowFor(evaluate(null, { capabilityDir: server }), 'RESTART / RECOVERY');
    expect(served.capability).toBe('UNPROVEN');
    expect(served.capabilityBasis).toContain('npm run relay:bridge: it is not RESTART / RECOVERY\'s drill');
    const renamed = rowFor(evaluate(withProof(completingBundle(), { transcript: 'recovery.transcript.txt' })), 'RESTART / RECOVERY');
    expect(renamed.capability).toBe('UNPROVEN');
    expect(renamed.capabilityBasis).toContain('npm run julius:recovery-drill writes julius-recovery-drill.transcript.txt');
    // CONTROL: each drill's own attestation still proves its own row.
    const genuine = mkdtempSync(join(tmpdir(), 'beta-gate-genuine-'));
    for (const capability of Object.keys(DRILL_OF)) attest(genuine, { capability });
    const proven = evaluate(null, { capabilityDir: genuine });
    for (const capability of Object.keys(DRILL_OF)) expect(rowFor(proven, capability).capability, capability).toBe('PROVEN');
  });

  /* ------------------------------------------------ P2-G · wonder-web.tsv */

  /**
   * G2. A typed `ghu-1` tenant, a hand-added `wonder-web.tsv` with no `run_id`
   * (it was not in RUN_SCOPED_FILES) and genuine drill ledgers printed BETA:
   * READY and exited 0. Nothing produces that file: it is run-scoped now, and
   * WONDER WEB OUTPUT is UNKNOWN until a dump query writes it.
   */
  it('P2-G (G2): a hand-added wonder-web.tsv is no dump\'s output — it unbinds without run_id and proves nothing with it', () => {
    const g2 = (wonderWeb: string) => evaluate(withDrills(completingWith({
      'sessions.tsv': table(SESSIONS, [{ execution_id: 'exec-1', mission_id: MISSION, project_id: 'prj-julius-live-2', player_id: 'ghu-1', agent_id: 'agent:ghu-1', state: 'RUNNING' }]),
      'wonder-web.tsv': wonderWeb,
    }).dir));
    const unscoped = g2('output_id\topened_at\nsome-other-runs-output\t2026-01-01\n(1 row)\n');
    expect(unscoped.binding.bound).toBe(false);
    expect(unscoped.binding.reason).toContain('wonder-web.tsv carries no run_id column');
    const scoped = g2(table(['run_id', 'output_id', 'opened_at'], [{ run_id: RUN, output_id: 'output:1', opened_at: 't' }]));
    expect(scoped.binding.bound, scoped.binding.reason ?? '').toBe(true);
    const row = rowFor(scoped, 'WONDER WEB OUTPUT');
    expect(row.mission).toBe('UNKNOWN');
    expect(row.basis).toContain('the wonder-web.tsv in this bundle is no dump\'s output');
    expect(rowFor(scoped, 'ACCOUNT / ONBOARDING').mission, 'and the typed ghu- tenant is no sign-up (P1-A)').toBe('UNKNOWN');
    for (const report of [unscoped, scoped]) {
      expect(report.summary.provenByMission + report.summary.provenByDrill, 'BETA: NOT READY').toBeLessThan(report.summary.total);
    }
  });
});
