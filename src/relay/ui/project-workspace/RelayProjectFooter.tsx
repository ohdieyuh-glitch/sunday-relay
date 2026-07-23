import type { HandoffNetworkState, WorkspaceOutputState } from './contracts';
import { OUTPUT_STATE_LABEL } from './projections';

/**
 * Bottom system bar — founder-screenshot language: one outlined bar with the
 * Relay statement bracketed in gold, handoff network at left, truthful
 * system state at right. "ALL SYSTEMS GO" appears only when the network is
 * online and nothing is blocked, waiting, or stopped.
 */
export function RelayProjectFooter({
  handoffNetworkState,
  outputState,
}: {
  handoffNetworkState: HandoffNetworkState;
  outputState: WorkspaceOutputState;
}) {
  // "ALL SYSTEMS GO" only while the mission is genuinely progressing:
  // online network AND an active working state. Terminal, blocked, and
  // waiting states always show their truthful label instead.
  const ACTIVE_STATES: WorkspaceOutputState[] = [
    'ready',
    'implementing',
    'held_for_inspection',
    'held_for_verification',
    'held_for_review',
    'held_for_re_review',
    'repairing',
  ];
  const calm = handoffNetworkState === 'online' && ACTIVE_STATES.includes(outputState);
  return (
    <footer className="rpw-footer">
      <span className="rpw-footer-net">
        <span
          className={`rpw-footer-dot rpw-footer-dot--${handoffNetworkState}`}
          aria-hidden="true"
        >
          ●
        </span>{' '}
        HANDOFF NETWORK / {handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'}
      </span>
      <p className="rpw-footer-statement">
        <span className="rpw-footer-bracket" aria-hidden="true">
          [
        </span>{' '}
        PASS THE WORK. <span className="rpw-footer-gold">KEEP THE CONTEXT.</span>{' '}
        <span className="rpw-footer-bracket" aria-hidden="true">
          ]
        </span>
      </p>
      <span className={`rpw-footer-state${calm ? ' rpw-footer-state--go' : ''}`}>
        {calm ? 'ALL SYSTEMS GO' : OUTPUT_STATE_LABEL[outputState]}
      </span>
    </footer>
  );
}
