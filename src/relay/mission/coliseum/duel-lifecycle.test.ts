import { describe, expect, it } from 'vitest';

import {
  DUEL_PARTICIPANT_KINDS,
  kindsAreCompatible,
  type DuelParticipant,
  type DuelParticipantKind,
  type DuelRecord,
} from './duel-contracts';
import { isSandboxProvisioned, provisionSandbox, type SandboxProvisioned } from './duel-sandbox';
import {
  abortDuel,
  acceptChallenge,
  activateDuel,
  beginProvisioning,
  concludeDuel,
  createChallenge,
} from './duel-lifecycle';

const AT = '2026-08-18T10:00:00.000Z';

const participant = (id: string, kind: DuelParticipantKind): DuelParticipant => ({
  participantId: id,
  displayName: id,
  kind,
});

const challenge = (aKind: DuelParticipantKind, bKind: DuelParticipantKind, mode: 'manual' | 'automation-fight' = 'manual') =>
  createChallenge({
    duelId: 'duel-1',
    mode,
    challenger: participant('p1', aKind),
    opponent: participant('p2', bKind),
    at: AT,
  });

function activeDuel(): DuelRecord {
  const c = challenge('agent', 'agent');
  if (!c.ok) throw new Error(c.reason);
  const accepted = acceptChallenge(c.duel, AT);
  if (!accepted.ok) throw new Error(accepted.reason);
  const provisioning = beginProvisioning(accepted.duel, AT);
  if (!provisioning.ok) throw new Error(provisioning.reason);
  const active = activateDuel(
    provisioning.duel,
    [
      provisionSandbox({ sourceTargetRef: 'repo:a', sandboxCopyId: 'sb-a', provisionedAt: AT }),
      provisionSandbox({ sourceTargetRef: 'repo:b', sandboxCopyId: 'sb-b', provisionedAt: AT }),
    ],
    AT,
  );
  if (!active.ok) throw new Error(active.reason);
  return active.duel;
}

describe('kind compatibility', () => {
  // The full mixed-compatibility table, spelled out so a table edit breaks a test.
  const EXPECTED: Record<DuelParticipantKind, Record<DuelParticipantKind, boolean>> = {
    'compound-agent': { 'compound-agent': true, agent: true, software: true, automation: false },
    agent: { 'compound-agent': true, agent: true, software: true, automation: false },
    software: { 'compound-agent': true, agent: true, software: true, automation: false },
    automation: { 'compound-agent': false, agent: false, software: false, automation: true },
  };

  it('same kind is always compatible', () => {
    for (const kind of DUEL_PARTICIPANT_KINDS) {
      expect(kindsAreCompatible(kind, kind)).toBe(true);
    }
  });

  it('matches the mixed table exactly, symmetrically', () => {
    for (const a of DUEL_PARTICIPANT_KINDS) {
      for (const b of DUEL_PARTICIPANT_KINDS) {
        expect(kindsAreCompatible(a, b), `${a} vs ${b}`).toBe(EXPECTED[a][b]);
        expect(kindsAreCompatible(a, b)).toBe(kindsAreCompatible(b, a));
      }
    }
  });

  it('refuses a challenge between incompatible kinds', () => {
    const result = challenge('agent', 'automation');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not duel-compatible');
  });

  it('refuses automation-fight mode unless BOTH sides are automations', () => {
    expect(challenge('agent', 'agent', 'automation-fight').ok).toBe(false);
    expect(challenge('automation', 'automation', 'automation-fight').ok).toBe(true);
  });

  it('refuses an automation dueling in manual mode', () => {
    expect(challenge('automation', 'automation', 'manual').ok).toBe(false);
  });

  it('refuses a duel against oneself', () => {
    const result = createChallenge({
      duelId: 'd',
      mode: 'manual',
      challenger: participant('same', 'agent'),
      opponent: participant('same', 'agent'),
      at: AT,
    });
    expect(result.ok).toBe(false);
  });
});

describe('lifecycle transitions', () => {
  it('walks challenge → accept → provisioning → active → concluded', () => {
    const duel = activeDuel();
    expect(duel.status).toBe('active');
    expect(duel.sandboxes).not.toBeNull();
    const concluded = concludeDuel(duel, 'p1', AT);
    expect(concluded.ok).toBe(true);
    if (concluded.ok) {
      expect(concluded.duel.status).toBe('concluded');
      expect(concluded.duel.winnerParticipantId).toBe('p1');
    }
  });

  it('refuses out-of-order transitions truthfully', () => {
    const c = challenge('agent', 'agent');
    if (!c.ok) throw new Error(c.reason);
    expect(beginProvisioning(c.duel, AT).ok).toBe(false);
    expect(concludeDuel(c.duel, 'p1', AT).ok).toBe(false);
    expect(acceptChallenge(activeDuel(), AT).ok).toBe(false);
  });

  it('refuses a winner who is not a participant, and allows a null (no-winner) conclusion', () => {
    const duel = activeDuel();
    expect(concludeDuel(duel, 'stranger', AT).ok).toBe(false);
    const draw = concludeDuel(duel, null, AT);
    expect(draw.ok).toBe(true);
    if (draw.ok) expect(draw.duel.winnerParticipantId).toBeNull();
  });

  it('aborts with a stated reason from any non-terminal state, never after', () => {
    const c = challenge('agent', 'agent');
    if (!c.ok) throw new Error(c.reason);
    expect(abortDuel(c.duel, '', AT).ok).toBe(false);
    const aborted = abortDuel(c.duel, 'challenger withdrew', AT);
    expect(aborted.ok).toBe(true);
    if (aborted.ok) {
      expect(aborted.duel.abortReason).toBe('challenger withdrew');
      expect(abortDuel(aborted.duel, 'again', AT).ok).toBe(false);
    }
  });
});

describe('THE SANDBOX GUARANTEE — a non-sandboxed target is rejected at validation', () => {
  it('refuses a forged plain-object "sandbox" even when its shape is perfect', () => {
    const c = challenge('agent', 'agent');
    if (!c.ok) throw new Error(c.reason);
    const provisioning = beginProvisioning(acceptOrThrow(c.duel), AT);
    if (!provisioning.ok) throw new Error(provisioning.reason);

    // A live/production target dressed up as a provisioned sandbox: every
    // field present, but it never went through the provisioning step.
    const forged = {
      sourceTargetRef: 'repo:production',
      sandboxCopyId: 'repo:production', // and it IS the live target
      provisionedAt: AT,
    } as unknown as SandboxProvisioned;

    expect(isSandboxProvisioned(forged)).toBe(false);
    const result = activateDuel(
      provisioning.duel,
      [forged, provisionSandbox({ sourceTargetRef: 'repo:b', sandboxCopyId: 'sb-b', provisionedAt: AT })],
      AT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('never run against a live target');
  });

  it('provisioning itself refuses a copy id equal to the live target ref', () => {
    expect(() =>
      provisionSandbox({ sourceTargetRef: 'repo:live', sandboxCopyId: 'repo:live', provisionedAt: AT }),
    ).toThrow(/never runs on the live target/);
  });

  it('refuses two participants sharing one sandbox copy', () => {
    const c = challenge('agent', 'agent');
    if (!c.ok) throw new Error(c.reason);
    const provisioning = beginProvisioning(acceptOrThrow(c.duel), AT);
    if (!provisioning.ok) throw new Error(provisioning.reason);
    const shared = provisionSandbox({ sourceTargetRef: 'repo:a', sandboxCopyId: 'sb-x', provisionedAt: AT });
    const sameId = provisionSandbox({ sourceTargetRef: 'repo:b', sandboxCopyId: 'sb-x', provisionedAt: AT });
    expect(activateDuel(provisioning.duel, [shared, sameId], AT).ok).toBe(false);
  });

  it('a genuinely provisioned record passes the registry check', () => {
    const real = provisionSandbox({ sourceTargetRef: 'repo:a', sandboxCopyId: 'sb-1', provisionedAt: AT });
    expect(isSandboxProvisioned(real)).toBe(true);
    // …and a structural clone of it does NOT — membership is not shape.
    expect(isSandboxProvisioned({ ...real })).toBe(false);
    expect(isSandboxProvisioned(JSON.parse(JSON.stringify(real)))).toBe(false);
  });
});

function acceptOrThrow(duel: DuelRecord): DuelRecord {
  const accepted = acceptChallenge(duel, AT);
  if (!accepted.ok) throw new Error(accepted.reason);
  return accepted.duel;
}
