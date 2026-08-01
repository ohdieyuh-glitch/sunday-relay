/**
 * A FAKE HERMES EXECUTABLE — a real program, not a stubbed function.
 *
 * It is written to disk and spawned by the ACTUAL runner, so the tests exercise
 * argv construction, the isolated environment, process-group termination, the
 * output cap, the usage file and the parser. Mocking the adapter itself would
 * leave exactly those things unproven, which is where process integrations
 * break.
 *
 * It makes no network request of any kind, so the suite can never contact xAI.
 */

import { chmodSync, writeFileSync } from 'node:fs';

export type FakeHermesScenario =
  | 'clean'            // valid JSON review, zero findings
  | 'with_findings'    // valid JSON review with a blocking finding
  | 'malformed'        // parseable process, unparseable review
  | 'hang'             // never exits — proves the timeout and tree kill
  | 'crash'            // non-zero exit
  | 'echo_env'         // prints the env it received — proves the allowlist
  | 'echo_argv'        // prints argv — proves no credential is passed there
  | 'flood';           // more stdout than the cap allows

/**
 * Emits a Node script. Node is already the test runtime, so this needs no
 * shell and behaves identically across platforms the suite runs on.
 */
export function fakeHermesSource(scenario: FakeHermesScenario): string {
  return `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const argv = process.argv.slice(2);
const scenario = ${JSON.stringify(scenario)};

function usageIndex() {
  const i = argv.indexOf('--usage-file');
  return i === -1 ? null : argv[i + 1];
}
function writeUsage(model) {
  const p = usageIndex();
  if (!p) return;
  try {
    fs.writeFileSync(p, JSON.stringify({
      input_tokens: 1200, output_tokens: 340, total_tokens: 1540,
      model: model, api_calls: 1, estimated_cost: 0.0042,
    }));
  } catch (e) { /* the runner treats a missing usage file as Unknown */ }
}
function modelArg() {
  const i = argv.indexOf('-m');
  return i === -1 ? null : argv[i + 1];
}

if (scenario === 'echo_argv') { process.stdout.write(JSON.stringify(argv)); process.exit(0); }
if (scenario === 'echo_env') { process.stdout.write(JSON.stringify(process.env)); process.exit(0); }
if (scenario === 'hang') { setInterval(() => {}, 1000); return; }
if (scenario === 'crash') { writeUsage(modelArg()); process.stderr.write('boom'); process.exit(3); }
if (scenario === 'flood') {
  writeUsage(modelArg());
  const chunk = 'x'.repeat(4096);
  for (let i = 0; i < 512; i += 1) process.stdout.write(chunk);
  process.exit(0);
}
if (scenario === 'malformed') {
  writeUsage(modelArg());
  process.stdout.write('I reviewed it and it looks fine to me.');
  process.exit(0);
}

const findings = scenario === 'with_findings' ? [{
  findingId: 'F-1', severity: 'blocking', requirement: 'AC-1',
  file: 'src/example.ts', line: 12,
  explanation: 'The guard is inverted so the error path never runs.',
  evidence: 'src/example.ts:12',
  recommendedAction: 'Invert the condition and add a regression test.',
}] : [];

writeUsage(modelArg());
process.stdout.write(JSON.stringify({
  verdict: scenario === 'with_findings' ? 'changes_required' : 'approved',
  summary: scenario === 'with_findings'
    ? 'One blocking defect in the changed guard.'
    : 'The change satisfies every stated acceptance criterion.',
  findings: findings,
  requirementsChecked: [
    { requirement: 'AC-1', status: scenario === 'with_findings' ? 'failed' : 'passed', evidence: 'reviewed diff' },
  ],
}));
process.exit(0);
`;
}

/** Writes the fake and marks it executable. Returns its path. */
export function writeFakeHermes(path: string, scenario: FakeHermesScenario): string {
  writeFileSync(path, fakeHermesSource(scenario), { encoding: 'utf8', mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

/** A `--version` / `--help` / `acp --check` responder for discovery tests. */
export function fakeHermesProbeSource(input: {
  version: string;
  flags: readonly string[];
  acpOk: boolean;
}): string {
  return `#!/usr/bin/env node
'use strict';
const argv = process.argv.slice(2);
const VERSION = ${JSON.stringify(input.version)};
const FLAGS = ${JSON.stringify(input.flags)};
if (argv[0] === '--version') {
  process.stdout.write('Hermes Agent v' + VERSION + ' (2026.7.7.2) \\u00b7 upstream abc \\u00b7 local def');
  process.exit(0);
}
if (argv[0] === '--help') {
  process.stdout.write('usage: hermes ' + FLAGS.join(' ') + '\\n');
  process.exit(0);
}
if (argv[0] === 'acp' && argv[1] === '--check') {
  ${input.acpOk ? "process.stdout.write('Hermes ACP check OK'); process.exit(0);" : "process.stderr.write('missing deps'); process.exit(1);"}
}
process.exit(0);
`;
}

export function writeFakeHermesProbe(
  path: string,
  input: { version: string; flags: readonly string[]; acpOk: boolean },
): string {
  writeFileSync(path, fakeHermesProbeSource(input), { encoding: 'utf8', mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}
