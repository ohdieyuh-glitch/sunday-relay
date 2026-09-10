import { describe, expect, it } from 'vitest';
import {
  describeJuliusMissionCost,
  juliusCostComponent,
  safeJuliusCostBasis,
  summariseJuliusMissionCost,
} from './julius-cost-accounting';

/**
 * THE RUN THIS MODULE EXISTS FOR. Live Run 3 settled four components: the
 * Coding Agent reported $0.608861 from its own runtime, and the Prompt
 * Architect and both Independent Reviewer calls reported nothing at all.
 */
const LIVE_RUN_3 = [
  juliusCostComponent({ taskId: 'plan', role: 'PROMPT_ARCHITECT', basis: 'UNKNOWN' }),
  juliusCostComponent({ taskId: 'plan:review', role: 'INDEPENDENT_REVIEWER', basis: 'UNKNOWN' }),
  juliusCostComponent({ taskId: 'build', role: 'CODING_AGENT', basis: 'PROVIDER_REPORTED', usdMicros: 608_861 }),
  juliusCostComponent({ taskId: 'build:review', role: 'INDEPENDENT_REVIEWER', basis: 'UNKNOWN' }),
];

describe('Julius cross-provider cost accounting', () => {
  it('narrows a basis to the closed four and calls anything else UNKNOWN', () => {
    for (const basis of ['PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'UNKNOWN']) {
      expect(safeJuliusCostBasis(basis)).toBe(basis);
    }
    for (const nonsense of ['provider_reported', 'FREE', '', 0, null, undefined, {}, ['ESTIMATED']]) {
      expect(safeJuliusCostBasis(nonsense), `${JSON.stringify(nonsense)} is not a basis`).toBe('UNKNOWN');
    }
  });

  /**
   * A BASIS IS A CLAIM ABOUT A NUMBER. Publishing `PROVIDER_REPORTED` beside no
   * amount would assert a report nobody made, and every reader downstream would
   * count the component as accounted for.
   */
  it('demotes a basis its own data cannot support', () => {
    expect(juliusCostComponent({ taskId: 't', basis: 'PROVIDER_REPORTED' }).basis).toBe('UNKNOWN');
    expect(juliusCostComponent({ taskId: 't', basis: 'MEASURED_FROM_USAGE', usdMicros: null }).basis).toBe('UNKNOWN');
    expect(juliusCostComponent({ taskId: 't', basis: 'ESTIMATED' }).basis).toBe('UNKNOWN');
    // A negative or non-finite figure is not a cost either.
    expect(juliusCostComponent({ taskId: 't', basis: 'PROVIDER_REPORTED', usdMicros: -1 }).knownUsdMicros).toBeNull();
    expect(juliusCostComponent({ taskId: 't', basis: 'PROVIDER_REPORTED', usdMicros: Number.NaN }).knownUsdMicros).toBeNull();
  });

  /**
   * A NUMBER WITHOUT A BASIS still has a provenance: `usage.usdMicros` reaches
   * the ledger only from a provider's or a runtime's own report. Defaulting an
   * undeclared basis to UNKNOWN would have discarded the one figure Live Run 3
   * actually recorded.
   */
  it('infers an undeclared basis from the data rather than dropping the figure', () => {
    expect(juliusCostComponent({ taskId: 't', usdMicros: 100 })).toMatchObject({ basis: 'PROVIDER_REPORTED', knownUsdMicros: 100 });
    expect(juliusCostComponent({ taskId: 't', estimatedUsdMicros: 42 })).toMatchObject({ basis: 'ESTIMATED', estimatedUsdMicros: 42 });
    expect(juliusCostComponent({ taskId: 't' })).toMatchObject({ basis: 'UNKNOWN', knownUsdMicros: null, estimatedUsdMicros: null });
  });

  /** An estimate is a harness's arithmetic, and it is never money anyone was charged. */
  it('never lets an estimate reach the known total', () => {
    const cost = summariseJuliusMissionCost([
      juliusCostComponent({ taskId: 'review', role: 'INDEPENDENT_REVIEWER', basis: 'ESTIMATED', estimatedUsdMicros: 2_500 }),
    ]);
    expect(cost.knownUsdMicros, 'an estimate is not a bill').toBe(0);
    expect(cost.estimatedUsdMicros).toBe(2_500);
    // It reported no BILLED cost, so it is still an unknown component of the
    // mission's real spend — recording the estimate does not close the gap.
    expect(cost.complete).toBe(false);
    expect(cost.unknownComponents).toEqual([{ taskId: 'review', role: 'INDEPENDENT_REVIEWER' }]);
  });

  it('reports Live Run 3 as a floor with three named unknown components', () => {
    const cost = summariseJuliusMissionCost(LIVE_RUN_3);
    expect(cost.knownUsdMicros).toBe(608_861);
    expect(cost.complete, 'three of four components reported nothing').toBe(false);
    expect(cost.unknownComponents.map((component) => component.taskId))
      .toEqual(['plan', 'plan:review', 'build:review']);
    // The founder's question was per role, so the rollup answers per role.
    expect(cost.byRole).toEqual([
      { role: 'PROMPT_ARCHITECT', knownUsdMicros: 0, estimatedUsdMicros: 0, unknownComponents: 1, components: 1 },
      { role: 'INDEPENDENT_REVIEWER', knownUsdMicros: 0, estimatedUsdMicros: 0, unknownComponents: 2, components: 2 },
      { role: 'CODING_AGENT', knownUsdMicros: 608_861, estimatedUsdMicros: 0, unknownComponents: 0, components: 1 },
    ]);
  });

  /**
   * THE SENTENCE THAT CANNOT BE MISREAD. `$0.608861` written on its own is how
   * a mission with three unreported components came to look fully accounted
   * for, so the floor never appears without the words that make it one.
   */
  it('describes an incomplete total as a floor and a complete one plainly', () => {
    const incomplete = describeJuliusMissionCost(summariseJuliusMissionCost(LIVE_RUN_3));
    expect(incomplete).toContain('at least $0.608861');
    expect(incomplete).toContain('3 of 4 component(s) reported no cost');
    expect(incomplete).toContain('unknown is not zero');

    const complete = describeJuliusMissionCost(summariseJuliusMissionCost([
      juliusCostComponent({ taskId: 'build', role: 'CODING_AGENT', basis: 'PROVIDER_REPORTED', usdMicros: 608_861 }),
    ]));
    expect(complete, 'hedging a known number is its own dishonesty').not.toContain('at least');
    expect(complete).toContain('$0.608861');
  });

  it('treats an empty mission as complete, because nothing is missing', () => {
    const cost = summariseJuliusMissionCost([]);
    expect(cost).toMatchObject({ knownUsdMicros: 0, estimatedUsdMicros: 0, complete: true });
    expect(cost.unknownComponents).toEqual([]);
  });
});
