/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (development fixtures).
 *
 * Simulated data, and it says so: every fixture carries the disclosure label
 * below, and the console renders it whenever a fixture is on screen. Normal
 * production navigation must never load these.
 *
 * The views are DERIVED through the real domain fixtures and the real
 * `projectDuelResults` projection (via the mission barrel), so they can never
 * drift from what the domain would actually produce.
 */

import {
  activeAutomationFightResults,
  challengedDuelResults,
  concludedManualDuelResults,
  type DuelResultsView,
} from '../../mission';

export const COLISEUM_FIXTURE_DISCLOSURE =
  'Development fixture — simulated duel data, not a real Coliseum record.';

/** A duel that has only been challenged: nothing has run, nothing is scored. */
export const CHALLENGED_DUEL_FIXTURE: DuelResultsView = challengedDuelResults();

/** An automation fight mid-flight: nothing verified, nothing measured, no winner. */
export const ACTIVE_AUTOMATION_DUEL_FIXTURE: DuelResultsView = activeAutomationFightResults();

/** A concluded manual duel with a winner, verified work, and an applied fix. */
export const CONCLUDED_MANUAL_DUEL_FIXTURE: DuelResultsView = concludedManualDuelResults();
