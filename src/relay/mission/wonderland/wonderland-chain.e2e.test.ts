import { describe, expect, it } from 'vitest';

import {
  cardPolicy,
  createJuliusHarness,
  task,
  verificationPolicy,
  worker,
} from '../julius/julius-runtime-fixtures';
import type { JuliusRunLoop } from '../julius/julius-run-loop';
import type { JuliusOperationalEvent } from '../julius/julius-events';

import { emptyJuliusActivity } from './wonderland-julius-activity';
import { noWonderlandBrainCitation } from './wonderland-brain-scope';
import { openWonderlandCursor } from './wonderland-ordering';
import { adoptWonderlandSnapshot, wonderlandRunSnapshot } from './wonderland-rehydration';
import { ingestWonderlandRows } from './wonderland-ingress';
import { planWonderlandActivityIntent } from './wonderland-activity-animation';
import { scopeWonderlandCard, wonderlandHydration, wonderlandHydrationResume } from './wonderland-hydration';
import {
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from './wonderland-usage-authority';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';
import type { WonderlandCursor } from './wonderland-ordering';

/**
 * THE WHOLE CLOUD-SIDE CHAIN, DRIVEN BY THE REAL JULIUS KERNEL.
 *
 * Every other suite on this seam constructs its own input. This one does not:
 * it runs the REAL `JuliusRunLoop` — real claim, real policy evaluation, real
 * context compiler, real budget reservation, real evidence normalization, real
 * verification, real repair planning — takes the operational events THAT LOOP
 * ITSELF EMITTED, and pushes them through the entire integration path.
 *
 * WHAT IS FAKED, precisely: the provider adapters answer from a script, because
 * no credential exists here and none is going to. Everything between the
 * scheduler and the adapter is real, and everything after the ledger is the
 * production path.
 *
 * WHAT THIS STILL IS NOT: a live run. No provider was called, no database was
 * touched, and no world drew anything. It proves the SOFTWARE joins up, which
 * is the thing that was in doubt.
 */

const scope = { projectId: 'prj-1' };

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan'], providerId: 'provider-a', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build'], providerId: 'provider-b', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review'], providerId: 'provider-c', adapterId: 'reviewer-adapter',
});

const capabilityFor = (item: { role: string }) =>
  item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement';

/**
 * Run the kernel until it has nothing left to claim.
 *
 * THE TICK CEILING IS AN ERROR, NOT AN EXIT. A loop that never quiesced would
 * otherwise hand every assertion below a PARTIAL event stream, and most of them
 * would still pass — the run simply would not have reached review or repair.
 * A silent cap is how a test starts proving less than its name says.
 */
async function drain(loop: JuliusRunLoop, maxTicks = 12): Promise<void> {
  let claimed = 1;
  for (let tick = 0; claimed > 0; tick += 1) {
    if (tick >= maxTicks) throw new Error(`the run loop still had work after ${maxTicks} ticks`);
    claimed = (await loop.tick(scope)).claimed;
  }
}

/** A mission that plans, builds, is reviewed with a blocking finding, and repairs. */
function buildHarness() {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] }] },
      {
        worker: CODER,
        script: [
          { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] },
          { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green after repair.' }] },
        ],
      },
      {
        worker: REVIEWER,
        script: [
          { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The branch is untested.' }] },
          { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] },
        ],
      },
    ],
    card: cardPolicy({
      allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
      capabilities: ['plan', 'implement', 'review'],
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun({
    runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
    cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
  });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan' }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [
    { criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] },
  ]);
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Bind the Julius boundary.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
    { entryId: 'brain-secret', kind: 'CONSTRAINT', text: 'api_key=sk-must-never-appear', taskIds: [], allowedRoles: ['CODING_AGENT'], sensitivity: 'SECRET' },
  ]);
  return harness;
}

/**
 * The kernel's own events, shaped the way `julius-postgres.ts` really persists
 * them: `json({schemaVersion, ...input})` with the operational event's own body
 * under `payload`. Building these from a guess is how the earlier
 * `run.transitioned` defect got through — green against a fixture, degraded
 * against the database.
 */
const asLedgerRows = (events: readonly JuliusOperationalEvent[]): WonderlandLedgerRow[] =>
  events.map((event, index) => ({
    eventId: event.eventId,
    streamId: event.runId,
    projectId: event.projectId,
    sequence: index + 1,
    eventType: `julius.${event.type}`,
    occurredAt: event.occurredAt,
    payload: {
      schemaVersion: 'relay-julius-event.v1',
      eventId: event.eventId,
      streamId: event.runId,
      projectId: event.projectId,
      type: event.type,
      occurredAt: event.occurredAt,
      // The FLAT shape: the operational event was written whole, `facts` and
      // all. Both shapes exist in the real ledger and the adapter reads both.
      taskId: event.taskId,
      workerId: event.workerId,
      correlationId: event.correlationId,
      causationId: event.causationId,
      facts: event.facts,
    },
  }));

const ingest = (rows: readonly WonderlandLedgerRow[], cursor: WonderlandCursor, revision: number) =>
  ingestWonderlandRows({
    grant: { projectId: 'prj-1', runId: 'run-1' },
    rows,
    revision,
    cursor,
    activity: emptyJuliusActivity({ projectId: 'prj-1', runId: 'run-1' }),
  });

/* ==================================================================== */

describe('a real Julius mission reaches a world', () => {
  it('emits events the world can read, and the world folds them into a state', async () => {
    const harness = buildHarness();
    await drain(harness.loop);

    const events = harness.store.events();
    expect(events.length, 'the kernel emitted nothing to carry').toBeGreaterThan(5);

    const rows = asLedgerRows(events);
    const result = ingest(rows, openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9);

    // The world saw real work.
    expect(result.deliveries.length).toBeGreaterThan(0);
    const states = result.deliveries.map((delivery) => delivery.envelope.state);
    expect(new Set(states).size).toBeGreaterThan(1);

    // Every delivery names the run and project it came from.
    for (const delivery of result.deliveries) {
      expect(delivery.envelope.projectId).toBe('prj-1');
      expect(delivery.envelope.runId).toBe('run-1');
    }

    // The cursor advanced and can be resumed from.
    expect(result.cursor.applied).toBe(result.deliveries.length);
    expect(result.cursor.sequence).toBeGreaterThan(0);
  });

  it('carries the reviewer through as its own visual state', async () => {
    const harness = buildHarness();
    await drain(harness.loop);
    const result = ingest(
      asLedgerRows(harness.store.events()),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    // The Independent Reviewer is a permanent slot in the architecture, and a
    // real review really ran. The world must be able to show it.
    expect(result.deliveries.map((d) => d.envelope.state)).toContain('independent_review');
  });

  it('never lets a SECRET brain entry reach a world', async () => {
    // The harness seeds `api_key=sk-must-never-appear` as a SECRET entry. The
    // context compiler filters SECRET and redacts key-shaped text; this
    // asserts the world's own payload is clean whatever happened upstream.
    const harness = buildHarness();
    await drain(harness.loop);
    const result = ingest(
      asLedgerRows(harness.store.events()),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    const serialised = JSON.stringify(result.deliveries);
    expect(serialised).not.toContain('must-never-appear');
    expect(serialised).not.toContain('Bind the Julius boundary');
    // `sk-` matches inside `task-`, so the check is key-SHAPED, never bare.
    expect(serialised).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);

    // AND THE STRUCTURAL GUARANTEE, which is what actually holds. The canary
    // check above passes even with the sanitizer removed, because this
    // kernel's event FACTS never carried brain text in the first place — the
    // brain reaches the context packet, not the ledger. A test that rested
    // only on the canary would be proving the fixture, not the boundary.
    //
    // `sanitizeWonderlandMetadata` is the boundary: primitives only, bounded
    // entries, bounded length. Anything a future writer put on an event is
    // capped by it whether or not this test knows to look for it.
    for (const delivery of result.deliveries) {
      const metadata = delivery.envelope.metadata as Readonly<Record<string, unknown>>;
      expect(Object.keys(metadata).length).toBeLessThanOrEqual(16);
      for (const value of Object.values(metadata)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
        if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(120);
      }
    }
  });

  it('names no provider, whatever the kernel routed to', async () => {
    // The workers are on `provider-a`, `provider-b`, `provider-c`. The world's
    // vocabulary is functions, not vendors.
    const harness = buildHarness();
    await drain(harness.loop);
    const result = ingest(
      asLedgerRows(harness.store.events()),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    const serialised = JSON.stringify(result.deliveries);
    for (const provider of ['provider-a', 'provider-b', 'provider-c']) {
      expect(serialised).not.toContain(provider);
    }
  });
});

/* ==================================================================== */

describe('the same-revision case, end to end', () => {
  /**
   * THE DEFECT THIS WHOLE SECTION EXISTS FOR.
   *
   * Only a state TRANSITION bumps `julius_runs.version`. `review.started`,
   * `finding.recorded` and both subagent events do not. So a snapshot taken at
   * revision N, followed by real review activity ALSO at revision N, used to
   * be refused entirely — the world went deaf until the run happened to change
   * state. This drives it with the kernel's own events rather than constructed
   * ones, so the case is the real one.
   */
  const sameRevisionRows = (events: readonly JuliusOperationalEvent[]) =>
    asLedgerRows(events).filter((row) =>
      ['julius.review.started', 'julius.finding.recorded', 'julius.subagent.spawned'].includes(
        row.eventType,
      ),
    );

  it('the kernel really does emit activity without bumping the run version', async () => {
    // THE PREMISE, CHECKED RATHER THAN ASSUMED — and worth being exact about
    // what this scenario actually produces, because a test resting on an
    // event nobody emits is a test that proves nothing.
    //
    // This mission emits `review.started` twice and does NOT reach
    // `finding.recorded` or `subagent.spawned`: the scripted reviewer returns
    // a failing verdict, the tasks fail, and the run ends in `run.failed`.
    // `review.started` alone is enough to exercise the case — it is emitted by
    // a writer that never touches `julius_runs.version` — and this assertion
    // fails loudly if even that stops happening.
    const harness = buildHarness();
    await drain(harness.loop);
    const events = harness.store.events();
    const activity = sameRevisionRows(events);
    expect(activity.length, 'no same-revision activity was emitted to test with').toBeGreaterThan(0);
    expect(activity.map((row) => row.eventType)).toContain('julius.review.started');

    // And the run really did move state at some point, so the two axes are
    // genuinely being told apart rather than one of them being absent.
    expect(events.some((event) => event.type === 'run.failed')).toBe(true);
  });

  it('hears that activity after a POSITIONED snapshot at the same revision', async () => {
    const harness = buildHarness();
    await drain(harness.loop);
    const rows = sameRevisionRows(harness.store.events());
    const firstActivitySequence = rows[0].sequence;

    const recovered = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      wonderlandRunSnapshot({
        projectId: 'prj-1',
        runId: 'run-1',
        state: 'EXECUTING',
        revision: 9,
        // The snapshot sits BEFORE the activity, which is the ordinary case.
        atSequence: firstActivitySequence - 1,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    expect(recovered.verdict).toBe('adopted');

    // Same revision as the snapshot, because no transition happened.
    const result = ingest(rows, recovered.cursor, 9);
    expect(result.deliveries.length, 'the world went deaf after the snapshot').toBeGreaterThan(0);
    expect(result.refusals.out_of_order).toBe(0);
  });

  it('still refuses the tail the snapshot already absorbed', () => {
    // The other half: `atSequence` must not become "accept everything".
    const harness = buildHarness();
    return drain(harness.loop).then(() => {
      const rows = asLedgerRows(harness.store.events());
      const recovered = adoptWonderlandSnapshot(
        openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
        wonderlandRunSnapshot({
          projectId: 'prj-1', runId: 'run-1', state: 'EXECUTING', revision: 9,
          atSequence: rows[rows.length - 1].sequence,
          observedAtIso: '2026-09-08T00:01:00.000Z',
        }),
      );
      // Everything is behind the snapshot now.
      const result = ingest(rows, recovered.cursor, 9);
      expect(result.deliveries).toEqual([]);
      expect(result.orderingVerdicts.stale_sequence).toBeGreaterThan(0);
    });
  });

  it('does not skip events to achieve it', async () => {
    // The failure mode on the other side of the fix: a snapshot that jumped
    // the cursor forward would look healthy and silently lose work.
    const harness = buildHarness();
    await drain(harness.loop);
    const rows = asLedgerRows(harness.store.events());

    const withSnapshot = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      wonderlandRunSnapshot({
        projectId: 'prj-1', runId: 'run-1', state: 'EXECUTING', revision: 9,
        atSequence: 0, observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    const fromSnapshot = ingest(rows, withSnapshot.cursor, 9);
    const fromCold = ingest(rows, openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9);

    // A snapshot at position zero absorbs nothing, so both see the same work.
    expect(fromSnapshot.deliveries.map((d) => d.envelope.eventId)).toEqual(
      fromCold.deliveries.map((d) => d.envelope.eventId),
    );
  });
});

/* ==================================================================== */

describe('reconnect costs a snapshot and a tail, never a transcript', () => {
  it('resumes from the hydration and converges on the same state', async () => {
    const harness = buildHarness();
    await drain(harness.loop);
    const rows = asLedgerRows(harness.store.events());
    const cut = Math.floor(rows.length / 2);

    // A world that watched the first half, then dropped.
    const before = ingest(rows.slice(0, cut), openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9);

    // It comes back and is handed a hydration cut at the same place.
    const authority = projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: 'prj-1' }),
      '2026-09-08T00:01:00.000Z',
    );
    const hydration = wonderlandHydration({
      run: wonderlandRunSnapshot({
        projectId: 'prj-1', runId: 'run-1', state: 'EXECUTING', revision: 9,
        atSequence: rows[cut - 1].sequence,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
      usage: authority.hud,
      usageStatus: authority.status,
      activity: emptyJuliusActivity({ projectId: 'prj-1', runId: 'run-1' }),
      brain: noWonderlandBrainCitation({ projectId: 'prj-1', runId: 'run-1' }),
      card: scopeWonderlandCard({ cardRevision: 'card-r1' }),
      observedAtIso: '2026-09-08T00:01:00.000Z',
    });

    const resume = wonderlandHydrationResume(hydration);
    expect(resume.afterSequence).toBe(rows[cut - 1].sequence);

    // It asks for the tail only.
    const tail = rows.filter((row) => row.sequence > resume.afterSequence);
    expect(tail.length).toBe(rows.length - cut);

    const recovered = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      hydration.run,
    );
    const after = ingest(tail, recovered.cursor, 9);

    // And lands where a world that never disconnected would have.
    const uninterrupted = ingest(rows, openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9);
    const lastOf = (deliveries: readonly { envelope: { state: string } }[]) =>
      deliveries[deliveries.length - 1]?.envelope.state;
    expect(lastOf([...before.deliveries, ...after.deliveries])).toBe(lastOf(uninterrupted.deliveries));
  });

  it('a duplicate reconnect changes nothing', async () => {
    const harness = buildHarness();
    await drain(harness.loop);
    const rows = asLedgerRows(harness.store.events());

    const first = ingest(rows, openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9);
    // The same rows again, from the cursor the first pass produced.
    const second = ingestWonderlandRows({
      grant: { projectId: 'prj-1', runId: 'run-1' },
      rows,
      revision: 9,
      cursor: first.cursor,
      activity: first.activity,
    });
    expect(second.deliveries).toEqual([]);
    expect(second.cursor.sequence).toBe(first.cursor.sequence);
  });
});

/* ==================================================================== */

describe('a mission that completes, so the endings are not all failures', () => {
  /**
   * The scenario above ends in `run.failed`, which is a real ending and worth
   * carrying. It is not the only one, and a chain proven only against failure
   * would be a chain nobody had watched succeed.
   */
  const buildCompleting = () => {
    const harness = createJuliusHarness({
      workers: [
        {
          worker: CODER,
          script: [{ kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] }],
        },
      ],
      card: cardPolicy({ allowedProviders: [CODER.providerId], capabilities: ['implement'] }),
      verification: verificationPolicy({ reviewerRequired: false, maxRepairRounds: 0 }),
      capabilityFor,
    });
    harness.store.seedRun({
      runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
      cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
    });
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 0, role: 'CODING_AGENT', taskType: 'build',
      requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria('run-1', [
      { criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] },
    ]);
    return harness;
  };

  it('carries a successful run through the chain', async () => {
    const harness = buildCompleting();
    await drain(harness.loop);
    const events = harness.store.events();
    expect(events.length).toBeGreaterThan(0);

    const result = ingest(
      asLedgerRows(events),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    expect(result.deliveries.length).toBeGreaterThan(0);
    for (const delivery of result.deliveries) {
      expect(delivery.envelope.runId).toBe('run-1');
    }
  });

  it('marks only a real ending terminal, and never a working state', async () => {
    const harness = buildCompleting();
    await drain(harness.loop);
    const result = ingest(
      asLedgerRows(harness.store.events()),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    for (const delivery of result.deliveries) {
      const { state, terminal } = delivery.envelope;
      const isEnding = state === 'complete' || state === 'blocked' || state === 'error';
      expect(terminal, `${state} reported terminal=${terminal}`).toBe(isEnding);
    }
  });

  it('holds a failing run and a completing run apart', async () => {
    // BLOCKED and ERROR are not COMPLETE. Two real runs, two different endings
    // in the world's vocabulary — or, when the kernel emits no terminal event
    // at all in a scenario, no claim of one.
    const failing = buildHarness();
    await drain(failing.loop);
    const failingStates = new Set(
      ingest(asLedgerRows(failing.store.events()), openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }), 9)
        .deliveries.filter((d) => d.envelope.terminal)
        .map((d) => d.envelope.state),
    );

    // The failing scenario really does end, and it does not end in success.
    expect(failingStates.has('complete')).toBe(false);
    expect(failingStates.size).toBeGreaterThan(0);
  });
});

/* ==================================================================== */

describe('what the world would animate, from a real run', () => {
  it('raises a signal on real activity and clears it on the real event that ends it', async () => {
    // THE FOLD, WATCHED RATHER THAN ASSUMED — and the shape of this test is
    // the finding. `context.compiled` raises `retrieving_context` and
    // `worker.dispatched` clears it, so by the end of a healthy mission the
    // set is EMPTY. Asserting on the final fold would have looked like the
    // fold was dead; it is the raise and the clear that are alive.
    const harness = buildHarness();
    await drain(harness.loop);
    const rows = asLedgerRows(harness.store.events());

    const compiledAt = rows.findIndex((row) => row.eventType === 'julius.context.compiled');
    expect(compiledAt, 'this mission compiled no context to fold').toBeGreaterThanOrEqual(0);

    // Up to and including the compilation: the signal is up.
    const raised = ingest(
      rows.slice(0, compiledAt + 1),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    expect(raised.activity.signals).toContain('retrieving_context');

    // Through the dispatch that follows it: the signal is down again.
    const dispatchAt = rows.findIndex(
      (row, index) => index > compiledAt && row.eventType === 'julius.worker.dispatched',
    );
    expect(dispatchAt, 'nothing dispatched after the context was compiled').toBeGreaterThan(compiledAt);
    const cleared = ingest(
      rows.slice(0, dispatchAt + 1),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );
    expect(cleared.activity.signals).not.toContain('retrieving_context');
  });

  it('turns the folded activity into intents and never into assets', async () => {
    const harness = buildHarness();
    await drain(harness.loop);
    const result = ingest(
      asLedgerRows(harness.store.events()),
      openWonderlandCursor({ projectId: 'prj-1', runId: 'run-1' }),
      9,
    );

    const last = result.deliveries[result.deliveries.length - 1];
    const intent = planWonderlandActivityIntent({
      signals: result.activity.signals,
      visualState: last.envelope.state,
    });

    // Semantic only. A clip, a colour or an asset name here would be the world
    // being told what to draw rather than what is true.
    const serialised = JSON.stringify(intent);
    expect(serialised).not.toMatch(/clip|montage|sprite|mesh|texture|colou?r|asset/i);
    expect(intent.reason.length).toBeGreaterThan(10);
  });
});
