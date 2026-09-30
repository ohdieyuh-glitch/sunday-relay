/**
 * WHAT EVERY JULIUS CAPABILITY DRILL SHARES.
 *
 * A drill is not a test. A test asserts that a function returns what its
 * author expected; a drill DRIVES production code against real infrastructure,
 * writes down what it saw step by step, and files an attestation the Beta Gate
 * independently verifies before it will report the capability proven. The gate
 * refuses that attestation unless its digests still match this tree, its paths
 * cover the row's own probe, and its transcript carries the declared passing
 * steps and no failing one — so what lives here is the machinery for producing
 * evidence in exactly the shape the gate checks, and nothing that decides a
 * verdict.
 *
 * There is deliberately no `pass()` helper that takes a boolean it does not
 * look at. Every step records the value it read, so a transcript says what was
 * true rather than that something was fine.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

import { drillDrivenFiles } from './julius-drill-closure.mjs';

/**
 * THE COLUMNS THE BETA GATE READS, restated here rather than imported from it.
 *
 * Importing the gate would drag its module-scope `import.meta.url` and its
 * run-as-a-program guard into a drill's bundle, where both would resolve to
 * that bundle and the gate would run in place of the drill. So the list is
 * declared, and `julius-drill-support.test.ts` asserts it is character for
 * character the gate's own — the same parity idiom the contract brief uses,
 * for the same reason: two writers of one document drift the day one of them
 * learns about a field.
 */
export const CAPABILITY_PROOF_COLUMNS = [
  'capability', 'drill', 'outcome', 'steps', 'infrastructure',
  'exercised_path', 'exercised_digest', 'transcript', 'recorded_at',
] as const;

export interface DrillStep { readonly ok: boolean; readonly name: string; readonly detail: string }

/**
 * A drill's transcript and its step ledger, kept together so they cannot
 * disagree about how many steps there were — which is the one number the gate
 * holds the transcript to.
 */
export class DrillRecord {
  readonly lines: string[] = [];
  readonly steps: DrillStep[] = [];

  say(...lines: readonly string[]): void { for (const line of lines) this.lines.push(line); }

  /** One observation. `detail` is what was actually read, not a restatement of the name. */
  step(name: string, ok: boolean, detail = ''): boolean {
    this.steps.push({ ok, name, detail });
    this.lines.push(`  [${ok ? 'PASS' : 'FAIL'}] ${this.steps.length}. ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  }

  get failures(): DrillStep[] { return this.steps.filter((row) => !row.ok); }

  /**
   * Close the transcript on the drill's own verdict line, which the gate
   * requires to be an all-capitals VERIFIED sentence. `verified` is derived
   * from the steps, never passed in: a drill that could be told it passed is a
   * drill that can be told anything.
   */
  seal(name: string): boolean {
    const verified = this.failures.length === 0;
    this.say('');
    this.say(verified ? `${name} VERIFIED` : `${name} DRILL FAILED: ${this.failures.length} step(s).`);
    return verified;
  }
}

/** Reads one scalar from the database. `null` means the query returned no row. */
export function scalarReader(pool: Pool) {
  return async (sql: string, params: readonly unknown[] = []): Promise<string | null> => {
    const result = await pool.query(sql, [...params]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const value = Object.values(row)[0];
    return value === null || value === undefined ? null : String(value);
  };
}

/**
 * DID THIS DRILL REALLY SPEND NOTHING — and could that question have been
 * answered wrongly?
 *
 * The first version of this check counted `julius.provider.call` events and
 * required zero. There is no such event type: the vocabulary has
 * `worker.selected`, `worker.dispatched`, `worker.completed` and
 * `provider.failure`. So the query could only ever return zero, the step could
 * only ever pass, and a transcript line that reads PASS on every possible
 * database is not testimony — it is the exact vacuous pass these drills exist
 * to refuse, written into one of them.
 *
 * This asks a question that can fail in both directions. `worker.selected`
 * carries the `providerId` a dispatch was routed to, so a drill can assert that
 * dispatches HAPPENED — the positive control, without which a broken predicate
 * reads as innocence — and that every one of them named the fake provider and
 * no real one.
 */
export async function auditProviders(
  scalar: (sql: string, params?: readonly unknown[]) => Promise<string | null>,
  runIds: readonly string[],
): Promise<{ readonly dispatches: number; readonly providers: string }> {
  const row = await scalar(
    `SELECT count(*)::text||' '||coalesce(string_agg(DISTINCT payload->'facts'->>'providerId', ','),'none')
       FROM relay_wonderland.events
      WHERE event_type='julius.worker.selected' AND payload->>'runId' = ANY($1)`, [runIds]);
  const [count, providers] = (row ?? '0 none').split(' ');
  return { dispatches: Number.parseInt(count ?? '0', 10), providers: providers ?? 'none' };
}

/**
 * The ledger the Beta Gate reads. A FAILED drill still writes one, recording
 * the outcome it actually had — a drill that files nothing when it fails
 * teaches a reader that silence means success, and the gate refuses any row
 * whose outcome is not VERIFIED anyway.
 *
 * The digest is taken at the moment the drill ran, which is what makes the
 * proof expire: edit one of these files and the gate recomputes a different
 * hash and reports CAPABILITY STALE rather than carrying yesterday's proof
 * forward over today's code.
 */
export function writeAttestation(input: {
  readonly outDir: string;
  readonly repoRoot: string;
  readonly capability: string;
  readonly drill: string;
  readonly exercised: readonly string[];
  /**
   * Every OTHER file the drill drove, beyond the row's own probe files. One
   * row each, so the gate can name the file that moved when the proof goes
   * stale. {@link writeDrillAttestation} derives it; only a test of the ledger
   * format itself passes it by hand.
   */
  readonly driven?: readonly string[];
  readonly infrastructure: string;
  readonly transcriptFile: string;
  readonly record: DrillRecord;
  readonly verified: boolean;
}): void {
  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(join(input.outDir, input.transcriptFile), `${input.record.lines.join('\n')}\n`);
  const recordedAt = new Date().toISOString();
  const attested = [...new Set([...input.exercised, ...(input.driven ?? [])])].sort();
  const rows = attested.map((path) => [
    input.capability,
    input.drill,
    input.verified ? 'VERIFIED' : 'FAILED',
    String(input.record.steps.length),
    input.infrastructure,
    path,
    `sha256:${createHash('sha256').update(readFileSync(join(input.repoRoot, path))).digest('hex')}`,
    input.transcriptFile,
    recordedAt,
  ].join('\t'));
  /**
   * MERGED, NEVER OVERWRITTEN.
   *
   * Three drills run into one directory in CI and in a mission bundle, and the
   * gate reads ONE ledger. A writer that truncated would leave the last drill's
   * proof and silently discard the other two — a directory that looks complete
   * and proves a third of what it says. Rows for THIS drill are replaced (a
   * rerun supersedes itself); every other drill's rows are carried through
   * untouched.
   */
  const ledger = join(input.outDir, 'capability-proofs.tsv');
  const header = CAPABILITY_PROOF_COLUMNS.join('\t');
  const kept: string[] = [];
  if (existsSync(ledger)) {
    const lines = readFileSync(ledger, 'utf8').split('\n')
      .filter((line) => line.length > 0 && !/^\(\d+ rows?\)$/.test(line));
    const existingHeader = lines[0] ?? '';
    if (existingHeader !== header) {
      // Overwriting would destroy evidence this writer cannot read; saying
      // nothing would be worse. The drill fails on its own output instead.
      throw new Error('capability_proof_ledger_header_mismatch: refusing to overwrite a ledger this drill cannot merge');
    }
    const mine = `${input.capability}\t${input.drill}\t`;
    kept.push(...lines.slice(1).filter((line) => !line.startsWith(mine)));
  }
  const all = [...kept, ...rows];
  writeFileSync(ledger, `${[header, ...all, `(${all.length} rows)`].join('\n')}\n`);
}

/**
 * THE ATTESTATION A DRILL FILES: its row's probe files AND every file it drove.
 *
 * The probe files alone let a drill stay "proven" while the pipeline, the
 * repositories and the composition it drove through were rewritten underneath
 * it. The driven set is read from the tree by the same reader the Beta Gate
 * uses (`julius-drill-closure.mjs`), from the drill's own npm command, so the
 * gate can demand exactly this set back. A drill that cannot say what it drove
 * files nothing and fails: an attestation that covers less than it claims is
 * worse than none.
 */
export function writeDrillAttestation(input: Omit<Parameters<typeof writeAttestation>[0], 'driven'>): void {
  const driven = drillDrivenFiles(input.repoRoot, input.drill);
  if ('error' in driven) throw new Error(`drill_driven_files_unknown: ${driven.error}`);
  writeAttestation({ ...input, driven: driven.files });
}

/**
 * A DRILL WRITES ONLY INTO A DATABASE THAT IS A THROWAWAY BY NAME.
 *
 * Every drill bootstraps missions whose three providers are scripted fakes and
 * drives them to COMPLETED. On this project's workstation `DATABASE_URL` is
 * inherited from the user profile and names Julius's LIVE store
 * (`…/julius`), and on a runner `…/julius` is the paid mission's own database —
 * so a drill that took whatever `DATABASE_URL` said would plant completed
 * fake-provider missions exactly where a real mission's evidence is read from.
 *
 * So the target is accepted only when its database is NAMED as a drill's:
 *
 *   julius_<drill>_drill   what CI, the paid workflow and the local launcher
 *                          create per drill (`julius_${drill//-/_}`) and pass
 *                          as `${DATABASE_URL%/*}/$db` — accepted without any
 *                          workflow change;
 *   juliusdrill… / julius_drill_…
 *                          the fresh databases the drill test suites create;
 *
 * or when it is exactly the database `JULIUS_TEST_DATABASE_URL` names, which is
 * this repository's declared throwaway. `julius` itself is refused by name
 * whatever else is set. The name is necessary, not sufficient: before anything
 * is written the drill also refuses a database holding any run but its own
 * ({@link foreignJuliusRuns}).
 */
export const JULIUS_STORE_DATABASE = 'julius';
export const JULIUS_DRILL_DATABASE_NAME = /^(?:julius_[a-z0-9_]+_drill|julius_?drill[a-z0-9_]*)$/u;

export type DrillDatabaseTarget =
  | { readonly ok: true; readonly url: string; readonly database: string; readonly basis: string }
  | { readonly ok: false; readonly code: string; readonly reason: string };

const postgresDatabase = (value: string): { readonly host: string; readonly port: string; readonly database: string } | null => {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  let database: string;
  try { database = decodeURIComponent(url.pathname.replace(/^\//u, '')); } catch { return null; }
  if (database === '' || database.includes('/')) return null;
  return { host: url.hostname.toLowerCase(), port: url.port === '' ? '5432' : url.port, database };
};

export function drillDatabaseTarget(input: {
  readonly databaseUrl?: string | undefined;
  readonly testDatabaseUrl?: string | undefined;
}): DrillDatabaseTarget {
  const url = (input.databaseUrl ?? '').trim();
  if (url === '') {
    return { ok: false, code: 'drill_requires_database_url', reason: 'set DATABASE_URL to a throwaway PostgreSQL database this drill may write' };
  }
  const target = postgresDatabase(url);
  if (target === null) {
    return { ok: false, code: 'drill_database_unverifiable', reason: 'DATABASE_URL is not a postgres:// URL naming a database, so it cannot be shown to be a throwaway' };
  }
  if (target.database === JULIUS_STORE_DATABASE) {
    return {
      ok: false, code: 'drill_database_is_julius_store',
      reason: `"${JULIUS_STORE_DATABASE}" is Julius's own store — the live one on a workstation, the paid mission's on a runner — and a drill must never plant its fake-provider missions there`,
    };
  }
  if (JULIUS_DRILL_DATABASE_NAME.test(target.database)) {
    return { ok: true, url, database: target.database, basis: 'a drill database by name' };
  }
  const declared = postgresDatabase((input.testDatabaseUrl ?? '').trim());
  if (declared !== null && declared.host === target.host && declared.port === target.port && declared.database === target.database) {
    return { ok: true, url, database: target.database, basis: 'the throwaway JULIUS_TEST_DATABASE_URL names' };
  }
  return {
    ok: false, code: 'drill_database_not_throwaway',
    reason: `"${target.database}" is not a drill database: create julius_<drill>_drill (or juliusdrill…) for it, or point DATABASE_URL at the database JULIUS_TEST_DATABASE_URL names`,
  };
}

/**
 * HOW MANY RUNS IN THIS DATABASE ARE NOT THE DRILL'S OWN, read before the
 * drill migrates or writes anything. A fresh database has no Julius schema at
 * all, which is zero. Any other answer means the database is somebody's store,
 * whatever it is called, and the drill refuses it.
 */
export async function foreignJuliusRuns(
  scalar: (sql: string, params?: readonly unknown[]) => Promise<string | null>,
  ownRunIds: readonly string[],
): Promise<number> {
  const migrated = await scalar(`SELECT to_regclass('relay_wonderland.julius_runs') IS NOT NULL`);
  if (migrated !== 'true') return 0;
  const count = await scalar(
    `SELECT count(*) FROM relay_wonderland.julius_runs WHERE NOT (run_id = ANY($1::text[]))`, [[...ownRunIds]]);
  // An answer that is not a count is not a zero: the database is refused.
  return count !== null && /^\d+$/u.test(count) ? Number(count) : Number.POSITIVE_INFINITY;
}
