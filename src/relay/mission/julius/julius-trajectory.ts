/**
 * NO GAUNTLET KIND. `GAUNTLET_ROUND` was here and is not, because a
 * user-activated review command is not something Julius's own trajectory
 * should be able to name. The Gauntlet Loop records its own rounds on its own
 * side of the boundary, in `src/relay/mission/gauntlet/**`.
 */
export const JULIUS_TRAJECTORY_KINDS=['TASK_TOPOLOGY','WORKER_SELECTED','PROVIDER_SELECTED','CONTEXT_COMPILED','DISPATCH','RETRY','FALLBACK','SUBAGENT','FINDING','REPAIR','VERIFICATION','RECOVERY','COMPLETION']as const;export type JuliusTrajectoryKind=typeof JULIUS_TRAJECTORY_KINDS[number];
export interface JuliusTrajectoryEvent{readonly trajectoryEventId:string;readonly runId:string;readonly projectId:string;readonly kind:JuliusTrajectoryKind;readonly taskId:string|null;readonly workerId:string|null;readonly providerId:string|null;readonly contextId:string|null;readonly runtimeVersion:string;readonly policyVersion:string;readonly cardRevision:string;readonly missionContractRevision:number;readonly projectBrainRevision:number;readonly durationMs:number|null;readonly usdMicros:number|null;readonly inputTokens:number|null;readonly outputTokens:number|null;readonly outcome:string|null;readonly safeFacts:Readonly<Record<string,string|number|boolean|null>>;readonly idempotencyKey:string;readonly occurredAt:string;}
/**
 * AN EVAL SUMMARY THAT CANNOT REPORT A FLOOR AS A TOTAL.
 *
 * `totalUsdMicros` used to be the sum of every dispatch that reported a cost,
 * and the ones that reported none were simply dropped. Live Run 3 is what that
 * looks like in practice: its Coding Agent reported $0.608861 and its Prompt
 * Architect and both Independent Reviewer calls reported nothing, so a summary
 * over that run would publish `totalUsdMicros: 608861` and a cost per verified
 * completion derived from it — three unmeasured components rendered as free.
 *
 * `knownUsdMicros` says what it is. `unknownCostComponents` counts the
 * dispatches that could not contribute, and `costComplete` is the one boolean a
 * reader has to check before quoting either number.
 */
export interface JuliusEvalSummary{readonly runtimeVersion:string;readonly runs:number;readonly verifiedCompletions:number;readonly verifiedCompletionRate:number;
/** The sum of the dispatches that reported a cost. A FLOOR whenever `costComplete` is false. */
readonly knownUsdMicros:number;
/** DISPATCHES that reported no cost. Not zero-cost dispatches — unmeasured ones. */
readonly unknownCostComponents:number;
/** True only when every dispatch in the window reported a cost. */
readonly costComplete:boolean;
/** Known cost over verified completions. `null` when nothing completed, and a floor when the cost is incomplete. */
readonly knownCostPerVerifiedCompletion:number|null;
readonly averageDurationMs:number|null;readonly retries:number;readonly fallbacks:number;readonly repairs:number;readonly recoveries:number;}
export function validateTrajectoryEvent(value:JuliusTrajectoryEvent):void{if(!value.runtimeVersion.trim()||!value.policyVersion.trim()||!value.cardRevision.trim()||!value.idempotencyKey.trim())throw new Error('trajectory_versions_required');for(const field of['missionContractRevision','projectBrainRevision','durationMs','usdMicros','inputTokens','outputTokens']as const){const number=value[field];if(number!==null&&(!Number.isSafeInteger(number)||number<0))throw new Error(`invalid_trajectory_${field}`);}const serialized=JSON.stringify(value.safeFacts);if(/(?:api[_-]?key|token|secret)\s*[=:]/i.test(serialized))throw new Error('trajectory_secret_rejected');if(serialized.length>8192)throw new Error('trajectory_facts_too_large');}
