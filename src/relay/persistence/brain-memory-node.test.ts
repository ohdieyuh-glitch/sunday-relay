import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createBrainMemoryStore } from './brain-memory-node';
import { emptyShortTermMemory, rememberShortTerm } from '../shared/llmops/brain-memory';
import type { RelayShortTermEntry } from '../shared/llmops/brain-memory';

/**
 * THE DURABLE PROJECT BRAIN — it must survive a restart, treat absent as empty
 * (not a crash), never trust a corrupt file, and never read/write outside the
 * state root.
 */

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } } });
function root(): string { const r = mkdtempSync(join(tmpdir(), 'relay-brain-')); roots.push(r); return r; }

const entry = (id: string): RelayShortTermEntry => ({
  entryId: id, kind: 'run_outcome', headline: `episode ${id}`,
  detail: null, observedAt: '2026-08-12T12:00:00.000Z', repositoryKey: 'k', missionId: 'm',
} as unknown as RelayShortTermEntry);

describe('a Project Brain memory survives a restart', () => {
  it('is read back by a brand-new store over the same root', () => {
    const r = root();
    const key = 'github:github.com/o/proof';
    const memory = rememberShortTerm(emptyShortTermMemory(), entry('e1'));
    createBrainMemoryStore({ root: r }).save(key, memory);

    // A second store, as a restart would create — no shared memory.
    const reopened = createBrainMemoryStore({ root: r }).load(key);
    expect(reopened.entries).toHaveLength(1);
    expect(reopened.entries[0]?.entryId).toBe('e1');
  });

  it('folds successive runs cumulatively', () => {
    const r = root(); const key = 'k1'; const store = createBrainMemoryStore({ root: r });
    store.save(key, rememberShortTerm(store.load(key), entry('a')));
    store.save(key, rememberShortTerm(store.load(key), entry('b')));
    expect(createBrainMemoryStore({ root: r }).load(key).entries.map((e) => e.entryId)).toEqual(['a', 'b']);
  });
});

describe('absent is empty; corrupt is empty; never a crash', () => {
  it('returns empty for a never-written key', () => {
    expect(createBrainMemoryStore({ root: root() }).load('nope')).toEqual(emptyShortTermMemory());
  });
  it('returns empty (not a throw) for a corrupt document', () => {
    const r = root();
    const dir = join(r, 'brain-memory'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${encodeURIComponent('k')}.json`), 'not json {');
    expect(createBrainMemoryStore({ root: r }).load('k')).toEqual(emptyShortTermMemory());
  });
});
