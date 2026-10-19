import type { RecentProjectSummary, RecentProjectState, RecentResearchStatus } from './contracts';

/**
 * Compact recent-projects surface. Truthful states only — no fake analytics,
 * usage charts, earnings, or productivity metrics. Continue hands control to
 * the host through a callback.
 */

const STATE_LABEL: Record<RecentProjectState, string> = {
  draft: 'DRAFT',
  ready: 'READY',
  in_progress: 'IN PROGRESS',
  researching: 'RESEARCHING',
  waiting_for_user: 'WAITING FOR USER',
  review_required: 'REVIEW REQUIRED',
  revision_required: 'REVISION REQUIRED',
  stopped_safely: 'STOPPED SAFELY',
  verified_complete: 'VERIFIED COMPLETE',
};

const RESEARCH_LABEL: Record<RecentResearchStatus, string> = {
  not_configured: 'RESEARCH NOT CONFIGURED',
  monitoring: 'RESEARCH MONITORING',
  researching: 'RESEARCHING',
  awaiting_approval: 'KNOWLEDGE AWAITING APPROVAL',
};

export function RelayRecentProjects({
  projects,
  onOpenRecentProject,
}: {
  projects: RecentProjectSummary[];
  onOpenRecentProject: (projectId: string) => void;
}) {
  return (
    <section className="reh-recent" aria-labelledby="reh-recent-heading">
      <h2 id="reh-recent-heading" className="reh-section-title">
        RECENT PROJECTS
      </h2>

      {projects.length === 0 ? (
        <div className="reh-recent-empty">
          <p className="reh-recent-empty-title">NO RELAY PROJECTS YET</p>
          <p className="reh-recent-empty-copy">
            Start with an idea, connect an existing project, or choose a project route.
          </p>
        </div>
      ) : (
        <ul className="reh-recent-list">
          {projects.map((p) => (
            <li key={p.projectId} className="reh-recent-row">
              <div className="reh-recent-main">
                <span className="reh-recent-name">{p.name}</span>
                <span className="reh-recent-type">{p.projectType}</span>
                <span className={`reh-recent-state reh-recent-state--${p.state}`}>
                  {STATE_LABEL[p.state]}
                </span>
              </div>
              <div className="reh-recent-meta">
                <span>MODE / {p.mode.toUpperCase()}</span>
                <span>LAST / {p.lastActivity}</span>
                <span>
                  {p.workforce.promptArchitect} → {p.workforce.codingAgent}
                  {p.workforce.reviewer ? ` → ${p.workforce.reviewer}` : ''}
                </span>
                <span>{RESEARCH_LABEL[p.researchStatus]}</span>
              </div>
              <button
                type="button"
                className="reh-btn reh-btn--ghost"
                onClick={() => onOpenRecentProject(p.projectId)}
              >
                CONTINUE
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
