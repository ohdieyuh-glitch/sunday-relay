import { describe, expect, it } from 'vitest';

import {
  BRAIN_OWNERSHIP,
  BRAIN_SYSTEMS,
  BRAIN_TRUTH_DOMAINS,
  brainMayRead,
  brainMayWrite,
  brainOwnershipOf,
  type BrainSystem,
} from './brain-ownership';
import {
  BRAIN_COMPOUND_CLONE_STATES,
  BRAIN_SUB_AGENT_STATES,
  brainCompoundCloneFact,
  brainCubPresentation,
  brainSubAgentFact,
  refuseSilentAgentUpgrade,
  type BrainAgentFact,
} from './brain-agent-facts';
import {
  brainAttemptScope,
  brainRunScope,
  brainScopeRunId,
  brainWorkflowProvenanceRef,
  isSameBrainAttempt,
  parseBrainScope,
  validateBrainAttemptIdentity,
} from './brain-attempt-identity';

const ATTEMPT = { runId: 'run:julius-live-9', taskId: 'build-1', leaseGeneration: 3 };
const JULIUS_FACT = {
  attempt: ATTEMPT, projectId: 'prj-1', missionId: 'mission:1', observedBy: 'JULIUS' as BrainSystem,
  evidenceIds: ['evidence:1'], occurredAt: '2026-09-22T10:00:00.000Z',
};

describe('the ownership registry', () => {
  it('every domain has exactly one author, a durable home, and a rule saying why', () => {
    expect(BRAIN_OWNERSHIP.map((rule) => rule.domain).sort()).toEqual([...BRAIN_TRUTH_DOMAINS].sort());
    for (const rule of BRAIN_OWNERSHIP) {
      expect(BRAIN_SYSTEMS, rule.domain).toContain(rule.author);
      // An author does not also need permission to propose to itself.
      expect(rule.propose, rule.domain).not.toContain(rule.author);
      expect(rule.durableHome.length, rule.domain).toBeGreaterThan(0);
      expect(rule.rule.length, rule.domain).toBeGreaterThan(20);
      for (const system of [...rule.propose, ...rule.read]) expect(BRAIN_SYSTEMS, rule.domain).toContain(system);
    }
  });

  it('nothing a renderer or a calculator says is truth: Wonderland and Python author nothing they should not', () => {
    // Wonderland authors presentation only, and presentation is not durable.
    const wonderlandAuthored = BRAIN_OWNERSHIP.filter((rule) => rule.author === 'WONDERLAND');
    expect(wonderlandAuthored.map((rule) => rule.domain)).toEqual(['PRESENTATION_STATE']);
    expect(wonderlandAuthored[0]!.durable).toBe(false);
    expect(brainMayWrite('WONDERLAND', 'PRESENTATION_STATE')).toMatchObject({ ok: false, reasonCode: 'not_durable' });

    for (const domain of ['AGENT_LIFECYCLE', 'COMPOUND_CLONE_LIFECYCLE', 'RUN_LIFECYCLE', 'MISSION_DECISION', 'PROJECT_PROGRESSION'] as const) {
      expect(brainMayWrite('WONDERLAND', domain), domain).toMatchObject({ ok: false, reasonCode: 'not_an_author' });
    }
    // Python computes: it authors its own results and proposes evaluations, nothing else.
    expect(BRAIN_OWNERSHIP.filter((rule) => rule.author === 'PYTHON').map((rule) => rule.domain)).toEqual(['COMPUTATION_RESULT']);
    expect(brainMayWrite('PYTHON', 'MISSION_DECISION')).toMatchObject({ ok: false, reasonCode: 'not_an_author' });
    expect(brainMayWrite('PYTHON', 'EVALUATION_RESULT')).toEqual({ ok: true, as: 'PROPOSAL' });
    // The reviewer reports and never rewrites what it reviewed.
    expect(brainMayWrite('INDEPENDENT_REVIEWER', 'REVIEW_FINDING')).toEqual({ ok: true, as: 'AUTHOR' });
    expect(brainMayWrite('INDEPENDENT_REVIEWER', 'MISSION_DECISION')).toEqual({ ok: true, as: 'PROPOSAL' });
    expect(brainMayWrite('INDEPENDENT_REVIEWER', 'RUN_LIFECYCLE')).toMatchObject({ ok: false, reasonCode: 'not_an_author' });
    // GVE proves; it does not become the database.
    expect(brainMayWrite('GVE', 'EVALUATION_RESULT')).toEqual({ ok: true, as: 'AUTHOR' });
    expect(brainMayWrite('GVE', 'MISSION_INTENT')).toMatchObject({ ok: false, reasonCode: 'not_an_author' });
    // The Brain itself authors nothing: it stores what others state.
    expect(BRAIN_OWNERSHIP.some((rule) => rule.author === 'PROJECT_BRAIN')).toBe(false);
  });

  it('Julius owns lifecycle, and the two agent domains are separate domains', () => {
    expect(brainOwnershipOf('AGENT_LIFECYCLE').author).toBe('JULIUS');
    expect(brainOwnershipOf('COMPOUND_CLONE_LIFECYCLE').author).toBe('JULIUS');
    expect(brainOwnershipOf('AGENT_LIFECYCLE').domain).not.toBe(brainOwnershipOf('COMPOUND_CLONE_LIFECYCLE').domain);
    // Sub-agent lifecycle is already stored by Julius; the Brain references it rather than copying it.
    expect(brainOwnershipOf('AGENT_LIFECYCLE').durableHome).toContain('julius_subagents');
    // Nothing may propose an agent into existence; only Julius states one.
    expect(brainOwnershipOf('AGENT_LIFECYCLE').propose).toEqual([]);
    expect(brainOwnershipOf('COMPOUND_CLONE_LIFECYCLE').propose).toEqual([]);
    expect(brainMayRead('WONDERLAND', 'AGENT_LIFECYCLE')).toBe(true);
    expect(brainMayRead('WONDERLAND', 'COMPUTATION_RESULT')).toBe(false);
    expect(() => brainOwnershipOf('NOT_A_DOMAIN' as never)).toThrow('brain_ownership_unknown_domain');
  });
});

describe('sub-agents and compound clones are never the same thing', () => {
  it('Julius may state a sub-agent; a renderer may not, and a Cub on screen proves nothing', () => {
    const recorded = brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'req-1', parentTaskId: 'build-1', childTaskId: 'build-1:child', depth: 1, capability: 'research', state: 'ACTIVE', denialReason: null });
    expect(recorded).toMatchObject({ ok: true, fact: { kind: 'SUB_AGENT', subAgentId: 'req-1', state: 'ACTIVE' } });

    const rendered = brainSubAgentFact({ ...JULIUS_FACT, observedBy: 'WONDERLAND', subAgentId: 'req-2', parentTaskId: 'build-1', childTaskId: 'build-1:child2', depth: 1, capability: 'research', state: 'ACTIVE', denialReason: null });
    expect(rendered).toEqual({ ok: false, reasonCode: 'presentation_is_not_evidence', detail: expect.stringContaining('a Cub on screen is not evidence') });
    for (const system of ['PYTHON', 'GVE', 'INDEPENDENT_REVIEWER', 'OPERATOR'] as BrainSystem[]) {
      expect(brainSubAgentFact({ ...JULIUS_FACT, observedBy: system, subAgentId: 'req-3', parentTaskId: 'p', childTaskId: 'c', depth: 1, capability: 'x', state: 'ACTIVE', denialReason: null }), system)
        .toMatchObject({ ok: false, reasonCode: 'not_an_author' });
    }
  });

  it('a clone is its own entity with its own id namespace and states, and nothing converts one into the other', () => {
    const clone = brainCompoundCloneFact({ ...JULIUS_FACT, cloneId: 'clone-1', primaryAgentId: 'julius', workstream: 'archive audit', state: 'WORKING', synthesisRef: null, terminationReason: null });
    expect(clone).toMatchObject({ ok: true, fact: { kind: 'COMPOUND_CLONE', cloneId: 'clone-1' } });
    // The two state vocabularies do not overlap, so a state can never be read as the wrong kind.
    expect(BRAIN_SUB_AGENT_STATES.filter((state) => (BRAIN_COMPOUND_CLONE_STATES as readonly string[]).includes(state))).toEqual([]);
    expect(brainCompoundCloneFact({ ...JULIUS_FACT, cloneId: 'clone-2', primaryAgentId: 'julius', workstream: 'x', state: 'ACTIVE' as never, synthesisRef: null, terminationReason: null }))
      .toMatchObject({ ok: false, reasonCode: 'state_invalid' });
    expect(brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'req-4', parentTaskId: 'p', childTaskId: 'c', depth: 1, capability: 'x', state: 'SPAWNED' as never, denialReason: null }))
      .toMatchObject({ ok: false, reasonCode: 'state_invalid' });
    // And a rendered clone is refused for the same reason a rendered sub-agent is.
    expect(brainCompoundCloneFact({ ...JULIUS_FACT, observedBy: 'WONDERLAND', cloneId: 'clone-3', primaryAgentId: 'julius', workstream: 'x', state: 'SPAWNED', synthesisRef: null, terminationReason: null }))
      .toMatchObject({ ok: false, reasonCode: 'presentation_is_not_evidence' });
    expect(refuseSilentAgentUpgrade('SUB_AGENT', 'COMPOUND_CLONE')).toEqual({
      ok: false, reasonCode: 'not_an_author',
      detail: 'a SUB_AGENT is not a COMPOUND_CLONE: they are separate entities with separate lifecycles, and only Julius may state which one existed',
    });
  });

  it('a sub-agent carries the identity and depth Julius gave it, and nothing invents them', () => {
    const invalid = brainSubAgentFact({ ...JULIUS_FACT, subAgentId: '', parentTaskId: 'p', childTaskId: 'c', depth: 1, capability: 'x', state: 'ACTIVE', denialReason: null });
    expect(invalid).toMatchObject({ ok: false, reasonCode: 'identity_invalid' });
    // Depth is the stored depth of a child: a child is never at depth 0, and never a guess.
    expect(brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'req-5', parentTaskId: 'p', childTaskId: 'c', depth: 0, capability: 'x', state: 'ACTIVE', denialReason: null }))
      .toMatchObject({ ok: false, reasonCode: 'depth_invalid' });
    // A denied spawn is a fact too, with the reason Julius gave.
    const denied = brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'req-6', parentTaskId: 'p', childTaskId: 'c', depth: 1, capability: 'x', state: 'CANCELLED', denialReason: 'CARD_SUBAGENT_DEPTH_LIMIT' });
    expect(denied).toMatchObject({ ok: true, fact: { state: 'CANCELLED', denialReason: 'CARD_SUBAGENT_DEPTH_LIMIT' } });
    // Unknown stays Unknown: a time Julius did not state is null, not now.
    const untimed = brainSubAgentFact({ ...JULIUS_FACT, occurredAt: null, subAgentId: 'req-7', parentTaskId: 'p', childTaskId: 'c', depth: 2, capability: 'x', state: 'SUCCEEDED', denialReason: null });
    expect(untimed).toMatchObject({ ok: true, fact: { occurredAt: null } });
  });

  it('what Wonderland may derive is a count of real facts, and the direction is Brain to renderer', () => {
    const facts: BrainAgentFact[] = [
      (brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'a', parentTaskId: 'p', childTaskId: 'c1', depth: 1, capability: 'x', state: 'ACTIVE', denialReason: null }) as { fact: BrainAgentFact }).fact,
      (brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'b', parentTaskId: 'p', childTaskId: 'c2', depth: 1, capability: 'x', state: 'AUTHORIZED', denialReason: null }) as { fact: BrainAgentFact }).fact,
      (brainSubAgentFact({ ...JULIUS_FACT, subAgentId: 'c', parentTaskId: 'p', childTaskId: 'c3', depth: 1, capability: 'x', state: 'SUCCEEDED', denialReason: null }) as { fact: BrainAgentFact }).fact,
      (brainCompoundCloneFact({ ...JULIUS_FACT, cloneId: 'clone-9', primaryAgentId: 'julius', workstream: 'x', state: 'WORKING', synthesisRef: null, terminationReason: null }) as { fact: BrainAgentFact }).fact,
    ];
    expect(brainCubPresentation(facts)).toEqual({
      activeSubAgents: 2,
      byState: { AUTHORIZED: 1, ACTIVE: 1, SUCCEEDED: 1, FAILED: 0, CANCELLED: 0 },
      compoundClones: 1,
    });
    // Clones are counted apart from Cubs: a Cub count never includes one.
    expect(brainCubPresentation(facts).activeSubAgents).not.toBe(3);
  });
});

describe('an attempt is identified in Julius terms, and never re-minted', () => {
  it('the scope is run, task and lease generation, and it parses back exactly', () => {
    expect(brainAttemptScope(ATTEMPT)).toBe('attempt:run:julius-live-9/build-1/3');
    expect(parseBrainScope(brainAttemptScope(ATTEMPT))).toEqual({ kind: 'ATTEMPT', identity: ATTEMPT });
    expect(brainRunScope('run:julius-live-9')).toBe('run:run:julius-live-9');
    expect(parseBrainScope(brainRunScope('run:julius-live-9'))).toEqual({ kind: 'RUN', runId: 'run:julius-live-9' });
    expect(brainScopeRunId(brainAttemptScope(ATTEMPT))).toBe('run:julius-live-9');
    expect(brainScopeRunId('nonsense')).toBeNull();
    expect(parseBrainScope('attempt:run:x/task/notanumber')).toBeNull();
  });

  it('two attempts of one task are different attempts: the lease generation is what separates them', () => {
    const second = { ...ATTEMPT, leaseGeneration: 4 };
    expect(isSameBrainAttempt(ATTEMPT, second)).toBe(false);
    expect(brainAttemptScope(ATTEMPT)).not.toBe(brainAttemptScope(second));
    expect(isSameBrainAttempt(ATTEMPT, { ...ATTEMPT })).toBe(true);
    // A lease generation of 0 is a real first attempt, not a missing value.
    expect(validateBrainAttemptIdentity({ ...ATTEMPT, leaseGeneration: 0 })).toEqual([]);
    expect(validateBrainAttemptIdentity({ ...ATTEMPT, leaseGeneration: -1 })).toEqual(['lease_generation_invalid']);
    expect(validateBrainAttemptIdentity({ runId: '', taskId: 'has space', leaseGeneration: 1.5 }))
      .toEqual(['run_id_invalid', 'task_id_invalid', 'lease_generation_invalid']);
    expect(() => brainAttemptScope({ ...ATTEMPT, taskId: 'with/slash' })).toThrow('brain_attempt_identity_invalid: task_id_invalid');
  });

  it('a workflow run and attempt is provenance beside the scope, never the identity', () => {
    expect(brainWorkflowProvenanceRef({ workflowRunId: '34995797200', workflowRunAttempt: 5 })).toBe('workflow:34995797200/5');
    expect(() => brainWorkflowProvenanceRef({ workflowRunId: 'run:julius', workflowRunAttempt: 1 })).toThrow('workflow_run_id_invalid');
    expect(() => brainWorkflowProvenanceRef({ workflowRunId: '3499', workflowRunAttempt: 0 })).toThrow('workflow_run_attempt_invalid');
    // It is not a scope, and the scope parser will not accept it as one.
    expect(parseBrainScope('workflow:34995797200/5')).toBeNull();
  });
});
