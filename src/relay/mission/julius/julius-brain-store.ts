import {
  JULIUS_BRAIN_SCHEMA_VERSION,
  canonicalJuliusBrainJson,
  juliusBrainGenesisHash,
  validateJuliusBrainPrincipal,
  isJuliusBrainId,
  type JuliusBrainDraft,
  type JuliusBrainHead,
  type JuliusBrainIdentity,
  type JuliusBrainPrincipal,
  type JuliusBrainRecord,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import type { JuliusBrainWriteGrant } from './julius-brain-policy';
import {
  juliusBrainPlanDependencies,
  planJuliusBrainGroups,
  projectJuliusBrain,
  verifyJuliusBrainLedger,
  type JuliusBrainCommitGroup,
  type JuliusBrainEntityState,
  type JuliusBrainIdempotencyHit,
  type JuliusBrainLifecycle,
  type JuliusBrainReceipt,
  type JuliusBrainRefusal,
} from './julius-brain-projection';

/**
 * THE PROJECT BRAIN STORE PORT, AND AN IN-MEMORY MODEL OF IT.
 *
 * A store does three things and decides none of them: it serialises commits
 * per Brain, it hands the planner the committed state the planner asks for,
 * and it persists exactly what the planner returned — all of it or none of it.
 *
 * THE IN-MEMORY MODEL is what `julius-memory-store.ts` is for the runtime: a
 * precise model of the semantics (serialised commits, idempotency, version
 * checks, atomic batches), never a production store. It forgets everything
 * when the process exits. Durability is `JuliusBrainPostgresStore`'s, and is
 * proven against a real PostgreSQL, not here.
 */

export interface JuliusBrainEntityFilter {
  readonly kinds?: readonly JuliusBrainRecordKind[];
  readonly entityIds?: readonly string[];
  readonly lifecycles?: readonly JuliusBrainLifecycle[];
  /** `undefined` matches any mission; `null` matches only Brain-level entities. */
  readonly missionId?: string | null;
  readonly taskId?: string | null;
  readonly statuses?: readonly string[];
  /** Keyset paging: entities sort by id, and this excludes every id up to and including it. */
  readonly afterEntityId?: string;
  readonly limit?: number;
}

export interface JuliusBrainRecordQuery {
  readonly afterSequence: number;
  readonly limit: number;
  readonly entityId?: string;
  readonly kinds?: readonly JuliusBrainRecordKind[];
}

export interface JuliusBrainCommitInput {
  readonly brainId: string;
  readonly projectId: string;
  readonly principal: JuliusBrainPrincipal;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly grant: JuliusBrainWriteGrant | null;
  readonly recordedAt: string;
  readonly secretLiterals?: readonly string[];
}

export type JuliusBrainCommitResult =
  | { readonly outcome: 'COMMITTED'; readonly receipts: readonly JuliusBrainReceipt[]; readonly head: JuliusBrainHead }
  | JuliusBrainRefusal;

export interface JuliusBrainGroupCommitInput {
  readonly brainId: string;
  readonly projectId: string;
  readonly recordedAt: string;
  readonly groups: readonly JuliusBrainCommitGroup[];
}

export type JuliusBrainGroupCommitResult =
  | { readonly outcome: 'COMMITTED'; readonly receipts: readonly (readonly JuliusBrainReceipt[])[]; readonly head: JuliusBrainHead }
  | (JuliusBrainRefusal & { readonly group: number });

/** A single-principal commit as a one-group commit. */
export const juliusBrainSingleGroup = (input: JuliusBrainCommitInput): JuliusBrainGroupCommitInput => ({
  brainId: input.brainId, projectId: input.projectId, recordedAt: input.recordedAt,
  groups: [{ principal: input.principal, grant: input.grant, drafts: input.drafts, secretLiterals: input.secretLiterals }],
});

export function juliusBrainUngroupResult(result: JuliusBrainGroupCommitResult): JuliusBrainCommitResult {
  if (result.outcome === 'REFUSED') return { outcome: 'REFUSED', index: result.index, reasonCode: result.reasonCode, detail: result.detail };
  return { outcome: 'COMMITTED', receipts: result.receipts[0] ?? [], head: result.head };
}

export type JuliusBrainRestoreResult =
  | { readonly outcome: 'RESTORED'; readonly head: JuliusBrainHead; readonly entityCount: number }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string };

export interface JuliusBrainStore {
  /** Idempotent for the same identity; refuses a brain id taken by a different project. */
  createBrain(identity: JuliusBrainIdentity): Promise<{ readonly created: boolean; readonly brain: JuliusBrainIdentity }>;
  loadBrain(brainId: string, projectId: string): Promise<JuliusBrainIdentity | null>;
  listBrains(projectId: string): Promise<readonly JuliusBrainIdentity[]>;
  head(brainId: string, projectId: string): Promise<JuliusBrainHead | null>;
  /** All-or-nothing. A refusal writes nothing. */
  commit(input: JuliusBrainCommitInput): Promise<JuliusBrainCommitResult>;
  /** Several principals' drafts as one all-or-nothing write, planned in group order. */
  commitGroup(input: JuliusBrainGroupCommitInput): Promise<JuliusBrainGroupCommitResult>;
  records(brainId: string, projectId: string, query: JuliusBrainRecordQuery): Promise<{ readonly records: readonly JuliusBrainRecord[]; readonly hasMore: boolean }>;
  entities(brainId: string, projectId: string, filter: JuliusBrainEntityFilter): Promise<readonly JuliusBrainEntityState[]>;
  /** Restore a verified ledger into a Brain id that does not exist yet. */
  restore(identity: JuliusBrainIdentity, records: readonly JuliusBrainRecord[]): Promise<JuliusBrainRestoreResult>;
}

export const JULIUS_BRAIN_READ_LIMIT = 5_000;

/** Every record of a Brain, paged through the port. */
export async function readAllJuliusBrainRecords(store: JuliusBrainStore, brainId: string, projectId: string, pageSize = 1_000): Promise<JuliusBrainRecord[]> {
  const out: JuliusBrainRecord[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = await store.records(brainId, projectId, { afterSequence, limit: pageSize });
    out.push(...page.records);
    if (!page.hasMore || page.records.length === 0) return out;
    afterSequence = page.records[page.records.length - 1]!.sequence;
  }
}

/** Every entity matching `filter`, paged so a large Brain is never silently truncated. */
export async function readAllJuliusBrainEntities(store: JuliusBrainStore, brainId: string, projectId: string, filter: JuliusBrainEntityFilter = {}): Promise<JuliusBrainEntityState[]> {
  const out: JuliusBrainEntityState[] = [];
  let afterEntityId: string | undefined;
  for (;;) {
    const page = await store.entities(brainId, projectId, { ...filter, afterEntityId, limit: JULIUS_BRAIN_READ_LIMIT });
    out.push(...page);
    if (page.length < JULIUS_BRAIN_READ_LIMIT) return out;
    afterEntityId = page[page.length - 1]!.entityId;
  }
}

export function validateJuliusBrainIdentity(identity: JuliusBrainIdentity): string[] {
  const errors: string[] = [];
  if (!isJuliusBrainId(identity.brainId)) errors.push('brainId: invalid');
  if (!isJuliusBrainId(identity.projectId)) errors.push('projectId: invalid');
  if (typeof identity.title !== 'string' || !identity.title.trim() || identity.title.length > 512) errors.push('title: required, at most 512');
  if (identity.schemaVersion !== JULIUS_BRAIN_SCHEMA_VERSION) errors.push('schemaVersion: unsupported');
  if (Number.isNaN(Date.parse(identity.createdAt))) errors.push('createdAt: must be an ISO timestamp');
  errors.push(...validateJuliusBrainPrincipal(identity.createdBy));
  return errors;
}

export function juliusBrainEntityMatches(state: JuliusBrainEntityState, filter: JuliusBrainEntityFilter): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(state.kind)) return false;
  if (filter.entityIds !== undefined && !filter.entityIds.includes(state.entityId)) return false;
  if (filter.lifecycles !== undefined && !filter.lifecycles.includes(state.lifecycle)) return false;
  if (filter.missionId !== undefined && state.scope.missionId !== filter.missionId) return false;
  if (filter.taskId !== undefined && state.scope.taskId !== filter.taskId) return false;
  if (filter.statuses !== undefined && !filter.statuses.includes(String(state.body.status ?? ''))) return false;
  if (filter.afterEntityId !== undefined && !(state.entityId > filter.afterEntityId)) return false;
  return true;
}

const byEntityId = (a: JuliusBrainEntityState, b: JuliusBrainEntityState): number => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);

export interface JuliusBrainMemoryStore extends JuliusBrainStore {
  /** Test inspection: whether the materialised rows still equal the projection of the ledger. */
  verify(brainId: string): { ok: boolean; problems: readonly string[] };
  /** The group commit, synchronously — for another in-memory model to pair with its own state change. */
  commitGroupSync(input: JuliusBrainGroupCommitInput): JuliusBrainGroupCommitResult;
}

export function createJuliusBrainMemoryStore(): JuliusBrainMemoryStore {
  interface BrainRow {
    identity: JuliusBrainIdentity;
    head: JuliusBrainHead;
    records: JuliusBrainRecord[];
    entities: Map<string, JuliusBrainEntityState>;
    keys: Map<string, JuliusBrainIdempotencyHit>;
  }
  const brains = new Map<string, BrainRow>();
  // Deep copies at the boundary, so a caller mutating a returned object can
  // never change what the store holds — the property a database gives for free.
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const owned = (brainId: string, projectId: string): BrainRow | null => {
    const row = brains.get(brainId);
    return row !== undefined && row.identity.projectId === projectId ? row : null;
  };

  /**
   * SYNCHRONOUS, START TO FINISH. JavaScript cannot interleave another task
   * inside it, which is this model's stand-in for the brain row lock — and what
   * lets a caller pair it with its own synchronous state change atomically.
   */
  function commitGroupSync(input: JuliusBrainGroupCommitInput): JuliusBrainGroupCommitResult {
    const row = owned(input.brainId, input.projectId);
    if (row === null) return { outcome: 'REFUSED', index: 0, group: 0, reasonCode: 'brain_not_found', detail: `${input.brainId} is not a Brain of ${input.projectId}.` };
    const groups = copy(input.groups);
    const allDrafts = groups.flatMap((group) => group.drafts);
    const entities = new Map<string, JuliusBrainEntityState | null>();
    for (let round = 0; round < 3; round += 1) {
      const needed = juliusBrainPlanDependencies(row.identity.brainId, allDrafts, entities);
      if (needed.length === 0) break;
      for (const id of needed) entities.set(id, row.entities.get(id) ?? null);
    }
    const idempotency = new Map<string, JuliusBrainIdempotencyHit | null>();
    for (const draft of allDrafts) idempotency.set(draft.idempotencyKey, row.keys.get(draft.idempotencyKey) ?? null);
    const grantUsage = new Map<string, number>();
    for (const group of groups) {
      if (group.grant !== null) grantUsage.set(group.grant.grantId, row.records.filter((record) => record.principal.grantId === group.grant!.grantId).length);
    }
    const plan = planJuliusBrainGroups({ brain: row.identity, head: row.head, recordedAt: input.recordedAt, groups, entities, idempotency, grantUsage });
    if (plan.outcome === 'REFUSED') return plan;
    for (const record of plan.records) {
      row.records.push(copy(record));
      row.keys.set(record.idempotencyKey, { recordId: record.recordId, fingerprint: record.fingerprint, entityId: record.entityId, entityVersion: record.entityVersion, sequence: record.sequence, kind: record.kind });
    }
    for (const state of plan.entities) row.entities.set(state.entityId, copy(state));
    row.head = plan.head;
    return { outcome: 'COMMITTED', receipts: plan.receipts, head: plan.head };
  }

  return {
    async createBrain(identity) {
      const errors = validateJuliusBrainIdentity(identity);
      if (errors.length > 0) throw new Error(`julius_brain_identity_invalid:${errors.join('; ')}`);
      const existing = brains.get(identity.brainId);
      if (existing !== undefined) {
        if (existing.identity.projectId !== identity.projectId) throw new Error('julius_brain_id_taken');
        return { created: false, brain: copy(existing.identity) };
      }
      brains.set(identity.brainId, {
        identity: copy(identity), head: { sequence: 0, chainHash: juliusBrainGenesisHash(identity.brainId) },
        records: [], entities: new Map(), keys: new Map(),
      });
      return { created: true, brain: copy(identity) };
    },

    async loadBrain(brainId, projectId) {
      const row = owned(brainId, projectId);
      return row === null ? null : copy(row.identity);
    },

    async listBrains(projectId) {
      return [...brains.values()].filter((row) => row.identity.projectId === projectId).map((row) => copy(row.identity))
        .sort((a, b) => a.brainId.localeCompare(b.brainId));
    },

    async head(brainId, projectId) {
      const row = owned(brainId, projectId);
      return row === null ? null : { ...row.head };
    },

    async commit(input) {
      return juliusBrainUngroupResult(commitGroupSync(juliusBrainSingleGroup(input)));
    },

    async commitGroup(input) {
      return commitGroupSync(input);
    },

    commitGroupSync,

    async records(brainId, projectId, query) {
      const row = owned(brainId, projectId);
      if (row === null) return { records: [], hasMore: false };
      const limit = Math.max(1, Math.min(query.limit, JULIUS_BRAIN_READ_LIMIT));
      const matching = row.records.filter((record) => record.sequence > query.afterSequence
        && (query.entityId === undefined || record.entityId === query.entityId)
        && (query.kinds === undefined || query.kinds.includes(record.kind)));
      return { records: copy(matching.slice(0, limit)), hasMore: matching.length > limit };
    },

    async entities(brainId, projectId, filter) {
      const row = owned(brainId, projectId);
      if (row === null) return [];
      const limit = Math.max(1, Math.min(filter.limit ?? JULIUS_BRAIN_READ_LIMIT, JULIUS_BRAIN_READ_LIMIT));
      return copy([...row.entities.values()].filter((state) => juliusBrainEntityMatches(state, filter)).sort(byEntityId).slice(0, limit));
    },

    async restore(identity, records) {
      const errors = validateJuliusBrainIdentity(identity);
      if (errors.length > 0) return { outcome: 'REFUSED', reasonCode: 'identity_invalid', detail: errors.join('; ') };
      if (brains.has(identity.brainId)) return { outcome: 'REFUSED', reasonCode: 'brain_exists', detail: 'A restore never merges into an existing Brain.' };
      const verification = verifyJuliusBrainLedger(identity.brainId, records);
      if (!verification.ok) return { outcome: 'REFUSED', reasonCode: 'ledger_invalid', detail: verification.problems.slice(0, 8).join('; ') };
      const projection = projectJuliusBrain(identity.brainId, records);
      const keys = new Map<string, JuliusBrainIdempotencyHit>();
      for (const record of records) keys.set(record.idempotencyKey, { recordId: record.recordId, fingerprint: record.fingerprint, entityId: record.entityId, entityVersion: record.entityVersion, sequence: record.sequence, kind: record.kind });
      brains.set(identity.brainId, { identity: copy(identity), head: projection.head, records: copy([...records]), entities: new Map(copy([...projection.entities])), keys });
      return { outcome: 'RESTORED', head: projection.head, entityCount: projection.entities.size };
    },

    verify(brainId) {
      const row = brains.get(brainId);
      if (row === undefined) return { ok: false, problems: ['brain_not_found'] };
      const result = verifyJuliusBrainLedger(brainId, row.records, row.entities.values());
      const headMatches = canonicalJuliusBrainJson(result.head) === canonicalJuliusBrainJson(row.head);
      return { ok: result.ok && headMatches, problems: headMatches ? result.problems : [...result.problems, 'head mismatch'] };
    },
  };
}
