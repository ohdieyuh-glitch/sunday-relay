import type { HandoffNetworkState, WorkspaceOutputState } from './contracts';
import { OUTPUT_STATE_LABEL } from './projections';

/** Bottom system area — handoff network, safety state, Relay statement. */
export function RelayProjectFooter({
  handoffNetworkState,
  outputState,
}: {
  handoffNetworkState: HandoffNetworkState;
  outputState: WorkspaceOutputState;
}) {
  return (
    <footer className="rpw-footer">
      <div className="rpw-footer-status">
        <span className="rpw-status-cell">
          <span className="rpw-key">HANDOFF NETWORK</span>
          <span className={`rpw-val rpw-net--${handoffNetworkState}`}>
            {handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'}
          </span>
        </span>
        <span className="rpw-status-cell">
          <span className="rpw-key">PROJECT SAFETY</span>
          <span className="rpw-val">
            {outputState === 'stopped_safely' || outputState === 'waiting_for_user'
              ? 'STOPPED SAFELY'
              : 'BOUNDED'}
          </span>
        </span>
        <span className="rpw-status-cell">
          <span className="rpw-key">STATE</span>
          <span className="rpw-val">{OUTPUT_STATE_LABEL[outputState]}</span>
        </span>
      </div>
      <p className="rpw-footer-statement">Pass the work. Keep the context.</p>
    </footer>
  );
}
