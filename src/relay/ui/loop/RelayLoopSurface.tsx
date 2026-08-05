import { RelayLoopComposer } from './RelayLoopComposer';
import { RelayLoopOverview, type RelayLoopOverviewSection } from './RelayLoopOverview';
import { RelayLoopRunSurface, type RelayLoopRunPort, type RelayLoopRunStore } from './RelayLoopRunPanel';
import type { RelayLoopComposerView, RelaySwarmGateView } from './loop-view';

/**
 * THE LOOP SURFACE HOST.
 *
 * One mount point for whatever a slash command opened — a composer, the
 * overview, or an error. The workspace renders this and nothing else, so
 * adding a future Loop surface does not mean editing an approved screen again.
 *
 * It is a switch and nothing more. Every decision was made upstream, in the
 * domain and the view model, which is what keeps this component free of any
 * logic worth testing separately.
 */

export type RelayLoopSurfaceState =
  | {
      readonly kind: 'composer';
      readonly view: RelayLoopComposerView;
      readonly swarmGate?: RelaySwarmGateView;
    }
  | {
      readonly kind: 'overview';
      readonly sections?: readonly RelayLoopOverviewSection[];
    }
  | {
      readonly kind: 'error';
      /** The safe, structured message the parser returned. */
      readonly message: string;
      readonly details: readonly string[];
    }
  | {
      /**
       * A LIVE RUN, read from the server.
       *
       * `runId` absent means "restore whatever this browser last saw, by
       * asking". The panel persists only the id and fetches everything else —
       * see `RelayLoopRunPanel`.
       */
      readonly kind: 'run';
      readonly runId?: string | null;
    };

export interface RelayLoopSurface {
  readonly state: RelayLoopSurfaceState | null;
  /**
   * Slash input from the conversation. The host passes it to
   * `openLoopSurface`, which parses it through the ONE grammar and returns
   * what to show. The workspace never interprets the text itself.
   */
  readonly onSlashCommand: (text: string) => void;
  readonly onClose: () => void;
  readonly onSaveDraft: () => void;
  readonly onContinueToPreflight: () => void;
  readonly onStartComposer: () => void;
  /**
   * How this host reads a run, and where it keeps the one id it may remember.
   *
   * BOTH ABSENT IS A REAL STATE, not a missing feature: a surface with no
   * server session cannot read a run, and the `run` state is simply not
   * reachable from it. That is why they are optional rather than stubbed —
   * a stub would let the panel render as though it had asked and found
   * nothing, which is a different claim from never having asked.
   */
  readonly runPort?: RelayLoopRunPort;
  readonly runStore?: RelayLoopRunStore;
}

export function RelayLoopSurfaceHost({ surface }: { surface: RelayLoopSurface }) {
  const { state } = surface;
  if (state === null) return null;

  if (state.kind === 'overview') {
    return (
      <RelayLoopOverview
        sections={state.sections}
        onClose={surface.onClose}
        onStartComposer={surface.onStartComposer}
      />
    );
  }

  if (state.kind === 'run') {
    // Not reachable without both a port and a store, and the host says so
    // rather than drawing an empty run.
    if (surface.runPort === undefined || surface.runStore === undefined) {
      return (
        <section className="rlc" role="status" aria-labelledby="rlc-norun-heading">
          <header className="rlc-head">
            <h2 className="rlc-title" id="rlc-norun-heading">LOOP RUN</h2>
          </header>
          <p className="rlc-status-detail">
            This surface has no Relay Bridge session, so it cannot read a Loop run. Nothing is
            claimed about any run that may exist.
          </p>
          <footer className="rlc-actions">
            <button type="button" className="rlc-btn" onClick={surface.onClose}>Close</button>
          </footer>
        </section>
      );
    }
    return (
      <RelayLoopRunSurface
        port={surface.runPort}
        store={surface.runStore}
        {...(state.runId === undefined ? {} : { runId: state.runId })}
        onClose={surface.onClose}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="rlc" role="alert" aria-labelledby="rlc-error-heading">
        <header className="rlc-head">
          <h2 className="rlc-title" id="rlc-error-heading">
            THAT COMMAND COULD NOT BE READ
          </h2>
        </header>
        <p className="rlc-status-detail">{state.message}</p>
        {state.details.length > 0 ? (
          <ul className="rlc-problems">
            {state.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <p className="rlc-note">Nothing was started and nothing was spent.</p>
        <footer className="rlc-actions">
          <button type="button" className="rlc-btn" onClick={surface.onClose}>
            Close
          </button>
        </footer>
      </section>
    );
  }

  return (
    <RelayLoopComposer
      view={state.view}
      swarmGate={state.swarmGate}
      onCancel={surface.onClose}
      onSaveDraft={surface.onSaveDraft}
      onContinueToPreflight={surface.onContinueToPreflight}
    />
  );
}
