import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RELAY_STATE_SCHEMA_VERSION } from './contracts';
import { ensureStateRoot, resolveStateRoot } from './paths';
import { writeFileAtomic, removeIfExists } from './atomic-file';
import { runSchemaVersion } from './migrations';
import { inspectLock } from './lock';

/**
 * State doctor (Prompt 8.5) — truthful, read-mostly report on the durable
 * state directory. The only write is a self-cleaning writability probe
 * inside the state root. Never touches provider credentials or sessions.
 */

export function stateDoctorReport(input: {
  env: Record<string, string | undefined>;
  overrideRoot?: string;
  now: string;
}): { lines: string[]; exitCode: number } {
  const lines: string[] = ['RELAY STATE DOCTOR'];
  const push = (k: string, v: string): void => { lines.push(`  ${k.padEnd(26)} ${v}`); };

  const resolved = resolveStateRoot(input.env, input.overrideRoot);
  if (!resolved.ok) {
    push('State directory', `INVALID — ${resolved.error.message}`);
    return { lines, exitCode: 8 };
  }
  const root = resolved.value.root;
  push('State directory', root);
  push('Resolution source', resolved.value.source);

  let writable = false;
  try {
    ensureStateRoot(root);
    const probe = join(root, `.doctor-probe-${process.pid}`);
    writeFileAtomic(probe, input.now);
    removeIfExists(probe);
    writable = true;
  } catch { /* not writable */ }
  push('Writable', writable ? 'yes' : 'NO');

  let permissions = 'unknown';
  try {
    const mode = statSync(root).mode & 0o777;
    permissions = `0o${mode.toString(8)}${(mode & 0o077) === 0 ? ' (restrictive)' : ' (WARNING: group/other access)'}`;
  } catch { /* unsupported */ }
  push('Permissions', permissions);
  push('Schema version', RELAY_STATE_SCHEMA_VERSION);

  let current = 0, needMigration = 0, unknown = 0, corrupted = 0, heldLocks = 0, staleLocks = 0;
  const runsDir = join(root, 'runs');
  if (existsSync(runsDir)) {
    for (const name of readdirSync(runsDir)) {
      const runDir = join(runsDir, name);
      const version = runSchemaVersion(runDir);
      if (version === RELAY_STATE_SCHEMA_VERSION) current += 1;
      else if (version === null) unknown += 1;
      else needMigration += 1;
      const lock = inspectLock(runDir);
      if (lock.status === 'held_by_live_owner') heldLocks += 1;
      if (lock.status === 'stale_owner_dead' || lock.status === 'unreadable') staleLocks += 1;
    }
  }
  const quarantineDir = join(root, 'quarantine');
  if (existsSync(quarantineDir)) corrupted = readdirSync(quarantineDir).length;

  push('Runs (current schema)', String(current));
  push('Runs needing migration', String(needMigration));
  push('Runs unreadable', String(unknown));
  push('Quarantined records', String(corrupted));
  push('Locks held (live)', String(heldLocks));
  push('Locks stale', String(staleLocks));
  push('Migration status', needMigration === 0 ? 'none pending' : `${needMigration} pending (run explicit migration)`);

  const healthy = writable && unknown === 0;
  push('State health', healthy ? 'ready' : 'NOT READY');
  return { lines, exitCode: healthy ? 0 : 8 };
}
