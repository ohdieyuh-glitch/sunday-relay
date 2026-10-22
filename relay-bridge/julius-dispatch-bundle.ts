import { createHash } from 'node:crypto';

/**
 * J1 BUNDLE STEP: the final judged message must BE the file the coder wrote, and the coder must have changed nothing else.
 * Pure functions over injected bytes and an injected file-system port: this file opens no file and spawns nothing.
 */

/** The one file the coder writes. */
export const J1_ARTIFACT_FILE = 'out/normalized.json';
/** The failure class of a judged message that is not the file's bytes. */
export const J1_ARTIFACT_FILE_MISMATCH = 'artifact_file_mismatch';
/** The failure class of a workspace in which anything but the artifact file changed. */
export const J1_WORKSPACE_SCOPE_VIOLATION = 'workspace_scope_violation';

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

/** The workspace as the bundle step sees it. The real one wraps node:fs (injected by the wiring); tests use a map. */
export interface WorkspaceFs {
  /** Every file path under the workspace root, relative, forward slashes. Excludes VCS and dependency directories. */
  listFiles(): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export type WorkspaceHashList = Readonly<Record<string, string>>;

/** every file path -> sha256 of its exact bytes. */
export async function hashWorkspace(fs: WorkspaceFs): Promise<WorkspaceHashList> {
  const out: Record<string, string> = {};
  for (const path of [...(await fs.listFiles())].sort()) out[path] = sha256(await fs.readFile(path));
  return Object.freeze(out);
}

export interface WorkspaceDelta { readonly added: readonly string[]; readonly removed: readonly string[]; readonly modified: readonly string[]; readonly changed: readonly string[] }

export function diffWorkspaceHashes(before: WorkspaceHashList, after: WorkspaceHashList): WorkspaceDelta {
  const added = Object.keys(after).filter((p) => !(p in before)).sort();
  const removed = Object.keys(before).filter((p) => !(p in after)).sort();
  const modified = Object.keys(after).filter((p) => p in before && before[p] !== after[p]).sort();
  return { added, removed, modified, changed: [...new Set([...added, ...removed, ...modified])].sort() };
}

/** True only when the artifact file was added or modified and NOTHING else changed (no other add, removal or edit). */
export function onlyArtifactChanged(before: WorkspaceHashList, after: WorkspaceHashList, artifactPath: string = J1_ARTIFACT_FILE): { readonly ok: boolean; readonly delta: WorkspaceDelta } {
  const delta = diffWorkspaceHashes(before, after);
  return { ok: delta.changed.length === 1 && delta.changed[0] === artifactPath && delta.removed.length === 0, delta };
}

export interface BundleResult {
  readonly ok: boolean;
  readonly failureClass: string | null;
  readonly judgedSha256: string;
  readonly fileSha256: string | null;
  readonly changedPaths: readonly string[];
}

/** The whole step: scope first, then the file against the judged message. */
export function bundleStep(input: { readonly judgedMessage: string; readonly before: WorkspaceHashList; readonly after: WorkspaceHashList; readonly fileBytes: Uint8Array | null; readonly artifactPath?: string }): BundleResult {
  const scope = onlyArtifactChanged(input.before, input.after, input.artifactPath);
  const cmp = compareJudgedToFile(input.judgedMessage, input.fileBytes);
  const failureClass = !scope.ok ? J1_WORKSPACE_SCOPE_VIOLATION : cmp.failureClass;
  return { ok: failureClass === null, failureClass, judgedSha256: cmp.judgedSha256, fileSha256: cmp.fileSha256, changedPaths: scope.delta.changed };
}

/** A WorkspaceFs over an injected node:fs-like surface (readdir with file types, readFile). Construct-only: nothing is read until called. */
export interface LocalFsLike {
  readdirSync(path: string, options: { withFileTypes: true }): readonly { readonly name: string; isDirectory(): boolean; isFile(): boolean }[];
  readFileSync(path: string): Uint8Array;
}
const SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);

export function createLocalWorkspaceFs(root: string, fs: LocalFsLike): WorkspaceFs {
  const join = (a: string, b: string): string => (a === '' ? b : `${a}/${b}`);
  const walk = (rel: string, out: string[]): void => {
    for (const entry of fs.readdirSync(rel === '' ? root : `${root}/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(join(rel, entry.name), out); } else if (entry.isFile()) out.push(join(rel, entry.name));
    }
  };
  return {
    async listFiles() { const out: string[] = []; walk('', out); return out.sort(); },
    async readFile(path) {
      if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('workspace_path_invalid');
      return fs.readFileSync(`${root}/${path}`);
    },
  };
}
