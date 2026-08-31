import { describe, expect, it } from 'vitest';

import { buildMissionContract } from '../../mission';
import type { MissionSpec, RelayMissionContract } from '../../mission/contracts';
import { defaultMissionConfig, validateMissionConfig, type RelayMissionConfig } from '../../mission/mission-config';
import { REPOSITORY_PERMISSIONS } from '../../mission/repository-target';
import { ROLE_SLOTS } from '../../mission/role-slots';
import { projectTerminalEvent, type ProjectTerminalEventInput } from '../../mission/terminal';
import {
  COMPOUND_AGENT_SLOTS,
  checkCompoundAgentSlots,
  type IntegrationDirectory,
  type IntegrationDirectoryEntry,
} from '../compound-agent';
import { JULIUS_EVENT_ACTORS, TERMINAL_ROLE_LABELS, projectJuliusEvent } from '../terminal';
import {
  LEGACY_SOURCE_TO_ACTOR,
  PSP_COMPLETION_RULE_TO_MISSION_RULE,
  PSP_ROLE_KEYS,
  PSP_ROLE_KEY_TO_ROLE_SLOT,
  adaptLegacyTerminalEvent,
  convertLegacyMissionConfig,
  normalizeMissionContract,
  normalizeMissionSpec,
  roleMappingIsTotal,
  translateCompletionRule,
} from './index';

/**
 * LEGACY COMPATIBILITY, ADVERSARIALLY.
 *
 * Two properties matter more than any other here, because losing either is
 * silent: a conversion must preserve PROJECT IDENTITY and it must preserve
 * ACCEPTANCE CRITERIA. Everything else is about refusing to guess.
 */

/* ------------------------------------------------------------- fixtures */

const entry = (over: Partial<IntegrationDirectoryEntry> & { integrationId: string }): IntegrationDirectoryEntry => ({
  roles: ['CODING_AGENT'], enabled: true, capabilities: [], configurationRequirements: [],
  agentId: over.integrationId, adapterId: `${over.integrationId}-adapter`,
  independenceGroup: over.integrationId, ...over,
});

const ENTRIES: readonly IntegrationDirectoryEntry[] = [
  entry({ integrationId: 'openai_gpt_architect', roles: ['PROMPT_ARCHITECT'], independenceGroup: 'openai' }),
  entry({ integrationId: 'claude_agent_sdk_hosted', roles: ['CODING_AGENT'], independenceGroup: 'anthropic' }),
  entry({ integrationId: 'hermes_remote_service', roles: ['INDEPENDENT_REVIEWER'], independenceGroup: 'hermes' }),
];
const DIRECTORY: IntegrationDirectory = {
  lookup: (id) => ENTRIES.find((e) => e.integrationId === id) ?? null,
};

const config = (over: Partial<RelayMissionConfig> = {}): RelayMissionConfig => ({
  ...defaultMissionConfig(),
  roles: {
    architect: 'openai_gpt_architect',
    coding: 'claude_agent_sdk_hosted',
    reviewer: 'hermes_remote_service',
  },
  mode: 'semi',
  review: 'independent',
  completionRule: 'strict',
  permissions: ['read', 'write_worktree'],
  limits: { runtimeMinutes: 30, agentCalls: 12, spendUsd: 4, reviewCycles: 2, repairCycles: 1 },
  ...over,
});

const SPEC: MissionSpec = {
  title: 'Legacy mission',
  objective: 'Carry a legacy mission across the boundary without losing anything.',
  requirements: ['Project identity survives.'],
  constraints: ['No provider is contacted.'],
  acceptanceCriteria: [
    { id: 'ac-1', text: 'Project identity is preserved.', blocking: true },
    { id: 'ac-2', text: 'Every acceptance criterion is preserved.', blocking: true },
    { id: 'ac-3', text: 'Non-blocking criteria survive too.', blocking: false },
  ],
  filesInScope: ['src/relay/integration/legacy/legacy-adapters.ts'],
  filesOutOfScope: ['src/relay/mission/julius/julius-runtime.ts'],
  systemsInScope: ['relay-integration'],
  systemsOutOfScope: ['julius-runtime'],
  assumptions: [], decisions: [], unresolvedQuestions: [],
  requiredEvidence: ['TEST'], requiredReviewers: ['independent'],
  implementerRequirement: 'coding_agent', reviewerRequirement: 'independent',
  maximumRepairIterations: 2, maximumReviewRuns: 2,
  maximumCostUsd: 5, maximumRuntimeMinutes: 60,
  completionRule: 'all_blocking_criteria_and_independent_review',
  createdBy: 'ghu-1',
};

const contract = (over: Partial<RelayMissionContract> = {}): RelayMissionContract => {
  const built = buildMissionContract({
    spec: SPEC, missionId: 'msn-legacy', projectId: 'prj-legacy',
    now: '2026-08-27T00:00:00.000Z', provenance: 'live',
  });
  if (!built.ok) throw new Error('fixture must build');
  return { ...built.value, ...over };
};

const reasons = (problems: readonly { reason: string }[]) => problems.map((p) => p.reason);

/* ---------------------------------------------------------- the role map */

describe('three names for one role, mapped once', () => {
  it('is total in both directions', () => {
    expect(roleMappingIsTotal()).toBe(true);
    expect(PSP_ROLE_KEYS).toHaveLength(ROLE_SLOTS.length);
    for (const key of PSP_ROLE_KEYS) {
      expect(ROLE_SLOTS, key).toContain(PSP_ROLE_KEY_TO_ROLE_SLOT[key]);
    }
  });

  it('reaches every worker slot', () => {
    const conversion = convertLegacyMissionConfig(config(), DIRECTORY);
    expect(conversion.slots.map((s) => s.role).sort()).toEqual([...COMPOUND_AGENT_SLOTS].sort());
  });
});

/* -------------------------------------------------- the completion rules */

describe('Relay\'s two completion vocabularies', () => {
  it('translates the two that have an honest translation', () => {
    expect(translateCompletionRule('strict')).toBe('all_blocking_criteria_and_independent_review');
    expect(translateCompletionRule('balanced')).toBe('all_blocking_criteria');
    expect(Object.keys(PSP_COMPLETION_RULE_TO_MISSION_RULE).sort()).toEqual(['balanced', 'strict']);
  });

  it('refuses to translate `custom` rather than picking one', () => {
    expect(translateCompletionRule('custom')).toBeNull();
    const conversion = convertLegacyMissionConfig(config({ completionRule: 'custom' }), DIRECTORY);
    expect(reasons(conversion.problems)).toContain('completion_rule_not_translatable');
    expect(conversion.complete).toBe(false);
  });

  it('keeps `custom` visible in the defaults rather than erasing it', () => {
    const conversion = convertLegacyMissionConfig(config({ completionRule: 'custom' }), DIRECTORY);
    expect(conversion.missionDefaults.completionRule).toBe('custom');
  });
});

/* ------------------------------------------------------ PSP → Compound Agent */

describe('converting a saved PSP', () => {
  it('resolves all three slots from real selectors', () => {
    const conversion = convertLegacyMissionConfig(config(), DIRECTORY);
    expect(conversion.complete).toBe(true);
    expect(conversion.problems).toEqual([]);
    expect(conversion.unresolvedRoles).toEqual([]);
    expect(checkCompoundAgentSlots(conversion.slots, DIRECTORY)).toEqual([]);
  });

  it('carries mode, review and limits through unchanged', () => {
    const source = config();
    const conversion = convertLegacyMissionConfig(source, DIRECTORY);
    expect(conversion.missionDefaults.executionMode).toBe(source.mode);
    expect(conversion.missionDefaults.reviewRequirement).toBe(source.review);
    expect(conversion.missionDefaults.limits).toEqual(source.limits);
  });

  it('carries requested permissions unchanged, never re-deriving them', () => {
    for (const permissions of [[], ['read'], [...REPOSITORY_PERMISSIONS]] as const) {
      const conversion = convertLegacyMissionConfig(config({ permissions }), DIRECTORY);
      expect(conversion.requestedPermissions).toEqual(permissions);
      expect(conversion.missionDefaults.requestedPermissions).toEqual(permissions);
    }
  });

  it('REPORTS an unnamed role rather than filling it with a deployment default', () => {
    const conversion = convertLegacyMissionConfig(
      config({ roles: { architect: 'openai_gpt_architect', coding: null, reviewer: 'hermes_remote_service' } }),
      DIRECTORY,
    );
    expect(conversion.complete).toBe(false);
    expect(conversion.unresolvedRoles).toEqual(['CODING_AGENT']);
    expect(reasons(conversion.problems)).toContain('role_selection_absent');
    // And it still returns what it DID resolve, so a migration can pre-fill.
    expect(conversion.slots.map((s) => s.role).sort()).toEqual(['INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT']);
  });

  it('treats a blank selector exactly like an absent one', () => {
    const conversion = convertLegacyMissionConfig(
      config({ roles: { architect: '   ', coding: 'claude_agent_sdk_hosted', reviewer: 'hermes_remote_service' } }),
      DIRECTORY,
    );
    expect(conversion.unresolvedRoles).toEqual(['PROMPT_ARCHITECT']);
  });

  it('separates a removed integration from one in the wrong slot', () => {
    const removed = convertLegacyMissionConfig(
      config({ roles: { architect: 'gone_away', coding: 'claude_agent_sdk_hosted', reviewer: 'hermes_remote_service' } }),
      DIRECTORY,
    );
    expect(reasons(removed.problems)).toContain('role_selection_unknown');

    const wrongSlot = convertLegacyMissionConfig(
      config({ roles: { architect: 'claude_agent_sdk_hosted', coding: 'claude_agent_sdk_hosted', reviewer: 'hermes_remote_service' } }),
      DIRECTORY,
    );
    expect(reasons(wrongSlot.problems)).toContain('role_selection_wrong_slot');
  });

  it('converts the product\'s own default config without inventing occupants', () => {
    // `defaultMissionConfig()` names no role at all. Every slot must come back
    // unresolved — the honest answer — and none may be silently staffed.
    const conversion = convertLegacyMissionConfig(defaultMissionConfig(), DIRECTORY);
    expect(conversion.slots).toEqual([]);
    expect([...conversion.unresolvedRoles].sort()).toEqual([...COMPOUND_AGENT_SLOTS].sort());
  });

  it('accepts anything the legacy validator accepts, without crashing', () => {
    const bodies: unknown[] = [
      {}, { roles: {} }, { roles: { architect: 1 } }, { permissions: ['nope'] },
      { mode: 'yolo' }, { limits: {} }, null, [],
    ];
    for (const body of bodies) {
      const validated = validateMissionConfig(body);
      if (!validated.ok) continue;
      const conversion = convertLegacyMissionConfig(validated.value, DIRECTORY);
      expect(Array.isArray(conversion.slots), JSON.stringify(body)).toBe(true);
      expect(typeof conversion.complete).toBe('boolean');
    }
  });
});

/* -------------------------------------------------- mission normalization */

describe('normalizing a mission preserves what must never be lost', () => {
  it('preserves project identity from a built contract', () => {
    const result = normalizeMissionContract(contract());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.projectId).toBe('prj-legacy');
    expect(result.mission.missionId).toBe('msn-legacy');
  });

  it('preserves every acceptance criterion, id, text and blocking flag', () => {
    const source = contract();
    const result = normalizeMissionContract(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.acceptanceCriteria).toEqual(source.acceptanceCriteria);
    expect(result.mission.acceptanceCriteria).toHaveLength(3);
    expect(result.mission.acceptanceCriteria.filter((c) => c.blocking)).toHaveLength(2);
  });

  it('preserves the four scope axes and the completion rule', () => {
    const source = contract();
    const result = normalizeMissionContract(source);
    if (!result.ok) throw new Error('must normalize');
    expect(result.mission.scope).toEqual({
      filesInScope: source.filesInScope, filesOutOfScope: source.filesOutOfScope,
      systemsInScope: source.systemsInScope, systemsOutOfScope: source.systemsOutOfScope,
    });
    expect(result.mission.completionRule).toBe(source.completionRule);
    expect(result.mission.revision).toBe(source.revision);
    expect(result.mission.bindingDigest).toBe(source.bindingDigest);
  });

  it('refuses a contract with no project or mission identity', () => {
    for (const broken of [{ projectId: '' }, { missionId: '' }, { projectId: '  ' }]) {
      const result = normalizeMissionContract(contract(broken));
      expect(result.ok, JSON.stringify(broken)).toBe(false);
      if (!result.ok) expect(reasons(result.problems)).toContain('mission_identity_missing');
    }
  });

  it('refuses a mission with no acceptance criteria rather than adding one', () => {
    const result = normalizeMissionContract(contract({ acceptanceCriteria: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(reasons(result.problems)).toContain('acceptance_criteria_missing');
  });

  it('takes the project from the CALLER for an authored spec, which has none', () => {
    const result = normalizeMissionSpec(SPEC, 'prj-from-authorization');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.projectId).toBe('prj-from-authorization');
    expect(result.mission.acceptanceCriteria).toEqual(SPEC.acceptanceCriteria);
  });

  it('leaves an unbound spec\'s revision and digest UNKNOWN rather than inventing them', () => {
    const result = normalizeMissionSpec(SPEC, 'prj-1');
    if (!result.ok) throw new Error('must normalize');
    expect(result.mission.missionId).toBeNull();
    expect(result.mission.revision).toBeNull();
    expect(result.mission.bindingDigest).toBeNull();
  });

  it('refuses a spec with no project supplied', () => {
    const result = normalizeMissionSpec(SPEC, '  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(reasons(result.problems)).toContain('mission_identity_missing');
  });

  it('normalizes a spec and its built contract to the same content', () => {
    const fromSpec = normalizeMissionSpec(SPEC, 'prj-legacy');
    const fromContract = normalizeMissionContract(contract());
    if (!fromSpec.ok || !fromContract.ok) throw new Error('both must normalize');
    expect(fromSpec.mission.objective).toBe(fromContract.mission.objective);
    expect(fromSpec.mission.acceptanceCriteria).toEqual(fromContract.mission.acceptanceCriteria);
    expect(fromSpec.mission.scope).toEqual(fromContract.mission.scope);
    expect(fromSpec.mission.completionRule).toBe(fromContract.mission.completionRule);
  });
});

/* ------------------------------------------------ legacy terminal events */

describe('pre-Julius ledger events render in the same terminal', () => {
  const legacy = (over: Partial<ProjectTerminalEventInput> = {}): ProjectTerminalEventInput => ({
    sequence: 1, at: '2026-08-27T04:00:00.000Z', source: 'coding-agent',
    kind: 'agent.report_created', safeSummary: 'Report returned.', provenance: 'live', ...over,
  });

  it('maps every legacy source onto a permanent label', () => {
    for (const source of Object.keys(LEGACY_SOURCE_TO_ACTOR)) {
      const actor = LEGACY_SOURCE_TO_ACTOR[source];
      expect(JULIUS_EVENT_ACTORS, source).toContain(actor);
      expect(TERMINAL_ROLE_LABELS[actor], source).toBeTruthy();
    }
  });

  it('adds no eleventh label for the legacy `user` source', () => {
    expect(LEGACY_SOURCE_TO_ACTOR.user).toBe('RELAY_SYSTEM');
    expect(Object.keys(TERMINAL_ROLE_LABELS)).toHaveLength(JULIUS_EVENT_ACTORS.length);
  });

  it('renders a legacy event through the same projection', () => {
    const entry = projectJuliusEvent(adaptLegacyTerminalEvent(legacy(), 'run-1'));
    expect(entry.line).toBe('[Coding Agent] Report returned.');
    expect(entry.runId).toBe('run-1');
    expect(entry.sequence).toBe(1);
  });

  it('gives a legacy event the SAME redaction the Julius path gets', () => {
    const leaky = legacy({ safeSummary: 'pushed with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' /* relay-boundary:allow-fixture */ });
    const entry = projectJuliusEvent(adaptLegacyTerminalEvent(leaky, 'run-1'));
    expect(entry.line).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' /* relay-boundary:allow-fixture */);
    expect(entry.redactionsApplied).toBeGreaterThan(0);
    // And the legacy projector agreed it was a secret, so this is a
    // continuation of the existing rule rather than a new one.
    expect(projectTerminalEvent(leaky).redactionsApplied).toBeGreaterThan(0);
  });

  it('omits private reasoning on the legacy path too', () => {
    const reasoning = legacy({ safeSummary: 'chain of thought: try the other adapter' });
    const entry = projectJuliusEvent(adaptLegacyTerminalEvent(reasoning, 'run-1'));
    expect(entry.omittedPrivateReasoning).toBe(true);
    expect(entry.line).not.toContain('other adapter');
  });

  it('sends an unrecognised source to Relay System rather than dropping the event', () => {
    const entry = projectJuliusEvent(adaptLegacyTerminalEvent(legacy({ source: 'some-future-thing' }), 'run-1'));
    expect(entry.actor).toBe('RELAY_SYSTEM');
    expect(entry.line).toContain('Report returned.');
  });

  it('carries the legacy event id when it has one and derives it when it does not', () => {
    expect(adaptLegacyTerminalEvent(legacy({ eventId: 'evt-abc' }), 'run-1').eventId).toBe('evt-abc');
    expect(adaptLegacyTerminalEvent(legacy({ sequence: 9 }), 'run-1').eventId).toBe('evt_9');
  });

  it('leaves severity UNKNOWN rather than guessing a second default', () => {
    expect(adaptLegacyTerminalEvent(legacy(), 'run-1').severity).toBeNull();
  });
});
