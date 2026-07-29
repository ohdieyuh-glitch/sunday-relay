import { useEffect, useRef, useState } from 'react';
import { RelayDogMark } from '../pixel-dog';
import { RelayProjectFooter } from './RelayProjectFooter';
import { RelayCodingAgentTerminal } from './RelayCodingAgentTerminal';
import type { CodingTerminalView } from './coding-terminal';
import { OUTPUT_STATE_LABEL, TRUTH_BADGE, formatEventTime } from './projections';
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
 * TERMINAL MODE — drawn to the founder terminal photo: a framed SUNDAY
 * RELAY terminal window (traffic-light chrome, centered brand, RLY chip),
 * `● LIVE / MISSION IN PROGRESS` status row, one outlined panel per role —
 * PROMPT ARCHITECT (THINKING …), CODING AGENT (WORKING …), RELAY SYSTEM
 * (LIVE) — with timeline rows that read like live agent work: gold role
 * prefix, activity headline, dim sub-detail, right-aligned safe operation
 * summaries (CREATE / MODIFY / RUN …) and green ✓ COMPLETE steps, then the
 * `>_ Ask Relay` prompt with ⌘↵ SEND and the system footer.
 *
 * THIS IS NOT THE CLI. It renders the same safe normalized Relay events —
 * never shell prompts, raw commands, stdout/stderr, provider streams, hidden
 * reasoning, session identifiers, environment values, or credentials. The
 * input is the supervisory Project Conversation, not command execution, and
 * an agent's activity line is always its claim until Relay verifies it.
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

/** Mixed-case role prefixes for terminal rows (founder photo language). */
const ROW_ROLE_LABEL: Record<TerminalEventCategory, string> = {
  relay: 'Relay',
  prompt_architect: 'Prompt Architect',
  research: 'Prompt Architect',
  coding_agent: 'Coding Agent',
  workspace_inspection: 'Relay Inspection',
  verification: 'Relay Verification',
  reviewer: 'Reviewer',
  repair: 'Coding Agent',
  manual_task: 'Relay',
  completion_engine: 'Relay',
  security: 'Relay Security',
  system: 'System',
};

const ARCHITECT_BUSY: ReadonlySet<WorkforceAssignment['promptArchitect']['status']> = new Set([
  'planning',
  'researching',
  'preparing_handoff',
]);
const CODING_BUSY: ReadonlySet<WorkforceAssignment['codingAgent']['status']> = new Set([
  'implementing',
  'verifying',
  'repairing',
]);

const ARCHITECT_STATUS: Record<WorkforceAssignment['promptArchitect']['status'], string> = {
  planning: 'THINKING',
  researching: 'RESEARCHING',
  preparing_handoff: 'THINKING',
  waiting: 'WAITING',
};
const CODING_STATUS: Record<WorkforceAssignment['codingAgent']['status'], string> = {
  ready: 'READY',
  implementing: 'WORKING',
  verifying: 'VERIFYING',
  repairing: 'REPAIRING',
  waiting: 'WAITING',
};

/** Pulsing activity dots after a busy status (THINKING ●●●). */
function BusyDots() {
  return (
    <span className="rpw-tm-dots" aria-hidden="true">
      <span>●</span>
      <span>●</span>
      <span>●</span>
    </span>
  );
}

function TerminalRow({ event, streaming }: { event: WorkspaceTerminalEvent; streaming: boolean }) {
  const badge = TRUTH_BADGE[event.truth];
  const verified = event.truth === 'relay_evidence';
  const done = event.done === true;
  return (
    <li
      className={`rpw-tmrow rpw-tmrow--${badge.tone}${done ? ' rpw-tmrow--done' : ''}`}
    >
      <span className="rpw-tmrow-square" aria-hidden="true">
        ■
      </span>
      <span className="rpw-tmrow-time">{formatEventTime(event.at)}</span>
      <div className="rpw-tmrow-main">
        <p className="rpw-tmrow-headline">
          <span className="rpw-tmrow-role">{ROW_ROLE_LABEL[event.category]}:</span>{' '}
          {event.headline}
          {(verified || done) && (
            <span className="rpw-tmrow-check" aria-hidden="true">
              {' '}
              ✓
            </span>
          )}
          {streaming && !done && (
            <span className="rpw-tm-cursor" aria-hidden="true">
              ▊
            </span>
          )}
        </p>
        <div className="rpw-tmrow-sub">
          {event.detail && <p className="rpw-tmrow-detail">{event.detail}</p>}
          <span className={`rpw-tev-truth rpw-tev-truth--${badge.tone}`}>
            {badge.label}
            {event.fixture && <span className="rpw-fixture-tag">FIXTURE</span>}
          </span>
        </div>
      </div>
      <span className="rpw-tmrow-meta">
        {event.meta && <span className="rpw-tmrow-op">{event.meta}</span>}
        {done && <span className="rpw-tmrow-complete">✓ COMPLETE</span>}
        {verified && <span className="rpw-tmrow-verified">✓ VERIFIED</span>}
      </span>
    </li>
  );
}

function RolePanel({
  title,
  chip,
  rightStatus,
  busy,
  events,
  contextLine,
}: {
  title: string;
  chip: string;
  rightStatus: string;
  /** Busy panels pulse activity dots and stream a cursor on the last open row. */
  busy: boolean;
  events: WorkspaceTerminalEvent[];
  contextLine?: string;
}) {
  if (events.length === 0 && !contextLine) return null;
  const lastId = events.length > 0 ? events[events.length - 1].eventId : null;
  return (
    <section className="rpw-tmpanel" aria-label={`${title} activity`}>
      <header className="rpw-tmpanel-head">
        <span className="rpw-tmpanel-title">
          <span className="rpw-tmpanel-square" aria-hidden="true">
            ■
          </span>{' '}
          {title} <span className="rpw-tmpanel-chip">{chip}</span>
        </span>
        <span className={`rpw-tmpanel-status${busy ? ' rpw-tmpanel-status--busy' : ''}`}>
          {rightStatus}
          {busy && <BusyDots />}
        </span>
      </header>
      <ol className="rpw-tmpanel-feed">
        {events.map((e) => (
          <TerminalRow key={e.eventId} event={e} streaming={busy && e.eventId === lastId} />
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
  codingTerminal,
  fullScreen = false,
  reducedMotion = false,
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
  /** When a real Claude Code execution exists, the CODING AGENT panel is the
      full terminal surface instead of the summary role panel. */
  codingTerminal?: CodingTerminalView;
  fullScreen?: boolean;
  reducedMotion?: boolean;
  onClose: () => void;
  onSendProjectMessage?: (text: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [input, setInput] = useState('');

  // Focus management: move focus into terminal mode on open and RESTORE the
  // previously focused control on close. Escape also closes. The background
  // page must not scroll behind the dialog while it is open.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || !onSendProjectMessage) return;
    onSendProjectMessage(text);
    setInput('');
  };

  // Demo Simulation is a PRESENTATION SOURCE, never a different renderer: the
  // original terminal (this component, these RolePanels) stays mounted and is
  // fed projected simulated events. The mode alone marks the source truthfully.
  const demo = mode === 'demo_simulation';
  const live = !demo && handoffNetworkState === 'online';
  const missionLabel = ACTIVE_STATES.has(outputState)
    ? 'MISSION IN PROGRESS'
    : OUTPUT_STATE_LABEL[outputState];

  const architectEvents = events.filter((e) => ARCHITECT_CATS.has(e.category));
  const codingEvents = events.filter((e) => CODING_CATS.has(e.category));
  const relayEvents = events.filter(
    (e) => !ARCHITECT_CATS.has(e.category) && !CODING_CATS.has(e.category),
  );

  const architectBusy = live && ARCHITECT_BUSY.has(workforce.promptArchitect.status);
  const codingBusy = live && CODING_BUSY.has(workforce.codingAgent.status);

  return (
    <section
      className={`rpw-terminal${fullScreen ? ' rpw-terminal--full' : ''}${
        reducedMotion ? ' rpw-terminal--static' : ''
      }`}
      aria-label={
        demo
          ? 'Live Terminal — Demo Simulation source'
          : 'Live Terminal — safe normalized Relay events'
      }
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="rpw-tm-window">
        <header className="rpw-tm-titlebar">
          <span className="rpw-tm-lights" aria-hidden="true">
            <span className="rpw-tm-light rpw-tm-light--r" />
            <span className="rpw-tm-light rpw-tm-light--y" />
            <span className="rpw-tm-light rpw-tm-light--g" />
          </span>
          <span className="rpw-tm-brand">
            <RelayDogMark unit={2} />
            <span
              className="rpw-wordmark-sm"
              aria-label={demo ? 'SUNDAY RELAY — DEMO TERMINAL' : 'SUNDAY RELAY — LIVE TERMINAL'}
            >
              <span aria-hidden="true">SUNDAY RELAY</span>
            </span>
          </span>
          <span className="rpw-tm-titlebar-right">
            <span className="rpw-ref-chip">
              <span aria-hidden="true">● </span>
              {project.reference}
            </span>
            <button
              ref={closeRef}
              type="button"
              className="rpw-btn rpw-terminal-close"
              onClick={onClose}
              aria-label={demo ? 'Return to Relay workspace' : 'Close Live Terminal'}
            >
              ✕ CLOSE
            </button>
          </span>
        </header>

        <div className="rpw-tm-statusrow">
          <span className="rpw-tm-left">
            <span className={`rpw-tm-live rpw-tm-live--${live ? 'on' : 'off'}`}>
              ● {demo ? 'DEMO SIMULATION' : live ? 'LIVE' : 'STANDBY'}
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
          {demo
            ? 'Scripted visual work products only — no provider calls, no processes, no hidden reasoning. This view observes; it does not execute.'
            : 'Normalized coordination events only — no raw process output, no hidden reasoning, no credentials. This view observes; it does not execute.'}
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
              busy={architectBusy}
              events={architectEvents}
            />
            {codingTerminal ? (
              <RelayCodingAgentTerminal view={codingTerminal} reducedMotion={reducedMotion} />
            ) : (
              <RolePanel
                title="CODING AGENT"
                chip={codingEvents.length > 0 ? 'ACTIVE' : 'IDLE'}
                rightStatus={CODING_STATUS[workforce.codingAgent.status]}
                busy={codingBusy}
                events={codingEvents}
              />
            )}
            <RolePanel
              title="RELAY SYSTEM"
              chip={demo ? 'DEMO' : live ? 'LIVE' : 'STANDBY'}
              rightStatus={OUTPUT_STATE_LABEL[outputState]}
              busy={false}
              events={relayEvents}
              contextLine={`CONTEXT ID: ${mission.missionId}`}
            />
          </div>
        )}

        {onSendProjectMessage && (
          <div className="rpw-tm-input">
            <span className="rpw-tm-prompt" aria-hidden="true">
              &gt;<span className="rpw-tm-prompt-caret">_</span>
            </span>
            <label className="rpw-visually-hidden" htmlFor="rpw-tm-text">
              Ask Relay about this project
            </label>
            <input
              id="rpw-tm-text"
              type="text"
              value={input}
              placeholder="Ask Relay anything about this project…"
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
      </div>
    </section>
  );
}
