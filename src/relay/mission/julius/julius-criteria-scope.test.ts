import { describe, expect, it } from 'vitest';
import { createJuliusMemoryStore } from './julius-memory-store';
import {
  juliusCriteriaScopeCases,
  type JuliusCriteriaScopeStore,
} from '../../persistence/julius-criteria-scope-conformance';

/**
 * THE CRITERIA-SCOPE CONTRACT, AGAINST THE IN-MEMORY STORE.
 *
 * This store has always keyed criteria by run, so these cases pass here and passed
 * here before the defect was found. That is exactly why they are worth running here
 * TOO: the contract is now asserted against the store that was right, so the two can
 * no longer drift in either direction. The real-PostgreSQL runner beside it is where
 * the defect actually lived.
 */

const store = (): JuliusCriteriaScopeStore => {
  const memory = createJuliusMemoryStore();
  const projects = new Map<string, string>();
  return {
    async createRun(runId, projectId) {
      projects.set(runId, projectId);
      memory.seedRun({
        runId, projectId, missionId: `mission:${runId}`, state: 'READY',
        cardRevision: 'card-1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
      });
    },
    async seed(runId, criteria) { memory.seedCriteria(runId, criteria); },
    async read(runId, projectId) { return memory.criteriaForRun(runId, projectId); },
  };
};

describe('a criterion belongs to a run: the in-memory store', () => {
  for (const scenario of juliusCriteriaScopeCases((actual, message) => expect(actual, message))) {
    it(scenario.name, async () => { await scenario.run(store()); });
  }
});
