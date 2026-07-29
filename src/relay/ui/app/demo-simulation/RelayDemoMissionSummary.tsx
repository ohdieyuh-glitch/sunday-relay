import { useState } from 'react';
import { RELAY_DEMO_SCRIPT } from './demo-simulation-script';
import type { RelayDemoSimulationState } from './demo-simulation-types';
import './relay-demo-workspace.css';

export function RelayDemoMissionSummary({ state }: { state: RelayDemoSimulationState }) {
  const [expanded, setExpanded] = useState(true);
  const step = RELAY_DEMO_SCRIPT[state.currentStepIndex];
  const bodyId = 'relay-demo-mission-summary-body';
  const complete = state.status === 'complete';

  return (
    <section className={`rdm${expanded ? '' : ' rdm--collapsed'}`} aria-label="Demo Mission summary">
      <header className="rdm-head">
        <div className="rdm-title">
          <strong>DEMO MISSION · {complete ? 'DEMO VERIFIED COMPLETE' : step.label}</strong>
          <span>DEMO SIMULATION · NO PROVIDER CALLS</span>
        </div>
        <button
          type="button"
          className="rdm-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? 'Minimize Demo Mission' : 'Expand Demo Mission'}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      </header>
      {expanded && (
        <div className="rdm-body" id={bodyId}>
          <div>
            <span className="rdm-key">FOUNDER REQUEST</span>
            <p>Implement <code>normalizeProjectName</code> with trimmed, lowercase, hyphen-separated output.</p>
          </div>
          <div>
            <span className="rdm-key">CURRENT COORDINATION</span>
            <p>{step.headline} — {step.summary}</p>
          </div>
          <ul>
            {step.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
          {state.currentStepIndex >= 7 && (
            <p className="rdm-finding">
              F-1 · Repeated hyphens are not collapsed · {state.currentStepIndex >= 11 ? 'RESOLVED ON demo-r2' : 'REVISION REQUIRED'}
            </p>
          )}
          {complete && (
            <p className="rdm-complete">
              DEMO VERIFIED COMPLETE · scope preserved · simulated evidence present · Hermes approved demo-r2
            </p>
          )}
        </div>
      )}
    </section>
  );
}
