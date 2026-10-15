/**
 * THE DATABASE A TEST MAY WRITE TO — AND WHY IT IS NOT `DATABASE_URL`.
 *
 * THE HAZARD, MEASURED. On the founder's workstation every shell inherits a
 * `DATABASE_URL` from the user profile, and it points at the PERSISTENT Julius
 * database — the one holding real mission history and paid-run evidence. Every
 * real-PostgreSQL suite in this repository migrates a database and writes rows
 * into it. So the old gate — `JULIUS_REAL_POSTGRES=1` plus whatever
 * `DATABASE_URL` happened to be — meant that one session turning on the real
 * suites would write test runs into the live store, and nothing in the URL
 * distinguishes that database from the ephemeral one CI provisions: same name,
 * same host, same port, same credentials.
 *
 * SO THE LAUNCHER STATES IT, AND NOTHING IS INFERRED. A suite runs only against
 * `JULIUS_TEST_DATABASE_URL`, a variable nothing else sets and nobody's profile
 * exports. CI sets it beside the database it just created; a session sets it to
 * a throwaway database it made on purpose. An inherited `DATABASE_URL` can no
 * longer reach a test, whatever else is switched on, because no test reads it.
 *
 * `DATABASE_URL` REMAINS THE RUNTIME'S. The bridge and the mission job take
 * their database from their own launch environment, which is where the founder
 * says database configuration belongs — see `juliusRuntimeDatabaseUrl`.
 */

/** The variable a test database is named in. Nothing else sets it. */
export const JULIUS_TEST_DATABASE_ENV = 'JULIUS_TEST_DATABASE_URL';

/**
 * The switch a launcher sets to say the real-PostgreSQL suites MUST run here.
 * It names no database: it is a demand, and the database is still only ever
 * the one `JULIUS_TEST_DATABASE_URL` states.
 */
export const JULIUS_REAL_POSTGRES_ENV = 'JULIUS_REAL_POSTGRES';

/**
 * The URL a real-PostgreSQL suite may use, or null when none was stated.
 *
 * Null means the suite must be `todo`: a skipped proof, never a passing one and
 * never a silent write somewhere else.
 *
 * EXCEPT WHERE THE LAUNCHER DEMANDED THE REAL SUITES. From #288 to the workflow
 * fix, julius-real-infra set `JULIUS_REAL_POSTGRES=1` and no test database, so
 * every real-PostgreSQL suite there answered `todo` and every step went green:
 * run 36587881843 executed 0 of 28 cases. A demand for the real suites with
 * nothing to run them against is a launcher error, so it now THROWS — naming
 * both variables — instead of reading as a pass. The inherited `DATABASE_URL`
 * is still never read.
 */
export function juliusTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const stated = env[JULIUS_TEST_DATABASE_ENV];
  if (typeof stated === 'string' && stated.trim() !== '') return stated.trim();
  if (env[JULIUS_REAL_POSTGRES_ENV] === '1') {
    throw new Error(`julius_real_postgres_without_test_database: ${JULIUS_REAL_POSTGRES_ENV}=1 demands the `
      + `real-PostgreSQL suites, and ${JULIUS_TEST_DATABASE_ENV} is not set, so they would all be todo. `
      + juliusTestDatabaseAbsence());
  }
  return null;
}

/** The live Julius store's database name. CI's own job database carries it too; its suites use `julius_suites`. */
export const JULIUS_LIVE_DATABASE_NAME = 'julius';

/**
 * A SECOND GUARD a suite may stack on `juliusTestDatabaseUrl`: does this URL name the live store's DATABASE?
 *
 * DECIDED BY THE DATABASE NAME ALONE -- never the port, never the host. CI's throwaway suite database is
 * `julius-postgres:5432/julius_suites` in one job and `127.0.0.1:55432/julius_suites` in another
 * (julius-real-infra.yml), so a port says nothing about which database it is: a guard that refused 5432 refused
 * CI's own throwaway, and on #348 the world-observe suite threw before a single case ran.
 *
 * The name is read where pg-connection-string reads it for a `postgres:` / `postgresql:` URL -- the path, decoded --
 * and compared without regard to case. A GUARD THAT CANNOT TELL SAYS YES (refuse): a URL that does not parse, any
 * other scheme, or no name at all (pg then falls back to the user's name, which is `julius` on the live store).
 */
export function juliusTestDatabaseNamesLiveStore(url: string): boolean {
  let name: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return true;
    name = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  } catch {
    return true;
  }
  return name === '' || name.toLowerCase() === JULIUS_LIVE_DATABASE_NAME;
}

/**
 * WHY A SUITE DID NOT RUN, in one sentence a reader can act on. Printed by the
 * suites' own names rather than as a silent skip, so "it passed" and "it was
 * never asked" cannot be confused.
 */
export const juliusTestDatabaseAbsence = (): string =>
  `${JULIUS_TEST_DATABASE_ENV} is not set, so this real-PostgreSQL suite did not run. `
  + 'Set it to a THROWAWAY database (create one first); DATABASE_URL is deliberately not read here, '
  + 'because on a developer machine it points at the persistent Julius store.';

/**
 * THE DATABASE THE RUNTIME RUNS AGAINST — the bridge's and the mission job's,
 * taken from their own launch environment.
 *
 * `JULIUS_DATABASE_URL` FIRST, so that a founder can move Julius's database out
 * of a machine-wide profile and into whatever launches the bridge and the job,
 * which is where database configuration belongs: a shell that happens to have a
 * `DATABASE_URL` for something else then reaches nothing of Julius's.
 * `DATABASE_URL` remains the fallback, because it is what every existing
 * deployment and CI job already sets, and breaking those to make a point would
 * be its own outage.
 */
export const JULIUS_RUNTIME_DATABASE_ENV = 'JULIUS_DATABASE_URL';

export function juliusRuntimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of [JULIUS_RUNTIME_DATABASE_ENV, 'DATABASE_URL']) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** Which variables a refusal should name, in the order they are read. */
export const JULIUS_RUNTIME_DATABASE_ENV_NAMES: readonly string[] =
  Object.freeze([JULIUS_RUNTIME_DATABASE_ENV, 'DATABASE_URL']);
