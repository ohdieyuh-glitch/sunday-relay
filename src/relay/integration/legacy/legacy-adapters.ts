/**
 * LEGACY RELAY → THE JULIUS BOUNDARY.
 *
 * Relay carries substantial pre-Julius backend structure — saved PSPs,
 * `RelayMissionConfig`, `MissionSpec`, `RelayMissionContract`, repository
 * permissions, and the existing ledger terminal events. All of it works, none
 * of it is rewritten here, and none of it is taught to Julius.
 *
 * THE BOUNDARY NORMALIZES; JULIUS CORE DOES NOT LEARN FIVE SCHEMAS. That is
 * the whole architectural point of this module. The alternative — teaching the
 * runtime to accept a PSP's `roles.architect`, a `MissionSpec`'s
 * `implementerRequirement` and a Compound Agent's `slots` — puts three
 * vocabularies inside the thing that is supposed to have one.
 *
 * TWO VOCABULARIES FOR ONE CONCEPT, FOUND AND NAMED. Relay already expresses
 * "the completion rule" twice: `RelayMissionConfig.completionRule` is
 * `strict | balanced | custom` and `RelayMissionContract.completionRule` is
 * `all_blocking_criteria_and_independent_review | all_blocking_criteria`.
 * Nothing in the repository mapped between them, so every surface that needed
 * both did it inline or avoided the question. The mapping now lives here,
 * once — and `custom` is NOT mapped, because "the user defined their own rule"
 * has no honest translation into a two-member enum and guessing one would
 * silently change a mission's definition of done.
 *
 * IT CONVERTS BACKEND DATA ONLY. No deprecated frontend visual is resurrected,
 * referenced, or implied by anything here.
 *
 * PURE. No Node, no network, no clock.
 */

import type { MissionCompletionRule, MissionSpec, RelayMissionContract } from '../../mission/contracts';
import type { RelayMissionConfig } from '../../mission/mission-config';
import type { RepositoryPermission } from '../../mission/repository-target';
import type { ProjectTerminalEventInput } from '../../mission/terminal';
import { ROLE_SLOTS, type RoleSlot } from '../../mission/role-slots';
import {
  COMPOUND_AGENT_SLOTS,
  type CompoundAgentMissionDefaults,
  type CompoundAgentSlot,
  type CompoundAgentSlotSelection,
  type IntegrationDirectory,
} from '../compound-agent';
import { ROLE_SLOT_TO_COMPOUND_AGENT_SLOT } from '../registry';
import type { JuliusEventActor, JuliusOperationalEvent } from '../terminal';

/* -------------------------------------------------------------- refusals */

export const LEGACY_CONVERSION_REFUSALS = [
  'role_selection_absent',
  'role_selection_unknown',
  'role_selection_wrong_slot',
  'completion_rule_not_translatable',
  'mission_identity_missing',
  'acceptance_criteria_missing',
] as const;
export type LegacyConversionRefusal = (typeof LEGACY_CONVERSION_REFUSALS)[number];

export interface LegacyConversionProblem {
  readonly reason: LegacyConversionRefusal;
  readonly field: string;
  readonly safeMessage: string;
  readonly role: CompoundAgentSlot | null;
}

const problem = (
  reason: LegacyConversionRefusal,
  field: string,
  safeMessage: string,
  role: CompoundAgentSlot | null = null,
): LegacyConversionProblem => ({ reason, field, safeMessage, role });

/* -------------------------------------------------- the role-name mapping */

/**
 * A PSP names its three role selectors `architect`, `coding` and `reviewer`;
 * the role-slot registry calls the same three `prompt_architect`,
 * `coding_agent` and `reviewer`; Julius calls them `PROMPT_ARCHITECT`,
 * `CODING_AGENT` and `INDEPENDENT_REVIEWER`. Three names for one role is not a
 * problem to solve by renaming a stored field — it is a problem to solve at
 * the boundary, once, with a total map a test walks in both directions.
 */
export const PSP_ROLE_KEY_TO_ROLE_SLOT: Readonly<Record<keyof RelayMissionConfig['roles'], RoleSlot>> =
  Object.freeze({ architect: 'prompt_architect', coding: 'coding_agent', reviewer: 'reviewer' });

export const PSP_ROLE_KEYS = Object.freeze(
  Object.keys(PSP_ROLE_KEY_TO_ROLE_SLOT) as Array<keyof RelayMissionConfig['roles']>,
);

/* --------------------------------------------------- completion-rule map */

/**
 * The ONE translation between Relay's two completion vocabularies.
 *
 * `custom` is deliberately absent. A two-member enum has no member meaning
 * "whatever the user wrote", and picking either one would change what
 * "complete" means for a mission without the user having said so. The
 * converter refuses instead and names the field.
 */
export const PSP_COMPLETION_RULE_TO_MISSION_RULE:
Readonly<Record<'strict' | 'balanced', MissionCompletionRule>> = Object.freeze({
  strict: 'all_blocking_criteria_and_independent_review',
  balanced: 'all_blocking_criteria',
});

export function translateCompletionRule(
  rule: RelayMissionConfig['completionRule'],
): MissionCompletionRule | null {
  return rule === 'custom' ? null : PSP_COMPLETION_RULE_TO_MISSION_RULE[rule];
}

/* --------------------------------------------- PSP → Compound Agent draft */

export interface LegacyConfigConversion {
  readonly slots: readonly CompoundAgentSlotSelection[];
  readonly missionDefaults: CompoundAgentMissionDefaults;
  /** The permissions the legacy config REQUESTED, carried unchanged. */
  readonly requestedPermissions: readonly RepositoryPermission[];
  /** Roles the legacy config left to a deployment default. */
  readonly unresolvedRoles: readonly CompoundAgentSlot[];
  readonly problems: readonly LegacyConversionProblem[];
  /** True only when every slot resolved and every field translated. */
  readonly complete: boolean;
}

/**
 * Convert a saved PSP's {@link RelayMissionConfig} into the slot selections and
 * mission defaults a Compound Agent draft needs.
 *
 * A NULL SELECTOR IS REPORTED, NEVER FILLED. A PSP's `roles.coding: null`
 * means "use whatever this deployment defaults to", which is a coherent thing
 * for a deployment-scoped mission start and an incoherent thing for a
 * user-owned Compound Agent: the whole point of the Compound Agent record is
 * that its occupants are named before a run exists. Substituting
 * `DEVELOPMENT_DEFAULT_OCCUPANTS` here would hand a user a Compound Agent
 * staffed by a choice they never made, and — for the coding slot — that
 * default is an installed CLI that a hosted deployment can never run. So the
 * role comes back in `unresolvedRoles` for a migration surface to ask about.
 *
 * `complete: false` is a normal outcome, not a failure. The conversion still
 * returns everything it DID resolve, so a migration can pre-fill two slots and
 * ask about the third.
 */
export function convertLegacyMissionConfig(
  config: RelayMissionConfig,
  directory: IntegrationDirectory,
): LegacyConfigConversion {
  const problems: LegacyConversionProblem[] = [];
  const slots: CompoundAgentSlotSelection[] = [];
  const unresolvedRoles: CompoundAgentSlot[] = [];

  for (const key of PSP_ROLE_KEYS) {
    const slot = ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[PSP_ROLE_KEY_TO_ROLE_SLOT[key]];
    const selector = config.roles[key];
    if (selector === null || selector.trim() === '') {
      unresolvedRoles.push(slot);
      problems.push(problem('role_selection_absent', `roles.${key}`,
        `This saved configuration left the ${slot} slot to the deployment's default. A Compound Agent names its own occupants, so this one must be chosen before the agent can run.`, slot));
      continue;
    }
    const entry = directory.lookup(selector.trim());
    if (entry === null) {
      problems.push(problem('role_selection_unknown', `roles.${key}`,
        `This saved configuration names "${selector}" for the ${slot} slot, and no such integration is registered. It may have been removed since the configuration was saved.`, slot));
      continue;
    }
    if (!entry.roles.includes(slot)) {
      problems.push(problem('role_selection_wrong_slot', `roles.${key}`,
        `This saved configuration names "${selector}" for the ${slot} slot, and that integration serves ${entry.roles.length > 0 ? entry.roles.join(', ') : 'no slot'}.`, slot));
      continue;
    }
    slots.push({ role: slot, integrationId: entry.integrationId, requiredCapabilities: [] });
  }

  if (config.completionRule === 'custom') {
    problems.push(problem('completion_rule_not_translatable', 'completionRule',
      'This saved configuration uses a custom completion rule. Relay will not translate it into one of the two mission completion rules on the user\'s behalf, because either choice would change what "complete" means for the mission.'));
  }

  return {
    slots,
    missionDefaults: {
      executionMode: config.mode,
      reviewRequirement: config.review,
      // A `custom` rule cannot cross the boundary, so the DEFAULTS carry the
      // legacy value unchanged and the refusal above is what stops it being
      // used. Rewriting it here would erase the fact that it was custom.
      completionRule: config.completionRule,
      // Carried unchanged. The repository resolver narrows a request against
      // real grants, so a legacy config can only ever have asked for authority
      // a human already approved — there is nothing here to re-approve, and
      // re-deriving the set would be a second answer to a settled question.
      requestedPermissions: config.permissions,
      limits: {
        runtimeMinutes: config.limits.runtimeMinutes,
        agentCalls: config.limits.agentCalls,
        spendUsd: config.limits.spendUsd,
        reviewCycles: config.limits.reviewCycles,
        repairCycles: config.limits.repairCycles,
      },
    },
    requestedPermissions: config.permissions,
    unresolvedRoles,
    problems,
    complete: problems.length === 0 && slots.length === COMPOUND_AGENT_SLOTS.length,
  };
}

/* ------------------------------------------------- mission normalization */

/**
 * What a mission carries across the boundary, whatever shape it arrived in.
 *
 * Two legacy shapes reach this boundary: an authored {@link MissionSpec} (no
 * ids, no revision, no digest) and a built {@link RelayMissionContract}. They
 * normalize into ONE record so the bootstrap adapter has a single input shape,
 * and so the two properties that must never be lost in translation — the
 * project identity and the acceptance criteria — are checked in one place
 * rather than at each call site.
 */
export interface NormalizedLegacyMission {
  readonly projectId: string;
  readonly missionId: string | null;
  readonly title: string;
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly scope: {
    readonly filesInScope: readonly string[];
    readonly filesOutOfScope: readonly string[];
    readonly systemsInScope: readonly string[];
    readonly systemsOutOfScope: readonly string[];
  };
  readonly completionRule: MissionCompletionRule;
  readonly revision: number | null;
  readonly bindingDigest: string | null;
}

export type LegacyMissionNormalization =
  | { readonly ok: true; readonly mission: NormalizedLegacyMission }
  | { readonly ok: false; readonly problems: readonly LegacyConversionProblem[] };

function normalizeCriteria(
  criteria: readonly { id: string; text: string; blocking: boolean }[],
  problems: LegacyConversionProblem[],
): readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[] {
  if (criteria.length === 0) {
    problems.push(problem('acceptance_criteria_missing', 'acceptanceCriteria',
      'A mission with no acceptance criteria has no definition of done. Relay does not add one during conversion.'));
    return [];
  }
  // Copied field by field rather than spread, so a criterion that grows a
  // field upstream cannot silently start crossing the boundary unreviewed.
  return criteria.map((criterion) => ({
    id: criterion.id, text: criterion.text, blocking: criterion.blocking,
  }));
}

/** Normalize a BUILT contract. Identity, revision and digest are all present. */
export function normalizeMissionContract(mission: RelayMissionContract): LegacyMissionNormalization {
  const problems: LegacyConversionProblem[] = [];
  if (mission.projectId.trim() === '' || mission.missionId.trim() === '') {
    problems.push(problem('mission_identity_missing', 'projectId',
      'A mission must carry its project and mission identity across the boundary. Conversion never invents either.'));
  }
  const acceptanceCriteria = normalizeCriteria(mission.acceptanceCriteria, problems);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    mission: {
      projectId: mission.projectId,
      missionId: mission.missionId,
      title: mission.title,
      objective: mission.objective,
      requirements: mission.requirements,
      constraints: mission.constraints,
      acceptanceCriteria,
      scope: {
        filesInScope: mission.filesInScope,
        filesOutOfScope: mission.filesOutOfScope,
        systemsInScope: mission.systemsInScope,
        systemsOutOfScope: mission.systemsOutOfScope,
      },
      completionRule: mission.completionRule,
      revision: mission.revision,
      bindingDigest: mission.bindingDigest,
    },
  };
}

/**
 * Normalize an AUTHORED spec, which has no identity of its own.
 *
 * `projectId` is supplied by the CALLER, from the authorization it is acting
 * under — never read from the spec, which does not have one. `missionId`,
 * `revision` and `bindingDigest` stay `null` and render as Unknown: a spec has
 * not been bound yet, and inventing a digest for one would produce a value
 * that looks like a binding and is not.
 */
export function normalizeMissionSpec(
  spec: MissionSpec,
  projectId: string,
): LegacyMissionNormalization {
  const problems: LegacyConversionProblem[] = [];
  if (projectId.trim() === '') {
    problems.push(problem('mission_identity_missing', 'projectId',
      'A mission spec carries no project of its own, so the caller must supply the project it is authorized for.'));
  }
  const acceptanceCriteria = normalizeCriteria(spec.acceptanceCriteria, problems);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    mission: {
      projectId,
      missionId: null,
      title: spec.title,
      objective: spec.objective,
      requirements: spec.requirements,
      constraints: spec.constraints,
      acceptanceCriteria,
      scope: {
        filesInScope: spec.filesInScope,
        filesOutOfScope: spec.filesOutOfScope,
        systemsInScope: spec.systemsInScope,
        systemsOutOfScope: spec.systemsOutOfScope,
      },
      completionRule: spec.completionRule,
      revision: null,
      bindingDigest: null,
    },
  };
}

/* ------------------------------------------- legacy events → the terminal */

/**
 * WHICH PERMANENT LABEL A PRE-JULIUS LEDGER EVENT BELONGS UNDER.
 *
 * The existing terminal read model attributes an event to a `source` string —
 * `relay-core`, `architect`, `coding-agent`, `reviewer`, `verification`,
 * `system`, `user`. Those are Relay's own sources and they predate Julius, so
 * they map onto the permanent labels rather than being replaced by them: a
 * user reading one Live Terminal should not be able to tell which era an entry
 * came from by its label.
 *
 * `user` maps to `RELAY_SYSTEM` on purpose. There is no permanent USER label,
 * and inventing one so that legacy events had somewhere to go would add an
 * eleventh label to a list the product fixed at ten.
 */
export const LEGACY_SOURCE_TO_ACTOR: Readonly<Record<string, JuliusEventActor>> = Object.freeze({
  'relay-core': 'RELAY_SYSTEM',
  system: 'RELAY_SYSTEM',
  user: 'RELAY_SYSTEM',
  architect: 'PROMPT_ARCHITECT',
  'coding-agent': 'CODING_AGENT',
  reviewer: 'INDEPENDENT_REVIEWER',
  verification: 'RELAY_VERIFICATION',
});

/**
 * Adapt one pre-Julius ledger event into the normalized event the Live
 * Terminal projection reads.
 *
 * The projection then applies its own redaction and its own private-reasoning
 * rule, so a legacy event gets exactly the same treatment as a Julius one —
 * which is the reason to adapt rather than to keep a second renderer.
 *
 * An unmapped source becomes `RELAY_SYSTEM` rather than being dropped. A
 * source Relay does not recognise is still something that happened.
 */
export function adaptLegacyTerminalEvent(
  input: ProjectTerminalEventInput,
  runId: string,
): JuliusOperationalEvent {
  return {
    eventId: input.eventId ?? `evt_${input.sequence}`,
    sequence: input.sequence,
    occurredAt: input.at,
    runId,
    kind: input.kind,
    actor: LEGACY_SOURCE_TO_ACTOR[input.source] ?? 'RELAY_SYSTEM',
    safeSummary: input.safeSummary,
    taskId: input.taskId ?? null,
    // The legacy model carries no severity, and `null` means UNKNOWN. The
    // projection decides a default; guessing one here would put two different
    // defaults in the product.
    severity: null,
    facts: {},
  };
}

/* ---------------------------------------------------------- completeness */

/** Every Relay role slot has a PSP key, and every PSP key a role slot. */
export function roleMappingIsTotal(): boolean {
  const mapped = PSP_ROLE_KEYS.map((key) => PSP_ROLE_KEY_TO_ROLE_SLOT[key]);
  return ROLE_SLOTS.every((slot) => mapped.includes(slot)) && mapped.length === ROLE_SLOTS.length;
}
