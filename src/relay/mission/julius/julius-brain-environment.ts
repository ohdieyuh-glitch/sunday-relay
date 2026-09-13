import { juliusPrincipal, type JuliusBrainDraft, type JuliusBrainPrincipal, type JuliusBrainRecordKind } from './julius-brain-contracts';
import { createJuliusBrainEvaluationContext, type JuliusBrainEvaluationContext } from './julius-brain-export';
import type { JuliusBrainReadGrant, JuliusBrainWriteGrant } from './julius-brain-policy';
import { readAllJuliusBrainEntities, type JuliusBrainCommitResult, type JuliusBrainStore } from './julius-brain-store';

/**
 * EVALUATION SESSIONS: HOW A SEPARATE ENVIRONMENT (A FUTURE GVE) USES THE BRAIN.
 *
 * Not a GVE. The primitive a GVE needs so that Project Brain does not have to be
 * redesigned when one arrives:
 *
 *   Julius OPENS a session — a scoped, sequence-pinned, hashed context snapshot,
 *   a read grant, and a write grant for an ENVIRONMENT principal bound to one
 *   environment run — and hands it to the environment.
 *
 *   The environment returns typed EVAL / EVIDENCE / ARTIFACT / TRACE drafts.
 *   Julius ADMITS them only if every eval cites the exact snapshot it was given
 *   (as an input whose contentHash is the snapshot hash) and the run identity it
 *   ran under, and every record stays inside the session's mission and task.
 *   The grant bounds kinds, count and lifetime; the planner enforces the rest.
 *
 * The Python tool is the first consumer of the same pieces; a GVE is the next.
 */

export const JULIUS_ENVIRONMENT_WRITE_KINDS: readonly JuliusBrainRecordKind[] = Object.freeze(['EVAL', 'EVIDENCE', 'ARTIFACT', 'TRACE']);

export interface JuliusEvaluationSession {
  readonly sessionId: string;
  readonly environmentId: string;
  readonly environmentRunId: string;
  readonly brainId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly issuedBy: string;
  readonly principal: JuliusBrainPrincipal;
  readonly readGrant: JuliusBrainReadGrant;
  readonly writeGrant: JuliusBrainWriteGrant;
  readonly context: JuliusBrainEvaluationContext;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export async function openJuliusEvaluationSession(input: {
  readonly store: JuliusBrainStore;
  readonly brainId: string;
  readonly projectId: string;
  readonly issuedBy: JuliusBrainPrincipal;
  readonly environmentId: string;
  readonly environmentRunId: string;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly readKinds: readonly JuliusBrainRecordKind[];
  readonly writeKinds: readonly JuliusBrainRecordKind[];
  readonly maxRecords: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): Promise<JuliusEvaluationSession> {
  if (input.issuedBy.kind !== 'JULIUS') throw new Error('julius_evaluation_session_requires_julius');
  if (input.writeKinds.some((kind) => !JULIUS_ENVIRONMENT_WRITE_KINDS.includes(kind))) throw new Error('julius_evaluation_session_kind_not_permitted');
  const head = await input.store.head(input.brainId, input.projectId);
  if (head === null) throw new Error('julius_evaluation_session_brain_not_found');
  const sessionId = `eval-session:${input.environmentId}:${input.environmentRunId}`;
  const grantId = `environment-grant:${input.environmentRunId}`;
  const principal = juliusPrincipal('ENVIRONMENT', `environment:${input.environmentId}:${input.environmentRunId}`, { grantId, onBehalfOf: input.issuedBy.id });
  const readGrant: JuliusBrainReadGrant = {
    grantId: `environment-read:${input.environmentRunId}`, brainId: input.brainId, kinds: input.readKinds,
    missionIds: [input.missionId], taskIds: input.taskId === null ? null : [input.taskId], includeHistory: false, includeRestricted: false,
  };
  const writeGrant: JuliusBrainWriteGrant = {
    grantId, brainId: input.brainId, principalId: principal.id, issuedBy: input.issuedBy.id, kinds: input.writeKinds,
    missionId: input.missionId, taskId: input.taskId, maxRecords: input.maxRecords, expiresAt: input.expiresAt,
  };
  const context = createJuliusBrainEvaluationContext({
    brainId: input.brainId, entities: await readAllJuliusBrainEntities(input.store, input.brainId, input.projectId),
    head, grant: readGrant, consumerRunId: input.environmentRunId, createdAt: input.issuedAt,
  });
  return {
    sessionId, environmentId: input.environmentId, environmentRunId: input.environmentRunId, brainId: input.brainId, projectId: input.projectId,
    missionId: input.missionId, taskId: input.taskId, issuedBy: input.issuedBy.id, principal, readGrant, writeGrant, context,
    issuedAt: input.issuedAt, expiresAt: input.expiresAt,
  };
}

/** The session's own requirements on a submission, before the planner's. */
export function checkJuliusEnvironmentSubmission(session: JuliusEvaluationSession, drafts: readonly JuliusBrainDraft[]): string[] {
  const errors: string[] = [];
  const visible = new Set(session.context.entities.map((state) => state.entityId));
  drafts.forEach((draft, index) => {
    const at = `drafts[${index}]`;
    if (draft.op !== 'CREATE') errors.push(`${at}: an environment only creates`);
    if (draft.scope.missionId !== session.missionId || (session.taskId !== null && draft.scope.taskId !== session.taskId)) errors.push(`${at}: outside the session's mission or task`);
    if (draft.provenance.executionId !== session.environmentRunId) errors.push(`${at}: provenance must name the environment run`);
    for (const link of draft.links) {
      const inBatch = drafts.some((other) => other.entityId === link.target);
      if (!visible.has(link.target) && !inBatch) errors.push(`${at}: links to ${link.target}, which the session did not grant`);
    }
    if (draft.kind === 'EVAL') {
      const body = draft.body as { reproducibility?: { environmentRunId?: unknown }; inputs?: readonly { contentHash?: unknown }[] };
      if (body.reproducibility?.environmentRunId !== session.environmentRunId) errors.push(`${at}: reproducibility.environmentRunId must be ${session.environmentRunId}`);
      if (!(body.inputs ?? []).some((item) => item.contentHash === session.context.snapshotHash)) errors.push(`${at}: must cite the context snapshot it evaluated against`);
    }
  });
  return errors;
}

export type JuliusEnvironmentSubmissionResult =
  | JuliusBrainCommitResult
  | { readonly outcome: 'REJECTED'; readonly errors: readonly string[] };

export async function submitJuliusEnvironmentResults(input: {
  readonly store: JuliusBrainStore;
  readonly session: JuliusEvaluationSession;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly recordedAt: string;
}): Promise<JuliusEnvironmentSubmissionResult> {
  const errors = checkJuliusEnvironmentSubmission(input.session, input.drafts);
  if (errors.length > 0) return { outcome: 'REJECTED', errors };
  return input.store.commit({
    brainId: input.session.brainId, projectId: input.session.projectId, principal: input.session.principal,
    drafts: input.drafts, grant: input.session.writeGrant, recordedAt: input.recordedAt,
  });
}
