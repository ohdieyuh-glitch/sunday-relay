#!/usr/bin/env node
/**
 * THE TRANSPORT RING'S MUTANTS (r16reh18 PROTOTYPE, to TRANSPORT_RING_DESIGN_T1_v1.md 0a710c29 + v2 c72f1ea8 and the reviewer's
 * signed T1 ruling d63c15; not evidence).
 *
 * Each privacy, ordering or bound invariant of the ring is enforced by one gate, one filter or one clear. Each mutant below REMOVES or
 * weakens it -- one edit, or the few edits that undo one design decision -- and names the tests (by id: RING-..., R..) that must ALL
 * then FAIL. The reviewer's G5 (ad7683) and v2 section 1.4: one mutant per invariant (NB: M43, M44; NI: M45, M46), and the rest.
 *
 * Run from the root of the worktree:
 *   node scripts/world-trail-mutations.mjs            every mutant, in turn
 *   node scripts/world-trail-mutations.mjs list       the mutants and the tests each must fail
 *   node scripts/world-trail-mutations.mjs only <id>  one mutant
 * RING_REPLAY_SCALE (default 0.25 here) scales the R27 / R27b seed counts for these repeated runs; 1 is the design's size.
 *
 * For each mutant: every anchor must occur EXACTLY once (else the run stops: a moved anchor would leave the code unmutated and fake a
 * survivor or a kill), the edits are written, the ring's tests run (vitest, one worker, no cache), and every touched file's original
 * bytes are written back and checked by sha256 before the next mutant -- also on an error or Ctrl-C. A baseline run with no mutant
 * must pass first. One summary line per mutant:  <id> KILLED|SURVIVED by <named tests> (<every failing id>).
 * Exit 0 only when the baseline passes and every mutant fails every one of its named tests.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WP = 'src/relay/social/world-presence.ts';
const SC = 'src/relay/social/social-commands.ts';
const PG = 'src/relay/persistence/social-postgres.ts';

/** The tests the mutants are judged by: the ring's own, today's bytes, and today's world tests. */
export const WORLD_TRAIL_TEST_FILES = Object.freeze([
  'src/relay/social/world-trail.test.ts',
  'relay-bridge/wonderland-social-world-trail.test.ts',
  'relay-bridge/wonderland-social-world-golden.test.ts',
  'src/relay/persistence/social-postgres-world-trail.test.ts',
  'src/relay/persistence/world-trail-replay.test.ts',
  'src/relay/social/world-presence.test.ts',
]);

const e = (file, from, to) => Object.freeze({ file, from, to });
const m = (id, invariant, edits, kills) => Object.freeze({ id, invariant, edits: Object.freeze(edits), kills: Object.freeze(kills) });
const dropRings = (set) => `trails: Object.fromEntries(Object.entries(world.trails ?? {}).filter(([id]) => !${set}.has(id)))`;

export const WORLD_TRAIL_MUTATIONS = Object.freeze([
  // ---- the ruled invariants (v2 section 1.4)
  m('M43', 'NB: the view of an op is built BEFORE its floors (P7 / P2-2 undone)', [
    e(SC, 'worldViewFor(gated, done.state, viewRequest.viewerId', 'worldViewFor(base, done.state, viewRequest.viewerId'),
  ], ['R37', 'R27']),
  m('M44', 'NB: the touched set over ring holders only (P8 / P2-1 undone)', [
    e(WP, '  for (const playerId of touched) {', '  for (const playerId of [...touched].filter((id) => (own(world.trails, id) ?? []).length > 0)) {'),
  ], ['R36', 'R27']),
  m('M45', 'NI: an arrival clears every member\'s ring (the prototype\'s PWP:231-233, P2 undone)', [
    e(WP, '    ...left,\n    seq: epoch,', '    ...left,\n    trails: Object.fromEntries(Object.entries(left.trails ?? {}).filter(([id]) => !current.memberIds.includes(id))),\n    seq: epoch,'),
  ], ['R14b', 'R27b']),
  m('M46', 'NI: a moved record clears the subject\'s whole ring (the prototype\'s PWP:187-191, P3 undone)', [
    e(WP, '  if (changed.size === 0) return world;', `  if (changed.size === 0) return { ...world, ${dropRings('touched')} };`),
    e(WP, '  return { ...world, seq: fresh, floors };', `  return { ...world, seq: fresh, floors, ${dropRings('touched')} };`),
  ], ['R14', 'R27b']),
  m('M47', 'the CPU bound: every member touched (a key diff over everyone) on every state change (P2-3 undone)', [
    e(WP, '  if (before === after || (before.users === after.users && before.friendships === after.friendships && before.blocks === after.blocks && before.parties === after.parties)) return world;', '  if (before === after) return world;'),
    e(WP, '  const touched = touchedPlayers(before, after, members ?? [], stats);', '  const touched = new Set([...touchedPlayers(before, after, members ?? [], stats), ...contexts.flatMap((c) => c.memberIds)]);\n  if (stats !== undefined) stats.keyComputations += touched.size;'),
  ], ['R38']),
  m('M48', 'a leaver\'s floors on others are kept (P9 undone)', [
    e(WP, 'map(([id, row]) => [id, strip(row) ?? {}])', 'map(([id, row]) => [id, row])'),
  ], ['R22b']),
  // ---- the touched set: each part of it
  m('M01', 'T misses the ends of a block added or removed', [e(WP, '  ends(before.blocks, after.blocks, (b) => `${b.blockerId}>${b.blockedId}`, (b) => [b.blockerId, b.blockedId]);\n', '')], ['RING-C03', 'RING-K01']),
  m('M02', 'T misses the ends of a friendship made or ended', [e(WP, '  ends(before.friendships, after.friendships, (f) => `${f.userA}|${f.userB}`, (f) => [f.userA, f.userB]);\n', '')], ['RING-C04', 'RING-K01']),
  m('M03', 'T misses the members of a changed party', [e(WP, '  if (before.parties !== after.parties) {', '  if (false) {')], ['RING-C05', 'RING-K01']),
  m('M04', 'T misses a changed user record (availability, presence audience, a removed record)', [e(WP, '  if (before.users !== after.users) {', '  if (false) {')], ['RING-C01', 'RING-C02', 'RING-C07']),
  m('M07', 'T is always empty', [e(WP, '  const touched = touchedPlayers(before, after, members ?? [], stats);', '  const touched = new Set<SocialUserId>();')], ['RING-C01', 'R27']),
  m('M08', 'no pair gate after an operation', [e(SC, '  const gated = noteAudienceChange(base, state, done.state);', '  const gated = base;')], ['RING-C01', 'RING-C08', 'R27']),
  // ---- the pair floors
  m('M31', 'no pair floor where an answer changed', [e(WP, '    if (positionVisibleTo(before, viewerId, subjectId) !== positionVisibleTo(after, viewerId, subjectId)) changed.set(', '    if (false) changed.set(')], ['RING-C01', 'R27']),
  m('M31w', 'no pair floor where an answer WIDENED (narrowing floors only)', [e(WP, '    if (positionVisibleTo(before, viewerId, subjectId) !== positionVisibleTo(after, viewerId, subjectId)) changed.set(', '    if (positionVisibleTo(before, viewerId, subjectId) && !positionVisibleTo(after, viewerId, subjectId)) changed.set(')], ['RING-C01', 'RING-C04', 'R27']),
  m('M32', 'the floor key swapped (floors[V][S])', [e(WP, 'floors[subjectId] = { ...(own(floors, subjectId) ?? {}), [viewerId]: fresh };', 'floors[viewerId] = { ...(own(floors, viewerId) ?? {}), [subjectId]: fresh };')], ['RING-C01', 'RING-C02']),
  m('M33', 'serial numbers from the request time, not the serial queue (P6 undone)', [
    e(WP, '  const seq = nextSerial(world);', '  const seq = nowMs;'),
    e(WP, '  const swept = sweepWorld(world, nowMs);', '  const swept = { ...sweepWorld(world, nowMs), clockMs: nowMs } as WorldState;'),
    e(WP, '  const epoch = nextSerial(left);', '  const epoch = (left as { clockMs?: number }).clockMs ?? 0;'),
    e(WP, '  const fresh = nextSerial(world);', '  const fresh = (world as { clockMs?: number }).clockMs ?? 0;'),
    e(SC, '  const base = done.world ?? world;', '  const base = { ...(done.world ?? world), clockMs: Date.parse(nowIso) } as WorldState;'),
  ], ['R15']),
  m('M35', 'floors pruned by time instead of by serial number', [e(WP, '  const floors = pruneFloors(world.floors, actorId, trail[0].seq);', '  const floors = pruneFloors(world.floors, actorId, trail[0].reportedAtMs);')], ['R22', 'RING-C01']),
  // ---- the join epoch and the drop with the avatar
  m('M30', 'the join epoch not in the gate', [e(WP, '  const gate = Math.max(epoch, floor);', '  const gate = floor;')], ['RING-C10', 'R27']),
  m('M30b', 'the join epoch never set', [e(WP, '    joinedSeq: { ...(left.joinedSeq ?? {}), [userId]: epoch },', '    joinedSeq: left.joinedSeq ?? {},')], ['RING-C10']),
  m('M09', 'the ring not dropped with the avatar (leave, move, sweep, removal)', [e(WP, '  return withoutRing({ ...world, contexts, avatars }, userId);', '  return { ...world, contexts, avatars };')], ['RING-C09', 'R17']),
  // ---- the per-report filter at serve time: today's decision, and the entry's own context
  m('M11', 'with a cursor, today\'s filter is skipped (a ring-only path)', [e(WP, '          .filter(visible)\n', '          .filter((id) => sinceMs !== undefined || visible(id))\n')], ['RING-F01', 'RING-F02', 'RING-F03']),
  m('M12', 'presence hiding removed from the one decision (P1)', [e(WP, ' && !presenceHiddenFrom(social, viewerId, subjectId);', ';')], ['RING-F02', 'RING-F01']),
  m('M13', 'blocks removed from the one decision (the wall)', [e(WP, 'return subjectId !== viewerId && !hasBlocked(social, subjectId, viewerId) && !hasBlocked(social, viewerId, subjectId) && ', 'return subjectId !== viewerId && ')], ['RING-F03']),
  m('M14', 'an entry stored in another context is served (no per-entry check)', [e(WP, '    .filter((e) => e.contextId === contextId)\n', '')], ['RING-V10']),
  // ---- the cursor
  m('M15', 'the window\'s age bound removed (a 0 / old cursor reaches the whole ring)', [e(WP, '  const lower = Math.max(sinceMs - WORLD_TRAIL_SLACK_MS, nowMs - WORLD_TRAIL_MAX_AGE_MS);', '  const lower = sinceMs - WORLD_TRAIL_SLACK_MS;')], ['RING-V05']),
  m('M34', 'no slack: a strict cursor (P4 undone)', [e(WP, '  const lower = Math.max(sinceMs - WORLD_TRAIL_SLACK_MS, nowMs - WORLD_TRAIL_MAX_AGE_MS);', '  const lower = Math.max(sinceMs, nowMs - WORLD_TRAIL_MAX_AGE_MS);')], ['RING-V03']),
  m('M17', 'the figure\'s newest report repeated in its trail', [e(WP, 'e.reportedAtMs > lower && e.reportedAtMs < figure.reportedAtMs', 'e.reportedAtMs > lower && e.reportedAtMs <= figure.reportedAtMs')], ['RING-V04']),
  m('M18', 'the cursor grammar weakened (any finite number)', [e(SC, '/^[0-9]{1,15}$/.test(rawSince) ? Number(rawSince)', "rawSince !== '' && Number.isFinite(Number(rawSince)) ? Number(rawSince)")], ['RING-V11', 'RING-W03']),
  m('M26', 'the cursor read from the BODY (P1 undone; void2 B_WLWORLD_FIELDS)', [e(SC, "const rawSince = Object.hasOwn(input.query, 'sinceMs') ? input.query.sinceMs : undefined;", "const rawSince = typeof body.sinceMs === 'number' || typeof body.sinceMs === 'string' ? String(body.sinceMs) : undefined;")], ['RING-V11', 'R30']),
  m('M27', 'a malformed cursor answers 400 (never an error, Q3)', [e(SC, '      const sinceMs = rawSince !== undefined && /^[0-9]{1,15}$/.test(rawSince)', "      if (rawSince !== undefined && !/^[0-9]{1,15}$/.test(rawSince)) return invalid('sinceMs must be a whole number');\n      const sinceMs = rawSince !== undefined && /^[0-9]{1,15}$/.test(rawSince)")], ['RING-V11', 'RING-W03']),
  // ---- no cursor = today's bytes; no asOfMs without a context
  m('M19', 'an absent cursor becomes 0', [e(SC, '/^[0-9]{1,15}$/.test(rawSince) ? Number(rawSince) : undefined;', '/^[0-9]{1,15}$/.test(rawSince) ? Number(rawSince) : 0;')], ['RING-V01', 'GOLDEN']),
  m('M20', 'asOfMs always', [e(WP, '  return sinceMs === undefined || context === undefined ? view : { ...view, asOfMs: nowMs };', '  return { ...view, asOfMs: nowMs };')], ['RING-V01', 'GOLDEN']),
  m('M36', 'the removal answer carries asOfMs (P5 undone)', [e(WP, '  return sinceMs === undefined || context === undefined ? view : { ...view, asOfMs: nowMs };', '  return sinceMs === undefined ? view : { ...view, asOfMs: nowMs };')], ['R21']),
  // ---- the ring itself
  m('M21', 'a duplicate or out-of-order report admitted', [e(WP, '  if (newest !== undefined && sample.reportedAtMs <= newest.reportedAtMs) return ring;\n', '')], ['RING-S04']),
  m('M22', 'the 8-entry bound removed', [e(WP, '.slice(-WORLD_TRAIL_MAX_ENTRIES)', '')], ['RING-S02']),
  m('M23', 'the 2 s prune removed', [e(WP, '.filter((e) => sample.reportedAtMs - e.reportedAtMs <= WORLD_TRAIL_MAX_AGE_MS)', '')], ['RING-S03']),
  m('M24', 'the ring stores the skin (a new field)', [e(WP, 'reportedAtMs: avatar.reportedAtMs, seq };', 'reportedAtMs: avatar.reportedAtMs, seq, skinId: avatar.skinId } as TrailSample;')], ['RING-S05']),
  m('M25', 'a served trail entry carries reportedAtMs (a new field)', [e(WP, 'ageMs: nowMs - e.reportedAtMs }));', 'ageMs: nowMs - e.reportedAtMs, reportedAtMs: e.reportedAtMs }));')], ['RING-V07', 'R02']),
  // ---- the stores
  m('M38', 'the PostgreSQL store adopts the world before the commit (a refused write would keep its floors)', [e(PG, '        const next = outcome.value.state;', '        const next = outcome.value.state;\n        if (outcome.value.world !== undefined) world = outcome.value.world;')], ['RING-P02']),
]);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The mutated texts per file, or a thrown error when an anchor does not occur exactly once. */
export function applyWorldTrailMutation(mutation, read) {
  const out = new Map();
  for (const edit of mutation.edits) {
    const text = out.get(edit.file) ?? read(edit.file);
    const count = text.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`world_trail_mutation_anchor:${mutation.id}:${edit.file}:${count}`);
    out.set(edit.file, text.replace(edit.from, () => edit.to));
  }
  return out;
}

const GOLDEN_TITLE = 'every answer of the scenario is exactly the recorded bytes';
const ID = /\b(RING-[A-Z]\d+|R\d{2}b?)\b/g;

/** Run the ring's tests; the ids of the failing tests, and how many tests failed in all. */
function runTests(root, scratch, tag) {
  const out = join(scratch, `${tag}.json`);
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const run = spawnSync(process.execPath, [vitest, 'run', '--maxWorkers=1', '--cache=false', '--configLoader', 'runner', '--reporter=json', `--outputFile=${out}`, ...WORLD_TRAIL_TEST_FILES], {
    cwd: root, encoding: 'utf8', timeout: 900_000, env: { ...process.env, FORCE_COLOR: '0', RING_REPLAY_SCALE: process.env.RING_REPLAY_SCALE ?? '0.25' },
  });
  let report;
  try { report = JSON.parse(readFileSync(out, 'utf8')); } catch { return { ok: false, failedIds: [], failed: -1, today: 0, total: -1, note: `no report (exit ${run.status})` }; }
  const results = report.testResults.flatMap((file) => file.assertionResults);
  const failed = results.filter((r) => r.status === 'failed');
  const ids = new Set();
  for (const r of failed) {
    if (r.title === GOLDEN_TITLE) ids.add('GOLDEN');
    for (const hit of r.title.matchAll(ID)) ids.add(hit[1]);
  }
  const today = failed.filter((r) => r.title !== GOLDEN_TITLE && r.title.match(ID) === null).length;
  return { ok: failed.length === 0 && run.status === 0, failedIds: [...ids].sort(), failed: failed.length, today, total: results.length, note: '' };
}

function main(argv) {
  const root = process.cwd();
  const [command, only] = argv;
  if (command === 'list') {
    for (const mu of WORLD_TRAIL_MUTATIONS) process.stdout.write(`${mu.id}\t${mu.kills.join('+')}\t${[...new Set(mu.edits.map((x) => x.file))].join(',')}\t${mu.invariant}\n`);
    return 0;
  }
  if (command !== undefined && command !== 'only') { process.stderr.write('usage: world-trail-mutations.mjs [list | only <id>]\n'); return 2; }
  const chosen = command === 'only' ? WORLD_TRAIL_MUTATIONS.filter((mu) => mu.id === only) : WORLD_TRAIL_MUTATIONS;
  if (chosen.length === 0) { process.stderr.write(`no mutant ${only}\n`); return 2; }

  const files = [...new Set(WORLD_TRAIL_MUTATIONS.flatMap((mu) => mu.edits.map((x) => x.file)))];
  const originals = new Map(files.map((f) => [f, readFileSync(join(root, f))]));
  const read = (f) => originals.get(f).toString('utf8');
  // every anchor first: a moved anchor stops the run before anything is written
  for (const mu of chosen) applyWorldTrailMutation(mu, read);
  const restore = () => {
    for (const [f, bytes] of originals) {
      writeFileSync(join(root, f), bytes);
      if (sha(readFileSync(join(root, f))) !== sha(bytes)) throw new Error(`world_trail_mutation_restore_failed:${f}`);
    }
  };
  const onSignal = () => { restore(); process.exit(130); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const scratch = mkdtempSync(join(tmpdir(), 'world-trail-mutations-'));
  let allKilled = true;
  try {
    const base = runTests(root, scratch, 'baseline');
    process.stdout.write(`BASELINE ${base.ok ? 'PASS' : 'FAIL'} (${base.total - Math.max(base.failed, 0)}/${base.total} tests pass${base.failed > 0 ? `; failing: ${base.failedIds.join(',')}` : ''}) ${base.note}\n`);
    if (!base.ok) return 1;
    for (const mu of chosen) {
      try {
        for (const [f, text] of applyWorldTrailMutation(mu, read)) writeFileSync(join(root, f), text);
        const r = runTests(root, scratch, mu.id);
        const killed = mu.kills.every((k) => r.failedIds.includes(k));
        if (!killed) allKilled = false;
        const todays = r.today > 0 ? `; +${r.today} of today's tests` : '';
        process.stdout.write(`${mu.id} ${killed ? 'KILLED' : 'SURVIVED'} by ${mu.kills.join('+')} (${r.failed} failing: ${r.failedIds.join(',') || 'none'}${todays}) -- ${mu.invariant}${r.note ? ` ${r.note}` : ''}\n`);
      } finally {
        restore();
      }
    }
  } finally {
    restore();
    rmSync(scratch, { recursive: true, force: true });
  }
  process.stdout.write(`${allKilled ? 'ALL KILLED' : 'SOME SURVIVED'}: ${chosen.length} mutants; files restored (sha256 checked)\n`);
  return allKilled ? 0 : 1;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  process.exitCode = main(process.argv.slice(2));
}
