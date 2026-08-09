import { describe, expect, it } from 'vitest';

import {
  OCCUPANTS_FOR_AGENT_OPTION,
  UNMAPPED_OCCUPANTS,
  dispatchForAgentOption,
} from './role-occupant-map';
import { AGENT_OPTIONS, SELECTABLE_AVAILABILITY, type AgentOption } from '../project-settings';
import { ROLE_OCCUPANTS, ROLE_SLOTS } from '../../mission';

/**
 * THE JOIN IS THE CLAIM, SO THE JOIN IS WHAT IS TESTED.
 *
 * A table matching two hand-written vocabularies rots silently: renaming an
 * occupant or a catalog id leaves a mapping that points at nothing and a
 * selector that quietly says "no occupant runs this". These fail instead.
 */

const optionById = (id: string): AgentOption | undefined =>
  AGENT_OPTIONS.find((o) => o.id === id);

describe('agent option → occupant map', () => {
  it('names only catalog options that exist', () => {
    for (const id of Object.keys(OCCUPANTS_FOR_AGENT_OPTION)) {
      expect(optionById(id), `${id} is not in AGENT_OPTIONS`).toBeDefined();
    }
  });

  it('names only registered occupants, in the role their option holds', () => {
    for (const [optionId, occupantIds] of Object.entries(OCCUPANTS_FOR_AGENT_OPTION)) {
      const option = optionById(optionId);
      expect(option).toBeDefined();
      for (const occupantId of occupantIds) {
        const occupant = ROLE_OCCUPANTS.find((o) => o.occupantId === occupantId);
        expect(occupant, `${occupantId} is not registered`).toBeDefined();
        expect(occupant?.role, `${occupantId} does not hold ${option?.role ?? '?'}`)
          .toBe(option?.role);
      }
    }
  });

  it('leaves no registered occupant unreachable without saying so', () => {
    // Every occupant is either selectable through some catalog option or
    // listed as deliberately unmapped WITH the reason in the module. A third
    // state — registered, unmapped, unexplained — is how a real integration
    // becomes invisible to the founder, which is the hole this catches.
    const mapped = new Set(Object.values(OCCUPANTS_FOR_AGENT_OPTION).flat());
    for (const occupant of ROLE_OCCUPANTS) {
      const known = mapped.has(occupant.occupantId)
        || UNMAPPED_OCCUPANTS.includes(occupant.occupantId);
      expect(known, `${occupant.occupantId} is registered but unreachable and unexplained`)
        .toBe(true);
    }
  });

  it('never lets the offline fake stand in for a real named agent', () => {
    // Selecting "Claude Code" must not be able to yield a simulated run under
    // a real name. The fake is reachable only through the server variable
    // that makes it honest.
    expect(UNMAPPED_OCCUPANTS).toContain('claude_code_fake');
    expect(Object.values(OCCUPANTS_FOR_AGENT_OPTION).flat()).not.toContain('claude_code_fake');
  });

  it('reports the same role slots the mission registry defines', () => {
    for (const role of ROLE_SLOTS) {
      expect(AGENT_OPTIONS.some((o) => o.role === role), `no catalog option holds ${role}`)
        .toBe(true);
    }
  });
});

describe('dispatchForAgentOption', () => {
  it('reports a hosted-only occupant as not running on a founder machine', () => {
    const hosted = optionById('coding-claude-code');
    expect(hosted).toBeDefined();
    // Claude Code has BOTH a local CLI and a hosted SDK occupant, so it runs
    // in either place — that is the point of the pair.
    expect(dispatchForAgentOption(hosted as AgentOption, 'coding_agent', 'hosted').runsHere).toBe(true);
    expect(dispatchForAgentOption(hosted as AgentOption, 'coding_agent', 'founder_machine').runsHere).toBe(true);
  });

  it('names the configuration a hosted Hermes reviewer reads, because only the remote occupant can run there', () => {
    const reviewer = optionById('reviewer-hermes');
    expect(reviewer).toBeDefined();
    const onHost = dispatchForAgentOption(reviewer as AgentOption, 'reviewer', 'hosted');
    // The remote service occupant is what makes hosted possible at all, and it
    // reads configuration — which must be NAMED so the founder can set it.
    expect(onHost.runsHere).toBe(true);
    expect(onHost.requiredConfig.length).toBeGreaterThan(0);
    for (const name of onHost.requiredConfig) {
      expect(name).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it('takes the least configuration among occupants that run here, not the union', () => {
    // The local Hermes process needs nothing; the remote service needs a URL
    // and a token. On a founder machine the answer is "nothing", because that
    // is the occupant that would run — reporting the union would demand
    // variables this deployment never reads.
    const reviewer = optionById('reviewer-hermes') as AgentOption;
    expect(dispatchForAgentOption(reviewer, 'reviewer', 'founder_machine').requiredConfig).toHaveLength(0);
  });

  it('reports an unmapped option as running nowhere', () => {
    const unmapped = AGENT_OPTIONS.find(
      (o) => o.role === 'reviewer' && OCCUPANTS_FOR_AGENT_OPTION[o.id] === undefined,
    );
    expect(unmapped).toBeDefined();
    expect(dispatchForAgentOption(unmapped as AgentOption, 'reviewer', 'hosted').runsHere).toBe(false);
    expect(dispatchForAgentOption(unmapped as AgentOption, 'reviewer', 'hosted').occupants)
      .toHaveLength(0);
  });

  it('answers UNKNOWN, not "nowhere", when no bridge is connected', () => {
    // A browser in the offline product has never seen a machine. Reporting
    // `false` there would be a claim about a computer that does not exist yet,
    // and the surface would tell the founder their choice cannot run when in
    // truth nothing has been asked.
    const claude = optionById('coding-claude-code') as AgentOption;
    const unknown = dispatchForAgentOption(claude, 'coding_agent', null);
    expect(unknown.runsHere).toBeNull();
    expect(unknown.requiredConfig).toHaveLength(0);
    // The registered occupants are still reported — the registry is knowable
    // without a deployment; only "does it run here" is not.
    expect(unknown.occupants.length).toBeGreaterThan(0);
  });

  it('does not silently promote a selectable option into a dispatchable one', () => {
    // Several catalog options are selectable configuration with no registered
    // occupant — `reviewer-codex` among them, whose adapter the CLI can run
    // but the bridge cannot bind. That gap is real and must stay visible.
    const selectableWithoutOccupant = AGENT_OPTIONS.filter(
      (o) => SELECTABLE_AVAILABILITY.has(o.availability)
        && !dispatchForAgentOption(o, o.role, 'hosted').runsHere,
    );
    expect(selectableWithoutOccupant.length).toBeGreaterThan(0);
  });
});
