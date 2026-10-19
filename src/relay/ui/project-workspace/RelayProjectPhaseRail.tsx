import { phaseRailSteps, type PhaseRailInput } from './projections';

/**
 * Project phase rail — PLAN → RESEARCH → BUILD → VERIFY → REVIEW → REPAIR →
 * COMPLETE. Only the active phase is highlighted; COMPLETE stays locked
 * while any blocker is open. Pure projection of props — the UI never decides
 * the phase.
 */
export function RelayProjectPhaseRail(input: PhaseRailInput) {
  const steps = phaseRailSteps(input);
  return (
    <ol className="rpw-phase-rail" aria-label="Project phases">
      {steps.map((s) => (
        <li
          key={s.phase}
          className={`rpw-phase rpw-phase--${s.state}`}
          aria-current={s.state === 'active' ? 'step' : undefined}
        >
          <span className="rpw-phase-mark" aria-hidden="true">
            {s.state === 'complete' ? '✓' : s.state === 'locked' ? '⊘' : s.state === 'active' ? '■' : '□'}
          </span>
          <span className="rpw-phase-label">{s.label}</span>
          <span className="rpw-phase-state">{s.state.toUpperCase()}</span>
        </li>
      ))}
    </ol>
  );
}
