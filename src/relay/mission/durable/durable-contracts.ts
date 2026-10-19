/**
 * THE CANONICAL DURABLE MISSION RECORD — one versioned shape, written and
 * read identically by the browser application and by Node (CLI / bridge).
 *
 * WHY IT LIVES HERE AND NOT IN `src/relay/persistence`: the Node persistence
 * layer (journal + snapshots, ADR-016) may never be imported by the website —
 * a structural boundary test proves it. So the RECORD is domain vocabulary,
 * beside the mission wire contracts, and each surface supplies its own
 * storage adapter. The journal remains the Node authority; this record is the
 * portable operational state needed to resume a mission safely.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: credentials, provider tokens, raw
 * secret values, environment values, hidden reasoning, transcripts, or full
 * prompts. `redactDurableRecord` strips them at write time and
 * `durable-record.test.ts` proves nothing secret-shaped survives.
 *
 * LARGE EVIDENCE IS REFERENCED, NEVER COPIED: findings, repairs, capsules,
 * trace entries and cost receipts appear as identifier references. A
 * checkpoint stays small enough to write on every safe boundary.
 */

/* ----------------------------------------------------------- versioning */

export const DURABLE_MISSION_SCHEMA_V1 = 'relay-durable-mission.v1' as const;
/** The version this build WRITES. */
export const DURABLE_MISSION_SCHEMA_VERSION = DURABLE_MISSION_SCHEMA_V1;
/** Every version this build can READ (older ones migrate forward). */
export const SUPPORTED_DURABLE_SCHEMA_VERSIONS = [DURABLE_MISSION_SCHEMA_V1] as const;
export type DurableMissionSchemaVersion = (typeof SUPPORTED_DURABLE_SCHEMA_VERSIONS)[number];

/* --------------------------------------------------------- checkpoints */

/**
 * The SAFE BOUNDARIES at which a checkpoint may be written. This list is the
 * whole policy: anything not named here (a keystroke, an animation frame, a
 * terminal character) never triggers a mission checkpoint.
 */
export const DURABLE_CHECKPOINT_REASONS = [
  'mission_contract_accepted',
  'mission_execution_began',
  'handoff_completed',
  'bounded_task_completed',
  'command_result_recorded',
  'test_result_recorded',
  'reviewer_findings_recorded',
  'repair_requested',
  'mission_paused',
  'approval_requested',
  'approval_received',
  'budget_state_changed',
  'mission_terminal_state',
] as const;
export type DurableCheckpointReason = (typeof DURABLE_CHECKPOINT_REASONS)[number];

/* ------------------------------------------------------------- identity */

/** A role assignment. Runtime identity is REQUESTED vs ACTUAL, because after
    a restart the actual runtime is usually unknown — and unknown is a
    truthful value, never a claim that something reconnected. */
export interface DurableAgentAssignment {
  readonly role: 'prompt_architect' | 'coding_agent' | 'reviewer';
  readonly displayName: string;
  /** The runtime the mission asked for, e.g. 'Claude Code'. */
  readonly requestedRuntime: string;
  /** The runtime actually observed. `null` means unknown — never assume. */
  readonly actualRuntime: string | null;
  /** Reference to the environment record; never its variable values. */
  readonly environmentRef: string | null;
  /** Explicitly granted tool names — capability names only, never secrets. */
  readonly grantedTools: readonly string[];
}

/* --------------------------------------------------------- progress refs */

/** An action Relay attempted, with a CONFIRMED outcome or an explicitly
    unknown one. An unknown outcome is exactly what must never be replayed. */
export interface DurableActionRecord {
  /** Stable id — the same logical action always carries the same id, which
      is what makes replay detection possible after a restart. */
  readonly actionId: string;
  readonly kind: 'command' | 'test' | 'handoff' | 'review' | 'repair' | 'approval';
  /** Safe summary. Never a raw command line with arguments. */
  readonly summary: string;
  readonly startedAt: string;
  /** 'completed' / 'failed' are confirmed; 'unknown' means Relay cannot tell
      whether it finished, so recovery must ask rather than re-run. */
  readonly outcome: 'completed' | 'failed' | 'unknown';
  readonly completedAt: string | null;
}

export interface DurableEvidenceRefs {
  /** Files the agent REPORTED changing — claims, not verified truth. */
  readonly filesReportedChanged: readonly string[];
  /** Safe summaries of commands reported executed. */
  readonly commandsReported: readonly string[];
  readonly testStatus: 'passed' | 'failed' | 'not_run' | 'unknown';
  /** Identifier references into the ledger / capsules — never copies. */
  readonly evidenceRefs: readonly string[];
  readonly traceLedgerRefs: readonly string[];
  readonly executionCapsuleRefs: readonly string[];
  readonly findingRefs: readonly string[];
  readonly repairRefs: readonly string[];
  readonly handoffRefs: readonly string[];
  readonly approvalRefs: readonly string[];
}

/** Known usage/cost at the checkpoint. `null` is UNKNOWN and must stay
    unknown through recovery — a missing cost never becomes zero. */
export interface DurableUsageState {
  readonly costReceiptRefs: readonly string[];
  readonly knownCostMicros: string | null;
  readonly currency: string | null;
  readonly budgetStatus: string | null;
  /** Provenance of the usage figures carried alongside the mission. */
  readonly usageProvenance: 'live' | 'offline' | 'simulated' | null;
}

/* ------------------------------------------------------------- record */

export interface DurableMissionRecord {
  readonly schemaVersion: DurableMissionSchemaVersion;
  readonly missionId: string;
  readonly projectId: string;
  /** Reference + revision of the Mission Contract. The instructions
      themselves are NOT copied — they are read from the contract. */
  readonly missionContractRef: string;
  readonly missionContractRevision: string;
  readonly assignments: readonly DurableAgentAssignment[];
  /** Canonical mission state, from the mission machine — never invented. */
  readonly missionState: string;
  readonly stage: string;
  /** The bounded task in flight, if any. */
  readonly currentTaskRef: string | null;
  readonly lastCompletedAction: DurableActionRecord | null;
  /** The action Relay was in the middle of, if any. An entry here with an
      `unknown` outcome is what forces inspection instead of replay. */
  readonly inFlightAction: DurableActionRecord | null;
  readonly evidence: DurableEvidenceRefs;
  readonly usage: DurableUsageState;
  /** Why the mission stopped, in the user's words, when it stopped at all. */
  readonly interruptionReason: string | null;
  readonly provenance: 'live' | 'offline' | 'simulated';
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The safe boundary that produced this checkpoint. */
  readonly checkpointReason: DurableCheckpointReason;
  readonly checkpointAt: string;
  /**
   * Monotonic. Increments on every accepted resume, so a stale tab that
   * resumes an older generation is detected instead of duplicating work.
   */
  readonly recoveryGeneration: number;
  /** The session that currently claims this mission, with a lease expiry.
      The smallest reliable local ownership guard — not distributed locking. */
  readonly owner: DurableOwnerLease | null;
  /** sha-256 over every field above, sorted. Computed at write time. */
  readonly checksum: string;
}

export interface DurableOwnerLease {
  /** Identifies one browser tab / one CLI process. */
  readonly sessionId: string;
  readonly claimedAt: string;
  /** After this instant the lease is stale and another session may claim. */
  readonly expiresAt: string;
}

/** Everything except the checksum — what `sealDurableRecord` signs. */
export type DurableMissionRecordDraft = Omit<DurableMissionRecord, 'checksum'>;

/* ------------------------------------------------- recovery classification */

/**
 * How a discovered incomplete mission may be treated. Deliberately distinct
 * from the Node layer's `RECOVERY_PLAN_OUTCOMES`, which describe a supervised
 * RUN's next permitted actions; these describe what the CUSTOMER is offered.
 * `recoveryClassificationFrom` maps one to the other where they overlap.
 */
export const DURABLE_RECOVERY_CLASSIFICATIONS = [
  'ready_to_resume',
  'awaiting_approval',
  'paused',
  'execution_connection_lost',
  'environment_requires_inspection',
  'budget_blocked',
  'record_corrupt',
  'unsupported_record_version',
  'cannot_resume_safely',
  'completed',
] as const;
export type DurableRecoveryClassification = (typeof DURABLE_RECOVERY_CLASSIFICATIONS)[number];

/** The classifications that may offer a Resume control at all. */
export const RESUMABLE_CLASSIFICATIONS: readonly DurableRecoveryClassification[] = [
  'ready_to_resume',
  'paused',
];

/** Classifications that must stay visible until the user acts on them. */
export const BLOCKING_CLASSIFICATIONS: readonly DurableRecoveryClassification[] = [
  'record_corrupt',
  'unsupported_record_version',
  'cannot_resume_safely',
  'environment_requires_inspection',
  'budget_blocked',
];
