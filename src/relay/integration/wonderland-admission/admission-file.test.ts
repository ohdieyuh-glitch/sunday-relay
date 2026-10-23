import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const fsLog = vi.hoisted(() => ({ ops: [] as string[] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync(...args: Parameters<typeof actual.openSync>) {
      const fd = actual.openSync(...args);
      fsLog.ops.push(`open ${String(args[1])} ${String(args[0])} fd=${fd}`);
      return fd;
    },
    fsyncSync(fd: number) {
      fsLog.ops.push(`fsync ${fd}`);
      return actual.fsyncSync(fd);
    },
    renameSync(from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]) {
      fsLog.ops.push(`rename ${String(from)} -> ${String(to)}`);
      return actual.renameSync(from, to);
    },
  };
});

import {
  ADMISSION_FILE_SCHEMA_VERSION,
  AdmissionFileClosedError,
  createFileAdmissionLedger,
  isAdmissionFileClosed,
  resolveAdmissionStorePath,
} from './admission-file';
import { createWonderlandAdmissionStore, type AdmissionRequest } from './admission-store';

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

function directory(): string {
  return mkdtempSync(join(tmpdir(), 'wonderland-admission-file-'));
}

describe('resolveAdmissionStorePath', () => {
  it('refuses unset, relative, and URL values', () => {
    expect(resolveAdmissionStorePath(undefined).ok).toBe(false);
    expect(resolveAdmissionStorePath('').ok).toBe(false);
    expect(resolveAdmissionStorePath('   ').ok).toBe(false);
    expect(resolveAdmissionStorePath('admission.json').ok).toBe(false);
    expect(resolveAdmissionStorePath('./admission.json').ok).toBe(false);
    expect(resolveAdmissionStorePath('https://example.com/admission.json').ok).toBe(false);
    expect(resolveAdmissionStorePath('http://127.0.0.1/admission.json').ok).toBe(false);
    expect(resolveAdmissionStorePath('file:///tmp/admission.json').ok).toBe(false);
    expect(resolveAdmissionStorePath('//127.0.0.1/share/admission.json').ok).toBe(false);
  });

  it('accepts an absolute path in a writable directory', () => {
    const dir = directory();
    try {
      const file = join(dir, 'admission.json');
      const located = resolveAdmissionStorePath(file);
      expect(located).toEqual({ ok: true, path: file });
      writeFileSync(join(dir, 'not-a-directory'), 'x');
      expect(resolveAdmissionStorePath(join(dir, 'not-a-directory', 'admission.json')).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the admission file', () => {
  it('writes schema version 2 and reloads the same server run id and cap', async () => {
    const dir = directory();
    const file = join(dir, 'admission.json');
    let opened: { close(): void } | null = null;
    try {
      let minted = 0;
      const mint = () => {
        minted += 1;
        return `run:${minted.toString(16).padStart(24, '0')}`;
      };
      const ledger = createFileAdmissionLedger(file);
      opened = ledger;
      const first = createWonderlandAdmissionStore({
        ledger, dailyCap: 1, missionCap: 1, mintServerRunId: mint,
      });
      const created = await first.admit(request());
      if (!created.ok) throw new Error('expected an admission');
      expect(created.run.state).toBe('ADMISSION_HELD');
      expect(readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
      const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; rows: { serverRunId: string }[] };
      expect(onDisk.schemaVersion).toBe(ADMISSION_FILE_SCHEMA_VERSION);
      expect(onDisk.rows).toHaveLength(1);
      expect(onDisk.rows[0]?.serverRunId).toBe(created.run.serverRunId);
      ledger.close();
      opened = null;

      let remints = 0;
      const reloaded = createFileAdmissionLedger(file);
      opened = reloaded;
      const second = createWonderlandAdmissionStore({
        ledger: reloaded,
        dailyCap: 1,
        missionCap: 1,
        mintServerRunId: () => {
          remints += 1;
          throw new Error('mint_on_reload');
        },
      });
      const replay = await second.admit(request({ dispatchId: 'adm_ignored' }));
      expect(replay.ok && replay.httpStatus).toBe(200);
      if (!replay.ok) throw new Error('expected the replay');
      expect(replay.run.serverRunId).toBe(created.run.serverRunId);
      expect(replay.run.state).toBe('ADMISSION_HELD');
      expect(remints).toBe(0);
      expect(second.admissionCount()).toBe(1);
      const capped = await second.admit(request({
        runId: RUN_2, keyHash: KEY_2, dispatchId: 'adm_other',
      }));
      expect(capped).toMatchObject({ ok: false, httpStatus: 429, kind: 'julius_dispatch_cap_reached' });
      const after = JSON.parse(readFileSync(file, 'utf8')) as { rows: unknown[] };
      expect(after.rows).toHaveLength(1);
    } finally {
      opened?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a held lock fails closed and leaves the file alone', () => {
    const dir = directory();
    const file = join(dir, 'admission.json');
    const first = createFileAdmissionLedger(file);
    try {
      expect(() => createFileAdmissionLedger(file)).toThrow(AdmissionFileClosedError);
      try {
        createFileAdmissionLedger(file);
        throw new Error('second opener took the lock');
      } catch (error) {
        expect(isAdmissionFileClosed(error)).toBe(true);
        if (isAdmissionFileClosed(error)) expect(error.code).toBe('lock_held');
      }
      expect(readFileSync(`${file}.lock`, 'utf8')).toContain('wonderland-admission');
    } finally {
      first.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('corrupt or unknown content fails closed and is never reset', () => {
    const dir = directory();
    const samples: { text: string; code: 'corrupt' | 'ledger_schema_unsupported' }[] = [
      { text: 'not-json', code: 'corrupt' },
      { text: '', code: 'corrupt' },
      { text: '{"schemaVersion":999,"rows":[]}\n', code: 'ledger_schema_unsupported' },
      { text: '{"schemaVersion":1,"rows":[]}\n', code: 'ledger_schema_unsupported' },
      { text: '{"schemaVersion":"1","rows":[]}\n', code: 'corrupt' },
      { text: '{"schemaVersion":1,"rows":[],"extra":true}\n', code: 'corrupt' },
    ];
    try {
      for (const sample of samples) {
        const file = join(dir, `admission-${samples.indexOf(sample)}.json`);
        writeFileSync(file, sample.text);
        const before = readFileSync(file);
        try {
          createFileAdmissionLedger(file);
          throw new Error(`opened ${sample.text}`);
        } catch (error) {
          expect(isAdmissionFileClosed(error), sample.text).toBe(true);
          if (isAdmissionFileClosed(error)) expect(error.code, sample.text).toBe(sample.code);
        }
        expect(readFileSync(file), sample.text).toEqual(before);
        expect(readdirSync(dir).some((name) => name.endsWith('.tmp')), sample.text).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an injected write failure fails closed and does not release the pair', async () => {
    const dir = directory();
    const file = join(dir, 'admission.json');
    let attempts = 0;
    const ledger = createFileAdmissionLedger(file, {
      persist(_filePath, contents) {
        attempts += 1;
        const parsed = JSON.parse(contents) as { rows: { state: string }[] };
        if (attempts === 1) {
          expect(parsed.rows[0]?.state).toBe('LEDGER_UNWRITTEN');
          writeFileSync(file, contents);
          return;
        }
        expect(parsed.rows[0]?.state).toBe('ADMISSION_HELD');
        throw new Error('disk full');
      },
    });
    try {
      let minted = 0;
      const admissions = createWonderlandAdmissionStore({
        ledger,
        dailyCap: 2,
        missionCap: 2,
        mintServerRunId: () => {
          minted += 1;
          return `run:${minted.toString(16).padStart(24, 'f')}`;
        },
      });
      const first = await admissions.admit(request());
      const second = await admissions.admit(request());
      if (!first.ok || !second.ok) throw new Error('expected the reserved run');
      expect(first.run.state).toBe('LEDGER_UNWRITTEN');
      expect(first.run.ledgerWritten).toBe(false);
      expect(second.httpStatus).toBe(200);
      expect(second.run.serverRunId).toBe(first.run.serverRunId);
      expect(second.run.state).toBe('LEDGER_UNWRITTEN');
      expect(attempts).toBe(2);
      expect(minted).toBe(1);
      expect(admissions.admissionCount()).toBe(1);
      const parked = JSON.parse(readFileSync(file, 'utf8')) as { rows: { state: string; serverRunId: string }[] };
      expect(parked.rows).toEqual([expect.objectContaining({
        state: 'LEDGER_UNWRITTEN',
        serverRunId: first.run.serverRunId,
      })]);
      ledger.close();

      let remints = 0;
      const reopened = createFileAdmissionLedger(file);
      const restarted = createWonderlandAdmissionStore({
        ledger: reopened,
        dailyCap: 2,
        missionCap: 2,
        mintServerRunId: () => {
          remints += 1;
          throw new Error('mint_on_unwritten_restart');
        },
      });
      const replay = await restarted.admit(request());
      if (!replay.ok) throw new Error('expected the parked pair');
      expect(replay.httpStatus).toBe(200);
      expect(replay.run.state).toBe('LEDGER_UNWRITTEN');
      expect(replay.run.serverRunId).toBe(first.run.serverRunId);
      expect(replay.run.ledgerWritten).toBe(false);
      expect(remints).toBe(0);
      expect(restarted.admissionCount()).toBe(1);
      const still = JSON.parse(readFileSync(file, 'utf8')) as { rows: { state: string }[] };
      expect(still.rows).toEqual([expect.objectContaining({ state: 'LEDGER_UNWRITTEN' })]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a data write fsyncs a temp file before renaming it onto the store', async () => {
    const dir = directory();
    const file = join(dir, 'admission.json');
    const ledger = createFileAdmissionLedger(file);
    fsLog.ops.length = 0;
    try {
      const created = await createWonderlandAdmissionStore({
        ledger, dailyCap: 2, missionCap: 2, mintServerRunId: () => `run:${'1'.padStart(24, '0')}`,
      }).admit(request());
      if (!created.ok) throw new Error('expected an admission');
      const renames = fsLog.ops
        .map((op, index) => ({ op, index }))
        .filter(({ op }) => op.startsWith('rename ') && op.includes(`${file}.`) && op.endsWith(` -> ${file}`));
      expect(renames.length).toBeGreaterThan(0);
      for (const { op, index } of renames) {
        const from = op.slice('rename '.length, op.indexOf(' -> '));
        const opened = [...fsLog.ops.slice(0, index)].reverse().find((item) => item.startsWith('open wx ') && item.includes(from));
        expect(opened, op).toBeTruthy();
        const fd = opened?.match(/fd=(\d+)/)?.[1];
        const between = fsLog.ops.slice(fsLog.ops.lastIndexOf(opened ?? '', index), index);
        expect(between, op).toContain(`fsync ${fd}`);
      }
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fsyncs the directory after the rename', async () => {
    const dir = directory();
    const file = join(dir, 'admission.json');
    const ledger = createFileAdmissionLedger(file);
    fsLog.ops.length = 0;
    try {
      const created = await createWonderlandAdmissionStore({
        ledger, dailyCap: 2, missionCap: 2, mintServerRunId: () => `run:${'2'.padStart(24, '0')}`,
      }).admit(request());
      if (!created.ok) throw new Error('expected an admission');
      const renames = fsLog.ops
        .map((op, index) => ({ op, index }))
        .filter(({ op }) => op.startsWith('rename ') && op.endsWith(` -> ${file}`));
      expect(renames.length).toBeGreaterThan(0);
      for (const { index } of renames) {
        const after = fsLog.ops.slice(index + 1);
        const nextRename = after.findIndex((item) => item.startsWith('rename '));
        const window = nextRename === -1 ? after : after.slice(0, nextRename);
        const opened = window.find((item) => item.startsWith(`open r ${dir} `) || item.startsWith(`open r ${dirname(file)} `));
        expect(opened, fsLog.ops.slice(index).join('\n')).toBeTruthy();
        const fd = opened?.match(/fd=(\d+)/)?.[1];
        expect(window.slice(window.indexOf(opened ?? '')), opened).toContain(`fsync ${fd}`);
      }
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the atomic write', () => {
    const source = readFileSync(join(__dirname, 'admission-file.ts'), 'utf8');
    expect(source).toContain('fsyncSync');
    expect(source).toContain('renameSync');
    expect(source).toContain('openSync(dirPath');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('node:crypto');
  });
});
