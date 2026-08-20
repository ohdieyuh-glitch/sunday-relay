import type { RelayAgentRole, RelayToolGrant } from '../agent-operating';

/**
 * THE C.A.R.D. — Compound AI agent Record, Durable.
 *
 * The first thing a new participant makes and the thing they come back to. It
 * is the configuration OF an agent, not the agent: Relay already owns the
 * Prompt Architect, the Coding Agent, the independent Reviewer, the Project
 * Brain, budgets, verification and repair. A card selects and bounds them.
 * Nothing here re-implements an engine.
 *
 * WHAT ALREADY EXISTED AND IS NOT DUPLICATED HERE:
 *
 *   agent-operating/   RelayAgentOperatingProfile — what an agent is CURRENTLY
 *                      operating with, as a projection. A card is the durable
 *                      user-owned intent; the profile is the observed truth.
 *                      Different directions, both needed.
 *   durable/           versioned records, checksums, atomic writes, recovery
 *                      classification. The card store is that backing, not a
 *                      second persistence layer.
 *   ui/app/configured-psp.ts
 *                      a sessionStorage pointer that carries a configuration
 *                      across the GitHub OAuth redirect. Deliberately NOT
 *                      durable — its own comment says a config outliving the
 *                      tab would be a stale request. It solves surviving a
 *                      redirect; this solves surviving a user.
 *
 * THE STANDARD CARD IS ALREADY EXCELLENT. It is not a crippled tier that
 * upgrades repair. Every capability Relay has is reachable from the default;
 * what a bigger card buys is scale and specialisation, never the difference
 * between a working agent and a broken one.
 *
 * PURE. No Node, no network, no clock — time arrives as an injected ISO string.
 */

/* ------------------------------------------------------------- versioning */

export const CARD_SCHEMA_V1 = 'relay-card.v1' as const;
export const SUPPORTED_CARD_SCHEMA_VERSIONS = [CARD_SCHEMA_V1] as const;
export type CardSchemaVersion = (typeof SUPPORTED_CARD_SCHEMA_VERSIONS)[number];

/* ---------------------------------------------------------------- policy */

/**
 * How hard the agent checks itself before claiming a thing is done.
 *
 * `evidence_required` is the DEFAULT, not the premium tier. An agent that
 * announces completion without evidence is the failure this product exists to
 * prevent, so the standard card refuses to.
 */
export const CARD_VERIFICATION_POLICIES = [
  'evidence_required',
  'evidence_required_plus_independent_review',
] as const;
export type CardVerificationPolicy = (typeof CARD_VERIFICATION_POLICIES)[number];

/** What the agent may do without asking. Bounded autonomy, stated as a value. */
export const CARD_AUTONOMY_BOUNDS = ['ask_before_write', 'write_then_report', 'plan_only'] as const;
export type CardAutonomyBound = (typeof CARD_AUTONOMY_BOUNDS)[number];

export interface CardBudget {
  /** Ceiling in whole cents. Null is UNKNOWN, never unlimited. */
  readonly perMissionCents: number | null;
  readonly perDayCents: number | null;
  /** Refuse rather than exceed. There is no "soft" budget. */
  readonly failClosed: true;
}

export interface CardRoleSlot {
  readonly role: RelayAgentRole;
  /** Model or runtime the participant chose. Null = Relay decides at run time. */
  readonly modelId: string | null;
  readonly enabled: boolean;
}

export interface CardProjectBrainConfig {
  readonly enabled: boolean;
  /** Durable project memory is per-project; a card without one is still valid. */
  readonly projectId: string | null;
  readonly retainEvidence: boolean;
}

export interface CardIdentity {
  readonly displayName: string;
  /** Palette key from the existing Relay design system; never a raw colour. */
  readonly themeKey: string;
  /**
   * CANONICAL RELAY DOG ONLY. White blocky body, black visor, gold eyes. The
   * card may vary the coat within the sanctioned set; it may not invent a
   * different creature, and there is deliberately no field in which to try.
   */
  readonly dogCoat: CardDogCoat;
}

export const CARD_DOG_COATS = ['white', 'pink', 'gray', 'tan', 'brown'] as const;
export type CardDogCoat = (typeof CARD_DOG_COATS)[number];

/* ----------------------------------------------------------- the record */

export const CARD_STATES = ['draft', 'active', 'inactive'] as const;
export type CardState = (typeof CARD_STATES)[number];

export interface RelayCard {
  readonly schemaVersion: CardSchemaVersion;
  readonly cardId: string;
  /** Who owns it. Cards never cross owners; see cardBelongsTo. */
  readonly ownerId: string;
  /** Optional project scope. Null means the card is not yet bound to one. */
  readonly projectId: string | null;

  readonly state: CardState;
  readonly identity: CardIdentity;
  readonly roleStack: readonly CardRoleSlot[];
  readonly tools: readonly RelayToolGrant[];
  readonly autonomy: CardAutonomyBound;
  readonly budget: CardBudget;
  readonly verificationPolicy: CardVerificationPolicy;
  readonly projectBrain: CardProjectBrainConfig;
  /** Named workflows/loops this card may run. Empty is valid. */
  readonly workflows: readonly string[];

  /** Where this card came from, carried for the life of the record. */
  readonly provenance: 'created_by_participant' | 'restored_from_durable';
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /** Set only when the card actually became active. Null otherwise. */
  readonly activatedAtIso: string | null;
}

/* ---------------------------------------------------------------- events */

/**
 * Durable events. Each is emitted only AFTER the fact it names has happened —
 * CardActivated after the activation is durable, never after deciding to try.
 */
export const CARD_EVENT_TYPES = [
  'CardCreated',
  'CardUpdated',
  'CardValidated',
  'CardActivated',
  'CardRestored',
  'WonderlandEntryRequested',
  'WonderlandEntryAuthorized',
] as const;
export type CardEventType = (typeof CARD_EVENT_TYPES)[number];

export interface CardEvent {
  readonly type: CardEventType;
  readonly cardId: string;
  readonly ownerId: string;
  readonly atIso: string;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

/* ----------------------------------------------------- entry to Wonderland */

/**
 * WONDERLAND IS NOT AUTHORITATIVE. It asks; Relay answers.
 *
 * An entry decision is a grant Relay issues from the card it already holds.
 * Wonderland cannot mint one, cannot infer one from local state, and cannot
 * proceed on its absence — which is why refusal carries a reason the client
 * shows rather than a silent false.
 */
export const WONDERLAND_ENTRY_REFUSALS = [
  'no_card',
  'card_not_active',
  'card_invalid',
  'owner_mismatch',
  'unsupported_schema',
] as const;
export type WonderlandEntryRefusal = (typeof WONDERLAND_ENTRY_REFUSALS)[number];

export interface WonderlandEntryGrant {
  readonly authorized: true;
  readonly cardId: string;
  readonly ownerId: string;
  readonly identity: CardIdentity;
  readonly authorizedAtIso: string;
}

export interface WonderlandEntryDenied {
  readonly authorized: false;
  readonly refusal: WonderlandEntryRefusal;
  readonly detail: string;
}

export type WonderlandEntryDecision = WonderlandEntryGrant | WonderlandEntryDenied;
