import { RelayDogMark } from '../pixel-dog';
import { OUTPUT_STATE_LABEL } from './projections';
import type { WorkspaceOutputState, WorkspaceProject } from './contracts';

/**
 * Compact browser-app header for the Active Project Workspace. Product
 * identity + project identity + global controls. No marketing navigation —
 * the developer is inside the product supervising a configured project.
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
        <span className="rpw-mark" aria-hidden="true">
          <RelayDogMark unit={2} />
        </span>
        <span className="rpw-wordmark">SUNDAY RELAY</span>
        <nav className="rpw-switcher" aria-label="Product switcher">
          <button type="button" className="rpw-switch-btn" onClick={onReturnHome}>
            ← RELAY HOME
          </button>
          <span className="rpw-switch-btn is-active" aria-current="page">
            WORKSPACE
          </span>
        </nav>
      </div>

      <div className="rpw-header-project" aria-label="Active project">
        <span className="rpw-proj-cell">
          <span className="rpw-key">PROJECT</span>
          <span className="rpw-val rpw-proj-name">{project.name}</span>
        </span>
        <span className="rpw-proj-cell">
          <span className="rpw-key">STATE</span>
          <span className={`rpw-val rpw-state rpw-state--${outputState}`}>
            {OUTPUT_STATE_LABEL[outputState]}
          </span>
        </span>
        <span className="rpw-proj-cell">
          <span className="rpw-key">REFERENCE</span>
          <span className="rpw-val">{project.reference}</span>
        </span>
      </div>

      <div className="rpw-header-right">
        <button type="button" className="rpw-term-btn" onClick={onOpenTerminal} aria-label="Open Live Terminal">
          <span aria-hidden="true">&gt;_</span>
          <span className="rpw-term-btn-label">OPEN LIVE TERMINAL</span>
        </button>
        <button type="button" className="rpw-head-btn" onClick={onOpenProjectSettings}>
          PROJECT SETTINGS
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
