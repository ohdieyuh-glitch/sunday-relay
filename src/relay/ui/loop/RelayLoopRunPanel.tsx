import { useCallback, useEffect, useRef, useState } from 'react';
import './relay-loop.css';
import type { LoopStatusProjection } from '../../mission';
import {
  isUsableRestorePoint, projectLoopRunView, restorePointFor,
  type RelayLoopRestorePoint, type RelayLoopRunView,
} from './loop-run-view';

/**
 * THE RUNNING LOOP, ON SCREEN.
 *
 * `loop-run-view.ts` has been the honest projection of a running Loop since the
 * runtime landed, with its own tests — and nothing rendered it. A projection no
 * component consumes is a surface that exists in the repository and not in the
 * product, which is precisely the condition the MCP milestone's parity check was
 * built to catch. This file is the missing half.
 *
 * THREE RULES IT EXISTS TO HOLD.
 *
 * 1. ANIMATION FOLLOWS THE SERVER, NEVER THE CLICK. `activity` comes from the
 *    state class the server reported, and only `working` may animate. Not a
 *    timer, not an optimistic flag set when Start was pressed, not "we sent a
 *    request and have not heard back". Every one of those produces a spinner
 *    that keeps spinning after a run has failed — the most common way a product
 *    lies about background work, and the user's only clue is that it never
 *    stops.
 *
 * 2. RESTORATION IS A READ, NOT A CACHE. Across a refresh the browser persists
 *    exactly one thing: `{runId, loopId}`. Everything else is fetched. A cached
 *    projection would survive the refresh and show a finished run as still
 *    running, with nothing to tell the user it was stale. Until the first
 *    response arrives the panel says it is restoring — it does not draw the run
 *    it remembers.
 *
 * 3. A CONTROL THAT CANNOT ACT IS NOT DRAWN. Controls come from the projection,
 *    which knows whether each is permitted and why not; and a control whose
 *    handler the host did not supply is omitted entirely rather than rendered
 *    dead. A `Stop` button that silently does nothing tells the user a run was
 *    stopped when it is still spending.
 *
 * PURE OF I/O. No `fetch`, no `localStorage`, no timers of its own — the host
 * injects a port and a store, so the same component is driven by the real
 * bridge in the app and by a fake in the tests.
 */

/* ------------------------------------------------------------------ ports */

export type RelayLoopRunFetch =
  | { readonly ok: true; readonly status: LoopStatusProjection }
  | { readonly ok: false; readonly message: string };

export interface RelayLoopRunPort {
  /** Read one run's status from the SERVER. The only source of run truth. */
  status(runId: string): Promise<RelayLoopRunFetch>;
  /**
   * Optional. When absent, the panel renders no control at all — see rule 3.
   * A host that cannot act must not present controls that look as if it can.
   */
  control?(input: {
    readonly runId: string;
    readonly action: 'pause' | 'resume' | 'stop';
  }): Promise<RelayLoopRunFetch>;
}

/** Where the ONE restorable fact lives across a refresh. */
export interface RelayLoopRunStore {
  read(): unknown;
  write(point: RelayLoopRestorePoint | null): void;
}

/* -------------------------------------------------------- presentational */

/**
 * What the panel is doing about the SERVER, kept separate from what the RUN is
 * doing. A failed refresh must not be drawn as a failed run, and a restoring
 * panel must not be drawn as an idle one.
 */
export type RelayLoopRunSync = 'idle' | 'restoring' | 'refreshing' | 'acting' | 'unreachable';

export interface RelayLoopRunPanelProps {
  readonly view: RelayLoopRunView;
  readonly sync: RelayLoopRunSync;
  /** Why the last read or action failed. Never a run failure. */
  readonly syncMessage: string | null;
  readonly onRefresh?: () => void;
  readonly onControl?: (action: 'pause' | 'resume' | 'stop') => void;
  readonly onClose?: () => void;
}

const CONTROL_LABEL: Readonly<Record<'pause' | 'resume' | 'stop', string>> = Object.freeze({
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
});

const SYNC_LABEL: Readonly<Record<RelayLoopRunSync, string | null>> = Object.freeze({
  idle: null,
  restoring: 'Restoring this run from the server…',
  refreshing: 'Reading the latest state from the server…',
  acting: 'Waiting for the server to confirm…',
  unreachable: null, // the message says it; a label would repeat it
});

export function RelayLoopRunPanel({
  view, sync, syncMessage, onRefresh, onControl, onClose,
}: RelayLoopRunPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  // ONLY `working` animates. `waiting` is a run blocked on approval or budget
  // and is making no progress; a spinner would claim otherwise once a second
  // for as long as it stays stuck.
  const animating = view.activity === 'working';

  return (
    <section
      className={`rlr rlr--${view.activity}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="rlr-heading"
      data-loop-activity={view.activity}
      data-loop-sync={sync}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose?.(); }}
    >
      <header className="rlr-head">
        <h2 className="rlr-title" id="rlr-heading" ref={headingRef} tabIndex={-1}>
          LOOP RUN
        </h2>
        {onClose !== undefined && (
          <button type="button" className="rlc-btn" onClick={onClose}>Close</button>
        )}
      </header>

      <p className="rlr-headline" role="status">
        <span className={animating ? 'rlr-pulse is-animating' : 'rlr-pulse'} aria-hidden="true" />
        <span className="rlr-state">{view.headline}</span>
      </p>

      {SYNC_LABEL[sync] !== null && (
        <p className="rlr-sync" role="status">{SYNC_LABEL[sync]}</p>
      )}

      {/* A TRANSPORT FAILURE IS NOT A RUN FAILURE. Kept in its own region,
          worded as what it is, so a user never reads "could not reach the
          server" as "the Loop failed". */}
      {syncMessage !== null && (
        <p className="rlr-unreachable" role="alert">
          {syncMessage}
          {' '}
          This says nothing about the run itself — Relay could not ask.
        </p>
      )}

      {view.emptyReason !== null ? (
        <p className="rlr-empty">{view.emptyReason}</p>
      ) : (
        <>
          <dl className="rlr-identity">
            <div><dt>Run</dt><dd className="rlr-id">{view.runId ?? 'Unknown'}</dd></div>
            <div><dt>Loop</dt><dd className="rlr-id">{view.loopId ?? 'Unknown'}</dd></div>
            {view.identityLines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd className={line.unknown ? 'rlr-unknown' : undefined}>{line.value}</dd>
              </div>
            ))}
          </dl>

          <h3 className="rlc-section-title">USAGE</h3>
          <dl className="rlr-usage">
            {view.usageLines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd className={line.unknown ? 'rlr-unknown' : undefined}>{line.value}</dd>
              </div>
            ))}
          </dl>

          {view.blocker !== null && (
            <p className="rlr-blocker" role="status">
              <span className="rlr-tag">WAITING</span>
              {view.blocker}
            </p>
          )}
          {view.requiredUserAction !== null && (
            <p className="rlr-action">{view.requiredUserAction}</p>
          )}
          {view.failure !== null && (
            <p className="rlr-failure" role="alert">
              <span className="rlr-tag">FAILURE</span>
              {view.failure}
            </p>
          )}
        </>
      )}

      <footer className="rlr-controls">
        {/* Rendered only when the host can actually act. */}
        {onControl !== undefined && view.controls.map((control) => (
          <span className="rlr-control" key={control.action}>
            <button
              type="button"
              className="rlc-btn"
              disabled={!control.enabled || sync === 'acting'}
              onClick={() => onControl(control.action)}
            >
              {CONTROL_LABEL[control.action]}
            </button>
            {control.unavailableReason !== null && (
              <span className="rlc-why">{control.unavailableReason}</span>
            )}
          </span>
        ))}
        {onRefresh !== undefined && (
          <button
            type="button"
            className="rlc-btn"
            onClick={onRefresh}
            disabled={sync === 'refreshing' || sync === 'restoring'}
          >
            Refresh
          </button>
        )}
      </footer>
    </section>
  );
}

/* ----------------------------------------------------------------- host */

export interface RelayLoopRunSurfaceProps {
  readonly port: RelayLoopRunPort;
  readonly store: RelayLoopRunStore;
  /** A run this session just started. Absent means "restore, if there is one". */
  readonly runId?: string | null;
  readonly onClose?: () => void;
}

/**
 * The host that makes restoration server-authoritative.
 *
 * On mount it reads the stored restore point, validates its SHAPE only, and
 * asks the server. Whether the run still exists and what state it is in are
 * questions only the server can answer, so it asks rather than trusting
 * anything it stored. A stored point whose run the server no longer knows is
 * cleared, not rendered.
 */
export function RelayLoopRunSurface({ port, store, runId, onClose }: RelayLoopRunSurfaceProps) {
  const [status, setStatus] = useState<LoopStatusProjection | null>(null);
  const [sync, setSync] = useState<RelayLoopRunSync>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | undefined>(undefined);

  const load = useCallback(async (id: string, mode: 'restoring' | 'refreshing') => {
    setSync(mode);
    setSyncMessage(null);
    const result = await port.status(id);
    if (result.ok) {
      setStatus(result.status);
      store.write(restorePointFor(result.status));
      setEmptyReason(undefined);
      setSync('idle');
      return;
    }
    // The server could not answer. The panel does NOT fall back to whatever it
    // last drew: a stale projection that survives a failed refresh is the cache
    // this design exists to refuse.
    setStatus(null);
    setEmptyReason('Relay could not read this run from the server, so it is not showing one.');
    setSyncMessage(result.message);
    setSync('unreachable');
  }, [port, store]);

  useEffect(() => {
    const explicit = runId ?? null;
    if (explicit !== null) {
      void load(explicit, 'restoring');
      return;
    }
    const stored: unknown = store.read();
    if (!isUsableRestorePoint(stored)) {
      // Nothing to restore is not an error, and it is not an empty run either.
      store.write(null);
      setStatus(null);
      setEmptyReason(undefined);
      setSync('idle');
      return;
    }
    void load(stored.runId, 'restoring');
  }, [runId, store, load]);

  const currentId = status?.runId ?? runId ?? null;

  return (
    <RelayLoopRunPanel
      view={projectLoopRunView({ status, ...(emptyReason === undefined ? {} : { emptyReason }) })}
      sync={sync}
      syncMessage={syncMessage}
      onRefresh={currentId === null ? undefined : () => { void load(currentId, 'refreshing'); }}
      onControl={port.control === undefined || currentId === null ? undefined : (action) => {
        void (async () => {
          setSync('acting');
          setSyncMessage(null);
          const result = await port.control!({ runId: currentId, action });
          if (result.ok) {
            setStatus(result.status);
            store.write(restorePointFor(result.status));
            setSync('idle');
            return;
          }
          // The action's outcome is UNKNOWN, so the run is re-read rather than
          // assumed. Announcing "Stopped" here would be announcing an intention.
          setSyncMessage(result.message);
          await load(currentId, 'refreshing');
        })();
      }}
      {...(onClose === undefined ? {} : { onClose })}
    />
  );
}
