import type { ReactNode } from 'react';

import type { MissionError, RelayMissionState } from '../app/contracts';

/**
 * LIVE MISSION CONTROL — the STOP / RETRY control for a REAL mission (Sunday
 * Alcatraz architect → Claude Code, verified by Relay). It only reports intent
 * through callbacks; the backend is the mission authority and the store mirrors
 * its view. Unlike the demo playback, there is no manual ADVANCE — a live
 * mission progresses on its own and the browser polls for the truth.
 *
 * Honest by construction: it shows STOP only while running, RETRY only when the
 * backend reported a retryable failure, and a completion line only for a state
 * the machine actually reached (never a fabricated "verified").
 */

const TERMINAL: RelayMissionState[] = ['verified_complete', 'failed', 'cancelled'];

export function RelayLiveMissionControl({
  state,
  error,
  architectLabel,
  busy = false,
  onStop,
  onRetry,
  runControls,
}: {
  state: RelayMissionState;
  error?: MissionError;
  architectLabel?: string;
  busy?: boolean;
  onStop: () => void;
  onRetry: () => void;
  /** PAUSE / RESUME, rendered beside STOP and RETRY. Optional so every
      existing caller keeps its exact current behavior. */
  runControls?: ReactNode;
}) {
  const running = !TERMINAL.includes(state);
  const complete = state === 'verified_complete';
  const failed = state === 'failed';
  const cancelled = state === 'cancelled';
  return (
    <section className="rpw-playback" aria-label="Live mission control">
      <div className="rpw-playback-head">
        <span className="rpw-playback-tag">LIVE MISSION</span>
        <span className="rpw-playback-note">
          Real Sunday Alcatraz architect → real Claude Code, verified by Relay
          {architectLabel ? ` · ${architectLabel}` : ''}.
        </span>
      </div>
      <div className="rpw-playback-actions">
        {complete && (
          <span className="rpw-playback-done" role="status">
            ✓ VERIFIED — Relay verified the result. This low-risk policy requires no independent review.
          </span>
        )}
        {cancelled && (
          <span className="rpw-playback-done" role="status">
            ■ CANCELLED — the mission was stopped safely. No completion is claimed.
          </span>
        )}
        {failed && (
          <span className="rpw-playback-error" role="alert">
            ✕ STOPPED — {error?.safeMessage ?? 'The mission stopped.'}
          </span>
        )}
        {running && (
          <button type="button" className="rpw-btn" onClick={onStop} disabled={busy} aria-busy={busy}>
            ■ STOP MISSION
          </button>
        )}
        {failed && error?.retryable && (
          <button type="button" className="rpw-btn rpw-btn--primary" onClick={onRetry} disabled={busy}>
            ⟲ RETRY
          </button>
        )}
        {/* PAUSE / RESUME. The controls project their own eligibility from the
            real mission context and render nothing when neither applies, so
            STOP and RETRY behave exactly as before. */}
        {!TERMINAL.includes(state) && runControls}
      </div>
    </section>
  );
}
