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
/**
 * WHAT A DISPATCH ROW IS. Nine writers share the kind, and they are not one fact:
 *   PROVIDER      a dispatch that reached a worker's provider: it names the provider.
 *   TOOL          an executor tool step (`julius-tool-settlement-postgres`): it names its
 *                 `toolId`, and its tokens and dollars are literal zeros, not a call's.
 *   REFUSAL       a governance refusal BEFORE any provider was called (held, denied, an
 *                 unlocked, mismatched or stale contract): one of the six outcomes below,
 *                 with no provider, no context and no measure at all.
 *   UNATTRIBUTED  anything else, e.g. a failure whose provider went unrecorded. It may
 *                 have been paid for, so every reader treats it as a provider attempt.
 * An eval that mixes them is measuring the wrong thing: tool steps of a few
 * milliseconds averaged with provider calls of a minute read a mission that ran
 * MORE tool steps as faster.
 */
export const JULIUS_PRE_PROVIDER_REFUSALS=['GOVERNANCE_HELD','APPROVAL_DENIED','POLICY_DENIED','CONTRACT_NOT_LOCKED','REVIEW_CONTRACT_MISMATCH','CONTRACT_STALE']as const;
export type JuliusDispatchRowClass='PROVIDER'|'TOOL'|'REFUSAL'|'UNATTRIBUTED';
export function juliusDispatchRowClass(event:JuliusTrajectoryEvent):JuliusDispatchRowClass{const toolId=event.safeFacts.toolId;if(typeof toolId==='string'&&toolId!=='')return'TOOL';if(event.providerId!==null)return'PROVIDER';if(event.outcome!==null&&(JULIUS_PRE_PROVIDER_REFUSALS as readonly string[]).includes(event.outcome)&&event.contextId===null&&event.durationMs===null&&event.usdMicros===null&&event.inputTokens===null&&event.outputTokens===null)return'REFUSAL';return'UNATTRIBUTED';}
/** A dispatch row that may have reached a provider: everything but a tool step or a pre-provider refusal. */
export const isJuliusProviderAttempt=(event:JuliusTrajectoryEvent):boolean=>{if(event.kind!=='DISPATCH')return false;const rowClass=juliusDispatchRowClass(event);return rowClass==='PROVIDER'||rowClass==='UNATTRIBUTED';};
export function validateTrajectoryEvent(value:JuliusTrajectoryEvent):void{if(!value.runtimeVersion.trim()||!value.policyVersion.trim()||!value.cardRevision.trim()||!value.idempotencyKey.trim())throw new Error('trajectory_versions_required');for(const field of['missionContractRevision','projectBrainRevision','durationMs','usdMicros','inputTokens','outputTokens']as const){const number=value[field];if(number!==null&&(!Number.isSafeInteger(number)||number<0))throw new Error(`invalid_trajectory_${field}`);}const serialized=JSON.stringify(value.safeFacts);if(/(?:api[_-]?key|token|secret)\s*[=:]/i.test(serialized))throw new Error('trajectory_secret_rejected');if(serialized.length>8192)throw new Error('trajectory_facts_too_large');}
