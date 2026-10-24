import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createWonderlandAdmissionService, handleWonderlandStatusRoute, WONDERLAND_STATUS_PATH, type WonderlandAdmissionRouteRequest } from '../../../../relay-bridge/wonderland-admission-route';
import { identifyAdmissionRun } from './admission-run-id';
import {
  AdmissionFileClosedError,
  createFileAdmissionLedger,
  LEGACY_ADMISSION_SCHEMA_VERSION,
  openAdmissionFile,
} from './admission-file';
import { createMemoryAdmissionLedger, createWonderlandAdmissionStore, type AdmissionLedgerRow } from './admission-store';
import { createOperatorClaimTool, type GhSpawner } from './operator-claim';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const OTHER = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const WHEN = '2026-10-23T17:18:00.000Z';
const LEGACY = `run:${'a'.repeat(24)}`;
const LEGACY_LOCK = `julius-run-spent-${'a'.repeat(24)}`;

function row(over: Partial<AdmissionLedgerRow> = {}): AdmissionLedgerRow {
  return {
    phase: 'run_admission',
    runId: RUN,
    serverRunId: LEGACY,
    keyHash: KEY,
    dispatchId: 'adm_fixed',
    missionId: 'julius-continuous-1',
    requestId: 'trigger_01',
    clientLogSha256: 'c'.repeat(64),
    clientUiActionUtc: WHEN,
    receivedAt: WHEN,
    ledgerRef: 'julius-wonderland-admission:adm_fixed',
    resultSha256: null,
    state: 'ADMISSION_HELD',
    modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
    ...over,
  };
}

function document(schemaVersion: number, rows: readonly AdmissionLedgerRow[]): string {
  return `${JSON.stringify({ schemaVersion, rows })}\n`;
}

describe('schema v3 run ids', () => {
  it('fails closed on an ambiguous pair, both forms that disagree, and an unparsable id', () => {
    expect(identifyAdmissionRun(RUN, OTHER)).toEqual({ ok: false, reason: 'admission_run_id_ambiguous' });
    expect(identifyAdmissionRun(LEGACY, RUN)).toEqual({ ok: false, reason: 'admission_run_id_ambiguous' });
    expect(identifyAdmissionRun(LEGACY, LEGACY)).toEqual({ ok: false, reason: 'admission_run_id_ambiguous' });
    expect(identifyAdmissionRun('not-an-id', RUN).ok).toBe(false);
    expect(identifyAdmissionRun('', RUN)).toEqual({ ok: false, reason: 'admission_run_id_required' });
    expect(identifyAdmissionRun(RUN, RUN)).toMatchObject({ ok: true, form: 'wlj', serverRunId: RUN, legacyRunId: null });
    expect(identifyAdmissionRun(RUN, LEGACY)).toMatchObject({
      ok: true, form: 'legacy', serverRunId: LEGACY, legacyRunId: LEGACY, wljRunId: RUN,
    });
  });

  it('refuses a schema v3 row that is not keyed on one wlj id, and leaves the bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-v3-'));
    const samples = [
      document(3, [row({ serverRunId: OTHER })]),
      document(3, [row()]),
      document(3, [row({ runId: 'not-an-id', serverRunId: 'not-an-id' })]),
      document(2, [row({ runId: RUN, serverRunId: RUN })]),
    ];
    try {
      for (const text of samples) {
        const file = join(dir, `bad-${samples.indexOf(text)}.json`);
        writeFileSync(file, text);
        expect(() => createFileAdmissionLedger(file), text).toThrow(AdmissionFileClosedError);
        expect(readFileSync(file, 'utf8'), text).toBe(text);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('legacy schema v2 rows', () => {
  it('are read only, cannot be dispatched or resumed, and still fill the mission cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-legacy-'));
    const file = join(dir, 'admission.json');
    const text = document(LEGACY_ADMISSION_SCHEMA_VERSION, [row()]);
    writeFileSync(file, text);
    const ledger = createFileAdmissionLedger(file);
    try {
      const admissions = createWonderlandAdmissionStore({ ledger, dailyCap: 2, missionCap: 2 });
      const resume = await admissions.admit({
        runId: RUN,
        keyHash: KEY,
        dispatchId: 'adm_again',
        missionId: 'julius-continuous-1',
        requestId: 'trigger_01',
        clientLogSha256: 'c'.repeat(64),
        clientUiActionUtc: WHEN,
        receivedAt: WHEN,
        modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
      });
      expect(resume).toMatchObject({ ok: false, httpStatus: 409, kind: 'julius_dispatch_legacy_readonly' });
      const another = await admissions.admit({
        runId: OTHER,
        keyHash: OTHER_KEY,
        dispatchId: 'adm_other',
        missionId: 'julius-continuous-1',
        requestId: 'trigger_02',
        clientLogSha256: 'd'.repeat(64),
        clientUiActionUtc: WHEN,
        receivedAt: WHEN,
        modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
      });
      expect(another).toMatchObject({ ok: false, kind: 'julius_dispatch_legacy_readonly' });
      expect(admissions.markTerminal(RUN, 'FAILED')).toBeNull();
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(JSON.parse(text).schemaVersion).toBe(2);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still counts toward the mission cap and the untouched $60 MISSION_LIMITS grant', async () => {
    const ceilings = readFileSync(join(__dirname, '../../../../scripts/julius-live-contract-check.mjs'), 'utf8');
    expect(ceilings).toContain("'julius-continuous-1': Object.freeze({ spendUsd: 60, repairCycles: 3 })");
    const legacy = row();
    const memory = createMemoryAdmissionLedger();
    await memory.append(legacy);
    const admissions = createWonderlandAdmissionStore({ ledger: memory, dailyCap: 2, missionCap: 1 });
    const created = await admissions.admit({
      runId: OTHER,
      keyHash: OTHER_KEY,
      dispatchId: 'adm_other',
      missionId: 'julius-continuous-1',
      requestId: 'trigger_02',
      clientLogSha256: 'd'.repeat(64),
      clientUiActionUtc: WHEN,
      receivedAt: WHEN,
      modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
    });
    expect(created).toMatchObject({ ok: false, httpStatus: 429, kind: 'julius_dispatch_mission_cap_reached' });
    expect(admissions.admissionCount()).toBe(1);
    expect(memory.snapshot()).toEqual([legacy]);
  });

  it('cannot be claimed or spend-locked, and status answers either id form', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-legacy-'));
    const file = join(dir, 'admission.json');
    const text = document(LEGACY_ADMISSION_SCHEMA_VERSION, [row()]);
    writeFileSync(file, text);
    const calls: string[][] = [];
    const spawn: GhSpawner = {
      run(args) {
        calls.push([...args]);
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    try {
      const opened = openAdmissionFile(file);
      const claims = createOperatorClaimTool(opened, spawn, { nowIso: () => WHEN });
      const claimed = await claims.claim({
        wonderlandRunId: RUN,
        serverRunId: LEGACY,
        repo: 'founder/sunday-relay',
        lane: 'lab',
        workflowSource: 'on:\n  workflow_dispatch:\n    inputs:\n      server_run_id:\n        default: \'\'\n',
        dispatch: true,
        confirmation: 'RUN LIVE MISSION',
      });
      expect(claimed.ok).toBe(false);
      if (claimed.ok) return;
      expect(claimed.kind).toBe('legacy_readonly');
      expect(calls).toEqual([]);
      expect(readFileSync(file, 'utf8')).toBe(text);
      const status = await claims.status(RUN, LEGACY);
      expect(status.ok && status.record.serverRunId).toBe(LEGACY);
      expect(status.ok && status.record.spentTag).toBe(LEGACY_LOCK);

      const ports = createWonderlandAdmissionService({
        env: {
          JULIUS_WONDERLAND_ADMISSION: '1',
          JULIUS_J1_PROJECT_ID: 'project-1',
          JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
          JULIUS_WONDERLAND_MISSION: 'julius-continuous-1',
          JULIUS_WONDERLAND_ADMISSION_STORE: file,
        },
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
      });
      const request = (runId: string): WonderlandAdmissionRouteRequest => ({
        method: 'GET',
        path: WONDERLAND_STATUS_PATH,
        url: `${WONDERLAND_STATUS_PATH}?projectId=project-1&runId=${encodeURIComponent(runId)}`,
        authorization: 'Relay-Session native-token',
        origin: undefined,
        rawBody: '',
        idempotencyKey: undefined,
        remoteAddress: '127.0.0.1',
        host: 'localhost',
        forwarded: false,
        nowIso: WHEN,
        nowMs: Date.parse(WHEN),
      });
      for (const runId of [RUN, LEGACY]) {
        const answer = await handleWonderlandStatusRoute(request(runId), ports);
        expect(answer?.status, runId).toBe(200);
        expect(answer?.body, runId).toMatchObject({
          wljRunId: RUN,
          serverRunId: LEGACY,
          legacyRunId: LEGACY,
          dispatchedAt: null,
        });
      }
      expect(readFileSync(file, 'utf8')).toBe(text);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('admission parsing', () => {
  it('goes through the shared module and does not mint a run id', () => {
    const files = [
      'admission-store.ts',
      'admission-file.ts',
      'operator-claim.ts',
      'admission-run-id.ts',
    ];
    for (const name of files) {
      const source = readFileSync(join(__dirname, name), 'utf8');
      expect(source, name).toContain(name === 'admission-run-id.ts' ? 'scripts/julius-admission-run-id.mjs' : 'admission-run-id');
      expect(source, name).not.toContain('mintServerRunId');
      expect(source, name).not.toContain('randomBytes');
      expect(source, name).not.toContain('randomUUID');
      expect(source, name).not.toMatch(/JULIUS_BOOTSTRAP_RUN_ID\.test|WONDERLAND_RUN_ID\.test/);
    }
    const route = readFileSync(join(__dirname, '../../../../relay-bridge/wonderland-admission-route.ts'), 'utf8');
    expect(route).toContain('admission-run-id');
    expect(route).not.toContain('mintServerRunId');
    expect(route).not.toContain('randomBytes');
    expect(route).not.toContain('randomUUID');
  });
});
