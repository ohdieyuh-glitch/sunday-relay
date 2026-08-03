import { RelayLoopComposer } from './RelayLoopComposer';
import { RelayLoopOverview, type RelayLoopOverviewSection } from './RelayLoopOverview';
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
