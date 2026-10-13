import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyWfsCommit,
  discardWfsBranch,
  emptyWfsProject,
  forkWfsBranch,
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
  type WfsLimits,
  type WfsOp,
  type WfsPrincipal,
  type WfsProjectState,
} from './index';

/**
 * The engine's guarantees (§4), one describe each. Every test asserts the state a broken engine would get wrong: a
 * last-writer-wins engine fails T-CONFLICT; a partial-apply engine fails T-ATOMIC; an engine without the request log fails
 * T-IDEMPOTENT; an engine that hashes less than the whole commit fails T-CHAIN.
 */

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

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
  return apply(emptyWfsProject('prj-1'), request([
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
    const p0 = emptyWfsProject('prj-1');
    const r = applyWfsCommit(p0, request([{ op: 'create', path: 'a.txt', kind: 'file', sha256: sha('never uploaded'), size: 14 }], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('accepted');
    expect(r.error.code).toBe('validation-failed');
    expect(main(p0).headRev).toBe(0);
  });

  it('refuses a size that does not match the uploaded content', () => {
    const h = harness();
    const b = h.blob('hello');
    const r = applyWfsCommit(emptyWfsProject('prj-1'), request([{ op: 'create', path: 'a.txt', kind: 'file', sha256: b.sha256, size: b.size + 1 }], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
  });

  it('refuses a merge_put sent by a caller (only merge-back writes it)', () => {
    const h = harness();
    const forged = { op: 'merge_put', fileId: 'file-1', expectVersion: 0, state: { kind: 'file', path: 'x', sha256: null, size: null, deleted: false } } as unknown as WfsOp;
    const r = applyWfsCommit(emptyWfsProject('prj-1'), request([forged], who('ghu-1')), h.ctx);
    expect(r.ok).toBe(false);
  });

  it('refuses a file created in a folder that does not exist (as a preserved conflict)', () => {
    const h = harness();
    const b = h.blob('x');
    const out = apply(emptyWfsProject('prj-1'), request([{ op: 'create', path: 'missing/a.txt', kind: 'file', ...b }], who('ghu-1')), h.ctx);
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
    const p1 = apply(emptyWfsProject('prj-1'), request([
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
    const p1 = apply(emptyWfsProject('prj-1'), request([{ op: 'create', path: 'a', kind: 'dir' }, { op: 'create', path: 'a/b', kind: 'dir' }], who('ghu-1')), h.ctx).project;
    const out = apply(p1, request([{ op: 'move', fileId: entry(p1, 'a').fileId, expectPathVersion: 1, newPath: 'a/b/a' }], who('ghu-1')), h.ctx);
    expect(conflicted(out.outcome).failures[0].kind).toBe('cycle');
  });

  it('T-PATH-TAKEN: a second create of the same path, in another case, is preserved as a conflict', () => {
    const h = harness();
    const first = h.blob('first');
    const second = h.blob('second');
    const p1 = apply(emptyWfsProject('prj-1'), request([{ op: 'create', path: 'Readme.md', kind: 'file', ...first }], who('ghu-alice')), h.ctx).project;
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
    const p0 = emptyWfsProject('prj-1');
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

  it('refuses a request id reused for a different change', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1');
    const req = request([{ op: 'create', path: 'a.txt', kind: 'file', ...h.blob('a') }], who('ghu-1'));
    const first = apply(p0, req, h.ctx);
    const reused = applyWfsCommit(first.project, { ...req, ops: [{ op: 'create', path: 'b.txt', kind: 'file', ...h.blob('b') }] }, h.ctx);
    expect(reused.ok).toBe(false);
    if (reused.ok) throw new Error('accepted');
    expect(reused.error.code).toBe('duplicate-idempotency-key');
  });

  it('does not remember a REFUSED (malformed) request: the corrected request may reuse its id', () => {
    const h = harness();
    const p0 = emptyWfsProject('prj-1');
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
    expect(commits[0].prevCommitHash).toBeNull();
    expect(commits[1].prevCommitHash).toBe(commits[0].commitHash);
    expect(verifyWfsChain(commits, sha)).toBeNull();
  });

  it('detects an edited resulting state, an edited author and a broken link', () => {
    const { commits } = threeCommits();
    const touchedEdited = commits.map((c, i) => (i === 1 ? { ...c, touched: c.touched.map((e) => ({ ...e, sha256: sha('forged') })) } : c));
    expect(verifyWfsChain(touchedEdited, sha)).toEqual({ rev: 2, reason: 'hash' });
    const authorEdited = commits.map((c, i) => (i === 2 ? { ...c, principal: who('ghu-someone-else') } : c));
    expect(verifyWfsChain(authorEdited, sha)).toEqual({ rev: 3, reason: 'hash' });
    const relinked = commits.map((c, i) => (i === 2 ? { ...c, prevCommitHash: commits[0].commitHash } : c));
    expect(verifyWfsChain(relinked, sha)).toEqual({ rev: 3, reason: 'link' });
    expect(verifyWfsChain(commits.slice(1), sha)).toEqual({ rev: 2, reason: 'rev' });
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
    let p = emptyWfsProject('prj-1');
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
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approvedBy: null }, h.ctx);
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
    expect(verifyWfsChain(main(mp).commits, sha)).toBeNull();
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
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approvedBy: null }, h.ctx);
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
      const r = mergeBackWfsBranch(p, { requestId: rid(), branchId, principal: who('julius-7', 'julius'), approvedBy: null }, h.ctx);
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
    const merged = mergeBackWfsBranch(p, { requestId: rid(), branchId: clone.value.branchId, principal: who('clone-1', 'clone'), approvedBy: null }, h.ctx);
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
    const p1 = apply(emptyWfsProject('prj-1'), request([
      { op: 'create', path: 'a', kind: 'file', ...h.blob('a') },
      { op: 'create', path: 'b', kind: 'file', ...h.blob('b') },
    ], who('ghu-1')), ctx).project;
    const r = applyWfsCommit(p1, request([{ op: 'create', path: 'c', kind: 'file', ...h.blob('c') }], who('ghu-1')), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('accepted');
    expect(r.error.code).toBe('budget-exceeded');
    expect(main(p1).headRev).toBe(1);
  });

  it('still allows a commit that SHRINKS a project that is over a (lowered) limit', () => {
    const h = harness();
    const p1 = apply(emptyWfsProject('prj-1'), request([
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
    const r = applyWfsCommit(emptyWfsProject('prj-1'), request([{ op: 'create', path: 'big', kind: 'file', ...h.blob('12345') }], who('ghu-1')), ctx);
    expect(r.ok).toBe(false);
  });
});
