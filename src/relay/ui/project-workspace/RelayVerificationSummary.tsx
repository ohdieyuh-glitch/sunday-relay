import type { VerificationSummary } from './contracts';

/**
 * Relay's own verification evidence — independent of any agent claim. Checks
 * render truthful statuses only; nothing is fabricated when no check ran.
 */
export function RelayVerificationSummary({ summary }: { summary: VerificationSummary }) {
  return (
    <section className="rpw-verification" aria-labelledby="rpw-verif-heading">
      <h2 id="rpw-verif-heading" className="rpw-section-title">
        RELAY VERIFICATION
      </h2>
      {summary.headline && <p className="rpw-verif-headline">{summary.headline}</p>}
      {summary.checks.length === 0 ? (
        <p className="rpw-dim">No verification has run yet.</p>
      ) : (
        <ul className="rpw-verif-checks">
          {summary.checks.map((c) => (
            <li key={c.label} className={`rpw-check rpw-check--${c.status}`}>
              <span className="rpw-check-mark" aria-hidden="true">
                {c.status === 'passed' ? '✓' : c.status === 'failed' ? '✕' : c.status === 'pending' ? '…' : '—'}
              </span>
              <span className="rpw-check-label">{c.label}</span>
              <span className="rpw-check-status">{c.status.replace(/_/g, ' ').toUpperCase()}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="rpw-verif-note">
        Evidence shown here was produced by Relay's own inspection — agent claims are labeled
        separately in the terminal.
      </p>
    </section>
  );
}
