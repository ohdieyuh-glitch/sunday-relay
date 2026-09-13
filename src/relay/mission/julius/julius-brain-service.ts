import {
  JULIUS_BRAIN_RECORD_KINDS,
  JULIUS_BRAIN_SCHEMA_VERSION,
  juliusBrainProvenance,
  juliusBrainScope,
  type JuliusBrainBody,
  type JuliusBrainDraft,
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
import {
  juliusBrainPrincipalClass,
  juliusBrainReadable,
  type JuliusBrainReadGrant,
  type JuliusBrainWriteGrant,
} from './julius-brain-policy';
import {
  juliusBrainStateHash,
  verifyJuliusBrainLedger,
  type JuliusBrainEntityState,
  type JuliusBrainLedgerVerification,
  type JuliusBrainLifecycle,
} from './julius-brain-projection';
import {
  readAllJuliusBrainEntities,
  readAllJuliusBrainRecords,
  type JuliusBrainCommitResult,
  type JuliusBrainEntityFilter,
  type JuliusBrainStore,
} from './julius-brain-store';
import type { JuliusClock } from './julius-runtime-ports';
import type { JuliusMemoryProvenance } from './julius-memory-trust';

/**
 * THE GOVERNED PROJECT BRAIN API.
 *
 * Nothing reaches the store except through a HANDLE, and a handle is opened for
 * one principal by the composition root that authenticated it. The handle can
 * only write as that principal and only read what that principal's read grant
 * admits, so "which worker wrote this" and "which worker could see that" are
 * facts about the wiring, not about the good behaviour of callers.
 *
 * WRITES ANNOUNCE FACTS. A write returns `COMMITTED` only after the store's
 * atomic commit resolved, with the receipts it produced; a refusal carries a
 * reason code and wrote nothing.
 */

export interface JuliusBrainWriteOptions {
  /** Deterministic per source. The same key with the same content is a replay. */
  readonly key: string;
  readonly entityId?: string | null;
  readonly scope?: Partial<JuliusBrainScope>;
  readonly links?: readonly JuliusBrainLink[];
  readonly confidence?: number | null;
  readonly retention?: JuliusBrainRetention;
  readonly sensitivity?: JuliusBrainSensitivity;
  readonly provenance?: JuliusBrainProvenance;
  readonly occurredAt?: string;
}

export const juliusLink = (relation: JuliusBrainLinkRelation, target: string, targetVersion: number | null = null): JuliusBrainLink =>
  ({ relation, target, targetVersion });

/** The provenance source a principal's own writes carry by default. */
function defaultSource(principal: JuliusBrainPrincipal): JuliusMemoryProvenance {
  switch (juliusBrainPrincipalClass(principal)) {
    case 'USER': return 'user_stated';
    case 'TOOL': case 'ENVIRONMENT': return 'tool_observed';
    case 'INDEPENDENT_REVIEWER': return 'reviewer_verified';
    case 'SYSTEM': return 'system_policy';
    case 'JULIUS': return 'run_observed';
    default: return 'derived_candidate';
  }
}

export function defaultJuliusBrainReadGrant(principal: JuliusBrainPrincipal, brainId: string): JuliusBrainReadGrant {
  const actor = juliusBrainPrincipalClass(principal);
  const full = actor === 'JULIUS' || actor === 'USER' || actor === 'SYSTEM';
  if (actor === 'TOOL' || actor === 'ENVIRONMENT') {
    // A tool reads nothing it was not explicitly granted.
    return { grantId: `default:${principal.id}`, brainId, kinds: [], missionIds: [], taskIds: [], includeHistory: false, includeRestricted: false };
  }
  return { grantId: `default:${principal.id}`, brainId, kinds: JULIUS_BRAIN_RECORD_KINDS, missionIds: null, taskIds: null, includeHistory: true, includeRestricted: full };
}

export interface JuliusBrainHistoryPage {
  readonly records: readonly JuliusBrainRecord[];
  readonly hasMore: boolean;
  /** Records in the page range this principal may not see. Counted, never silent. */
  readonly omitted: number;
  readonly nextAfterSequence: number;
}

export interface JuliusBrainProvenanceView {
  readonly entity: JuliusBrainEntityState;
  readonly versions: readonly {
    readonly recordId: string; readonly sequence: number; readonly entityVersion: number; readonly op: string;
    readonly principal: JuliusBrainPrincipal; readonly provenance: JuliusBrainProvenance;
    readonly occurredAt: string; readonly recordedAt: string; readonly contentHash: string; readonly chainHash: string;
  }[];
  /** What this entity was derived from, transitively (depth-bounded). */
  readonly derivation: readonly { readonly relation: JuliusBrainLinkRelation; readonly from: string; readonly to: string; readonly depth: number; readonly lifecycle: JuliusBrainLifecycle | 'UNREADABLE' | 'MISSING' }[];
  /** What points at this entity from other entities' current versions. */
  readonly inbound: readonly { readonly relation: JuliusBrainLinkRelation; readonly source: string; readonly sourceLifecycle: JuliusBrainLifecycle | 'UNREADABLE' | 'MISSING' }[];
  /** Entities this one superseded, newest first, and the one that superseded it. */
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
}

export type JuliusBrainWriteResult = JuliusBrainCommitResult;

export interface JuliusBrainHandle {
  readonly brain: JuliusBrainIdentity;
  readonly principal: JuliusBrainPrincipal;
  readonly readGrant: JuliusBrainReadGrant;

  /* ------------------------------------------------------------ writes */
  commit(drafts: readonly JuliusBrainDraft[]): Promise<JuliusBrainCommitResult>;
  draft(kind: JuliusBrainRecordKind, body: JuliusBrainBody, options: JuliusBrainWriteOptions): JuliusBrainDraft;
  create(kind: JuliusBrainRecordKind, body: JuliusBrainBody, options: JuliusBrainWriteOptions): Promise<JuliusBrainWriteResult>;
  revise(entityId: string, body: JuliusBrainBody, options: JuliusBrainWriteOptions & { readonly expectedVersion: number }): Promise<JuliusBrainWriteResult>;
  retire(entityId: string, input: { readonly reason: string; readonly disposition: JuliusBrainRetirementDisposition; readonly expectedVersion: number; readonly key: string; readonly occurredAt?: string }): Promise<JuliusBrainWriteResult>;
  /** A new entity of the same kind that SUPERSEDES `entityId` (pinned to the version the caller read). */
  supersede(entityId: string, expectedVersion: number, body: JuliusBrainBody, options: JuliusBrainWriteOptions): Promise<JuliusBrainWriteResult>;
  checkpoint(label: string): Promise<JuliusBrainWriteResult>;

  /* ------------------------------------------------------------- reads */
  entities(filter?: JuliusBrainEntityFilter): Promise<readonly JuliusBrainEntityState[]>;
  entity(entityId: string): Promise<JuliusBrainEntityState | null>;
  /** ACTIVE entities of a kind, optionally within a mission (Brain-level entities included). */
  current(kind: JuliusBrainRecordKind, missionId?: string): Promise<readonly JuliusBrainEntityState[]>;
  history(query?: { readonly afterSequence?: number; readonly limit?: number; readonly entityId?: string; readonly kinds?: readonly JuliusBrainRecordKind[] }): Promise<JuliusBrainHistoryPage>;
  provenance(entityId: string, depth?: number): Promise<JuliusBrainProvenanceView | null>;
  verify(): Promise<JuliusBrainLedgerVerification>;
}

export interface JuliusProjectBrainService {
  initialize(input: { readonly brainId: string; readonly projectId: string; readonly title: string; readonly principal: JuliusBrainPrincipal }): Promise<{ readonly created: boolean; readonly brain: JuliusBrainIdentity }>;
  /** Null when the Brain does not exist in this project. */
  open(input: {
    readonly brainId: string; readonly projectId: string; readonly principal: JuliusBrainPrincipal;
    readonly writeGrant?: JuliusBrainWriteGrant | null; readonly readGrant?: JuliusBrainReadGrant | null;
    readonly secretLiterals?: readonly string[];
  }): Promise<JuliusBrainHandle | null>;
}

export function createJuliusProjectBrainService(deps: { readonly store: JuliusBrainStore; readonly clock: JuliusClock }): JuliusProjectBrainService {
  return {
    async initialize(input) {
      if (!['JULIUS', 'USER'].includes(input.principal.kind)) throw new Error('julius_brain_initialize_requires_authority');
      return deps.store.createBrain({
        brainId: input.brainId, projectId: input.projectId, title: input.title,
        createdBy: input.principal, createdAt: deps.clock.now(), schemaVersion: JULIUS_BRAIN_SCHEMA_VERSION,
      });
    },

    async open(input) {
      const brain = await deps.store.loadBrain(input.brainId, input.projectId);
      if (brain === null) return null;
      const readGrant = input.readGrant ?? defaultJuliusBrainReadGrant(input.principal, brain.brainId);
      if (readGrant.brainId !== brain.brainId) throw new Error('julius_brain_read_grant_brain_mismatch');
      const writeGrant = input.writeGrant ?? null;
      if (writeGrant !== null && writeGrant.brainId !== brain.brainId) throw new Error('julius_brain_write_grant_brain_mismatch');
      return createHandle({ store: deps.store, clock: deps.clock, brain, principal: input.principal, readGrant, writeGrant, secretLiterals: input.secretLiterals ?? [] });
    },
  };
}

function createHandle(ctx: {
  store: JuliusBrainStore; clock: JuliusClock; brain: JuliusBrainIdentity; principal: JuliusBrainPrincipal;
  readGrant: JuliusBrainReadGrant; writeGrant: JuliusBrainWriteGrant | null; secretLiterals: readonly string[];
}): JuliusBrainHandle {
  const { store, brain, principal, readGrant } = ctx;
  const readable = (state: { kind: JuliusBrainRecordKind; scope: JuliusBrainScope; sensitivity: JuliusBrainSensitivity }) =>
    juliusBrainReadable({ grant: readGrant, kind: state.kind, scope: state.scope, sensitivity: state.sensitivity });

  const draft = (kind: JuliusBrainRecordKind, body: JuliusBrainBody, options: JuliusBrainWriteOptions, op: JuliusBrainDraft['op'] = 'CREATE', expectedVersion = 0): JuliusBrainDraft => ({
    kind, op, entityId: options.entityId ?? null, expectedVersion, body,
    links: options.links ?? [],
    scope: juliusBrainScope(options.scope),
    retention: options.retention ?? 'DURABLE',
    confidence: options.confidence ?? null,
    sensitivity: options.sensitivity ?? 'INTERNAL',
    provenance: options.provenance ?? juliusBrainProvenance(defaultSource(principal)),
    idempotencyKey: options.key,
    occurredAt: options.occurredAt ?? ctx.clock.now(),
  });

  const commit = (drafts: readonly JuliusBrainDraft[]) => store.commit({
    brainId: brain.brainId, projectId: brain.projectId, principal, drafts, grant: ctx.writeGrant,
    recordedAt: ctx.clock.now(), secretLiterals: ctx.secretLiterals,
  });

  const entity = async (entityId: string): Promise<JuliusBrainEntityState | null> => {
    const [state] = await store.entities(brain.brainId, brain.projectId, { entityIds: [entityId], limit: 1 });
    return state !== undefined && readable(state) ? state : null;
  };

  return {
    brain, principal, readGrant,
    commit,
    draft: (kind, body, options) => draft(kind, body, options),
    create: (kind, body, options) => commit([draft(kind, body, options)]),

    async revise(entityId, body, options) {
      const current = await entity(entityId);
      if (current === null) return { outcome: 'REFUSED', index: 0, reasonCode: 'entity_not_found', detail: `${entityId} does not exist or is not readable.` };
      return commit([draft(current.kind, body, {
        ...options, entityId,
        scope: current.scope,
        links: options.links ?? current.links,
        confidence: options.confidence === undefined ? current.confidence : options.confidence,
        retention: options.retention ?? current.retention,
        sensitivity: options.sensitivity ?? current.sensitivity,
      }, 'REVISE', options.expectedVersion)]);
    },

    async retire(entityId, input) {
      const current = await entity(entityId);
      if (current === null) return { outcome: 'REFUSED', index: 0, reasonCode: 'entity_not_found', detail: `${entityId} does not exist or is not readable.` };
      return commit([draft(current.kind, { reason: input.reason, disposition: input.disposition }, {
        key: input.key, entityId, scope: current.scope, links: [], confidence: current.confidence,
        retention: current.retention, sensitivity: current.sensitivity, occurredAt: input.occurredAt,
      }, 'RETIRE', input.expectedVersion)]);
    },

    async supersede(entityId, expectedVersion, body, options) {
      const current = await entity(entityId);
      if (current === null) return { outcome: 'REFUSED', index: 0, reasonCode: 'entity_not_found', detail: `${entityId} does not exist or is not readable.` };
      const links = [...(options.links ?? []).filter((link) => !(link.relation === 'SUPERSEDES' && link.target === entityId)), juliusLink('SUPERSEDES', entityId, expectedVersion)];
      return commit([draft(current.kind, body, { scope: current.scope, ...options, links })]);
    },

    async checkpoint(label) {
      const records = await readAllJuliusBrainRecords(store, brain.brainId, brain.projectId);
      const materialised = await readAllJuliusBrainEntities(store, brain.brainId, brain.projectId);
      const verification = verifyJuliusBrainLedger(brain.brainId, records, materialised);
      // A checkpoint pins a state that was VERIFIED, never one merely read.
      if (!verification.ok) return { outcome: 'REFUSED', index: 0, reasonCode: 'ledger_invalid', detail: verification.problems.slice(0, 4).join('; ') };
      return commit([draft('CHECKPOINT', {
        label, throughSequence: verification.head.sequence, stateHash: verification.stateHash, entityCount: materialised.length,
      }, { key: `checkpoint:${label}:${verification.head.sequence}` })]);
    },

    async entities(filter = {}) {
      return (await store.entities(brain.brainId, brain.projectId, filter)).filter(readable);
    },

    entity,

    async current(kind, missionId) {
      const states = await store.entities(brain.brainId, brain.projectId, { kinds: [kind], lifecycles: ['ACTIVE'] });
      return states.filter((state) => readable(state) && (missionId === undefined || state.scope.missionId === null || state.scope.missionId === missionId))
        .sort((a, b) => a.createdSequence - b.createdSequence);
    },

    async history(query = {}) {
      if (!readGrant.includeHistory) return { records: [], hasMore: false, omitted: 0, nextAfterSequence: query.afterSequence ?? 0 };
      const page = await store.records(brain.brainId, brain.projectId, {
        afterSequence: query.afterSequence ?? 0, limit: query.limit ?? 200, entityId: query.entityId, kinds: query.kinds,
      });
      const visible = page.records.filter(readable);
      const last = page.records[page.records.length - 1];
      return { records: visible, hasMore: page.hasMore, omitted: page.records.length - visible.length, nextAfterSequence: last?.sequence ?? (query.afterSequence ?? 0) };
    },

    async provenance(entityId, depth = 4) {
      const root = await entity(entityId);
      if (root === null) return null;
      const versions = (await store.records(brain.brainId, brain.projectId, { afterSequence: 0, limit: 5_000, entityId })).records.map((record) => ({
        recordId: record.recordId, sequence: record.sequence, entityVersion: record.entityVersion, op: record.op,
        principal: record.principal, provenance: record.provenance, occurredAt: record.occurredAt, recordedAt: record.recordedAt,
        contentHash: record.contentHash, chainHash: record.chainHash,
      }));
      const cache = new Map<string, JuliusBrainEntityState | null>([[root.entityId, root]]);
      const load = async (id: string): Promise<JuliusBrainEntityState | null | 'UNREADABLE'> => {
        if (!cache.has(id)) {
          const [state] = await store.entities(brain.brainId, brain.projectId, { entityIds: [id], limit: 1 });
          cache.set(id, state ?? null);
        }
        const state = cache.get(id) ?? null;
        if (state === null) return null;
        return readable(state) ? state : 'UNREADABLE';
      };
      const DERIVATION: readonly JuliusBrainLinkRelation[] = ['DERIVED_FROM', 'EVIDENCED_BY', 'SUPPORTS', 'PRODUCED_BY', 'ANSWERS', 'RESOLVES', 'REPAIRS', 'SUPERSEDES'];
      const derivation: JuliusBrainProvenanceView['derivation'][number][] = [];
      const seen = new Set<string>([root.entityId]);
      let frontier: JuliusBrainEntityState[] = [root];
      for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
        const next: JuliusBrainEntityState[] = [];
        for (const state of frontier) {
          for (const link of state.links.filter((candidate) => DERIVATION.includes(candidate.relation))) {
            const target = await load(link.target);
            derivation.push({ relation: link.relation, from: state.entityId, to: link.target, depth: level, lifecycle: target === null ? 'MISSING' : target === 'UNREADABLE' ? 'UNREADABLE' : target.lifecycle });
            if (target !== null && target !== 'UNREADABLE' && !seen.has(target.entityId)) { seen.add(target.entityId); next.push(target); }
          }
        }
        frontier = next;
      }
      const inbound = [];
      for (const edge of root.inbound) {
        const source = await load(edge.source);
        inbound.push({ relation: edge.relation, source: edge.source, sourceLifecycle: source === null ? 'MISSING' as const : source === 'UNREADABLE' ? 'UNREADABLE' as const : source.lifecycle });
      }
      const supersedes: string[] = [];
      let cursor: JuliusBrainEntityState | null = root;
      while (cursor !== null && supersedes.length < 64) {
        const link: JuliusBrainLink | undefined = cursor.links.find((candidate) => candidate.relation === 'SUPERSEDES');
        if (link === undefined) break;
        supersedes.push(link.target);
        const loaded = await load(link.target);
        cursor = loaded === null || loaded === 'UNREADABLE' ? null : loaded;
      }
      return { entity: root, versions, derivation, inbound, supersedes, supersededBy: root.supersededBy };
    },

    async verify() {
      const records = await readAllJuliusBrainRecords(store, brain.brainId, brain.projectId);
      return verifyJuliusBrainLedger(brain.brainId, records, await readAllJuliusBrainEntities(store, brain.brainId, brain.projectId));
    },
  };
}

/** The hash of a Brain's current state as a store holds it — what a checkpoint pins. */
export async function juliusBrainStoredStateHash(store: JuliusBrainStore, brainId: string, projectId: string): Promise<string> {
  return juliusBrainStateHash(await readAllJuliusBrainEntities(store, brainId, projectId));
}
