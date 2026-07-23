import { useEffect, useRef, useState } from 'react';
import { RelayDogMark } from '../pixel-dog';
import { RelayProjectFooter } from './RelayProjectFooter';
import { CATEGORY_LABEL, OUTPUT_STATE_LABEL, TRUTH_BADGE, formatEventTime } from './projections';
import type {
  HandoffNetworkState,
  RelayWorkspaceMode,
  TerminalEventCategory,
  WorkforceAssignment,
  WorkspaceMission,
  WorkspaceOutputState,
  WorkspaceProject,
  WorkspaceTerminalEvent,
} from './contracts';

/**
 * TERMINAL MODE — the founder-screenshot full view opened by the `>_`
 * control: framed SUNDAY RELAY header, LIVE mission status row, one outlined
 * panel per role (PROMPT ARCHITECT / CODING AGENT / RELAY SYSTEM) with
 * timeline rows and safe right-aligned operation summaries, the ask input,
 * and the system footer.
 *
 * THIS IS NOT THE CLI. It renders the same safe normalized Relay events —
 * never shell prompts, raw commands, stdout/stderr, provider streams, hidden
 * reasoning, session identifiers, environment values, or credentials. The
 * input is the supervisory Project Conversation, not command execution.
 */

const ARCHITECT_CATS: ReadonlySet<TerminalEventCategory> = new Set(['prompt_architect', 'research']);
const CODING_CATS: ReadonlySet<TerminalEventCategory> = new Set(['coding_agent', 'repair']);

const ACTIVE_STATES: ReadonlySet<WorkspaceOutputState> = new Set([
  'ready',
  'implementing',
  'held_for_inspection',
  'held_for_verification',
  'held_for_review',
  'held_for_re_review',
  'repairing',
]);

const ARCHITECT_STATUS: Record<WorkforceAssignment['promptArchitect']['status'], string> = {
  planning: 'PLANNING',
  researching: 'RESEARCHING',
  preparing_handoff: 'PREPARING HANDOFF',
  waiting: 'WAITING',
};
const CODING_STATUS: Record<WorkforceAssignment['codingAgent']['status'], string> = {
  ready: 'READY',
  implementing: 'WORKING',
  verifying: 'VERIFYING',
  repairing: 'REPAIRING',
  waiting: 'WAITING',
};

function TerminalRow({ event }: { event: WorkspaceTerminalEvent }) {
  const badge = TRUTH_BADGE[event.truth];
  const verified = event.truth === 'relay_evidence';
  return (
    <li className={`rpw-tmrow rpw-tmrow--${badge.tone}`}>
      <span className="rpw-tmrow-square" aria-hidden="true">
        ■
      </span>
      <span className="rpw-tmrow-time">{formatEventTime(event.at)}</span>
      <div className="rpw-tmrow-main">
        <p className="rpw-tmrow-headline">
          <span className="rpw-tmrow-role">{CATEGORY_LABEL[event.category]}:</span>{' '}
          {event.headline}
          {verified && (
            <span className="rpw-tmrow-check" aria-hidden="true">
              {' '}
              ✓
            </span>
          )}
        </p>
        {event.detail && <p className="rpw-tmrow-detail">{event.detail}</p>}
        <span className={`rpw-tev-truth rpw-tev-truth--${badge.tone}`}>
          {badge.label}
          {event.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
        </span>
      </div>
      <span className="rpw-tmrow-meta">
        {event.meta && <span className="rpw-tmrow-op">{event.meta}</span>}
        {verified && <span className="rpw-tmrow-verified">✓ VERIFIED</span>}
      </span>
    </li>
  );
}

function RolePanel({
  title,
  chip,
  rightStatus,
  events,
  contextLine,
}: {
  title: string;
  chip: string;
  rightStatus: string;
  events: WorkspaceTerminalEvent[];
  contextLine?: string;
}) {
  if (events.length === 0 && !contextLine) return null;
  return (
    <section className="rpw-tmpanel" aria-label={`${title} activity`}>
      <header className="rpw-tmpanel-head">
        <span className="rpw-tmpanel-title">
          <span className="rpw-tmpanel-square" aria-hidden="true">
            ■
          </span>{' '}
          {title} <span className="rpw-tmpanel-chip">{chip}</span>
        </span>
        <span className="rpw-tmpanel-status">{rightStatus}</span>
      </header>
      <ol className="rpw-tmpanel-feed">
        {events.map((e) => (
          <TerminalRow key={e.eventId} event={e} />
        ))}
      </ol>
      {contextLine && <p className="rpw-tmpanel-context">{contextLine}</p>}
    </section>
  );
}

export function RelayLiveTerminalPanel({
  project,
  mission,
  events,
  handoffNetworkState,
  workforce,
  mode,
  outputState,
  fullScreen = false,
  onClose,
  onSendProjectMessage,
}: {
  project: WorkspaceProject;
  mission: WorkspaceMission;
  events: WorkspaceTerminalEvent[];
  handoffNetworkState: HandoffNetworkState;
  workforce: WorkforceAssignment;
  mode: RelayWorkspaceMode;
  outputState: WorkspaceOutputState;
  fullScreen?: boolean;
  onClose: () => void;
  onSendProjectMessage?: (text: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [input, setInput] = useState('');

  // Focus management: move focus into terminal mode on open and RESTORE the
  // previously focused control on close. Escape also closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || !onSendProjectMessage) return;
    onSendProjectMessage(text);
    setInput('');
  };

  const live = handoffNetworkState === 'online';
  const missionLabel = ACTIVE_STATES.has(outputState)
    ? 'MISSION IN PROGRESS'
    : OUTPUT_STATE_LABEL[outputState];

  const architectEvents = events.filter((e) => ARCHITECT_CATS.has(e.category));
  const codingEvents = events.filter((e) => CODING_CATS.has(e.category));
  const relayEvents = events.filter(
    (e) => !ARCHITECT_CATS.has(e.category) && !CODING_CATS.has(e.category),
  );

  return (
    <section
      className={`rpw-terminal${fullScreen ? ' rpw-terminal--full' : ''}`}
      aria-label="Live Terminal — safe normalized Relay events"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header className="rpw-tm-titlebar">
        <span className="rpw-tm-brand">
          <RelayDogMark unit={2} />
          <span className="rpw-wordmark-sm" aria-label="SUNDAY RELAY — LIVE TERMINAL">
            <span aria-hidden="true">SUNDAY RELAY</span>
          </span>
          <span className="rpw-dim" aria-hidden="true">
            — LIVE TERMINAL
          </span>
        </span>
        <span className="rpw-ref-chip">{project.reference}</span>
        <button
          ref={closeRef}
          type="button"
          className="rpw-btn rpw-terminal-close"
          onClick={onClose}
          aria-label="Close Live Terminal"
        >
          ✕ CLOSE
        </button>
      </header>

      <div className="rpw-tm-statusrow">
        <span className="rpw-tm-left">
          <span className={`rpw-tm-live rpw-tm-live--${live ? 'on' : 'off'}`}>
            ● {live ? 'LIVE' : 'STANDBY'}
          </span>
          <span className="rpw-tm-mission">{missionLabel}</span>
        </span>
        <span className="rpw-tm-meta">
          <span>
            <span className="rpw-tm-metakey">ARCHITECT:</span> {workforce.promptArchitect.name}
          </span>
          <span>
            <span className="rpw-tm-metakey">CODING AGENT:</span> {workforce.codingAgent.name}
          </span>
          <span>
            <span className="rpw-tm-metakey">MODE:</span>{' '}
            <span className="rpw-tm-modechip">{mode.toUpperCase()}</span>
          </span>
        </span>
      </div>
      <p className="rpw-terminal-scope">
        Normalized coordination events only — no raw process output, no hidden reasoning, no
        credentials. This view observes; it does not execute.
      </p>

      {events.length === 0 ? (
        <div className="rpw-console-empty">
          <p>No mission is running.</p>
          <p className="rpw-dim">
            Relay activity will appear here after Project Settings is confirmed and the first
            mission begins.
          </p>
        </div>
      ) : (
        <div className="rpw-tm-panels">
          <RolePanel
            title="PROMPT ARCHITECT"
            chip={architectEvents.length > 0 ? 'ACTIVE' : 'IDLE'}
            rightStatus={ARCHITECT_STATUS[workforce.promptArchitect.status]}
            events={architectEvents}
          />
          <RolePanel
            title="CODING AGENT"
            chip={codingEvents.length > 0 ? 'ACTIVE' : 'IDLE'}
            rightStatus={CODING_STATUS[workforce.codingAgent.status]}
            events={codingEvents}
          />
          <RolePanel
            title="RELAY SYSTEM"
            chip={live ? 'LIVE' : 'STANDBY'}
            rightStatus={OUTPUT_STATE_LABEL[outputState]}
            events={relayEvents}
            contextLine={`CONTEXT ID: ${mission.missionId}`}
          />
        </div>
      )}

      {onSendProjectMessage && (
        <div className="rpw-tm-input">
          <span className="rpw-conv-prompt" aria-hidden="true">
            &gt;_
          </span>
          <label className="rpw-visually-hidden" htmlFor="rpw-tm-text">
            Ask Relay about this project
          </label>
          <input
            id="rpw-tm-text"
            type="text"
            value={input}
            placeholder="Ask Relay about this project…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
          <button type="button" className="rpw-btn rpw-btn--primary" onClick={send}>
            ⌘↵ SEND
          </button>
        </div>
      )}

      <RelayProjectFooter handoffNetworkState={handoffNetworkState} outputState={outputState} />
    </section>
  );
}
