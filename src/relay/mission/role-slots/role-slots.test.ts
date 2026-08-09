import { describe, expect, it } from 'vitest';
import { ROLE_SLOTS, type RoleOccupant, type RoleSlot } from './role-slot-contracts';
import {
  DEVELOPMENT_DEFAULT_OCCUPANTS, ROLE_OCCUPANTS, findOccupant, occupantsForRole,
  registryIsComplete,
} from './role-slot-registry';
import {
  bindRoleSlots, occupantsAreIndependent, requestedOccupantId,
} from './role-slot-binding';

/**
 * Every configuration name any registered occupant declares. Used as the
 * "fully configured" environment so a test that means to exercise ONE refusal
 * is never accidentally also exercising `configuration_missing`.
 */
const ALL_NAMES: ReadonlySet<string> = new Set(
  ROLE_OCCUPANTS.flatMap((o) => [...o.requiredConfig, ...(o.hostedOnlyConfig ?? [])]),
);

const hosted = (requested: Partial<Record<RoleSlot, string>>, names = ALL_NAMES) => bindRoleSlots({
  requested,
  environment: 'hosted',
  configuredNames: names,
  allowDevelopmentDefaults: false,
});

const laptop = (requested: Partial<Record<RoleSlot, string>> = {}, names = ALL_NAMES) => bindRoleSlots({
  requested,
  environment: 'founder_machine',
  configuredNames: names,
  allowDevelopmentDefaults: true,
});

const reasons = (result: ReturnType<typeof bindRoleSlots>): string[] =>
  result.ok ? [] : result.problems.map((p) => p.reason);

describe('the role-slot registry', () => {
  it('registers at least one occupant and a resolvable default for every permanent role', () => {
    expect(registryIsComplete()).toBe(true);
    for (const role of ROLE_SLOTS) {
      expect(occupantsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it('carries no duplicate occupant id within a role', () => {
    for (const role of ROLE_SLOTS) {
      const ids = occupantsForRole(role).map((o) => o.occupantId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  /**
   * Configuration names are declared HERE and read by the bridge. Whether the
   * two agree is a fact about the bridge, so the parity assertion lives on the
   * bridge side (`relay-bridge/role-slots-parity.test.ts`) — this module stays
   * pure domain and imports no server code, not even in a test.
   */
  it('names configuration by variable name only, never by value', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      for (const name of occupant.requiredConfig) {
        expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  /**
   * The invariant that keeps the SHIPPED registry bindable. A future occupant
   * that quietly shares a vendor group with the implementer would make every
   * hosted mission refuse to start, and this fails at the moment it is added
   * rather than at the moment a founder runs a mission.
   */
  it('ships no Coding-Agent/Reviewer pair that its own independence rule would refuse', () => {
    for (const implementer of occupantsForRole('coding_agent')) {
      for (const reviewer of occupantsForRole('reviewer')) {
        expect(occupantsAreIndependent(implementer, reviewer)).toBe(true);
      }
    }
  });

  it('never claims an installed CLI can run on a hosted deployment', () => {
    const local = findOccupant('coding_agent', 'claude_code_local') as RoleOccupant;
    expect(local.environments).not.toContain('hosted');
    const localHermes = findOccupant('reviewer', 'hermes_local') as RoleOccupant;
    expect(localHermes.environments).not.toContain('hosted');
  });

  /** The hosted surface is API-billed. The local one is not. This is the exact
   *  distinction the hard-coded `billingPath: 'subscription'` erased. */
  it('separates the two Coding Agent billing paths', () => {
    expect((findOccupant('coding_agent', 'claude_code_local') as RoleOccupant).billingPath)
      .toBe('subscription');
    expect((findOccupant('coding_agent', 'claude_agent_sdk_hosted') as RoleOccupant).billingPath)
      .toBe('api');
  });
});

describe('binding a deployment request', () => {
  it('binds the development defaults on a founder machine', () => {
    const result = laptop();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bindings.coding_agent.occupant.occupantId).toBe('claude_code_local');
    expect(result.bindings.reviewer.occupant.occupantId).toBe('hermes_local');
    // THE UNMETERED ARCHITECT. A development default that names the API-billed
    // provider is the kind of default that becomes load-bearing later; before
    // role slots existed an unconfigured machine had no architect at all, so
    // there is no prior behaviour that required the paid one.
    expect(result.bindings.prompt_architect.occupant.occupantId).toBe('fusion_architect');
    expect(result.bindings.prompt_architect.occupant.billingPath).toBe('none');
  });

  it('binds a fully hosted combination', () => {
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'claude_agent_sdk_hosted',
      reviewer: 'hermes_remote_service',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bindings.coding_agent.requestedOccupantId).toBe('claude_agent_sdk_hosted');
  });

  /**
   * The asymmetry copied from `selectHermesMode`. A laptop may default; a
   * hosted deployment may not, because guessing which agent holds a role on a
   * machine the operator cannot see is the original bug in a new place.
   */
  it('refuses every unnamed slot on a hosted deployment instead of guessing', () => {
    const result = hosted({});
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual([
      'no_occupant_requested', 'no_occupant_requested', 'no_occupant_requested',
    ]);
  });

  /**
   * "No occupant is configured for the coding_agent role" is true and useless
   * to the operator who then has to go and discover what the variable is
   * called. The refusal names it.
   */
  it('names the variable that would configure an unnamed slot', () => {
    const result = bindRoleSlots({
      requested: {},
      environment: 'hosted',
      configuredNames: ALL_NAMES,
      allowDevelopmentDefaults: false,
      selectorNames: { coding_agent: 'RELAY_ROLE_CODING_AGENT' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const coding = result.problems.find((p) => p.role === 'coding_agent');
    expect(coding?.safeMessage).toContain('Set RELAY_ROLE_CODING_AGENT.');
    // A role with no declared selector says nothing rather than inventing one.
    const reviewer = result.problems.find((p) => p.role === 'reviewer');
    expect(reviewer?.safeMessage).not.toContain('Set ');
  });

  /**
   * Set-to-nonsense and not-set are opposite remedies. Collapsing them told an
   * operator "no occupant is configured" for a variable that is configured.
   */
  it('refuses a selector set to an invalid value differently from an unset one', () => {
    const result = bindRoleSlots({
      requested: { prompt_architect: 'fusion_architect', coding_agent: 'claude_code_local' },
      environment: 'founder_machine',
      configuredNames: ALL_NAMES,
      allowDevelopmentDefaults: true,
      invalidSelectors: ['reviewer'],
      selectorNames: { reviewer: 'RELAY_HERMES_MODE' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasons(result)).toEqual(['invalid_selector']);
    expect(result.problems[0].safeMessage).toContain('Set RELAY_HERMES_MODE.');
  });

  /**
   * An occupant with no adapter is refused. The shipped registry has no such
   * entry by design, so without the documented seam this branch could be
   * asserted and never executed.
   */
  it('refuses an occupant Relay ships no adapter for', () => {
    const result = bindRoleSlots({
      requested: {
        prompt_architect: 'fusion_architect',
        coding_agent: 'paper_agent',
        reviewer: 'hermes_local',
      },
      environment: 'founder_machine',
      configuredNames: ALL_NAMES,
      allowDevelopmentDefaults: false,
      occupants: [
        ...ROLE_OCCUPANTS.filter((o) => o.role !== 'coding_agent'),
        {
          ...(findOccupant('coding_agent', 'claude_code_local') as RoleOccupant),
          occupantId: 'paper_agent',
          adapterAvailable: false,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual(['adapter_unavailable']);
  });

  /**
   * Some configuration is required only where the gate it feeds is armed. The
   * Hermes trusted-origin allowlist is required on a server and deliberately
   * not on a laptop pointing at loopback — so binding must ask for it in one
   * environment and not the other, or it refuses a setup `checkServiceUrl`
   * permits.
   */
  it('requires hosted-only configuration on a host and not on a laptop', () => {
    const remote = findOccupant('reviewer', 'hermes_remote_service') as RoleOccupant;
    expect(remote.hostedOnlyConfig?.length).toBeGreaterThan(0);
    const withoutHostedOnly = new Set(
      [...ALL_NAMES].filter((n) => !(remote.hostedOnlyConfig ?? []).includes(n)),
    );

    const onHost = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'claude_agent_sdk_hosted',
      reviewer: 'hermes_remote_service',
    }, withoutHostedOnly);
    expect(onHost.ok).toBe(false);
    if (onHost.ok) return;
    expect(onHost.problems.find((p) => p.role === 'reviewer')?.reason)
      .toBe('configuration_missing');

    const onLaptop = bindRoleSlots({
      requested: {
        prompt_architect: 'openai_gpt_architect',
        coding_agent: 'claude_code_local',
        reviewer: 'hermes_remote_service',
      },
      environment: 'founder_machine',
      configuredNames: withoutHostedOnly,
      allowDevelopmentDefaults: false,
    });
    expect(onLaptop.ok).toBe(true);
  });

  it('resolves an unnamed slot to the development default only when defaults are allowed', () => {
    const request = {
      requested: {},
      environment: 'hosted' as const,
      configuredNames: ALL_NAMES,
      allowDevelopmentDefaults: false,
    };
    expect(requestedOccupantId(request, 'coding_agent')).toBeNull();
    expect(requestedOccupantId({ ...request, allowDevelopmentDefaults: true }, 'coding_agent'))
      .toBe(DEVELOPMENT_DEFAULT_OCCUPANTS.coding_agent);
  });

  it('refuses an occupant it does not know', () => {
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'some_agent_nobody_registered',
      reviewer: 'hermes_remote_service',
    });
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual(['unknown_occupant']);
  });

  /** A real occupant in the wrong slot is a different mistake from an invented
   *  name, and an operator fixes it differently. */
  it('distinguishes a real occupant in the wrong slot from an unknown one', () => {
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'hermes_remote_service',
      reviewer: 'hermes_remote_service',
    });
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual(['occupant_role_mismatch']);
  });

  it('refuses an installed-CLI occupant on a hosted deployment, naming what it does support', () => {
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'claude_code_local',
      reviewer: 'hermes_remote_service',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.problems.find((p) => p.role === 'coding_agent');
    expect(problem?.reason).toBe('environment_unsupported');
    expect(problem?.safeMessage).toContain('founder_machine');
  });

  it('refuses a hosted Coding Agent whose credential variable is unset, and names the variable', () => {
    // Read off the registry rather than restated here: a test that names the
    // variable independently keeps passing after the occupant stops needing it.
    const [credentialName] = (findOccupant('coding_agent', 'claude_agent_sdk_hosted') as RoleOccupant)
      .requiredConfig;
    const withoutKey = new Set([...ALL_NAMES].filter((n) => n !== credentialName));
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'claude_agent_sdk_hosted',
      reviewer: 'hermes_remote_service',
    }, withoutKey);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.problems.find((p) => p.role === 'coding_agent');
    expect(problem?.reason).toBe('configuration_missing');
    expect(problem?.safeMessage).toContain(credentialName);
  });

  /**
   * Reporting one problem at a time makes an operator fix, redeploy, and
   * discover the next. Two independent mistakes must arrive together.
   */
  it('reports every problem it finds rather than the first', () => {
    const result = hosted({
      prompt_architect: 'not_a_real_architect',
      coding_agent: 'claude_code_local',
      reviewer: 'hermes_remote_service',
    });
    expect(result.ok).toBe(false);
    expect(reasons(result).sort()).toEqual(['environment_unsupported', 'unknown_occupant']);
  });

  it('carries no configuration name into a message as a value', () => {
    const result = hosted({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const problem of result.problems) {
      expect(problem.safeMessage).not.toMatch(/sk-[A-Za-z0-9]/);
    }
  });
});

describe('reviewer independence at binding time', () => {
  const occupant = (over: Partial<RoleOccupant>): RoleOccupant => ({
    occupantId: 'test_occupant',
    role: 'reviewer',
    agentId: 'reviewer-agent',
    adapterId: 'reviewer-adapter',
    independenceGroup: 'reviewer-group',
    displayName: 'Test occupant',
    kind: 'harness_remote',
    environments: ['hosted'],
    adapterAvailable: true,
    billingPath: 'api',
    requiredConfig: [],
    verificationNotes: [],
    ...over,
  });

  const implementer = occupant({
    occupantId: 'test_implementer',
    role: 'coding_agent',
    agentId: 'impl-agent',
    adapterId: 'impl-adapter',
    independenceGroup: 'impl-group',
    kind: 'agent_sdk',
  });

  it('accepts a reviewer that differs in agent, adapter and group', () => {
    expect(occupantsAreIndependent(implementer, occupant({}))).toBe(true);
  });

  it.each([
    ['agent id', { agentId: 'impl-agent' }],
    ['adapter id', { adapterId: 'impl-adapter' }],
    ['vendor group', { independenceGroup: 'impl-group' }],
  ])('refuses a reviewer sharing the implementer\'s %s', (_label, over) => {
    expect(occupantsAreIndependent(implementer, occupant(over))).toBe(false);
  });

  /**
   * Executes the refusal branch of `bindRoleSlots` itself, through the
   * documented test-only registry seam. Without this the branch is asserted by
   * the shipped registry's invariant and never actually run.
   */
  it('refuses to bind a non-independent pair, before anything is dispatched', () => {
    const result = bindRoleSlots({
      requested: {
        prompt_architect: 'openai_gpt_architect',
        coding_agent: 'test_implementer',
        reviewer: 'same_vendor_reviewer',
      },
      environment: 'hosted',
      configuredNames: ALL_NAMES,
      allowDevelopmentDefaults: false,
      occupants: [
        ...ROLE_OCCUPANTS.filter((o) => o.role === 'prompt_architect'),
        implementer,
        occupant({
          occupantId: 'same_vendor_reviewer',
          // Everything differs except the vendor group — the "same vendor,
          // different model" review that looks independent and is not.
          agentId: 'other-agent',
          adapterId: 'other-adapter',
          independenceGroup: 'impl-group',
        }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasons(result)).toEqual(['reviewer_not_independent']);
    expect(result.problems[0].safeMessage).toContain('not an independent review');
  });

  it('does not report independence when one of the two slots failed to bind at all', () => {
    const result = hosted({
      prompt_architect: 'openai_gpt_architect',
      coding_agent: 'nope',
      reviewer: 'hermes_remote_service',
    });
    expect(reasons(result)).not.toContain('reviewer_not_independent');
  });
});
