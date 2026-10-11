import { describe, expect, it } from 'vitest';
import { createInMemoryVoiceBindings, decideVoiceBinding, normalizePuid } from './voice-binding';

/*
 * PARTY VOICE PUID BINDING (R16 EOS voice backend, review #2): a PUID belongs to exactly one signed-in player; the first join
 * binds; another player's PUID is refused; a player's own different PUID re-binds only from a newer session.
 */

const NOW = '2026-10-04T08:00:00.000Z';
const P1 = '0123456789abcdef0123456789abcdef';
const P2 = 'fedcba9876543210fedcba9876543210';
/** A caller whose session issue time nobody knows, on a server whose sessions cannot be looked up: said out loud, never omitted. */
const UNKNOWN = { sessionIssuedAtIso: null, sessionIssuedAtOf: null } as const;

describe('the PUID shape', () => {
  it('accepts 32 hex characters in either case and stores them lowercase; refuses anything else', () => {
    expect(normalizePuid(P1.toUpperCase())).toBe(P1);
    expect(normalizePuid(` ${P1} `)).toBe(P1);
    for (const bad of [P1.slice(1), `${P1}0`, 'g'.repeat(32), `${P1.slice(0, 31)}/`, 12, null, undefined]) expect(normalizePuid(bad), String(bad)).toBeNull();
  });
});

describe('the binding rule (memory store; the PostgreSQL store applies the same decideVoiceBinding)', () => {
  it('first join binds; the same PUID again is "same"; another player\'s PUID is refused', async () => {
    const b = createInMemoryVoiceBindings();
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', ...UNKNOWN, nowIso: NOW })).toBe('bound');
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', ...UNKNOWN, nowIso: NOW })).toBe('same');
    expect(await b.bind({ userId: 'ghu-2', puid: P1, sessionId: 's9', ...UNKNOWN, nowIso: NOW })).toBe('refused');
    expect(Object.fromEntries(await b.puidsOf(['ghu-1', 'ghu-2']))).toEqual({ 'ghu-1': P1 });
  });

  it('a player\'s own different PUID re-binds only from ANOTHER session (the issue times unknown: the dev server\'s fallback)', async () => {
    const b = createInMemoryVoiceBindings();
    await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', ...UNKNOWN, nowIso: NOW });
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's1', ...UNKNOWN, nowIso: NOW })).toBe('refused');
    expect((await b.puidsOf(['ghu-1'])).get('ghu-1')).toBe(P1);
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's2', ...UNKNOWN, nowIso: NOW })).toBe('rebound');
    expect((await b.puidsOf(['ghu-1'])).get('ghu-1')).toBe(P2);
    // the released PUID may now be bound by somebody else
    expect(await b.bind({ userId: 'ghu-2', puid: P1, sessionId: 's7', ...UNKNOWN, nowIso: NOW })).toBe('bound');
  });

  it("bindingOf and ownerOf read what decideVoiceBinding reads: the caller's binding (PUID, session, when) and who holds a PUID (B1)", async () => {
    const b = createInMemoryVoiceBindings();
    const LATER = '2026-10-04T09:00:00.000Z';
    expect(await b.bindingOf('ghu-1')).toBeNull();
    expect(await b.ownerOf(P1)).toBeNull();
    await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', ...UNKNOWN, nowIso: NOW });
    expect(await b.bindingOf('ghu-1')).toEqual({ userId: 'ghu-1', puid: P1, sessionId: 's1', boundAtIso: NOW });
    expect(await b.ownerOf(P1)).toBe('ghu-1');
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's2', ...UNKNOWN, nowIso: LATER })).toBe('rebound');
    expect(await b.bindingOf('ghu-1')).toEqual({ userId: 'ghu-1', puid: P2, sessionId: 's2', boundAtIso: LATER });
    expect([await b.ownerOf(P1), await b.ownerOf(P2)]).toEqual([null, 'ghu-1']);
    // a refused bind changes neither read
    expect(await b.bind({ userId: 'ghu-2', puid: P2, sessionId: 's9', ...UNKNOWN, nowIso: LATER })).toBe('refused');
    expect([await b.bindingOf('ghu-2'), await b.ownerOf(P2)]).toEqual([null, 'ghu-1']);
  });

  it('NEWEST SESSION WINS, when the session store cannot answer (m3): bound_at stands in for the binding session', async () => {
    const b = createInMemoryVoiceBindings();
    const T0 = '2026-10-04T08:00:00.000Z';
    const T1 = '2026-10-04T09:00:00.000Z';
    const T2 = '2026-10-04T10:00:00.000Z';
    // s-old was issued at T0, s-new at T2; the first binding is made at T1 by s-old.
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's-old', sessionIssuedAtIso: T0, sessionIssuedAtOf: null, nowIso: T1 })).toBe('bound');
    // a NEWER session (issued after the binding) re-binds
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's-new', sessionIssuedAtIso: T2, sessionIssuedAtOf: null, nowIso: T2 })).toBe('rebound');
    // the OLDER live session asking for its PUID back is refused, and the binding stays the newer one's
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's-old', sessionIssuedAtIso: T0, sessionIssuedAtOf: null, nowIso: T2 })).toBe('refused');
    expect(Object.fromEntries(await b.puidsOf(['ghu-1']))).toEqual({ 'ghu-1': P2 });
    // a session issued exactly at the binding's time is not newer: refused
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's2', sessionIssuedAtIso: T1, sessionIssuedAtOf: null, owner: null,
      mine: { userId: 'u', puid: P2, sessionId: 's1', boundAtIso: T1 } })).toBe('refused');
    // unknown issue time (the dev server): another session suffices, as before
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's2', ...UNKNOWN, owner: null,
      mine: { userId: 'u', puid: P2, sessionId: 's1', boundAtIso: T1 } })).toBe('rebound');
    // the same session never re-binds, whatever its issue time
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's1', sessionIssuedAtIso: T2, sessionIssuedAtOf: null, owner: null,
      mine: { userId: 'u', puid: P2, sessionId: 's1', boundAtIso: T1 } })).toBe('refused');
  });

  it("NEWEST SESSION WINS, by the session store (MAIN's internal review af2eb058, m-d): the binding's SESSION is compared while it lives; once it is gone, the binding yields", () => {
    const T0 = Date.parse('2026-10-04T08:00:00.000Z');
    const iso = (ms: number) => new Date(ms).toISOString();
    // the binding was made at T0 + 60 min by session s1, which was issued at T0
    const mine = { userId: 'u', puid: P2, sessionId: 's1', boundAtIso: iso(T0 + 3_600_000) };
    const live = new Map<string, number>([['s1', T0]]);
    const lookup = (id: string): number | null => live.get(id) ?? null;
    const decide = (sessionId: string, issuedMs: number | null, of: ((id: string) => number | null) | null = lookup) =>
      decideVoiceBinding({ userId: 'u', puid: P1, sessionId, sessionIssuedAtIso: issuedMs === null ? null : iso(issuedMs), sessionIssuedAtOf: of, mine, owner: null });
    // THE m-d CASE: s2 signed in at T0 + 1 min -- after s1, but BEFORE s1's first join made the binding -- and wins
    expect(decide('s2', T0 + 60_000)).toBe('rebound');
    // ... where comparing with bound_at (a store that cannot answer) refuses it until it signs in again
    expect(decide('s2', T0 + 60_000, null)).toBe('refused');
    // an OLDER live session is refused; one issued at the same instant is not newer
    expect(decide('s0', T0 - 60_000)).toBe('refused');
    expect(decide('s3', T0)).toBe('refused');
    // the binding's session is GONE (expired, revoked, a restart): another session of the player re-binds, an older one included
    live.delete('s1');
    expect(decide('s0', T0 - 60_000)).toBe('rebound');
    live.set('s1', T0);
    // unknown caller issue time: another session suffices; the same session never re-binds, whatever the store says
    expect(decide('s2', null)).toBe('rebound');
    expect(decide('s1', T0 + 120_000)).toBe('refused');
    // a time nobody can read, on either side, is refused
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's2', sessionIssuedAtIso: 'not a time', sessionIssuedAtOf: lookup, mine, owner: null })).toBe('refused');
    expect(decide('s2', T0 + 60_000, () => Number.NaN)).toBe('refused');
    // the rule never asks about anyone's session but the binding's
    const asked: string[] = [];
    decide('s2', T0 + 60_000, (id) => { asked.push(id); return lookup(id); });
    expect(asked).toEqual(['s1']);
  });

  it('the stores apply it: an older live session cannot take the binding back; once the newer one is gone, it can', async () => {
    const b = createInMemoryVoiceBindings();
    const T0 = Date.parse('2026-10-04T08:00:00.000Z');
    const iso = (ms: number) => new Date(ms).toISOString();
    const live = new Map<string, number>([['old', T0], ['new', T0 + 1000]]);
    const of = (id: string): number | null => live.get(id) ?? null;
    // both sessions signed in before either joined; the OLDER one joins first
    expect(await b.bind({ userId: 'u', puid: P1, sessionId: 'old', sessionIssuedAtIso: iso(T0), sessionIssuedAtOf: of, nowIso: iso(T0 + 60_000) })).toBe('bound');
    expect(await b.bind({ userId: 'u', puid: P2, sessionId: 'new', sessionIssuedAtIso: iso(T0 + 1000), sessionIssuedAtOf: of, nowIso: iso(T0 + 61_000) })).toBe('rebound');
    expect(await b.bind({ userId: 'u', puid: P1, sessionId: 'old', sessionIssuedAtIso: iso(T0), sessionIssuedAtOf: of, nowIso: iso(T0 + 62_000) })).toBe('refused');
    expect((await b.bindingOf('u'))?.puid).toBe(P2);
    live.delete('new'); // signed out
    expect(await b.bind({ userId: 'u', puid: P1, sessionId: 'old', sessionIssuedAtIso: iso(T0), sessionIssuedAtOf: of, nowIso: iso(T0 + 63_000) })).toBe('rebound');
    expect(await b.bindingOf('u')).toEqual({ userId: 'u', puid: P1, sessionId: 'old', boundAtIso: iso(T0 + 63_000) });
  });

  it('decideVoiceBinding, case by case', () => {
    const mine = { userId: 'u', puid: P1, sessionId: 's1', boundAtIso: NOW };
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's1', ...UNKNOWN, mine: null, owner: 'other' })).toBe('refused');
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's1', ...UNKNOWN, mine: null, owner: null })).toBe('bound');
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's5', ...UNKNOWN, mine, owner: 'u' })).toBe('same');
    expect(decideVoiceBinding({ userId: 'u', puid: P2, sessionId: 's1', ...UNKNOWN, mine, owner: null })).toBe('refused');
    expect(decideVoiceBinding({ userId: 'u', puid: P2, sessionId: 's2', ...UNKNOWN, mine, owner: null })).toBe('rebound');
  });
});
