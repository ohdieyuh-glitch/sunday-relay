import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyWfsCommit,
  emptyWfsProject,
  wfsBlobIntegrity,
  wfsBoundPage,
  wfsCheckTreeQuery,
  wfsCompareKeys,
  wfsConflictClosing,
  wfsDecodeTreeCursor,
  wfsEncodeTreeCursor,
  wfsJsonBytes,
  wfsOutcomeEvent,
  WFS_ALPHA_LIMITS,
  WFS_CONFLICT_RETENTION_MS,
  WFS_MAIN_BRANCH,
  WFS_PAGE_MAX_LIMIT,
  type WfsEngineContext,
  type WfsPrincipal,
  type WfsProjectState,
} from './index';

/** The helpers BOTH stores page, order and judge with (wonderfs-store.ts): if one is wrong, both stores are wrong the same way. */

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const shaBytes = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('WonderFS store helpers: order', () => {
  it('wfsCompareKeys is CODE-POINT order (= UTF-8 bytes = PostgreSQL COLLATE "C"), not the default UTF-16 order', () => {
    const keys = ['\u{1f600}', 'ａ', 'é', 'z', 'a', 'ab', '\u{10000}', '￿'];
    expect([...keys].sort(wfsCompareKeys)).toEqual(['a', 'ab', 'z', 'é', 'ａ', '￿', '\u{10000}', '\u{1f600}']);
    // the same order as the UTF-8 bytes
    const byBytes = [...keys].sort((x, y) => Buffer.compare(Buffer.from(x, 'utf8'), Buffer.from(y, 'utf8')));
    expect([...keys].sort(wfsCompareKeys)).toEqual(byBytes);
    // CONTROL: the default sort puts the astral characters before U+E000..U+FFFF
    expect([...keys].sort()).not.toEqual(byBytes);
    expect(wfsCompareKeys('same', 'same')).toBe(0);
    expect(wfsCompareKeys('\u{1f600}a', '\u{1f600}b')).toBe(-1);
    expect(wfsCompareKeys('\u{1f600}', '\u{1f600}')).toBe(0);
  });
});

describe('WonderFS store helpers: pages', () => {
  it('wfsJsonBytes is the exact UTF-8 length of the JSON, astral and lone surrogates included', () => {
    for (const v of ['', 'ascii', 'éè', '字文', '\u{1f600}x', 'lone \ud800 high', 'lone \udc00 low', { a: ['\u{10ffff}', 1, null, true] }, [1, 'two']]) {
      expect(wfsJsonBytes(v), JSON.stringify(v)).toBe(Buffer.byteLength(JSON.stringify(v), 'utf8'));
    }
  });

  it('wfsBoundPage: at most `limit` items, at most the byte bound, the first item always (an oversized one alone), and whether more follow', () => {
    const rows = ['aaaa', 'bbbb', 'cccc', 'dddd'];
    expect(wfsBoundPage(rows, 2)).toEqual({ items: ['aaaa', 'bbbb'], more: true });
    expect(wfsBoundPage(rows, 4)).toEqual({ items: rows, more: false });
    expect(wfsBoundPage(rows.slice(0, 3), 2)).toEqual({ items: ['aaaa', 'bbbb'], more: true });
    // "aaaa" is 6 bytes of JSON; the list's brackets 2; each further item + 1 comma: 2 + 6 + 7 = 15
    expect(wfsBoundPage(rows, 4, 15)).toEqual({ items: ['aaaa', 'bbbb'], more: true });
    expect(wfsBoundPage(rows, 4, 14)).toEqual({ items: ['aaaa'], more: true });
    // an item larger than the whole bound is still served, alone, so a reader moves on
    expect(wfsBoundPage(['x'.repeat(100), 'y'], 10, 20)).toEqual({ items: ['x'.repeat(100)], more: true });
    expect(wfsBoundPage([], 10)).toEqual({ items: [], more: false });
    // the bound holds for the list as JSON
    const big = Array.from({ length: 50 }, (_, i) => `item-${i}-${'字'.repeat(i)}`);
    const page = wfsBoundPage(big, 50, 1000);
    expect(Buffer.byteLength(JSON.stringify(page.items), 'utf8')).toBeLessThanOrEqual(1000);
    expect(page.more).toBe(true);
  });

  it('a tree cursor carries the revision and the offset, never a path; anything else is refused', () => {
    expect(wfsDecodeTreeCursor(wfsEncodeTreeCursor(12, 400))).toEqual({ rev: 12, offset: 400 });
    expect(wfsDecodeTreeCursor(wfsEncodeTreeCursor(0, 0))).toEqual({ rev: 0, offset: 0 });
    for (const bad of ['', '1', '1.', '.1', '01.1', '1.01', '1.1.1', '-1.1', '1.-1', 'a.b', '1234567890.1', ' 1.1']) expect(wfsDecodeTreeCursor(bad), bad).toBeNull();
    const q = (over: object) => wfsCheckTreeQuery({ branchId: WFS_MAIN_BRANCH, ...over });
    expect(q({})).toEqual({ ok: true, value: { branchId: 'main', rev: null, offset: 0, limit: 200 } });
    expect(q({ rev: 3, limit: WFS_PAGE_MAX_LIMIT })).toEqual({ ok: true, value: { branchId: 'main', rev: 3, offset: 0, limit: WFS_PAGE_MAX_LIMIT } });
    expect(q({ cursor: '3.40' })).toEqual({ ok: true, value: { branchId: 'main', rev: 3, offset: 40, limit: 200 } });
    expect(q({ rev: 3, cursor: '3.40' })).toEqual({ ok: true, value: { branchId: 'main', rev: 3, offset: 40, limit: 200 } });
    for (const over of [{ rev: 4, cursor: '3.40' }, { cursor: 'x' }, { rev: 1.5 }, { rev: -1 }, { limit: 0 }, { limit: WFS_PAGE_MAX_LIMIT + 1 }, { branchId: 'a/b' }, { branchId: '' }]) {
      const r = q(over);
      expect(r.ok === false && r.error.code, JSON.stringify(over)).toBe('validation-failed');
    }
  });
});

describe('WonderFS store helpers: blobs, conflicts, events', () => {
  it('wfsBlobIntegrity: absent / bytes missing / size / hash / intact', () => {
    const bytes = new TextEncoder().encode('bytes');
    const h = shaBytes(bytes);
    expect(wfsBlobIntegrity(h, null, null, shaBytes)).toEqual({ status: 'absent' });
    expect(wfsBlobIntegrity(h, 5, null, shaBytes)).toEqual({ status: 'corrupt', reason: 'bytes_missing' });
    expect(wfsBlobIntegrity(h, 6, bytes, shaBytes)).toEqual({ status: 'corrupt', reason: 'size_mismatch' });
    expect(wfsBlobIntegrity(h, 5, new TextEncoder().encode('bytez'), shaBytes)).toEqual({ status: 'corrupt', reason: 'hash_mismatch' });
    expect(wfsBlobIntegrity(h, 5, bytes, shaBytes)).toEqual({ status: 'intact', size: 5 });
  });

  it('wfsConflictClosing: open; keep-theirs (no ops) = dismissed; keep-mine = resolved; closed at the RESOLVING commit, kept 30 days', () => {
    const who: WfsPrincipal = { kind: 'human', id: 'ghu-1', onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null };
    let n = 0;
    const blobs = new Map([[sha('a'), 1], [sha('b'), 1], [sha('c'), 1]]);
    const ctx = (nowIso: string): WfsEngineContext => ({ nowIso, newId: (k) => `${k}-${(n += 1)}`, sha256Hex: sha, blobSize: (x) => blobs.get(x) ?? null, limits: WFS_ALPHA_LIMITS });
    const apply = (p: WfsProjectState, ops: Parameters<typeof applyWfsCommit>[1]['ops'], at: string, resolvesConflictId: string | null = null): { p: WfsProjectState; conflictId: string | null } => {
      const r = applyWfsCommit(p, { requestId: `req-${String(n).padStart(8, '0')}x`, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who, ops, resolvesConflictId }, ctx(at));
      if (!r.ok) throw new Error(r.error.message);
      return { p: r.value.project, conflictId: r.value.outcome.status === 'conflict' ? r.value.outcome.conflictId : null };
    };
    const T0 = '2026-10-12T09:00:00.000Z';
    const T1 = '2026-10-12T10:00:00.000Z';
    const LATER = '2026-10-13T00:00:00.000Z';
    let p = apply(emptyWfsProject('prj-1', sha), [{ op: 'create', path: 'f', kind: 'file', sha256: sha('a'), size: 1 }], T0).p;
    const fileId = [...p.branches.get(WFS_MAIN_BRANCH)!.entries.keys()][0];
    p = apply(p, [{ op: 'update', fileId, expectContentVersion: 1, sha256: sha('b'), size: 1 }], T0).p;
    const stale = [{ op: 'update' as const, fileId, expectContentVersion: 1, sha256: sha('c'), size: 1 }];
    const first = apply(p, stale, T0);
    const second = apply(first.p, stale, T0);
    p = second.p;
    expect(wfsConflictClosing(p.conflicts.get(first.conflictId!)!, p.branches, LATER)).toEqual({ status: 'open', closedAtIso: null, retainUntilIso: null });
    p = apply(p, [], T1, first.conflictId).p;
    p = apply(p, [{ op: 'update', fileId, expectContentVersion: 2, sha256: sha('c'), size: 1 }], T1, second.conflictId).p;
    const retain = new Date(Date.parse(T1) + WFS_CONFLICT_RETENTION_MS).toISOString();
    expect(wfsConflictClosing(p.conflicts.get(first.conflictId!)!, p.branches, LATER)).toEqual({ status: 'dismissed', closedAtIso: T1, retainUntilIso: retain });
    expect(wfsConflictClosing(p.conflicts.get(second.conflictId!)!, p.branches, LATER)).toEqual({ status: 'resolved', closedAtIso: T1, retainUntilIso: retain });
    expect(WFS_CONFLICT_RETENTION_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('wfsOutcomeEvent: one event per change (commit or conflict); a replay records none', () => {
    const committed = { status: 'committed', branchId: 'main', rev: 3, commitId: 'commit-1', commitHash: 'h', replay: false } as const;
    expect(wfsOutcomeEvent(committed, 'commit')).toEqual({ kind: 'commit', body: { branchId: 'main', rev: 3, commitId: 'commit-1' } });
    expect(wfsOutcomeEvent(committed, 'branch.merge')).toEqual({ kind: 'branch.merge', body: { branchId: 'main', rev: 3, commitId: 'commit-1' } });
    expect(wfsOutcomeEvent({ status: 'conflict', branchId: 'main', conflictId: 'conflict-1', failures: [], headRev: 2, replay: false }, 'commit')).toEqual({ kind: 'conflict', body: { branchId: 'main', conflictId: 'conflict-1' } });
    expect(wfsOutcomeEvent({ ...committed, replay: true }, 'commit')).toBeNull();
  });
});

/**
 * R0b-fix (CI r1.7, real PostgreSQL): the events page came back as [1, 10, 11, 12, ...]. Its SQL said `SELECT seq::text AS seq ...
 * ORDER BY seq`, and PostgreSQL binds a bare ORDER BY name to an OUTPUT column first -- the TEXT alias, not the bigint column. The
 * conformance case NUMERIC-KEYS catches it on rows (CI); this catches the SHAPE here, on every run, with no database: no query of
 * the PostgreSQL store may order by a bare name that some SELECT list in it re-types (`x::type AS name`).
 */
function orderByRetypedAlias(source: string): string[] {
  const retyped = new Set([...source.matchAll(/[\w.]+::\w+ AS (\w+)/gu)].map((m) => m[1]));
  const offenders: string[] = [];
  for (const m of source.matchAll(/ORDER BY\s+([\s\S]*?)(?=\s+LIMIT\b|\s+OFFSET\b|\)|`|'|$)/gu)) {
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+/u)[0];
      if (!name.includes('.') && retyped.has(name)) offenders.push(name);
    }
  }
  return offenders;
}

describe('WonderFS store: numeric paging keys in SQL (R0b-fix, CI r1.7)', () => {
  it('no query of the PostgreSQL store orders by a bare name it re-typed as an output alias; CONTROL: the query that failed CI is caught, its fix is not', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'relay', 'persistence', 'wonderfs-postgres.ts'), 'utf8');
    expect(source).toContain('ORDER BY'); // the scan has something to read
    expect(orderByRetypedAlias(source)).toEqual([]);
    expect(orderByRetypedAlias("'SELECT seq::text AS seq, kind, body, at FROM relay_wonderland.wfs_events WHERE project_id = $1 AND seq > $2 ORDER BY seq LIMIT $3'")).toEqual(['seq']);
    expect(orderByRetypedAlias("'SELECT e.seq::text AS seq FROM relay_wonderland.wfs_events e WHERE e.seq > $2 ORDER BY e.seq LIMIT $3'")).toEqual([]);
    expect(orderByRetypedAlias("const C = 'size::text AS size'; `SELECT ${C} FROM t ORDER BY path_key COLLATE \"C\", size DESC LIMIT 1`")).toEqual(['size']);
  });
});
