import { CATEGORY_LABEL, TRUTH_BADGE, formatEventTime } from './projections';
import type { WorkspaceTerminalEvent } from './contracts';

/**
 * One safe normalized Relay event. Agent claims, Relay evidence, review
 * verdicts, and user-action events carry visibly different truth badges —
 * an agent statement is never rendered with the weight of Relay evidence.
 */
export function RelayTerminalEvent({ event }: { event: WorkspaceTerminalEvent }) {
  const badge = TRUTH_BADGE[event.truth];
  return (
    <li className={`rpw-tev rpw-tev--${badge.tone}`}>
      <span className="rpw-tev-time">{formatEventTime(event.at)}</span>
      <span className={`rpw-tev-cat rpw-tev-cat--${event.category}`}>
        {CATEGORY_LABEL[event.category]}
      </span>
      <span className="rpw-tev-body">
        <span className="rpw-tev-headline">{event.headline}</span>
        {event.detail && <span className="rpw-tev-detail">{event.detail}</span>}
        <span className={`rpw-tev-truth rpw-tev-truth--${badge.tone}`}>{badge.label}</span>
        {event.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
      </span>
    </li>
  );
}
