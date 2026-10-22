import { createHash } from 'node:crypto';

/**
 * J1 BUNDLE STEP: the final judged message must BE the file the coder wrote, and the coder must have changed nothing else.
 * Pure functions over injected bytes and an injected file-system port: this file opens no file and spawns nothing.
 *
 * WHAT IS HASHED (M3 D1/D2). EVERYTHING under the workspace root: node_modules/ included, symlinks included (a link is recorded by its
 * TARGET, never followed). The only exclusion is a NAMED set that is EMPTY unless the caller passes `{ gitDir: '.git' }` for a repository
 * the bridge itself made; then `.git/` is not in the file list but has its OWN tree hash (`gitTreeSha256`), computed over every file in it
 * except the two names in {@link GIT_DIR_NAMED_EXCLUSIONS} (objects the bridge's own `git write-tree` adds, and the index git refreshes).
 * The exclusions in force are returned (`excluded`) and recorded with the lists. The full lists and their sha256 are returned for the ledger.
 */

/** The one file the coder writes. */
export const J1_ARTIFACT_FILE = 'out/normalized.json';
/** The failure class of a judged message that is not the file's bytes. */
export const J1_ARTIFACT_FILE_MISMATCH = 'artifact_file_mismatch';
/** The failure class of a workspace in which anything but the artifact file changed. */
export const J1_WORKSPACE_SCOPE_VIOLATION = 'workspace_scope_violation';
/** The ONLY names left out of the git tree hash when `gitDir` is set. Recorded with every snapshot. */
export const GIT_DIR_NAMED_EXCLUSIONS: readonly string[] = Object.freeze(['.git/objects/', '.git/index']);

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** TRIMMED bytes: UTF-8 decode (strict), String.trim (the same trim the controller applies to the coder's message), re-encode. */
export function trimmedBytes(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return new TextEncoder().encode(text.trim());
}

export interface BundleComparison {
  readonly ok: boolean;
  /** sha256 of the trimmed bytes of the final judged message. */
  readonly judgedSha256: string;
  /** sha256 of the trimmed bytes of the file; null when the file is absent or not valid UTF-8. */
  readonly fileSha256: string | null;
  readonly failureClass: typeof J1_ARTIFACT_FILE_MISMATCH | null;
}

/** Compares the final judged message with the bytes of out/normalized.json. Both hashes are returned either way, for the ledger. */
export function compareJudgedToFile(judgedMessage: string, fileBytes: Uint8Array | null): BundleComparison {
  const judgedSha256 = sha256(trimmedBytes(new TextEncoder().encode(judgedMessage)));
  let fileSha256: string | null = null;
  if (fileBytes !== null) { try { fileSha256 = sha256(trimmedBytes(fileBytes)); } catch { fileSha256 = null; } }
  const ok = fileSha256 !== null && fileSha256 === judgedSha256;
  return { ok, judgedSha256, fileSha256, failureClass: ok ? null : J1_ARTIFACT_FILE_MISMATCH };
}

/** One thing in the workspace. A symlink carries its target and is never followed; `special` is a socket, device or other non-file. */
export type WorkspaceEntry =
  | { readonly path: string; readonly kind: 'file' }
  | { readonly path: string; readonly kind: 'symlink'; readonly linkTarget: string }
  | { readonly path: string; readonly kind: 'special' };

/** The workspace as the bundle step sees it. The real one wraps node:fs (injected by the wiring); tests use a map. */
export interface WorkspaceFs {
  /** EVERY entry under the workspace root (relative, forward slashes), skipping nothing: .git and node_modules are listed. */
  listEntries(): Promise<readonly WorkspaceEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export type WorkspaceHashList = Readonly<Record<string, string>>;

export interface SnapshotOptions {
  /** '.git' = the bridge made a repository here: its files get their own tree hash instead of being in the list. Absent/null = nothing excluded. */
  readonly gitDir?: '.git' | null;
}

export interface WorkspaceSnapshot {
  /** path -> sha256 of the exact bytes; `symlink:<target>` for a link; `special:` for a non-file. */
  readonly files: WorkspaceHashList;
  /** sha256 of the canonical JSON of the sorted [path, hash] pairs of `files`. */
  readonly listSha256: string;
  /** Tree hash of the git directory (see the header), or null when no gitDir was named or none exists. */
  readonly gitTreeSha256: string | null;
  /** The named exclusions in force (empty unless gitDir was named). */
  readonly excluded: readonly string[];
}

const listHash = (files: WorkspaceHashList): string => sha256(JSON.stringify(Object.entries(files).sort()));

/** every path -> sha256 of its exact bytes (links by target). Nothing is skipped except the named, recorded git exclusions. */
export async function hashWorkspace(fs: WorkspaceFs, options: SnapshotOptions = {}): Promise<WorkspaceSnapshot> {
  const gitDir = options.gitDir ?? null;
  const out: Record<string, string> = {};
  const gitOut: Record<string, string> = {};
  let sawGit = false;
  const entries = [...(await fs.listEntries())].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const entry of entries) {
    const inGit = gitDir !== null && entry.path.startsWith(`${gitDir}/`);
    if (inGit) {
      sawGit = true;
      if (GIT_DIR_NAMED_EXCLUSIONS.some((ex) => (ex.endsWith('/') ? entry.path.startsWith(ex) : entry.path === ex))) continue;
    }
    const value = entry.kind === 'file' ? sha256(await fs.readFile(entry.path)) : entry.kind === 'symlink' ? `symlink:${entry.linkTarget}` : 'special:';
    if (inGit) gitOut[entry.path] = value; else out[entry.path] = value;
  }
  const files = Object.freeze(out);
  return Object.freeze({
    files, listSha256: listHash(files),
    gitTreeSha256: sawGit ? listHash(gitOut) : null,
    excluded: Object.freeze(gitDir === null ? [] : [...GIT_DIR_NAMED_EXCLUSIONS]),
  });
}

export interface WorkspaceDelta { readonly added: readonly string[]; readonly removed: readonly string[]; readonly modified: readonly string[]; readonly changed: readonly string[] }

export function diffWorkspaceHashes(before: WorkspaceHashList, after: WorkspaceHashList): WorkspaceDelta {
  const added = Object.keys(after).filter((p) => !(p in before)).sort();
  const removed = Object.keys(before).filter((p) => !(p in after)).sort();
  const modified = Object.keys(after).filter((p) => p in before && before[p] !== after[p]).sort();
  return { added, removed, modified, changed: [...new Set([...added, ...removed, ...modified])].sort() };
}

/** The marker in `changed` when the git directory's own tree hash moved. */
export const GIT_DIR_CHANGED_MARKER = '.git';

/**
 * True only when the artifact file was added or modified AS A REGULAR FILE and NOTHING else changed (no other add, removal or edit,
 * no symlink, and the git directory's own tree hash is unchanged).
 */
export function onlyArtifactChanged(before: WorkspaceSnapshot, after: WorkspaceSnapshot, artifactPath: string = J1_ARTIFACT_FILE): { readonly ok: boolean; readonly delta: WorkspaceDelta } {
  const base = diffWorkspaceHashes(before.files, after.files);
  const gitMoved = before.gitTreeSha256 !== after.gitTreeSha256;
  const delta: WorkspaceDelta = gitMoved ? { ...base, modified: [...base.modified, GIT_DIR_CHANGED_MARKER].sort(), changed: [...base.changed, GIT_DIR_CHANGED_MARKER].sort() } : base;
  const artifactValue = after.files[artifactPath];
  const regular = artifactValue !== undefined && !artifactValue.startsWith('symlink:') && !artifactValue.startsWith('special:');
  return { ok: regular && delta.changed.length === 1 && delta.changed[0] === artifactPath && delta.removed.length === 0, delta };
}

export interface BundleResult {
  readonly ok: boolean;
  readonly failureClass: string | null;
  readonly judgedSha256: string;
  readonly fileSha256: string | null;
  readonly changedPaths: readonly string[];
  /** D1: the FULL lists and their hashes, for the ledger / audit. */
  readonly beforeList: WorkspaceHashList;
  readonly afterList: WorkspaceHashList;
  readonly beforeListSha256: string;
  readonly afterListSha256: string;
  readonly gitTreeSha256Before: string | null;
  readonly gitTreeSha256After: string | null;
  /** D2: the named exclusions in force. */
  readonly excluded: readonly string[];
}

/** The whole step: scope first, then the file against the judged message. */
export function bundleStep(input: { readonly judgedMessage: string; readonly before: WorkspaceSnapshot; readonly after: WorkspaceSnapshot; readonly fileBytes: Uint8Array | null; readonly artifactPath?: string }): BundleResult {
  const scope = onlyArtifactChanged(input.before, input.after, input.artifactPath);
  const cmp = compareJudgedToFile(input.judgedMessage, input.fileBytes);
  const failureClass = !scope.ok ? J1_WORKSPACE_SCOPE_VIOLATION : cmp.failureClass;
  return {
    ok: failureClass === null, failureClass, judgedSha256: cmp.judgedSha256, fileSha256: cmp.fileSha256, changedPaths: scope.delta.changed,
    beforeList: input.before.files, afterList: input.after.files, beforeListSha256: input.before.listSha256, afterListSha256: input.after.listSha256,
    gitTreeSha256Before: input.before.gitTreeSha256, gitTreeSha256After: input.after.gitTreeSha256, excluded: input.after.excluded,
  };
}

/** A WorkspaceFs over an injected node:fs-like surface (readdir with file types, readlink, readFile). Construct-only: nothing is read until called. */
export interface LocalFsLike {
  readdirSync(path: string, options: { withFileTypes: true }): readonly { readonly name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[];
  readlinkSync(path: string): string;
  readFileSync(path: string): Uint8Array;
}

export function createLocalWorkspaceFs(root: string, fs: LocalFsLike): WorkspaceFs {
  const join = (a: string, b: string): string => (a === '' ? b : `${a}/${b}`);
  const walk = (rel: string, out: WorkspaceEntry[]): void => {
    for (const entry of fs.readdirSync(rel === '' ? root : `${root}/${rel}`, { withFileTypes: true })) {
      const path = join(rel, entry.name);
      /* A link is checked FIRST and never followed: a link to a directory is a link, not a directory. */
      if (entry.isSymbolicLink()) out.push({ path, kind: 'symlink', linkTarget: fs.readlinkSync(`${root}/${path}`) });
      else if (entry.isDirectory()) walk(path, out);
      else if (entry.isFile()) out.push({ path, kind: 'file' });
      else out.push({ path, kind: 'special' });
    }
  };
  return {
    async listEntries() { const out: WorkspaceEntry[] = []; walk('', out); return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); },
    async readFile(path) {
      if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('workspace_path_invalid');
      return fs.readFileSync(`${root}/${path}`);
    },
  };
}
