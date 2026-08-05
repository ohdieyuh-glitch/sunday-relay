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
  | {
    readonly ok: false;
    readonly message: string;
    /**
     * WHY it failed, when the port knows.
     *
     * Without this the host could not tell "this run does not exist" from
     * "Relay could not reach the bridge" — and the two demand opposite
     * behaviour: the first must clear the stored id so a dead run is not
     * re-requested forever, and the second must keep it, because the run is
     * probably fine and the network is not.
     *
     * OPTIONAL, AND ABSENT IN EVERY SHIPPED PATH TODAY. No adapter constructs
     * this type outside the tests — the website supplies no port at all — so a
     * failure arrives here without a kind and the stored id is KEPT, which is
     * the conservative half. Recorded rather than implied, because an earlier
     * version of this comment said the client "used to drop it on the floor",
     * and there is no client wired to drop anything.
     *
     * The kinds that mean GONE are `not_found` and `run_not_found`. A server
     * that invents a third word will be treated as unreachable, which keeps
     * the id — wrong in the safe direction.
     */
    readonly kind?: string;
  };

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
export type RelayLoopRunSync =
  | 'idle' | 'restoring' | 'refreshing' | 'acting'
  /** Relay could not ASK. Nothing is claimed about the run. */
  | 'unreachable'
  /**
   * A control did not take effect, AND the re-read that followed succeeded.
   *
   * Named for the common case and defined by the second clause, because that
   * is what the code actually tests. Whether the control failed because the
   * server refused it or because the request never arrived is not knowable
   * here — but the READ did arrive, so the run shown below is current, and
   * that is the only thing this state asserts.
   *
   * Distinct from `unreachable` because the sentence that follows differs
   * completely: telling a user "Relay could not ask" while showing them a
   * fresh answer is the surface lying about what just happened.
   */
  | 'refused';

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
  refused: null,
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
          {sync === 'refused'
            // The server answered, so the run shown below IS current. Saying
            // "Relay could not ask" here would contradict the panel itself.
            ? 'The run below is what the server reports now.'
            : 'This says nothing about the run itself — Relay could not ask.'}
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
            // `acting` too: a read started while a control is in flight can
            // outlive it and repaint the pre-control state. The host also stops
            // offering the handler, and both are deliberate — the panel should
            // be correct on its own rather than only in the host that wires it.
            disabled={sync === 'refreshing' || sync === 'restoring' || sync === 'acting'}
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
/** Failure kinds that mean the run is GONE rather than unreachable. */
const RUN_ABSENT_KINDS: ReadonlySet<string> = new Set(['not_found', 'run_not_found']);

/**
 * A store whose `read` or `write` throws must not take the tree down with it.
 * `localStorage` throws under blocked storage and over quota, and a surface
 * that crashes because it could not remember a run id is worse than one that
 * forgets it.
 */
function safeRead(store: RelayLoopRunStore): unknown {
  try {
    return store.read();
  } catch {
    return null;
  }
}
function safeWrite(store: RelayLoopRunStore, point: RelayLoopRestorePoint | null): void {
  try {
    store.write(point);
  } catch {
    // Nothing to do and nothing to claim: the id is simply not remembered.
  }
}

export function RelayLoopRunSurface({ port, store, runId, onClose }: RelayLoopRunSurfaceProps) {
  const [status, setStatus] = useState<LoopStatusProjection | null>(null);
  const [sync, setSync] = useState<RelayLoopRunSync>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | undefined>(undefined);

  /**
   * THE LATEST REQUEST WINS, AND ONLY THE LATEST.
   *
   * Every read and every control takes a ticket; a result whose ticket is no
   * longer current is DROPPED. Without this, two overlapping requests race and
   * the SLOWER one decides what the screen says — so a refresh issued before a
   * Stop could answer after it and repaint a stopped run as `running`, with the
   * pulse animating. That is rule 1 broken by the surface that exists to hold
   * it, and no amount of correct state mapping prevents it.
   *
   * The same ticket handles unmount: after it, nothing is current, so a late
   * response neither renders nor writes to the store.
   */
  const ticket = useRef(0);
  const alive = useRef(true);
  const nextTicket = () => {
    ticket.current += 1;
    return ticket.current;
  };
  /*
   * THE COUNTER IS MONOTONIC; UNMOUNT IS A SEPARATE FLAG.
   *
   * Cleanup used to set the ticket to `-1`, which is a REWIND rather than a
   * bump — so tickets restarted at 1, 2, 3 and collided with requests still in
   * flight from before. React double-invokes effects under `<StrictMode>`,
   * which `src/relay/main.tsx` uses, so a mount issued two passes of reads and
   * an orphaned first-pass response could match a later ticket exactly and
   * repaint a finished run as running. The guard defeated by its own cleanup.
   *
   * `alive` also has to be RE-ARMED on mount: StrictMode runs cleanup between
   * the two passes, and a flag that only ever goes false would leave the second
   * pass unable to render anything at all.
   */
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const current = (mine: number) => alive.current && ticket.current === mine;

  const load = useCallback(async (
    id: string,
    mode: 'restoring' | 'refreshing',
    /** A message from a control that failed. It must survive the re-read. */
    carryMessage?: string,
  ) => {
    const mine = nextTicket();
    setSync(mode);
    setSyncMessage(carryMessage ?? null);
    const result = await port.status(id);
    if (!current(mine)) return;   // superseded, or unmounted
    if (result.ok) {
      setStatus(result.status);
      safeWrite(store, restorePointFor(result.status));
      setEmptyReason(undefined);
      // A control failure is still the most recent thing the user did, so its
      // message outlives a successful re-read rather than being wiped by it —
      // as `refused`, because the read SUCCEEDED and the run below is current.
      setSync(carryMessage === undefined ? 'idle' : 'refused');
      return;
    }
    // The server could not answer. The panel does NOT fall back to whatever it
    // last drew: a stale projection that survives a failed refresh is the cache
    // this design exists to refuse.
    setStatus(null);
    setEmptyReason('Relay could not read this run from the server, so it is not showing one.');
    setSyncMessage(carryMessage ?? result.message);
    setSync('unreachable');
    // A run the server says does not EXIST is forgotten, so it is not
    // re-requested on every future mount. One it merely could not reach is
    // kept, because the run is probably fine and the network is not.
    if (result.kind !== undefined && RUN_ABSENT_KINDS.has(result.kind)) safeWrite(store, null);
  }, [port, store]);

  useEffect(() => {
    const explicit = runId ?? null;
    if (explicit !== null) {
      void load(explicit, 'restoring');
      return;
    }
    const stored: unknown = safeRead(store);
    if (!isUsableRestorePoint(stored)) {
      // Nothing to restore is not an error, and it is not an empty run either.
      safeWrite(store, null);
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
      onRefresh={currentId === null || sync === 'acting'
        ? undefined
        : () => { void load(currentId, 'refreshing'); }}
      onControl={port.control === undefined || currentId === null ? undefined : (action) => {
        void (async () => {
          const mine = nextTicket();
          setSync('acting');
          setSyncMessage(null);
          const result = await port.control!({ runId: currentId, action });
          if (!current(mine)) return;   // superseded, or unmounted
          if (result.ok) {
            setStatus(result.status);
            safeWrite(store, restorePointFor(result.status));
            setSync('idle');
            return;
          }
          // The action's outcome is UNKNOWN, so the run is re-read rather than
          // assumed. Announcing "Stopped" here would be announcing an intention.
          //
          // The failure message is CARRIED INTO the re-read rather than set
          // before it: `load` clears the message on entry, so setting it here
          // meant a refused Stop left the screen saying nothing at all.
          await load(currentId, 'refreshing', result.message);
        })();
      }}
      {...(onClose === undefined ? {} : { onClose })}
    />
  );
}
