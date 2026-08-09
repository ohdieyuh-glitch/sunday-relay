import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatEventTime } from './projections';
import { codingTerminalEmptyMessage } from './coding-terminal';
import type { CodingTerminalView } from './coding-terminal';
import type { CodingTerminalLine } from '../app/contracts';

/**
 * THE CODING AGENT TERMINAL.
 *
 * The title is `view.runtime` — the runtime this mission asked for — and was
 * the literal "CLAUDE CODE" whichever surface ran. A hosted Agent-SDK run was
 * titled CLAUDE CODE on the main execution surface, which is the defect the
 * role registry exists to make impossible, surviving in a component after it
 * had been fixed in the role row and the event stream.
 *
 * A terminal-style execution surface for the ONE real Claude Code invocation
 * that performs the mission. It is an observation window, not a shell: there
 * is no command input, it never launches a process, and it renders only the
 * normalized, sanitized facts Relay captured.
 *
 * Truthfulness rules encoded in this component:
 *   - every body row comes from `view.lines`; nothing is synthesized
 *   - the agent's own statements render as CLAIM, Relay's findings as
 *     EVIDENCE, and the two never share a treatment
 *   - while the process is genuinely running and no newer event exists, the
 *     single approved waiting line is shown (with a live cursor, which
 *     represents real process state)
 *   - hidden reasoning never arrives here and is never reconstructed
 *   - absent facts are shown as absent, never as a placeholder value
 *
 * Visual language: black stage, cream text, muted gold accents, monospace,
 * editorial and restrained — the existing Relay workspace tokens.
 */

const KIND_LABEL: Record<CodingTerminalLine['kind'], string> = {
  session: 'SESSION',
  tool: 'TOOL',
  process: 'PROCESS',
  claim: 'CLAIM',
  inspection: 'INSPECTION',
  command: 'COMMAND',
  verification: 'VERIFICATION',
  notice: 'NOTICE',
};

const TRUTH_LABEL: Record<CodingTerminalLine['truth'], string> = {
  agent_claim: 'CLAIM',
  relay_evidence: 'RELAY EVIDENCE',
  system_notice: 'SYSTEM',
};

/** Distance from the bottom (px) still treated as "at the bottom". */
const BOTTOM_THRESHOLD = 24;

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Real elapsed runtime: ticks only while the process is genuinely running. */
function useElapsed(view: CodingTerminalView): string | null {
  const running = view.status === 'live' && view.startedAt !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return useMemo(() => {
    if (!view.startedAt) return null;
    const start = Date.parse(view.startedAt);
    if (Number.isNaN(start)) return null;
    const end = view.endedAt ? Date.parse(view.endedAt) : nowMs;
    if (Number.isNaN(end)) return null;
    return formatElapsed(end - start);
  }, [view.startedAt, view.endedAt, nowMs]);
}

function TerminalLineRow({ line }: { line: CodingTerminalLine }) {
  const tone =
    line.truth === 'relay_evidence' ? 'evidence' : line.truth === 'agent_claim' ? 'claim' : 'system';
  return (
    <li className={`rcat-line rcat-line--${tone}`}>
      <span className="rcat-line-time">{formatEventTime(line.at)}</span>
      <span className="rcat-line-kind">{KIND_LABEL[line.kind]}</span>
      <span className="rcat-line-body">
        <span className="rcat-line-text">{line.text}</span>
        {line.target && <span className="rcat-line-target">{line.target}</span>}
      </span>
      <span className="rcat-line-truth">{TRUTH_LABEL[line.truth]}</span>
    </li>
  );
}

export function RelayCodingAgentTerminal({
  view,
  reducedMotion = false,
}: {
  view: CodingTerminalView;
  reducedMotion?: boolean;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const elapsed = useElapsed(view);
  const active = view.status === 'live';

  // Auto-scroll while active. A manual scroll away from the bottom turns it
  // off (no forced snap-back); returning to the bottom turns it back on.
  const onScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    const el = feedRef.current;
    if (!el || !autoScroll) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll, view.lines.length, view.waitingMessage]);

  if (!view.present) {
    return (
      <section className="rcat rcat--empty" aria-label={`${view.runtime} — Coding Agent terminal`}>
        <header className="rcat-head">
          <span className="rcat-title">
            <span className="rcat-square" aria-hidden="true">
              ■
            </span>{' '}
            {view.runtime.toUpperCase()}
          </span>
          <span className="rcat-role">CODING AGENT</span>
          <span className="rcat-status rcat-status--waiting">WAITING</span>
        </header>
        <div className="rcat-empty">
          <p>{codingTerminalEmptyMessage(view.runtime)}</p>
          <p className="rcat-dim">
            Execution activity appears here when a mission dispatches the Coding Agent.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rcat${reducedMotion ? ' rcat--static' : ''}`}
      aria-label={`${view.runtime} — Coding Agent terminal`}
    >
      <header className="rcat-head">
        <span className="rcat-title">
          <span className="rcat-square" aria-hidden="true">
            ■
          </span>{' '}
          {view.runtime.toUpperCase()}
        </span>
        <span className="rcat-role">CODING AGENT</span>
        <span className={`rcat-status rcat-status--${view.status}`} role="status">
          {active && (
            <span className="rcat-status-dot" aria-hidden="true">
              ●{' '}
            </span>
          )}
          {view.statusLabel}
        </span>
        <span className="rcat-billing">{view.billingLabel}</span>
      </header>

      <dl className="rcat-meta">
        <div className="rcat-meta-cell">
          <dt>EXECUTION</dt>
          <dd>{view.executionId}</dd>
        </div>
        <div className="rcat-meta-cell">
          <dt>ELAPSED</dt>
          <dd>{elapsed ?? '—'}</dd>
        </div>
        <div className="rcat-meta-cell">
          <dt>PHASE</dt>
          <dd>{view.phaseLabel}</dd>
        </div>
        <div className="rcat-meta-cell">
          <dt>PROJECT</dt>
          <dd>{view.projectLabel}</dd>
        </div>
        <div className="rcat-meta-cell">
          <dt>RUNTIME</dt>
          <dd>{view.runtime}</dd>
        </div>
        {view.externalSessionRedacted && (
          <div className="rcat-meta-cell">
            <dt>SESSION</dt>
            <dd>{view.externalSessionRedacted}</dd>
          </div>
        )}
      </dl>

      <p className="rcat-permissions">
        <span className="rcat-key">PERMISSIONS</span> {view.permissionSummary}
      </p>

      <div
        className="rcat-feed"
        ref={feedRef}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label={`${view.runtime} execution events`}
      >
        {view.lines.length === 0 && !view.waitingMessage && (
          <p className="rcat-dim rcat-feed-empty">No execution event has been recorded yet.</p>
        )}
        <ol className="rcat-lines">
          {view.lines.map((line) => (
            <TerminalLineRow key={`${line.sequence}-${line.at}`} line={line} />
          ))}
        </ol>
        {view.waitingMessage && (
          <p className="rcat-waiting" role="status">
            {view.waitingMessage}
            <span className="rcat-cursor" aria-hidden="true">
              ▊
            </span>
          </p>
        )}
      </div>

      {view.claim && (
        <section className="rcat-block rcat-block--claim" aria-label="Coding agent claim">
          <h3 className="rcat-block-title">
            {view.runtime.toUpperCase()} CLAIM{' '}
            <span className="rcat-block-tag">UNVERIFIED UNTIL RELAY CHECKS IT</span>
          </h3>
          <p className="rcat-claim-summary">{view.claim.summary}</p>
          {view.claim.filesChanged.length > 0 && (
            <p className="rcat-dim">Claimed files: {view.claim.filesChanged.join(', ')}</p>
          )}
          {view.claim.checksRun.length > 0 && (
            <p className="rcat-dim">Claimed checks: {view.claim.checksRun.join(' · ')}</p>
          )}
        </section>
      )}

      {view.test && (
        <section className="rcat-block rcat-block--test" aria-label="Relay verification result">
          <h3 className="rcat-block-title">
            RELAY VERIFICATION{' '}
            <span className={`rcat-test-status rcat-test-status--${view.test.status}`}>
              {view.testStatusLabel}
            </span>
          </h3>
          <p className="rcat-command">
            <span className="rcat-prompt" aria-hidden="true">
              $
            </span>{' '}
            {view.test.command}
          </p>
          <p className="rcat-dim">
            Exit status: {view.test.exitCode === null ? 'unavailable' : view.test.exitCode}
          </p>
          {view.test.output && <pre className="rcat-output">{view.test.output}</pre>}
        </section>
      )}

      {view.diff && (
        <section className="rcat-block rcat-block--diff" aria-label="Resulting diff">
          <button
            type="button"
            className="rcat-toggle"
            aria-expanded={diffOpen}
            onClick={() => setDiffOpen((open) => !open)}
          >
            {diffOpen ? '▾' : '▸'} RESULTING DIFF ({view.changedFileCount} file
            {view.changedFileCount === 1 ? '' : 's'})
          </button>
          {diffOpen && <pre className="rcat-diff">{view.diff}</pre>}
        </section>
      )}

      <footer className="rcat-foot">
        <span className="rcat-foot-cell">
          <span className="rcat-key">ACTIVE FILE</span> {view.activeFile ?? '—'}
        </span>
        <span className="rcat-foot-cell">
          <span className="rcat-key">CHANGED</span> {view.changedFileCount}
        </span>
        <span className="rcat-foot-cell">
          <span className="rcat-key">LAST EXIT</span>{' '}
          {view.lastExitCode === null ? '—' : view.lastExitCode}
        </span>
        <span className="rcat-foot-cell">
          <span className="rcat-key">TESTS</span> {view.testStatusLabel}
        </span>
        <span className="rcat-foot-cell">
          <span className="rcat-key">EVENTS</span> {view.eventCount}
        </span>
        <span className="rcat-foot-cell">
          <span className="rcat-key">ATTESTATION</span>{' '}
          <span className={view.attested ? 'rcat-attested' : 'rcat-unattested'}>
            {view.attestationLabel}
          </span>
        </span>
        <button
          type="button"
          className="rcat-toggle rcat-toggle--scroll"
          aria-pressed={autoScroll}
          onClick={() => {
            const next = !autoScroll;
            setAutoScroll(next);
            if (next && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
          }}
        >
          AUTO-SCROLL {autoScroll ? 'ON' : 'PAUSED'}
        </button>
      </footer>
    </section>
  );
}
