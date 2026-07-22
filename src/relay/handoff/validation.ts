import type { AgentHandoffPackage, RelayRun, RelayTask, TaskAssignment } from '../protocol/contracts';
import { checkAgentHandoffPackage } from '../protocol/contracts';
import { rejectHiddenReasoning } from '../protocol/validate';
import { validateHandoffFreshness } from '../coordination/checks';
import type { Enforcement } from '../protocol/enums';

/**
 * Handoff validation (Prompt 3, Section 12): every compiled package is
 * re-validated before dispatch eligibility. Structured result — rejected
 * packages never dispatch; staleness may checkpoint instead when policy
 * allows revalidation.
 */

export type HandoffValidationOutcome = 'valid' | 'rejected' | 'checkpoint_required';

export interface HandoffValidationResult {
  outcome: HandoffValidationOutcome;
  errors: string[];
  warnings: string[];
}

const CREDENTIAL_SHAPE = /\b(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bap]-[A-Za-z0-9-]+|Bearer\s+[A-Za-z0-9._-]{16,})\b/;

export interface ValidateHandoffInput {
  pkg: AgentHandoffPackage;
  run: RelayRun;
  task: RelayTask;
  assignment: TaskAssignment;
  currentLedgerVersion: number;
  currentBaseRevision?: string;
  now: string;
  /** When true, stale packages checkpoint for revalidation instead of rejecting. */
  staleRevalidatable?: boolean;
  /** Controls the package must carry with at least this enforcement. */
  requiredEnforcement?: ReadonlyArray<{ control: string; minimumLevel: Enforcement }>;
}

export function validateHandoffPackage(input: ValidateHandoffInput): HandoffValidationResult {
  const { pkg, run, task, assignment, currentLedgerVersion, currentBaseRevision, now, staleRevalidatable, requiredEnforcement = [] } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  let stale = false;

  errors.push(...checkAgentHandoffPackage(pkg, 'package'));
  errors.push(...rejectHiddenReasoning(pkg as unknown as Record<string, unknown>, 'package'));

  if (pkg.runId !== run.runId) errors.push('Package is bound to a different run.');
  if (pkg.projectId !== run.projectId) errors.push('Package is bound to a different project.');
  if (pkg.taskId !== task.taskId) errors.push('Package is bound to a different task.');
  if (pkg.targetAdapterId !== assignment.adapterId) errors.push('Package target does not match the task owner.');
  if (pkg.role !== assignment.role) errors.push('Package role does not match the assignment role.');

  const freshness = validateHandoffFreshness(pkg, { ledgerVersion: currentLedgerVersion, baseRevision: currentBaseRevision, now });
  if (freshness.status === 'stale_blocking' || freshness.status === 'stale_but_revalidatable') {
    stale = true;
    (staleRevalidatable ? warnings : errors).push(freshness.detail);
  } else if (freshness.status === 'invalid') {
    errors.push(freshness.detail);
  } else if (freshness.status === 'unavailable') {
    warnings.push(freshness.detail);
  }

  // Allowed vs protected conflict: an allowed file that falls under a
  // prohibited/protected pattern is a compilation defect.
  const protectedPatterns = pkg.prohibitedActions
    .filter((p) => p.value.startsWith('protected:'))
    .map((p) => p.value.slice('protected:'.length));
  for (const allowed of pkg.permittedFiles) {
    for (const pattern of protectedPatterns) {
      if (allowed.value === pattern || allowed.value.startsWith(`${pattern.replace(/\/\*\*$/, '')}/`)) {
        errors.push(`Allowed file \`${allowed.value}\` conflicts with protected path \`${pattern}\`.`);
      }
    }
  }

  for (const req of requiredEnforcement) {
    const order: Enforcement[] = ['unsupported', 'advisory', 'enforced'];
    const carried = [...pkg.permittedFiles, ...pkg.permittedTools, ...pkg.prohibitedActions]
      .filter((r) => r.value.includes(req.control))
      .map((r) => r.enforcement);
    const best = carried.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'unsupported';
    if (order.indexOf(best) < order.indexOf(req.minimumLevel)) {
      errors.push(`Required protection \`${req.control}\` is only ${best} (needs ${req.minimumLevel}).`);
    }
  }

  const serialized = JSON.stringify(pkg);
  if (CREDENTIAL_SHAPE.test(serialized)) errors.push('Package contains credential-shaped data.');

  const unbounded = pkg.budget.maxUsd === undefined && pkg.budget.maxTokens === undefined && pkg.budget.maxRuntimeMs === undefined;
  if (unbounded && pkg.stoppingCondition.maxRuntimeMs === undefined && !pkg.stoppingCondition.deadline) {
    errors.push('Package has no budget ceiling and no bounded stopping condition.');
  }

  if (errors.length > 0) return { outcome: 'rejected', errors, warnings };
  if (stale) return { outcome: 'checkpoint_required', errors, warnings };
  return { outcome: 'valid', errors, warnings };
}
