import type { RelayResult } from '../protocol/errors';
import type { EventDraft, ReportEnvelope } from '../protocol/envelopes';
import type {
  AgentHandoffPackage, Blueprint, CompletionPolicy, EvidenceBundle, EvidenceRecord,
  RelayProject, RelayRun, RelayTask, RevisionContract, TaskAssignment, UsageRecord,
} from '../protocol/contracts';
import type { Enforcement, Provenance, Role } from '../protocol/enums';
import type { IdFactory, SessionRefId } from '../protocol/ids';

/**
 * Provider-neutral connector PORTS (ARCHITECTURE §7). Relay Core depends on
 * these interfaces only; simulation adapters implement them now, real local/
 * cloud adapters later — without changing Core workflow semantics. Adapters
 * hold no orchestration logic and no provider credentials.
 */

export interface AdapterDescriptor {
  adapterId: string;
  roles: Role[];
  displayName: string;
  /** What this adapter's outputs truthfully are. Simulation adapters MUST
   * declare 'simulated' and cannot emit anything else. */
  provenance: Provenance;
  /** Truthful enforcement declarations per control (Decision 5). */
  enforcement: Record<string, Enforcement>;
  /** Which policies this adapter merely SIMULATES vs actually enforces. */
  simulatedPolicies: string[];
}

export interface AdapterContext {
  ids: IdFactory;
  now: string;
  correlationId?: string;
}

export interface ArchitectRequest {
  project: RelayProject;
  run: RelayRun;
  objective: string;
  context: AdapterContext;
}

export interface ArchitectResult {
  blueprint: Blueprint;
  report: ReportEnvelope;
  usage: UsageRecord[];
  events: EventDraft[];
}

export interface ArchitectAdapterPort {
  descriptor: AdapterDescriptor;
  createBlueprint(request: ArchitectRequest): RelayResult<ArchitectResult>;
}

export interface CodingAgentDispatch {
  pkg: AgentHandoffPackage;
  task: RelayTask;
  assignment: TaskAssignment;
  /** Present on the single repair attempt — same session must resume. */
  revision?: RevisionContract;
  resumeSessionRef?: SessionRefId;
  context: AdapterContext;
}

export interface CodingAgentResult {
  report: ReportEnvelope;
  sessionRef: SessionRefId;
  usage: UsageRecord[];
  events: EventDraft[];
}

export interface CodingAgentAdapterPort {
  descriptor: AdapterDescriptor;
  execute(dispatch: CodingAgentDispatch): RelayResult<CodingAgentResult>;
}

export interface ReviewRequest {
  pkg: AgentHandoffPackage;
  task: RelayTask;
  reviewerAssignment: TaskAssignment;
  implementationReport: ReportEnvelope;
  evidence: EvidenceBundle | null;
  policy: CompletionPolicy;
  attempt: 1 | 2;
  context: AdapterContext;
}

export interface ReviewResult {
  report: ReportEnvelope;
  usage: UsageRecord[];
  events: EventDraft[];
}

export interface ReviewerAdapterPort {
  descriptor: AdapterDescriptor;
  review(request: ReviewRequest): RelayResult<ReviewResult>;
}

export interface VerificationRequest {
  task: RelayTask;
  run: RelayRun;
  policy: CompletionPolicy;
  baseRevision: string;
  attempt: 1 | 2;
  context: AdapterContext;
}

export interface VerificationResult {
  records: EvidenceRecord[];
  bundle: EvidenceBundle;
  usage: UsageRecord[];
  events: EventDraft[];
}

export interface VerificationAdapterPort {
  descriptor: AdapterDescriptor;
  verify(request: VerificationRequest): RelayResult<VerificationResult>;
}

export interface RelayAdapters {
  architect: ArchitectAdapterPort;
  codingAgent: CodingAgentAdapterPort;
  reviewer: ReviewerAdapterPort;
  verification: VerificationAdapterPort;
}
