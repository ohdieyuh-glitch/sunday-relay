/**
 * Durable Looking for Feed snapshot.
 *
 * Same two habits as the mission store: `writeFileAtomic` (temp file, fsync,
 * rename) and a previous file so a torn write is not the only copy. A snapshot
 * that does not parse is corrupt. It is not loaded as an empty board, and it
 * is not overwritten while it is the only copy.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { readTextIfExists, writeFileAtomic } from './atomic-file';
import {
  parseLffBoardSnapshot,
  type LffBoardSnapshot,
  type LffBoardStore,
  type LffStoreLoad,
} from '../mission/wonderland/wonderland-lff';

export function createWonderlandLffFileStore(options: { readonly root: string }): LffBoardStore {
  const root = resolve(options.root);
  const dir = join(root, 'wonderland-lff');
  const current = join(dir, 'board.json');
  const previous = join(dir, 'board.previous.json');

  const contained = (file: string): void => {
    const resolved = resolve(file);
    if (!isAbsolute(root) || (resolved !== dir && !resolved.startsWith(dir + sep))) {
      throw new Error('lff store path escaped its directory');
    }
  };

  const readSnapshot = (file: string): LffBoardSnapshot | null => {
    const text = readTextIfExists(file);
    if (text === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return null; }
    return parseLffBoardSnapshot(parsed);
  };

  return {
    load(): LffStoreLoad {
      contained(current);
      contained(previous);
      const currentText = readTextIfExists(current);
      if (currentText !== null) {
        let parsed: unknown;
        try { parsed = JSON.parse(currentText); } catch { parsed = null; }
        const snapshot = parseLffBoardSnapshot(parsed);
        if (snapshot !== null) return { status: 'ok', snapshot };
      }
      const previousSnapshot = readSnapshot(previous);
      if (previousSnapshot !== null) return { status: 'ok', snapshot: previousSnapshot };
      if (currentText === null && readTextIfExists(previous) === null) return { status: 'empty' };
      return { status: 'corrupt', reason: 'lff board snapshot is not valid' };
    },

    save(snapshot: LffBoardSnapshot): void {
      contained(current);
      contained(previous);
      const data = JSON.stringify(snapshot);
      mkdirSync(dir, { recursive: true });
      if (existsSync(current)) {
        const currentSnapshot = readSnapshot(current);
        if (currentSnapshot === null) {
          if (readSnapshot(previous) === null) throw new Error('lff store is corrupt');
          writeFileAtomic(current, data);
          return;
        }
        renameSync(current, previous);
      }
      writeFileAtomic(current, data);
    },
  };
}
