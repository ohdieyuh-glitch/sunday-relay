/**
 * PROTECTED STORES: the databases no migration runner may change by itself (the founder, 2026-10-11, migration 035:
 * "Do not automatically apply 035 to Julius's live database merely because PR #346 merges" and "Verify that no automatic
 * migration runner can bypass these protections after #346 merges").
 *
 * Every runner reaches the chain through `TransactionalWonderlandDatabase.migrate()` (the 035 autorun audit,
 * _qa_handoff/voice/MIGRATION_035_AUTORUN_AUDIT_20261011.md, 6e1408e5). This module tells that choke point which database
 * it is talking to, so it can REFUSE the protected one and execute nothing there. The founder's 10-04 ruling keeps migrate()
 * free for empty and disposable databases (CI, rehearsals, paid-run databases): only an IDENTIFIED protected store is
 * refused. The explicit, reviewed live applies use psql and never reach migrate().
 *
 * How the Julius live store is identified -- any ONE signal suffices:
 *   - S1, a catalog marker: `COMMENT ON DATABASE ... IS 'relay-store-role=julius-live'`, read from the catalog
 *     (shobj_description), which no SET or connection option can change. Written on the live store in 035's window (RUNBOOK step 4m); the only signal that survives a restore into a new cluster.
 *   - S2, the pinned identity: sha256("<system identifier>/<database>") equals the pin taken BY COMMAND from the live store's
 *     own apply record. Per database, so other databases in the same cluster stay migratable.
 *   - S3, when the system identifier is UNREADABLE (a role without the privilege): the database is named `julius`. The live
 *     store's database is `julius`; the hosted Wonderland database is never named `julius` (O1 bootstrap D4), so a
 *     non-superuser on the live store cannot slip past S2 (MAIN JUJU's review, 10-11).
 * There is no environment-variable override: an env token would leak through the many places that spread process.env into
 * child processes. The reviewed EMPTY-store bootstrap passes its verified identity programmatically (wonderland-postgres.ts).
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export interface ProtectedStore {
  readonly role: string;
  /** sha256 of "<system identifier>/<database>", computed by command from the record named in `pinnedFrom`. */
  readonly identitySha256: string;
  readonly pinnedFrom: string;
}

export const PROTECTED_STORES: readonly ProtectedStore[] = Object.freeze([
  Object.freeze({
    role: 'julius-live',
    identitySha256: '6ddb9ccb8e660945c4286dae72459431025a6517b83fcf7e6610e516d21036b7',
    pinnedFrom: 'julius-p10/deploy-034/apply-034-20261007T212137Z.json (sha256 ea899d36455359e2...): .systemIdentifier + "/" + .database, hashed by command',
  }),
]);

/** The database name the live Julius store uses (S3). */
export const PROTECTED_DATABASE_NAMES: readonly string[] = Object.freeze(['julius']);

const MARKER = /(?:^|\s)relay-store-role=([a-z][a-z0-9-]{0,40})(?:\s|$)/u;
const PROTECTED_ROLES: ReadonlySet<string> = new Set(PROTECTED_STORES.map((s) => s.role));

export const storeIdentitySha256 = (systemIdentifier: string, database: string): string =>
  createHash('sha256').update(`${systemIdentifier}/${database}`, 'utf8').digest('hex');

type Queryable = Pick<Pool, 'query'>;

/** PostgreSQL's SQLSTATE for "this role may not": the ONE failure that means a signal is unreadable rather than broken. */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * The database's own identity, or a null system identifier when this role may not read it (SQLSTATE 42501, and nothing else).
 * Any other failure THROWS: a broken read is never a quieter answer (the Reviewer's MINOR-1 on 7d3b2dfe / 0378bcfd).
 */
export async function storeIdentity(q: Queryable): Promise<{ readonly database: string; readonly systemIdentifier: string | null }> {
  const db = await q.query<{ db: string }>('SELECT current_database() AS db');
  const name: unknown = db.rows[0]?.db;
  if (typeof name !== 'string' || name === '') throw new Error('protected-store: current_database() returned no name');
  let systemIdentifier: string | null = null;
  try {
    const sid = await q.query<{ sid: string | null }>('SELECT system_identifier::text AS sid FROM pg_control_system()');
    const value = sid.rows[0]?.sid;
    systemIdentifier = value === null || value === undefined ? null : String(value);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== INSUFFICIENT_PRIVILEGE) throw error;
    systemIdentifier = null;
  }
  return { database: name, systemIdentifier };
}

/**
 * Which protected store this is, or null for any other database. A signal this role MAY NOT read abstains: S2 when the system
 * identifier is denied to it, and S3 then decides by the database name. A read that FAILS for any other reason throws, so a
 * failure can never be taken for "not protected": migrate() then executes nothing, and a writer guard caches nothing.
 */
export async function protectedStoreRole(q: Queryable): Promise<string | null> {
  // S1: pg_database and shobj_description are readable by every role, so this read has no "may not" case. Any failure throws.
  const m = await q.query<{ c: string | null }>("SELECT shobj_description(d.oid, 'pg_database') AS c FROM pg_database d WHERE d.datname = current_database()");
  const marked = MARKER.exec(m.rows[0]?.c ?? '')?.[1] ?? null;
  if (marked !== null && PROTECTED_ROLES.has(marked)) return marked;
  const id = await storeIdentity(q);
  if (id.systemIdentifier !== null) {
    const sha = storeIdentitySha256(id.systemIdentifier, id.database);
    return PROTECTED_STORES.find((s) => s.identitySha256 === sha)?.role ?? null;
  }
  return PROTECTED_DATABASE_NAMES.includes(id.database) ? 'julius-live' : null;
}

/** migrate() refused a protected store: nothing was executed. */
export class ProtectedStoreMigrationRefused extends Error {
  readonly code = 'migration_refused_protected_store';
  constructor(readonly storeRole: string, readonly missingVersions: readonly string[]) {
    super(
      `migration_refused_protected_store: this database is the ${storeRole} store, which no migration runner changes by itself; ` +
        `${missingVersions.length} migration(s) missing (${missingVersions.join(', ')}) reach it only through its reviewed, founder-approved apply. Nothing was executed.`,
    );
    this.name = 'ProtectedStoreMigrationRefused';
  }
}
