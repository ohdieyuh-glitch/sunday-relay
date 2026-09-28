/**
 * WHAT A WORKSPACE-RELATIVE PATH IS, AND THE SHAPES THAT ARE NEVER ONE.
 *
 * WHY THIS EXISTS. Julius now lets a Coding Agent create files and routes every
 * file tool through its own authority (see `julius-file-creation.ts` and the
 * bridge's hosted tool authority). Every one of those decisions starts from the
 * same question -- is this a path INSIDE the workspace, spelled one way, that no
 * filesystem will quietly reinterpret? -- and a question answered in several
 * places is answered differently in at least one of them. This module is the one
 * answer.
 *
 * WHAT IT REFUSES, AND WHY EACH IS A SHAPE RATHER THAN A POLICY:
 *
 *   - absolute, home-relative and drive-qualified spellings: a workspace-relative
 *     decision cannot be made about `/etc/passwd`, `~/.ssh` or `C:\` by comparing
 *     prefixes;
 *   - `..` anywhere: whatever it resolves to today, it can leave the workspace;
 *   - control characters, and the characters Windows refuses in a name
 *     (`< > : " | ? *`): `file.txt:stream` is an NTFS alternate data stream, and
 *     a name only one platform can hold is not a deliverable;
 *   - a segment ending in `.` or a space: Windows strips both, so `.git.` IS
 *     `.git` there, and a decision about the spelling would not be a decision
 *     about the file;
 *   - reserved device names (`CON`, `NUL`, `COM1`...): on Windows they name a
 *     device, not a file, whatever the extension.
 *
 * AND WHERE A PATH LANDS, BY LOCATION. Control locations (`.git`, `.claude`,
 * hook directories) change what runs next; credential locations hold secrets;
 * workflow files change what CI runs. Every comparison is CASE-INSENSITIVE,
 * because the filesystems this runs on are not all case-sensitive: on Windows
 * and macOS `.GIT/hooks/pre-commit` is the real hook, and a case-sensitive check
 * would have waved it through.
 *
 * PURE. No Node, no clock, no network, no filesystem. Whether a path EXISTS, or
 * where a symlink points, is observed by the caller and never guessed here.
 */

export type JuliusPathRefusal =
  | 'path_empty'
  | 'path_absolute'
  | 'path_drive_qualified'
  | 'path_traversal'
  | 'path_invalid_character'
  | 'path_ambiguous_segment'
  | 'path_reserved_name'
  | 'path_too_long';

/** Bounds on a path's spelling. Generous for any real repository; a path longer than this is not a deliverable. */
export const JULIUS_PATH_LIMITS = Object.freeze({
  chars: 1_024,
  segmentChars: 255,
  segments: 64,
});

export type JuliusRelativePath =
  | { readonly ok: true; readonly path: string; readonly segments: readonly string[] }
  | { readonly ok: false; readonly refusal: JuliusPathRefusal; readonly because: string };

/** Characters Windows refuses in a name. `:` is the alternate-data-stream separator as well. */
const PORTABILITY_HOSTILE = /[<>:"|?*]/u;
/** C0 controls and DEL. A NUL truncates a path in every C API underneath us. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
/** Windows device names, matched on the stem before the first dot, case-insensitively. */
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/iu;

/**
 * The one spelling of a workspace-relative path, or a NAMED refusal.
 *
 * Separators are normalised to `/` and `.` segments dropped; nothing else is
 * changed -- in particular the case is kept, because the file on a
 * case-sensitive filesystem is the one with that case.
 */
export function juliusWorkspaceRelativePath(raw: unknown): JuliusRelativePath {
  const refuse = (refusal: JuliusPathRefusal, because: string): JuliusRelativePath =>
    ({ ok: false, refusal, because });

  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return refuse('path_empty', 'No path was given.');
  if (text.length > JULIUS_PATH_LIMITS.chars) {
    return refuse('path_too_long', `A path longer than ${String(JULIUS_PATH_LIMITS.chars)} characters is not a deliverable.`);
  }
  if (CONTROL_CHARACTER.test(text)) {
    return refuse('path_invalid_character', 'A path may not contain control characters.');
  }
  if (text.startsWith('/') || text.startsWith('\\')) {
    return refuse('path_absolute', 'An absolute path is never workspace-relative; use a path inside the workspace.');
  }
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    return refuse('path_absolute', 'A home-relative path names a location outside the workspace.');
  }
  if (/^[A-Za-z]:/u.test(text)) {
    return refuse('path_drive_qualified', 'A drive-qualified path names a filesystem the workspace does not control.');
  }
  if (PORTABILITY_HOSTILE.test(text)) {
    return refuse('path_invalid_character', 'A path may not contain < > : " | ? * -- ":" also opens an alternate data stream on Windows.');
  }

  const segments = text.split(/[\\/]+/u).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return refuse('path_empty', 'The path had no usable segments.');
  if (segments.includes('..')) {
    return refuse('path_traversal', 'A path containing ".." can leave the workspace, whatever it resolves to today.');
  }
  if (segments.length > JULIUS_PATH_LIMITS.segments) {
    return refuse('path_too_long', `A path deeper than ${String(JULIUS_PATH_LIMITS.segments)} segments is not a deliverable.`);
  }
  for (const segment of segments) {
    if (segment.length > JULIUS_PATH_LIMITS.segmentChars) {
      return refuse('path_too_long', `A path segment longer than ${String(JULIUS_PATH_LIMITS.segmentChars)} characters is refused.`);
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return refuse('path_ambiguous_segment', `"${segment}" ends in a dot or a space, which Windows strips -- it would name a different file there.`);
    }
    const stem = segment.split('.')[0] ?? segment;
    if (RESERVED_STEM.test(stem)) {
      return refuse('path_reserved_name', `"${segment}" is a reserved device name on Windows, not a file.`);
    }
  }
  return { ok: true, path: segments.join('/'), segments: Object.freeze(segments) };
}

/* ------------------------------------------------------------ locations */

export type JuliusPathLocation =
  | { readonly kind: 'ordinary' }
  | { readonly kind: 'control' | 'credential' | 'workflow'; readonly because: string };

/**
 * DIRECTORIES WHOSE CONTENTS ARE NOT SOURCE, AND WHERE A WRITE IS AN ACTION.
 *
 * `.git` first: a file in `.git/hooks`, or a line in `.git/config`
 * (`core.fsmonitor`, `core.hooksPath`), is code the next git command runs -- and
 * Julius's own executor runs git in this workspace to take the attempt's
 * snapshot. `.claude` holds settings and hooks a later Claude Code session in
 * this repository would load. `.husky` and `.githooks` are hook directories by
 * convention. `.julius` is the harness the mission's own check loads.
 * `node_modules` is not dangerous so much as never a deliverable.
 */
const CONTROL_SEGMENTS: readonly string[] = Object.freeze([
  '.git', '.julius', '.claude', '.husky', '.githooks', '.hg', '.svn', '.bzr', 'node_modules',
]);

/** Files that EXECUTE on someone's behalf, wherever they sit: direnv runs `.envrc` on entering the directory. */
const CONTROL_FILES: readonly string[] = Object.freeze(['.envrc']);

/** Directories that hold credentials. */
const CREDENTIAL_SEGMENTS: readonly string[] = Object.freeze([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config',
]);

/** Files that hold credentials, wherever they sit. */
const CREDENTIAL_FILES: readonly string[] = Object.freeze([
  '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '_netrc', '.pypirc', '.git-credentials', 'credentials',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
]);

/**
 * `.env` holds secrets by convention; `.env.production` and friends too. The
 * shapes that are DOCUMENTATION of an environment -- `.env.example`, `.sample`,
 * `.template`, `.dist` -- are ordinary files a mission may well be asked to write.
 */
const ENV_FILE = /^\.env(\..+)?$/iu;
const ENV_DOCUMENTATION = /^\.env\.(example|sample|template|dist)$/iu;

/**
 * Where a normalised workspace-relative path lands. Takes the SEGMENTS
 * {@link juliusWorkspaceRelativePath} produced, so a caller cannot classify a
 * spelling it never normalised.
 */
export function juliusPathLocation(segments: readonly string[]): JuliusPathLocation {
  const lower = segments.map((segment) => segment.toLowerCase());
  for (const segment of lower) {
    if (CONTROL_SEGMENTS.includes(segment)) {
      return { kind: 'control', because: `"${segment}" holds control state, not deliverables; a write there is an action rather than a change.` };
    }
    if (CREDENTIAL_SEGMENTS.includes(segment)) {
      return { kind: 'credential', because: `"${segment}" is a credential location and is never a deliverable.` };
    }
  }
  const leaf = lower[lower.length - 1] ?? '';
  if (CONTROL_FILES.includes(leaf)) {
    return { kind: 'control', because: `"${leaf}" is executed on someone's behalf; a write there is an action rather than a change.` };
  }
  if (CREDENTIAL_FILES.includes(leaf) || (ENV_FILE.test(leaf) && !ENV_DOCUMENTATION.test(leaf))) {
    return { kind: 'credential', because: `"${leaf}" is a credential file and is never a deliverable.` };
  }
  // The directory itself counts, not only the files in it: a GRANT naming
  // `.github/workflows` as a prefix is as much a workflow authority as a file there.
  if (lower.length >= 2 && lower[0] === '.github' && lower[1] === 'workflows') {
    return { kind: 'workflow', because: 'A workflow file is CI configuration; it changes what runs, and only an authorised human path may add or change one.' };
  }
  return { kind: 'ordinary' };
}

/* ---------------------------------------------------------------- scope */

/**
 * `a/b` is under `a` and under `a/`; `ab` is not under `a`. Case-sensitive,
 * because a scope is a statement about the repository's own spelling -- the
 * case-insensitive comparison above is for locations that are DANGEROUS under
 * any spelling, which a scope is not.
 */
export function juliusPathIsUnder(path: string, prefix: string): boolean {
  const clean = prefix.split(/[\\/]+/u).filter((segment) => segment !== '' && segment !== '.').join('/');
  if (clean === '') return false;
  return path === clean || path.startsWith(`${clean}/`);
}
