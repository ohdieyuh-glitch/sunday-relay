import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluate, type BetaGateReport, type BetaVerdict } from './wonderland-beta-gate.mjs';

/**
 * THE GATE, HELD TO ITS OWN RULE.
 *
 * What is worth testing here is not that fourteen rows appear. It is that the
 * gate CANNOT be talked into an optimistic answer: no repository state, however
 * complete, may produce a PASS for a capability that runs at mission time. Every
 * PASS has to be read out of a real run.
 *
 * The bundles below are written from the shapes the live workflow actually
 * uploads — `runs.tsv`, `tasks.tsv`, `failures.tsv`, `decisions.tsv`,
 * `findings.tsv`, `evidence.tsv`, `worker-diagnostics.tsv`, `receipt-ids.txt`
 * and `live-mission.evidence.txt` — and the failing one is paid run
 * 34037313976 verbatim.
 */

const tsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header.join('\t'), ...rows.map((row) => row.join('\t')), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n');

const RUN = 'run:4bf13d0e833a042c74f57555';

/** Paid run 34037313976, as its artifact recorded it. */
function failingBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beta-gate-failed-'));
  const bundle = join(dir, 'julius-live-evidence');
  mkdirSync(bundle);
  const write = (name: string, text: string) => writeFileSync(join(bundle, name), text);

  write('runs.tsv', tsv(['run_id', 'mission_id', 'state', 'card_revision'], [[RUN, 'mission:julius-live-2', 'FAILED', 'card:julius-live:1']]));
  write('tasks.tsv', tsv(['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id'], [
    [`${RUN}:plan`, 'plan', 'PROMPT_ARCHITECT', 'SUCCEEDED', '0', ''],
    [`repair:${RUN}:plan:1:task`, 'repair:plan', 'CODING_AGENT', 'FAILED', '1', `${RUN}:plan`],
    [`${RUN}:build`, 'build', 'CODING_AGENT', 'FAILED', '1', ''],
    [`${RUN}:plan:review`, 'review:plan', 'INDEPENDENT_REVIEWER', 'SUCCEEDED', '1', `${RUN}:plan`],
  ]));
  write('failures.tsv', tsv(['task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'], [
    [`${RUN}:build`, 'CODING_AGENT', 'julius.task.failed', 'WORKER_EXECUTION_FAILURE', 'coder_cost_exceeded', 'false', '', '', 't'],
    [`${RUN}:plan:review`, 'INDEPENDENT_REVIEWER', 'julius.retry.scheduled', 'TIMEOUT', 'review_timeout', 'true', '', '', 't'],
    [`repair:${RUN}:plan:1:task`, 'CODING_AGENT', 'julius.task.failed', 'PROVIDER_UNAVAILABLE', '', 'false', '', '', 't'],
  ]));
  write('decisions.tsv', tsv(['decision_id', 'task_id', 'action', 'reason_code'], [['decision:1', `${RUN}:plan`, 'REPAIR', 'BLOCKING_FINDINGS']]));
  write('findings.tsv', tsv(['finding_id', 'blocking', 'status', 'claim'], [
    ['finding:1', 't', 'OPEN', '[blocking] No edit occurred.'],
  ]));
  write('evidence.tsv', tsv(['evidence_id', 'evidence_type', 'status', 'safe_summary'], [
    [`${RUN}:plan:1:0`, 'ARTIFACT', 'PASSED', 'Validated architect plan stored for this run.'],
    // The reviewer answered — about an empty diff, which is the run's whole
    // tragedy, but it answered and Julius could act on what it said.
    [`${RUN}:plan:review:3:0`, 'REVIEW_FINDING', 'FAILED', '[blocking] No edit occurred.'],
  ]));
  write('worker-diagnostics.tsv', tsv(['task_id', 'role', 'stage', 'transport', 'permission_denials'], [
    [`${RUN}:build`, 'CODING_AGENT', 'build', 'hosted', '0'],
  ]));
  write('receipt-ids.txt', ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)].join('\n'));
  write('live-mission.evidence.txt', `# evidence\n\nRun ${RUN} accepted in state READY; driving the Julius run loop.\nRESULT: FAILED after 5 ticks\n`);
  return dir;
}

/** The same run with the ceiling repaired: the coder's work is banked and the mission completes. */
function completingBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beta-gate-completed-'));
  const bundle = join(dir, 'julius-live-evidence');
  mkdirSync(bundle);
  const write = (name: string, text: string) => writeFileSync(join(bundle, name), text);

  write('runs.tsv', tsv(['run_id', 'mission_id', 'state', 'card_revision'], [[RUN, 'mission:julius-live-2', 'COMPLETED', 'card:julius-live:1']]));
  write('tasks.tsv', tsv(['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id'], [
    [`${RUN}:plan`, 'plan', 'PROMPT_ARCHITECT', 'SUCCEEDED', '0', ''],
    [`${RUN}:build`, 'build', 'CODING_AGENT', 'SUCCEEDED', '1', ''],
    [`repair:${RUN}:build:1:task`, 'repair:build', 'CODING_AGENT', 'SUCCEEDED', '2', `${RUN}:build`],
    [`${RUN}:build:review`, 'review:build', 'INDEPENDENT_REVIEWER', 'SUCCEEDED', '2', `${RUN}:build`],
  ]));
  write('failures.tsv', tsv(['task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'], [
    [`${RUN}:build:review`, 'INDEPENDENT_REVIEWER', 'julius.retry.scheduled', 'TIMEOUT', 'review_timeout', 'true', '', '', 't'],
  ]));
  write('decisions.tsv', tsv(['decision_id', 'task_id', 'action', 'reason_code'], [['decision:1', `${RUN}:build`, 'ACCEPT', 'ALL_CRITERIA_MET']]));
  write('findings.tsv', tsv(['finding_id', 'blocking', 'status', 'claim'], [['finding:1', 'f', 'RESOLVED', '[minor] naming']]));
  write('evidence.tsv', tsv(['evidence_id', 'evidence_type', 'status', 'safe_summary'], [
    [`${RUN}:plan:1:0`, 'ARTIFACT', 'PASSED', 'Validated architect plan stored for this run.'],
    [`${RUN}:build:1:0`, 'TEST', 'PASSED', 'node --test run-summary.test.js: exit 0.'],
    // An APPROVING review. The adapter writes one PASSED row on this path, and
    // a probe that counted findings instead would have scored it a failure.
    [`${RUN}:build:review:1:0`, 'REVIEW_FINDING', 'PASSED', 'Independent review approved the change.'],
  ]));
  write('worker-diagnostics.tsv', tsv(['task_id', 'role', 'stage', 'transport', 'permission_denials'], [
    [`${RUN}:build`, 'CODING_AGENT', 'build', 'hosted', '0'],
  ]));
  write('receipt-ids.txt', ['a'.repeat(64), 'b'.repeat(64)].join('\n'));
  write('live-mission.evidence.txt', `# evidence\n\nRun ${RUN} accepted in state READY; driving the Julius run loop.\nRESULT: COMPLETED after 9 ticks\n`);
  return dir;
}

const verdictFor = (report: BetaGateReport, id: string): BetaVerdict =>
  report.results.find((row) => row.id === id)!.verdict;

const CONTRACT_EVENT_COLUMNS = [
  'task_id', 'event_type', 'reason_code', 'contract_task_id', 'contract_id', 'contract_revision', 'binding_digest',
  'recorded_revision', 'current_revision', 'review_revision', 'implementation_revision', 'role', 'occurred_at',
];
const contractEvents = (rows: readonly (readonly string[])[]) => tsv(CONTRACT_EVENT_COLUMNS, rows);

describe('the Wonderland Beta Gate', () => {
  const VERDICTS: readonly BetaVerdict[] = ['PASS', 'FAIL', 'NOT BUILT'];

  it('answers with exactly three values, whatever it is pointed at', () => {
    for (const report of [evaluate(null), evaluate(failingBundle()), evaluate(completingBundle())]) {
      expect(report.results.length, 'the fifteen declared capabilities').toBe(15);
      for (const row of report.results) {
        expect(VERDICTS, `${row.id} answered ${row.verdict}`).toContain(row.verdict);
        expect(row.basis.length, `${row.id} must name what it read`).toBeGreaterThan(0);
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
    expect(report.results.filter((row) => row.verdict === 'PASS'), 'nothing may pass on repository state alone').toEqual([]);
  });

  it('reads paid run 34037313976 exactly as its artifact recorded it', () => {
    const report = evaluate(failingBundle());
    expect(verdictFor(report, 'JULIUS MISSION START')).toBe('PASS');
    expect(verdictFor(report, 'PROMPT ARCHITECT')).toBe('PASS');
    expect(verdictFor(report, 'INDEPENDENT REVIEWER'), 'the reviewer answered, whatever it was handed').toBe('PASS');
    expect(verdictFor(report, 'VERIFICATION')).toBe('PASS');
    expect(verdictFor(report, 'FAILURE RECOVERY'), 'the review timeout was retried and then succeeded').toBe('PASS');
    expect(verdictFor(report, 'CODING AGENT'), 'the build task FAILED on coder_cost_exceeded').toBe('FAIL');
    expect(verdictFor(report, 'REPAIR LOOP')).toBe('FAIL');
    expect(verdictFor(report, 'VERIFIED COMPLETION')).toBe('FAIL');
    expect(verdictFor(report, 'WONDER WEB OUTPUT')).toBe('NOT BUILT');
    expect(report.results.find((row) => row.id === 'CODING AGENT')!.basis,
      'and it says which class stopped it').toContain('coder_cost_exceeded');
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
   * banked instead of refused, so the diff reaches the reviewer and the run
   * reaches COMPLETED. Three verdicts move, and nothing else has to.
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
    const withBrain = (rows: readonly (readonly string[])[]): string => {
      const dir = completingBundle();
      writeFileSync(join(dir, 'julius-live-evidence', 'project-brain.tsv'),
        tsv(['entry_id', 'entry_kind', 'worker_id', 'task_id', 'revision', 'created_at'], rows));
      return dir;
    };
    const seededOnly = evaluate(withBrain([
      ['brain-1', 'CONSTRAINT', 'relay-bootstrap', '', '1', 't'],
      ['brain-2', 'CONSTRAINT', 'relay-bootstrap', '', '2', 't'],
    ]));
    expect(verdictFor(seededOnly, 'PROJECT BRAIN PERSISTENCE'), 'a read-only seed is not persistence').toBe('FAIL');
    expect(seededOnly.results.find((row) => row.id === 'PROJECT BRAIN PERSISTENCE')!.basis)
      .toContain('the run wrote none back');

    const writtenBack = evaluate(withBrain([
      ['brain-1', 'CONSTRAINT', 'relay-bootstrap', '', '1', 't'],
      ['brain-2', 'DECISION', 'coding-agent-claude-hosted', `${RUN}:build`, '2', 't'],
    ]));
    expect(verdictFor(writtenBack, 'PROJECT BRAIN PERSISTENCE')).toBe('PASS');
    expect(writtenBack.results.find((row) => row.id === 'PROJECT BRAIN PERSISTENCE')!.basis).toContain('DECISION');

    const empty = evaluate(withBrain([]));
    expect(verdictFor(empty, 'PROJECT BRAIN PERSISTENCE'), 'not even the seed persisted').toBe('FAIL');
    expect(empty.results.find((row) => row.id === 'PROJECT BRAIN PERSISTENCE')!.basis).toContain('empty');
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
    const dir = completingBundle();
    writeFileSync(join(dir, 'julius-live-evidence', 'project-brain.tsv'), 'unavailable\n');
    const report = evaluate(dir);
    const brain = report.results.find((row) => row.id === 'PROJECT BRAIN PERSISTENCE')!;
    expect(brain.verdict, 'unreadable is still not a pass').toBe('FAIL');
    expect(brain.basis, 'but it must not claim the table was empty').toContain('no readable');
    expect(brain.basis).not.toContain('empty');
  });

  /**
   * ACCOUNT / ONBOARDING IS A GATE, NOT A CONSTANT.
   *
   * It shipped earlier today as a row that returned FAIL down every branch —
   * no evidence shape could have passed it, which makes it a hard-coded verdict
   * wearing a probe's clothes. The durable fact that decides it is
   * `execution_sessions.player_id`: the operator identity both bounded missions
   * run under is not an account, and anything else is.
   */
  it('flips ACCOUNT / ONBOARDING on the account the mission actually ran for', () => {
    const withSessions = (players: readonly string[]): string => {
      const dir = completingBundle();
      writeFileSync(join(dir, 'julius-live-evidence', 'sessions.tsv'),
        tsv(['execution_id', 'mission_id', 'project_id', 'player_id', 'agent_id', 'state'],
          players.map((player, index) => [`exec-${index}`, 'mission:julius-live-2', 'prj-julius-live-2', player, `agent:${player}`, 'RUNNING'])));
      return dir;
    };
    expect(verdictFor(evaluate(withSessions(['tenant'])), 'ACCOUNT / ONBOARDING'),
      'the operator identity is not an account').toBe('FAIL');
    expect(verdictFor(evaluate(withSessions(['player:ada'])), 'ACCOUNT / ONBOARDING'),
      'a real account is exactly what this row is about').toBe('PASS');
    expect(verdictFor(evaluate(withSessions(['tenant', 'player:ada'])), 'ACCOUNT / ONBOARDING'),
      'one real account among operator runs still counts').toBe('PASS');

    const withoutDump = evaluate(completingBundle());
    expect(withoutDump.results.find((row) => row.id === 'ACCOUNT / ONBOARDING')!.basis,
      'and a bundle that cannot say must say it cannot, not fail for a reason it never checked')
      .toContain('no readable execution-session dump');
  });

  it('still refuses to call that beta ready, because four capabilities remain unproven', () => {
    const report = evaluate(completingBundle());
    expect(report.results.every((row) => row.verdict === 'PASS'), 'a completing mission is not a beta').toBe(false);
  });

  /**
   * NO PROBE IS A CONSTANT — the structural version of the ACCOUNT fix.
   *
   * ACCOUNT / ONBOARDING shipped as a row that returned FAIL down every branch.
   * Nothing caught it, because each individual test asserted the verdict that
   * row happened to give. The general property is REACHABILITY: for every
   * capability whose implementation exists, some evidence bundle must make it
   * PASS. One bundle in which everything went right proves all of them at once,
   * and would have failed the day ACCOUNT was written.
   *
   * WONDER WEB OUTPUT is the exception and stays NOT BUILT, because no module
   * exists to probe. That is the honest shape of "one capability is absent" —
   * and if someone builds it, this test starts demanding a passing bundle for
   * it too.
   */
  it('every capability that is built can be reached: one good run passes all fourteen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beta-gate-ideal-'));
    const bundle = join(dir, 'julius-live-evidence');
    mkdirSync(bundle);
    const write = (name: string, text: string) => writeFileSync(join(bundle, name), text);

    write('runs.tsv', tsv(['run_id', 'mission_id', 'state', 'card_revision'], [[RUN, 'mission:julius-live-2', 'COMPLETED', 'card:julius-live:1']]));
    write('tasks.tsv', tsv(['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id'], [
      [`${RUN}:plan`, 'plan', 'PROMPT_ARCHITECT', 'SUCCEEDED', '0', ''],
      [`${RUN}:build`, 'build', 'CODING_AGENT', 'SUCCEEDED', '1', ''],
      [`repair:${RUN}:build:1:task`, 'repair:build', 'CODING_AGENT', 'SUCCEEDED', '2', `${RUN}:build`],
      [`${RUN}:build:review`, 'review:build', 'INDEPENDENT_REVIEWER', 'SUCCEEDED', '3', `${RUN}:build`],
    ]));
    write('failures.tsv', tsv(['task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'], [
      // A retryable failure that then succeeded — FAILURE RECOVERY.
      [`${RUN}:build:review`, 'INDEPENDENT_REVIEWER', 'julius.retry.scheduled', 'TIMEOUT', 'review_timeout', 'true', '', '', 't'],
      // A recovery sweep that requeued an expired lease — RESTART / RECOVERY.
      [`${RUN}:build`, 'CODING_AGENT', 'julius.recovery.action', '', '', '', '', 'REQUEUED', 't'],
    ]));
    write('decisions.tsv', tsv(['decision_id', 'task_id', 'action', 'reason_code'], [['decision:1', `${RUN}:build`, 'ACCEPT', 'ALL_CRITERIA_MET']]));
    write('findings.tsv', tsv(['finding_id', 'blocking', 'status', 'claim'], [['finding:1', 'f', 'RESOLVED', '[minor] naming']]));
    write('evidence.tsv', tsv(['evidence_id', 'evidence_type', 'status', 'safe_summary'], [
      [`${RUN}:plan:1:0`, 'ARTIFACT', 'PASSED', 'Validated architect plan stored for this run.'],
      [`${RUN}:build:1:0`, 'TEST', 'PASSED', 'node --test run-summary.test.js: exit 0.'],
      [`${RUN}:build:review:1:0`, 'REVIEW_FINDING', 'PASSED', 'Independent review approved the change.'],
    ]));
    write('tool-invocations.tsv', tsv(['invocation_id', 'tool_id', 'state', 'requested_at'], [[`${RUN}:build:base:g1`, 'shell.bash', 'SUCCEEDED', 't']]));
    write('worker-diagnostics.tsv', tsv(['task_id', 'role', 'stage', 'transport', 'permission_denials'], [[`${RUN}:build`, 'CODING_AGENT', 'build', 'hosted', '0']]));
    write('receipt-ids.txt', ['a'.repeat(64), 'b'.repeat(64)].join('\n'));
    write('live-mission.evidence.txt', `Run ${RUN} accepted in state READY; driving the Julius run loop.\nRESULT: COMPLETED after 9 ticks\n`);
    // A worker wrote back to the Project Brain, and a real account owns the run.
    write('project-brain.tsv', tsv(['entry_id', 'entry_kind', 'worker_id', 'task_id', 'revision', 'created_at'], [
      ['brain-1', 'CONSTRAINT', 'relay-bootstrap', '', '1', 't'],
      ['brain-2', 'DECISION', 'coding-agent-claude-hosted', `${RUN}:build`, '2', 't'],
    ]));
    write('sessions.tsv', tsv(['execution_id', 'mission_id', 'project_id', 'player_id', 'agent_id', 'state'], [
      ['exec-1', 'mission:julius-live-2', 'prj-julius-live-2', 'player:ada', 'agent:ada', 'RUNNING'],
    ]));
    // And the build ran under terms that were agreed before it started.
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '1', `${RUN}:build`, 'SUPERSEDED', `sha256:${'a'.repeat(64)}`, 't1', 'reviewer:hermes', 't0'],
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    // And the build and its review were CLAIMED under that lock — the same
    // revision and digest — which the lock table alone cannot say.
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.contract.locked', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'b'.repeat(64)}`, '', '', '', '', '', 't2'],
      [`${RUN}:build`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'b'.repeat(64)}`, '', '', '', '', 'CODING_AGENT', 't3'],
      [`${RUN}:build:review`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'b'.repeat(64)}`, '', '', '', '', 'INDEPENDENT_REVIEWER', 't4'],
    ]));

    const report = evaluate(dir);
    const notPassing = report.results.filter((row) => row.verdict !== 'PASS');
    expect(notPassing.map((row) => `${row.id}: ${row.verdict} — ${row.basis}`),
      'every built capability must have SOME evidence that reaches PASS; a row that cannot is a constant, not a probe')
      .toEqual([`WONDER WEB OUTPUT: NOT BUILT — ${report.results.find((row) => row.id === 'WONDER WEB OUTPUT')!.basis}`]);
    expect(report.gaps.map((row) => row.id), 'and the only gap left is the one nobody has built')
      .toEqual(['WONDER WEB OUTPUT']);
  });

  /**
   * LOCKED IS NOT RUN UNDER. The two bundles below carry a contract locked
   * before the build and would have passed the row on the lock table alone;
   * each is exactly the run the stale-handoff and reviewer-binding guards
   * exist to refuse, and the gate must read them as the guards would.
   */
  it('a build claimed under an older revision than the lock turns TASK CONTRACT LOCK to FAIL', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '1', `sha256:${'a'.repeat(64)}`, '', '', '', '', 'CODING_AGENT', 't3'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('claimed under revision 1 while revision 2 is the lock');
  });

  it('a binding refusal on the build turns TASK CONTRACT LOCK to FAIL even though the lock looks perfect', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '1', `sha256:${'a'.repeat(64)}`, '', '', '', '', 'CODING_AGENT', 't3'],
      [`${RUN}:build`, 'julius.contract.refused', 'binding_stale', `${RUN}:build`, `contract:${RUN}:build`, '', '', '1', '2', '', '', 'CODING_AGENT', 't4'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('binding_stale');
  });

  it('a contract-events dump with NO claim row for the build turns TASK CONTRACT LOCK to FAIL — absence is not agreement', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.contract.locked', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'b'.repeat(64)}`, '', '', '', '', '', 't2'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain('carries no recorded contract binding on its claim');
  });

  it('a review claimed under a different revision than the build turns TASK CONTRACT LOCK to FAIL, naming the review', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'b'.repeat(64)}`, '', '', '', '', 'CODING_AGENT', 't3'],
      [`${RUN}:build:review`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '3', `sha256:${'c'.repeat(64)}`, '', '', '', '', 'INDEPENDENT_REVIEWER', 't4'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain(`review ${RUN}:build:review was claimed under revision 3 while revision 2 is the lock`);
  });

  it('a build claimed under the right revision but a different digest turns TASK CONTRACT LOCK to FAIL — two records agreeing on a number is not agreement', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '2', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    write('contract-events.tsv', contractEvents([
      [`${RUN}:build`, 'julius.task.claimed', '', `${RUN}:build`, `contract:${RUN}:build`, '2', `sha256:${'a'.repeat(64)}`, '', '', '', '', 'CODING_AGENT', 't3'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('FAIL');
    expect(row.basis).toContain(`build ${RUN}:build was claimed under a digest that is not the lock's`);
  });

  it('a bundle without the contract-events dump keeps the weaker proof and says so', () => {
    const dir = completingBundle();
    const write = (name: string, text: string) => writeFileSync(join(dir, 'julius-live-evidence', name), text);
    write('task-contracts.tsv', tsv(['contract_id', 'contract_revision', 'task_id', 'state', 'binding_digest', 'locked_at', 'locked_by_evaluator_id', 'created_at'], [
      [`contract:${RUN}:build`, '1', `${RUN}:build`, 'LOCKED', `sha256:${'b'.repeat(64)}`, 't2', 'reviewer:hermes', 't1'],
    ]));
    const row = evaluate(dir).results.find((value) => value.id === 'TASK CONTRACT LOCK')!;
    expect(row.verdict).toBe('PASS');
    expect(row.basis).toContain('not measurable');
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
