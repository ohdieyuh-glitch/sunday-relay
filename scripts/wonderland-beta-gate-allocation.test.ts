import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluate } from './wonderland-beta-gate.mjs';

/**
 * A RUN FUNDED AT A PLACEHOLDER IS NOT FULL-CAPABILITY EVIDENCE.
 *
 * The beta-readiness rule: a paid run is invalid as full-capability evidence
 * when its allocation fell back to the fixed estimate. Lab run 34739303313 is
 * that run — all three dispatches allocated 300,000 micro-dollars under
 * `ESTIMATE_NO_LEDGER` on a twenty-dollar mission, and the gate reported eight
 * of its rows as proven by it.
 *
 * What these cases hold the gate to:
 *   - one estimate-funded allocation sets aside every row the run EXERCISED;
 *   - a FAILED row stays FAILED, so nothing a drill proves can rescue it;
 *   - a run allocated against the ledger reads exactly as it did before;
 *   - a bundle that cannot say how it was funded says so and loses nothing;
 *   - a run under an earlier rule is named as such, not called ledger-backed.
 *
 * The bundle shape is the one `julius-live-evidence-dump.sh` writes, with the
 * budget dump's real header.
 */

const RUN = 'run:c8910d0afb5608e0ea68aa72';
const BUDGET_HEADER = [
  'run_id', 'sequence', 'task_id', 'event_type', 'role', 'allocated_usd_micros', 'allocation_basis',
  'share_usd_micros', 'remaining_usd_micros', 'allocation_policy', 'settled_usd_micros', 'cost_basis',
  'estimated_usd_micros', 'reason', 'slot_refusal', 'reservation_id', 'occurred_at',
];

const tsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header.join('\t'), ...rows.map((row) => row.join('\t')), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n');

const allocated = (sequence: number, role: string, usdMicros: number, basis: string, policy: string): string[] => [
  RUN, String(sequence), `${RUN}:${role === 'PROMPT_ARCHITECT' ? 'plan' : role === 'CODING_AGENT' ? 'build' : 'plan:review'}`,
  'julius.budget.allocated', role, String(usdMicros), basis, '', '20000000', policy, '', '', '', '', '', '', '2026-09-13 05:04:13+00',
];

/**
 * Lab run 34739303313's shape: a plan that succeeded and was reviewed, a build
 * that failed, and whatever budget dump the case supplies.
 */
function bundle(budget: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'beta-gate-allocation-'));
  const root = join(dir, 'julius-live-evidence');
  mkdirSync(root);
  const write = (name: string, text: string) => writeFileSync(join(root, name), text);
  write('runs.tsv', tsv(['run_id', 'mission_id', 'state', 'card_revision'], [[RUN, 'mission:julius-live-4', 'FAILED', 'card:julius-live:1']]));
  write('tasks.tsv', tsv(['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id'], [
    [`${RUN}:plan`, 'plan', 'PROMPT_ARCHITECT', 'SUCCEEDED', '0', ''],
    [`${RUN}:plan:review`, 'review:plan', 'INDEPENDENT_REVIEWER', 'SUCCEEDED', '1', `${RUN}:plan`],
    [`${RUN}:build`, 'build', 'CODING_AGENT', 'FAILED', '1', ''],
  ]));
  write('failures.tsv', tsv(['task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'], [
    [`${RUN}:build`, 'CODING_AGENT', 'julius.task.failed', 'WORKER_EXECUTION_FAILURE', 'coder_cost_exceeded', 'false', '', '', 't'],
  ]));
  write('evidence.tsv', tsv(['evidence_id', 'evidence_type', 'status', 'safe_summary'], [
    [`${RUN}:plan:1:0`, 'ARTIFACT', 'PASSED', 'Validated architect plan stored for this run.'],
  ]));
  write('live-mission.evidence.txt', `# evidence\n\nRun ${RUN} accepted in state READY; driving the Julius run loop.\nRESULT: FAILED after 9 ticks\n`);
  if (budget !== null) write('budget.tsv', budget);
  return dir;
}

const ESTIMATE_FUNDED = tsv(BUDGET_HEADER, [
  allocated(8, 'PROMPT_ARCHITECT', 300_000, 'ESTIMATE_NO_LEDGER', 'julius-allocation.v3'),
  allocated(21, 'INDEPENDENT_REVIEWER', 300_000, 'ESTIMATE_NO_LEDGER', 'julius-allocation.v3'),
  allocated(34, 'CODING_AGENT', 300_000, 'ESTIMATE_NO_LEDGER', 'julius-allocation.v3'),
]);
const LEDGER_FUNDED = tsv(BUDGET_HEADER, [
  allocated(8, 'PROMPT_ARCHITECT', 9_000_000, 'SHARED_POOL', 'julius-allocation.v3'),
  allocated(21, 'INDEPENDENT_REVIEWER', 8_700_000, 'SHARED_POOL', 'julius-allocation.v3'),
  allocated(34, 'CODING_AGENT', 8_400_000, 'SHARED_POOL', 'julius-allocation.v3'),
]);

const byId = (report: ReturnType<typeof evaluate>) => new Map(report.results.map((row) => [row.id, row]));

describe('a run funded at the estimate', () => {
  it('is reported as ESTIMATE_NO_LEDGER, with the count and the roles', () => {
    const report = evaluate(bundle(ESTIMATE_FUNDED));
    expect(report.allocation.state).toBe('ESTIMATE_NO_LEDGER');
    expect(report.allocation.estimated).toBe(3);
    expect(report.allocation.allocations).toBe(3);
    expect(report.allocation.basis).toContain('3 of 3');
    expect(report.allocation.basis).toContain('CODING_AGENT');
  });

  it('sets aside every row it exercised, and none of them can pass', () => {
    const ledger = byId(evaluate(bundle(LEDGER_FUNDED)));
    const estimate = byId(evaluate(bundle(ESTIMATE_FUNDED)));
    const exercisedUnderLedger = [...ledger.values()].filter((row) => row.mission === 'EXERCISED');
    expect(exercisedUnderLedger.length, 'the same run under a ledger proves something').toBeGreaterThan(0);
    for (const row of exercisedUnderLedger) {
      const same = estimate.get(row.id)!;
      expect(same.mission, row.id).toBe('INADMISSIBLE');
      expect(same.verdict, row.id).not.toBe('PASS');
      expect(same.basis, row.id).toContain('inadmissible as full-capability evidence');
    }
  });

  it('never turns a failure into something a drill could rescue', () => {
    const estimate = byId(evaluate(bundle(ESTIMATE_FUNDED)));
    const coder = estimate.get('CODING AGENT')!;
    expect(coder.mission).toBe('FAILED');
    expect(coder.verdict).toBe('FAIL');
  });

  it('counts what it set aside, and says the run is invalid on the command line', () => {
    const dir = bundle(ESTIMATE_FUNDED);
    const report = evaluate(dir);
    expect(report.summary.inadmissible).toBe([...byId(report).values()].filter((row) => row.mission === 'INADMISSIBLE').length);
    expect(report.summary.exercised).toBe(0);
    const cli = spawnSync(process.execPath, [join('scripts', 'wonderland-beta-gate.mjs'), '--evidence', dir], { encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain('allocation: ESTIMATE_NO_LEDGER');
    expect(cli.stdout).toContain('RUN VALIDITY:               INVALID AS FULL-CAPABILITY EVIDENCE');
    expect(cli.stdout).toContain('BETA: NOT READY');
  });

  it('is invalid even when only one allocation of many fell back', () => {
    const mixed = tsv(BUDGET_HEADER, [
      allocated(8, 'PROMPT_ARCHITECT', 9_000_000, 'SHARED_POOL', 'julius-allocation.v3'),
      allocated(34, 'CODING_AGENT', 300_000, 'ESTIMATE_NO_LEDGER', 'julius-allocation.v3'),
    ]);
    const report = evaluate(bundle(mixed));
    expect(report.allocation.state).toBe('ESTIMATE_NO_LEDGER');
    expect(report.allocation.basis).toContain('1 of 2');
    expect(report.summary.exercised).toBe(0);
  });
});

describe('a run funded against its ledger', () => {
  it('reads exactly as it did before the rule, and says how it was funded', () => {
    const withLedger = evaluate(bundle(LEDGER_FUNDED));
    const withoutDump = evaluate(bundle(null));
    expect(withLedger.allocation.state).toBe('LEDGER');
    expect(withLedger.summary.inadmissible).toBe(0);
    expect(withLedger.results.map((row) => [row.id, row.verdict, row.mission]))
      .toEqual(withoutDump.results.map((row) => [row.id, row.verdict, row.mission]));
  });
});

describe('the other things a budget dump can say', () => {
  it('a bundle with no readable dump says it cannot tell, and sets nothing aside', () => {
    for (const budget of [null, 'unavailable\n']) {
      const report = evaluate(bundle(budget));
      expect(report.allocation.state).toBe('UNKNOWN');
      expect(report.summary.inadmissible).toBe(0);
      expect(report.summary.exercised).toBeGreaterThan(0);
    }
  });

  it('a dispatch refused for want of a ledger is named, and nothing was funded blind', () => {
    const report = evaluate(bundle(tsv(BUDGET_HEADER, [
      allocated(8, 'PROMPT_ARCHITECT', 0, 'NO_LEDGER_DENIED', 'julius-allocation.v3'),
    ])));
    expect(report.allocation.state).toBe('NO_LEDGER_DENIED');
    expect(report.allocation.denied).toBe(1);
    expect(report.summary.inadmissible).toBe(0);
  });

  it('a run under an earlier rule is named as one, never called ledger-backed', () => {
    const report = evaluate(bundle(tsv(BUDGET_HEADER, [
      allocated(8, 'PROMPT_ARCHITECT', 300_000, 'ESTIMATE', 'julius-allocation.v1'),
      allocated(34, 'CODING_AGENT', 7_500_000, 'CODER_SHARE', 'julius-allocation.v1'),
    ])));
    expect(report.allocation.state).toBe('EARLIER_RULE');
    expect(report.allocation.basis).toContain('julius-allocation.v1');
    expect(report.summary.inadmissible).toBe(0);
  });

  it('a v3 basis the gate does not know is named rather than trusted', () => {
    const report = evaluate(bundle(tsv(BUDGET_HEADER, [
      allocated(8, 'PROMPT_ARCHITECT', 1_000, 'SOMETHING_NEW', 'julius-allocation.v3'),
    ])));
    expect(report.allocation.state).toBe('UNRECOGNISED');
    expect(report.allocation.basis).toContain('SOMETHING_NEW');
  });

  it('no bundle at all is no evidence, not a valid run', () => {
    expect(evaluate(null).allocation.state).toBe('NO_EVIDENCE');
  });
});
