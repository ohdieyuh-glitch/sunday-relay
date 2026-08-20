import { RELAY_AGENT_ROLES } from '../agent-operating';
import {
  CARD_AUTONOMY_BOUNDS,
  CARD_DOG_COATS,
  CARD_SCHEMA_V1,
  CARD_STATES,
  CARD_VERIFICATION_POLICIES,
  SUPPORTED_CARD_SCHEMA_VERSIONS,
  type CardEvent,
  type CardEventType,
  type CardIdentity,
  type CardSchemaVersion,
  type RelayCard,
  type WonderlandEntryDecision,
} from './card-contracts';

/**
 * C.A.R.D. LIFECYCLE — create, validate, activate, restore, and the Wonderland
 * entry decision.
 *
 * PURE. Every function takes what it needs and returns a new value; time is an
 * injected ISO string. Nothing here reads storage — the store does that and
 * hands the result in, so every rule below is testable without a backing.
 */

/* --------------------------------------------------------- the standard */

/**
 * THE STANDARD CARD, and it is already a good agent.
 *
 * All three roles on, evidence required, fail-closed budgets, Project Brain
 * enabled, planning and repair reachable. Nothing is withheld so a later
 * upgrade can restore it. What a larger card buys is scale and specialisation
 * — more concurrent work, deeper review, bigger budgets — never the difference
 * between an agent that verifies itself and one that does not.
 *
 * `ask_before_write` is the default because a first-run agent that edits before
 * anyone has seen it is not bounded autonomy, it is a surprise. The participant
 * can widen it; the product will not widen it for them.
 */
export function standardCard(input: {
  readonly cardId: string;
  readonly ownerId: string;
  readonly displayName: string;
  readonly nowIso: string;
  readonly projectId?: string | null;
  readonly themeKey?: string;
  readonly dogCoat?: CardIdentity['dogCoat'];
}): RelayCard {
  return {
    schemaVersion: CARD_SCHEMA_V1,
    cardId: input.cardId,
    ownerId: input.ownerId,
    projectId: input.projectId ?? null,
    state: 'draft',
    identity: {
      displayName: input.displayName,
      themeKey: input.themeKey ?? 'obsidian',
      dogCoat: input.dogCoat ?? 'white',
    },
    roleStack: RELAY_AGENT_ROLES.map((role) => ({ role, modelId: null, enabled: true })),
    tools: [],
    autonomy: 'ask_before_write',
    budget: { perMissionCents: null, perDayCents: null, failClosed: true },
    verificationPolicy: 'evidence_required',
    projectBrain: { enabled: true, projectId: input.projectId ?? null, retainEvidence: true },
    workflows: [],
    provenance: 'created_by_participant',
    createdAtIso: input.nowIso,
    updatedAtIso: input.nowIso,
    activatedAtIso: null,
  };
}

/* -------------------------------------------------------------- validate */

export interface CardValidation {
  readonly valid: boolean;
  readonly problems: readonly string[];
}

const isIso = (v: unknown): boolean =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);

/**
 * Is this a card Relay will act on?
 *
 * Deliberately strict about the things that would let a broken record look
 * usable: an unsupported schema, a missing owner, an empty role stack, a
 * budget that is not fail-closed. Every one of those has a plausible
 * "well, it mostly works" reading, and every one of them is how a participant
 * ends up with an agent nobody can account for.
 */
export function validateCard(candidate: unknown): CardValidation {
  const problems: string[] = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, problems: ['not an object'] };
  }
  const c = candidate as Partial<RelayCard>;

  // A FUTURE CARD IS NOT A CORRUPT CARD, and the two send the participant to
  // different places: "update Relay" versus "this record is damaged". So the
  // distinguishable message is reserved for a version that is PRESENT and
  // simply newer than this build. An absent or non-string version is not a
  // newer schema — it is a record that never had one, which is corruption.
  if (typeof c.schemaVersion !== 'string' || c.schemaVersion.trim() === '') {
    problems.push('schemaVersion is missing');
  } else if (!SUPPORTED_CARD_SCHEMA_VERSIONS.includes(c.schemaVersion as CardSchemaVersion)) {
    problems.push(`unsupported schema version ${c.schemaVersion}`);
  }
  const need = (v: unknown, name: string) => {
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${name} is required`);
  };
  need(c.cardId, 'cardId');
  need(c.ownerId, 'ownerId');
  need(c.identity?.displayName, 'identity.displayName');
  need(c.identity?.themeKey, 'identity.themeKey');

  if (!CARD_DOG_COATS.includes(c.identity?.dogCoat as never)) {
    problems.push('identity.dogCoat is not a sanctioned Relay Dog coat');
  }
  if (!CARD_STATES.includes(c.state as never)) problems.push(`unknown state ${String(c.state)}`);
  if (!CARD_AUTONOMY_BOUNDS.includes(c.autonomy as never)) problems.push('autonomy is not a known bound');
  if (!CARD_VERIFICATION_POLICIES.includes(c.verificationPolicy as never)) {
    problems.push('verificationPolicy is not a known policy');
  }
  if (!Array.isArray(c.roleStack) || c.roleStack.length === 0) {
    problems.push('roleStack is empty — an agent with no roles is not an agent');
  } else if (!c.roleStack.some((s) => s.enabled)) {
    problems.push('every role is disabled — nothing would run');
  }
  if (c.budget === undefined || c.budget.failClosed !== true) {
    problems.push('budget must be fail-closed');
  }
  if (!isIso(c.createdAtIso)) problems.push('createdAtIso is not an ISO timestamp');
  if (!isIso(c.updatedAtIso)) problems.push('updatedAtIso is not an ISO timestamp');
  if (c.state === 'active' && !isIso(c.activatedAtIso)) {
    // The one that matters most: a card claiming to be active with no moment
    // at which it became active is a state nobody can audit.
    problems.push('an active card must carry activatedAtIso');
  }
  return { valid: problems.length === 0, problems };
}

/* ---------------------------------------------------------------- update */

export function updateCard(
  card: RelayCard,
  patch: Partial<Omit<RelayCard, 'cardId' | 'ownerId' | 'schemaVersion' | 'createdAtIso' | 'provenance'>>,
  nowIso: string,
): RelayCard {
  // cardId, ownerId, schemaVersion, createdAtIso and provenance are excluded at
  // the type level rather than filtered at run time — an update that could
  // change who owns a card is not an update.
  return { ...card, ...patch, updatedAtIso: nowIso };
}

/* -------------------------------------------------------------- activate */

export interface CardActivation {
  readonly ok: boolean;
  readonly card: RelayCard | null;
  readonly reason: string;
}

/**
 * Make a card the one Relay acts on.
 *
 * Refuses an invalid card, and refuses to activate one that is already active —
 * a duplicate activation would move activatedAtIso and quietly rewrite when the
 * participant's agent came into being.
 */
export function activateCard(card: RelayCard, nowIso: string): CardActivation {
  const v = validateCard(card);
  if (!v.valid) {
    return { ok: false, card: null, reason: `card is not valid: ${v.problems.join('; ')}` };
  }
  if (card.state === 'active') {
    return { ok: false, card, reason: 'card is already active' };
  }
  return {
    ok: true,
    card: { ...card, state: 'active', activatedAtIso: nowIso, updatedAtIso: nowIso },
    reason: '',
  };
}

/* --------------------------------------------------------------- restore */

export const CARD_RESTORE_OUTCOMES = [
  'restored',
  'no_card',
  'invalid',
  'unsupported_schema',
  'owner_mismatch',
  'not_active',
] as const;
export type CardRestoreOutcome = (typeof CARD_RESTORE_OUTCOMES)[number];

export interface CardRestoration {
  readonly outcome: CardRestoreOutcome;
  readonly card: RelayCard | null;
  readonly detail: string;
}

/**
 * Bring a returning participant's card back, or say precisely why not.
 *
 * NEVER FABRICATES A DEFAULT. The tempting behaviour — no card found, so hand
 * back a standard one and carry on — would tell a participant their agent was
 * restored while silently discarding whatever they had configured. Every
 * failure below returns a reason the caller must handle, and the only route to
 * a new card is the participant creating one.
 */
export function restoreCard(input: {
  readonly stored: unknown;
  readonly expectedOwnerId: string;
}): CardRestoration {
  if (input.stored === null || input.stored === undefined) {
    return { outcome: 'no_card', card: null, detail: 'no card is stored for this owner' };
  }
  const v = validateCard(input.stored);
  if (!v.valid) {
    const unsupported = v.problems.some((p) => p.startsWith('unsupported schema version'));
    return {
      outcome: unsupported ? 'unsupported_schema' : 'invalid',
      card: null,
      detail: v.problems.join('; '),
    };
  }
  const card = input.stored as RelayCard;
  if (card.ownerId !== input.expectedOwnerId) {
    // Fail closed and do NOT echo the stored owner back: the caller already
    // knows who they asked for, and naming the other party leaks whose card it is.
    return { outcome: 'owner_mismatch', card: null, detail: 'this card belongs to another owner' };
  }
  if (card.state !== 'active') {
    return {
      outcome: 'not_active',
      card,
      detail: `card is ${card.state}; a returning participant must activate it before entering`,
    };
  }
  return {
    outcome: 'restored',
    card: { ...card, provenance: 'restored_from_durable' },
    detail: '',
  };
}

/* --------------------------------------------------- wonderland entry */

/**
 * Relay's answer to "may I enter Wonderland".
 *
 * The grant carries only what the client needs to present the world — an
 * identity — and no authority. Wonderland cannot mint this, cannot infer it,
 * and must not proceed without it.
 */
export function decideWonderlandEntry(input: {
  readonly card: RelayCard | null;
  readonly requesterOwnerId: string;
  readonly nowIso: string;
}): WonderlandEntryDecision {
  const { card } = input;
  if (card === null) {
    return { authorized: false, refusal: 'no_card', detail: 'no card — create one first' };
  }
  const v = validateCard(card);
  if (!v.valid) {
    const unsupported = v.problems.some((p) => p.startsWith('unsupported schema version'));
    return {
      authorized: false,
      refusal: unsupported ? 'unsupported_schema' : 'card_invalid',
      detail: v.problems.join('; '),
    };
  }
  if (card.ownerId !== input.requesterOwnerId) {
    return { authorized: false, refusal: 'owner_mismatch', detail: 'this card belongs to another owner' };
  }
  if (card.state !== 'active') {
    return { authorized: false, refusal: 'card_not_active', detail: `card is ${card.state}` };
  }
  return {
    authorized: true,
    cardId: card.cardId,
    ownerId: card.ownerId,
    identity: card.identity,
    authorizedAtIso: input.nowIso,
  };
}

/* ---------------------------------------------------------------- events */

export function cardEvent(
  type: CardEventType,
  card: Pick<RelayCard, 'cardId' | 'ownerId'>,
  atIso: string,
  detail: Readonly<Record<string, string | number | boolean | null>> = {},
): CardEvent {
  return { type, cardId: card.cardId, ownerId: card.ownerId, atIso, detail };
}
