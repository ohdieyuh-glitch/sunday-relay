/**
 * FIRST-TIME BOOTSTRAP OF AN EMPTY JULIUS STORE (migration 030 deploy, path R1).
 *
 * THE PREMISE THE 030 GATES WERE BUILT ON WAS FALSE. The founder's live
 * pre-deploy (2026-10-03T16:46:02Z) refused because the workstation `julius`
 * database had never been initialized: no schema, no ledger, no tables. The
 * gates assumed a populated store at 029. Every CI run and every paid run
 * already initializes an empty disposable database through `migrate()`; what
 * the persistent workstation store lacked was a REVIEWED, recorded transition
 * from EMPTY, so that no ordinary entry point initializes it by accident.
 *
 * This is that transition, and nothing more:
 * - it refuses unless the connection is the expected store (current database AND
 *   the cluster's system identifier) and nobody else is connected;
 * - it refuses unless the store is EMPTY by exactly rules 1-4 of
 *   `docs/julius-migrations/030/classify-store.sql` (a store whose ledger already
 *   holds every version is reported as ALREADY INITIALIZED and left untouched);
 * - it applies the migrations through `migrateIfNeeded`, the same call the
 *   entry points make, never hand-written SQL;
 * - it proves the ledger afterwards: every version, in the build's order;
 * - on ANY failure it says the store is PARTIAL and is not initialized, and
 *   exits non-zero. Only `BOOTSTRAP OK` with exit 0 means success.
 *
 * It reads NO inherited `DATABASE_URL` / `JULIUS_DATABASE_URL` and refuses if
 * either is set (founder ruling R-6, 2026-10-03): the founder's wrapper passes
 * the target explicitly in `JULIUS_BOOTSTRAP_DATABASE_URL`, read from the parked
 * deployment-only `JULIUS_LIVE_STORE_URL`, and the expected identity on the
 * command line. Run it from the checkout root: it checks that every migration
 * it loaded is that checkout's file, byte for byte.
 *
 * Exit codes: 0 BOOTSTRAP OK · 2 BOOTSTRAP FAILED (the store may be PARTIAL) ·
 * 3 REFUSED (nothing written) · 4 configuration error (nothing written).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { WONDERLAND_MIGRATIONS, migrationVersion } from '../src/relay/persistence/wonderland-postgres';
import { migrateIfNeeded } from './julius-live-preflight-identity';

export interface EmptyFacts {
  readonly schemas: string;
  readonly publicObjects: number;
  readonly extraExtensions: string;
  readonly eventTriggers: number;
  readonly hasRelayWonderland: boolean;
  readonly hasLedger: boolean;
}

/** classify-store.sql rules 1-4 (EMPTY), as reasons it is NOT empty; empty list = EMPTY. */
export const notEmptyReasons = (facts: EmptyFacts): string[] => [
  facts.extraExtensions !== '' ? `extension(s) ${facts.extraExtensions}` : null,
  facts.eventTriggers !== 0 ? `${facts.eventTriggers} event trigger(s)` : null,
  facts.schemas !== 'public' ? `schemas are [${facts.schemas}], not [public]` : null,
  facts.publicObjects !== 0 ? `${facts.publicObjects} object(s) in public` : null,
  facts.hasRelayWonderland ? 'schema relay_wonderland exists' : null,
  facts.hasLedger ? 'a migration ledger exists' : null,
].filter((reason): reason is string => reason !== null);

/** The ledger, read back in application order, must be exactly the loaded versions in the build's order. */
export const ledgerOrderProblem = (ledgerInOrder: readonly string[], loaded: readonly string[]): string | null => {
  if (ledgerInOrder.length !== loaded.length) return `ledger holds ${ledgerInOrder.length} versions, the build has ${loaded.length}`;
  const first = loaded.findIndex((version, index) => ledgerInOrder[index] !== version);
  return first === -1 ? null : `position ${first + 1}: ledger has '${ledgerInOrder[first]}', the build expects '${loaded[first]}'`;
};

/** Byte-for-byte the `public_objects` expression of classify-store.sql; a unit test holds the two equal. */
export const PUBLIC_OBJECTS_SQL = `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_collation o JOIN pg_namespace n ON n.oid = o.collnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_conversion o JOIN pg_namespace n ON n.oid = o.connamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_config o JOIN pg_namespace n ON n.oid = o.cfgnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_dict o JOIN pg_namespace n ON n.oid = o.dictnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_parser o JOIN pg_namespace n ON n.oid = o.prsnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_template o JOIN pg_namespace n ON n.oid = o.tmplnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_statistic_ext o JOIN pg_namespace n ON n.oid = o.stxnamespace WHERE n.nspname = 'public')`;

const FACTS_QUERY = `SELECT
  (SELECT coalesce(string_agg(nspname, ',' ORDER BY nspname), '') FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_(toast|temp_|toast_temp_)') AS schemas,
  (${PUBLIC_OBJECTS_SQL})::int AS public_objects,
  (SELECT coalesce(string_agg(extname, ',' ORDER BY extname), '') FROM pg_extension WHERE extname <> 'plpgsql') AS extra_extensions,
  (SELECT count(*)::int FROM pg_event_trigger) AS event_triggers,
  (to_regnamespace('relay_wonderland') IS NOT NULL) AS has_rw,
  (to_regclass('relay_wonderland.schema_migrations') IS NOT NULL) AS has_ledger`;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const argValue = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string, out: (line: string) => void): Promise<number> {
  const url = env.JULIUS_BOOTSTRAP_DATABASE_URL;
  const expectDatabase = argValue(argv, '--expect-database');
  const expectSystemId = argValue(argv, '--expect-system-identifier');
  if (!url || !expectDatabase || !expectSystemId || !/^\d+$/u.test(expectSystemId)) {
    out('BOOTSTRAP CONFIG ERROR: needs JULIUS_BOOTSTRAP_DATABASE_URL, --expect-database <name> and --expect-system-identifier <digits>');
    return 4;
  }
  // R-6: NO INHERITED URL. Every workstation shell used to inherit the live store's URL, which is how an ordinary
  // entry point could initialize it by accident. The wrapper strips both for this process; their presence here means
  // the environment was not cleaned, so nothing runs.
  const inherited = ['DATABASE_URL', 'JULIUS_DATABASE_URL'].filter((name) => (env[name] ?? '') !== '');
  if (inherited.length > 0) {
    out(`BOOTSTRAP CONFIG ERROR: ${inherited.join(' and ')} must not be set for the bootstrap (pass the target only in JULIUS_BOOTSTRAP_DATABASE_URL)`);
    return 4;
  }
  const loaded = WONDERLAND_MIGRATIONS.map((sql) => ({ version: migrationVersion(sql), sha256: sha256(sql), bytes: sql.length }));
  if (loaded.some((entry) => entry.bytes === 0 || entry.version === null)) {
    out('BOOTSTRAP CONFIG ERROR: a migration is not packaged (empty or unstamped); run from the checkout root');
    return 4;
  }
  // R-3: EVERY LOADED MIGRATION IS ITS FILE. migrate() re-applies a file whose stamp parses as null on every run, and
  // migration() loads from the bundle's folder before the checkout's. So the SQL that will run must be, entry for
  // entry, the checkout's files in filename order: same count, the stamp equal to the filename, the same bytes. That
  // also makes the chain's order its filename order, which classify-store.sql's prefix rule relies on.
  const directory = join(cwd, 'src', 'relay', 'persistence', 'wonderland-migrations');
  let files: string[];
  try {
    files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    out(`BOOTSTRAP CONFIG ERROR: no migration directory at ${directory}; run from the checkout root; nothing written`);
    return 4;
  }
  const fileProblem = files.length !== loaded.length
    ? `the checkout has ${files.length} migration files, the build loaded ${loaded.length}`
    : files.map((name, index) => {
      const stem = name.slice(0, -'.sql'.length);
      if (loaded[index].version !== stem) return `entry ${index + 1} stamps '${loaded[index].version}', its file is '${name}'`;
      const onDisk = sha256(readFileSync(join(directory, name), 'utf8'));
      return onDisk === loaded[index].sha256 ? null : `entry ${index + 1} (${name}) differs from the checkout's file`;
    }).find((problem) => problem !== null) ?? null;
  if (fileProblem !== null) {
    out(`BOOTSTRAP CONFIG ERROR: ${fileProblem}; nothing written`);
    return 4;
  }
  const versions = loaded.map((entry) => entry.version as string);
  for (const [index, entry] of loaded.entries()) out(`LOADED ${String(index + 1).padStart(2, '0')} ${entry.version} sha256=${entry.sha256}`);

  const pool = new Pool({ connectionString: url, max: 1, application_name: 'julius-bootstrap-empty-store' });
  try {
    const who = (await pool.query<{ db: string; sid: string; others: number }>(
      `SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS sid,
              (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
                 AND backend_type = 'client backend') AS others`)).rows[0];
    out(`TARGET database=${who.db} system_identifier=${who.sid} other_sessions=${who.others}`);
    if (who.db !== expectDatabase || who.sid !== expectSystemId) {
      out(`BOOTSTRAP REFUSED: connected to ${who.db}/${who.sid}, expected ${expectDatabase}/${expectSystemId}; nothing written`);
      return 3;
    }
    if (who.others !== 0) {
      out(`BOOTSTRAP REFUSED: ${who.others} other session(s) on ${who.db}; stop every writer; nothing written`);
      return 3;
    }
    const row = (await pool.query(FACTS_QUERY)).rows[0];
    const facts: EmptyFacts = {
      schemas: row.schemas, publicObjects: row.public_objects, extraExtensions: row.extra_extensions,
      eventTriggers: row.event_triggers, hasRelayWonderland: row.has_rw, hasLedger: row.has_ledger,
    };
    const reasons = notEmptyReasons(facts);
    if (reasons.length > 0) {
      if (facts.hasLedger) {
        const ledger = (await pool.query<{ version: string }>(
          'SELECT version FROM relay_wonderland.schema_migrations ORDER BY version')).rows.map((r) => r.version);
        if (ledgerOrderProblem(ledger, [...versions].sort()) === null) {
          out(`BOOTSTRAP REFUSED: ALREADY INITIALIZED (the ledger holds exactly the build's ${versions.length} versions); nothing written`);
          return 3;
        }
      }
      out(`BOOTSTRAP REFUSED: the store is not EMPTY: ${reasons.join('; ')}; nothing written`);
      return 3;
    }
    out('EMPTY verified: no relay_wonderland, no ledger, public only and holding nothing');

    let result: { readonly alreadyPresent: number; readonly applied: readonly string[] };
    try {
      // the ONE caller allowed past the protected-store refusal: this store's identity and emptiness were verified above
      result = await migrateIfNeeded(pool, { reviewedBootstrap: { database: who.db, systemIdentifier: who.sid } });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').slice(0, 300);
      const hasLedger = (await pool.query<{ present: boolean }>(
        "SELECT to_regclass('relay_wonderland.schema_migrations') IS NOT NULL AS present")).rows[0].present;
      // Two steps: a query naming a missing table fails at planning, whatever a CASE around it would evaluate.
      const stamped = hasLedger
        ? (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.schema_migrations')).rows[0].n
        : 0;
      out(`BOOTSTRAP FAILED at ${versions[stamped] ?? '(after the last)'}: ${stamped} of ${versions.length} migrations committed; the store is PARTIAL and is not initialized. Cause: ${message}`);
      return 2;
    }
    const ledger = (await pool.query<{ version: string; applied_at: string }>(
      'SELECT version, applied_at::text FROM relay_wonderland.schema_migrations ORDER BY applied_at, version')).rows;
    for (const [index, entry] of ledger.entries()) out(`LEDGER ${String(index + 1).padStart(2, '0')} ${entry.version} applied_at=${entry.applied_at}`);
    const problem = result.alreadyPresent !== 0
      ? `migrateIfNeeded found ${result.alreadyPresent} version(s) already present on a store verified EMPTY`
      : ledgerOrderProblem(ledger.map((entry) => entry.version), versions)
        ?? ledgerOrderProblem([...result.applied], [...versions].sort());
    if (problem !== null) {
      out(`BOOTSTRAP FAILED: the ledger does not prove the chain (${problem}); the store is not initialized as reviewed`);
      return 2;
    }
    out(`BOOTSTRAP OK: ${versions.length} migrations applied in order, ${versions[0]} .. ${versions[versions.length - 1]}`);
    out(`BOOTSTRAP_RECORD ${JSON.stringify({ database: who.db, systemIdentifier: who.sid, applied: versions, loaded })}`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2), process.env, process.cwd(), (line) => process.stdout.write(`${line}\n`))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stdout.write(`BOOTSTRAP FAILED: unexpected error before or after the chain: ${error instanceof Error ? error.message : String(error)}; treat the store as PARTIAL until classified\n`);
      process.exitCode = 2;
    });
}
