/**
 * SUNDAY RELAY — AGENT OPERATING FOUNDATION.
 *
 * THE CANONICAL PRODUCT STATEMENT this file encodes:
 *
 *   A Relay Dog is a visible compound-agent identity operating through a
 *   RUNTIME, under a MISSION CONTRACT, inside an ENVIRONMENT, using
 *   explicitly granted TOOLS.
 *
 * Those four components are the whole foundation. This module is PURE and
 * browser-safe: types and pure functions only, no I/O, no provider, no
 * secrets, no second source of truth.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not an agent framework, not a plugin
 * marketplace, not a persistence layer, and not a second workflow engine. It
 * adds no Relay role: the three agent roles are DERIVED from the canonical
 * `MissionRole` by `Extract`, so a fourth role cannot appear here without
 * first appearing in the canonical union — which `agent-operating.test.ts`
 * asserts against.
 *
 * NO DUPLICATE TYPES. Every enumeration below either is canonical already or
 * is derived from a canonical one:
 *
 *   role            Extract<MissionRole, …>            wire-contracts.ts
 *   execution mode  Provenance                         protocol/enums.ts
 *   mission mode    RelayMode                          mission/modes.ts
 *   completion rule MissionCompletionRule              mission/contracts.ts
 *   mission status  MissionStatus                      mission/contracts.ts
 *
 * The runtime, environment and tool-grant shapes are new because no canonical
 * shape existed for them — but their FIELDS are named after, and populated
 * from, `RelayExecutionAttestation` and `RelayModePolicy` respectively.
 */

import type { Provenance } from '../../protocol/enums';
import type { MissionCompletionRule, MissionStatus } from '../contracts';
import type { RelayMode } from '../modes';
import type { MissionRole } from '../wire-contracts';

/* ------------------------------------------------------------------ role */

/**
 * THE ONLY THREE AGENT ROLES. `relay` is the orchestrator, not an agent with
 * an operating profile, so it is excluded — but the union is DERIVED from the
 * canonical `MissionRole` rather than re-typed, so these can never drift from
 * it and a new top-level role cannot be smuggled in here.
 *
 * Research is a Prompt Architect capability, testing is a Coding Agent tool
 * capability, verification is a Relay and Reviewer capability, and repair is a
 * workflow that returns work to the Coding Agent. None of them is a role.
 */
export type RelayAgentRole = Extract<MissionRole, 'prompt_architect' | 'coding_agent' | 'reviewer'>;

export const RELAY_AGENT_ROLES: readonly RelayAgentRole[] = [
  'prompt_architect',
  'coding_agent',
  'reviewer',
] as const;

/* --------------------------------------------------------------- runtime */

/**
 * IS THE RUNTIME ACTUALLY THERE? Kept separate from the execution mode,
 * because "which adapter was asked for" and "is anything connected" are
 * different questions and conflating them is how a surface ends up claiming a
 * provider is active when it is not.
 */
export const RELAY_RUNTIME_AVAILABILITIES = ['connected', 'not_connected', 'unknown'] as const;
export type RelayRuntimeAvailability = (typeof RELAY_RUNTIME_AVAILABILITIES)[number];

/**
 * WHAT IS ACTUALLY PERFORMING THE WORK.
 *
 * Field names mirror `RelayExecutionAttestation`, which is where these values
 * come from once a run exists. `null` means GENUINELY UNKNOWN and renders as
 * `Unknown` — never as a plausible-looking provider name. Relay does not
 * invent provider identity.
 */
export interface RelayRuntimeReference {
  /** The runtime that was ASKED for — e.g. `claude-code`. Always known. */
  readonly requestedAgentType: string;
  /** The runtime that actually ran, when a run has reported one. */
  readonly actualAgentType: string | null;
  readonly adapterId: string | null;
  readonly modelVersion: string | null;
  /** Canonical provenance: `simulated` | `live` | `imported` | `manual`. */
  readonly executionMode: Provenance;
  readonly availability: RelayRuntimeAvailability;
}

/* ------------------------------------------------------- mission contract */

/**
 * A STABLE REFERENCE TO THE MISSION CONTRACT — never a copy of it.
 *
 * The Mission Contract is the canonical source of the agent's system-level
 * instructions, and there is exactly one of it. Copying its requirements,
 * constraints and acceptance criteria into every agent profile would create a
 * second, divergable source of the same instructions — and a second hidden
 * system prompt is precisely what this foundation must not introduce.
 *
 * So this carries the IDENTITY (`missionId` + `revision` + `bindingDigest`,
 * which is what makes a handoff stale) plus only the few fields a compact
 * inspector row must display. Anything more is read from the contract itself.
 *
 * `agent-operating.test.ts` asserts this shape carries none of the contract's
 * instruction arrays.
 */
export interface RelayMissionContractReference {
  readonly missionId: string;
  readonly revision: number;
  /** Deterministic digest of the contract's BINDING fields. */
  readonly bindingDigest: string;
  /** Concise display only — the contract remains authoritative. */
  readonly title: string;
  readonly mode: RelayMode;
  readonly status: MissionStatus;
  readonly completionRule: MissionCompletionRule;
}

/* ----------------------------------------------------------- environment */

export const RELAY_ENVIRONMENT_ACCESS = ['read_only', 'editable'] as const;
export type RelayEnvironmentAccess = (typeof RELAY_ENVIRONMENT_ACCESS)[number];

export const RELAY_NETWORK_POLICIES = ['no_network', 'approved_only', 'unknown'] as const;
export type RelayNetworkPolicy = (typeof RELAY_NETWORK_POLICIES)[number];

export const RELAY_WORKSPACE_KINDS = ['local_workspace', 'unknown'] as const;
export type RelayWorkspaceKind = (typeof RELAY_WORKSPACE_KINDS)[number];

/**
 * THE WORKSPACE AND EXECUTION CONTEXT — not an `.env` file.
 *
 * NO SECRETS, STRUCTURALLY. There is no field here that can hold an API key, a
 * token, a password or the contents of a private environment variable, and
 * `agent-operating.test.ts` asserts every projected string is free of
 * credential shapes. The environment is described, never dumped.
 *
 * `worktree` IS NULL UNTIL ISOLATED WORKTREES EXIST. Relay does not yet run
 * agents in isolated worktrees, so this reports `null` and the inspector says
 * so. Naming a worktree that does not exist would be the exact species of
 * untruth this foundation is built to prevent.
 */
export interface RelayEnvironmentReference {
  readonly projectId: string;
  /** The repository name — never a path containing a user's home directory. */
  readonly repository: string;
  readonly branch: string | null;
  /** `null` until isolated worktrees are implemented. Truthful, not aspirational. */
  readonly worktree: string | null;
  readonly workspaceKind: RelayWorkspaceKind;
  readonly terminalAvailable: boolean;
  readonly networkPolicy: RelayNetworkPolicy;
  readonly projectBrainAccess: boolean;
  readonly access: RelayEnvironmentAccess;
  /** Safe version strings, e.g. `node 22`. Never an environment dump. */
  readonly runtimeVersions: readonly string[];
  /** How many files the agent may reach, when the workspace reports it. */
  readonly accessibleFileCount: number | null;
}

/* ----------------------------------------------------------------- tools */

/**
 * AN EXPLICITLY GRANTED CAPABILITY.
 *
 * A grant is a positive statement — there is no "maybe". `toolId` reuses the
 * identifiers the mode policy already speaks in, so a grant can be checked
 * against `RelayModePolicy.prohibitedTools` rather than against a second,
 * parallel permission model. This is not the future compound-agent tool
 * marketplace; it is the list an operator can read.
 */
export interface RelayToolGrant {
  readonly toolId: string;
  /** Human label for both surfaces — one spelling, not one per surface. */
  readonly label: string;
}

/* --------------------------------------------------------------- profile */

/**
 * THE FOUR CANONICAL OPERATING COMPONENTS OF ONE RELAY DOG.
 *
 * Every Relay Dog has all four. A profile missing any of them is not a
 * partially-configured agent — it is an agent nobody can account for.
 */
export interface RelayAgentOperatingProfile {
  readonly role: RelayAgentRole;
  readonly runtime: RelayRuntimeReference;
  readonly missionContract: RelayMissionContractReference;
  readonly environment: RelayEnvironmentReference;
  readonly tools: readonly RelayToolGrant[];
}

/** The four component keys, in the order every surface displays them. */
export const RELAY_OPERATING_COMPONENTS = ['runtime', 'mission_contract', 'environment', 'tools'] as const;
export type RelayOperatingComponent = (typeof RELAY_OPERATING_COMPONENTS)[number];
