import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * G3 (the founder, 2026-10-11: the 035 code guard): migrate() STAYS THE ONLY WAY the migration chain runs, so its
 * protected-store refusal (protected-store.ts) covers every runner. The 035 autorun audit
 * (_qa_handoff/voice/MIGRATION_035_AUTORUN_AUDIT_20261011.md) found 11 non-test call sites, all through migrate(). This sweep
 * pins them: a NEW call site, a second executor of the chain, or a second caller of the bootstrap override fails here and must
 * be reviewed. Reads `git ls-files` and the sources only.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SCANNED = /^(src|relay-bridge|scripts|relay-hermes-service)\//u;
const TEST = /\.(test|spec)\.[cm]?[tj]sx?$/u;
const SOURCE = /\.[cm]?[tj]sx?$/u;

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => SCANNED.test(f) && SOURCE.test(f) && !TEST.test(f));
const text = (f: string) => readFileSync(join(ROOT, f), 'utf8');

/**
 * The source without its comments, so a comment that NAMES `.migrate()` is not counted as a call. String and template
 * literals are kept intact (a `//` inside a string is not a comment), so code after such a string is never hidden.
 */
function withoutComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
const code = (f: string) => withoutComments(text(f));

/** Count the chain's executions a source text asks for. Exported shapes are tested against planted text below. */
function chainExecutions(source: string): { migrateCalls: number; directExecutions: number; overrides: number } {
  const migrateCalls = [...source.matchAll(/\.migrate\(|migrateIfNeeded\(/gu)].length;
  // a migration constant or the chain array handed to something that executes SQL
  const directExecutions = [...source.matchAll(/\.query\(\s*WONDERLAND_MIGRATION_0\d\d\b|for\s*\(\s*const\s+\w+\s+of\s+WONDERLAND_MIGRATIONS\b|WONDERLAND_MIGRATIONS\s*\.\s*(?:forEach|reduce)\s*\(/gu)].length;
  const overrides = [...source.matchAll(/reviewedBootstrap\s*:/gu)].length;
  return { migrateCalls, directExecutions, overrides };
}

/** The 11 non-test call sites at the 035 guard's commit: file -> how many `.migrate(` / `migrateIfNeeded(` it holds. */
const PINNED_CALL_SITES: Readonly<Record<string, number>> = {
  'relay-bridge/dev-social-server.ts': 1,
  'relay-bridge/julius-live-mission.ts': 1,
  'scripts/julius-bootstrap-empty-store.ts': 1,
  'scripts/julius-failure-recovery-drill.ts': 1,
  'scripts/julius-live-preflight-identity.ts': 2, // the definition of migrateIfNeeded and its one migrate() call
  'scripts/julius-live-preflight.ts': 1,
  'scripts/julius-recovery-drill.ts': 1,
  'scripts/julius-repair-loop-drill.ts': 1,
  'scripts/julius-sibling-support.ts': 1,
  'scripts/project-brain-proof-main.ts': 1,
  'scripts/r16-migrate-throwaway.ts': 1,
};

describe('G3: migrate() is the only way the migration chain runs', () => {
  it('the detector sees what it must (planted text): a call, a direct execution, a loop, an override', () => {
    expect(chainExecutions('await new TransactionalWonderlandDatabase(pool).migrate();').migrateCalls).toBe(1);
    expect(chainExecutions('await pool.query(WONDERLAND_MIGRATION_035);').directExecutions).toBe(1);
    expect(chainExecutions('for (const sql of WONDERLAND_MIGRATIONS) await client.query(sql);').directExecutions).toBe(1);
    expect(chainExecutions('WONDERLAND_MIGRATIONS.forEach((s) => run(s));').directExecutions).toBe(1);
    expect(chainExecutions('migrateIfNeeded(pool, { reviewedBootstrap: { database, systemIdentifier } })').overrides).toBe(1);
    expect(chainExecutions('const versions = WONDERLAND_MIGRATIONS.map(migrationVersion);').directExecutions).toBe(0); // a read is not an execution
  });

  it('the scan covers the repository (it is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('src/relay/persistence/wonderland-postgres.ts');
  });

  it('the non-test call sites are exactly the pinned 11: a new one fails here until reviewed', () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      if (f === 'src/relay/persistence/wonderland-postgres.ts') continue; // where migrate() is defined
      const n = chainExecutions(code(f)).migrateCalls;
      if (n > 0) found[f] = n;
    }
    expect(found).toEqual(PINNED_CALL_SITES);
  });

  it('nothing but migrate() executes the chain', () => {
    const offenders = files.filter((f) => f !== 'src/relay/persistence/wonderland-postgres.ts' && chainExecutions(code(f)).directExecutions > 0);
    expect(offenders).toEqual([]);
  });

  it('only the reviewed EMPTY-store bootstrap passes the override', () => {
    const callers = files.filter((f) => chainExecutions(code(f)).overrides > 0);
    expect(callers).toEqual(['scripts/julius-bootstrap-empty-store.ts']);
  });

  it('the migration files are read only by wonderland-postgres.ts (to execute) and the bootstrap (to VERIFY, never to run)', () => {
    // the bootstrap reads the folder only to prove the SQL migrate() will run IS the checkout's files (its R-3); it executes
    // through migrateIfNeeded alone (the call-site pin above)
    const readers = files.filter((f) => /['"`]wonderland-migrations['"`]/u.test(code(f)));
    expect(readers).toEqual(['scripts/julius-bootstrap-empty-store.ts', 'src/relay/persistence/wonderland-postgres.ts']);
  });

  it('comments do not count, strings do not hide code (controls for the scanner itself)', () => {
    expect(chainExecutions(withoutComments('// see migrate() for why: x.migrate()\n/* db.migrate() */ ok();')).migrateCalls).toBe(0);
    expect(chainExecutions(withoutComments("const u = 'https://x'; await db.migrate();")).migrateCalls).toBe(1);
    expect(chainExecutions(withoutComments('const s = "/* not a comment"; await db.migrate(); // */')).migrateCalls).toBe(1);
  });
});
