import { describe, expect, it } from 'vitest';
import {
  PRIOR_TEST_RUN_MAX_CHARACTERS, PRIOR_TEST_RUN_MAX_FAILURES, PRIOR_TEST_RUN_TAIL_CHARACTERS, coderPriorTestRunBrief, priorTestRunSectionFor,
} from './live-workers';

/**
 * THE BRIEF A REPAIRING CODER READS ABOUT THE RUN IT IS REPAIRING.
 *
 * The hosted coder has Read, Glob, Grep and Edit and no way to run the mission's
 * tests. The executor runs them after each round and the reviewer is handed the
 * output; a repair round used to be handed nothing but the reviewer's findings.
 * These cases hold the reduction to what a repair needs, and hold its bounds.
 */

const TAP = [
  'exit=1',
  'TAP version 13',
  '# Subtest: lineage',
  '    not ok 1 - round two sees round one’s finding',
  '      ---',
  '      duration_ms: 3.1',
  "      error: 'the finding round one was repairing'",
  '      expected: true',
  '      actual: false',
  "      code: 'ERR_ASSERTION'",
  '      stack: |-',
  '        at TestContext.<anonymous> (file:///ws/spec.test.ts:120:10)',
  '      ...',
  '    ok 2 - a lineage with one round',
  'not ok 1 - lineage',
  '  ---',
  "  error: '1 subtest failed'",
  '  ...',
  'ok 2 - pure helpers',
  '# tests 3',
  '# pass 1',
  '# fail 2',
].join('\n');

describe('the reduction', () => {
  it('keeps the exit status, the summary counts, and each failing test with its error, expected and actual lines', () => {
    const brief = coderPriorTestRunBrief(TAP)!;
    expect(brief.split('\n')[0]).toBe('--- PREVIOUS TEST RUN (the round you are repairing; exit=1) ---');
    for (const kept of ['# tests 3', '# pass 1', '# fail 2', 'not ok 1 - round two sees round one’s finding',
      "error: 'the finding round one was repairing'", 'expected: true', 'actual: false', "code: 'ERR_ASSERTION'", 'not ok 1 - lineage']) {
      expect(brief, kept).toContain(kept);
    }
    // What a repair does not need: timings, stack frames, passing tests.
    for (const dropped of ['duration_ms', 'TestContext.<anonymous>', 'ok 2 - pure helpers', 'ok 2 - a lineage with one round']) {
      expect(brief, dropped).not.toContain(dropped);
    }
  });

  it('quotes at most the stated number of failures and says how many it left out', () => {
    const many = ['exit=1', ...Array.from({ length: PRIOR_TEST_RUN_MAX_FAILURES + 5 }, (_, index) => `not ok ${index + 1} - case ${index + 1}\n  ---\n  error: 'boom ${index + 1}'\n  ...`), '# fail 25'].join('\n');
    const brief = coderPriorTestRunBrief(many)!;
    expect(brief).toContain(`not ok ${PRIOR_TEST_RUN_MAX_FAILURES} - case ${PRIOR_TEST_RUN_MAX_FAILURES}`);
    expect(brief).not.toContain(`not ok ${PRIOR_TEST_RUN_MAX_FAILURES + 1} - case`);
    expect(brief).toContain('… and 5 more failing test(s)');
  });

  it('keeps the tail of output that is not a test-runner report', () => {
    const output = `exit=2\n${'npm ERR! something unrelated\n'.repeat(400)}Error: Cannot find module './julius-learning-loop'`;
    const brief = coderPriorTestRunBrief(output)!;
    expect(brief).toContain('exit=2');
    expect(brief).toContain("Cannot find module './julius-learning-loop'");
    expect(brief.length).toBeLessThanOrEqual(PRIOR_TEST_RUN_TAIL_CHARACTERS + 200);
  });

  it('is bounded however pathological the output', () => {
    const huge = ['exit=1', ...Array.from({ length: 30 }, (_, index) => `not ok ${index + 1} - ${'x'.repeat(2_000)}\n  error: '${'y'.repeat(2_000)}'`)].join('\n');
    expect(coderPriorTestRunBrief(huge)!.length).toBeLessThanOrEqual(PRIOR_TEST_RUN_MAX_CHARACTERS);
  });

  it('says nothing when there was no previous run', () => {
    expect(coderPriorTestRunBrief(null)).toBeNull();
    expect(coderPriorTestRunBrief('   \n')).toBeNull();
  });

  it('reads an unknown exit status as unknown', () => {
    expect(coderPriorTestRunBrief('not ok 1 - x\n# fail 1')!.split('\n')[0]).toContain('exit=unknown');
  });
});

describe('which dispatch is shown it', () => {
  it('a repair round is, and a build, a continuation or an untyped dispatch is not — even with a previous run on record', () => {
    expect(priorTestRunSectionFor({ taskType: 'repair:build', testOutput: TAP })).toHaveLength(1);
    for (const taskType of ['build', 'build:segment', 'implementation', null]) {
      expect(priorTestRunSectionFor({ taskType, testOutput: TAP }), String(taskType)).toEqual([]);
    }
    expect(priorTestRunSectionFor({ taskType: 'repair:build', testOutput: null })).toEqual([]);
  });
});
