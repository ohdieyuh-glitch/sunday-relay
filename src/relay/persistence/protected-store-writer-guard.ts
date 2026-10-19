import type { Pool } from 'pg';

import { protectedStoreRole } from './protected-store';

/**
 * C2 (the Reviewer's INDEP_REVIEW_035_GUARD_788dffed; the founder, 2026-10-11: "Voice data must remain in Wonderland's
 * database. No voice sessions or user voice records should be written to Julius's live store"): the social and voice WRITERS
 * refuse a protected store in code, as migrate() does (protected-store.ts), so a bridge with social on whose pool is the Julius
 * live store reads and writes nothing there.
 *
 * Exactly two modules write the social and voice tables (social-writer-choke-point.test.ts pins them): social-postgres.ts and
 * voice-binding-postgres.ts. Each asks this guard before its first read or write.
 */
export class ProtectedStoreWriteRefused extends Error {
  readonly code = 'write_refused_protected_store';

  constructor(readonly writer: string, readonly storeRole: string) {
    super(`${writer} refused: this database is a protected store (${storeRole}); social and voice data live in the Wonderland database`);
    this.name = 'ProtectedStoreWriteRefused';
  }
}

/**
 * The guard for one writer on one pool. A pool's database never changes, so a store found NOT protected is remembered and
 * not asked again. A protected store is refused on EVERY call, and a failed identity read is never remembered: nothing is cached
 * that could let a later call through.
 */
export function protectedStoreWriterGuard(pool: Pick<Pool, 'query'>, writer: string): () => Promise<void> {
  let clear = false;
  return async () => {
    if (clear) return;
    const role = await protectedStoreRole(pool);
    if (role !== null) throw new ProtectedStoreWriteRefused(writer, role);
    clear = true;
  };
}
