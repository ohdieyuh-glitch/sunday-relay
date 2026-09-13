import { describe, expect, it } from 'vitest';

import { createJuliusResearchMediator } from './research-mediator';
import { meteredFromJuliusOutcome } from './live-composition';
import { createLiveReachService } from '../live-reach-service';
import {
  JULIUS_RESEARCH_OUTCOMES,
  JULIUS_RESEARCH_ROLES,
  juliusMissionResearchMeter,
  noJuliusResearch,
  sealJuliusResearchPolicy,
  type JuliusResearchRequest,
} from '../../src/relay/mission/julius';

/**
 * AN ASK THE MISSION AUTHORIZED AND THE DEPLOYMENT COULD NOT SERVE.
 *
 * Every paid mission with a research clause has so far run with no observed
 * backend, because nothing in the paid workflow declares one. On that path the
 * mediator authorizes the ask, Live Reach refuses it `not_ready` before any
 * attempt, and the record used to read `policy_refused` — whose documented
 * meaning is "the mission never authorized this" and whose sentence tells the
 * worker that widening research "is the mission's decision". All three slots
 * were told to ask the mission for authority it had already granted.
 *
 * These cases drive the REAL mediator over the REAL Live Reach service with no
 * readiness observation, exactly as the paid entrypoint composes it today, and
 * a fetch that fails the test if it is ever called.
 */

const POLICY = () => sealJuliusResearchPolicy({
  missionId: 'msn-unavailable',
  roles: [...JULIUS_RESEARCH_ROLES],
  allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['nodejs.org'] }],
  missionBudget: { maxRetrievals: 6, maxBytes: 400_000 },
  roleBudget: { maxRetrievals: 2, maxBytes: 200_000 },
});

const ask = (over: Partial<JuliusResearchRequest> = {}): JuliusResearchRequest => ({
  missionId: 'msn-unavailable',
  projectId: 'prj-unavailable',
  runId: 'run-unavailable',
  taskId: 'task-plan',
  role: 'PROMPT_ARCHITECT',
  source: 'web',
  capability: 'read_item',
  reference: 'https://nodejs.org/api/typescript.html',
  purpose: 'Confirm which TypeScript syntax Node erases before planning.',
  requestedAt: '2026-09-12T12:00:00.000Z',
  ...over,
});

/** The paid composition as it stands: no `retrievalContext`, so nothing is observed. */
function unobservedMediator() {
  let fetched = 0;
  let id = 0;
  const now = (): string => '2026-09-12T12:00:01.000Z';
  const policy = POLICY();
  const mediator = createJuliusResearchMediator({
    policyFor: (missionId) => (missionId === policy.missionId ? policy : noJuliusResearch(missionId)),
    liveReach: createLiveReachService({
      now,
      nextEvidenceId: () => { id += 1; return `ev-${String(id)}`; },
      fetchImpl: (async () => { fetched += 1; throw new Error('an unobserved backend must never be fetched'); }) as typeof fetch,
    }),
    now,
  });
  return { mediator, fetched: () => fetched };
}

describe('an authorized ask with no observed backend is UNAVAILABLE, never a policy refusal', () => {
  it('the vocabulary names it, beside the answer it must not be confused with', () => {
    expect(JULIUS_RESEARCH_OUTCOMES).toContain('unavailable');
    expect(JULIUS_RESEARCH_OUTCOMES).toContain('policy_refused');
  });

  it('reads as unavailable with the capability refusal, and nothing is fetched', async () => {
    const { mediator, fetched } = unobservedMediator();
    const result = await mediator.research(ask());
    expect(result.observation.outcome).toBe('unavailable');
    expect(result.observation.refusal).toBe('capability_unavailable');
    expect(result.observation.evidenceId).toBeNull();
    expect(result.observation.rendered).toBeNull();
    expect(fetched()).toBe(0);
  });

  it('tells the worker the truth: the mission already authorized it, and asking the mission is not the move', async () => {
    const { mediator } = unobservedMediator();
    const { observation } = await mediator.research(ask());
    expect(observation.detail).toContain('authorizes that retrieval');
    expect(observation.detail).toContain('Nothing was attempted and nothing was charged');
    expect(observation.detail).not.toContain('does not authorize');
    expect(observation.detail).not.toContain("is the mission's decision");
  });

  it('charges nothing, for every slot, however many times it is asked', async () => {
    const { mediator } = unobservedMediator();
    let ledger;
    for (const role of JULIUS_RESEARCH_ROLES) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        ({ ledger } = await mediator.research(ask({ role, taskId: `task-${role}-${String(attempt)}` })));
      }
    }
    expect(juliusMissionResearchMeter(ledger!).counted).toBe(0);
  });

  it('a restarted mission rebuilding its meter from the durable rows does not charge an unavailable ask', () => {
    expect(meteredFromJuliusOutcome('unavailable')).toBe('not_attempted');
    // And the answers it must stay distinct from keep their own charges.
    expect(meteredFromJuliusOutcome('policy_refused')).toBe('not_attempted');
    expect(meteredFromJuliusOutcome('unreachable')).toBe('unreachable');
  });

  it('a host the mission never allowlisted is still a policy refusal, before Live Reach is consulted', async () => {
    const { mediator, fetched } = unobservedMediator();
    const result = await mediator.research(ask({ reference: 'https://example.com/not-granted' }));
    expect(result.observation.outcome).toBe('policy_refused');
    expect(result.observation.refusal).toBe('host_not_allowed');
    expect(fetched()).toBe(0);
  });
});
