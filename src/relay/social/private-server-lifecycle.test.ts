import { describe, expect, it } from 'vitest';
import {
  cleanServerName,
  cooldownMessage,
  effectiveServerTier,
  lapsedCycleRecord,
  FREE_ACTIVE_WINDOW_RANGE_MS,
  FREE_COOLDOWN_RANGE_MS,
  lifecycleViewFor,
  makePrivateServerPolicy,
  observeClosed,
  openPrivateServer,
  PRIVATE_SERVER_POLICY,
  privateServerAccess,
  privateServerIsOpen,
  WONDERLAND_SERVER_TIERS,
  type PrivateServerRecord,
  type ServerEntitlementRow,
} from './private-server-lifecycle';

/*
 * THE FOUNDER'S PRIVATE-SERVER RULES (2026-10-11), on the pure decisions: who may open, for how long, when it rests, and what
 * each tier changes. Server time is the injected millisecond count; nothing a client sends is an input here at all. The store /
 * route suites (private-server-store.test.ts) prove the same rules through the real social operations.
 */

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.parse('2026-10-12T08:00:00.000Z');
const P = PRIVATE_SERVER_POLICY;
const W = P.freeActiveWindowMs;
const C = P.freeCooldownMs;
const OWNER = 'u_owner';
const pro = (from: number, until: number | null = null): ServerEntitlementRow => ({ userId: OWNER, tier: 'PRO', validFromMs: from, validUntilMs: until });
const max = (from: number, until: number | null = null): ServerEntitlementRow => ({ userId: OWNER, tier: 'MAX', validFromMs: from, validUntilMs: until });

/** Open as the owner and return the record the store would persist (asserting the open succeeded). */
function opened(record: PrivateServerRecord | null, tier: ServerEntitlementRow | null, at: number, name = ''): PrivateServerRecord {
  const o = openPrivateServer(record, tier, P, OWNER, name, at);
  if (!o.ok) throw new Error(`open refused at +${(at - T0) / MIN} min: ${o.access.status}`);
  return o.record;
}

describe('the policy: the founder approved RANGES, and the durations live in one place', () => {
  it('PRIVATE_SERVER_POLICY is inside 6-8 h then 4-5 h, and is marked PROPOSED (not frozen) until the founder fixes it', () => {
    expect(W).toBeGreaterThanOrEqual(6 * H);
    expect(W).toBeLessThanOrEqual(8 * H);
    expect(C).toBeGreaterThanOrEqual(4 * H);
    expect(C).toBeLessThanOrEqual(5 * H);
    expect(P.frozen).toBe(false);
    expect(P.policyId).toMatch(/-proposed$/);
    expect(FREE_ACTIVE_WINDOW_RANGE_MS).toEqual({ min: 6 * H, max: 8 * H });
    expect(FREE_COOLDOWN_RANGE_MS).toEqual({ min: 4 * H, max: 5 * H });
  });

  it('a policy outside the approved ranges cannot be made (each bound, and a non-minute value); the bounds themselves can', () => {
    const make = (w: number, c: number) => () => makePrivateServerPolicy({ freeActiveWindowMs: w, freeCooldownMs: c, frozen: true });
    for (const [w, c] of [[6 * H - MIN, 4 * H], [8 * H + MIN, 4 * H], [7 * H, 4 * H - MIN], [7 * H, 5 * H + MIN], [7 * H + 1, 4 * H], [7 * H, Number.NaN], [Number.POSITIVE_INFINITY, 4 * H]]) {
      expect(make(w, c), `${w} / ${c}`).toThrow(RangeError);
    }
    expect(make(6 * H, 4 * H)().policyId).toBe('free-360m-cool-240m');
    expect(make(8 * H, 5 * H)().policyId).toBe('free-480m-cool-300m');
  });

  it('there is NO Team tier: the enum is FREE / PRO / MAX, and a forged "TEAM" row grants nothing', () => {
    expect([...WONDERLAND_SERVER_TIERS]).toEqual(['FREE', 'PRO', 'MAX']);
    const forged = { userId: OWNER, tier: 'TEAM', validFromMs: T0 - H, validUntilMs: null } as unknown as ServerEntitlementRow;
    expect(effectiveServerTier(forged, T0).tier).toBe('FREE');
  });
});

describe('Rule A: every player may open a private server, free', () => {
  it('(1) a FREE player (no tier row at all) opens one: a new Free cycle, fixed from server time, version 1', () => {
    const o = openPrivateServer(null, null, P, OWNER, "Kai's Lab", T0);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.write).toBe(true);
    expect(o.record).toMatchObject({ ownerId: OWNER, serverName: "Kai's Lab", status: 'ACTIVE', cycleTier: 'FREE', policyId: P.policyId, activatedAtMs: T0, activeUntilMs: T0 + W, cooldownUntilMs: T0 + W + C, version: 1 });
    expect(o.access).toEqual({ status: 'ACTIVE', tier: 'FREE', activeUntilMs: T0 + W, cooldownUntilMs: T0 + W + C });
  });

  it('a name is the owner\'s own text, kept with the record; an empty request keeps the stored name, else the neutral one', () => {
    expect(opened(null, null, T0).serverName).toBe('Private server');
    const named = opened(null, null, T0, '  Den  ');
    expect(named.serverName).toBe('Den');
    const again = openPrivateServer(named, null, P, OWNER, '', T0 + MIN);
    expect(again.ok && again.record.serverName).toBe('Den');
    expect(again.ok && again.write).toBe(false); // nothing moved
  });
});

describe('Rule B: the Free active window, on server time', () => {
  it('(2) the window is enforced: open until activeUntil, closed from that millisecond on', () => {
    const r = opened(null, null, T0);
    expect(privateServerAccess(r, null, P, T0 + W - 1).status).toBe('ACTIVE');
    expect(privateServerIsOpen(privateServerAccess(r, null, P, T0 + W - 1))).toBe(true);
    expect(privateServerAccess(r, null, P, T0 + W).status).toBe('COOLDOWN');
    expect(privateServerIsOpen(privateServerAccess(r, null, P, T0 + W))).toBe(false);
  });

  it('(5) coming back during the window does not extend it: leaving and re-opening keeps the SAME activeUntil (no write)', () => {
    const r = opened(null, null, T0);
    for (const later of [MIN, 2 * H, W - MIN]) {
      const o = openPrivateServer(r, null, P, OWNER, '', T0 + later);
      expect(o.ok && o.record.activeUntilMs).toBe(T0 + W);
      expect(o.write).toBe(false);
    }
  });

  it('the window does not pause while the server is empty: it is the clock from activation, whoever is inside', () => {
    const r = opened(null, null, T0);
    // nobody touched it for the whole window: it still closed on time
    expect(privateServerAccess(r, null, P, T0 + W + MIN).status).toBe('COOLDOWN');
  });
});

describe('Rule C: the Free cooldown', () => {
  it('(3) the cooldown is enforced: the owner cannot open it, and the refusal says when it opens again (UTC, server time)', () => {
    const r = opened(null, null, T0);
    const o = openPrivateServer(r, null, P, OWNER, '', T0 + W + MIN);
    expect(o.ok).toBe(false);
    expect(o.access).toEqual({ status: 'COOLDOWN', tier: 'FREE', activeUntilMs: null, cooldownUntilMs: T0 + W + C });
    expect(cooldownMessage(o.access)).toContain(new Date(T0 + W + C).toISOString().slice(0, 16).replace('T', ' '));
    // the last millisecond of the cooldown is still closed; the next opens a NEW cycle from that moment
    expect(openPrivateServer(r, null, P, OWNER, '', T0 + W + C - 1).ok).toBe(false);
    const next = opened(r, null, T0 + W + C);
    expect(next).toMatchObject({ activatedAtMs: T0 + W + C, activeUntilMs: T0 + 2 * W + C, version: 2 });
  });

  it('a refused open never moves the cycle\'s times: only the observed status may be recorded (once)', () => {
    const r = opened(null, null, T0);
    const o = openPrivateServer(r, null, P, OWNER, 'renamed while resting', T0 + W + MIN);
    expect(o.ok).toBe(false);
    expect(o.write).toBe(true);
    expect(o.record).toMatchObject({ status: 'COOLDOWN', activatedAtMs: T0, activeUntilMs: T0 + W, cooldownUntilMs: T0 + W + C, serverName: r.serverName, version: 2 });
    const twice = openPrivateServer(o.record, null, P, OWNER, '', T0 + W + 2 * MIN);
    expect(twice.write).toBe(false);
    // observeClosed agrees, and has nothing to add once recorded
    expect(observeClosed(r, privateServerAccess(r, null, P, T0 + W), P, T0 + W)?.status).toBe('COOLDOWN');
    expect(observeClosed(o.record, privateServerAccess(o.record, null, P, T0 + W), P, T0 + W)).toBeNull();
  });

  it('(6) a decision depends only on the stored times and the SERVER clock: the same record reads the same at the same server time, whatever else', () => {
    const r = opened(null, null, T0);
    // the "client clock" is not an input anywhere; the server clock alone moves the answer
    const at = (ms: number) => privateServerAccess(r, null, P, ms).status;
    // an opening the server has not lived through (beyond the 2-minute NTP tolerance) is CLOSED, never open (review m3)
    expect([at(T0 - H), at(T0 - MIN), at(T0), at(T0 + W), at(T0 + W + C)]).toEqual(['COOLDOWN', 'ACTIVE', 'ACTIVE', 'COOLDOWN', 'READY']);
    expect(privateServerAccess(r, null, P, T0 - H).cooldownUntilMs).toBe(T0); // "closed until it is reached"
    // a running cycle keeps the terms it opened under, even if the policy changes later
    const other = makePrivateServerPolicy({ freeActiveWindowMs: 6 * H, freeCooldownMs: 5 * H, frozen: true });
    expect(privateServerAccess(r, null, other, T0 + 7 * H).status).toBe(privateServerAccess(r, null, P, T0 + 7 * H).status);
  });
});

describe('Rules D / E: PRO and MAX are continuous', () => {
  it('(7) PRO: no window and no cooldown -- open now, open a day later, never closing', () => {
    const r = opened(null, pro(T0 - H), T0);
    expect(r).toMatchObject({ status: 'CONTINUOUS', cycleTier: 'PRO', activeUntilMs: null, cooldownUntilMs: null });
    for (const later of [W, W + C, 24 * H, 30 * 24 * H]) expect(privateServerAccess(r, pro(T0 - H), P, T0 + later).status).toBe('CONTINUOUS');
  });

  it('(8) MAX: the same, and an UPGRADE lifts a Free cooldown at once (the cooldown is a Free rule)', () => {
    const free = opened(null, null, T0);
    const resting = T0 + W + MIN;
    expect(openPrivateServer(free, null, P, OWNER, '', resting).ok).toBe(false);
    const upgraded = openPrivateServer(free, max(resting), P, OWNER, '', resting);
    expect(upgraded.ok).toBe(true);
    expect(upgraded.ok && upgraded.record).toMatchObject({ status: 'CONTINUOUS', cycleTier: 'MAX', activatedAtMs: resting, activeUntilMs: null, cooldownUntilMs: null });
  });

  it('the OWNER sees status, closing time and tier; a GUEST sees OPEN either way (no tier to infer) and the closing time only in the last 15 minutes', () => {
    const r = opened(null, null, T0);
    const a = privateServerAccess(r, null, P, T0 + H);
    expect(lifecycleViewFor(a, true, T0 + H)).toEqual({ status: 'ACTIVE', closesAtIso: new Date(T0 + W).toISOString(), closesInMs: W - H, tier: 'FREE' });
    expect(lifecycleViewFor(a, false, T0 + H)).toEqual({ status: 'OPEN', closesAtIso: null, closesInMs: null, tier: null });
    const late = privateServerAccess(r, null, P, T0 + W - 10 * MIN);
    expect(lifecycleViewFor(late, false, T0 + W - 10 * MIN)).toEqual({ status: 'OPEN', closesAtIso: new Date(T0 + W).toISOString(), closesInMs: 10 * MIN, tier: null });
    const c = privateServerAccess(opened(null, max(T0), T0), max(T0), P, T0);
    expect(lifecycleViewFor(c, true, T0)).toEqual({ status: 'CONTINUOUS', closesAtIso: null, closesInMs: null, tier: 'MAX' });
    // a guest cannot tell a paid server from a Free one far from its end: the two views are identical
    expect(lifecycleViewFor(c, false, T0)).toEqual(lifecycleViewFor(a, false, T0 + H));
  });
});

describe('(9) an expired subscription keeps no unearned entitlement', () => {
  it('a row past valid_until is FREE, and says when it lapsed; a row not yet valid is FREE', () => {
    expect(effectiveServerTier(pro(T0 - 2 * H, T0), T0)).toEqual({ tier: 'FREE', lapsedAtMs: T0 });
    expect(effectiveServerTier(pro(T0 - 2 * H, T0), T0 - 1)).toEqual({ tier: 'PRO', lapsedAtMs: null });
    expect(effectiveServerTier(pro(T0 + H), T0)).toEqual({ tier: 'FREE', lapsedAtMs: null });
  });

  it('a continuous server whose PRO lapsed is on the Free clock FROM THE LAPSE: open for one window after it, then cooling down', () => {
    const lapse = T0 + 10 * H;
    const r = opened(null, pro(T0 - H, lapse), T0);
    expect(privateServerAccess(r, pro(T0 - H, lapse), P, lapse - 1).status).toBe('CONTINUOUS');
    expect(privateServerAccess(r, pro(T0 - H, lapse), P, lapse).status).toBe('ACTIVE');
    expect(privateServerAccess(r, pro(T0 - H, lapse), P, lapse + W).status).toBe('COOLDOWN');
    // staying away after the lapse earns nothing: the window ran on the clock
    const back = openPrivateServer(r, pro(T0 - H, lapse), P, OWNER, '', lapse + W + MIN);
    expect(back.ok).toBe(false);
    // and the conversion is written once, with the window counted from the lapse
    expect(back.record).toMatchObject({ cycleTier: 'FREE', status: 'COOLDOWN', activatedAtMs: lapse, activeUntilMs: lapse + W, cooldownUntilMs: lapse + W + C });
  });

  it('(M1) once a lapse is WRITTEN DOWN (lapsedCycleRecord), deleting the expired row cannot end the cooldown -- unwritten, it could', () => {
    const A = T0;
    const L = T0 + 30 * 24 * H;
    const r = opened(null, pro(A - H, L), A);
    const resting = L + W + H;
    expect(privateServerAccess(r, pro(A - H, L), P, resting).status).toBe('COOLDOWN');
    const written = lapsedCycleRecord(r, pro(A - H, L), P, resting);
    expect(written).toMatchObject({ cycleTier: 'FREE', status: 'COOLDOWN', activatedAtMs: L, activeUntilMs: L + W, cooldownUntilMs: L + W + C, version: r.version + 1 });
    // the row deleted afterwards: the written record still rests; the UNWRITTEN one would read READY (the bug the review found)
    expect(privateServerAccess(written, null, P, resting + MIN).status).toBe('COOLDOWN');
    expect(privateServerAccess(r, null, P, resting + MIN).status).toBe('READY');
    // nothing to write for a Free record, a live paid tier, or no record
    expect(lapsedCycleRecord(written, null, P, resting)).toBeNull();
    expect(lapsedCycleRecord(r, pro(A - H), P, resting)).toBeNull();
    expect(lapsedCycleRecord(null, null, P, resting)).toBeNull();
  });

  it('a REVOKED row (gone altogether) counts from the cycle\'s opening, never moving with the clock', () => {
    const r = opened(null, pro(T0 - H), T0);
    expect(privateServerAccess(r, null, P, T0 + W - 1).status).toBe('ACTIVE');
    expect(privateServerAccess(r, null, P, T0 + W).status).toBe('COOLDOWN');
    // asked again much later it does not restart from "now"
    expect(privateServerAccess(r, null, P, T0 + W + C).status).toBe('READY');
  });
});

describe('records are written by compare-and-set: each change names the version it replaces', () => {
  it('every write bumps the version by one, keeps created_at, and stamps updated_at with server time', () => {
    const a = opened(null, null, T0);
    const b = openPrivateServer(a, null, P, OWNER, 'New name', T0 + MIN);
    expect(b.ok && b.record).toMatchObject({ version: 2, createdAtMs: T0, updatedAtMs: T0 + MIN, activeUntilMs: T0 + W });
  });

  it('a server clock stepped BACK never writes updated_at before created_at, the last update or the cycle\'s opening (037\'s times CHECK)', () => {
    const a = opened(null, null, T0);
    const renamed = openPrivateServer(a, null, P, OWNER, 'Renamed', T0 - 10 * MIN); // the clock went back 10 minutes
    expect(renamed.ok && renamed.write).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.record.updatedAtMs).toBeGreaterThanOrEqual(renamed.record.createdAtMs);
    expect(renamed.record.updatedAtMs).toBeGreaterThanOrEqual(a.updatedAtMs);
    expect(renamed.record.updatedAtMs).toBeGreaterThanOrEqual(renamed.record.activatedAtMs as number);
    // and the decision still reads the cycle's own fixed times, not the stepped clock
    expect(renamed.record.activeUntilMs).toBe(T0 + W);
  });

  it('the refusal\'s reopening time is rounded UP to the minute, so a retry at the stated minute is never refused', () => {
    const r = opened(null, null, T0 + 30_000); // a cycle opened at :30 seconds
    const o = openPrivateServer(r, null, P, OWNER, '', T0 + 30_000 + W + MIN);
    expect(o.ok).toBe(false);
    const stated = new Date(Math.ceil((T0 + 30_000 + W + C) / MIN) * MIN).toISOString().slice(0, 16).replace('T', ' ');
    expect(cooldownMessage(o.access)).toContain(stated);
    expect(openPrivateServer(r, null, P, OWNER, '', Date.parse(`${stated.replace(' ', 'T')}:00.000Z`)).ok).toBe(true);
  });

  it('a name is cut at 60 CODE POINTS (PostgreSQL\'s char_length), never through a surrogate pair', () => {
    const name = `${'a'.repeat(59)}😀😀`;
    const cut = cleanServerName(name);
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut.endsWith('😀')).toBe(true);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/u.test(cut)).toBe(false);
  });

  it('a record that is not the owner\'s is a programming error, never a silent open', () => {
    expect(() => openPrivateServer({ ...opened(null, null, T0), ownerId: 'u_other' }, null, P, OWNER, '', T0)).toThrow();
  });
});
