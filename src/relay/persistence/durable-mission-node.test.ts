import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeDurableMissionStore, DURABLE_MISSIONS_DIR } from './durable-mission-file';
import {
  DURABLE_MISSION_SCHEMA_VERSION,
  sealDurableRecord,
  type DurableMissionRecordDraft,
} from '../mission/durable';

/**
 * The NODE durable-mission adapter: the same canonical record the browser
 * writes, stored atomically under an isolated state root. Process recreation
 * is proven with real child processes — a record that only survives inside
 * one Node process is not durable.
 */

const roots: string[] = [];
const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'relay-durable-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

const NOW = '2026-08-01T10:00:00.000Z';

function draft(overrides: Partial<DurableMissionRecordDraft> = {}): DurableMissionRecordDraft {
  return {
    schemaVersion: DURABLE_MISSION_SCHEMA_VERSION,
    missionId: 'mission-node-1',
    projectId: 'rly-003',
    missionContractRef: 'rly-003:mission-node-1',
    missionContractRevision: 'r1',
    assignments: [],
    missionState: 'coding',
    stage: 'coding_agent_working',
    currentTaskRef: null,
    lastCompletedAction: null,
    inFlightAction: null,
    evidence: {
      filesReportedChanged: ['src/relay/cli/main.ts'],
      commandsReported: ['RUN typecheck'],
      testStatus: 'passed',
      evidenceRefs: [],
      traceLedgerRefs: [],
      executionCapsuleRefs: [],
      findingRefs: ['F-1'],
      repairRefs: [],
      handoffRefs: [],
      approvalRefs: [],
    },
    usage: {
      costReceiptRefs: ['receipt-1'],
      knownCostMicros: '2500000',
      currency: 'USD',
      budgetStatus: 'under_budget',
      usageProvenance: 'offline',
    },
    interruptionReason: 'process restarted',
    provenance: 'offline',
    createdAt: NOW,
    updatedAt: NOW,
    checkpointReason: 'bounded_task_completed',
    checkpointAt: NOW,
    recoveryGeneration: 0,
    owner: null,
    ...overrides,
  };
}

describe('node durable-mission adapter', () => {
  it('round-trips the canonical record through the filesystem', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    const written = await store.write(draft());
    expect(written.ok).toBe(true);
    const read = await store.read('mission-node-1');
    expect(read.ok).toBe(true);
    if (!read.ok || !written.ok) throw new Error('record must round-trip');
    expect(read.record).toEqual(written.record);
    expect(read.record.usage.knownCostMicros).toBe('2500000');
    expect(store.durability).toBe('durable');
  });

  it('SURVIVES PROCESS RECREATION — a second Node process reads it back', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    const written = await store.write(draft({ stage: 'written-by-process-one' }));
    expect(written.ok).toBe(true);

    // A genuinely separate process: no shared module state, no shared memory.
    const file = join(root, DURABLE_MISSIONS_DIR, `${encodeURIComponent('mission:mission-node-1')}.json`);
    const out = execFileSync(
      process.execPath,
      ['-e', `const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(${JSON.stringify(file)},'utf8'));process.stdout.write(r.stage+'|'+r.schemaVersion);`],
      { encoding: 'utf8' },
    );
    expect(out).toBe(`written-by-process-one|${DURABLE_MISSION_SCHEMA_VERSION}`);
  });

  it('writes atomically with restrictive permissions and leaves no temp file', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    await store.write(draft());
    const dir = join(root, DURABLE_MISSIONS_DIR);
    const entries = readdirSync(dir);
    expect(entries.some((name) => name.includes('.tmp-'))).toBe(false);
    const file = join(dir, entries.filter((n) => !n.endsWith('.previous.json'))[0]);
    // 0o600 — the same restriction the journal layer uses.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('keeps the previous known-good checkpoint when a newer write is replaced', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    await store.write(draft({ stage: 'first' }));
    await store.write(draft({ stage: 'second' }));
    const dir = join(root, DURABLE_MISSIONS_DIR);
    const previous = readdirSync(dir).find((n) => n.endsWith('.previous.json'));
    expect(previous).toBeTruthy();
    const retained = JSON.parse(readFileSync(join(dir, previous as string), 'utf8')) as { stage: string };
    expect(retained.stage).toBe('first');
    const current = await store.read('mission-node-1');
    expect(current.ok && current.record.stage).toBe('second');
  });

  it('rejects a corrupted file on disk instead of returning an empty mission', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    await store.write(draft());
    const file = join(root, DURABLE_MISSIONS_DIR, `${encodeURIComponent('mission:mission-node-1')}.json`);
    writeFileSync(file, '{ "schemaVersion": "relay-durable-mission.v1", "missionId": ', 'utf8');
    const read = await store.read('mission-node-1');
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('a truncated file must not load');
    expect(read.reason).toBe('corrupt');
    // The bytes are still there for inspection — nothing auto-deleted.
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0);
  });

  it('rejects a checksum mismatch written by hand', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    const sealed = sealDurableRecord(draft());
    const file = join(root, DURABLE_MISSIONS_DIR, `${encodeURIComponent('mission:mission-node-1')}.json`);
    await store.write(draft()); // creates the directory
    writeFileSync(file, JSON.stringify({ ...sealed, stage: 'edited-behind-relays-back' }), 'utf8');
    const read = await store.read('mission-node-1');
    expect(read.ok).toBe(false);
    if (read.ok || read.reason !== 'corrupt') {
      throw new Error('an edited record must be reported as corrupt');
    }
    expect(read.detail).toContain('checksum');
  });

  it('lists and removes records', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    await store.write(draft());
    await store.write(draft({ missionId: 'mission-node-2' }));
    expect([...(await store.list())].sort()).toEqual(['mission-node-1', 'mission-node-2']);
    await store.remove('mission-node-1');
    expect(await store.list()).toEqual(['mission-node-2']);
  });

  it('persists no secret material even when a caller passes some', async () => {
    const root = makeRoot();
    const store = createNodeDurableMissionStore(root);
    await store.write({
      ...draft(),
      ...({
        apiKey: 'sk-FAKETESTNOTREALFAKETESTNOTREAL',
        environmentValues: { TOKEN: 'x' },
      } as Partial<DurableMissionRecordDraft>),
    });
    const dir = join(root, DURABLE_MISSIONS_DIR);
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).not.toContain('apiKey');
      expect(text, name).not.toContain('environmentValues');
      expect(text, name).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    }
  });
});
