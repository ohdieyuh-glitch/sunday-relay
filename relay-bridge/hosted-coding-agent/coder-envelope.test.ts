import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODER_JOB_SHARE_MS, CODER_TURN_HARD_CEILING, CODER_TURN_HEADROOM_RATIO,
  CODER_RUNTIME_HEADROOM_RATIO, CoderEnvelopeUnsatisfiable, JOB_BUDGET_MS_FOR_SHARES,
  MAX_CODER_ATTEMPTS, RECORDED_CODER_OBSERVATIONS, coderMaxRuntimeMs, coderMaxTurns,
  coderRuntimeHardCeilingMs, resolveCoderEnvelope,
} from './coder-envelope';
import { DEFAULT_HOSTED_LIMITS, compileHostedEnvelope, hostedLimitsForAllocation } from './hosted-envelope';
import { runHostedCodingAgent, type HostedQueryFn } from './hosted-runner';
import { REVIEWER_JOB_SHARE_MS } from '../reviewer-deadline';
import { CODER_WORKER, architectWorker, architectWorstCaseSpendMs } from '../julius/live-composition';
import { architectOperativeTimeoutMs } from '../../src/relay/connectors/gpt-architect/config';

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const WS = '/data/relay-workspaces/prj/run-1';
const init = () => ({
  type: 'system', subtype: 'init', model: 'claude-fable-5', claude_code_version: '2.1.220',
  apiKeySource: 'ANTHROPIC_API_KEY', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'],
});
const result = () => ({
  type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2,
  duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 5 },
  permission_denials: [],
});

/** Runs the real runner against a fake SDK and returns what the SDK was handed. */
const optionsHandedToTheSdk = async (limits?: Parameters<typeof runHostedCodingAgent>[0]['limits']) => {
  const seen: Record<string, unknown>[] = [];
  const fn: HostedQueryFn = (params) => {
    seen.push(params.options);
    return (async function* () { yield init(); yield result(); })();
  };
  let n = 0;
  await runHostedCodingAgent({
    queryFn: fn, prompt: 'implement it', workspacePath: WS, apiKey: 'k',
    requestedModel: 'claude-fable-5', now: () => new Date(Date.UTC(2026, 8, 10, 12, 0, n++)).toISOString(),
    ...(limits ? { limits } : {}),
  });
  return seen[0]!;
};

describe('the turn ceiling the SDK actually receives', () => {
  /**
   * THE DEFECT THIS FILE EXISTS FOR. `hosted-runner.ts` read runtime and cost
   * off `limits` but compiled the envelope WITHOUT them, so the SDK's turn
   * ceiling always came from `DEFAULT_HOSTED_LIMITS`. `HostedLimits.maxTurns`
   * was a field nothing consulted: a caller could raise it to forty and Paid
   * Mission 5 would still have stopped at twelve.
   */
  it('honours the limits it was given, not the default', async () => {
    const options = await optionsHandedToTheSdk({ ...DEFAULT_HOSTED_LIMITS, maxTurns: 40 });
    expect(options.maxTurns).toBe(40);
  });

  it('falls back to the derived default when no limits are supplied', async () => {
    const options = await optionsHandedToTheSdk();
    expect(options.maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
    expect(options.maxTurns).toBe(coderMaxTurns());
  });

  it('compiles the envelope from the limits at every call site', () => {
    expect(compileHostedEnvelope({ workspacePath: WS, limits: { ...DEFAULT_HOSTED_LIMITS, maxTurns: 7 } }).maxTurns).toBe(7);
    expect(compileHostedEnvelope({ workspacePath: WS }).maxTurns).toBe(coderMaxTurns());
  });

  it('leaves no decorative turn or runtime literal in the envelope module', () => {
    const source = read('relay-bridge/hosted-coding-agent/hosted-envelope.ts');
    expect([...source.matchAll(/maxTurns:\s*([0-9][0-9_]*)/g)].map((m) => m[1]),
      'maxTurns must be derived, never a literal').toEqual([]);
    expect([...source.matchAll(/maxRuntimeMs:\s*([0-9][0-9_]*\s*\*?\s*[0-9_]*)/g)].map((m) => m[1]),
      'maxRuntimeMs must be derived, never a literal').toEqual([]);
    expect(source).toContain('coderMaxTurns()');
    expect(source).toContain('coderMaxRuntimeMs()');
  });

  it('gives the declared coder worker exactly the runtime that bounds it', () => {
    expect(CODER_WORKER.timeoutMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
    expect(CODER_WORKER.timeoutMs).toBe(coderMaxRuntimeMs());
  });
});

describe('money stays an independent hard bound', () => {
  /**
   * REQUIREMENT: a larger execution envelope must NEVER move the monetary
   * ceiling. Turns and runtime bound thrash and wall clock; the reservation
   * bounds spend, and only `hostedLimitsForAllocation` may raise it.
   */
  it('does not change maxCostCents when turns and runtime are raised', () => {
    const base = hostedLimitsForAllocation(7_500_000);
    const roomier = hostedLimitsForAllocation(7_500_000, { ...DEFAULT_HOSTED_LIMITS, maxTurns: 999, maxRuntimeMs: 9_999_999 });
    expect(roomier.maxCostCents).toBe(base.maxCostCents);
    expect(base.maxCostCents).toBe(750);
  });

  it('keeps the unbudgeted default cost floor untouched by this policy', () => {
    expect(DEFAULT_HOSTED_LIMITS.maxCostCents).toBe(50);
    // The policy may EXPLAIN that it leaves cost alone — that comment is worth
    // keeping. What it must never do is assign or compute the ceiling, so this
    // looks for code rather than for the word.
    const source = read('relay-bridge/hosted-coding-agent/coder-envelope.ts');
    const codeUses = [...source.matchAll(/maxCostCents\s*[:=][^:=]/g)].map((m) => m[0]);
    expect(codeUses, 'the envelope policy must never set or compute the cost ceiling').toEqual([]);
  });

  it('still carries the reservation into the cost ceiling and nothing else', () => {
    const limits = hostedLimitsForAllocation(2_500_000);
    expect(limits.maxCostCents).toBe(250);
    expect(limits.maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
    expect(limits.maxRuntimeMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
  });
});

describe('the derivation is deterministic, bounded and honest about censoring', () => {
  it('derives both limits from the recorded observations', () => {
    const envelope = resolveCoderEnvelope();
    expect(envelope.turnsFloor).toBe(envelope.observedTurnsHighWater);
    expect(envelope.maxTurns).toBe(Math.min(
      Math.ceil(envelope.turnsFloor * (1 + CODER_TURN_HEADROOM_RATIO)), CODER_TURN_HARD_CEILING));
    expect(envelope.maxRuntimeMs).toBe(Math.ceil(envelope.runtimeFloorMs * (1 + CODER_RUNTIME_HEADROOM_RATIO)));
    expect(envelope.runtimeHardCeilingMs).toBe(coderRuntimeHardCeilingMs());
  });

  it('is a pure function of its inputs', () => {
    expect(resolveCoderEnvelope()).toEqual(resolveCoderEnvelope());
  });

  /**
   * Mission 5 told us the coder needed MORE than 13 turns and nothing about how
   * many more. Reporting that as a measurement would understate exactly the
   * thing it is evidence of.
   */
  it('treats an exhausted turn count as a lower bound, not a measurement', () => {
    const envelope = resolveCoderEnvelope();
    expect(envelope.observedTurnsHighWater).toBe(13);
    expect(envelope.observedTurnsCensored).toBe(true);
    expect(envelope.basis).toBe('OBSERVED_CENSORED');
    const censored = RECORDED_CODER_OBSERVATIONS.find((o) => o.turns === 13);
    expect(censored?.outcome).toBe('TURNS_EXHAUSTED');
  });

  /** UNKNOWN STAYS UNKNOWN: a timed-out run reported no usage, so cost is null. */
  it('records an unreported cost as null, never zero', () => {
    const cutOff = RECORDED_CODER_OBSERVATIONS.find((o) => o.outcome === 'RUNTIME_CUT_OFF');
    expect(cutOff?.costUsdMicros).toBeNull();
    expect(cutOff?.turns).toBeNull();
  });

  it('reports OBSERVED_COMPLETED when nothing was cut off', () => {
    const envelope = resolveCoderEnvelope({
      observations: RECORDED_CODER_OBSERVATIONS.filter((o) => o.outcome === 'COMPLETED'),
    });
    expect(envelope.basis).toBe('OBSERVED_COMPLETED');
    expect(envelope.observedTurnsCensored).toBe(false);
    expect(envelope.observedTurnsHighWater).toBe(11);
  });

  /**
   * A turn ceiling the clock can never reach is not a ceiling — it is the same
   * silent disagreement this module exists to end, one level down.
   */
  it('keeps the runtime large enough to reach the turns it grants', () => {
    const envelope = resolveCoderEnvelope();
    expect(envelope.observedMsPerTurn).not.toBeNull();
    expect(envelope.maxRuntimeMs).toBeGreaterThanOrEqual(envelope.maxTurns * envelope.observedMsPerTurn!);
  });

  it('never exceeds the absolute turn ceiling however large the observation', () => {
    const envelope = resolveCoderEnvelope({
      observations: [{ runId: 'r', taskId: 't', turns: 500, toolCalls: 1, elapsedMs: 1_000, outcome: 'COMPLETED', costUsdMicros: null }],
    });
    expect(envelope.maxTurns).toBe(CODER_TURN_HARD_CEILING);
  });

  it('refuses rather than clamping when the runtime floor will not fit the job', () => {
    expect(() => resolveCoderEnvelope({
      observations: [{ runId: 'r', taskId: 't', turns: 2, toolCalls: 1, elapsedMs: 60 * 60_000, outcome: 'COMPLETED', costUsdMicros: null }],
    })).toThrow(CoderEnvelopeUnsatisfiable);
    try {
      resolveCoderEnvelope({ observations: [{ runId: 'r', taskId: 't', turns: 2, toolCalls: 1, elapsedMs: 60 * 60_000, outcome: 'COMPLETED', costUsdMicros: null }] });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('coder_envelope_unsatisfiable');
      expect((error as Error).message).toContain('CODER_JOB_SHARE_MS');
      expect((error as Error).message).toContain('MAX_CODER_ATTEMPTS');
    }
  });

  it('rejects a nonsense headroom instead of quietly producing a number', () => {
    expect(() => resolveCoderEnvelope({ turnHeadroomRatio: -1 })).toThrow('invalid_turn_headroom_ratio');
    expect(() => resolveCoderEnvelope({ runtimeHeadroomRatio: -1 })).toThrow('invalid_runtime_headroom_ratio');
  });

  it('learns from a longer observation instead of ignoring it', () => {
    const longer = resolveCoderEnvelope({
      observations: [{ runId: 'r', taskId: 't', turns: 20, toolCalls: 1, elapsedMs: 400_000, outcome: 'TURNS_EXHAUSTED', costUsdMicros: null }],
    });
    expect(longer.maxTurns).toBeGreaterThan(resolveCoderEnvelope().maxTurns);
  });
});

describe('the job budget is shared out, and the shares add up', () => {
  /**
   * Four claims on one job: the reviewers worst case, the coder worst case, the
   * architect's own ceiling across its attempts, and a stated allowance for the
   * image builds, PostgreSQL, Hermes and the evidence dump.
   */
  const INFRASTRUCTURE_ALLOWANCE_MS = 15 * 60_000;

  /**
   * THE ARCHITECT'S SHARE IS RESOLVED FROM THE JOB'S OWN ENVIRONMENT, and both
   * of its factors are read rather than restated.
   *
   * This used to be `DEFAULT_TIMEOUT_MS * 2`: the connector's FALLBACK times a
   * literal for the attempt count. Both were wrong in the same direction.
   * `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` moves the deadline the architect is
   * actually bounded by, so setting it in the workflow would raise the real
   * worst case while this arithmetic — and therefore this proof that the four
   * shares fit — stayed exactly where it was, passing. That is the reviewer's
   * Mission 4 failure in miniature: a model compared against a window, both
   * agreeing, while the real thing ran past them.
   *
   * So the deadline comes from the workflow's own `env:` block (the only
   * environment the paid job ever runs with) through the same resolver the
   * adapter uses, and the attempt count comes from the worker's own
   * `maxRetries`, which is what the run loop actually spends.
   */
  const workflowArchitectEnv = (): Record<string, string | undefined> => {
    const workflow = read('.github/workflows/julius-first-live-mission.yml');
    // Only an UNCOMMENTED assignment counts; the block carries commented-out
    // history of retired values that must not be read as configuration.
    const set = /^[ \t]+RELAY_PROMPT_ARCHITECT_TIMEOUT_MS:[ \t]*'?(\d+)'?[ \t]*$/m.exec(workflow);
    return set === null ? {} : { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: set[1] };
  };
  const architectEnv = workflowArchitectEnv();
  const ARCHITECT_ATTEMPTS = architectWorker(architectEnv).maxRetries + 1;
  const ARCHITECT_WORST_CASE_MS = architectWorstCaseSpendMs(architectEnv);

  it('takes the architect share from the job environment, not the connector fallback', () => {
    // THE MUTATION THIS KILLS: reverting to `DEFAULT_TIMEOUT_MS * 2`, which is
    // right only while the workflow happens to leave the variable unset — the
    // one case in which a broken version and a correct one are identical.
    expect(architectWorstCaseSpendMs({ RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: '450000' }))
      .toBe(450_000 * ARCHITECT_ATTEMPTS);
    expect(ARCHITECT_WORST_CASE_MS).toBe(architectOperativeTimeoutMs(architectEnv) * ARCHITECT_ATTEMPTS);
  });

  it('fits the reviewer, coder, architect and infrastructure inside JOB_BUDGET_MS', () => {
    const claimed = REVIEWER_JOB_SHARE_MS + CODER_JOB_SHARE_MS + ARCHITECT_WORST_CASE_MS + INFRASTRUCTURE_ALLOWANCE_MS;
    expect(claimed, `claims ${claimed} ms of a ${JOB_BUDGET_MS_FOR_SHARES} ms job`)
      .toBeLessThanOrEqual(JOB_BUDGET_MS_FOR_SHARES);
  });

  it('keeps the coder worst case inside its own share', () => {
    const envelope = resolveCoderEnvelope();
    expect(envelope.worstCaseRuntimeSpendMs).toBe(envelope.maxRuntimeMs * MAX_CODER_ATTEMPTS);
    expect(envelope.worstCaseRuntimeSpendMs).toBeLessThanOrEqual(CODER_JOB_SHARE_MS);
  });

  it('pins the live mission workflow timeout to JOB_BUDGET_MS', () => {
    const workflow = read('.github/workflows/julius-first-live-mission.yml');
    const declared = /^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(workflow);
    expect(declared).not.toBeNull();
    expect(Number(declared![1]) * 60_000).toBe(JOB_BUDGET_MS_FOR_SHARES);
  });
});
