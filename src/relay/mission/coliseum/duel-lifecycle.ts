/**
 * WONDERLAND COLISEUM — DUEL LIFECYCLE (PURE).
 *
 * challenge → accept → sandbox-provision → active → concluded (or aborted at
 * any pre-concluded point). Every transition is a pure function taking the
 * current record plus an injected ISO timestamp and returning either the next
 * record or a truthful refusal. Nothing here reads a clock or invents state.
 */

import {
  kindsAreCompatible,
  type DuelMode,
  type DuelParticipant,
  type DuelRecord,
} from './duel-contracts';
import { isSandboxProvisioned, type SandboxProvisioned } from './duel-sandbox';

export interface DuelTransitionOk {
  readonly ok: true;
  readonly duel: DuelRecord;
}
export interface DuelTransitionRefused {
  readonly ok: false;
  /** Safe, human-readable. Never a stack trace. */
  readonly reason: string;
}
export type DuelTransitionResult = DuelTransitionOk | DuelTransitionRefused;

const refuse = (reason: string): DuelTransitionRefused => ({ ok: false, reason });

/* ---------------------------------------------------------------- challenge */

export interface ChallengeInput {
  readonly duelId: string;
  readonly mode: DuelMode;
  readonly challenger: DuelParticipant;
  readonly opponent: DuelParticipant;
  readonly at: string;
}

export function createChallenge(input: ChallengeInput): DuelTransitionResult {
  const { challenger, opponent } = input;
  if (challenger.participantId === opponent.participantId) {
    return refuse('a duel needs two distinct participants');
  }
  if (!kindsAreCompatible(challenger.kind, opponent.kind)) {
    return refuse(
      `participant kinds '${challenger.kind}' and '${opponent.kind}' are not duel-compatible`,
    );
  }
  if (input.mode === 'automation-fight') {
    if (challenger.kind !== 'automation' || opponent.kind !== 'automation') {
      return refuse('an automation fight requires BOTH participants to be automations');
    }
  } else if (challenger.kind === 'automation' || opponent.kind === 'automation') {
    return refuse('an automation may only duel in automation-fight mode');
  }
  return {
    ok: true,
    duel: {
      duelId: input.duelId,
      status: 'challenged',
      mode: input.mode,
      participants: [challenger, opponent],
      sandboxes: null,
      winnerParticipantId: null,
      createdAt: input.at,
      updatedAt: input.at,
      abortReason: null,
    },
  };
}

/* ------------------------------------------------------------------- accept */

export function acceptChallenge(duel: DuelRecord, at: string): DuelTransitionResult {
  if (duel.status !== 'challenged') {
    return refuse(`only a challenged duel can be accepted (status is '${duel.status}')`);
  }
  return { ok: true, duel: { ...duel, status: 'accepted', updatedAt: at } };
}

/* ------------------------------------------------------------ provisioning */

export function beginProvisioning(duel: DuelRecord, at: string): DuelTransitionResult {
  if (duel.status !== 'accepted') {
    return refuse(`provisioning starts only from 'accepted' (status is '${duel.status}')`);
  }
  return { ok: true, duel: { ...duel, status: 'provisioning', updatedAt: at } };
}

/**
 * THE SANDBOX GATE. Activation accepts only `SandboxProvisioned` records that
 * pass the module-private registry check — a forged object literal, however
 * perfectly shaped, is refused here. This is the named guarantee that a duel
 * can never target a live/production system.
 */
export function activateDuel(
  duel: DuelRecord,
  sandboxes: readonly [SandboxProvisioned, SandboxProvisioned],
  at: string,
): DuelTransitionResult {
  if (duel.status !== 'provisioning') {
    return refuse(`a duel activates only from 'provisioning' (status is '${duel.status}')`);
  }
  for (const sandbox of sandboxes) {
    if (!isSandboxProvisioned(sandbox)) {
      return refuse(
        'target is not a provisioned sandbox — duels never run against a live target',
      );
    }
  }
  if (sandboxes[0].sandboxCopyId === sandboxes[1].sandboxCopyId) {
    return refuse('each participant needs its own sandbox copy');
  }
  return {
    ok: true,
    duel: {
      ...duel,
      status: 'active',
      sandboxes: [
        {
          sourceTargetRef: sandboxes[0].sourceTargetRef,
          sandboxCopyId: sandboxes[0].sandboxCopyId,
          provisionedAt: sandboxes[0].provisionedAt,
        },
        {
          sourceTargetRef: sandboxes[1].sourceTargetRef,
          sandboxCopyId: sandboxes[1].sandboxCopyId,
          provisionedAt: sandboxes[1].provisionedAt,
        },
      ],
      updatedAt: at,
    },
  };
}

/* ----------------------------------------------------------------- conclude */

export function concludeDuel(
  duel: DuelRecord,
  winnerParticipantId: string | null,
  at: string,
): DuelTransitionResult {
  if (duel.status !== 'active') {
    return refuse(`only an active duel can conclude (status is '${duel.status}')`);
  }
  if (
    winnerParticipantId !== null &&
    !duel.participants.some((p) => p.participantId === winnerParticipantId)
  ) {
    return refuse('the winner must be one of the duel participants');
  }
  return {
    ok: true,
    duel: { ...duel, status: 'concluded', winnerParticipantId, updatedAt: at },
  };
}

/* -------------------------------------------------------------------- abort */

export function abortDuel(duel: DuelRecord, reason: string, at: string): DuelTransitionResult {
  if (duel.status === 'concluded' || duel.status === 'aborted') {
    return refuse(`a ${duel.status} duel cannot be aborted`);
  }
  if (reason.trim() === '') return refuse('an abort needs a stated reason');
  return {
    ok: true,
    duel: { ...duel, status: 'aborted', abortReason: reason, updatedAt: at },
  };
}
