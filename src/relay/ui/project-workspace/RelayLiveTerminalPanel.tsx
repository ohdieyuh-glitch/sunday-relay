import { useEffect, useRef } from 'react';
import { RelayTerminalEvent } from './RelayTerminalEvent';
import type { HandoffNetworkState, WorkspaceMission, WorkspaceProject, WorkspaceTerminalEvent } from './contracts';

/**
 * LIVE TERMINAL — the browser application's observational view of safe
 * normalized Relay activity. THIS IS NOT THE CLI. It never displays shell
 * prompts, raw commands, raw stdout/stderr, provider streams, hidden
 * reasoning, session identifiers, environment values, or credentials.
 * Desktop: right drawer. Mobile: full-screen page with a close control.
 */
export function RelayLiveTerminalPanel({
  project,
  mission,
  events,
  handoffNetworkState,
  fullScreen = false,
  onClose,
}: {
  project: WorkspaceProject;
  mission: WorkspaceMission;
  events: WorkspaceTerminalEvent[];
  handoffNetworkState: HandoffNetworkState;
  fullScreen?: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus management: move focus into the terminal when it opens.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <section
      className={`rpw-terminal${fullScreen ? ' rpw-terminal--full' : ''}`}
      aria-label="Live Terminal — safe normalized Relay events"
      role="dialog"
      aria-modal="true"
    >
      <header className="rpw-terminal-head">
        <div>
          <span className="rpw-wordmark-sm">SUNDAY RELAY</span>{' '}
          <span className="rpw-dim">— LIVE TERMINAL</span>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="rpw-btn rpw-terminal-close"
          onClick={onClose}
          aria-label="Close Live Terminal"
        >
          ✕ CLOSE
        </button>
      </header>

      <dl className="rpw-terminal-meta">
        <div>
          <dt>PROJECT</dt>
          <dd>{project.name}</dd>
        </div>
        <div>
          <dt>REFERENCE</dt>
          <dd>{project.reference}</dd>
        </div>
        <div>
          <dt>MISSION</dt>
          <dd>{mission.title}</dd>
        </div>
        <div>
          <dt>HANDOFF NETWORK</dt>
          <dd>{handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'}</dd>
        </div>
      </dl>
      <p className="rpw-terminal-scope">
        Normalized coordination events only — no raw process output, no hidden reasoning, no
        credentials. This view observes; it does not execute.
      </p>

      {events.length === 0 ? (
        <div className="rpw-terminal-empty">
          <p>No mission is running.</p>
          <p className="rpw-dim">
            Relay activity will appear here after Project Settings is confirmed and the first
            mission begins.
          </p>
        </div>
      ) : (
        <ol className="rpw-terminal-feed" aria-live="polite" aria-label="Relay event feed">
          {events.map((e) => (
            <RelayTerminalEvent key={e.eventId} event={e} />
          ))}
        </ol>
      )}
    </section>
  );
}
