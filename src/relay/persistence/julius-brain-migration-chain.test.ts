import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JULIUS_BRAIN_MIGRATIONS, juliusBrainMigrationVersion } from './julius-brain-database';

/**
 * A migration that exists on disk but is not registered applies to nobody, and
 * one whose stamped version does not match its filename is skipped forever on
 * every database that has already run it. Both are caught here rather than in
 * production, exactly as the runtime chain is.
 */

const DIRECTORY = join(__dirname, 'julius-brain-migrations');
const read = (name: string) => readFileSync(join(DIRECTORY, name), 'utf8');

describe('the Project Brain migration chain', () => {
  it('is every file on disk, registered once, in filename order', () => {
    const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(JULIUS_BRAIN_MIGRATIONS).toHaveLength(files.length);
    // Matched by content, so renaming a file cannot quietly register the wrong one.
    expect(JULIUS_BRAIN_MIGRATIONS.map((sql) => files.find((name) => read(name) === sql))).toEqual(files);
  });

  it('each stamps its own version, and each is one transaction', () => {
    const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort();
    for (const [index, sql] of JULIUS_BRAIN_MIGRATIONS.entries()) {
      const expected = files[index]!.replace(/\.sql$/, '');
      expect(juliusBrainMigrationVersion(sql), files[index]).toBe(expected);
      expect(sql.trimStart().startsWith('BEGIN;'), files[index]).toBe(true);
      expect(sql.trimEnd().endsWith('COMMIT;'), files[index]).toBe(true);
      expect(sql, files[index]).not.toBe('');
    }
  });

  it('belongs to the Brain alone: it never touches the Julius runtime schema', () => {
    for (const sql of JULIUS_BRAIN_MIGRATIONS) {
      // The runtime database is disposable; a Brain migration that wrote into it
      // would put durable truth somewhere that gets thrown away.
      expect(sql).not.toMatch(/relay_wonderland/);
      const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--'));
      expect(statements.join('\n')).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i);
    }
  });
});
