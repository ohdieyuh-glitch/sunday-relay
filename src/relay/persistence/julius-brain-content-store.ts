import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * CONTENT-ADDRESSED ARTIFACT BYTES FOR THE PROJECT BRAIN.
 *
 * A Brain ARTIFACT record carries `contentHash` and `storageRef`; this is what
 * makes the reference resolve. Bytes live at their own sha256, so:
 *
 *   - a reference can never silently point at different bytes — `get` re-hashes
 *     what it read and refuses a mismatch;
 *   - storing the same bytes twice is one file, and a concurrent second writer
 *     is harmless (write to a unique temp name, then no-clobber link into place);
 *   - any runtime that can compute sha256 — Python, a GVE, a C++ tool — can
 *     verify an artifact without asking Julius what it meant.
 *
 * `storageRef` is `cas://sha256/<hex>`: a location-independent name. Which root
 * it resolves under is deployment configuration, never part of the record.
 */

export const JULIUS_BRAIN_CAS_PREFIX = 'cas://sha256/';

export type JuliusBrainArtifactResolution =
  | { readonly status: 'RESOLVED'; readonly byteSize: number }
  | { readonly status: 'MISSING' }
  | { readonly status: 'INTEGRITY_FAILURE' }
  | { readonly status: 'UNSUPPORTED_REF' };

export interface JuliusBrainContentStore {
  put(content: Uint8Array): Promise<{ readonly contentHash: string; readonly byteSize: number; readonly storageRef: string }>;
  get(storageRef: string): Promise<Uint8Array | null>;
  resolve(storageRef: string, expectedContentHash: string): Promise<JuliusBrainArtifactResolution>;
}

const hexOf = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');

export class LocalJuliusBrainContentStore implements JuliusBrainContentStore {
  constructor(private readonly root: string, private readonly maxBytes = 256 * 1024 * 1024) {}

  private pathFor(hex: string): string {
    return join(this.root, 'sha256', hex.slice(0, 2), hex.slice(2));
  }

  private hexFromRef(storageRef: string): string | null {
    if (!storageRef.startsWith(JULIUS_BRAIN_CAS_PREFIX)) return null;
    const hex = storageRef.slice(JULIUS_BRAIN_CAS_PREFIX.length);
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  }

  async put(content: Uint8Array) {
    if (content.byteLength > this.maxBytes) throw new Error('julius_brain_artifact_too_large');
    const hex = hexOf(content);
    const target = this.pathFor(hex);
    await mkdir(dirname(target), { recursive: true });
    const exists = await stat(target).then((info) => info.isFile(), () => false);
    if (!exists) {
      const temp = join(dirname(target), `.${randomUUID()}.tmp`);
      await writeFile(temp, content, { flag: 'wx' });
      try {
        await copyFile(temp, target, constants.COPYFILE_EXCL);
      } catch (error) {
        // Another writer won the race. Same name means same bytes — verify, never assume.
        const prior = await readFile(target).catch(() => null);
        if (prior === null || hexOf(prior) !== hex) throw error;
      } finally {
        await rm(temp, { force: true });
      }
    }
    return { contentHash: `sha256:${hex}`, byteSize: content.byteLength, storageRef: `${JULIUS_BRAIN_CAS_PREFIX}${hex}` };
  }

  async get(storageRef: string): Promise<Uint8Array | null> {
    const hex = this.hexFromRef(storageRef);
    if (hex === null) return null;
    const content = await readFile(this.pathFor(hex)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (content === null) return null;
    if (hexOf(content) !== hex) throw new Error('julius_brain_artifact_integrity_failure');
    return content;
  }

  async resolve(storageRef: string, expectedContentHash: string): Promise<JuliusBrainArtifactResolution> {
    const hex = this.hexFromRef(storageRef);
    if (hex === null) return { status: 'UNSUPPORTED_REF' };
    if (expectedContentHash !== `sha256:${hex}`) return { status: 'INTEGRITY_FAILURE' };
    try {
      const content = await this.get(storageRef);
      return content === null ? { status: 'MISSING' } : { status: 'RESOLVED', byteSize: content.byteLength };
    } catch {
      return { status: 'INTEGRITY_FAILURE' };
    }
  }
}

/** Atomic small-file write for drill attestations and exports (temp + rename). */
export async function writeJuliusBrainFileAtomically(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}
