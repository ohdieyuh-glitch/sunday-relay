import { isJuliusContentDigest } from './julius-artifact-reference';

/**
 * THE BODIES A MISSION PRODUCES, AND WHERE THEY LIVE.
 *
 * A plan, a diff, the test output, the packet a reviewer was shown: Julius
 * produced all of them, decided on them, and kept NONE of them. They lived in
 * a `Map` in one process, keyed per RUN — `plan:<runId>`, `diff:<runId>` — so
 * two things were true at once:
 *
 *   * a restart lost every body, and a resumed run could not be reviewed at
 *     all (`reviewer_plan_absent` refuses, correctly, rather than approving
 *     nothing);
 *   * a repair round OVERWROTE the round before it, so the diff and the test
 *     output that explain WHY a repair was needed were gone by the time the
 *     repair was judged.
 *
 * The second is the worse one. A repair exists because something was wrong,
 * and the evidence of what was wrong was destroyed by the attempt to fix it.
 *
 * SO AN ARTIFACT IS SCOPED BY THE ATTEMPT THAT MADE IT. Not by the run: by
 * project, run, task, and the LEASE GENERATION that fences the attempt — the
 * same fencing token the store uses for every other attempt-scoped fact. Two
 * rounds of the same task produce two artifacts, both durable, neither
 * overwriting the other.
 *
 * AN ARTIFACT IS NOT EVIDENCE. The artifact is the bytes; the evidence is the
 * claim that refers to them, carrying the digest and — now that there is
 * something to point at — a reference that resolves. A digest is not a body,
 * and a body is not a verdict.
 */

/** What kind of body this is. One kind per attempt per task, which is what makes the id deterministic. */
export const JULIUS_WORK_ARTIFACT_KINDS = [
  /** The Prompt Architect's validated plan, as it was accepted. */
  'PLAN',
  /** An architect's answer to a question asked mid-mission. */
  'GUIDANCE',
  /** The unified diff the executor captured for this attempt. */
  'DIFF',
  /** The deterministic test command's combined output. */
  'TEST_OUTPUT',
  /** The revision the attempt started from. */
  'BASE_REVISION',
  /** Exactly what an Independent Reviewer was shown. */
  'REVIEW_PACKET',
  /** What a research step fetched, as the worker was given it. */
  'RESEARCH',
] as const;
export type JuliusWorkArtifactKind = (typeof JULIUS_WORK_ARTIFACT_KINDS)[number];

/**
 * WHICH ATTEMPT MADE IT.
 *
 * `leaseGeneration` is the fencing token: it moves on every claim, so it
 * separates attempt 1 from attempt 2 of the same task even when nothing else
 * does. `julius_tasks.attempt` counts execution admissions and can stall
 * across a retry, which is why it is not the discriminator here.
 */
export interface JuliusWorkArtifactScope {
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly leaseGeneration: number;
  readonly kind: JuliusWorkArtifactKind;
}

export interface JuliusWorkArtifactRecord extends JuliusWorkArtifactScope {
  readonly artifactId: string;
  /** Who produced it, so a reader can tell a reviewer's packet from a coder's diff. */
  readonly role: string;
  readonly contentType: string;
  readonly byteSize: number;
  /** sha256 of the bytes, lowercase hex. The store verifies it on write AND on read. */
  readonly contentHash: string;
  /** Where the bytes are, in the content store's own terms. */
  readonly storageRef: string;
  readonly occurredAt: string;
}

/**
 * THE NAME AN ARTIFACT HAS, DERIVED FROM THE ATTEMPT THAT MADE IT.
 *
 * Deterministic for the same reason a decision's events are: a process that
 * repeats work names the same artifact, so a replay is recognised rather than
 * duplicated, and a reader holding the attempt can ASK for the body instead of
 * searching for it.
 *
 * The segments are joined with `/` and the whole is safe for the content
 * store's own scope validation, which refuses anything outside
 * `[A-Za-z0-9][A-Za-z0-9._:-]*` — so the id is hashed into a single segment by
 * the store rather than becoming a path.
 */
export const JULIUS_WORK_ARTIFACT_ID_VERSION = 'julius-work-artifact.v1' as const;

export const juliusWorkArtifactId = (scope: JuliusWorkArtifactScope): string =>
  [
    JULIUS_WORK_ARTIFACT_ID_VERSION,
    scope.runId,
    scope.taskId,
    `g${String(scope.leaseGeneration)}`,
    scope.kind,
  ].join(':');

/** The durable reference an evidence row may carry for this artifact. */
export const juliusWorkArtifactRef = (scope: JuliusWorkArtifactScope): string =>
  `artifact:${juliusWorkArtifactId(scope)}`;

/**
 * WHAT A RECORD MUST SAY TO BE RECORDABLE.
 *
 * Refused rather than written: a body with no digest cannot be verified on
 * read, and a byte size that disagrees with the bytes is a claim nobody
 * checked. Both are the kind of unchecked assertion this table exists to
 * replace.
 */
export const validateJuliusWorkArtifact = (record: JuliusWorkArtifactRecord): void => {
  if (!isJuliusContentDigest(record.contentHash)) throw new Error('julius_work_artifact_digest_invalid');
  if (!Number.isInteger(record.byteSize) || record.byteSize < 0) throw new Error('julius_work_artifact_size_invalid');
  if (!Number.isInteger(record.leaseGeneration) || record.leaseGeneration < 0) throw new Error('julius_work_artifact_attempt_invalid');
  if (!(JULIUS_WORK_ARTIFACT_KINDS as readonly string[]).includes(record.kind)) throw new Error('julius_work_artifact_kind_invalid');
  for (const value of [record.projectId, record.runId, record.taskId, record.role, record.storageRef, record.contentType, record.occurredAt]) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('julius_work_artifact_identity_required');
  }
  if (record.artifactId !== juliusWorkArtifactId(record)) throw new Error('julius_work_artifact_id_mismatch');
};

/**
 * THE PORT. Bodies go through a content store that hashes and verifies them;
 * this is the record of WHICH body belongs to which attempt, and it is what a
 * later process reads to find one.
 */
export interface JuliusWorkArtifactStore {
  /**
   * Record an artifact. Idempotent by artifact id: the same attempt writing
   * the same kind again is the same artifact, and a DIFFERENT body under that
   * id is refused rather than silently replacing the first.
   */
  recordWorkArtifact(record: JuliusWorkArtifactRecord): Promise<{ readonly recorded: boolean }>;
  /** The artifact for exactly this attempt, or null. */
  workArtifact(scope: JuliusWorkArtifactScope): Promise<JuliusWorkArtifactRecord | null>;
  /**
   * The most recent artifact of this kind for a task, whichever attempt made
   * it — what a reader wants when it asks for "the plan" rather than "attempt
   * two's plan". Ordered by lease generation, which is monotonic per task.
   */
  latestWorkArtifact(input: { projectId: string; runId: string; taskId: string; kind: JuliusWorkArtifactKind }): Promise<JuliusWorkArtifactRecord | null>;
  /** Every artifact of a run, for the record and for the proofs. */
  workArtifactsForRun(input: { projectId: string; runId: string }): Promise<readonly JuliusWorkArtifactRecord[]>;
}

/** The same id, asked to hold different bytes. Nothing is written. */
export class JuliusWorkArtifactConflict extends Error {
  constructor(readonly artifactId: string) {
    super('julius_work_artifact_conflict');
    this.name = 'JuliusWorkArtifactConflict';
  }
}
