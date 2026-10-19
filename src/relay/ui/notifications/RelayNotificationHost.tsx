import type { RelayActiveNotification } from './notification-contracts';
import './relay-notifications.css';

/**
 * THE ONE TOP-RIGHT NOTIFICATION HOST — rendered exactly once, by the
 * application shell, as a sibling of every screen. Fullscreen panels, the
 * Live Terminal and route changes never mount a second host: they are all
 * below it in the same document, and the stack sits at a fixed layer above
 * the focused-panel context (z 62) and below the mobile menu (z 90).
 *
 * Announcements: info/success/warning are `role="status"` (polite);
 * critical is `role="alert"`, announced once when it appears — the node
 * stays stable afterwards, so it is never re-announced.
 */

const KIND_LABEL: Record<RelayActiveNotification['kind'], string> = {
  info: 'INFO',
  success: 'OK',
  warning: 'WARNING',
  critical: 'CRITICAL',
};

export function RelayNotificationHost({
  notifications,
  queuedCount,
  onDismiss,
  onPause,
  onResume,
  reducedMotion = false,
}: {
  notifications: readonly RelayActiveNotification[];
  queuedCount: number;
  onDismiss: (id: string) => void;
  onPause: () => void;
  onResume: () => void;
  reducedMotion?: boolean;
}) {
  if (notifications.length === 0 && queuedCount === 0) return null;
  return (
    <div
      className={`rnt-host${reducedMotion ? ' rnt-host--static' : ''}`}
      aria-label="Notifications"
      data-relay-notification-host="true"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
    >
      <ol className="rnt-stack">
        {notifications.map((n) => (
          <li
            key={n.id}
            className={`rnt-toast rnt-toast--${n.kind}`}
            role={n.kind === 'critical' ? 'alert' : 'status'}
          >
            <div className="rnt-toast-head">
              <span className="rnt-toast-kind" aria-hidden="true">
                ■ {KIND_LABEL[n.kind]}
              </span>
              {n.simulated === true && <span className="rnt-toast-sim">SIMULATED</span>}
              <button
                type="button"
                className="rnt-toast-dismiss"
                onClick={() => onDismiss(n.id)}
                aria-label={`Dismiss notification: ${n.title}`}
              >
                DISMISS
              </button>
            </div>
            <p className="rnt-toast-title">{n.title}</p>
            {n.body !== undefined && <p className="rnt-toast-body">{n.body}</p>}
            {n.actions !== undefined && n.actions.length > 0 && (
              <div className="rnt-toast-actions">
                {n.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="rnt-toast-action"
                    onClick={action.onSelect}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {queuedCount > 0 && (
        <p className="rnt-queued" aria-live="off">
          + {queuedCount} more waiting
        </p>
      )}
    </div>
  );
}
