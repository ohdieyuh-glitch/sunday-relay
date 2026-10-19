/**
 * A RESEARCH READ'S BYTES SURVIVE THE DURABLE ROW, SO THE NEXT READ IS METERED, NOT REFUSED.
 *
 * Paid qualification attempt 4 (run 34774471909, main 44fd503a) granted three
 * reads per slot under a byte budget. The architect's first read was observed;
 * every one of the next ten asks — four architect, six coder — was refused
 * `budget_exhausted / byte_budget_unenforceable` within milliseconds. The live
 * research ledger is rebuilt from the run's `research.retrieved` rows, the rows
 * carried no byte count, the projection replayed each past read as UNSIZED, and
 * `checkRetrievalBudget` rightly refuses a byte budget over a sum that cannot
 * account for every read. One read per mission.
 *
 * These proofs drive the REAL domain pipeline (it writes the rows), the REAL
 * research mediator and Live Reach service (they charge the bytes), and the
 * REAL durable projection (it rebuilds the ledger from the rows). A fresh
 * mediator is built for every serve, so nothing survives in a process Map: the
 * rows are the only memory, exactly as after a restart. Nothing reaches the
 * network; the fetch and the resolver are stand-ins.
 */

import { describe, expect, it } from 'vitest';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from '../../src/relay/mission/julius/julius-runtime-fixtures';
import type { JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import {
  JULIUS_RESEARCH_ROLES,
  juliusMissionResearchMeter,
  sealJuliusResearchPolicy,
  type JuliusResearchPolicy,
  type JuliusResearchPort,
  type JuliusTimelineReader,
} from '../../src/relay/mission/julius';
import type { BackendProbe } from '../../src/relay/mission/live-reach';
import { createLiveReachService } from '../live-reach-service';
import { projectDurableJuliusResearchLedger } from './live-composition';
import { createJuliusResearchMediator, juliusResearchPortFrom } from './research-mediator';

const READY: readonly BackendProbe[] = Object.freeze([
  { backendId: 'relay_http_fetch', capability: 'read_item', result: 'observed', probedAt: '2026-09-15T09:59:00.000Z' },
]);

/** Attempt 4's grant, exactly: three reads and 300 KB a slot, nine and 900 KB for the mission. */
const ATTEMPT_4_POLICY = (over: { roleBytes?: number; missionBytes?: number } = {}): JuliusResearchPolicy => sealJuliusResearchPolicy({
  missionId: 'msn-1',
  roles: [...JULIUS_RESEARCH_ROLES],
  allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['www.postgresql.org'] }],
  missionBudget: { maxRetrievals: 9, maxBytes: over.missionBytes ?? 900_000 },
  roleBudget: { maxRetrievals: 3, maxBytes: over.roleBytes ?? 300_000 },
});

const PAGE_BYTES = 2_048;
const PAGE = `<html><body>${'x'.repeat(PAGE_BYTES - 26)}</body></html>`;

/** The run's own rows, served the way the Postgres timeline repository serves them. */
const timelineOf = (harness: JuliusHarness): JuliusTimelineReader => ({
  async timeline({ runId, sinceSequence, limit }) {
    const entries = harness.store.events()
      .map((event, index) => ({ event, sequence: index + 1 }))
      .filter(({ event, sequence }) => event.runId === runId && sequence > sinceSequence)
      .slice(0, limit)
      .map(({ event, sequence }) => ({
        eventId: event.eventId, sequence, type: event.type, taskId: event.taskId,
        workerId: event.workerId, occurredAt: event.occurredAt, facts: event.facts,
      }));
    return { entries, hasMore: false };
  },
});

/**
 * THE RESTART, EVERY TIME. Each serve builds a new mediator and a new Live Reach
 * service, so the only thing the second read can know about the first is what
 * the durable rows say.
 */
const durablePort = (
  reader: () => JuliusTimelineReader,
  policy: JuliusResearchPolicy,
  fetched: string[],
): JuliusResearchPort => ({
  async serve(input) {
    let tick = 0;
    const now = (): string => { tick += 1; return new Date(Date.UTC(2026, 8, 15, 10, 0, tick)).toISOString(); };
    const mediator = createJuliusResearchMediator({
      policyFor: () => policy,
      liveReach: createLiveReachService({
        now,
        nextEvidenceId: () => `ev-${String(fetched.length + 1)}`,
        fetchImpl: (async (url: string | URL) => {
          fetched.push(String(url));
          return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
        }) as typeof fetch,
        resolver: { resolve: async () => ['151.101.2.217'] },
      }),
      now,
      retrievalContext: () => ({ probes: READY }),
      durableLedger: (request) => projectDurableJuliusResearchLedger(reader(), request),
    });
    return juliusResearchPortFrom(mediator).serve(input);
  },
});

const ASK = Object.freeze({
  source: 'web', capability: 'read_item',
  reference: 'https://www.postgresql.org/docs/current/app-psql.html',
  purpose: 'How psql unaligned output renders a SQL NULL.',
});
const RESUME = Object.freeze({ completedSoFar: ['read the module'], nextIntent: 'implement readTextCell' });

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const ARCHITECT = worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', capabilities: ['plan'], taskTypes: ['plan'] });
const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] });
const REVIEWER = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'xai', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'] });

/** A coder that asks once per segment, `asks` times, and then finishes. */
function harnessAsking(asks: number, policy: JuliusResearchPolicy): { harness: JuliusHarness; fetched: string[] } {
  const fetched: string[] = [];
  let harness!: JuliusHarness;
  const script = [
    ...Array.from({ length: asks }, () => ({ kind: 'succeed' as const, researchAsks: [ASK], segmentResume: RESUME })),
    { kind: 'succeed' as const },
  ];
  harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] }] },
      { worker: CODER, script },
      { worker: REVIEWER, script: [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'xai'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor: (item: { role: string }) => (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
    research: durablePort(() => timelineOf(harness), policy, fetched),
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return { harness, fetched };
}

async function drain(harness: JuliusHarness, ticks = 40): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    let report;
    try { report = await harness.loop.tick({ projectId: 'prj-1' }); } catch { return; }
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const retrieved = (harness: JuliusHarness) =>
  harness.store.events().filter((event) => event.type === 'research.retrieved').map((event) => event.facts);

/* ------------------------------------------------------------ the repair */

describe('the byte count a read was charged survives the row, and the next read is metered', () => {
  it('A–E: three reads by one slot across three segments, each settled by a fresh mediator from the rows alone', async () => {
    const { harness, fetched } = harnessAsking(3, ATTEMPT_4_POLICY());
    await drain(harness);
    const rows = retrieved(harness);
    expect(rows.map((row) => row.outcome), 'all three reads the grant allows are served').toEqual(['observed', 'observed', 'observed']);
    expect(rows.map((row) => row.reasonCode)).toEqual([null, null, null]);
    expect(fetched, 'each read really reached the stand-in host').toHaveLength(3);
    // B: the bytes the ledger was charged are on the durable row, marked as recorded.
    for (const row of rows) {
      expect(row.bytesRecorded).toBe(true);
      expect(row.bytes).toBe(PAGE_BYTES);
    }
    // C/D: the rebuilt ledger knows exactly what was spent — sized, not unknown.
    const ledger = await projectDurableJuliusResearchLedger(timelineOf(harness), RUN);
    const meter = juliusMissionResearchMeter(ledger);
    expect(meter.counted).toBe(3);
    expect(meter.unsized, 'no read is replayed as unmeasured').toBe(0);
    expect(meter.bytes).toBe(3 * PAGE_BYTES);
  });

  it('F: a byte budget still refuses truthfully once it is genuinely spent', async () => {
    // Room for one 2 KB read per slot: the second is refused as EXHAUSTED, never as unenforceable.
    const { harness, fetched } = harnessAsking(2, ATTEMPT_4_POLICY({ roleBytes: PAGE_BYTES, missionBytes: 900_000 }));
    await drain(harness);
    const rows = retrieved(harness);
    expect(rows.map((row) => `${String(row.outcome)}/${String(row.reasonCode)}`)).toEqual(['observed/null', 'budget_exhausted/byte_budget_exhausted']);
    expect(fetched, 'the refused read opened no socket').toHaveLength(1);
  });
});

describe('a row with no recorded byte count is unknown historical spend, never zero', () => {
  const entry = (sequence: number, facts: Record<string, string | number | boolean | null>) => ({
    eventId: `e-${String(sequence)}`, sequence, type: 'research.retrieved', taskId: 'build-1', workerId: 'coder',
    occurredAt: '2026-09-13T18:28:19.117Z', facts: { role: 'CODING_AGENT', outcome: 'observed', counted: true, ...facts },
  });
  const readerOf = (entries: ReturnType<typeof entry>[]): JuliusTimelineReader => ({ timeline: async () => ({ entries, hasMore: false }) });

  it('G: REPRODUCES ATTEMPT 4 — a legacy row without a byte count makes the next read refused as unenforceable, with no fetch', async () => {
    const fetched: string[] = [];
    const port = durablePort(() => readerOf([entry(1, {})]), ATTEMPT_4_POLICY(), fetched);
    const [observation] = await port.serve({
      missionId: 'msn-1', projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', role: 'CODING_AGENT',
      asks: [ASK], requestedAt: '2026-09-13T18:48:53.769Z',
    });
    expect(observation!.outcome).toBe('budget_exhausted');
    expect(observation!.refusal).toBe('byte_budget_unenforceable');
    expect(fetched, 'fail closed: nothing is read under a budget nobody can count').toHaveLength(0);
  });

  it.each([
    ['a legacy row with no count at all', {}],
    ['a count written without the recorded marker', { bytes: 2048 }],
    ['a marked row whose count is null', { bytes: null, bytesRecorded: true }],
    ['a negative count', { bytes: -1, bytesRecorded: true }],
    ['a fractional count', { bytes: 1.5, bytesRecorded: true }],
    ['a count that is a string', { bytes: '2048', bytesRecorded: true }],
  ] as const)('%s is replayed as unsized, never as zero bytes', async (_label, facts) => {
    const meter = juliusMissionResearchMeter(await projectDurableJuliusResearchLedger(readerOf([entry(1, facts)]), RUN));
    expect(meter.counted).toBe(1);
    expect(meter.unsized).toBe(1);
    expect(meter.bytes).toBeNull();
  });

  it('a well-formed recorded row replays to exactly its count', async () => {
    const meter = juliusMissionResearchMeter(await projectDurableJuliusResearchLedger(readerOf([entry(1, { bytes: 269_680, bytesRecorded: true })]), RUN));
    expect(meter).toMatchObject({ counted: 1, unsized: 0, bytes: 269_680 });
  });
});
