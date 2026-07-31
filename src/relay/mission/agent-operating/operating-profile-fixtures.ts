/**
 * SUNDAY RELAY — OPERATING-PROFILE DEVELOPMENT FIXTURES.
 *
 * Deterministic, SIMULATED profiles for the three Relay agent roles. No
 * mission ran, no provider was called, no runtime was attached.
 *
 * DISCLOSED BY CONSTRUCTION. Every fixture runtime carries
 * `executionMode: 'simulated'`, and the projection derives its disclosure
 * banner from that field — so a surface cannot present these as live activity
 * by forgetting a flag. `availability` is `'not_connected'`, because nothing
 * is attached and saying otherwise would be a lie about the product.
 *
 * The environment is described truthfully: no worktree exists yet, so
 * `worktree` is `null` and the inspector says `Local workspace`.
 *
 * PURE DATA. No I/O, no provider, and structurally no place to put a secret.
 */

import { defaultModePolicy, type RelayMode } from '../modes';
import { buildAgentOperatingProfile } from './operating-profile-builder';
import type {
  RelayAgentOperatingProfile,
  RelayAgentRole,
  RelayEnvironmentReference,
  RelayRuntimeReference,
} from './operating-profile-types';
import { RELAY_AGENT_ROLES } from './operating-profile-types';
import type { RelayMissionContract } from '../contracts';

export const OPERATING_FIXTURE_AT = '2026-07-30T12:00:00.000Z';
export const OPERATING_FIXTURE_MISSION = 'mission-123';
export const OPERATING_FIXTURE_PROJECT = 'project-sunday';
export const OPERATING_FIXTURE_MODE: RelayMode = 'guided';

/**
 * A minimal Mission Contract for the fixtures. It is a real
 * `RelayMissionContract` — the profile REFERENCES it rather than copying it,
 * which is the property the tests check.
 */
export const OPERATING_FIXTURE_CONTRACT: RelayMissionContract = Object.freeze({
  missionId: OPERATING_FIXTURE_MISSION,
  projectId: OPERATING_FIXTURE_PROJECT,
  title: 'Add the agent operating foundation',
  objective: 'Give every Relay Dog a runtime, a Mission Contract, an environment and explicit tools.',
  requirements: ['Four canonical operating components', 'One shared projection'],
  constraints: ['No provider calls', 'No new Relay roles'],
  acceptanceCriteria: [{ id: 'ac-1', text: 'Both surfaces agree', blocking: true }],
  filesInScope: [],
  filesOutOfScope: [],
  systemsInScope: [],
  systemsOutOfScope: [],
  assumptions: [],
  decisions: [],
  unresolvedQuestions: [],
  requiredEvidence: [],
  requiredReviewers: [],
  implementerRequirement: 'coding_agent',
  reviewerRequirement: 'independent',
  maximumRepairIterations: 1,
  maximumReviewRuns: 2,
  maximumCostUsd: null,
  maximumRuntimeMinutes: null,
  completionRule: 'all_blocking_criteria_and_independent_review',
  status: 'in_progress',
  revision: 4,
  bindingDigest: 'fixture-binding-digest',
  createdAt: OPERATING_FIXTURE_AT,
  updatedAt: OPERATING_FIXTURE_AT,
  createdBy: 'founder',
  updatedBy: 'founder',
  provenance: 'simulated',
});

/**
 * The environment as it ACTUALLY is in this build: one local workspace, no
 * isolated worktree, no network.
 */
export const OPERATING_FIXTURE_ENVIRONMENT: RelayEnvironmentReference = Object.freeze({
  projectId: OPERATING_FIXTURE_PROJECT,
  repository: 'sunday-relay',
  branch: 'main',
  worktree: null,
  workspaceKind: 'local_workspace',
  terminalAvailable: true,
  networkPolicy: 'no_network',
  projectBrainAccess: true,
  access: 'editable',
  runtimeVersions: Object.freeze(['node 22']),
  accessibleFileCount: null,
});

/** The runtime each role was ASKED for. Nothing is attached to any of them. */
const REQUESTED: Readonly<Record<RelayAgentRole, string>> = Object.freeze({
  prompt_architect: 'Prompt Architect',
  coding_agent: 'Claude Code',
  reviewer: 'Codex Reviewer',
});

function fixtureRuntime(role: RelayAgentRole): RelayRuntimeReference {
  return {
    requestedAgentType: REQUESTED[role],
    // Nothing ran, so nothing is known about what actually would have.
    actualAgentType: null,
    adapterId: null,
    modelVersion: null,
    executionMode: 'simulated',
    availability: 'not_connected',
  };
}

/** The fixture profile for one role. */
export function operatingProfileFixture(role: RelayAgentRole): RelayAgentOperatingProfile {
  return buildAgentOperatingProfile({
    role,
    runtime: fixtureRuntime(role),
    contract: OPERATING_FIXTURE_CONTRACT,
    mode: OPERATING_FIXTURE_MODE,
    environment: OPERATING_FIXTURE_ENVIRONMENT,
    policy: defaultModePolicy(OPERATING_FIXTURE_MODE, OPERATING_FIXTURE_AT),
  });
}

/** All three roles, in canonical order. */
export function operatingProfileFixtures(): readonly RelayAgentOperatingProfile[] {
  return RELAY_AGENT_ROLES.map(operatingProfileFixture);
}
