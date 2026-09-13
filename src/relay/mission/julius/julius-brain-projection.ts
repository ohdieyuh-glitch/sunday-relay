import {
  JULIUS_BRAIN_SCHEMA_VERSION,
  canonicalJuliusBrainJson,
  juliusBrainChainHash,
  juliusBrainContentHash,
  juliusBrainDerivedEntityId,
  juliusBrainDraftOf,
  juliusBrainFingerprint,
  juliusBrainGenesisHash,
  juliusBrainRecordId,
  juliusBrainSha256,
  validateJuliusBrainDraft,
  validateJuliusBrainPrincipal,
  type JuliusBrainBody,
  type JuliusBrainDraft,
  type JuliusBrainHead,
  type JuliusBrainIdentity,
  type JuliusBrainLink,
  type JuliusBrainLinkRelation,
  type JuliusBrainPrincipal,
  type JuliusBrainProvenance,
  type JuliusBrainRecord,
  type JuliusBrainRecordKind,
  type JuliusBrainRetention,
  type JuliusBrainRetirementDisposition,
  type JuliusBrainScope,
  type JuliusBrainSensitivity,
} from './julius-brain-contracts';
import { authorizeJuliusBrainWrite, juliusBrainPrincipalClass, type JuliusBrainWriteGrant } from './julius-brain-policy';
import { juliusStringsOf, scanJuliusSecrets } from './julius-brain-secrets';

/**
 * WHAT HAPPENED → WHAT IS CURRENTLY TRUE.
 *
 * Two pure functions carry the whole Brain, and every store calls the same two:
 *
 *   `planJuliusBrainAppend` decides whether a batch of drafts may be written
 *   and, if so, produces the exact records and entity rows to persist. It is
 *   given the committed state it needs and nothing else; it touches no store.
 *
 *   `applyJuliusBrainRecord` folds one record into the entity map. The planner
 *   uses it to build the rows it returns, and `projectJuliusBrain` uses it to
 *   rebuild current state from the ledger alone.
 *
 * Because the PostgreSQL store persists exactly the rows the planner returned,
 * and the planner built them with the same fold a rebuild uses, "the
 * materialised table equals the projection of the ledger" is a property of the
 * code rather than a hope — and `verifyJuliusBrainLedger` checks it anyway.
 */

export type JuliusBrainLifecycle = 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';

export interface JuliusBrainInboundLink {
  readonly relation: JuliusBrainLinkRelation;
  readonly source: string;
  readonly sourceKind: JuliusBrainRecordKind;
}

export interface JuliusBrainEntityState {
  readonly brainId: string;
  readonly entityId: string;
  readonly kind: JuliusBrainRecordKind;
  readonly version: number;
  /** The latest record. */
  readonly recordId: string;
  /** Every record of this entity, oldest first. The entity's own history. */
  readonly recordIds: readonly string[];
  readonly createdSequence: number;
  readonly updatedSequence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: JuliusBrainPrincipal;
  readonly updatedBy: JuliusBrainPrincipal;
  readonly lifecycle: JuliusBrainLifecycle;
  /** The entity that superseded this one, or null. */
  readonly supersededBy: string | null;
  readonly retirement: { readonly reason: string; readonly disposition: JuliusBrainRetirementDisposition; readonly recordId: string } | null;
  /** The latest CONTENT body. A retirement never erases what was last true. */
  readonly body: JuliusBrainBody;
  readonly links: readonly JuliusBrainLink[];
  /** Links from other entities' current versions that point here. */
  readonly inbound: readonly JuliusBrainInboundLink[];
  readonly scope: JuliusBrainScope;
  readonly retention: JuliusBrainRetention;
  readonly confidence: number | null;
  readonly sensitivity: JuliusBrainSensitivity;
  readonly provenance: JuliusBrainProvenance;
}

export interface JuliusBrainReceipt {
  readonly outcome: 'APPENDED' | 'DUPLICATE';
  readonly recordId: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly sequence: number;
  readonly kind: JuliusBrainRecordKind;
}

export interface JuliusBrainRefusal {
  readonly outcome: 'REFUSED';
  /** The index of the draft that was refused; nothing in the batch was written. */
  readonly index: number;
  readonly reasonCode: string;
  readonly detail: string;
}

export interface JuliusBrainIdempotencyHit {
  readonly recordId: string;
  readonly fingerprint: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly sequence: number;
  readonly kind: JuliusBrainRecordKind;
}

/** Exactly the committed state a plan may consult. Stores fill it; the planner reads it. */
export interface JuliusBrainPlanInput {
  readonly brain: JuliusBrainIdentity;
  readonly head: JuliusBrainHead;
  readonly principal: JuliusBrainPrincipal;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly grant: JuliusBrainWriteGrant | null;
  readonly recordedAt: string;
  /** Committed entities. `undefined` for an id the store did not load is a planner error, not "absent". */
  readonly entities: ReadonlyMap<string, JuliusBrainEntityState | null>;
  readonly idempotency: ReadonlyMap<string, JuliusBrainIdempotencyHit | null>;
  /** Records already written under `grant`, for its `maxRecords` bound. */
  readonly grantUsage: number;
  /** Literal secret values that must never enter the Brain (the Python tool's). */
  readonly secretLiterals?: readonly string[];
}

export type JuliusBrainPlan =
  | {
    readonly outcome: 'APPLY';
    readonly records: readonly JuliusBrainRecord[];
    /** Every entity row that changed, in its final state. */
    readonly entities: readonly JuliusBrainEntityState[];
    readonly receipts: readonly JuliusBrainReceipt[];
    readonly head: JuliusBrainHead;
  }
  | JuliusBrainRefusal;

/** The entity ids a plan will consult for these drafts, given what is already loaded. */
export function juliusBrainPlanDependencies(brainId: string, drafts: readonly JuliusBrainDraft[], loaded: ReadonlyMap<string, JuliusBrainEntityState | null>): string[] {
  const needed = new Set<string>();
  for (const draft of drafts) {
    const entityId = draft.entityId ?? (draft.op === 'CREATE' && typeof draft.idempotencyKey === 'string' ? juliusBrainDerivedEntityId(brainId, draft.kind, draft.idempotencyKey) : null);
    if (entityId !== null) needed.add(entityId);
    for (const link of Array.isArray(draft.links) ? draft.links : []) if (typeof link?.target === 'string') needed.add(link.target);
  }
  // A revision can DROP a link, so the targets of the current links matter too.
  for (const id of [...needed]) {
    const state = loaded.get(id);
    if (state) for (const link of state.links) needed.add(link.target);
  }
  return [...needed].filter((id) => !loaded.has(id));
}

const refuse = (index: number, reasonCode: string, detail: string): JuliusBrainRefusal => ({ outcome: 'REFUSED', index, reasonCode, detail });

export function planJuliusBrainAppend(input: JuliusBrainPlanInput): JuliusBrainPlan {
  const principalErrors = validateJuliusBrainPrincipal(input.principal);
  if (principalErrors.length > 0) return refuse(0, 'invalid_principal', principalErrors.join('; '));
  if (input.drafts.length === 0) return refuse(0, 'empty_batch', 'A commit carries at least one draft.');
  if (input.drafts.length > 500) return refuse(0, 'batch_too_large', 'A commit carries at most 500 drafts.');

  const brainId = input.brain.brainId;
  const overlay = new Map<string, JuliusBrainEntityState | null>();
  const batchKeys = new Map<string, JuliusBrainIdempotencyHit>();
  const records: JuliusBrainRecord[] = [];
  const receipts: JuliusBrainReceipt[] = [];
  let head = input.head;
  const actor = juliusBrainPrincipalClass(input.principal);
  let grantWrites = input.grantUsage;

  const lookup = (id: string): JuliusBrainEntityState | null => {
    if (overlay.has(id)) return overlay.get(id) ?? null;
    if (!input.entities.has(id)) throw new Error(`julius_brain_plan_entity_not_loaded:${id}`);
    return input.entities.get(id) ?? null;
  };

  for (let index = 0; index < input.drafts.length; index += 1) {
    const draft = input.drafts[index]!;
    const errors = validateJuliusBrainDraft(draft);
    if (errors.length > 0) return refuse(index, 'invalid_draft', errors.slice(0, 8).join('; '));

    const scan = scanJuliusSecrets(juliusStringsOf({ body: draft.body, provenance: draft.provenance, scope: draft.scope, links: draft.links }).join('\n'), input.secretLiterals ?? []);
    if (scan.shapes.length > 0 || scan.literalMatches > 0) {
      // The shape NAMES, never the text: the refusal itself must be safe to log.
      return refuse(index, 'credential_shaped_content', `Refused: ${[...scan.shapes, ...(scan.literalMatches > 0 ? ['granted-secret'] : [])].join(', ')}.`);
    }

    const entityId = draft.entityId ?? juliusBrainDerivedEntityId(brainId, draft.kind, draft.idempotencyKey);
    const fingerprint = juliusBrainFingerprint({ ...draft, entityId }, input.principal);
    const prior = batchKeys.get(draft.idempotencyKey) ?? input.idempotency.get(draft.idempotencyKey);
    if (prior === undefined) throw new Error(`julius_brain_plan_idempotency_not_loaded:${draft.idempotencyKey}`);
    if (prior !== null) {
      if (prior.fingerprint !== fingerprint) return refuse(index, 'idempotency_key_conflict', `The key ${draft.idempotencyKey} already names different content.`);
      receipts.push({ outcome: 'DUPLICATE', recordId: prior.recordId, entityId: prior.entityId, entityVersion: prior.entityVersion, sequence: prior.sequence, kind: prior.kind });
      continue;
    }

    const current = lookup(entityId);
    if (draft.op === 'CREATE') {
      if (current !== null) return refuse(index, 'entity_already_exists', `${entityId} already exists; revise it instead.`);
    } else {
      if (current === null) return refuse(index, 'entity_not_found', `${entityId} does not exist.`);
      if (current.kind !== draft.kind) return refuse(index, 'entity_kind_mismatch', `${entityId} is ${current.kind}, not ${draft.kind}.`);
      if (current.lifecycle !== 'ACTIVE') return refuse(index, 'entity_not_active', `${entityId} is ${current.lifecycle}; history is not rewritten.`);
      if (current.version !== draft.expectedVersion) return refuse(index, 'version_conflict', `${entityId} is at version ${current.version}, not ${draft.expectedVersion}.`);
      if (canonicalJuliusBrainJson(current.scope) !== canonicalJuliusBrainJson(draft.scope)) return refuse(index, 'scope_is_immutable', 'An entity keeps the mission and task it was created in.');
    }

    const supersedes: JuliusBrainEntityState[] = [];
    for (const link of draft.links) {
      if (link.target === entityId) return refuse(index, 'self_link', 'An entity cannot link to itself.');
      const target = lookup(link.target);
      if (target === null) return refuse(index, 'link_target_not_found', `${link.target} does not exist.`);
      if (link.relation === 'SUPERSEDES') {
        if (draft.op === 'RETIRE') return refuse(index, 'retirement_cannot_supersede', 'Retire, or supersede — not both.');
        if (target.kind !== draft.kind) return refuse(index, 'supersession_kind_mismatch', `A ${draft.kind} cannot supersede a ${target.kind}.`);
        if (target.lifecycle !== 'ACTIVE') return refuse(index, 'supersession_target_not_active', `${link.target} is already ${target.lifecycle}.`);
        if (link.targetVersion !== null && link.targetVersion !== target.version) return refuse(index, 'version_conflict', `${link.target} is at version ${target.version}, not ${link.targetVersion}.`);
        supersedes.push(target);
      }
    }

    const authorization = authorizeJuliusBrainWrite({
      principal: input.principal, draft, grant: input.grant, now: input.recordedAt,
      subject: current === null ? null : { kind: current.kind, createdBy: current.createdBy, body: current.body },
      supersedes: supersedes.map((target) => ({ kind: target.kind, createdBy: target.createdBy, body: target.body })),
    });
    if (!authorization.allowed) return refuse(index, authorization.reasonCode, authorization.detail);
    if ((actor === 'TOOL' || actor === 'ENVIRONMENT') && input.grant !== null) {
      grantWrites += 1;
      if (grantWrites > input.grant.maxRecords) return refuse(index, 'grant_record_limit', `The grant allows ${input.grant.maxRecords} records.`);
    }

    const sequence = head.sequence + 1;
    const recordId = juliusBrainRecordId(brainId, draft.idempotencyKey);
    const base = {
      ...juliusBrainDraftOf(draft),
      schemaVersion: JULIUS_BRAIN_SCHEMA_VERSION,
      brainId, recordId, entityId,
      entityVersion: current === null ? 1 : current.version + 1,
      principal: input.principal,
      fingerprint,
    };
    const contentHash = juliusBrainContentHash(base);
    const record: JuliusBrainRecord = {
      ...base, sequence, contentHash, recordedAt: input.recordedAt,
      chainHash: juliusBrainChainHash(head.chainHash, sequence, recordId, contentHash),
    };
    records.push(record);
    head = { sequence, chainHash: record.chainHash };
    batchKeys.set(draft.idempotencyKey, { recordId, fingerprint, entityId, entityVersion: record.entityVersion, sequence, kind: draft.kind });
    receipts.push({ outcome: 'APPENDED', recordId, entityId, entityVersion: record.entityVersion, sequence, kind: draft.kind });
    applyJuliusBrainRecord({ get: lookup, set: (id, state) => overlay.set(id, state) }, record);
  }

  const entities = [...overlay.values()].filter((state): state is JuliusBrainEntityState => state !== null)
    .sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
  return { outcome: 'APPLY', records, entities, receipts, head };
}

/* ----------------------------------------------------------------- groups */

export interface JuliusBrainCommitGroup {
  readonly principal: JuliusBrainPrincipal;
  readonly grant: JuliusBrainWriteGrant | null;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly secretLiterals?: readonly string[];
}

export type JuliusBrainGroupPlan =
  | {
    readonly outcome: 'APPLY';
    readonly records: readonly JuliusBrainRecord[];
    readonly entities: readonly JuliusBrainEntityState[];
    /** Receipts per group, in group order. */
    readonly receipts: readonly (readonly JuliusBrainReceipt[])[];
    readonly head: JuliusBrainHead;
  }
  | (JuliusBrainRefusal & { readonly group: number });

/**
 * SEVERAL PRINCIPALS, ONE ATOMIC WRITE. Each group is planned by the ordinary
 * single-principal planner against the state the groups before it produced,
 * so a later group may link to what an earlier one created, and any refusal
 * refuses everything. This is how a Python settlement writes Julius's own
 * execution record and the tool's proposals together.
 */
export function planJuliusBrainGroups(input: {
  readonly brain: JuliusBrainIdentity;
  readonly head: JuliusBrainHead;
  readonly recordedAt: string;
  readonly groups: readonly JuliusBrainCommitGroup[];
  readonly entities: ReadonlyMap<string, JuliusBrainEntityState | null>;
  readonly idempotency: ReadonlyMap<string, JuliusBrainIdempotencyHit | null>;
  readonly grantUsage: ReadonlyMap<string, number>;
}): JuliusBrainGroupPlan {
  if (input.groups.length === 0) return { ...refuse(0, 'empty_batch', 'A commit carries at least one group.'), group: 0 };
  let head = input.head;
  const entities = new Map(input.entities);
  const idempotency = new Map(input.idempotency);
  const grantUsage = new Map(input.grantUsage);
  const records: JuliusBrainRecord[] = [];
  const changed = new Map<string, JuliusBrainEntityState>();
  const receipts: (readonly JuliusBrainReceipt[])[] = [];
  for (let group = 0; group < input.groups.length; group += 1) {
    const { principal, grant, drafts, secretLiterals } = input.groups[group]!;
    const plan = planJuliusBrainAppend({
      brain: input.brain, head, principal, drafts, grant, recordedAt: input.recordedAt, entities, idempotency,
      grantUsage: grant === null ? 0 : grantUsage.get(grant.grantId) ?? 0, secretLiterals,
    });
    if (plan.outcome === 'REFUSED') return { ...plan, group };
    records.push(...plan.records);
    for (const state of plan.entities) { entities.set(state.entityId, state); changed.set(state.entityId, state); }
    for (const record of plan.records) {
      idempotency.set(record.idempotencyKey, { recordId: record.recordId, fingerprint: record.fingerprint, entityId: record.entityId, entityVersion: record.entityVersion, sequence: record.sequence, kind: record.kind });
    }
    if (grant !== null) grantUsage.set(grant.grantId, (grantUsage.get(grant.grantId) ?? 0) + plan.records.length);
    receipts.push(plan.receipts);
    head = plan.head;
  }
  return { outcome: 'APPLY', records, entities: [...changed.values()].sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)), receipts, head };
}

/* ------------------------------------------------------------------- fold */

export interface JuliusBrainEntityAccess {
  get(entityId: string): JuliusBrainEntityState | null;
  set(entityId: string, state: JuliusBrainEntityState): void;
}

const sortInbound = (items: JuliusBrainInboundLink[]): JuliusBrainInboundLink[] =>
  items.sort((a, b) => a.relation.localeCompare(b.relation) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

/**
 * FOLD ONE RECORD. Assumes the record was admitted by the planner; it neither
 * authorises nor validates, which is what lets a rebuild reproduce the exact
 * rows the planner persisted.
 */
export function applyJuliusBrainRecord(access: JuliusBrainEntityAccess, record: JuliusBrainRecord): void {
  const current = access.get(record.entityId);
  const retiring = record.op === 'RETIRE';
  const previousLinks = current?.links ?? [];
  const nextLinks = retiring ? previousLinks : record.links;

  const next: JuliusBrainEntityState = {
    brainId: record.brainId,
    entityId: record.entityId,
    kind: record.kind,
    version: record.entityVersion,
    recordId: record.recordId,
    recordIds: [...(current?.recordIds ?? []), record.recordId],
    createdSequence: current?.createdSequence ?? record.sequence,
    updatedSequence: record.sequence,
    createdAt: current?.createdAt ?? record.occurredAt,
    updatedAt: record.occurredAt,
    createdBy: current?.createdBy ?? record.principal,
    updatedBy: record.principal,
    lifecycle: retiring ? 'RETIRED' : (current?.lifecycle ?? 'ACTIVE'),
    supersededBy: current?.supersededBy ?? null,
    retirement: retiring
      ? { reason: String(record.body.reason), disposition: record.body.disposition as JuliusBrainRetirementDisposition, recordId: record.recordId }
      : (current?.retirement ?? null),
    body: retiring ? (current?.body ?? {}) : record.body,
    links: nextLinks,
    inbound: current?.inbound ?? [],
    scope: record.scope,
    retention: retiring ? (current?.retention ?? record.retention) : record.retention,
    confidence: retiring ? (current?.confidence ?? null) : record.confidence,
    sensitivity: retiring ? (current?.sensitivity ?? record.sensitivity) : record.sensitivity,
    provenance: retiring ? (current?.provenance ?? record.provenance) : record.provenance,
  };
  access.set(record.entityId, next);

  if (retiring) return;

  // RE-POINT INBOUND LINKS. Targets this version no longer names lose the
  // edge; targets it names gain it. The edge set always describes current
  // versions, and the records keep every edge that ever existed.
  const key = (link: JuliusBrainLink) => `${link.relation} ${link.target}`;
  const before = new Set(previousLinks.map(key));
  const after = new Set(nextLinks.map(key));
  for (const link of previousLinks) {
    if (after.has(key(link))) continue;
    const target = access.get(link.target);
    if (target === null) continue;
    access.set(link.target, { ...target, inbound: target.inbound.filter((edge) => !(edge.relation === link.relation && edge.source === record.entityId)) });
  }
  for (const link of nextLinks) {
    const target = access.get(link.target);
    if (target === null) continue;
    const inbound = before.has(key(link))
      ? target.inbound
      : sortInbound([...target.inbound, { relation: link.relation, source: record.entityId, sourceKind: record.kind }]);
    const superseded = link.relation === 'SUPERSEDES' && !before.has(key(link));
    access.set(link.target, {
      ...target, inbound,
      ...(superseded ? { lifecycle: 'SUPERSEDED' as const, supersededBy: record.entityId } : {}),
    });
  }
}

export interface JuliusBrainProjection {
  readonly brainId: string;
  readonly head: JuliusBrainHead;
  readonly entities: ReadonlyMap<string, JuliusBrainEntityState>;
}

/** Current state from the ledger alone. Records must be this brain's, in sequence order. */
export function projectJuliusBrain(brainId: string, records: readonly JuliusBrainRecord[], until?: number): JuliusBrainProjection {
  const entities = new Map<string, JuliusBrainEntityState>();
  let head: JuliusBrainHead = { sequence: 0, chainHash: juliusBrainGenesisHash(brainId) };
  for (const record of records) {
    if (until !== undefined && record.sequence > until) break;
    applyJuliusBrainRecord({ get: (id) => entities.get(id) ?? null, set: (id, state) => entities.set(id, state) }, record);
    head = { sequence: record.sequence, chainHash: record.chainHash };
  }
  return { brainId, head, entities };
}

/** A stable hash of current state: the thing a checkpoint pins and a restore must reproduce. */
export function juliusBrainStateHash(entities: Iterable<JuliusBrainEntityState>): string {
  const sorted = [...entities].sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  return juliusBrainSha256(canonicalJuliusBrainJson(sorted));
}

export interface JuliusBrainLedgerVerification {
  readonly ok: boolean;
  readonly checkedRecords: number;
  readonly head: JuliusBrainHead;
  readonly problems: readonly string[];
  readonly stateHash: string;
}

/**
 * RE-DERIVE EVERYTHING AND COMPARE. Sequence continuity, every content hash,
 * every chain link, every fingerprint, and — when `materialised` is supplied —
 * that the stored entity rows are exactly the projection of the ledger.
 */
export function verifyJuliusBrainLedger(brainId: string, records: readonly JuliusBrainRecord[], materialised?: Iterable<JuliusBrainEntityState>): JuliusBrainLedgerVerification {
  const problems: string[] = [];
  let previous = juliusBrainGenesisHash(brainId);
  records.forEach((record, index) => {
    const expectedSequence = index + 1;
    if (record.brainId !== brainId) problems.push(`record ${record.recordId}: belongs to ${record.brainId}`);
    if (record.sequence !== expectedSequence) problems.push(`sequence ${expectedSequence}: found ${record.sequence}`);
    if (juliusBrainContentHash(record) !== record.contentHash) problems.push(`record ${record.recordId}: content hash mismatch`);
    if (juliusBrainChainHash(previous, record.sequence, record.recordId, record.contentHash) !== record.chainHash) problems.push(`record ${record.recordId}: chain hash mismatch`);
    if (juliusBrainFingerprint(record, record.principal) !== record.fingerprint) problems.push(`record ${record.recordId}: fingerprint mismatch`);
    previous = record.chainHash;
  });
  const projection = projectJuliusBrain(brainId, records);
  const stateHash = juliusBrainStateHash(projection.entities.values());
  if (materialised !== undefined) {
    const stored = juliusBrainStateHash(materialised);
    if (stored !== stateHash) problems.push('materialised entities differ from the projection of the ledger');
  }
  return { ok: problems.length === 0, checkedRecords: records.length, head: projection.head, problems, stateHash };
}
