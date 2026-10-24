import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyWfsCommit,
  discardWfsBranch,
  emptyWfsProject,
  forkWfsBranch,
  issueWfsApproval,
  mergeBackWfsBranch,
  verifyWfsChain,
  wfsChangesAfter,
  wfsSubtreeRev,
  wfsTreeAt,
  WFS_ALPHA_LIMITS,
  WFS_MAIN_BRANCH,
  type WfsApplied,
  type WfsCommit,
  type WfsCommitOutcome,
  type WfsCommitRequest,
  type WfsConflict,
  type WfsEngineContext,
  type WfsEntry,
  type WfsHumanRole,
  type WfsLimits,
  type WfsMergeApproval,
  type WfsOp,
  type WfsPrincipal,
  type WfsProjectState,
  type WfsReviewVerdict,
  canonicalJson,
  wfsGenesisHash,
  WFS_REQUEST_HASH_VERSION,
} from './index';

/**
 * The engine's guarantees (§4), one describe each. Every test asserts the state a broken engine would get wrong: a
 * last-writer-wins engine fails T-CONFLICT; a partial-apply engine fails T-ATOMIC; an engine without the request log fails
 * T-IDEMPOTENT; an engine that hashes less than the whole commit fails T-CHAIN.
 */

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** r1.2 §19.M7: project prj-1's main chain anchor. */
const GENESIS = wfsGenesisHash('prj-1', sha);

/** r1.2 §19.M1: a review verdict bound to the branch's head NOW (the Julius runner reads it from WonderFS before the review). */
function verdictFor(p: WfsProjectState, branchId: string): WfsReviewVerdict {
  const b = p.branches.get(branchId);
  if (b === undefined || b.parent === null) throw new Error(`no agent branch ${branchId}`);
  return { verdictId: `verdict-${b.headRev}`, verdictHash: sha(`verdict:${b.headCommitHash}`), reviewedBranchId: branchId, reviewedHeadCommitHash: b.headCommitHash, reviewedBaseRev: b.parent.forkRev };
}

interface Harness {
  ctx: WfsEngineContext;
  blob: (text: string) => { sha256: string; size: number };
  withLimits: (limits: WfsLimits) => WfsEngineContext;
}

function harness(): Harness {
  let n = 0;
  const blobs = new Map<string, number>();
  const base = {
    nowIso: '2026-10-11T03:00:00.000Z',
    newId: (kind: 'file' | 'commit' | 'conflict' | 'branch') => {
      n += 1;
      return `${kind}-${String(n).padStart(5, '0')}`;
    },
    sha256Hex: sha,
    blobSize: (h: string) => blobs.get(h) ?? null,
  };
  const ctx: WfsEngineContext = { ...base, limits: WFS_ALPHA_LIMITS };
  return {
    ctx,
    blob: (text: string) => {
      const h = sha(text);
      const size = Buffer.byteLength(text, 'utf8');
      blobs.set(h, size);
      return { sha256: h, size };
    },
    withLimits: (limits: WfsLimits) => ({ ...base, limits }),
  };
}

function who(id: string, kind: WfsPrincipal['kind'] = 'human'): WfsPrincipal {
  return { kind, id, onBehalfOf: kind === 'human' ? null : 'ghu-1', grantId: kind === 'human' ? null : `grant-${id}`, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null };
}

let requestSeq = 0;
const rid = (): string => {
  requestSeq += 1;
  return `req-${String(requestSeq).padStart(8, '0')}`;
};

function request(ops: readonly WfsOp[], principal: WfsPrincipal, extra: Partial<WfsCommitRequest> = {}): WfsCommitRequest {
  return { requestId: rid(), branchId: WFS_MAIN_BRANCH, baseRev: 0, ops, principal, ...extra };
}

function apply(project: WfsProjectState, req: WfsCommitRequest, ctx: WfsEngineContext): WfsApplied {
  const r = applyWfsCommit(project, req, ctx);
  expect(r.ok, r.ok ? '' : `${r.error.code}: ${r.error.message} ${JSON.stringify(r.error.details)}`).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function committed(o: WfsCommitOutcome): Extract<WfsCommitOutcome, { status: 'committed' }> {
  expect(o.status).toBe('committed');
  if (o.status !== 'committed') throw new Error(`expected a commit, got ${JSON.stringify(o)}`);
  return o;
}

function conflicted(o: WfsCommitOutcome): Extract<WfsCommitOutcome, { status: 'conflict' }> {
  expect(o.status).toBe('conflict');
  if (o.status !== 'conflict') throw new Error(`expected a conflict, got ${JSON.stringify(o)}`);
  return o;
}

const main = (p: WfsProjectState) => p.branches.get(WFS_MAIN_BRANCH)!;
const at = (p: WfsProjectState, path: string, branchId = WFS_MAIN_BRANCH): WfsEntry | undefined =>
  wfsTreeAt(p.branches.get(branchId)!).find((e) => e.path === path);
function entry(p: WfsProjectState, path: string, branchId = WFS_MAIN_BRANCH): WfsEntry {
  const e = at(p, path, branchId);
  expect(e, `no live entry at ${path}`).toBeDefined();
  if (e === undefined) throw new Error(path);
  return e;
}

/** A project with `src/` and `src/main.cpp` ("v1") on main at rev 1. */
function seeded(h: Harness): WfsProjectState {
  const v1 = h.blob('int main() { return 1; }');
  return apply(emptyWfsProject('prj-1', sha), request([
    { op: 'create', path: 'src', kind: 'dir' },
    { op: 'create', path: 'src/main.cpp', kind: 'file', ...v1 },
  ], who('ghu-1')), h.ctx).project;
}

describe('WonderFS engine: commits', () => {
  it('creates a folder and a file in one atomic commit at rev 1', () => {
    const h = harness();
    const p = seeded(h);
    expect(main(p).headRev).toBe(1);
    expect(wfsTreeAt(main(p)).map((e) => e.path)).toEqual(['src', 'src/main.cpp']);
    const file = entry(p, 'src/main.cpp');
    expect(file.version).toBe(1);
    expect(file.contentVersion).toBe(1);
    expect(file.pathVersion).toBe(1);
    expect(file.createdRev).toBe(1);
  });

  it('refuses a file whose content was not uploaded first, and changes nothing', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const r = applyWfsCommit(p0, request([{ op: 'create', path: 'a.txt', kind: 'file', sha256: sha('never uploaded'), size: 14 }], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('accepted');
    expect(r.error.code).toBe('validation-failed');
    expect(main(p0).headRev).toBe(0);
  });

  it('refuses a size that does not match the uploaded content', () => {
    const h = harness();
    const b = h.blob('hello');
    const r = applyWfsCommit(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'a.txt', kind: 'file', sha256: b.sha256, size: b.size + 1 }], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
  });

  it('refuses a merge_put sent by a caller (only merge-back writes it)', () => {
    const h = harness();
    const forged = { op: 'merge_put', fileId: 'file-1', expectVersion: 0, state: { kind: 'file', path: 'x', sha256: null, size: null, deleted: false } } as unknown as WfsOp;
    const r = applyWfsCommit(emptyWfsProject('prj-1', sha), request([forged], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
  });

  it('refuses a file created in a folder that does not exist (as a preserved conflict)', () => {
    const h = harness();
    const b = h.blob('x');
    const out = apply(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'missing/a.txt', kind: 'file', ...b }], who('ghu-1')), h.ctx);
    expect(conflicted(out.outcome).failures.map((f) => f.kind)).toEqual(['parent_missing']);
    expect(main(out.project).headRev).toBe(0);
  });
});

describe('WonderFS engine: T-CONFLICT (detect AND preserve; never last-writer-wins)', () => {
  it('keeps the first edit, and preserves the second edit whole as a conflict with its exact content', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const alice = h.blob('int main() { return 2; } // Alice');
    const bob = h.blob('int main() { return 3; } // Bob');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...alice }], who('ghu-alice'), { baseRev: 1 }), h.ctx);
    expect(committed(p2.outcome).rev).toBe(2);
    const p3 = apply(p2.project, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...bob }], who('ghu-bob'), { baseRev: 1 }), h.ctx);
    const c = conflicted(p3.outcome);
    expect(c.failures).toEqual([{ opIndex: 0, kind: 'content', fileId: file.fileId, path: 'src/main.cpp', detail: 'the file changed (version 2, expected 1)' }]);
    // The tree holds Alice's bytes; Bob's bytes are NOT lost: the conflict names them, with Bob as its author.
    expect(entry(p3.project, 'src/main.cpp').sha256).toBe(alice.sha256);
    const kept = p3.project.conflicts.get(c.conflictId) as WfsConflict;
    expect(kept.status).toBe('open');
    expect(kept.principal.id).toBe('ghu-bob');
    expect(kept.ops).toEqual([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...bob }]);
    expect(main(p3.project).headRev).toBe(2);
  });

  it('keep mine: re-applies the preserved change at the current version and closes the conflict', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const alice = h.blob('A');
    const bob = h.blob('B');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...alice }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...bob }], who('ghu-bob')), h.ctx);
    const conflictId = conflicted(p3.outcome).conflictId;
    const p4 = apply(p3.project, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 2, ...bob }], who('ghu-bob'), { resolvesConflictId: conflictId }), h.ctx);
    const done = committed(p4.outcome);
    expect(entry(p4.project, 'src/main.cpp').sha256).toBe(bob.sha256);
    expect(p4.project.conflicts.get(conflictId)?.status).toBe('resolved');
    expect(p4.project.conflicts.get(conflictId)?.resolvedByCommitId).toBe(done.commitId);
    expect(main(p4.project).commits[done.rev - 1].resolvesConflictId).toBe(conflictId);
  });

  it('keep theirs: a recorded dismissal (a commit with no ops) leaves the tree alone and closes the conflict', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const alice = h.blob('A');
    const bob = h.blob('B');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...alice }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...bob }], who('ghu-bob')), h.ctx);
    const conflictId = conflicted(p3.outcome).conflictId;
    const p4 = apply(p3.project, request([], who('ghu-bob'), { resolvesConflictId: conflictId }), h.ctx);
    const done = committed(p4.outcome);
    expect(entry(p4.project, 'src/main.cpp').sha256).toBe(alice.sha256);
    expect(main(p4.project).commits[done.rev - 1].touched).toEqual([]);
    expect(main(p4.project).commits[done.rev - 1].principal.id).toBe('ghu-bob');
    expect(p4.project.conflicts.get(conflictId)?.status).toBe('resolved');
  });

  it('keep both: the preserved content lands at a new path', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const alice = h.blob('A');
    const bob = h.blob('B');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...alice }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...bob }], who('ghu-bob')), h.ctx);
    const conflictId = conflicted(p3.outcome).conflictId;
    const p4 = apply(p3.project, request([{ op: 'create', path: 'src/main (conflict, ghu-bob, 2026-10-11 03-00).cpp', kind: 'file', ...bob }], who('ghu-bob'), { resolvesConflictId: conflictId }), h.ctx);
    committed(p4.outcome);
    expect(entry(p4.project, 'src/main.cpp').sha256).toBe(alice.sha256);
    expect(entry(p4.project, 'src/main (conflict, ghu-bob, 2026-10-11 03-00).cpp').sha256).toBe(bob.sha256);
  });

  it('refuses to resolve a conflict twice, or one on another branch', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('A') }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('B') }], who('ghu-bob')), h.ctx);
    const conflictId = conflicted(p3.outcome).conflictId;
    const p4 = apply(p3.project, request([], who('ghu-bob'), { resolvesConflictId: conflictId }), h.ctx).project;
    const again = applyWfsCommit(p4, request([], who('ghu-bob'), { resolvesConflictId: conflictId }), h.ctx);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('accepted');
    expect(again.error.code).toBe('immutable');
  });
});

describe('WonderFS engine: T-ATOMIC', () => {
  it('applies none of a 3-op commit when one op fails, and keeps all 3 ops in the conflict', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('newer') }], who('ghu-alice')), h.ctx).project;
    const ops: WfsOp[] = [
      { op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') },
      { op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('stale') },
      { op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') },
    ];
    const out = apply(p2, request(ops, who('ghu-bob')), h.ctx);
    const c = conflicted(out.outcome);
    expect(c.failures.map((f) => [f.opIndex, f.kind])).toEqual([[1, 'content']]);
    expect(at(out.project, 'a.txt')).toBeUndefined();
    expect(at(out.project, 'b.txt')).toBeUndefined();
    expect(main(out.project).headRev).toBe(2);
    expect(out.project.conflicts.get(c.conflictId)?.ops).toEqual(ops);
  });
});

describe('WonderFS engine: moves, folders and deletes', () => {
  it('T-MOVE-EDIT: a move and a concurrent edit of the same file both land', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const edit = h.blob('edited');
    const p2 = apply(p1, request([{ op: 'move', fileId: file.fileId, expectPathVersion: 1, newPath: 'src/game.cpp' }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...edit }], who('ghu-bob')), h.ctx);
    committed(p3.outcome);
    const moved = entry(p3.project, 'src/game.cpp');
    expect(moved.fileId).toBe(file.fileId);
    expect(moved.sha256).toBe(edit.sha256);
    expect(at(p3.project, 'src/main.cpp')).toBeUndefined();
  });

  it('T-MOVE-MOVE: the second of two moves of one file is preserved as a conflict', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'move', fileId: file.fileId, expectPathVersion: 1, newPath: 'src/a.cpp' }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'move', fileId: file.fileId, expectPathVersion: 1, newPath: 'src/b.cpp' }], who('ghu-bob')), h.ctx);
    expect(conflicted(p3.outcome).failures[0].kind).toBe('move_move');
    expect(entry(p3.project, 'src/a.cpp').fileId).toBe(file.fileId);
  });

  it('T-DIR-MOVE: a folder move carries everything beneath it and keeps every file id', () => {
    const h = harness();
    const p1 = apply(emptyWfsProject('prj-1', sha), request([
      { op: 'create', path: 'a', kind: 'dir' },
      { op: 'create', path: 'a/b', kind: 'dir' },
      { op: 'create', path: 'a/b/c.txt', kind: 'file', ...h.blob('c') },
      { op: 'create', path: 'ab.txt', kind: 'file', ...h.blob('sibling') },
    ], who('ghu-1')), h.ctx).project;
    const dir = entry(p1, 'a');
    const deep = entry(p1, 'a/b/c.txt');
    const p2 = apply(p1, request([{ op: 'create', path: 'z', kind: 'dir' }, { op: 'move', fileId: dir.fileId, expectPathVersion: 1, newPath: 'z/a2' }], who('ghu-1')), h.ctx).project;
    expect(wfsTreeAt(main(p2)).map((e) => e.path)).toEqual(['ab.txt', 'z', 'z/a2', 'z/a2/b', 'z/a2/b/c.txt']);
    expect(entry(p2, 'z/a2/b/c.txt').fileId).toBe(deep.fileId);
    expect(entry(p2, 'ab.txt').pathVersion).toBe(1);
  });

  it('refuses to move a folder into itself (cycle), as a preserved conflict', () => {
    const h = harness();
    const p1 = apply(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'a', kind: 'dir' }, { op: 'create', path: 'a/b', kind: 'dir' }], who('ghu-1')), h.ctx).project;
    const out = apply(p1, request([{ op: 'move', fileId: entry(p1, 'a').fileId, expectPathVersion: 1, newPath: 'a/b/a' }], who('ghu-1')), h.ctx);
    expect(conflicted(out.outcome).failures[0].kind).toBe('cycle');
  });

  it('T-PATH-TAKEN: a second create of the same path, in another case, is preserved as a conflict', () => {
    const h = harness();
    const first = h.blob('first');
    const second = h.blob('second');
    const p1 = apply(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'Readme.md', kind: 'file', ...first }], who('ghu-alice')), h.ctx).project;
    const out = apply(p1, request([{ op: 'create', path: 'README.md', kind: 'file', ...second }], who('ghu-bob')), h.ctx);
    const c = conflicted(out.outcome);
    expect(c.failures[0].kind).toBe('path_taken');
    expect(entry(out.project, 'Readme.md').sha256).toBe(first.sha256);
    expect(out.project.conflicts.get(c.conflictId)?.ops).toEqual([{ op: 'create', path: 'README.md', kind: 'file', ...second }]);
  });

  it('T-DELETE-EDIT: deleting a file someone just edited is a conflict; editing a deleted file is a conflict', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('edited') }], who('ghu-bob')), h.ctx).project;
    const del = apply(p2, request([{ op: 'delete', fileId: file.fileId, expectContentVersion: 1 }], who('ghu-alice')), h.ctx);
    expect(conflicted(del.outcome).failures[0].kind).toBe('delete_edited');
    expect(at(del.project, 'src/main.cpp')).toBeDefined();
    const p3 = apply(p2, request([{ op: 'delete', fileId: file.fileId, expectContentVersion: 2 }], who('ghu-alice')), h.ctx).project;
    const edit = apply(p3, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 2, ...h.blob('late') }], who('ghu-bob')), h.ctx);
    expect(conflicted(edit.outcome).failures[0].kind).toBe('edit_deleted');
  });

  it('a folder delete is judged by its subtree revision, and tombstones everything beneath', () => {
    const h = harness();
    const p1 = seeded(h);
    const dir = entry(p1, 'src');
    expect(wfsSubtreeRev(main(p1).entries, dir)).toBe(1);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('edited') }], who('ghu-bob')), h.ctx).project;
    const stale = apply(p2, request([{ op: 'delete', fileId: dir.fileId, expectSubtreeRev: 1 }], who('ghu-alice')), h.ctx);
    expect(conflicted(stale.outcome).failures[0].kind).toBe('delete_edited');
    const fresh = apply(p2, request([{ op: 'delete', fileId: dir.fileId, expectSubtreeRev: 2 }], who('ghu-alice')), h.ctx);
    committed(fresh.outcome);
    expect(wfsTreeAt(main(fresh.project))).toEqual([]);
    expect(main(fresh.project).entries.get(file.fileId)?.deleted).toBe(true);
  });

  it('two people deleting the same file agree (the second is a harmless no-op)', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'delete', fileId: file.fileId, expectContentVersion: 1 }], who('ghu-alice')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'delete', fileId: file.fileId, expectContentVersion: 1 }], who('ghu-bob')), h.ctx);
    const second = committed(p3.outcome);
    expect(second.rev).toBe(3);
    expect(main(p3.project).commits[1].touched.map((e) => e.deleted)).toEqual([true]);
    expect(main(p3.project).commits[second.rev - 1].touched).toEqual([]);
  });

  it('T-UNDELETE: a tombstone comes back, unless its path is taken', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'delete', fileId: file.fileId, expectContentVersion: 1 }], who('ghu-alice')), h.ctx).project;
    const tomb = main(p2).entries.get(file.fileId)!;
    expect(tomb.deleted).toBe(true);
    const back = apply(p2, request([{ op: 'undelete', fileId: file.fileId, expectVersion: tomb.version }], who('ghu-alice')), h.ctx);
    committed(back.outcome);
    expect(entry(back.project, 'src/main.cpp').fileId).toBe(file.fileId);
    const p3 = apply(p2, request([{ op: 'create', path: 'src/main.cpp', kind: 'file', ...h.blob('replacement') }], who('ghu-bob')), h.ctx).project;
    const blocked = apply(p3, request([{ op: 'undelete', fileId: file.fileId, expectVersion: tomb.version }], who('ghu-alice')), h.ctx);
    expect(conflicted(blocked.outcome).failures[0].kind).toBe('path_taken');
  });
});

describe('WonderFS engine: T-IDEMPOTENT (INV-8)', () => {
  it('answers a repeated request with the original outcome and applies it once', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const req = request([{ op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') }], who('ghu-1'));
    const first = apply(p0, req, h.ctx);
    const again = apply(first.project, req, h.ctx);
    expect(again.outcome).toEqual({ ...first.outcome, replay: true });
    expect(main(again.project).headRev).toBe(1);
    expect(main(again.project).commits).toHaveLength(1);
  });

  it('answers a repeated conflicting request with the SAME conflict, never a second one', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('A') }], who('ghu-alice')), h.ctx).project;
    const req = request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('B') }], who('ghu-bob'));
    const first = apply(p2, req, h.ctx);
    const again = apply(first.project, req, h.ctx);
    expect(conflicted(again.outcome).conflictId).toBe(conflicted(first.outcome).conflictId);
    expect(again.project.conflicts.size).toBe(1);
  });

  it('refuses a request id reused by the SAME actor for a different change; ANOTHER actor using that id is an independent request (K4, contract r1.6.2 e2)', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const req = request([{ op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') }], who('ghu-1'));
    const first = apply(p0, req, h.ctx);
    const reused = applyWfsCommit(first.project, { ...req, ops: [{ op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') }] }, h.ctx);
    expect(reused.ok).toBe(false);
    if (reused.ok) throw new Error('accepted');
    expect(reused.error.code).toBe('duplicate-idempotency-key');
    // another player, the same id, its own change: it LANDS, with its own outcome (never the first actor's, never a 409)
    const other = apply(first.project, { ...req, baseRev: 1, principal: who('ghu-2'), ops: [{ op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') }] }, h.ctx);
    expect(committed(other.outcome).rev).toBe(2);
    expect(other.outcome.replay).toBe(false);
    expect(main(other.project).commits[1].principal.id).toBe('ghu-2');
  });

  it('K4 PRE-CLAIM (contract r1.6.2 e2; attack WFS15-06 / BS-W2-03): member B commits under id X FIRST; then member A\'s change under X lands with A\'s OWN outcome, and A\'s replay answers A\'s, B\'s answers B\'s (CONTROL: B reusing X for A\'s change is still 409)', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const X = 'req-guessable-0001';
    const bob = apply(p0, { requestId: X, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('ghu-bob'), ops: [{ op: 'create', path: 'squat', kind: 'dir' }] }, h.ctx);
    const aliceReq: WfsCommitRequest = { requestId: X, branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('ghu-alice'), ops: [{ op: 'create', path: 'mine.txt', kind: 'file', ...h.blob('alice') }] };
    const alice = apply(bob.project, aliceReq, h.ctx);
    const landed = committed(alice.outcome);
    expect([landed.rev, landed.replay]).toEqual([2, false]);
    expect(landed.commitId).not.toBe(committed(bob.outcome).commitId);
    expect(at(alice.project, 'mine.txt')?.sha256, 'A\'s change is what landed').toBe(sha('alice'));
    // each actor's replay answers its OWN outcome
    const aliceAgain = apply(alice.project, { ...aliceReq, principal: { ...aliceReq.principal, sessionId: 'sref-new' } }, h.ctx);
    expect(aliceAgain.outcome).toEqual({ ...alice.outcome, replay: true });
    const bobAgain = apply(alice.project, { requestId: X, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('ghu-bob'), ops: [{ op: 'create', path: 'squat', kind: 'dir' }] }, h.ctx);
    expect(bobAgain.outcome).toEqual({ ...bob.outcome, replay: true });
    // CONTROL: within ONE actor the id is still claimed -- B sending A's change under X is refused
    const bobReuse = applyWfsCommit(alice.project, { ...aliceReq, principal: who('ghu-bob') }, h.ctx);
    expect(bobReuse.ok === false && bobReuse.error.code).toBe('duplicate-idempotency-key');
  });

  it('T-CRASH "after COMMIT, before the response" (INV-11): the journal replays after a restart and a NEW sign-in -> the ORIGINAL revision', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const beforeRestart: WfsPrincipal = { ...who('ghu-1'), sessionId: 'sref-before-restart', clientBuild: 'build-1', tool: 'wonderland-client' };
    const req = request([{ op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') }], beforeRestart);
    const first = apply(p0, req, h.ctx);
    // the commit landed but its answer was lost; meanwhile another player committed, so the head moved on
    const later = apply(first.project, request([{ op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') }], who('ghu-2'), { baseRev: 1 }), h.ctx).project;
    // the bridge restarted (every player signed out): the same player signs in again -- a new session ref -- on an updated client
    const afterRestart: WfsPrincipal = { ...beforeRestart, sessionId: 'sref-after-restart', clientBuild: 'build-2', tool: 'wonderland-client-2' };
    const again = apply(later, { ...req, principal: afterRestart }, h.ctx);
    expect(again.outcome).toEqual({ ...first.outcome, replay: true });
    expect(committed(again.outcome).rev, 'the ORIGINAL revision, not the head').toBe(1);
    expect(again.project, 'nothing applied twice').toBe(later);
    expect(main(again.project).commits[0].principal, 'the stored commit still names the session that made it').toEqual(beforeRestart);
    // CONTROL: the same request id with other content from the same player is still refused
    const reuse = applyWfsCommit(later, { ...req, principal: afterRestart, ops: [{ op: 'create', path: 'c.txt', kind: 'dir' }] as WfsOp[] }, h.ctx);
    expect(reuse.ok === false && reuse.error.code).toBe('duplicate-idempotency-key');
    // K4 (contract r1.6.2 e2): from ANOTHER player the same id is an independent request -- judged afresh (here: a.txt is taken, so
    // a conflict of its own), never answered with the first player's revision
    const other = apply(later, { ...req, principal: { ...afterRestart, id: 'ghu-2' } }, h.ctx);
    expect(conflicted(other.outcome).replay).toBe(false);
  });

  it('T-CRASH: a replayed CONFLICT from a new session is the SAME conflict, never a second one', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('A') }], who('ghu-alice')), h.ctx).project;
    const bob: WfsPrincipal = { ...who('ghu-bob'), sessionId: 'sref-1', clientBuild: 'build-1' };
    const req = request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('B') }], bob);
    const first = apply(p2, req, h.ctx);
    const again = apply(first.project, { ...req, principal: { ...bob, sessionId: 'sref-2', clientBuild: 'build-2' } }, h.ctx);
    expect(again.outcome).toEqual({ ...first.outcome, replay: true });
    expect(again.project.conflicts.size).toBe(1);
  });

  it('WHAT makes it the same request: the actor\'s stable identity and the change -- never the session, the build or the tool (each field pinned)', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const actor: WfsPrincipal = { kind: 'julius', id: 'julius-7', onBehalfOf: 'ghu-1', grantId: 'grant-1', sessionId: 'sref-1', clientBuild: 'build-1', tool: 'julius-runner', missionId: 'mission-1', attemptId: 'attempt-1' };
    const req = request([{ op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') }], actor);
    const first = apply(p0, req, h.ctx);
    const send = (r: WfsCommitRequest) => applyWfsCommit(first.project, r, h.ctx);
    // per sign-in / descriptive provenance: a replay (CONTROL: hashing the whole principal refuses each of these)
    const replays: Partial<WfsPrincipal>[] = [{ sessionId: 'sref-2' }, { sessionId: null }, { clientBuild: 'build-2' }, { clientBuild: null }, { tool: 'julius-runner-2' }, { tool: null }];
    for (const over of replays) {
      const r = send({ ...req, principal: { ...actor, ...over } });
      expect(r.ok && r.value.outcome, JSON.stringify(over)).toEqual({ ...first.outcome, replay: true });
    }
    // identity (K4, contract r1.6.2 e2): each is ANOTHER actor, so the same id is an independent request, judged afresh (a.txt is taken:
    // a conflict of its own) -- never answered with the first actor's outcome, never a 409 (CONTROL: dropping any one of these from the
    // actor key either replays the first actor's answer or refuses it as a reused id)
    const others: Partial<WfsPrincipal>[] = [{ kind: 'imported_agent' }, { id: 'julius-8' }, { onBehalfOf: 'ghu-2' }, { grantId: 'grant-2' }, { missionId: 'mission-2' }, { attemptId: 'attempt-2' }];
    for (const over of others) {
      const r = send({ ...req, principal: { ...actor, ...over } });
      expect(r.ok && r.value.outcome.status, JSON.stringify(over)).toBe('conflict');
      expect(r.ok && r.value.outcome.replay, JSON.stringify(over)).toBe(false);
    }
    // the change itself: refused
    const changes: Partial<WfsCommitRequest>[] = [{ baseRev: 1 }, { branchId: 'branch-other' }, { resolvesConflictId: 'conflict-x' }, { ops: [{ op: 'create', path: 'a.txt', kind: 'dir' }] }];
    for (const over of changes) {
      const r = send({ ...req, ...over });
      expect(r.ok === false && r.error.code, JSON.stringify(over)).toBe('duplicate-idempotency-key');
    }
  });

  it('does not remember a REFUSED (malformed) request: the corrected request may reuse its id', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1', sha);
    const id = rid();
    const bad = applyWfsCommit(p0, { requestId: id, branchId: WFS_MAIN_BRANCH, baseRev: 0, ops: [{ op: 'create', path: 'bad\nname', kind: 'dir' }], principal: who('ghu-1') }, h.ctx);
    expect(bad.ok).toBe(false);
    const good = apply(p0, { requestId: id, branchId: WFS_MAIN_BRANCH, baseRev: 0, ops: [{ op: 'create', path: 'good', kind: 'dir' }], principal: who('ghu-1') }, h.ctx);
    committed(good.outcome);
  });
});

describe('WonderFS engine: T-CHAIN and history (INV-6, INV-7)', () => {
  function threeCommits(): { project: WfsProjectState; commits: readonly WfsCommit[] } {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const p2 = apply(p1, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('two') }], who('ghu-1')), h.ctx).project;
    const p3 = apply(p2, request([{ op: 'move', fileId: file.fileId, expectPathVersion: 1, newPath: 'src/game.cpp' }], who('ghu-1')), h.ctx).project;
    return { project: p3, commits: main(p3).commits };
  }

  it('links every commit to its predecessor and re-hashes to its stored hash', () => {
    const { commits } = threeCommits();
    expect(commits.map((c) => c.rev)).toEqual([1, 2, 3]);
    expect(commits[0].prevCommitHash).toBe(GENESIS); // r1.2 §19.M7: main's chain is anchored to its genesis
    expect(commits[1].prevCommitHash).toBe(commits[0].commitHash);
    expect(verifyWfsChain(commits, sha, GENESIS)).toBeNull();
  });

  it('detects an edited resulting state, an edited author and a broken link', () => {
    const { commits } = threeCommits();
    const touchedEdited = commits.map((c, i) => (i === 1 ? { ...c, touched: c.touched.map((e) => ({ ...e, sha256: sha('forged') })) } : c));
    expect(verifyWfsChain(touchedEdited, sha, GENESIS)).toEqual({ rev: 2, reason: 'hash' });
    const authorEdited = commits.map((c, i) => (i === 2 ? { ...c, principal: who('ghu-someone-else') } : c));
    expect(verifyWfsChain(authorEdited, sha, GENESIS)).toEqual({ rev: 3, reason: 'hash' });
    const relinked = commits.map((c, i) => (i === 2 ? { ...c, prevCommitHash: commits[0].commitHash } : c));
    expect(verifyWfsChain(relinked, sha, GENESIS)).toEqual({ rev: 3, reason: 'link' });
    expect(verifyWfsChain(commits.slice(1), sha, GENESIS)).toEqual({ rev: 2, reason: 'rev' });
  });

  it('rebuilds the tree at any earlier revision from the commits', () => {
    const { project } = threeCommits();
    const m = main(project);
    expect(wfsTreeAt(m, 1).map((e) => [e.path, e.contentVersion])).toEqual([['src', 1], ['src/main.cpp', 1]]);
    expect(wfsTreeAt(m, 2).map((e) => [e.path, e.contentVersion])).toEqual([['src', 1], ['src/main.cpp', 2]]);
    expect(wfsTreeAt(m, 3).map((e) => [e.path, e.contentVersion])).toEqual([['src', 1], ['src/game.cpp', 2]]);
    expect(wfsTreeAt(m, 0)).toEqual([]);
  });
});

describe('WonderFS engine: T-FEED (§7)', () => {
  it('pages commits after a revision, gapless and in order, and is empty past the head', () => {
    const h = harness();
    let p = emptyWfsProject('prj-1', sha);
    for (const name of ['a', 'b', 'c', 'd', 'e']) p = apply(p, request([{ op: 'create', path: name, kind: 'dir' }], who('ghu-1')), h.ctx).project;
    expect(wfsChangesAfter(main(p), 0, 2).commits.map((c) => c.rev)).toEqual([1, 2]);
    expect(wfsChangesAfter(main(p), 2, 2).commits.map((c) => c.rev)).toEqual([3, 4]);
    expect(wfsChangesAfter(main(p), 4, 10).commits.map((c) => c.rev)).toEqual([5]);
    expect(wfsChangesAfter(main(p), 5, 10)).toEqual({ commits: [], headRev: 5 });
    expect(wfsChangesAfter(main(p), 0, 10).commits[2].touched.map((e) => e.path)).toEqual(['c']);
  });
});

describe('WonderFS engine: T-AGENT (branches, §6.5)', () => {
  it('a clean merge-back lands as one commit on main carrying the branch\'s commit hashes, and closes the branch', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-7', 'julius') }, h.ctx);
    expect(fork.ok).toBe(true);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    const agentEdit = h.blob('agent edit');
    let p = apply(fork.value.project, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...agentEdit }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
    p = apply(p, request([{ op: 'create', path: 'src/new.cpp', kind: 'file', ...h.blob('new') }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
    // main moves meanwhile, on an unrelated file
    p = apply(p, request([{ op: 'create', path: 'notes.md', kind: 'file', ...h.blob('human note') }], who('ghu-1')), h.ctx).project;
    expect(entry(p, 'src/main.cpp').sha256).not.toBe(agentEdit.sha256);
    const branchHashes = p.branches.get(branchId)!.commits.map((c) => c.commitHash);
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approval: null, reviewVerdict: verdictFor(p, branchId), approverRoleNow: null }, h.ctx);
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error(merged.error.message);
    const out = committed(merged.value.outcome);
    const mp = merged.value.project;
    expect(entry(mp, 'src/main.cpp').sha256).toBe(agentEdit.sha256);
    expect(at(mp, 'src/new.cpp')).toBeDefined();
    expect(at(mp, 'notes.md')).toBeDefined();
    const mergeCommit = main(mp).commits[out.rev - 1];
    expect(mergeCommit.mergesBranchId).toBe(branchId);
    expect(mergeCommit.carriedCommitHashes).toEqual(branchHashes);
    expect(mp.branches.get(branchId)?.closed?.how).toBe('merged');
    expect(verifyWfsChain(main(mp).commits, sha, GENESIS)).toBeNull();
  });

  it('a merge-back over a file main changed applies NOTHING, keeps a conflict naming the branch, and leaves the branch open', () => {
    const h = harness();
    const p1 = seeded(h);
    const file = entry(p1, 'src/main.cpp');
    const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-7', 'julius') }, h.ctx);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    let p = apply(fork.value.project, request([
      { op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('agent') },
      { op: 'create', path: 'src/extra.cpp', kind: 'file', ...h.blob('extra') },
    ], who('julius-7', 'julius'), { branchId }), h.ctx).project;
    p = apply(p, request([{ op: 'update', fileId: file.fileId, expectContentVersion: 1, ...h.blob('human') }], who('ghu-1')), h.ctx).project;
    const headBefore = main(p).headRev;
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approval: null, reviewVerdict: verdictFor(p, branchId), approverRoleNow: null }, h.ctx);
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error(merged.error.message);
    const c = conflicted(merged.value.outcome);
    const mp = merged.value.project;
    expect(main(mp).headRev).toBe(headBefore);
    expect(at(mp, 'src/extra.cpp')).toBeUndefined();
    expect(mp.conflicts.get(c.conflictId)?.mergesBranchId).toBe(branchId);
    expect(mp.branches.get(branchId)?.closed).toBeNull();
    expect(at(mp, 'src/extra.cpp', branchId)).toBeDefined();
  });

  describe('aspect by aspect (D-6)', () => {
    function forkedWithFile(h: Harness): { p: WfsProjectState; branchId: string; fileId: string } {
      const p1 = seeded(h);
      const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-7', 'julius') }, h.ctx);
      if (!fork.ok) throw new Error(fork.error.message);
      return { p: fork.value.project, branchId: fork.value.branchId, fileId: entry(p1, 'src/main.cpp').fileId };
    }
    const mergeOf = (p: WfsProjectState, branchId: string, h: Harness): WfsApplied => {
      const r = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approval: null, reviewVerdict: verdictFor(p, branchId), approverRoleNow: null }, h.ctx);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };

    it('a human MOVE on main does not stale an agent CONTENT edit: both land', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      const agent = h.blob('agent content');
      let q = apply(p, request([{ op: 'update', fileId, expectContentVersion: 1, ...agent }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      q = apply(q, request([{ op: 'move', fileId, expectPathVersion: 1, newPath: 'src/game.cpp' }], who('ghu-1')), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      committed(merged.outcome);
      const e = entry(merged.project, 'src/game.cpp');
      expect(e.fileId).toBe(fileId);
      expect(e.sha256).toBe(agent.sha256);
      expect(at(merged.project, 'src/main.cpp')).toBeUndefined();
    });

    it('an agent MOVE lands over a human CONTENT edit', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      const human = h.blob('human content');
      let q = apply(p, request([{ op: 'move', fileId, expectPathVersion: 1, newPath: 'src/renamed.cpp' }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      q = apply(q, request([{ op: 'update', fileId, expectContentVersion: 1, ...human }], who('ghu-1')), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      committed(merged.outcome);
      expect(entry(merged.project, 'src/renamed.cpp').sha256).toBe(human.sha256);
    });

    it('two moves of the same file conflict (move_move), and nothing applies', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      let q = apply(p, request([{ op: 'move', fileId, expectPathVersion: 1, newPath: 'src/a.cpp' }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      q = apply(q, request([{ op: 'move', fileId, expectPathVersion: 1, newPath: 'src/b.cpp' }], who('ghu-1')), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      expect(conflicted(merged.outcome).failures.map((f) => f.kind)).toEqual(['move_move']);
      expect(entry(merged.project, 'src/b.cpp').fileId).toBe(fileId);
    });

    it('an agent DELETE of a file a human changed is a conflict (delete_edited)', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      let q = apply(p, request([{ op: 'delete', fileId, expectContentVersion: 1 }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      q = apply(q, request([{ op: 'move', fileId, expectPathVersion: 1, newPath: 'src/kept.cpp' }], who('ghu-1')), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      expect(conflicted(merged.outcome).failures.map((f) => f.kind)).toEqual(['delete_edited']);
      expect(at(merged.project, 'src/kept.cpp')).toBeDefined();
    });

    it('an agent EDIT of a file a human deleted is a conflict (edit_deleted)', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      let q = apply(p, request([{ op: 'update', fileId, expectContentVersion: 1, ...h.blob('agent') }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      q = apply(q, request([{ op: 'delete', fileId, expectContentVersion: 1 }], who('ghu-1')), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      expect(conflicted(merged.outcome).failures.map((f) => f.kind)).toEqual(['edit_deleted']);
      expect(main(merged.project).entries.get(fileId)?.deleted).toBe(true);
    });

    it('an agent DELETE of a file nobody else touched lands as a tombstone', () => {
      const h = harness();
      const { p, branchId, fileId } = forkedWithFile(h);
      const q = apply(p, request([{ op: 'delete', fileId, expectContentVersion: 1 }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
      const merged = mergeOf(q, branchId, h);
      committed(merged.outcome);
      expect(main(merged.project).entries.get(fileId)?.deleted).toBe(true);
      expect(at(merged.project, 'src/main.cpp')).toBeUndefined();
    });
  });

  it('a clone forks from its agent\'s branch and merges into THAT branch, not main', () => {
    const h = harness();
    const p1 = seeded(h);
    const agent = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-7', 'julius') }, h.ctx);
    if (!agent.ok) throw new Error(agent.error.message);
    const clone = forkWfsBranch(agent.value.project, { fromBranchId: agent.value.branchId, owner: who('clone-1', 'clone') }, h.ctx);
    if (!clone.ok) throw new Error(clone.error.message);
    const p = apply(clone.value.project, request([{ op: 'create', path: 'src/from-clone.cpp', kind: 'file', ...h.blob('clone') }], who('clone-1', 'clone'), { branchId: clone.value.branchId }), h.ctx).project;
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId: clone.value.branchId, principal: who('clone-1', 'clone'), approval: null, reviewVerdict: null, approverRoleNow: null }, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    expect(committed(merged.value.outcome).branchId).toBe(agent.value.branchId);
    expect(at(merged.value.project, 'src/from-clone.cpp', agent.value.branchId)).toBeDefined();
    expect(at(merged.value.project, 'src/from-clone.cpp')).toBeUndefined();
  });

  it('a discarded branch refuses further commits, and its commits stay in history', () => {
    const h = harness();
    const p1 = seeded(h);
    const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('agent-x', 'imported_agent') }, h.ctx);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    const p = apply(fork.value.project, request([{ op: 'create', path: 'x.txt', kind: 'file', ...h.blob('x') }], who('agent-x', 'imported_agent'), { branchId }), h.ctx).project;
    const discarded = discardWfsBranch(p, branchId, h.ctx.nowIso);
    if (!discarded.ok) throw new Error(discarded.error.message);
    expect(discarded.value.branches.get(branchId)?.commits).toHaveLength(1);
    const late = applyWfsCommit(discarded.value, request([{ op: 'create', path: 'y.txt', kind: 'file', ...h.blob('y') }], who('agent-x', 'imported_agent'), { branchId }), h.ctx);
    expect(late.ok).toBe(false);
    if (late.ok) throw new Error('accepted');
    expect(late.error.code).toBe('immutable');
    const mainDiscard = discardWfsBranch(discarded.value, WFS_MAIN_BRANCH, h.ctx.nowIso);
    expect(mainDiscard.ok).toBe(false);
  });
});

describe('WonderFS engine: T-LIMITS (§11)', () => {
  it('refuses a commit that grows a project past its file limit, and changes nothing', () => {
    const h = harness();
    const ctx = h.withLimits({ ...WFS_ALPHA_LIMITS, maxFiles: 2 });
    const p1 = apply(emptyWfsProject('prj-1', sha), request([
      { op: 'create', path: 'a', kind: 'file', ...h.blob('a') },
      { op: 'create', path: 'b', kind: 'file', ...h.blob('b') },
    ], who('ghu-1')), ctx).project;
    const r = applyWfsCommit(p1, request([{ op: 'create', path: 'c', kind: 'file', ...h.blob('c') }], who('ghu-1')), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('accepted');
    expect(r.error.code).toBe('budget-exceeded');
    expect(main(p1).headRev).toBe(1);
  });

  it('K1 (contract r1.6.2 r1 / §21 K1): DIRECTORIES count toward §11\'s entries limit -- a directory-only commit past it is refused and changes nothing (CONTROL: the files-only count let it land); a shrink of directories lands, and growing again is refused', () => {
    const h = harness();
    const ctx = h.withLimits({ ...WFS_ALPHA_LIMITS, maxFiles: 2 });
    // CONTROL: two folders are two entries, within the limit
    const p1 = apply(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'd1', kind: 'dir' }, { op: 'create', path: 'd2', kind: 'dir' }], who('ghu-1')), ctx).project;
    const r = applyWfsCommit(p1, request([{ op: 'create', path: 'd3', kind: 'dir' }], who('ghu-1'), { baseRev: 1 }), ctx);
    expect(r.ok === false && [r.error.code, r.error.message]).toEqual(['budget-exceeded', 'This project is full: delete something, or keep this change for later.']);
    expect(main(p1).headRev).toBe(1);
    // a file beside folders: one file, but three entries
    const mixed = applyWfsCommit(p1, request([{ op: 'create', path: 'f.txt', kind: 'file', ...h.blob('f') }], who('ghu-1'), { baseRev: 1 }), ctx);
    expect(mixed.ok === false && mixed.error.code, 'a file is an entry beside the folders').toBe('budget-exceeded');
    // the same project under a tighter limit (one entry): deleting a folder SHRINKS it and lands; growing again is refused
    const tight = h.withLimits({ ...WFS_ALPHA_LIMITS, maxFiles: 1 });
    const shrunk = apply(p1, request([{ op: 'delete', fileId: entry(p1, 'd2').fileId, expectSubtreeRev: 1 }], who('ghu-1'), { baseRev: 1 }), tight);
    expect(committed(shrunk.outcome).rev, 'CONTROL: a shrink lands').toBe(2);
    const again = applyWfsCommit(shrunk.project, request([{ op: 'create', path: 'd4', kind: 'dir' }], who('ghu-1'), { baseRev: 2 }), tight);
    expect(again.ok === false && again.error.code, 'growing again is refused').toBe('budget-exceeded');
  });

  it('still allows a commit that SHRINKS a project that is over a (lowered) limit', () => {
    const h = harness();
    const p1 = apply(emptyWfsProject('prj-1', sha), request([
      { op: 'create', path: 'a', kind: 'file', ...h.blob('a') },
      { op: 'create', path: 'b', kind: 'file', ...h.blob('b') },
    ], who('ghu-1')), h.ctx).project;
    const tight = h.withLimits({ ...WFS_ALPHA_LIMITS, maxFiles: 1 });
    const out = apply(p1, request([{ op: 'delete', fileId: entry(p1, 'a').fileId, expectContentVersion: 1 }], who('ghu-1')), tight);
    committed(out.outcome);
  });

  it('refuses a file over the per-file size limit before anything is checked against the tree', () => {
    const h = harness();
    const ctx = h.withLimits({ ...WFS_ALPHA_LIMITS, maxFileBytes: 4 });
    const r = applyWfsCommit(emptyWfsProject('prj-1', sha), request([{ op: 'create', path: 'big', kind: 'file', ...h.blob('12345') }], who('ghu-1')), ctx);
    expect(r.ok).toBe(false);
  });
});

describe('WonderFS engine: r1.2 §19.M1 (T-APPROVAL-BIND) and §19.M7 (anchored chains)', () => {
  /** An agent branch of the given owner kind with ONE commit on it (head H1). */
  function agentWithOneCommit(h: Harness, kind: 'julius' | 'imported_agent'): { p: WfsProjectState; branchId: string; owner: WfsPrincipal } {
    const p1 = seeded(h);
    const owner = who(kind === 'julius' ? 'julius-7' : 'agent-x', kind);
    const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner }, h.ctx);
    if (!fork.ok) throw new Error(fork.error.message);
    const p = apply(fork.value.project, request([{ op: 'create', path: 'src/h1.cpp', kind: 'file', ...h.blob('h1') }], owner, { branchId: fork.value.branchId }), h.ctx).project;
    return { p, branchId: fork.value.branchId, owner };
  }
  /** r1.4 N-minor-1: an approval as the server writes it, for a human holding `roleNow`. */
  function approve(p: WfsProjectState, branchId: string, principal: WfsPrincipal, roleNow: WfsHumanRole | null, approvalId: string): WfsMergeApproval {
    const r = issueWfsApproval(p, { approvalId, branchId, principal, roleNow }, '2026-10-11T04:00:00.000Z');
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }
  function refusedAs(r: ReturnType<typeof mergeBackWfsBranch>, code: string, detail: string): void {
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('merged');
    expect(r.error.code).toBe(code);
    expect(r.error.details).toEqual([`wonderfs: ${detail}`]);
  }

  it('a Julius merge into main needs a review verdict, and only a verdict for the CURRENT head merges', () => {
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'julius');
    refusedAs(mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: null, approverRoleNow: null }, h.ctx), 'evidence-required', 'review_required');
    const forH1 = verdictFor(p, branchId);
    // one more branch commit after the review: H2
    const p2 = apply(p, request([{ op: 'create', path: 'src/h2.cpp', kind: 'file', ...h.blob('h2, unreviewed') }], owner, { branchId }), h.ctx).project;
    const headBefore = main(p2).headRev;
    refusedAs(mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: forH1, approverRoleNow: null }, h.ctx), 'stale-context', 'review_stale');
    expect(main(p2).headRev).toBe(headBefore);
    expect(p2.branches.get(branchId)?.closed).toBeNull();
    // a verdict naming another branch is stale too
    refusedAs(mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: { ...verdictFor(p2, branchId), reviewedBranchId: 'branch-other' }, approverRoleNow: null }, h.ctx), 'stale-context', 'review_stale');
    const forH2 = verdictFor(p2, branchId);
    const merged = mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: forH2, approverRoleNow: null }, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    const done = committed(merged.value.outcome);
    expect(main(merged.value.project).commits[done.rev - 1].reviewVerdict).toEqual(forH2);
    expect(at(merged.value.project, 'src/h2.cpp')).toBeDefined();
  });

  it("an imported agent's merge into main needs a person's approval bound to the head; a stale one is refused", () => {
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'imported_agent');
    refusedAs(mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: null, approverRoleNow: null }, h.ctx), 'evidence-required', 'approval_required');
    const editor = who('ghu-editor');
    const approval = approve(p, branchId, editor, 'editor', 'appr-1');
    const p2 = apply(p, request([{ op: 'create', path: 'src/later.cpp', kind: 'file', ...h.blob('after the approval') }], owner, { branchId }), h.ctx).project;
    refusedAs(mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval, reviewVerdict: null, approverRoleNow: 'editor' }, h.ctx), 'stale-context', 'approval_stale');
    // an approval naming another branch is stale too, whatever head it names
    const otherBranch = { ...approve(p2, branchId, editor, 'editor', 'appr-x'), branchId: 'branch-other' };
    refusedAs(mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval: otherBranch, reviewVerdict: null, approverRoleNow: 'editor' }, h.ctx), 'stale-context', 'approval_stale');
    const fresh = approve(p2, branchId, editor, 'editor', 'appr-2');
    const merged = mergeBackWfsBranch(p2, { requestId: rid(), branchId, principal: owner, approval: fresh, reviewVerdict: null, approverRoleNow: 'editor' }, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    const done = committed(merged.value.outcome);
    expect(main(merged.value.project).commits[done.rev - 1].approval).toEqual(fresh);
  });

  it('N-minor-1 (a): only a HUMAN editor or owner writes an approval; approvedBy is the server-set principal, bound to the head now', () => {
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'imported_agent');
    const forbidden = (principal: WfsPrincipal, roleNow: WfsHumanRole | null, onBranch: string = branchId): void => {
      const r = issueWfsApproval(p, { approvalId: 'appr-x', branchId: onBranch, principal, roleNow }, h.ctx.nowIso);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('approved');
      expect(r.error.code).toBe('permission-denied');
      expect(r.error.details).toEqual(['wonderfs: approval_forbidden']);
    };
    forbidden(owner, 'editor'); // the imported agent itself (an agent grant), even with a role handed in
    forbidden(who('clone-1', 'clone'), 'editor');
    forbidden(who('julius-7', 'julius'), 'owner');
    forbidden(who('svc-1', 'service'), 'owner');
    forbidden(who('ghu-viewer'), 'viewer'); // a person without edit rights
    forbidden(who('ghu-gone'), null); // a person no longer a member
    forbidden(owner, 'editor', 'branch-that-does-not-exist'); // decided before the lookup: the same answer, no existence leak

    const b = p.branches.get(branchId)!;
    const r = issueWfsApproval(p, { approvalId: 'appr-1', branchId, principal: who('ghu-owner'), roleNow: 'owner' }, h.ctx.nowIso);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toEqual({ approvalId: 'appr-1', branchId, approvedBy: 'ghu-owner', approvedHeadCommitHash: b.headCommitHash, approvedBaseRev: b.parent!.forkRev, approvedAtIso: h.ctx.nowIso });
    expect(issueWfsApproval(p, { approvalId: 'appr-2', branchId: WFS_MAIN_BRANCH, principal: who('ghu-owner'), roleNow: 'owner' }, h.ctx.nowIso).ok).toBe(false);
  });

  it('N-minor-1 (b): the approver demoted or removed before the merge -> refused (an issue-time-only check would accept it)', () => {
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'imported_agent');
    const approval = approve(p, branchId, who('ghu-editor'), 'editor', 'appr-1');
    const headBefore = main(p).headRev;
    for (const roleNow of ['viewer', null] as const) {
      refusedAs(mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: owner, approval, reviewVerdict: null, approverRoleNow: roleNow }, h.ctx), 'stale-context', 'approval_stale');
    }
    expect(main(p).headRev).toBe(headBefore);
    expect(p.branches.get(branchId)?.closed).toBeNull();
    // the same approval, its approver still able to edit (here promoted to owner), merges
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: owner, approval, reviewVerdict: null, approverRoleNow: 'owner' }, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    expect(main(merged.value.project).commits[committed(merged.value.outcome).rev - 1].approval).toEqual(approval);
  });

  it('T-CRASH for a merge: the same runner re-sends it after a restart (a new session ref) -> the ORIGINAL merge; another attempt -> refused', () => {
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'julius');
    const runner: WfsPrincipal = { ...owner, sessionId: 'sref-1', missionId: 'mission-1', attemptId: 'attempt-1' };
    const input = { requestId: rid(), branchId, principal: runner, approval: null, reviewVerdict: verdictFor(p, branchId), approverRoleNow: null };
    const merged = mergeBackWfsBranch(p, input, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    // the branch is closed now: only the stored answer can reply, and it does
    const again = mergeBackWfsBranch(merged.value.project, { ...input, principal: { ...runner, sessionId: 'sref-2', clientBuild: 'build-2' } }, h.ctx);
    if (!again.ok) throw new Error(again.error.message);
    expect(again.value.outcome).toEqual({ ...merged.value.outcome, replay: true });
    expect(again.value.project).toBe(merged.value.project);
    // CONTROL: the same request id under another attempt is not this request (K4: another actor, an independent request) -- it is
    // never answered with this merge; judged afresh, it meets the branch this merge closed
    const otherAttempt = mergeBackWfsBranch(merged.value.project, { ...input, principal: { ...runner, attemptId: 'attempt-2' } }, h.ctx);
    expect(otherAttempt.ok === false && otherAttempt.error.code).toBe('immutable');
  });

  it('R0a review MINOR-2: the request-identity hash is VERSIONED (wfs-req.2) for commits AND merges; a row stored under another formula is refused, never answered', () => {
    expect(WFS_REQUEST_HASH_VERSION).toBe('wfs-req.2');
    const h = harness();
    const { p, branchId, owner } = agentWithOneCommit(h, 'julius');
    const actorOf = (x: WfsPrincipal) => ({ kind: x.kind, id: x.id, onBehalfOf: x.onBehalfOf, grantId: x.grantId, missionId: x.missionId, attemptId: x.attemptId });
    // K4 (contract r1.6.2 e2): a request is stored under (actor_key, request_id); actor_key = sha256 of the canonical actor allow-list
    const keyOf = (x: WfsPrincipal, requestId: string) => `${sha(canonicalJson(actorOf(x)))}\n${requestId}`;
    // the COMMIT formula, pinned: the stored hash is the tagged one (CONTROL: dropping `v` from the engine's object turns this red)
    const req = request([{ op: 'create', path: 'tagged.txt', kind: 'file', ...h.blob('t') }], who('ghu-1'));
    const first = apply(p, req, h.ctx);
    const commitBody = { kind: 'commit', branchId: req.branchId, baseRev: req.baseRev, ops: req.ops, actor: actorOf(req.principal), resolvesConflictId: null };
    expect(first.project.requests.get(keyOf(req.principal, req.requestId))?.payloadHash).toBe(sha(canonicalJson({ v: 'wfs-req.2', ...commitBody })));
    // the MERGE formula, pinned the same way
    const input = { requestId: rid(), branchId, principal: owner, approval: null, reviewVerdict: verdictFor(first.project, branchId), approverRoleNow: null };
    const merged = mergeBackWfsBranch(first.project, input, h.ctx);
    if (!merged.ok) throw new Error(merged.error.message);
    const mergeBody = { kind: 'merge', branchId, actor: actorOf(owner), approval: null, reviewVerdict: input.reviewVerdict };
    expect(merged.value.project.requests.get(keyOf(owner, input.requestId))?.payloadHash).toBe(sha(canonicalJson({ v: 'wfs-req.2', ...mergeBody })));
    // a row written under the UNTAGGED formula (as R0a's code wrote it) is a different formula: its replay is refused, not answered
    const stored = first.project.requests.get(keyOf(req.principal, req.requestId))!;
    const legacy: WfsProjectState = { ...first.project, requests: new Map(first.project.requests).set(keyOf(req.principal, req.requestId), { ...stored, payloadHash: sha(canonicalJson(commitBody)) }) };
    const replayOfLegacy = applyWfsCommit(legacy, req, h.ctx);
    expect(replayOfLegacy.ok === false && replayOfLegacy.error.code).toBe('duplicate-idempotency-key');
    // CONTROL: the same replay against the tagged row is answered with the original revision
    const replayOfTagged = applyWfsCommit(first.project, req, h.ctx);
    expect(replayOfTagged.ok && replayOfTagged.value.outcome).toEqual({ ...first.outcome, replay: true });
  });

  it("main's chain is anchored to its genesis; a branch's first commit links to its parent's head at the fork and says so", () => {
    const h = harness();
    const p1 = seeded(h);
    expect(main(p1).anchorHash).toBe(GENESIS);
    expect(main(p1).commits[0].prevCommitHash).toBe(GENESIS);
    expect(verifyWfsChain(main(p1).commits, sha, GENESIS)).toBeNull();
    expect(verifyWfsChain(main(p1).commits, sha, wfsGenesisHash('prj-other', sha))).toEqual({ rev: 1, reason: 'link' });

    const fork = forkWfsBranch(p1, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-7', 'julius') }, h.ctx);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    const p2 = apply(fork.value.project, request([{ op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
    const branch = p2.branches.get(branchId)!;
    expect(branch.anchorHash).toBe(main(p1).headCommitHash);
    expect(branch.commits[0].prevCommitHash).toBe(main(p1).headCommitHash);
    expect(branch.commits[0].fork).toEqual({ parentBranchId: WFS_MAIN_BRANCH, parentRev: 1 });
    expect(verifyWfsChain(branch.commits, sha, branch.anchorHash)).toBeNull();
    // the branch's chain does not verify against main's genesis: it is anchored to the fork point, not floating
    expect(verifyWfsChain(branch.commits, sha, GENESIS)).toEqual({ rev: 1, reason: 'link' });
    // only a branch's FIRST commit records the fork
    const p3 = apply(p2, request([{ op: 'create', path: 'c.txt', kind: 'file', ...h.blob('c') }], who('julius-7', 'julius'), { branchId }), h.ctx).project;
    expect(p3.branches.get(branchId)!.commits[1].fork).toBeNull();
  });
});
