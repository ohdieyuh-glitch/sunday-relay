import type { ManualTask } from './contracts';

/**
 * Manual Tasks — first-class controlled handoff points, never styled as
 * errors. Each task explains what Relay needs, why it stopped, what the
 * developer must do, what happens afterward, and that the mission remains
 * safe. Approve / keep blocked / open details all flow through callbacks.
 */
export function RelayManualTaskPanel({
  tasks,
  onOpenManualTask,
  onApproveManualTask,
  onRejectManualTask,
}: {
  tasks: ManualTask[];
  onOpenManualTask: (taskId: string) => void;
  onApproveManualTask: (taskId: string) => void;
  onRejectManualTask: (taskId: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="rpw-manual" aria-labelledby="rpw-manual-heading">
      <h2 id="rpw-manual-heading" className="rpw-section-title">
        MANUAL TASKS
      </h2>
      {tasks.map((t) => (
        <article key={t.taskId} className="rpw-mt" aria-label={`Manual task ${t.reference}`}>
          <header className="rpw-mt-head">
            <span className="rpw-mt-ref">MANUAL TASK / {t.reference}</span>
            <span className={`rpw-mt-state rpw-mt-state--${t.safeState}`}>
              {t.safeState === 'stopped_safely' ? 'STOPPED SAFELY' : 'WAITING'}
            </span>
          </header>
          <h3 className="rpw-mt-title">{t.title}</h3>
          <dl className="rpw-mt-body">
            <div>
              <dt>RELAY NEEDS</dt>
              <dd>{t.need}</dd>
            </div>
            <div>
              <dt>WHY IT STOPPED</dt>
              <dd>{t.reason}</dd>
            </div>
            <div>
              <dt>YOUR ACTION</dt>
              <dd>{t.requiredAction}</dd>
            </div>
            <div>
              <dt>AFTERWARD</dt>
              <dd>{t.afterward}</dd>
            </div>
          </dl>
          {t.status === 'open' ? (
            <div className="rpw-mt-actions">
              <button
                type="button"
                className="rpw-btn"
                onClick={() => onOpenManualTask(t.taskId)}
              >
                REVIEW REQUEST
              </button>
              <button
                type="button"
                className="rpw-btn rpw-btn--primary"
                onClick={() => onApproveManualTask(t.taskId)}
              >
                APPROVE
              </button>
              <button
                type="button"
                className="rpw-btn rpw-btn--ghost"
                onClick={() => onRejectManualTask(t.taskId)}
              >
                KEEP BLOCKED
              </button>
            </div>
          ) : (
            <p className="rpw-mt-resolved">Decision recorded: {t.status.toUpperCase()}.</p>
          )}
        </article>
      ))}
    </section>
  );
}
