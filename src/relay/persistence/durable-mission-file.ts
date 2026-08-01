import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readTextIfExists, writeFileAtomic } from './atomic-file';
import {
  createDurableMissionStore,
  type DurableKeyValueBacking,
  type DurableMissionStorePort,
} from '../mission/durable';
import {
  createMissionWorktreeStore,
  type MissionWorktreeStorePort,
} from '../mission/worktree';

/**
 * THE NODE DURABLE-MISSION ADAPTER.
 *
 * The same canonical record the browser writes, stored as one file per
 * mission under the existing application state root — never in the Git work
 * tree. Writes reuse `writeFileAtomic` (temp file → fsync → rename, 0o600),
 * which is why a crashed or failed write can never leave a half-written
 * record presented as valid.
 *
 * KEEPING THE LAST KNOWN-GOOD CHECKPOINT: before a record is replaced, the
 * current file is copied aside as `<mission>.previous.json`. If the new write
 * throws, the previous file is still intact AND the current file is still the
 * old one (rename is atomic — it either happened or it did not). A reader
 * that finds a corrupt current record can fall back explicitly, which is a
 * decision the recovery layer makes visibly rather than silently.
 *
 * This module is Node-only and lives beside the journal layer on purpose:
 * the website may never import it (a structural boundary test proves that),
 * and it may never import the website.
 */

export const DURABLE_MISSIONS_DIR = 'durable-missions';

const fileName = (key: string): string => `${encodeURIComponent(key)}.json`;
const previousName = (key: string): string => `${encodeURIComponent(key)}.previous.json`;

/** Filesystem backing for the shared durable-mission store. */
export function createNodeDurableBacking(root: string): DurableKeyValueBacking {
  const dir = join(root, DURABLE_MISSIONS_DIR);
  const ensureDir = (): void => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  };

  return {
    durability: 'durable',
    locationLabel: dir,

    async getText(key) {
      ensureDir();
      return readTextIfExists(join(dir, fileName(key)));
    },

    async putText(key, value) {
      ensureDir();
      const target = join(dir, fileName(key));
      // Retain the last known-good copy BEFORE replacing it.
      if (existsSync(target)) {
        try {
          renameSync(target, join(dir, previousName(key)));
        } catch {
          /* keeping a spare is best-effort; the atomic write below still
             either fully succeeds or leaves the original untouched */
        }
      }
      writeFileAtomic(target, value);
    },

    async deleteKey(key) {
      ensureDir();
      try {
        unlinkSync(join(dir, fileName(key)));
      } catch {
        /* already gone */
      }
    },

    async listKeys() {
      ensureDir();
      return readdirSync(dir)
        .filter((name) => name.endsWith('.json') && !name.endsWith('.previous.json'))
        .map((name) => decodeURIComponent(name.slice(0, -'.json'.length)));
    },
  };
}

export function createNodeDurableMissionStore(root: string): DurableMissionStorePort {
  return createDurableMissionStore(createNodeDurableBacking(root));
}

/**
 * The mission-worktree store over the SAME backing. Worktree records use a
 * different key prefix, so both live in one directory with one set of atomic
 * write and retention rules — not two competing stores.
 */
export function createNodeMissionWorktreeStore(root: string): MissionWorktreeStorePort {
  return createMissionWorktreeStore(createNodeDurableBacking(root));
}

/** The retained previous checkpoint, when one exists. Recovery offers this
    explicitly; nothing falls back to it silently. */
export function readPreviousDurableRecordText(root: string, missionId: string): string | null {
  return readTextIfExists(join(root, DURABLE_MISSIONS_DIR, previousName(`mission:${missionId}`)));
}
