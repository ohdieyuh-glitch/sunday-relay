/**
 * WONDERLAND PRIVATE SERVERS — WHEN ONE IS OPEN, AND FOR WHOM (the founder's private-server rules, 2026-10-11).
 *
 * THE RULES:
 *   A. Every player may OPEN a private server, free: no charge and no tier needed. One per owner (`priv_<owner>`, world-presence.ts).
 *   B. FREE: once opened, a server stays open for one ACTIVE WINDOW of SERVER time (6-8 h PROPOSED, not approved) ...
 *   C. ... then it COOLS DOWN (4-5 h PROPOSED, not approved). Nobody opens it or joins it until the cooldown ends.
 *   D/E. PRO and MAX: continuous. No window, no cooldown. There is NO Team tier.
 *   F. A window ending closes the SESSION, never the data. Nothing here deletes anything. The server's own settings (its name) are
 *      kept with its record, and WonderFS, Project Brain and social rows are never touched by a lifecycle change.
 *   G. Server time only, from records the client cannot write. Fail closed.
 *
 * WHAT DECIDES: two server-side records, which the store reads before each world operation that touches a private server.
 *   - The owner's TIER ROW (`private_server_entitlements`, migration 037). It is written ONLY by an operator (or a future billing
 *     service); no social route writes it. No row = FREE (the product's default, not a failure). A row outside its validity = FREE.
 *   - The owner's LIFECYCLE ROW (`private_servers`, 037): when the current cycle opened, when its window ends and when its
 *     cooldown ends. All three are FIXED AT ACTIVATION from the policy then in force, so a later policy change never rewrites a
 *     running cycle, and nothing (a restart, a reconnect, another device, signing out) can start the window again early.
 *   Every decision compares those fixed timestamps with the SERVER's clock. Nothing a client sends -- a time, a tier, a state --
 *   is read here.
 *
 * ENTITLEMENT CHANGES DURING A CYCLE (deterministic; PROPOSED to the founder 10-11 with the durations):
 *   - An UPGRADE (Free -> Pro/Max) takes effect at once. A cooldown is lifted, because a Pro/Max server has none.
 *   - A LAPSE (Pro/Max -> Free) puts a continuous server on the Free clock FROM THE LAPSE: its window counts from
 *     max(the cycle's opening, the row's valid_until). With no lapse time to read (the row deleted, or replaced by one not yet
 *     valid) it counts from the cycle's opening. THE FIRST READ THAT SEES A LAPSE WRITES IT DOWN (`lapsedCycleRecord`, persisted by
 *     the store's gate reader): from then on the record is a FREE cycle with fixed times, so deleting or replacing the expired row
 *     afterwards cannot move them -- in particular it cannot end a cooldown early (the internal review's M1, 10-11). Staying
 *     offline after a lapse earns nothing: the window counts on the clock.
 *   - The window runs on the CLOCK from activation. It does not pause while the server is empty, so leaving and coming back
 *     cannot stretch it. The cooldown starts when the window ends.
 *   - A cycle that opens in the FUTURE by more than PRIVATE_SERVER_CLOCK_TOLERANCE_MS (an invalid activation time, or a server clock
 *     stepped far back) is CLOSED until it is reached: never open on a timestamp the server has not lived through.
 *
 * WHAT THIS DOES NOT TOUCH: Julius usage. A server's tier says only when the server is open. It grants no Julius allowance, model
 * spend or mission budget; those are Julius's own (MAIN JUJU's), and this module imports nothing from them
 * (private-server-store.test.ts, H(13)). Capacity (WORLD_PRIVATE_CAPACITY) is the same for every tier.
 *
 * Pure: time is an injected millisecond count; nothing here touches a clock, the network or a store.
 */

import type { SocialUserId } from './social-contracts';

/** The server tiers. Wonderland's own enum (never Julius's mission/entitlement.ts). NO Team tier, by the founder's rule. */
export const WONDERLAND_SERVER_TIERS = ['FREE', 'PRO', 'MAX'] as const;
export type WonderlandServerTier = (typeof WONDERLAND_SERVER_TIERS)[number];
/** The tiers a tier row may grant. FREE is the absence of a row. */
export const PAID_SERVER_TIERS = ['PRO', 'MAX'] as const;
export type PaidServerTier = (typeof PAID_SERVER_TIERS)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The Free durations as PROPOSED (not approved) to the founder on 2026-10-11: an active window of 6-8 hours, then a cooldown of
 * 4-5 hours. FOR DOCUMENTATION AND UI ONLY: no validation reads this, and neither does migration 037. The founder has not approved
 * these ranges, so they are not law anywhere in code or schema.
 */
export const FREE_PROPOSED_RANGES_MS = Object.freeze({
  activeWindow: Object.freeze({ min: 6 * HOUR_MS, max: 8 * HOUR_MS }),
  cooldown: Object.freeze({ min: 4 * HOUR_MS, max: 5 * HOUR_MS }),
});

/**
 * NEUTRAL SANITY BOUNDS, NOT POLICY: what makePrivateServerPolicy accepts, and the same bounds migration 037's
 * private_servers_free_cycle CHECK holds a stored Free cycle to. An active window of 1 minute to 24 hours; a cooldown of 1 minute
 * to 24 hours (a Free server always has a cooldown: none at all would make it a continuous one). They exist to refuse nonsense (a zero or day-long-plus window), not to encode the founder's proposal, so any duration the
 * founder later chooses inside a day needs a code change only, never a new migration.
 */
export const FREE_ACTIVE_WINDOW_SANITY_MS = Object.freeze({ min: MINUTE_MS, max: 24 * HOUR_MS });
export const FREE_COOLDOWN_SANITY_MS = Object.freeze({ min: MINUTE_MS, max: 24 * HOUR_MS });

export interface PrivateServerPolicy {
  /** Stored on every cycle, so the record says which terms it opened under. */
  readonly policyId: string;
  readonly freeActiveWindowMs: number;
  readonly freeCooldownMs: number;
  /** False until the founder fixes the exact durations. The policy id says "proposed" until then. */
  readonly frozen: boolean;
}

/**
 * A policy in whole minutes inside the SANITY BOUNDS (window 1 min to 24 h, cooldown 1 min to 24 h), or a RangeError. The bounds are not
 * the founder's proposal: a window outside 6-8 h is accepted here, because those figures are PROPOSED (not approved).
 */
export function makePrivateServerPolicy(input: { readonly freeActiveWindowMs: number; readonly freeCooldownMs: number; readonly frozen: boolean }): PrivateServerPolicy {
  const { freeActiveWindowMs: w, freeCooldownMs: c } = input;
  const whole = (ms: number) => Number.isSafeInteger(ms) && ms % MINUTE_MS === 0;
  if (!whole(w) || w < FREE_ACTIVE_WINDOW_SANITY_MS.min || w > FREE_ACTIVE_WINDOW_SANITY_MS.max) {
    throw new RangeError(`the Free active window must be whole minutes from 1 min to 24 h (a sanity bound, not policy), not ${w} ms`);
  }
  if (!whole(c) || c < FREE_COOLDOWN_SANITY_MS.min || c > FREE_COOLDOWN_SANITY_MS.max) {
    throw new RangeError(`the Free cooldown must be whole minutes from 1 min to 24 h (a sanity bound, not policy), not ${c} ms`);
  }
  return Object.freeze({
    policyId: `free-${w / MINUTE_MS}m-cool-${c / MINUTE_MS}m${input.frozen ? '' : '-proposed'}`,
    freeActiveWindowMs: w,
    freeCooldownMs: c,
    frozen: input.frozen,
  });
}

/**
 * THE ONE PLACE THE DURATIONS LIVE. PROPOSED (not approved) to the founder on 2026-10-11, NOT frozen: 8 h active + 4 h cooldown,
 * a 12-hour cycle (twice a day). Neither these values nor the 6-8 h / 4-5 h ranges are approved, so the policy id ends "-proposed"
 * and `frozen` is false. Freezing it takes an explicit code change to this line (there is no environment or runtime override), and a
 * running cycle keeps the terms it opened under.
 */
export const PRIVATE_SERVER_POLICY: PrivateServerPolicy = makePrivateServerPolicy({ freeActiveWindowMs: 8 * HOUR_MS, freeCooldownMs: 4 * HOUR_MS, frozen: false });

/** The trusted tier row, as the store read it. Written only by an operator or billing service, never by a social route. */
export interface ServerEntitlementRow {
  readonly userId: SocialUserId;
  readonly tier: PaidServerTier;
  readonly validFromMs: number;
  /** Null = no end date. */
  readonly validUntilMs: number | null;
}

/** What the tier row grants now: PRO/MAX inside its validity, else FREE, plus when a past row lapsed (for the Free clock). */
export function effectiveServerTier(row: ServerEntitlementRow | null, nowMs: number): { readonly tier: WonderlandServerTier; readonly lapsedAtMs: number | null } {
  if (row === null) return { tier: 'FREE', lapsedAtMs: null };
  if (!(PAID_SERVER_TIERS as readonly string[]).includes(row.tier) || !Number.isFinite(row.validFromMs)) return { tier: 'FREE', lapsedAtMs: null };
  if (nowMs < row.validFromMs) return { tier: 'FREE', lapsedAtMs: null };
  if (row.validUntilMs !== null && nowMs >= row.validUntilMs) return { tier: 'FREE', lapsedAtMs: row.validUntilMs };
  return { tier: row.tier, lapsedAtMs: null };
}

export const PRIVATE_SERVER_STATUSES = ['READY', 'ACTIVE', 'COOLDOWN', 'CONTINUOUS'] as const;
/**
 * READY      never opened, or its cooldown is over: the owner may open it (a new Free cycle).
 * ACTIVE     a Free cycle inside its window: open, joinable.
 * COOLDOWN   a Free cycle past its window, before its cooldown ends: closed to everyone, the owner included.
 * CONTINUOUS a Pro/Max owner's server: open whenever the owner opens it, no window, no cooldown.
 */
export type PrivateServerStatus = (typeof PRIVATE_SERVER_STATUSES)[number];

/** The owner's lifecycle row (migration 037 `private_servers`). One per owner; it is never deleted by a lifecycle change. */
export interface PrivateServerRecord {
  readonly ownerId: SocialUserId;
  /** The server's own name: its configuration, kept across restarts and cycles. */
  readonly serverName: string;
  /** The status as of `updatedAtMs`, for the record. Decisions come from the timestamps and the server clock, never from this. */
  readonly status: PrivateServerStatus;
  /** The tier the current cycle opened under. */
  readonly cycleTier: WonderlandServerTier;
  readonly policyId: string;
  /** When the current cycle opened (server time); null = never opened. */
  readonly activatedAtMs: number | null;
  /** FREE only: when the window ends, which is also when the cooldown starts. Null for a continuous cycle. */
  readonly activeUntilMs: number | null;
  /** FREE only: when the cooldown ends. Null for a continuous cycle. */
  readonly cooldownUntilMs: number | null;
  /** Optimistic concurrency: a write names the version it read, and loses if anybody moved the row first. */
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** What a private server allows at one moment: computed, never stored as the decision. */
export interface PrivateServerAccess {
  readonly status: PrivateServerStatus;
  readonly tier: WonderlandServerTier;
  /** ACTIVE: when the window ends. Null when nothing is scheduled to close. */
  readonly activeUntilMs: number | null;
  /** ACTIVE / COOLDOWN: when the cooldown ends, so when it may open again. */
  readonly cooldownUntilMs: number | null;
}

interface FreeCycle {
  readonly activatedAtMs: number;
  readonly activeUntilMs: number;
  readonly cooldownUntilMs: number;
}

function freeCycleFrom(startMs: number, policy: PrivateServerPolicy): FreeCycle {
  return { activatedAtMs: startMs, activeUntilMs: startMs + policy.freeActiveWindowMs, cooldownUntilMs: startMs + policy.freeActiveWindowMs + policy.freeCooldownMs };
}

/** The Free cycle that governs an owner who is FREE now, or null when there is none (never opened). */
function governingFreeCycle(record: PrivateServerRecord | null, lapsedAtMs: number | null, policy: PrivateServerPolicy): FreeCycle | null {
  if (record === null || record.activatedAtMs === null) return null;
  if (record.cycleTier === 'FREE') {
    // A stored Free cycle is fixed: its own times, whatever the policy says today. Migration 037's CHECK makes a FREE row carry all
    // three times or none; none means never opened (READY), and a row missing only some can never read as open.
    if (record.activeUntilMs === null || record.cooldownUntilMs === null) return null;
    return { activatedAtMs: record.activatedAtMs, activeUntilMs: record.activeUntilMs, cooldownUntilMs: record.cooldownUntilMs };
  }
  // A LAPSED continuous cycle: on the Free clock from the lapse (never earlier than the cycle's opening). With no lapse time to read
  // (the row deleted, or replaced by one not yet valid), from the cycle's opening -- never moving with the clock. The gate reader
  // writes this conversion down the first time it sees it (lapsedCycleRecord), so a later deletion cannot move it (review M1).
  return freeCycleFrom(Math.max(record.activatedAtMs, lapsedAtMs ?? record.activatedAtMs), policy);
}

/** How far a cycle's opening may lie AHEAD of the server clock (an NTP step) and still count as begun. Beyond it: closed. */
export const PRIVATE_SERVER_CLOCK_TOLERANCE_MS = 2 * MINUTE_MS;

/**
 * A cycle whose opening lies AHEAD of the server clock by more than the tolerance (a clock stepped back, or an invalid activation
 * time): privateServerAccess reads it closed, and NOTHING about it is observed or written until the clock reaches it. Its
 * "COOLDOWN" carries the opening as cooldownUntilMs, not a real cooldown end, so deriving a Free record from it would put
 * active_until before activated_at (the internal review's M1, 10-12).
 */
function cycleNotYetReached(record: PrivateServerRecord, nowMs: number): boolean {
  return record.activatedAtMs !== null && nowMs < record.activatedAtMs - PRIVATE_SERVER_CLOCK_TOLERANCE_MS;
}

/** What the owner's server allows NOW, from the two trusted records and the server clock. */
export function privateServerAccess(record: PrivateServerRecord | null, entitlement: ServerEntitlementRow | null, policy: PrivateServerPolicy, nowMs: number): PrivateServerAccess {
  const { tier, lapsedAtMs } = effectiveServerTier(entitlement, nowMs);
  if (tier !== 'FREE') return { status: 'CONTINUOUS', tier, activeUntilMs: null, cooldownUntilMs: null };
  const cycle = governingFreeCycle(record, lapsedAtMs, policy);
  if (cycle === null || nowMs >= cycle.cooldownUntilMs) return { status: 'READY', tier, activeUntilMs: null, cooldownUntilMs: null };
  // AN OPENING THE SERVER HAS NOT LIVED THROUGH (review m3; Rule G "invalid activation timestamps"): closed until it is reached
  if (nowMs < cycle.activatedAtMs - PRIVATE_SERVER_CLOCK_TOLERANCE_MS) return { status: 'COOLDOWN', tier, activeUntilMs: null, cooldownUntilMs: cycle.activatedAtMs };
  if (nowMs < cycle.activeUntilMs) return { status: 'ACTIVE', tier, activeUntilMs: cycle.activeUntilMs, cooldownUntilMs: cycle.cooldownUntilMs };
  return { status: 'COOLDOWN', tier, activeUntilMs: null, cooldownUntilMs: cycle.cooldownUntilMs };
}

/**
 * A LAPSE WRITTEN DOWN (review M1): when the owner's record is a continuous (PRO / MAX) cycle and their tier now reads FREE, the FREE
 * cycle that governs them -- the same one privateServerAccess derives -- as a record with fixed times and the observed status. The
 * store's gate reader persists it (compare-and-set) the first time it sees it; afterwards nothing about the expired tier row (a
 * deletion, a renewal dated later) can move the times. Null when there is nothing to convert.
 */
export function lapsedCycleRecord(record: PrivateServerRecord | null, entitlement: ServerEntitlementRow | null, policy: PrivateServerPolicy, nowMs: number): PrivateServerRecord | null {
  if (record === null || record.cycleTier === 'FREE' || record.activatedAtMs === null || cycleNotYetReached(record, nowMs)) return null;
  const { tier, lapsedAtMs } = effectiveServerTier(entitlement, nowMs);
  if (tier !== 'FREE') return null;
  const cycle = freeCycleFrom(Math.max(record.activatedAtMs, lapsedAtMs ?? record.activatedAtMs), policy);
  const status: PrivateServerStatus = nowMs >= cycle.cooldownUntilMs ? 'READY' : nowMs >= cycle.activeUntilMs ? 'COOLDOWN' : 'ACTIVE';
  return stamped(record, record.ownerId, { serverName: record.serverName, status, cycleTier: 'FREE', policyId: policy.policyId, ...cycle }, nowMs);
}

/** Whether a server in this state may be entered or stayed in: ACTIVE or CONTINUOUS only. */
export function privateServerIsOpen(access: PrivateServerAccess): boolean {
  return access.status === 'ACTIVE' || access.status === 'CONTINUOUS';
}

export const PRIVATE_SERVER_DEFAULT_NAME = 'Private server';
const NAME_MAX = 60;

/**
 * The owner's own text for their server's name: trimmed, control characters refused upstream (C0, DEL and C1: social-commands.ts
 * world.join), at most 60 CODE POINTS -- PostgreSQL's char_length -- never cutting a surrogate pair in half (review m2). Empty = keep.
 */
export function cleanServerName(requested: string): string {
  return Array.from(requested.trim()).slice(0, NAME_MAX).join('').trim();
}

export type PrivateServerOpen =
  | { readonly ok: true; readonly access: PrivateServerAccess; readonly record: PrivateServerRecord; readonly write: boolean }
  | { readonly ok: false; readonly access: PrivateServerAccess; readonly record: PrivateServerRecord | null; readonly write: boolean };

/**
 * The next version of a record. `updatedAtMs` never moves backwards -- not below the last update, the creation or the cycle's own
 * opening -- so a server clock stepped back (NTP) cannot produce a row migration 037's private_servers_times CHECK refuses.
 */
function stamped(base: PrivateServerRecord | null, ownerId: SocialUserId, fields: Omit<PrivateServerRecord, 'ownerId' | 'version' | 'createdAtMs' | 'updatedAtMs'>, nowMs: number): PrivateServerRecord {
  const createdAtMs = base?.createdAtMs ?? nowMs;
  const updatedAtMs = Math.max(nowMs, base?.updatedAtMs ?? nowMs, createdAtMs, fields.activatedAtMs ?? nowMs);
  return { ownerId, ...fields, version: (base?.version ?? 0) + 1, createdAtMs, updatedAtMs };
}

/**
 * THE OWNER OPENS THEIR SERVER. READY -> a new Free cycle (window and cooldown fixed now). ACTIVE -> in, with the cycle unchanged.
 * COOLDOWN -> refused, until `access.cooldownUntilMs`. CONTINUOUS -> in. `write` says the store must persist `record` (compare-and-set
 * on the version it read) BEFORE the open takes effect; a refusal may also carry a status observation to persist (best effort).
 */
export function openPrivateServer(
  record: PrivateServerRecord | null,
  entitlement: ServerEntitlementRow | null,
  policy: PrivateServerPolicy,
  ownerId: SocialUserId,
  requestedName: string,
  nowMs: number,
): PrivateServerOpen {
  if (record !== null && record.ownerId !== ownerId) throw new Error('openPrivateServer: the record is not this owner\'s');
  const access = privateServerAccess(record, entitlement, policy, nowMs);
  const name = cleanServerName(requestedName) || record?.serverName || PRIVATE_SERVER_DEFAULT_NAME;
  const renamed = record !== null && record.serverName !== name;
  switch (access.status) {
    case 'COOLDOWN': {
      if (record === null) return { ok: false, access, record: null, write: false };
      // A cycle the server clock has not reached: refused, and nothing is observed or written (see cycleNotYetReached).
      if (cycleNotYetReached(record, nowMs)) return { ok: false, access, record, write: false };
      // The cycle's times are already fixed; only the observed status may need recording (the owner's name request is not applied
      // to a server they may not open).
      const observed = record.status === 'COOLDOWN' && record.cycleTier === 'FREE' ? record : freeRecordOf(record, access, ownerId, policy, nowMs, 'COOLDOWN');
      return { ok: false, access, record: observed, write: observed !== record };
    }
    case 'READY': {
      const cycle = freeCycleFrom(nowMs, policy);
      const next = stamped(record, ownerId, { serverName: name, status: 'ACTIVE', cycleTier: 'FREE', policyId: policy.policyId, ...cycle }, nowMs);
      return { ok: true, access: privateServerAccess(next, entitlement, policy, nowMs), record: next, write: true };
    }
    case 'ACTIVE': {
      const current = record as PrivateServerRecord;   // ACTIVE needs a governing cycle, so a record
      const needsFreeCycle = current.cycleTier !== 'FREE' || current.status !== 'ACTIVE';
      if (!needsFreeCycle && !renamed) return { ok: true, access, record: current, write: false };
      const next = needsFreeCycle ? freeRecordOf(current, access, ownerId, policy, nowMs, 'ACTIVE', name) : stamped(current, ownerId, { ...current, serverName: name }, nowMs);
      return { ok: true, access, record: next, write: true };
    }
    case 'CONTINUOUS': {
      const sameCycle = record !== null && record.cycleTier === access.tier && record.status === 'CONTINUOUS' && record.activatedAtMs !== null;
      if (sameCycle && !renamed) return { ok: true, access, record: record as PrivateServerRecord, write: false };
      const next = stamped(
        record,
        ownerId,
        {
          serverName: name,
          status: 'CONTINUOUS',
          cycleTier: access.tier,
          policyId: policy.policyId,
          activatedAtMs: sameCycle ? (record as PrivateServerRecord).activatedAtMs : nowMs,
          activeUntilMs: null,
          cooldownUntilMs: null,
        },
        nowMs,
      );
      return { ok: true, access, record: next, write: true };
    }
  }
}

/** The record with its governing Free cycle written out (a lapsed continuous cycle put on the Free clock), and an observed status. */
function freeRecordOf(record: PrivateServerRecord, access: PrivateServerAccess, ownerId: SocialUserId, policy: PrivateServerPolicy, nowMs: number, status: 'ACTIVE' | 'COOLDOWN', name?: string): PrivateServerRecord {
  const cooldownUntilMs = access.cooldownUntilMs as number;
  const activeUntilMs = cooldownUntilMs - (record.cycleTier === 'FREE' && record.cooldownUntilMs !== null && record.activeUntilMs !== null ? record.cooldownUntilMs - record.activeUntilMs : policy.freeCooldownMs);
  const activatedAtMs = record.cycleTier === 'FREE' && record.activatedAtMs !== null ? record.activatedAtMs : activeUntilMs - policy.freeActiveWindowMs;
  return stamped(
    record,
    ownerId,
    {
      serverName: name ?? record.serverName,
      status,
      cycleTier: 'FREE',
      policyId: record.cycleTier === 'FREE' ? record.policyId : policy.policyId,
      activatedAtMs,
      activeUntilMs,
      cooldownUntilMs,
    },
    nowMs,
  );
}

/** A Free server's window just ended while people were inside: the record of that observation (status COOLDOWN), times unchanged. */
export function observeClosed(record: PrivateServerRecord | null, access: PrivateServerAccess, policy: PrivateServerPolicy, nowMs: number): PrivateServerRecord | null {
  if (record === null || access.status !== 'COOLDOWN' || (record.status === 'COOLDOWN' && record.cycleTier === 'FREE') || cycleNotYetReached(record, nowMs)) return null;
  return freeRecordOf(record, access, record.ownerId, policy, nowMs, 'COOLDOWN');
}

/**
 * What the client is told about the private server it is in (world-presence.ts WorldView).
 *   - The OWNER sees everything: ACTIVE with its closing time, or CONTINUOUS, and their own tier.
 *   - A GUEST sees `OPEN` -- never ACTIVE vs CONTINUOUS, which would say whether the owner pays (review m5) -- and a closing time
 *     only in the server's last GUEST_CLOSING_NOTICE_MS, which is what they need to be warned before it closes. No tier.
 */
export interface PrivateServerLifecycleView {
  readonly status: PrivateServerStatus | 'OPEN';
  /** When the server closes (ISO, server time), or null when nothing is scheduled (continuous) or not yet told (a guest). */
  readonly closesAtIso: string | null;
  /** Milliseconds until it closes, from the server's clock when the view was made; null as for closesAtIso. */
  readonly closesInMs: number | null;
  /** The owner's tier: shown to the owner only. */
  readonly tier: WonderlandServerTier | null;
}

/** How long before a Free server closes its guests are told when (the client warns at 15 and at 5 minutes). */
export const GUEST_CLOSING_NOTICE_MS = 15 * MINUTE_MS;

export function lifecycleViewFor(access: PrivateServerAccess, viewerIsOwner: boolean, nowMs: number): PrivateServerLifecycleView {
  const closesAt = access.status === 'ACTIVE' ? access.activeUntilMs : null;
  const told = closesAt !== null && (viewerIsOwner || closesAt - nowMs <= GUEST_CLOSING_NOTICE_MS) ? closesAt : null;
  return {
    status: viewerIsOwner ? access.status : privateServerIsOpen(access) ? 'OPEN' : access.status,
    closesAtIso: told === null ? null : new Date(told).toISOString(),
    closesInMs: told === null ? null : Math.max(0, told - nowMs),
    tier: viewerIsOwner ? access.tier : null,
  };
}

/**
 * The words a refused open says (shown verbatim by the client: WonderlandSocialLive.cpp ErrorMessageOf). Server time, UTC, rounded
 * UP to the minute, so a retry at the stated time is never refused (the review's NOTE).
 */
export function cooldownMessage(access: PrivateServerAccess): string {
  const until = access.cooldownUntilMs === null ? null : Math.ceil(access.cooldownUntilMs / MINUTE_MS) * MINUTE_MS;
  const at = until === null ? 'later' : `at ${new Date(until).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `Your private server is resting after its free session. It opens again ${at}.`;
}

export const PRIVATE_SERVER_CLOSED_MESSAGE = 'That private server is closed right now.';
