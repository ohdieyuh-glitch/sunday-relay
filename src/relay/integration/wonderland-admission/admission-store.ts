/**
 * ONE ADMISSION PER (run id, idempotency key), reserved before any ledger write.
 *
 * A resend of that pair, including one that arrives while the ledger write is
 * still running, reads the run that already exists. It is not answered with
 * a busy refusal, and it does not open a second slot. Cap refusals
 * write no row and reserve nothing. Nothing in this file retries a refused,
 * interrupted, duplicate, or failed run, and nothing calls a provider or the
 * paid workflow.
 *
 * PURE apart from the injected ledger. Time arrives as an ISO string.
 */

import {
  CAP_REFUSAL_KINDS,
  GATES_REMAINING,
  PAID_SLOT_DISPATCH_KEY,
  PAID_SLOT_SCRIPT,
  PAID_WORKFLOW_FILE,
  SHA256_HEX,
  applyWonderlandStatusTransition,
  type CapRefusalKind,
  type PaidWorkflowTicket,
  type ReviewedModelPins,
  paidWorkflowTicket,
} from './admission-contract';
import { identifyAdmissionRun, parseJuliusAdmissionRunId } from './admission-run-id';

export type AdmissionState = 'RESERVED' | 'ADMISSION_HELD' | 'LEDGER_UNWRITTEN' | 'INTERRUPTED' | 'FAILED';

export interface AdmissionRun {
  readonly runId: string;
  /**
   * The id this row is keyed on. A new row stores the client's `wlj_` id.
   * A legacy schema-v2 row stores its `run:` id. Neither is minted here.
   */
  readonly serverRunId: string;
  readonly keyHash: string;
  readonly dispatchId: string;
  readonly missionId: string | null;
  readonly requestId: string;
  readonly clientLogSha256: string;
  readonly clientUiActionUtc: string;
  readonly receivedAt: string;
  readonly ledgerRef: string;
  readonly modelPins: ReviewedModelPins;
  readonly paidWorkflow: PaidWorkflowTicket;
  state: AdmissionState;
  ledgerAttempted: boolean;
  ledgerWritten: boolean;
  resultSha256: string | null;
  resultHashConflicts: number;
  ownerPlayerId?: string;
}

export interface AdmissionLedgerRow {
  readonly phase: 'run_admission';
  readonly runId: string;
  readonly serverRunId: string;
  readonly keyHash: string;
  readonly dispatchId: string;
  readonly missionId: string | null;
  readonly requestId: string;
  readonly clientLogSha256: string;
  readonly clientUiActionUtc: string;
  readonly receivedAt: string;
  readonly ledgerRef: string;
  readonly resultSha256: null;
  /**
   * Present on a file row. `LEDGER_UNWRITTEN` is the durable reservation left
   * when the completion write failed. Absent means the in-memory ledger,
   * which restores as `ADMISSION_HELD`.
   */
  readonly state?: 'ADMISSION_HELD' | 'LEDGER_UNWRITTEN';
  /**
   * Present on a row this process wrote. A restored row without pins keeps
   * every pin null. Replay returns the stored pins, not a fresh empty set,
   * when the row recorded them.
   */
  readonly modelPins?: ReviewedModelPins;
  /** Player the admission belongs to. Absent on a row written before ownership was stored. */
  readonly ownerPlayerId?: string;
}

export interface AdmissionLedger {
  rows(): Promise<readonly AdmissionLedgerRow[]>;
  append(row: AdmissionLedgerRow): Promise<void>;
  /**
   * True when the durable document is schema v2. Those rows are readable and
   * still count toward the caps. The document is not rewritten.
   */
  legacyReadonly?(): boolean;
}

export interface AdmissionRequest {
  readonly runId: string;
  /** sha256 of the idempotency key. The raw key is not stored. */
  readonly keyHash: string;
  readonly dispatchId: string;
  readonly missionId: string | null;
  readonly requestId: string;
  readonly clientLogSha256: string;
  readonly clientUiActionUtc: string;
  readonly receivedAt: string;
  readonly modelPins: ReviewedModelPins;
  readonly ownerPlayerId?: string;
}

export type AdmissionOutcome =
  | {
    readonly ok: true;
    readonly httpStatus: 200 | 202;
    readonly replayed: boolean;
    readonly run: AdmissionRun;
  }
  | {
    readonly ok: false;
    readonly httpStatus: 400 | 409 | 429;
    readonly kind: string;
    readonly message: string;
  };

const RECEIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const EMPTY_PINS: ReviewedModelPins = {
  architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null,
};

export function createMemoryAdmissionLedger(): AdmissionLedger & { readonly snapshot: () => readonly AdmissionLedgerRow[] } {
  const held: AdmissionLedgerRow[] = [];
  return {
    async rows() { return held.slice(); },
    async append(row) { held.push(row); },
    snapshot() { return held.slice(); },
  };
}

export function createWonderlandAdmissionStore(input: {
  readonly ledger: AdmissionLedger;
  readonly dailyCap: number;
  readonly missionCap: number;
}): WonderlandAdmissionStore {
  return new WonderlandAdmissionStore(input.ledger, input.dailyCap, input.missionCap);
}

class WonderlandAdmissionStore {
  private readonly byPair = new Map<string, AdmissionRun>();
  private readonly byRunId = new Map<string, AdmissionRun>();
  private readonly byKeyHash = new Map<string, AdmissionRun>();
  private readonly byServerRunId = new Map<string, AdmissionRun>();
  private load: Promise<void> | null = null;

  constructor(
    private readonly ledger: AdmissionLedger,
    private readonly dailyCap: number,
    private readonly missionCap: number,
  ) {}

  /** How many runs this process has reserved. Cap refusals are not runs. */
  admissionCount(): number {
    return this.byRunId.size;
  }

  runs(): readonly AdmissionRun[] {
    return [...this.byRunId.values()];
  }

  /**
   * Reserve or replay. The map update happens synchronously after the ledger
   * snapshot has loaded, and before `append` is awaited.
   */
  async admit(request: AdmissionRequest): Promise<AdmissionOutcome> {
    await this.ensureLoaded();
    const decision = this.reserveSync(request);
    if (decision.kind !== 'created') return decision.outcome;
    const run = decision.run;
    run.ledgerAttempted = true;
    try {
      await this.ledger.append(ledgerRow(run));
      run.ledgerWritten = true;
      if (run.state === 'RESERVED') run.state = 'ADMISSION_HELD';
    } catch (error) {
      if (error instanceof Error && error.message === 'admission_file_legacy_readonly') throw error;
      // The run stays reserved in memory. A resend reads it. The write is not tried again.
      if (run.state === 'RESERVED') run.state = 'LEDGER_UNWRITTEN';
    }
    return { ok: true, httpStatus: 202, replayed: false, run };
  }

  /**
   * Record a terminal failure on the existing run. Same pair, same slot.
   * Returns null when the run was never reserved. Does not append, retry, or spend.
   */
  markTerminal(
    runId: string,
    state: 'INTERRUPTED' | 'FAILED',
    options?: { readonly dispatched?: boolean },
  ): AdmissionRun | null {
    const run = this.byRunId.get(runId);
    if (run === undefined || isLegacyRun(run)) return null;
    const decision = applyWonderlandStatusTransition({
      dispatched: options?.dispatched === true,
      proposedState: state,
      proposedCause: null,
    });
    if (!decision.ok) return null;
    if (run.state === 'INTERRUPTED' || run.state === 'FAILED') return run;
    run.state = state;
    return run;
  }

  /**
   * Bind a result hash once. The same hash is the same answer. A different
   * hash does not replace it and does not open a run.
   */
  attachResultHash(runId: string, resultSha256: string): AdmissionRun | null {
    const run = this.byRunId.get(runId);
    if (run === undefined || isLegacyRun(run)) return null;
    if (!SHA256_HEX.test(resultSha256)) return run;
    if (run.resultSha256 === null) {
      run.resultSha256 = resultSha256;
      return run;
    }
    if (run.resultSha256 !== resultSha256) run.resultHashConflicts += 1;
    return run;
  }

  private ensureLoaded(): Promise<void> {
    if (this.load === null) {
      this.load = this.ledger.rows().then((rows) => {
        for (const row of rows) this.restore(row);
      });
    }
    return this.load;
  }

  private restore(row: AdmissionLedgerRow): void {
    if (this.byRunId.has(row.runId) || this.byKeyHash.has(row.keyHash) || this.byServerRunId.has(row.serverRunId)) return;
    const identity = identifyAdmissionRun(row.runId, row.serverRunId);
    if (!identity.ok) throw new Error('admission_server_run_id_invalid');
    const run = runFromRow(row);
    this.index(run);
  }

  private index(run: AdmissionRun): void {
    this.byPair.set(pairKey(run.runId, run.keyHash), run);
    this.byRunId.set(run.runId, run);
    this.byKeyHash.set(run.keyHash, run);
    this.byServerRunId.set(run.serverRunId, run);
  }

  private reserveSync(request: AdmissionRequest):
    | { kind: 'created'; run: AdmissionRun }
    | { kind: 'answered'; outcome: AdmissionOutcome } {
    const parsed = parseJuliusAdmissionRunId(request.runId);
    if (!parsed.ok) {
      return { kind: 'answered', outcome: refuse(400, 'julius_dispatch_run_invalid', 'runId is required.') };
    }
    if (parsed.form !== 'wlj') {
      return { kind: 'answered', outcome: legacyReadonlyRefusal() };
    }
    if (this.ledger.legacyReadonly?.() === true) {
      return { kind: 'answered', outcome: legacyReadonlyRefusal() };
    }
    if (!SHA256_HEX.test(request.keyHash) || !PAID_SLOT_DISPATCH_KEY.test(request.keyHash)) {
      return { kind: 'answered', outcome: refuse(400, 'julius_dispatch_idempotency_key_invalid', 'x-relay-idempotency-key is required.') };
    }
    if (!RECEIVED_AT.test(request.receivedAt)) {
      throw new Error('admission_clock_invalid');
    }
    const existing = this.byPair.get(pairKey(request.runId, request.keyHash));
    if (existing !== undefined) {
      if (isLegacyRun(existing)) return { kind: 'answered', outcome: legacyReadonlyRefusal() };
      return { kind: 'answered', outcome: { ok: true, httpStatus: 200, replayed: true, run: existing } };
    }
    const sameRun = this.byRunId.get(request.runId);
    if (sameRun !== undefined) {
      if (isLegacyRun(sameRun)) return { kind: 'answered', outcome: legacyReadonlyRefusal() };
      return { kind: 'answered', outcome: refuse(409, 'julius_dispatch_already_dispatched', 'That run id already has an admission.') };
    }
    const sameKey = this.byKeyHash.get(request.keyHash);
    if (sameKey !== undefined) {
      return { kind: 'answered', outcome: refuse(409, 'julius_dispatch_key_reused', 'That idempotency key already belongs to another run.') };
    }
    const day = request.receivedAt.slice(0, 10);
    const admitted = [...this.byRunId.values()];
    if (admitted.filter((run) => run.receivedAt.slice(0, 10) === day).length >= this.dailyCap) {
      return { kind: 'answered', outcome: cap('julius_dispatch_cap_reached') };
    }
    if (admitted.filter((run) => run.missionId === request.missionId).length >= this.missionCap) {
      return { kind: 'answered', outcome: cap('julius_dispatch_mission_cap_reached') };
    }
    const serverRunId = parsed.runId;
    if (this.byServerRunId.has(serverRunId)) {
      throw new Error('admission_server_run_id_invalid');
    }
    const run: AdmissionRun = {
      runId: request.runId,
      serverRunId,
      keyHash: request.keyHash,
      dispatchId: request.dispatchId,
      missionId: request.missionId,
      requestId: request.requestId,
      clientLogSha256: request.clientLogSha256,
      clientUiActionUtc: request.clientUiActionUtc,
      receivedAt: request.receivedAt,
      ledgerRef: `julius-wonderland-admission:${request.dispatchId}`,
      modelPins: request.modelPins,
      paidWorkflow: paidWorkflowTicket({ dispatchKey: request.keyHash, mission: request.missionId }),
      state: 'RESERVED',
      ledgerAttempted: false,
      ledgerWritten: false,
      resultSha256: null,
      resultHashConflicts: 0,
      ...(request.ownerPlayerId === undefined ? {} : { ownerPlayerId: request.ownerPlayerId }),
    };
    this.index(run);
    return { kind: 'created', run };
  }
}

function pairKey(runId: string, keyHash: string): string {
  return `${runId}\0${keyHash}`;
}

function refuse(httpStatus: 400 | 409, kind: string, message: string): AdmissionOutcome {
  return { ok: false, httpStatus, kind, message };
}

function legacyReadonlyRefusal(): AdmissionOutcome {
  return refuse(
    409,
    'julius_dispatch_legacy_readonly',
    'A legacy run: admission is read only. Nothing was reserved.',
  );
}

function isLegacyRun(run: { readonly runId: string; readonly serverRunId: string }): boolean {
  const identity = identifyAdmissionRun(run.runId, run.serverRunId);
  return identity.ok && identity.form === 'legacy';
}

function cap(kind: CapRefusalKind): AdmissionOutcome {
  if (!CAP_REFUSAL_KINDS.includes(kind)) {
    throw new Error('admission_cap_kind_invalid');
  }
  return {
    ok: false,
    httpStatus: 429,
    kind,
    message: 'The admission cap is reached. Nothing was reserved.',
  };
}

function ledgerRow(run: AdmissionRun): AdmissionLedgerRow {
  return {
    phase: 'run_admission',
    runId: run.runId,
    serverRunId: run.serverRunId,
    keyHash: run.keyHash,
    dispatchId: run.dispatchId,
    missionId: run.missionId,
    requestId: run.requestId,
    clientLogSha256: run.clientLogSha256,
    clientUiActionUtc: run.clientUiActionUtc,
    receivedAt: run.receivedAt,
    ledgerRef: run.ledgerRef,
    resultSha256: null,
    modelPins: {
      architectModel: run.modelPins.architectModel,
      codingModel: run.modelPins.codingModel,
      reviewerProvider: run.modelPins.reviewerProvider,
      reviewerModel: run.modelPins.reviewerModel,
    },
  };
}

function runFromRow(row: AdmissionLedgerRow): AdmissionRun {
  return {
    runId: row.runId,
    serverRunId: row.serverRunId,
    keyHash: row.keyHash,
    dispatchId: row.dispatchId,
    missionId: row.missionId,
    requestId: row.requestId,
    clientLogSha256: row.clientLogSha256,
    clientUiActionUtc: row.clientUiActionUtc,
    receivedAt: row.receivedAt,
    ledgerRef: row.ledgerRef,
    modelPins: row.modelPins === undefined ? EMPTY_PINS : {
      architectModel: row.modelPins.architectModel,
      codingModel: row.modelPins.codingModel,
      reviewerProvider: row.modelPins.reviewerProvider,
      reviewerModel: row.modelPins.reviewerModel,
    },
    paidWorkflow: {
      workflowFile: PAID_WORKFLOW_FILE,
      admissionScript: PAID_SLOT_SCRIPT,
      confirmLive: '',
      dispatchKey: row.keyHash,
      mission: row.missionId,
      lane: '',
      submitted: false,
      gatesRemaining: GATES_REMAINING,
    },
    state: row.state === 'LEDGER_UNWRITTEN' ? 'LEDGER_UNWRITTEN' : 'ADMISSION_HELD',
    ledgerAttempted: true,
    ledgerWritten: row.state !== 'LEDGER_UNWRITTEN',
    resultSha256: row.resultSha256,
    resultHashConflicts: 0,
    ...(row.ownerPlayerId === undefined ? {} : { ownerPlayerId: row.ownerPlayerId }),
  };
}
