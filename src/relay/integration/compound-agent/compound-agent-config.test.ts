import { describe, expect, it } from 'vitest';

import { JULIUS_DEFAULT_ROLES } from '../../mission/julius/julius-runtime';
import {
  COMPOUND_AGENT_SLOTS,
  authorizeCompoundAgentRead,
  checkCompoundAgentSlots,
  createCompoundAgentConfiguration,
  evaluateCompoundAgentReadiness,
  identityIsReservedForJulius,
  parseCompoundAgentDraft,
  updateCompoundAgentConfiguration,
  type CompoundAgentAuthority,
  type CompoundAgentDraft,
  type CompoundAgentSlot,
  type IntegrationDirectory,
  type IntegrationDirectoryEntry,
} from './index';

/**
 * THE CONFIGURATION BOUNDARY, ADVERSARIALLY.
 *
 * Every test here asks the same question from a different angle: can a
 * configuration reach Julius describing something its owner did not choose?
 * The answers that matter most are the refusals, so the refusals are what this
 * file spends its length on.
 */

/* ------------------------------------------------------------- fixtures */

const entry = (over: Partial<IntegrationDirectoryEntry> & { integrationId: string }): IntegrationDirectoryEntry => ({
  roles: ['CODING_AGENT'],
  enabled: true,
  capabilities: [],
  configurationRequirements: [],
  agentId: over.integrationId,
  adapterId: over.integrationId,
  independenceGroup: over.integrationId,
  ...over,
});

const ENTRIES: readonly IntegrationDirectoryEntry[] = [
  entry({
    integrationId: 'openai_gpt_architect',
    roles: ['PROMPT_ARCHITECT'],
    capabilities: ['planning', 'decomposition'],
    configurationRequirements: ['OPENAI_API_KEY', 'RELAY_PROMPT_ARCHITECT_MODE'],
    agentId: 'openai-prompt-architect',
    adapterId: 'openai-architect',
    independenceGroup: 'openai-gpt',
  }),
  entry({
    integrationId: 'claude_agent_sdk_hosted',
    roles: ['CODING_AGENT'],
    capabilities: ['code-edit', 'test-execution'],
    configurationRequirements: ['ANTHROPIC_API_KEY'],
    agentId: 'claude-agent-sdk',
    adapterId: 'claude-agent-sdk-hosted',
    independenceGroup: 'anthropic-claude',
  }),
  entry({
    integrationId: 'hermes_remote_service',
    roles: ['INDEPENDENT_REVIEWER'],
    capabilities: ['security-review', 'code-review'],
    configurationRequirements: ['RELAY_HERMES_SERVICE_URL'],
    agentId: 'hermes',
    adapterId: 'hermes',
    independenceGroup: 'hermes-xai',
  }),
  entry({
    integrationId: 'anthropic_reviewer',
    roles: ['INDEPENDENT_REVIEWER'],
    capabilities: ['code-review'],
    agentId: 'claude-reviewer',
    adapterId: 'claude-reviewer',
    // Same vendor group as the Coding Agent above — the review that looks
    // independent and is not.
    independenceGroup: 'anthropic-claude',
  }),
  entry({ integrationId: 'retired_reviewer', roles: ['INDEPENDENT_REVIEWER'], enabled: false }),
];

const directoryOf = (entries: readonly IntegrationDirectoryEntry[]): IntegrationDirectory => ({
  lookup: (id) => entries.find((e) => e.integrationId === id) ?? null,
});
const DIRECTORY = directoryOf(ENTRIES);

const AUTHORITY: CompoundAgentAuthority = {
  tenantId: 'tenant-sunday',
  projectId: 'prj-relay',
  ownerParticipant: 'ghu-1',
};

const SLOTS = [
  { role: 'PROMPT_ARCHITECT' as const, integrationId: 'openai_gpt_architect', requiredCapabilities: ['planning'] },
  { role: 'CODING_AGENT' as const, integrationId: 'claude_agent_sdk_hosted', requiredCapabilities: ['code-edit'] },
  { role: 'INDEPENDENT_REVIEWER' as const, integrationId: 'hermes_remote_service', requiredCapabilities: [] },
];

const DRAFT: CompoundAgentDraft = {
  compoundAgentId: 'agent-alpha',
  displayName: 'Alpha',
  slots: SLOTS,
  card: { referenceId: 'card-standard', revision: 'r7' },
  projectBrain: { referenceId: 'brain-relay', revision: 'b12' },
  missionDefaults: {
    executionMode: 'guided',
    reviewRequirement: 'independent',
    completionRule: 'strict',
    limits: { runtimeMinutes: 60, agentCalls: null, spendUsd: 5, reviewCycles: null, repairCycles: 3 },
  },
  activation: 'ACTIVE',
};

const created = () => createCompoundAgentConfiguration({
  draft: DRAFT, authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-27T00:00:00.000Z',
});

const reasons = (problems: readonly { reason: string }[]) => problems.map((p) => p.reason);

/* ------------------------------------------------------ derived vocabulary */

describe('worker slots are derived from Julius, not re-typed', () => {
  it('is exactly the Julius default role list', () => {
    expect(COMPOUND_AGENT_SLOTS).toEqual(JULIUS_DEFAULT_ROLES);
  });

  it('names the three permanent roles and no fourth', () => {
    expect([...COMPOUND_AGENT_SLOTS].sort())
      .toEqual(['CODING_AGENT', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT']);
  });
});

/* --------------------------------------------------- Julius is not a worker */

describe('Julius can never occupy a worker slot', () => {
  const SPELLINGS = [
    'julius', 'Julius', 'JULIUS', 'julius-runtime', 'relay_julius',
    'JULIUS.CORE', 'j-u-l-i-u-s', 'julius runtime v1', 'theJuliusHarness',
  ];

  for (const role of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as CompoundAgentSlot[]) {
    for (const spelling of SPELLINGS) {
      it(`refuses "${spelling}" for ${role} with the reserved-name reason`, () => {
        const slots = SLOTS.map((s) => (s.role === role ? { ...s, integrationId: spelling } : s));
        const problems = checkCompoundAgentSlots(slots, DIRECTORY);
        const reserved = problems.filter((p) => p.reason === 'julius_cannot_occupy_worker_slot');
        expect(reserved).toHaveLength(1);
        expect(reserved[0].role).toBe(role);
        // The remedy is architectural, not a spelling correction, so it must
        // NOT be reported as an unknown integration.
        expect(reasons(problems)).not.toContain('unknown_integration');
      });
    }
  }

  it('recognises the reserved name however it is punctuated', () => {
    for (const spelling of SPELLINGS) expect(identityIsReservedForJulius(spelling)).toBe(true);
  });

  it('does not reserve names that merely look similar', () => {
    for (const safe of ['julian_reviewer', 'juli', 'hermes', 'jules', 'iulius']) {
      expect(identityIsReservedForJulius(safe), `${safe} must not be reserved`).toBe(false);
    }
  });

  it('is over-broad by design where separators are stripped, and says so', () => {
    // Stripping separators is what catches a deliberately obfuscated
    // `j-u-l-i-u-s`. The cost is that a name which merely CONTAINS those
    // letters in order across separators is refused too. That trade is
    // deliberate and documented on `identityIsReservedForJulius`: refusing a
    // real integration is visible and recoverable — a product decision adds a
    // registry alias — while admitting Julius into a worker slot inverts the
    // architecture and is neither.
    expect(identityIsReservedForJulius('jul-ius-less')).toBe(true);
  });

  it('refuses Julius even when it would otherwise resolve, by running first', () => {
    // A registry that HAS been polluted with a Julius entry must still refuse.
    const polluted = directoryOf([
      ...ENTRIES,
      entry({ integrationId: 'julius', roles: ['CODING_AGENT'], capabilities: ['code-edit'] }),
    ]);
    const slots = SLOTS.map((s) => (s.role === 'CODING_AGENT' ? { ...s, integrationId: 'julius' } : s));
    expect(reasons(checkCompoundAgentSlots(slots, polluted)))
      .toContain('julius_cannot_occupy_worker_slot');
  });
});

/* --------------------------------------------------------- slot invariants */

describe('slot invariants', () => {
  it('accepts a coherent set of three', () => {
    expect(checkCompoundAgentSlots(SLOTS, DIRECTORY)).toEqual([]);
  });

  for (const role of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as CompoundAgentSlot[]) {
    it(`refuses a configuration missing the ${role} slot`, () => {
      const problems = checkCompoundAgentSlots(SLOTS.filter((s) => s.role !== role), DIRECTORY);
      const missing = problems.filter((p) => p.reason === 'role_slot_missing');
      expect(missing).toHaveLength(1);
      expect(missing[0].role).toBe(role);
    });

    it(`refuses a duplicated ${role} slot rather than picking one`, () => {
      const duplicate = SLOTS.find((s) => s.role === role)!;
      const problems = checkCompoundAgentSlots([...SLOTS, duplicate], DIRECTORY);
      const dup = problems.filter((p) => p.reason === 'role_slot_duplicated');
      expect(dup).toHaveLength(1);
      expect(dup[0].role).toBe(role);
    });
  }

  it('refuses an integration offered for a different slot', () => {
    const slots = SLOTS.map((s) => (s.role === 'CODING_AGENT'
      ? { ...s, integrationId: 'openai_gpt_architect', requiredCapabilities: [] }
      : s));
    expect(reasons(checkCompoundAgentSlots(slots, DIRECTORY))).toContain('integration_role_mismatch');
  });

  it('refuses an integration the registry does not declare', () => {
    const slots = SLOTS.map((s) => (s.role === 'CODING_AGENT'
      ? { ...s, integrationId: 'totally_made_up', requiredCapabilities: [] }
      : s));
    expect(reasons(checkCompoundAgentSlots(slots, DIRECTORY))).toContain('unknown_integration');
  });

  it('refuses a disabled integration with its own reason', () => {
    const slots = SLOTS.map((s) => (s.role === 'INDEPENDENT_REVIEWER'
      ? { ...s, integrationId: 'retired_reviewer', requiredCapabilities: [] }
      : s));
    const problems = checkCompoundAgentSlots(slots, DIRECTORY);
    expect(reasons(problems)).toContain('integration_disabled');
    // Disabled is not "unknown": the remedy is an operator action, not an edit.
    expect(reasons(problems)).not.toContain('unknown_integration');
  });

  it('refuses a capability the integration does not offer', () => {
    const slots = SLOTS.map((s) => (s.role === 'CODING_AGENT'
      ? { ...s, requiredCapabilities: ['formal-verification'] }
      : s));
    const problems = checkCompoundAgentSlots(slots, DIRECTORY);
    expect(reasons(problems)).toContain('capability_unsupported');
    expect(problems[0].safeMessage).toContain('formal-verification');
  });

  it('refuses a Reviewer in the Coding Agent\'s own vendor group', () => {
    const slots = SLOTS.map((s) => (s.role === 'INDEPENDENT_REVIEWER'
      ? { ...s, integrationId: 'anthropic_reviewer', requiredCapabilities: [] }
      : s));
    const problems = checkCompoundAgentSlots(slots, DIRECTORY);
    expect(reasons(problems)).toContain('reviewer_not_independent');
  });

  it('does not invent an independence verdict when a slot did not resolve', () => {
    const slots = SLOTS.filter((s) => s.role !== 'CODING_AGENT');
    expect(reasons(checkCompoundAgentSlots(slots, DIRECTORY))).not.toContain('reviewer_not_independent');
  });
});

/* -------------------------------------------------------------- parsing */

describe('parsing refuses rather than repairs', () => {
  const body = (over: Record<string, unknown>) => ({
    compoundAgentId: 'agent-alpha',
    displayName: 'Alpha',
    slots: SLOTS,
    card: { referenceId: 'card-standard', revision: 'r7' },
    projectBrain: { referenceId: 'brain-relay', revision: 'b12' },
    missionDefaults: DRAFT.missionDefaults,
    activation: 'ACTIVE',
    ...over,
  });

  it('accepts a well-formed body', () => {
    const parsed = parseCompoundAgentDraft(body({}));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.draft.slots).toHaveLength(3);
  });

  it('refuses an unrecognised execution mode instead of falling back', () => {
    const parsed = parseCompoundAgentDraft(body({
      missionDefaults: { ...DRAFT.missionDefaults, executionMode: 'yolo' },
    }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(reasons(parsed.problems)).toContain('invalid_mission_defaults');
  });

  it('refuses a negative or non-finite limit', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '5']) {
      const parsed = parseCompoundAgentDraft(body({
        missionDefaults: { ...DRAFT.missionDefaults, limits: { ...DRAFT.missionDefaults.limits, spendUsd: bad } },
      }));
      expect(parsed.ok, `spendUsd=${String(bad)} must be refused`).toBe(false);
      if (!parsed.ok) expect(reasons(parsed.problems)).toContain('invalid_limit');
    }
  });

  it('keeps null as "not set by this configuration"', () => {
    const parsed = parseCompoundAgentDraft(body({
      missionDefaults: { ...DRAFT.missionDefaults, limits: { ...DRAFT.missionDefaults.limits, spendUsd: null } },
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.draft.missionDefaults.limits.spendUsd).toBeNull();
  });

  it('refuses an id that is not path-safe', () => {
    for (const bad of ['../escape', 'has space', '', '-leading', 'a'.repeat(65)]) {
      const parsed = parseCompoundAgentDraft(body({ compoundAgentId: bad }));
      expect(parsed.ok, `id ${JSON.stringify(bad)} must be refused`).toBe(false);
      if (!parsed.ok) expect(reasons(parsed.problems)).toContain('invalid_identifier');
    }
  });

  it('refuses a pinned reference missing its revision', () => {
    const parsed = parseCompoundAgentDraft(body({ card: { referenceId: 'card-standard' } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(reasons(parsed.problems)).toContain('invalid_revision_reference');
  });

  it('refuses an unknown slot role', () => {
    const parsed = parseCompoundAgentDraft(body({
      slots: [...SLOTS, { role: 'JULIUS', integrationId: 'x', requiredCapabilities: [] }],
    }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(reasons(parsed.problems)).toContain('unknown_slot_role');
  });

  it('reports every problem, not just the first', () => {
    const parsed = parseCompoundAgentDraft({ compoundAgentId: '!!', displayName: '', slots: 'nope' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(reasons(parsed.problems)).toEqual(
        expect.arrayContaining(['invalid_identifier', 'invalid_display_name', 'role_slot_missing']),
      );
      expect(parsed.problems.length).toBeGreaterThan(2);
    }
  });

  it('never treats a missing body as an empty valid one', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(parseCompoundAgentDraft(bad).ok, `${JSON.stringify(bad)} must be refused`).toBe(false);
    }
  });
});

/* ---------------------------------------------------------------- writes */

describe('creating a configuration', () => {
  it('mints revision 1 and takes identity from the authority, never the body', () => {
    const result = created();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configuration.revision).toBe(1);
    expect(result.configuration.projectId).toBe(AUTHORITY.projectId);
    expect(result.configuration.tenantId).toBe(AUTHORITY.tenantId);
    expect(result.configuration.ownerParticipant).toBe(AUTHORITY.ownerParticipant);
  });

  it('reports readiness derived from the registry it was given', () => {
    const result = created();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readiness.ready).toBe(true);
    expect(result.readiness.configurationRequirements)
      .toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'RELAY_HERMES_SERVICE_URL', 'RELAY_PROMPT_ARCHITECT_MODE']);
    expect(result.readiness.notes.length).toBeGreaterThan(0);
  });

  it('refuses a draft whose slots do not resolve', () => {
    const result = createCompoundAgentConfiguration({
      draft: { ...DRAFT, slots: SLOTS.filter((s) => s.role !== 'CODING_AGENT') },
      authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-27T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });
});

describe('updating a configuration', () => {
  const current = () => {
    const result = created();
    if (!result.ok) throw new Error('fixture must create');
    return result.configuration;
  };

  it('increments the revision and preserves createdAt', () => {
    const before = current();
    const result = updateCompoundAgentConfiguration({
      current: before, draft: { ...DRAFT, displayName: 'Alpha II' }, expectedRevision: 1,
      authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-28T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configuration.revision).toBe(2);
    expect(result.configuration.displayName).toBe('Alpha II');
    expect(result.configuration.createdAt).toBe(before.createdAt);
    expect(result.configuration.updatedAt).toBe('2026-08-28T00:00:00.000Z');
  });

  it('refuses a stale revision rather than merging', () => {
    const result = updateCompoundAgentConfiguration({
      current: { ...current(), revision: 4 }, draft: DRAFT, expectedRevision: 3,
      authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-28T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(reasons(result.problems)).toContain('stale_configuration_revision');
  });

  it('refuses a caller from another tenant, project, or participant', () => {
    const table: Array<[Partial<CompoundAgentAuthority>, string]> = [
      [{ tenantId: 'tenant-other' }, 'tenant_mismatch'],
      [{ projectId: 'prj-other' }, 'project_mismatch'],
      [{ ownerParticipant: 'ghu-2' }, 'owner_mismatch'],
    ];
    for (const [override, expected] of table) {
      const result = updateCompoundAgentConfiguration({
        current: current(), draft: DRAFT, expectedRevision: 1,
        authority: { ...AUTHORITY, ...override }, directory: DIRECTORY, now: '2026-08-28T00:00:00.000Z',
      });
      expect(result.ok, `${expected} must refuse`).toBe(false);
      if (!result.ok) expect(reasons(result.problems)).toContain(expected);
    }
  });

  it('refuses an id change and never moves the record between projects', () => {
    const result = updateCompoundAgentConfiguration({
      current: current(), draft: { ...DRAFT, compoundAgentId: 'agent-beta' }, expectedRevision: 1,
      authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-28T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(reasons(result.problems)).toContain('invalid_identifier');
  });
});

/* -------------------------------------------------------------- readiness */

describe('readiness is derived, never stored', () => {
  const configuration = () => {
    const result = created();
    if (!result.ok) throw new Error('fixture must create');
    return result.configuration;
  };

  it('turns unready when an integration is disabled after the write', () => {
    const config = configuration();
    const later = directoryOf(ENTRIES.map((e) =>
      (e.integrationId === 'hermes_remote_service' ? { ...e, enabled: false } : e)));
    const readiness = evaluateCompoundAgentReadiness(config, later);
    expect(readiness.ready).toBe(false);
    expect(reasons(readiness.blockingProblems)).toContain('integration_disabled');
    // The stored record did not change; only the derived answer did.
    expect(config.revision).toBe(1);
  });

  it('refuses to be ready while the owner has not activated it', () => {
    for (const activation of ['DRAFT', 'RETIRED'] as const) {
      const readiness = evaluateCompoundAgentReadiness({ ...configuration(), activation }, DIRECTORY);
      expect(readiness.ready).toBe(false);
      expect(reasons(readiness.blockingProblems)).toContain('configuration_not_activated');
      expect(readiness.activation).toBe(activation);
    }
  });

  it('states what readiness does not prove', () => {
    const readiness = evaluateCompoundAgentReadiness(configuration(), DIRECTORY);
    expect(readiness.notes.join(' ')).toContain('never proof that a credential is valid');
  });

  it('lists configuration requirements as NAMES and never values', () => {
    const readiness = evaluateCompoundAgentReadiness(configuration(), DIRECTORY);
    for (const name of readiness.configurationRequirements) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

/* ---------------------------------------------------------- read authority */

describe('reading a stored configuration', () => {
  it('permits the owning authority and refuses every other', () => {
    const result = created();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(authorizeCompoundAgentRead(result.configuration, AUTHORITY).ok).toBe(true);
    const denied = authorizeCompoundAgentRead(result.configuration, { ...AUTHORITY, ownerParticipant: 'ghu-2' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(reasons(denied.problems)).toContain('owner_mismatch');
  });
});
