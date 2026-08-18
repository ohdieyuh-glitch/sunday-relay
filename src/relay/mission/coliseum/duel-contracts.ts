/**
 * WONDERLAND COLISEUM — DUEL CONTRACTS (PURE).
 *
 * The duel domain vocabulary: participants, sandbox provisioning, and the
 * duel record itself. No Node, no network, no clock — time is an injected ISO
 * string, exactly like every other mission domain module.
 *
 * THE SANDBOX GUARANTEE is PER-PROCESS and ACTIVATION-TIME: `activateDuel`
 * and `planAutomationFight` accept only `SandboxProvisioned` records minted
 * by `provisionSandbox` in the current process and checked against its
 * module-private registry — a plain object literal with the same fields is
 * refused there. A DURABLE `DuelRecord` carries only sandbox FACTS
 * (`SandboxFacts` — strings), never the activation capability: a persisted
 * or forged 'active' record cannot reach an executor until a composition
 * root re-provisions its sandboxes in this process.
 *
 * The REAL provisioning mechanism is `src/relay/workspace/worktree-manager.ts`
 * (Node-only, never imported here). This module models the provisioning STEP
 * as a domain fact; a composition root performs the copy and reports back.
 */

/* ------------------------------------------------------------ participants */

export const DUEL_PARTICIPANT_KINDS = [
  'compound-agent',
  'agent',
  'software',
  'automation',
] as const;
export type DuelParticipantKind = (typeof DUEL_PARTICIPANT_KINDS)[number];

export interface DuelParticipant {
  readonly participantId: string;
  readonly displayName: string;
  readonly kind: DuelParticipantKind;
}

/**
 * THE COMPATIBILITY TABLE. Same kind is always compatible. Mixed kinds:
 * agentic kinds (compound-agent, agent) may duel each other and may duel
 * software (probing a system under test is the point of the Coliseum), but
 * NOTHING mixed may duel an automation — an automation duel is an Automation
 * Fight, and that mode requires BOTH sides to run the autonomous loop port.
 */
export const DUEL_KIND_COMPATIBILITY: Readonly<
  Record<DuelParticipantKind, readonly DuelParticipantKind[]>
> = {
  'compound-agent': ['compound-agent', 'agent', 'software'],
  agent: ['agent', 'compound-agent', 'software'],
  software: ['software', 'compound-agent', 'agent'],
  automation: ['automation'],
};

export function kindsAreCompatible(a: DuelParticipantKind, b: DuelParticipantKind): boolean {
  return DUEL_KIND_COMPATIBILITY[a].includes(b);
}

/* -------------------------------------------------------------- duel record */

export const DUEL_STATUSES = [
  'challenged',
  'accepted',
  'provisioning',
  'active',
  'concluded',
  'aborted',
] as const;
export type DuelStatus = (typeof DUEL_STATUSES)[number];

export type DuelMode = 'manual' | 'automation-fight';

/** The provisioning FACTS a duel record carries once its sandboxes exist.
    Serializable — the branded object itself is never persisted. */
export interface SandboxFacts {
  readonly sourceTargetRef: string;
  readonly sandboxCopyId: string;
  readonly provisionedAt: string;
}

export interface DuelRecord {
  readonly duelId: string;
  readonly status: DuelStatus;
  readonly mode: DuelMode;
  readonly participants: readonly [DuelParticipant, DuelParticipant];
  /** null until BOTH sandboxes are provisioned. Truthfully absent, never faked. */
  readonly sandboxes: readonly [SandboxFacts, SandboxFacts] | null;
  readonly winnerParticipantId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Why the duel stopped early, when it did. */
  readonly abortReason: string | null;
}
