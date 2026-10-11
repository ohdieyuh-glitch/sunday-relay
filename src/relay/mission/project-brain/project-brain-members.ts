/**
 * WHO MAY USE A PROJECT'S BRAIN, AND WHO DECIDES THAT.
 *
 * Until this, the only role the product wrote was OWNER (relay-bridge/julius/mission-seed.ts): a project had exactly one
 * person in it, nobody else could pair a desktop client, and a multiplayer Project Brain could not exist. The founder
 * decided the roles on 2026-09-27 (decisions 4 and 5): an ADMIN holds what an OWNER holds; a MEMBER reads the world
 * and the mission results, never the cost, and never creates a mission. Here they become writable, by one audited
 * change through the Project Brain's own mutation log (one idempotency namespace, one advisory lock, one event stream).
 *
 *   - Only a holder of `brain:members` (OWNER, ADMIN) changes membership, and never their OWN row.
 *   - OWNER is permanent: written only by the mission seed, never granted, changed or removed here.
 *   - ADMIN is granted, changed or removed only by an OWNER. An ADMIN manages MEMBERs.
 *   - A change names the role the caller SAW (`expectedRole`; null = not a member). Two people changing one membership at
 *     once: one wins, the other is refused `member_conflict` and reads again. Nothing is applied blind.
 *   - A companion manages nothing.
 *
 * In the Brain, a MEMBER contributes (FOUNDER DECISION 2026-10-04): it reads, proposes, and writes and edits its own
 * statements; it never adopts or approves, changes governance (no GOVERNANCE_ACK), manages membership, resolves or
 * supersedes another person's statement, or bypasses a revision check. OWNER and ADMIN keep canonical authority.
 *
 * Pure: no clock, no I/O. The store applies these rules inside the one transaction that writes.
 */

import {
  projectBrainRefusal,
  type ProjectBrainCapability,
  type ProjectBrainProvenance,
  type ProjectBrainRefusal,
} from './project-brain';

export const PROJECT_BRAIN_MEMBER_OPERATIONS = ['MEMBER_SET', 'MEMBER_REMOVE'] as const;
export type ProjectBrainMemberOperation = (typeof PROJECT_BRAIN_MEMBER_OPERATIONS)[number];

/** The roles a membership change may grant (founder decisions 4 and 5). OWNER is never granted. */
export const PROJECT_BRAIN_GRANTABLE_ROLES = ['ADMIN', 'MEMBER'] as const;
export type ProjectBrainGrantableRole = (typeof PROJECT_BRAIN_GRANTABLE_ROLES)[number];

/** The doors' actor grammar: what a player id may look like anywhere it is named. */
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
/** A role as the membership table may hold it: upper-case words. Unknown roles are named, never trusted. */
const ROLE_NAME = /^[A-Z][A-Z_]{0,31}$/u;

export type ProjectBrainMemberCommand =
  | {
    readonly operation: 'MEMBER_SET';
    readonly idempotencyKey: string;
    readonly playerId: string;
    readonly role: ProjectBrainGrantableRole;
    /** The role the caller saw; null when the player was not a member. */
    readonly expectedRole: string | null;
  }
  | {
    readonly operation: 'MEMBER_REMOVE';
    readonly idempotencyKey: string;
    readonly playerId: string;
    readonly expectedRole: string;
  };

const MEMBER_KEYS: Readonly<Record<ProjectBrainMemberOperation, readonly string[]>> = {
  MEMBER_SET: ['operation', 'idempotencyKey', 'playerId', 'role', 'expectedRole'],
  MEMBER_REMOVE: ['operation', 'idempotencyKey', 'playerId', 'expectedRole'],
};

export const isProjectBrainMemberOperation = (value: unknown): value is ProjectBrainMemberOperation =>
  typeof value === 'string' && (PROJECT_BRAIN_MEMBER_OPERATIONS as readonly string[]).includes(value);

/** A membership change, from an untrusted body. Closed keys: anything not named here is refused. */
export function parseProjectBrainMemberChange(input: unknown): { readonly ok: true; readonly command: ProjectBrainMemberCommand } | ProjectBrainRefusal {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return projectBrainRefusal(400, 'body_invalid', 'A membership change is a JSON object.');
  const body = input as Record<string, unknown>;
  if (!isProjectBrainMemberOperation(body.operation)) return projectBrainRefusal(422, 'operation_invalid', 'operation is MEMBER_SET or MEMBER_REMOVE.');
  const operation = body.operation;
  const unknown = Object.keys(body).filter((key) => !MEMBER_KEYS[operation].includes(key));
  if (unknown.length > 0) return projectBrainRefusal(422, 'field_unknown', `A ${operation} carries only ${MEMBER_KEYS[operation].join(', ')}; refused: ${unknown.sort().join(', ')}.`);
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
    return projectBrainRefusal(422, 'idempotency_key_required', 'idempotencyKey is required (8-200 of A-Z a-z 0-9 . _ : -). Send the same key to retry safely.');
  }
  if (typeof body.playerId !== 'string' || !PLAYER_ID.test(body.playerId)) return projectBrainRefusal(422, 'player_invalid', 'playerId is not a player id.');
  const expected = body.expectedRole;
  if (operation === 'MEMBER_SET') {
    if (!(PROJECT_BRAIN_GRANTABLE_ROLES as readonly unknown[]).includes(body.role)) {
      return projectBrainRefusal(422, 'role_invalid', `role is one of ${PROJECT_BRAIN_GRANTABLE_ROLES.join(', ')}; OWNER is never granted.`);
    }
    if (expected !== null && (typeof expected !== 'string' || !ROLE_NAME.test(expected))) {
      return projectBrainRefusal(422, 'expected_role_required', 'expectedRole is the role you saw for this player, or null if they were not a member.');
    }
    return { ok: true, command: { operation, idempotencyKey: body.idempotencyKey, playerId: body.playerId, role: body.role as ProjectBrainGrantableRole, expectedRole: expected as string | null } };
  }
  if (typeof expected !== 'string' || !ROLE_NAME.test(expected)) {
    return projectBrainRefusal(422, 'expected_role_required', 'expectedRole is the role you saw for this player: a removal is never blind.');
  }
  return { ok: true, command: { operation, idempotencyKey: body.idempotencyKey, playerId: body.playerId, expectedRole: expected } };
}

/**
 * MAY THIS CALLER MAKE THIS CHANGE, given the target's role as the database holds it NOW? Pure; the store calls it
 * inside the transaction, under the project's lock, so `currentRole` cannot move between the check and the write.
 */
export function authorizeProjectBrainMemberChange(input: {
  readonly provenance: ProjectBrainProvenance;
  readonly capabilities: readonly ProjectBrainCapability[];
  /** The caller's own role in this project (null when the caller is not a member). */
  readonly actorRole: string | null;
  /** The player id the caller acts as (the member whose row this must not be). */
  readonly actorId: string;
  readonly command: ProjectBrainMemberCommand;
  /** The target's role now; null when the target is not a member. */
  readonly currentRole: string | null;
}): { readonly ok: true } | ProjectBrainRefusal {
  const { provenance, capabilities, actorRole, actorId, command, currentRole } = input;
  if (provenance.author.kind === 'COMPANION' || provenance.deliverer.kind === 'COMPANION_CHANNEL') {
    return projectBrainRefusal(403, 'companion_cannot_manage_members', 'A companion decides nothing about who is in a project.');
  }
  if (!capabilities.includes('brain:members')) return projectBrainRefusal(403, 'members_not_permitted', 'Only an owner or an admin changes who is in this project.');
  if (command.playerId === actorId) return projectBrainRefusal(403, 'own_membership', 'Nobody changes their own membership; another owner or admin does.');
  if (currentRole !== command.expectedRole) {
    return projectBrainRefusal(409, 'member_conflict', `This player's role is ${currentRole ?? 'none'}, not ${command.expectedRole ?? 'none'}: someone changed it. Nothing was saved; read again.`);
  }
  if (currentRole === 'OWNER') return projectBrainRefusal(403, 'owner_is_permanent', 'The owner of a project is never changed or removed here.');
  const touchesAdmin = (command.operation === 'MEMBER_SET' && command.role === 'ADMIN') || (currentRole !== null && currentRole !== 'MEMBER');
  if (touchesAdmin && actorRole !== 'OWNER') return projectBrainRefusal(403, 'owner_required', 'Only an owner grants, changes or removes an admin.');
  if (command.operation === 'MEMBER_SET' && command.role === currentRole) {
    return projectBrainRefusal(409, 'member_unchanged', `This player is already ${currentRole}. Nothing was saved.`);
  }
  // A removal of someone who is no longer a member was refused above as a conflict: the caller saw a role that is gone.
  return { ok: true };
}

/** The event each change is announced under, in the one Project Brain vocabulary. */
export const projectBrainMemberEventType = (operation: ProjectBrainMemberOperation) =>
  (operation === 'MEMBER_SET' ? 'project_brain.member.set' : 'project_brain.member.removed') as 'project_brain.member.set' | 'project_brain.member.removed';
