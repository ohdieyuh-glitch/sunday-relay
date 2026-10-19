import { reviewerIsIndependent } from '../entitlement';
import {
  ROLE_SLOTS,
  type ExecutionEnvironment, type RoleBinding, type RoleBindingProblem, type RoleOccupant,
  type RoleSlot, type RoleSlotBindingResult,
} from './role-slot-contracts';
import { DEVELOPMENT_DEFAULT_OCCUPANTS, ROLE_OCCUPANTS } from './role-slot-registry';

/**
 * BINDING A DEPLOYMENT'S REQUEST TO REGISTERED OCCUPANTS — fail closed.
 *
 * Binding answers one question: may this deployment attempt this combination
 * at all? It runs BEFORE any spend, reports EVERY problem rather than the
 * first, and refuses rather than substituting. A binding is not readiness and
 * is not a launch: a bound slot can still turn out to have an invalid
 * credential or an unreachable service, and those are discovered later, by
 * probes and by runs, which is where they belong.
 *
 * EVERY PROBLEM, NOT THE FIRST. Copied from `selectHermesMode`, which learned
 * it the hard way: surfacing one misconfiguration at a time makes an operator
 * fix, redeploy, and discover the next. A refusal is a refusal either way; the
 * only thing at stake is how many restarts it takes to act on it.
 *
 * INDEPENDENCE IS NOT DECIDED HERE. It is decided by `reviewerIsIndependent`,
 * the rule Relay already had, called with the registry's identity fields. This
 * module contributes no second opinion — it only makes sure a combination that
 * rule would reject can never be bound in the first place, so the refusal
 * arrives before a paid Coding Agent run rather than after it.
 *
 * WHAT THIS IS STILL NOT. Binding-time independence compares IDENTITIES, which
 * is all that exists before anything runs. The session-level check — two roles
 * that turned out to share one provider session — still happens in
 * `evaluateReviewerGate` at review time, and this module does not and cannot
 * replace it.
 */

/** Names of environment variables the deployment actually sets. NAMES ONLY —
 *  no value reaches this module, so a caller may pass the key set of its
 *  environment without redacting anything. */
export type ConfiguredNames = ReadonlySet<string>;

export interface RoleSlotRequest {
  /** What the deployment asked for, per role. An absent entry is unnamed. */
  readonly requested: Partial<Readonly<Record<RoleSlot, string>>>;
  readonly environment: ExecutionEnvironment;
  readonly configuredNames: ConfiguredNames;
  /**
   * Whether an unnamed slot may fall back to the development default.
   *
   * A hosted deployment passes FALSE. Guessing which agent should hold a role
   * on a machine the operator cannot see is how `RELAY_HERMES_MODE` unset once
   * meant "probe this container's PATH" — the exact bug the transport seam was
   * built to remove. An unnamed slot in production is a configuration error,
   * stated as one.
   */
  readonly allowDevelopmentDefaults: boolean;
  /**
   * The environment variable that SELECTS each role, by name.
   *
   * Carried so a refusal can say which variable to set. Without it the message
   * was "No occupant is configured for the coding_agent role" — true, and
   * useless to the operator who has to go and find out that the variable is
   * called `RELAY_ROLE_CODING_AGENT`. Names only; no value ever enters here.
   */
  readonly selectorNames?: Partial<Readonly<Record<RoleSlot, string>>>;
  /**
   * Roles whose selector was SET to something that is not a valid choice.
   *
   * The caller owns this judgement because the caller owns the selector's
   * vocabulary — `RELAY_HERMES_MODE` is validated by `selectHermesMode`, and a
   * second copy of that vocabulary here is how the two would disagree. What
   * this module contributes is that "set to nonsense" refuses differently from
   * "not set".
   */
  readonly invalidSelectors?: readonly RoleSlot[];
  /**
   * Roles this caller will NOT dispatch, and therefore does not require.
   *
   * An optional role that binds is still bound and still checked; an optional
   * role that cannot bind is simply absent. Binding mirrors dispatch — see
   * `RoleSlotBindingResult`.
   */
  readonly optionalRoles?: readonly RoleSlot[];
  /**
   * The occupants to bind against. Overridable ONLY for tests, and for one
   * specific reason: the shipped registry deliberately contains no
   * non-independent Coding-Agent/Reviewer pair, so without a seam the
   * independence refusal could be asserted but never EXECUTED. A test that
   * cannot run the branch it claims to cover is the failure mode this
   * repository keeps finding.
   *
   * Nothing reads this from a request body, an environment variable or a
   * route. Production callers pass nothing and get `ROLE_OCCUPANTS`.
   */
  readonly occupants?: readonly RoleOccupant[];
}

/**
 * Whether these two occupants may hold implementer and reviewer at once.
 *
 * Delegates to `reviewerIsIndependent` — Relay's ONE independence rule — and
 * adds nothing to it. Exported so the refusal branch is directly testable
 * against hand-built occupants.
 */
export function occupantsAreIndependent(
  implementer: RoleOccupant,
  reviewer: RoleOccupant,
): boolean {
  return reviewerIsIndependent({
    reviewerAgentId: reviewer.agentId,
    // No session exists before anything runs. The session-level check is
    // `evaluateReviewerGate`'s, at review time, and stays there.
    reviewerSessionId: null,
    reviewerAdapterId: reviewer.adapterId,
    reviewerIndependenceGroup: reviewer.independenceGroup,
    implementerAgentId: implementer.agentId,
    implementerSessionId: null,
    implementerAdapterId: implementer.adapterId,
    implementerIndependenceGroup: implementer.independenceGroup,
  });
}

/** Resolve which occupant id a role is asking for, defaults included. */
export function requestedOccupantId(
  request: RoleSlotRequest,
  role: RoleSlot,
): string | null {
  const named = (request.requested[role] ?? '').trim();
  if (named !== '') return named;
  return request.allowDevelopmentDefaults ? DEVELOPMENT_DEFAULT_OCCUPANTS[role] : null;
}

function bindOne(
  request: RoleSlotRequest,
  role: RoleSlot,
): { binding: RoleBinding | null; problems: RoleBindingProblem[] } {
  const problems: RoleBindingProblem[] = [];
  const selector = request.selectorNames?.[role];
  const setIt = selector === undefined ? '' : ` Set ${selector}.`;

  if (request.invalidSelectors?.includes(role) === true) {
    problems.push({
      role,
      reason: 'invalid_selector',
      safeMessage:
        `The ${role} selector is set to a value that is not one of its choices, so no occupant `
        + `could be resolved for the role.${setIt}`,
    });
    return { binding: null, problems };
  }

  const wanted = requestedOccupantId(request, role);

  if (wanted === null) {
    problems.push({
      role,
      reason: 'no_occupant_requested',
      safeMessage:
        `No occupant is configured for the ${role} role. A hosted Relay must be told explicitly which `
        + `agent, model or harness holds each role; it will not guess.${setIt}`,
    });
    return { binding: null, problems };
  }

  const registry = request.occupants ?? ROLE_OCCUPANTS;
  const occupant = registry.find((o) => o.role === role && o.occupantId === wanted) ?? null;
  if (occupant === null) {
    // Deliberately does NOT list the alternatives that would have matched a
    // different role: an operator who typed a reviewer into the coding slot is
    // told which mistake they made, below, and an operator who invented a name
    // is not handed a menu that implies the name was nearly right.
    const elsewhere = registry.some((o) => o.role !== role && o.occupantId === wanted);
    problems.push(elsewhere
      ? {
        role,
        reason: 'occupant_role_mismatch',
        safeMessage: `"${wanted}" is a registered occupant, but not for the ${role} role.`,
      }
      : {
        role,
        reason: 'unknown_occupant',
        safeMessage: `"${wanted}" is not a registered occupant for the ${role} role.`,
      });
    return { binding: null, problems };
  }

  if (!occupant.adapterAvailable) {
    problems.push({
      role,
      reason: 'adapter_unavailable',
      safeMessage: `Relay ships no adapter for "${occupant.occupantId}", so it cannot hold the ${role} role.`,
    });
  }

  if (!occupant.environments.includes(request.environment)) {
    problems.push({
      role,
      reason: 'environment_unsupported',
      safeMessage:
        `"${occupant.occupantId}" cannot run on a ${request.environment} deployment. `
        + `It supports: ${occupant.environments.join(', ')}.`,
    });
  }

  const required = request.environment === 'hosted'
    ? [...occupant.requiredConfig, ...(occupant.hostedOnlyConfig ?? [])]
    : occupant.requiredConfig;
  const missing = required.filter((name) => !request.configuredNames.has(name));
  if (missing.length > 0) {
    problems.push({
      role,
      reason: 'configuration_missing',
      safeMessage:
        `"${occupant.occupantId}" needs configuration that is not set: ${missing.join(', ')}.`,
    });
  }

  if (problems.length > 0) return { binding: null, problems };
  return { binding: { role, requestedOccupantId: wanted, occupant }, problems };
}

/**
 * Bind all three slots, or refuse with every reason found.
 *
 * The independence check runs only when BOTH the coding agent and the reviewer
 * bound successfully. Reporting "these two are not independent" beside "one of
 * them does not exist" would be noise: the second refusal is a consequence of
 * the first, and an operator acting on it would be fixing a problem that has
 * not happened yet.
 */
export function bindRoleSlots(request: RoleSlotRequest): RoleSlotBindingResult {
  const problems: RoleBindingProblem[] = [];
  const bound = new Map<RoleSlot, RoleBinding>();

  for (const role of ROLE_SLOTS) {
    const result = bindOne(request, role);
    if (result.binding !== null) {
      bound.set(role, result.binding);
      continue;
    }
    /**
     * OPTIONAL MEANS "YOU NEED NOT NAME ONE", NOT "ANYTHING YOU NAME IS
     * IGNORED".
     *
     * An unstaffed optional role is silent: the caller will not dispatch it,
     * so a refusal an operator neither needs nor could act on is noise. But an
     * operator who DID name something and got it wrong — a misspelled
     * selector, an unregistered occupant, one that cannot run here, one whose
     * configuration is absent — asked a question that deserves an answer.
     * Swallowing those would be the silent-substitution failure again, wearing
     * the word "optional".
     */
    const optional = request.optionalRoles?.includes(role) === true;
    problems.push(...(optional
      ? result.problems.filter((p) => p.reason !== 'no_occupant_requested')
      : result.problems));
  }

  const implementer = bound.get('coding_agent');
  const reviewer = bound.get('reviewer');
  if (implementer !== undefined && reviewer !== undefined) {
    if (!occupantsAreIndependent(implementer.occupant, reviewer.occupant)) {
      problems.push({
        role: 'reviewer',
        reason: 'reviewer_not_independent',
        safeMessage:
          `"${reviewer.occupant.occupantId}" is not independent of the Coding Agent `
          + `"${implementer.occupant.occupantId}". A review by the same agent, adapter or vendor group as the `
          + 'implementer is not an independent review, and Relay will not start one.',
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  const bindings: Partial<Record<RoleSlot, RoleBinding>> = {};
  for (const [role, binding] of bound) bindings[role] = binding;
  return { ok: true, bindings: Object.freeze(bindings) };
}

/**
 * One truthful line per bound slot.
 *
 * The bridge composes its preflight description from these, so the occupant
 * name a founder reads is the one the binding produced rather than a sentence
 * written alongside it. Any surface that later needs the same line uses this
 * one — that is the only way three surfaces stay in agreement.
 */
export function renderBindingLine(binding: RoleBinding): string {
  return `${binding.role}: ${binding.occupant.displayName} (${binding.occupant.occupantId})`;
}
