import { createHash } from 'node:crypto';

/**
 * Deterministic serialization + checksums (Prompt 8.5). Every persisted
 * artifact is serialized with sorted keys so digests and checksums are
 * stable across processes, and every journal event carries a sha256
 * checksum computed over its deterministic serialization.
 */

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Digest of any serializable state value. */
export function digestOf(value: unknown): string {
  return sha256Hex(stableSerialize(value));
}
