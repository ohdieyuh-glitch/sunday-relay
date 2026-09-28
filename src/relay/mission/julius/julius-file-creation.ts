/**
 * MAY THIS WORKER CREATE THIS FILE? A PURE DECISION, AND JULIUS'S TO MAKE.
 *
 * WHY THIS EXISTS. The hosted Coding Agent can read, search and EDIT, and cannot
 * create a file: its envelope denies `Write` unconditionally. So a mission that
 * needs a new module, a new test, a new component or a new configuration file
 * requires a human to commit an empty stub first, and CI asserts that a contract
 * "must ask for edits, never for a new file". For a mission an operator composes
 * that is friction. For one a PLAYER composes it is fatal, because nobody is
 * there to invent the file list.
 *
 * WHY IT IS A DECISION RATHER THAN A TOOL. The obvious fix is to grant `Write`
 * and rely on what the existing audit already does. That audit is a tree snapshot
 * of the WORKSPACE, and its authority is real for anything inside it — but a write
 * to an absolute path outside the workspace is not caught by it, it is simply
 * UNSEEN, and a coder runs as a child process on the bridge host rather than
 * inside the sandbox. "Not observed" is the one answer a containment control may
 * never give. So the permission is asked BEFORE the write, Julius answers, and
 * this module is the answer.
 *
 * WHAT THIS MODULE IS NOT. It does not write anything and it names no provider,
 * no SDK and no tool. It takes a requested path, a byte count and whether the
 * target already exists, and returns allow or a NAMED refusal. Observing the
 * filesystem and mapping some runtime's tool call onto this shape are both the
 * bridge's job, which is what keeps this decision testable without a provider,
 * a disk or a clock.
 *
 * DENY IS THE DEFAULT. Every path that is not recognised as permitted is refused,
 * and every refusal has a name a record can carry.
 *
 * PURE. No Node, no clock, no network, no filesystem.
 */

/** What a worker asked to create. `exists` is observed by the caller, never here. */
export interface JuliusFileCreationRequest {
  /** The path as the worker spelled it, in whatever separator it chose. */
  readonly path: string;
  /** Bytes of content it intends to write. */
  readonly bytes: number;
  /** Whether something is already at that path. The caller looks; this module does not. */
  readonly exists: boolean;
}

/** The bounds this dispatch was given, from the architecture contract and the limits. */
export interface JuliusFileCreationPolicy {
  /**
   * Prefixes the dispatch may write under. EMPTY MEANS NOTHING IS PERMITTED, not
   * everything: a contract that forgot to say where work may land must not thereby
   * authorise the whole workspace.
   */
  readonly permittedPaths: readonly string[];
  /** Prefixes it may not write under, even when a permitted prefix would allow them. */
  readonly outOfScope: readonly string[];
  /** The largest file it may create, in bytes. */
  readonly maxBytes: number;
  /** Whether it may replace a file that already exists. */
  readonly mayOverwrite: boolean;
}

export type JuliusFileCreationRefusal =
  | 'path_empty'
  | 'path_absolute'
  | 'path_drive_qualified'
  | 'path_traversal'
  | 'path_control_location'
  | 'path_credential_location'
  | 'path_out_of_scope'
  | 'path_not_permitted'
  | 'content_too_large'
  | 'content_negative'
  | 'overwrite_not_authorized';

export type JuliusFileCreationDecision =
  | { readonly allowed: true; readonly path: string; readonly overwrites: boolean }
  | { readonly allowed: false; readonly refusal: JuliusFileCreationRefusal; readonly because: string };

/**
 * DIRECTORIES WHOSE CONTENTS ARE NOT SOURCE, AND WHERE A WRITE IS AN ACTION.
 *
 * `.git` first, because a file in `.git/hooks` is arbitrary code that the next git
 * command runs — a creation capability that permitted it would be a remote shell
 * with extra steps. `.julius` is the harness the mission's own check loads.
 * `node_modules` is not dangerous so much as never a deliverable, and permitting it
 * invites a coder to "fix" a dependency in a way no diff review would catch.
 */
const CONTROL_SEGMENTS: readonly string[] = Object.freeze([
  '.git', '.julius', '.hg', '.svn', '.bzr', 'node_modules',
]);

/**
 * LOCATIONS THAT HOLD CREDENTIALS, or that execute on someone else's behalf.
 *
 * `.github/workflows` is here rather than above because the directory is ordinary
 * and the contents are CI: this repository's own App cannot push a workflow
 * change, and a coder must not route around that by writing one.
 */
const CREDENTIAL_SEGMENTS: readonly string[] = Object.freeze([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config',
]);
const CREDENTIAL_FILES: readonly string[] = Object.freeze([
  '.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', 'credentials', 'id_rsa', 'id_ed25519',
]);
const WORKFLOW_PREFIX = '.github/workflows/';

/** Separators normalised, `.` segments dropped, nothing else changed. */
const segmentsOf = (path: string): readonly string[] =>
  path.split(/[\\/]+/u).filter((segment) => segment !== '' && segment !== '.');

/** `a/b` is under `a` and under `a/`; `ab` is not under `a`. */
const isUnder = (path: string, prefix: string): boolean => {
  const clean = segmentsOf(prefix).join('/');
  if (clean === '') return false;
  return path === clean || path.startsWith(`${clean}/`);
};

/**
 * Julius's answer to a creation request. The returned `path` is the normalised
 * POSIX spelling, so a caller never has to re-derive it from the request and two
 * spellings of one path cannot be authorised differently.
 */
export function juliusFileCreationDecision(
  request: JuliusFileCreationRequest,
  policy: JuliusFileCreationPolicy,
): JuliusFileCreationDecision {
  const refuse = (refusal: JuliusFileCreationRefusal, because: string): JuliusFileCreationDecision =>
    ({ allowed: false, refusal, because });

  const raw = typeof request.path === 'string' ? request.path.trim() : '';
  if (raw === '') return refuse('path_empty', 'No path was requested.');

  // ABSOLUTE AND DRIVE-QUALIFIED FORMS ARE REFUSED BY SHAPE, before any prefix is
  // consulted. A workspace-relative decision cannot be made about `/etc/passwd`
  // by comparing prefixes, and a Windows `C:\` or a UNC `\\host\share` reaches a
  // different filesystem entirely.
  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return refuse('path_absolute', 'An absolute path is never workspace-relative; ask for a path inside the workspace.');
  }
  if (/^[A-Za-z]:/u.test(raw)) {
    return refuse('path_drive_qualified', 'A drive-qualified path names a filesystem the workspace does not control.');
  }

  const segments = segmentsOf(raw);
  if (segments.length === 0) return refuse('path_empty', 'The path had no usable segments.');
  if (segments.includes('..')) {
    return refuse('path_traversal', 'A path containing ".." can leave the workspace, whatever it resolves to today.');
  }
  const path = segments.join('/');

  for (const segment of segments) {
    if (CONTROL_SEGMENTS.includes(segment)) {
      return refuse('path_control_location', `"${segment}" holds control state, not deliverables; a write there is an action rather than a change.`);
    }
    if (CREDENTIAL_SEGMENTS.includes(segment)) {
      return refuse('path_credential_location', `"${segment}" is a credential location and is never a deliverable.`);
    }
  }
  const leaf = segments[segments.length - 1]!;
  if (CREDENTIAL_FILES.includes(leaf)) {
    return refuse('path_credential_location', `"${leaf}" is a credential file and is never a deliverable.`);
  }
  if (path.startsWith(WORKFLOW_PREFIX)) {
    return refuse('path_control_location', 'A workflow file is CI configuration; it changes what runs, and only an authorised human path may add one.');
  }

  // SCOPE. Out of scope wins over permitted, because the contract's exclusions are
  // the more specific statement.
  for (const prefix of policy.outOfScope) {
    if (isUnder(path, prefix)) {
      return refuse('path_out_of_scope', `"${path}" is under "${prefix}", which this mission's contract puts out of scope.`);
    }
  }
  if (!policy.permittedPaths.some((prefix) => isUnder(path, prefix))) {
    return refuse('path_not_permitted', `"${path}" is under none of the paths this dispatch was permitted to write.`);
  }

  if (!Number.isFinite(request.bytes) || request.bytes < 0) {
    return refuse('content_negative', 'A content size must be a non-negative number.');
  }
  if (request.bytes > policy.maxBytes) {
    return refuse('content_too_large', `${String(request.bytes)} bytes exceeds the ${String(policy.maxBytes)}-byte ceiling for a created file.`);
  }

  if (request.exists && !policy.mayOverwrite) {
    return refuse('overwrite_not_authorized', `"${path}" already exists and this dispatch may not replace an existing file.`);
  }

  return { allowed: true, path, overwrites: request.exists };
}
