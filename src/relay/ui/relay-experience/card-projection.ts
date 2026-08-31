import {
  RELAY_COMPLETION_RULES, RELAY_EXECUTION_MODES, RELAY_REVIEW_REQUIREMENTS,
  validateMissionConfig, type RelayMissionConfig,
} from '../../mission/mission-config';
import { REPOSITORY_PERMISSIONS, type RepositoryPermission } from '../../mission/repository-target';
import {
  CARD_IDENTITY_FIELDS, CARD_VALUE_FIELDS, isPersistedCard, normaliseName,
  type CardValueField, type CompoundAgentDraft,
} from './onboarding';

/**
 * THE C.A.R.D. → MISSION REQUEST PROJECTION, and its inverse.
 *
 * The bridge validates one shape at `/relay-api/mission/start`: the domain's
 * `RelayMissionConfig` (`validateMissionConfig`). The live journey's edit
 * surface (`RelayAgentConfigEditor`) edits that same loose shape. Neither is a
 * store: both are PROJECTIONS of the authoritative C.A.R.D. — `projectMissionConfig`
 * derives the request from the record, `applyMissionConfigToCard` writes an
 * edit of that shape BACK INTO the record. Nothing else may carry configuration
 * between the two.
 *
 * WHAT THE LEGACY SHAPE CANNOT REPRESENT IS NAMED, NOT DROPPED. The mission
 * request has no field for the network policy, the Project Brain policy or the
 * reviewer policy, and no field for the Agent's name; those stay authoritative
 * in the C.A.R.D. and are listed in `CARD_FIELDS_NOT_IN_MISSION_CONFIG` so a
 * reader — and the test that enumerates every C.A.R.D. field — sees exactly
 * which values the request does not carry.
 */

/** C.A.R.D. values with NO counterpart in `RelayMissionConfig`. Authoritative in the record only. */
export const CARD_FIELDS_NOT_IN_MISSION_CONFIG = Object.freeze([
  'name', 'network', 'brainUpdate', 'reviewerPolicy', 'activatedAt',
] as const satisfies readonly CardValueField[]);

/** C.A.R.D. values the projection carries, and the request field each lands in. */
export const CARD_FIELDS_IN_MISSION_CONFIG = Object.freeze({
  promptArchitectId: 'roles.architect',
  codingAgentId: 'roles.coding',
  reviewerId: 'roles.reviewer',
  mode: 'mode',
  review: 'review',
  completionRule: 'completionRule',
  permissions: 'permissions',
  spendUsd: 'limits.spendUsd',
  runtimeMinutes: 'limits.runtimeMinutes',
  agentCalls: 'limits.agentCalls',
  reviewCycles: 'limits.reviewCycles',
  repairCycles: 'limits.repairCycles',
} as const satisfies Partial<Record<CardValueField, string>>);

/**
 * The C.A.R.D. identity a Mission records. It travels in the request's `pspId`
 * slot — the legacy field whose documented meaning is "which saved profile
 * drove this Mission" — in a form the bridge's `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`
 * accepts, so a Mission can always say which C.A.R.D. revision it ran under.
 */
export function cardRef(card: CompoundAgentDraft): string | null {
  if (!isPersistedCard(card)) return null;
  return `${card.cardId}-r${card.revision}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
}

/** Read a request `pspId` stamped by {@link cardRef}. Null for anything else — a saved profile's own id, or nothing. */
export function parseCardRef(pspId: unknown): { readonly cardId: string; readonly revision: number } | null {
  if (typeof pspId !== 'string') return null;
  const match = /^(card-[A-Za-z0-9_-]+?)-r(\d+)$/.exec(pspId);
  return match ? { cardId: match[1], revision: Number(match[2]) } : null;
}

const words = (v: string): string => v.replace(/_/g, ' ');

/**
 * The C.A.R.D. values a Mission request does NOT carry, spelled out for the
 * participant beside the request it does carry — so a NETWORK: BLOCKED chosen
 * in the world is never presented as part of a request that never asks for it.
 */
export function cardNotCarriedNote(card: CompoundAgentDraft): string {
  return 'Not carried by the Mission request — set in your C.A.R.D. only: '
    + `network ${words(card.network)} · Project Brain ${words(card.brainUpdate)} · reviewer policy ${words(card.reviewerPolicy)}.`;
}

/** The request a Mission carries, derived from the C.A.R.D. Validated by the same gate the bridge applies. */
export function projectMissionConfig(card: CompoundAgentDraft): RelayMissionConfig {
  const loose = {
    pspId: cardRef(card),
    roles: { architect: card.promptArchitectId, coding: card.codingAgentId, reviewer: card.reviewerId },
    mode: card.mode,
    review: card.review,
    completionRule: card.completionRule,
    permissions: [...card.permissions],
    limits: {
      spendUsd: card.spendUsd,
      runtimeMinutes: card.runtimeMinutes,
      agentCalls: card.agentCalls,
      reviewCycles: card.reviewCycles,
      repairCycles: card.repairCycles,
    },
  };
  const validated = validateMissionConfig(loose);
  if (validated.ok) return validated.value;
  // A parsed C.A.R.D. cannot carry a malformed ceiling (the parser refuses them),
  // so this is unreachable; if it ever were reached, failing loudly beats
  // dispatching a request the bridge would refuse for a reason nobody can see.
  throw new Error(`The C.A.R.D. could not be projected into a Mission request: ${validated.error.message}`);
}

/**
 * The truthful display name of a projected C.A.R.D. for the surfaces that say
 * what a Mission is "running under". Names the Agent and the revision — never
 * "Default beta configuration" over a record the participant configured.
 */
export function missionConfigLabel(card: CompoundAgentDraft): string {
  const name = normaliseName(card.name) || 'UNNAMED';
  return `C.A.R.D. ${name} · revision ${card.revision}`;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : fallback);
const selector = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** A ceiling edited in the request shape: absent = leave the C.A.R.D.'s value; null = explicitly unset. */
const ceilingEdit = (v: unknown, current: number | null): number | null => {
  if (v === undefined) return current;
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : current;
};

/**
 * WRITE AN EDIT OF THE REQUEST SHAPE BACK INTO THE C.A.R.D. Every field the
 * request names is applied; every field it is silent on keeps the C.A.R.D.'s
 * value — an editor that never shows the network policy cannot erase it. The
 * identity envelope is never touched by an edit: identity is the store's.
 */
export function applyMissionConfigToCard(card: CompoundAgentDraft, config: unknown): CompoundAgentDraft {
  const root = asRecord(config);
  const roles = asRecord(root.roles);
  const limits = asRecord(root.limits);
  const permissions: readonly RepositoryPermission[] = Array.isArray(root.permissions)
    ? REPOSITORY_PERMISSIONS.filter((p) => (root.permissions as unknown[]).includes(p))
    : card.permissions;
  return {
    ...card,
    promptArchitectId: 'architect' in roles ? selector(roles.architect) : card.promptArchitectId,
    codingAgentId: 'coding' in roles ? selector(roles.coding) : card.codingAgentId,
    reviewerId: 'reviewer' in roles ? selector(roles.reviewer) : card.reviewerId,
    mode: oneOf(root.mode, RELAY_EXECUTION_MODES, card.mode),
    review: oneOf(root.review, RELAY_REVIEW_REQUIREMENTS, card.review),
    completionRule: oneOf(root.completionRule, RELAY_COMPLETION_RULES, card.completionRule),
    permissions,
    spendUsd: ceilingEdit(limits.spendUsd, card.spendUsd),
    runtimeMinutes: ceilingEdit(limits.runtimeMinutes, card.runtimeMinutes),
    agentCalls: ceilingEdit(limits.agentCalls, card.agentCalls),
    reviewCycles: ceilingEdit(limits.reviewCycles, card.reviewCycles),
    repairCycles: ceilingEdit(limits.repairCycles, card.repairCycles),
  };
}

/**
 * Every C.A.R.D. value is either carried by the projection or named as not
 * carried. This is what keeps a future field from being dropped in silence: the
 * test that calls it fails the moment a value field appears in neither list.
 */
export function unaccountedCardFields(): readonly string[] {
  const carried = new Set<string>(Object.keys(CARD_FIELDS_IN_MISSION_CONFIG));
  const named = new Set<string>(CARD_FIELDS_NOT_IN_MISSION_CONFIG);
  const identity = new Set<string>(CARD_IDENTITY_FIELDS);
  return CARD_VALUE_FIELDS.filter((f) => !carried.has(f) && !named.has(f) && !identity.has(f));
}
