import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  KNOWN_STATE_SCHEMA_VERSIONS, RELAY_STATE_SCHEMA_V0, RELAY_STATE_SCHEMA_VERSION,
  type PersistedEvent,
} from './contracts';
import { eventChecksum, JOURNAL_FILE } from './journal';
import { stableSerialize } from './integrity';
import { writeFileAtomic } from './atomic-file';
import { resolveRunDir } from './paths';

/**
 * Persistence schema migrations (Prompt 8.5). Explicit, deterministic, and
 * backed up: a migration first copies the ENTIRE run directory into
 * `migrations/backup-<run>-<ts>/`, then rewrites in place; any failure
 * rolls the run directory back from that backup. Unknown FUTURE schemas are
 * rejected — they are never guessed and never "migrated" downward. There is
 * no uncontrolled automatic migration: `migrateRun` runs only when invoked
 * explicitly, and loading an old-schema run fails with a migrate-first
 * diagnostic instead of mutating anything.
 */

export interface MigrationResult {
  migrated: boolean;
  fromVersion: string;
  toVersion: string;
  backupDir: string | null;
  detail: string;
}

/** relay-state.v0 → v1: events carried no `attemptId` and named the total
 * budget `budgetMax`. Deterministic rewrite with checksum recomputation. */
function migrateEventV0toV1(raw: Record<string, unknown>): PersistedEvent {
  const payload = { ...(raw.payload as Record<string, unknown> ?? {}) };
  if (payload.budgetMax !== undefined && payload.maxCalls === undefined) {
    payload.maxCalls = payload.budgetMax;
    delete payload.budgetMax;
  }
  const upgraded = {
    ...raw,
    schemaVersion: RELAY_STATE_SCHEMA_VERSION,
    attemptId: typeof raw.attemptId === 'string' && raw.attemptId !== '' ? raw.attemptId : 'attempt-1',
    payload,
  } as Omit<PersistedEvent, 'checksum'> & { checksum?: string };
  delete upgraded.checksum;
  return { ...(upgraded as Omit<PersistedEvent, 'checksum'>), checksum: eventChecksum(upgraded as Omit<PersistedEvent, 'checksum'>) };
}

const MIGRATIONS: Record<string, (runDir: string) => void> = {
  [RELAY_STATE_SCHEMA_V0]: (runDir) => {
    const journalPath = join(runDir, JOURNAL_FILE);
    const lines = existsSync(journalPath)
      ? readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '')
      : [];
    const upgraded = lines.map((line) => stableSerialize(migrateEventV0toV1(JSON.parse(line) as Record<string, unknown>)));
    writeFileAtomic(journalPath, upgraded.map((l) => `${l}\n`).join(''));
    const metadataPath = join(runDir, 'metadata.json');
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      writeFileAtomic(metadataPath, JSON.stringify({ ...metadata, schemaVersion: RELAY_STATE_SCHEMA_VERSION }, null, 1));
    }
    // Old-schema snapshots are removed; the journal (the authority) rebuilds
    // them on the next append/recovery.
    for (const name of ['snapshot.json', 'snapshot.previous.json']) {
      try { rmSync(join(runDir, name), { force: true }); } catch { /* absent */ }
    }
  },
};

export function runSchemaVersion(runDir: string): string | null {
  const metadataPath = join(runDir, 'metadata.json');
  if (!existsSync(metadataPath)) return null;
  try {
    return String((JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>).schemaVersion ?? '');
  } catch {
    return null;
  }
}

export function migrateRun(root: string, reference: string, now: string): RelayResult<MigrationResult> {
  const dir = resolveRunDir(root, 'runs', reference);
  if (!dir.ok) return dir;
  if (!existsSync(dir.value)) return fail(relayError('not-found', 'No persisted run with that reference.'));
  const version = runSchemaVersion(dir.value);
  if (version === null) return fail(relayError('validation-failed', 'Run metadata is unreadable — cannot determine schema.'));
  if (version === RELAY_STATE_SCHEMA_VERSION) {
    return ok({
      migrated: false, fromVersion: version, toVersion: version, backupDir: null,
      detail: 'already at the current schema (no-op migration)',
    });
  }
  if (!(KNOWN_STATE_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return fail(relayError('validation-failed',
      `Unknown schema version ${version} — future or unrecognized schemas are rejected, never guessed.`));
  }
  const migrate = MIGRATIONS[version];
  if (!migrate) {
    return fail(relayError('validation-failed', `No registered migration from ${version}.`));
  }
  const backupDir = join(root, 'migrations', `backup-${reference}-${now.replaceAll(':', '').replaceAll('.', '')}`);
  cpSync(dir.value, backupDir, { recursive: true });
  try {
    migrate(dir.value);
  } catch (err) {
    // Roll back the run directory from the migration backup.
    rmSync(dir.value, { recursive: true, force: true });
    cpSync(backupDir, dir.value, { recursive: true });
    return fail(relayError('validation-failed',
      `Migration failed and was rolled back from the backup: ${(err as Error).message}`));
  }
  return ok({
    migrated: true, fromVersion: version, toVersion: RELAY_STATE_SCHEMA_VERSION,
    backupDir, detail: 'journal rewritten deterministically; snapshots rebuilt from the journal; backup preserved',
  });
}
