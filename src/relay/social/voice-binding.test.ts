import { describe, expect, it } from 'vitest';
import { createInMemoryVoiceBindings, decideVoiceBinding, normalizePuid } from './voice-binding';

/*
 * PARTY VOICE PUID BINDING (R16 EOS voice backend, review #2): a PUID belongs to exactly one signed-in player; the first join
 * binds; another player's PUID is refused; a player's own different PUID re-binds only from a new session.
 */

const NOW = '2026-10-04T08:00:00.000Z';
const P1 = '0123456789abcdef0123456789abcdef';
const P2 = 'fedcba9876543210fedcba9876543210';

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
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('bound');
    expect(await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('same');
    expect(await b.bind({ userId: 'ghu-2', puid: P1, sessionId: 's9', nowIso: NOW })).toBe('refused');
    expect(Object.fromEntries(await b.puidsOf(['ghu-1', 'ghu-2']))).toEqual({ 'ghu-1': P1 });
  });

  it('a player\'s own different PUID re-binds only from a NEW session', async () => {
    const b = createInMemoryVoiceBindings();
    await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW });
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's1', nowIso: NOW })).toBe('refused');
    expect((await b.puidsOf(['ghu-1'])).get('ghu-1')).toBe(P1);
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's2', nowIso: NOW })).toBe('rebound');
    expect((await b.puidsOf(['ghu-1'])).get('ghu-1')).toBe(P2);
    // the released PUID may now be bound by somebody else
    expect(await b.bind({ userId: 'ghu-2', puid: P1, sessionId: 's7', nowIso: NOW })).toBe('bound');
  });

  it("bindingOf and ownerOf read what decideVoiceBinding reads: the caller's binding (PUID, session, when) and who holds a PUID (B1)", async () => {
    const b = createInMemoryVoiceBindings();
    const LATER = '2026-10-04T09:00:00.000Z';
    expect(await b.bindingOf('ghu-1')).toBeNull();
    expect(await b.ownerOf(P1)).toBeNull();
    await b.bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW });
    expect(await b.bindingOf('ghu-1')).toEqual({ userId: 'ghu-1', puid: P1, sessionId: 's1', boundAtIso: NOW });
    expect(await b.ownerOf(P1)).toBe('ghu-1');
    expect(await b.bind({ userId: 'ghu-1', puid: P2, sessionId: 's2', nowIso: LATER })).toBe('rebound');
    expect(await b.bindingOf('ghu-1')).toEqual({ userId: 'ghu-1', puid: P2, sessionId: 's2', boundAtIso: LATER });
    expect([await b.ownerOf(P1), await b.ownerOf(P2)]).toEqual([null, 'ghu-1']);
    // a refused bind changes neither read
    expect(await b.bind({ userId: 'ghu-2', puid: P2, sessionId: 's9', nowIso: LATER })).toBe('refused');
    expect([await b.bindingOf('ghu-2'), await b.ownerOf(P2)]).toEqual([null, 'ghu-1']);
  });

  it('decideVoiceBinding, case by case', () => {
    const mine = { userId: 'u', puid: P1, sessionId: 's1', boundAtIso: NOW };
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's1', mine: null, owner: 'other' })).toBe('refused');
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's1', mine: null, owner: null })).toBe('bound');
    expect(decideVoiceBinding({ userId: 'u', puid: P1, sessionId: 's5', mine, owner: 'u' })).toBe('same');
    expect(decideVoiceBinding({ userId: 'u', puid: P2, sessionId: 's1', mine, owner: null })).toBe('refused');
    expect(decideVoiceBinding({ userId: 'u', puid: P2, sessionId: 's2', mine, owner: null })).toBe('rebound');
  });
});
