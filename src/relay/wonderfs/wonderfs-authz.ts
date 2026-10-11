/**
 * WONDERFS — who may do what (§8). Pure: the caller resolves the principal, its role or grant, and the clock.
 *
 *   - A HUMAN acts by role in the project: owner / editor / viewer (§8.2).
 *   - Every NON-HUMAN acts under exactly one GRANT (§8.3): scoped to branches, operations and path globs, expiring,
 *     revocable, and never wider than whoever issued it. A clone's grant is a subset of its parent's.
 *   - The server's own namespace (`.wonderfs` at the root) is never writable, whatever a grant says.
 *
 * Refusals are uniform (§9.1): `not-found` with one fixed message, whatever the reason, so a refusal never tells an outsider
 * whether the thing exists. The precise reason goes to `details` for the server's own log, never to the caller.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { WfsPrincipalKind, WfsProjectId } from './wonderfs-contracts';
import { normalizeWfsPath, wfsIsBeneath, wfsPathKey, WFS_RESERVED_ROOT } from './wonderfs-paths';

export type WfsHumanRole = 'owner' | 'editor' | 'viewer';

/** What a principal asks to do. `paths` are the paths an operation reads or writes (both ends of a move). */
export type WfsAction = 'read' | 'write' | 'delete' | 'move' | 'merge' | 'resolve' | 'approve_merge' | 'issue_grant' | 'manage_project';

export type WfsGrantOp = 'read' | 'write' | 'delete' | 'move' | 'merge';

export interface WfsGrant {
  readonly grantId: string;
  readonly projectId: WfsProjectId;
  readonly principalId: string;
  readonly principalKind: Exclude<WfsPrincipalKind, 'human'>;
  /** A human (by user id) or, for a clone, the grant it was cut from. */
  readonly issuedBy: { readonly kind: 'human'; readonly userId: string } | { readonly kind: 'grant'; readonly grantId: string };
  /** `own` = only branches this principal owns; `main_and_own` adds main (never granted to a clone). */
  readonly branches: 'own' | 'main_and_own';
  readonly ops: readonly WfsGrantOp[];
  /** Path globs over normalized paths: `*` within one name, `**` across folders. `**` alone = the whole project. */
  readonly paths: readonly string[];
  readonly expiresAtIso: string;
  readonly revokedAtIso: string | null;
}

const HUMAN_ACTIONS: Record<WfsHumanRole, readonly WfsAction[]> = {
  owner: ['read', 'write', 'delete', 'move', 'merge', 'resolve', 'approve_merge', 'issue_grant', 'manage_project'],
  editor: ['read', 'write', 'delete', 'move', 'merge', 'resolve', 'approve_merge', 'issue_grant'],
  viewer: ['read'],
};

/** The one refusal every caller sees (§9.1). */
function refused(reasonForServerLog: string): RelayResult<never> {
  return fail(relayError('not-found', 'Not found.', { details: [`wonderfs-authz: ${reasonForServerLog}`] }));
}

function touchesReservedRoot(paths: readonly string[]): boolean {
  return paths.some((p) => wfsPathKey(p.split('/')[0]) === WFS_RESERVED_ROOT);
}

const WRITE_ACTIONS: ReadonlySet<WfsAction> = new Set(['write', 'delete', 'move', 'merge', 'resolve']);

/** A human's request. `role` is `null` when the user has no role in the project: indistinguishable from "no such project". */
export function authorizeHuman(input: { readonly role: WfsHumanRole | null; readonly action: WfsAction; readonly paths: readonly string[] }): RelayResult<true> {
  if (input.role === null) return refused('no role in this project');
  if (WRITE_ACTIONS.has(input.action) && touchesReservedRoot(input.paths)) return refused('the reserved namespace');
  if (!HUMAN_ACTIONS[input.role].includes(input.action)) return refused(`role ${input.role} may not ${input.action}`);
  return ok(true);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Globs. Deliberately small: `*` = any run of characters inside one name, `**` = any run of names (zero or more). Matching is
// on path KEYS, so case never lets a path slip past a glob.
// ---------------------------------------------------------------------------------------------------------------------------

function globSource(glob: string): string {
  const parts = wfsPathKey(glob).split('/');
  const out: string[] = [];
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    if (part === '**') {
      out.push(last ? '.*' : '(?:[^/]+/)*');
      return;
    }
    const name = part
      .split('*')
      .map((lit) => lit.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*');
    out.push(last ? name : `${name}/`);
  });
  return `^${out.join('')}$`;
}

/** True when the normalized `path` matches `glob`. A glob that is not itself a valid path pattern matches nothing. */
export function wfsGlobMatches(glob: string, path: string): boolean {
  if (glob.length === 0 || glob.startsWith('/') || glob.includes('//') || glob.split('/').some((p) => p === '.' || p === '..')) return false;
  return new RegExp(globSource(glob), 'u').test(wfsPathKey(path));
}

/**
 * A conservative subset test for clone grants (§8.3): `child` is covered when it equals a parent glob, the parent has `**`,
 * or the parent is `P/**` and the child lies beneath P. Anything cleverer is refused: a refused clone is an inconvenience, a
 * clone wider than its parent is a hole.
 */
export function wfsGlobCovered(child: string, parentGlobs: readonly string[]): boolean {
  const c = wfsPathKey(child);
  return parentGlobs.some((pg) => {
    const p = wfsPathKey(pg);
    if (p === c || p === '**') return true;
    if (!p.endsWith('/**')) return false;
    const prefix = p.slice(0, -3);
    return !prefix.includes('*') && wfsIsBeneath(c, prefix);
  });
}

const GRANT_OPS_FOR: Partial<Record<WfsAction, WfsGrantOp>> = { read: 'read', write: 'write', delete: 'delete', move: 'move', merge: 'merge' };

/**
 * A non-human's request under its grant. `branchOwnedByPrincipal` / `branchIsMain` describe the branch it targets; the store
 * knows which branch a principal owns. Checked on EVERY use: a revocation or an expiry bites on the next request.
 */
export function authorizeAgent(input: {
  readonly grant: WfsGrant | null;
  readonly principalId: string;
  readonly projectId: WfsProjectId;
  readonly nowIso: string;
  readonly action: WfsAction;
  readonly branchIsMain: boolean;
  readonly branchOwnedByPrincipal: boolean;
  readonly paths: readonly string[];
}): RelayResult<true> {
  const g = input.grant;
  if (g === null) return refused('no grant');
  if (g.projectId !== input.projectId || g.principalId !== input.principalId) return refused('the grant belongs to another project or principal');
  if (g.revokedAtIso !== null && g.revokedAtIso <= input.nowIso) return refused('the grant was revoked');
  if (g.expiresAtIso <= input.nowIso) return refused('the grant expired');
  const op = GRANT_OPS_FOR[input.action];
  if (op === undefined || !g.ops.includes(op)) return refused(`the grant does not allow ${input.action}`);
  if (input.branchIsMain ? g.branches !== 'main_and_own' : !input.branchOwnedByPrincipal) return refused('the grant does not reach this branch');
  if (input.action !== 'read' && touchesReservedRoot(input.paths)) return refused('the reserved namespace');
  for (const p of input.paths) {
    const n = normalizeWfsPath(p);
    if (!n.ok) return refused('a malformed path');
    if (!g.paths.some((glob) => wfsGlobMatches(glob, n.value.path))) return refused('a path outside the grant');
  }
  return ok(true);
}

/** May `child` be issued under `parent` (a clone's grant, §8.3)? Every dimension must be within the parent's. */
export function wfsCloneGrantWithin(child: WfsGrant, parent: WfsGrant, nowIso: string): RelayResult<true> {
  if (child.principalKind !== 'clone') return refused('only a clone takes a grant cut from another grant');
  if (child.issuedBy.kind !== 'grant' || child.issuedBy.grantId !== parent.grantId) return refused('the clone grant names another parent');
  if (child.projectId !== parent.projectId) return refused('the clone grant is for another project');
  if (parent.revokedAtIso !== null && parent.revokedAtIso <= nowIso) return refused('the parent grant was revoked');
  if (parent.expiresAtIso <= nowIso) return refused('the parent grant expired');
  if (child.branches !== 'own') return refused('a clone works only on its own branch');
  if (child.expiresAtIso > parent.expiresAtIso) return refused('the clone grant outlives its parent');
  if (!child.ops.every((o) => parent.ops.includes(o))) return refused('the clone grant allows an op its parent does not');
  if (!child.paths.every((p) => wfsGlobCovered(p, parent.paths))) return refused('the clone grant reaches a path its parent does not');
  return ok(true);
}

/** The branch a merge-back lands on must be the parent; for an imported agent, a human editor must have approved it (§8.3). */
export function wfsMergeNeedsApproval(ownerKind: WfsPrincipalKind, targetIsMain: boolean): boolean {
  return ownerKind === 'imported_agent' && targetIsMain;
}
