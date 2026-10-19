/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Deterministic IN-MEMORY capsule repository — clearly labeled: this is the
 * milestone's test/development persistence boundary, NOT a database and NOT
 * production persistence. Durable capsule storage arrives with the Aquala
 * Trace ledger (Milestone 4) and the production persistence work that follows.
 *
 * Guarantees enforced here:
 *   - one capsule per run: capsule ids AND run ids are unique;
 *   - records are replaced only through validated service operations, and the
 *     replacement must be the same capsule, same run, with immutable binding
 *     fields intact — there is no arbitrary mutation API and no deletion API;
 *   - every returned record is a DEEP-FROZEN clone, so stored state can never
 *     be mutated through a returned reference (including nested arrays);
 *   - terminal capsules remain inspectable forever;
 *   - a rejected update leaves the stored capsule byte-for-byte unchanged.
 */

import { capsuleError, capsuleFail, capsuleOk, type CapsuleResult } from './capsule-errors';
import type { RelayAgentExecutionCapsule } from './capsule-types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const frozenClone = <T>(value: T): T => deepFreeze(deepClone(value));

export class InMemoryExecutionCapsuleRepository {
  private readonly capsules = new Map<string, RelayAgentExecutionCapsule>();
  private readonly capsuleIdByRunId = new Map<string, string>();

  create(capsule: RelayAgentExecutionCapsule): CapsuleResult<RelayAgentExecutionCapsule> {
    if (this.capsules.has(capsule.capsuleId)) {
      return capsuleFail(
        capsuleError(
          'DUPLICATE_CAPSULE_ID',
          `capsule ${capsule.capsuleId} already exists — capsule ids are unique`,
          'inspect the existing capsule, or prepare the run under a fresh capsule id',
          { capsuleId: capsule.capsuleId, runId: capsule.runId, field: 'capsuleId' },
        ),
      );
    }
    const existingForRun = this.capsuleIdByRunId.get(capsule.runId);
    if (existingForRun) {
      return capsuleFail(
        capsuleError(
          'DUPLICATE_RUN_ID',
          `run ${capsule.runId} already has capsule ${existingForRun} — one capsule per run`,
          'inspect the existing capsule, or create a NEW run for the retry/reassignment',
          { capsuleId: capsule.capsuleId, runId: capsule.runId, field: 'runId', actual: existingForRun },
        ),
      );
    }
    this.capsules.set(capsule.capsuleId, deepClone(capsule));
    this.capsuleIdByRunId.set(capsule.runId, capsule.capsuleId);
    return capsuleOk(frozenClone(capsule));
  }

  get(capsuleId: string): RelayAgentExecutionCapsule | null {
    const stored = this.capsules.get(capsuleId);
    return stored ? frozenClone(stored) : null;
  }

  getByRunId(runId: string): RelayAgentExecutionCapsule | null {
    const capsuleId = this.capsuleIdByRunId.get(runId);
    return capsuleId ? this.get(capsuleId) : null;
  }

  listByMission(missionId: string): RelayAgentExecutionCapsule[] {
    return [...this.capsules.values()]
      .filter((capsule) => capsule.missionId === missionId)
      .map((capsule) => frozenClone(capsule));
  }

  listByTask(taskId: string): RelayAgentExecutionCapsule[] {
    return [...this.capsules.values()]
      .filter((capsule) => capsule.taskId === taskId)
      .map((capsule) => frozenClone(capsule));
  }

  /**
   * Replaces a stored capsule with the result of a validated service
   * operation. The replacement must describe the SAME run and must not have
   * altered any binding fixed at preparation — identity of the record itself
   * is not negotiable here, only its lifecycle state.
   */
  replace(next: RelayAgentExecutionCapsule): CapsuleResult<RelayAgentExecutionCapsule> {
    const stored = this.capsules.get(next.capsuleId);
    if (!stored) {
      return capsuleFail(
        capsuleError(
          'CAPSULE_NOT_FOUND',
          `capsule ${next.capsuleId} does not exist`,
          'prepare the capsule before updating it',
          { capsuleId: next.capsuleId, runId: next.runId },
        ),
      );
    }
    if (stored.runId !== next.runId) {
      return capsuleFail(
        capsuleError(
          'DUPLICATE_RUN_ID',
          'a capsule cannot be re-pointed at a different run',
          'create a new capsule for the new run',
          {
            capsuleId: next.capsuleId,
            field: 'runId',
            expected: stored.runId,
            actual: next.runId,
          },
        ),
      );
    }
    const drift = bindingDrift(stored, next);
    if (drift) {
      return capsuleFail(
        capsuleError(
          'RESPONSIBILITY_REVISION_MISMATCH',
          `${drift.field} is fixed at preparation and cannot change (${drift.expected} → ${drift.actual})`,
          'create a new run and capsule for the new revision or policy',
          {
            capsuleId: next.capsuleId,
            runId: next.runId,
            field: drift.field,
            expected: drift.expected,
            actual: drift.actual,
          },
        ),
      );
    }
    this.capsules.set(next.capsuleId, deepClone(next));
    return capsuleOk(frozenClone(next));
  }
}

interface BindingDrift {
  field: string;
  expected: string;
  actual: string;
}

/** Fields bound at preparation and immutable for the life of the run. */
export function bindingDrift(
  stored: RelayAgentExecutionCapsule,
  next: RelayAgentExecutionCapsule,
): BindingDrift | null {
  const checks: Array<[string, string | number, string | number]> = [
    ['projectId', stored.projectId, next.projectId],
    ['missionId', stored.missionId, next.missionId],
    ['taskId', stored.taskId, next.taskId],
    ['binding.responsibility', stored.binding.responsibility, next.binding.responsibility],
    ['binding.missionRevision', stored.binding.missionRevision, next.binding.missionRevision],
    ['binding.taskRevision', stored.binding.taskRevision, next.binding.taskRevision],
    ['binding.handoffId', stored.binding.handoffId, next.binding.handoffId],
    [
      'binding.handoffCompilerVersion',
      stored.binding.handoffCompilerVersion,
      next.binding.handoffCompilerVersion,
    ],
    ['binding.policyPackVersion', stored.binding.policyPackVersion, next.binding.policyPackVersion],
    ['binding.passportId', stored.binding.passportId, next.binding.passportId],
    ['identity.requested.agentId', stored.identity.requested.agentId, next.identity.requested.agentId],
    ['createdAt', stored.createdAt, next.createdAt],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) {
      return { field, expected: String(expected), actual: String(actual) };
    }
  }
  // A capsule cannot silently switch workspaces after preparation.
  const storedWorkspace = stored.workspace?.workspaceId ?? 'none';
  const nextWorkspace = next.workspace?.workspaceId ?? 'none';
  if (storedWorkspace !== nextWorkspace) {
    return { field: 'workspace.workspaceId', expected: storedWorkspace, actual: nextWorkspace };
  }
  return null;
}
