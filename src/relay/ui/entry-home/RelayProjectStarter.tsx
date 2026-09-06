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
    <section className="reh-starter reh-hero" aria-labelledby="reh-starter-heading">
      <p className="reh-syslabel">i.Wonder / Relay’s Wonderland</p>
      <p className="reh-hero-product">RELAY’S WONDERLAND</p>
      <h1 id="reh-starter-heading" className="reh-h1 reh-hero-title">
        Enter the World Where Ideas Become Real.
      </h1>
      <p className="reh-support reh-hero-support">
        A living, multiplayer world for building software with AI — where projects, agents,
        tools and verification become places you can enter, watch and change. Explore it like a
        world; real software is built underneath.
      </p>

      <div className="reh-objective">
        <label className="reh-field-label" htmlFor="reh-objective-input">
          WHAT ARE WE BUILDING?
        </label>
        <textarea
          id="reh-objective-input"
          className="reh-objective-input"
          rows={4}
          value={projectIdeaDraft}
          placeholder="Describe the product, feature, system or world you want to bring into being."
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
