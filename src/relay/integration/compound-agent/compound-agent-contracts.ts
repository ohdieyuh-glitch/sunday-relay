/**
 * THE RELAY ↔ JULIUS BOUNDARY — COMPOUND AGENT CONFIGURATION CONTRACTS.
 *
 * WHAT THIS LAYER IS. Relay owns what a user may CONFIGURE and REQUEST. Julius
 * owns how that request EXECUTES. A Compound Agent Configuration is the first
 * half: the durable, owner-scoped record naming which integration stands in
 * each of Julius's three worker slots, which C.A.R.D. and Project Brain
 * revisions the run is pinned to, and what the mission defaults are. It is
 * CONFIGURATION, in the same sense a saved PSP is configuration — never a
 * second Julius runtime state, never a second scheduler, never a place a run's
 * progress is recorded.
 *
 * WHY IT IS NOT JUST A PSP. `RelayMissionConfig` already carries role
 * SELECTORS (`roles.architect`, `roles.coding`, `roles.reviewer`) as bare
 * strings resolved late, against a deployment's environment. That is right for
 * a deployment-scoped mission start and wrong for a user-scoped Compound
 * Agent: a Compound Agent is an identity a person owns inside a project, its
 * slots must be resolvable and coherent BEFORE any run is requested, and the
 * three roles must each be filled exactly once. `src/relay/integration/legacy`
 * converts between the two rather than either replacing the other.
 *
 * PROVIDER-NEUTRAL BY CONSTRUCTION. A slot never names a vendor. It names a
 * ROLE, an INTEGRATION ID that the server-authoritative registry must resolve,
 * and the CAPABILITIES the configuration requires of whatever answers. Writing
 * `promptArchitect: 'gpt'` would put the vendor in the durable record, and the
 * day the registry moved that integration to a different provider the record
 * would be a lie that nothing could detect. The provider is a fact the
 * registry reports at read time, and it is never copied in here.
 *
 * PURE DOMAIN. No Node, no network, no clock — timestamps arrive as ISO
 * strings from the caller, exactly like every other `src/relay/mission/*`
 * module. The browser, the bridge and the CLI can all read this unchanged.
 */

import { JULIUS_DEFAULT_ROLES, type JuliusDefaultRole } from '../../mission/julius/julius-runtime';

/* ------------------------------------------------------------- worker slots */

/**
 * THE THREE WORKER SLOTS, DERIVED AND NOT RE-TYPED.
 *
 * `JULIUS_DEFAULT_ROLES` on merged main is the canonical list. Re-declaring it
 * here would create a second source of truth that drifts silently the first
 * time Julius's list changes — the failure `operating-profile-types.ts`
 * documents at length and avoids by deriving `RelayAgentRole` with `Extract`.
 * This module derives for the same reason. If Julius ever adds a fourth
 * DEFAULT role, `COMPOUND_AGENT_SLOTS` grows with it and the exactly-once
 * invariant below keeps applying — without an edit here.
 *
 * A `SPECIALIST:*` role is deliberately NOT a slot. Specialists are spawned by
 * Julius at run time under its own policy; a Compound Agent configures the
 * three permanent slots and nothing else.
 */
export const COMPOUND_AGENT_SLOTS: readonly JuliusDefaultRole[] = JULIUS_DEFAULT_ROLES;
export type CompoundAgentSlot = JuliusDefaultRole;

/* ------------------------------------------------------ the Julius reservation */

/**
 * JULIUS IS THE HARNESS. IT CAN NEVER BE A WORKER.
 *
 * The hierarchy is models/agents → Julius → Relay → the user. Julius ORGANIZES
 * the intelligence in the three slots; it is not a fourth thing that can be
 * selected into one of them. GPT is not Julius, Claude is not Julius, Hermes is
 * not Julius — each of those may occupy a slot, and Julius may not.
 *
 * TWO GUARDS, BECAUSE THEY FAIL DIFFERENTLY. The structural guard is that only
 * a registry entry can fill a slot and the registry contains no Julius entry
 * (`integration-registry` asserts that over the derived set, so it stays true
 * as the registry grows). That guard produces `unknown_integration`, which
 * reads as "you misspelled something" — the wrong sentence for this mistake,
 * and one that would silently start working the day somebody added a Julius
 * entry "for completeness". So the lexical guard runs FIRST and answers with
 * its own reason: this name is reserved, and the remedy is not a correction to
 * the spelling but an understanding of the architecture.
 *
 * THE KNOWN LIMIT, STATED RATHER THAN HIDDEN. The lexical rule is a substring
 * match on a normalized id, so a genuine future vendor whose name contains
 * "julius" would be refused and would need a product decision — an explicit
 * registry alias — rather than a quiet exception. Refusing a real integration
 * is a visible, recoverable mistake; admitting Julius into a worker slot
 * inverts the architecture and is neither.
 */
export const JULIUS_RESERVED_TOKEN = 'julius';

/**
 * Normalize an identifier for reservation checking: case-folded, with every
 * separator and non-alphanumeric character removed. `Julius`, `JULIUS_CORE`,
 * `relay-julius`, `j u l i u s` and `julius.runtime.v1` all normalize to a
 * string containing `julius`; nothing that does not mean Julius does.
 */
export function normalizeIntegrationIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether an identity string names Julius and is therefore reserved. */
export function identityIsReservedForJulius(value: string): boolean {
  return normalizeIntegrationIdentity(value).includes(JULIUS_RESERVED_TOKEN);
}

/* -------------------------------------------------------- slot selections */

/**
 * ONE SLOT'S SELECTION.
 *
 * `integrationId` is resolved against the server-authoritative registry, which
 * is the only authority on whether it exists, what role it serves, and whether
 * it is enabled. `requiredCapabilities` is what the CONFIGURATION demands of
 * whatever answers — a requirement, not a description. The registry reports
 * what an integration offers; validation intersects the two. Nothing here
 * records a provider, a model name, a credential, or a URL.
 */
export interface CompoundAgentSlotSelection {
  readonly role: CompoundAgentSlot;
  readonly integrationId: string;
  /** Capabilities the configuration REQUIRES. Empty means "no extra demand". */
  readonly requiredCapabilities: readonly string[];
}

/* ------------------------------------------------------- pinned revisions */

/**
 * A PINNED REFERENCE — a C.A.R.D. or a Project Brain, at a revision.
 *
 * The revision is what makes a bootstrap request reproducible and what makes a
 * stale one detectable. It is carried as an OPAQUE STRING because Relay does
 * not own either revisioning scheme: a C.A.R.D. policy revision is minted by
 * whatever owns C.A.R.D. policy, and comparing them for ordering here would be
 * inventing a rule about somebody else's identifiers. Relay compares them for
 * EQUALITY only — pinned vs current — which is the whole question it needs to
 * answer, and the only one it can answer honestly.
 */
export interface PinnedRevisionReference {
  readonly referenceId: string;
  readonly revision: string;
}

/* -------------------------------------------------------- mission defaults */

/**
 * WHAT A RUN STARTED FROM THIS COMPOUND AGENT DEFAULTS TO.
 *
 * Deliberately narrow, and deliberately built out of vocabulary that already
 * exists in the product (`RELAY_EXECUTION_MODES`, `RELAY_REVIEW_REQUIREMENTS`,
 * `RELAY_COMPLETION_RULES`, `RelayMissionLimits`) rather than a new parallel
 * set. `src/relay/integration/legacy` holds the conversion in one place so
 * these two vocabularies cannot drift apart in five call sites.
 *
 * A `null` limit means NOT SET BY THIS CONFIGURATION and is disclosed as such.
 * It never silently means unlimited: the enforcement layer — Julius — decides
 * what an unset ceiling permits, and Relay does not pre-empt that decision by
 * inventing a number.
 */
export interface CompoundAgentMissionDefaults {
  readonly executionMode: 'guided' | 'semi' | 'autonomous';
  readonly reviewRequirement: 'none' | 'independent' | 'security' | 'manual_founder';
  readonly completionRule: 'strict' | 'balanced' | 'custom';
  readonly limits: {
    readonly runtimeMinutes: number | null;
    readonly agentCalls: number | null;
    readonly spendUsd: number | null;
    readonly reviewCycles: number | null;
    readonly repairCycles: number | null;
  };
}

/* ------------------------------------------------------------ activation */

/**
 * THE OWNER'S INTENT FOR THIS CONFIGURATION — a stored fact, and only that.
 *
 * `ACTIVE` says the owner has finished configuring and wants runs to be
 * startable. It does NOT say the configuration currently resolves, because
 * that depends on a registry whose entries can be disabled after the fact.
 * READINESS is therefore never stored: it is derived at validation time from
 * the live registry, every time. Storing it would be a snapshot of somebody
 * else's state that goes stale without anything writing to this record — the
 * exact shape of "announce facts, not intentions" this repository refuses.
 */
export const COMPOUND_AGENT_ACTIVATIONS = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type CompoundAgentActivation = (typeof COMPOUND_AGENT_ACTIVATIONS)[number];

/* --------------------------------------------------- the configuration itself */

/**
 * THE AUTHORITATIVE RELAY-SIDE COMPOUND AGENT CONFIGURATION.
 *
 * Owner and tenant identity are stored, not derived, because every read of
 * this record is an authorization decision. `projectId` scopes it: a Compound
 * Agent belongs to exactly one project and a bootstrap request naming a
 * different one is refused rather than reconciled.
 */
export interface CompoundAgentConfiguration {
  readonly compoundAgentId: string;
  readonly projectId: string;
  readonly tenantId: string;
  /** The participant who owns this Compound Agent (e.g. `ghu-<github-id>`). */
  readonly ownerParticipant: string;
  /** A human label. Free text, never used for identity or comparison. */
  readonly displayName: string;
  readonly slots: readonly CompoundAgentSlotSelection[];
  /** The C.A.R.D. this Compound Agent runs under, pinned at a revision. */
  readonly card: PinnedRevisionReference;
  /** The Project Brain this Compound Agent reads, pinned at a revision. */
  readonly projectBrain: PinnedRevisionReference;
  readonly missionDefaults: CompoundAgentMissionDefaults;
  readonly activation: CompoundAgentActivation;
  /**
   * Monotonic, Relay-owned. Every accepted write increments it by one, and a
   * write that does not name the current revision is refused — which is what
   * stops two browser tabs from silently overwriting each other's slots.
   */
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------- refusals */

/**
 * WHY A CONFIGURATION WAS REFUSED.
 *
 * Each member names something a caller CHANGES, and the members stay separate
 * because the remedies differ. `role_slot_missing` means add a selection;
 * `role_slot_duplicated` means remove one; `integration_role_mismatch` means
 * you picked a real integration for the wrong slot; `integration_disabled`
 * means the integration is real and right and currently switched off, which is
 * an operator action rather than a configuration edit. Collapsing any pair of
 * these into one code would send a user to the wrong remedy — the defect
 * `ROLE_BINDING_REFUSALS` was split up to prevent.
 */
export const COMPOUND_AGENT_REFUSALS = [
  'invalid_identifier',
  'invalid_display_name',
  'role_slot_missing',
  'role_slot_duplicated',
  'unknown_slot_role',
  /** The name is Julius's. Julius organizes workers; it is never one. */
  'julius_cannot_occupy_worker_slot',
  'unknown_integration',
  'integration_role_mismatch',
  'integration_disabled',
  'capability_unsupported',
  /**
   * The Reviewer is not independent of the Coding Agent.
   *
   * Computed by `reviewerIsIndependent` — Relay's ONE independence rule, in
   * `mission/entitlement.ts` — and not by a second rule written beside it. A
   * review by the same agent, adapter or vendor group as the implementer is
   * the review that looks independent and is not.
   */
  'reviewer_not_independent',
  'invalid_revision_reference',
  'invalid_mission_defaults',
  'invalid_limit',
  'stale_configuration_revision',
  'tenant_mismatch',
  'project_mismatch',
  'owner_mismatch',
  'configuration_not_activated',
] as const;
export type CompoundAgentRefusal = (typeof COMPOUND_AGENT_REFUSALS)[number];

/**
 * One refusal. `safeMessage` is safe to render to an operator: it names roles,
 * integration ids, capability names and field paths, and never a credential, a
 * value read from the environment, or a provider response.
 */
export interface CompoundAgentProblem {
  readonly reason: CompoundAgentRefusal;
  /** The slot this problem belongs to, when it belongs to one. */
  readonly role: CompoundAgentSlot | null;
  /** Dotted path into the submitted object, for a form to highlight. */
  readonly field: string;
  readonly safeMessage: string;
}

/* ------------------------------------------------------------- readiness */

/**
 * DERIVED, NEVER STORED. Whether this configuration could start a run RIGHT
 * NOW, computed against the registry that was passed in.
 *
 * `blockingProblems` is empty when nothing structural stands in the way.
 * `configurationRequirements` lists the environment variable NAMES the chosen
 * integrations declare they need — names only, never values, so a readiness
 * report is safe to render in a browser. Relay cannot see whether those names
 * are set in Julius's deployment, and it says so rather than guessing: an
 * empty list means "these integrations declare no requirements", not "every
 * requirement is satisfied".
 */
export interface CompoundAgentReadiness {
  readonly ready: boolean;
  readonly activation: CompoundAgentActivation;
  readonly blockingProblems: readonly CompoundAgentProblem[];
  readonly configurationRequirements: readonly string[];
  /** What readiness does NOT prove, written down so a surface cannot overclaim. */
  readonly notes: readonly string[];
}

export type CompoundAgentValidation =
  | {
    readonly ok: true;
    readonly configuration: CompoundAgentConfiguration;
    readonly readiness: CompoundAgentReadiness;
  }
  | { readonly ok: false; readonly problems: readonly CompoundAgentProblem[] };
