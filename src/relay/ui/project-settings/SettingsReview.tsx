import { AVAILABILITY_LABEL } from './options';
import type { AgentOption, ProjectSettingsDraft, SettingsValidation } from './contracts';

/**
 * 14 — REVIEW AND START. A clean summary of every selection, warnings shown
 * separately, START PROJECT disabled while blockers exist. Nothing here
 * claims the project is executing — the host callback owns what happens
 * next.
 */
export function SettingsReview({
  draft,
  validation,
  agentOptions,
  onBack,
  onSaveDraft,
  onStartProject,
}: {
  draft: ProjectSettingsDraft;
  validation: SettingsValidation;
  agentOptions: AgentOption[];
  onBack: () => void;
  onSaveDraft: () => void;
  onStartProject: () => void;
}) {
  const agent = (id: string | null) => agentOptions.find((o) => o.id === id) ?? null;
  const architect = agent(draft.workforce.promptArchitectId);
  const coding = agent(draft.workforce.codingAgentId);
  const reviewer = agent(draft.workforce.reviewerId);
  const blocked = validation.blockers.length > 0;

  const group = (title: string, rows: Array<[string, string]>) => (
    <div className="rps-review-group">
      <h3 className="rps-review-title">{title}</h3>
      <dl className="rps-review-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const agentLine = (a: AgentOption | null) =>
    a ? `${a.name} — ${AVAILABILITY_LABEL[a.availability]}` : '—';

  return (
    <div className="rps-section-body">
      <div className="rps-review">
        {group('PROJECT', [
          ['Name', draft.projectName ?? '—'],
          ['Type', draft.projectTypes.map((t) => t.replace(/_/g, ' ')).join(', ') || '—'],
          ['Stage', draft.stage.replace(/_/g, ' ')],
          ['Platform', draft.platforms.join(', ') || '—'],
          ['Source', draft.source?.replace(/_/g, ' ') ?? '—'],
        ])}
        {group('WORKFORCE', [
          ['Prompt Architect', agentLine(architect)],
          ['Coding Agent', agentLine(coding)],
          ['Reviewer', draft.workforce.reviewerPolicy === 'never' ? 'Not required' : agentLine(reviewer)],
          ['Reviewer policy', draft.workforce.reviewerPolicy.replace(/_/g, ' ')],
        ])}
        {group('MODE', [['Relay mode', draft.mode.toUpperCase()]])}
        {group('RESEARCH', [
          ['Status', draft.research.mode.replace(/_/g, ' ')],
          ['Topics', `${draft.research.topics.length} approved`],
          ['Project Brain', draft.research.brainUpdate.replace(/_/g, ' ')],
        ])}
        {group('BOUNDARIES', [
          ['Scope', draft.scope.preset.replace(/_/g, ' ')],
          ['Protected areas', `${draft.scope.protectedAreas.length} selected`],
          ['File access', draft.scope.fileAccess.replace(/_/g, ' ')],
          ['Network', draft.permissions.network.replace(/_/g, ' ')],
          ['Deployment', draft.permissions.deployment.replace(/_/g, ' ')],
          ['Destructive', draft.permissions.destructive.replace(/_/g, ' ')],
        ])}
        {group('PROOF', [
          ['Tests', `${draft.verification.tests.length} required`],
          ['Inspections', `${draft.verification.inspections.length} required`],
          ['Review', draft.verification.review.replace(/_/g, ' ')],
          ['Completion rule', draft.verification.completionRule.toUpperCase()],
        ])}
        {group('LIMITS', [
          ['Runtime', `${draft.limits.runtimeMinutes} min`],
          ['Agent calls', String(draft.limits.agentCalls)],
          ['Spending', `$${draft.limits.spendUsd}`],
          ['Review cycles', String(draft.limits.reviewCycles)],
          ['Repair cycles', String(draft.limits.repairCycles)],
        ])}
      </div>

      {(validation.blockers.length > 0 || validation.warnings.length > 0) && (
        <div className="rps-review-issues" role="alert" aria-label="Configuration issues">
          {validation.blockers.map((b) => (
            <p key={b.id} className="rps-issue rps-issue--blocker">
              ⊘ {b.message}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w.id} className="rps-issue rps-issue--warning">
              ! {w.message}
            </p>
          ))}
        </div>
      )}

      <div className="rps-review-actions">
        <button type="button" className="rps-btn" onClick={onBack}>
          BACK
        </button>
        <button type="button" className="rps-btn" onClick={onSaveDraft}>
          SAVE PROJECT DRAFT
        </button>
        <button
          type="button"
          className="rps-btn rps-btn--primary"
          disabled={blocked}
          onClick={onStartProject}
        >
          START PROJECT
        </button>
      </div>
      {blocked && (
        <p className="rps-hint">START PROJECT unlocks when the required configuration above is complete.</p>
      )}
    </div>
  );
}
