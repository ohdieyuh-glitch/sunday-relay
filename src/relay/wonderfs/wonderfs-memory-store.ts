/**
 * WONDERFS IN MEMORY (R0b): the reference engine behind `WfsStore`, for the bridge's handler tests and the loopback dev server.
 * NEVER a deployment store: nothing here outlives the process (INV-11 is the PostgreSQL store's, persistence/wonderfs-postgres.ts).
 *
 * It is the PostgreSQL store's twin, on purpose: the engine decides every change (the same calls, in the same order, with the
 * same ids drawn), and this store keeps exactly what it decided -- the same lifecycle events, the same stored approvals, the
 * same 036 conflict statuses, and blob presence read from its OWN blob table at the moment of the change. Reads go through the
 * same checks, order, cursors and page bounds (wonderfs-store.ts). The conformance cases (persistence/wonderfs-store-
 * conformance.ts) run against both; a behaviour only one of them has is the drift they exist to catch.
 *
 * The product rows WonderFS sits beside are modelled too: a project must be KNOWN (`seedProject`, the `projects` row) before it
 * gets a file environment, and a member's role is the PRODUCT's value (OWNER / ADMIN / MEMBER, or anything a writer stored),
 * read through the one mapping (`wfsHumanRoleFromMembership`).
 *
 * Several store objects may share one `WfsMemoryBacking` (two "bridges" over one database). Every call is synchronous inside,
 * so each change is atomic and each read sees one state.
 */

import { createHash, randomUUID } from 'node:crypto';

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { wfsHumanRoleFromMembership } from './wonderfs-authz';
import { wfsGenesisHash } from './wonderfs-canonical';
import { WFS_ALPHA_LIMITS, type WfsCommit, type WfsConflict, type WfsEntry, type WfsLimits, type WfsMergeApproval } from './wonderfs-contracts';
import {
  applyWfsCommit,
  discardWfsBranch,
  emptyWfsProject,
  forkWfsBranch,
  issueWfsApproval,
  mergeBackWfsBranch,
  wfsEntriesAt,
  WFS_MAIN_BRANCH,
  type WfsEngineContext,
  type WfsProjectState,
} from './wonderfs-engine';
import {
  wfsAdmitCommit,
  wfsAdmitWrite,
  wfsConflictLimits,
  wfsConflictLimitsApply,
  wfsConflictRetained,
  wfsBlobIntegrity,
  wfsBlobRoom,
  wfsBlobsNamed,
  wfsBoundPage,
  wfsCheckUpload,
  wfsHashMismatch,
  wfsSha256InSlices,
  wfsCheckChangesQuery,
  wfsCheckConflictsQuery,
  wfsCheckEventsQuery,
  wfsCheckFileAtQuery,
  wfsCheckHistoryQuery,
  wfsCheckProjectsQuery,
  wfsCheckSha256,
  wfsCheckTreeQuery,
  wfsCompareEntries,
  wfsCompareKeys,
  wfsConflictClosing,
  wfsEncodeTreeCursor,
  wfsIso,
  wfsNotFound,
  wfsOutcomeEvent,
  type WfsBlobInfo,
  type WfsBlobIntegrity,
  type WfsChangesPage,
  type WfsConflictClosing,
  type WfsConflictsPage,
  type WfsConflictTally,
  type WfsConflictSummary,
  type WfsConflictView,
  type WfsEventRecord,
  type WfsEventsPage,
  type WfsFileAt,
  type WfsFileVersion,
  type WfsHistoryPage,
  type WfsMemberProject,
  type WfsProjectHead,
  type WfsProjectsPage,
  type WfsReferencedBlob,
  type WfsStore,
  type WfsStoreEvent,
  type WfsTreePage,
} from './wonderfs-store';

export interface WfsMemoryProject {
  state: WfsProjectState;
  readonly events: WfsEventRecord[];
  /** wfs_approvals: by approval id. */
  readonly approvals: Map<string, WfsMergeApproval>;
  /** wfs_conflicts' status / closed_at / retain_until, decided when the change that touched the conflict was kept. */
  readonly closings: Map<string, WfsConflictClosing>;
  /** wfs_blobs + wfs_blob_bytes. */
  readonly blobs: Map<string, Uint8Array>;
}

/** What several memory stores may share: the product's projects and members, and every WonderFS project. */
export interface WfsMemoryBacking {
  /** relay_wonderland.projects + project_members: project id -> player id -> the PRODUCT's role value. */
  readonly products: Map<string, Map<string, string>>;
  readonly projects: Map<string, WfsMemoryProject>;
}

export function wfsMemoryBacking(): WfsMemoryBacking {
  return { products: new Map(), projects: new Map() };
}

export interface WfsMemoryOptions {
  readonly backing?: WfsMemoryBacking;
  readonly limits?: WfsLimits;
  /** Ids for files, commits, conflicts, branches and approvals (default: random UUIDs, prefixed by kind). */
  readonly newId?: (kind: 'file' | 'commit' | 'conflict' | 'branch' | 'approval') => string;
}

export interface WfsMemoryStore extends WfsStore {
  readonly backing: WfsMemoryBacking;
  /** The product's `projects` row (and optionally its members), which a WonderFS project needs first. */
  seedProject(projectId: string, members?: Readonly<Record<string, string>>): void;
  /** Write (or, with null, remove) a member's PRODUCT role value, exactly as a product writer would store it. */
  setMemberRole(projectId: string, playerId: string, productRole: string | null): void;
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** A copy through JSON, as a jsonb column would give it back: no caller ever holds this store's own objects. */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const noProject = (): RelayResult<never> => fail(relayError('not-found', 'No such project.', { details: ['wonderfs: unknown project'] }));

export function openWfsMemoryStore(options: WfsMemoryOptions = {}): WfsMemoryStore {
  const backing = options.backing ?? wfsMemoryBacking();
  const limits = options.limits ?? WFS_ALPHA_LIMITS;
  const newId = options.newId ?? ((kind) => `${kind}_${randomUUID()}`);

  const roleOf = (projectId: string, playerId: string) => wfsHumanRoleFromMembership(backing.products.get(projectId)?.get(playerId));

  /** One change: decide on the current state, then keep exactly what was decided (or nothing, for a refusal or a replay). */
  const mutate = <T>(
    projectId: string,
    nowIso: string,
    decide: (p: WfsMemoryProject, ctx: WfsEngineContext) => RelayResult<{ state: WfsProjectState; value: T; event: WfsStoreEvent | null; approval?: WfsMergeApproval }>,
  ): Promise<RelayResult<T>> => {
    const p = backing.projects.get(projectId);
    if (p === undefined) return Promise.resolve(noProject());
    // blob presence: this project's blob table NOW (the PostgreSQL store reads wfs_blobs inside the change, never a cache)
    const ctx: WfsEngineContext = { nowIso, newId: (kind) => newId(kind), sha256Hex, blobSize: (sha) => p.blobs.get(sha)?.byteLength ?? null, limits };
    const decided = decide(p, ctx);
    if (!decided.ok) return Promise.resolve(decided);
    const { state: next, value, event, approval } = decided.value;
    if (next === p.state && event === null) return Promise.resolve(ok(value)); // a replay: nothing to keep
    for (const [conflictId, c] of next.conflicts) {
      if (p.state.conflicts.get(conflictId) !== c) p.closings.set(conflictId, wfsConflictClosing(c, next.branches, nowIso));
    }
    if (approval !== undefined) p.approvals.set(approval.approvalId, { ...approval, approvedAtIso: wfsIso(approval.approvedAtIso) });
    if (event !== null) p.events.push({ seq: p.events.length + 1, kind: event.kind, body: viaJson(event.body), atIso: wfsIso(nowIso) });
    p.state = next;
    return Promise.resolve(ok(value));
  };

  /**
   * A read of one project: its state as it is NOW (one immutable object), or the uniform not-found. The answer is a COPY through
   * JSON, as PostgreSQL's rows and jsonb give one back: a caller editing it changes nothing here, and an `undefined` member reads
   * as absent in both stores alike.
   */
  const read = <T>(projectId: string, work: (p: WfsMemoryProject) => RelayResult<T>): Promise<RelayResult<T>> => {
    const p = backing.projects.get(projectId);
    if (p === undefined) return Promise.resolve(wfsNotFound('unknown project'));
    const r = work(p);
    return Promise.resolve(r.ok ? ok(viaJson(r.value)) : r);
  };

  const closingOf = (p: WfsMemoryProject, c: WfsConflict): WfsConflictClosing => p.closings.get(c.conflictId) ?? wfsConflictClosing(c, p.state.branches, c.atIso);

  /** Whether a file's history names `sha`: any branch's versions, current entries or fork-time base. */
  const inHistory = (p: WfsMemoryProject, sha: string): boolean => {
    const named = (e: WfsEntry) => e.sha256 === sha;
    return [...p.state.branches.values()].some((b) => [...b.entries.values()].some(named) || [...b.base.values()].some(named) || b.commits.some((c) => c.touched.some(named)));
  };

  /**
   * Whether anything of this project names `sha` at `nowIso`: a file's history, or a conflict while it is RETAINED -- open, or closed
   * less than its 30 days ago (K2, contract r1.6.2 r2: the same rule as the PostgreSQL store's BLOB_REFERENCE_SQL). Worked out whether
   * or not the blob is held.
   */
  const referencedIn = (p: WfsMemoryProject, sha: string, nowIso: string): boolean =>
    inHistory(p, sha) || [...p.state.conflicts.values()].some((c) => wfsConflictRetained(closingOf(p, c), nowIso) && wfsBlobsNamed(c.ops).includes(sha));
  /** The read clock (K2): a reader asks NOW, as the PostgreSQL store's `now()` does. */
  const readNow = (): string => new Date().toISOString();

  /**
   * R2 (§19.m3): main's live file bytes, and as PENDING the bytes of every held blob no file's history names -- an orphan, or (R2-r2,
   * security MAJOR-3) one only a conflict names: a conflict-held upload counts against the room until a file takes it.
   */
  const room = (p: WfsMemoryProject): { liveBytes: number; pendingBytes: number } => {
    let liveBytes = 0;
    for (const e of p.state.branches.get(WFS_MAIN_BRANCH)?.entries.values() ?? []) if (!e.deleted && e.kind === 'file') liveBytes += e.size ?? 0;
    let pendingBytes = 0;
    for (const [sha, held] of p.blobs) if (!inHistory(p, sha)) pendingBytes += held.byteLength;
    return { liveBytes, pendingBytes };
  };

  /** R2-r3: the conflicts `playerId` authored in this project at `nowIso` -- open, retained, and when the next closed one frees. */
  const tallyOf = (p: WfsMemoryProject, playerId: string, nowIso: string): WfsConflictTally => {
    let open = 0;
    let retained = 0;
    let nextFreeIso: string | null = null;
    for (const c of p.state.conflicts.values()) {
      if (c.principal.kind !== 'human' || c.principal.id !== playerId) continue;
      const closing = closingOf(p, c);
      if (closing.status === 'open') open += 1;
      if (!wfsConflictRetained(closing, nowIso)) continue;
      retained += 1;
      if (closing.status !== 'open' && closing.retainUntilIso !== null && (nextFreeIso === null || closing.retainUntilIso < nextFreeIso)) nextFreeIso = closing.retainUntilIso;
    }
    return { open, retained, nextFreeIso };
  };

  return {
    backing,
    seedProject(projectId, members = {}) {
      const known = backing.products.get(projectId) ?? new Map<string, string>();
      for (const [playerId, role] of Object.entries(members)) known.set(playerId, role);
      backing.products.set(projectId, known);
    },
    setMemberRole(projectId, playerId, productRole) {
      const known = backing.products.get(projectId);
      if (known === undefined) throw new Error(`wonderfs memory store: no product project ${projectId}`);
      if (productRole === null) known.delete(playerId);
      else known.set(playerId, productRole);
    },

    async createProject(projectId, _nowIso) {
      // a project the product does not know is refused, exactly as the PostgreSQL store's foreign key refuses it (23503)
      if (!backing.products.has(projectId)) return fail(relayError('not-found', 'No such project to give a file environment.', { details: ['wonderfs: unknown project'] }));
      if (!backing.projects.has(projectId)) {
        backing.projects.set(projectId, { state: emptyWfsProject(projectId, sha256Hex), events: [], approvals: new Map(), closings: new Map(), blobs: new Map() });
      }
      return ok({ genesisHash: wfsGenesisHash(projectId, sha256Hex) });
    },
    async memberRole(projectId, playerId) {
      return ok(roleOf(projectId, playerId));
    },
    async projectsOf(playerId, query) {
      const q = wfsCheckProjectsQuery(playerId, query);
      if (!q.ok) return q;
      const { after, limit } = q.value;
      // the membership (through the ONE mapping) JOINED to a live file environment: either missing, the project is absent
      const mine: WfsMemberProject[] = [];
      for (const [projectId, members] of backing.products) {
        const role = wfsHumanRoleFromMembership(members.get(q.value.playerId));
        if (role === null || !backing.projects.has(projectId)) continue;
        if (after !== null && wfsCompareKeys(projectId, after) <= 0) continue;
        mine.push({ projectId, role });
      }
      mine.sort((a, b) => wfsCompareKeys(a.projectId, b.projectId));
      const page = wfsBoundPage(mine.slice(0, limit + 1), limit);
      const answer: WfsProjectsPage = { projects: page.items, next: page.more ? page.items[page.items.length - 1].projectId : null };
      return ok(answer);
    },
    async project(projectId) {
      return backing.projects.get(projectId)?.state ?? null;
    },
    head: (projectId) =>
      read<WfsProjectHead>(projectId, (p) => {
        const main = p.state.branches.get(WFS_MAIN_BRANCH);
        if (main === undefined) return wfsNotFound('no main branch');
        let files = 0;
        let bytes = 0;
        // K1 (contract r1.6.2 a9 / r1): every live entry, files AND directories -- what §11's maxFiles is judged on
        let entries = 0;
        for (const e of main.entries.values()) {
          if (e.deleted) continue;
          entries += 1;
          if (e.kind === 'file') {
            files += 1;
            bytes += e.size ?? 0;
          }
        }
        return ok({ projectId, genesisHash: main.anchorHash, main: { headRev: main.headRev, headCommitHash: main.headCommitHash }, usage: { files, bytes, entries }, lastEventSeq: p.events.length });
      }),
    async tree(projectId, query) {
      const q = wfsCheckTreeQuery(query);
      if (!q.ok) return q;
      const { branchId, offset, limit } = q.value;
      return read<WfsTreePage>(projectId, (p) => {
        const branch = p.state.branches.get(branchId);
        if (branch === undefined) return wfsNotFound('unknown project or branch');
        const rev = q.value.rev ?? branch.headRev;
        if (rev > branch.headRev) return wfsNotFound('no such revision');
        const at = rev === branch.headRev ? branch.entries : wfsEntriesAt(branch, rev);
        const live = [...at.values()].filter((e) => !e.deleted).sort(wfsCompareEntries);
        const page = wfsBoundPage(live.slice(offset, offset + limit + 1), limit);
        return ok({ branchId, rev, headRev: branch.headRev, entries: page.items, next: page.more ? wfsEncodeTreeCursor(rev, offset + page.items.length) : null });
      });
    },
    async fileHistory(projectId, query) {
      const q = wfsCheckHistoryQuery(query);
      if (!q.ok) return q;
      const { branchId, fileId, before, limit } = q.value;
      return read<WfsHistoryPage>(projectId, (p) => {
        const branch = p.state.branches.get(branchId);
        if (branch === undefined) return wfsNotFound('unknown project or branch');
        const current = branch.entries.get(fileId);
        if (current === undefined) return wfsNotFound('unknown file');
        const base = branch.base.get(fileId);
        const all: WfsFileVersion[] = [
          ...(base === undefined ? [] : [{ rev: 0, entry: base }]),
          ...branch.commits.flatMap((c) => c.touched.filter((e) => e.fileId === fileId).map((entry) => ({ rev: c.rev, entry }))),
        ];
        const older = all.filter((v) => before === null || v.entry.version < before).sort((a, b) => b.entry.version - a.entry.version);
        const page = wfsBoundPage(older.slice(0, limit + 1), limit);
        return ok({ branchId, fileId, current, versions: page.items, next: page.more ? page.items[page.items.length - 1].entry.version : null });
      });
    },
    async fileAt(projectId, query) {
      const q = wfsCheckFileAtQuery(query);
      if (!q.ok) return q;
      const { branchId, fileId, rev } = q.value;
      return read<WfsFileAt>(projectId, (p) => {
        const branch = p.state.branches.get(branchId);
        if (branch === undefined) return wfsNotFound('unknown project or branch');
        const current = branch.entries.get(fileId);
        if (current === undefined) return wfsNotFound('unknown file');
        if (rev === null) return ok({ headRev: branch.headRev, rev: branch.headRev, entry: current });
        if (rev > branch.headRev) return wfsNotFound('no such revision');
        const base = branch.base.get(fileId);
        const versions: WfsFileVersion[] = [
          ...(base === undefined ? [] : [{ rev: 0, entry: base }]),
          ...branch.commits.flatMap((c) => c.touched.filter((e) => e.fileId === fileId).map((entry) => ({ rev: c.rev, entry }))),
        ];
        const at = versions.filter((v) => v.rev <= rev).sort((a, b) => b.entry.version - a.entry.version)[0];
        if (at === undefined) return wfsNotFound('no version at that revision');
        return ok({ headRev: branch.headRev, rev, entry: at.entry });
      });
    },
    async changes(projectId, query) {
      const q = wfsCheckChangesQuery(query);
      if (!q.ok) return q;
      const { branchId, afterRev, limit } = q.value;
      return read<WfsChangesPage>(projectId, (p) => {
        const branch = p.state.branches.get(branchId);
        if (branch === undefined) return wfsNotFound('unknown project or branch');
        const after: WfsCommit[] = branch.commits.filter((c) => c.rev > afterRev).slice(0, limit + 1);
        const page = wfsBoundPage(after, limit);
        return ok({ branchId, headRev: branch.headRev, commits: page.items, next: page.more ? page.items[page.items.length - 1].rev : null });
      });
    },
    async events(projectId, query) {
      const q = wfsCheckEventsQuery(query);
      if (!q.ok) return q;
      const { afterSeq, limit } = q.value;
      return read<WfsEventsPage>(projectId, (p) => {
        const page = wfsBoundPage(p.events.filter((e) => e.seq > afterSeq).slice(0, limit + 1), limit);
        return ok({ events: page.items, lastSeq: p.events.length, next: page.more ? page.items[page.items.length - 1].seq : null });
      });
    },
    async conflicts(projectId, query) {
      const q = wfsCheckConflictsQuery(query);
      if (!q.ok) return q;
      const { branchId, all, after, limit } = q.value;
      return read<WfsConflictsPage>(projectId, (p) => {
        if (branchId !== null && !p.state.branches.has(branchId)) return wfsNotFound('unknown branch');
        const listed: WfsConflictSummary[] = [...p.state.conflicts.values()]
          .filter((c) => branchId === null || c.branchId === branchId)
          .map((c) => ({ c, status: closingOf(p, c).status }))
          .filter(({ status }) => all || status === 'open')
          .filter(({ c }) => after === null || wfsCompareKeys(c.conflictId, after) > 0)
          .sort((x, y) => wfsCompareKeys(x.c.conflictId, y.c.conflictId))
          .slice(0, limit + 1)
          .map(({ c, status }) => ({
            conflictId: c.conflictId,
            branchId: c.branchId,
            requestId: c.requestId,
            status,
            principal: c.principal,
            baseRev: c.baseRev,
            headRevAtRefusal: c.headRevAtRefusal,
            atIso: c.atIso,
            mergesBranchId: c.mergesBranchId,
            opCount: c.ops.length,
            failureCount: c.failures.length,
          }));
        const page = wfsBoundPage(listed, limit);
        return ok({ conflicts: page.items, next: page.more ? page.items[page.items.length - 1].conflictId : null });
      });
    },
    conflict: (projectId, conflictId) =>
      read<WfsConflictView>(projectId, (p) => {
        const c = p.state.conflicts.get(conflictId);
        if (c === undefined) return wfsNotFound('unknown conflict');
        return ok({ record: c, ...closingOf(p, c) });
      }),
    async blobInfo(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      return read<WfsBlobInfo | null>(projectId, (p) => {
        const referenced = referencedIn(p, sha.value, readNow());
        const held = p.blobs.get(sha.value);
        return ok(held === undefined ? null : { sha256: sha.value, size: held.byteLength, referenced });
      });
    },
    async readReferencedBlob(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      const p = backing.projects.get(projectId);
      if (p === undefined) return wfsNotFound('unknown project');
      const referenced = referencedIn(p, sha.value, readNow());
      const held = p.blobs.get(sha.value);
      const answer: WfsReferencedBlob | null = !referenced || held === undefined ? null : { size: held.byteLength, bytes: new Uint8Array(held) };
      return ok(answer);
    },
    async verifyBlob(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      return read<WfsBlobIntegrity>(projectId, (p) => {
        const held = p.blobs.get(sha.value);
        return ok(wfsBlobIntegrity(sha.value, held === undefined ? null : held.byteLength, held ?? null, sha256Bytes));
      });
    },
    async readBlob(projectId, sha256) {
      const held = backing.projects.get(projectId)?.blobs.get(sha256);
      return held === undefined ? null : new Uint8Array(held);
    },

    commit: (projectId, req, nowIso, authority) =>
      mutate(projectId, nowIso, (p, ctx) => {
        // R2: the role NOW, inside the change (this synchronous block is the memory store's transaction), before the replay lookup
        if (authority !== undefined) {
          const admitted = wfsAdmitCommit(roleOf(projectId, authority.playerId), authority, req);
          if (!admitted.ok) return admitted;
        }
        const r = applyWfsCommit(p.state, req, ctx);
        if (!r.ok) return r;
        // R2-r3: a NEW conflict past its author's open limit, or past the retained storage limit, keeps nothing
        if (authority !== undefined && wfsConflictLimitsApply(r.value.outcome, authority)) {
          const limited = wfsConflictLimits(tallyOf(p, authority.playerId, nowIso), authority);
          if (!limited.ok) return limited;
        }
        return ok({ state: r.value.project, value: r.value.outcome, event: wfsOutcomeEvent(r.value.outcome, 'commit') });
      }),
    fork: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, (p, ctx) => {
        const r = forkWfsBranch(p.state, input, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: { branchId: r.value.branchId }, event: { kind: 'branch.fork', body: { branchId: r.value.branchId, fromBranchId: input.fromBranchId } } });
      }),
    mergeBack: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, (p, ctx) => {
        // the STORED approval, by id (a forged id is no approval), and its approver's role NOW
        const approval = input.approvalId === null ? null : p.approvals.get(input.approvalId) ?? null;
        const approverRoleNow = approval === null ? null : roleOf(projectId, approval.approvedBy);
        const r = mergeBackWfsBranch(p.state, { requestId: input.requestId, branchId: input.branchId, principal: input.principal, approval, reviewVerdict: input.reviewVerdict, approverRoleNow }, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: r.value.outcome, event: wfsOutcomeEvent(r.value.outcome, 'branch.merge') });
      }),
    approve: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, (p) => {
        const roleNow = input.principal.kind === 'human' ? roleOf(projectId, input.principal.id) : null;
        const r = issueWfsApproval(p.state, { approvalId: newId('approval'), branchId: input.branchId, principal: input.principal, roleNow }, nowIso);
        if (!r.ok) return r;
        return ok({ state: p.state, value: r.value, event: { kind: 'approval', body: { branchId: r.value.branchId, approvalId: r.value.approvalId } }, approval: r.value });
      }),
    discard: (projectId, branchId, nowIso) =>
      mutate(projectId, nowIso, (p) => {
        const r = discardWfsBranch(p.state, branchId, nowIso);
        if (!r.ok) return r;
        return ok({ state: r.value, value: null, event: { kind: 'branch.discard', body: { branchId } } });
      }),
    async putBlob(projectId, bytes, options = {}) {
      const checked = wfsCheckUpload(bytes.byteLength, options.claimedSha256, limits);
      if (!checked.ok) return checked;
      // its own copy first: the caller's buffer may change while the hash yields
      const copy = new Uint8Array(bytes);
      const sha256 = await wfsSha256InSlices(copy, createHash('sha256'));
      if (checked.value !== null && checked.value !== sha256) return wfsHashMismatch();
      // from here on, synchronous: the memory store's transaction
      const p = backing.projects.get(projectId);
      if (p === undefined) return noProject();
      if (options.authority !== undefined) {
        const admitted = wfsAdmitWrite(roleOf(projectId, options.authority.playerId), options.authority);
        if (!admitted.ok) return admitted;
      }
      const created = !p.blobs.has(sha256);
      if (created) {
        const fits = wfsBlobRoom({ ...room(p), size: copy.byteLength, limits });
        if (!fits.ok) return fits;
        p.blobs.set(sha256, copy);
      }
      return ok({ sha256, size: copy.byteLength, created });
    },
  };
}
