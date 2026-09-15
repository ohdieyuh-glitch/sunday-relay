import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../../mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from '../../mission/julius/julius-brain-archive-import';
import { juliusPrincipal, juliusWorkerPrincipal } from '../../mission/julius/julius-brain-contracts';
import { juliusBrainSchemaDocument } from '../../mission/julius/julius-brain-schema-document';
import { createJuliusProjectBrainService } from '../../mission/julius/julius-brain-service';
import type { JuliusBrainStateModePolicy } from '../../mission/julius/julius-brain-state-modes';
import { createJuliusBrainMemoryStore } from '../../mission/julius/julius-brain-store';
import { JULIUS_PYTHON_DEFAULT_LIMITS, JULIUS_PYTHON_REQUEST_FORMAT, type JuliusPythonExecutionRequest } from '../../mission/julius/julius-python-contracts';
import { createJuliusPythonExecutionMemoryStore, createJuliusPythonExecutionService } from '../../mission/julius/julius-python-service';
import { cardPolicy } from '../../mission/julius/julius-runtime-fixtures';
import { LocalJuliusBrainContentStore } from '../../persistence/julius-brain-content-store';
import { NodeJuliusPythonRunner, StaticJuliusPythonEnvironmentRegistry, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from './python-runner';

/**
 * A PYTHON EXECUTION OBEYS THE SAME RETRIEVAL AUTHORITY AS A WORKER. With a real
 * interpreter: an archived paid run in the Brain is absent from a FRESH
 * execution's snapshot and present in a LEARNING one. Todo without CPython 3.11+.
 */
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();
const suite = python !== null && sdkRoot !== null ? describe : describe.todo;

const BRAIN = 'brain:julius';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const CURRENT_RUN = 'run:julius-live-4:now';

suite('Python under state modes', () => {
  async function setup() {
    const clock = { now: () => new Date().toISOString() };
    const brains = createJuliusBrainMemoryStore();
    const service = createJuliusProjectBrainService({ store: brains, clock });
    await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: juliusPrincipal('JULIUS', 'julius') });
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jpy-mode-cas-')));
    const imported = await importJuliusPaidRunArchive({ store: brains, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: clock.now() });
    expect(imported.outcome).toBe('IMPORTED');
    const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    const objective = await julius.create('OBJECTIVE', { statement: 'Implement the trust core', successMeasure: null }, { key: 'objective', scope: { missionId: MISSION } });
    if (objective.outcome !== 'COMMITTED') throw new Error(objective.detail);
    // A prior run's judgment against the objective: an edge a FRESH interpreter must not be handed.
    await julius.create('EVIDENCE', {
      evidenceClass: 'OBSERVATION', claim: 'the objective was unreachable last run', summary: 'prior run', status: 'FAILED', verification: 'UNVERIFIED', data: {}, juliusEvidenceId: null,
    }, { key: 'prior-contradiction', scope: { missionId: MISSION, runId: 'run:julius-live-4:prev' }, links: [{ relation: 'CONTRADICTS', target: objective.receipts[0]!.entityId, targetVersion: null }] });
    const python_ = createJuliusPythonExecutionService({
      store: createJuliusPythonExecutionMemoryStore(brains), brains,
      runner: new NodeJuliusPythonRunner({ sandboxRoot: mkdtempSync(join(tmpdir(), 'jpy-mode-sbx-')), sdkRoot: sdkRoot!, content }),
      environments: new StaticJuliusPythonEnvironmentRegistry(new Map([['system-python', python!]])),
      secrets: { has: () => false, resolve: async () => null },
      policies: { cardFor: async () => cardPolicy({ capabilities: ['python', 'process'], network: false }) },
      schema: juliusBrainSchemaDocument(), clock, hostInstanceId: 'host-modes',
    });
    let counter = 0;
    const request = (stateMode: JuliusBrainStateModePolicy | null, overrides: Partial<JuliusPythonExecutionRequest> = {}): JuliusPythonExecutionRequest => {
      counter += 1;
      return {
        format: JULIUS_PYTHON_REQUEST_FORMAT, executionId: `exec-mode-${counter}`, idempotencyKey: `exec-mode-${counter}`, brainId: BRAIN, projectId: PROJECT,
        missionId: MISSION, runId: CURRENT_RUN, taskId: 'task-now', requestedBy: juliusWorkerPrincipal('coder', 'CODING_AGENT'), purpose: 'look for prior findings',
        script: { kind: 'INLINE', source: 'from julius import brain, result\nresult.set({"findings": [f.get("statement") for f in brain.findings()], "objective": brain.get_objective().get("statement"), "contradictedBy": brain.get_objective().contradicted_by(), "mode": brain.state_mode()})\n' },
        argv: [], inputs: {}, files: [],
        brainRead: { kinds: ['OBJECTIVE', 'FINDING', 'EVIDENCE'], taskScoped: false, includeHistory: false, stateMode },
        brainWrite: { kinds: ['TRACE'], maxRecords: 1 }, environment: { environmentId: 'system-python', requirements: [] }, network: { mode: 'DENY' }, secrets: [],
        limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 30_000 }, requestedAt: clock.now(), ...overrides,
      };
    };
    return { python: python_, request, julius };
  }

  it('FRESH: the archived run exists in the Brain and is absent from the interpreter\'s world', async () => {
    const { python: service, request, julius } = await setup();
    const record = await service.execute(request({ mode: 'FRESH', missionId: MISSION, runId: CURRENT_RUN }));
    expect(record.outcome?.stderr?.text).toBe('');
    expect(record.state).toBe('SUCCEEDED');
    const value = record.outcome!.structured.value as { findings: string[]; objective: string; contradictedBy: string[]; mode: { mode: string; excluded: Record<string, number> } };
    expect(value.findings).toEqual([]);
    expect(value.objective).toBe('Implement the trust core');
    expect(value.contradictedBy).toEqual([]);
    expect(value.mode.mode).toBe('FRESH');
    expect(value.mode.excluded.PRIOR_RUN_STATE).toBeGreaterThan(0);
    expect((await julius.entities({ kinds: ['FINDING'] }))).toHaveLength(1);
    const execution = (await julius.current('PYTHON_EXECUTION')).find((state) => state.body.executionId === record.executionId)!;
    expect(execution.body.stateMode).toBe('FRESH');

    // Without a mode, the same script is handed the prior run's evidence and its edge: exactly what FRESH withheld.
    const unmoded = await service.execute(request(null));
    expect(unmoded.state).toBe('SUCCEEDED');
    expect((unmoded.outcome!.structured.value as { contradictedBy: string[] }).contradictedBy).toHaveLength(1);
  }, 60_000);

  it('LEARNING: the same archived finding is available when the policy names it', async () => {
    const { python: service, request } = await setup();
    const record = await service.execute(request({ mode: 'LEARNING', missionId: MISSION, runId: CURRENT_RUN, learnFrom: { runIds: ['run:julius-live-4:1'], kinds: ['FINDING'], requireVerified: false } }));
    expect(record.state).toBe('SUCCEEDED');
    expect((record.outcome!.structured.value as { findings: string[] }).findings).toEqual(['The coder was granted the ESTIMATE_NO_LEDGER allocation and stopped before implementing.']);
  }, 60_000);

  it('a mode that names another mission or run is refused before anything runs', async () => {
    const { python: service, request } = await setup();
    await expect(service.execute(request({ mode: 'FRESH', missionId: 'mission:other', runId: CURRENT_RUN }))).rejects.toThrow('brainRead.stateMode.missionId');
    await expect(service.execute(request({ mode: 'FRESH', missionId: MISSION, runId: CURRENT_RUN }, { runId: null }))).rejects.toThrow('brainRead.stateMode.runId');
  }, 60_000);
});
