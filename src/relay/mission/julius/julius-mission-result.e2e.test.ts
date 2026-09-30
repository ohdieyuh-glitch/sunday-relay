import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore } from './julius-memory-store';
import { JuliusRuntimeApi, type JuliusMissionResultView } from './julius-runtime-api';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE RESULT A USER ASKS FOR — held to what it must never say.
 *
 * THE LOOP'S LAST STEP is "returns a truthful verified result", and until this
 * projection existed a surface had to assemble that answer from six reads and
 * its own idea of what completion means. The failure mode is specific and
 * serious: a client that treated a COMPLETED run, or a full evidence list, as
 * proof would eventually show a mission as done when a criterion had no passing
 * evidence, or show a reviewer's opinion as the work.
 *
 * These cases drive the REAL run loop to a real completion and then ask the API
 * — never the fixture — what the mission produced.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'provider-a', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'provider-b', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'provider-c', adapterId: 'reviewer-adapter',
});
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const scope = { projectId: 'prj-1' };
const IDENTITY = { tenantId: 'tenant', projectId: 'prj-1', actorId: 'operator', scopes: ['run:read'] as const };

const PLAN_OK = {
  kind: 'succeed' as const,
  evidence: [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'plan.md written' }],
};
const REVIEW_OK = {
  kind: 'succeed' as const,
  evidence: [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'no blocking findings' }],
};

interface Build {
  readonly buildEvidence?: readonly { type: string; status: string; safeSummary: string }[];
  readonly buildFails?: boolean;
  readonly criterionEvidence?: readonly string[];
  readonly usdMicros?: number | null;
}

function build(input: Build = {}): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      {
        worker: CODER,
        script: [input.buildFails === true
          ? { kind: 'fail', code: 'AUTH_CONFIGURATION', message: 'scripted permanent failure' }
          : {
            kind: 'succeed',
            usdMicros: input.usdMicros === undefined ? 512_000 : input.usdMicros,
            evidence: (input.buildEvidence ?? [
              { type: 'TEST', status: 'PASSED', safeSummary: 'node --test: 12 passed' },
              { type: 'DIFF', status: 'PASSED', safeSummary: '2 files changed, 41 insertions' },
            ]) as never,
          }],
      },
      { worker: REVIEWER, script: [REVIEW_OK, REVIEW_OK, REVIEW_OK] },
    ],
    card: cardPolicy({
      allowedProviders: ['provider-a', 'provider-b', 'provider-c'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({
    taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
  }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{
    criterionId: 'AC-1', description: 'The suite passes and the change is visible in a diff.',
    requiredEvidenceTypes: (input.criterionEvidence ?? ['TEST', 'DIFF']) as never,
  }]);
  return harness;
}

async function resultOf(harness: JuliusHarness, maxTicks = 30): Promise<JuliusMissionResultView> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if ((await harness.loop.tick(scope)).claimed === 0) break;
  }
  const api = new JuliusRuntimeApi({
    store: harness.store as never, timeline: harness.store as never,
    approvers: { mayApprove: async () => false }, clock: harness.clock,
  });
  const result = await api.inspectResult(IDENTITY, 'run-1');
  expect(result.ok, 'the result view must be readable').toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('the result a user asks for', () => {
  it('says what the mission made, that it was verified, and what satisfied each criterion', async () => {
    const result = await resultOf(build());

    expect(result.state).toBe('COMPLETED');
    expect(result.verified, 'COMPLETED, and only COMPLETED, is verified').toBe(true);
    expect(result.terminal).toBe(true);

    // THE CRITERION, AND WHAT SATISFIED IT — not "it completed, trust me".
    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0]!.satisfied).toBe(true);
    expect(result.criteria[0]!.evidenceIds.length, 'the rows a reader can go and look at').toBeGreaterThan(0);

    // THE DELIVERABLES ARE THE PRODUCT, not the judgement about it.
    expect(result.deliverables.map((item) => item.type).sort()).toEqual(['ARTIFACT', 'DIFF', 'TEST']);
    expect(result.deliverables.some((item) => item.type === 'REVIEW_FINDING'),
      'a reviewer’s opinion is not a deliverable').toBe(false);
    expect(result.deliverables.every((item) => item.retained === (item.artifactRef !== null)),
      'retained says whether a body exists, and never guesses').toBe(true);

    // AND WHO VERIFIED IT: the decisions are on the answer, so "who says so" is
    // answerable without a second read.
    expect(result.reviewDecisions.some((decision) => decision.action === 'ACCEPT')).toBe(true);
    expect(result.outstandingFindings, 'a verified mission has no open blocking finding').toEqual([]);
    expect(result.failure, 'and no failure').toBeNull();
  });

  it('will not call a criterion that requires nothing "satisfied" until the mission completes', async () => {
    // THE DEFECT A REAL-DATABASE CASE CAUGHT BEFORE ANY CLIENT DID. `every()`
    // over an empty list is true, so a criterion naming no evidence read as
    // satisfied on a run that had not started — and the bootstrap seeds exactly
    // those. Such a criterion is satisfied by COMPLETION or not at all, and the
    // answer says which basis it used so a surface need not guess.
    const harness = build({ criterionEvidence: [] });
    const api = new JuliusRuntimeApi({
      store: harness.store as never, timeline: harness.store as never,
      approvers: { mayApprove: async () => false }, clock: harness.clock,
    });

    // BEFORE ANY TICK: nothing has happened, and nothing is claimed.
    const before = await api.inspectResult(IDENTITY, 'run-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.criteria[0]!.basis).toBe('COMPLETION');
    expect(before.value.criteria[0]!.satisfied, 'an untouched run satisfies nothing').toBe(false);
    expect(before.value.verified).toBe(false);

    // AFTER THE RUN COMPLETES: the same criterion is satisfied, on the same basis.
    const after = await resultOf(harness);
    expect(after.verified).toBe(true);
    expect(after.criteria[0]!.basis).toBe('COMPLETION');
    expect(after.criteria[0]!.satisfied).toBe(true);
    // And a criterion that DOES name evidence reports the other basis.
    const byEvidence = await resultOf(build());
    expect(byEvidence.criteria[0]!.basis).toBe('EVIDENCE');
  });

  it('reports the spend it knows and the components it does not, never a zero for unknown', async () => {
    const priced = await resultOf(build({ usdMicros: 512_000 }));
    expect(priced.cost.knownUsdMicros, 'the coder’s billed attempt is on the total').toBeGreaterThan(0);

    // A DISPATCH THAT REPORTED NO COST is unknown, and the answer says so
    // rather than adding zero and calling the total complete.
    const unpriced = await resultOf(build({ usdMicros: null }));
    expect(unpriced.cost.unknownComponents, 'an unpriced dispatch is counted as unknown').toBeGreaterThan(0);
    expect(unpriced.cost.complete, 'and the total is not called complete').toBe(false);
  });

  it('does NOT call a run verified when a criterion has no passing evidence', async () => {
    // THE FAILURE MODE THIS PROJECTION EXISTS FOR. The criterion demands a
    // SECURITY_SCAN that nothing produces: the run cannot complete, and the
    // answer must say which criterion is unsatisfied rather than reporting a
    // result because tasks succeeded.
    const result = await resultOf(build({ criterionEvidence: ['TEST', 'SECURITY_SCAN'] }));
    expect(result.verified).toBe(false);
    expect(result.state).not.toBe('COMPLETED');
    expect(result.criteria[0]!.satisfied, 'the unmet criterion is named as unmet').toBe(false);
    // The work it DID do is still reported: a surface can show progress without
    // being told the mission succeeded.
    expect(result.deliverables.length, 'what was produced is still visible').toBeGreaterThan(0);
  });

  it('names the failure when the mission failed, and claims nothing it did not do', async () => {
    const result = await resultOf(build({ buildFails: true }));
    expect(result.verified).toBe(false);
    expect(result.state).toBe('FAILED');
    expect(result.terminal, 'a failed run is terminal: nothing is still coming').toBe(true);
    expect(result.failure, 'the reason is on the answer').not.toBeNull();
    expect(result.failure!.failureClass ?? result.failure!.reasonCode, 'and it is named').toBeTruthy();
    expect(result.deliverables.some((item) => item.type === 'TEST'), 'a failed build produced no test result').toBe(false);
  });

  it('refuses a reader from another project, and one with no scope', async () => {
    const harness = build();
    for (let tick = 0; tick < 30; tick += 1) {
      if ((await harness.loop.tick(scope)).claimed === 0) break;
    }
    const api = new JuliusRuntimeApi({
    store: harness.store as never, timeline: harness.store as never,
    approvers: { mayApprove: async () => false }, clock: harness.clock,
  });
    const stranger = await api.inspectResult({ ...IDENTITY, projectId: 'prj-someone-else' }, 'run-1');
    expect(stranger.ok).toBe(false);
    const unscoped = await api.inspectResult({ ...IDENTITY, scopes: [] }, 'run-1');
    expect(unscoped.ok).toBe(false);
    if (!unscoped.ok) expect(unscoped.reason).toBe('scope_missing');
  });
});

/**
 * THE RESULT AGREES WITH THE DECISION (defect A's A-6, the operator-facing half). The decision reads
 * only the attempt the task row names (eaddbf74). This view read every attempt's rows, so a PASSED row
 * a lost lease left behind could show an operator a criterion as SATISFIED, and list a deliverable,
 * that the decision never credited: a record that disagrees with the decision. It now reads the same
 * attempt the decision does. `inspectEvidence` stays the raw history, and says it is.
 */
describe('the result reads the attempt the decision read', () => {
  const now = '2026-09-29T12:00:00.000Z';
  const later = '2026-09-29T13:00:00.000Z';
  /** A build accepted on its SECOND lease; `rows` are written under the generations they name. */
  const acceptedOnSecondLease = async (rows: (first: number, second: number) => Array<{ generation: number; status: 'PASSED' | 'FAILED' }>) => {
    const store = createJuliusMemoryStore();
    store.seedRun(RUN);
    store.seedTask('run-1', task({ taskId: 'build-1', role: 'CODING_AGENT', taskType: 'build', requiredEvidenceTypes: ['TEST'], state: 'RUNNABLE' }));
    store.seedCriteria('run-1', [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] as never }]);
    const [first] = await store.claimRunnable({ owner: 'lost', now, leaseExpiresAt: later, limit: 1, projectId: 'prj-1' });
    expect(await store.finishTask({ taskId: 'build-1', owner: 'lost', leaseGeneration: first!.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now })).toBe(true);
    const [second] = await store.claimRunnable({ owner: 'accepted', now, leaseExpiresAt: later, limit: 1, projectId: 'prj-1' });
    for (const [index, row] of rows(first!.leaseGeneration, second!.leaseGeneration).entries()) {
      expect(await store.appendEvidence({
        runId: 'run-1', projectId: 'prj-1', idempotencyKey: `k${String(index)}`,
        evidence: {
          evidenceId: `build-1:${String(row.generation)}:${String(index)}`, missionId: 'msn-1', taskId: 'build-1', workerId: 'coder',
          type: 'TEST', status: row.status, safeSummary: `TEST ${row.status} under lease ${String(row.generation)}`, artifactRef: null, integrityHash: null, occurredAt: now,
        },
      })).toBe(true);
    }
    expect(await store.finishTask({ taskId: 'build-1', owner: 'accepted', leaseGeneration: second!.leaseGeneration, state: 'SUCCEEDED', now })).toBe(true);
    const api = new JuliusRuntimeApi({ store: store as never, timeline: store as never, approvers: { mayApprove: async () => false }, clock: { now: () => now } as never });
    const result = await api.inspectResult(IDENTITY, 'run-1');
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  };

  it('RED FIRST: a PASSED row a lost lease left behind satisfies no criterion and is no deliverable', async () => {
    const view = await acceptedOnSecondLease((first) => [{ generation: first, status: 'PASSED' }]);
    expect(view.criteria[0], 'the decision never credited that row').toMatchObject({ satisfied: false, evidenceIds: [] });
    expect(view.deliverables).toEqual([]);
  });
  it('CONTROL: the accepted attempt’s own PASSED row satisfies it, and is the deliverable', async () => {
    const view = await acceptedOnSecondLease((first, second) => [{ generation: first, status: 'FAILED' }, { generation: second, status: 'PASSED' }]);
    expect(view.criteria[0]).toMatchObject({ satisfied: true, evidenceIds: ['build-1:2:1'] });
    expect(view.deliverables.map((item) => item.evidenceId)).toEqual(['build-1:2:1']);
  });
  it('the accepted attempt’s own FAILED row satisfies nothing either: the attempt is reduced, then the status is read', async () => {
    const view = await acceptedOnSecondLease((_first, second) => [{ generation: second, status: 'FAILED' }]);
    expect(view.criteria[0]).toMatchObject({ satisfied: false, evidenceIds: [] });
    expect(view.deliverables).toEqual([]);
  });
});
