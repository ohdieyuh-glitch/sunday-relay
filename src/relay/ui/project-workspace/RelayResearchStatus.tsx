import { useState } from 'react';
import type { ResearchState } from './contracts';

/**
 * Prompt Architect research automation status. Truthful states only:
 * NOT CONFIGURED / MONITORING APPROVED TOPICS / RESEARCHING / NEW KNOWLEDGE
 * AWAITING APPROVAL. Research requests leave through a callback; no research
 * runs in the browser.
 */

const STATUS_LABEL: Record<ResearchState['status'], string> = {
  not_configured: 'NOT CONFIGURED',
  monitoring: 'MONITORING APPROVED TOPICS',
  researching: 'RESEARCHING',
  awaiting_approval: 'NEW KNOWLEDGE AWAITING APPROVAL',
};

export function RelayResearchStatus({
  state,
  onRequestResearch,
}: {
  state: ResearchState;
  onRequestResearch: (topic: string) => void;
}) {
  const [topic, setTopic] = useState('');

  const request = () => {
    const t = topic.trim();
    if (!t) return;
    onRequestResearch(t);
    setTopic('');
  };

  return (
    <section className="rpw-research" aria-labelledby="rpw-research-heading">
      <div className="rpw-panel-head">
        <h2 id="rpw-research-heading" className="rpw-section-title">
          PROJECT RESEARCH
        </h2>
        <span className={`rpw-research-status rpw-research-status--${state.status}`}>
          {STATUS_LABEL[state.status]}
        </span>
      </div>
      {state.note && <p className="rpw-research-note">{state.note}</p>}
      {state.approvedTopics.length > 0 && (
        <ul className="rpw-research-topics" aria-label="Approved research topics">
          {state.approvedTopics.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <div className="rpw-research-request">
        <label className="rpw-visually-hidden" htmlFor="rpw-research-topic">
          Request a research topic
        </label>
        <input
          id="rpw-research-topic"
          type="text"
          value={topic}
          placeholder="Request a research topic…"
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') request();
          }}
        />
        <button type="button" className="rpw-btn" onClick={request}>
          REQUEST RESEARCH
        </button>
      </div>
    </section>
  );
}
