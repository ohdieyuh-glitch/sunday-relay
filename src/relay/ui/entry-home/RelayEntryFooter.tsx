import type { EntryProductState, HandoffNetworkState } from './contracts';

/**
 * System footer — handoff network status + the Relay statement. No marketing
 * links; the user is inside the product.
 */
export function RelayEntryFooter({
  handoffNetworkState,
  productState,
}: {
  handoffNetworkState: HandoffNetworkState;
  productState: EntryProductState;
}) {
  return (
    <footer className="reh-footer">
      <div className="reh-footer-status">
        <span className="reh-status-cell">
          <span className="reh-status-key">HANDOFF NETWORK</span>
          <span className={`reh-status-val reh-status-val--${handoffNetworkState}`}>
            {handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'}
          </span>
        </span>
        <span className="reh-status-cell">
          <span className="reh-status-key">PROJECT STATE</span>
          <span className="reh-status-val">
            {productState === 'draft' ? 'DRAFT' : 'UNCONFIGURED'}
          </span>
        </span>
      </div>
      <p className="reh-footer-statement">Pass the work. Keep the context.</p>
    </footer>
  );
}
