import { useState } from 'react';
import { RelayProjectBriefDraftPanel } from './RelayProjectBriefDraft';
import type { RelayGuideChatProps } from './contracts';

/**
 * ASK RELAY — in-product guidance chat. Its ONLY purposes: explain how Relay
 * works (modes, roles, setup, permissions, verification, safety), help shape
 * a project idea, and help generate the beginning Project Brief Draft.
 *
 * It is NOT the execution console, NOT the Prompt Architect's active project
 * conversation, NOT a coding terminal. It cannot modify files, launch agents,
 * or start a mission. No provider is called from this component — messages
 * leave through onSendMessage and the host connects an approved Relay
 * product-guidance service later.
 */
export function RelayGuideChat({
  messages,
  status,
  suggestedQuestions,
  projectBriefDraft,
  onSendMessage,
  onSelectSuggestedQuestion,
  onUpdateProjectBriefDraft,
  onCopyProjectBrief,
  onClearProjectBrief,
  onContinueToProjectSettings,
}: RelayGuideChatProps) {
  const [input, setInput] = useState('');

  const send = () => {
    const text = input.trim();
    if (!text) return;
    onSendMessage(text);
    setInput('');
  };

  return (
    <section className="reh-guide" aria-labelledby="reh-guide-heading">
      <div className="reh-guide-chat">
        <div className="reh-guide-head">
          <h2 id="reh-guide-heading" className="reh-section-title">
            ASK RELAY
          </h2>
          <span className="reh-guide-status" role="status" aria-live="polite">
            {status === 'drafting' ? 'DRAFTING' : status === 'listening' ? 'LISTENING' : 'IDLE'}
          </span>
        </div>
        <p className="reh-guide-scope">
          Guidance only — Ask Relay never runs agents, edits files, or starts a mission. Missions
          begin after Project Settings.
        </p>

        {messages.length === 0 ? (
          <div className="reh-guide-empty">
            <p>
              Ask how Relay works, explore a project idea, or create the first draft of your project
              brief.
            </p>
          </div>
        ) : (
          <ol className="reh-guide-messages" aria-label="Ask Relay conversation">
            {messages.map((m) => (
              <li key={m.messageId} className={`reh-msg reh-msg--${m.author}`}>
                <span className="reh-msg-author">
                  {m.author === 'developer' ? 'YOU' : 'RELAY'}
                </span>
                {m.fixture && <span className="reh-msg-fixture">FIXTURE</span>}
                <p className="reh-msg-text">{m.text}</p>
                <span className="reh-msg-at">{m.at}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="reh-guide-suggested" aria-label="Suggested questions">
          {suggestedQuestions.map((q) => (
            <button
              key={q}
              type="button"
              className="reh-suggested-q"
              onClick={() => onSelectSuggestedQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="reh-guide-input">
          <label className="reh-visually-hidden" htmlFor="reh-guide-text">
            Ask Relay
          </label>
          <input
            id="reh-guide-text"
            type="text"
            value={input}
            placeholder="Ask how Relay works, or describe your idea…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
          <button type="button" className="reh-btn reh-btn--primary" onClick={send}>
            SEND
          </button>
        </div>
      </div>

      <RelayProjectBriefDraftPanel
        draft={projectBriefDraft}
        onUpdateProjectBriefDraft={onUpdateProjectBriefDraft}
        onCopyProjectBrief={onCopyProjectBrief}
        onClearProjectBrief={onClearProjectBrief}
        onContinueToProjectSettings={onContinueToProjectSettings}
      />
    </section>
  );
}
