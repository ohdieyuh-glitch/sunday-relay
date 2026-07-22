import { RELAY_PROTOCOL_VERSION, checkProtocolVersion } from './version';
import { relayError, fail, ok, type RelayResult } from './errors';
import type {
  BlueprintId, CheckpointId, ClaimId, ContextVersion, EventId, LedgerVersion,
  PackageId, ProjectId, QuestionId, ReportId, RunId, SessionRefId, TaskId,
} from './ids';
import type { Classification, EventSource, Provenance, ReportType, Role } from './enums';
import {
  CLASSIFICATIONS, EVENT_SOURCES, PROVENANCES, REPORT_TYPES, REVIEW_VERDICTS, ROLES,
} from './enums';
import {
  arr, freeId, id, iso, isRecord, lit, metadata, num, objectOf,
  rejectHiddenReasoning, str, versionNum, type Check, type Shape,
} from './validate';
import { checkImportedBlueprintPayload, checkReviewFinding, checkRevisionContract, checkVerificationCheck } from './contracts';

/* ================================================================== */
/* Commands (PROTOCOL §1.1). Discriminated union keyed by commandType. */
/* dispatch-task / dispatch-revision / request-verification carry the  */
/* run-internal intents (EXECUTE_TASK / APPLY_REVISION / RUN_TESTS /   */
/* FINAL_VERIFY equivalents).                                          */
/* ================================================================== */

export const COMMAND_TYPES = [
  'create-project',
  'create-run',
  'submit-objective',
  'import-blueprint',
  'accept-blueprint',
  'compile-handoff',
  'dispatch-task',
  'submit-report',
  'request-verification',
  'dispatch-revision',
  'pause-run',
  'resume-run',
  'cancel-run',
  'respond-checkpoint',
  'answer-open-question',
  'set-budget',
  'assign-agent',
  'approve-completion',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface CommandEnvelope<T extends CommandType = CommandType> {
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  commandId: string;
  commandType: T;
  issuedAt: string;
  actor: { kind: 'user' | 'client' | 'system'; id: string };
  payload: Record<string, unknown>;
  provenance: Provenance;
  idempotencyKey?: string;
  correlationId?: string;
  expectedLedgerVersion?: LedgerVersion;
}

const budgetShape = objectOf({
  required: {},
  optional: {
    maxUsd: num({ min: 0 }),
    maxTokens: num({ int: true, min: 0 }),
    maxRuntimeMs: num({ int: true, min: 0 }),
    warningAtFraction: num({ min: 0 }),
    missingEstimate: lit('allow', 'checkpoint', 'deny'),
  },
});

/** Per-command payload shapes. Invalid combinations fail here (e.g.
 * dispatch-revision without a RevisionContract, dispatch-task without task
 * and package refs, request-verification without a policy, cancel-run
 * without a reason). */
const COMMAND_PAYLOADS: Record<CommandType, Check> = {
  'create-project': objectOf({
    required: { name: str({ max: 200 }), objective: str() },
    optional: {
      repository: objectOf({ required: { path: str(), defaultBranch: str() } }),
      constraints: arr(str()),
    },
  }),
  'create-run': objectOf({
    required: { projectId: id('prj'), objective: str() },
    optional: {
      mode: lit('guided'),
      budget: budgetShape,
      loopPolicy: objectOf({ required: { maxAutomaticRevisions: num({ int: true, min: 0 }) } }),
    },
  }),
  'submit-objective': objectOf({ required: { runId: id('run'), objective: str() } }),
  'import-blueprint': (v, f) => {
    const shape = objectOf({ required: { runId: id('run'), blueprint: (bv, bf) => checkImportedBlueprintPayload(bv, bf) } });
    return shape(v, f);
  },
  'accept-blueprint': objectOf({ required: { runId: id('run'), blueprintId: id('blu') } }),
  'compile-handoff': objectOf({ required: { runId: id('run'), taskId: id('tsk') } }),
  'dispatch-task': objectOf({
    required: { runId: id('run'), taskId: id('tsk'), packageId: id('pkg') },
  }),
  'submit-report': objectOf({ required: { runId: id('run'), reportId: id('rpt') } }),
  'request-verification': objectOf({
    required: { runId: id('run'), taskId: id('tsk'), policyId: id('pol'), scope: lit('initial', 'final') },
  }),
  'dispatch-revision': objectOf({
    required: { runId: id('run'), taskId: id('tsk'), revisionContract: checkRevisionContract },
  }),
  'pause-run': objectOf({ required: { runId: id('run') } }),
  'resume-run': objectOf({ required: { runId: id('run') } }),
  'cancel-run': objectOf({ required: { runId: id('run'), reason: str() } }),
  'respond-checkpoint': objectOf({
    required: { runId: id('run'), checkpointId: id('ckp'), response: lit('approve', 'reject') },
    optional: { note: str() },
  }),
  'answer-open-question': objectOf({ required: { questionId: id('oqn'), answer: str() } }),
  'set-budget': objectOf({ required: { runId: id('run'), budget: budgetShape } }),
  'assign-agent': objectOf({
    required: { runId: id('run'), role: lit(...ROLES), adapterId: str() },
    optional: { taskId: id('tsk') },
  }),
  'approve-completion': objectOf({ required: { runId: id('run') } }),
};

const commandEnvelopeShape: Shape = {
  required: {
    protocolVersion: str(),
    commandId: freeId(),
    commandType: lit(...COMMAND_TYPES),
    issuedAt: iso(),
    actor: objectOf({ required: { kind: lit('user', 'client', 'system'), id: str() } }),
    payload: metadata(),
    provenance: lit(...PROVENANCES),
  },
  optional: {
    idempotencyKey: freeId(),
    correlationId: freeId(),
    expectedLedgerVersion: versionNum(),
  },
};

export function parseCommand(value: unknown): RelayResult<CommandEnvelope> {
  if (!isRecord(value)) {
    return fail(relayError('invalid-command', 'Command must be an object.'));
  }
  const versionError = checkProtocolVersion(value.protocolVersion);
  if (versionError) return fail(versionError);
  const envelopeErrors = objectOf(commandEnvelopeShape)(value, 'command');
  if (envelopeErrors.length > 0) {
    return fail(relayError('invalid-command', 'Command envelope failed validation.', { details: envelopeErrors }));
  }
  const commandType = value.commandType as CommandType;
  const payloadErrors = COMMAND_PAYLOADS[commandType](value.payload, `command.payload<${commandType}>`);
  if (payloadErrors.length > 0) {
    return fail(relayError('invalid-command', `Payload for ${commandType} failed validation.`, { details: payloadErrors }));
  }
  return ok(value as unknown as CommandEnvelope);
}

/* ================================================================== */
/* Reports (PROTOCOL §1.3) — untrusted external input, always ingested */
/* as unverified claims. Reviewer/agent identity comes from the        */
/* envelope's adapter-assigned agentIdentity, never from payload text. */
/* ================================================================== */

export interface ReportEnvelope {
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  reportId: ReportId;
  projectId: ProjectId;
  runId: RunId;
  taskId?: TaskId;
  packageId?: PackageId;
  reportType: ReportType;
  agentIdentity: { adapterId: string; role: Role; displayName: string; sessionRef?: SessionRefId };
  provenance: Provenance;
  submittedAt: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  ledgerVersion?: LedgerVersion;
  contextVersion?: ContextVersion;
  usage?: { kind: 'estimated' | 'actual'; tokens?: number; usd?: number; runtimeMs?: number };
  notes?: string;
}

const claimedCommand = objectOf({
  required: { command: str(), status: lit('pass', 'fail') },
  optional: { outputExcerpt: str({ allowEmpty: true, max: 20000 }) },
});

const REPORT_PAYLOADS: Record<ReportType, Check> = {
  blueprint: (v, f) => checkImportedBlueprintPayload(v, f),
  implementation: objectOf({
    required: { summary: str(), changedFiles: arr(str()) },
    optional: {
      filesInspected: arr(str()),
      commandsClaimed: arr(claimedCommand),
      blockers: arr(str()),
      acceptanceCriteriaAddressed: arr(str()),
      notes: str(),
      metadata: metadata(),
    },
  }),
  review: (v, f) => {
    const shape = objectOf({
      required: { verdict: lit(...REVIEW_VERDICTS), findings: arr(checkReviewFinding) },
      optional: { metadata: metadata() },
    });
    const errors = shape(v, f);
    if (errors.length === 0 && isRecord(v) && v.verdict === 'changes_requested' && Array.isArray(v.findings) && v.findings.length === 0) {
      errors.push(`\`${f}.findings\` must list at least one finding when the verdict is changes_requested.`);
    }
    return errors;
  },
  repair: objectOf({
    required: {
      summary: str(),
      resolvedFindings: arr(objectOf({ required: { id: str(), resolution: str() } })),
      changedFiles: arr(str()),
    },
    optional: { metadata: metadata() },
  }),
  'verification-output': objectOf({
    required: { checks: arr(checkVerificationCheck, { minLen: 1 }), repoRevision: str() },
    optional: { environment: objectOf({ required: { os: str(), node: str(), cwd: str() } }) },
  }),
};

const reportEnvelopeShape: Shape = {
  required: {
    protocolVersion: str(),
    reportId: id('rpt'),
    projectId: id('prj'),
    runId: id('run'),
    reportType: lit(...REPORT_TYPES),
    agentIdentity: objectOf({
      required: { adapterId: str(), role: lit(...ROLES), displayName: str() },
      optional: { sessionRef: id('ses') },
    }),
    provenance: lit(...PROVENANCES),
    submittedAt: iso(),
    payload: metadata(),
  },
  optional: {
    taskId: id('tsk'),
    packageId: id('pkg'),
    correlationId: freeId(),
    ledgerVersion: versionNum(),
    contextVersion: versionNum(),
    usage: objectOf({
      required: { kind: lit('estimated', 'actual') },
      optional: { tokens: num({ min: 0 }), usd: num({ min: 0 }), runtimeMs: num({ min: 0 }) },
    }),
    notes: str(),
  },
};

export function parseReport(value: unknown): RelayResult<ReportEnvelope> {
  if (!isRecord(value)) return fail(relayError('invalid-report', 'Report must be an object.'));
  const versionError = checkProtocolVersion(value.protocolVersion);
  if (versionError) return fail(versionError);
  const errors = objectOf(reportEnvelopeShape)(value, 'report');
  if (errors.length > 0) {
    return fail(relayError('invalid-report', 'Report envelope failed validation.', { details: errors }));
  }
  const reportType = value.reportType as ReportType;
  // Blueprint reports are RUN-level (no task/package exists yet); every
  // other report type must bind to its task + handoff package.
  if (reportType !== 'blueprint' && (!value.taskId || !value.packageId)) {
    return fail(
      relayError('invalid-report', `${reportType} reports require taskId and packageId (the handoff being answered).`),
    );
  }
  const payloadErrors = [
    ...REPORT_PAYLOADS[reportType](value.payload, `report.payload<${reportType}>`),
    ...rejectHiddenReasoning(value.payload, `report.payload<${reportType}>`),
  ];
  if (payloadErrors.length > 0) {
    return fail(relayError('invalid-report', `Payload for ${reportType} failed validation.`, { details: payloadErrors }));
  }
  return ok(value as unknown as ReportEnvelope);
}

/* ================================================================== */
/* Events (PROTOCOL §1.2) — the only feed clients consume.             */
/* ================================================================== */

export const RELAY_EVENT_KINDS = [
  // run
  'run.created', 'run.validated', 'run.started', 'run.phase_changed',
  'run.paused', 'run.resumed', 'run.cancelled', 'run.completed',
  'run.failed', 'run.checkpoint_required', 'run.checkpoint_responded',
  // architect
  'architect.started', 'architect.blueprint_created', 'architect.blueprint_imported',
  'architect.blueprint_accepted', 'architect.revision_created', 'architect.failed',
  // handoff
  'handoff.created', 'handoff.validated', 'handoff.dispatched', 'handoff.received', 'handoff.failed',
  // agent
  'agent.session_started', 'agent.session_resumed', 'agent.report_created',
  'agent.blocked', 'agent.completed', 'agent.failed',
  // reviewer
  'reviewer.started', 'reviewer.verdict_created', 'reviewer.completed', 'reviewer.failed',
  // verification
  'verification.started', 'verification.check_passed', 'verification.check_failed', 'verification.completed',
  // ledger & coordination
  'ledger.event_appended', 'ledger.claim_recorded', 'ledger.claim_promoted', 'ledger.claim_rejected',
  'task.created', 'task.assigned', 'task.state_changed', 'task.ownership_changed', 'task.lease_expired',
  'file_claim.created', 'file_claim.released', 'file_claim.expired',
  // usage & policy
  'usage.updated', 'budget.warning', 'budget.exceeded', 'permission.denied', 'policy.checkpoint_required',
  // audit
  'audit.report_created',
] as const;
export type RelayEventKind = (typeof RELAY_EVENT_KINDS)[number];

export interface EventRefs {
  ledgerVersion?: LedgerVersion;
  contextVersion?: ContextVersion;
  packageId?: PackageId;
  blueprintId?: BlueprintId;
  reportId?: ReportId;
  claimId?: ClaimId;
  checkpointId?: CheckpointId;
  questionId?: QuestionId;
  evidenceIds?: string[];
}

export interface EventEnvelope {
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  eventId: EventId;
  /** Monotonic gap-free per-project sequence == ledger version at append. */
  sequence: number;
  at: string;
  projectId: ProjectId;
  runId?: RunId;
  taskId?: TaskId;
  source: EventSource;
  kind: RelayEventKind;
  provenance: Provenance;
  classification: Classification;
  /** Safe rendered summary — action/decision/artifact/result/blocker only.
   * Never hidden reasoning. */
  safeSummary: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  refs?: EventRefs;
}

/** An event draft: everything but eventId + sequence, which ONLY the
 * ledger assigns at append (PROTOCOL §1.2). */
export type EventDraft = Omit<EventEnvelope, 'eventId' | 'sequence'>;

const eventShape: Shape = {
  required: {
    protocolVersion: str(),
    eventId: id('evt'),
    sequence: num({ int: true, min: 1 }),
    at: iso(),
    projectId: id('prj'),
    source: lit(...EVENT_SOURCES),
    kind: lit(...RELAY_EVENT_KINDS),
    provenance: lit(...PROVENANCES),
    classification: lit(...CLASSIFICATIONS),
    safeSummary: str({ max: 2000 }),
    payload: metadata(),
  },
  optional: {
    runId: id('run'),
    taskId: id('tsk'),
    correlationId: freeId(),
    causationId: freeId(),
    refs: objectOf({
      required: {},
      optional: {
        ledgerVersion: versionNum(),
        contextVersion: versionNum(),
        packageId: id('pkg'),
        blueprintId: id('blu'),
        reportId: id('rpt'),
        claimId: id('clm'),
        checkpointId: id('ckp'),
        questionId: id('oqn'),
        evidenceIds: arr(str()),
      },
    }),
  },
};

export function parseEvent(value: unknown): RelayResult<EventEnvelope> {
  if (!isRecord(value)) return fail(relayError('invalid-event', 'Event must be an object.'));
  const versionError = checkProtocolVersion(value.protocolVersion);
  if (versionError) return fail(versionError);
  const errors = [
    ...objectOf(eventShape)(value, 'event'),
    ...rejectHiddenReasoning(value.payload, 'event.payload'),
  ];
  if (errors.length > 0) {
    return fail(relayError('invalid-event', 'Event envelope failed validation.', { details: errors }));
  }
  return ok(value as unknown as EventEnvelope);
}

/* ================================================================== */
/* Queries / read models (PROTOCOL §1.4)                               */
/* ================================================================== */

export const QUERY_TYPES = [
  'project-brain', 'run-status', 'task-detail', 'handoff-detail',
  'evidence-detail', 'event-feed', 'usage-summary', 'audit-report',
] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export interface QueryEnvelope {
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  queryId: string;
  queryType: QueryType;
  params: Record<string, unknown>;
}

export interface ReadModelEnvelope<T = unknown> {
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  queryId: string;
  readModelType: QueryType;
  asOfLedgerVersion: LedgerVersion;
  data: T;
}

export function parseQuery(value: unknown): RelayResult<QueryEnvelope> {
  if (!isRecord(value)) return fail(relayError('validation-failed', 'Query must be an object.'));
  const versionError = checkProtocolVersion(value.protocolVersion);
  if (versionError) return fail(versionError);
  const errors = objectOf({
    required: {
      protocolVersion: str(),
      queryId: freeId(),
      queryType: lit(...QUERY_TYPES),
      params: metadata(),
    },
  })(value, 'query');
  if (errors.length > 0) {
    return fail(relayError('validation-failed', 'Query envelope failed validation.', { details: errors }));
  }
  return ok(value as unknown as QueryEnvelope);
}
