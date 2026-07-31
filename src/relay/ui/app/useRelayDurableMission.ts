import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assessRecovery,
  createResumeCoordinator,
  shouldCheckpoint,
  type DurableCheckpointReason,
  type DurableMissionRecord,
  type DurableMissionRecordDraft,
  type DurableMissionStorePort,
  type RecoveryAssessment,
} from '../../mission/durable';
import {
  createBrowserDurableMissionStore,
  readDurableIndex,
  writeDurableIndex,
} from './durable-mission-browser-store';
import { projectDurableMissionRecord, type DurableProjectionInput } from './durable-mission-projection';
import type { RelayNotificationInput } from '../notifications';

/**
 * DURABLE MISSION PERSISTENCE, WIRED INTO THE APPLICATION SHELL.
 *
 * One hook owns: the store, the last confirmed record, the discovery of an
 * incomplete mission on boot, the recovery assessment, and the persistence
 * notifications. It is the only place that decides what the customer is told
 * about saving, and it obeys one rule above all:
 *
 *   A NOTIFICATION FOLLOWS THE FACT, NEVER THE INTENTION.
 *
 * `Mission saved` is published after the durable write resolves ok — starting
 * a write publishes nothing. A failed write publishes `Save delayed`, which
 * is a warning, not a success. `Mission recovered` is published only after a
 * record passed version + shape + checksum validation AND the recovery
 * assessment produced a resumable classification; anything else publishes
 * `Recovery blocked` with the exact safe reason, and stays until dismissed.
 */

/** One browser tab = one session. Used for the ownership lease. */
function createSessionId(): string {
  const random = Math.floor(Math.random() * 0x100000000).toString(16);
  return `session-${random}-${Date.now().toString(36)}`;
}

export interface DurableMissionState {
  /** The last record whose durable write succeeded. */
  readonly lastSaved: DurableMissionRecord | null;
  /** An incomplete mission discovered at startup, with its assessment. */
  readonly discovered: RecoveryAssessment | null;
  /** True while the shell is still looking. */
  readonly discovering: boolean;
  /** Honest label of where records live ('IndexedDB', 'in-memory …'). */
  readonly locationLabel: string;
  readonly durable: boolean;
}

export interface UseDurableMissionInput {
  /** Injected in tests; production resolves IndexedDB itself. */
  readonly store?: DurableMissionStorePort;
  readonly publish: (input: RelayNotificationInput) => void;
  /** Opens the recovery surface, used by the notification action. */
  readonly onViewRecovery?: () => void;
  readonly now?: () => string;
  /** False in the offline build — recovery may never claim a reconnection. */
  readonly runtimeAvailable?: boolean;
  readonly sessionId?: string;
}

export interface DurableMissionApi extends DurableMissionState {
  /** Write a checkpoint at a safe boundary. Resolves once the outcome is
      known; the notification is published from inside. */
  readonly checkpoint: (input: Omit<DurableProjectionInput, 'previous' | 'now'> & {
    readonly now?: string;
    /**
     * An explicit safe boundary. Some boundaries are known only to the
     * caller — a PAUSE command is one — and cannot be inferred from the
     * coarse mission state, so the caller names them.
     */
    readonly reason?: DurableCheckpointReason;
  }) => Promise<boolean>;
  /** Accept a resume exactly once, even when clicked twice. */
  readonly resume: (missionId: string) => Promise<boolean>;
  /** Stop a mission: the record is removed deliberately, by the user. */
  readonly stop: (missionId: string) => Promise<void>;
  /** Clear the discovered banner without touching the stored record. */
  readonly dismissDiscovered: () => void;
}

export function useRelayDurableMission(input: UseDurableMissionInput): DurableMissionApi {
  const runtimeAvailable = input.runtimeAvailable ?? false;
  const store = useMemo(
    () => input.store ?? createBrowserDurableMissionStore(),
    [input.store],
  );
  const sessionId = useMemo(() => input.sessionId ?? createSessionId(), [input.sessionId]);
  const resumeCoordinator = useMemo(() => createResumeCoordinator(store), [store]);

  const [lastSaved, setLastSaved] = useState<DurableMissionRecord | null>(null);
  const [discovered, setDiscovered] = useState<RecoveryAssessment | null>(null);
  const [discovering, setDiscovering] = useState(true);

  /**
   * CALLBACKS LIVE IN REFS, NOT IN DEPENDENCY ARRAYS.
   *
   * A caller naturally writes `publish={center.publish}` and
   * `onViewRecovery={() => setOpen(true)}` — a fresh function identity on
   * every render. If those were effect dependencies, discovery would re-run
   * on every render, publish another notification, cause another render, and
   * never stop. Holding them in refs keeps the effects keyed to what
   * actually changes: the store, the session and runtime availability.
   */
  const publishRef = useRef(input.publish);
  publishRef.current = input.publish;
  const viewRecoveryRef = useRef(input.onViewRecovery);
  viewRecoveryRef.current = input.onViewRecovery;
  const nowRef = useRef(input.now);
  nowRef.current = input.now;
  const now = useCallback(
    (): string => (nowRef.current ?? (() => new Date().toISOString()))(),
    [],
  );
  const publish = useCallback((notification: RelayNotificationInput): void => {
    publishRef.current(notification);
  }, []);
  const buildViewActions = useCallback(
    (): RelayNotificationInput['actions'] =>
      viewRecoveryRef.current === undefined
        ? undefined
        : [{
          id: 'view-recovery',
          label: 'INSPECT MISSION',
          onSelect: () => viewRecoveryRef.current?.(),
        }],
    [],
  );

  /** Records already announced, so a re-render never re-announces. */
  const announced = useRef(new Set<string>());

  /* ------------------------------------------------------- discovery ---- */

  useEffect(() => {
    let cancelled = false;
    const discover = async (): Promise<void> => {
      const ids = await store.list();
      // The localStorage index is only a hint; the record decides.
      const hinted = readDurableIndex().map((entry) => entry.missionId);
      const candidates = ids.length > 0 ? ids : hinted;
      if (candidates.length === 0) {
        if (!cancelled) setDiscovering(false);
        return;
      }
      const read = await store.read(candidates[0]);
      if (cancelled) return;
      const assessment = assessRecovery(read, {
        runtimeAvailable,
        budgetSufficient: true,
        sessionId,
        now: now(),
      });
      setDiscovered(assessment);
      setDiscovering(false);

      // A record that was never found is not an event worth announcing.
      if (!read.ok && read.reason === 'not_found') return;
      const key = `recovery:${candidates[0]}:${assessment.classification}`;
      if (announced.current.has(key)) return;
      announced.current.add(key);

      if (assessment.blocking) {
        publish({
          dedupeKey: key,
          kind: 'critical',
          title: 'Recovery blocked',
          body: assessment.summary,
          actions: buildViewActions(),
        });
        return;
      }
      if (assessment.classification === 'completed') return;
      publish({
        dedupeKey: key,
        kind: 'info',
        title: 'Mission recovered',
        body: 'Relay restored the latest safe checkpoint.',
        simulated: assessment.record?.provenance === 'simulated',
        actions: buildViewActions(),
      });
      if (assessment.canResume) {
        publish({
          dedupeKey: `${key}:ready`,
          kind: 'info',
          title: 'Ready to resume',
          body: assessment.summary,
          simulated: assessment.record?.provenance === 'simulated',
          actions: buildViewActions(),
        });
      }
    };
    void discover();
    return () => { cancelled = true; };
    // Discovery runs ONCE per store — a route change, a re-render or a new
    // callback identity must never repeat it.
  }, [store, sessionId, runtimeAvailable, publish, buildViewActions, now]);

  /* ------------------------------------------------------ checkpointing -- */

  const checkpoint = useCallback<DurableMissionApi['checkpoint']>(
    async (projectionInput) => {
      const at = projectionInput.now ?? now();
      const projected = projectDurableMissionRecord({
        ...projectionInput,
        previous: lastSaved,
        now: at,
      });
      const draft: DurableMissionRecordDraft = projectionInput.reason === undefined
        ? projected
        : { ...projected, checkpointReason: projectionInput.reason };
      const decision = shouldCheckpoint({
        reason: draft.checkpointReason,
        previous: lastSaved,
        next: draft,
      });
      if (!decision.write) return false;

      const written = await store.write(draft);
      if (!written.ok) {
        // A failed write NEVER displays success.
        publish({
          dedupeKey: `save-delayed:${draft.missionId}`,
          kind: 'warning',
          title: 'Save delayed',
          body: 'Relay could not confirm the latest durable checkpoint.',
          actions: buildViewActions(),
        });
        return false;
      }

      setLastSaved(written.record);
      writeDurableIndex([
        { missionId: written.record.missionId, checkpointAt: written.record.checkpointAt },
      ]);
      publish({
        // One notification per checkpoint boundary, not per write attempt.
        dedupeKey: `saved:${written.record.missionId}:${written.record.checkpointReason}`,
        kind: 'success',
        title: draft.checkpointReason === 'mission_paused' ? 'Mission paused' : 'Mission saved',
        body:
          draft.checkpointReason === 'mission_paused'
            ? 'Relay saved the mission before pausing.'
            : `Checkpoint created at ${formatCheckpointTime(written.record.checkpointAt)}.`,
        simulated: written.record.provenance === 'simulated',
      });
      return true;
    },
    [store, lastSaved, publish, buildViewActions, now],
  );

  /* ----------------------------------------------------------- resume ---- */

  const resume = useCallback(
    async (missionId: string): Promise<boolean> => {
      const outcome = await resumeCoordinator.resume({ missionId, sessionId, now: now() });
      if (!outcome.ok) {
        publish({
          dedupeKey: `recovery-blocked:${missionId}`,
          kind: 'critical',
          title: 'Recovery blocked',
          body: outcome.reason,
        });
        return false;
      }
      setLastSaved(outcome.record);
      setDiscovered(null);
      return true;
    },
    [resumeCoordinator, sessionId, publish, now],
  );

  const stop = useCallback(
    async (missionId: string): Promise<void> => {
      await store.remove(missionId);
      writeDurableIndex([]);
      setDiscovered(null);
      setLastSaved(null);
    },
    [store],
  );

  const dismissDiscovered = useCallback(() => setDiscovered(null), []);

  return {
    lastSaved,
    discovered,
    discovering,
    locationLabel: store.locationLabel,
    durable: store.durability === 'durable',
    checkpoint,
    resume,
    stop,
    dismissDiscovered,
  };
}

/** Readable local time for the saved notification. */
export function formatCheckpointTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'an unknown time';
  const date = new Date(ms);
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${meridiem} UTC`;
}
