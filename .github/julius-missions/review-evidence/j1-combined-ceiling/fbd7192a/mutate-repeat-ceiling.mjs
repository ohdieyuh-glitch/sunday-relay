/**
 * DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance.
 *
 * Ad hoc mutation check for relay-bridge/julius-dispatch-repeat-ceiling.ts.
 * This is NOT a reconstruction of an independent reviewer's original harness.
 * That harness was not in the tree at fbd7192a and is not reproduced here as
 * if it were. Ten mutants below are ones the tests at fbd7192a already kill.
 * M5, M8 and M11 match the three reviewer checks that had no killing test at
 * that commit; this script expects them to SURVIVE there. A later evidence
 * run, after those tests exist, expects M5, M8 and M11 to be KILLED.
 *
 * Each mutant is one textual edit. The source file is restored and its sha256
 * checked before exit.
 *
 * Usage (repo root): node .github/julius-missions/review-evidence/j1-combined-ceiling/fbd7192a/mutate-repeat-ceiling.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SOURCE = 'relay-bridge/julius-dispatch-repeat-ceiling.ts';
const TESTS = 'relay-bridge/julius-dispatch-repeat-ceiling.test.ts';

const MUTANTS = [
  {
    id: 'M1-per-run-env-can-raise',
    expect: 'killed',
    from: 'perRunUsdMicros: Math.min(frozen.perRunUsdMicros, envPer)',
    to: 'perRunUsdMicros: Math.max(frozen.perRunUsdMicros, envPer)',
  },
  {
    id: 'M2-combined-env-can-raise',
    expect: 'killed',
    from: 'combined = Math.min(frozen.combinedInitialRepeatUsdMicros, envCombined)',
    to: 'combined = Math.max(frozen.combinedInitialRepeatUsdMicros, envCombined)',
  },
  {
    id: 'M3-worst-case-is-estimate-envelope',
    expect: 'killed',
    from: 'return input.perRunCapUsdMicros;',
    to: 'return envelope;',
  },
  {
    id: 'M4-exact-per-run-refused',
    expect: 'killed',
    from: 'if (input.actualUsdMicros > input.perRunCapUsdMicros) return { admit: false, reason: \'run1_actual_above_per_run\' };',
    to: 'if (input.actualUsdMicros >= input.perRunCapUsdMicros) return { admit: false, reason: \'run1_actual_above_per_run\' };',
  },
  {
    id: 'M5-spend-unknown-count-ignored',
    expect: 'survived',
    from: 'if (prior.spendUnknownLegs > 0) return { verified: false, reason: \'unknown_spend\' };',
    to: 'if (prior.spendUnknownLegs > 99) return { verified: false, reason: \'unknown_spend\' };',
  },
  {
    id: 'M6-exact-combined-refused',
    expect: 'killed',
    from: 'if (input.actualUsdMicros + input.repeatWorstCaseUsdMicros > input.combinedCapUsdMicros)',
    to: 'if (input.actualUsdMicros + input.repeatWorstCaseUsdMicros >= input.combinedCapUsdMicros)',
  },
  {
    id: 'M7-missing-cost-counts-as-zero',
    expect: 'killed',
    from: 'if (typeof leg.costUsdMicros !== \'number\' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return \'unknown_spend\';',
    to: 'if (typeof leg.costUsdMicros !== \'number\' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 0;',
  },
  {
    id: 'M8-cost-safe-integer-check-removed',
    expect: 'survived',
    from: 'if (typeof leg.costUsdMicros !== \'number\' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return \'unknown_spend\';',
    to: 'if (typeof leg.costUsdMicros !== \'number\' || leg.costUsdMicros < 0) return \'unknown_spend\';',
  },
  {
    id: 'M9-zero-role-count-still-bounds',
    expect: 'killed',
    from: 'if (!Number.isSafeInteger(input.roleCount) || input.roleCount <= 0) return null;',
    to: 'if (!Number.isSafeInteger(input.roleCount) || input.roleCount < 0) return null;',
  },
  {
    id: 'M10-not-contacted-null-is-unknown',
    expect: 'killed',
    from: 'if (leg.costUsdMicros === null || leg.costUsdMicros === 0) return 0;',
    to: 'if (leg.costUsdMicros === 0) return 0;',
  },
  {
    id: 'M11-sealed-check-removed',
    expect: 'survived',
    from: 'if (!prior.sealed || prior.orderOk !== true) return { verified: false, reason: \'missing_receipt\' };',
    to: 'if (prior.orderOk !== true) return { verified: false, reason: \'missing_receipt\' };',
  },
  {
    id: 'M12-second-prior-run-allowed',
    expect: 'killed',
    from: 'if (starts.length > 1) return { kind: \'repeat_already_used\' };',
    to: 'if (starts.length > 2) return { kind: \'repeat_already_used\' };',
  },
  {
    id: 'M13-other-mission-uses-frozen-ceiling',
    expect: 'killed',
    from: 'if (missionId !== J1_INWORLD_DATA_1_MISSION_ID) return { applicable: false };',
    to: 'if (missionId === \'never\') return { applicable: false };',
  },
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const original = readFileSync(SOURCE, 'utf8');
const originalSha = sha256(original);

function restore() {
  writeFileSync(SOURCE, original);
  const now = sha256(readFileSync(SOURCE, 'utf8'));
  if (now !== originalSha) {
    process.stderr.write(`restore failed: sha256 ${now} !== ${originalSha}\n`);
    process.exit(2);
  }
}

let matched = 0;
try {
  for (const mutant of MUTANTS) {
    const hits = original.split(mutant.from).length - 1;
    if (hits !== 1) {
      process.stdout.write(`ANCHOR ${mutant.id}: expected 1 occurrence, found ${hits}\n`);
      process.exit(2);
    }
    writeFileSync(SOURCE, original.replace(mutant.from, mutant.to));
    const run = spawnSync(
      'npx',
      ['vitest', 'run', TESTS, '--reporter=verbose'],
      { encoding: 'utf8' },
    );
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
process.stdout.write(`SOURCE sha256 ${originalSha}\n`);
process.exit(matched === MUTANTS.length ? 0 : 1);
