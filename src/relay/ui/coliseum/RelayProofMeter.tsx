import './relay-coliseum.css';

import {
  PROOF_CATEGORY_LABEL,
  proofEntryVerdict,
  type DuelParticipantResultView,
} from './projections';

/**
 * ONE participant's proof score, with the per-entry truth on display.
 *
 * The meter never averages, never rounds a claim up into a score: an
 * UNVERIFIED entry scores 0 and says "unverified", whatever its claimed
 * points; a penalty stays negative. The total shown is the domain's
 * `proofScore`, not something recomputed here.
 *
 * INTERNAL to the Coliseum surface: not exported from the barrel. It renders
 * only under RelayDuelResults, which requires a `source` and renders the
 * SIMULATED DATA banner for fixture data before these figures.
 */
export function RelayProofMeter({ participant }: { participant: DuelParticipantResultView }) {
  return (
    <section
      className="relay-coliseum-proof"
      aria-label={`Proof score for ${participant.displayName}`}
    >
      <header className="relay-coliseum-proof-head">
        <span className="relay-coliseum-proof-name">{participant.displayName}</span>
        <span className="relay-coliseum-proof-score" data-testid={`proof-score-${participant.participantId}`}>
          {participant.proofScore}
          <span className="relay-coliseum-proof-score-unit"> proof</span>
        </span>
      </header>
      {participant.entries.length === 0 ? (
        <p className="relay-coliseum-proof-empty">No proof entries recorded.</p>
      ) : (
        <ul className="relay-coliseum-proof-entries">
          {participant.entries.map((entry, index) => {
            const points = entry.points;
            return (
              <li
                key={`${entry.category}-${index}`}
                className="relay-coliseum-proof-entry"
                data-verified={entry.verified ? 'true' : 'false'}
              >
                <span className="relay-coliseum-proof-category">
                  {PROOF_CATEGORY_LABEL[entry.category]}
                </span>
                <span className="relay-coliseum-proof-summary">{entry.summary}</span>
                <span
                  className={
                    points < 0
                      ? 'relay-coliseum-proof-points relay-coliseum-proof-points--penalty'
                      : 'relay-coliseum-proof-points'
                  }
                >
                  {points > 0 ? `+${points}` : String(points)}
                </span>
                <span className="relay-coliseum-proof-verdict">
                  {proofEntryVerdict(entry)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
