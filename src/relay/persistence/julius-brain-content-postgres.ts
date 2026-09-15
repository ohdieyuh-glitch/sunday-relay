import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

import { JULIUS_BRAIN_CAS_PREFIX, type JuliusBrainArtifactResolution, type JuliusBrainContentStore } from './julius-brain-content-store';

/**
 * ARTIFACT BYTES IN THE BRAIN DATABASE (`julius_brain.content`).
 *
 * The same contract as the filesystem store — `cas://sha256/<hex>`, re-hashed
 * on every read, a mismatch refused — with durability equal to the Brain's own:
 * the bytes an ARTIFACT record names are backed up, restored and replicated with
 * the record. Rows are immutable; a second put of the same bytes is a no-op, and
 * a stored row whose bytes do not hash to its key is an integrity failure, never
 * served.
 */

const hexOf = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');

export class PostgresJuliusBrainContentStore implements JuliusBrainContentStore {
  constructor(private readonly pool: Pool, private readonly maxBytes = 64 * 1024 * 1024) {}

  private hexFromRef(storageRef: string): string | null {
    if (!storageRef.startsWith(JULIUS_BRAIN_CAS_PREFIX)) return null;
    const hex = storageRef.slice(JULIUS_BRAIN_CAS_PREFIX.length);
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  }

  async put(content: Uint8Array) {
    if (content.byteLength > this.maxBytes) throw new Error('julius_brain_artifact_too_large');
    const hex = hexOf(content);
    await this.pool.query(
      'INSERT INTO julius_brain.content(content_hash,byte_size,bytes) VALUES($1,$2,$3) ON CONFLICT(content_hash) DO NOTHING',
      [`sha256:${hex}`, content.byteLength, Buffer.from(content.buffer, content.byteOffset, content.byteLength)],
    );
    return { contentHash: `sha256:${hex}`, byteSize: content.byteLength, storageRef: `${JULIUS_BRAIN_CAS_PREFIX}${hex}` };
  }

  async get(storageRef: string): Promise<Uint8Array | null> {
    const hex = this.hexFromRef(storageRef);
    if (hex === null) return null;
    const result = await this.pool.query<{ bytes: Buffer }>('SELECT bytes FROM julius_brain.content WHERE content_hash=$1', [`sha256:${hex}`]);
    const row = result.rows[0];
    if (row === undefined) return null;
    const content = new Uint8Array(row.bytes);
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
