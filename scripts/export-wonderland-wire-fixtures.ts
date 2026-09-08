/**
 * CANONICAL WIRE FIXTURES, PRODUCED BY THE SERVER AND DRIVEN THROUGH THE CLIENT.
 *
 * The decoder is written against a contract. A contract is a description, and a
 * description can be right about a shape nobody actually sends. These fixtures
 * are the shape that is actually sent: every payload below is produced by
 * calling the REAL `wonderlandEnvelope()` and serialising it exactly as the
 * bridge does — `JSON.stringify` over the frozen object — so what the C++ reads
 * is what a world would receive.
 *
 * THE REFUSAL CASES ARE PRODUCED THE SAME WAY and then damaged, one field at a
 * time. That matters: a hand-typed broken payload can be broken in a way the
 * real serialiser could never produce, and then the decoder is being held to a
 * standard the wire does not set.
 *
 * `<name>\\t<expect>\\t<json>` per line, where `expect` is `ok` or the decoder's
 * own refusal name. TSV rather than JSON because every field is a scalar and a
 * JSON file of JSON strings is one escaping layer nobody needs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { wonderlandEnvelope } from '../src/relay/mission/wonderland/wonderland-envelope';
import { JULIUS_VISUAL_STATES } from '../src/relay/mission/wonderland/wonderland-julius-state';
import { WONDERLAND_WORKER_ROLES } from '../src/relay/mission/wonderland/wonderland-envelope';

const AT = '2026-09-08T00:00:00.000Z';

/** A real envelope, from the real constructor. Never a hand-built object. */
const envelope = (over: Partial<Parameters<typeof wonderlandEnvelope>[0]> = {}) =>
  wonderlandEnvelope({
    eventId: 'evt-1',
    projectId: 'project-alpha',
    juliusInstanceId: 'julius-1',
    runId: 'run-1',
    state: 'coding',
    stateSource: 'julius_run_state',
    sequence: 42,
    revision: 7,
    occurredAt: AT,
    ...over,
  });

interface Fixture {
  readonly name: string;
  readonly expect: string;
  readonly json: string;
}

const cases: Fixture[] = [];
const ok = (name: string, value: unknown) =>
  cases.push({ name, expect: 'ok', json: JSON.stringify(value) });
const refused = (name: string, expect: string, value: unknown) =>
  cases.push({ name, expect, json: JSON.stringify(value) });

/* ---------------------------------------------------- what Relay sends */

ok('normal-active', envelope());
ok('terminal-complete', envelope({ state: 'complete', terminal: true, sourceState: 'COMPLETED' }));
ok('terminal-blocked', envelope({ state: 'blocked', sourceState: 'BLOCKED' }));
ok('terminal-error', envelope({ state: 'error', terminal: true, sourceState: 'FAILED' }));
ok('every-nullable-absent', envelope({
  juliusInstanceId: null, runId: null, missionId: null, taskId: null,
  worldSessionId: null, workerRole: null, sourceState: null,
}));
ok('every-nullable-present', envelope({
  juliusInstanceId: 'julius-1', runId: 'run-1', missionId: 'mission-1', taskId: 'task-1',
  worldSessionId: 'world-1', workerRole: 'CODING_AGENT', sourceState: 'EXECUTING',
}));
ok('sequence-zero', envelope({ sequence: 0, revision: 0 }));
ok('largest-exact-integer', envelope({ sequence: 9007199254740991, revision: 9007199254740991 }));
ok('empty-string-run-id', envelope({ runId: '' }));
ok('metadata-scalars', envelope({ metadata: { attempt: 2, ok: true, note: 'x', gone: null } }));
ok('metadata-dropped', envelope({ metadata: { apiKey: 'sk-not-a-real-key', kept: 1 } }));

// EVERY visual state and EVERY worker role, so no member of either vocabulary
// can be added on one side without the other refusing it.
for (const state of JULIUS_VISUAL_STATES) {
  ok(`state-${state}`, envelope({ state }));
}
for (const role of WONDERLAND_WORKER_ROLES) {
  ok(`role-${role}`, envelope({ workerRole: role }));
}

/* ------------------------------------ what a damaged frame looks like */

// Produced by the real constructor, then broken — so the decoder is held to
// what the wire can actually carry rather than to something hand-typed.
const damage = (over: Record<string, unknown>) => ({ ...envelope(), ...over });
const without = (key: string) => {
  const copy: Record<string, unknown> = { ...envelope() };
  delete copy[key];
  return copy;
};

refused('unknown-state-token', 'unknown_token', damage({ state: 'ascended' }));
refused('pascal-case-state', 'unknown_token', damage({ state: 'IndependentReview' }));
refused('kernel-word-as-state', 'unknown_token', damage({ state: 'EXECUTING' }));
refused('unknown-worker-role', 'unknown_token', damage({ workerRole: 'ARCHITECT' }));
refused('unknown-state-source', 'unknown_token', damage({ stateSource: 'guessed' }));
refused('blank-project', 'identity_rejected', damage({ projectId: '' }));
refused('whitespace-project', 'identity_rejected', damage({ projectId: '   ' }));
refused('blank-event-id', 'identity_rejected', damage({ eventId: '' }));
refused('null-project', 'wrong_type', damage({ projectId: null }));
refused('numeric-state', 'wrong_type', damage({ state: 3 }));
refused('stringly-sequence', 'wrong_type', damage({ sequence: '42' }));
refused('stringly-terminal', 'wrong_type', damage({ terminal: 'false' }));
refused('fractional-sequence', 'number_not_integer', damage({ sequence: 1.5 }));
refused('negative-sequence', 'number_out_of_range', damage({ sequence: -1 }));
refused('negative-revision', 'number_out_of_range', damage({ revision: -1 }));
refused('missing-run-id', 'missing_field', without('runId'));
refused('missing-state', 'missing_field', without('state'));
refused('missing-metadata', 'missing_field', without('metadata'));
refused('nested-metadata', 'wrong_type', damage({ metadata: { nested: { a: 1 } } }));
refused('array-metadata', 'wrong_type', damage({ metadata: { list: [1, 2] } }));

/* --------------------------------------------------------- the writing */

/**
 * COMMITTED, beside the harness that reads it, not in `generated/` — that
 * directory is gitignored, so a fresh checkout would find no fixtures and the
 * harness would report success over an empty file. The ordering case table
 * lives in the source tree for the same reason.
 */
export const WONDERLAND_WIRE_FIXTURES_PATH = join('wonderland', 'Tools', 'WireHarness', 'fixtures.tsv');

/** The file, rendered. Exported so a test compares the same bytes. */
export function renderWonderlandWireFixtures(): string {
  // A tab or a newline inside a payload would break the format silently, so it
  // is refused loudly instead. `JSON.stringify` escapes both, but a fixture
  // added later could carry a raw one.
  for (const item of cases) {
    if (item.json.includes('\t') || item.json.includes('\n')) {
      throw new Error(`export-wonderland-wire-fixtures: ${item.name} contains a raw tab or newline.`);
    }
  }
  return `${cases.map((c) => `${c.name}\t${c.expect}\t${c.json}`).join('\n')}\n`;
}

function main(): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'src', 'relay', 'mission', 'wonderland'))) {
    console.error('export-wonderland-wire-fixtures: run from the repository root.');
    process.exit(1);
  }
  const path = join(root, WONDERLAND_WIRE_FIXTURES_PATH);
  const body = renderWonderlandWireFixtures();

  if (process.argv.includes('--check')) {
    const onDisk = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (onDisk !== body) {
      console.error(
        'export-wonderland-wire-fixtures --check: the fixtures are stale.\n' +
          'The envelope shape or a vocabulary moved without a re-export. Run:\n' +
          '  npm run wonderland:wire:fixtures\n' +
          'READ THE DIFF — it is a change to what a client must decode.',
      );
      process.exit(1);
    }
    console.log(`wonderland wire fixtures current (${cases.length} cases)`);
    return;
  }

  writeFileSync(path, body);
  const accepted = cases.filter((c) => c.expect === 'ok').length;
  console.log(
    `wonderland wire fixtures -> ${cases.length} cases (${accepted} accepted, ${cases.length - accepted} refused)`,
  );
}

if (process.argv[1]?.includes('export-wonderland-wire-fixtures')) main();
