import { projectJuliusSlotLedger, type JuliusBudgetRow, type JuliusSlotAccount } from './julius-slot-ledger';
import {
  JULIUS_SLOT_EFFORT_VERSION, juliusSlotEffortObservation, summarizeJuliusSlotEffort,
  type JuliusEffortVerdict, type JuliusSlotEffort,
} from './julius-slot-effort';
import { JULIUS_BUDGET_SLOTS, type JuliusSlotEnvelopePolicy } from './julius-slot-envelope';

/**
 * WHAT EACH OF THE THREE PERSISTENT WORKERS ACTUALLY DID — assembled from the
 * run's own durable rows, for the one question a paid continuous-Julius run has
 * to be able to answer afterwards.
 *
 * Mission 5's bundle could say that three roles ran. It could not say what any
 * of them did relative to the others, so the only comparable figure was money,
 * and money named the one slot whose provider reports a price.
 *
 * THE RAW DIMENSIONS ARE AUTHORITATIVE. There is a derived parity reading in
 * here and it is explicitly the LEAST important thing in the report: it answers
 * one diagnostic question and is computed from a weighting this repository
 * chose. Everything a reader should reason from — dispatches, tokens, runtime,
 * tool and research calls, checkpoints, guidance, verdicts, repairs, evidence,
 * money allocated and money settled with its basis — is carried separately and
 * per slot, and the underlying rows are carried too so nothing has to be taken
 * on the summary's word.
 *
 * NOTHING IS INVENTED. A dimension the run did not record arrives as `unknown`
 * in its own total rather than as a zero, so a slot whose provider is quiet
 * cannot be mistaken for a slot that did nothing.
 *
 * Pure: no clock, no store, no network. It takes rows and returns a record.
 */

export const JULIUS_SLOT_REPORT_VERSION = 'julius-slot-report.v1' as const;

/** One dispatch, kept whole so a reader never has to trust a total. */
export interface JuliusSlotDispatchRow {
  readonly taskId: string | null;
  readonly role: string;
  readonly taskType: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface JuliusSlotReportEntry {
  readonly slot: string;
  /** Money: envelope, rounds, outstanding, settled, remaining, borrowed. */
  readonly ledger: JuliusSlotAccount | null;
  /** Work: every dimension, each with what was measured and what was not. */
  readonly effort: JuliusSlotEffort | null;
  /** The rows the totals were built from. */
  readonly dispatches: readonly JuliusSlotDispatchRow[];
}

export interface JuliusSlotMissionReport {
  readonly version: typeof JULIUS_SLOT_REPORT_VERSION;
  readonly effortVersion: typeof JULIUS_SLOT_EFFORT_VERSION;
  readonly runId: string;
  readonly allocation: {
    /** The rule this report READ the run under. */
    readonly policyVersion: string;
    /** The rules the run's own rows NAME. */
    readonly recordedPolicyVersions: readonly string[];
    /** True when those disagree — the report is then descriptive, never a basis for a decision. */
    readonly historicalPolicyConflict: boolean;
    readonly ceilingUsdMicros: number;
    readonly unallocatedUsdMicros: number;
  };
  readonly bySlot: Readonly<Record<string, JuliusSlotReportEntry>>;
  /**
   * THE DERIVED READING, AND IT IS DERIVED. Kept beside the raw dimensions
   * rather than instead of them, and named so nobody mistakes it for a grade.
   */
  readonly parity: {
    readonly ratioToCoder: Readonly<Record<string, number | null>>;
    readonly observed: Readonly<Record<string, JuliusEffortVerdict>>;
  };
}

/** One durable timeline entry, as the reader hands it over. */
export interface JuliusReportRow {
  readonly type: string;
  readonly taskId: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

/**
 * Build the report.
 *
 * Budget rows build the money side, `worker.effort` rows build the work side,
 * and everything else is ignored — so a caller may hand over the WHOLE timeline
 * without filtering it and get the same answer. That matters: a caller that had
 * to know which types to keep would be a second place the row vocabulary lives.
 */
export function buildJuliusSlotMissionReport(input: {
  readonly runId: string;
  readonly policy: JuliusSlotEnvelopePolicy | null;
  readonly policyVersion: string;
  readonly ceilingUsdMicros: number;
  readonly rows: readonly JuliusReportRow[];
}): JuliusSlotMissionReport {
  const budgetRows: JuliusBudgetRow[] = [];
  const dispatchesBySlot = new Map<string, JuliusSlotDispatchRow[]>();

  for (const row of input.rows) {
    if (row.type === 'budget.allocated' || row.type === 'budget.reserved' || row.type === 'budget.settled') {
      budgetRows.push({ type: row.type, taskId: row.taskId, facts: row.facts });
      continue;
    }
    if (row.type !== 'worker.effort') continue;
    const role = typeof row.facts.role === 'string' ? row.facts.role : null;
    if (role === null) continue;
    const list = dispatchesBySlot.get(role) ?? [];
    list.push({
      taskId: row.taskId,
      role,
      taskType: typeof row.facts.taskType === 'string' ? row.facts.taskType : null,
      facts: row.facts,
    });
    dispatchesBySlot.set(role, list);
  }

  const ledger = projectJuliusSlotLedger({
    runId: input.runId,
    policy: input.policy,
    policyVersion: input.policyVersion,
    ceilingUsdMicros: input.ceilingUsdMicros,
    rows: budgetRows,
  });

  const observations = [...dispatchesBySlot.values()].flat()
    .map((row) => juliusSlotEffortObservation(row.facts))
    .filter((observation): observation is NonNullable<typeof observation> => observation !== null);
  const effort = summarizeJuliusSlotEffort(observations);

  /**
   * EVERY SLOT THE MISSION HAS, PLUS EVERY SLOT THAT APPEARED IN THE ROWS.
   *
   * A peer slot that never dispatched still gets an entry — a mission where the
   * architect never ran is exactly the finding this report exists to surface,
   * and a missing key would read as a slot nobody thought to include. A
   * specialist that did appear gets one too, so no spend is dropped.
   */
  const slots = new Set<string>([
    ...JULIUS_BUDGET_SLOTS,
    ...Object.keys(ledger.bySlot),
    ...dispatchesBySlot.keys(),
  ]);
  const bySlot: Record<string, JuliusSlotReportEntry> = {};
  for (const slot of slots) {
    bySlot[slot] = Object.freeze({
      slot,
      ledger: ledger.bySlot[slot] ?? null,
      effort: effort.bySlot[slot] ?? null,
      dispatches: Object.freeze(dispatchesBySlot.get(slot) ?? []),
    });
  }

  return Object.freeze({
    version: JULIUS_SLOT_REPORT_VERSION,
    effortVersion: JULIUS_SLOT_EFFORT_VERSION,
    runId: input.runId,
    allocation: Object.freeze({
      policyVersion: input.policyVersion,
      recordedPolicyVersions: ledger.recordedPolicyVersions,
      historicalPolicyConflict: ledger.historicalPolicyConflict,
      ceilingUsdMicros: input.ceilingUsdMicros,
      unallocatedUsdMicros: ledger.unallocatedUsdMicros,
    }),
    bySlot: Object.freeze(bySlot),
    parity: Object.freeze({
      ratioToCoder: effort.ratioToCoder,
      observed: effort.verdict,
    }),
  });
}
