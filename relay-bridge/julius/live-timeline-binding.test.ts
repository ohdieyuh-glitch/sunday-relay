import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createJuliusPostgresRuntimeStore } from './postgres-store';
import { createContextAndClaimHandoffs } from './live-composition';

/**
 * THE CAPABILITY THAT EXISTED, WORKED, AND WAS BOUND TO NOTHING.
 *
 * `JuliusTimelinePostgresRepository` implements `JuliusTimelineReader` against
 * the real events table. Its only references in the whole repository were its
 * own declaration and the barrel that exports it. No production caller.
 *
 * That mattered because BOTH consumers of a timeline reader are bound behind a
 * structural probe — `typeof store.timeline === 'function'` — and the live
 * store returned no such method:
 *
 *   - `durableLedger` on the research mediator, which rebuilds a slot's
 *     retrieval spend from the run's own rows. Unbound, the mediator keeps an
 *     in-process Map, so a bridge restart forgets what every slot has already
 *     spent. The durable projection was built precisely to close that, and in
 *     production it was never reached.
 *   - `deps.timeline` on the pipeline, which projects the per-slot money ledger
 *     from `budget.reserved` and `budget.settled`. Unbound, allocation falls
 *     back to counting rounds off the task rows — a lower bound that cannot
 *     tell an open reservation from one settled for less, and says so in its
 *     own basis.
 *
 * WHY NO EXISTING TEST CAUGHT IT. The store factory's own comment leans on
 * `julius-store-conformance.test.ts`: "if a port method is added without a
 * repository implementing it, the conformance test fails." True, and it cannot
 * apply here — `JuliusTimelineReader` is not part of `JuliusRuntimeStore`, so
 * there was no required port to be missing. A conformance test proves the
 * REQUIRED surface and is silent about an optional capability, which is exactly
 * the kind that gets dropped.
 *
 * These cases are about the binding, not about the SQL: the repository's own
 * behaviour against a real database is `julius-live-chain.e2e.test.ts`'s. What
 * is proven here is that production asks it anything at all.
 */

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/** A pool that is never queried: nothing here executes SQL. */
const pool = { query: async () => { throw new Error('no query is made in these cases'); } } as never;

describe('A — the live store serves its own timeline', () => {
  it('1. the method exists on the composed production store', () => {
    const store = createJuliusPostgresRuntimeStore(pool);
    expect(typeof (store as { timeline?: unknown }).timeline,
      'the live store answers the probe both consumers are gated on').toBe('function');
  });

  it('2. and it is in the RETURN TYPE, not left to a structural probe', () => {
    // A probe fails quietly; a declared method that goes missing fails at the
    // type. This is what makes the next optional capability impossible to drop
    // the same way.
    const source = read('relay-bridge/julius/postgres-store.ts');
    const signature = source.slice(source.indexOf('export function createJuliusPostgresRuntimeStore'));
    const head = signature.slice(0, signature.indexOf('{'));
    expect(head).toContain('JuliusTimelineReader');
  });

  it('3. it is the real repository, not a stub that answers empty', () => {
    const source = read('relay-bridge/julius/postgres-store.ts');
    expect(source).toContain('JuliusTimelinePostgresRepository');
    expect(source).toContain('timeline: timeline.timeline.bind(timeline)');
    // AND NOT AN EMPTY ANSWER. A reader that returned no entries would satisfy
    // the probe, bind both consumers, and rebuild every ledger as zero — worse
    // than not binding at all, because the fallbacks at least say they are
    // conservative.
    expect(source).not.toContain('entries: []');
  });

  it('4. the handoffs wrapper the entrypoint composes does not drop it', () => {
    // `createContextAndClaimHandoffs` is what the live entrypoint actually hands
    // to the runtime. It wraps the store to intercept two methods; if it
    // rebuilt the object instead of spreading it, the capability would be lost
    // one line after being bound.
    const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
    expect(typeof (handoffs.store as { timeline?: unknown }).timeline).toBe('function');
  });
});

describe('B — the two consumers that were gated on it', () => {
  it('5. BOTH consumers are gated on the probe, and each one is still behind it', () => {
    /**
     * COUNTED, NOT MERELY PRESENT. The probe appears once per consumer, so an
     * assertion that the string exists somewhere would survive one of them
     * being replaced by a literal — the other occurrence would satisfy it while
     * that consumer became unreachable. Both sites are checked, and each is
     * matched to the consumer that follows it.
     */
    const source = read('relay-bridge/julius/live-composition.ts');
    const gate = "typeof (options.store as { timeline?: unknown }).timeline === 'function'";
    const sites: number[] = [];
    for (let at = source.indexOf(gate); at >= 0; at = source.indexOf(gate, at + 1)) sites.push(at);
    expect(sites, 'one probe per consumer, and no consumer without one').toHaveLength(2);

    const followed = sites.map((at) => source.slice(at, at + 240));
    expect(followed.filter((block) => block.includes('durableLedger:')),
      'the durable research ledger is behind a probe').toHaveLength(1);
    expect(followed.filter((block) => block.includes('timeline: options.store as unknown as JuliusTimelineReader')),
      'the pipeline timeline is behind a probe').toHaveLength(1);
  });

  it('6. and neither is behind a literal that can never be false', () => {
    // The shape this whole file exists to prevent: a capability bound in a
    // branch nothing takes. A `false` gate reads as deliberate and is
    // indistinguishable from the state before the binding.
    const source = read('relay-bridge/julius/live-composition.ts');
    expect(source).not.toContain('...(false');
    expect(source).not.toContain('...(true');
  });

  it('7. the projection refuses rather than inventing when nothing is bound', () => {
    // The fallbacks are correct and were never the defect: a null projection
    // makes allocation report a conservative basis instead of a total it cannot
    // support. What was wrong was reaching them in production.
    const pipeline = read('src/relay/mission/julius/julius-task-pipeline.ts');
    expect(pipeline).toContain('if (deps.timeline === undefined) return null;');
  });

  it('8a. the harness map no longer declares it uncomposed', () => {
    /**
     * THE MAP SAID SO ITSELF. `scripts/export-julius-harness.mjs` carried this
     * file in its "not composed" list — "a read model no live surface consumes
     * yet" — which was an accurate record of the defect, kept as a deliberate
     * declaration. The export refuses a declaration for a file a root actually
     * reaches, so binding it failed the harness check until the line came out.
     * That refusal is why the map can be trusted at all.
     */
    const exporter = read('scripts/export-julius-harness.mjs');
    expect(exporter, 'the stale declaration is gone').not.toContain('julius-timeline-postgres.ts');
    const manifest = read('JULIUS_HARNESS_MANIFEST.md');
    expect(manifest, 'and the generated map now carries it as production')
      .toContain('julius-timeline-postgres.ts');
  });

  it('8. the repository has a production caller now, which it did not', () => {
    // The shape #254 found on `buildJuliusSlotMissionReport` and Blocker 5
    // found on governed research: complete machinery, proven by tests that
    // supply their own binding, reached by nothing that ships.
    const callers = ['relay-bridge/julius/postgres-store.ts']
      .filter((file) => read(file).includes('JuliusTimelinePostgresRepository'));
    expect(callers, 'a production composition constructs it').not.toHaveLength(0);
  });
});

/**
 * AND A PAID RUN WITHOUT IT DOES NOT START.
 *
 * Paid run 34739303313 ran on a main whose store had no reader: every dispatch
 * was allocated the flat 300 000 µ$ estimate and the Coding Agent stopped at its
 * own $0.30 ceiling after two turns. Binding the reader fixes that store; these
 * cases make its ABSENCE a refusal rather than a silent fallback, on both the
 * preflight and the confirmed-live path, and hold the workflow to the answer.
 */
describe('C — no live ledger, no paid run', () => {
  it('the entrypoint reports BOUND for the production store and UNBOUND for anything without a reader', async () => {
    const { liveLedgerState } = await import('../julius-live-mission');
    expect(liveLedgerState(createJuliusPostgresRuntimeStore(pool))).toBe('BOUND');
    expect(liveLedgerState(createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store), 'the handoff wrapper keeps it').toBe('BOUND');
    const { timeline: _dropped, ...withoutReader } = createJuliusPostgresRuntimeStore(pool) as unknown as Record<string, unknown>;
    expect(liveLedgerState(withoutReader)).toBe('UNBOUND');
    expect(liveLedgerState({ timeline: 'not a function' })).toBe('UNBOUND');
    expect(liveLedgerState(null)).toBe('UNBOUND');
  });

  it('preflight blocks on UNBOUND, and the live path refuses the wrapped store before bootstrap', () => {
    const source = read('relay-bridge/julius-live-mission.ts');
    expect(source).toContain("out(`  live_ledger: ${ledger}`);");
    expect(source, 'an unbound ledger is a preflight block').toMatch(/\|\| ledger === 'UNBOUND';/u);
    const refusal = source.indexOf("if (liveLedgerState(handoffs.store) !== 'BOUND') {");
    expect(refusal, 'the live path asks the store the runtime will receive').toBeGreaterThan(-1);
    expect(refusal, 'and asks before the run is bootstrapped').toBeLessThan(source.indexOf('const bootstrapRuns = new JuliusPostgresRepository(pool);'));
  });

  it('the paid workflow accepts nothing but BOUND before the LIVE step', () => {
    const workflow = read('.github/workflows/julius-first-live-mission.yml');
    const check = workflow.indexOf("grep -qx '  live_ledger: BOUND' preflight-roles.log");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(workflow.indexOf("- name: 'LIVE: run the first real Julius mission'"));
  });
});
