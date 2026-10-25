/**
 * THE CODER'S FINAL MESSAGE, KEPT FOR THE HIDDEN CHECKER.
 *
 * The paid workflow grades J1 on the coder's final message ("the final message
 * is the artifact that is checked"). The runtime parses that text and keeps
 * nothing else of it, so nothing could be graded. The paid Coding Agent
 * provider writes it once per dispatch, to the directory the workflow made
 * for it (`JULIUS_FINAL_MESSAGE_DIR`, a fresh `mktemp -d` OUTSIDE the coder's
 * workspace), keyed by task AND dispatch context, so a re-leased task never
 * reuses a superseded dispatch's text:
 *
 *   <task>.<context>.raw.txt        the TRIMMED text, byte for byte, mode 0600.
 *                                   Graded and then deleted. Never evidence.
 *   <task>.<context>.manifest.json  task, context, run, trimmed sha256, bytes.
 *   <task>.<context>.redacted.json  the manifest plus the redacted text, capped
 *                                   at 8,000 characters (the contract's own cut),
 *                                   with `truncated` and `alteredByRedaction`.
 *                                   The only copy that becomes evidence.
 *
 * The trimmed sha256 and the context id are ALSO recorded on the dispatch's
 * durable diagnostics (`diag_finalMessageSha256`, `diag_finalMessageContextId`),
 * so the grader matches the file to the run's own record rather than to a
 * manifest written beside it.
 *
 * Nothing in the runtime reads these files back. They are not work artifacts,
 * so the text can never reach a reviewer packet or a later prompt. No directory:
 * nothing is written. A failure never fails the mission: no record is an absent
 * record, and the grade job reports NOT_RUN.
 */

import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { redactPayload } from '../redact';

export const JULIUS_FINAL_MESSAGE_SCHEMA = 'julius-final-message.v2';
/** The J1 contract cuts an artifact at 8,000 characters; the published copy keeps no more. */
export const JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS = 8_000;

const ID = /^[A-Za-z0-9:_-]{1,128}$/u;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The file stem for a task and dispatch context: ids with `:` spelled `_`, joined by `.`. */
export function juliusFinalMessageStem(taskId: string, contextId: string): string {
  return `${taskId.replace(/:/gu, '_')}.${contextId.replace(/:/gu, '_')}`;
}

export interface JuliusFinalMessageManifest {
  readonly schema: typeof JULIUS_FINAL_MESSAGE_SCHEMA;
  readonly taskId: string;
  readonly contextId: string;
  readonly runId: string;
  readonly trimmedSha256: string;
  readonly trimmedUtf8Bytes: number;
}

export type JuliusFinalMessageWrite =
  | { readonly written: true; readonly manifest: JuliusFinalMessageManifest }
  | { readonly written: false; readonly reason: 'no_directory' | 'no_text' | 'id_unsafe' | 'directory_unusable' | 'directory_inside_workspace' | 'write_failed' };

export interface JuliusFinalMessageFs {
  /** lstat of the directory itself: a symlink is refused, never followed. */
  inspectDirectory(path: string): { readonly isDirectory: boolean; readonly isSymlink: boolean; readonly mode: number; readonly uid: number };
  realpath(path: string): string;
  writeExclusive(path: string, text: string, mode: number): void;
}

export const NODE_FINAL_MESSAGE_FS: JuliusFinalMessageFs = Object.freeze({
  inspectDirectory: (path: string) => {
    const stat = lstatSync(path);
    return { isDirectory: stat.isDirectory(), isSymlink: stat.isSymbolicLink(), mode: stat.mode, uid: stat.uid };
  },
  realpath: (path: string) => realpathSync(path),
  writeExclusive: (path: string, text: string, mode: number) => {
    // 'wx': a write never replaces an existing file.
    const fd = openSync(path, 'wx', mode);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  },
});

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[0] !== '..');
}

export function writeJuliusFinalMessage(input: {
  readonly directory: string | null | undefined;
  readonly workspacePath: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly runId: string;
  readonly finalText: string | null;
  readonly fs?: JuliusFinalMessageFs;
  /** The process's uid; injected in tests. Null where the platform has none. */
  readonly uid?: number | null;
}): JuliusFinalMessageWrite {
  const fs = input.fs ?? NODE_FINAL_MESSAGE_FS;
  if (typeof input.directory !== 'string' || input.directory.trim() === '') return { written: false, reason: 'no_directory' };
  if (input.finalText === null) return { written: false, reason: 'no_text' };
  if (!ID.test(input.taskId) || !ID.test(input.contextId)) return { written: false, reason: 'id_unsafe' };
  let directory: string;
  let workspace: string;
  try {
    if (!isAbsolute(input.directory)) return { written: false, reason: 'directory_unusable' };
    // The workflow made this directory. It is not created here, and it must be a real directory
    // this process owns that nobody else may write: a symlink or a shared directory is refused.
    const seen = fs.inspectDirectory(input.directory);
    const uid = input.uid === undefined ? (typeof process.getuid === 'function' ? process.getuid() : null) : input.uid;
    if (!seen.isDirectory || seen.isSymlink) return { written: false, reason: 'directory_unusable' };
    if (uid !== null && (seen.uid !== uid || (seen.mode & 0o022) !== 0)) return { written: false, reason: 'directory_unusable' };
    directory = fs.realpath(input.directory);
    workspace = fs.realpath(input.workspacePath);
  } catch {
    return { written: false, reason: 'directory_unusable' };
  }
  if (inside(directory, workspace) || inside(workspace, directory)) return { written: false, reason: 'directory_inside_workspace' };

  const trimmed = input.finalText.trim();
  const manifest: JuliusFinalMessageManifest = {
    schema: JULIUS_FINAL_MESSAGE_SCHEMA,
    taskId: input.taskId,
    contextId: input.contextId,
    runId: input.runId,
    trimmedSha256: sha256(trimmed),
    trimmedUtf8Bytes: Buffer.byteLength(trimmed, 'utf8'),
  };
  const redacted = redactPayload(trimmed);
  const stem = juliusFinalMessageStem(input.taskId, input.contextId);
  try {
    fs.writeExclusive(join(directory, `${stem}.raw.txt`), trimmed, 0o600);
    fs.writeExclusive(join(directory, `${stem}.manifest.json`), `${JSON.stringify(manifest)}\n`, 0o600);
    fs.writeExclusive(join(directory, `${stem}.redacted.json`), `${JSON.stringify({
      ...manifest,
      truncated: redacted.length > JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS,
      alteredByRedaction: redacted !== trimmed,
      text: redacted.slice(0, JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS),
    })}\n`, 0o600);
  } catch {
    return { written: false, reason: 'write_failed' };
  }
  return { written: true, manifest };
}
