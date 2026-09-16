import { describe, expect, it } from 'vitest';
import { createInMemoryDurableBacking } from '../durable/durable-store';
import {
  NEVER_REPLICATED_CONCERNS,
  SHARED_PARTICIPANT_FIELDS,
  WONDERLAND_RECONNECT_WINDOW_MS,
  WONDERLAND_SESSION_MAX_PARTICIPANTS,
  closeWonderlandSession,
  createWonderlandSession,
  createWonderlandSessionStore,
  expireWonderlandReconnects,
  joinWonderlandSession,
  leaveWonderlandSession,
  markWonderlandDisconnected,
  mayActOnBehalfOf,
  moveWonderlandParticipant,
  reconnectToWonderlandSession,
  sealWonderlandSessionToJoins,
  viewWonderlandSession,
  type WonderlandSessionDraft,
} from './index';

const HOST = 'ghu-1001';
const GUEST = 'ghu-2002';
const OUTSIDER = 'ghu-3003';
const T0 = '2026-09-15T12:00:00.000Z';
const T1 = '2026-09-15T12:00:30.000Z';
const LATE = new Date(Date.parse(T0) + WONDERLAND_RECONNECT_WINDOW_MS + 1_000).toISOString();

function session(): WonderlandSessionDraft {
  const made = createWonderlandSession({
    sessionId: 'ses_1',
    hostUserId: HOST,
    hostDisplayName: 'KAI',
    name: 'Beta World',
    createdAtIso: T0,
  });
  if (!made.ok) throw new Error(made.error.message);
  return made.value;
}

function withGuest(): WonderlandSessionDraft {
  const base = session();
  const joined = joinWonderlandSession(base, {
    userId: GUEST,
    displayName: 'JUDITH',
    joinCode: base.joinCode,
    atIso: T0,
  });
  if (!joined.ok) throw new Error(joined.error.message);
  return joined.value;
}

/* ------------------------------------------------------------------------ */

describe('create, join, leave', () => {
  it('seats the host and mints a speakable join code', () => {
    const made = session();
    expect(made.participants).toHaveLength(1);
    expect(made.participants[0]).toMatchObject({ userId: HOST, isHost: true, connection: 'CONNECTED' });
    // No I, O, 0 or 1 — a code that gets read aloud must not be ambiguous.
    expect(made.joinCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('admits a guest holding the code', () => {
    expect(withGuest().participants.map((p) => p.userId)).toEqual([HOST, GUEST]);
  });

  it('refuses a guest with the wrong code', () => {
    const refused = joinWonderlandSession(session(), {
      userId: GUEST, displayName: 'JUDITH', joinCode: 'WRONG1', atIso: T0,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('permission-denied');
  });

  it('treats a second join as a reconnect, never a second body', () => {
    const base = withGuest();
    const again = joinWonderlandSession(base, {
      userId: GUEST, displayName: 'JUDITH', joinCode: base.joinCode, atIso: T1,
    });
    if (!again.ok) throw new Error('rejoin refused');
    expect(again.value.participants.filter((p) => p.userId === GUEST)).toHaveLength(1);
  });

  it('refuses joins once sealed, without ejecting anybody', () => {
    const sealed = sealWonderlandSessionToJoins(withGuest(), HOST, T1);
    if (!sealed.ok) throw new Error('seal refused');
    expect(sealed.value.participants).toHaveLength(2);
    const refused = joinWonderlandSession(sealed.value, {
      userId: OUTSIDER, displayName: 'X', joinCode: sealed.value.joinCode, atIso: T1,
    });
    expect(refused.ok).toBe(false);
  });

  it('holds at most the private-beta ceiling', () => {
    let current = session();
    for (let i = 1; i < WONDERLAND_SESSION_MAX_PARTICIPANTS; i++) {
      const joined = joinWonderlandSession(current, {
        userId: `ghu-${5000 + i}`, displayName: `P${i}`, joinCode: current.joinCode, atIso: T0,
      });
      if (!joined.ok) throw new Error(`join ${i} refused`);
      current = joined.value;
    }
    expect(current.participants).toHaveLength(WONDERLAND_SESSION_MAX_PARTICIPANTS);
    const overflow = joinWonderlandSession(current, {
      userId: 'ghu-9999', displayName: 'Late', joinCode: current.joinCode, atIso: T0,
    });
    expect(overflow.ok).toBe(false);
  });

  it('lets a guest leave themselves and the host remove them', () => {
    expect(leaveWonderlandSession(withGuest(), GUEST, GUEST, T1).ok).toBe(true);
    expect(leaveWonderlandSession(withGuest(), HOST, GUEST, T1).ok).toBe(true);
  });

  it('refuses a guest removing another guest', () => {
    const base = withGuest();
    const joined = joinWonderlandSession(base, {
      userId: OUTSIDER, displayName: 'T', joinCode: base.joinCode, atIso: T0,
    });
    if (!joined.ok) throw new Error('join refused');
    const refused = leaveWonderlandSession(joined.value, GUEST, OUTSIDER, T1);
    expect(refused.ok).toBe(false);
  });
});

describe('a disconnection is not a departure', () => {
  it('holds the slot and marks RECONNECTING', () => {
    const dropped = markWonderlandDisconnected(withGuest(), GUEST, T0);
    if (!dropped.ok) throw new Error('disconnect refused');
    const guest = dropped.value.participants.find((p) => p.userId === GUEST);
    expect(guest?.connection).toBe('RECONNECTING');
    expect(dropped.value.participants).toHaveLength(2);
    expect(guest?.reconnectDeadlineIso).not.toBeNull();
  });

  it('restores the player where they were, with their standing unchanged', () => {
    const moved = moveWonderlandParticipant(withGuest(), GUEST, { x: 5, y: 6, z: 7, yawDegrees: 90 }, T0);
    if (!moved.ok) throw new Error('move refused');
    const dropped = markWonderlandDisconnected(moved.value, GUEST, T0);
    if (!dropped.ok) throw new Error('disconnect refused');
    const back = reconnectToWonderlandSession(dropped.value, GUEST, T1);
    if (!back.ok) throw new Error('reconnect refused');

    const guest = back.value.participants.find((p) => p.userId === GUEST);
    expect(guest?.connection).toBe('CONNECTED');
    expect(guest?.transform).toEqual({ x: 5, y: 6, z: 7, yawDegrees: 90 });
    // A reconnect must not be a route to claiming standing you did not have.
    expect(guest?.isHost).toBe(false);
  });

  it('refuses a reconnect after the window has passed', () => {
    const dropped = markWonderlandDisconnected(withGuest(), GUEST, T0);
    if (!dropped.ok) throw new Error('disconnect refused');
    expect(reconnectToWonderlandSession(dropped.value, GUEST, LATE).ok).toBe(false);
  });

  it('releases an expired slot only when asked', () => {
    const dropped = markWonderlandDisconnected(withGuest(), GUEST, T0);
    if (!dropped.ok) throw new Error('disconnect refused');
    expect(expireWonderlandReconnects(dropped.value, T1).participants).toHaveLength(2);
    expect(expireWonderlandReconnects(dropped.value, LATE).participants).toHaveLength(1);
  });

  it('refuses a reconnect to a closed session', () => {
    const closed = closeWonderlandSession(withGuest(), HOST, T1);
    if (!closed.ok) throw new Error('close refused');
    expect(reconnectToWonderlandSession(closed.value, GUEST, T1).ok).toBe(false);
  });
});

describe('ADVERSARIAL — co-presence grants nothing', () => {
  const base = withGuest();

  it('never lets one account act for another, not even the host', () => {
    expect(mayActOnBehalfOf(base, HOST, HOST)).toBe(true);
    expect(mayActOnBehalfOf(base, GUEST, GUEST)).toBe(true);
    // Hosting a world is not owning the people in it.
    expect(mayActOnBehalfOf(base, HOST, GUEST)).toBe(false);
    expect(mayActOnBehalfOf(base, GUEST, HOST)).toBe(false);
    expect(mayActOnBehalfOf(base, OUTSIDER, GUEST)).toBe(false);
  });

  it('offers no way at all to move another player', () => {
    // `moveWonderlandParticipant` takes the ACTOR and moves the actor. There is
    // no target parameter, so moving somebody else is not expressible.
    const moved = moveWonderlandParticipant(base, GUEST, { x: 1, y: 1, z: 1, yawDegrees: 0 }, T1);
    if (!moved.ok) throw new Error('move refused');
    const host = moved.value.participants.find((p) => p.userId === HOST);
    expect(host?.transform).toEqual({ x: 0, y: 0, z: 0, yawDegrees: 0 });
  });

  it('refuses movement from a non-participant', () => {
    expect(moveWonderlandParticipant(base, OUTSIDER, { x: 1, y: 1, z: 1, yawDegrees: 0 }, T1).ok).toBe(false);
  });

  it('refuses sealing and closing to anybody but the host', () => {
    expect(sealWonderlandSessionToJoins(base, GUEST, T1).ok).toBe(false);
    expect(closeWonderlandSession(base, GUEST, T1).ok).toBe(false);
    expect(closeWonderlandSession(base, OUTSIDER, T1).ok).toBe(false);
  });

  it('refuses an outsider any view of the session', () => {
    expect(viewWonderlandSession(base, OUTSIDER).ok).toBe(false);
  });
});

describe('REPLICATION IS NOT AUTHORIZATION', () => {
  const base = withGuest();

  it('shows a peer only the shared fields, and nothing else', () => {
    const view = viewWonderlandSession(base, GUEST);
    if (!view.ok) throw new Error('view refused');
    for (const participant of view.value.participants) {
      expect([...Object.keys(participant)].sort()).toEqual([...SHARED_PARTICIPANT_FIELDS].sort());
    }
  });

  it('withholds private participant fields from the wire', () => {
    const view = viewWonderlandSession(base, GUEST);
    if (!view.ok) throw new Error('view refused');
    const wire = JSON.stringify(view.value);
    for (const hidden of ['joinedAtIso', 'lastSeenAtIso', 'reconnectDeadlineIso']) {
      expect(wire, `${hidden} reached a peer`).not.toContain(hidden);
    }
  });

  it('gives the join code to the host only', () => {
    const hostView = viewWonderlandSession(base, HOST);
    const guestView = viewWonderlandSession(base, GUEST);
    if (!hostView.ok || !guestView.ok) throw new Error('view refused');
    expect(hostView.value.joinCode).toBe(base.joinCode);
    // A guest who could read the code could invite, which the host never granted.
    expect(guestView.value.joinCode).toBeNull();
  });

  it('carries none of the concerns that must never be replicated', () => {
    const wire = JSON.stringify(base);
    for (const concern of NEVER_REPLICATED_CONCERNS) {
      expect(wire, `a session record carries ${concern}`).not.toContain(concern);
    }
  });

  it('keeps the session record free of project, creation and wallet state', () => {
    // The record holds bodies and names. Anything else would be replicated the
    // moment somebody built a view over it.
    const participantKeys = Object.keys(base.participants[0]);
    for (const forbidden of ['projectId', 'creationId', 'missionId', 'wallet', 'balance', 'token']) {
      expect(participantKeys.join(','), `participant carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('builds the view by allowlist, so a new private field stays private', () => {
    // A field added to the record but not to SHARED_PARTICIPANT_FIELDS must not
    // appear. Simulated here by adding one to a copy.
    const contaminated: WonderlandSessionDraft = {
      ...base,
      participants: base.participants.map((p) => ({ ...p, secretNote: 'do not replicate' } as typeof p)),
    };
    const view = viewWonderlandSession(contaminated, GUEST);
    if (!view.ok) throw new Error('view refused');
    expect(JSON.stringify(view.value)).not.toContain('do not replicate');
  });
});

describe('a session is durable, so a reconnect can outlive the process', () => {
  it('reads back and resolves a join code', async () => {
    const store = createWonderlandSessionStore(createInMemoryDurableBacking());
    await store.write(withGuest());

    const found = await store.read('ses_1');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.record.participants).toHaveLength(2);

    const byCode = await store.findByJoinCode(found.record.joinCode);
    expect(byCode?.sessionId).toBe('ses_1');
  });

  it('does not resolve the code of a closed session', async () => {
    const store = createWonderlandSessionStore(createInMemoryDurableBacking());
    const closed = closeWonderlandSession(withGuest(), HOST, T1);
    if (!closed.ok) throw new Error('close refused');
    await store.write(closed.value);
    expect(await store.findByJoinCode(closed.value.joinCode)).toBeNull();
  });

  it('never reads a corrupt session as an empty world', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createWonderlandSessionStore(backing);
    await store.write(withGuest());
    const key = (await backing.listKeys())[0];
    const tampered = JSON.parse((await backing.getText(key)) as string);
    tampered.participants = [];
    await backing.putText(key, JSON.stringify(tampered));

    const read = await store.read('ses_1');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('corrupt');
  });
});
