/**
 * WONDERLAND COLISEUM — FIXTURES (PURE, DETERMINISTIC).
 *
 * Realistic, TRUTHFUL fixtures for tests and for WP-2's UI work: nulls where
 * a value is genuinely unknown, sandboxes only where provisioning actually
 * happened in the story, and results derived through the real projection so
 * fixtures can never drift from the contract.
 */

import type { DuelRecord } from './duel-contracts';
import type { ProofEntry } from './proof-meter';
import {
  projectDuelResults,
  type DuelResultsView,
  type VerifiedFixFact,
} from './duel-results-projection';

/* -------------------------------------------------- concluded manual duel */

export const CONCLUDED_MANUAL_DUEL: DuelRecord = {
  duelId: 'duel-fixture-concluded-1',
  status: 'concluded',
  mode: 'manual',
  participants: [
    { participantId: 'agent-aria', displayName: 'Aria', kind: 'compound-agent' },
    { participantId: 'sw-ledger', displayName: 'Ledger Service', kind: 'software' },
  ],
  sandboxes: [
    {
      sourceTargetRef: 'repo:aria-stack@main',
      sandboxCopyId: 'sandbox-aria-001',
      provisionedAt: '2026-08-17T10:00:00.000Z',
    },
    {
      sourceTargetRef: 'repo:ledger-service@main',
      sandboxCopyId: 'sandbox-ledger-001',
      provisionedAt: '2026-08-17T10:00:05.000Z',
    },
  ],
  winnerParticipantId: 'agent-aria',
  createdAt: '2026-08-17T09:45:00.000Z',
  updatedAt: '2026-08-17T12:30:00.000Z',
  abortReason: null,
};

export const CONCLUDED_MANUAL_PROOF_ENTRIES: Readonly<Record<string, readonly ProofEntry[]>> = {
  'agent-aria': [
    {
      entryId: 'proof-1',
      category: 'bug-discovery',
      submitterId: 'agent-aria',
      summary: 'Ledger rounds half-cents toward zero on refunds',
      verification: 'verified-true',
      verifierId: 'reviewer-hermes',
      brokeSandbox: false,
    },
    {
      entryId: 'proof-2',
      category: 'repair-accepted',
      submitterId: 'agent-aria',
      summary: 'Banker-rounding repair applied to the opponent sandbox',
      verification: 'verified-true',
      verifierId: 'reviewer-hermes',
      brokeSandbox: false,
    },
    {
      entryId: 'proof-3',
      category: 'performance-improvement',
      submitterId: 'agent-aria',
      summary: 'Claimed 2x speedup on ledger replay — not yet verified',
      verification: 'unverified',
      verifierId: null,
      brokeSandbox: false,
    },
  ],
  'sw-ledger': [
    {
      entryId: 'proof-4',
      category: 'reproducible-failure',
      submitterId: 'sw-ledger',
      summary: 'Aria stack deadlocks on concurrent duel commands',
      verification: 'verified-true',
      verifierId: 'reviewer-hermes',
      brokeSandbox: false,
    },
  ],
};

export const CONCLUDED_MANUAL_VERIFIED_FIXES: readonly VerifiedFixFact[] = [
  {
    id: 'fix-1',
    summary: 'Banker rounding on refund paths',
    targetParticipantId: 'sw-ledger',
    authorParticipantId: 'agent-aria',
    appliedState: 'applied',
    // Applied AND independently verified — this is what legitimately earns
    // the opponent-fix bonus in the concluded fixture.
    verifierId: 'reviewer-hermes',
  },
];

export const concludedManualDuelResults = (): DuelResultsView =>
  projectDuelResults({
    duel: CONCLUDED_MANUAL_DUEL,
    proofEntries: CONCLUDED_MANUAL_PROOF_ENTRIES,
    measurements: {
      'agent-aria': { evaluationQuality: 0.82, reliabilityDelta: null, performanceDelta: null },
      // The service side was not measured — unknown stays null.
    },
    verifiedFixes: CONCLUDED_MANUAL_VERIFIED_FIXES,
  });

/* ------------------------------------------------ active automation fight */

export const ACTIVE_AUTOMATION_FIGHT: DuelRecord = {
  duelId: 'duel-fixture-automation-1',
  status: 'active',
  mode: 'automation-fight',
  participants: [
    { participantId: 'auto-red', displayName: 'Red Loop', kind: 'automation' },
    { participantId: 'auto-blue', displayName: 'Blue Loop', kind: 'automation' },
  ],
  sandboxes: [
    {
      sourceTargetRef: 'repo:red-target@main',
      sandboxCopyId: 'sandbox-red-001',
      provisionedAt: '2026-08-18T08:00:00.000Z',
    },
    {
      sourceTargetRef: 'repo:blue-target@main',
      sandboxCopyId: 'sandbox-blue-001',
      provisionedAt: '2026-08-18T08:00:02.000Z',
    },
  ],
  winnerParticipantId: null,
  createdAt: '2026-08-18T07:50:00.000Z',
  updatedAt: '2026-08-18T08:05:00.000Z',
  abortReason: null,
};

export const activeAutomationFightResults = (): DuelResultsView =>
  projectDuelResults({
    duel: ACTIVE_AUTOMATION_FIGHT,
    // Mid-fight: nothing verified yet, nothing measured yet — all truthfully empty/null.
    proofEntries: {},
    measurements: {},
    verifiedFixes: [],
  });

/* ------------------------------------------------------- challenged duel */

export const CHALLENGED_DUEL: DuelRecord = {
  duelId: 'duel-fixture-challenged-1',
  status: 'challenged',
  mode: 'manual',
  participants: [
    { participantId: 'agent-kestrel', displayName: 'Kestrel', kind: 'agent' },
    { participantId: 'agent-brook', displayName: 'Brook', kind: 'agent' },
  ],
  sandboxes: null, // nothing provisioned yet — never faked
  winnerParticipantId: null,
  createdAt: '2026-08-18T09:00:00.000Z',
  updatedAt: '2026-08-18T09:00:00.000Z',
  abortReason: null,
};

export const challengedDuelResults = (): DuelResultsView =>
  projectDuelResults({
    duel: CHALLENGED_DUEL,
    proofEntries: {},
    measurements: {},
    verifiedFixes: [],
  });
