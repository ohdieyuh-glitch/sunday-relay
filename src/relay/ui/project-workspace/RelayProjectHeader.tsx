import { RelayDogMark } from '../pixel-dog';
import { OUTPUT_STATE_LABEL } from './projections';
import type { WorkspaceOutputState, WorkspaceProject } from './contracts';

/**
 * Top application frame — founder-screenshot language: pixel dog mark +
 * letterspaced SUNDAY RELAY at left, project identity with the outlined
 * [ RLY / 001 ] chip in the center, system controls at right. No marketing
 * navigation — the developer is inside the product.
 */
export function RelayProjectHeader({
  project,
  outputState,
  openManualTasks,
  onReturnHome,
  onOpenProjectSettings,
  onOpenTerminal,
}: {
  project: WorkspaceProject;
  outputState: WorkspaceOutputState;
  openManualTasks: number;
  onReturnHome: () => void;
  onOpenProjectSettings: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <header className="rpw-header">
      <div className="rpw-header-left">
        <RelayDogMark unit={3} />
        <span className="rpw-wordmark" aria-label="SUNDAY RELAY">
          <span className="rpw-wordmark-sunday" aria-hidden="true">SUNDAY</span>{' '}
          <span className="rpw-wordmark-relay" aria-hidden="true">RELAY</span>
        </span>
        <button type="button" className="rpw-switch-btn" onClick={onReturnHome}>
          ← RELAY HOME
        </button>
      </div>

      <div className="rpw-header-project" aria-label="Active project">
        <span className="rpw-proj-name">{project.name}</span>
        <span className="rpw-ref-chip">{project.reference}</span>
        <span className={`rpw-val rpw-state rpw-state--${outputState}`}>
          {OUTPUT_STATE_LABEL[outputState]}
        </span>
      </div>

      <div className="rpw-header-right">
        <button type="button" className="rpw-head-btn" onClick={onOpenProjectSettings}>
          PROJECT SETTINGS
        </button>
        <button type="button" className="rpw-term-btn" onClick={onOpenTerminal} aria-label="Open Live Terminal">
          <span aria-hidden="true">&gt;_</span>
          <span className="rpw-term-btn-label">LIVE TERMINAL</span>
        </button>
        <span
          className={`rpw-mt-indicator${openManualTasks > 0 ? ' has-tasks' : ''}`}
          aria-label={`${openManualTasks} open manual task${openManualTasks === 1 ? '' : 's'}`}
        >
          MT / {openManualTasks}
        </span>
        <button type="button" className="rpw-icon-btn" aria-label="Notifications — none">
          <span aria-hidden="true">◷</span>
        </button>
        <button type="button" className="rpw-icon-btn" aria-label="Your profile">
          <span aria-hidden="true">◩</span>
        </button>
      </div>
    </header>
  );
}
