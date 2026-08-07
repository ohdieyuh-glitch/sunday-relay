/**
 * SUNDAY RELAY — CRON LOOPS (barrel).
 *
 * The schedule stage CRON_LOOPS.md approved, in dependency order: expression
 * semantics, the timezone port, the occurrence evaluator, claim-before-effect,
 * the overlap and missed-run decisions, and the tick that composes them.
 * Every module here is PURE — the file-backed claim adapter lives in
 * `src/relay/persistence/`, the same split the Loop runtime already uses.
 */

export { cronMatches, parseCronExpression } from './cron-expression';
export type { CronField, CronParseResult, CronSchedule } from './cron-expression';

export { createIntlTimezonePort, canonicalIanaZone } from './timezone-port';
export type { CronLocalMinute, TimezonePort } from './timezone-port';

export { dueCronOccurrences, MAX_CRON_WINDOW_MINUTES } from './cron-occurrences';
export type {
  CronEvaluation, CronEvaluationInput, CronOccurrence, CronRefusalReason,
} from './cron-occurrences';

export { claimOccurrence } from './cron-claim';
export type {
  OccurrenceClaimOutcome, OccurrenceClaimPort, OccurrenceLockAnswer,
} from './cron-claim';

export { decideOverlap, RELAY_OVERLAP_POLICIES } from './cron-overlap';
export type { OverlapDecision, OverlapState, RelayOverlapPolicy } from './cron-overlap';

export {
  decideMissedRuns, RELAY_CRON_WORK_CLASSES, RELAY_MISSED_RUN_POLICIES,
} from './cron-missed';
export type {
  MissedRunDecision, MissedRunInput, RelayCronWorkClass, RelayMissedRunPolicy,
} from './cron-missed';

export {
  CRON_APPROVAL_SCOPES, RECURRING_SCOPES, authorizeScheduledOperation,
} from './cron-approvals';
export type {
  ApprovalDecision, ApprovalGrant, ApprovalRefusalReason, CronApprovalScope,
  DeploymentAuthority, OperationRequest,
} from './cron-approvals';

export {
  BREAKER_CONDITIONS, SECURITY_CLASS_CONDITIONS,
  evaluateCircuitBreakers, mayResumeAfterBreaker,
} from './cron-breakers';
export type {
  BreakerCondition, BreakerDisclosure, BreakerReading, BreakerSignals,
  BreakerVerdict, ResumeDecision,
} from './cron-breakers';

export { authorizeScheduledSpend, SPEND_WINDOWS } from './cron-budget';
export type {
  Micros, ScheduledSpendDecision, ScheduledSpendRequest, SpendRefusal,
  SpendRefusalReason, SpendWindow, WindowBudget,
} from './cron-budget';

export { governingVersionFor, planScheduleEdit } from './cron-versioning';
export type {
  CronContractVersion, ScheduleEditDecision, ScheduleEditInput,
  ScheduleEditPlan, ScheduleEditRefusal, VersionedRun,
} from './cron-versioning';

export { runCronTick } from './cron-tick';
export type {
  CronOccurrenceOutcome, CronRunCreationPort, CronTickInput,
  CronTickOccurrenceReport, CronTickReport,
} from './cron-tick';
