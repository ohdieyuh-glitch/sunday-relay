import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { validateMissionConfig, type RelayMissionConfig } from '../mission/mission-config';

/**
 * SAVED PROJECT SETTINGS PROFILES (PSP V1) — durable, participant-owned config.
 *
 * A PSP is exactly the {@link RelayMissionConfig} a Mission runs under (role
 * selections, mode, verification/review policy, permissions, spend/compute
 * limits), saved under a name so a user can SELECT one instead of re-entering it.
 * It is CONFIGURATION, never a second Mission engine — loading a PSP only fills
 * in the config a Mission start already accepts.
 *
 * OWNED BY A PARTICIPANT. One directory per owner, one file per PSP, so a user
 * only ever lists or loads their own — the store never returns a PSP across
 * owners. Absent is empty (not a crash); a corrupt or tampered file is SKIPPED
 * on read, and its config is re-validated so a hand-edited limit can never load
 * as a live ceiling. Writes are atomic (tmp + rename) and path-contained.
 */

export interface SavedPsp {
  readonly pspId: string;
  readonly name: string;
  /** The participant who owns this PSP (e.g. `ghu-<github-id>`). */
  readonly ownerParticipant: string;
  readonly config: RelayMissionConfig;
  readonly updatedAt: string;
}

export interface PspConfigStore {
  /** Create or overwrite a PSP. The caller supplies an already-validated config. */
  save(psp: SavedPsp): void;
  /** One PSP by owner + id, or null (absent, unreadable, corrupt, or wrong owner). */
  load(ownerParticipant: string, pspId: string): SavedPsp | null;
  /** Every PSP this participant owns, newest name-sorted; empty when none. */
  list(ownerParticipant: string): readonly SavedPsp[];
}

/** Ids and owners are used as path segments; keep them filesystem-safe. */
const PSP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function createPspConfigStore(options: { readonly root: string }): PspConfigStore {
  const resolvedRoot = resolve(options.root);
  const baseDir = join(resolvedRoot, 'psp-configs');

  const ownerDir = (owner: string): string | null => {
    if (!PSP_ID.test(owner)) return null;
    const dir = join(baseDir, encodeURIComponent(owner));
    const resolved = resolve(dir);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) return null;
    return resolved;
  };

  const pathFor = (owner: string, pspId: string): string | null => {
    if (!PSP_ID.test(pspId)) return null;
    const dir = ownerDir(owner);
    if (dir === null) return null;
    const file = join(dir, `${encodeURIComponent(pspId)}.json`);
    const resolved = resolve(file);
    if (!resolved.startsWith(dir + sep)) return null;
    return resolved;
  };

  /** Parse + validate one file into a SavedPsp, or null on any doubt. The stored
   *  config is re-validated so a tampered ceiling never loads as enforceable, and
   *  the record's own owner must match the directory it was read from. */
  const readOne = (path: string, expectedOwner: string): SavedPsp | null => {
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); } catch { return null; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Partial<SavedPsp>;
    if (typeof record.pspId !== 'string' || typeof record.name !== 'string'
      || record.ownerParticipant !== expectedOwner || typeof record.updatedAt !== 'string') {
      return null;
    }
    const config = validateMissionConfig(record.config);
    if (!config.ok) return null; // a config that no longer validates is not loadable
    return {
      pspId: record.pspId,
      name: record.name,
      ownerParticipant: record.ownerParticipant,
      config: config.value,
      updatedAt: record.updatedAt,
    };
  };

  return {
    save(psp) {
      if (!isAbsolute(resolvedRoot)) return;
      const dir = ownerDir(psp.ownerParticipant);
      const path = pathFor(psp.ownerParticipant, psp.pspId);
      if (dir === null || path === null) return;
      mkdirSync(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(psp), 'utf8');
      renameSync(tmp, path);
    },

    load(ownerParticipant, pspId) {
      const path = pathFor(ownerParticipant, pspId);
      if (path === null) return null;
      return readOne(path, ownerParticipant);
    },

    list(ownerParticipant) {
      const dir = ownerDir(ownerParticipant);
      if (dir === null) return [];
      let names: string[];
      try { names = readdirSync(dir); } catch { return []; } // absent → empty
      const out: SavedPsp[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const psp = readOne(join(dir, name), ownerParticipant);
        if (psp !== null) out.push(psp);
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
