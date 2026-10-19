import {
  closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Crash-safe file primitives (Prompt 8.5). Snapshot/metadata/index writes go
 * through temp-file + fsync + atomic rename with restrictive permissions;
 * journal appends go through fd write + fsync so a torn tail is at most one
 * partial final line (which the reader handles explicitly). The only
 * known-good copy of a file is never overwritten in place.
 */

let tmpCounter = 0;

export function writeFileAtomic(filePath: string, data: string, mode = 0o600): void {
  const tmpPath = `${filePath}.tmp-${process.pid}-${(tmpCounter += 1)}`;
  const fd = openSync(tmpPath, 'w', mode);
  try {
    writeSync(fd, data, null, 'utf8');
    try { fsyncSync(fd); } catch { /* flush unsupported on this platform/fs */ }
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
  fsyncDirBestEffort(dirname(filePath));
}

/** Durable append (journal lines). Returns after the line is flushed. */
export function appendLineDurable(filePath: string, line: string, mode = 0o600): void {
  const fd = openSync(filePath, 'a', mode);
  try {
    writeSync(fd, `${line}\n`, null, 'utf8');
    try { fsyncSync(fd); } catch { /* flush unsupported */ }
  } finally {
    closeSync(fd);
  }
}

export function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = openSync(dirPath, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* directory fsync unsupported — best effort */ }
}

export function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

export function removeIfExists(filePath: string): void {
  try { unlinkSync(filePath); } catch { /* already gone */ }
}
