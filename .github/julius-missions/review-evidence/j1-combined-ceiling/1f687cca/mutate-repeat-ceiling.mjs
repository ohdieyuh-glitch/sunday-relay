/**
 * DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance.
 *
 * Mutation check at code commit 1f687cca. Not an independent reviewer's harness.
 * Ceiling mutants M1-M13 are the same edits as the abf15cec harness. M8a is
 * still expected to SURVIVE because the running-sum check refuses the same
 * values. F1-float-ceil-division is expected to SURVIVE because, for every
 * safe integer, Math.ceil(t/10000) equals the integer ceiling. That is
 * equivalence, not a missing test.
 *
 * Usage (repo root): node .github/julius-missions/review-evidence/j1-combined-ceiling/1f687cca/mutate-repeat-ceiling.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CEILING = 'relay-bridge/julius-dispatch-repeat-ceiling.ts';
const CEILING_TEST = 'relay-bridge/julius-dispatch-repeat-ceiling.test.ts';
const XAI = 'relay-bridge/julius-xai-direct-reviewer.ts';
const XAI_TESTS = ['relay-bridge/julius-xai-direct-reviewer.test.ts', 'relay-bridge/julius-dispatch-adapters.test.ts'];

const INTEGER_CEIL = '  const q = t / 10_000n;\n  const r = t % 10_000n;\n  const micros = r > 0n ? q + 1n : q;';

const MUTANTS = [
  { id: 'M1-per-run-env-can-raise', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['perRunUsdMicros: Math.min(frozen.perRunUsdMicros, envPer)', 'perRunUsdMicros: Math.max(frozen.perRunUsdMicros, envPer)'],
  ] },
  { id: 'M2-combined-env-can-raise', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['combined = Math.min(frozen.combinedInitialRepeatUsdMicros, envCombined)', 'combined = Math.max(frozen.combinedInitialRepeatUsdMicros, envCombined)'],
  ] },
  { id: 'M3-worst-case-is-estimate-envelope', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['return input.perRunCapUsdMicros;', 'return envelope;'],
  ] },
  { id: 'M4-exact-per-run-refused', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (input.actualUsdMicros > input.perRunCapUsdMicros) return { admit: false, reason: 'run1_actual_above_per_run' };", "if (input.actualUsdMicros >= input.perRunCapUsdMicros) return { admit: false, reason: 'run1_actual_above_per_run' };"],
  ] },
  { id: 'M5-spend-unknown-count-ignored', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (prior.spendUnknownLegs > 0) return { verified: false, reason: 'unknown_spend' };", "if (prior.spendUnknownLegs > 99) return { verified: false, reason: 'unknown_spend' };"],
  ] },
  { id: 'M6-exact-combined-refused', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['if (input.actualUsdMicros + input.repeatWorstCaseUsdMicros > input.combinedCapUsdMicros)', 'if (input.actualUsdMicros + input.repeatWorstCaseUsdMicros >= input.combinedCapUsdMicros)'],
  ] },
  { id: 'M7-missing-cost-counts-as-zero', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (typeof leg.costUsdMicros !== 'number' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 'unknown_spend';", "if (typeof leg.costUsdMicros !== 'number' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 0;"],
  ] },
  { id: 'M8a-per-leg-safe-integer-removed', expect: 'survived', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (typeof leg.costUsdMicros !== 'number' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 'unknown_spend';", "if (typeof leg.costUsdMicros !== 'number' || leg.costUsdMicros < 0) return 'unknown_spend';"],
  ] },
  { id: 'M8b-both-safe-integer-checks-removed', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (typeof leg.costUsdMicros !== 'number' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 'unknown_spend';", "if (typeof leg.costUsdMicros !== 'number' || leg.costUsdMicros < 0) return 'unknown_spend';"],
    ["    if (!Number.isSafeInteger(sum)) return { verified: false, reason: 'unknown_spend' };\n", ''],
  ] },
  { id: 'M9-zero-role-count-still-bounds', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['if (!Number.isSafeInteger(input.roleCount) || input.roleCount <= 0) return null;', 'if (!Number.isSafeInteger(input.roleCount) || input.roleCount < 0) return null;'],
  ] },
  { id: 'M10-not-contacted-null-is-unknown', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ['if (leg.costUsdMicros === null || leg.costUsdMicros === 0) return 0;', 'if (leg.costUsdMicros === 0) return 0;'],
  ] },
  { id: 'M11-sealed-check-removed', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (!prior.sealed || prior.orderOk !== true) return { verified: false, reason: 'missing_receipt' };", "if (prior.orderOk !== true) return { verified: false, reason: 'missing_receipt' };"],
  ] },
  { id: 'M12-second-prior-run-allowed', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (starts.length > 1) return { kind: 'repeat_already_used' };", "if (starts.length > 2) return { kind: 'repeat_already_used' };"],
  ] },
  { id: 'M13-other-mission-uses-frozen-ceiling', expect: 'killed', file: CEILING, tests: [CEILING_TEST], edits: [
    ["if (missionId !== J1_INWORLD_DATA_1_MISSION_ID) return { applicable: false };", "if (missionId === 'never') return { applicable: false };"],
  ] },
  { id: 'F1-success-omits-tick-receipt', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['verdict, shownSha256, ...costFields };', 'verdict, shownSha256 };'],
  ] },
  { id: 'F1-missing-ticks-become-zero', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['|| ticks < 0) return null;', '|| ticks < 0) return { costUsdMicros: 0, costUsdTicksRaw: 0 };'],
  ] },
  { id: 'F1-cost-taken-from-input-tokens', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['const receipt = costUsdMicrosFromXaiTicks(usageRaw.cost_in_usd_ticks);', 'const receipt = inTok === null ? null : { costUsdMicros: inTok, costUsdTicksRaw: inTok };'],
  ] },
  { id: 'F1-ceil-becomes-floor', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['const micros = r > 0n ? q + 1n : q;', 'const micros = q;'],
  ] },
  { id: 'F1-ceil-becomes-round', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['const micros = r > 0n ? q + 1n : q;', 'const micros = BigInt(Math.round(Number(t) / 10_000));'],
  ] },
  { id: 'F1-remainder-check-dropped', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['const micros = r > 0n ? q + 1n : q;', 'const micros = q + 1n;'],
  ] },
  { id: 'F1-float-ceil-division', expect: 'survived', file: XAI, tests: XAI_TESTS, edits: [
    [INTEGER_CEIL, '  const micros = BigInt(Math.ceil(Number(t) / 10_000));'],
  ] },
  { id: 'F1-drop-raw-ticks', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['return { costUsdMicros: Number(micros), costUsdTicksRaw: ticks };', 'return { costUsdMicros: Number(micros) };'],
  ] },
  { id: 'F1-accept-negative', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['|| !Number.isSafeInteger(ticks) || ticks < 0) return null;', '|| !Number.isSafeInteger(ticks)) return null;'],
  ] },
  { id: 'F1-accept-non-integer', expect: 'killed', file: XAI, tests: XAI_TESTS, edits: [
    ['|| !Number.isSafeInteger(ticks) || ticks < 0) return null;', '|| ticks < 0) return null;'],
  ] },
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const originals = new Map();
for (const file of [CEILING, XAI]) originals.set(file, readFileSync(file, 'utf8'));

function restore() {
  for (const [file, text] of originals) {
    writeFileSync(file, text);
    const now = sha256(readFileSync(file, 'utf8'));
    if (now !== sha256(text)) {
      process.stderr.write(`restore failed for ${file}\n`);
      process.exit(2);
    }
  }
}

let matched = 0;
try {
  for (const mutant of MUTANTS) {
    const original = originals.get(mutant.file);
    let next = original;
    for (const [from, to] of mutant.edits) {
      const hits = next.split(from).length - 1;
      if (hits !== 1) {
        process.stdout.write(`ANCHOR ${mutant.id}: expected 1 occurrence, found ${hits}\n`);
        process.exit(2);
      }
      next = next.replace(from, to);
    }
    writeFileSync(mutant.file, next);
    const run = spawnSync('npx', ['vitest', 'run', ...mutant.tests, '--reporter=verbose'], { encoding: 'utf8' });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const exit = run.status ?? 1;
    const actual = exit !== 0 ? 'killed' : 'survived';
    const ok = actual === mutant.expect;
    if (ok) matched += 1;
    process.stdout.write(`\n===== ${mutant.id} expect=${mutant.expect} actual=${actual} exit=${exit} ${ok ? 'OK' : 'MISMATCH'} =====\n`);
    process.stdout.write(out);
    if (!out.endsWith('\n')) process.stdout.write('\n');
    restore();
  }
} finally {
  restore();
}

process.stdout.write(`\nMUTANTS ${matched}/${MUTANTS.length} MATCHED EXPECTATION\n`);
for (const [file, text] of originals) process.stdout.write(`SOURCE ${file} sha256 ${sha256(text)}\n`);
process.exit(matched === MUTANTS.length ? 0 : 1);
