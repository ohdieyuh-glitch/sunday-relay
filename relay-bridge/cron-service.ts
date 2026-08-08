import { createLoopRunNodeStore, type LoopRunNodeStore } from '../src/relay/persistence/loop-run-node';
import { createCronClaimNodePort } from '../src/relay/persistence/cron-claim-node';
import {
  createCronScheduleStore, type CronScheduleStore, type ScheduleReadResult,
} from '../src/relay/persistence/cron-schedule-node';
import {
  VERSIONED_CONTRACT_FIELDS,
} from '../src/relay/mission/loop/cron/cron-versioning';
import type {
  CronContractVersion, VersionedRun,
} from '../src/relay/mission/loop/cron/cron-versioning';
import {
  confirmLoopRun, emptyLoopBudget, loopDigest, loopRunIsActive, readLoopRun,
  type LoopOperationDeps,
} from '../src/relay/mission/loop/runtime';
import {
  createIntlTimezonePort, resolvedZoneName, runCronTick, zoneNamesAPlace,
  type ZonePlaceVerdict,
  type CronRunCreationPort, type CronTickInput, type CronTickReport,
} from '../src/relay/mission/loop/cron';

/**
 * SUNDAY RELAY — THE CRON TICK'S COMPOSITION ROOT.
 *
 * `runCronTick` is pure; this builds the real ports it needs from a mounted
 * state root and nothing else. NO AGENT, NO ADAPTER, NO CREDENTIAL is
 * involved — which is the whole safety story of the tick and worth stating
 * where the wiring happens:
 *
 * A SCHEDULED RUN IS CREATED, NOT ADVANCED. `CronRunCreationPort.createRun`
 * is synchronous by design, so it cannot await `runLoopUntilSettled`; and a
 * run created here carries `creationSource: 'schedule'`, which the Loop
 * service now turns into `trigger: 'cron'`, which the iteration engine
 * refuses to dispatch. Three independent reasons a tick spends nothing —
 * and the response says so rather than letting "run_created" read as "work
 * happened".
 *
 * THE OVERLAP COUNT IS DERIVED, NEVER ACCEPTED. `activeRuns` comes from the
 * journal — the runs of this Loop that are actually EXECUTING — because a
 * caller-supplied count would let the client that wants a run decide whether
 * the limit that would stop it applies. What counts as executing is the
 * subtlest thing in this file; see `activeRunsFor`.
 */

/** What one schedule binds its runs to. THE SCHEDULE'S OWN: given at creation
 *  and read from the governing contract version, never from the tick that woke
 *  it. While it was caller-supplied per tick, a stored schedule could be run
 *  into any project and Loop a request named. */
export interface CronRunBinding {
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly loopId: string;
  readonly contractRef: string;
  readonly contractBindingDigest: string;
}

/** One stored schedule, and what the store can truthfully say about it. */
export interface CronScheduleListing {
  readonly scheduleId: string;
  readonly state: 'active' | 'paused' | 'corrupt' | 'missing';
}

/** How many schedules one listing will replay. Chosen to bound the work, not
 *  because more cannot exist — `totalStored` always reports the real count.
 *  EXPORTED so a test can reach the boundary: a cap no test can approach is a
 *  cap nothing proves, and `truncated` would pass while hardcoded false. */
export const MAX_LISTED_SCHEDULES = 200;

export interface CronScheduleListingPage {
  readonly schedules: readonly CronScheduleListing[];
  /** Every schedule on the volume, including any beyond the cap. */
  readonly totalStored: number;
  readonly truncated: boolean;
}

export interface CronTickService {
  /** The durable schedules. A tick reads what to run from HERE, not from the
   *  request that woke it. */
  readonly schedules: CronScheduleStore;
  /** What the store says about one schedule: found, missing or corrupt. */
  inspectSchedule(scheduleId: string): ScheduleReadResult;
  /** Every stored schedule WITH the state the store can actually state. A bare
   *  list of ids reports a corrupt or paused schedule as an ordinary one, and
   *  the store separates `inspect` from `list` precisely because that
   *  difference is the thing an operator needs to see. */
  listSchedules(): CronScheduleListingPage;
  /** What ICU resolves this zone to, or null when nothing can. An IANA-SHAPED
   *  string is not an IANA zone: `America/Atlantis` matches the pattern and
   *  nothing resolves it. */
  resolveZone(timeZone: string): string | null;
  /** Whether the zone names a place, does not, or cannot be verified. */
  zoneNamesAPlace(timeZone: string): ZonePlaceVerdict;
  createSchedule(
    scheduleId: string, first: CronContractVersion,
  ): { readonly ok: true } | { readonly ok: false; readonly problem: string };
  editSchedule(
    scheduleId: string,
    proposed: Omit<CronContractVersion, 'version'>,
    runs: readonly VersionedRun[],
  ): { readonly ok: true; readonly version: number; readonly changed: readonly string[] }
    | { readonly ok: false; readonly problem: string };
  setSchedulePaused(
    scheduleId: string, paused: boolean, at: string,
  ): { readonly ok: true } | { readonly ok: false; readonly problem: string };
  removeSchedule(
    scheduleId: string, at: string,
  ): { readonly ok: true; readonly claimsPurged: number; readonly claimsLeft: number }
    | { readonly ok: false; readonly problem: string };
  tick(input: Omit<CronTickInput, 'tz' | 'digest'> & {
    readonly binding: CronRunBinding;
  }): CronTickReport;
  /** How many runs of this Loop are EXECUTING right now, per the journal.
   *  A created-but-never-started run is not one of them — see the
   *  implementation for why that distinction is load-bearing. */
  activeRunsFor(loopId: string): number;
  /**
   * How many run records this Loop holds AT ALL, in whatever state.
   *
   * The cheap counterpart to `activeRunsFor`: one directory listing, with no
   * journal replayed. It exists so a caller can bound the cost of the
   * expensive count before paying it — nothing prunes a run record, and this
   * build creates scheduled runs it never advances, so a Loop's directory only
   * grows and `activeRunsFor` grows with it.
   */
  runCountFor(loopId: string): number;
  /**
   * The runs of THIS SCHEDULE in this Loop, with the version each started
   * under, plus how many runs in the Loop could not be attributed at all.
   *
   * The unattributed count is not decoration: a schedule-created run written
   * before runs recorded their schedule carries `scheduleId: null`, and
   * treating those as "not ours" would let an edit report a clean list over
   * runs that may well be ours. Unknown is reported as unknown.
   */
  scheduleRunsFor(loopIds: readonly string[], scheduleId: string): {
    readonly runs: readonly VersionedRun[];
    readonly unattributed: number;
  };
  /** Exposed for diagnostics and tests; never reachable from a route. */
  readonly store: LoopRunNodeStore;
}

/**
 * The budget every scheduled run is created with.
 *
 * The Loop service's `DEFAULT_POLICY`, restated rather than imported because
 * that one is private to its module. NOT a per-schedule policy: none exists,
 * and neither do the per-day/week/billing-period caps CRON_LOOPS.md calls
 * for. What keeps that from being a spending hazard today is that nothing
 * dispatches — the caps bind nothing because no iteration runs.
 */
const SCHEDULED_RUN_BUDGET = {
  maxIterations: 10,
  maxSpendMicros: '10000000',
  maxTotalTokens: 1_000_000,
  maxProviderCalls: 100,
  maxTotalDurationMinutes: 60,
};

export function createCronTickService(options: {
  readonly root: string;
  readonly now: () => string;
}): CronTickService {
  const store = createLoopRunNodeStore({ root: options.root });
  const operations: LoopOperationDeps = {
    backing: store,
    digest: loopDigest,
    now: options.now,
  };
  const claim = createCronClaimNodePort({ stateRoot: options.root, now: options.now });
  const schedules = createCronScheduleStore({ root: options.root });
  const tz = createIntlTimezonePort();

  /**
   * Runs of this Loop that are actually EXECUTING.
   *
   * `queued` is excluded deliberately, and the distinction is the difference
   * between a working endpoint and a wedged one. Overlap policies decide what
   * may run BESIDE work in flight; a run that has never started occupies no
   * execution slot. Counting `queued` as occupancy — which `loopRunIsActive`
   * does, correctly, for its own purpose of "not finished" — made this
   * endpoint destroy itself: a scheduled run is created `queued` and, by this
   * build's own safety property, nothing ever advances it, so the count
   * saturated at the first tick and never came down. Every later occurrence
   * then hit the overlap limit forever, and under `skip` each one was
   * DURABLY CLAIMED with no run behind it — occurrences silently and
   * irreversibly consumed, which is exactly what the claim marker exists to
   * make unrecoverable. Found by review, reproduced across three ticks.
   *
   * WHEN DISPATCH LANDS this stays correct rather than becoming a lie: a run
   * that starts leaves `queued` and is counted from that moment. What must
   * NOT happen is someone widening this back to `loopRunIsActive` to "count
   * everything" — the exhaustion tests below pin the queued case.
   */
  /** One directory listing, no journal replay. See the interface for why. */
  const runCountFor = (loopId: string): number => store.runIdsForLoop(loopId)?.length ?? 0;

  const activeRunsFor = (loopId: string): number => {
    const runIds = store.runIdsForLoop(loopId);
    if (runIds === null) return 0;
    let active = 0;
    for (const runId of runIds) {
      const loaded = readLoopRun(store, runId, loopDigest);
      if (loaded?.run == null) continue;
      if (loaded.run.state === 'queued') continue;
      if (loopRunIsActive(loaded.run.state)) active += 1;
    }
    return active;
  };

  const runsFor = (binding: CronRunBinding): CronRunCreationPort => ({
    createRun: (occurrence) => {
      const created = confirmLoopRun(operations, {
        // THE SCHEDULE IS THE AUTHOR, not whoever woke the tick. A principal
        // taken from the request would put the operator into the
        // idempotency key, so a second operator ticking the same schedule
        // would derive the same runId under a DIFFERENT key and get an
        // idempotency conflict on an occurrence already claimed — stuck for
        // a human over nothing.
        principal: 'relay-schedule',
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        loopId: binding.loopId,
        // DERIVED from the occurrence, never minted: a replay lands on the
        // same id, finds the run and answers duplicate rather than creating
        // a second one.
        runId: `lpr_${loopDigest(occurrence.occurrenceId).slice(0, 32)}`,
        contractRef: binding.contractRef,
        // The OCCURRENCE's version, not the binding's — an edited schedule
        // must not collide with its predecessor's runs.
        contractVersion: occurrence.contractVersion,
        contractBindingDigest: binding.contractBindingDigest,
        // `occ_<hex>`: no '#', which the confirmation input reserves for
        // role-scoped derivation.
        confirmationRequestId: occurrence.occurrenceId,
        creationSource: 'schedule',
        // THE OCCURRENCE KNOWS WHICH SCHEDULE IT CAME FROM, so the run does
        // too. Without it the edit endpoint can say nothing about the runs a
        // schedule already has unfinished.
        scheduleId: occurrence.scheduleId,
        budget: emptyLoopBudget({ ...SCHEDULED_RUN_BUDGET, currency: 'USD', maxConsecutiveFailures: 3 }),
        // Nothing contacted a provider. Still true, and the tick is the
        // reason it stays true.
        provenance: 'offline',
      });
      return created.ok
        ? { ok: true, runId: created.run.runId, duplicate: created.duplicate }
        : { ok: false, problem: created.problem };
    },
  });

  return {
    store,
    schedules,
    inspectSchedule: (scheduleId) => schedules.inspect(scheduleId),
    // BOUNDED ON PURPOSE. Stating each schedule's state costs a journal replay
    // apiece, and the bridge is single-threaded: an unbounded list would block
    // every other route for the total journal bytes on the volume. The cap is
    // reported rather than applied silently — a truncated list that looks
    // complete is how an operator concludes a schedule is gone.
    listSchedules: () => {
      const all = schedules.list();
      return {
        totalStored: all.length,
        truncated: all.length > MAX_LISTED_SCHEDULES,
        schedules: all.slice(0, MAX_LISTED_SCHEDULES).map((scheduleId) => {
          const inspected = schedules.inspect(scheduleId);
          if (inspected.kind === 'corrupt') return { scheduleId, state: 'corrupt' as const };
          // `list` enumerates directories; `inspect` replays. A schedule that
          // disappeared between the two is reported as gone, never as healthy.
          if (inspected.kind === 'missing') return { scheduleId, state: 'missing' as const };
          return {
            scheduleId,
            state: inspected.record.paused ? ('paused' as const) : ('active' as const),
          };
        }),
      };
    },
    resolveZone: (timeZone) => resolvedZoneName(timeZone),
    zoneNamesAPlace: (timeZone) => zoneNamesAPlace(timeZone),
    createSchedule: (scheduleId, first) => {
      const result = schedules.create(scheduleId, first);
      return result.ok ? { ok: true } : { ok: false, problem: result.problem };
    },
    removeSchedule: (scheduleId, at) => {
      const result = schedules.remove(scheduleId, at);
      return result.ok
        ? {
          ok: true,
          claimsPurged: result.value.claimsPurged,
          claimsLeft: result.value.claimsLeft,
        }
        : { ok: false, problem: result.problem };
    },
    setSchedulePaused: (scheduleId, paused, at) => {
      const result = schedules.setPaused(scheduleId, paused, at);
      return result.ok ? { ok: true } : { ok: false, problem: result.problem };
    },
    editSchedule: (scheduleId, proposed, runs) => {
      const result = schedules.edit(scheduleId, proposed, runs);
      if (!result.ok) return { ok: false, problem: result.problem };
      // WHAT ACTUALLY LANDED, diffed from the returned history. Asking
      // `planScheduleEdit` a second time out here would answer about a head
      // read OUTSIDE the write lock: another writer appending between the two
      // makes the report describe an edit that did not happen — and a
      // `no_change` out here beside a success in there would answer 200 saying
      // the new version changed nothing, a state the store guarantees cannot
      // exist.
      const appended = [...result.value.history].sort((a, b) => a.version - b.version);
      const head = appended[appended.length - 1];
      const previous = appended[appended.length - 2];
      const changed = head === undefined || previous === undefined
        ? []
        // THE PLANNER'S OWN LIST, not a copy of it: a field added to one and
        // not the other would be changed by an edit this response calls a
        // change to nothing.
        : VERSIONED_CONTRACT_FIELDS.filter((field) => head[field] !== previous[field]);
      return { ok: true, version: head?.version ?? 0, changed };
    },
    activeRunsFor,
    runCountFor,
    scheduleRunsFor: (loopIds, scheduleId) => {
      const runs: VersionedRun[] = [];
      let unattributed = 0;
      // EVERY LOOP THIS SCHEDULE HAS EVER NAMED, not just the one its head
      // names. `loopId` is a versioned field and rebinding is a supported edit,
      // so runs made under an earlier version live in an earlier Loop — and
      // scanning only the current one made them vanish from both outputs.
      for (const runId of [...new Set(loopIds)].flatMap((id) => store.runIdsForLoop(id) ?? [])) {
        const loaded = readLoopRun(store, runId, loopDigest);
        // A RUN THAT CANNOT BE READ IS NOT ABSENT. It might be this schedule's,
        // so it counts as unattributed rather than being dropped.
        if (loaded === null || loaded.run === null) { unattributed += 1; continue; }
        // NOR IS A RUN WHOSE JOURNAL IS DAMAGED. A torn or corrupt journal
        // still replays into a partial run — it does NOT read back as null —
        // and that partial record cannot be trusted to say whose run it is.
        if (loaded.journalIntegrity !== 'ok') { unattributed += 1; continue; }
        // NOR IS A RECORD WITH NO IDENTITY YET. Only `loop.run_created` gives a
        // run its identity; until it folds, the record is the bare SEED, whose
        // `creationSource` defaults to `api` — so a schedule's run would read
        // as somebody else's ordinary run and be skipped in silence.
        //
        // `lastSequence === 0` was the first attempt and is NOT sound:
        // `confirmLoopRun` writes the record, then `contract_confirmed`, then
        // `run_created`, so a crash or a refused third append leaves a durable
        // record at sequence 1 that still carries the seed's defaults — and a
        // re-tick finds it and answers `duplicate`, so nothing ever repairs it.
        // The empty key is what actually means "no identity".
        if (loaded.run.idempotencyKey === '') { unattributed += 1; continue; }
        const run = loaded.run;
        if (run.creationSource !== 'schedule') continue;
        if (run.scheduleId === null) { unattributed += 1; continue; }
        if (run.scheduleId !== scheduleId) continue;
        runs.push({ runId, contractVersion: run.contractVersion, active: loopRunIsActive(run.state) });
      }
      return { runs, unattributed };
    },
    // THE OCCURRENCE IDENTITY'S FIRST TERM IS THE SCHEDULE ID ITSELF. The
    // approved formula assumes that id is globally unique, and within the
    // namespace that matters it is: the claim markers share one flat namespace
    // per state root, and that root holds one schedule per id — `dirFor` gives
    // one directory and `create` takes it with `O_EXCL`. It was qualified with
    // (project, workspace, loop) back when a schedule was caller-declared and
    // two projects could both say "daily-triage"; once the binding was read
    // from the very schedule the id already names, that qualification could no
    // longer distinguish anything, while it COULD still move under a rebinding
    // and orphan every marker written before it. An identity term that varies
    // with mutable data is how a handled window gets replayed.
    tick: (input) => runCronTick(claim, runsFor(input.binding), {
      ...input,
      tz,
      digest: loopDigest,
    }),
  };
}
