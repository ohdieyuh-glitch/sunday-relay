import { RelayTerminalEvent } from './RelayTerminalEvent';
import type { HandoffNetworkState, WorkspaceTerminalEvent } from './contracts';

/**
 * RELAY CONSOLE — the main activity surface of the Active Project Workspace,
 * drawn to the founder screenshots: one large chamfered dark panel, `>_`
 * title, LIVE indicator, chronological timeline of safe normalized events.
 * Observational only — this is the browser projection of canonical Relay
 * activity, never a shell, never raw output, never hidden reasoning.
 */
export function RelayConsole({
  events,
  handoffNetworkState,
  subhead = 'Safe project activity and verified coordination',
  onOpenTerminal,
}: {
  events: WorkspaceTerminalEvent[];
  handoffNetworkState: HandoffNetworkState;
  subhead?: string;
  /** When provided, the `>_` glyph beside the title opens Terminal Mode. */
  onOpenTerminal?: () => void;
}) {
  const live = handoffNetworkState === 'online';
  return (
    <section className="rpw-console" aria-label="Relay Console — safe normalized project activity">
      <header className="rpw-console-head">
        <div>
          <span className="rpw-console-title">
            {onOpenTerminal ? (
              <button
                type="button"
                className="rpw-console-terminal-btn"
                onClick={onOpenTerminal}
                aria-label="Open Live Terminal from the Relay Console"
                title="Open Live Terminal"
              >
                &gt;_
              </button>
            ) : (
              <span aria-hidden="true">&gt;_ </span>
            )}
            RELAY CONSOLE
          </span>
          <span className="rpw-console-subhead">{subhead}</span>
        </div>
        <span className={`rpw-console-live rpw-console-live--${live ? 'on' : 'off'}`}>
          {live ? 'LIVE' : 'STANDBY'} <span aria-hidden="true">●</span>
        </span>
      </header>

      {events.length === 0 ? (
        <div className="rpw-console-empty">
          <p>No mission is running.</p>
          <p className="rpw-dim">
            Relay activity will appear here after Project Settings is confirmed and the first
            mission begins.
          </p>
        </div>
      ) : (
        <ol className="rpw-console-feed" aria-live="polite" aria-label="Relay event feed">
          {events.map((e) => (
            <RelayTerminalEvent key={e.eventId} event={e} />
          ))}
        </ol>
      )}
    </section>
  );
}
