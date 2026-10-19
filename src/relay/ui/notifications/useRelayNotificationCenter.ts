import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RELAY_NOTIFICATION_DURATION_MS,
  RELAY_NOTIFICATION_MAX_VISIBLE,
  type RelayActiveNotification,
  type RelayNotificationInput,
} from './notification-contracts';

/**
 * THE ONE NOTIFICATION CENTER — visible stack, overflow queue, per-item
 * auto-dismiss timers, and a pause latch shared by hover and keyboard focus.
 *
 * Timing rules:
 *  - info/success ≈ 5s, warning ≈ 7s, critical persists (contract table);
 *  - hovering OR focusing the stack pauses every running timer and stores
 *    the remaining time, so a user reading a warning never loses it;
 *  - dismissing (or expiry) promotes the oldest queued notification;
 *  - duplicates (same dedupeKey, still visible or queued) are suppressed.
 *
 * Duration is presentation only. Nothing reads "did it expire" as state.
 *
 * State is ONE object with pure transitions — visible and queued always move
 * together, and StrictMode's double-invoked updaters stay harmless.
 */

export interface RelayNotificationCenter {
  readonly visible: readonly RelayActiveNotification[];
  readonly queuedCount: number;
  readonly publish: (input: RelayNotificationInput) => void;
  readonly dismiss: (id: string) => void;
  readonly pauseTimers: () => void;
  readonly resumeTimers: () => void;
}

interface CenterState {
  readonly visible: readonly RelayActiveNotification[];
  readonly queued: readonly RelayActiveNotification[];
}

interface TimerRecord {
  timerId: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  armedAtMs: number;
}

const EMPTY_STATE: CenterState = { visible: [], queued: [] };

function withPromotion(
  visible: readonly RelayActiveNotification[],
  queued: readonly RelayActiveNotification[],
): CenterState {
  if (visible.length >= RELAY_NOTIFICATION_MAX_VISIBLE || queued.length === 0) {
    return { visible, queued };
  }
  const slots = RELAY_NOTIFICATION_MAX_VISIBLE - visible.length;
  return {
    visible: [...visible, ...queued.slice(0, slots)],
    queued: queued.slice(slots),
  };
}

export function useRelayNotificationCenter(): RelayNotificationCenter {
  const [state, setState] = useState<CenterState>(EMPTY_STATE);
  const timers = useRef(new Map<string, TimerRecord>());
  /** Counted latch: pointer hover and keyboard focus pause independently. */
  const pauseCount = useRef(0);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    const record = timers.current.get(id);
    if (record?.timerId != null) clearTimeout(record.timerId);
    timers.current.delete(id);
    setState((current) =>
      withPromotion(current.visible.filter((n) => n.id !== id), current.queued),
    );
  }, []);

  // Arm a timer for every visible non-critical notification that lacks one.
  // Runs after commit, so StrictMode re-renders never double-arm.
  useEffect(() => {
    for (const notification of state.visible) {
      if (timers.current.has(notification.id)) continue;
      const duration = RELAY_NOTIFICATION_DURATION_MS[notification.kind];
      if (duration === null) {
        // Critical: tracked with no timer, so pause/resume can skip it.
        timers.current.set(notification.id, {
          timerId: null,
          remainingMs: Number.POSITIVE_INFINITY,
          armedAtMs: Date.now(),
        });
        continue;
      }
      if (pauseCount.current > 0) {
        timers.current.set(notification.id, {
          timerId: null,
          remainingMs: duration,
          armedAtMs: Date.now(),
        });
      } else {
        const timerId = setTimeout(() => dismiss(notification.id), duration);
        timers.current.set(notification.id, {
          timerId,
          remainingMs: duration,
          armedAtMs: Date.now(),
        });
      }
    }
  }, [state.visible, dismiss]);

  // Clear every pending timer on unmount.
  useEffect(
    () => () => {
      for (const record of timers.current.values()) {
        if (record.timerId != null) clearTimeout(record.timerId);
      }
      timers.current.clear();
    },
    [],
  );

  const publish = useCallback((input: RelayNotificationInput) => {
    setState((current) => {
      if (
        input.dedupeKey !== undefined &&
        [...current.visible, ...current.queued].some((n) => n.dedupeKey === input.dedupeKey)
      ) {
        return current; // duplicate suppressed
      }
      const notification: RelayActiveNotification = { ...input, id: `rnt-${++seq.current}` };
      return withPromotion(current.visible, [...current.queued, notification]);
    });
  }, []);

  const pauseTimers = useCallback(() => {
    pauseCount.current += 1;
    if (pauseCount.current > 1) return;
    for (const record of timers.current.values()) {
      if (record.timerId == null) continue;
      clearTimeout(record.timerId);
      record.remainingMs = Math.max(0, record.remainingMs - (Date.now() - record.armedAtMs));
      record.timerId = null;
    }
  }, []);

  const resumeTimers = useCallback(() => {
    pauseCount.current = Math.max(0, pauseCount.current - 1);
    if (pauseCount.current > 0) return;
    for (const [id, record] of timers.current.entries()) {
      if (record.timerId != null || !Number.isFinite(record.remainingMs)) continue;
      const timerId = setTimeout(() => dismiss(id), Math.max(250, record.remainingMs));
      record.timerId = timerId;
      record.armedAtMs = Date.now();
    }
  }, [dismiss]);

  return useMemo(
    () => ({
      visible: state.visible,
      queuedCount: state.queued.length,
      publish,
      dismiss,
      pauseTimers,
      resumeTimers,
    }),
    [state, publish, dismiss, pauseTimers, resumeTimers],
  );
}
