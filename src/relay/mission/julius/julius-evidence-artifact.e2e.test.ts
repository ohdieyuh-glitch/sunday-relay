import { describe, expect, it } from 'vitest';

import { cardPolicy, createJuliusHarness, task, verificationPolicy, worker, type JuliusHarness } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * WHAT A WORKER CLAIMS ABOUT AN ARTIFACT, AND WHAT THE RECORD KEEPS.
 *
 * Both durable columns were taken verbatim from the provider: any string
 * became the artifact reference of record, and any string became the integrity
 * hash. The live adapters then filled the reference with a key into a `Map`
 * that lives in one process — `plan:<runId>` — and left the hash NULL while
 * computing the digest and burying sixteen characters of it in prose.
 *
 * A reference is kept only when it names something that outlives the process
 * that wrote it. A hash is kept only when it is one. Everything else is null,
 * which is the runtime's existing answer for a fact nobody can establish.
 */

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const DIGEST = 'b'.repeat(64);
const capabilityFor = () => 'plan';

const build = (evidence: readonly Record<string, unknown>[]): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [{
      worker: worker({
        workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai',
        adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'],
      }),
      script: [{ kind: 'succeed', evidence }],
    }],
    card: cardPolicy({ allowedProviders: ['openai'], capabilities: ['plan'] }),
    verification: verificationPolicy({ reviewerRequired: false }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  return harness;
};

const recorded = async (evidence: readonly Record<string, unknown>[]) => {
  const harness = build(evidence);
  await harness.loop.tick({ projectId: 'prj-1' });
  return harness.store.evidenceForRun('run-1', 'prj-1');
};

const ARTIFACT = { type: 'ARTIFACT', status: 'PASSED', safeSummary: 'A plan.' };

describe('the artifact reference a worker supplies', () => {
  it('is kept when it names something durable', async () => {
    const [row] = await recorded([{ ...ARTIFACT, artifactRef: 'artifact:plan-1' }]);
    expect(row?.artifactRef).toBe('artifact:plan-1');
  });

  it('is DROPPED when it is a key into the process that wrote it', async () => {
    // The exact value the live Prompt Architect used to record.
    const [row] = await recorded([{ ...ARTIFACT, artifactRef: 'plan:run-1' }]);
    expect(row?.artifactRef, 'a durable row must not point at a Map that dies with the process').toBeNull();
    expect(row, 'and the evidence itself is still recorded').toBeDefined();
  });

  it('is DROPPED for every other shape a provider might send', async () => {
    for (const artifactRef of ['../../etc/passwd', 'https://example.test/x', '', 'artifact:a b', 42, null]) {
      const [row] = await recorded([{ ...ARTIFACT, artifactRef }]);
      expect(row?.artifactRef, JSON.stringify(artifactRef)).toBeNull();
    }
  });
});

describe('the integrity hash a worker supplies', () => {
  it('is kept when it is a digest', async () => {
    const [row] = await recorded([{ ...ARTIFACT, integrityHash: DIGEST }]);
    expect(row?.integrityHash).toBe(DIGEST);
  });

  it('is DROPPED when it is not one, however plausible', async () => {
    for (const integrityHash of [DIGEST.slice(0, 16), `sha256:${DIGEST}`, DIGEST.toUpperCase(), 'unknown', '', 7, null]) {
      const [row] = await recorded([{ ...ARTIFACT, integrityHash }]);
      expect(row?.integrityHash, JSON.stringify(integrityHash)).toBeNull();
    }
  });

  it('is independent of the reference: a body can be identified with nowhere durable to keep it', async () => {
    const [row] = await recorded([{ ...ARTIFACT, integrityHash: DIGEST, artifactRef: 'plan:run-1' }]);
    expect(row?.integrityHash, 'the digest survives the process').toBe(DIGEST);
    expect(row?.artifactRef, 'the pointer does not').toBeNull();
  });
});

describe('the dispatch says which attempt is running', () => {
  /**
   * An adapter cannot scope a body to the attempt that produced it without
   * knowing which attempt that is. The claim has always fenced it; until now
   * the dispatch did not carry it, which is why a repair round overwrote the
   * round before it.
   */
  it('carries a real fencing token, and a different one for the next attempt', async () => {
    // The first attempt fails in a way Julius retries, so the same task runs
    // twice — which is exactly the case a per-run artifact key could not tell
    // apart.
    const harness = createJuliusHarness({
      workers: [{
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai',
          adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'],
        }),
        script: [{ kind: 'fail', code: 'RATE_LIMIT' }, { kind: 'succeed', evidence: [{ ...ARTIFACT, integrityHash: DIGEST }] }],
      }],
      card: cardPolicy({ allowedProviders: ['openai'], capabilities: ['plan'] }),
      verification: verificationPolicy({ reviewerRequired: false }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));

    for (let index = 0; index < 6; index += 1) {
      await harness.loop.tick({ projectId: 'prj-1' });
      harness.clock.advance(60_000);
    }

    const generations = harness.adapters.get('architect-adapter')!.dispatches.map((dispatch) => dispatch.attempt?.leaseGeneration);
    expect(generations.length, 'the task ran more than once').toBeGreaterThan(1);
    for (const generation of generations) {
      expect(generation, 'every dispatch is told which attempt it is').toEqual(expect.any(Number));
      expect(generation!).toBeGreaterThan(0);
    }
    expect(new Set(generations).size, 'and two attempts are never told the same thing').toBe(generations.length);
  });
});

describe('the result row says what it cited', () => {
  it('names the evidence of that attempt, not an empty list', async () => {
    const harness = build([{ ...ARTIFACT, integrityHash: DIGEST }, { type: 'ARTIFACT', status: 'PASSED', safeSummary: 'And another.' }]);
    const cited: string[][] = [];
    const store = harness.store;
    const watched = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'acceptWorkerResult') return Reflect.get(target, property, receiver);
        return async (input: { evidenceIds: readonly string[] }) => {
          cited.push([...input.evidenceIds]);
          return (Reflect.get(target, property, receiver) as (value: unknown) => unknown)(input);
        };
      },
    }) as JuliusHarness['store'];

    const observed = createJuliusHarness({
      workers: [{
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai',
          adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'],
        }),
        script: [{ kind: 'succeed', evidence: [{ ...ARTIFACT, integrityHash: DIGEST }, { type: 'ARTIFACT', status: 'PASSED', safeSummary: 'And another.' }] }],
      }],
      card: cardPolicy({ allowedProviders: ['openai'], capabilities: ['plan'] }),
      verification: verificationPolicy({ reviewerRequired: false }),
      capabilityFor,
      store: watched,
    });
    observed.store.seedRun(RUN);
    observed.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    await observed.loop.tick({ projectId: 'prj-1' });

    const rows = await observed.store.evidenceForRun('run-1', 'prj-1');
    expect(rows.length, 'two pieces of evidence were written').toBe(2);
    expect(cited, 'and the result row cited exactly those, rather than claiming it cited none')
      .toEqual([rows.map((row) => row.evidenceId)]);
  });
});
