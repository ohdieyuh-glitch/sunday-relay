import { describe, expect, it } from 'vitest';

import {
  RELAY_SKILLS,
  evaluateInternalSkillCall,
  evaluateSkillCall,
  findSkill,
  narrowSkill,
  skillChangesSomething,
  type RelaySkill,
} from './relay-skills';
import {
  MCP_AGENT_ROLES,
  evaluatePermission,
  type McpAgentRole,
  type McpPermissionEvaluationInput,
} from '../../mcp/policy/mcp-permissions';
import { MCP_RISK_CLASSES, type McpRiskClass } from '../../mcp/policy/mcp-risk';

/**
 * SKILLS ARE A NARROWING, NEVER A GRANT.
 *
 * The direction forbids a second judgement system, and the way that could go
 * wrong is not obvious: nobody writes `return 'allow'` in a skill catalogue on
 * purpose. It happens when a skill layer starts answering questions the
 * permission model was already answering, and drifts.
 *
 * So the central test does not inspect the code. It runs BOTH — the skill call
 * and `evaluatePermission` alone — across every role and every risk class, and
 * asserts the skill layer never returns a more permissive answer than the
 * permission model would have.
 */

/**
 * A grant that covers the capability under test.
 *
 * Without one, `evaluatePermission` denies everything for lack of a grant —
 * which made the first version of these tests compare "deny" with "deny" and
 * prove nothing. Grants name exact capabilities; there is deliberately no
 * wildcard, so each test names what it needs.
 */
const grantFor = (
  role: McpAgentRole,
  capabilityName: string,
  maximumRiskClass: McpRiskClass,
): McpPermissionEvaluationInput['grants'][number] => ({
  grantId: 'grant-1' as McpPermissionEvaluationInput['grants'][number]['grantId'],
  accountId: 'acct-1',
  workspaceId: 'ws-1',
  projectId: 'rly-100',
  missionId: 'msn-1',
  pspAgentFingerprint: null,
  role,
  registryEntryId: 'entry-1',
  capabilityKind: 'tool',
  capabilityNames: [capabilityName],
  maximumRiskClass,
  writablePathPrefixes: ['src/'],
  expiresAt: null,
  revokedAt: null,
});

const permission = (over: Partial<McpPermissionEvaluationInput> = {}): McpPermissionEvaluationInput => ({
  accountId: 'acct-1',
  workspaceId: 'ws-1',
  projectId: 'rly-100',
  missionId: 'msn-1',
  pspAgentFingerprint: null,
  actualAgentId: 'agent-1',
  role: 'coding-agent',
  // A verified identity: policy asks `trust`, never a declared name.
  serverIdentity: {
    configuredName: 'relay',
    requested: { name: 'relay', version: '1' },
    declared: { name: 'relay', version: '1' },
    verified: { name: 'relay', version: '1' },
    verificationMethod: 'registry_pin',
    trust: 'verified',
    observedOrigin: 'https://relay.invalid',
  } as unknown as McpPermissionEvaluationInput['serverIdentity'],
  registryEntryId: 'entry-1',
  capabilitySnapshotIsApproved: true,
  capabilityExistsInSnapshot: true,
  capabilityKind: 'tool',
  capabilityName: 'relay.workspace.write',
  normalizedArguments: {},
  riskClass: 'workspace_write',
  missingCredentialScopes: [],
  networkPolicyAllows: true,
  grants: [],
  missionWritablePathPrefixes: ['src/'],
  now: '2026-08-10T12:00:00.000Z',
  ...over,
});

const skill = (over: Partial<RelaySkill> = {}): RelaySkill => ({
  skillId: 'test.skill',
  version: 1,
  summary: 'A skill for testing.',
  capabilityKinds: ['tool'],
  highestRiskClass: 'read_only',
  permittedRoles: [...MCP_AGENT_ROLES],
  produces: 'analysis',
  requiredCapabilityNames: ['relay.workspace.write'],
  ...over,
});

describe('the skill layer never grants what the permission model would refuse', () => {
  it('is never more permissive, across every role and risk class', () => {
    // The whole rule, checked by running both rather than by reading either.
    for (const role of MCP_AGENT_ROLES) {
      for (const riskClass of MCP_RISK_CLASSES as readonly McpRiskClass[]) {
        const input = permission({
          role, riskClass,
          grants: [grantFor(role, 'relay.workspace.write', riskClass)],
          normalizedArguments: { path: 'src/app.ts' },
        });
        const alone = evaluatePermission(input);
        const viaSkill = evaluateSkillCall({
          skill: skill({ permittedRoles: [...MCP_AGENT_ROLES] }),
          capabilityName: input.capabilityName,
          permission: input,
        });

        if (alone.decision === 'deny') {
          expect(viaSkill.ok, `${role}/${riskClass}`).toBe(false);
        }
        if (viaSkill.ok) {
          // Whatever it allowed, the permission model allowed the same thing —
          // including `requires_approval`, which is passed through rather than
          // being resolved by the skill layer.
          expect(viaSkill.decision.decision, `${role}/${riskClass}`).toBe(alone.decision);
        }
      }
    }
  });

  it('passes requires_approval through instead of resolving it', () => {
    // Find a combination the permission model wants a human for, if the
    // defaults produce one; otherwise this assertion has nothing to hold and
    // says so rather than passing silently.
    let found = false;
    for (const role of MCP_AGENT_ROLES) {
      for (const riskClass of MCP_RISK_CLASSES as readonly McpRiskClass[]) {
        const input = permission({
          role, riskClass,
          grants: [grantFor(role, 'relay.workspace.write', riskClass)],
          normalizedArguments: { path: 'src/app.ts' },
        });
        if (evaluatePermission(input).decision !== 'requires_approval') continue;
        found = true;
        const viaSkill = evaluateSkillCall({
          skill: skill({ permittedRoles: [...MCP_AGENT_ROLES] }),
          capabilityName: input.capabilityName,
          permission: input,
        });
        expect(viaSkill.ok).toBe(true);
        if (viaSkill.ok) expect(viaSkill.decision.decision).toBe('requires_approval');
      }
    }
    expect(found, 'no role/risk combination requires approval — this test proved nothing').toBe(true);
  });
});

describe('a skill can only make an answer stricter', () => {
  it('refuses a role the skill does not permit, before any permission question', () => {
    const input = permission({
      role: 'architect',
      riskClass: 'read_only',
      capabilityName: 'relay.workspace.read',
      grants: [grantFor('architect', 'relay.workspace.read', 'read_only')],
    });
    // The permission model alone would not deny a read to an architect.
    expect(evaluatePermission(input).decision).not.toBe('deny');
    const viaSkill = evaluateSkillCall({
      skill: skill({ permittedRoles: ['coding-agent'], requiredCapabilityNames: ['relay.workspace.read'] }),
      capabilityName: 'relay.workspace.read',
      permission: input,
    });
    expect(viaSkill.ok).toBe(false);
    if (!viaSkill.ok) {
      expect(viaSkill.refusal).toBe('role_not_permitted_for_skill');
      // And it says so WITHOUT a permission decision, because none was asked.
      expect(viaSkill.decision).toBeNull();
    }
  });

  it('refuses a capability the skill never declared', () => {
    const viaSkill = evaluateSkillCall({
      skill: skill({ requiredCapabilityNames: ['relay.workspace.read'] }),
      capabilityName: 'relay.workspace.write',
      permission: permission({
        capabilityName: 'relay.workspace.write',
        grants: [grantFor('coding-agent', 'relay.workspace.write', 'workspace_write')],
        normalizedArguments: { path: 'src/app.ts' },
      }),
    });
    expect(viaSkill.ok).toBe(false);
    if (!viaSkill.ok) expect(viaSkill.refusal).toBe('capability_not_declared');
  });

  it('refuses an unregistered skill rather than falling back to a nearest match', () => {
    const viaSkill = evaluateSkillCall({
      skill: null, capabilityName: 'anything', permission: permission(),
    });
    if (viaSkill.ok) throw new Error('an unknown skill was allowed');
    expect(viaSkill.refusal).toBe('skill_unknown');
  });
});

describe('the shipped catalogue', () => {
  it('names only capabilities, and declares what each one produces', () => {
    for (const entry of RELAY_SKILLS) {
      expect(entry.requiredCapabilityNames.length, entry.skillId).toBeGreaterThan(0);
      // No wildcards, deliberately: a skill that can invoke anything is not a
      // skill, it is a shell.
      for (const name of entry.requiredCapabilityNames) {
        expect(name, entry.skillId).not.toContain('*');
      }
      expect(entry.permittedRoles.length, entry.skillId).toBeGreaterThan(0);
    }
  });

  it('lets only the coding agent change the workspace', () => {
    const edit = findSkill(RELAY_SKILLS, 'relay.repository.edit');
    expect(edit?.permittedRoles).toEqual(['coding-agent']);
    // The role defaults already carry this reasoning — an architect that can
    // write is a coding agent with a different name — and the skill must not
    // quietly widen it.
    expect(edit?.permittedRoles).not.toContain('architect');
  });

  it('distinguishes skills that change something from skills that do not', () => {
    expect(skillChangesSomething(findSkill(RELAY_SKILLS, 'relay.repository.edit') as RelaySkill)).toBe(true);
    expect(skillChangesSomething(findSkill(RELAY_SKILLS, 'relay.evidence.gather') as RelaySkill)).toBe(false);
    expect(skillChangesSomething(findSkill(RELAY_SKILLS, 'relay.repository.read') as RelaySkill)).toBe(false);
  });

  it('declares the HIGHEST risk each skill reaches, not an average', () => {
    const edit = findSkill(RELAY_SKILLS, 'relay.repository.edit');
    expect(edit?.highestRiskClass).toBe('workspace_write');
    const gather = findSkill(RELAY_SKILLS, 'relay.evidence.gather');
    expect(gather?.highestRiskClass).toBe('read_only');
  });
});

describe('finding a skill', () => {
  const catalogue: RelaySkill[] = [
    skill({ skillId: 'a', version: 1 }),
    skill({ skillId: 'a', version: 3 }),
    skill({ skillId: 'a', version: 2 }),
  ];

  it('returns the highest version when none is named', () => {
    expect(findSkill(catalogue, 'a')?.version).toBe(3);
  });

  it('returns exactly the version asked for', () => {
    expect(findSkill(catalogue, 'a', 2)?.version).toBe(2);
    // A version that does not exist is null, never the nearest one — a caller
    // pinning a version is pinning the permissions that came with it.
    expect(findSkill(catalogue, 'a', 9)).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(findSkill(catalogue, 'b')).toBeNull();
  });
});

/**
 * A SKILL OVER RELAY'S OWN OPERATIONS.
 *
 * The external path asks `evaluatePermission`, which has a server identity, an
 * approved snapshot and grants to reason about. Relay's own operations have
 * none of those and do not need them: Live Reach retrieval is already governed
 * by `evaluateLiveReach`, and a workspace write by the mission's write scope.
 *
 * So the governing verdict arrives as a PARAMETER, and the property worth
 * testing is the same asymmetry the external path has — the skill layer can
 * only ever take permission away.
 */
describe('a skill over an operation Relay governs itself', () => {
  const gather = findSkill(RELAY_SKILLS, 'relay.evidence.gather', 1);
  const edit = findSkill(RELAY_SKILLS, 'relay.repository.edit', 1);
  const ALLOWED = { allowed: true, detail: 'the Live Reach permission model allowed it' };
  const DENIED = { allowed: false, detail: 'read access to web is disabled for this project' };

  it('permits a declared capability, for a permitted role, that the governor allowed', () => {
    const decision = evaluateInternalSkillCall({
      skill: gather,
      capabilityName: 'relay.live_reach.retrieve',
      role: 'architect',
      missionAuthorisesChange: false,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(true);
  });

  it('CANNOT return ok when the governing judgement said no', () => {
    // The property. There is no combination of skill, role and mission
    // authority that turns a denial into a permission.
    for (const role of ['architect', 'reviewer', 'security-reviewer']) {
      for (const authorises of [true, false]) {
        const decision = evaluateInternalSkillCall({
          skill: gather,
          capabilityName: 'relay.live_reach.retrieve',
          role,
          missionAuthorisesChange: authorises,
          governing: DENIED,
        });
        expect(decision.ok, `${role}/${String(authorises)}`).toBe(false);
        if (!decision.ok) {
          expect(decision.refusal).toBe('permission_denied');
          // And it repeats the GOVERNOR's own words rather than inventing a
          // reason of its own.
          expect(decision.detail).toBe(DENIED.detail);
        }
      }
    }
  });

  it('refuses a role the skill never permitted, before consulting anything else', () => {
    const decision = evaluateInternalSkillCall({
      skill: gather,
      capabilityName: 'relay.live_reach.retrieve',
      role: 'coding-agent',
      missionAuthorisesChange: true,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.refusal).toBe('role_not_permitted_for_skill');
  });

  it('refuses a capability the skill did not declare, even when it is governed', () => {
    const decision = evaluateInternalSkillCall({
      skill: gather,
      capabilityName: 'relay.workspace.write',
      role: 'architect',
      missionAuthorisesChange: true,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.refusal).toBe('capability_not_declared');
  });

  it('refuses an unknown skill rather than a nearest match', () => {
    const decision = evaluateInternalSkillCall({
      skill: null,
      capabilityName: 'relay.live_reach.retrieve',
      role: 'architect',
      missionAuthorisesChange: false,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.refusal).toBe('skill_unknown');
  });

  it('refuses a CHANGING skill when the Mission asked only to read', () => {
    // And the reason names the MISSION, not the agent — an operator told
    // "permission denied" here would widen an entitlement that was never the
    // problem.
    const decision = evaluateInternalSkillCall({
      skill: edit,
      capabilityName: 'relay.workspace.write',
      role: 'coding-agent',
      missionAuthorisesChange: false,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.refusal).toBe('mission_does_not_authorize_change');
      expect(decision.detail).toContain('authorised only reading');
    }
  });

  it('does not ask a READING skill whether the Mission authorised a change', () => {
    // Gathering evidence changes nothing, so a read-only Mission runs it.
    const decision = evaluateInternalSkillCall({
      skill: gather,
      capabilityName: 'relay.live_reach.retrieve',
      role: 'architect',
      missionAuthorisesChange: false,
      governing: ALLOWED,
    });
    expect(decision.ok).toBe(true);
  });
});

describe('the narrowing is one implementation, not two', () => {
  it('gives the same verdict to both entry points', () => {
    // The drift this closes: two copies of "which role may run what" that
    // agree today and diverge the first time one is edited.
    const cases: [string, string][] = [
      ['architect', 'relay.live_reach.retrieve'],
      ['coding-agent', 'relay.live_reach.retrieve'],
      ['architect', 'relay.workspace.write'],
    ];
    for (const [role, capability] of cases) {
      const narrowed = narrowSkill({
        skill: findSkill(RELAY_SKILLS, 'relay.evidence.gather', 1), capabilityName: capability, role,
      });
      const internal = evaluateInternalSkillCall({
        skill: findSkill(RELAY_SKILLS, 'relay.evidence.gather', 1),
        capabilityName: capability,
        role,
        missionAuthorisesChange: true,
        governing: { allowed: true, detail: 'allowed' },
      });
      expect(internal.ok, `${role}/${capability}`).toBe(narrowed.ok);
      if (!narrowed.ok && !internal.ok) expect(internal.refusal).toBe(narrowed.refusal);
    }
  });
});
