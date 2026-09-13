import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { exportJuliusBrain, restoreJuliusBrainFromExport } from '../src/relay/mission/julius/julius-brain-export';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusBrainMemoryStore } from '../src/relay/mission/julius/julius-brain-store';
import { createJuliusPythonExecutionMemoryStore } from '../src/relay/mission/julius/julius-python-service';
import { LocalJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { NodeJuliusPythonRunner, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from '../src/relay/workspace/julius-tools/python-runner';
import { FLOW, runBrainPythonMissionFlow, summariseBrainPythonFlow } from './julius-brain-python-flow';

/**
 * THE INTEGRATED PRIVATE-BETA FLOW, IN MEMORY, WITH REAL PYTHON.
 *
 * Runs wherever a CPython 3.11+ exists — CI included — so the three tiers,
 * Julius, the Python tool and the Brain are exercised together on every run.
 * The PostgreSQL version, across real process restarts, is the drill.
 */
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();
const suite = python !== null && sdkRoot !== null ? describe : describe.todo;

suite('Julius, three tiers, Python and the Project Brain — one mission', () => {
  it('a contradicted conclusion is repaired, verified and superseded; everything survives export and restore', async () => {
    let tick = 0;
    const clock = { now: () => new Date(Date.parse('2026-09-13T08:00:00.000Z') + (tick++) * 1_000).toISOString() };
    const brains = createJuliusBrainMemoryStore();
    const executions = createJuliusPythonExecutionMemoryStore(brains);
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jflow-cas-')));
    const runner = new NodeJuliusPythonRunner({ sandboxRoot: mkdtempSync(join(tmpdir(), 'jflow-sbx-')), sdkRoot: sdkRoot!, content });
    const ids = await runBrainPythonMissionFlow({ brains, executions, content, runner, python: python!, clock, hostInstanceId: 'host-flow' });

    const summary = await summariseBrainPythonFlow({ brains, executions, content }, ids.executions);
    expect(summary.resume).toBe('VERIFIED');
    expect(summary.checkpointMatches).toBe(true);
    expect(summary.executions.map((row) => [row.state, row.brainState, row.admitted])).toEqual([['SUCCEEDED', 'SUCCEEDED', 3], ['SUCCEEDED', 'SUCCEEDED', 2], ['SUCCEEDED', 'SUCCEEDED', 4]]);
    for (const row of summary.executions) expect(row.brainScriptHash).toBe(row.scriptHash);
    expect(summary.finding).toEqual({ status: 'RESOLVED', inbound: ['REPAIRS<-REPAIR'] });
    expect(summary.decisions.superseded).toBe(1);
    expect(summary.decisions.active).toEqual(['Latency regressed from sample 100; the budget is breached']);
    expect(summary.contradicted).toEqual([ids.coderEvidence]);
    expect(summary.verifiedEvidence).toBe(1);
    expect(summary.artifacts).toEqual([
      { name: 'latency.csv', resolution: 'RESOLVED' }, { name: 'summary-v1.json', resolution: 'RESOLVED' }, { name: 'windows.csv', resolution: 'RESOLVED' },
    ]);
    // Decision → evidence → artifact → the Python execution that produced it, all from typed links.
    expect(summary.provenance).toEqual(['EVIDENCE:TOOL', 'ARTIFACT:TOOL', 'PYTHON_EXECUTION:JULIUS']);
    expect(summary.mission).toBe('COMPLETED');
    expect(summary.exportRedactions).toBe(0);

    const bundle = (await exportJuliusBrain({ store: brains, brainId: FLOW.brainId, projectId: FLOW.projectId, exportedBy: juliusPrincipal('JULIUS', 'julius'), exportedAt: clock.now() }))!;
    const restored = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(restored, JSON.parse(JSON.stringify(bundle)))).toMatchObject({ outcome: 'RESTORED' });
    const again = await summariseBrainPythonFlow({ brains: restored, executions, content }, ids.executions);
    expect(again).toEqual(summary);
  }, 180_000);
});
