import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { defaultModePolicy } from '../modes';
import {
  NOT_CONNECTED_LABEL,
  RELAY_AGENT_ROLES,
  RELAY_KNOWN_TOOL_IDS,
  RELAY_OPERATING_COMPONENTS,
  RELAY_ROLE_TOOL_GRANTS,
  buildAgentOperatingProfile,
  missionContractReference,
  operatingProfileFixture,
  operatingProfileFixtures,
  projectAgentOperatingProfile,
  runtimeReferenceFromAttestation,
  toolGrantsForRole,
  toolGrantsOutsidePolicy,
  toolGrantsWithinPolicy,
  unknownRuntimeReference,
  OPERATING_FIXTURE_CONTRACT,
  OPERATING_FIXTURE_ENVIRONMENT,
  OPERATING_FIXTURE_MODE,
  type RelayAgentOperatingProfile,
  type RelayAgentRole,
} from './index';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * THE AGENT OPERATING FOUNDATION.
 *
 * A Relay Dog is a visible compound-agent identity operating through a
 * RUNTIME, under a MISSION CONTRACT, inside an ENVIRONMENT, using explicitly
 * granted TOOLS. These tests hold that sentence to the code: all four
 * components for all three roles, no fourth role, no duplicated contract, no
 * secret, no invented provider, and one projection both surfaces render.
 */

describe('the four canonical operating components', () => {
  for (const role of RELAY_AGENT_ROLES) {
    it(`${role} has a runtime, a mission contract, an environment and tools`, () => {
      const profile = operatingProfileFixture(role);

      expect(profile.role).toBe(role);
      // Runtime.
      expect(profile.runtime.requestedAgentType.trim()).not.toBe('');
      expect(profile.runtime).toHaveProperty('executionMode');
      expect(profile.runtime).toHaveProperty('availability');
      // Mission Contract — a reference with a stable identity.
      expect(profile.missionContract.missionId).toBe(OPERATING_FIXTURE_CONTRACT.missionId);
      expect(profile.missionContract.revision).toBe(OPERATING_FIXTURE_CONTRACT.revision);
      expect(profile.missionContract.bindingDigest).toBe(OPERATING_FIXTURE_CONTRACT.bindingDigest);
      // Environment.
      expect(profile.environment.repository.trim()).not.toBe('');
      expect(profile.environment).toHaveProperty('access');
      // Tools — explicitly granted, never empty for a real role.
      expect(profile.tools.length).toBeGreaterThan(0);
    });
  }

  it('the projection renders exactly the four components, in canonical order', () => {
    for (const profile of operatingProfileFixtures()) {
      const projection = projectAgentOperatingProfile(profile);
      expect(projection.rows.map((r) => r.component)).toEqual([...RELAY_OPERATING_COMPONENTS]);
      expect(projection.rows.map((r) => r.label)).toEqual([
        'Runtime', 'Mission Contract', 'Environment', 'Tools',
      ]);
      // No row may be blank — a component with nothing to say is a component
      // nobody can account for.
      for (const row of projection.rows) expect(row.value.trim()).not.toBe('');
    }
  });
});

describe('no additional top-level Relay role is introduced', () => {
  it('there are exactly three agent roles', () => {
    expect([...RELAY_AGENT_ROLES]).toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('the role union is DERIVED from the canonical MissionRole, not re-typed', () => {
    // A second hand-written union is how a fourth role appears without anyone
    // deciding to add one. This asserts the derivation is still in the source.
    const source = read('src/relay/mission/agent-operating/operating-profile-types.ts');
    expect(source).toContain("Extract<MissionRole, 'prompt_architect' | 'coding_agent' | 'reviewer'>");
    expect(source).toContain("import type { MissionRole } from '../wire-contracts'");
  });

  it('research, testing, verification and repair are capabilities, never roles', () => {
    const roles = new Set<string>(RELAY_AGENT_ROLES);
    for (const notARole of ['research', 'researcher', 'testing', 'tester', 'verification', 'verifier', 'repair']) {
      expect(roles.has(notARole)).toBe(false);
    }
    // Research IS a Prompt Architect tool; testing IS a Coding Agent tool.
    expect(RELAY_ROLE_TOOL_GRANTS.prompt_architect.map((g) => g.toolId)).toContain('research');
    expect(RELAY_ROLE_TOOL_GRANTS.coding_agent.map((g) => g.toolId)).toContain('run_tests');
  });
});

describe('the Mission Contract is referenced, never duplicated', () => {
  it('the reference carries identity and display fields only', () => {
    const reference = missionContractReference(OPERATING_FIXTURE_CONTRACT, OPERATING_FIXTURE_MODE);
    expect(Object.keys(reference).sort()).toEqual(
      ['bindingDigest', 'completionRule', 'missionId', 'mode', 'revision', 'status', 'title'].sort(),
    );
  });

  it('an agent profile carries none of the contract’s instruction bodies', () => {
    // These are the fields that make the Mission Contract the system-level
    // instruction source. Copying any of them into a profile would create a
    // second, divergable source of the same instructions.
    const forbidden = [
      'requirements', 'constraints', 'acceptanceCriteria', 'objective',
      'filesInScope', 'filesOutOfScope', 'systemsInScope', 'systemsOutOfScope',
      'assumptions', 'decisions', 'unresolvedQuestions', 'requiredEvidence',
    ];
    for (const profile of operatingProfileFixtures()) {
      const serialized = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
      const reference = serialized.missionContract as Record<string, unknown>;
      for (const field of forbidden) {
        expect(field in serialized, `profile duplicates ${field}`).toBe(false);
        expect(field in reference, `mission reference duplicates ${field}`).toBe(false);
      }
    }
  });

  it('the contract remains the system-instruction source, with no second prompt field', () => {
    const source = read('src/relay/mission/agent-operating/operating-profile-types.ts');
    // A user-editable system prompt beside the Mission Contract is exactly the
    // thing this foundation must not introduce.
    for (const smell of ['systemPrompt', 'system_prompt', 'instructions:', 'promptOverride']) {
      expect(source).not.toContain(smell);
    }
    for (const profile of operatingProfileFixtures()) {
      const keys = Object.keys(JSON.parse(JSON.stringify(profile)) as object);
      expect(keys.sort()).toEqual(['environment', 'missionContract', 'role', 'runtime', 'tools']);
    }
  });
});

describe('runtime truth', () => {
  it('missing runtime information stays unknown — never an invented provider', () => {
    const runtime = unknownRuntimeReference('Claude Code');
    expect(runtime.actualAgentType).toBeNull();
    expect(runtime.adapterId).toBeNull();
    expect(runtime.modelVersion).toBeNull();
    expect(runtime.availability).toBe('unknown');

    const projection = projectAgentOperatingProfile({
      ...operatingProfileFixture('coding_agent'),
      runtime,
    });
    expect(projection.runtimeLabel).toBe('Claude Code · Unknown');
  });

  it('a requested-but-unattached runtime reads "Not connected", not a model name', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    expect(projection.runtimeLabel).toContain(NOT_CONNECTED_LABEL);
    // No fixture may imply an adapter or model is active.
    expect(projection.runtimeLabel).not.toMatch(/claude-3|gpt-|sonnet|opus/i);
  });

  it('the ACTUAL runtime is preferred over the requested one once one is verified', () => {
    const runtime = runtimeReferenceFromAttestation({
      requestedAgentType: 'Claude Code',
      actualAgentType: 'Claude Code 2.1',
      adapterId: 'claude-code',
      modelVersion: 'model-x',
      launchVerified: true,
      provenance: 'live',
    });
    expect(runtime.availability).toBe('connected');
    const projection = projectAgentOperatingProfile({
      ...operatingProfileFixture('coding_agent'),
      runtime,
    });
    expect(projection.runtimeLabel).toBe('Claude Code 2.1 · model-x');
    expect(projection.simulated).toBe(false);
    expect(projection.dataSourceLabel).toBeNull();
  });

  it('an unverified launch is NOT connected, however much was requested', () => {
    const runtime = runtimeReferenceFromAttestation({
      requestedAgentType: 'Claude Code',
      actualAgentType: 'Claude Code',
      adapterId: 'claude-code',
      modelVersion: null,
      launchVerified: false,
      provenance: 'live',
    });
    expect(runtime.availability).toBe('not_connected');
  });
});

describe('environment truth', () => {
  it('no raw secret can appear in a projected environment string', () => {
    for (const profile of operatingProfileFixtures()) {
      const projection = projectAgentOperatingProfile(profile);
      const text = [projection.environmentLabel, ...projection.rows.map((r) => r.value)].join(' ');
      for (const shape of [
        /sk-[A-Za-z0-9-]{8,}/, /AKIA[0-9A-Z]{8,}/, /ghp_[A-Za-z0-9]{8,}/,
        /Bearer\s+\S+/i, /password\s*[:=]/i, /token\s*[:=]/i, /secret\s*[:=]/i,
        /api[_-]?key\s*[:=]/i,
      ]) {
        expect(shape.test(text), `${shape} appeared in ${text}`).toBe(false);
      }
    }
  });

  it('the environment shape has no field that could carry a credential', () => {
    for (const profile of operatingProfileFixtures()) {
      const keys = Object.keys(profile.environment).map((k) => k.toLowerCase());
      for (const forbidden of ['env', 'secret', 'token', 'key', 'password', 'credential', 'variables']) {
        expect(keys.some((k) => k.includes(forbidden)), `environment exposes ${forbidden}`).toBe(false);
      }
    }
  });

  it('a worktree that does not exist is never claimed', () => {
    // Isolated worktrees are not implemented, so the truthful answer is a
    // local workspace — not an isolation Relay does not provide.
    expect(OPERATING_FIXTURE_ENVIRONMENT.worktree).toBeNull();
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    expect(projection.environmentLabel).toBe('sunday-relay · main · Local workspace');
    expect(projection.environmentLabel).not.toMatch(/worktree/i);
  });

  it('a worktree IS named once one genuinely exists', () => {
    const profile: RelayAgentOperatingProfile = {
      ...operatingProfileFixture('coding_agent'),
      environment: { ...OPERATING_FIXTURE_ENVIRONMENT, worktree: 'wt-7' },
    };
    expect(projectAgentOperatingProfile(profile).environmentLabel).toContain('Worktree wt-7');
  });
});

describe('tools are explicitly granted, and bounded by the mode policy', () => {
  it('every role has an explicit, non-empty grant list', () => {
    for (const role of RELAY_AGENT_ROLES) {
      const grants = toolGrantsForRole(role);
      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants) {
        expect(grant.toolId.trim()).not.toBe('');
        expect(grant.label.trim()).not.toBe('');
        expect(RELAY_KNOWN_TOOL_IDS).toContain(grant.toolId);
      }
    }
  });

  it('the granted set is exactly the documented starting catalogue', () => {
    expect(RELAY_ROLE_TOOL_GRANTS.prompt_architect.map((g) => g.toolId)).toEqual([
      'read_project', 'read_project_brain', 'research', 'search_documentation',
      'create_requirements', 'create_handoff',
    ]);
    expect(RELAY_ROLE_TOOL_GRANTS.coding_agent.map((g) => g.toolId)).toEqual([
      'read_files', 'edit_assigned_files', 'search_code', 'run_commands',
      'run_tests', 'inspect_build', 'safe_git',
    ]);
    expect(RELAY_ROLE_TOOL_GRANTS.reviewer.map((g) => g.toolId)).toEqual([
      'read_diff', 'read_files', 'inspect_tests', 'inspect_trace',
      'inspect_capsules', 'create_findings',
    ]);
  });

  it('a grant may not exceed the mode policy, and a prohibited one is dropped', () => {
    const policy = defaultModePolicy('guided', '2026-07-30T12:00:00.000Z');
    for (const role of RELAY_AGENT_ROLES) {
      expect(toolGrantsWithinPolicy(toolGrantsForRole(role), policy)).toBe(true);
    }

    // A policy that forbids the capability refuses the grant…
    const forbidding = { prohibitedTools: ['run_tests', 'deploy'] };
    expect(toolGrantsOutsidePolicy(toolGrantsForRole('coding_agent'), forbidding)
      .map((g) => g.toolId)).toEqual(['run_tests']);

    // …and the builder DROPS it rather than displaying a capability the
    // policy forbids.
    const built = buildAgentOperatingProfile({
      role: 'coding_agent',
      runtime: unknownRuntimeReference('Claude Code'),
      contract: OPERATING_FIXTURE_CONTRACT,
      mode: OPERATING_FIXTURE_MODE,
      environment: OPERATING_FIXTURE_ENVIRONMENT,
      policy: forbidding,
    });
    expect(built.tools.map((g) => g.toolId)).not.toContain('run_tests');
    expect(built.tools.map((g) => g.toolId)).toContain('read_files');
  });

  it('`safe_git` survives a `git push` prohibition — the distinction it was named for', () => {
    const policy = defaultModePolicy('guided', '2026-07-30T12:00:00.000Z');
    expect(policy.prohibitedTools).toContain('git push');
    expect(toolGrantsOutsidePolicy(toolGrantsForRole('coding_agent'), policy)).toEqual([]);
  });
});

describe('simulated data is disclosed, never presented as live', () => {
  it('every fixture profile is simulated and says so', () => {
    for (const profile of operatingProfileFixtures()) {
      expect(profile.runtime.executionMode).toBe('simulated');
      const projection = projectAgentOperatingProfile(profile);
      expect(projection.simulated).toBe(true);
      expect(projection.dataSourceLabel).toContain('SIMULATED DATA');
      expect(projection.executionModeLabel).toBe('Simulated');
    }
  });

  it('no fixture claims an adapter or model is active', () => {
    for (const profile of operatingProfileFixtures()) {
      expect(profile.runtime.adapterId).toBeNull();
      expect(profile.runtime.modelVersion).toBeNull();
      expect(profile.runtime.availability).toBe('not_connected');
    }
  });

  it('the disclosure is derived from the data, not from a caller’s flag', () => {
    // A surface cannot turn the banner off, because it is computed from the
    // execution mode rather than passed in.
    const live = projectAgentOperatingProfile({
      ...operatingProfileFixture('reviewer'),
      runtime: { ...operatingProfileFixture('reviewer').runtime, executionMode: 'live' },
    });
    expect(live.dataSourceLabel).toBeNull();
    expect(live.simulated).toBe(false);
  });
});

describe('one canonical projection', () => {
  it('is pure: the same profile projects identically every time', () => {
    const profile = operatingProfileFixture('reviewer');
    expect(projectAgentOperatingProfile(profile)).toEqual(projectAgentOperatingProfile(profile));
  });

  it('labels each role once, for every surface', () => {
    expect(operatingProfileFixtures().map((p) => projectAgentOperatingProfile(p).roleLabel))
      .toEqual(['Prompt Architect', 'Coding Agent', 'Reviewer']);
  });

  it('an empty grant list reads as none granted, never as a blank row', () => {
    const projection = projectAgentOperatingProfile({
      ...operatingProfileFixture('reviewer'),
      tools: [],
    });
    expect(projection.toolsLabel).toBe('None granted');
  });
});

describe('the Relay Dog identity and animations are untouched', () => {
  it('this feature adds no dog state and no animation', () => {
    const source = [
      read('src/relay/mission/agent-operating/operating-profile-types.ts'),
      read('src/relay/mission/agent-operating/operating-profile-projection.ts'),
      read('src/relay/mission/agent-operating/operating-profile-tools.ts'),
      read('src/relay/mission/agent-operating/operating-profile-builder.ts'),
    ].join('\n');
    for (const smell of ['DOG_STATES', 'DogState', 'computeDogActivity', 'renderDogFrames', '@keyframes']) {
      expect(source).not.toContain(smell);
    }
  });

  it('the canonical dog module still exposes its states unchanged', () => {
    const dog = read('src/relay/mission/dog.ts');
    expect(dog).toContain('export const DOG_STATES');
    expect(dog).toContain('export function computeDogActivity');
  });
});

/** A role that is not one of the three cannot be projected at all. */
describe('the role union is closed', () => {
  it('rejects an unknown role at the type boundary and at runtime', () => {
    const roles: readonly string[] = RELAY_AGENT_ROLES;
    expect(roles).not.toContain('relay');
    // `relay` is the orchestrator, not an agent with an operating profile.
    const fromCanonical: RelayAgentRole[] = ['prompt_architect', 'coding_agent', 'reviewer'];
    expect(fromCanonical.every((r) => roles.includes(r))).toBe(true);
  });
});
