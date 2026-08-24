/** Production execution-session state and live budget gate for Wonderland. Pure domain. */
import type { CardVersion } from './wonderland-backend';

export const WONDERLAND_EXECUTION_STATES = ['QUEUED', 'PROVISIONING', 'RUNNING', 'VERIFYING', 'REPAIRING', 'COMPLETE', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXHAUSTED'] as const;
export type WonderlandExecutionState = typeof WONDERLAND_EXECUTION_STATES[number];
export type ExecutionTerminalState = Extract<WonderlandExecutionState, 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'BUDGET_EXHAUSTED'>;

export interface ExecutionBudget {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  readonly usdMicros: number;
  readonly computeMs: number;
  readonly runtimeMs: number;
  readonly swarmConcurrency: number;
}

export interface ProviderUsageReceipt {
  readonly receiptId: string;
  readonly executionId: string;
  readonly provider: string;
  readonly model: string;
  readonly source: 'provider_reported' | 'adapter_observed';
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly usdMicros: number;
  readonly toolCalls: number;
  readonly reviewerCalls: number;
  readonly sandboxComputeMs: number;
  readonly durationMs: number;
  readonly subagentCalls: number;
  readonly gveCalls: number;
  readonly occurredAt: string;
}

export interface ExecutionUsage {
  inputTokens: number; cachedTokens: number; outputTokens: number; usdMicros: number;
  toolCalls: number; reviewerCalls: number; sandboxComputeMs: number; durationMs: number;
  subagentCalls: number; gveCalls: number;
}

export interface RecoveryCheckpoint {
  readonly version: number;
  readonly phase: WonderlandExecutionState;
  readonly lastReceiptId: string | null;
  readonly recordedAt: string;
}

export interface WonderlandExecutionSession {
  readonly executionId: string;
  readonly battleId: string | null;
  readonly missionId: string;
  readonly projectId: string;
  readonly playerId: string;
  readonly agentId: string;
  readonly cardSnapshot: CardVersion;
  readonly workspaceIsolationRef: string;
  readonly permissions: readonly string[];
  readonly budget: ExecutionBudget;
  state: WonderlandExecutionState;
  usage: ExecutionUsage;
  receiptIds: string[];
  evidenceIds: string[];
  artifactIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  cancellationRequestedAt: string | null;
  terminalReason: string | null;
  checkpoint: RecoveryCheckpoint;
  version: number;
}

export interface ExecutionOperation {
  readonly inputTokens?: number; readonly cachedTokens?: number; readonly outputTokens?: number;
  readonly usdMicros?: number; readonly toolCalls?: number; readonly computeMs?: number;
  readonly runtimeMs?: number; readonly swarmWorkers?: number;
}

export interface ExecutionTransition {
  readonly executionId: string; readonly previousState: WonderlandExecutionState;
  readonly state: WonderlandExecutionState; readonly at: string; readonly reason: string | null;
  readonly version: number;
}

const TERMINAL = new Set<WonderlandExecutionState>(['COMPLETE', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXHAUSTED']);
const ALLOWED: Readonly<Record<WonderlandExecutionState, readonly WonderlandExecutionState[]>> = {
  QUEUED: ['PROVISIONING', 'CANCELLED', 'FAILED'],
  PROVISIONING: ['RUNNING', 'CANCELLED', 'FAILED', 'TIMED_OUT', 'BUDGET_EXHAUSTED'],
  RUNNING: ['VERIFYING', 'REPAIRING', 'COMPLETE', 'CANCELLED', 'FAILED', 'TIMED_OUT', 'BUDGET_EXHAUSTED'],
  VERIFYING: ['REPAIRING', 'COMPLETE', 'CANCELLED', 'FAILED', 'TIMED_OUT', 'BUDGET_EXHAUSTED'],
  REPAIRING: ['VERIFYING', 'CANCELLED', 'FAILED', 'TIMED_OUT', 'BUDGET_EXHAUSTED'],
  COMPLETE: [], FAILED: [], CANCELLED: [], TIMED_OUT: [], BUDGET_EXHAUSTED: [],
};
const zeroUsage = (): ExecutionUsage => ({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, usdMicros: 0, toolCalls: 0, reviewerCalls: 0, sandboxComputeMs: 0, durationMs: 0, subagentCalls: 0, gveCalls: 0 });
const copy = <T>(value: T): T => structuredClone(value);
const nonNegativeInteger = (value: number, field: string): void => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid_${field}`); };

export class WonderlandExecutionRuntime {
  private readonly sessions = new Map<string, WonderlandExecutionSession>();
  private readonly receiptOwners = new Map<string, string>();
  private readonly idempotency = new Map<string, unknown>();
  constructor(private readonly now: () => string, private readonly onTransition: (transition: ExecutionTransition) => void = () => undefined) {}

  create(commandId: string, input: Omit<WonderlandExecutionSession, 'state' | 'usage' | 'receiptIds' | 'evidenceIds' | 'artifactIds' | 'startedAt' | 'completedAt' | 'cancellationRequestedAt' | 'terminalReason' | 'checkpoint' | 'version'>): WonderlandExecutionSession {
    const previous = this.idempotency.get(commandId) as WonderlandExecutionSession | undefined;
    if (previous) return copy(previous);
    if (this.sessions.has(input.executionId)) throw new Error('execution_exists');
    if (input.cardSnapshot.ownerId !== input.playerId || input.cardSnapshot.agentId !== input.agentId) throw new Error('card_or_agent_not_owned');
    if (!input.workspaceIsolationRef.trim()) throw new Error('workspace_isolation_required');
    for (const [key, value] of Object.entries(input.budget)) nonNegativeInteger(value, `budget_${key}`);
    const at = this.now();
    const session: WonderlandExecutionSession = { ...copy(input), state: 'QUEUED', usage: zeroUsage(), receiptIds: [], evidenceIds: [], artifactIds: [], startedAt: null, completedAt: null, cancellationRequestedAt: null, terminalReason: null, checkpoint: { version: 1, phase: 'QUEUED', lastReceiptId: null, recordedAt: at }, version: 1 };
    this.sessions.set(session.executionId, session); this.idempotency.set(commandId, copy(session)); return copy(session);
  }

  get(executionId: string): WonderlandExecutionSession | null { const value = this.sessions.get(executionId); return value ? copy(value) : null; }

  transition(executionId: string, next: WonderlandExecutionState, reason: string | null = null): WonderlandExecutionSession {
    const session = this.require(executionId); const previousState = session.state;
    if (!ALLOWED[previousState].includes(next)) throw new Error(`invalid_execution_transition:${previousState}->${next}`);
    const at = this.now(); session.state = next; session.version += 1;
    if (next === 'RUNNING' && session.startedAt === null) session.startedAt = at;
    if (TERMINAL.has(next)) { session.completedAt = at; session.terminalReason = reason; }
    session.checkpoint = { version: session.checkpoint.version + 1, phase: next, lastReceiptId: session.receiptIds.at(-1) ?? null, recordedAt: at };
    this.onTransition({ executionId, previousState, state: next, at, reason, version: session.version }); return copy(session);
  }

  authorize(executionId: string, operation: ExecutionOperation): { allowed: true } | { allowed: false; reason: string } {
    const session = this.require(executionId);
    if (session.state !== 'PROVISIONING' && session.state !== 'RUNNING' && session.state !== 'VERIFYING' && session.state !== 'REPAIRING') return { allowed: false, reason: 'execution_not_active' };
    for (const [key, value] of Object.entries(operation)) nonNegativeInteger(value ?? 0, key);
    const checks: readonly [number, number, string][] = [
      [session.usage.inputTokens + (operation.inputTokens ?? 0), session.budget.inputTokens, 'input_token_budget_exhausted'],
      [session.usage.cachedTokens + (operation.cachedTokens ?? 0), session.budget.cachedTokens, 'cached_token_budget_exhausted'],
      [session.usage.outputTokens + (operation.outputTokens ?? 0), session.budget.outputTokens, 'output_token_budget_exhausted'],
      [session.usage.usdMicros + (operation.usdMicros ?? 0), session.budget.usdMicros, 'usd_budget_exhausted'],
      [session.usage.toolCalls + (operation.toolCalls ?? 0), session.budget.toolCalls, 'tool_budget_exhausted'],
      [session.usage.sandboxComputeMs + (operation.computeMs ?? 0), session.budget.computeMs, 'compute_budget_exhausted'],
      [session.usage.durationMs + (operation.runtimeMs ?? 0), session.budget.runtimeMs, 'runtime_budget_exhausted'],
      [operation.swarmWorkers ?? 0, session.budget.swarmConcurrency, 'swarm_concurrency_exhausted'],
    ];
    const exceeded = checks.find(([projected, limit]) => projected > limit);
    if (!exceeded) return { allowed: true };
    this.transition(executionId, 'BUDGET_EXHAUSTED', exceeded[2]); return { allowed: false, reason: exceeded[2] };
  }

  recordReceipt(receipt: ProviderUsageReceipt): { recorded: boolean; session: WonderlandExecutionSession } {
    const session = this.require(receipt.executionId);
    const owner = this.receiptOwners.get(receipt.receiptId);
    if (owner !== undefined) { if (owner !== receipt.executionId) throw new Error('receipt_identity_collision'); return { recorded: false, session: copy(session) }; }
    if (TERMINAL.has(session.state)) throw new Error('execution_terminal');
    for (const key of ['inputTokens', 'cachedTokens', 'outputTokens', 'usdMicros', 'toolCalls', 'reviewerCalls', 'sandboxComputeMs', 'durationMs', 'subagentCalls', 'gveCalls'] as const) nonNegativeInteger(receipt[key], key);
    const gate = this.authorize(receipt.executionId, { inputTokens: receipt.inputTokens, cachedTokens: receipt.cachedTokens, outputTokens: receipt.outputTokens, usdMicros: receipt.usdMicros, toolCalls: receipt.toolCalls, computeMs: receipt.sandboxComputeMs, runtimeMs: receipt.durationMs });
    if (!gate.allowed) return { recorded: false, session: this.get(receipt.executionId)! };
    session.usage.inputTokens += receipt.inputTokens; session.usage.cachedTokens += receipt.cachedTokens; session.usage.outputTokens += receipt.outputTokens; session.usage.usdMicros += receipt.usdMicros; session.usage.toolCalls += receipt.toolCalls; session.usage.reviewerCalls += receipt.reviewerCalls; session.usage.sandboxComputeMs += receipt.sandboxComputeMs; session.usage.durationMs += receipt.durationMs; session.usage.subagentCalls += receipt.subagentCalls; session.usage.gveCalls += receipt.gveCalls;
    session.receiptIds.push(receipt.receiptId); session.version += 1; this.receiptOwners.set(receipt.receiptId, receipt.executionId); session.checkpoint = { version: session.checkpoint.version + 1, phase: session.state, lastReceiptId: receipt.receiptId, recordedAt: this.now() }; return { recorded: true, session: copy(session) };
  }

  attachEvidence(executionId: string, evidenceId: string): void { const session = this.require(executionId); if (!session.evidenceIds.includes(evidenceId)) session.evidenceIds.push(evidenceId); }
  attachArtifact(executionId: string, artifactId: string): void { const session = this.require(executionId); if (!session.artifactIds.includes(artifactId)) session.artifactIds.push(artifactId); }
  cancel(executionId: string, reason = 'cancelled_by_authority'): WonderlandExecutionSession { const session = this.require(executionId); if (TERMINAL.has(session.state)) return copy(session); session.cancellationRequestedAt = this.now(); return this.transition(executionId, 'CANCELLED', reason); }
  recover(snapshot: readonly WonderlandExecutionSession[]): void { for (const item of snapshot) { if (this.sessions.has(item.executionId)) throw new Error('execution_exists'); this.sessions.set(item.executionId, copy(item)); for (const receiptId of item.receiptIds) { if (this.receiptOwners.has(receiptId)) throw new Error('receipt_identity_collision'); this.receiptOwners.set(receiptId, item.executionId); } } }
  snapshot(): WonderlandExecutionSession[] { return [...this.sessions.values()].map(copy); }
  private require(executionId: string): WonderlandExecutionSession { const session = this.sessions.get(executionId); if (!session) throw new Error('execution_not_found'); return session; }
}
