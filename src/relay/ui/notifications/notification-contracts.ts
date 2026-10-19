/**
 * CANONICAL RELAY NOTIFICATION CONTRACT — one small interface every feature
 * uses to surface a top-right notification: usage warnings today; mission
 * persistence, recovery, Loops, Cubs, budgets and approvals later.
 *
 * This is a PRESENTATION event contract, not an event bus: publishing a
 * notification changes what the user sees and nothing else. It never carries
 * mission state, never drives usage or billing decisions, and duration is
 * never the source of any state.
 */

export const RELAY_NOTIFICATION_KINDS = ['info', 'success', 'warning', 'critical'] as const;
export type RelayNotificationKind = (typeof RELAY_NOTIFICATION_KINDS)[number];

/**
 * Auto-dismiss duration per kind, in milliseconds. `null` = persistent:
 * a critical notification stays until the user dismisses or resolves it.
 */
export const RELAY_NOTIFICATION_DURATION_MS: Readonly<
  Record<RelayNotificationKind, number | null>
> = Object.freeze({
  info: 5_000,
  success: 5_000,
  warning: 7_000,
  critical: null,
});

/** At most this many notifications are visible; the rest queue in order. */
export const RELAY_NOTIFICATION_MAX_VISIBLE = 3;

export interface RelayNotificationAction {
  readonly id: string;
  /** Visible label, e.g. `VIEW USAGE`. */
  readonly label: string;
  readonly onSelect: () => void;
}

export interface RelayNotificationInput {
  /**
   * Suppresses duplicates: while a notification with the same key is visible
   * or queued, publishing it again is a no-op.
   */
  readonly dedupeKey?: string;
  readonly kind: RelayNotificationKind;
  readonly title: string;
  readonly body?: string;
  /** Simulated events disclose themselves on the notification itself. */
  readonly simulated?: boolean;
  readonly actions?: readonly RelayNotificationAction[];
}

export interface RelayActiveNotification extends RelayNotificationInput {
  readonly id: string;
}
