import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from './integrity';
import type { WorkspaceAssociation } from './contracts';

/**
 * Recovery workspace re-inspection (Prompt 8.5) — READ-ONLY. After a
 * restart, the original in-process workspace registration is gone, so
 * recovery re-inspects the persisted workspace path directly with
 * inspection-only git commands (`rev-parse`, `status --porcelain`) and
 * recomputes claimed-file content digests. Nothing here writes, resets,
 * cleans, checks out, launches a provider, or touches any path outside the
 * persisted workspace/source associations.
 */

export interface RecoveredWorkspaceInspection {
  workspaceExists: boolean;
  headRevision: string | null;
  dirtyFiles: string[];
  claimedFileDigests: Record<string, string>;
  digestsMatchPersisted: boolean;
  sourceExists: boolean;
  sourceHeadRevision: string | null;
  sourceMatchesPersisted: boolean;
}

const GIT_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_TERMINAL_PROMPT: '0' };

function gitReadOnly(args: readonly string[], cwd: string): string | null {
  // Inspection-only surface: rev-parse / status. Never mutate.
  if (args[0] !== 'rev-parse' && args[0] !== 'status') return null;
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8', timeout: 15_000, env: GIT_ENV });
  } catch {
    return null;
  }
}

export function reinspectWorkspace(persisted: WorkspaceAssociation): RecoveredWorkspaceInspection {
  const result: RecoveredWorkspaceInspection = {
    workspaceExists: false, headRevision: null, dirtyFiles: [], claimedFileDigests: {},
    digestsMatchPersisted: false, sourceExists: false, sourceHeadRevision: null, sourceMatchesPersisted: false,
  };

  if (persisted.canonicalPath && existsSync(persisted.canonicalPath)) {
    result.workspaceExists = true;
    result.headRevision = gitReadOnly(['rev-parse', 'HEAD'], persisted.canonicalPath)?.trim() ?? null;
    const status = gitReadOnly(['status', '--porcelain'], persisted.canonicalPath);
    result.dirtyFiles = (status ?? '').split('\n').filter((l) => l.trim() !== '').map((l) => l.slice(3).trim());
    for (const file of persisted.claimedFiles) {
      const abs = join(persisted.canonicalPath, file);
      if (existsSync(abs)) result.claimedFileDigests[file] = sha256Hex(readFileSync(abs, 'utf8'));
    }
    const persistedDigests = persisted.claimedFileDigests;
    const keys = new Set([...Object.keys(persistedDigests), ...Object.keys(result.claimedFileDigests)]);
    result.digestsMatchPersisted = keys.size > 0 &&
      [...keys].every((k) => persistedDigests[k] !== undefined && persistedDigests[k] === result.claimedFileDigests[k]) &&
      (result.headRevision === null || persisted.lastInspectedRevision === null || result.headRevision === persisted.lastInspectedRevision);
  }

  if (persisted.sourceRepositoryPath && existsSync(persisted.sourceRepositoryPath)) {
    result.sourceExists = true;
    result.sourceHeadRevision = gitReadOnly(['rev-parse', 'HEAD'], persisted.sourceRepositoryPath)?.trim() ?? null;
    const sourceStatus = gitReadOnly(['status', '--porcelain'], persisted.sourceRepositoryPath) ?? '';
    const sourceDirty = sourceStatus.split('\n').some((l) => l.trim() !== '');
    result.sourceMatchesPersisted =
      result.sourceHeadRevision !== null && result.sourceHeadRevision === persisted.sourceRevision && !sourceDirty;
  }
  return result;
}
