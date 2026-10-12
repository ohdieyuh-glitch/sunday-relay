import type { Pool, PoolClient } from 'pg';

import type { PaidServerTier, PrivateServerRecord, PrivateServerStatus, ServerEntitlementRow, WonderlandServerTier } from '../social/private-server-lifecycle';
import type { PrivateServerRecords, PrivateServerRegistry } from '../social/private-server-registry';
import { protectedStoreWriterGuard } from './protected-store-writer-guard';

/**
 * PRIVATE SERVERS ON POSTGRESQL (migration 037): the owner's lifecycle row and the trusted tier row, read before a world operation
 * and written by compare-and-set (private-server-registry.ts says how a store uses them; private-server-lifecycle.ts decides).
 *
 * - The TIER row (`private_server_entitlements`) is READ here and never written: an operator or a billing service writes it. No
 *   social route reaches it.
 * - The LIFECYCLE row (`private_servers`) is written ONLY by `writePrivateServerRecord`: a new row (version 1) is inserted only if
 *   none exists; any later version replaces exactly the version before it. A lost race writes nothing and says so.
 * - Like the social and voice writers, this refuses a PROTECTED store (the Julius live store) before its first read or write
 *   (protected-store-writer-guard.ts; social-writer-choke-point.test.ts pins the writers). The social store calls
 *   `writePrivateServerRecord` inside its own transaction, after ITS guard.
 */

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface ServerRow {
  owner_id: string;
  server_name: string;
  status: PrivateServerStatus;
  cycle_tier: WonderlandServerTier;
  policy_id: string;
  activated_at: Date | null;
  active_until: Date | null;
  cooldown_until: Date | null;
  version: string;
  created_at: Date;
  updated_at: Date;
}

interface TierRow {
  player_id: string;
  tier: PaidServerTier;
  valid_from: Date;
  valid_until: Date | null;
}

const msOf = (at: Date | null): number | null => (at === null ? null : at.getTime());
const isoOf = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Both records for one owner, read as they stand. Throws when the database cannot answer (the caller fails closed). */
export async function readPrivateServerRecords(db: Queryable, ownerId: string): Promise<PrivateServerRecords> {
  const servers = await db.query<ServerRow>(
    `SELECT owner_id, server_name, status, cycle_tier, policy_id, activated_at, active_until, cooldown_until, version::text AS version, created_at, updated_at
       FROM relay_wonderland.private_servers WHERE owner_id = $1`,
    [ownerId],
  );
  const tiers = await db.query<TierRow>(
    `SELECT player_id, tier, valid_from, valid_until FROM relay_wonderland.private_server_entitlements WHERE player_id = $1`,
    [ownerId],
  );
  const s = servers.rows[0];
  const t = tiers.rows[0];
  const record: PrivateServerRecord | null =
    s === undefined
      ? null
      : {
          ownerId: s.owner_id,
          serverName: s.server_name,
          status: s.status,
          cycleTier: s.cycle_tier,
          policyId: s.policy_id,
          activatedAtMs: msOf(s.activated_at),
          activeUntilMs: msOf(s.active_until),
          cooldownUntilMs: msOf(s.cooldown_until),
          version: Number(s.version),
          createdAtMs: s.created_at.getTime(),
          updatedAtMs: s.updated_at.getTime(),
        };
  const entitlement: ServerEntitlementRow | null =
    t === undefined ? null : { userId: t.player_id, tier: t.tier, validFromMs: t.valid_from.getTime(), validUntilMs: msOf(t.valid_until) };
  return { record, entitlement };
}

/** Compare-and-set: true only when `next` replaced exactly version `next.version - 1` (or created the first row). */
export async function writePrivateServerRecord(db: Queryable, next: PrivateServerRecord): Promise<boolean> {
  const values = [
    next.ownerId,
    next.serverName,
    next.status,
    next.cycleTier,
    next.policyId,
    isoOf(next.activatedAtMs),
    isoOf(next.activeUntilMs),
    isoOf(next.cooldownUntilMs),
    next.version,
    isoOf(next.updatedAtMs),
  ];
  if (next.version === 1) {
    const inserted = await db.query(
      `INSERT INTO relay_wonderland.private_servers(owner_id, server_name, status, cycle_tier, policy_id, activated_at, active_until, cooldown_until, version, updated_at, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(owner_id) DO NOTHING`,
      [...values, isoOf(next.createdAtMs)],
    );
    return (inserted.rowCount ?? 0) === 1;
  }
  const updated = await db.query(
    `UPDATE relay_wonderland.private_servers
        SET server_name=$2, status=$3, cycle_tier=$4, policy_id=$5, activated_at=$6, active_until=$7, cooldown_until=$8, version=$9, updated_at=$10
      WHERE owner_id=$1 AND version=$11`,
    [...values, next.version - 1],
  );
  return (updated.rowCount ?? 0) === 1;
}

/** The registry on a pool: refuses a protected store before anything, then reads and writes the 037 tables. */
export function createPostgresPrivateServerRegistry(pool: Pick<Pool, 'query'>): PrivateServerRegistry {
  const refuseProtectedStore = protectedStoreWriterGuard(pool, 'private servers');
  return {
    async read(ownerId) {
      await refuseProtectedStore();
      return readPrivateServerRecords(pool, ownerId);
    },
    async write(next) {
      await refuseProtectedStore();
      return writePrivateServerRecord(pool, next);
    },
  };
}
