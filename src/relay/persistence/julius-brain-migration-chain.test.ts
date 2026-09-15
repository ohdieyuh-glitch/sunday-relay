import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JULIUS_BRAIN_MIGRATIONS, juliusBrainMigrationVersion } from './julius-brain-database';
import { WONDERLAND_MIGRATIONS } from './wonderland-postgres';

/**
 * THE PROJECT BRAIN'S MIGRATION CHAIN, HELD TO ITS OWN RULES — and kept apart
 * from the Julius runtime chain. Static: reads the directories, opens no
 * connection, runs in every suite.
 */

const DIRECTORY = join(__dirname, 'julius-brain-migrations');
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort();
const read = (name: string) => readFileSync(join(DIRECTORY, name), 'utf8');
/** The statements, without `--` comments: prose may name the runtime schema; SQL may not. */
const statements = (sql: string) => sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
const RUNTIME_DIRECTORY = join(__dirname, 'wonderland-migrations');
const runtimeFiles = readdirSync(RUNTIME_DIRECTORY).filter((name) => name.endsWith('.sql'));

describe('the Project Brain migration chain', () => {
  it('registers every file on disk, in filename order, none empty', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(JULIUS_BRAIN_MIGRATIONS.map((sql) => files.find((name) => read(name) === sql))).toEqual(files);
    for (const sql of JULIUS_BRAIN_MIGRATIONS) expect(sql.trim()).not.toBe('');
  });

  for (const name of files) {
    it(`${name} is one transaction that stamps its own version, and touches nothing outside julius_brain`, () => {
      const sql = read(name);
      expect(sql.trimStart().startsWith('BEGIN;')).toBe(true);
      expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
      expect(juliusBrainMigrationVersion(sql)).toBe(name.replace(/\.sql$/, ''));
      const code = statements(sql);
      expect(code).not.toContain('relay_wonderland');
      for (const match of code.matchAll(/REFERENCES\s+([a-z_]+)\./g)) expect(match[1]).toBe('julius_brain');
      for (const match of code.matchAll(/CREATE\s+(?:TABLE|INDEX\s+\w+\s+ON)\s+([a-z_]+)\./g)) expect(match[1]).toBe('julius_brain');
    });
  }

  it('the Julius runtime chain creates no Brain table and knows nothing of the Brain schema', () => {
    for (const sql of WONDERLAND_MIGRATIONS.map(statements)) {
      expect(sql).not.toContain('julius_brain.');
      expect(sql).not.toMatch(/julius_brains|julius_brain_records|julius_brain_entities|julius_brain_links|julius_python_executions/);
    }
    expect(runtimeFiles.some((name) => /project_brain|python_executions/.test(name))).toBe(false);
  });
});
