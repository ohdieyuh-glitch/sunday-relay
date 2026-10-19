import { CONNECTION_STATUS_LABEL } from './recommendations';
import type { WorkforceRecommendation } from './contracts';

/**
 * Recommended workforce preview — a vertical handoff chain, not a live
 * execution graph. Statuses are truthful: only agents with a real adapter may
 * read CONNECTED. The Prompt Architect is presented as a continuous
 * project-intelligence role, never merely a prompt writer.
 */
export function RelayWorkforceRecommendation({
  recommendation,
}: {
  recommendation: WorkforceRecommendation;
}) {
  return (
    <section className="reh-workforce" aria-labelledby="reh-workforce-heading">
      <h2 id="reh-workforce-heading" className="reh-section-title">
        RECOMMENDED WORKFORCE
      </h2>
      <p className="reh-workforce-note">Preview only — confirmed in Project Settings.</p>
      <ol className="reh-workforce-chain">
        {recommendation.roles.map((role) => (
          <li key={role.role} className={`reh-wf-role reh-wf-role--${role.role}`}>
            <div className="reh-wf-head">
              <span className="reh-wf-title">{role.role.replace(/_/g, ' ').toUpperCase()}</span>
              <span className={`reh-wf-status reh-wf-status--${role.status}`}>
                {CONNECTION_STATUS_LABEL[role.status]}
              </span>
            </div>
            <p className="reh-wf-agent">{role.agentName}</p>
            <p className="reh-wf-desc">{role.description}</p>
            <ul className="reh-wf-resp">
              {role.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {role.handoffLabel && (
              <p className="reh-wf-handoff" aria-label={`Handoff: ${role.handoffLabel}`}>
                <span aria-hidden="true">↓ </span>
                {role.handoffLabel}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="reh-wf-rationale">{recommendation.rationale}</p>
    </section>
  );
}
