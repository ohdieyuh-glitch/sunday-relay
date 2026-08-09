import {
  ROLE_SLOTS, bindRoleSlots, renderBindingLine,
  type RoleSlot, type RoleSlotBindingResult,
} from '../src/relay/mission/role-slots';
import { isProductionDeployment } from './deployment-environment';
import { HERMES_MODE_ENV } from './reviewer-harness/hermes/hermes-transport';

/**
 * READING WHICH OCCUPANT HOLDS EACH ROLE, FROM THE DEPLOYMENT.
 *
 * ONE SELECTOR PER ROLE, AND TWO OF THE THREE ALREADY EXISTED. The Prompt
 * Architect has been chosen by `RELAY_PROMPT_ARCHITECT_MODE` since it was
 * built, and the Reviewer by `RELAY_HERMES_MODE` since the transport seam
 * landed. Adding `RELAY_ROLE_PROMPT_ARCHITECT` and `RELAY_ROLE_REVIEWER` beside
 * them would create two variables that answer the same question, and the whole
 * failure mode this repository keeps hitting is two things that are supposed to
 * agree and quietly do not. So those two roles are DERIVED, and only the Coding
 * Agent — which never had a local-versus-hosted selector at all — gets a new
 * one.
 *
 * WHAT THIS FUNCTION DOES NOT DO. It reads no credential value, only whether a
 * variable is set to something non-empty. A variable set to the empty string
 * counts as unset, because on Railway that is what a half-pasted secret looks
 * like, and treating it as configured is how a deploy fails 84ms in with a
 * message about nothing.
 */

/** The one genuinely new selector. Values are registry occupant ids. */
export const CODING_AGENT_ROLE_ENV = 'RELAY_ROLE_CODING_AGENT';

/**
 * The architect path, expressed as an occupant.
 *
 * `blocked` returns null rather than an occupant: it is not a third agent, it
 * is the absence of a decision, and the mission already refuses on it with its
 * own message before binding is ever consulted.
 */
export function architectOccupantFor(mode: string | undefined): string | null {
  if (mode === 'live') return 'openai_gpt_architect';
  if (mode === 'fusion') return 'fusion_architect';
  return null;
}

/**
 * The Hermes transport mode, expressed as an occupant — in three states.
 *
 * UNSET is deliberately not defaulted here. `selectHermesMode` already decides
 * what unset means — local on a developer machine, a configuration error in
 * production — and duplicating that judgement is how the two would drift.
 * Reporting `unset` lets the binder apply the development default on a laptop
 * and refuse on a hosted deployment, which is the same answer arrived at once.
 *
 * INVALID is separate because collapsing it into `unset` made this module and
 * `selectHermesMode` disagree in both directions at once.
 */
export type SelectorResolution =
  | { readonly kind: 'unset' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'occupant'; readonly occupantId: string };

export function reviewerOccupantFor(mode: string | undefined): SelectorResolution {
  const raw = (mode ?? '').trim();
  if (raw === '') return { kind: 'unset' };
  if (raw === 'local') return { kind: 'occupant', occupantId: 'hermes_local' };
  if (raw === 'remote') return { kind: 'occupant', occupantId: 'hermes_remote_service' };
  /**
   * SET, AND NOT ONE OF THE CHOICES.
   *
   * `selectHermesMode` refuses this outright, so returning `unset` here made
   * the two disagree in both directions: on a laptop `RELAY_HERMES_MODE=REMOTE`
   * silently bound the LOCAL reviewer while the transport refused the value,
   * and on a host `romote` reported "no occupant is configured" for a variable
   * that is configured, misspelled. The vocabulary still lives in
   * `selectHermesMode` — this only distinguishes the two failures.
   */
  return { kind: 'invalid' };
}

/**
 * THE OCCUPANTS THIS MISSION PIPELINE CAN ACTUALLY DRIVE.
 *
 * Registration says Relay ships an adapter. Dispatchability says THIS caller
 * can drive it, and only this caller knows. The bridge's mission runs the
 * Coding Agent through `runCodingMission` (the Claude Code CLI) and the
 * Reviewer through `runHermesReview` (a spawned local Hermes); neither
 * consults the hosted runner or the remote transport. Binding an occupant the
 * pipeline cannot drive produced a mission that ANNOUNCED "Claude Agent SDK
 * (hosted)" in its preflight while the local CLI ran and attested itself —
 * one occupant narrated, another doing the work, which is the precise defect
 * the registry exists to make impossible.
 *
 * Entries are removed from this set as each surface is wired, and the removal
 * is the whole change: nothing else has to know.
 */
export const MISSION_DISPATCHABLE_OCCUPANTS: ReadonlySet<string> = new Set([
  'openai_gpt_architect',
  'fusion_architect',
  'claude_code_local',
  'hermes_local',
]);

/** Bound, coherent, configured — and undrivable here. Named per role. */
export function missionDispatchProblems(
  bindings: Readonly<Record<RoleSlot, { readonly occupant: { readonly occupantId: string; readonly displayName: string } }>>,
): readonly { readonly role: RoleSlot; readonly safeMessage: string }[] {
  const problems: { role: RoleSlot; safeMessage: string }[] = [];
  for (const role of Object.keys(bindings) as RoleSlot[]) {
    const { occupant } = bindings[role];
    if (MISSION_DISPATCHABLE_OCCUPANTS.has(occupant.occupantId)) continue;
    problems.push({
      role,
      safeMessage:
        `"${occupant.occupantId}" is registered for the ${role} role, but this Relay Bridge cannot yet `
        + `dispatch it: the mission pipeline has no execution path for ${occupant.displayName}. `
        + 'Relay refuses rather than run a different occupant under its name.',
    });
  }
  return problems;
}

/** Variable names whose value is set and non-empty. NAMES only. */
export function configuredNames(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') names.add(name);
  }
  return names;
}

export interface RoleSlotResolution {
  readonly hosted: boolean;
  readonly requested: Partial<Record<RoleSlot, string>>;
  readonly binding: RoleSlotBindingResult;
}

/**
 * The three selectors, read from wherever their owner reads them.
 *
 * Taken as explicit values rather than one environment object because the
 * mission registry deliberately keeps the architect's environment and the
 * Hermes environment separable, and inventing a merge policy inside this
 * module would quietly decide which one wins. The caller already knows.
 */
export interface RoleSlotInputs {
  readonly architectMode: string | undefined;
  readonly hermesMode: string | undefined;
  readonly codingAgentOccupant: string | undefined;
  readonly hosted: boolean;
  readonly configuredNames: ReadonlySet<string>;
}

/**
 * Resolve and bind every role slot for this deployment.
 *
 * Called at preflight, BEFORE any provider request, so an incoherent
 * combination costs nothing. A hosted deployment gets no development
 * defaults — see `bindRoleSlots`.
 */
export function resolveRoleSlots(inputs: RoleSlotInputs): RoleSlotResolution {
  const requested: Partial<Record<RoleSlot, string>> = {};
  const invalidSelectors: RoleSlot[] = [];

  const architect = architectOccupantFor(inputs.architectMode);
  if (architect !== null) requested.prompt_architect = architect;

  const reviewer = reviewerOccupantFor(inputs.hermesMode);
  if (reviewer.kind === 'occupant') requested.reviewer = reviewer.occupantId;
  if (reviewer.kind === 'invalid') invalidSelectors.push('reviewer');

  const coding = (inputs.codingAgentOccupant ?? '').trim();
  if (coding !== '') requested.coding_agent = coding;

  return {
    hosted: inputs.hosted,
    requested,
    binding: bindRoleSlots({
      requested,
      environment: inputs.hosted ? 'hosted' : 'founder_machine',
      configuredNames: inputs.configuredNames,
      allowDevelopmentDefaults: !inputs.hosted,
      invalidSelectors,
      // So a refusal says which variable to set, rather than leaving an
      // operator to discover the name.
      selectorNames: {
        prompt_architect: 'RELAY_PROMPT_ARCHITECT_MODE',
        coding_agent: CODING_AGENT_ROLE_ENV,
        reviewer: HERMES_MODE_ENV,
      },
    }),
  };
}

/** The single-environment convenience, for callers that have exactly one. */
export function resolveRoleSlotsFromEnv(env: NodeJS.ProcessEnv): RoleSlotResolution {
  return resolveRoleSlots({
    architectMode: env.RELAY_PROMPT_ARCHITECT_MODE,
    hermesMode: env[HERMES_MODE_ENV],
    codingAgentOccupant: env[CODING_AGENT_ROLE_ENV],
    hosted: isProductionDeployment(env),
    configuredNames: configuredNames(env),
  });
}

/** One safe line naming who holds each role, for the mission event stream. */
export function describeBinding(resolution: RoleSlotResolution): string {
  if (!resolution.binding.ok) {
    return resolution.binding.problems.map((p) => p.safeMessage).join(' ');
  }
  const { bindings } = resolution.binding;
  // Composed from `renderBindingLine`, so the occupant name a founder reads is
  // the one the binding produced and not a second sentence describing it.
  return ROLE_SLOTS.map((role) => renderBindingLine(bindings[role])).join(' · ');
}
