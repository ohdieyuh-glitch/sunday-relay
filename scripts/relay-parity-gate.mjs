#!/usr/bin/env node
/**
 * RELAY PARITY GATE — makes the website/CLI parity requirement unskippable.
 *
 * Why this exists. The repository-separation CI guarded parity with
 * `if [ -f scripts/relay-surface-parity.mjs ]`, which was honest while the
 * registry was deliberately preserved on another branch — the log said
 * "skipping" — but it is the wrong shape for the integrated product: a check
 * whose guard is the presence of its own input can be switched off by
 * deleting one file, and the step still renders green. Governance §7 calls
 * parity "a requirement, not an aspiration", so the requirement must fail
 * loudly when its machinery is incomplete rather than quietly disappear.
 *
 * This gate runs BEFORE the parity commands and asserts the four states the
 * integration prompt names:
 *
 *   registry present + script present   -> PASS (parity then runs for real)
 *   registry present + script missing   -> FAIL
 *   script present   + registry missing -> FAIL
 *   neither present                     -> FAIL on the integrated product;
 *                                          tolerated ONLY on a historical
 *                                          baseline commit that predates the
 *                                          parity registry, and even then it
 *                                          is reported as a SKIP with the
 *                                          reason, never as a capability pass.
 *
 * Reads only. No network, no provider, no deployment.
 * Exit 0 = the parity requirement is enforceable, exit 1 = it is not.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const has = (p) => existsSync(resolve(root, p));

const REGISTRY = 'src/relay/parity/relay-surface-capabilities.json';
const CHECKER = 'scripts/relay-surface-parity.mjs';

/**
 * The scripts must not merely EXIST — each must actually invoke the checker,
 * and the strict one must actually pass `--strict`. A script named
 * `relay:surface-parity:check` whose body is `echo ok` satisfies a
 * presence-only test while comparing nothing: the same shape of hole as the
 * `if [ -f … ]` guard this gate replaced.
 */
const REQUIRED_SCRIPTS = [
  { name: 'relay:surface-parity:check', mustContain: ['relay-surface-parity.mjs'] },
  { name: 'relay:surface-parity:check:strict', mustContain: ['relay-surface-parity.mjs', '--strict'] },
];

/**
 * A tree is "the integrated product" once ANY Relay source is present. The
 * historical-baseline skip is deliberately narrow: it applies only to a commit
 * that carries no `src/relay` at all. Keying it on two specific subdirectories
 * would let a rename quietly re-open the skip.
 */
const INTEGRATED_MARKERS = ['src/relay'];

const problems = [];
const note = (line) => console.log(`  ${line}`);

console.log('RELAY PARITY GATE');

const registryPresent = has(REGISTRY);
const checkerPresent = has(CHECKER);

let scripts = {};
try {
  scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {};
} catch {
  problems.push('package.json is missing or unreadable — cannot verify the parity scripts');
}

/** A script is present only if it exists AND genuinely runs the checker. */
const scriptProblems = [];
for (const { name, mustContain } of REQUIRED_SCRIPTS) {
  const body = scripts[name];
  if (typeof body !== 'string' || body.trim() === '') {
    scriptProblems.push(`${name} is missing`);
    continue;
  }
  for (const token of mustContain) {
    if (!body.includes(token)) {
      scriptProblems.push(`${name} does not invoke ${token} (it runs: ${body})`);
    }
  }
}
const scriptsPresent = scriptProblems.length === 0;

note(`registry: ${registryPresent ? REGISTRY : 'ABSENT'}`);
note(`checker:  ${checkerPresent ? CHECKER : 'ABSENT'}`);
note(`scripts:  ${scriptsPresent
  ? REQUIRED_SCRIPTS.map((s) => s.name).join(', ')
  : `UNUSABLE — ${scriptProblems.join('; ')}`}`);

const integrated = INTEGRATED_MARKERS.every((marker) => has(marker));

if (registryPresent && !(checkerPresent && scriptsPresent)) {
  problems.push(
    `the parity registry exists but its machinery does not: ${!checkerPresent ? `${CHECKER} is missing` : ''}`
    + `${!checkerPresent && !scriptsPresent ? ' and ' : ''}`
    + `${!scriptsPresent ? `npm script(s) unusable: ${scriptProblems.join('; ')}` : ''}`
    + ' — a declared capability registry that nothing verifies is exactly the drift parity exists to catch',
  );
}

if ((checkerPresent || scriptsPresent) && !registryPresent) {
  problems.push(
    `the parity checker/scripts exist but ${REGISTRY} does not — the check would have nothing to verify `
    + 'and would report green having compared nothing',
  );
}

if (!registryPresent && !checkerPresent && !scriptsPresent) {
  if (integrated) {
    problems.push(
      `this tree contains Relay source (${INTEGRATED_MARKERS.join(', ')}) but no parity registry, `
      + 'checker or scripts — parity cannot be skipped on the integrated product (governance §7)',
    );
  } else {
    // A historical baseline commit from before the registry landed. Say so
    // explicitly; never let it read as a capability result.
    note('SKIP — historical baseline commit: no Relay source, no parity registry.');
    note('       This is NOT a parity pass. No capability was compared.');
    process.exit(0);
  }
}

if (problems.length > 0) {
  console.error('RELAY PARITY GATE: FAIL');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nParity is a requirement, not an aspiration (docs/REPOSITORY_GOVERNANCE.md §7).');
  process.exit(1);
}

console.log('RELAY PARITY GATE: PASS');
console.log('  registry and checker present; both npm scripts genuinely invoke the checker');
console.log('  (and the strict script genuinely passes --strict) — parity runs for real below.');
process.exit(0);
