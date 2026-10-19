import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  OCCUPANTS_FOR_AGENT_OPTION,
  OCCUPANT_FACTS,
  UNMAPPED_OCCUPANTS,
  dispatchForAgentOption,
} from './role-occupant-map';
import { AGENT_OPTIONS, SELECTABLE_AVAILABILITY, type AgentOption } from '../project-settings';
import { ROLE_OCCUPANTS, ROLE_SLOTS } from '../../mission/role-slots';

/**
 * THE JOIN IS THE CLAIM, SO THE JOIN IS WHAT IS TESTED.
 *
 * The browser cannot import the occupant registry: occupants carry the
 * server-side variable names their adapters read, and a module reachable from
 * `main.tsx` must name none of them. So the workspace holds its own table of
 * browser-safe occupant FACTS — where each one runs, and whether it reads
 * configuration, never which.
 *
 * A hand-copied table rots silently. This file imports the real registry,
 * which is free of consequence in a test — a test is not in the browser's
 * import graph — and fails the moment the two disagree. That is the price of
 * the boundary, paid here rather than by a founder reading a stale list.
 */

const optionById = (id: string): AgentOption | undefined =>
  AGENT_OPTIONS.find((o) => o.id === id);

describe('the browser-safe occupant facts match the real registry', () => {
  it('covers every registered occupant, and invents none', () => {
    expect(OCCUPANT_FACTS.map((o) => o.occupantId).sort())
      .toEqual(ROLE_OCCUPANTS.map((o) => o.occupantId).sort());
  });

  it('reports each occupant’s role, name, hosts and adapter exactly', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      const facts = OCCUPANT_FACTS.find((o) => o.occupantId === occupant.occupantId);
      expect(facts, `${occupant.occupantId} has no browser-safe facts`).toBeDefined();
      expect(facts?.role).toBe(occupant.role);
      expect(facts?.displayName).toBe(occupant.displayName);
      expect(facts?.adapterAvailable).toBe(occupant.adapterAvailable);
      expect([...(facts?.environments ?? [])].sort()).toEqual([...occupant.environments].sort());
    }
  });

  it('reports THAT configuration is read, matching the registry, on both hosts', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      const facts = OCCUPANT_FACTS.find((o) => o.occupantId === occupant.occupantId);
      const onMachine = occupant.requiredConfig.length > 0;
      const onHost = occupant.requiredConfig.length + (occupant.hostedOnlyConfig?.length ?? 0) > 0;
      expect(facts?.needsServerConfig.founder_machine, occupant.occupantId).toBe(onMachine);
      expect(facts?.needsServerConfig.hosted, occupant.occupantId).toBe(onHost);
    }
  });

  it('names no server variable anywhere in the browser-safe module', () => {
    // The class barrier, not the instance. `browser-isolation.test.ts` catches
    // the OpenAI credential specifically; this catches the NEXT one, whatever
    // provider it belongs to, before it reaches a bundle.
    const source = readFileSync(
      join(process.cwd(), 'src', 'relay', 'ui', 'project-workspace', 'role-occupant-map.ts'),
      'utf8',
    );
    const named = new Set<string>();
    for (const occupant of ROLE_OCCUPANTS) {
      for (const name of [...occupant.requiredConfig, ...(occupant.hostedOnlyConfig ?? [])]) {
        named.add(name);
      }
    }
    expect(named.size, 'the registry names no configuration at all — this test proves nothing')
      .toBeGreaterThan(0);
    // The docstring may DISCUSS a credential as the reason this rule exists; a
    // declaration or a use is what would ship, so comments are stripped first.
    const outsideComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const name of named) {
      expect(outsideComments, `the browser-safe module names ${name}`).not.toContain(name);
    }
  });
});

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
  it('reports Claude Code as running in either place, because both occupants exist', () => {
    const claude = optionById('coding-claude-code') as AgentOption;
    expect(dispatchForAgentOption(claude, 'coding_agent', 'hosted').runsHere).toBe(true);
    expect(dispatchForAgentOption(claude, 'coding_agent', 'founder_machine').runsHere).toBe(true);
  });

  it('says a hosted Hermes reviewer reads configuration, without saying what', () => {
    const reviewer = optionById('reviewer-hermes') as AgentOption;
    const onHost = dispatchForAgentOption(reviewer, 'reviewer', 'hosted');
    // Only the remote service occupant runs on a hosted bridge, and it reads a
    // service URL and a token — so the answer is yes.
    expect(onHost.runsHere).toBe(true);
    expect(onHost.needsServerConfig).toBe(true);
  });

  it('answers for the occupant that would run, not for the strictest one', () => {
    // The local Hermes process reads nothing; the remote service does. On a
    // founder machine the answer is NO, because that is the occupant that
    // would run — answering for the stricter one would report configuration
    // this deployment never reads.
    const reviewer = optionById('reviewer-hermes') as AgentOption;
    expect(dispatchForAgentOption(reviewer, 'reviewer', 'founder_machine').needsServerConfig)
      .toBe(false);
  });

  it('reports an unmapped option as running nowhere', () => {
    const unmapped = AGENT_OPTIONS.find(
      (o) => o.role === 'reviewer' && OCCUPANTS_FOR_AGENT_OPTION[o.id] === undefined,
    );
    expect(unmapped).toBeDefined();
    const dispatch = dispatchForAgentOption(unmapped as AgentOption, 'reviewer', 'hosted');
    expect(dispatch.runsHere).toBe(false);
    expect(dispatch.occupants).toHaveLength(0);
  });

  it('answers UNKNOWN, not "nowhere", when no bridge is connected', () => {
    // A browser in the offline product has never seen a machine. Reporting
    // `false` there would be a claim about a computer that does not exist yet,
    // and the surface would tell the founder their choice cannot run when in
    // truth nothing has been asked.
    const claude = optionById('coding-claude-code') as AgentOption;
    const unknown = dispatchForAgentOption(claude, 'coding_agent', null);
    expect(unknown.runsHere).toBeNull();
    expect(unknown.needsServerConfig).toBeNull();
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
