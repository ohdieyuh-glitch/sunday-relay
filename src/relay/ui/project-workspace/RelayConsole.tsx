import { RelayTerminalEvent } from './RelayTerminalEvent';
import type { HandoffNetworkState, WorkspaceTerminalEvent } from './contracts';

/**
 * RELAY CONSOLE — the main activity surface of the Active Project Workspace,
 * drawn to the founder screenshots: one large chamfered dark panel, `>_`
 * title, LIVE indicator, chronological timeline of safe normalized events.
 * Observational only — this is the browser projection of canonical Relay
 * activity, never a shell, never raw output, never hidden reasoning.
 */
/**
 * What the console says — and offers — while it has nothing to show.
 *
 * The empty state used to be one fixed paragraph, which meant a mission whose
 * start was REFUSED for a stated reason rendered the same screen as a project
 * with no mission at all. A founder watched "Relay activity will appear here
 * after Project Settings is confirmed" while the actual reason (a read-only
 * session, an expired pairing, a stale record) sat in a dismissible line at
 * the bottom of the page. The reason a mission is not running belongs where
 * the founder is looking — and so does the button that tries again.
 */
export interface RelayConsoleIdleState {
  /** The start refusal, verbatim, when one happened. Null when none has. */
  readonly reason: string | null;
  /** True when a mission exists and may be dispatched right now. */
  readonly canStart: boolean;
  /** True while a dispatch this panel requested is in flight. */
  readonly starting?: boolean;
  onStart?: () => void;
}

export function RelayConsole({
  events,
  handoffNetworkState,
  subhead = 'Safe project activity and verified coordination',
  onOpenTerminal,
  idle,
}: {
  events: WorkspaceTerminalEvent[];
  handoffNetworkState: HandoffNetworkState;
  subhead?: string;
  /** When provided, the `>_` glyph beside the title opens Terminal Mode. */
  onOpenTerminal?: () => void;
  /** The truthful empty state. Absent renders the legacy copy unchanged. */
  idle?: RelayConsoleIdleState;
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
          {idle?.reason ? (
            // The start refusal, verbatim and where the founder is looking —
            // never only in a dismissible line at the bottom of the page.
            <p className="rpw-console-idle-reason" role="alert">{idle.reason}</p>
          ) : (
            <p className="rpw-dim">
              Relay activity will appear here after Project Settings is confirmed and the first
              mission begins.
            </p>
          )}
          {idle?.canStart && idle.onStart ? (
            <button
              type="button"
              className="rpw-console-start-btn"
              onClick={idle.onStart}
              disabled={idle.starting === true}
            >
              {idle.starting === true ? 'STARTING…' : 'START MISSION'}
            </button>
          ) : null}
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
