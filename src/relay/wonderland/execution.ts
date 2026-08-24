import type { EvalFinding, Swarm, Usage, VerificationEvidence } from './types';
import type { PermissionBounds, SpendBudget } from './types';
import { WonderlandDomainError, WonderlandService } from './service';

export interface AuthoritativeUsageReceipt extends Usage { receiptId: string; provider: string; subjectId: string; at: string; }
export interface ProviderReceiptSource { onReceipt(listener: (receipt: AuthoritativeUsageReceipt) => void): { close(): void }; }
export interface UsageAuthorityBinding { projectId: string; missionId: string; playerId: string; permissions: PermissionBounds; budget: SpendBudget; }

/** Provider callbacks are the authority; no HTTP route accepts usage fields. */
export class ProviderBudgetEnforcer {
  private readonly seen = new Set<string>();
  constructor(private readonly service: WonderlandService, private readonly bindings: Readonly<Record<string, UsageAuthorityBinding>>) {}
  attach(source: ProviderReceiptSource) { return source.onReceipt((receipt) => {
    if (this.seen.has(receipt.receiptId)) return; const binding = this.bindings[receipt.subjectId]; if (!binding) throw new WonderlandDomainError('Usage subject is not authorized.');
    try { this.service.consume(`provider-receipt:${receipt.receiptId}`, receipt.subjectId, binding.permissions, binding.budget, receipt); this.seen.add(receipt.receiptId); }
    catch (error) { this.service.ingestRelayEvent(`provider-budget-denial:${receipt.receiptId}`, { projectId: binding.projectId, missionId: binding.missionId, playerId: binding.playerId, eventType: 'agent.error', payload: { code: 'budget_exhausted', provider: receipt.provider } }); throw error; }
  }); }
}
export interface SubagentTask { subagentId: string; parentAgentId: string; role: string; objective: string; tokenBudget: number; timeBudgetMs: number; toolCallLimit: number; }
export interface SubagentResult { subagentId: string; usage: AuthoritativeUsageReceipt[]; evidence: VerificationEvidence[]; findings: EvalFinding[]; artifacts: string[]; }
export interface RelaySubagentWorker { execute(task: SubagentTask, signal: AbortSignal, telemetry: (kind: string, detail: Record<string, unknown>) => void): Promise<SubagentResult>; }

/** Executes the persisted swarm with real injected Relay workers and bounded cancellation. */
export async function executeSwarm(swarm: Swarm, objective: string, worker: RelaySubagentWorker, signal: AbortSignal, telemetry: (subagentId: string, kind: string, detail: Record<string, unknown>) => void): Promise<SubagentResult[]> {
  return Promise.all(swarm.subagentIds.map((subagentId, index) => worker.execute({ subagentId, parentAgentId: swarm.parentAgentId, role: swarm.roles[index], objective, tokenBudget: Math.floor(swarm.tokenBudget / swarm.subagentIds.length), timeBudgetMs: swarm.timeBudgetMs, toolCallLimit: Math.floor(swarm.toolCallLimit / swarm.subagentIds.length) }, signal, (kind, detail) => telemetry(subagentId, kind, detail))));
}

export interface GveRunRequest { missionId: string; battleId: string; projectId: string; executionRef: string; checks: VerificationEvidence['kind'][]; }
export interface GveRunner { run(request: GveRunRequest, signal: AbortSignal): Promise<{ evidence: VerificationEvidence[]; artifactIds: string[]; usage: AuthoritativeUsageReceipt[] }>; }
