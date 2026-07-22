import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type {
  AgentHandoffPackage, BudgetPolicy, HandoffCompilationRecord, RelayTask,
  ReviewerVerdictRecord, RevisionContract, StoppingCondition,
} from '../protocol/contracts';
import type { ContextVersion, EvidenceId, IdempotencyKey, IdFactory, LedgerVersion } from '../protocol/ids';
import type { Provenance } from '../protocol/enums';
import type { AutomaticRepairDecision } from '../recovery/repair';
import { COMPILER_VERSION } from './compiler';

/**
 * RevisionContract compilation (Prompt 3, Section 17 / PROTOCOL §4.4).
 * Compiles the ONE narrow repair — never broadens the objective, never
 * expands file claims, never authorizes deployment or a second repair.
 * Only an `allowed` AutomaticRepairDecision can compile.
 */

export interface CompileRevisionInput {
  task: RelayTask;
  parentPackage: AgentHandoffPackage;
  verdict: ReviewerVerdictRecord;
  decision: AutomaticRepairDecision;
  failureEvidenceRefs: EvidenceId[];
  requiredCorrection: string;
  behaviorToPreserve: string[];
  verificationToRerun: string[];
  budgetRemaining: BudgetPolicy;
  stoppingCondition: StoppingCondition;
  ledgerVersion: LedgerVersion;
  contextVersion: ContextVersion;
  baseRevision: string;
  provenance: Provenance;
  ids: IdFactory;
  now: string;
  idempotencyKey: string;
  correlationId?: string;
  expiresAt?: string;
  priorRevisions?: ReadonlyArray<{ contract: RevisionContract; record: HandoffCompilationRecord }>;
}

export function compileRevisionContract(
  input: CompileRevisionInput,
): RelayResult<{ contract: RevisionContract; record: HandoffCompilationRecord; idempotent: boolean }> {
  const { task, parentPackage, verdict, decision, failureEvidenceRefs, ids, now, idempotencyKey } = input;

  const prior = input.priorRevisions?.find((p) => p.contract.idempotencyKey === idempotencyKey);
  if (prior) return ok({ contract: prior.contract, record: prior.record, idempotent: true });

  if (decision.outcome !== 'allowed') {
    return fail(
      relayError('checkpoint-required', `Repair decision is ${decision.outcome} — a RevisionContract only compiles when allowed.`, {
        entityIds: { taskId: task.taskId },
      }),
    );
  }
  if (failureEvidenceRefs.length === 0) {
    return fail(relayError('evidence-required', 'A revision requires failure evidence references.', { entityIds: { taskId: task.taskId } }));
  }
  const blockingFindings = verdict.findings.map((f) => f.id);
  if (blockingFindings.length === 0) {
    return fail(relayError('evidence-required', 'A revision requires blocking reviewer findings.', { entityIds: { taskId: task.taskId } }));
  }
  if (parentPackage.taskId !== task.taskId) {
    return fail(relayError('validation-failed', 'Parent package belongs to a different task — task identity is never reset.', { entityIds: { taskId: task.taskId } }));
  }

  // Narrowness guarantees: files ⊆ existing claims; protected paths carried
  // forward verbatim; no new permissions appear anywhere on the contract.
  const allowedFiles = [...task.claimedFiles];
  const protectedPaths = parentPackage.prohibitedActions
    .filter((p) => p.value.startsWith('protected:'))
    .map((p) => p.value);

  const contract: RevisionContract = {
    packageId: ids.next('pkg'),
    parentPackageId: parentPackage.packageId,
    findingsTargeted: blockingFindings,
    narrowScope: { sameTask: true, sameFiles: true, sameAssignment: true },
    conditionsChecked: decision.conditions.map(({ condition, satisfied }) => ({ condition, satisfied })),
    taskId: task.taskId,
    failureEvidenceRefs,
    requiredCorrection: input.requiredCorrection,
    behaviorToPreserve: input.behaviorToPreserve,
    allowedFiles,
    protectedPaths,
    verificationToRerun: input.verificationToRerun,
    budgetRemaining: input.budgetRemaining,
    stoppingCondition: input.stoppingCondition,
    ledgerVersion: input.ledgerVersion,
    contextVersion: input.contextVersion,
    baseRevision: input.baseRevision,
    provenance: input.provenance,
    expiresAt: input.expiresAt,
    correlationId: input.correlationId,
    idempotencyKey: idempotencyKey as IdempotencyKey,
  };

  const record: HandoffCompilationRecord = {
    recordId: ids.next('hcr'),
    packageId: contract.packageId,
    compiledAt: now,
    ledgerVersion: input.ledgerVersion,
    contextVersion: input.contextVersion,
    inputRefs: [
      `parent:${parentPackage.packageId}`,
      ...blockingFindings.map((f) => `finding:${f}`),
      ...failureEvidenceRefs.map((e) => `evidence:${e}`),
    ],
    compilerVersion: `${COMPILER_VERSION}#revision`,
  };

  return ok({ contract, record, idempotent: false });
}
