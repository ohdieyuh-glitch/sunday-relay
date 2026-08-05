import './relay-operations-panel.css';
import { formatMicros } from '../../mission/llmops';
import type {
  RelayFigure, RelayHealthState, RelayOperationsView,
} from '../../mission/llmops';

/**
 * PROJECT OPERATIONS — tokens, cost, latency, errors, health, evaluations,
 * repair loops, and what the run is waiting for.
 *
 * Every figure here comes from `projectOperations`, the same projection
 * `relay project operations` renders. This component performs no arithmetic of
 * its own: a surface that recomputes a number is a second implementation that
 * will eventually disagree with the first, and the user has no way to tell
 * which one is lying.
 *
 * WHAT IT REFUSES TO DRAW.
 *
 * - **A zero it did not measure.** An unknown figure renders as an em dash with
 *   the reason beside it. There is no code path here that turns `known: false`
 *   into `0`, because `RelayFigure` has no numeric field to read without first
 *   checking `known`.
 * - **A green light for silence.** `unknown` health is its own state with its
 *   own colour. It is not folded into "healthy", which is how a dashboard ends
 *   up reassuring someone about a system that stopped reporting an hour ago.
 * - **A self-assessment as a review.** Independent and self-assessed
 *   evaluations are counted separately and shown separately.
 */

const HEALTH_LABEL: Record<RelayHealthState, string> = {
  healthy: 'HEALTHY',
  degraded: 'DEGRADED',
  failing: 'FAILING',
  unknown: 'UNKNOWN',
};

const UNKNOWN_NOTE: Record<string, string> = {
  not_observed: 'not observed',
  insufficient_samples: 'too few samples',
  unknown_denominator: 'denominator unknown',
  stale: 'stale',
};

/** The one place an unknown becomes text. There is no other. */
function Figure({ figure, format }: {
  readonly figure: RelayFigure;
  readonly format: (value: number) => string;
}) {
  if (figure.known) return <>{format(figure.value)}</>;
  return (
    <span className="rop-unknown">
      —<span className="rop-unknown-why"> {UNKNOWN_NOTE[figure.reason] ?? figure.reason}</span>
    </span>
  );
}

const ms = (value: number): string => (value >= 1000
  ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`
  : `${Math.round(value)}ms`);

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const duration = (value: number): string => {
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function RelayOperationsPanel({ view }: {
  /**
   * Null means NO HOST SUPPLIED ONE — which is a different fact from a project
   * that reported nothing, and is said differently. Neither is drawn as zeroes.
   */
  readonly view: RelayOperationsView | null;
}) {
  if (view === null) {
    return (
      <section className="rop" aria-labelledby="rop-heading">
        <h2 id="rop-heading" className="rpw-section-title">PROJECT OPERATIONS</h2>
        <p className="rop-health rop-health--unknown">
          <span className="rop-health-state">UNKNOWN</span>
          <span className="rop-health-reason">
            This deployment has no operations source wired, so nothing is being
            measured. That is not the same as a project with nothing to report.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="rop" aria-labelledby="rop-heading">
      <h2 id="rop-heading" className="rpw-section-title">PROJECT OPERATIONS</h2>

      {/* Health first, with its reason. A state with no reason is a colour. */}
      <p className={`rop-health rop-health--${view.health}`}>
        <span className="rop-health-state">{HEALTH_LABEL[view.health]}</span>
        <span className="rop-health-reason">{view.healthReason}</span>
      </p>

      {/* WAITING ON USER — first among the figures, because it is the only one
          the person reading this can do anything about. */}
      {(view.waitingOnUserMs > 0 || view.waitingOnUserOpen) && (
        <p className={`rop-waiting${view.waitingOnUserOpen ? ' rop-waiting--open' : ''}`} role="status">
          {view.waitingOnUserOpen
            ? `WAITING ON YOU — ${duration(view.waitingOnUserMs)} so far.`
            : `Waited on you for ${duration(view.waitingOnUserMs)}.`}
        </p>
      )}

      <dl className="rop-figures">
        <div>
          <dt>ERRORS</dt>
          <dd>
            {view.errorCount}
            {view.unrecoveredErrorCount > 0 && (
              <span className="rop-bad"> ({view.unrecoveredErrorCount} unrecovered)</span>
            )}
          </dd>
        </div>
        <div>
          <dt>ERROR RATE</dt>
          <dd><Figure figure={view.errorRate} format={percent} /></dd>
        </div>
        <div>
          <dt>EVALUATIONS</dt>
          <dd>
            {view.evaluations.total === 0 ? '—' : (
              <>
                {view.evaluations.independent} independent
                {view.evaluations.selfAssessed > 0 && (
                  // Named, not hidden. An agent grading itself is a real thing
                  // that happened and a reader should see it.
                  <span className="rop-caveat">, {view.evaluations.selfAssessed} self-assessed</span>
                )}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>REPAIR LOOPS</dt>
          <dd>
            {view.repairs.loops === 0 ? '—' : (
              <>
                {view.repairs.converged} converged
                {view.repairs.endedUnfixed > 0 && (
                  <span className="rop-bad">, {view.repairs.endedUnfixed} ended unfixed</span>
                )}
                {view.repairs.inProgress > 0 && (
                  <span className="rop-caveat">, {view.repairs.inProgress} running</span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      <h3 className="rop-subheading">TOKENS AND COST</h3>
      {view.spend === null ? (
        <p className="rop-empty">
          No economics source is wired, so no tokens or cost are recorded.
        </p>
      ) : (
        <>
          <dl className="rop-figures">
            <div>
              <dt>TOKENS</dt>
              <dd>
                {view.spend.tokens.total}
                <span className="rop-caveat">
                  {` (${view.spend.tokens.input} in, ${view.spend.tokens.output} out, `}
                  {`${view.spend.tokens.cachedInput} cached)`}
                </span>
                {view.spend.tokens.unreadable > 0 && (
                  <span className="rop-bad"> {view.spend.tokens.unreadable} unreadable</span>
                )}
              </dd>
            </div>
            <div>
              <dt>COST</dt>
              <dd>
                {view.spend.actual.length === 0 ? '—' : view.spend.actual
                  .map((total) => formatMicros(total.currency, total.amountMicros)).join(', ')}
              </dd>
            </div>
            {view.spend.estimated.length > 0 && (
              <div>
                {/* Never added to actual. A projection and a bill are different facts. */}
                <dt>ESTIMATED</dt>
                <dd className="rop-caveat">
                  {view.spend.estimated
                    .map((total) => formatMicros(total.currency, total.amountMicros)).join(', ')}
                </dd>
              </div>
            )}
          </dl>
          {view.spend.amountUnknown > 0 && (
            // Said beside the total: a small total must not read as a cheap run.
            <p className="rop-missing">
              {`${view.spend.amountUnknown} receipt(s) have no cost recorded yet.`}
            </p>
          )}
          {view.spend.voidedOrDisputed > 0 && (
            <p className="rop-missing">
              {`${view.spend.voidedOrDisputed} receipt(s) voided or disputed, excluded.`}
            </p>
          )}
          {view.spend.fixtureSourced > 0 && (
            // Simulated data says so.
            <p className="rop-missing">
              {`${view.spend.fixtureSourced} receipt(s) come from a development fixture, not a bill.`}
            </p>
          )}
        </>
      )}

      <h3 className="rop-subheading">LATENCY</h3>
      {view.latency.length === 0 ? (
        <p className="rop-empty">No phase has been timed for this project.</p>
      ) : (
        <table className="rop-latency">
          <thead>
            <tr><th scope="col">PHASE</th><th scope="col">N</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">MAX</th></tr>
          </thead>
          <tbody>
            {view.latency.map((phase) => (
              <tr key={phase.phase}>
                <th scope="row">{phase.phase.replace(/_/g, ' ')}</th>
                <td>{phase.samples}</td>
                <td><Figure figure={phase.p50Ms} format={ms} /></td>
                <td><Figure figure={phase.p95Ms} format={ms} /></td>
                <td><Figure figure={phase.maxMs} format={ms} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.missingPhases.length > 0 && (
        // Named rather than shown as rows of zeroes.
        <p className="rop-missing">
          {`Not timed: ${view.missingPhases.join(', ').replace(/_/g, ' ')}.`}
        </p>
      )}

      {view.waits.length > 0 && (
        <>
          <h3 className="rop-subheading">WAITING</h3>
          <ul className="rop-waits">
            {view.waits.map((wait) => (
              <li key={wait.reason}>
                <span className="rop-wait-reason">{wait.reason.replace(/_/g, ' ')}</span>
                <span className="rop-wait-time">
                  {duration(wait.totalMs)} over {wait.intervals}
                  {wait.intervals === 1 ? ' interval' : ' intervals'}
                  {wait.openIntervals > 0 && ' (still waiting)'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="rop-asof">
        {view.newestSignalAt === null
          ? 'Nothing has reported for this project.'
          : `Newest signal ${view.newestSignalAt}.`}
      </p>
    </section>
  );
}
