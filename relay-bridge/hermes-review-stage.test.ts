import { describe, expect, it } from 'vitest';

import { buildReviewPrompt, type ReviewPacket } from './hermes-reviewer';
import { reviewChargeFor } from '../src/relay/mission/julius';

/**
 * DEFECT 2 (paid run 34037313976): the plan review was handed the
 * implementation rubric and produced six blocking findings demanding a diff
 * and executed tests of a PLAN. The prompt now renders the stage's charge, and
 * these cases are adversarial about what each stage may and may not ask for.
 */

const base: ReviewPacket = {
  missionId: 'm1', originalRequest: 'Add a run summary.', handoffJson: '{"objective":"summary"}',
  acceptanceCriteria: ['AC-1 prints a summary'], baseRevision: 'rev1', artifactDigest: 'dig1',
  changedFiles: [], unifiedDiff: '', changedFileContents: '', testCommand: 'node --test', testOutput: '',
  relayEvidence: [],
};

describe('a PLAN review', () => {
  const prompt = buildReviewPrompt({ ...base, stage: 'plan', charge: reviewChargeFor('plan') });

  it('says it is a plan review of a plan that has no implementation yet, by design', () => {
    expect(prompt).toContain('THIS IS A PLAN REVIEW');
    expect(prompt).toMatch(/No implementation exists yet, by design/);
    expect(prompt).toContain('THE PLAN UNDER REVIEW');
  });

  it('forbids demanding the implementation artifacts', () => {
    for (const absent of ['completed edits', 'a unified diff', 'changed file contents', 'executed test output']) {
      expect(prompt).toContain(absent);
    }
    expect(prompt).toMatch(/Do NOT demand, and do NOT penalise the absence of/);
  });

  it('carries no diff, file-content or test-output sections at all', () => {
    for (const section of ['UNIFIED DIFF:', 'RESULTING FILE CONTENT:', 'DETERMINISTIC TEST COMMAND:', 'TEST OUTPUT:', 'CHANGED FILES:']) {
      expect(prompt, section).not.toContain(section);
    }
  });

  it('asks the plan questions, and none of the implementation ones', () => {
    expect(prompt).toContain('verification strategy');
    expect(prompt).toContain('handoff');
    expect(prompt).not.toMatch(/as shown by the diff/);
    // The independence and read-only rules are unchanged.
    expect(prompt).toMatch(/no write access/i);
    expect(prompt).toMatch(/judge the plan yourself/i);
  });
});

describe('a BUILD review', () => {
  const packet: ReviewPacket = {
    ...base, stage: 'build', charge: reviewChargeFor('build'),
    changedFiles: ['src/run-summary.js'], unifiedDiff: '--- a\n+++ b/src/run-summary.js', testOutput: 'ok',
  };
  const prompt = buildReviewPrompt(packet);

  it('judges the implementation and shows the diff and tests', () => {
    expect(prompt).toContain('THIS IS A BUILD REVIEW of an implementation');
    expect(prompt).toContain('UNIFIED DIFF:');
    expect(prompt).toContain('TEST OUTPUT:');
    expect(prompt).toContain('src/run-summary.js');
    expect(prompt).toMatch(/as shown by the diff/);
    expect(prompt).not.toContain('THIS IS A PLAN REVIEW');
  });

  it('reads identically for a legacy caller that sets no stage', () => {
    const legacy = buildReviewPrompt({ ...packet, stage: undefined, charge: undefined });
    expect(legacy).toContain('UNIFIED DIFF:');
    expect(legacy).toMatch(/judge the artifact yourself/i);
    expect(legacy).toContain('RUBRIC: (1) Does the implementation satisfy every acceptance criterion?');
  });
});

describe('a REPAIR review', () => {
  it('lists every prior finding and asks whether each is resolved', () => {
    const prompt = buildReviewPrompt({
      ...base, stage: 'repair:plan', charge: reviewChargeFor('repair:plan'),
      priorFindings: ['REVIEW FINDING f-1 [HIGH]: no verification strategy', 'REVIEW FINDING f-2 [HIGH]: scope unbounded'],
    });
    expect(prompt).toContain('THIS IS A REPAIR:PLAN REVIEW');
    expect(prompt).toContain('PRIOR BLOCKING FINDINGS (this review must judge whether each is resolved)');
    expect(prompt).toContain('- REVIEW FINDING f-1 [HIGH]: no verification strategy');
    expect(prompt).toContain('- REVIEW FINDING f-2 [HIGH]: scope unbounded');
    expect(prompt).toMatch(/Is every prior blocking finding resolved/);
    expect(prompt, 'a plan repair is still a plan review').not.toContain('UNIFIED DIFF:');
  });

  it('says so plainly when the round was admitted by failed evidence and has no findings', () => {
    // Julius admits a repair on the subject's own FAILED evidence too, and
    // such a round carries none. The reviewer is told that, not left to read
    // an empty list as "nothing was wrong".
    const prompt = buildReviewPrompt({
      ...base, stage: 'repair:build', charge: reviewChargeFor('repair:build'),
      unifiedDiff: '--- a\n+++ b/x.js', testOutput: 'ok',
    });
    expect(prompt).toContain('none recorded: this repair was admitted by failed evidence');
    expect(prompt).toMatch(/judge the repaired work and its evidence/);
  });

  it('a repair build review keeps the diff and adds the findings', () => {
    const prompt = buildReviewPrompt({
      ...base, stage: 'repair:build', charge: reviewChargeFor('repair:build'),
      unifiedDiff: '--- a\n+++ b/x.js', testOutput: 'ok', priorFindings: ['REVIEW FINDING f-9 [HIGH]: untested branch'],
    });
    expect(prompt).toContain('UNIFIED DIFF:');
    expect(prompt).toContain('- REVIEW FINDING f-9 [HIGH]: untested branch');
    expect(prompt).toMatch(/Is every prior blocking finding resolved/);
  });
});
