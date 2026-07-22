import { useMemo, useState } from 'react';
import { buildMissionControlData, type MissionControlData } from './data';
import { RelayDog } from './RelayDog';
import { LiveTerminal } from './LiveTerminal';
import type { RelayMode } from '../mission';

/**
 * Relay Mission Control (Prompt 8.2). A compact, terminal-dense surface that
 * PROJECTS from Relay Core (via buildMissionControlData) — not a disconnected
 * mockup. Primary screen shows mission/verdict/mode/plan/team/dog/phase, the
 * terminal button, the Manual Task indicator, a proof summary, and the latest
 * event; detail sections use progressive disclosure. Desktop + mobile via
 * CSS. Truthful labels: agents are deterministic SIMULATIONS here.
 */

const MODES: RelayMode[] = ['guided', 'semi', 'autonomous'];

function TerminalButton({ indicator, onClick }: { indicator: 'active' | 'waiting' | 'failure' | 'idle'; onClick: () => void }) {
  const mark = indicator === 'active' ? '●' : indicator === 'waiting' ? '!' : indicator === 'failure' ? '×' : '';
  return (
    <button
      type="button"
      className={`relay-term-btn relay-term-btn--${indicator}`}
      onClick={onClick}
      aria-label="Open Live Terminal"
      title="Open Live Terminal"
    >
      <span aria-hidden="true">&gt;_</span>
      {mark && <span className="relay-term-mark" aria-hidden="true">{mark}</span>}
      <span className="relay-visually-hidden">{indicator === 'waiting' ? 'waiting for you' : indicator === 'failure' ? 'failure' : 'active'}</span>
    </button>
  );
}

export function MissionControl({ initialMode = 'semi' }: { initialMode?: RelayMode }) {
  const [mode, setMode] = useState<RelayMode>(initialMode);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const data: MissionControlData = useMemo(() => buildMissionControlData({ mode }), [mode]);
  const b = data.bundle;
  const verified = b.verdict.verdict === 'verified_complete';
  const indicator: 'active' | 'waiting' | 'failure' | 'idle' =
    b.verdict.verdict === 'failed' ? 'failure'
      : ['needs_human', 'blocked'].includes(b.verdict.verdict) ? 'waiting'
        : verified ? 'idle' : 'active';

  const selectMode = (m: RelayMode) => {
    if (m === 'autonomous' && mode !== 'autonomous') { setShowConsent(true); return; }
    setMode(m);
  };

  return (
    <div className="relay-mc">
      <p className="relay-visually-hidden" aria-live="polite">
        Mission {b.mission.title}. Verdict {b.verdict.verdict}. Relay Dog {data.dog.statusLabel}.
      </p>

      <header className="relay-mc-head">
        <div className="relay-mc-brand">
          <span className="relay-wordmark">SUNDAY RELAY</span>
          <span className="relay-tagline">Mission Control</span>
        </div>
        <div className="relay-mc-head-right">
          <TerminalButton indicator={indicator} onClick={() => setTerminalOpen(true)} />
        </div>
      </header>

      <main className="relay-mc-main">
        <section className="relay-mc-primary" aria-label="Mission summary">
          <div className="relay-mc-mission">
            <h1 className="relay-mc-title">{b.mission.title}</h1>
            <span className={`relay-verdict relay-verdict--${b.verdict.verdict}`}>{b.verdict.verdict.replace(/_/g, ' ')}</span>
          </div>
          <div className="relay-mc-meta">
            <span className="relay-chip">Mode: {mode}</span>
            <span className="relay-chip">Plan: {data.entitlementLabel}</span>
            <span className="relay-chip">Phase: audit</span>
            <span className="relay-chip">Output: {data.outputVisibility}</span>
            <span className="relay-chip relay-chip--sim">SIMULATED</span>
          </div>

          <div className="relay-mc-teamdog">
            <div className="relay-mc-team" aria-label="Agent team">
              <span className="relay-role relay-role--architect">Prompt Architect</span>
              <span className="relay-role relay-role--coding">Claude Code (sim)</span>
              <span className="relay-role relay-role--reviewer">
                Codex Reviewer (sim){data.reviewer.availability !== 'available' && ' — locked'}
              </span>
            </div>
            <RelayDog dog={data.dog} />
          </div>

          <div className="relay-mc-proof" aria-label="Proof summary">
            <span>{b.reviews.length} review(s)</span>
            <span>{b.findings.length} finding(s)</span>
            <span>{b.repairs.length} repair(s)</span>
            <span>{b.attestations.length} attestation(s)</span>
          </div>
          <p className="relay-mc-latest"><span className="relay-dim">Latest:</span> {data.latestEvent}</p>

          <div className="relay-mc-modes" role="group" aria-label="Operational mode">
            {MODES.map((m) => (
              <button key={m} type="button" className={`relay-btn${m === mode ? ' primary' : ' ghost'}`}
                onClick={() => selectMode(m)} aria-pressed={m === mode}>
                {m}
              </button>
            ))}
            <button type="button" className="relay-btn ghost" onClick={() => setTerminalOpen(true)}>Live Terminal</button>
          </div>
        </section>

        {showConsent && (
          <section className="relay-consent" aria-label="Autonomous consent">
            <h2>Autonomous Mode</h2>
            <p>Relay can complete more steps without stopping to ask you. It may use accounts, tools, and secure access that you approve.</p>
            <p><strong>Relay will not display or give your passwords to AI agents.</strong> Relay will still stop before destructive, financial, identity-sensitive, or unsupported actions.</p>
            <h3>Approved access (names and scopes only — never values)</h3>
            <ul className="relay-access-list">
              {data.access.map((a) => (
                <li key={a.service}>{a.service} · {a.accountLabel} · scope {a.scope.join(', ')} · expires {a.expiresAt} · {a.status}</li>
              ))}
              <li>Max spend $5 · Max runtime 30m · Deployment: no · Destructive: no</li>
            </ul>
            <div className="relay-consent-actions">
              <button type="button" className="relay-btn primary" onClick={() => { setMode('autonomous'); setShowConsent(false); }}>Enable Autonomous Mode</button>
              <button type="button" className="relay-btn ghost" onClick={() => setTerminalOpen(true)}>Review Access</button>
              <button type="button" className="relay-btn ghost" onClick={() => setShowConsent(false)}>Cancel</button>
            </div>
          </section>
        )}

        <div className="relay-mc-sections">
          <details><summary>Mission Contract</summary>
            <ul>
              <li>Revision {b.mission.revision} · {b.mission.requirements.length} requirements · {b.mission.acceptanceCriteria.filter((c) => c.blocking).length} blocking criteria</li>
              <li>Implementer: {b.mission.implementerRequirement}</li>
              <li>Reviewer: {b.mission.reviewerRequirement}</li>
              <li>Out of scope: {[...b.mission.filesOutOfScope, ...b.mission.systemsOutOfScope].join(', ')}</li>
            </ul>
          </details>
          <details><summary>Review &amp; Repair</summary>
            <ul>
              {b.findings.map((f) => <li key={f.findingId}>{f.findingId} [{f.severity}] {f.title} — {f.status}</li>)}
              {b.repairs.map((r) => <li key={r.repairId}>{r.repairId} → {r.findingId} (iteration {r.iteration}) — {r.status}</li>)}
            </ul>
          </details>
          <details><summary>Reviewer &amp; Release Gate</summary>
            <ul>
              <li>Plan: {data.entitlementLabel} · reviewer available: {String(data.reviewer.availability === 'available')}</li>
              <li>Reviewer: {data.reviewer.agentId} · independent: {String(data.reviewerIndependent)} (SIMULATED)</li>
              <li>Output visibility: {data.outputVisibility}</li>
              <li className="relay-dim">Output cannot release before required review; Autonomous cannot bypass it.</li>
            </ul>
          </details>
          <details><summary>Access</summary>
            <ul>
              {data.access.map((a) => <li key={a.service}>{a.service} · {a.capability} · {a.scope.join(', ')} · {a.status}</li>)}
              <li className="relay-dim">Passwords/tokens are never accepted or displayed; MFA stays a Manual Task.</li>
            </ul>
          </details>
        </div>
      </main>

      {terminalOpen && (
        <div className="relay-terminal-overlay">
          <LiveTerminal data={data} mode={mode} onClose={() => setTerminalOpen(false)} />
        </div>
      )}
    </div>
  );
}
