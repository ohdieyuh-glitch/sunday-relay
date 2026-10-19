import { useMemo, useState } from 'react';
import type { MissionControlData } from './data';
import { buildAgentExchanges } from '../mission';

/**
 * Live Terminal view (Prompt 8.2). Consumes the RelayTerminalReadModel
 * projection — real normalized events, never a fake transcript, never hidden
 * reasoning or secrets. Desktop: side panel/drawer. Mobile: dedicated
 * full-screen page (the parent applies the full-screen class). Filters,
 * pause/resume auto-scroll, and safe copy are the frontend's concern.
 */

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'relay', label: 'Relay' }, { id: 'architect', label: 'Architect' },
  { id: 'coding-agent', label: 'Coding Agent' }, { id: 'reviewer', label: 'Reviewer' },
  { id: 'verification', label: 'Verification' },
] as const;

const CONNECTION_STATE: Record<string, string> = { LIVE: 'LIVE', RECONNECTING: 'RECONNECTING', OFFLINE: 'OFFLINE' };

export function LiveTerminal({ data, mode, fullScreen = false, onClose }: {
  data: MissionControlData; mode: string; fullScreen?: boolean; onClose?: () => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const b = data.bundle;

  const exchanges = useMemo(() => buildAgentExchanges({
    objective: b.mission.objective, changedFiles: b.mission.filesInScope,
    requiredProof: b.mission.requiredEvidence, findingTitle: b.findings[0]?.title ?? null,
    repairAction: b.repairs[0]?.requiredChanges ?? null,
  }), [b]);

  const shown = data.terminalEvents.filter((e) => filter === 'all' || e.sourceRole === filter);
  const conn = CONNECTION_STATE[data.connectionState] ?? 'OFFLINE';

  return (
    <section className={`relay-terminal${fullScreen ? ' relay-terminal--full' : ''}`} aria-label="Live Terminal">
      <header className="relay-terminal-head">
        <div>
          <span className="relay-wordmark-sm">SUNDAY RELAY</span> <span className="relay-dim">— LIVE TERMINAL</span>
        </div>
        {onClose && <button type="button" className="relay-btn ghost relay-terminal-close" onClick={onClose} aria-label="Close Live Terminal">✕</button>}
      </header>
      <dl className="relay-terminal-meta">
        <div><dt>Mode</dt><dd>{mode}</dd></div>
        <div><dt>Plan</dt><dd>{data.entitlementLabel}</dd></div>
        <div><dt>Mission</dt><dd>{b.mission.title}</dd></div>
        <div><dt>Run</dt><dd>{b.mission.missionId}</dd></div>
        <div><dt>Status</dt><dd>{b.verdict.verdict}</dd></div>
        <div><dt>Dog</dt><dd>{data.dog.state} · {data.dog.statusLabel}</dd></div>
        <div><dt>Connection</dt><dd className={`relay-conn relay-conn--${conn.toLowerCase()}`}>{conn === 'RECONNECTING' ? 'RECONNECTING' : conn}</dd></div>
        <div><dt>Provenance</dt><dd>SIMULATED</dd></div>
      </dl>

      <div className="relay-terminal-filters" role="tablist" aria-label="Event filters">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
            className={`relay-filter${filter === f.id ? ' is-active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="relay-terminal-filters-spacer" />
        <button type="button" className="relay-filter" aria-pressed={autoScroll} onClick={() => setAutoScroll((v) => !v)}>
          {autoScroll ? 'Pause scroll' : 'Resume scroll'}
        </button>
      </div>

      <ol className="relay-terminal-feed" aria-label="Event feed">
        {shown.map((e) => (
          <li key={e.eventId} className={`relay-tev relay-tev--${e.severity ?? 'info'}`}>
            <span className="relay-tev-seq">{String(e.sequence).padStart(2, '0')}</span>
            <span className={`relay-tag relay-tag--${e.sourceRole}`}>{e.sourceRole}</span>
            <span className="relay-tev-headline">{e.headline}</span>
            {e.omittedPrivateReasoning && <span className="relay-dim"> · Private reasoning omitted.</span>}
            <p className="relay-tev-summary">{e.safeSummary}</p>
          </li>
        ))}
      </ol>

      <details className="relay-exchanges">
        <summary>Responsibility exchanges</summary>
        {exchanges.map((x, i) => (
          <div key={i} className="relay-exchange">
            <span className="relay-exchange-route">{x.from} → {x.to}</span>
            <p className="relay-exchange-title">{x.title}</p>
            <pre className="relay-exchange-lines">{x.lines.join('\n')}</pre>
          </div>
        ))}
      </details>
    </section>
  );
}
