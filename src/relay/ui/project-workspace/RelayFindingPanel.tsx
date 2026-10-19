import type { ReviewFinding } from './contracts';

/** Validated review findings — ID, severity, criterion, evidence, action. */
export function RelayFindingPanel({
  findings,
  onOpenFinding,
}: {
  findings: ReviewFinding[];
  onOpenFinding: (findingId: string) => void;
}) {
  return (
    <ul className="rpw-findings" aria-label="Review findings">
      {findings.map((f) => (
        <li key={f.findingId} className={`rpw-finding rpw-finding--${f.status}`}>
          <div className="rpw-finding-head">
            <span className="rpw-finding-id">FINDING / {f.findingId}</span>
            <span className={`rpw-finding-sev rpw-finding-sev--${f.severity}`}>
              {f.severity.toUpperCase()}
            </span>
            <span className="rpw-finding-status">{f.status.toUpperCase()}</span>
          </div>
          <p className="rpw-finding-title">{f.title}</p>
          <dl className="rpw-finding-body">
            <div>
              <dt>CRITERION</dt>
              <dd>{f.criterion}</dd>
            </div>
            <div>
              <dt>EVIDENCE</dt>
              <dd>{f.evidenceSummary}</dd>
            </div>
            <div>
              <dt>REQUIRED ACTION</dt>
              <dd>{f.requiredAction}</dd>
            </div>
          </dl>
          <button type="button" className="rpw-btn rpw-btn--ghost" onClick={() => onOpenFinding(f.findingId)}>
            OPEN FINDING
          </button>
        </li>
      ))}
    </ul>
  );
}
