/**
 * The J1 pre-spend check. It calls {@link authorizeJuliusLiveSpend} and records
 * settlements in the same fact shape that function folds. It does not keep a
 * counter of its own.
 */

import {
  JULIUS_NAMESPACE_CEILINGS,
  authorizeJuliusLiveSpend,
  summarizeJuliusPriorRunSpend,
  type JuliusDurablePriorSpend,
  type JuliusSettlementFact,
  type JuliusSpendAuthorization,
  type JuliusSpendLedgerRead,
} from '../src/relay/mission/julius/julius-spend-ceiling';
import { readJuliusSpentTagLedger } from './julius/julius-prior-spend';

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
  if (reasonCode === 'qualifying_pair_spend_absent') return { status: 503, code: 'julius_dispatch_spend_record_absent' };
  if (reasonCode === 'qualifying_pair_third_run_refused') return { status: 409, code: 'julius_dispatch_repeat_already_used' };
  if (reasonCode === 'qualifying_pair_spend_unverified') return { status: 409, code: 'julius_dispatch_repeat_spend_unknown' };
  if (reasonCode === 'qualifying_pair_spend_exceeded') return { status: 409, code: 'julius_dispatch_repeat_combined_ceiling' };
  if (reasonCode.includes('repair')) return { status: 409, code: 'julius_dispatch_repair_ceiling' };
  return { status: 409, code: 'julius_dispatch_spend_ceiling' };
}

/**
 * A ledger whose rows are {@link JuliusSettlementFact}s, summarized by the same function #404 uses.
 * It lives in this process, so it is not the durable cross-job record: its reads say `ABSENT`, and a
 * qualifying pair is refused on them. Only the dispatch test kit stands one in for the durable record.
 */
export function createSharedSpendLedger(): JuliusSpendLedgerPort & { readonly facts: ReadonlyMap<string, readonly JuliusSettlementFact[]> } {
  return createInProcessSpendLedger('ABSENT');
}

/** Shared by the production in-process ledger (`ABSENT`) and the test kit's stand-in for the durable record. */
export function createInProcessSpendLedger(durableRecord: JuliusDurablePriorSpend): JuliusSpendLedgerPort & { readonly facts: ReadonlyMap<string, readonly JuliusSettlementFact[]> } {
  const facts = new Map<string, JuliusSettlementFact[]>();
  return {
    facts,
    async readPrior(input) {
      const priorRuns = [...facts.entries()]
        .filter(([runId]) => runId !== input.excludeRunId)
        .map(([runId, settlements]) => summarizeJuliusPriorRunSpend(runId, settlements));
      return { readable: true, priorRuns, durableRecord };
    },
    async record(runId, fact) {
      const list = facts.get(runId) ?? [];
      list.push(fact);
      facts.set(runId, list);
    },
  };
}

/**
 * THE DURABLE J1 LEDGER: the `julius-run-spent-*` tags the paid workflow writes before a provider call.
 * A read lists them for the mission's namespace (#404's reader, unchanged). A failed listing is
 * unreadable, never an empty history. The reader follows at most 5 pages of tags; a longer listing
 * is unreadable, so J1 then refuses rather than undercounting.
 *
 * This port does not write. The reservation tag is the paid workflow's, made before any provider
 * call, and the settlement itself is already a row on the dispatch ledger. `record()` therefore
 * resolves without writing: the tag, not this port, is what the $60 cap counts.
 *
 * NOT COMPOSED. The J1 dispatch controller is built without a spend ledger, so it reads
 * `{ readable: false }` and refuses with a 503 before any spend. That is deliberate: wiring this
 * port would put a GitHub token in the bridge environment the coder session inherits. J1 spend is
 * enforced on the paid workflow path only, where `julius-live-mission.ts` lists these same tags.
 */
export function createSpentTagSpendLedger(input: {
  readonly repository: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}): JuliusSpendLedgerPort {
  return {
    async readPrior(read) {
      return readJuliusSpentTagLedger({
        repository: input.repository,
        token: input.token,
        namespace: read.missionId,
        ...(read.excludeRunId === undefined ? {} : { excludeRunId: read.excludeRunId }),
        ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      });
    },
    async record() {
      /* The paid workflow's tag is the durable record; nothing is written here. */
    },
  };
}
