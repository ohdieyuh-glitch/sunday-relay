import type { ProjectBrainState } from './contracts';

/**
 * Project Brain — the Prompt Architect's approved, sourced project
 * knowledge. Counts and approval queue only; entries are managed through
 * Project Settings and the approval flow, never edited here.
 */
export function RelayProjectBrainStatus({ state }: { state: ProjectBrainState }) {
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
    </section>
  );
}
