import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { migrationVersion, WONDERLAND_MIGRATIONS } from './wonderland-postgres';

/**
 * THE MIGRATION CHAIN, HELD TO ITS OWN RULES.
 *
 * `migrate()` throws `wonderland_migration_not_packaged` when a migration
 * constant is the empty string, which catches a file that failed to load — and
 * catches NOTHING about a file that exists and was never added to the array.
 * That is the likelier mistake and the more dangerous one: the schema is
 * missing on a fresh database and every query against the new table fails at
 * runtime rather than at deploy.
 *
 * This file reads the directory rather than a list, so a migration added
 * without being registered fails here rather than in production. It is a
 * static check over text: it opens no connection and needs no database, which
 * is what lets it run in every suite.
 */

const DIRECTORY = join(__dirname, 'wonderland-migrations');
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort();
const read = (name: string) => readFileSync(join(DIRECTORY, name), 'utf8');

describe('every migration on disk is packaged', () => {
  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(WONDERLAND_MIGRATIONS.length).toBe(files.length);
  });

  it('registers each file in the ordered array', () => {
    // Matched by CONTENT rather than by name: the array holds file bodies, so
    // comparing bodies is what proves the right file was registered rather
    // than a same-named one from another directory.
    for (const name of files) {
      expect(WONDERLAND_MIGRATIONS, `${name} is not registered`).toContain(read(name));
    }
  });

  it('registers them in filename order, so a fresh database applies them in order', () => {
    expect(WONDERLAND_MIGRATIONS.map((sql) => files.find((name) => read(name) === sql))).toEqual(files);
  });

  it('never packages an empty migration', () => {
    for (const sql of WONDERLAND_MIGRATIONS) expect(sql.trim()).not.toBe('');
  });
});

describe('every migration is a single transaction that records itself', () => {
  for (const name of files) {
    it(`${name} begins, commits, and stamps schema_migrations with its own version`, () => {
      const sql = read(name);
      const version = name.replace(/\.sql$/, '');
      expect(sql.trimStart().startsWith('BEGIN;'), `${name} must open a transaction`).toBe(true);
      expect(sql.trimEnd().endsWith('COMMIT;'), `${name} must commit`).toBe(true);
      // A migration that stamps a version other than its own filename makes
      // the applied-set a lie, and re-running it would then be silent.
      expect(sql).toContain(`INSERT INTO relay_wonderland.schema_migrations(version) VALUES('${version}')`);
      // EXACTLY ONE, so `migrationVersion` cannot read a version out of a
      // comment. A second stamp — a header quoting an earlier migration —
      // would make `migrate()` believe this file had already been applied and
      // skip it on every migrated database, silently.
      expect(sql.match(/schema_migrations\(version\) VALUES/gu)?.length, `${name} must stamp exactly once`).toBe(1);
      expect(migrationVersion(sql), `${name} must resolve to its own version`).toBe(version);
    });
  }
});

describe('the Julius migrations', () => {
  const julius = files.filter((name) => name.includes('julius'));

  it('exist and are all inside the Wonderland schema', () => {
    expect(julius.length).toBeGreaterThan(0);
    for (const name of julius) {
      const sql = read(name);
      const tables = [...sql.matchAll(/CREATE TABLE\s+([A-Za-z_.]+)/g)].map((match) => match[1]!);
      for (const table of tables) {
        expect(table.startsWith('relay_wonderland.'), `${name} creates ${table} outside the schema`).toBe(true);
      }
    }
  });

  it('scope every Julius table to a run or a project, so a row has an owner', () => {
    for (const name of julius) {
      const sql = read(name);
      for (const block of sql.split('CREATE TABLE ').slice(1)) {
        const table = block.slice(0, block.indexOf('(')).trim();
        // A table that references neither a run nor a project has no tenancy
        // anchor, and every read of it would have to be trusted rather than
        // scoped. Join tables reference their own parent instead.
        const anchored = /REFERENCES relay_wonderland\.(julius_runs|projects|julius_tasks|julius_acceptance_criteria|julius_evidence)/.test(block);
        expect(anchored, `${table} in ${name} has no tenancy anchor`).toBe(true);
      }
    }
  });

  it('declare an idempotency or natural uniqueness on every appendable table', () => {
    // Replay safety is a schema property, not a code property: without a
    // unique constraint an `ON CONFLICT DO NOTHING` has nothing to conflict on
    // and a retried write silently duplicates.
    for (const name of julius) {
      const sql = read(name);
      for (const block of sql.split('CREATE TABLE ').slice(1)) {
        const table = block.slice(0, block.indexOf('(')).trim();
        if (!/idempotency_key/.test(block)) continue;
        expect(/UNIQUE\((?:[^)]*)idempotency_key\)/.test(block), `${table} has an idempotency key with no unique constraint`).toBe(true);
      }
    }
  });
});
