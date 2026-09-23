import {
  JuliusWorkArtifactConflict,
  juliusWorkArtifactId,
  validateJuliusWorkArtifact,
  type JuliusWorkArtifactKind,
  type JuliusWorkArtifactRecord,
  type JuliusWorkArtifactScope,
  type JuliusWorkArtifactStore,
} from './julius-work-artifact';

/**
 * THE SAME RECORD, IN MEMORY.
 *
 * Not a fake: it keeps the rules PostgreSQL keeps, because a proof that only
 * holds on the store nobody ships is not a proof. Append only, idempotent for
 * the same bytes, a typed conflict for different bytes under a used id, and
 * `latest` ordered by the lease generation that fences the attempt.
 *
 * It does NOT survive a restart, which is the point of the restart proofs: a
 * test restarts a PROCESS by building a new runtime over the SAME store, the
 * way a real restart reaches the same database.
 */
export function createJuliusWorkArtifactMemoryStore(): JuliusWorkArtifactStore & {
  /** Every record, for a test that wants to see the whole shelf. */
  all(): readonly JuliusWorkArtifactRecord[];
} {
  const records = new Map<string, JuliusWorkArtifactRecord>();

  return {
    all: () => [...records.values()],

    async recordWorkArtifact(record) {
      validateJuliusWorkArtifact(record);
      const existing = records.get(record.artifactId);
      if (existing !== undefined) {
        if (existing.contentHash !== record.contentHash || existing.byteSize !== record.byteSize) {
          throw new JuliusWorkArtifactConflict(record.artifactId);
        }
        return { recorded: false };
      }
      records.set(record.artifactId, Object.freeze({ ...record }));
      return { recorded: true };
    },

    async workArtifact(scope: JuliusWorkArtifactScope) {
      const record = records.get(juliusWorkArtifactId(scope));
      return record !== undefined && record.projectId === scope.projectId ? record : null;
    },

    async latestWorkArtifact(input: { projectId: string; runId: string; taskId: string; kind: JuliusWorkArtifactKind }) {
      const matching = [...records.values()].filter((record) => record.projectId === input.projectId
        && record.runId === input.runId && record.taskId === input.taskId && record.kind === input.kind);
      if (matching.length === 0) return null;
      return matching.reduce((newest, record) => (record.leaseGeneration > newest.leaseGeneration ? record : newest));
    },

    async workArtifactsForRun(input: { projectId: string; runId: string }) {
      return [...records.values()]
        .filter((record) => record.projectId === input.projectId && record.runId === input.runId)
        .sort((left, right) => (left.occurredAt === right.occurredAt
          ? left.artifactId.localeCompare(right.artifactId)
          : left.occurredAt.localeCompare(right.occurredAt)));
    },
  };
}
