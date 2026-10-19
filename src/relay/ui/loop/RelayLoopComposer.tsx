import { useEffect, useRef } from 'react';
import './relay-loop.css';
import {
  RELAY_LOOP_STATUS_DESCRIPTION,
  RELAY_LOOP_STATUS_LABEL,
  RELAY_LOOP_STATUS_TONE,
} from './loop-status';
import type { RelayLoopComposerView, RelaySwarmGateView } from './loop-view';

/**
 * THE RELAY LOOP COMPOSER.
 *
 * A contract preview, not a launcher. It shows what a Loop WOULD do — the
 * objective, who would work, what would prove it finished, and every bound it
 * would run inside — and it starts nothing. The confirmation boundary at the
 * top says so in the user's words rather than leaving them to infer it from a
 * greyed-out button.
 *
 * It renders the shared projection the CLI prints. No meaning is computed
 * here: the component maps an already-decided view model onto Relay's own
 * controls, so the two surfaces cannot come to describe a command differently.
 *
 * DESIGN. Obsidian canvas, bone-white type, periwinkle accent, hairline rules,
 * uppercase editorial labels — the workspace's existing register. Definition
 * lists rather than cards, because these are facts about one thing, not a
 * gallery. No glow, no gradient, no motion beyond what the user's settings
 * permit.
 *
 * ACCESSIBILITY. A labelled dialog with focus moved to its heading on open and
 * returned to the opener on close; status carried by text AND a shape marker,
 * never colour alone; validation announced through a live region; every
 * disabled control states its reason in rendered text rather than a tooltip.
 */

const TONE_MARK: Readonly<Record<'neutral' | 'attention' | 'ready', string>> = {
  neutral: '□',
  attention: '△',
  ready: '◇',
};

export function RelayLoopComposer({
  view,
  swarmGate,
  onCancel,
  onSaveDraft,
  onContinueToPreflight,
}: {
  view: RelayLoopComposerView;
  /** Present only for the `/sloop` family. */
  swarmGate?: RelaySwarmGateView;
  onCancel: () => void;
  onSaveDraft: () => void;
  onContinueToPreflight: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus the heading, not the first control: a screen-reader user should hear
  // WHAT this is before being told what they could press.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const tone = RELAY_LOOP_STATUS_TONE[view.status];
  const handler: Record<string, () => void> = {
    cancel: onCancel,
    save_draft: onSaveDraft,
    continue_to_preflight: onContinueToPreflight,
    start_loop: () => undefined,
  };

  return (
    <section
      className="rlc"
      role="dialog"
      aria-modal="false"
      aria-labelledby="rlc-heading"
      aria-describedby="rlc-boundary"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <header className="rlc-head">
        <h2 className="rlc-title" id="rlc-heading" ref={headingRef} tabIndex={-1}>
          {view.headline}
        </h2>
        <span className={`rlc-status rlc-status--${tone}`}>
          <span aria-hidden="true" className="rlc-status-mark">
            {TONE_MARK[tone]}
          </span>
          {RELAY_LOOP_STATUS_LABEL[view.status]}
        </span>
      </header>

      <p className="rlc-status-detail">{RELAY_LOOP_STATUS_DESCRIPTION[view.status]}</p>

      <p className="rlc-raw">
        <span className="rlc-raw-label">YOU TYPED</span>
        <code className="rlc-raw-value">{view.raw}</code>
      </p>

      {view.boundary ? (
        <aside className="rlc-boundary" id="rlc-boundary" aria-label="Confirmation boundary">
          <h3 className="rlc-boundary-title">{view.boundary.title}</h3>
          <ul className="rlc-boundary-lines">
            {view.boundary.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      {swarmGate ? (
        <aside className="rlc-gate" aria-label="Swarm Loop availability">
          <h3 className="rlc-gate-title">{swarmGate.title}</h3>
          <ul className="rlc-gate-lines">
            {swarmGate.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      {view.target ? (
        <section className="rlc-target" aria-labelledby="rlc-target-heading">
          <h3 className="rlc-section-title" id="rlc-target-heading">
            AGENTS
          </h3>
          <dl className="rlc-dl">
            <div className="rlc-row">
              <dt>Requested</dt>
              <dd>{view.target.requested}</dd>
            </div>
            <div className="rlc-row">
              <dt>Resolved roles</dt>
              <dd>
                {view.target.resolved.length > 0 ? (
                  view.target.resolved.join(', ')
                ) : (
                  <span className="rlc-unknown">Unknown</span>
                )}
              </dd>
            </div>
            {view.target.unavailable.length > 0 ? (
              <div className="rlc-row">
                <dt>Unavailable roles</dt>
                <dd>
                  <ul className="rlc-unavailable">
                    {view.target.unavailable.map((entry) => (
                      <li key={entry.role}>
                        {entry.role} — {entry.reason}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            <div className="rlc-row">
              <dt>Assigned agents</dt>
              <dd>
                {view.target.assigned.length > 0 ? (
                  view.target.assigned.join(', ')
                ) : (
                  <span className="rlc-none">None</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="rlc-note">{view.target.assignmentNote}</p>
        </section>
      ) : null}

      <section className="rlc-fields" aria-labelledby="rlc-contract-heading">
        <h3 className="rlc-section-title" id="rlc-contract-heading">
          {view.isSchedule ? 'SCHEDULED LOOP CONTRACT' : 'LOOP CONTRACT'}
        </h3>
        <dl className="rlc-dl">
          {view.fields.map((f) => (
            <div className="rlc-row" key={f.label}>
              <dt>{f.label}</dt>
              <dd className={f.unknown ? 'rlc-unknown' : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="rlc-live" role="status" aria-live="polite">
        {view.validationProblems.length > 0
          ? `${view.validationProblems.length} problem${view.validationProblems.length === 1 ? '' : 's'} must be resolved before this Loop can run.`
          : view.blockers.length > 0
            ? `${view.blockers.length} blocker${view.blockers.length === 1 ? '' : 's'} prevent this Loop from running.`
            : ''}
      </div>

      {view.validationProblems.length > 0 ? (
        <section className="rlc-problems" aria-labelledby="rlc-problems-heading">
          <h3 className="rlc-section-title" id="rlc-problems-heading">
            PROBLEMS
          </h3>
          <ul>
            {view.validationProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.blockers.length > 0 ? (
        <section className="rlc-blockers" aria-labelledby="rlc-blockers-heading">
          <h3 className="rlc-section-title" id="rlc-blockers-heading">
            BLOCKERS
          </h3>
          <ul>
            {view.blockers.map((blocker, index) => (
              <li key={`${blocker.reason}-${index}`}>
                <span className="rlc-blocker-reason">{blocker.reason.replace(/_/g, ' ')}</span>
                <span className="rlc-blocker-detail">{blocker.detail}</span>
                {blocker.requiredUserAction !== null ? (
                  <span className="rlc-blocker-action">{blocker.requiredUserAction}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.notices.length > 0 ? (
        <ul className="rlc-notices">
          {view.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}

      <footer className="rlc-actions">
        {view.controls.map((control) => (
          <span className="rlc-action" key={control.control}>
            <button
              type="button"
              className={`rlc-btn${control.control === 'continue_to_preflight' ? ' rlc-btn--primary' : ''}`}
              disabled={!control.enabled}
              aria-describedby={
                control.disabledReason !== null ? `rlc-why-${control.control}` : undefined
              }
              onClick={handler[control.control]}
            >
              {control.label}
            </button>
            {control.disabledReason !== null ? (
              <span className="rlc-why" id={`rlc-why-${control.control}`}>
                {control.disabledReason}
              </span>
            ) : null}
          </span>
        ))}
      </footer>
    </section>
  );
}
