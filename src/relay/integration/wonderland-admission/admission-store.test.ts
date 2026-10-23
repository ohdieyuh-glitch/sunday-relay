import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUSY_KIND,
  CAP_REFUSAL_KINDS,
  CLIENT_RESEND_MAX_COUNT,
  CLIENT_RESEND_MAX_TOTAL_WAIT_MS,
  JULIUS_BOOTSTRAP_RUN_ID,
  classifyDispatchAnswer,
  clientResendDelayMs,
  errorKindOf,
  parseWorkflowModelPins,
} from './admission-contract';
import {
  createMemoryAdmissionLedger,
  createWonderlandAdmissionStore,
  type AdmissionLedger,
  type AdmissionRequest,
  type AdmissionRun,
} from './admission-store';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = 'a'.repeat(64);
const RUN_2 = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY_2 = 'b'.repeat(64);
const WHEN = '2026-10-23T16:15:00.000Z';

function request(over: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return {
    runId: RUN,
    keyHash: KEY,
    dispatchId: 'adm_fixed',
    missionId: 'julius-inworld-data-1',
    requestId: 'trigger_01',
    clientLogSha256: 'c'.repeat(64),
    clientUiActionUtc: WHEN,
    receivedAt: WHEN,
    modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
    ...over,
  };
}

let minted = 0;

function nextServerRunId(): string {
  minted += 1;
  return `run:${minted.toString(16).padStart(24, '0')}`;
}

function store(caps: {
  daily?: number;
  mission?: number;
  ledger?: AdmissionLedger;
  mintServerRunId?: () => string;
} = {}) {
  return createWonderlandAdmissionStore({
    ledger: caps.ledger ?? createMemoryAdmissionLedger(),
    dailyCap: caps.daily ?? 2,
    missionCap: caps.mission ?? 2,
    mintServerRunId: caps.mintServerRunId ?? nextServerRunId,
  });
}

describe('ClassifyDispatchAnswer at a821a467', () => {
  it('a 2xx with no error object is Accepted', () => {
    expect(classifyDispatchAnswer(202, false, '')).toBe('Accepted');
    expect(classifyDispatchAnswer(200, false, '')).toBe('Accepted');
  });

  it('the only 429 refusals are the two cap kinds', () => {
    for (const kind of CAP_REFUSAL_KINDS) {
      expect(classifyDispatchAnswer(429, true, kind)).toBe('Refused');
    }
    expect(classifyDispatchAnswer(429, true, BUSY_KIND)).toBe('NoAnswer');
    expect(classifyDispatchAnswer(429, true, 'julius_dispatch_unknown')).toBe('NoAnswer');
    expect(classifyDispatchAnswer(429, false, '')).toBe('NoAnswer');
  });

  it('a bare 5xx is NoAnswer and a 5xx that names a kind is Refused', () => {
    expect(classifyDispatchAnswer(500, false, '')).toBe('NoAnswer');
    expect(classifyDispatchAnswer(503, true, 'julius_dispatch_disabled')).toBe('Refused');
    expect(classifyDispatchAnswer(400, true, 'julius_dispatch_run_invalid')).toBe('Refused');
  });

  it('pins the client resend schedule and does not run it', () => {
    expect([0, 1, 2, 3, 4, 5].map(clientResendDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(CLIENT_RESEND_MAX_COUNT).toBe(8);
    expect(CLIENT_RESEND_MAX_TOTAL_WAIT_MS).toBe(180_000);
  });
});

describe('model pins are read from the workflow env, never filled in', () => {
  it('quotes the paid workflow on main', () => {
    const source = readFileSync(join(__dirname, '../../../../.github/workflows/julius-first-live-mission.yml'), 'utf8');
    const read = parseWorkflowModelPins(source);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.pins).toEqual({
      architectModel: 'gpt-5.6-sol',
      codingModel: 'claude-opus-5-5',
      reviewerProvider: 'xai',
      reviewerModel: 'grok-build-0.1',
    });
    expect(source).toContain("grep -q 'architect=gpt-5.6-sol'");
    expect(source).toContain("grep -q 'coder=claude-opus-5-5'");
    expect(source).toContain("grep -q 'reviewer=xai/grok-build-0.1'");
  });

  it('a missing pin stays null and a duplicate fails closed', () => {
    const missing = parseWorkflowModelPins('OPENAI_PROMPT_ARCHITECT_MODEL: gpt-5.6-sol\n');
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.pins.codingModel).toBeNull();
    const duplicated = parseWorkflowModelPins('RELAY_HERMES_MODEL: grok-build-0.1\nRELAY_HERMES_MODEL: grok-other\n');
    expect(duplicated.ok).toBe(false);
    expect(duplicated.pins.reviewerModel).toBeNull();
  });
});

describe('one admission per pair', () => {
  it('a resend returns 200, the same run, and no error object', async () => {
    const admissions = store();
    const first = await admissions.admit(request());
    const second = await admissions.admit(request({ requestId: 'trigger_02' }));
    expect(first.ok && first.httpStatus).toBe(202);
    expect(second.ok && second.httpStatus).toBe(200);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.run.dispatchId).toBe(first.run.dispatchId);
    expect(second.run.state).toBe('ADMISSION_HELD');
    expect(second.run.requestId).toBe('trigger_01');
    expect(admissions.admissionCount()).toBe(1);
    expect(errorKindOf(httpBody(second)).hasError).toBe(false);
    expect(classifyDispatchAnswer(second.httpStatus, false, '')).toBe('Accepted');
    expect(second.run.paidWorkflow.confirmLive).toBe('');
    expect(second.run.paidWorkflow.submitted).toBe(false);
  });

  it('a concurrent resend during the ledger write is the same run and not busy', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let appends = 0;
    const ledger: AdmissionLedger = {
      async rows() { return []; },
      async append() {
        appends += 1;
        await gate;
      },
    };
    const admissions = store({ ledger });
    const first = admissions.admit(request());
    const second = admissions.admit(request());
    const replay = await second;
    expect(appends).toBe(1);
    expect(admissions.admissionCount()).toBe(1);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.httpStatus).toBe(200);
    expect(replay.run.state).toBe('RESERVED');
    expect(replay.run.dispatchId).toBe('adm_fixed');
    expect(JSON.stringify(replay)).not.toContain(BUSY_KIND);
    release();
    const created = await first;
    expect(created.ok && created.httpStatus).toBe(202);
    if (!created.ok) return;
    expect(created.run.state).toBe('ADMISSION_HELD');
    expect(created.run.ledgerWritten).toBe(true);
    expect(admissions.admissionCount()).toBe(1);
    expect(appends).toBe(1);
  });

  it('eight client resends still address the one admission', async () => {
    const admissions = store();
    const answers = [];
    for (let i = 0; i <= CLIENT_RESEND_MAX_COUNT; i += 1) answers.push(await admissions.admit(request()));
    expect(admissions.admissionCount()).toBe(1);
    expect(new Set(answers.map((answer) => answer.ok ? answer.run.dispatchId : 'refused')).size).toBe(1);
  });

  it('a ledger failure keeps the one run and is not written again', async () => {
    let attempts = 0;
    const ledger: AdmissionLedger = {
      async rows() { return []; },
      async append() {
        attempts += 1;
        throw new Error('ledger down');
      },
    };
    const admissions = store({ ledger });
    const first = await admissions.admit(request());
    const second = await admissions.admit(request());
    expect(attempts).toBe(1);
    expect(admissions.admissionCount()).toBe(1);
    if (!first.ok || !second.ok) throw new Error('expected the reserved run');
    expect(first.run.state).toBe('LEDGER_UNWRITTEN');
    expect(second.httpStatus).toBe(200);
    expect(second.run.state).toBe('LEDGER_UNWRITTEN');
    expect(second.run.ledgerWritten).toBe(false);
  });

  it('cap refusals reserve nothing and write nothing', async () => {
    const ledger = createMemoryAdmissionLedger();
    const admissions = store({ daily: 1, ledger });
    const first = await admissions.admit(request());
    const capped = await admissions.admit(request({
      runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_other',
    }));
    expect(first.ok).toBe(true);
    expect(capped).toMatchObject({ ok: false, httpStatus: 429, kind: 'julius_dispatch_cap_reached' });
    expect(admissions.admissionCount()).toBe(1);
    expect(ledger.snapshot()).toHaveLength(1);
    const body = { error: { kind: 'julius_dispatch_cap_reached', message: 'The admission cap is reached. Nothing was reserved.' } };
    const parsed = errorKindOf(body);
    expect(classifyDispatchAnswer(429, parsed.hasError, parsed.kind)).toBe('Refused');
  });

  it('the mission cap is the other 429 and a later day still counts that mission', async () => {
    const admissions = store({ daily: 5, mission: 1 });
    expect((await admissions.admit(request())).ok).toBe(true);
    const again = await admissions.admit(request({
      runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_next', receivedAt: '2026-10-24T00:00:00.000Z',
    }));
    expect(again).toMatchObject({ ok: false, httpStatus: 429, kind: 'julius_dispatch_mission_cap_reached' });
    expect(admissions.admissionCount()).toBe(1);
  });

  it('a different key or run is a conflict, not a second slot and not a resend', async () => {
    const admissions = store();
    await admissions.admit(request());
    const otherKey = await admissions.admit(request({ keyHash: KEY_2 }));
    const otherRun = await admissions.admit(request({ runId: RUN_2 }));
    expect(otherKey).toMatchObject({ ok: false, httpStatus: 409, kind: 'julius_dispatch_already_dispatched' });
    expect(otherRun).toMatchObject({ ok: false, httpStatus: 409, kind: 'julius_dispatch_key_reused' });
    expect(admissions.admissionCount()).toBe(1);
  });

  it('interrupted and failed stay on the same run with no further ledger write', async () => {
    const ledger = createMemoryAdmissionLedger();
    const admissions = store({ ledger });
    const created = await admissions.admit(request());
    if (!created.ok) throw new Error('expected an admission');
    expect(admissions.markTerminal(created.run.runId, 'INTERRUPTED')?.state).toBe('INTERRUPTED');
    const replay = await admissions.admit(request());
    expect(replay.ok && replay.run.state).toBe('INTERRUPTED');
    expect(admissions.markTerminal(created.run.runId, 'FAILED')).toBeTruthy();
    expect(ledger.snapshot()).toHaveLength(1);
    expect(admissions.admissionCount()).toBe(1);
  });

  it('a result hash binds once and a different hash does not open a run', async () => {
    const admissions = store();
    const created = await admissions.admit(request());
    if (!created.ok) throw new Error('expected an admission');
    const hash = 'd'.repeat(64);
    expect(admissions.attachResultHash(created.run.runId, hash)?.resultSha256).toBe(hash);
    expect(admissions.attachResultHash(created.run.runId, hash)?.resultHashConflicts).toBe(0);
    const conflict = admissions.attachResultHash(created.run.runId, 'e'.repeat(64));
    expect(conflict?.resultSha256).toBe(hash);
    expect(conflict?.resultHashConflicts).toBe(1);
    expect(admissions.admissionCount()).toBe(1);
  });

  it('reloads a ledger row into the same admission instead of reserving again', async () => {
    const ledger = createMemoryAdmissionLedger();
    const first = store({ ledger });
    const created = await first.admit(request());
    if (!created.ok) throw new Error('expected an admission');
    let remints = 0;
    const reloaded = store({
      ledger,
      mintServerRunId: () => {
        remints += 1;
        throw new Error('mint_on_reload');
      },
    });
    const replay = await reloaded.admit(request({ dispatchId: 'adm_ignored' }));
    expect(reloaded.admissionCount()).toBe(1);
    expect(replay.ok && replay.httpStatus).toBe(200);
    if (!replay.ok) return;
    expect(replay.run.dispatchId).toBe(created.run.dispatchId);
    expect(replay.run.serverRunId).toBe(created.run.serverRunId);
    expect(replay.run.ledgerWritten).toBe(true);
    expect(remints).toBe(0);
    expect(ledger.snapshot()[0]?.serverRunId).toBe(created.run.serverRunId);
  });
});

describe('one server run id per admitted pair', () => {
  it('a resend returns that id and does not mint another', async () => {
    let mints = 0;
    const admissions = store({
      mintServerRunId: () => {
        mints += 1;
        return `run:${'a'.repeat(24)}`;
      },
    });
    const first = await admissions.admit(request());
    const second = await admissions.admit(request());
    if (!first.ok || !second.ok) throw new Error('expected the reserved run');
    expect(first.run.serverRunId).toBe('run:' + 'a'.repeat(24));
    expect(second.run.serverRunId).toBe(first.run.serverRunId);
    expect(second.httpStatus).toBe(200);
    expect(mints).toBe(1);
    expect(JULIUS_BOOTSTRAP_RUN_ID.test(first.run.serverRunId)).toBe(true);
  });

  it('different pairs, including concurrent reservations, never share a server run id', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    let both: () => void = () => {};
    const bothEntered = new Promise<void>((resolve) => { both = resolve; });
    const mintedIds: string[] = [];
    const ledger: AdmissionLedger = {
      async rows() { return []; },
      async append() {
        entered += 1;
        if (entered === 2) both();
        await gate;
      },
    };
    const admissions = store({
      ledger,
      mintServerRunId: () => {
        const id = `run:${(mintedIds.length + 1).toString(16).padStart(24, '0')}`;
        mintedIds.push(id);
        return id;
      },
    });
    const first = admissions.admit(request());
    const second = admissions.admit(request({ runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_other' }));
    await bothEntered;
    expect(mintedIds).toHaveLength(2);
    expect(new Set(mintedIds).size).toBe(2);
    expect(admissions.runs().map((run) => run.serverRunId).sort()).toEqual([...mintedIds].sort());
    release();
    const [created, other] = await Promise.all([first, second]);
    if (!created.ok || !other.ok) throw new Error('expected two admissions');
    expect(created.run.serverRunId).not.toBe(other.run.serverRunId);
    expect(admissions.admissionCount()).toBe(2);
  });

  it('a failed reservation stores nothing, so the minted id is not reused', async () => {
    const ledger = createMemoryAdmissionLedger();
    const mintedIds: string[] = [];
    const valid = `run:${'b'.repeat(24)}`;
    const admissions = store({
      ledger,
      mintServerRunId: () => {
        const id = mintedIds.length === 0 ? 'run:not-a-bootstrap-id' : valid;
        mintedIds.push(id);
        return id;
      },
    });
    await expect(admissions.admit(request())).rejects.toThrow('admission_server_run_id_invalid');
    expect(admissions.admissionCount()).toBe(0);
    expect(ledger.snapshot()).toHaveLength(0);
    expect(admissions.runs().some((run) => run.serverRunId === mintedIds[0])).toBe(false);
    const created = await admissions.admit(request());
    if (!created.ok) throw new Error('expected the reserved run');
    expect(created.run.serverRunId).toBe(valid);
    expect(created.run.serverRunId).not.toBe(mintedIds[0]);
    expect(ledger.snapshot()).toEqual([expect.objectContaining({ serverRunId: valid })]);
    const replay = await admissions.admit(request());
    if (!replay.ok) throw new Error('expected the replay');
    expect(replay.run.serverRunId).toBe(valid);
    expect(mintedIds).toEqual(['run:not-a-bootstrap-id', valid]);
  });

  it('a colliding mint is refused before the pair is reserved', async () => {
    const taken = `run:${'c'.repeat(24)}`;
    const fresh = `run:${'d'.repeat(24)}`;
    const mintedIds: string[] = [];
    const admissions = store({
      mintServerRunId: () => {
        const id = mintedIds.length === 0 ? taken : mintedIds.length === 1 ? taken : fresh;
        mintedIds.push(id);
        return id;
      },
    });
    const first = await admissions.admit(request());
    if (!first.ok) throw new Error('expected the reserved run');
    await expect(admissions.admit(request({
      runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_other',
    }))).rejects.toThrow('admission_server_run_id_invalid');
    expect(admissions.admissionCount()).toBe(1);
    expect(admissions.runs().map((run) => run.serverRunId)).toEqual([taken]);
    const second = await admissions.admit(request({
      runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_other',
    }));
    if (!second.ok) throw new Error('expected the second admission');
    expect(second.run.serverRunId).toBe(fresh);
    expect(new Set(admissions.runs().map((run) => run.serverRunId)).size).toBe(2);
  });

  it('a bad clock throws before a server run id is minted', async () => {
    let mints = 0;
    const admissions = store({
      mintServerRunId: () => {
        mints += 1;
        return `run:${'e'.repeat(24)}`;
      },
    });
    await expect(admissions.admit(request({ receivedAt: 'not-a-time' }))).rejects.toThrow('admission_clock_invalid');
    expect(mints).toBe(0);
    expect(admissions.admissionCount()).toBe(0);
  });
});

function httpBody(outcome: { ok: true; run: AdmissionRun }): { data: { runId: string; state: string } } {
  return { data: { runId: outcome.run.runId, state: outcome.run.state } };
}

describe('the store does not emit busy or schedule a retry', () => {
  it('has no busy kind and no timer', () => {
    const source = readFileSync(join(__dirname, 'admission-store.ts'), 'utf8');
    expect(source).not.toContain(BUSY_KIND);
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('workflow_dispatch');
    expect(source).not.toContain('RUN LIVE MISSION');
    expect(source).not.toContain('node:crypto');
    expect(source).not.toContain('randomBytes');
    expect(source).not.toContain('randomUUID');
  });
});
