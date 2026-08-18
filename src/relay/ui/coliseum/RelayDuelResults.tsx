import './relay-coliseum.css';

import { COLISEUM_FIXTURE_DISCLOSURE } from './fixtures';
import { RelayProofMeter } from './RelayProofMeter';
import {
  DUEL_MODE_LABEL,
  DUEL_PARTICIPANT_KIND_LABEL,
  DUEL_STATUS_LABEL,
  formatDelta,
  formatMaybe,
  type DuelParticipantResultView,
  type DuelResultsView,
} from './projections';

/**
 * The full duel results, for BOTH participants — nothing derived, nothing
 * invented. Every value below comes from the view model; a `null` renders as
 * the word "Unknown", never as 0, never as a delta of nothing.
 *
 * `source` is REQUIRED so this component cannot render fixture figures
 * without their SIMULATED DATA banner, even when mounted standalone.
 */
export function RelayDuelResults({
  view,
  source,
}: {
  view: DuelResultsView;
  source: 'development_fixture' | 'live';
}) {
  const winner =
    view.winnerParticipantId === null
      ? null
      : view.participants.find((p) => p.participantId === view.winnerParticipantId) ?? null;

  return (
    <section className="relay-coliseum-results" aria-label="Duel results">
      {source === 'development_fixture' ? (
        <p className="relay-coliseum-disclosure" role="note">
          SIMULATED DATA — {COLISEUM_FIXTURE_DISCLOSURE}
        </p>
      ) : null}
      <header className="relay-coliseum-results-head">
        <h3 className="relay-coliseum-results-title">DUEL RESULTS</h3>
        <span className="relay-coliseum-results-meta">
          {DUEL_STATUS_LABEL[view.status]} · {DUEL_MODE_LABEL[view.mode]}
        </span>
      </header>

      <p className="relay-coliseum-results-winner" data-testid="duel-winner">
        {winner === null
          ? 'Winner: not decided'
          : `Winner: ${winner.displayName}`}
      </p>

      <div className="relay-coliseum-results-grid">
        {view.participants.map((participant) => (
          <ParticipantResult key={participant.participantId} participant={participant} />
        ))}
      </div>

      <section className="relay-coliseum-fixes" aria-label="Verified fixes">
        <h4 className="relay-coliseum-fixes-title">VERIFIED FIXES</h4>
        {view.verifiedFixes.length === 0 ? (
          <p className="relay-coliseum-fixes-empty">No verified fixes recorded.</p>
        ) : (
          <ul className="relay-coliseum-fixes-list">
            {view.verifiedFixes.map((fix) => (
              <li key={fix.id} className="relay-coliseum-fix" data-applied={fix.appliedState}>
                <span className="relay-coliseum-fix-summary">{fix.summary}</span>
                <span className="relay-coliseum-fix-state">
                  {fix.appliedState === 'applied' ? 'Applied' : 'Available to apply'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ParticipantResult({ participant }: { participant: DuelParticipantResultView }) {
  return (
    <article
      className="relay-coliseum-participant"
      aria-label={`Results for ${participant.displayName}`}
    >
      <header className="relay-coliseum-participant-head">
        <span className="relay-coliseum-participant-name">{participant.displayName}</span>
        <span className="relay-coliseum-participant-kind">
          {DUEL_PARTICIPANT_KIND_LABEL[participant.kind]}
        </span>
      </header>
      <RelayProofMeter participant={participant} />
      <dl className="relay-coliseum-stats">
        <dt>Bugs found</dt>
        <dd>{participant.bugsFound}</dd>
        <dt>Repairs accepted</dt>
        <dd>{participant.repairsAccepted}</dd>
        <dt>Regressions prevented</dt>
        <dd>{participant.regressionsPrevented}</dd>
        <dt>Evaluation quality</dt>
        <dd data-testid={`eval-quality-${participant.participantId}`}>
          {formatMaybe(participant.evaluationQuality)}
        </dd>
        <dt>Reliability delta</dt>
        <dd data-testid={`reliability-delta-${participant.participantId}`}>
          {formatDelta(participant.reliabilityDelta)}
        </dd>
        <dt>Performance delta</dt>
        <dd data-testid={`performance-delta-${participant.participantId}`}>
          {formatDelta(participant.performanceDelta)}
        </dd>
        <dt>XP earned</dt>
        <dd>{participant.xpEarned}</dd>
        <dt>Opponent-fix bonus</dt>
        <dd>{participant.opponentFixBonus}</dd>
        <dt>Rewards</dt>
        <dd>
          {participant.rewards.length === 0 ? 'None' : participant.rewards.join(', ')}
        </dd>
      </dl>
    </article>
  );
}
