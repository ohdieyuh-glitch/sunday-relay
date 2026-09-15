import { sealJuliusPaidRunArchiveExport, type JuliusPaidRunArchiveExport, type JuliusPaidRunArchiveExportBody } from './julius-brain-archive-import';

/**
 * A PAID-RUN ARCHIVE EXPORT FOR TESTS, shaped after the Live Evaluation Lab's
 * real paid run 34739303313 (julius-live-mission-4 A/B control on accepted main
 * 0845c593): the architect and reviewer reported no cost, the coder's provider
 * reported $0.369044 and its SDK stopped at the $0.30 ESTIMATE_NO_LEDGER
 * allocation, and the run failed after three ticks. A finding, a repair and a
 * research request are added so every section of the contract is exercised.
 * Not a production module: nothing composes it.
 */
export function paidRunArchiveBody(overrides: { attempt?: number; mutate?: (body: JuliusPaidRunArchiveExportBody) => JuliusPaidRunArchiveExportBody } = {}): JuliusPaidRunArchiveExportBody {
  const attempt = overrides.attempt ?? 1;
  const at = (minute: number, second = 0) => `2026-09-13T05:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
  const body: JuliusPaidRunArchiveExportBody = {
    format: 'julius-paid-run-archive-export.v1',
    exportedAt: '2026-09-15T09:00:00.000Z',
    archive: { archiveId: 'julius-postgres/paid-run-archive', archiveSchemaVersion: 'temporary-archive.draft-1' },
    run: {
      workflowRunId: '34739303313', workflowRunAttempt: attempt, acceptedMainSha: '0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91',
      missionId: 'mission:julius-live-4', campaignId: 'lab-eval-a', juliusRunId: 'run:julius-live-4', projectId: 'prj-julius-live-4',
      stateMode: 'FRESH', classification: 'LAB_EVAL', startedAt: at(4, 12), endedAt: at(7, 48), outcome: 'FAILED',
      outcomeReason: 'coder_cost_exceeded after 3 ticks',
    },
    tasks: [
      { taskId: 'plan-1', taskType: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED', ordinal: 0, parentTaskId: null },
      { taskId: 'plan-1:review', taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED', ordinal: 1, parentTaskId: 'plan-1' },
      { taskId: 'build-1', taskType: 'build', role: 'CODING_AGENT', state: 'FAILED', ordinal: 2, parentTaskId: null },
      { taskId: 'build-1:repair:1', taskType: 'repair:build', role: 'CODING_AGENT', state: 'CANCELLED', ordinal: 3, parentTaskId: 'build-1' },
    ],
    evidence: [
      { evidenceId: 'ev-plan', taskId: 'plan-1', evidenceType: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan validated against the task contract.', occurredAt: at(5, 1), artifactRef: 'art-plan', integrityHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' },
      { evidenceId: 'ev-review', taskId: 'plan-1:review', evidenceType: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Approved, 0 findings.', occurredAt: at(5, 40), artifactRef: null, integrityHash: null },
      { evidenceId: 'ev-build', taskId: 'build-1', evidenceType: 'TEST', status: 'FAILED', safeSummary: 'The stub test still fails: the build stopped at its budget.', occurredAt: at(7, 30), artifactRef: null, integrityHash: null },
    ],
    reviews: [
      { reviewId: 'dec-plan', taskId: 'plan-1', action: 'ACCEPT', reasonCode: 'TASK_VERIFIED', safeSummary: 'The plan is reviewed and accepted.', evidenceIds: ['ev-plan', 'ev-review'], occurredAt: at(5, 45) },
      { reviewId: 'dec-build', taskId: 'build-1', action: 'REPAIR', reasonCode: 'BLOCKING_FINDINGS', safeSummary: null, evidenceIds: ['ev-build'], occurredAt: at(7, 35) },
    ],
    findings: [
      { findingId: 'f-budget', taskId: 'build-1', severity: null, blocking: true, status: 'OPEN', claim: 'The coder was granted the ESTIMATE_NO_LEDGER allocation and stopped before implementing.', evidenceIds: ['ev-build'], occurredAt: at(7, 34) },
    ],
    repairs: [
      { repairId: 'repair:build-1:1', originalTaskId: 'build-1', repairTaskId: 'build-1:repair:1', round: 1, findingIds: ['f-budget'], state: 'CANCELLED', occurredAt: at(7, 40) },
    ],
    research: [
      { requestKey: 'plan-1:1:0', taskId: 'plan-1', role: 'PROMPT_ARCHITECT', outcome: 'observed', reference: 'https://docs.example.org/budgets', purpose: 'How does the allocation ledger settle a hosted dispatch?', evidenceId: null, occurredAt: at(4, 40) },
    ],
    usage: [
      { componentId: 'usage-architect', taskId: 'plan-1', role: 'PROMPT_ARCHITECT', provider: 'openai', model: 'gpt-5.6-sol', inputTokens: 2627, outputTokens: 4175, usdMicros: null, costBasis: 'UNKNOWN', estimatedUsdMicros: null, occurredAt: at(5, 0) },
      { componentId: 'usage-reviewer', taskId: 'plan-1:review', role: 'INDEPENDENT_REVIEWER', provider: 'xai', model: 'grok-build-0.1', inputTokens: 33101, outputTokens: 17728, usdMicros: null, costBasis: 'UNKNOWN', estimatedUsdMicros: 41200, occurredAt: at(5, 38) },
      { componentId: 'usage-coder', taskId: 'build-1', role: 'CODING_AGENT', provider: 'anthropic', model: 'claude-fable-5', inputTokens: null, outputTokens: null, usdMicros: 369044, costBasis: 'PROVIDER_REPORTED', estimatedUsdMicros: null, occurredAt: at(7, 29) },
    ],
    events: [
      { sequence: 1, eventType: 'run.created', taskId: null, occurredAt: at(4, 12), facts: { state: 'CREATED' } },
      { sequence: 2, eventType: 'budget.allocated', taskId: 'build-1', occurredAt: at(6, 0), facts: { role: 'CODING_AGENT', allocatedUsdMicros: 300000, allocationBasis: 'ESTIMATE_NO_LEDGER', policy: 'julius-allocation.v3', nested: { ignored: true } } },
      { sequence: 3, eventType: 'provider.failure', taskId: 'build-1', occurredAt: at(7, 29), facts: { code: 'coder_cost_exceeded', failureClass: 'BUDGET', errorRetryable: false } },
      { sequence: 4, eventType: 'run.failed', taskId: null, occurredAt: at(7, 48), facts: { reasonCode: 'coder_cost_exceeded' } },
    ],
    toolInvocations: [
      { invocationId: 'inv-1', taskId: 'build-1', toolId: 'shell.bash', state: 'SUCCEEDED', requestedAt: at(7, 10), completedAt: at(7, 12) },
    ],
    artifacts: [
      { artifactId: 'art-plan', name: 'plan.json', contentType: 'application/json', byteSize: 1834, contentHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111', storageRef: null },
    ],
  };
  return overrides.mutate ? overrides.mutate(body) : body;
}

export function paidRunArchive(overrides: Parameters<typeof paidRunArchiveBody>[0] = {}): JuliusPaidRunArchiveExport {
  return sealJuliusPaidRunArchiveExport(paidRunArchiveBody(overrides));
}
