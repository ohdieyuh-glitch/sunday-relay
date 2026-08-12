/**
 * THE MISSION EXECUTION CONFIG — the run-relevant projection of a PSP / Project
 * Settings, carried from the product boundary into a Mission.
 *
 * This is NOT a second settings model and NOT a second Mission engine. The rich
 * editing surface stays where it is (`src/relay/ui/project-settings`); a PSP is a
 * saved bundle of exactly these choices. What crosses the API boundary into
 * `registry.start` is this narrow, validated, layer-neutral contract: the subset
 * the engine actually acts on — who fills each role, the execution mode, the
 * verification/review policy, the repository permissions requested, and the
 * Mission's spend/compute limits.
 *
 * WHY A VALIDATOR, NOT A CAST. Every field here is an authorization or a spend
 * decision, so a malformed one must be REFUSED, never coerced into something
 * more permissive. An unknown permission is dropped (a config can only ever ask
 * for known authority), a negative or non-finite limit is refused (a limit that
 * is not a real number is not a limit), and an unrecognised enum falls back to
 * its most conservative member — never to "no policy".
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { isRepositoryPermission, type RepositoryPermission } from './repository-target';

export const RELAY_EXECUTION_MODES = ['guided', 'semi', 'autonomous'] as const;
export type RelayExecutionMode = (typeof RELAY_EXECUTION_MODES)[number];

export const RELAY_REVIEW_REQUIREMENTS = ['none', 'independent', 'security', 'manual_founder'] as const;
export type RelayReviewRequirement = (typeof RELAY_REVIEW_REQUIREMENTS)[number];

export const RELAY_COMPLETION_RULES = ['strict', 'balanced', 'custom'] as const;
export type RelayCompletionRule = (typeof RELAY_COMPLETION_RULES)[number];

/**
 * A Mission's spend/compute ceilings. `null` means "not set by this config" and
 * is DISCLOSED as such — it never silently means unlimited; the runtime's own
 * structural bounds still apply, and the enforcement layer decides what an unset
 * ceiling permits.
 */
export interface RelayMissionLimits {
  readonly runtimeMinutes: number | null;
  readonly agentCalls: number | null;
  readonly spendUsd: number | null;
  readonly reviewCycles: number | null;
  readonly repairCycles: number | null;
}

/** Who fills each role. Occupant SELECTOR strings (e.g. an occupant id); null
 *  means "use the deployment's configured default for that role". The registry
 *  resolves these against the real occupants — an unknown selector is refused
 *  THERE, where the occupant set lives, not invented here. */
export interface RelayRoleSelection {
  readonly architect: string | null;
  readonly coding: string | null;
  readonly reviewer: string | null;
}

export interface RelayMissionConfig {
  /** The PSP this configuration was loaded from, if any — recorded so a Mission
   *  can say which saved profile drove it. */
  readonly pspId: string | null;
  readonly roles: RelayRoleSelection;
  readonly mode: RelayExecutionMode;
  readonly review: RelayReviewRequirement;
  readonly completionRule: RelayCompletionRule;
  /** Permissions this config REQUESTS. Never widened downstream: the repository
   *  resolver narrows these against the registration's grants, so this can only
   *  ever ask for authority a human already granted. */
  readonly permissions: readonly RepositoryPermission[];
  readonly limits: RelayMissionLimits;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === 'object' ? value as Record<string, unknown> : {});

/** A field that must be a non-negative finite number when present. Returns the
    number, `null` when absent/`null`, or an error string when malformed. */
function optionalNonNegative(value: unknown, field: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ok: false, message: `${field} must be a non-negative number when set.` };
  }
  return { ok: true, value };
}

function selector(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/**
 * Validate a loose config object (the request body, or a stored PSP) into a
 * clean {@link RelayMissionConfig}. Refuses only what cannot be a real config:
 * a malformed limit. Everything else is normalized conservatively.
 */
export function validateMissionConfig(raw: unknown): RelayResult<RelayMissionConfig> {
  const root = asRecord(raw);
  const rolesRaw = asRecord(root.roles);
  const limitsRaw = asRecord(root.limits);

  // Permissions: keep only the known ones. A config asking for an unknown
  // permission does not fail — it simply cannot request authority that does not
  // exist, and the resolver will narrow the rest against real grants.
  const permsIn = Array.isArray(root.permissions) ? root.permissions : [];
  const permissions: RepositoryPermission[] = [];
  for (const p of permsIn) {
    if (typeof p === 'string' && isRepositoryPermission(p) && !permissions.includes(p)) {
      permissions.push(p);
    }
  }

  const limitFields: Array<keyof RelayMissionLimits> = ['runtimeMinutes', 'agentCalls', 'spendUsd', 'reviewCycles', 'repairCycles'];
  const limits: Record<string, number | null> = {};
  for (const field of limitFields) {
    const parsed = optionalNonNegative(limitsRaw[field], field);
    if (!parsed.ok) {
      return fail(relayError('validation-failed', parsed.message, { details: [`limits.${field}`] }));
    }
    limits[field] = parsed.value;
  }

  return ok({
    pspId: selector(root.pspId),
    roles: {
      architect: selector(rolesRaw.architect),
      coding: selector(rolesRaw.coding),
      reviewer: selector(rolesRaw.reviewer),
    },
    mode: oneOf(root.mode, RELAY_EXECUTION_MODES, 'guided'),
    review: oneOf(root.review, RELAY_REVIEW_REQUIREMENTS, 'independent'),
    completionRule: oneOf(root.completionRule, RELAY_COMPLETION_RULES, 'strict'),
    permissions,
    limits: {
      runtimeMinutes: limits.runtimeMinutes,
      agentCalls: limits.agentCalls,
      spendUsd: limits.spendUsd,
      reviewCycles: limits.reviewCycles,
      repairCycles: limits.repairCycles,
    },
  });
}

/** The conservative default config for a Mission that names none — guided mode,
    independent review, strict completion, no extra permissions, no limits set. */
export function defaultMissionConfig(): RelayMissionConfig {
  return {
    pspId: null,
    roles: { architect: null, coding: null, reviewer: null },
    mode: 'guided',
    review: 'independent',
    completionRule: 'strict',
    permissions: [],
    limits: { runtimeMinutes: null, agentCalls: null, spendUsd: null, reviewCycles: null, repairCycles: null },
  };
}
