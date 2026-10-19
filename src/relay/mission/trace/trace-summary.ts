/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * The derived `AqualaTrace` summary shape (PURE types).
 *
 * A read model over the ledger — never a second source of truth. Two things
 * it deliberately refuses to do:
 *
 *   - infer. Execution completion is not outcome satisfaction, reviewer
 *     process completion is not verification, verification is not release,
 *     and a requested agent is not an actual agent;
 *   - guess numbers. Every cost field stays `null` and the economics status
 *     stays `not_available` until a trusted economics adapter supplies real
 *     receipts (Milestone 5). Absent cost NEVER becomes zero.
 */

import type {
  AqualaExecutionStatus,
  AqualaMissionOutcomeStatus,
  AqualaReleaseStatus,
  AqualaVerificationStatus,
} from '../status/status-model';
import type { AqualaTraceIntegrityReport } from './trace-integrity';
import type {
  AqualaTraceEventFamily,
  AqualaTraceLifecycleStatus,
  AqualaTraceSchemaVersion,
  AqualaTraceSourceProduct,
} from './trace-types';

export const AQUALA_ECONOMICS_STATUSES = ['not_available', 'partial', 'complete'] as const;
export type AqualaEconomicsStatus = (typeof AQUALA_ECONOMICS_STATUSES)[number];

/** Requested vs actual identity, carried through reconstruction unchanged. */
export interface AqualaTraceIdentitySummary {
  readonly capsuleId: string;
  readonly requestedAgentId?: string;
  /** Present ONLY when a launch was verified. */
  readonly actualAgentId?: string;
  /** What was observed, including an unauthorized substitution. */
  readonly observedAgentId?: string;
  readonly launchVerified: boolean;
  readonly fallbackOccurred: boolean;
  readonly fallbackAuthorized: boolean;
}

export interface AqualaTrace {
  readonly traceId: string;
  readonly schemaVersion: AqualaTraceSchemaVersion;

  readonly projectId: string;
  readonly missionId?: string;
  readonly taskId?: string;

  readonly sourceProducts: readonly AqualaTraceSourceProduct[];

  readonly request: {
    readonly userIntent?: string;
    readonly objectiveReference?: string;
    readonly issuedAt?: string;
  };

  readonly context: {
    readonly projectBrainRevision?: number;
    readonly missionRevision?: number;
    readonly taskRevision?: number;
    readonly handoffCompilerVersion?: string;
  };

  readonly routing: {
    readonly selectedModels: readonly string[];
    readonly selectedAgents: readonly string[];
    readonly selectedTools: readonly string[];
    readonly rationaleReferences: readonly string[];
  };

  readonly policy: {
    readonly policyPackVersion?: string;
    readonly passportIds: readonly string[];
    readonly approvalIds: readonly string[];
  };

  readonly execution: {
    readonly capsuleIds: readonly string[];
    readonly runIds: readonly string[];
    readonly workspaceIds: readonly string[];
    readonly commandIds: readonly string[];
    readonly identities: readonly AqualaTraceIdentitySummary[];
  };

  readonly verification: {
    readonly reviewIds: readonly string[];
    readonly findingIds: readonly string[];
    readonly repairIds: readonly string[];
    readonly evidenceIds: readonly string[];

    readonly executionStatus: AqualaExecutionStatus;
    readonly outcomeStatus: AqualaMissionOutcomeStatus;
    readonly verificationStatus: AqualaVerificationStatus;
    readonly releaseStatus: AqualaReleaseStatus;
  };

  readonly economics: {
    readonly costReceiptIds: readonly string[];
    readonly directModelCostUsd: number | null;
    readonly agentExecutionCostUsd: number | null;
    readonly reviewCostUsd: number | null;
    readonly repairCostUsd: number | null;
    readonly retryCostUsd: number | null;
    readonly totalCostUsd: number | null;
    readonly runtimeMs: number | null;
    readonly status: AqualaEconomicsStatus;
  };

  readonly eventCountsByFamily: Readonly<Partial<Record<AqualaTraceEventFamily, number>>>;
  readonly eventCount: number;
  readonly firstEventAt?: string;
  readonly lastEventAt?: string;

  readonly integrity: AqualaTraceIntegrityReport;

  readonly lifecycleStatus: AqualaTraceLifecycleStatus;

  readonly createdAt: string;
  readonly completedAt?: string;
  readonly sealedAt?: string;
}
