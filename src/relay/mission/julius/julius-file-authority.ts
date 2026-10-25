/**
 * MAY THIS WORKER EDIT THIS FILE? A PURE DECISION, AND JULIUS'S TO MAKE.
 *
 * WHY THIS EXISTS. The hosted Coding Agent changes a mission's workspace with
 * `Edit`, which its envelope allows outright under `acceptEdits`. An allow rule
 * approves EVERY call to that tool, so nothing Julius owned was asked before a
 * worker changed `.git/config`, a CI workflow or a credential file -- and a line
 * in `.git/config` (`core.fsmonitor`, `core.hooksPath`) or a file under
 * `.julius/` is code the attempt's own snapshot or final check then runs. The
 * bridge's hosted tool authority now asks this module before every edit. This
 * module names no provider, SDK or tool.
 *
 * WHAT IT REFUSES, AND WHAT IT DOES NOT. Only what no contract could make safe:
 * a spelling that is not a workspace path, a control or credential location, and
 * a CI workflow file. An ordinary file anywhere in the workspace may be edited,
 * exactly as before, and whether an edit stayed inside the contract's scope is
 * still judged AFTER the session from what the executor observed.
 *
 * DENY IS THE DEFAULT for those locations, and every refusal has a name from a
 * CLOSED set ({@link JULIUS_FILE_AUTHORITY_REFUSALS}).
 *
 * PURE. No Node, no clock, no network, no filesystem.
 */

import {
  juliusPathLocation,
  juliusWorkspaceRelativePath,
  type JuliusPathRefusal,
} from './julius-workspace-paths';

export type JuliusFileLocationRefusal = 'path_control_location' | 'path_credential_location' | 'path_workflow_location';

/** The location check in one place, so no two tools can disagree about `.git`. */
function locationRefusal(segments: readonly string[]): { refusal: JuliusFileLocationRefusal; because: string } | null {
  const location = juliusPathLocation(segments);
  switch (location.kind) {
    case 'ordinary': return null;
    case 'control': return { refusal: 'path_control_location', because: location.because };
    case 'credential': return { refusal: 'path_credential_location', because: location.because };
    case 'workflow': return { refusal: 'path_workflow_location', because: location.because };
    default: return { refusal: 'path_control_location', because: 'An unclassified location is refused.' };
  }
}

export type JuliusFileEditRefusal = JuliusPathRefusal | JuliusFileLocationRefusal;

export type JuliusFileEditDecision =
  | { readonly allowed: true; readonly path: string }
  | { readonly allowed: false; readonly refusal: JuliusFileEditRefusal; readonly because: string };

/**
 * MAY THIS WORKER EDIT THIS EXISTING FILE? The returned `path` is the normalised
 * POSIX spelling, so two spellings of one path cannot be answered differently.
 */
export function juliusFileEditDecision(request: { readonly path: string }): JuliusFileEditDecision {
  const relative = juliusWorkspaceRelativePath(request.path);
  if (!relative.ok) return { allowed: false, refusal: relative.refusal, because: relative.because };
  const located = locationRefusal(relative.segments);
  if (located !== null) return { allowed: false, refusal: located.refusal, because: located.because };
  return { allowed: true, path: relative.path };
}

/**
 * EVERY REFUSAL NAME A FILE-AUTHORITY DECISION CAN PRODUCE -- the kernel's own
 * and the bridge adapter's (a path outside the workspace, a glob that climbs out,
 * a creation tool no mission is granted, a creation outside a mission's grant,
 * a cancelled dispatch, an unresolvable
 * workspace). A CLOSED set: the adapter's refusal parameter is typed to it, so a
 * record can never come to hold a word nobody defined.
 */
export const JULIUS_FILE_AUTHORITY_REFUSALS = Object.freeze([
  'path_empty', 'path_absolute', 'path_drive_qualified', 'path_traversal', 'path_invalid_character',
  'path_ambiguous_segment', 'path_reserved_name', 'path_too_long',
  'path_control_location', 'path_credential_location', 'path_workflow_location',
  'path_outside_workspace', 'path_unreadable', 'creation_not_granted', 'creation_outside_grant', 'glob_outside_workspace',
  'dispatch_cancelled', 'workspace_unresolvable',
] as const);
export type JuliusFileAuthorityRefusal = (typeof JULIUS_FILE_AUTHORITY_REFUSALS)[number];

/* ------------------------------------------------------------ file creation */

/**
 * WHICH MISSIONS MAY CREATE FILES, AND WHERE.
 *
 * The hosted Coding Agent edits files that already exist; creating one is
 * refused on every run (`creation_not_granted`). One mission needs more:
 * `julius-inworld-data-1` (J1) asks the coder to produce `out/normalized.json`,
 * a file -- and a directory -- that does not exist until the coder writes it.
 * The founder and the independent review approved exactly that and nothing
 * wider: creation for J1 ONLY, confined to `out/` inside the workspace.
 *
 * THE KEY IS THE VERIFIED CONTRACT'S `markerNamespace`, looked up by the
 * composition root that parsed the contract. Nothing the coder can reach --
 * a request field, an environment variable, a path it names -- selects a
 * grant: the table below is the only source, and it is frozen.
 *
 * A grant is a PREFIX, not a list of files: the coder may create anything
 * strictly under it, judged by real path (`hosted-tool-authority.ts`), and
 * nothing at it or outside it.
 */

/** One mission's permission to create files: everything strictly under `prefix` (workspace-relative, POSIX, ending in `/`). */
export interface JuliusFileCreationGrant {
  readonly prefix: string;
}

/** THE TABLE. Adding a row widens what a coder may create; it is a reviewed code change, never configuration. */
export const JULIUS_FILE_CREATION_GRANTS: Readonly<Record<string, JuliusFileCreationGrant>> = Object.freeze({
  'julius-inworld-data-1': Object.freeze({ prefix: 'out/' }),
});

/**
 * The grant a mission's verified `markerNamespace` carries, or null. An own
 * property of the table only, so `constructor`, `__proto__` or any other
 * inherited name answers null rather than something nobody granted.
 */
export function juliusFileCreationGrant(namespace: string | null | undefined): JuliusFileCreationGrant | null {
  if (typeof namespace !== 'string' || namespace === '') return null;
  if (!Object.prototype.hasOwnProperty.call(JULIUS_FILE_CREATION_GRANTS, namespace)) return null;
  return JULIUS_FILE_CREATION_GRANTS[namespace] ?? null;
}

/**
 * THE CONTRACT EACH GRANT BELONGS TO, by sha256 of its exact bytes. A namespace alone is a name a
 * contract chooses for itself; the grant follows the reviewed contract, so an edited contract
 * carrying the same namespace is granted nothing. J1's is J1_PINNED_CONTRACT_SHA256
 * (relay-bridge/julius-inworld-checker.ts); a test holds the two equal.
 */
export const JULIUS_FILE_CREATION_CONTRACTS: Readonly<Record<string, string>> = Object.freeze({
  'julius-inworld-data-1': 'bfa90f50f70916ff52180a94537f243300da8dcc51ee06d3952b0f18876226aa',
});

/** What the live entry uses: the namespace's grant, only when the contract's bytes are the pinned ones. */
export function juliusFileCreationGrantFor(namespace: string | null | undefined, contractSha256: string | null | undefined): JuliusFileCreationGrant | null {
  const grant = juliusFileCreationGrant(namespace);
  if (grant === null || typeof namespace !== 'string' || typeof contractSha256 !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(JULIUS_FILE_CREATION_CONTRACTS, namespace)) return null;
  return JULIUS_FILE_CREATION_CONTRACTS[namespace] === contractSha256 ? grant : null;
}
