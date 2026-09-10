import type { JuliusContractReviewCharge } from './julius-task-contract';
import { JULIUS_COST_BASES } from './julius-cost-accounting';
import type{JuliusWorker,JuliusWorkerRegistry,JuliusWorkerRole}from'./julius-runtime';import{workerAllowedByCard,type JuliusCardPolicy}from'./julius-policy';
export const JULIUS_ERROR_CODES=['RATE_LIMIT','TIMEOUT','AUTH_CONFIGURATION','PROVIDER_UNAVAILABLE','INVALID_REQUEST','WORKER_EXECUTION_FAILURE','POLICY_DENIED','BUDGET_DENIED','CANCELLED']as const;export type JuliusErrorCode=typeof JULIUS_ERROR_CODES[number];
/**
 * THE CONNECTOR'S OWN CLASSIFICATION, NARROWED TO A MACHINE TOKEN.
 *
 * A `JuliusErrorCode` is deliberately coarse: nine codes have to cover every
 * provider, so `WORKER_EXECUTION_FAILURE` answers "a malformed plan", "a
 * refusal" and "a 500" identically. The first paid mission failed on exactly
 * that ambiguity — the durable record held `code` and nothing else, and the
 * run could not be diagnosed after its database was destroyed.
 *
 * The connector already knows the finer answer, so it is carried alongside the
 * code. NARROWING IS THE SAFETY PROPERTY, not a convention: anything that is
 * not a short lower-case token becomes `null`, so a provider exception
 * message, a URL or an `Authorization:` header cannot survive this function
 * even if a future adapter passes one by mistake. Redaction that depends on
 * the caller remembering to redact is not redaction.
 *
 * WHAT IT DOES NOT PROVE, written down because an earlier version of this
 * comment claimed it. The rule is exactly `[a-z]` followed by up to 63 of
 * `[a-z0-9_]`, so it refuses a space, a colon, a slash, a dot, a dash, every
 * upper-case letter, a leading digit and anything past 64 characters — every
 * PROVIDER key shape this runtime has seen. It is not a shape rule for
 * credentials in general, and the rig mints a counter-example itself: the
 * live workflow's database password is `openssl rand -hex 24`, and about three
 * in eight of those are all-lower-case hex beginning a–f, which is shaped like
 * a class and passes. That is not a live exposure — every value the three live
 * adapters pass is a literal or a member of the connector's closed
 * failure-class union — and it is one of the cases the workflow's
 * literal-VALUE scan already exists to catch, `$DB_PASSWORD` being in its
 * needle list. This function is the first layer, not the only one.
 */
export const safeFailureClass=(value:unknown):string|null=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value)?value:null;
/**
 * THE SAME NARROWING FOR REASON CODES, WHICH USE BOTH CONVENTIONS.
 *
 * A connector's failure class is lower-case by its own vocabulary, so
 * {@link safeFailureClass} keeps that alphabet strict. A reason code is not:
 * this runtime writes `UNRESOLVED_WORKER_ROLE` and `TASK_FAILED` beside
 * `repair_round_limit` in the same durable column. Narrowing reason codes with
 * the lower-case rule would silently replace every upper-case one with a
 * generic fallback — losing the specific cause from the one artifact built to
 * explain a paid failure — so the alphabet is widened here and nowhere else.
 */
export const safeReasonCode=(value:unknown):string|null=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)?value:null;
/**
 * THE CORROBORATING FACTS, NARROWED THE SAME WAY THE CLASS IS.
 *
 * A failure class says WHICH boundary broke. It cannot say the exit code, the
 * bytes seen against the ceiling, or how many verdict-bearing objects made a
 * text ambiguous — and an operator needs those to debug the class without
 * buying a second paid run. Attempt #2 had none of them.
 *
 * THE ALLOWLIST IS THE SAFETY PROPERTY. This does not sanitise what the caller
 * sent; it rebuilds the record from a fixed set of keys with a fixed type
 * each, so a key nobody listed here cannot reach the durable event however it
 * was passed, and a value of the wrong type becomes `null` rather than
 * travelling. Booleans must be booleans, counts must be finite non-negative
 * integers, and the three string fields must match a shape. Everything else is
 * dropped. `null` always means "not known", never zero: a reviewer that never
 * started has no exit code, and `0` would say it exited cleanly.
 *
 * TWO ROLES, ONE ALLOWLIST. The reviewer names why a review was unreadable;
 * the Prompt Architect names why a plan was refused. Paid attempt #3 proved the
 * second gap the same way attempt #2 proved the first: `plan_validation_failed`
 * alone could not say WHICH rule the plan broke. A field a role does not have
 * is `null` for that role, which is the honest answer and costs nothing.
 *
 * WHAT THE STRING FIELDS DO AND DO NOT PROVE. `transport` and `stage`
 * are closed vocabularies. `provider` and `failureShape` take the
 * {@link safeFailureClass} alphabet, which no provider key shape this runtime
 * has seen can pass. `servedModel` is the loose one by necessity — real model
 * ids carry dots and dashes (`grok-build-0.1`, `gpt-4o-2024-08-06`) — so it is
 * bounded to 48 characters AND refused outright when it looks like a
 * credential. That is two layers, not a proof: it is stated here rather than
 * assumed, and the value only ever originates from a provider's own `model`
 * field or an engine usage report, never from parsing an error string.
 */
const MODEL_TOKEN=/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const CREDENTIAL_SHAPED=/(^(sk|xai|ghp|gho|ghu|ghs|ghr|pk|api)[-_])|bearer|authorization|private[-_ ]?key|begin [a-z ]*private/i;
const safeToken=(value:unknown):string|null=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value)?value:null;
/**
 * A FLAG A ROLE DOES NOT HAVE IS NULL, NOT FALSE.
 *
 * One allowlist serves the reviewer and the Prompt Architect, and most flags
 * belong to one of them. Coercing an absent flag to `false` publishes a
 * measurement nobody took: every reviewer failure would have reported
 * `validation_passed=false`, which reads as "a plan was validated and
 * rejected" when no plan was validated at all. `true` and `false` still mean
 * exactly themselves, and only a genuinely boolean value produces either.
 */
const safeNullableBool=(value:unknown):boolean|null=>typeof value==='boolean'?value:null;
const safeCount=(value:unknown):number|null=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null;
/**
 * AN HTTP STATUS, AND ONLY THAT.
 *
 * Bounded to the real status range so no counter, byte size or timestamp can
 * arrive dressed as one, and `null` whenever a status was not read. Paid
 * attempt #4 recorded `review_authentication_failed` with no number, and that
 * one shape covers a dead key (401), a key without model access (403) and a
 * malformed request whose body merely says `api-key` (400) — three different
 * repairs an operator otherwise has to guess between.
 */
const safeHttpStatus=(value:unknown):number|null=>typeof value==='number'&&Number.isInteger(value)&&value>=100&&value<=599?value:null;
const safeExitCode=(value:unknown):number|null=>typeof value==='number'&&Number.isInteger(value)&&value>=-256&&value<=65535?value:null;
const safeModel=(value:unknown):string|null=>typeof value==='string'&&MODEL_TOKEN.test(value)&&!CREDENTIAL_SHAPED.test(value)?value:null;
const safeEnum=<T extends string>(value:unknown,allowed:readonly T[]):T|null=>typeof value==='string'&&(allowed as readonly string[]).includes(value)?value as T:null;
/**
 * A FIELD PATH THIS REPOSITORY WROTE, not a value a model produced.
 *
 * WHY IT ADMITS A PATH AND NOT ONLY A NAME. The first version took at most two
 * dotted segments, which the flat key lists (`objectiveSummary`,
 * `handoff.allowedFileScope`) fit exactly — and every deeper answer was dropped
 * to null on the way to the artifact. `plan.handoff.boundedTask` is three
 * segments; `plan.testPlan[1]` carries an index. So the rule that walks a plan
 * structurally had nowhere to report WHERE, and paid runs 34185920678 and
 * 34186711214 each recorded `plan_false_work_claim` with an empty
 * `validation_field`. Widening the grammar is what makes that column able to
 * hold the answer at all.
 *
 * IT IS STILL STRUCTURE, NOT PROSE. Every segment is an identifier or a decimal
 * index: no spaces, no punctuation a sentence needs, and a bounded total
 * length. `prompt-architect-plan.ts` sanitises each segment before it builds
 * the path, so a key a model invented arrives as `unnameable` rather than as
 * its own text; this is the second layer, and it refuses the whole value rather
 * than trimming it.
 */
const FIELD_PATH=/^[A-Za-z][A-Za-z0-9_]{0,31}(\.[A-Za-z][A-Za-z0-9_]{0,31}|\[(?:\d{1,3}|many)\])*$/;
const safeFieldName=(value:unknown):string|null=>typeof value==='string'&&value.length<=160&&FIELD_PATH.test(value)?value:null;
/** A provider response identifier: bounded, and refused when credential-shaped. */
const safeResponseId=(value:unknown):string|null=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)&&!CREDENTIAL_SHAPED.test(value)?value:null;
/**
 * AN INSTANT, AND NOTHING THAT MERELY CONTAINS ONE.
 *
 * `elapsedMs` alone cannot say WHEN an attempt ran, and a reader who wants the
 * start has to subtract it from the durable row's `occurred_at` — arithmetic
 * across two tables to recover a fact both ends of the attempt already knew.
 * Live Run 3's reviewer attempts recorded neither, because the success path
 * recorded nothing at all.
 *
 * The grammar is exactly the ISO-8601 UTC instant this runtime writes
 * (`new Date().toISOString()`), optionally with sub-second digits, and it is
 * parsed as well as matched so `2026-13-45T99:99:99Z` is refused rather than
 * stored. No offset form, no local time, no date alone: a second grammar is a
 * second thing to defend, and every producer here writes the same one.
 */
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const safeInstant=(value:unknown):string|null=>typeof value==='string'&&INSTANT.test(value)&&!Number.isNaN(Date.parse(value))?value:null;
/**
 * A DIGEST IN THIS REPOSITORY'S OWN FORM: `sha256:` and sixty-four lower-case
 * hex characters, which is what {@link juliusTaskContractBinding} produces.
 * Nothing else passes, so the column cannot come to hold a truncated digest, a
 * digest of a different algorithm, or a sentence about one.
 */
const safeDigest=(value:unknown):string|null=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value)?value:null;
export type JuliusSafeDiagnostics=Readonly<Record<string,string|number|boolean|null>>;
export const safeReviewDiagnostics=(value:unknown):JuliusSafeDiagnostics|null=>{
 if(value===null||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 return Object.freeze({
  stage:safeEnum(v.stage,['plan','build','repair:plan','repair:build'] as const),
  transport:safeEnum(v.transport,['local','remote','openai','hosted'] as const),
  provider:safeToken(v.provider),
  servedModel:safeModel(v.servedModel),
  processExitCode:safeExitCode(v.processExitCode),
  timedOut:safeNullableBool(v.timedOut),
  outputBytesObserved:safeCount(v.outputBytesObserved),
  outputByteLimit:safeCount(v.outputByteLimit),
  outputTruncated:safeNullableBool(v.outputTruncated),
  jsonDetected:safeNullableBool(v.jsonDetected),
  jsonParseable:safeNullableBool(v.jsonParseable),
  reviewObjectCount:safeCount(v.reviewObjectCount),
  verdictPresent:safeNullableBool(v.verdictPresent),
  verdictValid:safeNullableBool(v.verdictValid),
  summaryPresent:safeNullableBool(v.summaryPresent),
  failureShape:safeToken(v.failureShape),
  providerHttpStatus:safeHttpStatus(v.providerHttpStatus),
  serviceHttpStatus:safeHttpStatus(v.serviceHttpStatus),
  /* --- What the reviewer's PROCESS did. Null for a transport that ran none.
   *
   * Paid run 34311556047 failed three times with `timed_out=true`,
   * `output_bytes_observed=0` and no exit code — and that is also what the
   * local transport records for a provider that answered slowly, a connection
   * that was never made, a credential that was refused, and an engine retrying
   * in silence. The reviewer's one-shot mode prints its whole answer in a
   * single write at the end, so zero bytes is simply the state of every review
   * that has not finished yet. These columns are what let the next failure be
   * read instead of guessed. --- */
  processStarted:safeNullableBool(v.processStarted),
  processPidObserved:safeNullableBool(v.processPidObserved),
  firstOutputObserved:safeNullableBool(v.firstOutputObserved),
  /** Milliseconds to the first byte, or null when none ever arrived. */
  firstOutputAfterMs:safeCount(v.firstOutputAfterMs),
  elapsedMs:safeCount(v.elapsedMs),
  /** The window the attempt was given, so the guillotine is visible beside it. */
  timeoutMs:safeCount(v.timeoutMs),
  exitObserved:safeNullableBool(v.exitObserved),
  /**
   * A CLOSED SET, NOT A SIGNAL NAME A CALLER CHOSE.
   *
   * `safeToken` refuses it (upper case, and a comma), and that is the right
   * refusal: the only two answers this repository's reviewer path can produce
   * are "SIGTERM was enough" and "SIGTERM was not, so it was killed". A boolean
   * would collapse exactly the distinction worth recording.
   */
  signalSent:safeEnum(v.signalSent,['SIGTERM','SIGTERM,SIGKILL'] as const),
  /** Whether the child was CONFIRMED gone before the outcome was reported. */
  cleanupCompleted:safeNullableBool(v.cleanupCompleted),
  /**
   * Whether a request reached the provider — and only from a transport that
   * can SEE the request. The local path reads a pipe, not a socket, so it
   * always writes null here rather than inferring one.
   */
  providerRequestStarted:safeNullableBool(v.providerRequestStarted),
  /** Bytes of the rendered review packet. A size, never a quotation. */
  packetBytes:safeCount(v.packetBytes),
  /* --- Prompt Architect (plan stage). Null for the reviewer, and vice versa. */
  requestedModel:safeModel(v.requestedModel),
  responseId:safeResponseId(v.responseId),
  validationPassed:safeNullableBool(v.validationPassed),
  /** A member of the closed `ArchitectPlanReasonCode` union, never validator prose. */
  validationReasonCode:safeToken(v.validationReasonCode),
  validationField:safeFieldName(v.validationField),
  /**
   * WHICH FALSE-WORK PHRASE A REFUSED PLAN CARRIED, as a token from the
   * validator's own closed set (`files_were_edited`, `tests_were_run`,
   * `i_ran_the_tests`, `i_edited`). The path says WHERE and this says WHAT;
   * neither alone explained the two paid refusals that recorded only the code.
   * Null for every other rule and for every other role.
   */
  validationClaimPhrase:safeToken(v.validationClaimPhrase),
  /**
   * HOW MANY PROVIDER CALLS ONE ARCHITECT DISPATCH BOUGHT. A refused plan may
   * be corrected once, so a dispatch is no longer one call by definition — and
   * a retry the record could not show would be a spend nobody could account
   * for. Null for a role that makes no such attempt.
   */
  planAttempts:safeCount(v.planAttempts),
  /**
   * HOW MANY REVIEW CALLS ONE REVIEWER DISPATCH BOUGHT. A review that arrived
   * in the wrong shape is asked once more with the defect named, so a reviewer
   * dispatch is no longer one call by definition either. Null for a role that
   * makes no such attempt.
   */
  reviewAttempts:safeCount(v.reviewAttempts),
  /* --- Coding Agent (build stage). Null for the other two roles. --- */
  /** The runtime's own result subtype, e.g. `success` / `error_max_turns`. */
  resultSubtype:safeToken(v.resultSubtype),
  isError:safeNullableBool(v.isError),
  numTurns:safeCount(v.numTurns),
  toolUseCount:safeCount(v.toolUseCount),
  /** Denials the runtime itself recorded — evidence the envelope held. */
  permissionDenials:safeCount(v.permissionDenials),
  /** Whether an actionable implementation result existed at all. */
  implementationPresent:safeNullableBool(v.implementationPresent),
  /* --- Coding Agent cost, beside a refusal. Paid run 34037313976 was refused
   * for cost and the amount lived only in a message nothing persisted. --- */
  /** The runtime-reported cost in micro-dollars; null when the runtime reported none. */
  costUsdMicros:safeCount(v.costUsdMicros),
  /** The ceiling this dispatch was limited to, in micro-dollars. */
  costCeilingUsdMicros:safeCount(v.costCeilingUsdMicros),
  /** `runtime_reported` or `unavailable` — Unknown stays Unknown. */
  costSource:safeToken(v.costSource),
  /** Whether the provider runtime launched at all: the difference between spending nothing and spending an unknown amount. */
  runtimeStarted:safeNullableBool(v.runtimeStarted),
  /* ------------------------------------------- the attempt itself ----
   *
   * EVERY FIELD ABOVE DESCRIBES A FAILURE, and until Live Run 3 that was the
   * only kind of attempt this record had. `worker-diagnostics.tsv` came back
   * from a COMPLETED paid mission with zero rows: the coordinator flattened
   * diagnostics onto `task.failed` and `retry.scheduled` and onto nothing
   * else, so a reviewer that answered correctly left less behind than one that
   * timed out. There was no healthy row to read a pathological one against —
   * which is precisely what the timeout repair of run 34311556047 needed and
   * had to buy a paid run to get.
   *
   * These five are what a SUCCESSFUL attempt has to state on its own: that it
   * succeeded (rather than being a failure whose shape nobody classified),
   * when it started and ended, and which locked contract revision and binding
   * digest it ran under. The last two are also in `trajectory.tsv`, and having
   * them here is deliberate: a diagnostics row that has to be joined to prove
   * what it was bound to is a row that gets read without the join. --- */
  /**
   * HOW THE ATTEMPT ENDED, from a closed pair.
   *
   * `failureShape` is null on a success AND on a failure nobody could classify,
   * so its absence never meant "this went well". This says which, and it is the
   * one column a reader can filter on to compare healthy attempts with sick
   * ones.
   */
  outcome:safeEnum(v.outcome,['succeeded','failed'] as const),
  /** When the attempt began, as the transport observed it. */
  startedAt:safeInstant(v.startedAt),
  /** When it ended. `elapsedMs` is the difference and is recorded beside it. */
  completedAt:safeInstant(v.completedAt),
  /** The LOCKED revision this dispatch ran under, or null for an unbound role. */
  contractRevision:safeCount(v.contractRevision),
  /** The binding digest it ran under — the fact the whole contract stack exists to prove. */
  contractBindingDigest:safeDigest(v.contractBindingDigest),
  /* ------------------------------------------ what the attempt cost ----
   *
   * `costUsdMicros` above answers "how much" and cannot answer "how do you
   * know". Live Run 3 settled one component with a runtime-reported figure and
   * three with nothing at all, and the ledger had one column for both — so a
   * mission that cost at least $0.61 could be read as a mission that cost
   * exactly $0.61. `costSource` already carried the hosted runtime's own two
   * words (`runtime_reported` / `unavailable`); this is the cross-provider
   * vocabulary every role answers in. --- */
  /** `PROVIDER_REPORTED`, `MEASURED_FROM_USAGE`, `ESTIMATED` or `UNKNOWN`. Never absent. */
  costBasis:safeEnum(v.costBasis,JULIUS_COST_BASES),
  /**
   * A HARNESS'S OWN ARITHMETIC, KEPT APART FROM WHAT A PROVIDER BILLED.
   *
   * Hermes writes an `estimated_cost` to its usage file, computed from token
   * counts and its own price table. That is worth recording and is not a
   * billing figure, so it never lands in `costUsdMicros` — the two are
   * different claims and one column would make them the same one.
   */
  estimatedCostUsdMicros:safeCount(v.estimatedCostUsdMicros),
  /** Tokens the boundary reported, which is what a later price table would measure. */
  inputTokens:safeCount(v.inputTokens),
  outputTokens:safeCount(v.outputTokens),
  /* ------------------------------- why an answer stopped early ----
   *
   * Mission 4's first paid attempt bought 62 seconds of a reasoning model and
   * came back `incomplete`. `failureClass` said `incomplete_response`, which is
   * true and does not say what to change. These three do: what the reasoning
   * consumed, what ceiling it was consuming against, and the provider's own
   * one-word reason. Without them the durable record cannot distinguish a plan
   * that ran out of room from a plan the provider declined to finish. --- */
  /** Spent against the SAME ceiling as visible output on a reasoning model. */
  reasoningTokens:safeCount(v.reasoningTokens),
  /** The ceiling in force for that call, so the comparison is checkable. */
  maxOutputTokens:safeCount(v.maxOutputTokens),
  /** The provider's own machine token, e.g. `max_output_tokens`. */
  incompleteReason:safeReasonCode(v.incompleteReason),
  /** The provider's own `status` when it answered — `incomplete`, `failed`. */
  providerStatus:safeReasonCode(v.providerStatus),
  /** Reported by the boundary; `null` when it reported none. */
  totalTokens:safeCount(v.totalTokens),
 });
};
/**
 * THE DIAGNOSTICS AS FLAT FACTS, because an operational event's facts are flat
 * by contract — `Record<string,string|number|boolean|null>`.
 *
 * A nested object here does not survive: the runtime's `recordEvent` adapter
 * coerces any non-scalar with `String(value)`, so a diagnostics object reached
 * the durable row as the literal text `[object Object]` and every column the
 * artifact reads out of it was null. The telemetry looked present in unit tests
 * that inspected the payload directly and was destroyed on the only path that
 * matters. Flattening at the source is what makes the two agree.
 *
 * Keys are prefixed so they cannot collide with `code`, `failureClass`,
 * `errorRetryable` or `reasonCode`, and null-valued facts are kept: "not known
 * here" is an answer the artifact must be able to show.
 */
export const flattenDiagnostics=(value:JuliusSafeDiagnostics|null):Record<string,string|number|boolean|null>=>{
 if(value===null)return{};
 const out:Record<string,string|number|boolean|null>={};
 for(const[key,entry]of Object.entries(value))out[`diag_${key}`]=entry;
 return out;
};
export class JuliusDispatchError extends Error{
 readonly failureClass:string|null;
 /** Allowlisted structural facts, or null when the boundary reported none. */
 readonly diagnostics:JuliusSafeDiagnostics|null;
 constructor(readonly code:JuliusErrorCode,readonly retryable:boolean,readonly safeMessage:string,failureClass?:unknown,diagnostics?:unknown){super(code);this.failureClass=safeFailureClass(failureClass);this.diagnostics=diagnostics===undefined?null:safeReviewDiagnostics(diagnostics);}
}
/**
 * A WORKER MAY PROPOSE A CONTRACT REVISION, and `unknown` is the honest type.
 *
 * The value comes from a provider, so it is not typed, not trusted and not
 * necessarily an object. Julius sanitises it against an allowlist
 * (`sanitizeJuliusContractProposal`), refuses every mission-owned field
 * (`reviseJuliusTaskContract`) and refuses an incomplete result
 * (`validateJuliusTaskContract`) before any of it binds anyone. Optional, so a
 * worker that proposes nothing behaves exactly as before.
 */
export interface JuliusProviderResult{readonly workerId:string;readonly providerId:string;readonly status:'SUCCEEDED'|'FAILED';readonly safeSummary:string;readonly evidence:readonly unknown[];readonly usage:unknown;readonly contractProposal?:unknown;
/**
 * WHAT THE ATTEMPT OBSERVED ABOUT ITSELF, ON THE PATH THAT SUCCEEDED.
 *
 * {@link JuliusDispatchError} has carried diagnostics since paid run
 * 34311556047, so a reviewer that FAILED left a lifecycle behind and a
 * reviewer that ANSWERED left none: there was nowhere on this type to put
 * them. Live Run 3 completed and its `worker-diagnostics.tsv` was empty.
 *
 * `unknown` is the honest type for the same reason `usage` is: it comes from
 * an adapter, and Julius rebuilds it from {@link safeReviewDiagnostics}'s
 * allowlist before any of it reaches a durable row. Optional, so an adapter
 * that reports none behaves exactly as before — and gets no row, rather than
 * a row of nulls.
 */
readonly diagnostics?:unknown;}
/**
 * WHAT JULIUS TELLS AN ADAPTER, and nothing more.
 *
 * `taskType` is the canonical stage carrier: a reviewer reads `review:plan` or
 * `review:build` from it rather than parsing a task id. `allocation` is the
 * execution ceiling Julius has RESERVED for this dispatch — the adapter may
 * spend up to it and not past it, and an adapter given none keeps its own
 * conservative default. Both are additive: an adapter that ignores them
 * behaves exactly as before.
 */
export interface JuliusDispatchAllocation{readonly usdMicros:number;readonly policyVersion:string;readonly basis:string;}
/**
 * THE LOCKED TERMS THIS DISPATCH RUNS UNDER, computed by Julius and handed to
 * the adapter.
 *
 * The same inversion `taskType` uses: an adapter must not reach into the store
 * for the contract any more than it may parse a stage out of a task id. Julius
 * proved the lock at the gate and hands the charge down; a reviewer that could
 * look one up would be choosing what it is graded against. Optional, so an
 * unbound role and the older reviewer harness are unchanged.
 */
export interface JuliusDispatchInput{readonly taskId:string;readonly contextId:string;readonly taskType?:string;readonly allocation?:JuliusDispatchAllocation;readonly contract?:JuliusContractReviewCharge;readonly signal?:AbortSignal;}
export interface JuliusProviderAdapter{readonly adapterId:string;dispatch(input:JuliusDispatchInput):Promise<JuliusProviderResult>;}
export interface JuliusProviderHealth{readonly providerId:string;readonly state:'CLOSED'|'OPEN'|'HALF_OPEN';readonly consecutiveFailures:number;readonly openedAt:string|null;readonly active:number;readonly concurrencyLimit:number;}
export class JuliusProviderHealthRegistry{private readonly values=new Map<string,JuliusProviderHealth>();set(value:JuliusProviderHealth){this.values.set(value.providerId,structuredClone(value));}available(providerId:string){const value=this.values.get(providerId);return value===undefined||(value.state!=='OPEN'&&value.active<value.concurrencyLimit);}get(providerId:string){const value=this.values.get(providerId);return value?structuredClone(value):null;}}
export class JuliusProviderRouter{constructor(private readonly workers:JuliusWorkerRegistry,private readonly adapters:ReadonlyMap<string,JuliusProviderAdapter>,private readonly health:JuliusProviderHealthRegistry){}
 select(input:{role:JuliusWorkerRole;taskType:string;capability:string;policy:JuliusCardPolicy;excludedWorkerIds?:readonly string[]}):JuliusWorker{const candidates=this.workers.eligible(input.role,input.taskType,input.capability).filter(worker=>!input.excludedWorkerIds?.includes(worker.workerId)&&this.health.available(worker.providerId));let denied=false;for(const worker of candidates){const verdict=workerAllowedByCard(input.policy,worker,input.capability);if(verdict.effect==='DENY'){denied=true;continue;}if(this.adapters.has(worker.adapterId))return worker;}throw new JuliusDispatchError(denied?'POLICY_DENIED':'PROVIDER_UNAVAILABLE',false,denied?'C.A.R.D. denied all eligible routes.':'No healthy provider route is available.');}
 /**
  * WHICH WORKERS COULD TAKE THIS, in the router's own order.
  *
  * `select` answers "which one" and throws when none; a caller deciding
  * whether to REROUTE needs "how many are left" without taking one and
  * without catching. Read-only: it registers nothing, dispatches nothing and
  * applies exactly the same eligibility, health and C.A.R.D. filters `select`
  * does, so the two can never disagree about who is available.
  */
 eligibleWorkerIds(input:{role:JuliusWorkerRole;taskType:string;capability:string;policy:JuliusCardPolicy;excludedWorkerIds?:readonly string[]}):string[]{
  return this.workers.eligible(input.role,input.taskType,input.capability)
   .filter(worker=>!input.excludedWorkerIds?.includes(worker.workerId)
    &&this.health.available(worker.providerId)
    &&workerAllowedByCard(input.policy,worker,input.capability).effect!=='DENY'
    &&this.adapters.has(worker.adapterId))
   .map(worker=>worker.workerId);
 }
 /** The provider a worker belongs to, or null when the worker is unknown. */
 providerOf(workerId:string|null):string|null{
  if(workerId===null)return null;
  const worker=this.workers.get(workerId);
  return worker?worker.providerId:null;
 }
 async dispatch(worker:JuliusWorker,input:JuliusDispatchInput){const adapter=this.adapters.get(worker.adapterId);if(!adapter)throw new JuliusDispatchError('PROVIDER_UNAVAILABLE',false,'Worker adapter is unavailable.');try{return await adapter.dispatch(input);}catch(error){throw normalizeProviderError(error);}}
}
export function normalizeProviderError(error:unknown):JuliusDispatchError{if(error instanceof JuliusDispatchError)return error;const code=error!==null&&typeof error==='object'&&'code'in error?String((error as{code:unknown}).code).toUpperCase():'';if(code==='429'||code==='RATE_LIMIT')return new JuliusDispatchError('RATE_LIMIT',true,'Provider rate limit reached.');if(code==='ETIMEDOUT'||code==='TIMEOUT'||error instanceof DOMException&&error.name==='TimeoutError')return new JuliusDispatchError('TIMEOUT',true,'Provider timed out.');if(['401','403','AUTH','CONFIGURATION'].includes(code))return new JuliusDispatchError('AUTH_CONFIGURATION',false,'Provider authentication or configuration failed.');if(code==='ABORT_ERR')return new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');return new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Worker execution failed.');}
