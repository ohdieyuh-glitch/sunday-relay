/**
 * The J1 pre-spend check. It calls {@link authorizeJuliusLiveSpend} and records
 * settlements in the same fact shape that function folds. It does not keep a
 * counter of its own.
 */

import {
  JULIUS_NAMESPACE_CEILINGS,
  authorizeJuliusLiveSpend,
  summarizeJuliusPriorRunSpend,
  type JuliusSettlementFact,
  type JuliusSpendAuthorization,
  type JuliusSpendLedgerRead,
} from '../src/relay/mission/julius/julius-spend-ceiling';

export interface JuliusSpendLedgerPort {
  readPrior(input: { readonly missionId: string; readonly projectId: string; readonly excludeRunId?: string }): Promise<JuliusSpendLedgerRead>;
  record(runId: string, fact: JuliusSettlementFact): Promise<void>;
}

export type PreSpendDecision =
  | { readonly applicable: false }
  | (JuliusSpendAuthorization & { readonly applicable: true });

/** Only a namespace the runtime table grants is checked. Anything else is not this cap. */
export function preSpendDecision(input: {
  readonly markerNamespace: string | null;
  readonly spendUsd: number | null;
  readonly repairCycles: number | null;
  readonly ledger: JuliusSpendLedgerRead;
}): PreSpendDecision {
  if (input.markerNamespace === null || !Object.hasOwn(JULIUS_NAMESPACE_CEILINGS, input.markerNamespace)) {
    return { applicable: false };
  }
  return {
    applicable: true,
    ...authorizeJuliusLiveSpend({
      namespace: input.markerNamespace,
      spendUsd: input.spendUsd,
      repairCycles: input.repairCycles,
      ledger: input.ledger,
    }),
  };
}

export function spendRefusalCode(reasonCode: string): { readonly status: number; readonly code: string } {
  if (reasonCode === 'spend_ledger_unreadable') return { status: 503, code: 'julius_dispatch_spend_ledger_unreadable' };
  if (reasonCode === 'qualifying_pair_third_run_refused') return { status: 409, code: 'julius_dispatch_repeat_already_used' };
  if (reasonCode === 'qualifying_pair_spend_unverified') return { status: 409, code: 'julius_dispatch_repeat_spend_unknown' };
  if (reasonCode === 'qualifying_pair_spend_exceeded') return { status: 409, code: 'julius_dispatch_repeat_combined_ceiling' };
  if (reasonCode.includes('repair')) return { status: 409, code: 'julius_dispatch_repair_ceiling' };
  return { status: 409, code: 'julius_dispatch_spend_ceiling' };
}

/** A ledger whose rows are {@link JuliusSettlementFact}s, summarized by the same function #404 uses. */
export function createSharedSpendLedger(): JuliusSpendLedgerPort & { readonly facts: ReadonlyMap<string, readonly JuliusSettlementFact[]> } {
  const facts = new Map<string, JuliusSettlementFact[]>();
  return {
    facts,
    async readPrior(input) {
      const priorRuns = [...facts.entries()]
        .filter(([runId]) => runId !== input.excludeRunId)
        .map(([runId, settlements]) => summarizeJuliusPriorRunSpend(runId, settlements));
      return { readable: true, priorRuns };
    },
    async record(runId, fact) {
      const list = facts.get(runId) ?? [];
      list.push(fact);
      facts.set(runId, list);
    },
  };
}
