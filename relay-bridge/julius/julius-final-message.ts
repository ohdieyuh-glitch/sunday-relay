/**
 * THE CODER'S FINAL MESSAGE, KEPT FOR THE HIDDEN CHECKER.
 *
 * The paid workflow grades J1 on the coder's final message ("the final message
 * is the artifact that is checked"). The runtime parses that text and keeps
 * nothing else of it, so nothing could be graded. This module writes it once,
 * to a directory the workflow names in `JULIUS_FINAL_MESSAGE_DIR`, OUTSIDE the
 * coder's workspace:
 *
 *   <taskId>.raw.txt        the TRIMMED text, byte for byte, mode 0600. It is
 *                           graded and then deleted. It is never evidence.
 *   <taskId>.manifest.json  task, run, raw and trimmed sha256, byte length.
 *   <taskId>.redacted.json  the manifest plus the redacted text, capped at
 *                           8,000 characters (the contract's own cut), with
 *                           `truncated` and `alteredByRedaction` recorded.
 *                           This is the only copy that becomes evidence.
 *
 * Nothing in the runtime reads these files back. They are not work artifacts,
 * so the text can never reach a reviewer packet or a later prompt. Unset
 * directory: nothing is written, and the mission is exactly what it was.
 * A failure here never fails the mission: no record is an absent record, and
 * the grade step then reports NOT_RUN.
 */

import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { redactPayload } from '../redact';

export const JULIUS_FINAL_MESSAGE_SCHEMA = 'julius-final-message.v1';
/** The J1 contract cuts an artifact at 8,000 characters; the published copy keeps no more. */
export const JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS = 8_000;

const TASK_ID = /^[A-Za-z0-9:_-]{1,128}$/u;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface JuliusFinalMessageManifest {
  readonly schema: typeof JULIUS_FINAL_MESSAGE_SCHEMA;
  readonly taskId: string;
  readonly runId: string;
  readonly rawSha256: string;
  readonly trimmedSha256: string;
  readonly trimmedUtf8Bytes: number;
}

export type JuliusFinalMessageWrite =
  | { readonly written: true; readonly manifest: JuliusFinalMessageManifest }
  | { readonly written: false; readonly reason: 'no_directory' | 'no_text' | 'task_id_unsafe' | 'directory_unusable' | 'directory_inside_workspace' | 'write_failed' };

export interface JuliusFinalMessageFs {
  realpath(path: string): string;
  mkdir(path: string): void;
  writeExclusive(path: string, text: string, mode: number): void;
}

export const NODE_FINAL_MESSAGE_FS: JuliusFinalMessageFs = Object.freeze({
  realpath: (path: string) => realpathSync(path),
  mkdir: (path: string) => { mkdirSync(path, { recursive: true, mode: 0o700 }); },
  writeExclusive: (path: string, text: string, mode: number) => {
    // 'wx': a second write of the same task never replaces the first.
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
  readonly runId: string;
  readonly finalText: string | null;
  readonly fs?: JuliusFinalMessageFs;
}): JuliusFinalMessageWrite {
  const fs = input.fs ?? NODE_FINAL_MESSAGE_FS;
  if (typeof input.directory !== 'string' || input.directory.trim() === '') return { written: false, reason: 'no_directory' };
  if (input.finalText === null) return { written: false, reason: 'no_text' };
  if (!TASK_ID.test(input.taskId)) return { written: false, reason: 'task_id_unsafe' };
  const fileStem = input.taskId.replace(/:/gu, '_');
  let directory: string;
  let workspace: string;
  try {
    if (!isAbsolute(input.directory)) return { written: false, reason: 'directory_unusable' };
    fs.mkdir(input.directory);
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
    runId: input.runId,
    rawSha256: sha256(input.finalText),
    trimmedSha256: sha256(trimmed),
    trimmedUtf8Bytes: Buffer.byteLength(trimmed, 'utf8'),
  };
  const redacted = redactPayload(trimmed);
  const published = redacted.slice(0, JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS);
  try {
    fs.writeExclusive(join(directory, `${fileStem}.raw.txt`), trimmed, 0o600);
    fs.writeExclusive(join(directory, `${fileStem}.manifest.json`), `${JSON.stringify(manifest)}\n`, 0o600);
    fs.writeExclusive(join(directory, `${fileStem}.redacted.json`), `${JSON.stringify({
      ...manifest,
      truncated: redacted.length > JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS,
      alteredByRedaction: redacted !== trimmed,
      text: published,
    })}\n`, 0o600);
  } catch {
    return { written: false, reason: 'write_failed' };
  }
  return { written: true, manifest };
}
