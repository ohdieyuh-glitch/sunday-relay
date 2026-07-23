import { READINESS_LABEL, computeHomeReadiness } from './project-brief';
import type { ProjectBriefDraft } from './contracts';

/**
 * Primary start area — RELAY HOME / ROUTE 000. The developer describes an
 * objective, builds a Project Brief, connects an existing project, or opens
 * Project Settings. Entering text NEVER begins agent execution: the only exit
 * is the deliberate Project Settings handoff.
 */
export function RelayProjectStarter({
  projectIdeaDraft,
  projectBriefDraft,
  onUpdateProjectIdea,
  onBuildProjectBrief,
  onConnectExistingProject,
  onOpenProjectSettings,
}: {
  projectIdeaDraft: string;
  projectBriefDraft: ProjectBriefDraft | null;
  onUpdateProjectIdea: (text: string) => void;
  onBuildProjectBrief: (objective: string) => void;
  onConnectExistingProject: () => void;
  onOpenProjectSettings: () => void;
}) {
  const readiness = computeHomeReadiness(projectIdeaDraft, projectBriefDraft);

  return (
    <section className="reh-starter" aria-labelledby="reh-starter-heading">
      <p className="reh-syslabel">RELAY HOME / ROUTE 000</p>
      <h1 id="reh-starter-heading" className="reh-h1">
        What are we building?
      </h1>
      <p className="reh-support">
        Start with an idea, connect an existing project, or choose a starting route.
      </p>

      <div className="reh-objective">
        <label className="reh-field-label" htmlFor="reh-objective-input">
          PROJECT OBJECTIVE
        </label>
        <textarea
          id="reh-objective-input"
          className="reh-objective-input"
          rows={4}
          value={projectIdeaDraft}
          placeholder="Describe the product, feature, system, or result you want Relay to help you build."
          onChange={(e) => onUpdateProjectIdea(e.target.value)}
        />
        <p className="reh-objective-example">
          e.g. Build a secure dashboard that helps AI developers monitor model usage, spending, and
          provider failures.
        </p>
      </div>

      <div className="reh-starter-actions">
        <button
          type="button"
          className="reh-btn reh-btn--primary"
          disabled={!projectIdeaDraft.trim()}
          onClick={() => onBuildProjectBrief(projectIdeaDraft)}
        >
          BUILD PROJECT BRIEF
        </button>
        <button type="button" className="reh-btn" onClick={onConnectExistingProject}>
          CONNECT EXISTING PROJECT
        </button>
        <button type="button" className="reh-btn" onClick={onOpenProjectSettings}>
          OPEN PROJECT SETTINGS
        </button>
      </div>

      <p className="reh-readiness" data-readiness={readiness}>
        <span className="reh-status-key">READINESS</span>
        <span className="reh-status-val">{READINESS_LABEL[readiness]}</span>
        <span className="reh-readiness-note">
          Execution readiness is determined only after Project Settings and the Mission Contract are
          complete.
        </span>
      </p>
    </section>
  );
}
