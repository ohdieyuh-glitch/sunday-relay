import { formatProjectBriefDraft } from './project-brief';
import type { ProjectBriefDraft } from './contracts';

/**
 * PROJECT BRIEF DRAFT panel — the editable structured beginning prompt.
 * Explicitly NOT a Mission Contract (that is created later by Relay and the
 * Prompt Architect after Project Settings is confirmed). Edits flow up via
 * onUpdateProjectBriefDraft; nothing is persisted here and nothing claims to
 * be saved.
 */

const splitLines = (v: string): string[] =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function RelayProjectBriefDraftPanel({
  draft,
  onUpdateProjectBriefDraft,
  onCopyProjectBrief,
  onClearProjectBrief,
  onContinueToProjectSettings,
}: {
  draft: ProjectBriefDraft | null;
  onUpdateProjectBriefDraft: (patch: Partial<ProjectBriefDraft>) => void;
  onCopyProjectBrief: (formatted: string) => void;
  onClearProjectBrief: () => void;
  onContinueToProjectSettings: (draft: ProjectBriefDraft) => void;
}) {
  // Keep the Home screen calm: no empty placeholder panel before a draft exists.
  if (!draft) return null;

  const textField = (
    label: string,
    key: keyof ProjectBriefDraft,
    value: string,
    rows = 2,
  ) => (
    <div className="reh-brief-field">
      <label className="reh-field-label" htmlFor={`reh-brief-${String(key)}`}>
        {label}
      </label>
      <textarea
        id={`reh-brief-${String(key)}`}
        rows={rows}
        value={value}
        onChange={(e) => onUpdateProjectBriefDraft({ [key]: e.target.value } as Partial<ProjectBriefDraft>)}
      />
    </div>
  );

  const listField = (label: string, key: keyof ProjectBriefDraft, values: string[], rows = 3) => (
    <div className="reh-brief-field">
      <label className="reh-field-label" htmlFor={`reh-brief-${String(key)}`}>
        {label}
      </label>
      <textarea
        id={`reh-brief-${String(key)}`}
        rows={rows}
        value={values.join('\n')}
        onChange={(e) =>
          onUpdateProjectBriefDraft({ [key]: splitLines(e.target.value) } as Partial<ProjectBriefDraft>)
        }
      />
      <span className="reh-brief-hint">One item per line.</span>
    </div>
  );

  return (
    <aside className="reh-brief" aria-labelledby="reh-brief-heading">
      <div className="reh-brief-head">
        <h2 id="reh-brief-heading" className="reh-section-title">
          PROJECT BRIEF DRAFT
        </h2>
        <span className="reh-brief-tag">NOT A MISSION CONTRACT</span>
      </div>
      <p className="reh-brief-note">
        The Mission Contract is created later by Relay and the Prompt Architect after Project
        Settings is confirmed.
      </p>

      <div className="reh-brief-grid">
        {textField('WORKING TITLE', 'workingTitle', draft.workingTitle, 1)}
        {textField('PROJECT TYPE', 'projectType', draft.projectType, 1)}
        {textField('PROBLEM', 'problem', draft.problem, 3)}
        {textField('INTENDED USERS', 'intendedUsers', draft.intendedUsers, 2)}
        {textField('DESIRED RESULT', 'desiredResult', draft.desiredResult, 2)}
        {listField('CORE FUNCTIONALITY', 'coreFunctionality', draft.coreFunctionality)}
        {textField('TECHNICAL CONTEXT', 'technicalContext', draft.technicalContext, 2)}
        {textField('PREFERRED STACK', 'preferredStack', draft.preferredStack, 1)}
        {textField('VISUAL DIRECTION', 'visualDirection', draft.visualDirection, 2)}
        {listField('CONSTRAINTS', 'constraints', draft.constraints)}
        {textField('SECURITY SENSITIVITY', 'securitySensitivity', draft.securitySensitivity, 1)}
        {textField('PRODUCTION IMPACT', 'productionImpact', draft.productionImpact, 1)}
        {listField('RESEARCH TOPICS', 'researchTopics', draft.researchTopics)}
        {listField('UNKNOWNS REQUIRING INVESTIGATION', 'unknowns', draft.unknowns)}
        {listField('KNOWLEDGE GAPS', 'knowledgeGaps', draft.knowledgeGaps)}
        {listField('EVIDENCE REQUIREMENTS', 'evidenceRequirements', draft.evidenceRequirements)}
        {listField('COMPLETION CRITERIA', 'completionCriteria', draft.completionCriteria)}
        {listField('OPEN QUESTIONS', 'openQuestions', draft.openQuestions)}
      </div>

      <dl className="reh-brief-meta">
        <div>
          <dt>EXISTING PROJECT</dt>
          <dd>{draft.existingProject ? 'YES' : 'NO'}</dd>
        </div>
        <div>
          <dt>SUGGESTED ARCHITECT</dt>
          <dd>{draft.suggestedPromptArchitect}</dd>
        </div>
        <div>
          <dt>SUGGESTED CODING AGENT</dt>
          <dd>{draft.suggestedCodingAgent}</dd>
        </div>
        <div>
          <dt>SUGGESTED REVIEWER</dt>
          <dd>{draft.suggestedReviewer}</dd>
        </div>
        <div>
          <dt>SUGGESTED MODE</dt>
          <dd>{draft.suggestedMode.toUpperCase()}</dd>
        </div>
      </dl>

      <div className="reh-brief-actions">
        <button
          type="button"
          className="reh-btn reh-btn--primary"
          onClick={() => onContinueToProjectSettings(draft)}
        >
          SEND TO PROJECT SETTINGS
        </button>
        <button
          type="button"
          className="reh-btn"
          onClick={() => onCopyProjectBrief(formatProjectBriefDraft(draft))}
        >
          COPY DRAFT
        </button>
        <button type="button" className="reh-btn reh-btn--ghost" onClick={onClearProjectBrief}>
          CLEAR DRAFT
        </button>
      </div>
    </aside>
  );
}
