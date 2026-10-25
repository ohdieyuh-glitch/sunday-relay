import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { planJuliusRepair, repairRoundsBefore, type JuliusTask } from '.';
import { authorizeJuliusLiveSpend } from './julius-spend-ceiling';

/**
 * THE J1 REPAIR CEILING, END TO END ON THE PAID PATH. The contract's
 * `limits.repairCycles` is authorized by `authorizeJuliusLiveSpend`, whose
 * `maxRepairRounds` is what julius-live-mission.ts hands the composition as the
 * repair policy. The pipeline counts prior rounds with `repairRoundsBefore` over
 * the durable task lineage (julius_tasks), not the unused `repairRoundsFor`.
 */
const contract = JSON.parse(readFileSync('.github/julius-missions/julius-inworld-data-1/contract.json', 'utf8')) as {
  markerNamespace: string;
  limits: { spendUsd: number; repairCycles: number };
};

const build: JuliusTask = {
  taskId: 'task:build', missionId: 'mission:julius-inworld-data-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'SUCCEEDED',
};
const repairOf = (parent: JuliusTask, n: number): JuliusTask => ({
  ...parent, taskId: `repair:${parent.taskId}:${String(n)}:task`, parentTaskId: parent.taskId, taskType: 'repair:build', ordinal: parent.ordinal + 1,
});

describe('J1 allows three repair cycles and refuses a fourth', () => {
  const authorized = authorizeJuliusLiveSpend({
    namespace: contract.markerNamespace,
    spendUsd: contract.limits.spendUsd,
    repairCycles: contract.limits.repairCycles,
    ledger: { readable: true, priorRuns: [], durableRecord: 'PRESENT' },
  });

  it('the paid workflow\'s J1 contract authorizes exactly three repair rounds', () => {
    expect(contract.limits).toMatchObject({ spendUsd: 30, repairCycles: 3 });
    expect(authorized).toMatchObject({ authorized: true, maxRepairRounds: 3 });
  });

  it('counts each repair in the lineage, and plans round 3 but never round 4', () => {
    if (!authorized.authorized) throw new Error('expected authorization');
    const policy = { revision: 'j1', reviewerRequired: true, maxRepairRounds: authorized.maxRepairRounds };
    const r1 = repairOf(build, 1);
    const r2 = repairOf(r1, 2);
    const r3 = repairOf(r2, 3);
    const tasks = [build, r1, r2, r3];
    const request = (subject: JuliusTask) => ({
      runId: 'wlj_x', originalTask: subject, findings: [], policy, budgetReservationId: 'reservation', now: 'now',
      decision: { action: 'REPAIR' as const, reasonCode: 'EVIDENCE_FAILED', evidenceIds: ['evidence'], safeSummary: 'repair' },
      priorRounds: repairRoundsBefore(subject, tasks),
    });
    expect(repairRoundsBefore(r2, tasks)).toBe(3);
    expect(planJuliusRepair({ ...request(r2), priorRounds: 2 })).toMatchObject({ round: 3 });
    expect(repairRoundsBefore(r3, tasks)).toBe(3);
    expect(() => planJuliusRepair(request(r3))).toThrow('repair_round_limit');
  });
});
