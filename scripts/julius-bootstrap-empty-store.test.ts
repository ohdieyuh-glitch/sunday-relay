import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ledgerOrderProblem, main, notEmptyReasons, PUBLIC_OBJECTS_SQL, type EmptyFacts } from './julius-bootstrap-empty-store';

/**
 * The first-time bootstrap of an EMPTY store (migration 030 deploy, path R1). These cases need no database: every one
 * of them must refuse BEFORE a connection is made (a bogus URL is passed and never dialled). The real-PostgreSQL half is
 * julius-bootstrap-empty-store.real-postgres.test.ts.
 */
const ROOT = resolve(__dirname, '..');
const DOCS = join(ROOT, 'docs', 'julius-migrations', '030');
const MIGRATIONS = join(ROOT, 'src', 'relay', 'persistence', 'wonderland-migrations');
const NEVER_DIALLED = 'postgres://bootstrap-test:unused@127.0.0.1:1/never';
const ARGS = ['--expect-database', 'julius', '--expect-system-identifier', '7684592472855232550'];
const EMPTY: EmptyFacts = { schemas: 'public', publicObjects: 0, extraExtensions: '', eventTriggers: 0, hasRelayWonderland: false, hasLedger: false };

const run = async (argv: readonly string[], env: NodeJS.ProcessEnv, cwd = ROOT): Promise<{ code: number; lines: string[] }> => {
  const lines: string[] = [];
  const code = await main(argv, env, cwd, (line) => lines.push(line));
  return { code, lines };
};

const temporaryTrees: string[] = [];
/** A checkout-shaped temporary tree holding a copy of the migrations, for the R-3 identity cases. */
const treeWithMigrations = (): { root: string; dir: string } => {
  const root = mkdtempSync(join(tmpdir(), 'julius-bootstrap-'));
  temporaryTrees.push(root);
  const dir = join(root, 'src', 'relay', 'persistence', 'wonderland-migrations');
  cpSync(MIGRATIONS, dir, { recursive: true });
  return { root, dir };
};
afterEach(() => { for (const root of temporaryTrees.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('the EMPTY predicate (classify-store.sql rules 1-4)', () => {
  it('EMPTY facts give no reason; each fact flipped gives its own named reason', () => {
    expect(notEmptyReasons(EMPTY)).toEqual([]);
    expect(notEmptyReasons({ ...EMPTY, extraExtensions: 'pg_trgm' })).toEqual(['extension(s) pg_trgm']);
    expect(notEmptyReasons({ ...EMPTY, eventTriggers: 1 })).toEqual(['1 event trigger(s)']);
    expect(notEmptyReasons({ ...EMPTY, schemas: 'other,public' })).toEqual(['schemas are [other,public], not [public]']);
    expect(notEmptyReasons({ ...EMPTY, publicObjects: 3 })).toEqual(['3 object(s) in public']);
    expect(notEmptyReasons({ ...EMPTY, hasRelayWonderland: true })).toEqual(['schema relay_wonderland exists']);
    expect(notEmptyReasons({ ...EMPTY, hasLedger: true })).toEqual(['a migration ledger exists']);
  });

  it("counts objects in public with EXACTLY the classifier's expression", () => {
    const classifier = readFileSync(join(DOCS, 'classify-store.sql'), 'utf8');
    const start = classifier.indexOf('(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \'public\')');
    const end = classifier.indexOf(' AS public_objects');
    expect(start, 'the classifier must carry the public_objects expression').toBeGreaterThan(0);
    const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();
    expect(squash(PUBLIC_OBJECTS_SQL)).toBe(squash(classifier.slice(start, end)));
  });
});

describe('the ledger proof', () => {
  it('accepts exactly the build order and names the first difference otherwise', () => {
    expect(ledgerOrderProblem(['001_a', '002_b'], ['001_a', '002_b'])).toBeNull();
    expect(ledgerOrderProblem(['001_a'], ['001_a', '002_b'])).toBe('ledger holds 1 versions, the build has 2');
    expect(ledgerOrderProblem(['002_b', '001_a'], ['001_a', '002_b'])).toBe("position 1: ledger has '002_b', the build expects '001_a'");
  });
});

describe('refusals before any connection', () => {
  it('needs the explicit URL and the expected identity', async () => {
    for (const [argv, env] of [
      [ARGS, {}],
      [['--expect-database', 'julius'], { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }],
      [['--expect-database', 'julius', '--expect-system-identifier', 'not-digits'], { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }],
    ] as const) {
      const result = await run(argv, env);
      expect(result.code).toBe(4);
      expect(result.lines.join('\n')).toMatch(/^BOOTSTRAP CONFIG ERROR: needs JULIUS_BOOTSTRAP_DATABASE_URL/mu);
    }
  });

  it('refuses while an inherited DATABASE_URL or JULIUS_DATABASE_URL is set (founder ruling R-6)', async () => {
    for (const name of ['DATABASE_URL', 'JULIUS_DATABASE_URL']) {
      const result = await run(ARGS, { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED, [name]: 'postgres://julius@127.0.0.1:5432/julius' });
      expect(result.code).toBe(4);
      expect(result.lines.join('\n')).toContain(`${name} must not be set for the bootstrap`);
    }
  });

  it('loads exactly the checkout files, so the unchanged tree passes every check (control)', async () => {
    // The bogus URL is dialled only AFTER every check passes, so the connection error proves the checks passed.
    const lines: string[] = [];
    await expect(main(ARGS, { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }, ROOT, (line) => lines.push(line))).rejects.toThrow();
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(28);
    expect(lines.filter((line) => line.startsWith('LOADED '))).toHaveLength(files.length);
    expect(lines.join('\n')).not.toMatch(/CONFIG ERROR/u);
  }, 30_000);

  it('R-3: refuses a tree whose migration file differs from what was loaded', async () => {
    const { root, dir } = treeWithMigrations();
    const victim = join(dir, '016_julius_subagents.sql');
    writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n-- one byte more\n`);
    const result = await run(ARGS, { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }, root);
    expect(result.code).toBe(4);
    expect(result.lines.join('\n')).toMatch(/BOOTSTRAP CONFIG ERROR: entry \d+ \(016_julius_subagents\.sql\) differs from the checkout's file; nothing written/u);
  });

  it('R-3: refuses a tree with a migration missing, or one whose stamp is not its filename', async () => {
    const missing = treeWithMigrations();
    rmSync(join(missing.dir, '016_julius_subagents.sql'));
    const a = await run(ARGS, { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }, missing.root);
    expect(a.code).toBe(4);
    expect(a.lines.join('\n')).toMatch(/the checkout has \d+ migration files, the build loaded \d+/u);

    const renamed = treeWithMigrations();
    renameSync(join(renamed.dir, '016_julius_subagents.sql'), join(renamed.dir, '016_julius_subagents_renamed.sql'));
    const b = await run(ARGS, { JULIUS_BOOTSTRAP_DATABASE_URL: NEVER_DIALLED }, renamed.root);
    expect(b.code).toBe(4);
    expect(b.lines.join('\n')).toMatch(/stamps '016_julius_subagents', its file is '016_julius_subagents_renamed\.sql'/u);
  });
});

describe('the deploy SQL kept in step', () => {
  it("rollback-bootstrap.sql's fingerprint view is fingerprint-store.sql's own lines query, byte for byte", () => {
    const fingerprint = readFileSync(join(DOCS, 'fingerprint-store.sql'), 'utf8');
    const rollback = readFileSync(join(DOCS, 'rollback-bootstrap.sql'), 'utf8');
    const lines = fingerprint.slice(fingerprint.indexOf('WITH us AS ('), fingerprint.indexOf('), digest AS ('));
    expect(lines.length).toBeGreaterThan(1000);
    expect(rollback).toContain(`CREATE TEMP VIEW rollback_fp_lines AS\n${lines})\nSELECT l FROM lines;`);
  });

  it('every deploy SQL file is read-only except the rollback, which commits only after its final fingerprint check', () => {
    for (const name of ['classify-store.sql', 'fingerprint-store.sql', 'rowcounts-store.sql']) {
      const sql = readFileSync(join(DOCS, name), 'utf8');
      expect(sql, name).toContain('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
      expect(sql, name).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/imu);
    }
    const rollback = readFileSync(join(DOCS, 'rollback-bootstrap.sql'), 'utf8');
    expect(rollback.match(/^COMMIT;$/gmu)).toHaveLength(1);
    expect(rollback.indexOf('DROP SCHEMA relay_wonderland CASCADE;')).toBeLessThan(rollback.indexOf('\\if :back_to_empty'));
    expect(rollback.indexOf('\\if :back_to_empty')).toBeLessThan(rollback.indexOf('COMMIT;'));
  });
});
