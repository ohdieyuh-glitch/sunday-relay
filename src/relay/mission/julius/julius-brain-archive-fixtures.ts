import { createHash } from 'node:crypto';

import { sealJuliusPaidRunArchiveExport, type JuliusPaidRunArchiveExport, type JuliusPaidRunArchiveExportBody } from './julius-brain-archive-import';

/**
 * A PAID-RUN ARCHIVE EXPORT FOR TESTS, shaped after the Live Evaluation Lab's
 * real paid run 34739303313 (julius-live-mission-4 A/B control on accepted main
 * 0845c593): the architect and reviewer reported no cost, the coder's provider
 * reported $0.369044 and its SDK stopped at the $0.30 ESTIMATE_NO_LEDGER
 * allocation, and the run failed after three ticks.
 *
 * THE GAPS ARE THE REAL ARCHIVE'S. Formal's `julius-paid-run-archive.v1` (as
 * inspected 2026-09-15) records findings with no time, task, severity or
 * evidence links, evidence with no task, tool calls with no completion, a
 * trajectory event with no sequence, and usage with no provider, model or
 * tokens for some components — so this fixture does too, listed in `unknown`,
 * never filled in. It also carries what the archive does have: tool evidence
 * (`COMMAND_EXECUTION`), a refused research request with its reason, and the
 * v1 Brain entries whose decision entries duplicate the reviews.
 * Not a production module: nothing composes it.
 */

/** Bytes an archive holds for `art-plan`; the fixture's recorded digest is theirs. */
export const PAID_RUN_ARTIFACT_BYTES: ReadonlyMap<string, Uint8Array> = new Map([
  ['art-plan', new TextEncoder().encode('{"plan":"implement the trust core admission checks","steps":3}')],
]);
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function paidRunArchiveBody(overrides: { attempt?: number; mutate?: (body: JuliusPaidRunArchiveExportBody) => JuliusPaidRunArchiveExportBody } = {}): JuliusPaidRunArchiveExportBody {
  const attempt = overrides.attempt ?? 1;
  const at = (minute: number, second = 0) => `2026-09-13T05:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
  const planBytes = PAID_RUN_ARTIFACT_BYTES.get('art-plan')!;
  const body: JuliusPaidRunArchiveExportBody = {
    format: 'julius-paid-run-archive-export.v1',
    exportedAt: '2026-09-15T09:00:00.000Z',
    source: { archiveId: 'julius-postgres/julius_archive', archiveSchemaVersion: 'julius-paid-run-archive.v1', exporterVersion: 'fixture.1' },
    identity: {
      workflowRunId: '34739303313', workflowRunAttempt: attempt, repository: 'ohdieyuh-glitch/sunday-relay',
      juliusRunId: 'run:julius-live-4', missionId: 'mission:julius-live-4', missionLabel: 'julius-live-mission-4', campaignId: 'lab-eval-a',
      projectId: 'prj-julius-live-4', classification: 'LAB_EVAL', acceptedMainSha: '0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91',
      stateMode: 'FRESH', stateModeBasis: 'GitHub-hosted job with a freshly migrated disposable PostgreSQL',
      outcome: 'FAILED', outcomeReason: 'coder_cost_exceeded after 3 ticks', startedAt: at(4, 12), endedAt: at(7, 48), unknown: [],
    },
    // What cost-accounting.tsv claims; checked against the usage items below.
    accounting: { knownUsdMicros: 369044, estimatedUsdMicros: 41200, unknownComponents: 2, components: 3, unknown: [] },
    tasks: [
      { taskId: 'plan-1', taskType: 'plan', role: 'PROMPT_ARCHITECT', workerId: null, state: 'SUCCEEDED', ordinal: 0, parentTaskId: null, dependencyIds: [], unknown: ['workerId'] },
      { taskId: 'plan-1:review', taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', workerId: null, state: 'SUCCEEDED', ordinal: 1, parentTaskId: 'plan-1', dependencyIds: null, unknown: ['dependencyIds', 'workerId'] },
      { taskId: 'build-1', taskType: 'build', role: 'CODING_AGENT', workerId: null, state: 'FAILED', ordinal: 2, parentTaskId: null, dependencyIds: ['plan-1'], unknown: ['workerId'] },
      { taskId: 'build-1:repair:1', taskType: 'repair:build', role: 'CODING_AGENT', workerId: null, state: 'CANCELLED', ordinal: 3, parentTaskId: 'build-1', dependencyIds: null, unknown: ['dependencyIds', 'workerId'] },
    ],
    research: [
      {
        requestKey: 'plan-1:1:0', attemptKey: 'plan-1:1:0:a1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskId: 'plan-1', host: 'docs.example.org', path: '/budgets',
        bytes: 18342, digest: `sha256:${'2'.repeat(64)}`, deliveryRange: { start: 0, end: 18341 }, handoffRef: null, disposition: 'SERVED', refusalReason: null,
        purpose: 'How does the allocation ledger settle a hosted dispatch?', evidenceId: null, occurredAt: at(4, 40), unknown: ['evidenceId', 'handoffRef'],
      },
      {
        requestKey: 'build-1:1:0', attemptKey: null, ordinal: 1, role: 'CODING_AGENT', taskId: 'build-1', host: 'registry.example.org', path: null,
        bytes: null, digest: null, deliveryRange: null, handoffRef: null, disposition: 'REFUSED', refusalReason: 'host_not_allowlisted',
        purpose: null, evidenceId: null, occurredAt: at(6, 30), unknown: ['attemptKey', 'evidenceId', 'handoffRef', 'path', 'purpose'],
      },
    ],
    evidence: [
      { evidenceId: 'ev-plan', taskId: 'plan-1', evidenceType: 'ARTIFACT', status: 'PASSED', sourceVerification: null, safeSummary: 'Plan validated against the task contract.', artifactRefs: ['art-plan'], integrityHash: sha256(planBytes), occurredAt: at(5, 1), unknown: ['sourceVerification'] },
      { evidenceId: 'ev-review', taskId: 'plan-1:review', evidenceType: 'REVIEW_FINDING', status: 'PASSED', sourceVerification: 'VERIFIED', safeSummary: 'Approved, 0 findings.', artifactRefs: [], integrityHash: null, occurredAt: at(5, 40), unknown: ['integrityHash'] },
      { evidenceId: 'ev-build', taskId: 'build-1', evidenceType: 'TEST', status: 'FAILED', sourceVerification: null, safeSummary: 'The stub test still fails: the build stopped at its budget.', artifactRefs: [], integrityHash: null, occurredAt: at(7, 30), unknown: ['integrityHash', 'sourceVerification'] },
      { evidenceId: 'ev-cmd', taskId: null, evidenceType: 'COMMAND_EXECUTION', status: 'FAILED', sourceVerification: null, safeSummary: 'npm test exited 1 before the budget stop.', artifactRefs: null, integrityHash: null, occurredAt: at(7, 12), unknown: ['artifactRefs', 'integrityHash', 'sourceVerification', 'taskId'] },
    ],
    findings: [
      { findingId: 'f-budget', taskId: null, severity: null, blocking: true, status: 'OPEN', claim: 'The coder was granted the ESTIMATE_NO_LEDGER allocation and stopped before implementing.', rationale: null, evidenceIds: null, occurredAt: null, unknown: ['evidenceIds', 'occurredAt', 'rationale', 'severity', 'taskId'] },
    ],
    reviews: [
      { reviewId: 'dec-plan', reviewer: 'INDEPENDENT_REVIEWER', verdict: 'ACCEPT', targetTaskId: 'plan-1', reasonCode: 'TASK_VERIFIED', rationale: 'The plan is reviewed and accepted.', evidenceIds: ['ev-plan', 'ev-review'], sourceRef: 'decisions.tsv/dec-plan', occurredAt: at(5, 45), unknown: [] },
      { reviewId: 'dec-build', reviewer: null, verdict: 'REPAIR', targetTaskId: 'build-1', reasonCode: 'BLOCKING_FINDINGS', rationale: null, evidenceIds: ['ev-build'], sourceRef: 'decisions.tsv/dec-build', occurredAt: at(7, 35), unknown: ['rationale', 'reviewer'] },
    ],
    repairs: [
      { repairId: 'repair:build-1:1', round: 1, targetTaskId: 'build-1', repairTaskId: 'build-1:repair:1', reason: null, outcome: 'CANCELLED', findingIds: ['f-budget'], occurredAt: null, unknown: ['occurredAt', 'reason'] },
    ],
    usage: [
      { componentId: 'usage-architect', taskId: 'plan-1', role: 'PROMPT_ARCHITECT', provider: 'openai', model: 'gpt-5.6-sol', requests: 1, inputTokens: 2627, outputTokens: 4175, usdMicros: null, costBasis: 'UNKNOWN', estimatedUsdMicros: null, occurredAt: at(5, 0), unknown: ['estimatedUsdMicros', 'usdMicros'] },
      { componentId: 'usage-reviewer', taskId: 'plan-1:review', role: 'INDEPENDENT_REVIEWER', provider: 'xai', model: 'grok-build-0.1', requests: null, inputTokens: 33101, outputTokens: 17728, usdMicros: null, costBasis: 'UNKNOWN', estimatedUsdMicros: 41200, occurredAt: at(5, 38), unknown: ['requests', 'usdMicros'] },
      { componentId: 'usage-coder', taskId: 'build-1', role: 'CODING_AGENT', provider: null, model: null, requests: null, inputTokens: null, outputTokens: null, usdMicros: 369044, costBasis: 'PROVIDER_REPORTED', estimatedUsdMicros: null, occurredAt: at(7, 29), unknown: ['estimatedUsdMicros', 'inputTokens', 'model', 'outputTokens', 'provider', 'requests'] },
    ],
    brainEntries: [
      { entryId: 'seed:constraint', kind: 'CONSTRAINT', workerId: 'julius', taskId: null, revision: 1, occurredAt: at(4, 12), unknown: [] },
      { entryId: 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED', kind: 'DECISION', workerId: 'julius', taskId: 'plan-1', revision: 2, occurredAt: at(5, 45), unknown: [] },
      { entryId: 'brain:guidance-request:build-1', kind: 'HANDOFF', workerId: null, taskId: 'build-1', revision: 3, occurredAt: at(6, 10), unknown: ['workerId'] },
      { entryId: 'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS', kind: 'DECISION', workerId: 'julius', taskId: 'build-1', revision: 4, occurredAt: at(7, 35), unknown: [] },
    ],
    events: [
      { eventId: 'failures.tsv#1', sequence: 1, eventType: 'julius.run.created', taskId: null, occurredAt: at(4, 12), facts: { state: 'CREATED' }, unknown: [] },
      { eventId: 'budget.tsv#2', sequence: 2, eventType: 'julius.budget.allocated', taskId: 'build-1', occurredAt: at(6, 0), facts: { role: 'CODING_AGENT', allocatedUsdMicros: 300000, allocationBasis: 'ESTIMATE_NO_LEDGER', policy: 'julius-allocation.v3', settledUsdMicros: null }, unknown: [] },
      { eventId: 'failures.tsv#3', sequence: 3, eventType: 'julius.provider.failure', taskId: 'build-1', occurredAt: at(7, 29), facts: { code: 'coder_cost_exceeded', failureClass: 'budget', errorRetryable: false }, unknown: [] },
      { eventId: 'failures.tsv#4', sequence: 4, eventType: 'julius.run.failed', taskId: null, occurredAt: at(7, 48), facts: { reasonCode: 'coder_cost_exceeded' }, unknown: [] },
      { eventId: 'trajectory.tsv#1', sequence: null, eventType: 'provider_call', taskId: 'build-1', occurredAt: at(7, 20), facts: { outcome: 'stopped', durationMs: 81000 }, unknown: ['sequence'] },
    ],
    toolInvocations: [
      { invocationId: 'inv-1', taskId: null, toolId: 'shell.bash', executionType: null, state: 'SUCCEEDED', result: 'exit 1', requestedAt: at(7, 10), completedAt: null, artifactRefs: [], unknown: ['completedAt', 'executionType', 'taskId'] },
    ],
    artifacts: [
      { artifactId: 'art-plan', name: 'plan.json', contentType: 'application/json', byteSize: planBytes.byteLength, contentHash: sha256(planBytes), storageRef: null, unknown: ['storageRef'] },
    ],
  };
  return overrides.mutate ? overrides.mutate(body) : body;
}

export function paidRunArchive(overrides: Parameters<typeof paidRunArchiveBody>[0] = {}): JuliusPaidRunArchiveExport {
  return sealJuliusPaidRunArchiveExport(paidRunArchiveBody(overrides));
}
