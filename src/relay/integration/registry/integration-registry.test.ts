import { describe, expect, it } from 'vitest';

import { REVIEWER_HARNESS_CAPABILITIES, findCatalogEntry } from '../../mission/reviewer-harness';
import { ROLE_OCCUPANTS, ROLE_SLOTS } from '../../mission/role-slots';
import {
  COMPOUND_AGENT_SLOTS,
  checkCompoundAgentSlots,
  identityIsReservedForJulius,
  type IntegrationDirectory,
} from '../compound-agent';
import {
  COMPOUND_AGENT_SLOT_TO_ROLE_SLOT,
  INTEGRATION_AVAILABILITIES,
  RELAY_INTEGRATIONS,
  ROLE_SLOT_TO_COMPOUND_AGENT_SLOT,
  applyObservedAvailability,
  createIntegrationDirectory,
  findIntegration,
  integrationsForSlot,
  slotsWithNoEnabledIntegration,
} from './index';

/**
 * THE REGISTRY, HELD AGAINST ITS SOURCE.
 *
 * The registry's whole value is that it is DERIVED. So most of this file
 * compares it with the module it is derived from rather than with a literal
 * written here — a literal would be a second hand-written list, which is the
 * thing the registry exists to remove.
 */

describe('the registry is derived, not written', () => {
  it('projects every registered occupant', () => {
    const occupantIds = ROLE_OCCUPANTS.map((o) => o.occupantId).sort();
    const integrationIds = RELAY_INTEGRATIONS.map((i) => i.integrationId).sort();
    expect(integrationIds).toEqual(occupantIds);
  });

  it('carries each occupant\'s declared configuration NAMES unchanged', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      const integration = findIntegration(occupant.occupantId);
      expect(integration, occupant.occupantId).not.toBeNull();
      expect(integration!.configurationRequirements).toEqual(occupant.requiredConfig);
      expect(integration!.hostedOnlyConfigurationRequirements).toEqual(occupant.hostedOnlyConfig ?? []);
    }
  });

  it('maps each occupant into exactly the matching worker slot', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      const integration = findIntegration(occupant.occupantId)!;
      expect(integration.roles).toEqual([ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[occupant.role]]);
    }
  });

  it('finds nothing for an id it does not have, and never a nearest match', () => {
    for (const missing of ['', 'openai', 'openai_gpt_architec', 'OPENAI_GPT_ARCHITECT']) {
      expect(findIntegration(missing), missing).toBeNull();
    }
  });
});

describe('the role mapping is total in both directions', () => {
  it('maps every Relay role slot to a worker slot', () => {
    for (const role of ROLE_SLOTS) {
      const mapped = ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[role];
      expect(COMPOUND_AGENT_SLOTS, `${role} maps outside the worker slots`).toContain(mapped);
    }
  });

  it('maps every worker slot back to a Relay role slot', () => {
    for (const slot of COMPOUND_AGENT_SLOTS) {
      const mapped = COMPOUND_AGENT_SLOT_TO_ROLE_SLOT[slot];
      expect(ROLE_SLOTS, `${slot} maps outside the Relay role slots`).toContain(mapped);
    }
  });

  it('round-trips both ways', () => {
    for (const role of ROLE_SLOTS) {
      expect(COMPOUND_AGENT_SLOT_TO_ROLE_SLOT[ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[role]]).toBe(role);
    }
    for (const slot of COMPOUND_AGENT_SLOTS) {
      expect(ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[COMPOUND_AGENT_SLOT_TO_ROLE_SLOT[slot]]).toBe(slot);
    }
  });
});

describe('Julius is never a selectable integration', () => {
  it('appears nowhere in the registry', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      expect(identityIsReservedForJulius(integration.integrationId), integration.integrationId).toBe(false);
      expect(identityIsReservedForJulius(integration.adapterId), integration.adapterId).toBe(false);
      expect(identityIsReservedForJulius(integration.agentId), integration.agentId).toBe(false);
    }
  });

  it('is absent from every slot listing', () => {
    for (const slot of COMPOUND_AGENT_SLOTS) {
      for (const integration of integrationsForSlot(slot)) {
        expect(identityIsReservedForJulius(integration.integrationId)).toBe(false);
      }
    }
  });
});

describe('capabilities are proven, and an empty list says which kind of empty', () => {
  it('reports only capabilities the harness catalog proves', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      const entry = findCatalogEntry(integration.adapterId);
      if (entry === null) {
        expect(integration.capabilitySource).toBe('none_declared');
        expect(integration.capabilities).toEqual([]);
        continue;
      }
      expect(integration.capabilitySource).toBe('reviewer_harness_catalog');
      expect(integration.capabilities)
        .toEqual(REVIEWER_HARNESS_CAPABILITIES.filter((c) => entry.capabilities[c]));
    }
  });

  it('never advertises a capability the catalog leaves unproven', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      const entry = findCatalogEntry(integration.adapterId);
      if (entry === null) continue;
      for (const capability of integration.capabilities) {
        expect(entry.capabilities[capability as never], `${integration.integrationId}/${capability}`).toBe(true);
      }
    }
  });

  it('has at least one integration of each kind of emptiness, so both branches are real', () => {
    const sources = new Set(RELAY_INTEGRATIONS.map((i) => i.capabilitySource));
    expect(sources.has('none_declared')).toBe(true);
    expect(sources.has('reviewer_harness_catalog')).toBe(true);
  });
});

describe('the registry never exposes a credential', () => {
  /** Anything that could be a secret VALUE rather than a variable NAME. */
  const SECRET_SHAPES = [
    /sk-[A-Za-z0-9]{8,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{12,}/,
    /BEGIN [A-Z ]*PRIVATE KEY/, /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
    // An Authorization HEADER VALUE, not the English word. The first version
    // of this rule was /\bBearer\s+\S+/i and it matched a verification note
    // reading "the bearer token goes nowhere else" — prose ABOUT a credential,
    // which is exactly what a truthful registry is supposed to contain. A
    // guard that fires on the word rather than the shape trains its reader to
    // ignore it.
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/, /xox[baprs]-/,
  ];

  it('holds no secret-shaped string anywhere in any entry', () => {
    const serialized = JSON.stringify(RELAY_INTEGRATIONS);
    for (const shape of SECRET_SHAPES) {
      expect(shape.test(serialized), `registry matched ${shape}`).toBe(false);
    }
  });

  it('lists configuration requirements as environment variable NAMES', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      for (const name of [
        ...integration.configurationRequirements,
        ...integration.hostedOnlyConfigurationRequirements,
      ]) {
        expect(name, `${integration.integrationId} declares ${name}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('carries no field that could hold a value read from an environment', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      const keys = Object.keys(integration);
      for (const forbidden of ['apiKey', 'token', 'secret', 'credential', 'sessionId', 'password']) {
        expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
      }
    }
  });
});

describe('availability is honest', () => {
  const NAMES = RELAY_INTEGRATIONS.flatMap((i) => [
    ...i.configurationRequirements, ...i.hostedOnlyConfigurationRequirements,
  ]);

  it('is unknown until something is observed', () => {
    for (const integration of RELAY_INTEGRATIONS) {
      expect(INTEGRATION_AVAILABILITIES).toContain(integration.availability);
      if (integration.enabled) expect(integration.availability).toBe('unknown');
      else expect(integration.availability).toBe('adapter_unavailable');
    }
  });

  it('reports environment_unsupported where the occupant cannot run at all', () => {
    const hosted = applyObservedAvailability(RELAY_INTEGRATIONS, {
      environment: 'hosted', presentConfigurationNames: NAMES,
    });
    const localOnly = RELAY_INTEGRATIONS.filter((i) => i.enabled && !i.environments.includes('hosted'));
    expect(localOnly.length, 'the fixture needs a local-only occupant to be meaningful').toBeGreaterThan(0);
    for (const integration of localOnly) {
      const applied = hosted.find((i) => i.integrationId === integration.integrationId)!;
      expect(applied.availability, integration.integrationId).toBe('environment_unsupported');
    }
  });

  it('reports configuration_missing when a declared NAME was not observed', () => {
    const none = applyObservedAvailability(RELAY_INTEGRATIONS, {
      environment: 'founder_machine', presentConfigurationNames: [],
    });
    const requiring = RELAY_INTEGRATIONS.filter(
      (i) => i.enabled && i.environments.includes('founder_machine') && i.configurationRequirements.length > 0,
    );
    expect(requiring.length).toBeGreaterThan(0);
    for (const integration of requiring) {
      expect(none.find((i) => i.integrationId === integration.integrationId)!.availability)
        .toBe('configuration_missing');
    }
  });

  it('reports configuration_present when every declared NAME was observed', () => {
    const all = applyObservedAvailability(RELAY_INTEGRATIONS, {
      environment: 'founder_machine', presentConfigurationNames: NAMES,
    });
    for (const integration of all) {
      if (!integration.enabled) continue;
      if (!integration.environments.includes('founder_machine')) continue;
      expect(integration.availability, integration.integrationId).toBe('configuration_present');
    }
  });

  it('applies hosted-only requirements only on a hosted deployment', () => {
    const withHostedOnly = RELAY_INTEGRATIONS.filter(
      (i) => i.enabled && i.hostedOnlyConfigurationRequirements.length > 0 && i.environments.includes('hosted'),
    );
    expect(withHostedOnly.length, 'the fixture needs a hosted-only requirement').toBeGreaterThan(0);
    for (const integration of withHostedOnly) {
      const baseNames = integration.configurationRequirements;
      const hosted = applyObservedAvailability([integration], {
        environment: 'hosted', presentConfigurationNames: baseNames,
      })[0];
      const local = applyObservedAvailability([integration], {
        environment: 'founder_machine', presentConfigurationNames: baseNames,
      })[0];
      expect(hosted.availability).toBe('configuration_missing');
      expect(local.availability).toBe('configuration_present');
    }
  });

  it('never turns configuration_present into a claim that a credential is valid', () => {
    // Asserted STRUCTURALLY rather than by matching the wording of a note.
    // Two occupants disclaim credential validity in two different sentences,
    // both truthful; a regex over prose would have to be widened for every
    // new phrasing and would go stale as a guard while still passing.
    //
    // The invariant that actually matters has two halves, and both are
    // mechanical: no availability value NAMES a validity claim, and upgrading
    // availability never removes the caveats the occupant declared.
    for (const value of INTEGRATION_AVAILABILITIES) {
      expect(value, `${value} reads as a validity claim`)
        .not.toMatch(/^(ready|connected|valid|verified|healthy|working)$/);
    }
    const before = RELAY_INTEGRATIONS;
    const after = applyObservedAvailability(before, {
      environment: 'founder_machine', presentConfigurationNames: NAMES,
    });
    const credentialed = before.filter((i) => i.configurationRequirements.some((n) => n.endsWith('_API_KEY')));
    expect(credentialed.length).toBeGreaterThan(0);
    for (const integration of credentialed) {
      const upgraded = after.find((i) => i.integrationId === integration.integrationId)!;
      expect(upgraded.availability).toBe('configuration_present');
      expect(upgraded.verificationNotes).toEqual(integration.verificationNotes);
      expect(upgraded.verificationNotes.length, integration.integrationId).toBeGreaterThan(0);
    }
  });
});

describe('the registry satisfies the configuration validator directly', () => {
  it('is accepted as the validator\'s directory without translation', () => {
    const directory: IntegrationDirectory = createIntegrationDirectory();
    expect(directory.lookup('claude_agent_sdk_hosted')).not.toBeNull();
    expect(directory.lookup('nope')).toBeNull();
  });

  it('composes a real, coherent three-slot configuration from live entries', () => {
    const directory = createIntegrationDirectory();
    const pick = (slot: Parameters<typeof integrationsForSlot>[0]) =>
      integrationsForSlot(slot).find((i) => i.enabled && !i.developmentOnly)!;
    const architect = pick('PROMPT_ARCHITECT');
    const coding = pick('CODING_AGENT');
    const reviewer = integrationsForSlot('INDEPENDENT_REVIEWER')
      .find((i) => i.enabled && i.independenceGroup !== coding.independenceGroup)!;
    expect([architect, coding, reviewer].every(Boolean)).toBe(true);

    const problems = checkCompoundAgentSlots([
      { role: 'PROMPT_ARCHITECT', integrationId: architect.integrationId, requiredCapabilities: [] },
      { role: 'CODING_AGENT', integrationId: coding.integrationId, requiredCapabilities: [] },
      { role: 'INDEPENDENT_REVIEWER', integrationId: reviewer.integrationId, requiredCapabilities: [] },
    ], directory);
    expect(problems).toEqual([]);
  });

  it('refuses a real reviewer that shares the real coding agent\'s vendor group', () => {
    const coding = integrationsForSlot('CODING_AGENT').find((i) => i.enabled)!;
    const architect = integrationsForSlot('PROMPT_ARCHITECT').find((i) => i.enabled)!;
    // Fabricate only the ONE fact under test: a reviewer in the coding agent's
    // group. Everything else stays a real registry entry.
    const shadowed = createIntegrationDirectory([
      ...RELAY_INTEGRATIONS,
      { ...coding, integrationId: 'shadow_reviewer', roles: ['INDEPENDENT_REVIEWER'] },
    ]);
    const problems = checkCompoundAgentSlots([
      { role: 'PROMPT_ARCHITECT', integrationId: architect.integrationId, requiredCapabilities: [] },
      { role: 'CODING_AGENT', integrationId: coding.integrationId, requiredCapabilities: [] },
      { role: 'INDEPENDENT_REVIEWER', integrationId: 'shadow_reviewer', requiredCapabilities: [] },
    ], shadowed);
    expect(problems.map((p) => p.reason)).toContain('reviewer_not_independent');
  });
});

describe('every worker slot can actually be filled', () => {
  it('has at least one enabled integration per slot', () => {
    expect(slotsWithNoEnabledIntegration()).toEqual([]);
  });

  it('marks development paths so a surface cannot present one as a real run', () => {
    const development = RELAY_INTEGRATIONS.filter((i) => i.developmentOnly);
    expect(development.length).toBeGreaterThan(0);
    for (const integration of development) {
      expect(integration.kind).toBe('development_engine');
      expect(integration.verificationNotes.join(' ')).toMatch(/development path/i);
    }
  });
});
