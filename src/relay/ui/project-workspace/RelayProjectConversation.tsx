import { useState } from 'react';
import { routeRelayInput } from '../../mission';
import type { ProjectMessage } from './contracts';

/**
 * PROJECT CHANNEL — the developer's interactive conversation with Relay
 * about the ACTIVE project, docked directly beneath the Relay Console.
 * Interactive where the console is observational; never bubbles inside the
 * activity console. It never displays hidden reasoning, raw prompts, raw
 * process output, or secrets; agent text is never presented as verified
 * evidence. Messages leave through callbacks only — no provider is called
 * from the browser.
 */

const QUICK_ACTIONS = [
  'What is happening?',
  'Why is Relay waiting?',
  'Explain the Reviewer finding',
  'What evidence passed?',
  'What is the Prompt Architect researching?',
  'Add a project requirement',
];

export function RelayProjectConversation({
  messages,
  onSendProjectMessage,
  onSendSlashCommand,
  onApproveDecision,
  onRejectDecision,
}: {
  messages: ProjectMessage[];
  onSendProjectMessage: (text: string) => void;
  /**
   * Slash input, routed to the CANONICAL grammar rather than the conversation.
   * Optional so an embedding surface that has no Loop composer yet keeps
   * today's behaviour instead of silently swallowing `/loop …` — a command
   * that quietly became a chat message would be the worst of both.
   */
  onSendSlashCommand?: (text: string) => void;
  onApproveDecision: (decisionId: string) => void;
  onRejectDecision: (decisionId: string) => void;
}) {
  const [input, setInput] = useState('');

  const send = () => {
    const text = input.trim();
    if (!text) return;
    // ONE seam between the two interpreters. Leading slash goes to the Loop
    // grammar; everything else stays natural language, which the existing
    // deterministic mission command interpreter owns. Loop-first does not
    // mean chat-removed.
    if (routeRelayInput(text) === 'slash' && onSendSlashCommand !== undefined) {
      onSendSlashCommand(text);
    } else {
      onSendProjectMessage(text);
    }
    setInput('');
  };

  // Show recent exchange plus EVERY pending approval request — an approval
  // must never become unreachable because newer messages arrived.
  const recent = messages.slice(-3);
  const pendingDecisions = messages.filter(
    (m) => m.kind === 'approval_request' && m.decisionId && !recent.includes(m),
  );
  const shown = [...pendingDecisions, ...recent];

  return (
    <section className="rpw-conversation" aria-labelledby="rpw-conv-heading">
      <div className="rpw-conv-head">
        <h2 id="rpw-conv-heading" className="rpw-conv-title">
          PROJECT CONVERSATION
        </h2>
        <span className="rpw-conv-note">
          Interactive — the console above is observational, not the Live Terminal input.
        </span>
      </div>

      {shown.length > 0 && (
        <ol className="rpw-conv-messages" aria-label="Project conversation">
          {shown.map((m) => (
            <li key={m.messageId} className={`rpw-msg rpw-msg--${m.author}`}>
              <span className="rpw-msg-author">{m.author === 'developer' ? 'YOU' : 'RELAY'}</span>
              <span className="rpw-msg-text">{m.text}</span>
              {m.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
              {m.kind === 'approval_request' && m.decisionId && (
                <span className="rpw-conv-decision">
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
      )}

      <div className="rpw-conv-input">
        <span className="rpw-conv-prompt" aria-hidden="true">
          &gt;_
        </span>
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
        <button type="button" className="rpw-btn rpw-btn--primary rpw-conv-send" onClick={send}>
          SEND
        </button>
      </div>

      <div className="rpw-conv-quick" aria-label="Quick questions">
        {QUICK_ACTIONS.map((q) => (
          <button key={q} type="button" className="rpw-quick" onClick={() => onSendProjectMessage(q)}>
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}
