/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (UI-side pure helpers).
 *
 * The view contract is THE ONE shared projection in
 * `src/relay/mission/coliseum/duel-results-projection.ts`. This file
 * re-exports those types verbatim and keeps only UI-side pure helpers,
 * typed against the shared contract so the two surfaces cannot drift.
 *
 * Truthfulness rules carried as code:
 * - `null` means Unknown and renders the word "Unknown" — never 0, never a
 *   dash pretending to be a value.
 * - An unbound command has no engine; the console must say so and must never
 *   fabricate a result for it.
 * - Unverified proof entries score 0, visibly.
 */

import { DUEL_COMMAND_NAMES, type DuelCommandName, type ProofEntryView } from '../../mission';

export { DUEL_COMMAND_NAMES } from '../../mission';
export type {
  DuelCommandBindingState,
  DuelCommandName,
  DuelCommandView,
  DuelParticipantKind,
  DuelParticipantResultView,
  DuelResultsView,
  DuelStatusView,
  ProofCategory,
  ProofEntryView,
  VerifiedFixView,
} from '../../mission';

import type {
  DuelParticipantKind,
  DuelResultsView,
  DuelStatusView,
  ProofCategory,
} from '../../mission';

/* ------------------------------------------------------------------ labels */

export const DUEL_STATUS_LABEL: Readonly<Record<DuelStatusView, string>> = Object.freeze({
  challenged: 'Challenged',
  accepted: 'Accepted',
  provisioning: 'Provisioning',
  active: 'Active',
  concluded: 'Concluded',
  aborted: 'Aborted',
});

export const DUEL_MODE_LABEL: Readonly<Record<DuelResultsView['mode'], string>> = Object.freeze({
  manual: 'Manual duel',
  'automation-fight': 'Automation Fight',
});

export const PROOF_CATEGORY_LABEL: Readonly<Record<ProofCategory, string>> = Object.freeze({
  'bug-discovery': 'Bug discovery',
  'reproducible-failure': 'Reproducible failure',
  'repair-accepted': 'Repair accepted',
  'regression-test': 'Regression test',
  'security-finding': 'Security finding',
  'reliability-improvement': 'Reliability improvement',
  'performance-improvement': 'Performance improvement',
  'independent-verification': 'Independent verification',
});

export const DUEL_PARTICIPANT_KIND_LABEL: Readonly<Record<DuelParticipantKind, string>> =
  Object.freeze({
    'compound-agent': 'Compound Agent',
    agent: 'Agent',
    software: 'Software',
    automation: 'Automation',
  });

/* -------------------------------------------------------------- pure helpers */

/**
 * Parse one line of console input into a duel command, or null.
 *
 * Case-insensitive, leading `/` tolerated, arguments after the verb ignored
 * for recognition (they belong to the engine, not the console).
 */
export function parseDuelCommand(text: string): DuelCommandName | null {
  const verb = text.trim().replace(/^\//, '').split(/\s+/)[0]?.toUpperCase() ?? '';
  return (DUEL_COMMAND_NAMES as readonly string[]).includes(verb)
    ? (verb as DuelCommandName)
    : null;
}

/**
 * The verdict line for one proof entry. `points` in the shared contract is
 * ALREADY the domain's scored value (`scoreProofEntry`): an unverified claim
 * arrives as 0, a penalty arrives negative with `verified: false`. The UI
 * never re-scores — it only states what the domain proved.
 */
export function proofEntryVerdict(entry: ProofEntryView): string {
  if (entry.verified) return 'verified';
  return entry.points < 0 ? 'penalty — not verified work' : 'unverified — scores 0';
}

/** A number that may be Unknown, rendered truthfully. */
export function formatMaybe(value: number | null): string {
  return value === null ? 'Unknown' : String(value);
}

/** A signed delta that may be Unknown. Penalties keep their minus sign. */
export function formatDelta(value: number | null): string {
  if (value === null) return 'Unknown';
  return value > 0 ? `+${value}` : String(value);
}
