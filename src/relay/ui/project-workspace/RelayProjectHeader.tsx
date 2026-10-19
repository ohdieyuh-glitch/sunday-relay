import { useState } from 'react';
import { RelayDogMark } from '../pixel-dog';
import { RelayMenuButton, RelayMobileMenu } from '../chrome';
import { RelayUsageBar, type RelayWorkspaceUsage } from '../usage';
import { OUTPUT_STATE_LABEL } from './projections';
import type { WorkspaceOutputState, WorkspaceProject } from './contracts';

/**
 * Top application frame — founder-screenshot language: pixel dog mark +
 * letterspaced SUNDAY RELAY at left, project identity with the outlined
 * [ RLY / 001 ] chip in the center, system controls at right. On mobile the
 * right-side controls collapse behind the founder gold MENU block; the
 * project route/status strip stays visible below the brand. No marketing
 * navigation — the developer is inside the product.
 */
export function RelayProjectHeader({
  project,
  outputState,
  openManualTasks,
  usage,
  onReturnHome,
  onOpenProjectSettings,
  onOpenTerminal,
}: {
  project: WorkspaceProject;
  outputState: WorkspaceOutputState;
  openManualTasks: number;
  /** Optional Usage Bar surface — callers that omit it render as before. */
  usage?: RelayWorkspaceUsage;
  onReturnHome: () => void;
  onOpenProjectSettings: () => void;
  onOpenTerminal: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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

      <RelayMenuButton onOpen={() => setMenuOpen(true)} />
      <RelayMobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        statusLine={`${project.reference} — ${OUTPUT_STATE_LABEL[outputState]}`}
        items={[
          { id: 'home', label: '← RELAY HOME', onSelect: onReturnHome },
          { id: 'settings', label: 'PROJECT SETTINGS', onSelect: onOpenProjectSettings },
          { id: 'terminal', label: '>_ LIVE TERMINAL', onSelect: onOpenTerminal },
          {
            id: 'manual-tasks',
            label: 'MANUAL TASKS',
            hint: `${openManualTasks} OPEN`,
          },
          { id: 'notifications', label: 'NOTIFICATIONS', hint: 'NONE' },
        ]}
      />

      <div className="rpw-header-project" aria-label="Active project">
        <span className="rpw-proj-name">{project.name}</span>
        <span className="rpw-ref-chip">{project.reference}</span>
        <span className={`rpw-val rpw-state rpw-state--${outputState}`}>
          {OUTPUT_STATE_LABEL[outputState]}
        </span>
      </div>

      {/* The Usage Bar sits OUTSIDE .rpw-header-right on purpose: the right
          cluster hides behind MENU on mobile, while usage stays reachable as
          a compact top-navigation indicator at every width. */}
      {usage !== undefined && (
        <RelayUsageBar view={usage.bar} onOpen={usage.onOpenUsage} />
      )}

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
