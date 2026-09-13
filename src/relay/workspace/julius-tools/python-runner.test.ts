import { mkdtempSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusPrincipal, juliusWorkerPrincipal } from '../../mission/julius/julius-brain-contracts';
import { juliusBrainSchemaDocument } from '../../mission/julius/julius-brain-schema-document';
import { createJuliusProjectBrainService } from '../../mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainCommitResult } from '../../mission/julius/julius-brain-store';
import {
  JULIUS_PYTHON_DEFAULT_LIMITS,
  JULIUS_PYTHON_REQUEST_FORMAT,
  type JuliusPythonExecutionRequest,
  type JuliusPythonRunInput,
  type JuliusPythonRunnerPort,
} from '../../mission/julius/julius-python-contracts';
import { createJuliusPythonExecutionMemoryStore, createJuliusPythonExecutionService } from '../../mission/julius/julius-python-service';
import { cardPolicy } from '../../mission/julius/julius-runtime-fixtures';
import type { JuliusBudgetPort } from '../../mission/julius/julius-runtime-ports';
import { LocalJuliusBrainContentStore } from '../../persistence/julius-brain-content-store';
import { NodeJuliusPythonRunner, StaticJuliusPythonEnvironmentRegistry, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from './python-runner';

/**
 * PYTHON AS A GOVERNED JULIUS TOOL, WITH REAL PROCESSES.
 *
 * Every test here spawns a real CPython through the real runner and settles
 * through the real service into a Brain. It needs a CPython 3.11+ on PATH and
 * reports todo — not green — without one.
 */
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();
const suite = python !== null && sdkRoot !== null ? describe : describe.todo;

const PROJECT = 'prj-python';
const BRAIN = 'brain:prj-python';
const MISSION = 'mission:analysis';
const TASK = 'task-analysis';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const CODER = juliusWorkerPrincipal('coder-1', 'CODING_AGENT');
// Assembled from fragments so this file holds no matchable credential literal.
const HOST_SECRET = ['sk', 'proj', 'HOSTONLYabcdefghijklmnopqrstuvwxyz0123'].join('-');
const GRANTED_SECRET = 'granted-token-7f3a9c2e5b81';

const ok = (result: JuliusBrainCommitResult): string => {
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return result.receipts[0]!.entityId;
};

let counter = 0;
async function harness(options: { capabilities?: string[]; runnerWrap?: (runner: JuliusPythonRunnerPort) => JuliusPythonRunnerPort; secrets?: Record<string, string>; budget?: JuliusBudgetPort } = {}) {
  const clock = { now: () => new Date().toISOString() };
  const brains = createJuliusBrainMemoryStore();
  const brainService = createJuliusProjectBrainService({ store: brains, clock });
  await brainService.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Python', principal: JULIUS });
  const julius = (await brainService.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const ids = {
    objective: ok(await julius.create('OBJECTIVE', { statement: 'Find the latency regression', successMeasure: null }, { key: 'o', scope: { missionId: MISSION } })),
    constraint: ok(await julius.create('CONSTRAINT', { statement: 'p95 must stay under 5ms', status: 'ACTIVE' }, { key: 'c', scope: { missionId: MISSION } })),
    restricted: ok(await julius.create('CONSTRAINT', { statement: 'customer name is Acme', status: 'ACTIVE' }, { key: 'r', scope: { missionId: MISSION }, sensitivity: 'RESTRICTED' })),
    elsewhere: ok(await julius.create('CONSTRAINT', { statement: 'other mission', status: 'ACTIVE' }, { key: 'x', scope: { missionId: 'mission:other' } })),
  };
  const cas = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jpy-cas-')));
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'jpy-sandbox-'));
  const executions = createJuliusPythonExecutionMemoryStore(brains);
  const realRunner = new NodeJuliusPythonRunner({ sandboxRoot, sdkRoot: sdkRoot!, content: cas });
  let runs = 0;
  const counting: JuliusPythonRunnerPort = { run: (input, signal) => { runs += 1; return realRunner.run(input, signal); } };
  const runner = options.runnerWrap ? options.runnerWrap(counting) : counting;
  const secretMap = options.secrets ?? { 'analytics-token': GRANTED_SECRET };
  const service = createJuliusPythonExecutionService({
    store: executions, brains, runner,
    environments: new StaticJuliusPythonEnvironmentRegistry(new Map([['system-python', python!]])),
    secrets: { has: (id) => id in secretMap, resolve: async (id) => secretMap[id] ?? null },
    policies: { cardFor: async () => cardPolicy({ capabilities: options.capabilities ?? ['python', 'process', 'secret:analytics-token'], network: false }) },
    schema: juliusBrainSchemaDocument(), clock, hostInstanceId: 'host-a', cancelPollMs: 50, budget: options.budget,
  });
  const request = (source: string, overrides: Partial<JuliusPythonExecutionRequest> = {}): JuliusPythonExecutionRequest => {
    counter += 1;
    return {
      format: JULIUS_PYTHON_REQUEST_FORMAT, executionId: `exec-${counter}`, idempotencyKey: `analysis-${counter}`,
      brainId: BRAIN, projectId: PROJECT, missionId: MISSION, runId: null, taskId: TASK, requestedBy: CODER,
      purpose: 'Analyse the latency samples', script: { kind: 'INLINE', source }, argv: [], inputs: {}, files: [],
      brainRead: { kinds: ['OBJECTIVE', 'CONSTRAINT', 'EVIDENCE'], taskScoped: false, includeHistory: false },
      brainWrite: { kinds: ['EVIDENCE', 'EVAL', 'FINDING', 'ARTIFACT', 'TRACE'], maxRecords: 20 },
      environment: { environmentId: 'system-python', requirements: [] }, network: { mode: 'DENY' }, secrets: [],
      limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 30_000 }, requestedAt: new Date().toISOString(),
      ...overrides,
    };
  };
  return { brains, julius, ids, cas, sandboxRoot, service, request, runs: () => runs };
}

const py = (...lines: string[]) => `${lines.join('\n')}\n`;

suite('Python as a governed Julius tool', () => {
  let savedSecret: string | undefined;
  beforeAll(() => { savedSecret = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = HOST_SECRET; });
  afterAll(() => { if (savedSecret === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedSecret; });

  it('reads scoped Brain context, processes an input file, and returns typed evidence, an eval and an artifact with full provenance', async () => {
    const h = await harness();
    const csv = await h.cas.put(new TextEncoder().encode('sample,latency_ms\n1,4.0\n2,4.4\n3,6.1\n4,3.9\n'));
    const record = await h.service.execute(h.request(py(
      'import csv, statistics',
      'from julius import artifacts, brain, evidence, result',
      'objective = brain.get_objective()',
      'assert objective is not None and "latency" in objective.get("statement")',
      'visible = sorted(e.get("statement") for e in brain.get_constraints())',
      'rows = [float(r["latency_ms"]) for r in csv.DictReader(open("../inputs/latency.csv"))]',
      'p95 = sorted(rows)[int(round(0.95 * (len(rows) - 1)))]',
      'limit = brain.inputs()["limit_ms"]',
      'artifacts.write("summary.json", \'{"p95": %s}\' % p95)',
      'art = brain.register_artifact("summary.json", "REPORT", "application/json")',
      'm = brain.record_evidence(evidence.Measurement("p95_ms", p95, "ms", claim="p95 under %s ms" % limit, status=evidence.FAILED if p95 >= limit else evidence.PASSED), supports=[objective], derived_from=[art])',
      'brain.record_eval(evidence.EvaluationResult("latency-budget", "ENTITY", objective.entity_id, "FAIL" if p95 >= limit else "PASS", score=0 if p95 >= limit else 1, max_score=1, seed=11), evidenced_by=[m])',
      'result.set({"p95": p95, "visible": visible})',
      'result.metric("p95", p95, "ms")',
      'print("analysed", len(rows), "samples")',
    ), { inputs: { limit_ms: 5 }, files: [{ name: 'latency.csv', storageRef: csv.storageRef, contentHash: csv.contentHash }] }));

    expect(record.outcome?.stderr?.text).toBe('');
    expect(record.state).toBe('SUCCEEDED');
    const outcome = record.outcome!;
    // Python saw its mission's constraint — and not the RESTRICTED one, and not another mission's.
    expect(outcome.structured.value).toEqual({ p95: 6.1, visible: ['p95 must stay under 5ms'] });
    expect(outcome.stdout?.text.trim()).toBe('analysed 4 samples');
    expect(outcome.proposals).toMatchObject({ status: 'VALID', staged: 3, admitted: 3 });
    expect(outcome.brain.outcome).toBe('COMMITTED');
    expect(outcome.usage?.enforcement).toMatchObject({ network: 'PYTHON_AUDIT_HOOK_DENY', filesystem: 'PYTHON_AUDIT_HOOK' });

    const entities = await readAllJuliusBrainEntities(h.brains, BRAIN, PROJECT);
    const execution = entities.find((state) => state.kind === 'PYTHON_EXECUTION')!;
    expect(execution.body).toMatchObject({ state: 'SUCCEEDED', exitCode: 0, proposalsAdmitted: 3, structuredOutput: 'VALID', network: 'DENY' });
    expect(execution.createdBy.kind).toBe('JULIUS');
    const measurement = entities.find((state) => state.kind === 'EVIDENCE')!;
    expect(measurement.body).toMatchObject({ evidenceClass: 'MEASUREMENT', status: 'FAILED', verification: 'UNVERIFIED' });
    expect(measurement.createdBy).toMatchObject({ kind: 'TOOL', id: `python.run:${record.executionId}`, onBehalfOf: 'coder-1' });
    expect(measurement.provenance).toMatchObject({ source: 'tool_observed', tool: 'python.run', executionId: record.executionId });
    expect(measurement.links.map((link) => link.relation).sort()).toEqual(['DERIVED_FROM', 'PRODUCED_BY', 'SUPPORTS']);
    const evalState = entities.find((state) => state.kind === 'EVAL')!;
    expect((evalState.body.reproducibility as Record<string, unknown>)).toMatchObject({ seed: 11, codeHash: record.scriptHash, environmentRunId: record.executionId });
    const artifact = entities.find((state) => state.kind === 'ARTIFACT')!;
    expect(await h.cas.resolve(String(artifact.body.storageRef), String(artifact.body.contentHash))).toEqual({ status: 'RESOLVED', byteSize: 12 });
    expect(readdirSync(h.sandboxRoot)).toEqual([]);
  }, 60_000);

  it('a replay returns the recorded execution and never runs the script again', async () => {
    const h = await harness();
    const request = h.request(py('from julius import result', 'result.set(1)'));
    const first = await h.service.execute(request);
    const second = await h.service.execute({ ...request, requestedAt: new Date().toISOString() });
    expect(second).toEqual(first);
    expect(h.runs()).toBe(1);
    await expect(h.service.execute({ ...request, script: { kind: 'INLINE', source: 'print(2)\n' } })).rejects.toThrow('julius_python_idempotency_conflict');
  }, 60_000);

  it('denied by C.A.R.D. without the python capability: nothing runs, and the denial is recorded', async () => {
    const h = await harness({ capabilities: ['process'] });
    const record = await h.service.execute(h.request(py('print("never")')));
    expect(record.state).toBe('DENIED');
    expect(record.outcome?.reasonCode).toBe('CARD_TOOL_DENIED');
    expect(h.runs()).toBe(0);
    const [execution] = await h.julius.current('PYTHON_EXECUTION');
    expect(execution!.body).toMatchObject({ state: 'DENIED', reasonCode: 'CARD_TOOL_DENIED', exitCode: null, durationMs: null });
  }, 60_000);

  it('a budgeted execution reserves its timeout as runtime and commits what it actually used', async () => {
    const calls: { op: string; input: Record<string, unknown> }[] = [];
    const budget: JuliusBudgetPort = {
      reserve: async (input) => { calls.push({ op: 'reserve', input }); return { state: 'RESERVED', denialReason: null }; },
      commit: async (input) => { calls.push({ op: 'commit', input }); },
      release: async (input) => { calls.push({ op: 'release', input }); },
    };
    const h = await harness({ budget });
    const record = await h.service.execute(h.request('print("counted")\n', { runId: 'run-7', limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 20_000 } }));
    expect(record.state).toBe('SUCCEEDED');
    expect(calls.map((call) => call.op)).toEqual(['reserve', 'commit']);
    expect(calls[0]!.input).toMatchObject({ runId: 'run-7', toolCalls: 1, runtimeMs: 20_000, usdMicros: 0 });
    expect(calls[1]!.input).toMatchObject({ toolCalls: 1, usdMicros: 0, runtimeMs: record.outcome!.durationMs, receiptId: record.executionId });
  }, 60_000);

  it('a refused budget denies the execution before anything runs', async () => {
    const h = await harness({ budget: { reserve: async () => ({ state: 'DENIED', denialReason: 'tool calls exhausted' }), commit: async () => { throw new Error('no commit'); }, release: async () => undefined } });
    const record = await h.service.execute(h.request('print("never")\n', { runId: 'run-7' }));
    expect(record).toMatchObject({ state: 'DENIED', outcome: { reasonCode: 'TOOL_BUDGET_DENIED', detail: 'tool calls exhausted' } });
    expect(h.runs()).toBe(0);
    const withoutRun = await harness({ budget: { reserve: async () => { throw new Error('not reached'); }, commit: async () => undefined, release: async () => undefined } });
    expect((await withoutRun.service.execute(withoutRun.request('print(1)\n'))).outcome?.reasonCode).toBe('BUDGET_RUN_REQUIRED');
  }, 60_000);

  it('denies an unsatisfied dependency pin before running anything', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request('print(1)\n', { environment: { environmentId: 'system-python', requirements: [{ name: 'numpy', version: '0.0.1' }] } }));
    expect(record).toMatchObject({ state: 'DENIED', outcome: { reasonCode: 'DEPENDENCY_UNSATISFIED' } });
    expect(h.runs()).toBe(0);
  }, 60_000);

  it('times out, kills the process, admits nothing', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py('from julius import brain, evidence', 'brain.trace("before the loop")', 'while True:', '    pass'), { limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 1_500 } }));
    expect(record.state).toBe('TIMED_OUT');
    expect(record.outcome).toMatchObject({ exitCode: null, proposals: { admitted: 0 } });
    expect(record.outcome!.durationMs!).toBeGreaterThanOrEqual(1_400);
    expect((await h.julius.entities()).filter((state) => state.kind === 'TRACE')).toEqual([]);
    expect(readdirSync(h.sandboxRoot)).toEqual([]);
  }, 60_000);

  it('cancellation kills the running process; only Julius\'s record of the cancellation enters the Brain', async () => {
    const h = await harness();
    const request = h.request(py('import time', 'from julius import brain', 'brain.trace("staged before cancel")', 'time.sleep(60)'));
    const running = h.service.execute(request);
    for (let i = 0; i < 200 && (await h.service.load(request.executionId, PROJECT))?.state !== 'RUNNING'; i += 1) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 500));
    expect(await h.service.cancel({ executionId: request.executionId, projectId: PROJECT, requestedBy: JULIUS })).toBe('CANCEL_REQUESTED');
    const record = await running;
    expect(record.state).toBe('CANCELLED');
    expect(record.outcome?.cancellation).toMatchObject({ requestedBy: 'JULIUS:julius', confirmedBy: 'KILLED' });
    expect(record.outcome!.durationMs!).toBeLessThan(30_000);
    const kinds = (await h.julius.entities()).map((state) => state.kind);
    expect(kinds).not.toContain('TRACE');
    expect((await h.julius.current('PYTHON_EXECUTION'))[0]!.body).toMatchObject({ state: 'CANCELLED', proposalsAdmitted: 0 });
    expect(await h.service.cancel({ executionId: request.executionId, projectId: PROJECT, requestedBy: JULIUS })).toBe('ALREADY_TERMINAL');
  }, 60_000);

  it('a result that arrives after cancellation was requested never mutates the Brain', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reachedGate: () => void = () => undefined;
    const atGate = new Promise<void>((resolve) => { reachedGate = resolve; });
    // The process finishes normally; the runner holds its outcome until the cancel lands.
    const h = await harness({ runnerWrap: (inner) => ({ run: async (input: JuliusPythonRunInput) => { const out = await inner.run(input, new AbortController().signal); reachedGate(); await gate; return out; } }) });
    const request = h.request(py('from julius import brain, evidence, result', 'brain.record_evidence(evidence.Observation("finished", "done", "PASSED"))', 'result.set("late")'));
    const running = h.service.execute(request);
    await atGate;
    expect(await h.service.cancel({ executionId: request.executionId, projectId: PROJECT, requestedBy: CODER })).toBe('CANCEL_REQUESTED');
    release();
    const record = await running;
    expect(record.state).toBe('CANCELLED');
    expect(record.outcome).toMatchObject({ lateResultDiscarded: true, cancellation: { confirmedBy: 'EXITED', requestedBy: 'WORKER:coder-1(CODING_AGENT)' }, proposals: { status: 'DISCARDED', admitted: 0 } });
    expect((await h.julius.entities()).filter((state) => state.kind === 'EVIDENCE')).toEqual([]);
  }, 60_000);

  it('never inherits host secrets; a granted secret is redacted from output, refused by the Brain, and quarantined from artifacts', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py(
      'import os',
      'from julius import artifacts, brain, evidence, result',
      'print("OPENAI_API_KEY" in os.environ, sorted(k for k in os.environ if "KEY" in k or "TOKEN" in k))',
      'token = os.environ["ANALYTICS_TOKEN"]',
      'print("token is", token)',
      'artifacts.write("leak.txt", "copied " + token)',
      'result.set({"echo": token})',
      'brain.record_evidence(evidence.Observation("token " + token, "leaked"))',
      'raise RuntimeError("failed with " + token)',
    ), { secrets: [{ capabilityId: 'analytics-token', envName: 'ANALYTICS_TOKEN' }] }));
    const outcome = record.outcome!;
    expect(outcome.stdout!.text).toContain("False ['ANALYTICS_TOKEN']");
    expect(outcome.stdout!.text).toContain('token is [REDACTED]');
    expect(outcome.stderr!.text).toContain('RuntimeError: failed with [REDACTED]');
    expect(outcome.redactions).toBeGreaterThanOrEqual(3);
    expect(outcome.artifacts).toEqual([expect.objectContaining({ name: 'leak.txt', quarantined: 'contains_secret', storageRef: null })]);
    expect(record.state).toBe('FAILED');
    const everything = JSON.stringify({ record, brain: await readAllJuliusBrainEntities(h.brains, BRAIN, PROJECT) });
    expect(everything).not.toContain(GRANTED_SECRET);
    expect(everything).not.toContain(HOST_SECRET);
  }, 60_000);

  it('the Brain refuses a staged record carrying a granted secret, and the execution says so', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py(
      'import os',
      'from julius import brain, evidence',
      'brain.record_evidence(evidence.Observation("value " + os.environ["ANALYTICS_TOKEN"], "copied"))',
    ), { secrets: [{ capabilityId: 'analytics-token', envName: 'ANALYTICS_TOKEN' }] }));
    expect(record.state).toBe('FAILED');
    expect(record.outcome?.reasonCode).toBe('BRAIN_REFUSED_PROPOSALS:credential_shaped_content');
    expect(record.outcome?.brain.outcome).toBe('PROPOSALS_REFUSED');
    expect((await h.julius.entities()).map((state) => state.kind)).not.toContain('EVIDENCE');
    expect(JSON.stringify(await readAllJuliusBrainEntities(h.brains, BRAIN, PROJECT))).not.toContain(GRANTED_SECRET);
  }, 60_000);

  describe('the audit hook governs network, processes and files', () => {
    let server: Server;
    let port = 0;
    let connections = 0;
    beforeAll(async () => {
      server = createServer((socket) => { connections += 1; socket.destroy(); });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('denies network, process creation, native loading, and reads or writes outside the grant — and counts each', async () => {
      const h = await harness();
      const outside = join(process.cwd(), 'package.json').replace(/\\/g, '/');
      const record = await h.service.execute(h.request(py(
        'import ctypes, os, socket, subprocess',
        'from julius import artifacts, result',
        'outcomes = {}',
        'def attempt(name, fn):',
        '    try:',
        '        fn()',
        '        outcomes[name] = "ALLOWED"',
        '    except PermissionError as e:',
        '        outcomes[name] = "DENIED"',
        '    except Exception as e:',
        '        outcomes[name] = type(e).__name__',
        `attempt("connect", lambda: socket.create_connection(("127.0.0.1", ${port}), timeout=2))`,
        'attempt("resolve", lambda: socket.getaddrinfo("example.com", 443))',
        'attempt("spawn", lambda: subprocess.run(["python", "-c", "print(1)"]))',
        'attempt("native", lambda: ctypes.CDLL("kernel32" if os.name == "nt" else "libc.so.6"))',
        `attempt("read_outside", lambda: open(${JSON.stringify(outside)}).read())`,
        'attempt("write_outside", lambda: open("../control/forged.json", "w").write("{}"))',
        'attempt("write_work", lambda: open("scratch.txt", "w").write("ok"))',
        'attempt("write_out", lambda: artifacts.write("fine.txt", "ok"))',
        'result.set(outcomes)',
      )));
      expect(record.state).toBe('SUCCEEDED');
      expect(record.outcome!.structured.value).toEqual({
        connect: 'DENIED', resolve: 'DENIED', spawn: 'DENIED', native: 'DENIED',
        read_outside: 'DENIED', write_outside: 'DENIED', write_work: 'ALLOWED', write_out: 'ALLOWED',
      });
      expect(connections).toBe(0);
      expect(record.outcome!.usage!.denialCount).toBeGreaterThanOrEqual(6);
      expect(record.outcome!.artifacts.map((artifact) => artifact.name)).toEqual(['fine.txt']);
    }, 60_000);
  });

  it('malformed staged output is refused as a whole, and the execution is not a success', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py(
      'from julius import _session, brain, evidence',
      'brain.record_evidence(evidence.Observation("valid", "valid"))',
      '_session.current().proposals.append({"proposalId": "p0002", "kind": "EVIDENCE", "body": {"bogus": True}, "links": [], "confidence": None, "retention": "DURABLE"})',
      '_session.current().proposals.append({"proposalId": "p0003", "kind": "DECISION", "body": {}, "links": [], "confidence": None, "retention": "DURABLE"})',
    )));
    expect(record.state).toBe('FAILED');
    expect(record.outcome?.reasonCode).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(record.outcome?.proposals).toMatchObject({ status: 'INVALID', admitted: 0 });
    expect(record.outcome!.proposals.errors.join(' ')).toContain('proposals[1].body.bogus: unknown field');
    expect(record.outcome!.proposals.errors.join(' ')).toContain('DECISION is not granted');
    expect((await h.julius.entities()).map((state) => state.kind)).not.toContain('EVIDENCE');
    expect((await h.julius.current('PYTHON_EXECUTION'))[0]!.body).toMatchObject({ state: 'FAILED', structuredOutput: 'INVALID' });
  }, 60_000);

  it('a staged link may point only at an entity the execution could see', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py(
      'from julius import brain, evidence',
      `brain.record_evidence(evidence.Observation("about the secret one", "x"), relates_to=[${JSON.stringify('constraint:placeholder')}])`,
    ).replace('constraint:placeholder', h.ids.restricted)));
    expect(record.state).toBe('FAILED');
    expect(record.outcome!.proposals.errors.join(' ')).toContain('is not a granted entity');
  }, 60_000);

  it('enforces a memory limit at the operating-system level and says which mechanism held', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py('blocks = [bytearray(64 * 1024 * 1024) for _ in range(16)]', 'print(len(blocks))'), { limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, memoryBytes: 256 * 1024 * 1024 } }));
    expect(record.state).toBe('FAILED');
    expect(['MEMORY_LIMIT', 'TERMINATED_WITHOUT_REPORT']).toContain(record.outcome?.reasonCode);
    if (record.outcome?.usage !== null) expect(record.outcome!.usage!.enforcement.memory).toMatch(/^(WINDOWS_JOB_OBJECT|RLIMIT_AS)$/);
  }, 60_000);

  it('recovers an execution whose host vanished as DISCONNECTED, and never runs it again', async () => {
    const h = await harness();
    const request = h.request('print(1)\n', { limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 1_000 } });
    // Simulate a host that started the execution and died: RUNNING with no runner anywhere.
    const executions = createJuliusPythonExecutionMemoryStore(h.brains);
    await executions.create({
      executionId: request.executionId, projectId: PROJECT, brainId: BRAIN, missionId: MISSION, runId: null, taskId: TASK, idempotencyKey: request.idempotencyKey,
      requestDigest: 'sha256:' + '0'.repeat(64), scriptHash: 'sha256:' + '0'.repeat(64), requestedBy: CODER, state: 'REQUESTED', hostInstanceId: null, request,
      decisions: null, outcome: null, cancellation: null, requestedAt: request.requestedAt, startedAt: null, completedAt: null, version: 1,
    });
    await executions.start({ executionId: request.executionId, projectId: PROJECT, hostInstanceId: 'host-gone', startedAt: new Date(Date.now() - 120_000).toISOString(), decisions: [] });
    let runs = 0;
    const recovery = createJuliusPythonExecutionService({
      store: executions, brains: h.brains, runner: { run: async () => { runs += 1; throw new Error('must not run'); } },
      environments: { resolve: async () => null }, secrets: { has: () => false, resolve: async () => null },
      policies: { cardFor: async () => cardPolicy() }, schema: {}, clock: { now: () => new Date().toISOString() }, hostInstanceId: 'host-b', disconnectGraceMs: 5_000,
    });
    expect(await recovery.recoverDisconnected()).toBe(1);
    expect(await recovery.recoverDisconnected()).toBe(0);
    const recovered = (await executions.load(request.executionId, PROJECT))!;
    expect(recovered).toMatchObject({ state: 'DISCONNECTED', outcome: { reasonCode: 'HOST_LOST', cancellation: null } });
    expect(runs).toBe(0);
    const [execution] = await h.julius.current('PYTHON_EXECUTION');
    expect(execution!.body).toMatchObject({ state: 'DISCONNECTED', exitCode: null });
  }, 60_000);

  it('links from staged records to granted entities survive into the Brain as real edges', async () => {
    const h = await harness();
    const record = await h.service.execute(h.request(py(
      'from julius import brain, evidence',
      'c = [e for e in brain.get_constraints()][0]',
      'brain.record_evidence(evidence.Assertion("budget", True, False, claim="p95 budget holds"), contradicts=[c])',
    )));
    expect(record.state).toBe('SUCCEEDED');
    const constraint = (await h.julius.entity(h.ids.constraint))!;
    expect(constraint.inbound.map((edge) => edge.relation)).toEqual(['CONTRADICTS']);
  }, 60_000);
});
