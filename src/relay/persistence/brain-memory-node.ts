import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import {
  emptyShortTermMemory,
  type RelayShortTermMemory,
} from '../shared/llmops/brain-memory';

/**
 * DURABLE PROJECT BRAIN — short-term memory that survives a restart.
 *
 * The Brain's short-term memory was a pure projection nobody persisted: a run
 * folded episodes into an in-memory value that vanished when the process ended,
 * so "write verified Mission results into Project Brain" was satisfied by a fold
 * with no store behind it. This is the store — one JSON document per project
 * key, holding exactly the `RelayShortTermMemory` the domain already produces.
 *
 * IT STORES, IT DOES NOT DECIDE. The fold (`rememberShipRun`, `rememberShortTerm`)
 * stays the domain's; this only loads the current memory, hands it to the fold,
 * and writes the result back atomically. It never promotes to long-term memory —
 * promotion is a human-gated proposal, and an episode is not a durable fact.
 *
 * `load` returns EMPTY, never null, on an absent or unreadable document: an
 * absent Brain is an empty Brain, and a corrupt file must not crash a ship. It
 * refuses to read or write outside the resolved state root.
 */

export interface BrainMemoryStore {
  /** The project's short-term memory, or empty when there is none yet. */
  load(key: string): RelayShortTermMemory;
  /** Overwrite the project's short-term memory atomically. */
  save(key: string, memory: RelayShortTermMemory): void;
}

export function createBrainMemoryStore(options: { readonly root: string }): BrainMemoryStore {
  const resolvedRoot = resolve(options.root);
  const dir = join(resolvedRoot, 'brain-memory');

  // The key is a repositoryKey/projectId; encode it so a slash or ':' cannot
  // escape the directory, and re-check the resolved path is inside the root.
  const pathFor = (key: string): string | null => {
    const file = join(dir, `${encodeURIComponent(key)}.json`);
    const resolved = resolve(file);
    if (resolved !== dir && !resolved.startsWith(dir + sep)) return null;
    return resolved;
  };

  return {
    load(key) {
      const path = pathFor(key);
      if (path === null) return emptyShortTermMemory();
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        return emptyShortTermMemory(); // absent → empty
      }
      try {
        const parsed = JSON.parse(raw) as RelayShortTermMemory;
        if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
          return emptyShortTermMemory(); // corrupt → empty, never a crash
        }
        return { entries: parsed.entries, evicted: typeof parsed.evicted === 'number' ? parsed.evicted : 0 };
      } catch {
        return emptyShortTermMemory();
      }
    },

    save(key, memory) {
      if (!isAbsolute(resolvedRoot)) return;
      const path = pathFor(key);
      if (path === null) return;
      mkdirSync(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(memory), 'utf8');
      renameSync(tmp, path); // atomic replace
    },
  };
}
