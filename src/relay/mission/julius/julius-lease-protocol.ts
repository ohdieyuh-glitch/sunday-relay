/**
 * THE DURABLE LEASE PROTOCOL — the primitive Julius and the Wonderland swarm
 * scheduler already share, named once so they cannot drift apart.
 *
 * THE SITUATION THIS EXISTS TO RESOLVE. Relay now has two schedulers.
 * `julius_tasks` claims work out of a dependency DAG for a mission;
 * `swarm_workers` claims work out of a bounded parallel fan-out for one battle
 * or goal. They were built separately and they implement THE SAME PROTOCOL:
 * the same five lease columns, the same `FOR UPDATE … SKIP LOCKED` claim, the
 * same generation counter, the same compare-and-set on completion, the same
 * expired-lease reclaim.
 *
 * TWO GENERAL-PURPOSE WORKER LEASE SYSTEMS IS ONE TOO MANY, and the answer is
 * NOT to merge the two tables. They model different things and merging them
 * would put a battle's role fan-out and a mission's dependency graph in one
 * schema with a nullable half:
 *
 *   TASK GRAPH   a dependency structure — what must happen before what
 *   SUB-AGENT    a dynamically authorized child worker inside a run
 *   SWARM        a bounded parallel execution strategy for one goal
 *
 * Those three stay distinct. What they share is HOW A WORKER TAKES WORK AND
 * PROVES IT STILL HAS IT, and that is the thing named here.
 *
 * WHAT THIS MODULE IS. The invariants, written once, plus a conformance
 * harness any implementation can be driven through. It is not a base class and
 * not a shared query builder: neither scheduler changes, and both are now
 * HELD to the same contract instead of being similar by coincidence.
 *
 * THE CONVERGENCE PATH, recorded rather than taken. A single
 * `relay_wonderland.leases` table keyed by `(scheduler, subject_id)` would
 * carry both, with each scheduler keeping its own domain table and joining. It
 * is not done here because it is a migration across two working systems for an
 * architectural gain, and the founder's instruction was to preserve working
 * battle and swarm behaviour. This contract is what makes that migration safe
 * to attempt later: it is the test suite the merged table would have to pass.
 */

/* ------------------------------------------------------------ the contract */

/**
 * ONE LEASED SUBJECT, in whichever scheduler.
 *
 * `subjectId` is a task id in Julius and a worker id in the swarm; the
 * protocol does not care which, which is the point.
 */
export interface LeasedSubject {
  readonly subjectId: string;
  readonly leaseOwner: string | null;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: string | null;
  readonly attempt: number;
  /** Whether the subject is currently held by a worker. */
  readonly active: boolean;
}

/**
 * What a scheduler must be able to do for the protocol to hold.
 *
 * Deliberately four methods. A protocol with more is a protocol two
 * implementations will diverge on; these four are exactly the ones both
 * schedulers already have.
 */
export interface LeaseScheduler {
  /** Take up to `limit` subjects. Never returns one another owner holds. */
  claim(input: { owner: string; now: string; leaseExpiresAt: string; limit: number }): Promise<readonly LeasedSubject[]>;
  /** Renew a lease. False when the caller no longer holds it. */
  heartbeat(input: { subjectId: string; owner: string; leaseGeneration: number; now: string; leaseExpiresAt: string }): Promise<boolean>;
  /** Finish. False when the caller no longer holds the lease. */
  complete(input: { subjectId: string; owner: string; leaseGeneration: number; now: string }): Promise<boolean>;
  /** Read one subject's current lease state. */
  read(subjectId: string): Promise<LeasedSubject | null>;
  /**
   * WHERE THIS SCHEDULER ADMITS WORK, which decides where an attempt is spent.
   *
   * The swarm's claim query enforces the concurrency ceiling itself — it takes
   * `ceiling - active` subjects and no more — so a claimed worker is always a
   * worker that runs, and its claim IS its admission. Julius claims first and
   * decides second: it resolves policy, compares the run's C.A.R.D.
   * concurrency, and hands back what it cannot run, so a claim there is
   * ownership only and admission comes later, in `admitTask`.
   *
   * Declaring it is what lets one invariant hold both. Default `true`, which
   * is the model every scheduler that predates this field implements.
   */
  readonly claimIsAdmission?: boolean;
  /**
   * HOW THIS SCHEDULER BRINGS AN EXPIRED LEASE BACK.
   *
   * The swarm's claim query offers an expired subject directly, so a claim
   * reclaims it. Julius's does not, deliberately: that path raised only the
   * generation and bypassed the recovery ceiling, so a subject claimed and
   * abandoned could be retaken forever without ever being counted. Julius
   * brings it back through a bounded recovery sweep that counts the reclaim
   * and can end the subject instead of re-offering it.
   *
   * Supplied, the harness runs it before the reclaim step; omitted, the claim
   * is expected to do the reclaiming itself, which is what every scheduler
   * predating this hook does. Either way the invariants below are the same:
   * the subject comes back, with a new generation, and the previous holder
   * has no authority.
   */
  reclaimExpired?: (now: string) => Promise<void>;
}

/* ---------------------------------------------------------- the invariants */

export const LEASE_INVARIANTS = [
  'a claimed subject is held by exactly one owner',
  'a claim increments the generation',
  'the attempt count follows the scheduler\'s admission model',
  'a stale generation cannot heartbeat',
  'a stale generation cannot complete',
  'a different owner cannot heartbeat',
  'a different owner cannot complete',
  'an expired lease is reclaimable',
  'reclaiming produces a new generation',
  'the previous holder has no authority after a reclaim',
  'a completed subject is not re-offered',
] as const;
export type LeaseInvariant = (typeof LEASE_INVARIANTS)[number];

export interface LeaseConformanceResult {
  readonly invariant: LeaseInvariant;
  readonly held: boolean;
  readonly detail: string;
}

/**
 * Drive a scheduler through every invariant.
 *
 * Returns a RESULT PER INVARIANT rather than throwing on the first failure,
 * because a scheduler that breaks three of them should report three — a
 * conformance run that stops at the first is a bisect, not a report.
 *
 * `expiredAt` and `futureAt` are supplied so the harness needs no clock: the
 * caller decides what "already expired" and "not yet expired" mean, which is
 * the only way this can run against a deterministic model and a real database
 * with the same code.
 */
export async function verifyLeaseProtocol(
  scheduler: LeaseScheduler,
  clock: { readonly now: string; readonly expiredAt: string; readonly futureAt: string },
): Promise<readonly LeaseConformanceResult[]> {
  const results: LeaseConformanceResult[] = [];
  const record = (invariant: LeaseInvariant, held: boolean, detail: string) =>
    results.push({ invariant, held, detail });

  /* -- one owner, a new generation, an attempt counted where it should be -- */
  const offered = await scheduler.claim({ owner: 'owner-probe', now: clock.now, leaseExpiresAt: clock.now, limit: 1 });
  // The probe claim is released by letting its lease expire immediately, so the
  // real claim below sees the same subject with a known prior attempt count.
  const beforeClaim = offered[0] === undefined ? null : await scheduler.read(offered[0].subjectId);
  // The probe's lease is already expired; bring the subject back the way this
  // scheduler brings any expired lease back, so the measured claim below sees
  // it. Without this a scheduler whose claim does not reclaim — Julius — would
  // have its only subject stranded by the probe.
  await scheduler.reclaimExpired?.(clock.now);
  const first = await scheduler.claim({ owner: 'owner-a', now: clock.now, leaseExpiresAt: clock.futureAt, limit: 1 });
  if (first.length === 0) {
    record('a claimed subject is held by exactly one owner', false, 'nothing was claimable');
    return results;
  }
  const subject = first[0]!;
  const before = subject.leaseGeneration;

  const contested = await scheduler.claim({ owner: 'owner-b', now: clock.now, leaseExpiresAt: clock.futureAt, limit: 1 });
  record(
    'a claimed subject is held by exactly one owner',
    !contested.some((other) => other.subjectId === subject.subjectId),
    contested.length === 0 ? 'a second claim took nothing' : 'a second claim took a different subject',
  );
  record(
    'a claim increments the generation',
    before > (beforeClaim?.leaseGeneration ?? 0),
    `generation went ${beforeClaim?.leaseGeneration ?? 0} -> ${before}`,
  );
  /**
   * AN ATTEMPT IS SPENT AT ADMISSION, NOT AT OWNERSHIP.
   *
   * This invariant used to read "a claim increments the attempt count", which
   * was the swarm's truth stated as everyone's. Julius hands claimed tasks
   * back — for policy it cannot resolve, for a C.A.R.D. concurrency allowance
   * already spent — and while its claim counted, every one of those hand-backs
   * spent a provider retry on a provider that was never called.
   *
   * So the rule is the same for both and the place is not: a scheduler whose
   * claim is its admission must count at the claim, and a scheduler that
   * decides afterwards must NOT, or it charges for work it may refuse to do.
   *
   * Measured as a DELTA, not against zero. Asserting `attempt === 0` would
   * hold only for a subject that has never executed, and this harness is meant
   * to be pointed at any scheduler, including one whose claimable subject has
   * a history. The claim either raised the count or it did not, and that is
   * the whole question.
   */
  const claimIsAdmission = scheduler.claimIsAdmission ?? true;
  const attemptBefore = beforeClaim?.attempt ?? 0;
  record(
    "the attempt count follows the scheduler's admission model",
    claimIsAdmission ? subject.attempt > attemptBefore : subject.attempt === attemptBefore,
    `attempt went ${attemptBefore} -> ${subject.attempt}; a claim ${claimIsAdmission ? 'is' : 'is not'} an admission here`,
  );

  /* -- authority is (owner, generation), and nothing else -- */
  record(
    'a stale generation cannot heartbeat',
    !(await scheduler.heartbeat({ subjectId: subject.subjectId, owner: 'owner-a', leaseGeneration: before - 1, now: clock.now, leaseExpiresAt: clock.futureAt })),
    'heartbeat with generation - 1',
  );
  record(
    'a different owner cannot heartbeat',
    !(await scheduler.heartbeat({ subjectId: subject.subjectId, owner: 'owner-b', leaseGeneration: before, now: clock.now, leaseExpiresAt: clock.futureAt })),
    'heartbeat as another owner',
  );
  record(
    'a stale generation cannot complete',
    !(await scheduler.complete({ subjectId: subject.subjectId, owner: 'owner-a', leaseGeneration: before - 1, now: clock.now })),
    'complete with generation - 1',
  );
  record(
    'a different owner cannot complete',
    !(await scheduler.complete({ subjectId: subject.subjectId, owner: 'owner-b', leaseGeneration: before, now: clock.now })),
    'complete as another owner',
  );

  /* -- an abandoned lease comes back, with new authority -- */
  await scheduler.heartbeat({
    subjectId: subject.subjectId, owner: 'owner-a', leaseGeneration: before,
    now: clock.now, leaseExpiresAt: clock.expiredAt,
  });
  await scheduler.reclaimExpired?.(clock.now);
  const reclaimed = await scheduler.claim({ owner: 'owner-c', now: clock.now, leaseExpiresAt: clock.futureAt, limit: 5 });
  const retaken = reclaimed.find((other) => other.subjectId === subject.subjectId) ?? null;
  record('an expired lease is reclaimable', retaken !== null, retaken === null ? 'not re-offered' : 're-offered');
  record(
    'reclaiming produces a new generation',
    retaken !== null && retaken.leaseGeneration > before,
    `was ${before}, now ${retaken?.leaseGeneration ?? 'n/a'}`,
  );
  record(
    'the previous holder has no authority after a reclaim',
    !(await scheduler.complete({ subjectId: subject.subjectId, owner: 'owner-a', leaseGeneration: before, now: clock.now })),
    'the original holder tried to complete',
  );

  /* -- finished work is not offered again -- */
  if (retaken !== null) {
    await scheduler.complete({ subjectId: subject.subjectId, owner: 'owner-c', leaseGeneration: retaken.leaseGeneration, now: clock.now });
  }
  const after = await scheduler.claim({ owner: 'owner-d', now: clock.now, leaseExpiresAt: clock.futureAt, limit: 5 });
  record(
    'a completed subject is not re-offered',
    !after.some((other) => other.subjectId === subject.subjectId),
    'claimed again after completion',
  );

  return results;
}

/** Every invariant that did not hold. Empty means conformant. */
export function leaseProtocolFailures(
  results: readonly LeaseConformanceResult[],
): readonly LeaseConformanceResult[] {
  return results.filter((result) => !result.held);
}
