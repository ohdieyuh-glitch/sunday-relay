import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  INWORLD_PIN_FILES,
  J1_PINNED_CHECKER_FILE_SHA256,
  J1_PINNED_CHECKER_SHA256,
  J1_PINNED_CONTRACT_SHA256,
  J1_PINNED_ORACLE_SHA256,
  pinInworldFiles,
} from './julius-inworld-checker';

/**
 * THE PAID WORKFLOW'S COPY OF J1. `julius-first-live-mission.yml` runs
 * `.github/julius-missions/<mission>/contract.json` and seeds the coder from that
 * mission's `workspace/` (a mission with both `workspace/` and `slice.txt` is
 * refused). The pinned originals stay under `relay-bridge/julius-inworld-mission/`,
 * beside the hidden checker. This copy must be the pinned bytes, and nothing of
 * the checker may reach it.
 */
const MISSION_DIR = join('.github', 'julius-missions', 'julius-inworld-data-1');
const SEED_DIR = join(MISSION_DIR, 'workspace');
const PINNED_DIR = join('relay-bridge', 'julius-inworld-mission', 'julius-inworld-data-1');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

describe('the paid workflow copy of julius-inworld-data-1', () => {
  it('is exactly the contract and a workspace seed, with no slice and no dry run', () => {
    expect(filesUnder(MISSION_DIR)).toEqual([
      'contract.json',
      'workspace/data/legacy_ledger.csv',
      'workspace/data/posts.json',
      'workspace/format.test.mjs',
    ]);
    expect(existsSync(join(MISSION_DIR, 'slice.txt'))).toBe(false);
  });

  it('seeds the coder with the two data files and the shape check only, and no out/ placeholder', () => {
    expect(filesUnder(SEED_DIR)).toEqual(['data/legacy_ledger.csv', 'data/posts.json', 'format.test.mjs']);
    expect(existsSync(join(SEED_DIR, 'out'))).toBe(false);
  });

  it('carries the pinned contract bytes', () => {
    expect(sha256(readFileSync(join(MISSION_DIR, 'contract.json')))).toBe(J1_PINNED_CONTRACT_SHA256);
  });

  it('carries the pinned seed bytes: the combined pin holds with the seed read from this copy', () => {
    const fromCopy: Record<string, string> = {
      'contract.json': join(MISSION_DIR, 'contract.json'),
      'seed/data/legacy_ledger.csv': join(SEED_DIR, 'data', 'legacy_ledger.csv'),
      'seed/data/posts.json': join(SEED_DIR, 'data', 'posts.json'),
    };
    const entries = INWORLD_PIN_FILES.map((name) => [name, readFileSync(fromCopy[name] ?? join(PINNED_DIR, name))] as const);
    expect(pinInworldFiles(entries)).toBe(J1_PINNED_CHECKER_SHA256);
    expect(readFileSync(join(SEED_DIR, 'format.test.mjs'))).toEqual(readFileSync(join(PINNED_DIR, 'seed', 'format.test.mjs')));
  });

  it('holds no checker or oracle bytes, and no file that names them', () => {
    expect(sha256(readFileSync(join(PINNED_DIR, 'checker', 'check.mjs')))).toBe(J1_PINNED_CHECKER_FILE_SHA256);
    expect(sha256(readFileSync(join(PINNED_DIR, 'checker', 'oracle.mjs')))).toBe(J1_PINNED_ORACLE_SHA256);
    for (const file of filesUnder(MISSION_DIR)) {
      const bytes = readFileSync(join(MISSION_DIR, file));
      expect(sha256(bytes), file).not.toBe(J1_PINNED_CHECKER_FILE_SHA256);
      expect(sha256(bytes), file).not.toBe(J1_PINNED_ORACLE_SHA256);
      const text = bytes.toString('utf8');
      expect(text, file).not.toContain('HIDDEN DETERMINISTIC CHECKER');
      expect(text, file).not.toContain('REFERENCE IMPLEMENTATION');
      expect(text, file).not.toContain('julius-inworld-mission/');
    }
  });
});
