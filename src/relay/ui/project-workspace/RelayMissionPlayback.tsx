import type { RelayMissionState } from '../app/contracts';

/**
 * DEMO MISSION PLAYBACK — a clearly-labeled control for stepping the
 * deterministic sample mission during the founder demonstration. It is
 * honest by construction: it only dispatches ADVANCE/RESTART to the mission
 * machine (the renderer never invents state), it never implies a provider
 * ran, and it only appears for demo missions.
 *
 * State transitions live in the store's mission machine — this component is
 * purely presentational and reports intent through callbacks.
 */

const NEXT_LABEL: Partial<Record<RelayMissionState, string>> = {
  configured: 'START MISSION',
  ready: 'ARCHITECT: PLAN & RESEARCH',
  architect_working: 'PREPARE HANDOFF',
  handoff_ready: 'CODING AGENT: IMPLEMENT',
  coding: 'SUBMIT WORK',
  claim_submitted: 'RELAY: VERIFY',
  relay_verifying: 'REVIEWER: REVIEW',
  reviewer_reviewing: 'RAISE FINDING',
  repair_required: 'AUTHORIZE REPAIR',
  repair_in_progress: 'RELAY: RE-VERIFY',
  re_verifying: 'REVIEWER: APPROVE',
  approved: 'EVALUATE COMPLETION',
};

export function RelayMissionPlayback({
  state,
  busy = false,
  onAdvance,
  onRestart,
}: {
  state: RelayMissionState;
  busy?: boolean;
  onAdvance: () => void;
  onRestart: () => void;
}) {
  const complete = state === 'verified_complete';
  const nextLabel = NEXT_LABEL[state];
  return (
    <section className="rpw-playback" aria-label="Demo mission playback">
      <div className="rpw-playback-head">
        <span className="rpw-playback-tag">DEMO MISSION</span>
        <span className="rpw-playback-note">
          Deterministic sample — no provider runs, no repository changes.
        </span>
      </div>
      <div className="rpw-playback-actions">
        {complete ? (
          <span className="rpw-playback-done" role="status">
            ✓ VERIFIED COMPLETE — Relay evaluated the completion policy.
          </span>
        ) : (
          <button
            type="button"
            className="rpw-btn rpw-btn--primary"
            onClick={onAdvance}
            disabled={busy || !nextLabel}
            aria-busy={busy}
          >
            {busy ? 'ADVANCING…' : `▸ ${nextLabel ?? 'ADVANCE'}`}
          </button>
        )}
        <button
          type="button"
          className="rpw-btn"
          onClick={onRestart}
          disabled={busy}
        >
          ⟲ RESTART DEMO
        </button>
      </div>
    </section>
  );
}
