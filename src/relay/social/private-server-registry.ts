/**
 * WHERE A PRIVATE SERVER'S TWO RECORDS LIVE, and how a social store reads them before a world operation (the founder's
 * private-server rules, 2026-10-11; the decisions themselves are private-server-lifecycle.ts, pure).
 *
 * A REGISTRY holds, per owner, the LIFECYCLE row (written only through a store, by compare-and-set on its version) and the TIER
 * row (written only by an operator or a billing service: `grant` below is the in-memory operator, and migration 037's table has
 * no social writer at all). Nothing a client sends reaches either.
 *
 * THE GATE READER (`createPrivateServerGates`) is what a store calls, inside its one-at-a-time section, before the command runs:
 *   - The OWNER'S OPEN and an INVITE from inside read both rows FRESH, every time. If they cannot be read, the operation is refused
 *     as an outage (503) and nothing changes: no tier is ever assumed.
 *   - A JOIN INTO SOMEBODY ELSE'S SERVER (FRIEND / INVITE / PARTY) also reads fresh, but a failed read gives NO gate rather than a
 *     503: the join's own permission rules then answer first (a stranger's 403, a hidden leader's 404) and an admitted player hears
 *     "closed". And such a join reads ONCE whether or not its target is in a private server. Together these keep the read from
 *     telling anybody where another player is (the internal review's M2, 10-11).
 *   - A member's REPORT (5 a second) and a world READ use what the last read returned, if it is less than
 *     PRIVATE_SERVER_CACHE_FRESH_MS old, else they read again. The records' own times still decide by the server's clock, so a
 *     Free window closes on time from a cached row. Only a tier row's change (an operator's grant or revocation) waits for the
 *     refresh. If the refresh fails, a cached read stays usable for at most PRIVATE_SERVER_CACHE_MAX_STALE_MS; beyond that the
 *     report gets NO gate, and the server closes for its members (fail closed, never open by default). A failed refresh is not
 *     retried for PRIVATE_SERVER_RETRY_AFTER_MS, and every read gives up after PRIVATE_SERVER_READ_TIMEOUT_MS, so a slow database
 *     cannot hold the store's one-at-a-time section (review m4).
 *   - A LAPSE IS WRITTEN DOWN the first time any read sees it (lapsedCycleRecord; review M1), and so is a refused open's COOLDOWN
 *     observation: best effort, by compare-and-set. After that, nothing about an expired tier row can move the cycle's times.
 */

import type { SocialUserId } from './social-contracts';
import {
  lapsedCycleRecord,
  observeClosed,
  openPrivateServer,
  privateServerAccess,
  type PrivateServerPolicy,
  type PrivateServerRecord,
  type ServerEntitlementRow,
} from './private-server-lifecycle';
import type { SocialState } from './social-state';
import { privateServerTouched, type PrivateServerGate, type WorldState } from './world-presence';

export interface PrivateServerRecords {
  readonly record: PrivateServerRecord | null;
  readonly entitlement: ServerEntitlementRow | null;
}

export interface PrivateServerRegistry {
  /** Both records for one owner. THROWS when they cannot be read: the caller refuses (fail closed), it never assumes a tier. */
  read(ownerId: SocialUserId): Promise<PrivateServerRecords>;
  /** Compare-and-set: stores `next` only if the stored version is `next.version - 1` (0 = no row yet). False = somebody moved it first. */
  write(next: PrivateServerRecord): Promise<boolean>;
}

/** The development and test registry: one process. Hand the SAME instance to a new store to model a restart. */
export interface InMemoryPrivateServerRegistry extends PrivateServerRegistry {
  /** THE OPERATOR's act, never a social route's: a player's PRO / MAX for a period. */
  grant(row: ServerEntitlementRow): void;
  /** THE OPERATOR's act: the tier row is gone (the player is FREE from now on). */
  revoke(userId: SocialUserId): void;
  /** Tests: make reads (or writes) fail, as an unreachable database would. */
  failReads(fail: boolean): void;
  failWrites(fail: boolean): void;
  /** Tests: make reads hang, as a database that stopped answering would (each read waits for the timeout). */
  hangReads(hang: boolean): void;
  /** Tests: how many reads were asked for, whatever their outcome. */
  readsAsked(): number;
  /** Tests: the stored lifecycle row, as it is. */
  stored(ownerId: SocialUserId): PrivateServerRecord | null;
}

export function createInMemoryPrivateServerRegistry(): InMemoryPrivateServerRegistry {
  const records = new Map<SocialUserId, PrivateServerRecord>();
  const tiers = new Map<SocialUserId, ServerEntitlementRow>();
  let readsFail = false;
  let writesFail = false;
  let readsHang = false;
  let asked = 0;
  return {
    async read(ownerId) {
      asked += 1;
      if (readsHang) return new Promise<PrivateServerRecords>(() => undefined);
      if (readsFail) throw new Error('private server records unreachable');
      return { record: records.get(ownerId) ?? null, entitlement: tiers.get(ownerId) ?? null };
    },
    async write(next) {
      if (writesFail) throw new Error('private server records unreachable');
      const storedVersion = records.get(next.ownerId)?.version ?? 0;
      if (storedVersion !== next.version - 1) return false;
      records.set(next.ownerId, next);
      return true;
    },
    grant(row) {
      tiers.set(row.userId, row);
    },
    revoke(userId) {
      tiers.delete(userId);
    },
    failReads(fail) {
      readsFail = fail;
    },
    failWrites(fail) {
      writesFail = fail;
    },
    hangReads(hang) {
      readsHang = hang;
    },
    readsAsked() {
      return asked;
    },
    stored(ownerId) {
      return records.get(ownerId) ?? null;
    },
  };
}

export const PRIVATE_SERVER_CACHE_FRESH_MS = 60_000;
export const PRIVATE_SERVER_CACHE_MAX_STALE_MS = 5 * 60_000;
/** After a failed refresh, reports use the cached read (within the max-stale bound) and do not ask again for this long. */
export const PRIVATE_SERVER_RETRY_AFTER_MS = 5_000;
/** A read that has not answered by then has failed (the store's one-at-a-time section never waits longer on it). */
export const PRIVATE_SERVER_READ_TIMEOUT_MS = 2_000;
/** The 503 a join / invite answers when the records cannot be read: an outage, retryable, and nothing changed. */
export const PRIVATE_SERVER_UNAVAILABLE_MESSAGE = 'Private servers cannot be checked right now. Nothing was changed; try again shortly.';
/** The 503 when the owner's open lost a compare-and-set (another request moved the server first). */
export const PRIVATE_SERVER_RACE_MESSAGE = 'The private server changed at the same moment. Nothing was changed; try again.';

export type PrivateServerGateRead =
  | { readonly ok: true; readonly gate: PrivateServerGate | null }
  | { readonly ok: false };

export interface PrivateServerGates {
  /** The gate for one operation, read before it runs (see the header); `ok: false` = refuse as an outage, change nothing. */
  gateFor(world: WorldState, social: SocialState, actorId: SocialUserId, op: string, body: Readonly<Record<string, unknown>>, nowMs: number): Promise<PrivateServerGateRead>;
  /** After a committed write: the record as stored. */
  remember(record: PrivateServerRecord, nowMs: number): void;
  /** After a lost or failed write: read fresh next time. */
  forget(ownerId: SocialUserId): void;
  /** A server found closed: record the COOLDOWN observation, best effort (a lost race or an outage changes nothing). */
  observeClosed(ownerId: SocialUserId, nowMs: number): Promise<void>;
}

/** Operations that may decide from a cached read: a member's report and a world read. */
const CACHED_OPS = new Set(['world.state', 'world.read']);
/** Joins into SOMEBODY ELSE's world: a failed read is no gate (never a 503), and they read once whatever their target. */
const GUEST_TARGETS = new Set(['FRIEND', 'INVITE', 'PARTY']);
/** Cached reads older than this are dropped when the cache is swept (at most once a minute). */
const CACHE_SWEEP_MS = 60_000;

/** `work`, or a rejection once `ms` has passed without an answer (the work itself is left to finish or fail on its own). */
function withinMs<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('private server records: no answer in time')), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createPrivateServerGates(registry: PrivateServerRegistry, policy: PrivateServerPolicy): PrivateServerGates {
  const cache = new Map<SocialUserId, { records: PrivateServerRecords; readAtMs: number }>();
  const failedAt = new Map<SocialUserId, number>();
  let sweptAt = Number.NEGATIVE_INFINITY;

  const sweep = (nowMs: number): void => {
    if (nowMs - sweptAt < CACHE_SWEEP_MS && nowMs >= sweptAt) return;
    sweptAt = nowMs;
    for (const [owner, entry] of cache) if (nowMs - entry.readAtMs > PRIVATE_SERVER_CACHE_MAX_STALE_MS || nowMs < entry.readAtMs) cache.delete(owner);
    for (const [owner, at] of failedAt) if (nowMs - at > PRIVATE_SERVER_RETRY_AFTER_MS || nowMs < at) failedAt.delete(owner);
  };

  /** Best effort, compare-and-set: the record replaces what was read, or nothing happens (the next read decides again). */
  const persist = async (next: PrivateServerRecord, entitlement: ServerEntitlementRow | null, nowMs: number): Promise<PrivateServerRecord | null> => {
    try {
      if (await withinMs(registry.write(next), PRIVATE_SERVER_READ_TIMEOUT_MS)) {
        cache.set(next.ownerId, { records: { record: next, entitlement }, readAtMs: nowMs });
        return next;
      }
    } catch {
      // an outage: nothing written; the in-memory decision below still uses the same derived times
    }
    cache.delete(next.ownerId);
    return null;
  };

  /** A fresh read, with a LAPSE written down the first time it is seen (review M1). Null = could not read. */
  const readFresh = async (ownerId: SocialUserId, nowMs: number): Promise<PrivateServerRecords | null> => {
    let records: PrivateServerRecords;
    try {
      records = await withinMs(registry.read(ownerId), PRIVATE_SERVER_READ_TIMEOUT_MS);
    } catch {
      failedAt.set(ownerId, nowMs);
      return null;
    }
    failedAt.delete(ownerId);
    cache.set(ownerId, { records, readAtMs: nowMs });
    const lapse = lapsedCycleRecord(records.record, records.entitlement, policy, nowMs);
    if (lapse === null) return records;
    // written or not, the decision uses the converted cycle: the same times privateServerAccess derives from the unconverted one
    return { record: (await persist(lapse, records.entitlement, nowMs)) ?? lapse, entitlement: records.entitlement };
  };

  return {
    async gateFor(world, social, actorId, op, body, nowMs) {
      sweep(nowMs);
      const ownerId = privateServerTouched(world, social, actorId, op, body);
      const opening = op === 'world.join' && body.target === 'PRIVATE';
      const guestJoin = op === 'world.join' && typeof body.target === 'string' && GUEST_TARGETS.has(body.target);
      if (ownerId === null) {
        // THE SAME WORK EITHER WAY (review M2): a join into somebody's world reads once even when they are in no private server,
        // so the answer's timing does not say where they are. Its outcome is not used.
        if (guestJoin) await withinMs(registry.read(actorId), PRIVATE_SERVER_READ_TIMEOUT_MS).catch(() => undefined);
        return { ok: true, gate: null };
      }
      let records: PrivateServerRecords | null;
      if (CACHED_OPS.has(op)) {
        const cached = cache.get(ownerId);
        // a cached read from the FUTURE (a clock step back) is not trusted as fresh
        const age = cached === undefined ? Number.POSITIVE_INFINITY : nowMs - cached.readAtMs;
        const lastFailure = failedAt.get(ownerId);
        const backingOff = lastFailure !== undefined && nowMs >= lastFailure && nowMs - lastFailure < PRIVATE_SERVER_RETRY_AFTER_MS;
        if (cached !== undefined && age >= 0 && age < PRIVATE_SERVER_CACHE_FRESH_MS) records = cached.records;
        else records = backingOff ? null : await readFresh(ownerId, nowMs);
        if (records === null) {
          // the refresh failed (or is backing off): a recent read still decides by its own times; an old one, or none, decides
          // nothing -- the server closes for its members
          records = cached !== undefined && age >= 0 && age < PRIVATE_SERVER_CACHE_MAX_STALE_MS ? cached.records : null;
          if (records === null) return { ok: true, gate: null };
        }
      } else {
        records = await readFresh(ownerId, nowMs);
        // a guest's join fails CLOSED but quietly (no 503 that only a private-server target could produce: review M2)
        if (records === null) return guestJoin ? { ok: true, gate: null } : { ok: false };
      }
      const access = privateServerAccess(records.record, records.entitlement, policy, nowMs);
      if (!opening) return { ok: true, gate: { ownerId, access } };
      const open = openPrivateServer(records.record, records.entitlement, policy, ownerId, typeof body.name === 'string' ? body.name : '', nowMs);
      // a REFUSED open's observation (COOLDOWN, the cycle's times unchanged) is written down too, best effort (review M1)
      if (!open.ok && open.write && open.record !== null) await persist(open.record, records.entitlement, nowMs);
      return { ok: true, gate: { ownerId, access, open } };
    },
    remember(record, nowMs) {
      const cached = cache.get(record.ownerId);
      cache.set(record.ownerId, { records: { record, entitlement: cached?.records.entitlement ?? null }, readAtMs: cached?.readAtMs ?? nowMs });
    },
    forget(ownerId) {
      cache.delete(ownerId);
    },
    async observeClosed(ownerId, nowMs) {
      const records = await readFresh(ownerId, nowMs);
      if (records === null) return;
      const access = privateServerAccess(records.record, records.entitlement, policy, nowMs);
      const observed = observeClosed(records.record, access, policy, nowMs);
      if (observed !== null) await persist(observed, records.entitlement, nowMs);
    },
  };
}
