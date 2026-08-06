import { createLoopRunNodeStore, type LoopRunNodeStore } from '../src/relay/persistence/loop-run-node';
import { createCronClaimNodePort } from '../src/relay/persistence/cron-claim-node';
import {
  confirmLoopRun, emptyLoopBudget, loopDigest, loopRunIsActive, readLoopRun,
  type LoopOperationDeps,
} from '../src/relay/mission/loop/runtime';
import {
  createIntlTimezonePort, runCronTick,
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
 * journal — the runs this Loop actually has in an active state — because a
 * caller-supplied count would let the client that wants a run decide whether
 * the limit that would stop it applies.
 */

/** What one schedule binds its runs to. Caller-supplied: no schedule store
 *  exists, and inventing one to make this look finished would be worse. */
export interface CronRunBinding {
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly loopId: string;
  readonly contractRef: string;
  readonly contractBindingDigest: string;
}

export interface CronTickService {
  tick(input: Omit<CronTickInput, 'tz' | 'digest'> & {
    readonly binding: CronRunBinding;
  }): CronTickReport;
  /** How many runs of this Loop the journal reports active, right now. */
  activeRunsFor(loopId: string): number;
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
  const tz = createIntlTimezonePort();

  const activeRunsFor = (loopId: string): number => {
    const runIds = store.runIdsForLoop(loopId);
    if (runIds === null) return 0;
    let active = 0;
    for (const runId of runIds) {
      const loaded = readLoopRun(store, runId, loopDigest);
      if (loaded?.run != null && loopRunIsActive(loaded.run.state)) active += 1;
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
    activeRunsFor,
    tick: (input) => runCronTick(claim, runsFor(input.binding), { ...input, tz, digest: loopDigest }),
  };
}
