import { execFile, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { juliusPrincipal, juliusWorkerPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { readAllJuliusBrainEntities } from '../src/relay/mission/julius/julius-brain-store';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { LocalJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { JuliusPythonExecutionPostgresStore } from '../src/relay/persistence/julius-python-postgres';
import { migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { NodeJuliusPythonRunner, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from '../src/relay/workspace/julius-tools/python-runner';
import { FLOW, flowPythonService, flowRequest, latencyDataset, runBrainPythonMissionFlow, summariseBrainPythonFlow, type BrainPythonFlowSummary } from './julius-brain-python-flow';

/**
 * THE BRAIN + PYTHON DRILL, ACROSS REAL PROCESSES AND A REAL POSTGRESQL.
 *
 *   A   runs the whole mission (three tiers, three Python executions) and exits
 *   —   the PostgreSQL server restarts, when JULIUS_BRAIN_DRILL_RESTART is set
 *   B   starts cold and must reconstruct the identical Brain and executions
 *   H   hosts a long execution; C, a different process, cancels it through the
 *       database; H must kill the interpreter and settle CANCELLED
 *   H2  hosts a long execution and crashes; the orphaned interpreter must end
 *       itself; R, another process, must settle it DISCONNECTED — never rerun
 *
 *   JULIUS_BRAIN_DATABASE_URL=… node dist-relay-bridge/julius-brain-python-flow-drill.cjs
 */

const run = promisify(execFile);
const USER = juliusPrincipal('USER', 'founder');
const CODER = juliusWorkerPrincipal('coder-1', 'CODING_AGENT');
const LONG_SCRIPT = 'import time\nfrom julius import brain\nbrain.trace("staged before the end")\ntime.sleep(120)\n';

interface Stores { pool: Pool; brains: JuliusBrainPostgresStore; executions: JuliusPythonExecutionPostgresStore }
const stores = (databaseUrl: string): Stores => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  return { pool, brains: new JuliusBrainPostgresStore(pool), executions: new JuliusPythonExecutionPostgresStore(pool) };
};
const realClock = { now: () => new Date().toISOString() };
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const lastJson = <T>(text: string): T => JSON.parse(text.trim().split('\n').filter((line) => line.startsWith('{')).at(-1)!) as T;
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function host(databaseUrl: string, artifacts: string, executionId: string, crash: boolean, timeoutMs: number): Promise<number> {
  const { pool, brains, executions } = stores(databaseUrl);
  const python = discoverJuliusPythonExecutable();
  const sdkRoot = resolveJuliusPythonSdkRoot();
  if (python === null || sdkRoot === null) { process.stderr.write('drill_requires_python\n'); return 2; }
  const content = new LocalJuliusBrainContentStore(artifacts);
  const runner = new NodeJuliusPythonRunner({
    sandboxRoot: mkdtempSync(join(tmpdir(), 'jflow-host-')), sdkRoot, content,
    onSpawn: ({ pid }) => {
      emit({ mode: 'host', executionId, pythonPid: pid, hostPid: process.pid });
      if (crash) {
        // Crash only once the execution is durably RUNNING, so the failure is
        // exactly "a host died holding an in-flight execution".
        void (async () => {
          for (let i = 0; i < 200; i += 1) {
            if ((await executions.load(executionId, FLOW.projectId))?.state === 'RUNNING') break;
            await wait(25);
          }
          process.exit(87);
        })();
      }
    },
  });
  const service = flowPythonService({ brains, executions, content, runner, python, clock: realClock, hostInstanceId: `host-${process.pid}` });
  const dataset = await content.put(new TextEncoder().encode(latencyDataset()));
  const record = await service.execute(flowRequest({
    executionId, requestedBy: CODER, taskId: 'task-long', purpose: 'A long analysis', source: LONG_SCRIPT, dataset, readKinds: ['OBJECTIVE'], now: realClock.now(), timeoutMs,
  }));
  emit({ mode: 'host', executionId, state: record.state, outcome: record.outcome });
  await pool.end();
  return 0;
}

export async function runBrainPythonFlowDrill(input: { readonly argv: readonly string[]; readonly databaseUrl: string | undefined; readonly restartCommand: string | undefined; readonly self: string }): Promise<number> {
  if (!input.databaseUrl) { process.stderr.write('julius_brain_python_drill_requires_database_url\n'); return 2; }
  const [mode = 'orchestrate'] = input.argv;
  const flag = (name: string) => { const index = input.argv.indexOf(name); return index >= 0 ? input.argv[index + 1] : undefined; };
  const artifacts = flag('--artifacts') ?? mkdtempSync(join(tmpdir(), 'jflow-cas-'));
  const executionIds = ['exec-coder-v1', 'exec-reviewer-check', 'exec-coder-repair'];

  if (mode === 'write') {
    const { pool, brains, executions } = stores(input.databaseUrl);
    try {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      const python = discoverJuliusPythonExecutable();
      const sdkRoot = resolveJuliusPythonSdkRoot();
      if (python === null || sdkRoot === null) { process.stderr.write('drill_requires_python\n'); return 2; }
      const content = new LocalJuliusBrainContentStore(artifacts);
      let tick = 0;
      const clock = { now: () => new Date(Date.parse('2026-09-13T08:00:00.000Z') + (tick++) * 1_000).toISOString() };
      const runner = new NodeJuliusPythonRunner({ sandboxRoot: mkdtempSync(join(tmpdir(), 'jflow-sbx-')), sdkRoot, content });
      await runBrainPythonMissionFlow({ brains, executions, content, runner, python, clock, hostInstanceId: `host-${process.pid}` });
      emit({ mode, pid: process.pid, summary: await summariseBrainPythonFlow({ brains, executions, content }, executionIds) });
      return 0;
    } finally { await pool.end(); }
  }
  if (mode === 'read') {
    const { pool, brains, executions } = stores(input.databaseUrl);
    try {
      emit({ mode, pid: process.pid, summary: await summariseBrainPythonFlow({ brains, executions, content: new LocalJuliusBrainContentStore(artifacts) }, executionIds) });
      return 0;
    } finally { await pool.end(); }
  }
  if (mode === 'host') return host(input.databaseUrl, artifacts, flag('--execution')!, input.argv.includes('--crash'), Number(flag('--timeout') ?? 30_000));
  if (mode === 'cancel' || mode === 'recover') {
    const { pool, brains, executions } = stores(input.databaseUrl);
    try {
      const service = flowPythonService({
        brains, executions, content: new LocalJuliusBrainContentStore(artifacts), python: 'unused', clock: realClock, hostInstanceId: `${mode}-${process.pid}`,
        runner: { run: async () => { throw new Error('this process never runs Python'); } },
      });
      if (mode === 'cancel') emit({ mode, pid: process.pid, result: await service.cancel({ executionId: flag('--execution')!, projectId: FLOW.projectId, requestedBy: USER }) });
      else emit({ mode, pid: process.pid, recovered: await service.recoverDisconnected() });
      return 0;
    } finally { await pool.end(); }
  }

  /* ---------------------------------------------------------- orchestrate */
  const env = { ...process.env, JULIUS_BRAIN_DATABASE_URL: input.databaseUrl };
  const child = (args: string[]) => run(process.execPath, [input.self, ...args, '--artifacts', artifacts], { env, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  const postmaster = async () => { const pool = new Pool({ connectionString: input.databaseUrl, max: 1 }); try { return String((await pool.query('SELECT pg_postmaster_start_time()::text AS t')).rows[0].t); } finally { await pool.end(); } };
  const report: Record<string, unknown> = {};

  const a = lastJson<{ pid: number; summary: BrainPythonFlowSummary }>((await child(['write'])).stdout);
  const startBefore = await postmaster();
  if (input.restartCommand) {
    const [command, ...args] = input.restartCommand.split(' ');
    await run(command!, args, { timeout: 120_000 });
    for (let i = 0; i < 120; i += 1) { try { await postmaster(); break; } catch { await wait(500); } }
  }
  // Retried: a restarting server can accept a connection and still refuse the query.
  let startAfter = startBefore;
  for (let i = 0; i < 240; i += 1) { try { startAfter = await postmaster(); break; } catch { await wait(500); } }
  const b = lastJson<{ pid: number; summary: BrainPythonFlowSummary }>((await child(['read'])).stdout);
  report.restart = { claimed: Boolean(input.restartCommand), startBefore, startAfter, serverRestarted: startBefore !== startAfter };
  report.reconstruction = {
    processA: a.pid, processB: b.pid, identical: JSON.stringify(a.summary) === JSON.stringify(b.summary), resume: b.summary.resume,
    executions: b.summary.executions.map((row) => `${row.executionId}:${row.state}:${row.admitted}`), finding: b.summary.finding, provenance: b.summary.provenance,
  };

  // Cross-process cancellation.
  const hostProcess = spawn(process.execPath, [input.self, 'host', '--execution', 'exec-long-cancel', '--timeout', '60000', '--artifacts', artifacts], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let hostOut = '';
  hostProcess.stdout.on('data', (chunk: Buffer) => { hostOut += chunk.toString('utf8'); });
  hostProcess.stderr.on('data', (chunk: Buffer) => { hostOut += chunk.toString('utf8'); });
  const hostExit = new Promise<number | null>((resolve) => hostProcess.once('close', resolve));
  const { pool: probePool, executions: probe, brains: probeBrains } = stores(input.databaseUrl);
  try {
    for (let i = 0; i < 400 && (await probe.load('exec-long-cancel', FLOW.projectId))?.state !== 'RUNNING'; i += 1) await wait(50);
    await wait(750);
    const cancel = lastJson<{ pid: number; result: string }>((await child(['cancel', '--execution', 'exec-long-cancel'])).stdout);
    const exitCode = await hostExit;
    const cancelled = await probe.load('exec-long-cancel', FLOW.projectId);
    const cancelledPid = (hostOut.split('\n').filter((line) => line.includes('pythonPid')).map((line) => JSON.parse(line).pythonPid as number))[0] ?? null;
    const entities = await readAllJuliusBrainEntities(probeBrains, FLOW.brainId, FLOW.projectId);
    report.crossProcessCancel = {
      hostExit: exitCode, cancelResult: cancel.result, cancelProcess: cancel.pid, state: cancelled?.state, cancellation: cancelled?.outcome?.cancellation,
      pythonGone: cancelledPid === null ? null : !alive(cancelledPid),
      brainRecord: entities.find((state) => state.entityId === 'python-execution:exec-long-cancel')?.body.state ?? null,
      stagedTraceAdmitted: entities.some((state) => state.kind === 'TRACE' && state.provenance.executionId === 'exec-long-cancel'),
    };

    // Host crash, orphan termination, DISCONNECTED recovery.
    let crashOut = '';
    const crashing = spawn(process.execPath, [input.self, 'host', '--execution', 'exec-long-crash', '--timeout', '4000', '--crash', '--artifacts', artifacts], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    crashing.stdout.on('data', (chunk: Buffer) => { crashOut += chunk.toString('utf8'); });
    const crashExit = await new Promise<number | null>((resolve) => crashing.once('close', resolve));
    const orphan = (crashOut.split('\n').filter((line) => line.includes('pythonPid')).map((line) => JSON.parse(line).pythonPid as number))[0] ?? null;
    let orphanGone = false;
    for (let i = 0; i < 100 && orphan !== null; i += 1) { if (!alive(orphan)) { orphanGone = true; break; } await wait(100); }
    const stillRunning = (await probe.load('exec-long-crash', FLOW.projectId))?.state;
    await wait(7_000);
    const recover = lastJson<{ pid: number; recovered: number }>((await child(['recover'])).stdout);
    const recovered = await probe.load('exec-long-crash', FLOW.projectId);
    const after = await readAllJuliusBrainEntities(probeBrains, FLOW.brainId, FLOW.projectId);
    report.hostCrash = {
      hostExit: crashExit, orphanPid: orphan, orphanGone, stateAfterCrash: stillRunning, recovered: recover.recovered, recoverProcess: recover.pid,
      state: recovered?.state, reasonCode: recovered?.outcome?.reasonCode,
      brainRecord: after.find((state) => state.entityId === 'python-execution:exec-long-crash')?.body.state ?? null,
      stagedTraceAdmitted: after.some((state) => state.kind === 'TRACE' && state.provenance.executionId === 'exec-long-crash'),
    };
  } finally {
    await probePool.end();
    if (hostProcess.exitCode === null) hostProcess.kill();
  }

  const reconstruction = report.reconstruction as { identical: boolean; resume: string; processA: number; processB: number };
  const cancel = report.crossProcessCancel as Record<string, unknown>;
  const crash = report.hostCrash as Record<string, unknown>;
  const restart = report.restart as { claimed: boolean; serverRestarted: boolean };
  const checks = {
    separateProcesses: reconstruction.processA !== reconstruction.processB,
    identicalReconstruction: reconstruction.identical && reconstruction.resume === 'VERIFIED',
    serverRestartHonest: !restart.claimed || restart.serverRestarted,
    crossProcessCancel: cancel.cancelResult === 'CANCEL_REQUESTED' && cancel.state === 'CANCELLED' && cancel.brainRecord === 'CANCELLED' && cancel.stagedTraceAdmitted === false && cancel.pythonGone === true
      && (cancel.cancellation as { requestedBy?: string; confirmedBy?: string } | undefined)?.requestedBy === 'USER:founder'
      && (cancel.cancellation as { confirmedBy?: string } | undefined)?.confirmedBy === 'KILLED',
    hostCrash: crash.hostExit === 87 && crash.orphanGone === true && crash.stateAfterCrash === 'RUNNING' && crash.recovered === 1
      && crash.state === 'DISCONNECTED' && crash.brainRecord === 'DISCONNECTED' && crash.stagedTraceAdmitted === false,
  };
  const passed = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ mode: 'orchestrate', checks, report, restart: restart.claimed ? 'POSTGRESQL SERVER RESTART' : 'PROCESS RESTART ONLY' }, null, 2)}\n`);
  process.stdout.write(passed ? 'JULIUS BRAIN + PYTHON DRILL VERIFIED\n' : 'JULIUS BRAIN + PYTHON DRILL NOT VERIFIED\n');
  return passed ? 0 : 8;
}
