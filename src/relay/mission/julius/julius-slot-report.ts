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
  /** The ledger position of this dispatch, absent when the row carried none. */
  readonly sequence?: number;
}

/**
 * WHAT A SLOT DID THAT WAS NOT A TOKEN COUNT.
 *
 * A checkpoint is recorded as its own durable row against the SUBJECT task —
 * the dispatch that asked — rather than as a field on an effort row. A report
 * reading only `worker.effort` could therefore say exactly what a slot spent
 * and still not say whether it ever stopped, asked, or was made to wait, which
 * is most of what "did this slot participate" means.
 *
 * ROUTING IS JULIUS'S ACT, NOT THE WORKER'S. The worker raised a checkpoint;
 * what happened next was decided by `routeJuliusCheckpoint`. Both are kept,
 * separately, because a slot that asked ten times and was continued ten times
 * did something very different from one that asked once and stopped the mission.
 */
export interface JuliusSlotParticipation {
  /** Distinct checkpoints raised by this slot's own dispatches. */
  readonly checkpointsRaised: number;
  /** Routing decisions recorded for them, by route. */
  readonly routes: Readonly<Record<string, number>>;
  /** Of those decisions, the ones that were a BARRIER — work stopped and waited. */
  readonly barriers: number;
  /**
   * Continuations a barrier actually minted. THE PROOF A BARRIER CHANGED
   * PROGRESSION rather than merely being classified as one: a barrier that
   * minted nothing stopped a worker without giving it anywhere to resume.
   */
  readonly continuations: number;
  /** The rows these counts came from, kept whole. */
  readonly rows: readonly JuliusReportRow[];
}

/**
 * WHEN THIS SLOT WAS ACTUALLY WORKING, as ledger positions in order.
 *
 * The question the paid proof has to answer is not "did this worker appear"
 * but "did it participate THROUGHOUT" — and a set of totals cannot tell a slot
 * that did everything in the first two minutes from one that kept re-entering
 * as the mission evolved. A sorted list of positions can.
 *
 * `positions` is one entry per dispatch. `span` is the first and last, so a
 * reader sees the reach without scanning. Both are EMPTY, never zero-filled,
 * for a slot whose rows carried no sequence.
 */
export interface JuliusSlotChronology {
  readonly positions: readonly number[];
  readonly span: { readonly first: number; readonly last: number } | null;
  /** Dispatches whose row carried no ledger position, so nothing is invented. */
  readonly unpositioned: number;
}

export interface JuliusSlotReportEntry {
  readonly slot: string;
  /** Money: envelope, rounds, outstanding, settled, remaining, borrowed. */
  readonly ledger: JuliusSlotAccount | null;
  /** Work: every dimension, each with what was measured and what was not. */
  readonly effort: JuliusSlotEffort | null;
  /** Participation: what this slot asked for, and what Julius did about it. */
  readonly participation: JuliusSlotParticipation;
  /** When this slot worked, in ledger order. */
  readonly chronology: JuliusSlotChronology;
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
   * CONTRACT DISPOSITIONS, AND DELIBERATELY NOT PER SLOT.
   *
   * `contract.disposition` is written against the SUBJECT task, not the
   * evaluator's own, so attributing it by task id would credit the coder with
   * the reviewer's challenge. The evaluator is named on the row as
   * `evaluatorId`, and that is what is reported — an id, not a role, because
   * the report cannot map one to the other from the rows it is given and will
   * not guess. A reader who knows the roster reads the answer off it.
   */
  readonly dispositions: {
    readonly byVerdict: Readonly<Record<string, number>>;
    readonly byEvaluator: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly rows: readonly JuliusReportRow[];
  };
  /**
   * Checkpoints whose subject dispatch recorded no effort row, so no slot can
   * be named for them. They are REPORTED, not dropped and not assigned to a
   * guess: a checkpoint that cannot be attributed is a hole in the evidence,
   * and a hole that is visible is a different thing from one that is not.
   */
  readonly unattributedCheckpoints: readonly JuliusReportRow[];
  /**
   * THE MISSION, READ END TO END — every dispatch in ledger order, with the
   * slot that made it.
   *
   * This is the shape the founder's claim is argued from: `A R C A R C R` is a
   * mission three peers worked through together; `A A A R C C C` is a mission
   * where the architect front-loaded and left. The totals are identical in both
   * and only this can tell them apart.
   *
   * Dispatches whose row carried no ledger position are NOT placed here — they
   * are counted per slot as `unpositioned`, because a guessed position would be
   * indistinguishable from a measured one.
   */
  readonly interleaving: readonly {
    readonly slot: string;
    readonly sequence: number;
    readonly taskId: string | null;
  }[];
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
  /**
   * THE LEDGER'S OWN POSITION FOR THIS ROW, and the reason this report can say
   * anything about WHEN.
   *
   * `JuliusTimelineEntry.sequence` has always carried it — a per-run monotonic
   * counter the event ledger allocates on append, `UNIQUE(stream_id, sequence)`
   * in PostgreSQL and the same contract in memory. It is emphatically NOT
   * `occurredAt`: several events routinely share a millisecond under the
   * production clock, so a wall-clock sort has no deterministic tiebreak and
   * cannot answer "which came first" at all.
   *
   * Optional because a caller handing over rows from somewhere other than the
   * timeline genuinely has no position, and an ABSENT position must read as
   * unknown rather than as zero — a row at "position 0" would sort before
   * everything and silently invent a history.
   */
  readonly sequence?: number;
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
  const checkpointRows: JuliusReportRow[] = [];
  const dispositionRows: JuliusReportRow[] = [];
  /**
   * WHICH SLOT A TASK BELONGED TO, learned from the effort rows rather than
   * assumed. Checkpoints name their subject task and nothing else; this is the
   * only thing in the input that says what role that task was dispatched under.
   */
  const roleByTaskId = new Map<string, string>();

  for (const row of input.rows) {
    if (row.type === 'budget.allocated' || row.type === 'budget.reserved' || row.type === 'budget.settled') {
      budgetRows.push({ type: row.type, taskId: row.taskId, facts: row.facts });
      continue;
    }
    if (row.type === 'checkpoint.recorded' || row.type === 'checkpoint.verdict') {
      checkpointRows.push(row);
      continue;
    }
    if (row.type === 'contract.disposition') {
      dispositionRows.push(row);
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
      ...(row.sequence === undefined ? {} : { sequence: row.sequence }),
    });
    dispatchesBySlot.set(role, list);
    if (row.taskId !== null) roleByTaskId.set(row.taskId, role);
  }

  /**
   * ATTRIBUTE THE CHECKPOINTS. A checkpoint row carries the subject task; the
   * subject's own effort row carries its role. Where the subject recorded no
   * effort row — it failed before emitting one — the checkpoint is UNATTRIBUTED
   * and is reported as such rather than assigned to a likely slot.
   */
  const participationRows = new Map<string, JuliusReportRow[]>();
  const unattributedCheckpoints: JuliusReportRow[] = [];
  for (const row of checkpointRows) {
    const slot = row.taskId === null ? undefined : roleByTaskId.get(row.taskId);
    if (slot === undefined) {
      unattributedCheckpoints.push(row);
      continue;
    }
    const list = participationRows.get(slot) ?? [];
    list.push(row);
    participationRows.set(slot, list);
  }

  const byVerdict: Record<string, number> = {};
  const byEvaluator: Record<string, Record<string, number>> = {};
  for (const row of dispositionRows) {
    const verdict = typeof row.facts.disposition === 'string' ? row.facts.disposition : 'UNKNOWN';
    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
    const evaluator = typeof row.facts.evaluatorId === 'string' ? row.facts.evaluatorId : 'UNKNOWN';
    const forEvaluator = byEvaluator[evaluator] ?? {};
    forEvaluator[verdict] = (forEvaluator[verdict] ?? 0) + 1;
    byEvaluator[evaluator] = forEvaluator;
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
  const interleaving: { slot: string; sequence: number; taskId: string | null }[] = [];
  const bySlot: Record<string, JuliusSlotReportEntry> = {};
  for (const slot of slots) {
    const dispatches = dispatchesBySlot.get(slot) ?? [];
    for (const dispatch of dispatches) {
      if (dispatch.sequence === undefined) continue;
      interleaving.push({ slot, sequence: dispatch.sequence, taskId: dispatch.taskId });
    }
    bySlot[slot] = Object.freeze({
      slot,
      ledger: ledger.bySlot[slot] ?? null,
      effort: effort.bySlot[slot] ?? null,
      participation: summarizeParticipation(participationRows.get(slot) ?? []),
      chronology: summarizeChronology(dispatches),
      dispatches: Object.freeze(dispatches),
    });
  }
  interleaving.sort((a, b) => a.sequence - b.sequence);

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
    dispositions: Object.freeze({
      byVerdict: Object.freeze(byVerdict),
      byEvaluator: Object.freeze(Object.fromEntries(
        Object.entries(byEvaluator).map(([id, counts]) => [id, Object.freeze(counts)]),
      )),
      rows: Object.freeze(dispositionRows),
    }),
    unattributedCheckpoints: Object.freeze(unattributedCheckpoints),
    interleaving: Object.freeze(interleaving),
    parity: Object.freeze({
      ratioToCoder: effort.ratioToCoder,
      observed: effort.verdict,
    }),
  });
}

/**
 * Count one slot's checkpoint rows.
 *
 * A checkpoint is RAISED once and may be ruled on once; the two are different
 * rows and are counted from the row that actually carries each fact — raised
 * from `checkpoint.recorded`, deduplicated by checkpoint id so a replayed row
 * cannot inflate it, and routing from `checkpoint.verdict`, where every
 * decision recorded is a decision that was really made.
 */
function summarizeParticipation(rows: readonly JuliusReportRow[]): JuliusSlotParticipation {
  const raised = new Set<string>();
  const routes: Record<string, number> = {};
  let barriers = 0;
  let continuations = 0;

  for (const row of rows) {
    const checkpointId = typeof row.facts.checkpointId === 'string' ? row.facts.checkpointId : null;
    if (row.type === 'checkpoint.recorded') {
      // A checkpoint with no id still happened. It is counted under its own row
      // identity rather than discarded for being unnameable.
      raised.add(checkpointId ?? `unnamed:${raised.size}`);
      continue;
    }
    const route = typeof row.facts.route === 'string' ? row.facts.route : 'UNKNOWN';
    routes[route] = (routes[route] ?? 0) + 1;
    // ONLY WHAT THE ROW SAYS. `barrier` is absent on the early-return verdict
    // path, and an absent flag is not a false one — an unstated barrier is not
    // counted either way rather than counted as "not a barrier".
    if (row.facts.barrier === true) barriers += 1;
    if (typeof row.facts.continuationTaskId === 'string' && row.facts.continuationTaskId.length > 0) {
      continuations += 1;
    }
  }

  return Object.freeze({
    checkpointsRaised: raised.size,
    routes: Object.freeze(routes),
    barriers,
    continuations,
    rows: Object.freeze([...rows]),
  });
}

/**
 * One slot's dispatch positions, in order.
 *
 * Sorted rather than trusted in arrival order: the rows reach this function
 * grouped by slot, and grouping is not ordering.
 */
function summarizeChronology(dispatches: readonly JuliusSlotDispatchRow[]): JuliusSlotChronology {
  const positions: number[] = [];
  let unpositioned = 0;
  for (const dispatch of dispatches) {
    if (dispatch.sequence === undefined) { unpositioned += 1; continue; }
    positions.push(dispatch.sequence);
  }
  positions.sort((a, b) => a - b);
  return Object.freeze({
    positions: Object.freeze(positions),
    // NULL, NOT {first:0,last:0}. A slot nobody could place has no span, and a
    // zeroed one would read as a slot that worked at the very beginning.
    span: positions.length === 0
      ? null
      : Object.freeze({ first: positions[0]!, last: positions[positions.length - 1]! }),
    unpositioned,
  });
}
