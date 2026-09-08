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
import {
  JULIUS_ACTIVITY_SIGNALS,
  emptyJuliusActivity,
  wonderlandJuliusActivity,
} from '../src/relay/mission/wonderland/wonderland-julius-activity';
import { wonderlandUsageHudFixture } from '../src/relay/mission/wonderland/wonderland-usage-meter';
import { RELAY_UNKNOWN_REASONS } from '../src/relay/shared/llmops';
import {
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from '../src/relay/mission/wonderland/wonderland-usage-authority';

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
/**
 * Deliveries are a SECOND file: the C++ reads them with a different entry point,
 * and mixing the two would mean the harness had to guess which decoder each line
 * wanted. Same format, same freshness rule.
 */
const deliveries: Fixture[] = [];
/** The usage HUD, read by `UWonderlandUsageSubsystem::ApplyUsage`. */
const usages: Fixture[] = [];
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

/* ---------------------------------------------- what an SSE frame carries */

// The bridge writes `data: {"envelope":…,"activity":…}` — a WonderlandDelivery.
// These are that shape, built from the real activity fold rather than a
// hand-written object, so the client is held to what the server sends.
const activity = (over: Partial<ReturnType<typeof emptyJuliusActivity>> = {}) => ({
  ...emptyJuliusActivity({ projectId: 'project-alpha', runId: 'run-1' }),
  ...over,
});

const delivery = (
  env: ReturnType<typeof wonderlandEnvelope> = envelope(),
  act: ReturnType<typeof emptyJuliusActivity> = activity(),
) => ({ envelope: env, activity: act });

deliveries.push({ name: 'delivery-quiet', expect: 'ok', json: JSON.stringify(delivery()) });
deliveries.push({
  name: 'delivery-every-signal',
  expect: 'ok',
  json: JSON.stringify(delivery(envelope(), activity({
    signals: [...JULIUS_ACTIVITY_SIGNALS],
    workers: [{ workerId: 'worker-1', signals: [...JULIUS_ACTIVITY_SIGNALS] }],
    activeSubagents: 3,
    subagentsDenied: 1,
    observedAtIso: AT,
    unusedEvents: 2,
  }))),
});
// The fold, run for real over real events, rather than a shape typed by hand.
deliveries.push({
  name: 'delivery-real-fold',
  expect: 'ok',
  json: JSON.stringify(delivery(envelope({ state: 'blocked' }), wonderlandJuliusActivity(
    emptyJuliusActivity({ projectId: 'project-alpha', runId: 'run-1' }),
    [{
      schemaVersion: 'relay-julius-event.v1', eventId: 'e1', projectId: 'project-alpha',
      runId: 'run-1', taskId: 'task-1', workerId: 'worker-1', type: 'approval.requested',
      occurredAt: AT, facts: {},
    } as never],
  ))),
});

// A delivery whose halves disagree about whose run it is. Nothing downstream
// compares them — every later check reads the envelope alone — so if this one
// crossed, one run's signals would land on another's world.
deliveries.push({
  name: 'delivery-foreign-activity-project',
  expect: 'identity_rejected',
  json: JSON.stringify(delivery(envelope(), activity({ projectId: 'project-beta' } as never))),
});
deliveries.push({
  name: 'delivery-foreign-activity-run',
  expect: 'identity_rejected',
  json: JSON.stringify(delivery(envelope(), activity({ runId: 'run-9' } as never))),
});
deliveries.push({
  name: 'delivery-unknown-signal',
  expect: 'unknown_token',
  json: JSON.stringify(delivery(envelope(), activity({ signals: ['transcending'] } as never))),
});
deliveries.push({
  name: 'delivery-negative-subagents',
  expect: 'number_out_of_range',
  json: JSON.stringify(delivery(envelope(), activity({ activeSubagents: -1 } as never))),
});
deliveries.push({
  name: 'delivery-missing-activity',
  expect: 'missing_field',
  json: JSON.stringify({ envelope: envelope() }),
});
deliveries.push({
  name: 'delivery-missing-envelope',
  expect: 'missing_field',
  json: JSON.stringify({ activity: activity() }),
});
deliveries.push({
  name: 'delivery-broken-envelope',
  expect: 'unknown_token',
  json: JSON.stringify({ envelope: { ...envelope(), state: 'ascended' }, activity: activity() }),
});

/* --------------------------------------------- what the usage HUD carries */

// UNKNOWN IS THE PRODUCTION READING TODAY: no authority reports into the usage
// contract, so this is what a world actually draws — two tracks and no
// remainder. It is the most important case, not the degenerate one.
const unknownHud = projectWonderlandUsageFromAuthority(
  emptyWonderlandUsageAuthority({ projectId: 'project-alpha' }), AT).hud;
usages.push({ name: 'usage-all-unknown', expect: 'ok', json: JSON.stringify(unknownHud) });

// And a fully-reported one, from the fixture the geometry harness already
// measures, so the decoder and the sampler agree about the same numbers.
const knownHud = wonderlandUsageHudFixture(AT);
usages.push({ name: 'usage-known', expect: 'ok', json: JSON.stringify(knownHud) });

// THE SWAP. Two real meters, exchanged. Every figure is genuine and every one
// is attributed to the wrong instrument — the green Compound arc would draw the
// single agent's spend. Nothing about the numbers looks wrong.
usages.push({
  name: 'usage-swapped-channels',
  expect: 'identity_rejected',
  json: JSON.stringify({
    ...knownHud, compoundAgent: knownHud.singleAgent, singleAgent: knownHud.compoundAgent,
  }),
});

// A figure that claims to be known and carries nothing. This is the shape a
// partly-written report has, and accepting it draws 0.0 as a measurement.
// ONE meter mislabelled, not both. A full swap is caught by either check, so
// with only that fixture each one can be deleted while the other still refuses
// — and a single mislabelled arc is the likelier bug anyway.
usages.push({
  name: 'usage-compound-slot-holds-single',
  expect: 'identity_rejected',
  json: JSON.stringify({ ...knownHud, compoundAgent: knownHud.singleAgent }),
});
usages.push({
  name: 'usage-single-slot-holds-compound',
  expect: 'identity_rejected',
  json: JSON.stringify({ ...knownHud, singleAgent: knownHud.compoundAgent }),
});
// EVERY reason, on a figure that is genuinely absent. `not_observed` is the
// ZERO member, so a fixture carrying only that one cannot tell a decoder that
// reads the reason from one that hardcodes the default — and "not reported"
// and "stale" are different facts about the same missing number.
for (const reason of RELAY_UNKNOWN_REASONS) {
  usages.push({
    name: `usage-reason-${reason}`,
    expect: 'ok',
    json: JSON.stringify({
      ...unknownHud,
      compoundAgent: {
        ...unknownHud.compoundAgent,
        capacityUnits: { known: false, value: null, reason },
      },
    }),
  });
}

usages.push({
  name: 'usage-known-with-null-value',
  expect: 'wrong_type',
  json: JSON.stringify({
    ...knownHud,
    compoundAgent: {
      ...knownHud.compoundAgent,
      capacityUnits: { ...knownHud.compoundAgent.capacityUnits, value: null },
    },
  }),
});
// And the opposite: not observed, and yet carrying a number.
usages.push({
  name: 'usage-unknown-with-value',
  expect: 'wrong_type',
  json: JSON.stringify({
    ...unknownHud,
    singleAgent: {
      ...unknownHud.singleAgent,
      usedUnits: { ...unknownHud.singleAgent.usedUnits, value: 12 },
    },
  }),
});
usages.push({
  name: 'usage-unknown-status-token',
  expect: 'unknown_token',
  json: JSON.stringify({
    ...knownHud, compoundAgent: { ...knownHud.compoundAgent, status: 'probably_fine' },
  }),
});
usages.push({
  name: 'usage-missing-meter',
  expect: 'missing_field',
  json: JSON.stringify({ schemaVersion: knownHud.schemaVersion, anchor: knownHud.anchor,
    observedAtIso: knownHud.observedAtIso, compoundAgent: knownHud.compoundAgent }),
});
usages.push({
  name: 'usage-non-finite-figure',
  // The conversion says out-of-range directly, which is more precise than
  // "not finite" — the finite check behind it remains for a platform whose
  // conversion returns HUGE_VAL instead of throwing.
  expect: 'number_out_of_range',
  // `JSON.stringify` turns Infinity into null, so the non-finite case has to be
  // written as literal JSON — which is also exactly how it would arrive from a
  // writer that was not JavaScript.
  json: JSON.stringify(knownHud).replace('"value":186', '"value":1e400'),
});

/* --------------------------------------------------------- the writing */

/**
 * COMMITTED, beside the harness that reads it, not in `generated/` — that
 * directory is gitignored, so a fresh checkout would find no fixtures and the
 * harness would report success over an empty file. The ordering case table
 * lives in the source tree for the same reason.
 */
export const WONDERLAND_WIRE_FIXTURES_PATH = join('wonderland', 'Tools', 'WireHarness', 'fixtures.tsv');
export const WONDERLAND_WIRE_DELIVERIES_PATH = join('wonderland', 'Tools', 'WireHarness', 'deliveries.tsv');
export const WONDERLAND_WIRE_USAGES_PATH = join('wonderland', 'Tools', 'WireHarness', 'usages.tsv');

const render = (items: readonly Fixture[]): string => {
  // A tab or a newline inside a payload would break the format silently, so it
  // is refused loudly instead. `JSON.stringify` escapes both, but a fixture
  // added later could carry a raw one.
  for (const item of items) {
    if (item.json.includes('\t') || item.json.includes('\n')) {
      throw new Error(`export-wonderland-wire-fixtures: ${item.name} contains a raw tab or newline.`);
    }
  }
  return `${items.map((c) => `${c.name}\t${c.expect}\t${c.json}`).join('\n')}\n`;
};

/** The files, rendered. Exported so a test compares the same bytes. */
export function renderWonderlandWireFixtures(): string { return render(cases); }
export function renderWonderlandWireDeliveries(): string { return render(deliveries); }
export function renderWonderlandWireUsages(): string { return render(usages); }

function main(): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'src', 'relay', 'mission', 'wonderland'))) {
    console.error('export-wonderland-wire-fixtures: run from the repository root.');
    process.exit(1);
  }
  const artefacts = [
    { path: join(root, WONDERLAND_WIRE_FIXTURES_PATH), body: renderWonderlandWireFixtures() },
    { path: join(root, WONDERLAND_WIRE_DELIVERIES_PATH), body: renderWonderlandWireDeliveries() },
    { path: join(root, WONDERLAND_WIRE_USAGES_PATH), body: renderWonderlandWireUsages() },
  ];
  const path = artefacts[0].path;
  const body = artefacts.map((a) => a.body).join('');

  if (process.argv.includes('--check')) {
    const onDisk = artefacts
      .map((a) => (existsSync(a.path) ? readFileSync(a.path, 'utf8') : null))
      .join('');
    if (onDisk !== body) {
      console.error(
        'export-wonderland-wire-fixtures --check: the fixtures are stale.\n' +
          'The envelope shape or a vocabulary moved without a re-export. Run:\n' +
          '  npm run wonderland:wire:fixtures\n' +
          'READ THE DIFF — it is a change to what a client must decode.',
      );
      process.exit(1);
    }
    console.log(
      `wonderland wire fixtures current (${cases.length} + ${deliveries.length} + ${usages.length} cases)`);
    return;
  }

  for (const artefact of artefacts) writeFileSync(artefact.path, artefact.body);
  void path;
  const accepted = cases.filter((c) => c.expect === 'ok').length;
  console.log(
    `wonderland wire fixtures -> ${cases.length} envelopes (${accepted} accepted), ` +
      `${deliveries.length} deliveries, ${usages.length} usages`,
  );
}

if (process.argv[1]?.includes('export-wonderland-wire-fixtures')) main();
