import { CATEGORY_LABEL, TRUTH_BADGE, formatEventTime } from './projections';
import type { EventTruthClass, WorkspaceTerminalEvent } from './contracts';

/**
 * One safe normalized Relay event, drawn as a founder-screenshot timeline
 * row: status icon, muted timestamp, gold role label, cream activity text.
 * Truthfulness stays visible — agent claims, Relay evidence, review
 * verdicts, and user-action events carry distinct icons and a small truth
 * tag, never equal visual weight.
 */

const TRUTH_ICON: Record<EventTruthClass, string> = {
  agent_claim: '→',
  relay_evidence: '✓',
  review_verdict: '◆',
  user_action_required: '!',
  system_notice: '●',
};

export function RelayTerminalEvent({ event }: { event: WorkspaceTerminalEvent }) {
  const badge = TRUTH_BADGE[event.truth];
  return (
    <li className={`rpw-tev rpw-tev--${badge.tone}`}>
      <span className="rpw-tev-icon" aria-hidden="true">
        {TRUTH_ICON[event.truth]}
      </span>
      <div className="rpw-tev-main">
        <div className="rpw-tev-head">
          <span className="rpw-tev-time">{formatEventTime(event.at)}</span>
          <span className={`rpw-tev-cat rpw-tev-cat--${event.category}`}>
            {CATEGORY_LABEL[event.category]}
          </span>
        </div>
        <p className="rpw-tev-headline">{event.headline}</p>
        {event.detail && <p className="rpw-tev-detail">{event.detail}</p>}
        <span className={`rpw-tev-truth rpw-tev-truth--${badge.tone}`}>
          {badge.label}
          {event.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
          {event.simulated && <span className="rpw-fixture-tag">SIMULATED</span>}
        </span>
      </div>
    </li>
  );
}
