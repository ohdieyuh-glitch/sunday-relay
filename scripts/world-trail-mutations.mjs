#!/usr/bin/env node
/**
 * THE TRANSPORT RING'S MUTANTS (r16reh18 PROTOTYPE, before the reviewer's T1 ruling; not evidence).
 *
 * Each privacy or ordering invariant of the ring (src/relay/social/world-presence.ts, social-commands.ts) is enforced by exactly
 * one clear or one filter. Each mutant below REMOVES or weakens that one clear or filter, and names the test (by its RING-... id)
 * that must then FAIL. The reviewer's G5 (ad7683): for each invariant, a mutant that removes the ring clear or the per-report
 * filter, and that mutant must fail a named test.
 *
 * Run from the root of the worktree:
 *   node scripts/world-trail-mutations.mjs            every mutant, in turn
 *   node scripts/world-trail-mutations.mjs list       the mutants and the test each must fail
 *   node scripts/world-trail-mutations.mjs only <id>  one mutant
 *
 * For each mutant: the file is read, its anchor must occur EXACTLY once (else the run stops: a moved anchor would leave the code
 * unmutated and fake a survivor or a kill), the mutant is written, the ring's tests run (vitest, one worker, no cache), and the
 * file's original bytes are written back and checked by sha256 before the next mutant -- also on an error or Ctrl-C. A baseline run
 * with no mutant must pass first. One summary line per mutant:  <id> KILLED|SURVIVED by <the named test> (<all failing ids>).
 * Exit 0 only when the baseline passes and every mutant is killed by its named test.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WP = 'src/relay/social/world-presence.ts';
const SC = 'src/relay/social/social-commands.ts';

/** The tests the mutants are judged by: the ring's own, today's bytes, and today's world tests (for information). */
export const WORLD_TRAIL_TEST_FILES = Object.freeze([
  'src/relay/social/world-trail.test.ts',
  'relay-bridge/wonderland-social-world-trail.test.ts',
  'relay-bridge/wonderland-social-world-golden.test.ts',
  'src/relay/persistence/social-postgres-world-trail.test.ts',
  'src/relay/social/world-presence.test.ts',
]);

const m = (id, invariant, file, from, to, kills) => Object.freeze({ id, invariant, file, from, to, kills });

export const WORLD_TRAIL_MUTATIONS = Object.freeze([
  // ---- the leading invariant: every audience-affecting change involving the subject clears their ring
  m('M01', 'a block added or removed, the subject on either side, clears the ring', WP,
    "    social.blocks.filter((b) => b.blockerId === userId || b.blockedId === userId).map((b) => `${b.blockerId}>${b.blockedId}`).sort(),\n", '', 'RING-C03'),
  m('M02', 'a friendship made or ended clears the ring (the viewer\'s accept included)', WP,
    '    friendIdsOf(social, userId),\n', '', 'RING-C04'),
  m('M03', 'a party change clears the ring (a PARTY audience; the reconciliation too)', WP,
    '    parties,\n', '', 'RING-C05'),
  m('M03b', 'a party change clears the ring even where carried-in data lists the player in two parties', WP,
    '  const parties = Object.values(social.parties)\n    .filter((p) => p.members.some((m) => m.userId === userId))\n',
    '  const parties = Object.values(social.parties)\n    .filter((p) => p.members.some((m) => m.userId === userId)).slice(0, 1)\n', 'RING-C13'),
  m('M04', 'appearing offline, and coming back, clears the ring (no replay across a hide)', WP,
    '    user === undefined ? null : user.presence.availability,\n', '', 'RING-C01'),
  m('M05', 'a presence visibility change clears the ring', WP,
    '    user === undefined ? null : user.privacy,\n', '', 'RING-C02'),
  m('M06', 'a sign-out clears the ring', WP,
    '    user === undefined ? null : user.presence.connected,\n', '', 'RING-C06'),
  m('M07', 'a record that disappears clears the ring (the key reads nothing)', WP,
    '  return JSON.stringify([\n    user === undefined ? null : user.presence.connected,', "  return 'constant'; JSON.stringify([\n    user === undefined ? null : user.presence.connected,", 'RING-C07'),
  m('M08', 'every operation (and the reconciliation before it) clears the rings it moved', SC,
    '  const cleared = clearTrailsWhereAudienceMoved(base, before, outcome.state);', '  const cleared = base;', 'RING-C08'),
  m('M09', 'leaving, moving context, the stale sweep and a removal drop the ring with the figure', WP,
    '  return clearTrails({ ...world, contexts, avatars }, [userId]);', '  return { ...world, contexts, avatars };', 'RING-C09'),
  m('M10', 'an arrival clears the rings of the context it joins (the viewer changes context)', WP,
    '  const arrived = clearTrails(left, current.memberIds);', '  const arrived = left;', 'RING-C10'),
  // ---- the per-report filter at serve time: today's filter, and the entry's own context
  m('M11', 'with a cursor, a hidden or blocked subject is still filtered out (no ring-only path)', WP,
    '          .filter(visible)\n', '          .filter((id) => sinceMs !== undefined || visible(id))\n', 'RING-F01'),
  m('M12', 'a subject hiding presence from the viewer is filtered out (today\'s P1 filter)', WP,
    'const visible = (id: SocialUserId) => unwalled(id) && !presenceHiddenFrom(social, viewerId, id);', 'const visible = (id: SocialUserId) => unwalled(id);', 'RING-F02'),
  m('M13', 'a subject blocked either way is filtered out (today\'s wall)', WP,
    'const unwalled = (id: SocialUserId) => id !== viewerId && !hasBlocked(social, id, viewerId) && !hasBlocked(social, viewerId, id);', 'const unwalled = (id: SocialUserId) => id !== viewerId;', 'RING-F03'),
  m('M14', 'an entry stored in another context is never served (per entry)', WP,
    '    .filter((e) => e.contextId === contextId)\n', '', 'RING-V10'),
  // ---- the cursor
  m('M15', 'a 0 / negative / too-old cursor reaches no further back than the ring\'s age', WP,
    '  const cursor = Math.max(Math.floor(sinceMs), nowMs - WORLD_TRAIL_MAX_AGE_MS);', '  const cursor = Math.floor(sinceMs);', 'RING-V05'),
  m('M16', 'strictly after the cursor: a report already sent is not sent again', WP,
    '.filter((e) => e.reportedAtMs > cursor && e.reportedAtMs < figure.reportedAtMs)', '.filter((e) => e.reportedAtMs >= cursor && e.reportedAtMs < figure.reportedAtMs)', 'RING-V03'),
  m('M17', 'the newest report, on the figure itself, is never repeated in the trail', WP,
    '.filter((e) => e.reportedAtMs > cursor && e.reportedAtMs < figure.reportedAtMs)', '.filter((e) => e.reportedAtMs > cursor && e.reportedAtMs <= figure.reportedAtMs)', 'RING-V04'),
  m('M18', 'a cursor that is not a finite number is ignored: today\'s answer', SC,
    "typeof body.sinceMs === 'number' && Number.isFinite(body.sinceMs) ? body.sinceMs : undefined", 'body.sinceMs !== undefined ? Number(body.sinceMs) : undefined', 'RING-V11'),
  // ---- an absent cursor is today's answer, byte for byte
  m('M19', 'an absent sinceMs is today\'s answer (the operation adds no cursor of its own)', SC,
    "typeof body.sinceMs === 'number' && Number.isFinite(body.sinceMs) ? body.sinceMs : undefined", "typeof body.sinceMs === 'number' && Number.isFinite(body.sinceMs) ? body.sinceMs : 0", 'RING-V01'),
  m('M20', 'an absent sinceMs is today\'s answer (no asOfMs without a cursor)', WP,
    '  return sinceMs === undefined ? view : { ...view, asOfMs: nowMs };', '  return { ...view, asOfMs: nowMs };', 'RING-V01'),
  // ---- the ring itself: once, in order, bounded, no new field
  m('M21', 'a duplicate or out-of-order report never enters the ring', WP,
    '  if (newest !== undefined && sample.reportedAtMs <= newest.reportedAtMs) return ring;\n', '', 'RING-S04'),
  m('M22', 'the ring keeps at most WORLD_TRAIL_MAX_ENTRIES', WP,
    '.slice(-WORLD_TRAIL_MAX_ENTRIES)', '', 'RING-S02'),
  m('M23', 'the ring drops reports older than WORLD_TRAIL_MAX_AGE_MS', WP,
    '.filter((e) => sample.reportedAtMs - e.reportedAtMs <= WORLD_TRAIL_MAX_AGE_MS)', '', 'RING-S03'),
  m('M24', 'the ring stores no field beyond the position report (no skin)', WP,
    'reportedAtMs: avatar.reportedAtMs };', 'reportedAtMs: avatar.reportedAtMs, skinId: avatar.skinId } as TrailSample;', 'RING-S05'),
  m('M25', 'a served trail entry carries no field beyond the figure\'s position and its age', WP,
    'ageMs: nowMs - e.reportedAtMs }));', 'ageMs: nowMs - e.reportedAtMs, reportedAtMs: e.reportedAtMs }));', 'RING-V07'),
]);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The mutated text, or a thrown error when the anchor does not occur exactly once. */
export function applyWorldTrailMutation(mutation, text) {
  const count = text.split(mutation.from).length - 1;
  if (count !== 1) throw new Error(`world_trail_mutation_anchor:${mutation.id}:${count}`);
  return text.replace(mutation.from, () => mutation.to);
}

/** Run the ring's tests; the RING ids of the failing tests, and how many tests failed in all. */
function runTests(root, scratch, tag) {
  const out = join(scratch, `${tag}.json`);
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const run = spawnSync(process.execPath, [vitest, 'run', '--maxWorkers=1', '--cache=false', '--configLoader', 'runner', '--reporter=json', `--outputFile=${out}`, ...WORLD_TRAIL_TEST_FILES], {
    cwd: root, encoding: 'utf8', timeout: 600_000, env: { ...process.env, FORCE_COLOR: '0' },
  });
  let report;
  try { report = JSON.parse(readFileSync(out, 'utf8')); } catch { return { ok: false, failedIds: [], failed: -1, today: 0, total: -1, note: `no report (exit ${run.status})` }; }
  const results = report.testResults.flatMap((file) => file.assertionResults);
  const failed = results.filter((r) => r.status === 'failed');
  const ids = [...new Set(failed.map((r) => (/RING-[A-Z]\d+/.exec(r.title) ?? [null])[0]).filter((x) => x !== null))].sort();
  const GOLDEN_TITLE = 'every answer of the scenario is exactly the recorded bytes';
  const golden = failed.some((r) => r.title === GOLDEN_TITLE) ? ['GOLDEN'] : [];
  const today = failed.filter((r) => !/RING-[A-Z]\d+/.test(r.title) && r.title !== GOLDEN_TITLE).length;
  return { ok: failed.length === 0 && run.status === 0, failedIds: [...ids, ...golden], failed: failed.length, today, total: results.length, note: '' };
}

function main(argv) {
  const root = process.cwd();
  const [command, only] = argv;
  if (command === 'list') {
    for (const mu of WORLD_TRAIL_MUTATIONS) process.stdout.write(`${mu.id}\t${mu.kills}\t${mu.file}\t${mu.invariant}\n`);
    return 0;
  }
  const chosen = command === 'only' ? WORLD_TRAIL_MUTATIONS.filter((mu) => mu.id === only) : WORLD_TRAIL_MUTATIONS;
  if (command !== undefined && command !== 'only') { process.stderr.write('usage: world-trail-mutations.mjs [list | only <id>]\n'); return 2; }
  if (chosen.length === 0) { process.stderr.write(`no mutant ${only}\n`); return 2; }

  const originals = new Map([WP, SC].map((f) => [f, readFileSync(join(root, f))]));
  // every anchor first: a moved anchor stops the run before anything is written
  for (const mu of chosen) applyWorldTrailMutation(mu, originals.get(mu.file).toString('utf8'));
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
        writeFileSync(join(root, mu.file), applyWorldTrailMutation(mu, originals.get(mu.file).toString('utf8')));
        const r = runTests(root, scratch, mu.id);
        const killed = r.failedIds.includes(mu.kills);
        if (!killed) allKilled = false;
        const todays = r.today > 0 ? `; +${r.today} of today's world tests` : '';
        process.stdout.write(`${mu.id} ${killed ? 'KILLED' : 'SURVIVED'} by ${mu.kills} (${r.failed} failing: ${r.failedIds.join(',') || 'none'}${todays}) -- ${mu.invariant}${r.note ? ` ${r.note}` : ''}\n`);
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
