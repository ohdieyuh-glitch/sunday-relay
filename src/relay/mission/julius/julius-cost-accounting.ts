/**
 * WHAT A MISSION COST, AND HOW MUCH OF THAT IS KNOWN.
 *
 * Live Run 3 completed for a recorded $0.608861. That figure is the Coding
 * Agent's, reported by its own runtime; the Prompt Architect and both
 * Independent Reviewer calls settled their reservations with no amount at all.
 * The ledger had one column for both answers, so a mission that cost AT LEAST
 * sixty-one cents reads as a mission that cost EXACTLY sixty-one cents, and
 * every summary built on it inherits the mistake — `summariseJuliusEvals`
 * filtered the nulls out and summed the rest into a field called
 * `totalUsdMicros`, then divided it by the completions to publish a cost per
 * verified completion nobody could stand behind.
 *
 * The rule this module exists to hold is one sentence: A COST NOBODY REPORTED
 * IS NOT A COST OF ZERO. It is not added, it is not dropped, and it is not
 * quietly rounded into the total — it is COUNTED, so the total always arrives
 * beside the number of components that could not contribute to it.
 *
 * The second rule is nearly as short: A HARNESS'S ESTIMATE IS NOT A BILLING
 * FIGURE. Hermes computes an `estimated_cost` from token counts and its own
 * price table, which is worth recording and is not what anyone was charged, so
 * it is summed on its own axis and never into the known total.
 *
 * Pure: no clock, no Node, no store. The browser and the CLI reach the same
 * conclusion about the same components, and the evidence bundle can be read
 * against it offline.
 */

/**
 * HOW A COST CAME TO BE KNOWN, in the order of how much it can be trusted.
 *
 * `PROVIDER_REPORTED` — the provider or its runtime stated an amount it
 * billed. The only basis this repository treats as spend.
 * `MEASURED_FROM_USAGE` — computed from token counts the boundary reported
 * against a price recorded at the time. Also spend, and nothing produces one
 * yet: there is no price table, and inventing one to fill this column is
 * exactly what the module forbids.
 * `ESTIMATED` — a harness's own arithmetic. Recorded, reported, never summed
 * into the known total.
 * `RESERVED_UNSETTLED` — money is HELD and no settlement has arrived yet. Not
 * a spend and not an absence: a dispatch that is still running, or one whose
 * settlement was lost to a crash. It exists so the slot ledger can say "this
 * mission is holding $3 it has not accounted for" rather than either counting
 * it as spent or letting it read as free.
 * `UNKNOWN` — a settlement arrived and reported nothing. Not zero.
 * `NOT_APPLICABLE` — there is NO billing event to report, because the dispatch
 * was not billed through a metered provider account at all. A subscription-backed
 * worker is the case that needs it: the work happened, the provider is unchanged,
 * and no per-request charge exists anywhere to be read.
 *
 * `NOT_APPLICABLE` IS NOT `UNKNOWN` AND IT IS CERTAINLY NOT ZERO. `UNKNOWN` says a
 * charge exists and we failed to learn it, which would make a reader keep looking.
 * A recorded `0` would assert that a billing event happened and cost nothing, which
 * is the manufactured figure this module exists to refuse. Neither is true of a
 * subscription dispatch, so it gets its own word — and like every basis outside
 * `SPEND_BASES` it can never be summed into money anyone was charged.
 */
export const JULIUS_COST_BASES = [
  'PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'RESERVED_UNSETTLED', 'UNKNOWN', 'NOT_APPLICABLE',
] as const;
export type JuliusCostBasis = (typeof JULIUS_COST_BASES)[number];

/** The two bases that describe money someone was actually charged. */
const SPEND_BASES: readonly JuliusCostBasis[] = ['PROVIDER_REPORTED', 'MEASURED_FROM_USAGE'];

/** A basis from the closed set, or `UNKNOWN`. A word nobody defined is not a basis. */
export const safeJuliusCostBasis = (value: unknown): JuliusCostBasis =>
  typeof value === 'string' && (JULIUS_COST_BASES as readonly string[]).includes(value)
    ? value as JuliusCostBasis
    : 'UNKNOWN';

/**
 * HOW A DISPATCH WAS PAID FOR — a different question from what it cost.
 *
 * `API_BILLED` — a metered provider account was charged per request: an API key.
 * `SUBSCRIPTION` — a flat subscription carried the work, as the founder's Claude
 * Max plan carries the Coding Agent in `CLAUDE_SUBSCRIPTION` mode; no per-request
 * charge exists. `NOT_APPLICABLE` — no billing of any kind applies. `UNKNOWN` —
 * nobody can say.
 *
 * DECIDED FROM THE CREDENTIAL, NEVER FROM AN AMOUNT. Only the adapter that
 * resolved the credential knows which one it used, so it says; `SUBSCRIPTION` is
 * never inferred from a `NOT_APPLICABLE` cost basis, which is the wider claim.
 */
export const JULIUS_BILLING_PATHS = ['API_BILLED', 'SUBSCRIPTION', 'NOT_APPLICABLE', 'UNKNOWN'] as const;
export type JuliusBillingPath = (typeof JULIUS_BILLING_PATHS)[number];

/**
 * A billing path that agrees with its settlement's cost basis, or null.
 *
 * A word nobody defined is not a path, and a CONTRADICTION IS NOT RECORDED: a
 * subscription or "no billing" beside anything but `NOT_APPLICABLE` would claim
 * there is no charge while the basis claims there is one (or one nobody read), and
 * an API bill beside `NOT_APPLICABLE` claims the reverse. Two claims that cannot
 * both be true leave a reader guessing, so neither is written.
 */
export function consistentJuliusBillingPath(path: unknown, basis: JuliusCostBasis): JuliusBillingPath | null {
  if (typeof path !== 'string' || !(JULIUS_BILLING_PATHS as readonly string[]).includes(path)) return null;
  const billingPath = path as JuliusBillingPath;
  if ((billingPath === 'SUBSCRIPTION' || billingPath === 'NOT_APPLICABLE') && basis !== 'NOT_APPLICABLE') return null;
  if (billingPath === 'API_BILLED' && basis === 'NOT_APPLICABLE') return null;
  return billingPath;
}

const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** What one dispatch cost, and on whose authority. */
export interface JuliusCostComponent {
  readonly taskId: string;
  /** The C.A.R.D. role that spent it, or null when the record does not say. */
  readonly role: string | null;
  readonly basis: JuliusCostBasis;
  /** Money someone was charged. Null unless the basis is a spend basis. */
  readonly knownUsdMicros: number | null;
  /** A harness's own figure. Null unless the basis is `ESTIMATED`. */
  readonly estimatedUsdMicros: number | null;
}

/**
 * ONE SETTLEMENT, NORMALISED — and the place the two ways a caller can lie to
 * itself are caught.
 *
 * A BASIS IS A CLAIM ABOUT A NUMBER, so a basis without its number is demoted
 * to `UNKNOWN` rather than published. `PROVIDER_REPORTED` beside a null amount
 * would assert that a provider reported something it did not, and every reader
 * downstream would count the component as accounted for.
 *
 * A NUMBER WITHOUT A BASIS still has a provenance, and in this runtime it is
 * always the same one: `usage.usdMicros` reaches the ledger only from a
 * provider's or a runtime's own report. So an undeclared basis is INFERRED
 * from the data rather than defaulted to `UNKNOWN` — which would have thrown
 * away the one figure Live Run 3 did record.
 */
export function juliusCostComponent(input: {
  readonly taskId: string;
  readonly role?: string | null;
  readonly basis?: unknown;
  /** What the boundary reported as billed, if anything. */
  readonly usdMicros?: unknown;
  /** What a harness estimated, if anything. */
  readonly estimatedUsdMicros?: unknown;
}): JuliusCostComponent {
  const role = typeof input.role === 'string' && input.role.trim() !== '' ? input.role : null;
  const known = amount(input.usdMicros);
  const estimated = amount(input.estimatedUsdMicros);
  const declared = input.basis === undefined || input.basis === null
    // Nothing declared: read it off the data, in the order of trust.
    ? (known !== null ? 'PROVIDER_REPORTED' : estimated !== null ? 'ESTIMATED' : 'UNKNOWN')
    : safeJuliusCostBasis(input.basis);
  if (SPEND_BASES.includes(declared) && known !== null) {
    return { taskId: input.taskId, role, basis: declared, knownUsdMicros: known, estimatedUsdMicros: null };
  }
  if (declared === 'ESTIMATED' && estimated !== null) {
    return { taskId: input.taskId, role, basis: 'ESTIMATED', knownUsdMicros: null, estimatedUsdMicros: estimated };
  }
  /**
   * NO BILLING EVENT EXISTS, AND THE WORD SAYS SO.
   *
   * A subscription-backed dispatch declares `NOT_APPLICABLE`. This branch used to
   * be missing, so the declaration fell through to the line below and every
   * durable settlement of a subscription dispatch was written as `UNKNOWN` — a
   * charge that exists and was not read, which is the one thing it is not. It
   * keeps its own word now, and carries no amount of either kind: any figure that
   * travelled beside it is the runtime's PRICE, never a bill, so it is dropped here
   * rather than summed into anything.
   */
  if (declared === 'NOT_APPLICABLE') {
    return { taskId: input.taskId, role, basis: 'NOT_APPLICABLE', knownUsdMicros: null, estimatedUsdMicros: null };
  }
  // A claim its own data cannot support. Unknown, and said so.
  return { taskId: input.taskId, role, basis: 'UNKNOWN', knownUsdMicros: null, estimatedUsdMicros: null };
}

/** What one role cost across a mission. Same rules, one role at a time. */
export interface JuliusRoleCost {
  readonly role: string | null;
  readonly knownUsdMicros: number;
  readonly estimatedUsdMicros: number;
  readonly unknownComponents: number;
  readonly components: number;
}

export interface JuliusMissionCost {
  /** Every component, normalised, in the order given. */
  readonly components: readonly JuliusCostComponent[];
  /** The sum of what providers reported. A FLOOR whenever `complete` is false. */
  readonly knownUsdMicros: number;
  /** The sum of what harnesses estimated. Never added to the known total. */
  readonly estimatedUsdMicros: number;
  /** The components that reported nothing, named so they can be chased. */
  readonly unknownComponents: readonly { readonly taskId: string; readonly role: string | null }[];
  /** True only when every component reported a spend basis with a figure. */
  readonly complete: boolean;
  /** The same arithmetic per role, so the four workers are separable. */
  readonly byRole: readonly JuliusRoleCost[];
}

/**
 * The mission's cost, with the unknown part kept in view rather than summed
 * away. `knownUsdMicros` is never the answer on its own: read it with
 * `complete`, or through {@link describeJuliusMissionCost}, which cannot state
 * one without the other.
 */
export function summariseJuliusMissionCost(
  components: readonly JuliusCostComponent[],
): JuliusMissionCost {
  const unknownComponents = components
    .filter((component) => component.knownUsdMicros === null)
    .map((component) => ({ taskId: component.taskId, role: component.role }));
  const roles = new Map<string | null, JuliusRoleCost>();
  for (const component of components) {
    const current = roles.get(component.role)
      ?? { role: component.role, knownUsdMicros: 0, estimatedUsdMicros: 0, unknownComponents: 0, components: 0 };
    roles.set(component.role, {
      role: component.role,
      knownUsdMicros: current.knownUsdMicros + (component.knownUsdMicros ?? 0),
      estimatedUsdMicros: current.estimatedUsdMicros + (component.estimatedUsdMicros ?? 0),
      unknownComponents: current.unknownComponents + (component.knownUsdMicros === null ? 1 : 0),
      components: current.components + 1,
    });
  }
  return {
    components,
    knownUsdMicros: components.reduce((total, component) => total + (component.knownUsdMicros ?? 0), 0),
    estimatedUsdMicros: components.reduce((total, component) => total + (component.estimatedUsdMicros ?? 0), 0),
    unknownComponents,
    // An empty mission is complete: nothing was spent and nothing is missing.
    complete: unknownComponents.length === 0,
    byRole: [...roles.values()],
  };
}

/**
 * THE SENTENCE THAT CANNOT BE MISREAD, because writing the total on its own is
 * how `$0.608861` came to stand for a mission with three unreported components.
 *
 * "at least" is not decoration: it is the only honest word for a floor, and it
 * appears whenever anything is unknown. A complete mission gets a plain figure
 * and no hedge, because hedging a known number is its own dishonesty.
 */
export function describeJuliusMissionCost(cost: JuliusMissionCost): string {
  const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(6)}`;
  const estimate = cost.estimatedUsdMicros > 0
    ? `, plus ${usd(cost.estimatedUsdMicros)} estimated by a harness rather than billed`
    : '';
  if (cost.complete) return `${usd(cost.knownUsdMicros)} across ${String(cost.components.length)} component(s)${estimate}.`;
  return `at least ${usd(cost.knownUsdMicros)}${estimate}; `
    + `${String(cost.unknownComponents.length)} of ${String(cost.components.length)} component(s) reported no cost, `
    + 'and unknown is not zero.';
}
