import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * C2's choke point (the Reviewer's INDEP_REVIEW_035_GUARD_788dffed): exactly two modules write the social and voice tables, and
 * both ask the protected-store writer guard (protected-store-writer-guard.ts) before anything else. A third writer, or one of the
 * two losing its guard, fails here until it is reviewed. Reads `git ls-files` and the sources only.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SCANNED = /^(src|relay-bridge|scripts|relay-hermes-service)\//u;
const TEST = /\.(test|spec)\.[cm]?[tj]sx?$/u;
const SOURCE = /\.[cm]?[tj]sx?$/u;
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => SCANNED.test(f) && SOURCE.test(f) && !TEST.test(f));

/** A write to a social_* or voice_* table of relay_wonderland, in any case and spacing SQL allows. */
const WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?relay_wonderland\s*\.\s*(?:social|voice)_[a-z_]+/iu;
const writes = (source: string): boolean => WRITE.test(source);

const WRITERS = ['src/relay/persistence/social-postgres.ts', 'src/relay/persistence/voice-binding-postgres.ts'];

/** Without its block comments and whole-line comments, so a comment that NAMES the guard does not count as calling it. */
const code = (f: string): string =>
  readFileSync(join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');

describe('C2: the social and voice tables have exactly two writers, and both refuse a protected store', () => {
  it('the detector sees what it must (planted text)', () => {
    expect(writes('await c.query(`INSERT INTO relay_wonderland.social_messages(id) VALUES($1)`)')).toBe(true);
    expect(writes('update relay_wonderland.voice_puid_binding set puid = $2')).toBe(true);
    expect(writes('DELETE FROM relay_wonderland . social_parties WHERE id = $1')).toBe(true);
    expect(writes('TRUNCATE TABLE relay_wonderland.social_events')).toBe(true);
    expect(writes('SELECT * FROM relay_wonderland.social_profiles')).toBe(false); // a read is not a write
    expect(writes('INSERT INTO relay_wonderland.players(player_id) VALUES($1)')).toBe(false); // not a social table
  });

  it('the scan covers the repository (it is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toEqual(expect.arrayContaining(WRITERS));
  });

  it('the writers are exactly the two', () => {
    expect(files.filter((f) => writes(readFileSync(join(ROOT, f), 'utf8')))).toEqual(WRITERS);
  });

  it('each of the two builds the guard in code (each method calling it is proven in protected-store-writer-guard.test.ts)', () => {
    for (const f of WRITERS) expect(code(f), f).toMatch(/protectedStoreWriterGuard\(pool, '[^']+'\)/u);
    expect(code('src/relay/persistence/social-postgres.ts')).toMatch(/await protectedStoreWriterGuard\(pool, '[^']+'\)\(\);\s*let state = await loadState\(pool\);/u);
  });
});
