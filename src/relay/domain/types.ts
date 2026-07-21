/**
 * Sunday Relay — domain types for the YC golden path.
 *
 * A mission is an event-sourced record: artifacts accumulate in golden-path
 * order and every stage is DERIVED from which artifacts exist (stages.ts).
 * Relay only ever generates briefs (documents) and validates ingested
 * artifacts — it never fabricates agent output. Reviewer/agent identity is
 * data carried by the artifact, never invented by the UI.
 */

export type IsoTimestamp = string;

export type RelayStageId =
  | 'mission'
  | 'handoff'
  | 'implementation'
  | 'review'
  | 'repair-task'
  | 'repair'
  | 'evidence'
  | 'verified';

export type RelayResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface LedgerEvent {
  at: IsoTimestamp;
  stage: RelayStageId;
  summary: string;
}

export type CommandStatus = 'pass' | 'fail';

/** One executed command with its honest outcome — used both for the
 * implementer's self-checks and for the final test-evidence artifact. */
export interface EvidenceEntry {
  command: string;
  status: CommandStatus;
  /** Output excerpt (tail is fine) — evidence, not decoration. */
  output: string;
}

export type FindingSeverity = 'critical' | 'major' | 'minor';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  recommendation?: string;
}

export type ReviewVerdict = 'approved' | 'changes-requested';

export type BriefKind = 'implementer-handoff' | 'review-brief' | 'repair-task';

/** A Relay-generated document (the only artifact kind Relay authors itself). */
export interface GeneratedBrief {
  kind: BriefKind;
  generatedAt: IsoTimestamp;
  markdown: string;
  /** repair-task only: the finding ids this task targets. */
  findingIds?: string[];
}

export interface ImplementationReport {
  receivedAt: IsoTimestamp;
  /** What actually ran, e.g. "Claude Code (Fable 5)". */
  agent: string;
  summary: string;
  changedFiles: string[];
  /** Implementer's own verification runs (optional self-checks). */
  commands?: EvidenceEntry[];
  notes?: string;
}

export interface ReviewReport {
  receivedAt: IsoTimestamp;
  /** What actually reviewed, e.g. "OpenAI Codex". */
  reviewer: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
}

export interface RepairResolution {
  /** Matches a ReviewFinding.id. */
  id: string;
  resolution: string;
}

export interface RepairReport {
  receivedAt: IsoTimestamp;
  agent: string;
  summary: string;
  resolvedFindings: RepairResolution[];
  changedFiles: string[];
}

export interface TestEvidence {
  receivedAt: IsoTimestamp;
  entries: EvidenceEntry[];
  note?: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** Snapshot of the gate at the moment the mission was marked verified.
 * Only ever stored with ok: true — the store refuses to record a failing gate. */
export interface VerificationRecord {
  at: IsoTimestamp;
  ok: true;
  checks: VerificationCheck[];
}

export interface RelayMission {
  id: string;
  createdAt: IsoTimestamp;
  title: string;
  objective: string;
  context?: string;
  constraints: string[];
  acceptanceCriteria: string[];
  /** true = pre-recorded demo mission; the UI badges it "Recorded". */
  recorded?: boolean;
  ledger: LedgerEvent[];
  handoff?: GeneratedBrief;
  implementationReport?: ImplementationReport;
  /** Optional convenience brief for the independent reviewer — does not gate
   * review ingestion (the reviewer may be briefed any way the operator likes). */
  reviewBrief?: GeneratedBrief;
  review?: ReviewReport;
  repairTask?: GeneratedBrief;
  repairReport?: RepairReport;
  evidence?: TestEvidence;
  verification?: VerificationRecord;
}
