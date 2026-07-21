import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { nextAction } from './domain/stages';
import { verifyMission } from './domain/gate';
import { useRelayStore } from './state/store';
import type {
  EvidenceEntry,
  GeneratedBrief,
  ImplementationReport,
  RelayMission,
  RelayResult,
  RepairReport,
  ReviewReport,
} from './domain/types';

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions/http) — select-and-copy fallback.
      window.prompt('Copy the brief below:', text);
    }
  };
  return (
    <button type="button" className="relay-btn" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function BriefCard({ brief, title }: { brief: GeneratedBrief; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="relay-card relay-brief">
      <header className="relay-card-head">
        <h3>{title}</h3>
        <div className="relay-card-actions">
          <CopyButton text={brief.markdown} label="Copy brief" />
          <button type="button" className="relay-btn ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </header>
      {open && (
        <div className="relay-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.markdown}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}

function IngestBox({
  label,
  hint,
  submitLabel,
  onSubmit,
}: {
  label: string;
  hint: string;
  submitLabel: string;
  onSubmit: (text: string) => RelayResult<null>;
}) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const submit = () => {
    const result = onSubmit(text);
    if (result.ok) {
      setText('');
      setErrors([]);
    } else {
      setErrors(result.errors);
    }
  };
  return (
    <section className="relay-card relay-ingest">
      <label className="relay-ingest-label">
        {label}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={hint}
          rows={7}
          spellCheck={false}
        />
      </label>
      {errors.length > 0 && (
        <ul className="relay-errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      <button type="button" className="relay-btn primary" onClick={submit} disabled={!text.trim()}>
        {submitLabel}
      </button>
    </section>
  );
}

function EvidenceRuns({ entries }: { entries: EvidenceEntry[] }) {
  return (
    <ul className="relay-evidence">
      {entries.map((e, i) => (
        <li key={`${e.command}-${i}`} className={e.status === 'pass' ? 'is-pass' : 'is-fail'}>
          <code>{e.command}</code>
          <span className="relay-evidence-status">{e.status}</span>
          <pre>{e.output}</pre>
        </li>
      ))}
    </ul>
  );
}

function ImplementationCard({ report, title }: { report: ImplementationReport; title: string }) {
  return (
    <section className="relay-card">
      <header className="relay-card-head">
        <h3>{title}</h3>
        <span className="relay-agent">{report.agent}</span>
      </header>
      <p>{report.summary}</p>
      {report.changedFiles.length > 0 && (
        <ul className="relay-files">
          {report.changedFiles.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      )}
      {report.commands && report.commands.length > 0 && <EvidenceRuns entries={report.commands} />}
      {report.notes && <p className="relay-dim">{report.notes}</p>}
    </section>
  );
}

function ReviewCard({ review, repair }: { review: ReviewReport; repair?: RepairReport }) {
  const resolved = new Set((repair?.resolvedFindings ?? []).map((r) => r.id));
  return (
    <section className="relay-card">
      <header className="relay-card-head">
        <h3>Independent review</h3>
        <span className="relay-agent">{review.reviewer}</span>
      </header>
      <p>
        Verdict: <strong className={`relay-verdict is-${review.verdict}`}>{review.verdict}</strong>
        {' · '}
        {review.findings.length} finding(s)
      </p>
      {review.findings.length > 0 && (
        <ul className="relay-findings">
          {review.findings.map((f) => (
            <li key={f.id} className={resolved.has(f.id) ? 'is-resolved' : ''}>
              <span className={`relay-sev is-${f.severity}`}>{f.severity}</span>
              <div>
                <strong>
                  {f.id} — {f.title}
                </strong>
                <p>{f.detail}</p>
                {f.recommendation && <p className="relay-dim">Fix: {f.recommendation}</p>}
                {resolved.has(f.id) && (
                  <p className="relay-resolved">
                    Resolved: {repair?.resolvedFindings.find((r) => r.id === f.id)?.resolution}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GatePanel({ mission }: { mission: RelayMission }) {
  const markVerified = useRelayStore((s) => s.markVerified);
  const gate = verifyMission(mission);
  const sealed = mission.verification;
  return (
    <section className={`relay-card relay-gate ${gate.ok ? 'is-open' : ''}`}>
      <header className="relay-card-head">
        <h3>Verification gate</h3>
        <span className={`relay-gate-state ${gate.ok ? 'ok' : ''}`}>
          {sealed ? 'verified complete' : gate.ok ? 'gate open' : 'gate closed'}
        </span>
      </header>
      <ul className="relay-checks">
        {(sealed ? sealed.checks : gate.checks).map((c) => (
          <li key={c.id} className={c.ok ? 'is-ok' : 'is-fail'}>
            <span aria-hidden>{c.ok ? '✓' : '✕'}</span>
            <div>
              <strong>{c.label}</strong>
              <p>{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {sealed ? (
        <p className="relay-sealed">
          Sealed {new Date(sealed.at).toLocaleString()} — this mission is immutable.
        </p>
      ) : (
        <button
          type="button"
          className="relay-btn primary"
          disabled={!gate.ok}
          onClick={() => markVerified(mission.id)}
        >
          {gate.ok ? 'Seal mission as verified' : 'Gate closed — checks failing above'}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The stage-driven panel                                              */
/* ------------------------------------------------------------------ */

export function StagePanel({ mission }: { mission: RelayMission }) {
  const store = useRelayStore();
  const action = nextAction(mission);
  const [actionErrors, setActionErrors] = useState<string[]>([]);

  const run = (fn: () => RelayResult<null>) => {
    const result = fn();
    setActionErrors(result.ok ? [] : result.errors);
  };

  return (
    <div className="relay-stage-panel">
      {actionErrors.length > 0 && (
        <ul className="relay-errors" role="alert">
          {actionErrors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {action.type === 'generate-handoff' && (
        <section className="relay-card">
          <h3>Hand the mission to your implementer</h3>
          <p className="relay-dim">
            Relay writes a structured handoff for your Claude Code session: objective,
            constraints, acceptance criteria, and the exact report format to come back with.
          </p>
          <button
            type="button"
            className="relay-btn primary"
            onClick={() => run(() => store.generateHandoff(mission.id))}
          >
            Generate implementer handoff
          </button>
        </section>
      )}

      {mission.handoff && !mission.implementationReport && (
        <>
          <BriefCard brief={mission.handoff} title="Implementer handoff" />
          <IngestBox
            label="Implementation report"
            hint="Paste the implementer's full reply here — Relay extracts the relay:implementation-report block."
            submitLabel="Ingest implementation report"
            onSubmit={(text) => store.ingestImplementationReport(mission.id, text)}
          />
        </>
      )}

      {action.type === 'ingest-review' && mission.implementationReport && (
        <>
          <ImplementationCard report={mission.implementationReport} title="Implementation report" />
          {mission.reviewBrief ? (
            <BriefCard brief={mission.reviewBrief} title="Review brief (for the independent reviewer)" />
          ) : (
            <section className="relay-card">
              <h3>Brief the independent reviewer</h3>
              <p className="relay-dim">
                Hand this to a DIFFERENT agent — e.g. your Codex session. Independence is
                checked at the gate.
              </p>
              <button
                type="button"
                className="relay-btn"
                onClick={() => run(() => store.generateReviewBrief(mission.id))}
              >
                Generate review brief
              </button>
            </section>
          )}
          <IngestBox
            label="Independent review"
            hint="Paste the reviewer's full reply — Relay extracts the relay:review block."
            submitLabel="Ingest review"
            onSubmit={(text) => store.ingestReview(mission.id, text)}
          />
        </>
      )}

      {mission.review && (
        <ReviewCard review={mission.review} repair={mission.repairReport} />
      )}

      {action.type === 'generate-repair-task' && (
        <section className="relay-card">
          <h3>Turn the findings into a repair task</h3>
          <p className="relay-dim">
            Relay packages every finding — id, severity, detail, recommendation — into a
            repair brief for the implementer.
          </p>
          <button
            type="button"
            className="relay-btn primary"
            onClick={() => run(() => store.generateRepairTask(mission.id))}
          >
            Generate repair task
          </button>
        </section>
      )}

      {action.type === 'ingest-repair-report' && mission.repairTask && (
        <>
          <BriefCard brief={mission.repairTask} title="Repair task" />
          <IngestBox
            label="Repair completion"
            hint="Paste the implementer's repair reply — Relay extracts the relay:repair-report block."
            submitLabel="Ingest repair report"
            onSubmit={(text) => store.ingestRepairReport(mission.id, text)}
          />
        </>
      )}

      {mission.repairReport && action.type !== 'ingest-repair-report' && (
        <ImplementationCard
          report={{ ...mission.repairReport, notes: undefined, commands: undefined }}
          title="Repair completion"
        />
      )}

      {action.type === 'ingest-evidence' && (
        <IngestBox
          label="Test evidence"
          hint="Paste the verification runs — Relay extracts the relay:test-evidence block (the repair reply may already contain it)."
          submitLabel="Record test evidence"
          onSubmit={(text) => store.ingestEvidence(mission.id, text)}
        />
      )}

      {mission.evidence && (
        <section className="relay-card">
          <header className="relay-card-head">
            <h3>Test evidence</h3>
            <span className="relay-dim">{new Date(mission.evidence.receivedAt).toLocaleString()}</span>
          </header>
          <EvidenceRuns entries={mission.evidence.entries} />
          {mission.evidence.note && <p className="relay-dim">{mission.evidence.note}</p>}
        </section>
      )}

      {(action.type === 'mark-verified' || action.type === 'complete') && (
        <GatePanel mission={mission} />
      )}
    </div>
  );
}
