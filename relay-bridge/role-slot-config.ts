import {
  ROLE_SLOTS, bindRoleSlots, renderBindingLine,
  type RoleBindingProblem, type RoleSlot, type RoleSlotBindingResult,
} from '../src/relay/mission/role-slots';
import { isProductionDeployment } from './deployment-environment';
import type { ReviewerTransport } from './reviewer-transport';
import { REMOTE_HERMES_ENV } from './hermes-remote-review';
import { OPENAI_REVIEWER_ENV } from './openai-reviewer';

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
/** The occupant `RELAY_BRIDGE_FAKE_CLAUDE=1` selects, named once. */
export const FAKE_CODING_OCCUPANT = 'claude_code_fake';
/**
 * THE REVIEWER'S OWN SELECTOR, AND WHY DERIVING IT WAS WRONG.
 *
 * The first version derived the mission's Reviewer from `RELAY_HERMES_MODE`,
 * reasoning that a second variable answering the same question is how two
 * things that must agree quietly stop agreeing. The reasoning was right and
 * the premise was false: `RELAY_HERMES_MODE` is read by
 * `transport-factory.ts`, which serves the `/reviewer/*` ROUTES. At the time,
 * the mission's reviewer leg always spawned a local process. Two surfaces, one
 * variable — so a founder machine set up to exercise the deployed Hermes
 * service through the routes (`remote`) had every MISSION refused, and there
 * was no value that satisfied both.
 *
 * They are different questions and have different variables.
 *
 * THE SECOND HALF OF THAT PARAGRAPH IS NO LONGER TRUE, and leaving it standing
 * cost something: the mission leg now resolves a transport and `callReviewer`
 * dispatches on it, so "never consults it and always spawns a local process"
 * described a Relay that had not existed for some time. It was the stated
 * reason `hermes_remote_service` sat outside the dispatchable set, which
 * refused a remote Reviewer this bridge could genuinely drive.
 *
 * The variables still answer different questions — one CONFIGURES a transport,
 * one SELECTS an occupant — and `reviewerSlotConflict` is what now keeps the
 * two answers from disagreeing.
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
   * The provider Reviewer. Absent from this list until now, which meant a
   * founder setting the value the handoff recommends was told it was not one
   * of the choices — a correct value refused. `reviewer-occupant-coherence`
   * holds the general rule: a Reviewer the mission can drive must be one the
   * selector can name.
   */
  if (raw === 'openai_reviewer') return { kind: 'occupant', occupantId: 'openai_reviewer' };
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
 * can drive it, and only this caller knows. Binding an occupant the pipeline
 * cannot drive produced a mission that ANNOUNCED "Claude Agent SDK (hosted)"
 * in its preflight while the local CLI ran and attested itself — one occupant
 * narrated, another doing the work, which is the precise defect the registry
 * exists to make impossible.
 *
 * WHAT THIS PARAGRAPH USED TO SAY, and why it is worth recording: it claimed
 * the mission "runs the Reviewer through `runHermesReview` (a spawned local
 * Hermes)" and consults "neither the hosted runner nor the remote transport".
 * Both halves stopped being true — `mission.ts` resolves a transport and
 * `callReviewer` dispatches on it — and the stale sentence was load-bearing,
 * because it is the justification for which entries are in this set. A remote
 * Reviewer that Relay could genuinely drive was refused as undrivable for as
 * long as nobody re-read it.
 *
 * Entries are removed from this set as each surface is wired, and the removal
 * is the whole change: nothing else has to know.
 */
export const MISSION_DISPATCHABLE_OCCUPANTS: ReadonlySet<string> = new Set([
  'openai_gpt_architect',
  'fusion_architect',
  'claude_code_local',
  'claude_code_fake',
  // The hosted Agent SDK, wired through `agent-invoker.ts`. Adding an entry
  // here is the whole wiring change once a surface can actually be driven —
  // which is the point of keeping dispatchability separate from registration.
  'claude_agent_sdk_hosted',
  'hermes_local',
  /**
   * BOTH REVIEWERS THAT ARE NOT THE LOCAL BINARY, and each is a fact about a
   * branch that exists rather than a promise. `callReviewer` in `mission.ts`
   * dispatches on the transport: `remote` calls the Hermes service, `provider`
   * calls the OpenAI Reviewer, and both return the same `HermesOutcome`, so
   * the review leg is unchanged either way.
   *
   * `hermes_remote_service` was absent here long after the remote transport
   * was wired, so a deployment that correctly configured the remote Reviewer
   * was refused as undrivable — the comment above says entries are removed as
   * each surface is wired, and this one was not.
   */
  'hermes_remote_service',
  'openai_reviewer',
]);

/**
 * WHICH OCCUPANT A TRANSPORT WOULD ACTUALLY RUN.
 *
 * Relay decides the Reviewer twice — `resolveReviewerTransport` decides who
 * reviews, the role slot decides who is BOUND, and the binding is what the
 * mission attests. Nothing reconciled them, and adding a third transport made
 * that gap reachable: on a founder machine `RELAY_OPENAI_REVIEWER_MODE=live`
 * with `RELAY_ROLE_REVIEWER` unset resolved the provider transport while
 * binding the laptop default, so OpenAI reviewed and `hermes_local` was
 * attested.
 *
 * This is the translation that lets the two be compared at all.
 */
export function reviewerOccupantForTransport(transport: ReviewerTransport): string | null {
  switch (transport.kind) {
    case 'provider': return 'openai_reviewer';
    case 'remote': return 'hermes_remote_service';
    case 'local': return 'hermes_local';
    // An unavailable transport is already refused with a better reason of its
    // own — ambiguous configuration, a missing token. A conflict stacked on
    // top would bury the message that actually helps.
    case 'unavailable': return null;
  }
}

/**
 * The occupant an EXPLICITLY CONFIGURED transport selects, if any.
 *
 * `local` is excluded deliberately, and the distinction is the whole point:
 * remote and provider each require an operator to set variables, so they are a
 * STATEMENT about who should review. Local is what you get by configuring
 * nothing, so treating it as a statement would bind an installed Hermes on a
 * container that has none — reintroducing the wrong-machine binding the role
 * registry exists to remove, and turning a hosted deployment's honest
 * `no_occupant_requested` into a silent guess.
 *
 * So an operator who configured a transport and named no occupant gets the
 * occupant they clearly meant, and one who configured nothing still has to say.
 */
export function explicitlySelectedReviewerOccupant(transport: ReviewerTransport): string | null {
  if (transport.kind === 'remote' || transport.kind === 'provider') {
    return reviewerOccupantForTransport(transport);
  }
  return null;
}

/**
 * Do the transport and the bound occupant name the same Reviewer?
 *
 * `null` means no disagreement — including the two cases where the question
 * does not arise: nothing bound, and no usable transport.
 *
 * A disagreement is refused rather than resolved, and the message names BOTH
 * settings. Picking one would be substituting an occupant under another's
 * name, which is the single thing this module exists to prevent.
 */
export function reviewerSlotConflict(input: {
  readonly transport: ReviewerTransport;
  readonly boundOccupantId: string | null;
}): { readonly role: RoleSlot; readonly safeMessage: string } | null {
  if (input.boundOccupantId === null) return null;
  const wouldRun = reviewerOccupantForTransport(input.transport);
  if (wouldRun === null || wouldRun === input.boundOccupantId) return null;

  const setting = input.transport.kind === 'provider'
    ? `${OPENAI_REVIEWER_ENV.mode}=live`
    : input.transport.kind === 'remote'
      ? `${REMOTE_HERMES_ENV.mode}=remote`
      : 'no Reviewer transport configuration, which selects the local Hermes';

  return {
    role: 'reviewer',
    safeMessage:
      `${setting} would run "${wouldRun}", and ${REVIEWER_ROLE_ENV} binds "${input.boundOccupantId}". `
      + 'Relay refuses rather than reviewing with one and attesting the other — set them to agree, or '
      + `unset ${REVIEWER_ROLE_ENV} on a founder machine only if the default matches the transport.`,
  };
}

/**
 * Bound, coherent, configured — and undrivable here. Named per role.
 *
 * `dispatchedRoles` bounds the question to the roles this mission will
 * actually run. Checking every BOUND role instead killed the one hosted shape
 * that works, for naming a reviewer it would never have called — the same
 * defect as demanding one, moved a layer down.
 */
export function missionDispatchProblems(
  bindings: Readonly<Partial<Record<RoleSlot, { readonly occupant: { readonly occupantId: string; readonly displayName: string } }>>>,
  dispatchedRoles: readonly RoleSlot[] = ROLE_SLOTS,
): readonly { readonly role: RoleSlot; readonly safeMessage: string }[] {
  const problems: { role: RoleSlot; safeMessage: string }[] = [];
  for (const role of Object.keys(bindings) as RoleSlot[]) {
    if (!dispatchedRoles.includes(role)) continue;
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
  /**
   * Whether this caller will dispatch a Reviewer. The caller already knows —
   * for the mission it is the same `live` that decides
   * `requiresIndependentReview`, the Hermes probe and the review leg.
   */
  readonly requiresReview: boolean;
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
    // Both naming the SAME occupant is agreement, not a conflict.
    if (namedCoding !== '' && namedCoding !== FAKE_CODING_OCCUPANT) {
      conflicts.push({
        role: 'coding_agent',
        reason: 'selector_conflict',
        safeMessage:
          `RELAY_BRIDGE_FAKE_CLAUDE=1 selects the offline coding pipeline, and ${CODING_AGENT_ROLE_ENV} `
          + `names "${namedCoding}". Relay will not run one under the other's name — unset whichever `
          + 'you did not mean.',
      });
    }
    requested.coding_agent = FAKE_CODING_OCCUPANT;
  } else if (namedCoding === FAKE_CODING_OCCUPANT) {
    /**
     * THE DANGEROUS HALF OF THE SAME CONFLICT.
     *
     * `RELAY_BRIDGE_FAKE_CLAUDE` is what decides `claudeMode`, so naming the
     * fake occupant WITHOUT it binds the fake while `resolveClaudeRuntime`
     * resolves the REAL installed Claude Code CLI. The fake deliberately
     * shares the local occupant's actor name and adapter id, so requested and
     * actual agree, `actorMatches` is true, nothing objects — and a real,
     * subscription-billed run is attested `simulated` and reaches
     * verified_complete. Recording a paid run as spend-free is worse than the
     * reverse, and it was three lines from the check that catches the reverse.
     */
    conflicts.push({
      role: 'coding_agent',
      reason: 'selector_conflict',
      safeMessage:
        `${CODING_AGENT_ROLE_ENV} names "${FAKE_CODING_OCCUPANT}", which is selected by `
        + 'RELAY_BRIDGE_FAKE_CLAUDE=1 and never by this variable. Set that instead — otherwise the '
        + 'real Claude Code CLI runs and would be recorded as having spent nothing.',
    });
  } else if (namedCoding !== '') {
    requested.coding_agent = namedCoding;
  }

  /**
   * THE REVIEWER IS REQUIRED EXACTLY WHEN THE MISSION WILL DISPATCH ONE.
   *
   * `requiresReview` is PASSED IN, not re-derived here. An earlier version
   * compared `architectMode === 'live'` a third time, beside the two
   * comparisons that already existed, and a comment claimed it "cannot drift"
   * — while being exactly the shape this module's own header warns about. The
   * drift direction was fail-OPEN: a live mission whose reviewer was never
   * bound would still run the review leg.
   */
  const optionalRoles: RoleSlot[] = inputs.requiresReview ? [] : ['reviewer'];

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
    // Derived from the one function in this module that knows what the live
    // architect is, rather than a fresh comparison against the same string.
    requiresReview: architectOccupantFor(env.RELAY_PROMPT_ARCHITECT_MODE) === 'openai_gpt_architect',
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
