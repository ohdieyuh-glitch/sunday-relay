import { describe, expect, it } from 'vitest';

import { buildReviewPrompt } from '../hermes-reviewer';
import { coderContractBrief } from './live-workers';
import type { JuliusContractReviewCharge } from '../../src/relay/mission/julius/julius-task-contract';

/**
 * ONE DOCUMENT, TWO READERS.
 *
 * The coder is handed the locked contract as its charge and the reviewer is
 * handed the same charge to grade against. Each role renders it into its own
 * prompt, and two renderers of one document drift the first time a field is
 * added to the contract and only one of them learns about it — the coder
 * would then be held to a term it was never shown, or shown a term nobody
 * checks. This holds both renderings to every content field of the charge,
 * and the `satisfies` clause makes a new field on the type fail to compile
 * here until a distinctive value is added for it.
 */

type ContentField = Exclude<keyof JuliusContractReviewCharge, 'stage' | 'binding'>;

const DISTINCTIVE = {
  objective: 'OBJ-9f2c distinctive objective',
  responsibilityBoundary: 'BOUNDARY-4a1e only the slug module',
  stoppingCondition: 'STOP-77b3 when the suite passes',
  inScope: ['SCOPE-IN-c1d2 src/slug.ts'],
  outOfScope: ['SCOPE-OUT-e3f4 package.json'],
  permittedPaths: ['PATH-5566 src/slug.ts'],
  prohibitedActions: ['PROHIBIT-7788 no network'],
  blockingCriteria: ['[criterion-1] CRIT-99aa the slug is deterministic'],
  requiredEvidence: ['TEST'] as const,
  requiredChecks: ['CHECK-bbcc npm test -- src/slug.test.ts'],
  contractReviewCriteria: ['REVIEW-ddee does the diff satisfy criterion-1'],
  failureConditions: ['FAIL-ff00 the suite does not pass'],
} satisfies Record<ContentField, string | readonly string[]>;

const charge: JuliusContractReviewCharge = Object.freeze({
  stage: 'build',
  binding: { contractId: 'contract:run-1:build-1', taskId: 'build-1', contractRevision: 3, bindingDigest: `sha256:${'d'.repeat(64)}` },
  ...DISTINCTIVE,
});

const values = (): string[] => Object.values(DISTINCTIVE).flatMap((value) => (typeof value === 'string' ? [value] : [...value]));

describe('the coder and the reviewer are shown the same contract', () => {
  const coder = coderContractBrief(charge);
  const reviewer = buildReviewPrompt({
    contract: charge,
    missionId: 'msn-1', originalRequest: 'the request', handoffJson: '{}',
    baseRevision: 'abc', artifactDigest: 'sha256:0', changedFiles: ['src/slug.ts'], unifiedDiff: '--- a\n+++ b\n',
    changedFileContents: '', testCommand: 'npm test', testOutput: 'ok', relayEvidence: [],
  });

  it('every content field of the charge reaches the coder\'s brief', () => {
    for (const value of values()) expect(coder, value).toContain(value);
  });

  it('and every one of them reaches the reviewer\'s prompt', () => {
    for (const value of values()) expect(reviewer, value).toContain(value);
  });

  it('both name the same revision and digest, so a durable record of either shows which agreement was in play', () => {
    for (const text of [coder, reviewer]) {
      expect(text).toContain('contract:run-1:build-1 revision 3');
      expect(text).toContain(`sha256:${'d'.repeat(64)}`);
    }
  });

  it('the coder is told the reviewer will grade against exactly this', () => {
    expect(coder).toContain('the reviewer grades against exactly this');
    expect(coder).toContain('ROUND: build');
  });
});
