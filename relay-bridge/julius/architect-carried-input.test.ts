import { describe, expect, it } from 'vitest';

import { JULIUS_CONTEXT_COMPILER_VERSION, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import { juliusCarriedCopyId, renderJuliusCarriedFinding } from '../../src/relay/mission/julius/julius-claim-ledger';
import { architectWorker } from './live-composition';
import { createInMemoryArtifactExchange, createLiveArchitectAdapter } from './live-workers';

/**
 * THE LAST LINK OF R2 POINT 4 (founder ruling 2026-10-04): what Julius compiled into the planner's packet is
 * what the LIVE Prompt Architect sends its provider as planning input.
 *
 * The real-PostgreSQL rehearsal proves the carried finding is in the plan task's compiled packet; the live
 * architect then builds the provider's `input` from that packet. Proven here at the adapter boundary, with the
 * connector replaced (`run` is injectable for exactly this) so nothing is contacted and nothing is spent: the
 * carried block, rendered by the production renderer, reaches the provider input whole.
 */

const SCOPE = { taskId: 'run:new:plan', taskType: 'plan' as const, role: 'PROMPT_ARCHITECT' as const };
const CARRIED = renderJuliusCarriedFinding({
  sourceRunId: 'run:without', sourceRunState: 'COMPLETED',
  finding: {
    findingId: 'finding:evidence:7', taskId: 'run:without:plan', reviewerWorkerId: 'independent-reviewer-hermes', severity: 'HIGH',
    category: 'review', claim: 'ARCHITECT-INPUT-SENTINEL the plan deploys before the migration runs', criterionId: 'AC-1',
    evidenceIds: ['evidence:7'], blocking: true, createdAt: '2026-10-04T10:00:00.000Z',
  },
  life: { state: 'RESOLVED', lastMove: 'REVIEWER_RESOLVED', repairTaskIds: ['repair:run:without:plan:1:task'], resolutionReviewTaskId: 'review:repair:run:without:plan:1:task' },
  task: { taskType: 'plan', role: 'PROMPT_ARCHITECT' },
  scope: SCOPE,
});
const CARRIED_ID = juliusCarriedCopyId('run:new', 'run:without', 'finding:evidence:7');

function planSnapshot(): JuliusContextSnapshot {
  const blocks = [
    { kind: 'CONSTRAINT' as const, text: 'OBJECTIVE: Add the deploy step to the release script.' },
    { kind: 'FINDING' as const, text: CARRIED },
  ];
  return {
    contextId: 'ctx-carried-1', runId: 'run:new', taskId: SCOPE.taskId, workerId: 'prompt-architect-openai',
    workerRole: 'PROMPT_ARCHITECT', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card-carried-1', projectBrainRevision: 0,
    taskContractRevision: null, taskContractDigest: null,
    sourceEntryIds: ['run:new:objective', CARRIED_ID], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:carried-test',
    integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    characterCount: blocks.reduce((sum, block) => sum + block.text.length, 0), redactionCount: 0, truncated: false,
    packet: { missionId: 'mission-carried-1', taskId: SCOPE.taskId, workerId: 'prompt-architect-openai', sourceEntryIds: ['run:new:objective', CARRIED_ID], blocks, truncated: false },
  };
}

describe('the live Prompt Architect plans from the packet Julius compiled, carried knowledge included', () => {
  it('sends the provider every block of the plan packet, the carried finding whole and structured', async () => {
    const inputs: string[] = [];
    const adapter = createLiveArchitectAdapter({
      worker: architectWorker({}),
      contexts: { snapshotFor: () => planSnapshot() },
      artifacts: createInMemoryArtifactExchange(),
      config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never,
      apiKey: 'FAKETESTNOTREAL-openai',
      // A provider that refuses: the dispatch then fails, which is beside the point — what it was SENT is the point.
      run: (async (request: { readonly input: string }) => {
        inputs.push(request.input);
        return { ok: false, failureClass: 'refused', message: 'scripted refusal' };
      }) as never,
    });
    const failure = await adapter.dispatch({ taskId: SCOPE.taskId, attempt: { leaseGeneration: 1 }, contextId: 'ctx-carried-1', taskType: 'plan' })
      .then(() => null, (raised: unknown) => raised);
    expect(failure, 'the scripted refusal really ended the dispatch').not.toBeNull();
    expect(inputs.length, 'the provider was asked').toBeGreaterThan(0);
    expect(inputs[0], 'the carried block reached the planning input, every line of it').toContain(CARRIED);
    for (const line of ['SOURCE RUN: run:without (COMPLETED)', 'FINDING: finding:evidence:7 | severity HIGH | category review | criterion AC-1 | blocking',
      "REVIEWER'S CLAIM: ARCHITECT-INPUT-SENTINEL the plan deploys before the migration runs"]) {
      expect(inputs[0], line).toContain(line);
    }
    expect(inputs[0], 'beside the objective it plans for').toContain('OBJECTIVE: Add the deploy step to the release script.');
  });
});
