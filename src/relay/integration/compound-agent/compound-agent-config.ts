/**
 * COMPOUND AGENT CONFIGURATION — parsing, invariants, and revisioned writes.
 *
 * This module answers exactly one question: is this a configuration Relay may
 * store and later ask Julius to run under? It never starts anything, never
 * dispatches anything, and never decides how anything executes. Those are
 * Julius's, and the boundary is the point.
 *
 * REFUSE, DO NOT REPAIR. `validateMissionConfig` — the PSP validator this sits
 * beside — normalizes an unrecognised enum to its most conservative member,
 * which is right for a preference a user can re-pick in a form. Every field
 * here is either an AUTHORIZATION (which integration acts as whom) or a
 * durable record a later run is pinned to, and quietly rewriting one of those
 * produces a Compound Agent that runs as something its owner did not choose.
 * So this validator refuses, with a structured problem per field, and returns
 * ALL of them rather than the first — a form that fixes one error at a time is
 * a form nobody finishes.
 *
 * THE DOMAIN DECLARES THE SHAPE IT NEEDS. {@link IntegrationDirectory} is a
 * narrow structural view, not the registry type. The registry (PR B) returns a
 * richer entry that happens to satisfy this; a test double satisfies it in
 * four lines. That inversion is the repository's standing rule — "the domain
 * declares the shape it needs and a composition root wires the two" — and it
 * is what keeps this module free of any provider, credential or transport.
 */

import { reviewerIsIndependent } from '../../mission/entitlement';
import { REPOSITORY_PERMISSIONS, isRepositoryPermission, type RepositoryPermission } from '../../mission/repository-target';
import {
  COMPOUND_AGENT_ACTIVATIONS,
  COMPOUND_AGENT_SLOTS,
  identityIsReservedForJulius,
  type CompoundAgentActivation,
  type CompoundAgentConfiguration,
  type CompoundAgentMissionDefaults,
  type CompoundAgentProblem,
  type CompoundAgentReadiness,
  type CompoundAgentSlot,
  type CompoundAgentSlotSelection,
  type CompoundAgentValidation,
  type PinnedRevisionReference,
} from './compound-agent-contracts';

/* --------------------------------------------------- the directory it needs */

/**
 * ONE INTEGRATION, AS THIS VALIDATOR NEEDS TO SEE IT.
 *
 * `roles` is plural because one integration may legitimately be offered for
 * more than one slot — the same OpenAI credential backs both a Prompt
 * Architect and a Reviewer in Relay today, and the registry models that as two
 * entries precisely so enabling the second is its own decision. A future
 * registry that models it as one entry with two roles is still valid input
 * here, and the role-match check below reads identically either way.
 *
 * The three identity fields exist so independence can be computed by Relay's
 * ONE existing rule (`reviewerIsIndependent`) rather than by a second rule
 * invented here. That is the same reason `RoleOccupant` carries them.
 */
export interface IntegrationDirectoryEntry {
  readonly integrationId: string;
  readonly roles: readonly CompoundAgentSlot[];
  readonly enabled: boolean;
  /** Capability tags this integration OFFERS. */
  readonly capabilities: readonly string[];
  /** Environment variable NAMES it declares it needs. Names only, never values. */
  readonly configurationRequirements: readonly string[];
  readonly agentId: string;
  readonly adapterId: string;
  readonly independenceGroup: string;
}

/** The only registry capability this domain depends on. */
export interface IntegrationDirectory {
  lookup(integrationId: string): IntegrationDirectoryEntry | null;
}

/* ---------------------------------------------------------- the authority */

/**
 * WHO IS ASKING, resolved from a verified session and never from the request
 * body. Every field is compared against the record rather than copied into it,
 * so a body claiming another tenant, project or owner is refused instead of
 * being believed.
 */
export interface CompoundAgentAuthority {
  readonly tenantId: string;
  readonly projectId: string;
  readonly ownerParticipant: string;
}

/* -------------------------------------------------------------- the draft */

/** The submitted shape, after structural parsing and before any registry check. */
export interface CompoundAgentDraft {
  readonly compoundAgentId: string;
  readonly displayName: string;
  readonly slots: readonly CompoundAgentSlotSelection[];
  readonly card: PinnedRevisionReference;
  readonly projectBrain: PinnedRevisionReference;
  readonly missionDefaults: CompoundAgentMissionDefaults;
  readonly activation: CompoundAgentActivation;
}

export type CompoundAgentDraftResult =
  | { readonly ok: true; readonly draft: CompoundAgentDraft }
  | { readonly ok: false; readonly problems: readonly CompoundAgentProblem[] };

/* ------------------------------------------------------------- primitives */

/** Ids double as path segments in the durable store, so they stay filesystem-safe. */
export const COMPOUND_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A display name is shown to humans; it is never compared and never an id. */
const DISPLAY_NAME_MAX = 120;

const EXECUTION_MODES = ['guided', 'semi', 'autonomous'] as const;
const REVIEW_REQUIREMENTS = ['none', 'independent', 'security', 'manual_founder'] as const;
const COMPLETION_RULES = ['strict', 'balanced', 'custom'] as const;
const LIMIT_FIELDS = ['runtimeMinutes', 'agentCalls', 'spendUsd', 'reviewCycles', 'repairCycles'] as const;

const problem = (
  reason: CompoundAgentProblem['reason'],
  field: string,
  safeMessage: string,
  role: CompoundAgentSlot | null = null,
): CompoundAgentProblem => ({ reason, role, field, safeMessage });

const asRecord = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** Distinct strings, trimmed, order preserved. Non-strings are dropped by the
 *  caller's own check rather than silently here. */
const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values.map((v) => v.trim()))];

/* --------------------------------------------------------------- parsing */

function parsePinnedReference(
  raw: unknown,
  field: string,
  problems: CompoundAgentProblem[],
): PinnedRevisionReference {
  const record = asRecord(raw);
  const referenceId = record.referenceId;
  const revision = record.revision;
  if (!isNonEmptyString(referenceId) || !isNonEmptyString(revision)) {
    problems.push(problem(
      'invalid_revision_reference',
      field,
      `${field} needs a non-empty referenceId and revision. A pinned reference with either half missing cannot be checked for staleness, so it is refused rather than stored.`,
    ));
    return { referenceId: '', revision: '' };
  }
  return { referenceId: referenceId.trim(), revision: revision.trim() };
}

function parseMissionDefaults(
  raw: unknown,
  problems: CompoundAgentProblem[],
): CompoundAgentMissionDefaults {
  const record = asRecord(raw);
  const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    problems.push(problem(
      'invalid_mission_defaults',
      `missionDefaults.${field}`,
      `missionDefaults.${field} must be one of: ${allowed.join(', ')}. An unrecognised value is refused rather than replaced, so a Compound Agent never runs under a policy its owner did not pick.`,
    ));
    return allowed[0];
  };

  const limitsRaw = asRecord(record.limits);
  const limits: Record<string, number | null> = {};
  for (const field of LIMIT_FIELDS) {
    const value = limitsRaw[field];
    if (value === undefined || value === null) { limits[field] = null; continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      problems.push(problem(
        'invalid_limit',
        `missionDefaults.limits.${field}`,
        `missionDefaults.limits.${field} must be a non-negative finite number when set, or null for "not set by this configuration". A limit that is not a real number is not a limit.`,
      ));
      limits[field] = null;
      continue;
    }
    limits[field] = value;
  }

  // REFUSED, NOT DROPPED. See `CompoundAgentMissionDefaults.requestedPermissions`
  // for why this layer differs from `validateMissionConfig` here.
  const permissionsRaw = record.requestedPermissions;
  const requestedPermissions: RepositoryPermission[] = [];
  if (permissionsRaw !== undefined && !Array.isArray(permissionsRaw)) {
    problems.push(problem(
      'invalid_permission',
      'missionDefaults.requestedPermissions',
      'missionDefaults.requestedPermissions must be an array of repository permissions when present.',
    ));
  } else {
    for (const value of (Array.isArray(permissionsRaw) ? permissionsRaw : [])) {
      if (typeof value !== 'string' || !isRepositoryPermission(value)) {
        problems.push(problem(
          'invalid_permission',
          'missionDefaults.requestedPermissions',
          `"${String(value)}" is not a repository permission. Relay accepts: ${REPOSITORY_PERMISSIONS.join(', ')}. An unrecognised permission is refused rather than dropped, so a Compound Agent never quietly lacks authority its owner believes it has.`,
        ));
        continue;
      }
      if (!requestedPermissions.includes(value)) requestedPermissions.push(value);
    }
  }

  return {
    executionMode: pick(record.executionMode, EXECUTION_MODES, 'executionMode'),
    reviewRequirement: pick(record.reviewRequirement, REVIEW_REQUIREMENTS, 'reviewRequirement'),
    completionRule: pick(record.completionRule, COMPLETION_RULES, 'completionRule'),
    requestedPermissions,
    limits: {
      runtimeMinutes: limits.runtimeMinutes,
      agentCalls: limits.agentCalls,
      spendUsd: limits.spendUsd,
      reviewCycles: limits.reviewCycles,
      repairCycles: limits.repairCycles,
    },
  };
}

function parseSlots(raw: unknown, problems: CompoundAgentProblem[]): CompoundAgentSlotSelection[] {
  if (!Array.isArray(raw)) {
    problems.push(problem('role_slot_missing', 'slots', 'slots must be an array holding one selection per worker slot.'));
    return [];
  }
  const parsed: CompoundAgentSlotSelection[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const role = record.role;
    if (typeof role !== 'string' || !(COMPOUND_AGENT_SLOTS as readonly string[]).includes(role)) {
      problems.push(problem(
        'unknown_slot_role',
        `slots[${index}].role`,
        `slots[${index}].role must be one of: ${COMPOUND_AGENT_SLOTS.join(', ')}. Julius's worker slots are fixed; a fourth is a product decision, not a configuration one.`,
      ));
      return;
    }
    const integrationId = record.integrationId;
    if (!isNonEmptyString(integrationId)) {
      problems.push(problem(
        'unknown_integration',
        `slots[${index}].integrationId`,
        `slots[${index}].integrationId must be a non-empty integration id.`,
        role as CompoundAgentSlot,
      ));
      return;
    }
    const capabilitiesRaw = record.requiredCapabilities;
    const capabilityList = Array.isArray(capabilitiesRaw) ? capabilitiesRaw : [];
    if (capabilitiesRaw !== undefined && !Array.isArray(capabilitiesRaw)) {
      problems.push(problem(
        'capability_unsupported',
        `slots[${index}].requiredCapabilities`,
        `slots[${index}].requiredCapabilities must be an array of capability tags when present.`,
        role as CompoundAgentSlot,
      ));
      return;
    }
    if (!capabilityList.every(isNonEmptyString)) {
      problems.push(problem(
        'capability_unsupported',
        `slots[${index}].requiredCapabilities`,
        `slots[${index}].requiredCapabilities must hold non-empty capability tags.`,
        role as CompoundAgentSlot,
      ));
      return;
    }
    parsed.push({
      role: role as CompoundAgentSlot,
      integrationId: integrationId.trim(),
      requiredCapabilities: uniqueStrings(capabilityList as string[]),
    });
  });
  return parsed;
}

/**
 * Structural parse of a submitted body. Registry-independent on purpose: a
 * malformed body and an unresolvable integration are different mistakes with
 * different remedies, and separating the passes keeps the second from being
 * hidden behind the first.
 */
export function parseCompoundAgentDraft(raw: unknown): CompoundAgentDraftResult {
  const problems: CompoundAgentProblem[] = [];
  const record = asRecord(raw);

  const compoundAgentId = typeof record.compoundAgentId === 'string' ? record.compoundAgentId.trim() : '';
  if (!COMPOUND_AGENT_ID.test(compoundAgentId)) {
    problems.push(problem(
      'invalid_identifier',
      'compoundAgentId',
      'compoundAgentId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$. The id is used as a storage path segment, so a value outside that set is refused rather than escaped.',
    ));
  }

  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
  if (displayName === '' || displayName.length > DISPLAY_NAME_MAX) {
    problems.push(problem(
      'invalid_display_name',
      'displayName',
      `displayName must be non-empty and at most ${DISPLAY_NAME_MAX} characters.`,
    ));
  }

  const slots = parseSlots(record.slots, problems);
  const card = parsePinnedReference(record.card, 'card', problems);
  const projectBrain = parsePinnedReference(record.projectBrain, 'projectBrain', problems);
  const missionDefaults = parseMissionDefaults(record.missionDefaults, problems);

  const activationRaw = record.activation;
  const activation: CompoundAgentActivation =
    typeof activationRaw === 'string' && (COMPOUND_AGENT_ACTIVATIONS as readonly string[]).includes(activationRaw)
      ? activationRaw as CompoundAgentActivation
      : 'DRAFT';
  if (activationRaw !== undefined && activation === 'DRAFT' && activationRaw !== 'DRAFT') {
    problems.push(problem(
      'invalid_mission_defaults',
      'activation',
      `activation must be one of: ${COMPOUND_AGENT_ACTIVATIONS.join(', ')}.`,
    ));
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    draft: { compoundAgentId, displayName, slots, card, projectBrain, missionDefaults, activation },
  };
}

/* ------------------------------------------------------- slot invariants */

/**
 * EVERY SLOT INVARIANT, IN ONE PLACE.
 *
 * Ordered so the most specific refusal wins. A slot naming Julius is refused
 * as a reserved name BEFORE it is looked up, because "unknown integration"
 * would be both true and useless: the remedy is not a spelling correction.
 */
export function checkCompoundAgentSlots(
  slots: readonly CompoundAgentSlotSelection[],
  directory: IntegrationDirectory,
): CompoundAgentProblem[] {
  const problems: CompoundAgentProblem[] = [];

  /* -- exactly once, per slot -- */
  const byRole = new Map<CompoundAgentSlot, CompoundAgentSlotSelection[]>();
  for (const slot of slots) {
    const existing = byRole.get(slot.role);
    if (existing) existing.push(slot); else byRole.set(slot.role, [slot]);
  }
  for (const role of COMPOUND_AGENT_SLOTS) {
    const selections = byRole.get(role) ?? [];
    if (selections.length === 0) {
      problems.push(problem(
        'role_slot_missing',
        'slots',
        `No integration is configured for the ${role} slot. All three worker slots must be filled exactly once; an empty slot is not a default, because Relay does not choose a worker on the owner's behalf.`,
        role,
      ));
    } else if (selections.length > 1) {
      problems.push(problem(
        'role_slot_duplicated',
        'slots',
        `The ${role} slot is configured ${selections.length} times. A slot has exactly one occupant, and two selections for one slot means one of them would be silently discarded.`,
        role,
      ));
    }
  }

  /* -- resolution, role match, enablement, capabilities -- */
  const resolved = new Map<CompoundAgentSlot, IntegrationDirectoryEntry>();
  for (const slot of slots) {
    if (identityIsReservedForJulius(slot.integrationId)) {
      problems.push(problem(
        'julius_cannot_occupy_worker_slot',
        'slots',
        `"${slot.integrationId}" is refused for the ${slot.role} slot: Julius is the Compound Agent harness that organizes the workers, never one of them. GPT, Claude and Hermes may occupy a worker slot; Julius may not.`,
        slot.role,
      ));
      continue;
    }
    const entry = directory.lookup(slot.integrationId);
    if (entry === null) {
      problems.push(problem(
        'unknown_integration',
        'slots',
        `"${slot.integrationId}" is not a supported integration. Relay only presents and accepts integrations the server registry actually declares, so an id that is not in it is refused rather than passed through to Julius.`,
        slot.role,
      ));
      continue;
    }
    if (!entry.roles.includes(slot.role)) {
      problems.push(problem(
        'integration_role_mismatch',
        'slots',
        `"${entry.integrationId}" is not offered for the ${slot.role} slot (it serves: ${entry.roles.length > 0 ? entry.roles.join(', ') : 'no slot'}). Roles do not swap silently.`,
        slot.role,
      ));
      continue;
    }
    if (!entry.enabled) {
      problems.push(problem(
        'integration_disabled',
        'slots',
        `"${entry.integrationId}" is currently disabled and cannot be configured into the ${slot.role} slot. This is an operator action rather than a fault in the configuration.`,
        slot.role,
      ));
      continue;
    }
    const missing = slot.requiredCapabilities.filter((capability) => !entry.capabilities.includes(capability));
    if (missing.length > 0) {
      problems.push(problem(
        'capability_unsupported',
        'slots',
        `"${entry.integrationId}" does not offer the capabilities this slot requires: ${missing.join(', ')}.`,
        slot.role,
      ));
      continue;
    }
    // Only the FIRST selection for a role is resolved. A duplicated slot is
    // already refused above, and resolving the second here would decide which
    // of two selections "won" — exactly the silent discard that refusal exists
    // to prevent.
    if (!resolved.has(slot.role)) resolved.set(slot.role, entry);
  }

  /* -- independence, by Relay's one existing rule -- */
  const implementer = resolved.get('CODING_AGENT');
  const reviewer = resolved.get('INDEPENDENT_REVIEWER');
  if (implementer !== undefined && reviewer !== undefined) {
    const independent = reviewerIsIndependent({
      reviewerAgentId: reviewer.agentId,
      // No session exists before anything runs. The session-level check
      // belongs to review time and stays there.
      reviewerSessionId: null,
      reviewerAdapterId: reviewer.adapterId,
      reviewerIndependenceGroup: reviewer.independenceGroup,
      implementerAgentId: implementer.agentId,
      implementerSessionId: null,
      implementerAdapterId: implementer.adapterId,
      implementerIndependenceGroup: implementer.independenceGroup,
    });
    if (!independent) {
      problems.push(problem(
        'reviewer_not_independent',
        'slots',
        `"${reviewer.integrationId}" is not independent of the Coding Agent "${implementer.integrationId}". A review by the same agent, adapter or vendor group as the implementer is not an independent review.`,
        'INDEPENDENT_REVIEWER',
      ));
    }
  }

  return problems;
}

/* -------------------------------------------------------------- readiness */

const READINESS_NOTES: readonly string[] = Object.freeze([
  'Readiness means the configuration resolves against the registry right now. It is never proof that a credential is valid, that a provider will answer, or that anything has ever run.',
  'Relay lists the environment variable NAMES the chosen integrations declare. It cannot see whether those names are set in the runtime that will execute, so an empty list means "no requirements declared", never "every requirement satisfied".',
]);

/**
 * Derived readiness. Recomputed on every read, because the registry can
 * disable an integration after this record was written and nothing would have
 * touched the record.
 */
export function evaluateCompoundAgentReadiness(
  configuration: CompoundAgentConfiguration,
  directory: IntegrationDirectory,
): CompoundAgentReadiness {
  const blockingProblems = checkCompoundAgentSlots(configuration.slots, directory);
  if (configuration.activation !== 'ACTIVE') {
    blockingProblems.push(problem(
      'configuration_not_activated',
      'activation',
      `This Compound Agent is ${configuration.activation}. Only an ACTIVE configuration may start a run.`,
    ));
  }
  const requirements = new Set<string>();
  for (const slot of configuration.slots) {
    const entry = directory.lookup(slot.integrationId);
    if (entry === null) continue;
    for (const name of entry.configurationRequirements) requirements.add(name);
  }
  return {
    ready: blockingProblems.length === 0,
    activation: configuration.activation,
    blockingProblems,
    configurationRequirements: [...requirements].sort(),
    notes: READINESS_NOTES,
  };
}

/* ---------------------------------------------------------------- writes */

const authorityProblems = (
  authority: CompoundAgentAuthority,
  record: { tenantId: string; projectId: string; ownerParticipant: string },
): CompoundAgentProblem[] => {
  const problems: CompoundAgentProblem[] = [];
  if (record.tenantId !== authority.tenantId) {
    problems.push(problem('tenant_mismatch', 'tenantId', 'This Compound Agent belongs to another tenant.'));
  }
  if (record.projectId !== authority.projectId) {
    problems.push(problem('project_mismatch', 'projectId', 'This Compound Agent belongs to another project.'));
  }
  if (record.ownerParticipant !== authority.ownerParticipant) {
    problems.push(problem('owner_mismatch', 'ownerParticipant', 'This Compound Agent belongs to another participant.'));
  }
  return problems;
};

/**
 * Mint a configuration at revision 1.
 *
 * Tenant, project and owner come from the AUTHORITY and are never read from
 * the draft — a body cannot name a project it was not authorized for, because
 * this function never looks.
 */
export function createCompoundAgentConfiguration(input: {
  readonly draft: CompoundAgentDraft;
  readonly authority: CompoundAgentAuthority;
  readonly directory: IntegrationDirectory;
  readonly now: string;
}): CompoundAgentValidation {
  const problems = checkCompoundAgentSlots(input.draft.slots, input.directory);
  if (problems.length > 0) return { ok: false, problems };

  const configuration: CompoundAgentConfiguration = {
    compoundAgentId: input.draft.compoundAgentId,
    projectId: input.authority.projectId,
    tenantId: input.authority.tenantId,
    ownerParticipant: input.authority.ownerParticipant,
    displayName: input.draft.displayName,
    slots: input.draft.slots,
    card: input.draft.card,
    projectBrain: input.draft.projectBrain,
    missionDefaults: input.draft.missionDefaults,
    activation: input.draft.activation,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return {
    ok: true,
    configuration,
    readiness: evaluateCompoundAgentReadiness(configuration, input.directory),
  };
}

/**
 * Apply a revisioned update.
 *
 * `expectedRevision` is what the caller believed it was editing. A mismatch is
 * refused rather than merged: two tabs editing the same Compound Agent must
 * not silently overwrite each other's slots, and there is no correct automatic
 * resolution for "which worker did the owner actually pick".
 *
 * Identity is IMMUTABLE. `compoundAgentId`, `projectId`, `tenantId` and
 * `ownerParticipant` are carried from the stored record, never from the draft,
 * so an update can never move a Compound Agent into another project or hand it
 * to another owner.
 */
export function updateCompoundAgentConfiguration(input: {
  readonly current: CompoundAgentConfiguration;
  readonly draft: CompoundAgentDraft;
  readonly expectedRevision: number;
  readonly authority: CompoundAgentAuthority;
  readonly directory: IntegrationDirectory;
  readonly now: string;
}): CompoundAgentValidation {
  const problems = authorityProblems(input.authority, input.current);

  if (input.expectedRevision !== input.current.revision) {
    problems.push(problem(
      'stale_configuration_revision',
      'expectedRevision',
      `This Compound Agent has moved on since it was loaded (expected revision ${input.expectedRevision}, stored revision ${input.current.revision}). Reload it and re-apply the change rather than overwriting whatever landed in between.`,
    ));
  }
  if (input.draft.compoundAgentId !== input.current.compoundAgentId) {
    problems.push(problem(
      'invalid_identifier',
      'compoundAgentId',
      'A Compound Agent id is immutable. Create a new Compound Agent instead of renaming this one\'s id.',
    ));
  }
  problems.push(...checkCompoundAgentSlots(input.draft.slots, input.directory));
  if (problems.length > 0) return { ok: false, problems };

  const configuration: CompoundAgentConfiguration = {
    compoundAgentId: input.current.compoundAgentId,
    projectId: input.current.projectId,
    tenantId: input.current.tenantId,
    ownerParticipant: input.current.ownerParticipant,
    displayName: input.draft.displayName,
    slots: input.draft.slots,
    card: input.draft.card,
    projectBrain: input.draft.projectBrain,
    missionDefaults: input.draft.missionDefaults,
    activation: input.draft.activation,
    revision: input.current.revision + 1,
    createdAt: input.current.createdAt,
    updatedAt: input.now,
  };
  return {
    ok: true,
    configuration,
    readiness: evaluateCompoundAgentReadiness(configuration, input.directory),
  };
}

/**
 * Read a stored configuration as a given authority.
 *
 * Separate from {@link evaluateCompoundAgentReadiness} because authorization
 * and readiness answer different questions, and a caller that may not see this
 * record at all must be refused before it learns anything about the record's
 * readiness.
 */
export function authorizeCompoundAgentRead(
  configuration: CompoundAgentConfiguration,
  authority: CompoundAgentAuthority,
): { readonly ok: true } | { readonly ok: false; readonly problems: readonly CompoundAgentProblem[] } {
  const problems = authorityProblems(authority, configuration);
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}
