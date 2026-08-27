/**
 * MISSION CONTRACT → JULIUS BOOTSTRAP REQUEST.
 *
 * WHAT THIS DOES: compiles. It takes an authorized Relay Mission Contract, the
 * Compound Agent configuration that will run it, and the revisions everything
 * is pinned to, and produces a validated {@link JuliusBootstrapRequest}.
 *
 * WHAT THIS DOES NOT DO: execute. It starts nothing, dispatches nothing,
 * reserves no budget and reaches no provider. Submitting the compiled request
 * is a separate act through {@link JuliusBootstrapPort}, and the separation is
 * what lets a surface PREVIEW exactly what would be sent before anything is.
 *
 * FAIL CLOSED, AND NEVER REPAIR. Every refusal below names something the
 * caller changes. None of them is repaired silently — a Mission Contract with
 * no blocking acceptance criterion is not given one, a stale C.A.R.D. pin is
 * not re-pinned, a mismatched project is not reconciled. Silently fixing an
 * invalid contract is how a run executes against something nobody authorized.
 *
 * PURE. No Node, no network, no clock: `now` and every current revision arrive
 * as arguments.
 */

import type { RelayMissionContract } from '../../mission/contracts';
import {
  checkCompoundAgentSlots,
  type CompoundAgentAuthority,
  type CompoundAgentConfiguration,
  type CompoundAgentProblem,
  type IntegrationDirectory,
} from '../compound-agent';
import {
  JULIUS_AUTHORIZATION_METHODS,
  JULIUS_BOOTSTRAP_REQUEST_VERSION,
  type JuliusBootstrapAuthorization,
  type JuliusBootstrapRequest,
  type JuliusWorkerRequest,
} from './julius-port';

/* -------------------------------------------------------------- refusals */

/**
 * WHY A BOOTSTRAP WAS REFUSED.
 *
 * Separate from `CompoundAgentRefusal` because these are facts about a
 * REQUEST rather than about a stored configuration, and a surface handles them
 * differently: a configuration problem sends the user to the Compound Agent
 * editor, a bootstrap problem sends them to the mission.
 */
export const JULIUS_BOOTSTRAP_REFUSALS = [
  'authorization_absent',
  'tenant_mismatch',
  'project_mismatch',
  'compound_agent_project_mismatch',
  'invalid_idempotency_key',
  'malformed_mission_contract',
  'mission_not_locked',
  'mission_already_running',
  'mission_terminal',
  'acceptance_criteria_missing',
  'blocking_acceptance_criterion_missing',
  'duplicate_acceptance_criterion_id',
  'configuration_not_activated',
  'invalid_worker_configuration',
  'card_revision_unknown',
  'card_revision_stale',
  'project_brain_revision_unknown',
  'project_brain_revision_stale',
] as const;
export type JuliusBootstrapRefusal = (typeof JULIUS_BOOTSTRAP_REFUSALS)[number];

export interface JuliusBootstrapProblem {
  readonly reason: JuliusBootstrapRefusal;
  readonly field: string;
  readonly safeMessage: string;
}

export type JuliusBootstrapCompilation =
  | { readonly ok: true; readonly request: JuliusBootstrapRequest }
  | {
    readonly ok: false;
    readonly problems: readonly JuliusBootstrapProblem[];
    /** Configuration problems, kept typed rather than flattened into strings. */
    readonly configurationProblems: readonly CompoundAgentProblem[];
  };

/* --------------------------------------------------------------- inputs */

/**
 * The revisions this request is being pinned AGAINST.
 *
 * `null` means Relay could not determine the current revision. That is refused
 * rather than treated as "matches", because a pin nobody can check is not a
 * pin — and treating unknown as satisfied is precisely how a run executes
 * against a C.A.R.D. its owner never approved.
 */
export interface CurrentPinnedRevisions {
  readonly cardRevision: string | null;
  readonly projectBrainRevision: string | null;
}

export interface JuliusBootstrapInput {
  readonly mission: RelayMissionContract;
  readonly configuration: CompoundAgentConfiguration;
  readonly authorization: JuliusBootstrapAuthorization;
  readonly authority: CompoundAgentAuthority;
  readonly current: CurrentPinnedRevisions;
  readonly directory: IntegrationDirectory;
  readonly idempotencyKey: string;
  readonly now: string;
}

/* ----------------------------------------------------------- primitives */

/** Long enough to be unique in practice, bounded so it cannot carry a payload. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;

const problem = (
  reason: JuliusBootstrapRefusal,
  field: string,
  safeMessage: string,
): JuliusBootstrapProblem => ({ reason, field, safeMessage });

const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Which mission statuses may be bootstrapped, and why the others each get
 * their own refusal.
 *
 *   draft              not bound yet — the binding revision a run is pinned
 *                      to does not exist, so there is nothing to compile.
 *   in_progress /      a run already exists. Re-entering one is RECOVERY,
 *   blocked            which is Julius's, and starting a second is a
 *                      duplicate nobody asked for.
 *   verified_complete  terminal. Nothing restarts a finished mission.
 *   cancelled
 */
function missionStatusProblem(mission: RelayMissionContract): JuliusBootstrapProblem | null {
  switch (mission.status) {
    case 'locked':
      return null;
    case 'draft':
      return problem('mission_not_locked', 'mission.status',
        'This Mission Contract is still a draft. A bootstrap request is compiled from a LOCKED revision, because that is the revision the run is pinned to and a draft has none.');
    case 'in_progress':
    case 'blocked':
      return problem('mission_already_running', 'mission.status',
        `This Mission Contract is ${mission.status}. Re-entering an existing run is recovery, which the Julius runtime owns; Relay will not compile a second bootstrap for it.`);
    default:
      return problem('mission_terminal', 'mission.status',
        `This Mission Contract is ${mission.status} and cannot be started again.`);
  }
}

/* ---------------------------------------------------------- the compiler */

export function compileJuliusBootstrapRequest(input: JuliusBootstrapInput): JuliusBootstrapCompilation {
  const problems: JuliusBootstrapProblem[] = [];
  const { mission, configuration, authorization, authority, current } = input;

  /* ------------------------------------------------------ authorization */
  const methodKnown = (JULIUS_AUTHORIZATION_METHODS as readonly string[]).includes(authorization.method);
  if (!methodKnown || !isNonEmpty(authorization.authorizationRef)
    || !isNonEmpty(authorization.tenantId) || !isNonEmpty(authorization.projectId)
    || !isNonEmpty(authorization.ownerParticipant)) {
    problems.push(problem('authorization_absent', 'authorization',
      'A bootstrap request needs a complete authorization: a known method, a non-empty authorization reference, and the tenant, project and participant it was granted to. An incomplete authorization is refused rather than treated as anonymous.'));
  }

  if (authorization.tenantId !== authority.tenantId || configuration.tenantId !== authority.tenantId) {
    problems.push(problem('tenant_mismatch', 'tenantId',
      'The authorization, the Compound Agent and the caller do not agree on the tenant.'));
  }
  if (authorization.projectId !== authority.projectId) {
    problems.push(problem('project_mismatch', 'authorization.projectId',
      'The authorization was granted for a different project than the caller is acting in.'));
  }
  if (configuration.projectId !== mission.projectId) {
    problems.push(problem('compound_agent_project_mismatch', 'configuration.projectId',
      `This Compound Agent belongs to project "${configuration.projectId}" and the Mission Contract belongs to "${mission.projectId}". A Compound Agent runs only its own project's missions.`));
  }
  if (mission.projectId !== authority.projectId) {
    problems.push(problem('project_mismatch', 'mission.projectId',
      'The Mission Contract belongs to a different project than the caller is acting in.'));
  }

  /* --------------------------------------------------- idempotency key */
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    problems.push(problem('invalid_idempotency_key', 'idempotencyKey',
      'idempotencyKey must match ^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$. A retried submit is only safe when the key is stable and bounded.'));
  }

  /* ------------------------------------------------- the mission itself */
  if (!isNonEmpty(mission.missionId) || !isNonEmpty(mission.projectId)
    || !isNonEmpty(mission.objective) || !isNonEmpty(mission.bindingDigest)
    || !Number.isSafeInteger(mission.revision) || mission.revision < 1) {
    problems.push(problem('malformed_mission_contract', 'mission',
      'A Mission Contract needs a missionId, a projectId, an objective, a binding digest and a revision of at least 1. A contract missing any of them is refused rather than completed with defaults.'));
  }

  const statusProblem = missionStatusProblem(mission);
  if (statusProblem !== null) problems.push(statusProblem);

  const criteria = Array.isArray(mission.acceptanceCriteria) ? mission.acceptanceCriteria : [];
  if (criteria.length === 0) {
    problems.push(problem('acceptance_criteria_missing', 'mission.acceptanceCriteria',
      'A mission with no acceptance criteria has no definition of done, so no verification could ever pass or fail it.'));
  } else {
    if (!criteria.some((criterion) => criterion.blocking)) {
      problems.push(problem('blocking_acceptance_criterion_missing', 'mission.acceptanceCriteria',
        'At least one acceptance criterion must be blocking. Without one, completion would be decided by nothing.'));
    }
    const seen = new Set<string>();
    for (const criterion of criteria) {
      if (!isNonEmpty(criterion.id) || !isNonEmpty(criterion.text)) {
        problems.push(problem('malformed_mission_contract', 'mission.acceptanceCriteria',
          'Every acceptance criterion needs a non-empty id and text.'));
        break;
      }
      if (seen.has(criterion.id)) {
        problems.push(problem('duplicate_acceptance_criterion_id', 'mission.acceptanceCriteria',
          `Acceptance criterion id "${criterion.id}" appears more than once. Findings are attributed by criterion id, so a duplicate makes attribution ambiguous.`));
        break;
      }
      seen.add(criterion.id);
    }
  }

  /* -------------------------------------------------- the Compound Agent */
  if (configuration.activation !== 'ACTIVE') {
    problems.push(problem('configuration_not_activated', 'configuration.activation',
      `This Compound Agent is ${configuration.activation}. Only an ACTIVE configuration may start a run.`));
  }

  const configurationProblems = checkCompoundAgentSlots(configuration.slots, input.directory);
  if (configurationProblems.length > 0) {
    problems.push(problem('invalid_worker_configuration', 'configuration.slots',
      `This Compound Agent's worker slots do not currently resolve (${configurationProblems.length} problem(s)). The typed problems are returned alongside this refusal.`));
  }

  /* ----------------------------------------------------------- the pins */
  if (current.cardRevision === null) {
    problems.push(problem('card_revision_unknown', 'current.cardRevision',
      'Relay could not determine the current C.A.R.D. revision, so it cannot confirm this Compound Agent is pinned to it. An unverifiable pin is refused rather than assumed fresh.'));
  } else if (current.cardRevision !== configuration.card.revision) {
    problems.push(problem('card_revision_stale', 'configuration.card.revision',
      `This Compound Agent is pinned to C.A.R.D. revision "${configuration.card.revision}" and the current revision is "${current.cardRevision}". Re-validate the Compound Agent against the new C.A.R.D. before running it.`));
  }
  if (current.projectBrainRevision === null) {
    problems.push(problem('project_brain_revision_unknown', 'current.projectBrainRevision',
      'Relay could not determine the current Project Brain revision, so it cannot confirm this Compound Agent is pinned to it.'));
  } else if (current.projectBrainRevision !== configuration.projectBrain.revision) {
    problems.push(problem('project_brain_revision_stale', 'configuration.projectBrain.revision',
      `This Compound Agent is pinned to Project Brain revision "${configuration.projectBrain.revision}" and the current revision is "${current.projectBrainRevision}".`));
  }

  if (problems.length > 0) return { ok: false, problems, configurationProblems };

  /* ------------------------------------------------------- the request */
  const workers: JuliusWorkerRequest[] = [];
  for (const slot of configuration.slots) {
    // Every slot resolved above, so a lookup miss here is impossible; the
    // guard exists so a future change that reorders these passes fails loudly
    // rather than emitting a worker with empty identity.
    const entry = input.directory.lookup(slot.integrationId);
    if (entry === null) {
      return {
        ok: false,
        problems: [problem('invalid_worker_configuration', 'configuration.slots',
          `"${slot.integrationId}" resolved during validation and not during compilation. Nothing was submitted.`)],
        configurationProblems,
      };
    }
    workers.push({
      role: slot.role,
      integrationId: entry.integrationId,
      adapterId: entry.adapterId,
      independenceGroup: entry.independenceGroup,
      requiredCapabilities: slot.requiredCapabilities,
    });
  }

  return {
    ok: true,
    request: {
      requestVersion: JULIUS_BOOTSTRAP_REQUEST_VERSION,
      idempotencyKey: input.idempotencyKey,
      missionId: mission.missionId,
      projectId: mission.projectId,
      tenantId: configuration.tenantId,
      compoundAgentId: configuration.compoundAgentId,
      compoundAgentRevision: configuration.revision,
      authorization,
      objective: mission.objective,
      requirements: mission.requirements,
      constraints: mission.constraints,
      acceptanceCriteria: criteria.map((criterion) => ({
        id: criterion.id, text: criterion.text, blocking: criterion.blocking,
      })),
      scope: {
        filesInScope: mission.filesInScope,
        filesOutOfScope: mission.filesOutOfScope,
        systemsInScope: mission.systemsInScope,
        systemsOutOfScope: mission.systemsOutOfScope,
      },
      workers,
      card: configuration.card,
      projectBrain: configuration.projectBrain,
      executionMode: configuration.missionDefaults.executionMode,
      reviewRequirement: configuration.missionDefaults.reviewRequirement,
      // THE COMPLETION RULE COMES FROM THE MISSION, not the Compound Agent.
      // A Compound Agent's `missionDefaults.completionRule` is a preference
      // used when AUTHORING a mission; once a Mission Contract is locked, the
      // rule it was locked with is the rule the run is judged by. Taking the
      // Compound Agent's value here would let an edit to a saved profile
      // change the definition of done for a mission already bound.
      completionRule: mission.completionRule,
      limits: configuration.missionDefaults.limits,
      missionRevision: mission.revision,
      missionBindingDigest: mission.bindingDigest,
      compiledAt: input.now,
    },
  };
}
