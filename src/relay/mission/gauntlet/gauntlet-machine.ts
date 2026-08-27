/**
 * THE GAUNTLET LOOP — a USER-ACTIVATED review command, not a runtime.
 *
 * WHAT IT IS. `/gauntletloop` is a command a person types. It runs an
 * ITERATIVE REVIEW: the Independent Reviewer Harness reviews the work, its
 * findings drive a repair through the ordinary system boundaries, and the
 * reviewer looks again — repeating until it clears or a stopping rule ends it.
 *
 * WHAT IT IS NOT, and this is the correction this module exists to make. It is
 * not a Julius runtime, not a Julius subsystem, not a Julius execution mode,
 * not part of Julius Core, and not something Julius activates, owns state for,
 * or knows exists. An earlier version of this code lived inside
 * `mission/julius/` as `julius-gauntlet-runtime.ts`, with gauntlet tables
 * prefixed `julius_`, gauntlet event types inside the Julius operational
 * catalogue, a `gauntlet` field on the C.A.R.D. policy, a `GAUNTLET_ROUND`
 * trajectory kind and an `inspectGauntlet` method on the Julius execution API.
 * All of that was Julius knowing about a feature it must not know about.
 *
 * THE DEPENDENCY DIRECTION IS THE WHOLE POINT.
 *
 *     Gauntlet  ──uses──▶  generic Julius interfaces      ALLOWED
 *     Julius    ──uses──▶  Gauntlet                       FORBIDDEN
 *
 * This module imports the interfaces it needs FROM its own port file, which
 * declares them in gauntlet terms. Nothing under `mission/julius/**` imports
 * anything from here, and a test walks the Julius sources to prove it.
 *
 * ACTIVATION IS EXPLICIT AND IS THE ONLY WAY IN. A mission starting, a
 * reviewer being called, a verification failing, a coding agent finishing, a
 * run resuming or a server restarting must never activate a gauntlet. Those
 * events may participate in one that is ALREADY active; none of them starts
 * one. `activateGauntlet` is the single entry point and it takes an explicit
 * command from a named actor.
 *
 * THE INDEPENDENT REVIEWER DOES NOT REQUIRE THIS. A normal review is a single
 * review through the reviewer slot and needs nothing here. The gauntlet simply
 * USES the same Independent Reviewer Harness, repeatedly, when a person asks.
 *
 * PURE DOMAIN. No Node, no network, no clock.
 */

/* ------------------------------------------------- the iteration machine */

/**
 * The stopping rules, unchanged from the state machine this replaces.
 *
 * Kept byte-identical in behaviour on purpose: the founder's instruction was
 * to restore the architectural boundary, not to redesign working stopping
 * rules. Round limit, retry limit, duration ceiling, spend ceiling,
 * cancellation and stale-writer refusal all behave exactly as before — they
 * simply no longer live inside Julius.
 */
export type GauntletState='READY'|'RUNNING'|'VERIFYING'|'REPAIRING'|'CLEARED'|'HALTED'|'CANCELLED';export interface GauntletLimits{readonly maxRounds:number;readonly maxRetries:number;readonly maxDurationMs:number;readonly maxUsdMicros:number;}export interface GauntletRun{readonly gauntletId:string;readonly runId:string;readonly taskId:string;readonly limits:GauntletLimits;state:GauntletState;round:number;retries:number;usedDurationMs:number;usedUsdMicros:number;haltReason:string|null;version:number;}
export function advanceGauntlet(run:GauntletRun,input:{expectedVersion:number;action:'START'|'VERIFY_PASS'|'VERIFY_FAIL'|'REPAIR_COMPLETE'|'CANCEL';durationMs:number;usdMicros:number}):GauntletRun{if(run.version!==input.expectedVersion)throw new Error('stale_gauntlet_version');if(['CLEARED','HALTED','CANCELLED'].includes(run.state))return structuredClone(run);for(const value of[input.durationMs,input.usdMicros])if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid_gauntlet_usage');const next=structuredClone(run);next.usedDurationMs+=input.durationMs;next.usedUsdMicros+=input.usdMicros;next.version++;
 if(input.action==='CANCEL'){next.state='CANCELLED';next.haltReason='cancelled';return next;}if(next.usedDurationMs>next.limits.maxDurationMs||next.usedUsdMicros>next.limits.maxUsdMicros){next.state='HALTED';next.haltReason=next.usedDurationMs>next.limits.maxDurationMs?'duration_limit':'budget_limit';return next;}
 if(input.action==='START'&&next.state==='READY'){if(next.round>=next.limits.maxRounds){next.state='HALTED';next.haltReason='round_limit';}else{next.round++;next.state='RUNNING';}return next;}if(input.action==='VERIFY_PASS'&&['RUNNING','VERIFYING'].includes(next.state)){next.state='CLEARED';return next;}if(input.action==='VERIFY_FAIL'&&['RUNNING','VERIFYING'].includes(next.state)){if(next.retries>=next.limits.maxRetries){next.state='HALTED';next.haltReason='retry_limit';}else{next.retries++;next.state='REPAIRING';}return next;}if(input.action==='REPAIR_COMPLETE'&&next.state==='REPAIRING'){next.state='READY';return next;}throw new Error(`invalid_gauntlet_transition:${run.state}:${input.action}`);}
