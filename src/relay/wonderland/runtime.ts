import { randomUUID } from 'node:crypto';
import { runBoundedCommand } from '../workspace/command-runner';
import type { GveRunRequest, GveRunner, RelaySubagentWorker, SubagentResult } from './execution';
import type { VerificationEvidence } from './types';

/** Real bounded local Relay worker: no shell, bounded output, timeout and cancellation. */
export function createLocalRelayWorker(input: { cwd: string; executable: string; argsForRole: (role: string, objective: string) => string[]; now?: () => string }): RelaySubagentWorker {
  return { async execute(task, signal, telemetry): Promise<SubagentResult> {
    telemetry('task.started', { role: task.role }); let cancel = () => false; const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true });
    const outcome = await runBoundedCommand({ executable: input.executable, args: input.argsForRole(task.role, task.objective), cwd: input.cwd, env: {}, timeoutMs: task.timeBudgetMs, outputLimitBytes: 64 * 1024 }, input.now ?? (() => new Date().toISOString()), (handle) => { cancel = handle.cancel; }); signal.removeEventListener('abort', abort);
    telemetry(outcome.exitCode === 0 ? 'task.completed' : 'task.failed', { exitCode: outcome.exitCode, durationMs: outcome.durationMs, timedOut: outcome.timedOut });
    const evidence: VerificationEvidence = { id: `evd_${randomUUID()}`, kind: task.role === 'testing' ? 'VISIBLE_TEST' : task.role === 'verification' ? 'REGRESSION' : 'ROBUSTNESS', passed: outcome.exitCode === 0 && !outcome.timedOut && !outcome.cancelled, weight: 1, summary: `${task.role} command ${outcome.exitCode === 0 ? 'passed' : 'failed'} in ${outcome.durationMs}ms` };
    return { subagentId: task.subagentId, usage: [{ receiptId: `receipt_${randomUUID()}`, provider: 'relay-local-worker', subjectId: task.parentAgentId, at: outcome.completedAt, tokens: 0, compute: outcome.durationMs, toolCalls: 1, spendUsd: 0 }], evidence: [evidence], findings: [], artifacts: [] };
  } };
}

/** GVE runner backed by Relay's hardened bounded command runner. */
export function createCommandGveRunner(input: { cwdForExecution: (executionRef: string) => string; commandForCheck: (kind: VerificationEvidence['kind']) => { executable: string; args: string[] }; now?: () => string }): GveRunner {
  return { async run(request: GveRunRequest, signal) { const evidence: VerificationEvidence[] = []; const usage = []; for (const kind of request.checks) { if (signal.aborted) throw new Error('GVE cancelled.'); const command = input.commandForCheck(kind); let cancel = () => false; const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true }); const outcome = await runBoundedCommand({ ...command, cwd: input.cwdForExecution(request.executionRef), env: {}, timeoutMs: 120_000, outputLimitBytes: 128 * 1024 }, input.now ?? (() => new Date().toISOString()), (handle) => { cancel = handle.cancel; }); signal.removeEventListener('abort', abort); evidence.push({ id: `evd_${randomUUID()}`, kind, passed: outcome.exitCode === 0 && !outcome.timedOut, weight: 1, summary: `${kind} ${outcome.exitCode === 0 ? 'passed' : 'failed'} in ${outcome.durationMs}ms` }); usage.push({ receiptId: `receipt_${randomUUID()}`, provider: 'relay-gve', subjectId: request.executionRef, at: outcome.completedAt, tokens: 0, compute: outcome.durationMs, toolCalls: 1, spendUsd: 0 }); } return { evidence, artifactIds: [], usage }; } };
}
