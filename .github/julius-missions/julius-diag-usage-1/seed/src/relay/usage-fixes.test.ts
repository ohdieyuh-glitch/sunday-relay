import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveUsageThresholdEvents, EMPTY_USAGE_LATCH } from './usage/usage-thresholds.ts';
import { projectUsageBar } from './usage/usage-projection.ts';

/**
 * TWO LATENT DEFECTS IN RELAY'S USAGE MODULES — THE SPECIFICATION.
 *
 * Each module is real Relay code with a documented intent and a behaviour that does not match it. The tests pin the main behaviours of each fix; the acceptance
 * criteria in the contract state the wider invariants in words.
 *
 *   A. `deriveUsageThresholdEvents` (usage/usage-thresholds.ts). Its header says the latch is the memory of which thresholds already notified, that "the SAME key
 *      never notifies twice — refreshes and route changes cannot fabricate a crossing", and that only dropping back BELOW a threshold (or a new reset window) re-arms it.
 *      The code rebuilds the latch from scratch on every call and skips a section whose reading is unknown, so one refresh with an unknown reading silently re-arms
 *      every threshold of that section and the next ordinary refresh notifies the same crossing again.
 *   B. `projectUsageBar` (usage/usage-projection.ts). `tone` is documented as the "highest warning level currently visible in the snapshot", but a snapshot in which
 *      nothing the summary shows is known returns early with a hard-coded `idle`, even when the weekly window is known and fully used.
 */

const RESET = '2026-10-19T20:00:00.000Z';
const RESET_NEXT = '2026-10-20T01:00:00.000Z';
const CONTRACTS_RESET = '2026-11-01T00:00:00.000Z';

type Win = { percentUsed: number | null; resetAt: string | null; status: string };
const win = (percentUsed: number | null, over: Partial<Win> = {}): Win => ({ percentUsed, resetAt: RESET, status: percentUsed === null ? 'updating' : 'available', ...over });
const contracts = (remaining: number | null, over: Record<string, unknown> = {}) => ({
  used: null, limit: remaining === null ? null : 50, remaining, resetAt: CONTRACTS_RESET, status: remaining === null ? 'updating' : 'available', ...over,
});
const snapshot = (over: Record<string, unknown> = {}) => ({
  missionContracts: contracts(48), fiveHour: win(10), weekly: win(10), cubs: { active: null, concurrentLimit: null, weeklyUsed: null, weeklyLimit: null, resetAt: null, status: 'not_enabled' },
  provenance: 'live', ...over,
}) as never;
const derive = (snap: unknown, latch: unknown) => deriveUsageThresholdEvents(snap as never, latch as never) as { events: { key: string; section: string; kind: string }[]; latch: { keys: readonly string[] } };

/* ----------------------------------------------------------------------------------------------------------- A: the notification latch */

test('A: a crossing notifies once, and the same snapshot again does not (control: the ordinary behaviour is unchanged)', () => {
  const first = derive(snapshot({ fiveHour: win(92) }), EMPTY_USAGE_LATCH);
  assert.deepEqual(first.events.map((e) => [e.section, e.kind]), [['five_hour', 'warning']]);
  assert.deepEqual([...first.latch.keys], [`five_hour|70|${RESET}|live`, `five_hour|90|${RESET}|live`]);
  const again = derive(snapshot({ fiveHour: win(92) }), first.latch);
  assert.deepEqual(again.events, []);
});

test('A: one refresh in which the five-hour reading is UNKNOWN keeps its latch, so the next refresh does not notify the same crossing again', () => {
  const first = derive(snapshot({ fiveHour: win(92) }), EMPTY_USAGE_LATCH);
  const unknown = derive(snapshot({ fiveHour: win(null) }), first.latch);
  assert.deepEqual(unknown.events, []);
  assert.deepEqual([...unknown.latch.keys], [...first.latch.keys], 'an unknown reading leaves the five-hour keys exactly as they were');
  const back = derive(snapshot({ fiveHour: win(92) }), unknown.latch);
  assert.deepEqual(back.events, [], 'usage never dropped below 90% and the window did not change: nothing new to say');
});

test('A: the same holds for the weekly window and for the Mission Contract count', () => {
  const weekly = derive(snapshot({ weekly: win(95) }), EMPTY_USAGE_LATCH);
  const weeklyUnknown = derive(snapshot({ weekly: win(null) }), weekly.latch);
  assert.deepEqual(derive(snapshot({ weekly: win(95) }), weeklyUnknown.latch).events, []);

  const low = derive(snapshot({ missionContracts: contracts(1) }), EMPTY_USAGE_LATCH);
  assert.deepEqual(low.events.map((e) => [e.section, e.kind]), [['mission_contracts', 'warning']]);
  const lowUnknown = derive(snapshot({ missionContracts: contracts(null) }), low.latch);
  assert.deepEqual(derive(snapshot({ missionContracts: contracts(1) }), lowUnknown.latch).events, []);
});

test('A: a KNOWN reading below a threshold still re-arms it, and a new reset window starts clean (unchanged behaviour)', () => {
  const crossed = derive(snapshot({ fiveHour: win(92) }), EMPTY_USAGE_LATCH);
  const dropped = derive(snapshot({ fiveHour: win(60) }), crossed.latch);
  assert.deepEqual(dropped.events, []);
  assert.deepEqual([...dropped.latch.keys], [], 'a known 60% is below both thresholds: both keys are removed');
  const crossedAgain = derive(snapshot({ fiveHour: win(92) }), dropped.latch);
  assert.equal(crossedAgain.events.length, 1, 'crossing again after genuinely dropping may truthfully notify again');

  const nextWindow = derive(snapshot({ fiveHour: win(92, { resetAt: RESET_NEXT }) }), crossed.latch);
  assert.equal(nextWindow.events.length, 1, 'a different reset window changes every key');
  assert.deepEqual([...nextWindow.latch.keys], [`five_hour|70|${RESET_NEXT}|live`, `five_hour|90|${RESET_NEXT}|live`]);
});

test('A: an unknown section does not disturb the other sections (their keys are still added, kept or removed on their own readings)', () => {
  const both = derive(snapshot({ fiveHour: win(75), weekly: win(95) }), EMPTY_USAGE_LATCH);
  const mixed = derive(snapshot({ fiveHour: win(null), weekly: win(60) }), both.latch);
  assert.deepEqual([...mixed.latch.keys], [`five_hour|70|${RESET}|live`], 'five-hour kept (unknown); weekly removed (known and below both thresholds)');
});

/* -------------------------------------------------------------------------------------------------------------------------- B: the usage bar */

test('B: when only the weekly window is known and it is fully used, the bar says UNAVAILABLE but its tone is critical', () => {
  const bar = projectUsageBar(snapshot({ missionContracts: contracts(null, { status: 'unavailable' }), fiveHour: win(null, { status: 'unavailable' }), weekly: win(100) }));
  assert.equal(bar.summary, 'USAGE · UNAVAILABLE', 'the summary text is unchanged: the bar never prints the weekly figure');
  assert.equal(bar.tone, 'critical');
});

test('B: the early-return states still read right: weekly warning, nothing known, and the UPDATING word', () => {
  const warn = projectUsageBar(snapshot({ missionContracts: contracts(null), fiveHour: win(null), weekly: win(75) }));
  assert.equal(warn.tone, 'warning');
  const none = projectUsageBar(snapshot({ missionContracts: contracts(null, { status: 'unavailable' }), fiveHour: win(null, { status: 'unavailable' }), weekly: win(null, { status: 'unavailable' }) }));
  assert.equal(none.summary, 'USAGE · UNAVAILABLE');
  assert.equal(none.tone, 'idle');
  const updating = projectUsageBar(snapshot({ missionContracts: contracts(null), fiveHour: win(null), weekly: win(100) }));
  assert.equal(updating.summary, 'USAGE · UPDATING', 'a section that says it is updating makes the word UPDATING');
  assert.equal(updating.tone, 'critical');
});

test('B: the ordinary path is unchanged: the most severe of the three windows wins, and a simulated snapshot is always demo', () => {
  assert.equal(projectUsageBar(snapshot({ fiveHour: win(10), weekly: win(100) })).tone, 'critical');
  assert.equal(projectUsageBar(snapshot({ fiveHour: win(80), weekly: win(10) })).tone, 'warning');
  assert.equal(projectUsageBar(snapshot({ missionContracts: contracts(0), fiveHour: win(10) })).tone, 'critical');
  assert.equal(projectUsageBar(snapshot()).tone, 'idle');
  const demo = projectUsageBar(snapshot({ provenance: 'simulated', weekly: win(100) }));
  assert.equal(demo.tone, 'demo');
});
