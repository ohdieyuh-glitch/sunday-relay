import {
  ROLE_SLOTS, bindRoleSlots, renderBindingLine,
  type RoleBindingProblem, type RoleSlot, type RoleSlotBindingResult,
} from '../src/relay/mission/role-slots';
import { isProductionDeployment } from './deployment-environment';

/**
 * READING WHICH OCCUPANT HOLDS EACH ROLE, FROM THE DEPLOYMENT.
 *
 * ONE SELECTOR PER ROLE, AND ONE OF THE THREE ALREADY EXISTED. The Prompt
 * Architect has been chosen by `RELAY_PROMPT_ARCHITECT_MODE` since it was
 * built, so it is DERIVED — a second variable answering a question that
 * already has one is how two things that must agree quietly stop agreeing.
 *
 * The Reviewer was derived from `RELAY_HERMES_MODE` on the same reasoning, and
 * that was wrong: `RELAY_HERMES_MODE` belongs to the `/reviewer/*` ROUTES'
 * transport, which is a different surface from the mission's reviewer leg. One
 * variable with two incompatible readers had no value that satisfied both. See
 * `REVIEWER_ROLE_ENV`.
 *
 * WHAT THIS FUNCTION DOES NOT DO. It reads no credential value, only whether a
 * variable is set to something non-empty. A variable set to the empty string
 * counts as unset, because on Railway that is what a half-pasted secret looks
 * like, and treating it as configured is how a deploy fails 84ms in with a
 * message about nothing.
 */

/** Selectors, by role. Values are registry occupant ids. */
export const CODING_AGENT_ROLE_ENV = 'RELAY_ROLE_CODING_AGENT';
/**
 * THE REVIEWER'S OWN SELECTOR, AND WHY DERIVING IT WAS WRONG.
 *
 * The first version derived the mission's Reviewer from `RELAY_HERMES_MODE`,
 * reasoning that a second variable answering the same question is how two
 * things that must agree quietly stop agreeing. The reasoning was right and
 * the premise was false: `RELAY_HERMES_MODE` is read by
 * `transport-factory.ts`, which serves the `/reviewer/*` ROUTES. The mission's
 * reviewer leg is `runHermesReview`, which never consults it and always spawns
 * a local process. Two surfaces, one variable — so a founder machine set up to
 * exercise the deployed Hermes service through the routes (`remote`) had every
 * MISSION refused, and there was no value that satisfied both.
 *
 * They are different questions and now have different variables.
 */
export const REVIEWER_ROLE_ENV = 'RELAY_ROLE_REVIEWER';

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
 * The requested Reviewer occupant, in three states.
 *
 * UNSET is deliberately not defaulted here: reporting it lets the binder apply
 * the development default on a laptop and refuse on a hosted deployment, which
 * is one decision made in one place.
 */
export type SelectorResolution =
  | { readonly kind: 'unset' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'occupant'; readonly occupantId: string };

export function reviewerOccupantFor(requested: string | undefined): SelectorResolution {
  const raw = (requested ?? '').trim();
  if (raw === '') return { kind: 'unset' };
  if (raw === 'hermes_local') return { kind: 'occupant', occupantId: 'hermes_local' };
  if (raw === 'hermes_remote_service') return { kind: 'occupant', occupantId: 'hermes_remote_service' };
  /**
   * SET, AND NOT ONE OF THE CHOICES. Distinguished from unset because the
   * remedies are opposite: one says set the variable, the other says the value
   * you set is misspelled. Collapsing them reported "no occupant is
   * configured" for a variable that is configured, wrongly.
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
  'claude_code_fake',
  'hermes_local',
]);

/** Bound, coherent, configured — and undrivable here. Named per role. */
export function missionDispatchProblems(
  bindings: Readonly<Partial<Record<RoleSlot, { readonly occupant: { readonly occupantId: string; readonly displayName: string } }>>>,
): readonly { readonly role: RoleSlot; readonly safeMessage: string }[] {
  const problems: { role: RoleSlot; safeMessage: string }[] = [];
  for (const role of Object.keys(bindings) as RoleSlot[]) {
    // An UNSTAFFED role has nothing to dispatch and nothing to refuse. The
    // mission does not call it; see `RoleSlotBindingResult`.
    const binding = bindings[role];
    if (binding === undefined) continue;
    const { occupant } = binding;
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
  readonly reviewerOccupant: string | undefined;
  readonly codingAgentOccupant: string | undefined;
  /**
   * Whether this deployment runs the keyless offline coding pipeline.
   *
   * A MODE, not a role choice — `RELAY_BRIDGE_FAKE_CLAUDE=1` already decides
   * it, exactly as `RELAY_PROMPT_ARCHITECT_MODE` decides the architect. It
   * therefore OVERRIDES any named coding occupant rather than competing with
   * one: a deployment running fakes is not running whatever it named.
   */
  readonly fakeCodingRuntime: boolean;
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
  const conflicts: RoleBindingProblem[] = [];

  const architect = architectOccupantFor(inputs.architectMode);
  if (architect !== null) requested.prompt_architect = architect;

  const reviewer = reviewerOccupantFor(inputs.reviewerOccupant);
  if (reviewer.kind === 'occupant') requested.reviewer = reviewer.occupantId;
  if (reviewer.kind === 'invalid') invalidSelectors.push('reviewer');

  const namedCoding = (inputs.codingAgentOccupant ?? '').trim();
  if (inputs.fakeCodingRuntime) {
    /**
     * FAKE MODE AND A NAMED OCCUPANT ARE A CONFLICT, NOT A PRECEDENCE.
     *
     * Silently overriding bound the fake and said nothing — substituting a
     * different occupant under the operator's chosen name, which is the one
     * thing this module exists to prevent, and worse here than elsewhere: on
     * the development path nothing reviews the result, so a silently
     * substituted simulated run can reach `verified_complete`.
     */
    if (namedCoding !== '') {
      conflicts.push({
        role: 'coding_agent',
        reason: 'selector_conflict',
        safeMessage:
          `RELAY_BRIDGE_FAKE_CLAUDE=1 selects the offline coding pipeline, and ${CODING_AGENT_ROLE_ENV} `
          + `names "${namedCoding}". Relay will not run one under the other's name — unset whichever `
          + 'you did not mean.',
      });
    }
    requested.coding_agent = 'claude_code_fake';
  } else if (namedCoding !== '') {
    requested.coding_agent = namedCoding;
  }

  /**
   * THE REVIEWER IS REQUIRED EXACTLY WHEN THE MISSION WILL DISPATCH ONE.
   *
   * Derived from the architect path rather than configured separately, because
   * that is the same signal the mission uses: `live` decides
   * `requiresIndependentReview`, whether the Hermes probe runs, and whether
   * the review leg executes at all. Demanding a bindable reviewer on the
   * development path turned a working zero-spend hosted pipeline into a dead
   * end whose stated remedy — set a reviewer — could not be performed, because
   * no reviewer occupant runs on a container.
   */
  const optionalRoles: RoleSlot[] = inputs.architectMode === 'live' ? [] : ['reviewer'];

  const binding = bindRoleSlots({
      requested,
      environment: inputs.hosted ? 'hosted' : 'founder_machine',
      configuredNames: inputs.configuredNames,
      allowDevelopmentDefaults: !inputs.hosted,
      invalidSelectors,
      optionalRoles,
      // So a refusal says which variable to set, rather than leaving an
      // operator to discover the name.
      selectorNames: {
        prompt_architect: 'RELAY_PROMPT_ARCHITECT_MODE',
        coding_agent: CODING_AGENT_ROLE_ENV,
        reviewer: REVIEWER_ROLE_ENV,
      },
  });
  // A conflict is a refusal even when everything else binds.
  const merged: RoleSlotBindingResult = conflicts.length === 0
    ? binding
    : { ok: false, problems: [...conflicts, ...(binding.ok ? [] : binding.problems)] };
  return { hosted: inputs.hosted, requested, binding: merged };
}

/** The single-environment convenience, for callers that have exactly one. */
export function resolveRoleSlotsFromEnv(env: NodeJS.ProcessEnv): RoleSlotResolution {
  return resolveRoleSlots({
    architectMode: env.RELAY_PROMPT_ARCHITECT_MODE,
    reviewerOccupant: env[REVIEWER_ROLE_ENV],
    codingAgentOccupant: env[CODING_AGENT_ROLE_ENV],
    fakeCodingRuntime: env.RELAY_BRIDGE_FAKE_CLAUDE === '1',
    hosted: isProductionDeployment(env),
    configuredNames: configuredNames(env),
  });
}

/**
 * One safe line naming who holds each role, for the mission event stream.
 *
 * A REFUSAL LEADS WITH ITS COUNT. `safeError` truncates at 600 characters and
 * the worst realistic refusal measured 558 — so one more problem, or one
 * longer variable name, would silently drop the tail and defeat the "EVERY
 * problem, not the first" guarantee with no failing test. Leading with the
 * count means truncation can cost detail but never the fact that detail is
 * missing.
 */
export function describeBinding(resolution: RoleSlotResolution): string {
  if (!resolution.binding.ok) {
    const { problems } = resolution.binding;
    const lead = problems.length === 1
      ? '1 role problem: '
      : `${String(problems.length)} role problems: `;
    return lead + problems.map((p) => p.safeMessage).join(' ');
  }
  const { bindings } = resolution.binding;
  // Composed from `renderBindingLine`, so the occupant name a founder reads is
  // the one the binding produced and not a second sentence describing it. A
  // role the mission will not dispatch is named as unstaffed rather than
  // omitted — a missing line reads as an oversight.
  return ROLE_SLOTS
    .map((role) => {
      const binding = bindings[role];
      return binding === undefined
        ? `${role}: unstaffed (this mission does not dispatch it)`
        : renderBindingLine(binding);
    })
    .join(' · ');
}
