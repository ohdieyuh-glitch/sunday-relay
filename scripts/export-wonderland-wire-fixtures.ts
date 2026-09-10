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
import { JULIUS_MISSION_STATES } from '../src/relay/mission/julius/julius-runtime';
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
import { wonderlandRunSnapshot } from '../src/relay/mission/wonderland/wonderland-rehydration';
import {
  noWonderlandBrainCitation,
  scopeWonderlandBrain,
} from '../src/relay/mission/wonderland/wonderland-brain-scope';
import {
  scopeWonderlandCard,
  wonderlandHydration,
} from '../src/relay/mission/wonderland/wonderland-hydration';
import {
  WONDERLAND_GATED_OPERATIONS,
  scopeWonderlandHumanGate,
  scopeWonderlandHumanGates,
} from '../src/relay/mission/wonderland/wonderland-human-gate';

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
/**
 * The SNAPSHOT — what `GET /wonderland/julius/hydrate` answers.
 *
 * A FOURTH FILE rather than more lines in the third, for the same reason
 * deliveries are their own: the C++ reads it through a different entry point,
 * and a harness that had to guess which decoder a line wanted would be one
 * mis-guess away from reporting a pass it never ran.
 */
const hydrations: Fixture[] = [];
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

/* ------------------------------------------------ what the snapshot carries */

/**
 * THE PAYLOAD A WORLD ADOPTS WHOLESALE, from the real constructors.
 *
 * Every part below is built by the function that owns it — `wonderlandHydration`
 * assembles and narrows and computes nothing, exactly as the runtime does — so
 * what the C++ reads here is the shape the bridge actually writes. The refusal
 * cases are that payload with ONE thing changed, so a failure names the change.
 */
const runSnapshot = (over: Partial<Parameters<typeof wonderlandRunSnapshot>[0]> = {}) =>
  wonderlandRunSnapshot({
    projectId: 'project-alpha',
    runId: 'run-1',
    state: 'EXECUTING',
    revision: 7,
    atSequence: 42,
    observedAtIso: AT,
    juliusInstanceId: 'julius-1',
    missionId: 'mission-1',
    activeTasks: 3,
    pendingApprovals: 0,
    ...over,
  });

const brainCitation = scopeWonderlandBrain({
  projectId: 'project-alpha',
  runId: 'run-1',
  taskId: 'task-1',
  projectBrainRevision: 12,
  kinds: ['OBJECTIVE', 'OBJECTIVE', 'CONSTRAINT', 'DECISION', 'EVIDENCE'],
  characterCount: 4096,
  redactionCount: 2,
  truncated: true,
  contentHash: 'sha256:6f1e',
  observedAtIso: AT,
});

/** A C.A.R.D. whose record RESOLVED: three real answers about three slots. */
const cardResolved = scopeWonderlandCard({
  cardRevision: 'card-rev-3',
  promptArchitect: 'slot-a',
  codingAgent: 'slot-b',
  reviewer: null,
  capabilities: ['swarm:implementer', 'swarm:researcher', 'tools:git'],
  autonomy: 'AUTONOMOUS',
});

/**
 * A C.A.R.D. NOBODY COULD RESOLVE — which is every reader in this build, since
 * `julius_runs.card_revision` is free text with no foreign key. All three slots
 * come back `null`, and this is the fixture that proves the client keeps them
 * unknown rather than drawing three empty roles as a fact.
 */
const cardUnresolved = scopeWonderlandCard({ cardRevision: 'card-rev-3' });

/**
 * TWO OPEN GATES: one on a task and one on the run itself.
 *
 * Both shapes matter — `taskId` is nullable precisely because C.A.R.D. can gate
 * a run-level operation, and a fixture set with only task gates would let a
 * decoder that required the id pass.
 */
const openGates = scopeWonderlandHumanGates([
  {
    projectId: 'project-alpha', runId: 'run-1', gateId: 'gate-1', taskId: 'task-1',
    operation: 'SPAWN_SUBAGENT', reasonCode: 'CARD_APPROVAL_REQUIRED', requestedAtIso: AT,
  },
  {
    projectId: 'project-alpha', runId: 'run-1', gateId: 'gate-2', taskId: null,
    operation: 'ACCESS_NETWORK', reasonCode: 'CARD_APPROVAL_REQUIRED', requestedAtIso: AT,
  },
]).gates;

const hydration = (over: Partial<Parameters<typeof wonderlandHydration>[0]> = {}) =>
  wonderlandHydration({
    run: runSnapshot(),
    usage: knownHud,
    usageStatus: projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: 'project-alpha' }), AT).status,
    activity: activity({ signals: ['retrieving_context'], observedAtIso: AT }),
    brain: brainCitation,
    card: cardResolved,
    observedAtIso: AT,
    worldSessionId: 'world-1',
    humanGates: openGates,
    ...over,
  });

const hydrated = (name: string, value: unknown) =>
  hydrations.push({ name, expect: 'ok', json: JSON.stringify(value) });
const hydrationRefused = (name: string, expect: string, value: unknown) =>
  hydrations.push({ name, expect, json: JSON.stringify(value) });

hydrated('hydration-full', hydration());

// THE PRODUCTION SHAPE TODAY, and the one that matters most: no authority
// reports usage, no reader resolves a C.A.R.D., and no retrieval has been
// cited. Everything a world cannot know stays UNKNOWN rather than becoming a
// confident zero — three empty role slots and two empty meters would both be
// claims nobody made.
hydrated('hydration-production-unknowns', hydration({
  usage: unknownHud,
  card: cardUnresolved,
  brain: noWonderlandBrainCitation({ projectId: 'project-alpha', runId: 'run-1' }),
  run: runSnapshot({ atSequence: null, activeTasks: null, pendingApprovals: null }),
  worldSessionId: null,
  humanGates: [],
}));

// A run the reader could not place in the ledger. The world then asks for
// everything it can get and lets ordering refuse what it already has.
hydrated('hydration-no-position', hydration({ run: runSnapshot({ atSequence: null }) }));

// Both C.A.R.D. answers, separately, so a decoder that collapsed the three-way
// flag into a bool fails on exactly one of them.
hydrated('hydration-card-resolved', hydration({ card: cardResolved }));
hydrated('hydration-card-unresolved', hydration({ card: cardUnresolved }));

// AND THE THIRD ANSWER ABOUT A SWARM, which is the one that makes the other two
// mean anything: a record that WAS resolved and permits no swarm. `false` here
// and `null` above are different facts that a bare bool cannot hold apart, and
// with only one of them in the fixture set a decoder collapsing them would pass.
hydrated('hydration-card-no-swarm', hydration({
  card: scopeWonderlandCard({ cardRevision: 'card-rev-3', capabilities: ['tools:git'] }),
}));

// A citation nobody reported: mostly zeroes, and told apart from a real
// retrieval of nothing by an empty content hash.
hydrated('hydration-no-citation', hydration({
  brain: noWonderlandBrainCitation({ projectId: 'project-alpha', runId: 'run-1' }),
}));

// Every autonomy level, because the level answers a question a founder actually
// asks — "will it stop and ask me?" — and `null` must not become `SUPERVISED`.
for (const autonomy of ['SUPERVISED', 'AUTONOMOUS', 'UNCHAINED']) {
  hydrated(`hydration-autonomy-${autonomy}`, hydration({
    card: scopeWonderlandCard({ cardRevision: 'card-rev-3', autonomy }),
  }));
}
hydrated('hydration-autonomy-absent', hydration({
  card: scopeWonderlandCard({ cardRevision: 'card-rev-3' }),
}));

/* ---------------------------- what a world hydrating cold can draw */

// EVERY KERNEL STATE, so the drawable answer crosses for all of them. A world
// hydrating cold has only this: `run.state` is the kernel's bookkeeping word,
// and mapping it client-side would be a second answer to "what is this run
// doing" in engine code nobody reviewed.
for (const state of JULIUS_MISSION_STATES) {
  hydrated(`hydration-state-${state}`, hydration({ run: runSnapshot({ state }) }));
}

// THE CASE THAT MOTIVATED THE FIELD. A COMPLETED run has no further events, so
// the envelope that normally carries the drawable state never arrives — without
// this a world would hold a finished mission it could not draw, for ever.
hydrated('hydration-terminal-complete', hydration({ run: runSnapshot({ state: 'COMPLETED' }) }));

// AND THE PAIR THAT MUST NOT BE CONFUSED. `blocked` and `error` are drawn
// differently and only one of them is terminal, so `terminal` cannot be
// recovered from the drawing — a client inferring an ending from the picture
// would read the picture as the fact.
hydrated('hydration-blocked-not-terminal', hydration({ run: runSnapshot({ state: 'BLOCKED' }) }));
hydrated('hydration-failed-is-terminal', hydration({ run: runSnapshot({ state: 'FAILED' }) }));

/* ------------------------------ what a person is being waited on for */

// EVERY GATED OPERATION, one fixture each. A gate this build cannot name is a
// person being waited on that a world would not draw, and the run would look
// merely slow — so the vocabulary has to cross whole, and each member has to be
// exercised rather than assumed from the enum's presence.
for (const operation of WONDERLAND_GATED_OPERATIONS) {
  hydrated(`hydration-gate-${operation}`, hydration({
    humanGates: scopeWonderlandHumanGates([{
      projectId: 'project-alpha', runId: 'run-1', gateId: `gate-${operation}`,
      taskId: 'task-1', operation, reasonCode: 'CARD_APPROVAL_REQUIRED',
      requestedAtIso: AT,
    }]).gates,
  }));
}

// A RUN-LEVEL GATE, with no task. `taskId` is nullable precisely because
// C.A.R.D. gates run-level operations too, and a decoder that required the id
// would refuse the gate that stops the whole run.
hydrated('hydration-gate-run-level', hydration({
  humanGates: scopeWonderlandHumanGates([{
    projectId: 'project-alpha', runId: 'run-1', gateId: 'gate-run',
    taskId: null, operation: 'UNCHAINED_CONTINUATION',
    reasonCode: 'CARD_UNCHAINED_DENIED', requestedAtIso: AT,
  }]).gates,
}));

// NOBODY IS BEING WAITED ON, and somebody looked. An empty list beside a known
// count of zero is a fact; the count is what carries "nobody counted".
hydrated('hydration-gate-none', hydration({
  humanGates: [],
  run: runSnapshot({ pendingApprovals: 0 }),
}));

// A REASON CODE THE SERVER WOULD NOT REPEAT. The kernel's column is free text;
// anything that is not a machine name is dropped to empty rather than drawn, so
// a sentence cannot reach a game client through this field.
hydrated('hydration-gate-unrepeatable-reason', hydration({
  humanGates: scopeWonderlandHumanGates([{
    projectId: 'project-alpha', runId: 'run-1', gateId: 'gate-prose', taskId: 'task-1',
    operation: 'MUTATE_FILESYSTEM',
    reasonCode: 'The founder must confirm this write. Ask them in person.',
    requestedAtIso: AT,
  }]).gates,
}));

/* ------------------------------- and what a world must refuse to adopt */

// THE MIS-ROUTED HYDRATION, three ways. Each is adopted WHOLESALE if it gets
// through, so nothing arriving afterwards would contradict it: the world would
// simply watch the wrong run with every number on it real.
hydrationRefused('hydration-foreign-run-project', 'identity_rejected',
  { ...hydration(), run: runSnapshot({ projectId: 'project-beta' }) });
hydrationRefused('hydration-foreign-activity-project', 'identity_rejected',
  { ...hydration(), activity: activity({ projectId: 'project-beta' } as never) });
hydrationRefused('hydration-foreign-activity-run', 'identity_rejected',
  { ...hydration(), activity: activity({ runId: 'run-9' } as never) });
hydrationRefused('hydration-foreign-brain-project', 'identity_rejected',
  { ...hydration(), brain: noWonderlandBrainCitation({
    projectId: 'project-beta', runId: 'run-1' }) });

// THE SWAPPED METERS, inside a snapshot. The usage entry point refuses this
// already; a hydration that composed the reader without the check would be
// exactly as swappable, and the arcs would draw each other's spend.
hydrationRefused('hydration-swapped-channels', 'identity_rejected', {
  ...hydration(),
  usage: { ...knownHud, compoundAgent: knownHud.singleAgent, singleAgent: knownHud.compoundAgent },
});

// A SCHEMA THIS BUILD DOES NOT IMPLEMENT. Every key below it may mean something
// else, so it is refused rather than read against the fields this build knows.
hydrationRefused('hydration-future-schema', 'schema_rejected',
  { ...hydration(), schemaVersion: 'relay-wonderland-hydration.v2' });

hydrationRefused('hydration-blank-project', 'identity_rejected',
  { ...hydration(), projectId: '' });

// A GATE FROM ANOTHER RUN, AND FROM ANOTHER PROJECT. One foreign gate among
// correct ones would show a person being waited on for something this world
// cannot see, and nothing arriving afterwards would withdraw it.
hydrationRefused('hydration-foreign-gate-project', 'identity_rejected', {
  ...hydration(),
  humanGates: [...openGates, scopeWonderlandHumanGate({
    projectId: 'project-beta', runId: 'run-1', gateId: 'gate-x', taskId: null,
    operation: 'ACCESS_NETWORK', reasonCode: 'CARD_APPROVAL_REQUIRED', requestedAtIso: AT,
  })],
});
hydrationRefused('hydration-foreign-gate-run', 'identity_rejected', {
  ...hydration(),
  humanGates: [...openGates, scopeWonderlandHumanGate({
    projectId: 'project-alpha', runId: 'run-9', gateId: 'gate-x', taskId: null,
    operation: 'ACCESS_NETWORK', reasonCode: 'CARD_APPROVAL_REQUIRED', requestedAtIso: AT,
  })],
});

// AN OPERATION THIS BUILD CANNOT NAME. Refused rather than landed on ordinal 0,
// which is `Unobserved` and would draw a gate with no boundary on it.
hydrationRefused('hydration-gate-unknown-operation', 'unknown_token', {
  ...hydration(),
  humanGates: [{ ...openGates[0], operation: 'SUMMON_THE_FOUNDER' }],
});

// THE FIELD ITSELF, ABSENT. A bridge that does not send gates is not a run
// waiting on nobody, and of the two this build must not guess the second.
hydrationRefused('hydration-gates-absent', 'missing_field', (() => {
  const damaged: Record<string, unknown> = { ...hydration() };
  delete damaged.humanGates;
  return damaged;
})());
hydrationRefused('hydration-gates-not-an-array', 'wrong_type',
  { ...hydration(), humanGates: {} });

// A PICTURE THAT DOES NOT MATCH ITS RUN. Adopted wholesale and never
// contradicted, it would animate the wrong mission under the right name.
hydrationRefused('hydration-picture-disagrees-with-run', 'unknown_token', {
  ...hydration(), visualState: 'ascended',
});
hydrationRefused('hydration-no-visual-state', 'missing_field', (() => {
  const damaged: Record<string, unknown> = { ...hydration() };
  delete damaged.visualState;
  return damaged;
})());
hydrationRefused('hydration-no-terminal-flag', 'missing_field', (() => {
  const damaged: Record<string, unknown> = { ...hydration() };
  delete damaged.terminal;
  return damaged;
})());

// Each half, absent. A hydration missing one of them is not a smaller
// hydration: a world would draw the remaining halves and have no meters, no
// citation or no roles with nothing saying why.
for (const part of ['run', 'usage', 'usageStatus', 'activity', 'brain', 'card']) {
  const damaged: Record<string, unknown> = { ...hydration() };
  delete damaged[part];
  hydrationRefused(`hydration-missing-${part}`, 'missing_field', damaged);
}

// A CARRIER THAT CAME BACK AS A BARE VALUE. `atSequence` is `number | null`;
// a string there is a writer that is not Relay.
hydrationRefused('hydration-stringly-sequence', 'wrong_type',
  { ...hydration(), run: { ...runSnapshot(), atSequence: '42' } });
hydrationRefused('hydration-fractional-sequence', 'number_not_integer',
  { ...hydration(), run: { ...runSnapshot(), atSequence: 1.5 } });
// A negative position would resume the world from before the beginning, and
// every event of the replay that followed would look new.
hydrationRefused('hydration-negative-sequence', 'number_out_of_range',
  { ...hydration(), run: { ...runSnapshot(), atSequence: -1 } });
hydrationRefused('hydration-negative-active-tasks', 'number_out_of_range',
  { ...hydration(), run: { ...runSnapshot(), activeTasks: -1 } });

// THE THREE-WAY FLAG, FLATTENED. A bool where the carrier belongs is how a
// name-matching converter would send it, and accepting it would draw an empty
// slot for a C.A.R.D. nobody resolved.
hydrationRefused('hydration-card-slot-numeric', 'wrong_type',
  { ...hydration(), card: { ...cardResolved, hasCodingAgent: 1 } });
hydrationRefused('hydration-card-unknown-autonomy', 'unknown_token',
  { ...hydration(), card: { ...cardResolved, autonomy: 'FEARLESS' } });

// A KIND COUNT THAT IS NOT A COUNT, and a kind bucket that never arrived.
hydrationRefused('hydration-brain-missing-kind', 'missing_field', {
  ...hydration(),
  brain: (() => {
    const counts: Record<string, number> = { ...brainCitation.kindCounts };
    delete counts.FINDING;
    return { ...brainCitation, kindCounts: counts };
  })(),
});
hydrationRefused('hydration-brain-negative-kind', 'number_out_of_range', {
  ...hydration(),
  brain: { ...brainCitation, kindCounts: { ...brainCitation.kindCounts, REPAIR: -1 } },
});

// AND THE ONE UNKNOWN TOKEN THIS DECODER TOLERATES. A kind the kernel learned
// and this build has not is counted in `entryCount` and in no bucket; the
// disagreement between the two IS the signal. Refusing would take a world dark
// the moment Relay grew a tenth kind, which is the more expensive failure by a
// wide margin.
hydrated('hydration-brain-future-kind', {
  ...hydration(),
  brain: { ...brainCitation, kindCounts: { ...brainCitation.kindCounts, PREMONITION: 4 } },
});

// The usage verdict's own counters. A negative refusal count is a report from
// something that is not the usage authority.
hydrationRefused('hydration-negative-rejection-count', 'number_out_of_range', {
  ...hydration(),
  usageStatus: {
    ...projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: 'project-alpha' }), AT).status,
    foreignProjectReportsRejected: -1,
  },
});
hydrationRefused('hydration-unknown-usage-reading', 'unknown_token', {
  ...hydration(),
  usageStatus: {
    ...projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: 'project-alpha' }), AT).status,
    reading: 'probably_fine',
  },
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
export const WONDERLAND_WIRE_HYDRATIONS_PATH = join('wonderland', 'Tools', 'WireHarness', 'hydrations.tsv');

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
export function renderWonderlandWireHydrations(): string { return render(hydrations); }

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
    { path: join(root, WONDERLAND_WIRE_HYDRATIONS_PATH), body: renderWonderlandWireHydrations() },
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
      'wonderland wire fixtures current ' +
        `(${cases.length} + ${deliveries.length} + ${usages.length} + ${hydrations.length} cases)`);
    return;
  }

  for (const artefact of artefacts) writeFileSync(artefact.path, artefact.body);
  void path;
  const accepted = cases.filter((c) => c.expect === 'ok').length;
  console.log(
    `wonderland wire fixtures -> ${cases.length} envelopes (${accepted} accepted), ` +
      `${deliveries.length} deliveries, ${usages.length} usages, ` +
      `${hydrations.length} hydrations`,
  );
}

if (process.argv[1]?.includes('export-wonderland-wire-fixtures')) main();
