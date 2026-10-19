/**
 * SUNDAY RELAY — THE ONE CANONICAL OPERATING-PROFILE PROJECTION.
 *
 * The website panels and the CLI render THE SAME projection, so the two
 * surfaces cannot disagree about which runtime is performing the work, which
 * Mission Contract governs it, which environment it runs in, or which tools it
 * was granted. Only the presentation differs: the website styles these rows,
 * the CLI prints them.
 *
 * WHY THE LABELS LIVE HERE AND NOT ON EACH SURFACE. A surface that formats its
 * own label is a surface that can quietly say something different from the
 * other one — "Not connected" on one and "Offline" on the other, or worse, a
 * provider name on one and `Unknown` on the other. Every string an operator
 * reads is produced once, here, and `agent-operating-parity.test.ts` asserts
 * the two surfaces emit the identical row values.
 *
 * PURE. No I/O, no provider call, no clock, no randomness.
 */

import { SIMULATED_DATA_LABEL, UNKNOWN_LABEL } from '../economics/economics-projection';
import {
  RELAY_OPERATING_COMPONENTS,
  type RelayAgentOperatingProfile,
  type RelayAgentRole,
  type RelayEnvironmentReference,
  type RelayMissionContractReference,
  type RelayOperatingComponent,
  type RelayRuntimeReference,
  type RelayToolGrant,
} from './operating-profile-types';

/**
 * The word Relay uses when a runtime was named but nothing is attached.
 *
 * `Unknown` is NOT redeclared here: the repository already has exactly one
 * canonical spelling of it, in `economics-projection.ts`, and a second const
 * with the same value is how two surfaces start disagreeing about the same
 * fact. It is imported above and re-exported by this module's barrel.
 */
export const NOT_CONNECTED_LABEL = 'Not connected';

export { UNKNOWN_LABEL };

export const RELAY_AGENT_ROLE_LABEL: Readonly<Record<RelayAgentRole, string>> = Object.freeze({
  prompt_architect: 'Prompt Architect',
  coding_agent: 'Coding Agent',
  reviewer: 'Reviewer',
});

export const RELAY_OPERATING_COMPONENT_LABEL: Readonly<Record<RelayOperatingComponent, string>> = Object.freeze({
  runtime: 'Runtime',
  mission_contract: 'Mission Contract',
  environment: 'Environment',
  tools: 'Tools',
});

/** One inspector row. Both surfaces render exactly these, in this order. */
export interface RelayOperatingRow {
  readonly component: RelayOperatingComponent;
  readonly label: string;
  readonly value: string;
}

export interface RelayAgentOperatingProjection {
  readonly role: RelayAgentRole;
  readonly roleLabel: string;

  readonly runtimeLabel: string;
  readonly missionContractLabel: string;
  readonly environmentLabel: string;
  readonly toolsLabel: string;

  /** Individual tool labels, for a surface that lists rather than joins. */
  readonly toolLabels: readonly string[];
  readonly executionModeLabel: string;

  /** The four rows, in canonical order — the shared rendering contract. */
  readonly rows: readonly RelayOperatingRow[];

  /**
   * WHERE THIS CAME FROM. Derived from the profile's own execution mode, so a
   * surface cannot present simulated activity as live by forgetting a flag.
   */
  readonly simulated: boolean;
  /** The disclosure banner both surfaces show. `null` only for live data. */
  readonly dataSourceLabel: string | null;
}

/** `a · b · c`, skipping anything empty — the separator both surfaces use. */
const join = (parts: readonly (string | null)[]): string =>
  parts.filter((p): p is string => p !== null && p.trim() !== '').join(' · ');

/**
 * RUNTIME — what is actually performing the work.
 *
 * The ACTUAL runtime is preferred over the requested one, because the
 * requested one is an intention and the actual one is a fact. When nothing has
 * reported, the row says `Not connected` (a runtime was named, nothing is
 * attached) or `Unknown` (nothing is known at all). Neither is ever replaced
 * by a plausible provider name.
 */
export function runtimeLabelOf(runtime: RelayRuntimeReference): string {
  const identity = runtime.actualAgentType ?? runtime.requestedAgentType;
  const name = identity.trim() === '' ? UNKNOWN_LABEL : identity;

  const state = runtime.availability === 'connected'
    ? (runtime.modelVersion ?? executionModeLabelOf(runtime))
    : runtime.availability === 'not_connected'
      ? NOT_CONNECTED_LABEL
      : UNKNOWN_LABEL;

  return join([name, state]);
}

/** `simulated` is disclosed by name; nothing else is dressed up as live. */
export function executionModeLabelOf(runtime: RelayRuntimeReference): string {
  switch (runtime.executionMode) {
    case 'simulated':
      return 'Simulated';
    case 'live':
      return 'Live';
    case 'imported':
      return 'Imported';
    case 'manual':
      return 'Manual';
    default:
      return UNKNOWN_LABEL;
  }
}

/** MISSION CONTRACT — its identity and mode, never its instructions. */
export function missionContractLabelOf(reference: RelayMissionContractReference): string {
  const mode = reference.mode.charAt(0).toUpperCase() + reference.mode.slice(1);
  return join([reference.missionId, mode]);
}

/**
 * ENVIRONMENT — the workspace, described truthfully.
 *
 * A worktree is named ONLY when one exists. Until isolated worktrees are
 * implemented that is never, and the row says `Local workspace` — which is
 * what is actually true — rather than implying an isolation Relay does not
 * yet provide.
 */
export function environmentLabelOf(environment: RelayEnvironmentReference): string {
  const place = environment.worktree !== null
    ? `Worktree ${environment.worktree}`
    : environment.workspaceKind === 'local_workspace'
      ? 'Local workspace'
      : UNKNOWN_LABEL;
  return join([environment.repository, environment.branch ?? UNKNOWN_LABEL, place]);
}

/** TOOLS — the granted capabilities, in the order they were granted. */
export function toolsLabelOf(tools: readonly RelayToolGrant[]): string {
  if (tools.length === 0) return 'None granted';
  return tools.map((t) => t.label).join(' · ');
}

/**
 * THE PROJECTION. One function, both surfaces.
 */
export function projectAgentOperatingProfile(
  profile: RelayAgentOperatingProfile,
): RelayAgentOperatingProjection {
  const runtimeLabel = runtimeLabelOf(profile.runtime);
  const missionContractLabel = missionContractLabelOf(profile.missionContract);
  const environmentLabel = environmentLabelOf(profile.environment);
  const toolsLabel = toolsLabelOf(profile.tools);

  const values: Readonly<Record<RelayOperatingComponent, string>> = {
    runtime: runtimeLabel,
    mission_contract: missionContractLabel,
    environment: environmentLabel,
    tools: toolsLabel,
  };

  const rows: RelayOperatingRow[] = RELAY_OPERATING_COMPONENTS.map((component) => ({
    component,
    label: RELAY_OPERATING_COMPONENT_LABEL[component],
    value: values[component],
  }));

  const simulated = profile.runtime.executionMode === 'simulated';

  return {
    role: profile.role,
    roleLabel: RELAY_AGENT_ROLE_LABEL[profile.role],
    runtimeLabel,
    missionContractLabel,
    environmentLabel,
    toolsLabel,
    toolLabels: profile.tools.map((t) => t.label),
    executionModeLabel: executionModeLabelOf(profile.runtime),
    rows,
    simulated,
    // Reuses the repository's existing disclosure banner rather than inventing
    // a second wording for the same fact.
    dataSourceLabel: simulated ? SIMULATED_DATA_LABEL : null,
  };
}

/** Projects a whole workforce, in canonical role order. */
export function projectAgentOperatingProfiles(
  profiles: readonly RelayAgentOperatingProfile[],
): readonly RelayAgentOperatingProjection[] {
  return profiles.map(projectAgentOperatingProfile);
}
