import type { ResearchRecommendation } from './contracts';

/**
 * PROJECT RESEARCH preview — status is always NOT CONFIGURED on the Home
 * screen. No research runs here, no provider call, nothing is pretended.
 * Project Settings later controls topics, sources, cadence, permissions,
 * cost limits, citations, and Project Brain approval.
 */
export function RelayResearchPreview({
  recommendation,
}: {
  recommendation: ResearchRecommendation;
}) {
  return (
    <section className="reh-research" aria-labelledby="reh-research-heading">
      <div className="reh-research-head">
        <h2 id="reh-research-heading" className="reh-section-title">
          PROJECT RESEARCH
        </h2>
        <span className="reh-research-status">NOT CONFIGURED</span>
      </div>
      <p className="reh-research-desc">{recommendation.description}</p>
      {recommendation.topics.length > 0 && (
        <div className="reh-research-topics">
          <span className="reh-status-key">SUGGESTED TOPICS</span>
          <ul>
            {recommendation.topics.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="reh-research-note">
        Research is configured and approved in Project Settings. Nothing has been researched yet.
      </p>
    </section>
  );
}
