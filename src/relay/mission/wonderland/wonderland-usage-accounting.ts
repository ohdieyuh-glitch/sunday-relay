/**
 * WHICH METER A UNIT OF WORK BELONGS TO, and why it can only be one.
 *
 * The HUD has two channels and they are not a split of one number. GREEN is the
 * Compound AI Agent — Julius orchestrating its worker slots. BLUE is a single
 * agent working alone. A founder reads them as separate instruments with
 * separate ceilings, so putting the same spend in both would not merely
 * double a total; it would tell them they had used capacity on a tier they
 * never touched.
 *
 * THE RULE, IN ONE SENTENCE: attribution follows the ORCHESTRATOR, not the
 * worker.
 *
 * That is the whole boundary, and it is chosen because it is the only reading
 * that cannot double-count. A single model does the work in both cases — a
 * Coding Agent slot inside a Compound Agent is one model, and an imported
 * coding-agent sidekick is one model — so attributing by WHO DID THE WORK
 * would put the same activity in both channels and there would be no principled
 * way to choose. Attributing by WHAT ORCHESTRATED IT is unambiguous: a unit of
 * work has exactly one orchestrator, or none, and never two.
 *
 *   GREEN, compound      work Julius orchestrated. Every worker slot's spend
 *                        inside a run belongs here, including the Coding
 *                        Agent's — the founder bought a Compound Agent and the
 *                        slots are what it is made of
 *   BLUE, single         work an agent did outside any orchestration
 *   NEITHER              work that cannot be attributed. It is REPORTED, never
 *                        assigned, and it is why `partial` exists
 *
 * WHY `partial` IS A READING AND NOT A ROUNDING. If Julius reports spend it
 * cannot attribute, the tempting move is to put it in green — orchestration is
 * the common case, so the guess is usually right. Usually-right is exactly the
 * wrong standard for a number about money: a founder cannot tell a guessed
 * figure from a measured one, and the first time the guess is wrong they are
 * looking at a meter that is confidently incorrect. Unattributed units make the
 * reading `partial` and are counted separately, so the HUD can say that
 * something is missing instead of quietly absorbing it.
 *
 * NOT IMPLEMENTED HERE, deliberately: /MAS clones, imported sidekicks, multiple
 * Julius instances and future C.A.R.D. shapes. The contract is built so each of
 * them lands somewhere honest — a second Julius is a second orchestrator and
 * therefore its own compound total; a sidekick has no orchestrator and is
 * single — but none of them is built in this pass.
 */

import { exactKeys } from './wonderland-contracts';
import { WONDERLAND_USAGE_CHANNELS } from './wonderland-usage-meter';
import type { WonderlandUsageChannel } from './wonderland-usage-meter';
import type { WonderlandWorkerRole } from './wonderland-envelope';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_ACCOUNTING_SCHEMA_V1 = 'relay-wonderland-accounting.v1' as const;
export type WonderlandAccountingSchemaVersion = typeof WONDERLAND_ACCOUNTING_SCHEMA_V1;

/* ---------------------------------------------------------- attribution */

/**
 * WHAT ORCHESTRATED A UNIT OF WORK.
 *
 * `unattributed` is ordinal 0 and that is the safe default: a record nobody
 * filled in has not been attributed to anything, and defaulting it to compound
 * would put unexplained spend on a founder's main meter.
 */
export const WONDERLAND_USAGE_ATTRIBUTIONS = [
  'unattributed',
  'compound_orchestrated',
  'single_agent',
] as const;
export type WonderlandUsageAttribution = (typeof WONDERLAND_USAGE_ATTRIBUTIONS)[number];

/** The channel an attribution draws into, or null when it draws into neither. */
export const WONDERLAND_ATTRIBUTION_CHANNEL: Readonly<
  Record<WonderlandUsageAttribution, WonderlandUsageChannel | null>
> = Object.freeze({
  unattributed: null,
  compound_orchestrated: 'compound_agent',
  single_agent: 'single_agent',
});

/**
 * One piece of spend, with the identity that justifies where it goes.
 *
 * `units` is deliberately unnamed as to kind. Tokens, credits, dollars and
 * "wonder" are all the authority's business; this module decides WHICH METER,
 * never what a unit is worth, and a module that knew would be one refactor away
 * from inventing a price.
 */
export interface WonderlandUsageActivity {
  readonly units: number;
  /** The Julius instance that orchestrated it, when one did. */
  readonly orchestratorId: string | null;
  readonly runId: string | null;
  /** Which slot acted. Present only inside an orchestration. */
  readonly workerRole: WonderlandWorkerRole | null;
  /** An agent working alone. Mutually exclusive with an orchestrator. */
  readonly soloAgentId: string | null;
}

export const WONDERLAND_USAGE_ACTIVITY_FIELDS = exactKeys<WonderlandUsageActivity>()([
  'units',
  'orchestratorId',
  'runId',
  'workerRole',
  'soloAgentId',
]);

/**
 * Decide where a unit of work belongs. THE ONLY PLACE THAT DECIDES.
 *
 * An activity claiming both an orchestrator and a solo agent is CONTRADICTORY,
 * not a preference to resolve. Picking one would be this module choosing which
 * of two contradictory claims to believe about someone's money; the honest
 * answer is that the record is unusable and the units are unattributed.
 */
export function attributeWonderlandUsage(
  activity: WonderlandUsageActivity,
): WonderlandUsageAttribution {
  const orchestrated = activity.orchestratorId !== null || activity.runId !== null;
  const solo = activity.soloAgentId !== null;
  if (orchestrated && solo) return 'unattributed';
  if (orchestrated) return 'compound_orchestrated';
  if (solo) return 'single_agent';
  // A worker role with no orchestration behind it names a slot of something
  // that was never identified. It is evidence, not attribution.
  return 'unattributed';
}

/* -------------------------------------------------------------- the total */

export interface WonderlandUsageAccount {
  readonly schemaVersion: WonderlandAccountingSchemaVersion;
  /** Units attributed to each channel. Never overlapping. */
  readonly compoundUnits: number;
  readonly singleUnits: number;
  /** Units nothing could attribute. Reported, never assigned. */
  readonly unattributedUnits: number;
  readonly activitiesCounted: number;
  readonly activitiesUnattributed: number;
  /** Records refused outright: negative, non-finite, or self-contradictory. */
  readonly activitiesRefused: number;
  /** True when anything was left out, so a surface can say so. */
  readonly partial: boolean;
}

export const WONDERLAND_USAGE_ACCOUNT_FIELDS = exactKeys<WonderlandUsageAccount>()([
  'schemaVersion',
  'compoundUnits',
  'singleUnits',
  'unattributedUnits',
  'activitiesCounted',
  'activitiesUnattributed',
  'activitiesRefused',
  'partial',
]);

export const EMPTY_WONDERLAND_USAGE_ACCOUNT: WonderlandUsageAccount = Object.freeze({
  schemaVersion: WONDERLAND_ACCOUNTING_SCHEMA_V1,
  compoundUnits: 0,
  singleUnits: 0,
  unattributedUnits: 0,
  activitiesCounted: 0,
  activitiesUnattributed: 0,
  activitiesRefused: 0,
  partial: false,
});

/**
 * Total a list of activities into the two channels.
 *
 * EVERY ACTIVITY LANDS IN EXACTLY ONE PLACE — one channel, the unattributed
 * pile, or refused — which is what makes double-counting structurally
 * impossible rather than merely avoided by care. A test asserts the arithmetic
 * closes over arbitrary input.
 *
 * A NEGATIVE OR NON-FINITE FIGURE IS REFUSED, not clamped. Clamping a negative
 * to zero silently absorbs whatever produced it, and a meter that quietly
 * absorbs bad arithmetic about money is worse than one that says a record was
 * unusable.
 */
export function accountWonderlandUsage(
  activities: readonly WonderlandUsageActivity[],
): WonderlandUsageAccount {
  let compoundUnits = 0;
  let singleUnits = 0;
  let unattributedUnits = 0;
  let counted = 0;
  let unattributedCount = 0;
  let refused = 0;

  for (const activity of activities) {
    if (!Number.isFinite(activity.units) || activity.units < 0) {
      refused += 1;
      continue;
    }
    const attribution = attributeWonderlandUsage(activity);
    const channel = WONDERLAND_ATTRIBUTION_CHANNEL[attribution];
    if (channel === 'compound_agent') {
      compoundUnits += activity.units;
      counted += 1;
    } else if (channel === 'single_agent') {
      singleUnits += activity.units;
      counted += 1;
    } else {
      unattributedUnits += activity.units;
      unattributedCount += 1;
    }
  }

  return Object.freeze({
    schemaVersion: WONDERLAND_ACCOUNTING_SCHEMA_V1,
    compoundUnits,
    singleUnits,
    unattributedUnits,
    activitiesCounted: counted,
    activitiesUnattributed: unattributedCount,
    activitiesRefused: refused,
    // Anything left out makes the whole account partial. A surface that showed
    // two confident meters beside a silently dropped record would be presenting
    // an incomplete total as a complete one.
    partial: unattributedCount > 0 || refused > 0,
  });
}

/**
 * Units for one channel, or null when the account cannot support the claim.
 *
 * Null rather than the running subtotal when the account is partial: a subtotal
 * that omits unattributed spend is not a smaller true number, it is a number
 * whose meaning depends on what was left out. `UNKNOWN` is the honest reading
 * and the HUD already draws it.
 */
export function wonderlandChannelUnits(
  account: WonderlandUsageAccount,
  channel: WonderlandUsageChannel,
): number | null {
  if (account.partial) return null;
  return channel === 'compound_agent' ? account.compoundUnits : account.singleUnits;
}

/** Both channels at once, in the contract's own order. */
export const wonderlandAccountByChannel = (
  account: WonderlandUsageAccount,
): Readonly<Record<WonderlandUsageChannel, number | null>> =>
  Object.freeze(
    Object.fromEntries(
      WONDERLAND_USAGE_CHANNELS.map((channel) => [channel, wonderlandChannelUnits(account, channel)]),
    ) as Record<WonderlandUsageChannel, number | null>,
  );
