/**
 * MAY THIS WORKER CREATE -- OR EDIT -- THIS FILE? PURE DECISIONS, AND JULIUS'S TO MAKE.
 *
 * WHY THIS EXISTS. The hosted Coding Agent could read, search and EDIT, and could
 * not create a file: its envelope denied `Write` unconditionally. So a mission
 * needing a new module, test, component or configuration file required a human to
 * commit an empty stub first. For a mission an operator composes that is friction;
 * for one a PLAYER composes it is fatal, because nobody is there to invent the
 * file list.
 *
 * WHY IT IS A DECISION RATHER THAN A TOOL. Granting `Write` and relying on the
 * attempt snapshot is not containment: the snapshot's authority is real for the
 * WORKSPACE, but a write to a path outside it is not caught, it is UNSEEN -- the
 * agent is a child process on the bridge host, not a process in the sandbox. So
 * the write is ASKED about before it happens, Julius answers, and this module is
 * the answer. The bridge's hosted tool authority maps a runtime's tool call onto
 * these shapes; this module names no provider, SDK or tool.
 *
 * WHO MAY AUTHORISE CREATION. A {@link JuliusFileCreationGrant} is MISSION-OWNED:
 * it comes from the trusted mission contract, never from a worker's proposal. The
 * locked task contract -- which the Prompt Architect drafts -- may only NARROW
 * where a file lands ({@link juliusFileCreationPolicyFor}); it can never grant
 * creation or widen it. No grant, no creation: that stays the default, so every
 * mission written before this capability behaves exactly as it did.
 *
 * DENY IS THE DEFAULT, and every refusal has a name a record can carry.
 *
 * PURE. No Node, no clock, no network, no filesystem.
 */

import {
  juliusPathIsUnder,
  juliusPathLocation,
  juliusWorkspaceRelativePath,
  type JuliusPathRefusal,
} from './julius-workspace-paths';

/** What a worker asked to create. `exists` is observed by the caller, never here. */
export interface JuliusFileCreationRequest {
  /** The WORKSPACE-RELATIVE path. A caller resolves a runtime's absolute path first; an absolute spelling is refused. */
  readonly path: string;
  /** Bytes of content it intends to write. */
  readonly bytes: number;
  /** Whether something is already at that path. The caller looks; this module does not. */
  readonly exists: boolean;
}

/** The bounds one dispatch was given. Built by {@link juliusFileCreationPolicyFor}, never by a worker. */
export interface JuliusFileCreationPolicy {
  /**
   * Prefixes the dispatch may create under. EMPTY MEANS NOTHING IS PERMITTED, not
   * everything: a grant that forgot to say where work may land must not thereby
   * authorise the whole workspace.
   */
  readonly permittedPaths: readonly string[];
  /**
   * When non-empty, a created path must ALSO sit under one of these -- the locked
   * task contract's `permittedPaths`, which may narrow the mission's grant and may
   * never widen it. Empty means the contract adds no narrowing.
   */
  readonly alsoWithin: readonly string[];
  /** Prefixes it may not write under, even when a permitted prefix would allow them. */
  readonly outOfScope: readonly string[];
  /** The largest file it may create, in bytes. */
  readonly maxBytes: number;
  /** Whether it may replace a file that already exists. */
  readonly mayOverwrite: boolean;
}

/**
 * THE MISSION'S OWN AUTHORISATION TO CREATE FILES, from the trusted mission
 * contract. Absent means the mission may not create anything.
 */
export interface JuliusFileCreationGrant {
  /** Where new files may land. Must be non-empty, and every entry a safe workspace-relative prefix. */
  readonly permittedPaths: readonly string[];
  /** The largest created file, in bytes; clamped to {@link JULIUS_FILE_CREATION_LIMITS}. */
  readonly maxBytes?: number;
  /** Whether an existing file may be replaced by `Write`. Defaults to false. */
  readonly mayOverwrite?: boolean;
}

/**
 * THE CEILINGS ON A CREATED FILE. 256 KiB by default is several thousand lines of
 * source -- more than any single file a mission should produce in one write -- and
 * 1 MiB is the hard stop. The workspace itself is small (see
 * `docs/JULIUS_MVP_CAPABILITIES.md`), so a creation large enough to exhaust it is
 * refused here rather than discovered as a failed snapshot.
 */
export const JULIUS_FILE_CREATION_LIMITS = Object.freeze({
  defaultMaxBytes: 256 * 1024,
  hardMaxBytes: 1024 * 1024,
  maxPrefixes: 32,
});

export type JuliusFileCreationRefusal =
  | JuliusPathRefusal
  | 'path_control_location'
  | 'path_credential_location'
  | 'path_workflow_location'
  | 'path_out_of_scope'
  | 'path_not_permitted'
  | 'content_too_large'
  | 'content_negative'
  | 'overwrite_not_authorized';

export type JuliusFileCreationDecision =
  | { readonly allowed: true; readonly path: string; readonly overwrites: boolean }
  | { readonly allowed: false; readonly refusal: JuliusFileCreationRefusal; readonly because: string };

type LocationRefusal = 'path_control_location' | 'path_credential_location' | 'path_workflow_location';

/** The location check both decisions share, so creation and edit cannot disagree about `.git`. */
function locationRefusal(segments: readonly string[]): { refusal: LocationRefusal; because: string } | null {
  const location = juliusPathLocation(segments);
  switch (location.kind) {
    case 'ordinary': return null;
    case 'control': return { refusal: 'path_control_location', because: location.because };
    case 'credential': return { refusal: 'path_credential_location', because: location.because };
    case 'workflow': return { refusal: 'path_workflow_location', because: location.because };
    default: return { refusal: 'path_control_location', because: 'An unclassified location is refused.' };
  }
}

/**
 * Julius's answer to a creation request. The returned `path` is the normalised
 * POSIX spelling, so a caller never re-derives it and two spellings of one path
 * cannot be authorised differently.
 */
export function juliusFileCreationDecision(
  request: JuliusFileCreationRequest,
  policy: JuliusFileCreationPolicy,
): JuliusFileCreationDecision {
  const refuse = (refusal: JuliusFileCreationRefusal, because: string): JuliusFileCreationDecision =>
    ({ allowed: false, refusal, because });

  const relative = juliusWorkspaceRelativePath(request.path);
  if (!relative.ok) return refuse(relative.refusal, relative.because);
  const { path, segments } = relative;

  const located = locationRefusal(segments);
  if (located !== null) return refuse(located.refusal, located.because);

  // SCOPE. Out of scope wins over permitted: the contract's exclusions are the
  // more specific statement.
  for (const prefix of policy.outOfScope) {
    if (juliusPathIsUnder(path, prefix)) {
      return refuse('path_out_of_scope', `"${path}" is under "${prefix}", which this mission's contract puts out of scope.`);
    }
  }
  if (!policy.permittedPaths.some((prefix) => juliusPathIsUnder(path, prefix))) {
    return refuse('path_not_permitted', `"${path}" is under none of the paths this mission permits new files in.`);
  }
  if (policy.alsoWithin.length > 0 && !policy.alsoWithin.some((prefix) => juliusPathIsUnder(path, prefix))) {
    return refuse('path_not_permitted', `"${path}" is outside the locked task contract's permitted paths.`);
  }

  if (!Number.isFinite(request.bytes) || request.bytes < 0) {
    return refuse('content_negative', 'A content size must be a non-negative number.');
  }
  if (request.bytes > policy.maxBytes) {
    return refuse('content_too_large', `${String(request.bytes)} bytes exceeds the ${String(policy.maxBytes)}-byte ceiling for a created file.`);
  }

  if (request.exists && !policy.mayOverwrite) {
    return refuse('overwrite_not_authorized', `"${path}" already exists and this dispatch may not replace an existing file; edit it instead.`);
  }

  return { allowed: true, path, overwrites: request.exists };
}

/* -------------------------------------------------------------- the policy */

export type JuliusFileCreationPolicyResult =
  | { readonly policy: JuliusFileCreationPolicy; readonly problem: null }
  | { readonly policy: null; readonly problem: string | null };

/**
 * THE POLICY ONE DISPATCH RUNS UNDER, from the mission's grant and the locked
 * task contract's bounds.
 *
 * `problem` is null when there is simply no grant (creation is off, the default)
 * and a sentence when a grant was present but unusable -- a malformed grant fails
 * CLOSED, with a reason, and never degrades to "create anywhere".
 */
export function juliusFileCreationPolicyFor(
  grant: JuliusFileCreationGrant | null | undefined,
  contract: { readonly permittedPaths: readonly string[]; readonly outOfScope: readonly string[] } | null,
): JuliusFileCreationPolicyResult {
  if (grant === null || grant === undefined) return { policy: null, problem: null };
  const prefixes = Array.isArray(grant.permittedPaths) ? grant.permittedPaths : [];
  if (prefixes.length === 0) {
    return { policy: null, problem: 'The mission grants file creation but names no path it may happen under.' };
  }
  if (prefixes.length > JULIUS_FILE_CREATION_LIMITS.maxPrefixes) {
    return { policy: null, problem: `A creation grant may name at most ${String(JULIUS_FILE_CREATION_LIMITS.maxPrefixes)} paths.` };
  }
  const permittedPaths: string[] = [];
  for (const prefix of prefixes) {
    const relative = juliusWorkspaceRelativePath(prefix);
    if (!relative.ok) return { policy: null, problem: `Creation grant path "${String(prefix)}" is refused: ${relative.because}` };
    const located = locationRefusal(relative.segments);
    if (located !== null) return { policy: null, problem: `Creation grant path "${relative.path}" is refused: ${located.because}` };
    permittedPaths.push(relative.path);
  }
  const requested = typeof grant.maxBytes === 'number' && Number.isFinite(grant.maxBytes) && grant.maxBytes > 0
    ? Math.floor(grant.maxBytes)
    : JULIUS_FILE_CREATION_LIMITS.defaultMaxBytes;
  return {
    policy: Object.freeze({
      permittedPaths: Object.freeze(permittedPaths),
      alsoWithin: Object.freeze([...(contract?.permittedPaths ?? [])]),
      outOfScope: Object.freeze([...(contract?.outOfScope ?? [])]),
      maxBytes: Math.min(requested, JULIUS_FILE_CREATION_LIMITS.hardMaxBytes),
      mayOverwrite: grant.mayOverwrite === true,
    }),
    problem: null,
  };
}

/* ----------------------------------------------------------------- editing */

export type JuliusFileEditRefusal =
  | JuliusPathRefusal
  | LocationRefusal
  | 'path_out_of_scope';

export type JuliusFileEditDecision =
  | { readonly allowed: true; readonly path: string }
  | { readonly allowed: false; readonly refusal: JuliusFileEditRefusal; readonly because: string };

/**
 * MAY THIS WORKER EDIT THIS EXISTING FILE?
 *
 * Narrower than creation on purpose. An edit was always permitted anywhere in the
 * granted repository, and whether it stayed inside the contract's
 * `permittedPaths` is judged AFTER the session from what the executor observed --
 * so this decision refuses only what no contract could make safe: a spelling that
 * is not a workspace path, a control or credential location, a workflow file, and
 * a path the contract puts OUT of scope.
 */
export function juliusFileEditDecision(
  request: { readonly path: string },
  policy: { readonly outOfScope: readonly string[] },
): JuliusFileEditDecision {
  const relative = juliusWorkspaceRelativePath(request.path);
  if (!relative.ok) return { allowed: false, refusal: relative.refusal, because: relative.because };
  const located = locationRefusal(relative.segments);
  if (located !== null) return { allowed: false, refusal: located.refusal, because: located.because };
  for (const prefix of policy.outOfScope) {
    if (juliusPathIsUnder(relative.path, prefix)) {
      return { allowed: false, refusal: 'path_out_of_scope', because: `"${relative.path}" is under "${prefix}", which this mission's contract puts out of scope.` };
    }
  }
  return { allowed: true, path: relative.path };
}
