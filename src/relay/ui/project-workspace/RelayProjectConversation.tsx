import { useState } from 'react';
import type { ProjectMessage } from './contracts';

/**
 * PROJECT CHANNEL — the developer's interactive conversation with Relay
 * about the ACTIVE project. Distinct from the Live Terminal (observational).
 * It never displays hidden reasoning, raw prompts, raw process output, or
 * secrets; agent text is never presented as verified evidence. Messages
 * leave through callbacks only — no provider is called from the browser.
 */
export function RelayProjectConversation({
  messages,
  onSendProjectMessage,
  onApproveDecision,
  onRejectDecision,
}: {
  messages: ProjectMessage[];
  onSendProjectMessage: (text: string) => void;
  onApproveDecision: (decisionId: string) => void;
  onRejectDecision: (decisionId: string) => void;
}) {
  const [input, setInput] = useState('');

  const send = () => {
    const text = input.trim();
    if (!text) return;
    onSendProjectMessage(text);
    setInput('');
  };

  return (
    <section className="rpw-conversation" aria-labelledby="rpw-conv-heading">
      <div className="rpw-panel-head">
        <h2 id="rpw-conv-heading" className="rpw-section-title">
          PROJECT CHANNEL
        </h2>
        <span className="rpw-panel-note">Interactive — supervise and direct the project</span>
      </div>

      <ol className="rpw-conv-messages" aria-label="Project conversation">
        {messages.map((m) => (
          <li key={m.messageId} className={`rpw-msg rpw-msg--${m.author}`}>
            <span className="rpw-msg-author">{m.author === 'developer' ? 'YOU' : 'RELAY'}</span>
            {m.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
            <p className="rpw-msg-text">{m.text}</p>
            <span className="rpw-msg-at">{m.at}</span>
            {m.kind === 'approval_request' && m.decisionId && (
              <span className="rpw-msg-decision">
                <button
                  type="button"
                  className="rpw-btn rpw-btn--primary"
                  onClick={() => onApproveDecision(m.decisionId!)}
                >
                  APPROVE
                </button>
                <button
                  type="button"
                  className="rpw-btn"
                  onClick={() => onRejectDecision(m.decisionId!)}
                >
                  REJECT
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="rpw-conv-input">
        <label className="rpw-visually-hidden" htmlFor="rpw-conv-text">
          Ask Relay about this project
        </label>
        <input
          id="rpw-conv-text"
          type="text"
          value={input}
          placeholder="Ask Relay about this project…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="rpw-btn rpw-btn--primary" onClick={send}>
          SEND
        </button>
      </div>
      <p className="rpw-conv-scope">
        Supervisory channel — this is not the Live Terminal and never launches agents directly.
      </p>
    </section>
  );
}
