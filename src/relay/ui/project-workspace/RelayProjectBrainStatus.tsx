import type { ProjectBrainState } from './contracts';
import type { RelayBrainDocument } from '../../shared/llmops';

/**
 * Project Brain — the Prompt Architect's approved, sourced project
 * knowledge. Counts and approval queue only; entries are managed through
 * Project Settings and the approval flow, never edited here.
 */
export function RelayProjectBrainStatus({ state, document: brainDocument }: {
  state: ProjectBrainState;
  /**
   * The refreshed Brain document. OPTIONAL, and its absence means NO GENERATOR
   * HAS RUN — which is said in those words rather than shown as an empty
   * document, because a project with nothing recorded and a deployment that
   * generates nothing are different facts.
   */
  document?: RelayBrainDocument;
}) {
  return (
    <section className="rpw-brain" aria-labelledby="rpw-brain-heading">
      <h2 id="rpw-brain-heading" className="rpw-section-title">
        PROJECT BRAIN
      </h2>
      <dl className="rpw-brain-body">
        <div>
          <dt>APPROVED ENTRIES</dt>
          <dd>{state.entries}</dd>
        </div>
        <div>
          <dt>LAST UPDATE</dt>
          <dd>{state.lastUpdate ?? '—'}</dd>
        </div>
        <div>
          <dt>PENDING APPROVALS</dt>
          <dd className={state.pendingApprovals > 0 ? 'rpw-brain-pending' : undefined}>
            {state.pendingApprovals}
          </dd>
        </div>
      </dl>

      {brainDocument === undefined ? (
        <p className="rpw-brain-doc-none">
          No Brain document has been generated for this project.
        </p>
      ) : (
        <div className="rpw-brain-doc">
          {/* Freshness first, and always a sentence. "Continuously refreshed" is
              a promise about staleness, and a promise about staleness needs an
              observed timestamp — so the document reports what it was generated
              FROM, not only what it concluded. */}
          <p className={brainDocument.stale ? 'rpw-brain-stale' : 'rpw-brain-fresh'}>
            {brainDocument.stale ? 'STALE — ' : 'CURRENT — '}
            {brainDocument.freshness}
          </p>
          {brainDocument.sections.map((section) => (
            <section key={section.heading} aria-label={section.heading}>
              <h3 className="rpw-brain-doc-heading">{section.heading}</h3>
              <ul className="rpw-brain-doc-lines">
                {section.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
