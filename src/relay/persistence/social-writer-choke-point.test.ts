import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * C2's choke point (the Reviewer's INDEP_REVIEW_035_GUARD_788dffed): exactly two modules write the social and voice tables, and
 * both ask the protected-store writer guard (protected-store-writer-guard.ts) before anything else. A third writer, or one of the
 * two losing its guard, fails here until it is reviewed. Reads `git ls-files` and the sources only.
 * 037 (the private-server rules, 10-11) adds the private_server* tables and exactly ONE module that writes them,
 * private-server-postgres.ts, under the same guard: three writers in all.
 * 038 (LFF, the "Looking For Feed", PROVISIONAL number, 10-12) adds the lff_* tables and NO new writer: their one writer is
 * social-postgres.ts (slice B2b: its write-through and its event log), already one of the three and already guarded.
 * B2b's review (m2) narrows it: social-postgres.ts is the ONLY writer of the lff_* tables (the union scan alone would let another of
 * the three gain an lff_* write), and writeSocialEvent -- exported, so a caller writes social_events with no SQL in its own text --
 * is used exactly where it is today. Both scans read tracked AND untracked (not ignored) files, so new work is caught before it lands.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SCANNED = /^(src|relay-bridge|scripts|relay-hermes-service)\//u;
const TEST = /\.(test|spec)\.[cm]?[tj]sx?$/u;
const SOURCE = /\.[cm]?[tj]sx?$/u;
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => SCANNED.test(f) && SOURCE.test(f) && !TEST.test(f));

/** A write to a social_*, voice_*, private_server* or lff_* table of relay_wonderland, in any case and spacing SQL allows. */
const WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?relay_wonderland\s*\.\s*(?:(?:social|voice|lff)_[a-z_]+|private_server[a-z_]*)/iu;
const writes = (source: string): boolean => WRITE.test(source);

const WRITERS = ['src/relay/persistence/private-server-postgres.ts', 'src/relay/persistence/social-postgres.ts', 'src/relay/persistence/voice-binding-postgres.ts'];

/** Every source file, tests included, tracked or new (not ignored): what the two narrower scans below read. */
const everySource = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => SCANNED.test(f) && SOURCE.test(f) && existsSync(join(ROOT, f)));
const SELF = 'src/relay/persistence/social-writer-choke-point.test.ts';

/** A write to an lff_* table, schema-qualified OR NOT (a writer on a search_path), in any case and spacing SQL allows. */
const LFF_WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?(?:relay_wonderland\s*\.\s*)?lff_[a-z_]+/iu;
const LFF_WRITERS = ['src/relay/persistence/social-postgres.ts'];

/** Every file that uses writeSocialEvent in code (its definition, its one call site, its unit test). A new one is reviewed first. */
const EVENT_WRITER_USERS = ['src/relay/persistence/social-postgres-lff.test.ts', 'src/relay/persistence/social-postgres.ts'];

/**
 * BOTH SIDES SORTED before every list comparison (B2b r2 review r2-m2): `git ls-files --cached --others` lists untracked files
 * BEFORE tracked ones, so the order a scan finds them in changes when a file is committed. A copy, so the constants stay as written.
 */
const sorted = (list: readonly string[]): string[] => [...list].sort();

/** Without its block comments and whole-line comments, so a comment that NAMES the guard does not count as calling it. */
const code = (f: string): string =>
  readFileSync(join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');

describe('C2: the social, voice, private-server and LFF tables have exactly three writers, and each refuses a protected store', () => {
  it('the detector sees what it must (planted text)', () => {
    expect(writes('await c.query(`INSERT INTO relay_wonderland.social_messages(id) VALUES($1)`)')).toBe(true);
    expect(writes('update relay_wonderland.voice_puid_binding set puid = $2')).toBe(true);
    expect(writes('DELETE FROM relay_wonderland . social_parties WHERE id = $1')).toBe(true);
    expect(writes('TRUNCATE TABLE relay_wonderland.social_events')).toBe(true);
    expect(writes('UPDATE relay_wonderland.private_servers SET version = $2')).toBe(true);
    expect(writes('insert into relay_wonderland.private_server_entitlements(player_id) values($1)')).toBe(true);
    expect(writes('INSERT INTO relay_wonderland.lff_posts(post_id, owner_id) VALUES($1, $2)')).toBe(true);
    expect(writes('delete from relay_wonderland . lff_join_requests where request_id = $1')).toBe(true);
    expect(writes('UPDATE ONLY relay_wonderland.lff_posts SET status = $2')).toBe(true);
    expect(writes('SELECT * FROM relay_wonderland.social_profiles')).toBe(false); // a read is not a write
    expect(writes('SELECT tier FROM relay_wonderland.private_server_entitlements')).toBe(false); // a read is not a write
    expect(writes('SELECT * FROM relay_wonderland.lff_posts WHERE status = $1')).toBe(false); // a read is not a write
    expect(writes('INSERT INTO relay_wonderland.lff(x) VALUES($1)')).toBe(false); // not an lff_* table
    expect(writes('INSERT INTO relay_wonderland.players(player_id) VALUES($1)')).toBe(false); // not a social table
  });

  it('the scan covers the repository (it is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toEqual(expect.arrayContaining(WRITERS));
  });

  it('the writers are exactly the three (nothing writes the trusted tier row: an operator does)', () => {
    expect(sorted(files.filter((f) => writes(readFileSync(join(ROOT, f), 'utf8'))))).toEqual(sorted(WRITERS));
    expect(code('src/relay/persistence/private-server-postgres.ts')).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+relay_wonderland\.private_server_entitlements/iu);
  });

  it('the lff_* tables have exactly ONE writer, social-postgres.ts: not another of the three, not anything else (B2b review m2)', () => {
    // planted text first: the detector sees an lff_* write, qualified or not, and nothing that is not one
    expect(LFF_WRITE.test('INSERT INTO relay_wonderland.lff_posts(post_id) VALUES($1)')).toBe(true);
    expect(LFF_WRITE.test('delete from lff_join_requests where request_id = $1')).toBe(true);
    expect(LFF_WRITE.test('UPDATE ONLY relay_wonderland . lff_post_creations SET created_at = $2')).toBe(true);
    expect(LFF_WRITE.test('SELECT * FROM relay_wonderland.lff_posts ORDER BY post_id')).toBe(false); // a read is not a write
    expect(LFF_WRITE.test('INSERT INTO relay_wonderland.social_events(op) VALUES($1)')).toBe(false); // not an lff_* table
    expect(everySource.length).toBeGreaterThan(files.length); // the wider list holds the tests too: not vacuous
    expect(sorted(everySource.filter((f) => !TEST.test(f) && LFF_WRITE.test(readFileSync(join(ROOT, f), 'utf8'))))).toEqual(sorted(LFF_WRITERS));
  });

  it('writeSocialEvent, the event log\'s exported writer, is used exactly where it is today: a new caller fails here (B2b review m2)', () => {
    const users = everySource.filter((f) => f !== SELF && /\bwriteSocialEvent\b/u.test(code(f)));
    expect(sorted(users)).toEqual(sorted(EVENT_WRITER_USERS));
    expect(code('src/relay/persistence/social-postgres.ts')).toMatch(/export async function writeSocialEvent\(/u);
  });

  it('each of the three builds the guard in code (each method calling it is proven in protected-store-writer-guard.test.ts)', () => {
    for (const f of WRITERS) expect(code(f), f).toMatch(/protectedStoreWriterGuard\(pool, '[^']+'\)/u);
    expect(code('src/relay/persistence/social-postgres.ts')).toMatch(/await protectedStoreWriterGuard\(pool, '[^']+'\)\(\);\s*let state = await loadState\(pool\);/u);
  });
});

/*
 * D-L5 TRIPWIRES (the D-L5 security review's m-5). Moderation evidence (founder D-L5: a reported LFF post is kept, silently, for
 * moderators only) is safe only while (1) no app code reads it -- not the evidence view, not the held posts or the snapshots in
 * memory -- and (2) no statement undoes it: none clears held_at, none updates or deletes a snapshot, every post DELETE carries both
 * evidence guards, and nothing deletes a player (the players cascade would take the evidence: founder question FQ-3). The file-level
 * writer scan above would pass a change that broke any of these, so each is pinned here, on code with its comments stripped, each
 * detector proven on planted text first. Non-test sources only, tracked or new (not ignored).
 */
describe('D-L5 tripwires: no app code reads the evidence, and no statement un-holds it, rewrites a snapshot or deletes a player', () => {
  const appSources = everySource.filter((f) => !TEST.test(f));
  /** The SQL text of every statement in `source` that starts with `head`: up to the template literal's closing backtick. */
  const statements = (source: string, head: RegExp): string[] =>
    [...source.matchAll(new RegExp(`${head.source}[^\`]*`, 'giu'))].map((m) => m[0].replace(/\s+/gu, ' '));
  const POST_DELETE = /\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:relay_wonderland\s*\.\s*)?lff_posts\b/u;
  const SNAPSHOT_REWRITE = /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s+(?:ONLY\s+)?(?:relay_wonderland\s*\.\s*)?lff_post_snapshots\b/iu;
  const UNHOLD = /\bheld_at\s*=\s*(?:NULL|DEFAULT)\b/iu;
  const PLAYER_DELETE = /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:relay_wonderland\s*\.\s*)?players\b/iu;
  const GUARDS = ['held_at IS NULL', 'NOT EXISTS (SELECT 1 FROM relay_wonderland.lff_post_snapshots s WHERE s.post_id = $1)'];

  it('the detectors see what they must (planted text)', () => {
    expect(statements('x `DELETE FROM relay_wonderland.lff_posts WHERE post_id=$1` y', POST_DELETE)).toEqual(['DELETE FROM relay_wonderland.lff_posts WHERE post_id=$1']);
    expect(statements('`SELECT 1 FROM relay_wonderland.lff_posts`', POST_DELETE)).toEqual([]);
    expect(SNAPSHOT_REWRITE.test('update relay_wonderland . lff_post_snapshots set title = $2')).toBe(true);
    expect(SNAPSHOT_REWRITE.test('DELETE FROM lff_post_snapshots WHERE post_id = $1')).toBe(true);
    expect(SNAPSHOT_REWRITE.test('INSERT INTO relay_wonderland.lff_post_snapshots(post_id) VALUES($1)')).toBe(false); // appending is the point
    expect(UNHOLD.test('UPDATE relay_wonderland.lff_posts SET held_at = NULL WHERE post_id=$1')).toBe(true);
    expect(UNHOLD.test('SET held_at=GREATEST($2::timestamptz, updated_at)')).toBe(false);
    expect(PLAYER_DELETE.test('delete from relay_wonderland.players where player_id = $1')).toBe(true);
    expect(PLAYER_DELETE.test('TRUNCATE players')).toBe(true);
    expect(PLAYER_DELETE.test('SELECT * FROM relay_wonderland.players')).toBe(false);
    expect(appSources.length, 'not vacuous').toBeGreaterThan(200);
  });

  it('no app source names the evidence view: only database operators read it (R-4; no route serves it)', () => {
    expect(appSources.filter((f) => /\blff_moderation_evidence\b/u.test(code(f)))).toEqual([]);
    // the control: a test does name it, so the scan reads the text it must
    expect(everySource.filter((f) => TEST.test(f) && /\blff_moderation_evidence\b/u.test(code(f))).length).toBeGreaterThan(0);
  });

  it('the held posts and the snapshots are named in code only by the domain, the state and the store (no player surface reads them, R-3)', () => {
    const named = (word: string) => sorted(appSources.filter((f) => new RegExp(`\\b${word}\\b`, 'u').test(code(f))));
    const ONLY = sorted(['src/relay/social/social-lff.ts', 'src/relay/social/social-state.ts', 'src/relay/persistence/social-postgres.ts']);
    expect(named('lffHeld')).toEqual(ONLY);
    expect(named('lffSnapshots')).toEqual(ONLY);
  });

  it('no statement clears held_at or rewrites a snapshot, the snapshot INSERT has no ON CONFLICT, and every lff_posts DELETE carries both evidence guards', () => {
    expect(appSources.filter((f) => UNHOLD.test(code(f))), 'held_at is never cleared').toEqual([]);
    expect(appSources.filter((f) => SNAPSHOT_REWRITE.test(code(f))), 'a snapshot is never updated or deleted').toEqual([]);
    const store = code('src/relay/persistence/social-postgres.ts');
    const appends = statements(store, /\bINSERT\s+INTO\s+relay_wonderland\.lff_post_snapshots\b/u);
    expect(appends, 'one snapshot INSERT').toHaveLength(1);
    expect(appends[0], 'a second write of a key is a refusal, never an overwrite').not.toMatch(/ON\s+CONFLICT/iu);
    const holds = statements(store, /\bSET\s+held_at\s*=/u);
    expect(holds.length, 'the hold and its backstop').toBe(2);
    for (const h of holds) expect(h).toMatch(/^SET held_at=GREATEST\(\$2::timestamptz, updated_at\) WHERE post_id=\$1 AND owner_id=\$3 AND created_at=\$4 /u);
    const deletes = appSources.flatMap((f) => statements(code(f), POST_DELETE).map((s) => [f, s] as const));
    expect(deletes.map(([f]) => f), 'one post DELETE, in the store').toEqual(['src/relay/persistence/social-postgres.ts']);
    for (const [, d] of deletes) for (const guard of GUARDS) expect(d, guard).toContain(guard);
    // the control: a DELETE without the guards is what this would catch
    expect(GUARDS.every((g) => 'DELETE FROM relay_wonderland.lff_posts WHERE post_id=$1'.includes(g))).toBe(false);
  });

  it('no app source deletes or truncates a player: the players cascade would destroy held evidence (FQ-3, open for counsel)', () => {
    expect(appSources.filter((f) => PLAYER_DELETE.test(code(f)))).toEqual([]);
  });
});
