import type { BudgetPolicy, LoopPolicy, UsageRecord } from '../protocol/contracts';

/**
 * Budget stop-before-dispatch (Prompt 3, System 9 MVP). Deterministic: the
 * evaluator consumes supplied usage records and estimates only — no
 * provider pricing catalog. Over-budget is never rounded down into
 * compliance; missing estimates are handled per policy, honestly. The
 * Aquala cloud spend breaker remains a separate future OUTER guard.
 */

export type BudgetOutcome = 'allowed' | 'warning' | 'checkpoint_required' | 'denied';

export interface BudgetDecision {
  outcome: BudgetOutcome;
  reasons: string[];
  actual: { usd: number; tokens: number; runtimeMs: number };
  projected: { usd?: number; tokens?: number; runtimeMs?: number };
  estimateMissing: boolean;
  safeSummary: string;
}

export interface BudgetEvaluationInput {
  policy: BudgetPolicy;
  loopPolicy?: LoopPolicy;
  repairCount?: number;
  currentUsage: readonly UsageRecord[];
  /** Supplied estimate for the next operation; null when genuinely unknown. */
  estimatedNextOperation: { usd?: number; tokens?: number; runtimeMs?: number } | null;
  currentTime: string;
}

export function evaluateDispatchBudget(input: BudgetEvaluationInput): BudgetDecision {
  const { policy, loopPolicy, repairCount = 0, currentUsage, estimatedNextOperation } = input;
  const reasons: string[] = [];

  const sum = (kind: 'actual' | 'estimated') =>
    currentUsage
      .filter((u) => u.kind === kind)
      .reduce(
        (acc, u) => ({ usd: acc.usd + (u.usd ?? 0), tokens: acc.tokens + (u.tokens ?? 0), runtimeMs: acc.runtimeMs + (u.runtimeMs ?? 0) }),
        { usd: 0, tokens: 0, runtimeMs: 0 },
      );
  const actual = sum('actual');
  const estimated = sum('estimated');
  // Spend basis: the larger of actual vs estimated per dimension — estimates
  // are preserved separately, never overwritten by actuals.
  const basis = {
    usd: Math.max(actual.usd, estimated.usd),
    tokens: Math.max(actual.tokens, estimated.tokens),
    runtimeMs: Math.max(actual.runtimeMs, estimated.runtimeMs),
  };

  const estimateMissing = estimatedNextOperation === null;
  const next = estimatedNextOperation ?? {};
  const projected = {
    usd: policy.maxUsd !== undefined || next.usd !== undefined ? basis.usd + (next.usd ?? 0) : undefined,
    tokens: policy.maxTokens !== undefined || next.tokens !== undefined ? basis.tokens + (next.tokens ?? 0) : undefined,
    runtimeMs: policy.maxRuntimeMs !== undefined || next.runtimeMs !== undefined ? basis.runtimeMs + (next.runtimeMs ?? 0) : undefined,
  };

  let denied = false;
  let warning = false;

  const ceilings: Array<[number | undefined, number | undefined, number, string]> = [
    [policy.maxUsd, projected.usd, basis.usd, 'usd'],
    [policy.maxTokens, projected.tokens, basis.tokens, 'token'],
    [policy.maxRuntimeMs, projected.runtimeMs, basis.runtimeMs, 'runtime'],
  ];
  for (const [ceiling, proj, current, name] of ceilings) {
    if (ceiling === undefined) continue;
    if (current > ceiling) {
      denied = true;
      reasons.push(`Actual ${name} usage ${current} already exceeds the ceiling ${ceiling}.`);
      continue;
    }
    if (proj !== undefined && proj > ceiling) {
      // No rounding bypass: strict comparison on exact values.
      denied = true;
      reasons.push(`Projected ${name} ${proj} exceeds the hard ceiling ${ceiling}.`);
      continue;
    }
    const warnAt = policy.warningAtFraction;
    if (warnAt !== undefined && proj !== undefined && proj >= ceiling * warnAt) {
      warning = true;
      reasons.push(`Projected ${name} ${proj} is at/over the warning threshold (${warnAt * 100}% of ${ceiling}).`);
    }
  }

  if (loopPolicy && repairCount > loopPolicy.maxAutomaticRevisions) {
    denied = true;
    reasons.push(`Revision count ${repairCount} exceeds the loop ceiling ${loopPolicy.maxAutomaticRevisions}.`);
  }

  let outcome: BudgetOutcome = denied ? 'denied' : warning ? 'warning' : 'allowed';
  if (!denied && estimateMissing) {
    const behavior = policy.missingEstimate ?? 'checkpoint';
    if (behavior === 'deny') { outcome = 'denied'; reasons.push('No cost estimate supplied and policy denies unestimated dispatch.'); }
    else if (behavior === 'checkpoint') { outcome = 'checkpoint_required'; reasons.push('No cost estimate supplied — operator checkpoint required.'); }
    else reasons.push('No cost estimate supplied; policy allows unestimated dispatch (recorded honestly).');
  }

  return {
    outcome,
    reasons,
    actual,
    projected,
    estimateMissing,
    safeSummary: `Budget ${outcome}${reasons.length ? `: ${reasons[0]}` : '.'}`,
  };
}
