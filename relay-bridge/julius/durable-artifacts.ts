import { createHash } from 'node:crypto';

import {
  JuliusWorkArtifactConflict,
  juliusWorkArtifactId,
  juliusWorkArtifactRef,
  type ArtifactStorePort,
  type JuliusWorkArtifactKind,
  type JuliusWorkArtifactRecord,
  type JuliusWorkArtifactScope,
  type JuliusWorkArtifactStore,
} from '../../src/relay/mission/julius';

/**
 * WHERE A MISSION'S BODIES ACTUALLY GO.
 *
 * The live exchange was a `Map<string,string>` in one process, keyed per RUN.
 * Two consequences, both real and both proven before this existed:
 *
 *   * a restart lost every body, so a resumed run could not be reviewed —
 *     Julius refuses rather than approving nothing, which is right, and also
 *     means the mission simply stops;
 *   * a repair round OVERWROTE the round before it, destroying the diff and
 *     the test output that explain why the repair was needed.
 *
 * This composes the two things that already exist and were never wired
 * together: the content-addressed store, which hashes bytes on write and
 * RE-HASHES them on read and refuses a scope that is not its own, and a
 * durable record of which body belongs to which attempt.
 *
 * NOTHING HERE INVENTS STORAGE. The bytes go to `ArtifactStorePort`
 * exactly as the tool path's artifacts do, with the same guarantees; this adds
 * only the attempt scope the worker path needs and the row that lets a later
 * process find one.
 */

/** The bytes as this exchange stores them. Text, because every body it holds is text. */
const CONTENT_TYPE = 'text/plain; charset=utf-8';
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export interface JuliusDurableArtifacts {
  /**
   * Keep a body for this attempt. Returns the durable reference — the value an
   * evidence row may carry, because it resolves after this process is gone.
   */
  put(scope: JuliusWorkArtifactScope & { readonly role: string; readonly occurredAt: string }, text: string): Promise<{
    readonly ref: string;
    readonly contentHash: string;
    readonly byteSize: number;
  }>;
  /** The body this exact attempt produced, verified against its digest, or null. */
  get(scope: JuliusWorkArtifactScope): Promise<string | null>;
  /**
   * The newest body of this kind for a task, whichever attempt made it — what
   * a reviewer means by "the plan". Earlier attempts stay exactly where they
   * are; this only chooses which one to read.
   */
  latest(input: { projectId: string; runId: string; taskId: string; kind: JuliusWorkArtifactKind }): Promise<string | null>;
}

/** The tenant a mission runs under. The content store scopes by it and refuses across it. */
export interface JuliusArtifactTenancy {
  readonly tenantId: string;
}

/** The scope the content store itself keys and verifies on. */
interface JuliusContentScope {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly invocationId: string;
}

export function createJuliusDurableArtifacts(input: {
  readonly content: ArtifactStorePort;
  readonly records: JuliusWorkArtifactStore;
  readonly tenancy: JuliusArtifactTenancy;
}): JuliusDurableArtifacts {
  const { content, records, tenancy } = input;

  /**
   * The content store's own scope. `invocationId` names the ATTEMPT here,
   * because on this path an attempt is what an invocation is on the tool path:
   * the unit whose output must not be confused with another's.
   */
  const contentScope = (scope: JuliusWorkArtifactScope): JuliusContentScope => ({
    artifactId: juliusWorkArtifactId(scope),
    tenantId: tenancy.tenantId,
    projectId: scope.projectId,
    runId: scope.runId,
    taskId: scope.taskId,
    invocationId: `attempt:${String(scope.leaseGeneration)}`,
  });

  return {
    async put(scope, text) {
      const bytes = Buffer.from(text, 'utf8');
      const contentHash = sha256(text);
      /* THE RECORD DECIDES WHETHER THESE BYTES MAY BE WRITTEN AT ALL.
         Asked afterwards, the content store gets there first and refuses a
         second body under a used id with its own filesystem error — `EEXIST`,
         which says nothing about attempts, artifacts or why. Asked first, the
         same attempt writing the same body is recognised and nothing is
         rewritten, and a DIFFERENT body under that id is the typed conflict a
         caller can act on. The record call below is still the authority: two
         processes racing here both reach it, and it refuses one of them. */
      const existing = await records.workArtifact(scope);
      if (existing !== null) {
        if (existing.contentHash !== contentHash || existing.byteSize !== bytes.byteLength) {
          throw new JuliusWorkArtifactConflict(existing.artifactId);
        }
        return { ref: juliusWorkArtifactRef(scope), contentHash, byteSize: bytes.byteLength };
      }
      /* THEN THE BYTES, THEN THE ROW. A record naming bytes nobody stored is
         the dangling reference this whole change exists to remove; bytes with
         no record are merely unreferenced, which a later sweep can collect. */
      const stored = await content.put({
        metadata: { ...contentScope(scope), kind: 'STRUCTURED_OUTPUT', contentType: CONTENT_TYPE, createdAt: scope.occurredAt, expiresAt: null },
        content: bytes,
      });
      const record: JuliusWorkArtifactRecord = {
        ...scope,
        artifactId: juliusWorkArtifactId(scope),
        role: scope.role,
        contentType: CONTENT_TYPE,
        byteSize: bytes.byteLength,
        contentHash,
        storageRef: stored.storageRef,
        occurredAt: scope.occurredAt,
      };
      await records.recordWorkArtifact(record);
      return { ref: juliusWorkArtifactRef(scope), contentHash, byteSize: bytes.byteLength };
    },

    async get(scope) {
      const record = await records.workArtifact(scope);
      if (record === null) return null;
      return read(content, record, contentScope(scope));
    },

    async latest(input) {
      const record = await records.latestWorkArtifact(input);
      if (record === null) return null;
      return read(content, record, contentScope(record));
    },
  };
}

/**
 * THE BODY, OR NOTHING — never a body the record does not vouch for.
 *
 * The content store already re-hashes on read and throws
 * `artifact_integrity_failure` when the bytes moved. This checks the SECOND
 * half a store cannot: that the bytes match the digest the RECORD carries, so
 * a row and a body that disagree are refused rather than reconciled in favour
 * of whichever was read last.
 */
async function read(
  content: ArtifactStorePort,
  record: JuliusWorkArtifactRecord,
  scope: JuliusContentScope,
): Promise<string | null> {
  const stored = await content.get(scope);
  if (stored === null) return null;
  const text = Buffer.from(stored.content).toString('utf8');
  if (sha256(text) !== record.contentHash || stored.content.byteLength !== record.byteSize) {
    throw new Error('julius_work_artifact_integrity_failure');
  }
  return text;
}
