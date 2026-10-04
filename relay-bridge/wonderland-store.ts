import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  judgeWonderlandLedger,
  readWonderlandStoreReadiness,
  WONDERLAND_SHIPPED_CHAIN,
  WONDERLAND_SOCIAL_STAMP,
  type WonderlandLedgerJudgement,
} from './wonderland-store-readiness';

/**
 * THE HOSTED WONDERLAND STORE, FROM NOTHING TO MIGRATED, ON A RECORD.
 *
 *   wonderland-store inspect   [--database-env NAME]
 *   wonderland-store bootstrap [--database-env NAME] [--repo DIR] --record DIR --confirm "BOOTSTRAP THE HOSTED WONDERLAND STORE"
 *
 * The hosted bridge never migrates at boot: without a migrated database, social
 * answers 503. This is the one way its store is brought up, and it can only do
 * what it rehearsed.
 *
 * WHICH DATABASE. The URL is read from the environment variable `--database-env`
 * names (default `JULIUS_DATABASE_URL`) and is never printed or recorded.
 * `DATABASE_URL` is never read unless it is named explicitly.
 *
 * WHAT IT WILL TOUCH, decided before anything is written:
 *   EMPTY         no schema but an empty `public`, and no marker. Bootstrap
 *                 marks it, so it can be recognised later, then migrates it.
 *   HOSTED_STORE  carries this tool's marker (`COMMENT ON DATABASE`), and its
 *                 ledger is a gap-free prefix of the chain this build ships.
 *                 Bootstrap applies what is pending, which may be nothing.
 *   Anything else is REFUSED by name, before a single write:
 *     NOT_EMPTY_NOT_MARKED  a database with content this tool did not create,
 *                           which is the permanent Julius store's case;
 *     LEDGER_NOT_A_PREFIX   a gap, or stamps out of order;
 *     AHEAD_OF_THIS_BUILD   a stamp this build neither ships nor stages.
 *
 * HOW. The same `TransactionalWonderlandDatabase.migrate()` the paid job runs
 * over its own fresh database, then a postcheck (the whole chain applied,
 * gap-free, social ready), then the catalog fingerprint
 * (`docs/julius-migrations/030/fingerprint-store.sql`, the instrument the
 * migration window uses). It is recorded both raw and role-neutral, because a
 * hosted store's owner is not a rehearsal's.
 *
 * WHAT IT PROVES ABOUT ITSELF. The record names the commit it ran from and
 * refuses a dirty tree. That the commit is accepted `main`, with the chain
 * landed, is the reviewer's check (`docs/relay/WONDERLAND_HOSTED_STORE.md`).
 *
 * Exit: 0 PASS (or a clean inspect), 2 REFUSED or STOP, 1 usage or environment.
 */

export const WONDERLAND_STORE_TOOL_VERSION = 'wonderland-store.v1';
export const WONDERLAND_STORE_BOOTSTRAP_PHRASE = 'BOOTSTRAP THE HOSTED WONDERLAND STORE';
export const WONDERLAND_STORE_MARKER_PREFIX = 'relay-wonderland-hosted-store:';
const MARKER = /^relay-wonderland-hosted-store:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type WonderlandStoreClassification =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'HOSTED_STORE'; readonly marker: string; readonly ledger: WonderlandLedgerJudgement }
  | { readonly kind: 'REFUSED'; readonly reason: 'NOT_EMPTY_NOT_MARKED' | 'LEDGER_NOT_A_PREFIX' | 'AHEAD_OF_THIS_BUILD'; readonly detail: string };

interface Query { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }> }

/** What the database holds, read-only, and what this tool may therefore do to it. */
export async function classifyWonderlandStore(pool: Pool): Promise<WonderlandStoreClassification> {
  const db = pool as unknown as Query;
  const schemas = (await db.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname !~ '^pg_' ORDER BY nspname")).rows
    .map((row) => row.nspname);
  const publicRelations = Number((await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'")).rows[0]?.n ?? '0');
  const marker = (await db.query<{ marker: string | null }>(
    'SELECT shobj_description(d.oid, \'pg_database\') AS marker FROM pg_database d WHERE d.datname = current_database()')).rows[0]?.marker ?? null;

  if (marker === null && schemas.length === 0 && publicRelations === 0) return { kind: 'EMPTY' };
  if (marker === null || !MARKER.test(marker)) {
    return {
      kind: 'REFUSED', reason: 'NOT_EMPTY_NOT_MARKED',
      detail: `the database holds ${String(schemas.length)} schema(s) beside public and ${String(publicRelations)} relation(s) in public, and no marker this tool wrote: it is not a store this tool created`,
    };
  }
  const foreign = schemas.filter((name) => name !== 'relay_wonderland');
  if (foreign.length > 0 || publicRelations > 0) {
    return {
      kind: 'REFUSED', reason: 'NOT_EMPTY_NOT_MARKED',
      detail: `the marked database also holds ${String(foreign.length)} other schema(s) and ${String(publicRelations)} relation(s) in public`,
    };
  }
  const ledger = judgeWonderlandLedger(await new TransactionalWonderlandDatabase(pool).appliedMigrationVersions());
  if (ledger.unknown.length > 0) {
    return { kind: 'REFUSED', reason: 'AHEAD_OF_THIS_BUILD', detail: `the ledger holds ${ledger.unknown.join(', ')}, which this build neither ships nor stages` };
  }
  if (!ledger.gapFree) {
    return { kind: 'REFUSED', reason: 'LEDGER_NOT_A_PREFIX', detail: `the ledger holds ${String(ledger.applied)} of this build's stamps, not as a prefix of its chain` };
  }
  return { kind: 'HOSTED_STORE', marker, ledger };
}

export interface WonderlandStoreFingerprint {
  /** The script's own digest, roles included: comparable only between stores owned by the same role. */
  readonly sha256: string;
  readonly lines: number;
  /** The same lines with the connected role written as `<owner>`: comparable between a hosted store and a rehearsal. */
  readonly roleNeutralSha256: string;
}

/** The migration window's catalog fingerprint, run through the driver: psql meta-commands are dropped, nothing else changes. */
export async function fingerprintWonderlandStore(pool: Pool, scriptPath: string): Promise<WonderlandStoreFingerprint> {
  const sql = readFileSync(scriptPath, 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('\\')).join('\n');
  const role = String(((await (pool as unknown as Query).query<{ role: string }>('SELECT current_user AS role')).rows[0])?.role ?? '');
  const results = await (pool as unknown as { query(text: string): Promise<unknown> }).query(sql) as unknown;
  const sets = (Array.isArray(results) ? results : [results]) as Array<{ rows?: Array<Record<string, unknown>> }>;
  const rows = sets.flatMap((set) => set.rows ?? []).map((row) => String(Object.values(row)[0]));
  const final = rows.find((line) => line.startsWith('FINGERPRINT '));
  const match = /^FINGERPRINT sha256=([0-9a-f]{64}) lines=(\d+)$/u.exec(final ?? '');
  if (match === null) throw new Error('wonderland_store_fingerprint_unreadable');
  const body = rows.filter((line) => !line.startsWith('FINGERPRINT '));
  const escaped = role.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const neutral = role === '' ? body : body.map((line) => line
    .replace(new RegExp(`owner=${escaped}(?=\\s|$)`, 'gu'), 'owner=<owner>')
    .replace(new RegExp(`(^|[{,=/])${escaped}(?=[=/},])`, 'gu'), '$1<owner>'));
  const sorted = [...neutral].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    sha256: match[1]!, lines: Number(match[2]),
    roleNeutralSha256: createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex'),
  };
}

export interface WonderlandStoreBootstrapOutcome {
  readonly result: 'PASS' | 'REFUSED' | 'STOP';
  readonly lines: readonly string[];
  readonly fingerprint: WonderlandStoreFingerprint | null;
}

/**
 * Classify, mark (an EMPTY store only), migrate, postcheck, fingerprint. Every
 * line it returns is a fact for the record: no URL, no credential.
 */
export async function bootstrapWonderlandStore(input: {
  readonly pool: Pool;
  readonly confirm: string | undefined;
  readonly treeClean: boolean;
  readonly fingerprintScript: string;
}): Promise<WonderlandStoreBootstrapOutcome> {
  const lines: string[] = [];
  const refuse = (reason: string, detail: string): WonderlandStoreBootstrapOutcome => {
    lines.push(`REFUSED ${reason} — ${detail}; nothing was written`);
    return { result: 'REFUSED', lines, fingerprint: null };
  };
  if (input.confirm !== WONDERLAND_STORE_BOOTSTRAP_PHRASE) {
    return refuse('CONFIRMATION_REQUIRED', `--confirm must be exactly "${WONDERLAND_STORE_BOOTSTRAP_PHRASE}"`);
  }
  if (!input.treeClean) return refuse('TREE_DIRTY', 'the checkout has tracked changes, so the record could not name what ran');
  const before = await classifyWonderlandStore(input.pool);
  lines.push(`classification: ${before.kind}${before.kind === 'REFUSED' ? ` ${before.reason}` : ''}`);
  if (before.kind === 'REFUSED') return refuse(before.reason, before.detail);

  let marker: string;
  if (before.kind === 'EMPTY') {
    marker = `${WONDERLAND_STORE_MARKER_PREFIX}${randomUUID()}`;
    await (input.pool as unknown as Query).query(
      `DO $mark$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), '${marker}'); END $mark$`);
    lines.push(`marked: ${marker}`);
  } else {
    marker = before.marker;
    lines.push(`marker: ${marker}`);
    lines.push(`ledger before: ${String(before.ledger.applied)}/${String(before.ledger.expected)} through ${before.ledger.through ?? 'none'}`);
  }

  await new TransactionalWonderlandDatabase(input.pool).migrate();

  const after = await classifyWonderlandStore(input.pool);
  if (after.kind !== 'HOSTED_STORE' || after.marker !== marker) {
    lines.push(`STOP postcheck: the store reads as ${after.kind} after migrating`);
    return { result: 'STOP', lines, fingerprint: null };
  }
  const ledger = after.ledger;
  lines.push(`ledger after: ${String(ledger.applied)}/${String(ledger.expected)} through ${ledger.through ?? 'none'} gap_free=${String(ledger.gapFree)} pending=${String(ledger.pending.length)}`);
  if (ledger.pending.length > 0 || ledger.through !== WONDERLAND_SHIPPED_CHAIN.at(-1)) {
    lines.push(`STOP postcheck: ${String(ledger.pending.length)} stamp(s) of this build's chain are still pending`);
    return { result: 'STOP', lines, fingerprint: null };
  }
  const readiness = await readWonderlandStoreReadiness({ pool: input.pool, missingConfig: [], env: {} });
  lines.push(`social: ${readiness.surfaces.social}`);
  if (readiness.surfaces.social !== 'READY') {
    lines.push(`STOP postcheck: ${WONDERLAND_SOCIAL_STAMP} is not in the ledger`);
    return { result: 'STOP', lines, fingerprint: null };
  }
  const fingerprint = await fingerprintWonderlandStore(input.pool, input.fingerprintScript);
  lines.push(`fingerprint: sha256=${fingerprint.sha256} lines=${String(fingerprint.lines)} role_neutral_sha256=${fingerprint.roleNeutralSha256}`);
  lines.push('PASS');
  return { result: 'PASS', lines, fingerprint };
}

/* --------------------------------------------------------------------- CLI --- */

const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

function checkoutFacts(repo: string): { commit: string; treeClean: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repo, encoding: 'utf8' }).trim();
    return { commit: /^[0-9a-f]{40}$/u.test(commit) ? commit : 'unknown', treeClean: changes === '' };
  } catch {
    return { commit: 'unknown', treeClean: false };
  }
}

export async function wonderlandStoreMain(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, out: (line: string) => void): Promise<number> {
  const command = argv[0];
  const variable = option(argv, 'database-env') ?? 'JULIUS_DATABASE_URL';
  if ((command !== 'inspect' && command !== 'bootstrap') || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(variable)) {
    out('Usage: wonderland-store inspect [--database-env NAME] | bootstrap [--database-env NAME] --record DIR --confirm "BOOTSTRAP THE HOSTED WONDERLAND STORE"');
    return 1;
  }
  const url = (env[variable] ?? '').trim();
  out(`${WONDERLAND_STORE_TOOL_VERSION} ${command} database_env=${variable}`);
  if (url === '') { out(`BLOCKED ${variable} is not set: no database was contacted`); return 1; }
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => undefined);
  try {
    if (command === 'inspect') {
      const readiness = await readWonderlandStoreReadiness({ pool, missingConfig: [], env });
      out(`database: ${readiness.database.state}${readiness.database.state === 'UNREACHABLE' ? ` ${readiness.database.reason}` : ''}`);
      if (readiness.ledger !== null) {
        out(`ledger: ${String(readiness.ledger.applied)}/${String(readiness.ledger.expected)} through ${readiness.ledger.through ?? 'none'} gap_free=${String(readiness.ledger.gapFree)} unknown=${readiness.ledger.unknown.join(',') || 'none'}`);
      }
      out(`social: ${readiness.surfaces.social} voice_schema: ${readiness.surfaces.voiceSchema}`);
      if (readiness.database.state === 'CONNECTED') {
        const classification = await classifyWonderlandStore(pool);
        out(`classification: ${classification.kind}${classification.kind === 'REFUSED' ? ` ${classification.reason}` : ''}`);
      }
      return readiness.database.state === 'CONNECTED' ? 0 : 2;
    }
    const record = option(argv, 'record');
    if (record === undefined) { out('BLOCKED --record DIR is required: a bootstrap without a record is not one'); return 1; }
    // The checkout this tool was built from, unless the operator names it (a bundle built elsewhere).
    const repo = resolve(option(argv, 'repo') ?? resolve(__dirname, '..'));
    const facts = checkoutFacts(repo);
    const outcome = await bootstrapWonderlandStore({
      pool, confirm: option(argv, 'confirm'), treeClean: facts.treeClean,
      fingerprintScript: join(repo, 'docs', 'julius-migrations', '030', 'fingerprint-store.sql'),
    });
    const lines = [
      `tool=${WONDERLAND_STORE_TOOL_VERSION}`, `commit=${facts.commit}`, `tree_clean=${String(facts.treeClean)}`,
      `database_env=${variable}`, `produced_at=${new Date().toISOString()}`, ...outcome.lines,
    ];
    mkdirSync(record, { recursive: true });
    writeFileSync(join(record, 'RECORD.txt'), `${lines.join('\n')}\n`);
    for (const line of outcome.lines) out(line);
    out(`RESULT: ${outcome.result} (record ${join(record, 'RECORD.txt')})`);
    return outcome.result === 'PASS' ? 0 : 2;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    out(`STOP the database refused or failed: ${typeof code === 'string' && /^[A-Z0-9_]{2,40}$/u.test(code) ? code : 'ERROR'}`);
    return 2;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/* The esbuild bundle runs this file directly; import.meta is unavailable in
 * the bridge tsconfig, so the entry check is on `require.main`. */
if (typeof require !== 'undefined' && require.main === module) {
  wonderlandStoreMain(process.argv.slice(2), process.env, (line) => process.stdout.write(`${line}\n`)).then(
    (code) => { process.exitCode = code; },
    () => { process.stdout.write('wonderland-store crashed\n'); process.exitCode = 1; },
  );
}
