/**
 * THE RUNTIME'S OWN SPEND CEILINGS.
 *
 * `scripts/julius-live-contract-check.mjs` refuses a contract above the
 * namespace grant, and the live entry used to trust whatever figure survived
 * that script — including the entry's own `$5` / one-cycle default when the
 * contract said nothing. This module is the same table, applied by the runtime
 * before a provider is contacted. A parity test holds the two copies equal.
 * This file does not import the script: the script runs its check on import.
 *
 * THE QUALIFYING PAIR's combined cap is the GitHub tag
 * `refs/tags/julius-run-spent-<24 lowercase hex>`. A successful listing is
 * the durable record (`durableRecord: 'PRESENT'`). An empty listing is zero
 * prior spend. A failed listing is not zero. A tag that does not carry a
 * positive reserved ceiling for this namespace is an unverified prior run,
 * also not zero. The ref is created before the provider call and is not
 * updated afterwards, so the figure on it is the reserved ceiling, not a
 * provider invoice. This module never claims a provider balance was verified.
 * Only a ledger whose `durableRecord` is `PRESENT` may be compared with
 * `JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS` ($60).
 *
 * The pair check applies only to `JULIUS_QUALIFYING_PAIR_NAMESPACES`. It does
 * not apply to `julius-continuous-1` (whose $60 figure is an allocator input),
 * the diagnostic namespaces (whose grant is $100), or the learning-pair
 * namespaces (whose founder bound is $30 per arm and $120 across four arms).
 * Those higher grants are unchanged and still need a founder ruling.
 *
 * A prior run whose settlements are missing, estimated, unsettled, or a
 * subscription/`NOT_APPLICABLE` coder charge is not a verified bill. This
 * module never claims a provider balance was verified.
 */

import { juliusCostComponent } from './julius-cost-accounting';

export interface JuliusNamespaceCeiling {
  readonly spendUsd: number;
  readonly repairCycles: number;
}

export const JULIUS_DEFAULT_NAMESPACE_CEILING: JuliusNamespaceCeiling = Object.freeze({
  spendUsd: 5,
  repairCycles: 1,
});

/** The per-namespace grant. Keys and numbers match `MISSION_LIMITS` in the contract-check script. */
export const JULIUS_NAMESPACE_CEILINGS: Readonly<Record<string, JuliusNamespaceCeiling>> = Object.freeze({
  'julius-live-mission-2': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-3': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-4': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-5': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-continuous-1': Object.freeze({ spendUsd: 60, repairCycles: 3 }),
  'julius-unreal-mission-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-2': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-diag-output-safety-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-output-safety-2': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-audit-fixes-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-digest-evidence-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
});

/**
 * Namespaces allowed one initial run and one repeat, together not above $60
 * of known provider spend.
 */
export const JULIUS_QUALIFYING_PAIR_NAMESPACES: readonly string[] = Object.freeze([
  'julius-live-mission-5',
  'julius-unreal-mission-1',
]);

/** $60, in USD micros. Equality is inside the cap; one micro over is not. */
export const JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS = 60_000_000;

export function juliusNamespaceCeiling(namespace: string | null): JuliusNamespaceCeiling {
  if (namespace !== null && Object.hasOwn(JULIUS_NAMESPACE_CEILINGS, namespace)) {
    return JULIUS_NAMESPACE_CEILINGS[namespace] as JuliusNamespaceCeiling;
  }
  return JULIUS_DEFAULT_NAMESPACE_CEILING;
}

export interface JuliusSettlementFact {
  readonly taskId: string;
  readonly role: string | null;
  readonly basis: unknown;
  readonly usdMicros: unknown;
  readonly estimatedUsdMicros: unknown;
  readonly billingPath: unknown;
}

/** What one earlier run of this mission cost, as far as its settlements can prove. */
export interface JuliusPriorRunSpend {
  readonly runId: string;
  readonly knownUsdMicros: number;
  readonly unknownCostComponents: number;
  /**
   * True when the Coding Agent settled as a subscription or as
   * `NOT_APPLICABLE`. That is not an API bill, and it is not zero.
   */
  readonly unverifiableApiSpend: boolean;
  /** True only when every settlement is a known provider or measured-usage bill. */
  readonly spendVerified: boolean;
}

/**
 * `PRESENT` is the durable cross-job record only. Anything else, including a
 * field left off, is absent. A per-job database is never `PRESENT`.
 */
export type JuliusDurablePriorSpend = 'ABSENT' | 'PRESENT';

export type JuliusSpendLedgerRead =
  | { readonly readable: false }
  | {
    readonly readable: true;
    readonly priorRuns: readonly JuliusPriorRunSpend[];
    readonly durableRecord?: JuliusDurablePriorSpend;
  };

export type JuliusSpendAuthorization =
  | {
    readonly authorized: true;
    readonly spendCeilingUsdMicros: number;
    readonly maxRepairRounds: number;
  }
  | { readonly authorized: false; readonly reasonCode: string; readonly safeMessage: string };

const USD_MICROS = 1_000_000;

function usdMicrosOf(spendUsd: number): number | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return null;
  const micros = Math.round(spendUsd * USD_MICROS);
  if (!Number.isSafeInteger(micros) || micros <= 0) return null;
  return micros;
}

/**
 * Fold `budget.settled` facts into one prior run. Estimated, unknown, and
 * unsettled components are counted and are not added as dollars. A coder
 * settlement that says the work was not API-billed is flagged, not zeroed.
 */
export function summarizeJuliusPriorRunSpend(
  runId: string,
  settlements: readonly JuliusSettlementFact[],
): JuliusPriorRunSpend {
  let knownUsdMicros = 0;
  let unknownCostComponents = 0;
  let spendBasisCount = 0;
  let unverifiableApiSpend = false;
  for (const settlement of settlements) {
    const component = juliusCostComponent({
      taskId: settlement.taskId,
      role: settlement.role,
      basis: settlement.basis,
      usdMicros: settlement.usdMicros,
      estimatedUsdMicros: settlement.estimatedUsdMicros,
    });
    if (component.knownUsdMicros !== null) {
      knownUsdMicros += component.knownUsdMicros;
      spendBasisCount += 1;
    } else {
      unknownCostComponents += 1;
    }
    if (
      component.role === 'CODING_AGENT'
      && (component.basis === 'NOT_APPLICABLE' || settlement.billingPath === 'SUBSCRIPTION')
    ) {
      unverifiableApiSpend = true;
    }
  }
  const spendVerified = settlements.length > 0
    && unknownCostComponents === 0
    && !unverifiableApiSpend
    && spendBasisCount === settlements.length
    && Number.isSafeInteger(knownUsdMicros);
  return {
    runId,
    knownUsdMicros: Number.isSafeInteger(knownUsdMicros) ? knownUsdMicros : 0,
    unknownCostComponents,
    unverifiableApiSpend,
    spendVerified,
  };
}

/**
 * Refuse a live contract the namespace does not grant. A qualifying-pair
 * namespace is also refused when prior-spend facts are absent, unverified, or
 * unreadable. Authorized output is the contract's own ceiling, never a raised
 * default, and only when those facts are a durable record.
 */
export function authorizeJuliusLiveSpend(input: {
  readonly namespace: string | null;
  readonly spendUsd: number | null;
  readonly repairCycles: number | null;
  readonly ledger: JuliusSpendLedgerRead;
}): JuliusSpendAuthorization {
  const ceiling = juliusNamespaceCeiling(input.namespace);
  const namespaceLabel = input.namespace ?? 'a mission with no declared namespace';
  if (input.spendUsd === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_unknown',
      safeMessage: 'limits.spendUsd is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  if (input.repairCycles === null) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_unknown',
      safeMessage: 'limits.repairCycles is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  const spendCeilingUsdMicros = usdMicrosOf(input.spendUsd);
  if (spendCeilingUsdMicros === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_invalid',
      safeMessage: 'limits.spendUsd must be a positive finite number. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.spendUsd > ceiling.spendUsd) {
    return {
      authorized: false,
      reasonCode: 'namespace_spend_ceiling_exceeded',
      safeMessage: `limits.spendUsd is ${String(input.spendUsd)}, above the ${String(ceiling.spendUsd)} ceiling for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!Number.isInteger(input.repairCycles) || input.repairCycles < 0) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_invalid',
      safeMessage: 'limits.repairCycles must be a non-negative integer. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.repairCycles > ceiling.repairCycles) {
    return {
      authorized: false,
      reasonCode: 'namespace_repair_ceiling_exceeded',
      safeMessage: `limits.repairCycles is ${String(input.repairCycles)}, above the ${String(ceiling.repairCycles)} allowed for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!JULIUS_QUALIFYING_PAIR_NAMESPACES.includes(input.namespace ?? '')) {
    return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
  }
  if (!input.ledger.readable) {
    return {
      authorized: false,
      reasonCode: 'spend_ledger_unreadable',
      safeMessage: 'Prior-spend facts could not be read. They are not treated as zero, and no provider balance was verified.',
    };
  }
  // PRESENT is a successful julius-run-spent-* listing. This job's Postgres
  // is not that record, so an empty local history stays absent, not a verified $0.
  if (input.ledger.durableRecord !== 'PRESENT') {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_absent',
      safeMessage: 'Prior-spend facts for this qualifying mission are absent. This job\'s database is not a durable record of earlier runs, so no combined cap is applied and the missing history is not treated as zero. The durable record is the julius-run-spent-<id> tag and ledger. No provider was contacted, and no provider balance was verified.',
    };
  }
  const priorRuns = input.ledger.priorRuns;
  if (priorRuns.length >= 2) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_third_run_refused',
      safeMessage: `This qualifying mission already has ${String(priorRuns.length)} runs. The founder cap allows the initial run and one repeat. No provider was contacted, and no provider balance was verified.`,
    };
  }
  const unverified = priorRuns.find((run) => !run.spendVerified || run.unknownCostComponents > 0 || run.unverifiableApiSpend);
  if (unverified !== undefined) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_unverified',
      safeMessage: `Prior run ${unverified.runId} has no complete API bill (unknown components ${String(unverified.unknownCostComponents)}, coder API spend unverifiable ${String(unverified.unverifiableApiSpend)}). Unknown is not zero, and no provider balance was verified.`,
    };
  }
  let priorKnown = 0;
  for (const run of priorRuns) {
    priorKnown += run.knownUsdMicros;
  }
  if (!Number.isSafeInteger(priorKnown) || priorKnown + spendCeilingUsdMicros > JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_exceeded',
      safeMessage: `Known prior spend ${String(priorKnown)} micros plus this contract's ceiling ${String(spendCeilingUsdMicros)} micros exceeds the ${String(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS)} micro combined cap. No provider was contacted, and no provider balance was verified.`,
    };
  }
  return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
}

/**
 * ONE SPENT TAG.
 *
 * `ref` is `refs/tags/julius-run-spent-<24 lowercase hex>`. `message` is the
 * annotated tag body, or null when the ref points straight at a commit.
 * The body, when present, is exactly these four lines:
 *
 *   julius-run-spent.v1
 *   run=run:<24 lowercase hex>
 *   namespace=<namespace>
 *   reservedUsdMicros=<positive integer>
 *
 * The hex in `run` matches the hex in the ref. `reservedUsdMicros` is the
 * ceiling reserved before the provider call. It is not a provider invoice.
 */
export interface JuliusSpentTag {
  readonly ref: string;
  readonly message: string | null;
}

const SPENT_TAG_REF = /^refs\/tags\/julius-run-spent-([0-9a-f]{24})$/u;
const SPENT_RUN_ID = /^run:[0-9a-f]{24}$/u;

/**
 * The four-line body a writer puts on the tag. Null when the inputs are not
 * the form a reader will accept.
 */
export function juliusSpentTagMessage(input: {
  readonly runId: string;
  readonly namespace: string;
  readonly reservedUsdMicros: number;
}): string | null {
  const hex = SPENT_RUN_ID.test(input.runId) ? input.runId.slice(4) : null;
  if (hex === null) return null;
  if (!/^[a-z0-9-]{1,64}$/u.test(input.namespace)) return null;
  if (!Number.isSafeInteger(input.reservedUsdMicros) || input.reservedUsdMicros <= 0) return null;
  return [
    'julius-run-spent.v1',
    `run=${input.runId}`,
    `namespace=${input.namespace}`,
    `reservedUsdMicros=${String(input.reservedUsdMicros)}`,
  ].join('\n');
}

function spentTagHex(ref: string): string | null {
  return SPENT_TAG_REF.exec(ref)?.[1] ?? null;
}

/**
 * Turn a successful tag listing into the ledger the cap compares.
 *
 * A ref that is not a spent tag makes the whole listing unreadable: the
 * caller asked for that prefix only. The run id passed as `excludeRunId`
 * is this dispatch's own lock, created before the check, and is not prior
 * spend. A body that names another namespace is that other mission. A body
 * that is missing or does not match this namespace's form is an unverified
 * prior run of this mission, because the listing cannot prove it is not.
 */
export function interpretJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
}): JuliusSpendLedgerRead {
  const exclude = input.excludeRunId !== undefined && SPENT_RUN_ID.test(input.excludeRunId)
    ? input.excludeRunId
    : null;
  const priorRuns: JuliusPriorRunSpend[] = [];
  const seen = new Set<string>();
  for (const tag of input.tags) {
    const hex = spentTagHex(tag.ref);
    if (hex === null) return { readable: false };
    if (seen.has(hex)) continue;
    seen.add(hex);
    const runId = `run:${hex}`;
    if (runId === exclude) continue;
    const parsed = parseSpentTagBody(tag.message, runId, input.namespace);
    if (parsed.kind === 'other') continue;
    if (parsed.kind === 'verified') {
      priorRuns.push({
        runId,
        knownUsdMicros: parsed.reservedUsdMicros,
        unknownCostComponents: 0,
        unverifiableApiSpend: false,
        spendVerified: true,
      });
      continue;
    }
    priorRuns.push({
      runId,
      knownUsdMicros: 0,
      unknownCostComponents: 1,
      unverifiableApiSpend: false,
      spendVerified: false,
    });
  }
  priorRuns.sort((left, right) => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0));
  return { readable: true, priorRuns, durableRecord: 'PRESENT' };
}

function parseSpentTagBody(
  message: string | null,
  runId: string,
  expectedNamespace: string,
): { readonly kind: 'verified'; readonly reservedUsdMicros: number } | { readonly kind: 'other' } | { readonly kind: 'unverified' } {
  if (message === null) return { kind: 'unverified' };
  const lines = message.trim().split('\n');
  if (lines.length !== 4 || lines[0] !== 'julius-run-spent.v1' || lines[1] !== `run=${runId}`) {
    return { kind: 'unverified' };
  }
  const namespace = /^namespace=([a-z0-9-]{1,64})$/u.exec(lines[2] ?? '')?.[1];
  const rawMicros = /^reservedUsdMicros=([0-9]{1,15})$/u.exec(lines[3] ?? '')?.[1];
  if (namespace === undefined || rawMicros === undefined) return { kind: 'unverified' };
  const reservedUsdMicros = Number(rawMicros);
  if (!Number.isSafeInteger(reservedUsdMicros) || reservedUsdMicros <= 0) return { kind: 'unverified' };
  const canonical = juliusSpentTagMessage({ runId, namespace, reservedUsdMicros });
  if (canonical === null || canonical !== message.trim()) return { kind: 'unverified' };
  if (namespace !== expectedNamespace) return { kind: 'other' };
  return { kind: 'verified', reservedUsdMicros };
}
