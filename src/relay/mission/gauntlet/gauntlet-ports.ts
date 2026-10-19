/**
 * WHAT THE GAUNTLET COMMAND NEEDS, DECLARED ON THE GAUNTLET'S SIDE.
 *
 * Every interface here is written in the gauntlet's own vocabulary and names
 * nothing Julius-specific. That is deliberate: the dependency runs
 * Gauntlet → generic infrastructure, so the gauntlet states what it needs and
 * a composition root binds it to whatever provides it. Declaring these inside
 * `mission/julius/**` — or importing a Julius type here — would put the arrow
 * back the wrong way round.
 *
 * A composition root today binds {@link GauntletWorkPort} to Julius's generic
 * task interface, because Julius is what executes work in this product. It
 * could equally bind to something else, and nothing in this directory would
 * change — which is the test of whether the boundary is real.
 */

/* ----------------------------------------------------------- the work port */

/**
 * REQUESTING WORK, GENERICALLY.
 *
 * The gauntlet needs three things from whatever executes work: put a unit of
 * work in the queue, ask whether a unit finished, and stop one. It does not
 * need — and must not be given — a mission state machine, a task graph, a
 * scheduler, a lease, or anything else that would make this port a Julius
 * interface wearing a different name.
 */
export interface GauntletWorkPort {
  /**
   * Request one unit of work. Idempotent by `workId`: a retried request
   * returns the existing unit rather than queueing a second.
   */
  requestWork(input: {
    readonly workId: string;
    readonly subjectId: string;
    readonly kind: 'REVIEW' | 'REPAIR' | 'EXECUTE';
    readonly ordinal: number;
  }): Promise<{ readonly accepted: boolean; readonly duplicate: boolean; readonly reasonCode: string | null }>;
  /** Whether a requested unit has finished, and how. `null` while it runs. */
  workOutcome(workId: string): Promise<'PASSED' | 'FAILED' | 'CANCELLED' | null>;
  /** Stop a unit that has not finished. Idempotent. */
  cancelWork(workId: string): Promise<boolean>;
}

/* -------------------------------------------------------- the review port */

/**
 * THE INDEPENDENT REVIEWER HARNESS, as the gauntlet uses it.
 *
 * A normal review is a single call through the reviewer slot and needs nothing
 * from this file. The gauntlet calls the SAME harness repeatedly — that is the
 * entire difference between a review and a gauntlet, and it is why the
 * reviewer must keep working with no gauntlet module loaded at all.
 */
export interface GauntletReviewPort {
  /**
   * Ask the Independent Reviewer Harness to review a subject.
   *
   * Returns the harness's own verdict shape reduced to what a stopping rule
   * needs: whether it cleared, and the findings it produced. The gauntlet
   * never interprets a finding's content — it counts blocking ones.
   */
  review(input: {
    readonly reviewId: string;
    readonly subjectId: string;
    readonly round: number;
  }): Promise<{
    readonly completed: boolean;
    readonly blockingFindings: number;
    readonly findingIds: readonly string[];
    readonly safeSummary: string;
  }>;
}

/* --------------------------------------------------------- the spend port */

/**
 * What a round cost, MEASURED.
 *
 * The stopping rules bound duration and spend, and bounding them against an
 * estimate would halt a gauntlet for money nobody spent. The caller reports
 * what actually happened; the gauntlet does not guess.
 */
export interface GauntletUsage {
  readonly durationMs: number;
  readonly usdMicros: number;
}

/* -------------------------------------------------------- ambient services */

export interface GauntletClock { now(): string; }
export interface GauntletIds { next(kind: string): string; }

/* ------------------------------------------------------------ the policy */

/**
 * THE BOUNDS A DEPLOYMENT PUTS ON ITERATIVE REVIEW.
 *
 * Supplied to the command rather than read from anywhere. When a C.A.R.D.
 * bounds iterative review, a composition root passes that bound in — which is
 * the allowed direction. The gauntlet does not read a C.A.R.D., does not know
 * what a C.A.R.D. is, and has no import that could tell it.
 */
export interface GauntletPolicy {
  /** Whether iterative review may run at all in this deployment. */
  readonly allowed: boolean;
  /** The most rounds permitted, whatever the command asked for. */
  readonly maxRounds: number;
  /** Whether activation needs a human approval first. */
  readonly requiresApproval: boolean;
}
