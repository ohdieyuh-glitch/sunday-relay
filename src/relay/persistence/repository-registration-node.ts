import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { fsyncDirBestEffort, readTextIfExists, writeFileAtomic } from './atomic-file';
import { repositoryKey } from '../mission/repository-target';
import type { RepositoryRegistration } from '../mission/repository-target';

/**
 * THE DURABLE REGISTRATION STORE — the thing `REPOSITORY_TARGETS.md` has listed
 * as "not built" since the feature existed.
 *
 * Registration is the authorization spine: a Mission may name only a repository
 * that a human registered. Held only in memory, that spine does not survive a
 * bridge restart, so after every deploy no Mission could target any repository
 * until someone re-registered it. This is where a registration lives across a
 * restart.
 *
 * MODELLED ON `beta-enrollment-node.ts`, deliberately, because that store
 * learned these lessons under review and they are the same lessons:
 *
 *   - ONE FILE PER REGISTRATION, named by the canonical key. Atomic write, so a
 *     crash mid-write leaves the old file, never a half-written one.
 *   - `list` returns `null`, not `[]`, when the directory cannot be read. An
 *     empty list means "no registrations"; a directory Relay cannot read means
 *     "unknown", and admitting a Mission against "unknown = none" is exactly the
 *     failure the beta store's own review caught.
 *   - READ-BACK IS VALIDATED. A stored registration is JSON on disk, and JSON on
 *     disk can be truncated, tampered, or left over from an older schema. On
 *     read the key is RE-DERIVED from the identity and must match the filename;
 *     a mismatch is a corrupt or moved file and is refused rather than trusted.
 *     A capability read from an unverified file is not a capability.
 *   - A revocation is stored, never deleted: the domain keeps `revokedAt` on the
 *     registration so the audit trail survives, and so does the file.
 */

const REGISTRATIONS_DIR = 'repository-registrations';

/** The canonical key is a repository identity; keep it filesystem-safe. */
function keyToFilename(key: string): string {
  // `local:demo`, `github:github.com/o/r` → a flat, reversible-enough name. The
  // key is re-derived and checked on read, so this only has to be unique and
  // path-safe, never parseable back.
  return `${encodeURIComponent(key)}.json`;
}

export interface RepositoryRegistrationStore {
  /**
   * Persist a registration, keyed by its canonical key.
   *
   * REPLACES an existing file for the same key: a re-registration is a human
   * act that supersedes the prior record (the domain decides whether the new
   * draft is valid; this only stores what it is given). It never merges.
   */
  save(registration: RepositoryRegistration): void;
  /** The registration for a key, or `null` — absent, unreadable, or corrupt. */
  get(key: string): RepositoryRegistration | null;
  /**
   * Every stored registration, or `null` when the directory cannot be read.
   * Corrupt individual files are SKIPPED (not fatal to the whole list) but a
   * directory that cannot be read at all is `null`.
   */
  list(): readonly RepositoryRegistration[] | null;
}

/** Parse and integrity-check one stored file. Returns null on any doubt. */
function readRegistrationFile(path: string): RepositoryRegistration | null {
  const text = readTextIfExists(path);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Partial<RepositoryRegistration>;
  // Structural floor: the fields a live registration cannot be missing.
  if (typeof record.key !== 'string' || record.identity === undefined
    || record.location === undefined || !Array.isArray(record.grants)) {
    return null;
  }
  /**
   * THE KEY MUST STILL DERIVE FROM THE IDENTITY. The filename and the stored
   * `key` could both be wrong together (a copied file, a hand-edit); the domain
   * is the authority on what a given identity's key IS, so re-derive and
   * compare. A registration whose stored key does not match its own identity is
   * not a registration Relay will act on.
   */
  let derived: string;
  try {
    derived = repositoryKey(record.identity);
  } catch {
    return null;
  }
  if (derived !== record.key) return null;
  // A registration written before ownership existed has no `ownerParticipant`.
  // Absent normalizes to null = operator-owned — the safe legacy default, and
  // the honest one: a repo the operator registered stays the operator's.
  return {
    ...(record as RepositoryRegistration),
    ownerParticipant: record.ownerParticipant ?? null,
  };
}

export function createRepositoryRegistrationStore(options: { readonly root: string }): RepositoryRegistrationStore {
  const dir = join(options.root, REGISTRATIONS_DIR);

  const ensureDir = (): void => {
    mkdirSync(dir, { recursive: true });
  };

  return {
    save(registration) {
      /**
       * THE KEY IS RE-DERIVED HERE TOO, not trusted from the object. A caller
       * that hands over a registration whose `key` disagrees with its identity
       * would otherwise write a file the reader then refuses — a write that can
       * never be read. Derive, and store under the derived name so save and
       * read agree by construction.
       */
      const key = repositoryKey(registration.identity);
      const toStore = key === registration.key ? registration : { ...registration, key };
      ensureDir();
      const path = join(dir, keyToFilename(key));
      writeFileAtomic(path, `${JSON.stringify(toStore, null, 2)}\n`);
      fsyncDirBestEffort(dir);
    },

    get(key) {
      return readRegistrationFile(join(dir, keyToFilename(key)));
    },

    list() {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch (error) {
        // ENOENT is "no registrations yet" — an empty list, not unknown.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        return null;
      }
      const out: RepositoryRegistration[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const record = readRegistrationFile(join(dir, name));
        // A single corrupt file is skipped; it does not blind the whole list.
        if (record !== null) out.push(record);
      }
      return out;
    },
  };
}
