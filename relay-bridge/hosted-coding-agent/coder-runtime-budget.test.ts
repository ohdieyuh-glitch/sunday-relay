import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeExecutorShell } from '../julius/coding-agent-fixtures';
import { createClaudeCodeCodingAgentProvider } from '../julius/claude-code-coding-provider';
import {
  CODER_FIT_GATED_APPROVAL_WAIT_MS, CODER_WORKER, JULIUS_JOB_STAMP_LAG_RESERVE_MS, JULIUS_RESERVE_AFTER_LIVE_MS, approvalWaitMsFor,
  architectWorstCaseSpendMs, coderRuntimeBudgetRefusal, coderWorkerForRuntime, liveStageDeadline, resolveLiveWorkers,
} from '../julius/live-composition';
import { createInMemoryArtifactExchange } from '../julius/live-workers';
import { JULIUS_LIMITS_KEYS, compileBootstrapRequest, parseLiveMissionContract } from '../julius/mission-contract';
import { JOB_BUDGET_MS, REVIEWER_JOB_SHARE_MS, reviewerDeadlineHardCeilingMs } from '../reviewer-deadline';
import {
  CODER_CONTRACT_RUNTIME_MAX_MINUTES, CODER_CONTRACT_RUNTIME_MIN_MINUTES, CODER_FIT_INFRASTRUCTURE_ALLOWANCE_MS, CODER_JOB_SHARE_MS,
  CODER_POST_SESSION_ALLOWANCE_MS, CODER_PRE_SESSION_ALLOWANCE_MS, CoderRuntimeBudgetRefused, MAX_CODER_ATTEMPTS, RECORDED_CODER_OBSERVATIONS,
  coderRuntimeJobFit, coderRuntimeMinutesProblem, resolveCoderEnvelope, resolveContractCoderRuntime, coderRuntimeHardCeilingMs,
} from './coder-envelope';
import { HOSTED_API_KEY_ENV } from './hosted-readiness';
import { DEFAULT_HOSTED_LIMITS } from './hosted-envelope';
import type { JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';
import { JULIUS_CONTEXT_COMPILER_VERSION, type JuliusContextSnapshot } from '../../src/relay/mission/julius';

/**
 * THE OPT-IN, CONTRACT-SCOPED CODER SESSION BUDGET (`limits.coderRuntimeMinutes`) — DRAFT, founder policy + reviewer read.
 *
 * What this file pins, in order: the DEFAULT envelope is exactly what it was (so the opt-in changes nothing for a contract that
 * does not use it); the resolver and its absolute range; the job-fit arithmetic and the table of largest fitting sessions; the
 * checker's mirrored constants equal their TypeScript sources; the parser refuses outside the range and binds the value into
 * the digest; EVERY committed contract's binding digest is byte-identical (the scored learning-pair and Registration 2 included);
 * the checker refuses above the cap and above the fit (the NEGATIVE CONTROLS); the composition carries the minutes into the
 * worker and the runner's limits, and into nothing else; and the entrypoint passes the fields at both call sites.
 */

const ROOT = resolve(__dirname, '..', '..');
const MISSIONS = join(ROOT, '.github', 'julius-missions');
const CHECKER = join(ROOT, 'scripts', 'julius-live-contract-check.mjs');
const CHECKER_SOURCE = readFileSync(CHECKER, 'utf8');

/* ------------------------------------------------------------ the default is untouched */

describe('the DEFAULT envelope is exactly what it was', () => {
  it('golden values: the observation-derived session, the attempt, the ceilings, the worker and the runner limit', () => {
    const envelope = resolveCoderEnvelope();
    expect(envelope.maxRuntimeMs).toBe(734_386);
    expect(envelope.attemptDeadlineMs).toBe(1_199_386);
    expect(envelope.maxTurns).toBe(26);
    expect(envelope.runtimeHardCeilingMs).toBe(1_200_000);
    expect(CODER_PRE_SESSION_ALLOWANCE_MS).toBe(45_000);
    expect(CODER_POST_SESSION_ALLOWANCE_MS).toBe(420_000);
    expect(CODER_JOB_SHARE_MS).toBe(2_400_000);
    expect(MAX_CODER_ATTEMPTS).toBe(2);
    expect(coderRuntimeHardCeilingMs()).toBe(1_200_000);
    expect(RECORDED_CODER_OBSERVATIONS).toHaveLength(3);
    expect(CODER_WORKER.timeoutMs).toBe(1_199_386);
    expect(DEFAULT_HOSTED_LIMITS.maxRuntimeMs).toBe(734_386);
  });

  it('the default attempt already sits at the per-attempt ceiling: there is no headroom to give globally (the reason this is opt-in)', () => {
    expect(coderRuntimeHardCeilingMs() - resolveCoderEnvelope().attemptDeadlineMs).toBe(614);
  });

  it('building a worker for a declared budget never mutates CODER_WORKER', () => {
    const before = JSON.stringify(CODER_WORKER);
    const copy = coderWorkerForRuntime(30);
    expect(copy).not.toBe(CODER_WORKER);
    expect(JSON.stringify(CODER_WORKER)).toBe(before);
    expect({ ...copy, timeoutMs: CODER_WORKER.timeoutMs }).toEqual(CODER_WORKER);
  });
});

/* ------------------------------------------------------------ the resolver and its range */

describe('resolveContractCoderRuntime', () => {
  it('turns whole minutes into the session limit, the attempt deadline and the dispatch worst case', () => {
    expect(resolveContractCoderRuntime(30)).toEqual({
      coderRuntimeMinutes: 30, maxRuntimeMs: 1_800_000, attemptDeadlineMs: 2_265_000, worstCaseDispatchMs: 4_530_000,
    });
    expect(resolveContractCoderRuntime(CODER_CONTRACT_RUNTIME_MIN_MINUTES).maxRuntimeMs).toBe(13 * 60_000);
    expect(resolveContractCoderRuntime(CODER_CONTRACT_RUNTIME_MAX_MINUTES).maxRuntimeMs).toBe(45 * 60_000);
  });

  it('the smallest declarable session is not below what the default envelope already grants; the largest is the explicit hard cap', () => {
    expect(CODER_CONTRACT_RUNTIME_MIN_MINUTES * 60_000).toBeGreaterThanOrEqual(resolveCoderEnvelope().maxRuntimeMs);
    expect((CODER_CONTRACT_RUNTIME_MIN_MINUTES - 1) * 60_000).toBeLessThan(resolveCoderEnvelope().maxRuntimeMs);
    expect(CODER_CONTRACT_RUNTIME_MAX_MINUTES).toBe(45);
  });

  it('refuses anything outside the absolute range or not a whole number, by code', () => {
    for (const bad of [12, 46, 0, -5, 30.5, '30', null, undefined, NaN, Infinity, true]) {
      expect(() => resolveContractCoderRuntime(bad), String(bad)).toThrow(CoderRuntimeBudgetRefused);
      expect(coderRuntimeMinutesProblem(bad), String(bad)).not.toBeNull();
    }
    try { resolveContractCoderRuntime(46); } catch (error) { expect((error as CoderRuntimeBudgetRefused).code).toBe('coder_runtime_minutes_invalid'); }
    expect(coderRuntimeMinutesProblem(13)).toBeNull();
    expect(coderRuntimeMinutesProblem(45)).toBeNull();
  });
});

/* ------------------------------------------------------------ the job fit */

const FIGURES = {
  reviewerShareMs: REVIEWER_JOB_SHARE_MS, reviewerCycleCeilingMs: reviewerDeadlineHardCeilingMs(),
  architectWorstCaseMs: architectWorstCaseSpendMs({}), infrastructureMs: CODER_FIT_INFRASTRUCTURE_ALLOWANCE_MS,
  marginsMs: JULIUS_JOB_STAMP_LAG_RESERVE_MS + JULIUS_RESERVE_AFTER_LIVE_MS, jobBudgetMs: JOB_BUDGET_MS,
};
const fit = (coderRuntimeMinutes: number, repairCycles: number, approvalWaitMs = 0) =>
  coderRuntimeJobFit({ coderRuntimeMinutes, repairCycles, approvalWaitMs, ...FIGURES });

describe('coderRuntimeJobFit: the whole job under a declared session budget', () => {
  it('the committed figures are the ones the design record states', () => {
    expect(FIGURES).toEqual({
      reviewerShareMs: 3_000_000, reviewerCycleCeilingMs: 1_000_000, architectWorstCaseMs: 600_000, infrastructureMs: 900_000,
      marginsMs: 420_000, jobBudgetMs: 18_000_000,
    });
  });

  it('at the DEFAULT attempt the formula reproduces the repository\'s own priced path (3 cycles) to within the rounding it uses', () => {
    // r8.5 / the job-share test price the coder at its whole 40-minute share (2,400,000) and so state 17,516,316 ms; the exact two
    // attempts are 2 x 1,199,386 = 2,398,772, which gives 17,515,088. The difference is exactly the 1,228 ms of rounding in the share.
    const attempt = resolveCoderEnvelope().attemptDeadlineMs;
    const dispatch = MAX_CODER_ATTEMPTS * attempt;
    const exact = FIGURES.reviewerShareMs + dispatch + FIGURES.architectWorstCaseMs + FIGURES.infrastructureMs
      + 3 * (dispatch + FIGURES.reviewerCycleCeilingMs) + FIGURES.marginsMs;
    expect(exact).toBe(17_515_088);
    const repositoryFigure = FIGURES.reviewerShareMs + CODER_JOB_SHARE_MS + FIGURES.architectWorstCaseMs + FIGURES.infrastructureMs
      + 3 * (dispatch + FIGURES.reviewerCycleCeilingMs) + FIGURES.marginsMs;
    expect(repositoryFigure).toBe(17_516_316);
    expect(repositoryFigure - exact).toBe(CODER_JOB_SHARE_MS - dispatch);
    // and the formula is the same at the default attempt as at a declared session of the same length
    expect(fit(13, 3).worstCaseMs).toBeLessThan(18_000_000);
  });

  /** The largest session that fits, by repair cycles R and approval wait W; the design record's table, pinned. */
  const largest = (repairCycles: number, approvalWaitMs: number): number | null => {
    let best: number | null = null;
    for (let minutes = CODER_CONTRACT_RUNTIME_MIN_MINUTES; minutes <= CODER_CONTRACT_RUNTIME_MAX_MINUTES; minutes += 1) {
      if (fit(minutes, repairCycles, approvalWaitMs).fits) best = minutes;
    }
    return best;
  };

  it('the table of largest fitting sessions (no approval wait)', () => {
    expect([0, 1, 2, 3, 4].map((cycles) => largest(cycles, 0))).toEqual([45, 42, 23, 13, null]);
  });

  it('the table of largest fitting sessions (a gated mission: 35 minutes of approval wait)', () => {
    expect([0, 1, 2, 3].map((cycles) => largest(cycles, CODER_FIT_GATED_APPROVAL_WAIT_MS))).toEqual([45, 33, 17, null]);
  });

  it('the boundary is exact: the largest fitting minute fits, the next does not', () => {
    expect(fit(42, 1).fits).toBe(true);
    expect(fit(42, 1).headroomMs).toBe(140_000);
    expect(fit(43, 1).fits).toBe(false);
    expect(fit(43, 1).headroomMs).toBeLessThan(0);
    expect(fit(45, 1).worstCaseMs).toBe(18_580_000);
  });

  it('a session budget can never fit by being quietly clamped: an out-of-range value or a negative cycle count is refused', () => {
    expect(() => fit(46, 0)).toThrow(CoderRuntimeBudgetRefused);
    expect(() => fit(30, -1)).toThrow(CoderRuntimeBudgetRefused);
    expect(() => fit(30, 1.5)).toThrow(CoderRuntimeBudgetRefused);
  });
});

/* ------------------------------------------------------------ the checker's mirrored constants */

describe('the checker mirrors every constant it uses, and a test holds each equal to its source', () => {
  const mirrored = (name: string): number => {
    const match = new RegExp(`${name}: ([0-9_]+)`, 'u').exec(CHECKER_SOURCE);
    expect(match, `${name} must be declared in the checker's CODER_FIT`).not.toBeNull();
    return Number(match![1].replaceAll('_', ''));
  };

  it('CODER_FIT equals the TypeScript figures', () => {
    expect(mirrored('attemptsPerDispatch')).toBe(MAX_CODER_ATTEMPTS);
    expect(mirrored('preSessionMs')).toBe(CODER_PRE_SESSION_ALLOWANCE_MS);
    expect(mirrored('postSessionMs')).toBe(CODER_POST_SESSION_ALLOWANCE_MS);
    expect(mirrored('reviewerShareMs')).toBe(FIGURES.reviewerShareMs);
    expect(mirrored('reviewerCycleCeilingMs')).toBe(FIGURES.reviewerCycleCeilingMs);
    expect(mirrored('architectWorstCaseMs')).toBe(FIGURES.architectWorstCaseMs);
    expect(mirrored('infrastructureMs')).toBe(FIGURES.infrastructureMs);
    expect(mirrored('marginsMs')).toBe(FIGURES.marginsMs);
    expect(mirrored('gatedApprovalWaitMs')).toBe(CODER_FIT_GATED_APPROVAL_WAIT_MS);
    expect(mirrored('jobBudgetMs')).toBe(JOB_BUDGET_MS);
  });

  it('the architect figure is the one the WORKFLOW leaves in force (an uncommented RELAY_PROMPT_ARCHITECT_TIMEOUT_MS would move it)', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'julius-first-live-mission.yml'), 'utf8');
    const set = /^[ \t]+RELAY_PROMPT_ARCHITECT_TIMEOUT_MS:[ \t]*'?(\d+)'?[ \t]*$/m.exec(workflow);
    expect(architectWorstCaseSpendMs(set === null ? {} : { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: set[1] })).toBe(FIGURES.architectWorstCaseMs);
  });

  it('the infrastructure allowance is the very one the job-share test prices', () => {
    const shares = readFileSync(join(__dirname, 'coder-envelope.test.ts'), 'utf8');
    expect(/const INFRASTRUCTURE_ALLOWANCE_MS = 15 \* 60_000;/u.test(shares)).toBe(true);
    expect(CODER_FIT_INFRASTRUCTURE_ALLOWANCE_MS).toBe(15 * 60_000);
  });

  it('the range and the limits key list agree in the parser, the resolver and the checker', () => {
    const range = /const CODER_RUNTIME_MINUTES = \{ min: (\d+), max: (\d+) \};/u.exec(CHECKER_SOURCE);
    expect(range).not.toBeNull();
    expect([Number(range![1]), Number(range![2])]).toEqual([CODER_CONTRACT_RUNTIME_MIN_MINUTES, CODER_CONTRACT_RUNTIME_MAX_MINUTES]);
    const keys = /const LIMITS_KEYS = \[([^\]]*)\];/u.exec(CHECKER_SOURCE);
    expect([...keys![1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1])).toEqual([...JULIUS_LIMITS_KEYS]);
    expect(JULIUS_LIMITS_KEYS).toContain('coderRuntimeMinutes');
  });

  it('the checker\'s formula gives the same worst case as coderRuntimeJobFit for every (minutes, cycles, wait) in range', () => {
    const body = /const coderRuntimeWorstCaseMs = \(minutes, repairCycles, approvalWaitMs\) => \{([\s\S]*?)\n\};/u.exec(CHECKER_SOURCE);
    expect(body, 'the checker declares coderRuntimeWorstCaseMs').not.toBeNull();
    const CODER_FIT = {
      attemptsPerDispatch: mirroredOf('attemptsPerDispatch'), preSessionMs: mirroredOf('preSessionMs'), postSessionMs: mirroredOf('postSessionMs'),
      reviewerShareMs: mirroredOf('reviewerShareMs'), reviewerCycleCeilingMs: mirroredOf('reviewerCycleCeilingMs'),
      architectWorstCaseMs: mirroredOf('architectWorstCaseMs'), infrastructureMs: mirroredOf('infrastructureMs'), marginsMs: mirroredOf('marginsMs'),
    };
    // eslint-disable-next-line no-new-func
    const fromChecker = new Function('CODER_FIT', 'minutes', 'repairCycles', 'approvalWaitMs', body![1]) as (c: typeof CODER_FIT, m: number, r: number, w: number) => number;
    for (const wait of [0, CODER_FIT_GATED_APPROVAL_WAIT_MS]) {
      for (let cycles = 0; cycles <= 4; cycles += 1) {
        for (let minutes = CODER_CONTRACT_RUNTIME_MIN_MINUTES; minutes <= CODER_CONTRACT_RUNTIME_MAX_MINUTES; minutes += 1) {
          expect(fromChecker(CODER_FIT, minutes, cycles, wait), `${minutes} min, ${cycles} cycles, wait ${wait}`).toBe(fit(minutes, cycles, wait).worstCaseMs);
        }
      }
    }
    function mirroredOf(name: string): number {
      return Number(new RegExp(`${name}: ([0-9_]+)`, 'u').exec(CHECKER_SOURCE)![1].replaceAll('_', ''));
    }
  });
});

/* ------------------------------------------------------------ the parser, and byte identity */

const rawMission2 = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(MISSIONS, 'julius-live-mission-2', 'contract.json'), 'utf8')) as Record<string, unknown>;
const withLimits = (extra: Record<string, unknown>): string => {
  const raw = rawMission2();
  return JSON.stringify({ ...raw, limits: { ...(raw.limits as Record<string, unknown>), ...extra } });
};
const digestOf = (raw: string): string => {
  const parsed = parseLiveMissionContract(raw);
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest;
};

describe('the parser', () => {
  it('accepts a whole number of minutes in range and carries it; refuses everything else with the reason', () => {
    for (const ok of [13, 30, 45]) {
      const parsed = parseLiveMissionContract(withLimits({ coderRuntimeMinutes: ok }));
      expect(parsed.ok, String(ok)).toBe(true);
      if (parsed.ok) expect(parsed.contract.limits?.coderRuntimeMinutes).toBe(ok);
    }
    for (const bad of [12, 46, 30.5, '30', null, 0, -1]) {
      const parsed = parseLiveMissionContract(withLimits({ coderRuntimeMinutes: bad }));
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/limits\.coderRuntimeMinutes must be/u);
    }
  });

  it('the value is INSIDE the binding digest: declared differs from absent, and two values differ from each other', () => {
    const none = digestOf(JSON.stringify(rawMission2()));
    const a = digestOf(withLimits({ coderRuntimeMinutes: 20 }));
    const b = digestOf(withLimits({ coderRuntimeMinutes: 21 }));
    expect(new Set([none, a, b]).size).toBe(3);
  });
});

describe('BYTE IDENTITY: no committed contract moves when the key is absent', () => {
  /** Printed by pristine main 6402cb13's own mission-contract.ts (no coderRuntimeMinutes code), never retyped. */
  const BEFORE: Readonly<Record<string, string>> = {
    'julius-continuous-1': 'sha256:e6814f7ce2167785052595c60f89aec2ea6bb84bf6f411105e86f317fe02d80a',
    'julius-diag-output-safety-1': 'sha256:7c12a6dfea7bfa3982380997be4da107e2a03c36fbaed59a1d86a0f93056e415',
    'julius-first-live': 'sha256:f7f8c2fe683cba5819ecc9e71085228ce8bf82f3e1b7f9c2b6862f2e28346a56',
    'julius-learning-pair-1-with-1': 'sha256:6148c551c9fbaf79e85eaca6906fe5ce59afeb71e054dff6ba0955e472532774',
    'julius-learning-pair-1-with-2': 'sha256:6148c551c9fbaf79e85eaca6906fe5ce59afeb71e054dff6ba0955e472532774',
    'julius-learning-pair-1-without-1': 'sha256:6148c551c9fbaf79e85eaca6906fe5ce59afeb71e054dff6ba0955e472532774',
    'julius-learning-pair-1-without-2': 'sha256:6148c551c9fbaf79e85eaca6906fe5ce59afeb71e054dff6ba0955e472532774',
    'julius-learning-pair-2-with-1': 'sha256:0ebe60c6575b4806eb9874b86cb98f332eb73fef26ddc7b0ecacc70bb54103ab',
    'julius-learning-pair-2-with-2': 'sha256:0ebe60c6575b4806eb9874b86cb98f332eb73fef26ddc7b0ecacc70bb54103ab',
    'julius-learning-pair-2-without-1': 'sha256:0ebe60c6575b4806eb9874b86cb98f332eb73fef26ddc7b0ecacc70bb54103ab',
    'julius-learning-pair-2-without-2': 'sha256:0ebe60c6575b4806eb9874b86cb98f332eb73fef26ddc7b0ecacc70bb54103ab',
    'julius-live-mission-2': 'sha256:4bf13d0e833a042c74f57555aa7fc520aab8941b5bc621dcef35c975b87b714b',
    'julius-live-mission-3': 'sha256:132b1d96d9eebad0ecf386d541169559057ecc2c93aa7cce7853ed9f2eb5a723',
    'julius-live-mission-4': 'sha256:90967fc2b4726240de490d7bfd97a73a9398352fdf71e777a682abbfd3005ecc',
    'julius-live-mission-5': 'sha256:cecba99c779c967f128dd58c58de5d362e5da37afef2a7974f9fface4b44cc80',
    'julius-live-mission-6': 'sha256:efb6e20f0d11885bc5085a6835d5d27ef0441dfebf14480d0972fdee07ecf71b',
    'julius-option2-lab-1': 'sha256:ddcbc427835530b5b30b358114a67b046a55f83f965f22ebe79312aa248f1b33',
    'julius-unreal-mission-1': 'sha256:905815a6478f86c98d12fa2383ae2606f818e04697fbbc3ab44b5b0c8465cce0',
  };

  it('every committed contract parses to the digest main printed, and none declares the key (declaring it is a deliberate, reviewed edit)', () => {
    const seen: string[] = [];
    for (const name of readdirSync(MISSIONS).sort()) {
      let raw: string;
      try { raw = readFileSync(join(MISSIONS, name, 'contract.json'), 'utf8'); } catch { continue; }
      const parsed = parseLiveMissionContract(raw);
      expect(parsed.ok, `${name} parses`).toBe(true);
      if (!parsed.ok) throw new Error(parsed.problem);
      expect('coderRuntimeMinutes' in (parsed.contract.limits ?? {}), `${name}: no committed contract declares a coder session budget yet`).toBe(false);
      expect(compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest, `${name}: the same digest as before`).toBe(BEFORE[name]);
      seen.push(name);
    }
    expect(seen, 'every committed contract is covered, and no literal is stale').toEqual(Object.keys(BEFORE).sort());
  });
});

/* ------------------------------------------------------------ the checker, with its negative controls */

describe('the contract checker', () => {
  let scratch = '';
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'julius-crt-check-')); });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });
  const check = (raw: string): { code: number; output: string } => {
    const file = join(scratch, `contract-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(file, raw);
    try {
      return { code: 0, output: execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8', cwd: ROOT }) };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { code: failed.status, output: failed.stdout };
    }
  };

  it('an unchanged contract passes and prints no session-budget line', () => {
    const result = check(JSON.stringify(rawMission2()));
    expect(result.code).toBe(0);
    expect(result.output).not.toMatch(/coder session budget/u);
  });

  it('a declared, fitting budget passes and is echoed', () => {
    const result = check(withLimits({ repairCycles: 1, coderRuntimeMinutes: 20 }));
    expect(result.code).toBe(0);
    expect(result.output).toContain('coder session budget: 20 minute(s)');
  });

  it('NEGATIVE CONTROL: above the cap is refused (46), below the floor is refused (12), a fraction is refused', () => {
    for (const bad of [46, 120, 12, 0, 30.5]) {
      const result = check(withLimits({ repairCycles: 1, coderRuntimeMinutes: bad }));
      expect(result.code, String(bad)).toBe(1);
      expect(result.output, String(bad)).toContain('limits.coderRuntimeMinutes must be a whole number of minutes from 13 to 45');
    }
  });

  it('NEGATIVE CONTROL: in range but not fitting the job is refused, naming the overrun (45 minutes with one repair cycle)', () => {
    const result = check(withLimits({ repairCycles: 1, coderRuntimeMinutes: 45 }));
    expect(result.code).toBe(1);
    expect(result.output).toContain('needs 18580000 ms of a 18000000 ms job (580000 ms over)');
  });

  it('the boundary matches the TypeScript fit exactly: 42 minutes with one cycle passes, 43 is refused', () => {
    expect(check(withLimits({ repairCycles: 1, coderRuntimeMinutes: 42 })).code).toBe(0);
    expect(check(withLimits({ repairCycles: 1, coderRuntimeMinutes: 43 })).code).toBe(1);
    // mission 2's own ceiling is 3 cycles: only the floor session fits there, exactly as the table says
    expect(check(withLimits({ repairCycles: 3, coderRuntimeMinutes: 13 })).code).toBe(0);
    expect(check(withLimits({ repairCycles: 3, coderRuntimeMinutes: 14 })).code).toBe(1);
  });

  it('a contract that declares an approval gate is fitted with the 35-minute approval wait: 33 minutes with one cycle passes the FIT, 34 is refused for the fit', () => {
    // The clause is read by name from the raw contract, so this holds before and after the gate registration exists; the
    // checker's other (gate registration) refusals are not what is asserted here, only whether the FIT line is among them.
    const gate = [{ id: 'gate-x', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'], reason: 'sign-off' }];
    const gated = (minutes: number): string => JSON.stringify({ ...JSON.parse(withLimits({ repairCycles: 1, coderRuntimeMinutes: minutes })), approvalGates: gate });
    expect(check(gated(33)).output).not.toContain('needs ');
    const over = check(gated(34));
    expect(over.output).toContain('and an approval wait needs ');
    expect(over.output).toContain('ms over)');
  });

  it('an unknown limits key is still refused (the whitelist grew by exactly one key)', () => {
    const result = check(withLimits({ coderRuntimeSeconds: 600 }));
    expect(result.code).toBe(1);
    expect(result.output).toContain('limits.coderRuntimeSeconds is not a limit this build reads');
  });
});

/* ------------------------------------------------------------ the composition */

const BASE: Record<string, string> = Object.freeze({
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_EXECUTABLE: '/usr/bin/true',
  [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-configured',
});

describe('the composition carries the declared minutes into the coder worker, and only there', () => {
  let scratch = '';
  let workspace = '';
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'julius-crt-comp-')); workspace = join(scratch, 'workspace'); mkdirSync(workspace); });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

  const resolveWith = (extra: Record<string, unknown>) => resolveLiveWorkers({
    env: BASE, projectId: 'prj-crt', workspacePath: workspace, testCommand: 'npm test',
    contexts: { snapshotFor: () => null }, artifacts: createInMemoryArtifactExchange(), shell: createFakeExecutorShell({}),
    ...extra,
  } as never);
  const coderOf = (resolution: ReturnType<typeof resolveWith>) => resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');

  it('ABSENT: the coder entry carries CODER_WORKER itself, and the other two workers are the ones they always were', () => {
    const resolution = resolveWith({});
    expect(resolution.ok).toBe(true);
    expect(coderOf(resolution)!.worker).toBe(CODER_WORKER);
    expect(coderOf(resolution)!.worker.timeoutMs).toBe(1_199_386);
  });

  it('DECLARED and fitting: a copy with the longer attempt deadline; every other worker field is the registered one', () => {
    const resolution = resolveWith({ coderRuntimeMinutes: 30, repairCycles: 1 });
    expect(resolution.ok).toBe(true);
    const worker = coderOf(resolution)!.worker;
    expect(worker).not.toBe(CODER_WORKER);
    expect(worker.timeoutMs).toBe(2_265_000);
    expect({ ...worker, timeoutMs: CODER_WORKER.timeoutMs }).toEqual(CODER_WORKER);
    expect(CODER_WORKER.timeoutMs, 'the registered constant is untouched').toBe(1_199_386);
  });

  it('the repair-cycle default for the fit is the contract default (1), and the approval wait is added for a gated contract', () => {
    expect(resolveWith({ coderRuntimeMinutes: 42 }).ok, '42 min fits with the default 1 cycle').toBe(true);
    expect(resolveWith({ coderRuntimeMinutes: 43 }).ok, '43 min does not').toBe(false);
    expect(approvalWaitMsFor({})).toBe(0);
    expect(approvalWaitMsFor({ approvalGates: [] })).toBe(CODER_FIT_GATED_APPROVAL_WAIT_MS);
    expect(resolveWith({ coderRuntimeMinutes: 33, repairCycles: 1, approvalWaitMs: CODER_FIT_GATED_APPROVAL_WAIT_MS }).ok).toBe(true);
    expect(resolveWith({ coderRuntimeMinutes: 34, repairCycles: 1, approvalWaitMs: CODER_FIT_GATED_APPROVAL_WAIT_MS }).ok).toBe(false);
  });

  it('NEGATIVE CONTROL: an unfit declared budget is refused in the preflight resolution, with the overrun, and no coder entry exists', () => {
    const resolution = resolveWith({ coderRuntimeMinutes: 45, repairCycles: 1 });
    expect(resolution.ok).toBe(false);
    expect(coderOf(resolution)).toBeUndefined();
    const problem = resolution.problems.find((item) => item.role === 'CODING_AGENT');
    expect(problem?.missing.join(' ')).toContain('coder_runtime_budget_unfit');
    expect(problem?.missing.join(' ')).toContain('580000 ms over');
  });

  it('NEGATIVE CONTROL: an out-of-range value that reaches the composition is refused by code, never clamped', () => {
    for (const bad of [12, 46, 30.5]) {
      const refusal = coderRuntimeBudgetRefusal({ env: BASE, coderRuntimeMinutes: bad, repairCycles: 1, approvalWaitMs: 0 });
      expect(refusal, String(bad)).toContain('coder_runtime_minutes_invalid');
    }
  });

  it('the declared minutes reach the RUNNER through the composition: the abort limit is the declared session, the default otherwise', async () => {
    const snapshot = (): JuliusContextSnapshot => ({
      contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: CODER_WORKER.workerId, workerRole: 'CODING_AGENT',
      compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
      taskContractRevision: 2, taskContractDigest: `sha256:${'b'.repeat(64)}`, sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
      acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
      integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
      packet: { missionId: 'mission-1', taskId: 'build-1', workerId: CODER_WORKER.workerId, sourceEntryIds: ['brain:objective'], blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize.' }], truncated: false },
    } as never);
    const charge = {
      stage: 'build' as const,
      binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
      objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
      inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
      prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
      requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'], stoppingCondition: 'The suite is green.',
    };
    const dispatch = {
      taskId: 'build-1', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-1',
      taskType: 'build', contract: charge, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' },
    };
    const limitsSeenBy = async (extra: Record<string, unknown>): Promise<Record<string, unknown>> => {
      let seen: Record<string, unknown> | null = null;
      const artifacts = createInMemoryArtifactExchange();
      artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
      const resolution = resolveLiveWorkers({
        env: BASE, projectId: 'prj-crt', workspacePath: workspace, testCommand: 'npm test',
        contexts: { snapshotFor: () => snapshot() }, artifacts, shell: createFakeExecutorShell({}), ...extra,
        runners: {
          coder: (async (input: { limits: Record<string, unknown> }) => { seen = input.limits; throw new Error('stop once the limits are captured'); }) as never,
          queryLoader: async () => (() => (async function* () { /* none */ })()) as never,
        },
      } as never);
      const coder = coderOf(resolution);
      expect(coder, 'the coder must resolve').toBeDefined();
      const outcome = await coder!.adapter.dispatch(dispatch as never).then((value) => value as unknown, (error: unknown) => error);
      expect(seen, `the runner must have been called; the dispatch ended with ${JSON.stringify(outcome, (_k, v) => (v instanceof Error ? v.message : v)).slice(0, 600)}`).not.toBeNull();
      return seen!;
    };
    const plain = await limitsSeenBy({});
    expect(plain.maxRuntimeMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
    const declared = await limitsSeenBy({ coderRuntimeMinutes: 30, repairCycles: 1 });
    expect(declared.maxRuntimeMs).toBe(1_800_000);
    // The money bound is the allocation's (2,000,000 micro-dollars = 200 cents), identical with and without the budget.
    expect(declared.maxCostCents).toBe(plain.maxCostCents);
    expect(declared.maxCostCents).toBe(200);
    expect({ ...declared, maxRuntimeMs: plain.maxRuntimeMs }).toEqual(plain);
  });

  it('the stage deadline reads the declared worker: the coder stage bound grows with the minutes, the other roles do not', () => {
    const started = '2026-10-19T00:00:00.000Z';
    const plain = resolveWith({});
    const declared = resolveWith({ coderRuntimeMinutes: 30, repairCycles: 1 });
    const stage = (resolution: typeof plain) => liveStageDeadline({ jobStartedAt: started, workers: resolution.entries.map((entry) => entry.worker) })!.stageBoundMs;
    const a = stage(plain);
    const b = stage(declared);
    expect(b.CODING_AGENT).toBeGreaterThan(a.CODING_AGENT);
    expect(b.PROMPT_ARCHITECT).toBe(a.PROMPT_ARCHITECT);
    expect(b.INDEPENDENT_REVIEWER).toBe(a.INDEPENDENT_REVIEWER);
  });
});

/* ------------------------------------------------------------ the runner's limits */

describe('the provider hands the runner the declared session limit, and never touches the money bound', () => {
  const request = {
    version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
    workspacePath: '/workspace/mission', contract: null, plan: 'THE PLAN',
    sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
    permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
    requiredEvidence: ['TEST'], budget: { usdMicros: 3_000_000 }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
  } as unknown as JuliusCodingAgentRequest;

  const limitsSeen = async (maxRuntimeMs?: number): Promise<Record<string, unknown>> => {
    let seen: Record<string, unknown> = {};
    const provider = createClaudeCodeCodingAgentProvider({
      apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-fable-5',
      ...(maxRuntimeMs === undefined ? {} : { maxRuntimeMs }),
      run: (async (input: { limits: Record<string, unknown> }) => { seen = input.limits; throw new Error('stop after the limits are captured'); }) as never,
      queryLoader: async () => (() => (async function* () { /* none */ })()) as never,
    });
    await provider.execute(request).then(() => null, () => null);
    return seen;
  };

  it('absent: the runner gets exactly the default limits; declared: only maxRuntimeMs differs, cost and turns are the same', async () => {
    const plain = await limitsSeen();
    expect(plain.maxRuntimeMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
    expect(plain.maxCostCents).toBe(300);
    const declared = await limitsSeen(1_800_000);
    expect(declared.maxRuntimeMs).toBe(1_800_000);
    expect({ ...declared, maxRuntimeMs: plain.maxRuntimeMs }).toEqual(plain);
    expect(declared.maxCostCents, 'money is an independent bound').toBe(300);
    expect(declared.maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
  });
});

/* ------------------------------------------------------------ the entrypoint */

describe('the entrypoint hands the fields to the composition at BOTH of its call sites', () => {
  // Structural, and named as such: the entrypoint needs a database and an executor to run, so what can be proven offline is that
  // each place it resolves the workers (the preflight and the confirmed run) passes all three fields from the contract.
  const entry = readFileSync(join(ROOT, 'relay-bridge', 'julius-live-mission.ts'), 'utf8');
  const count = (needle: string): number => entry.split(needle).length - 1;

  it('coderRuntimeMinutes, repairCycles and the approval wait are passed twice each', () => {
    expect(count('coderRuntimeMinutes: contract.limits?.coderRuntimeMinutes')).toBe(2);
    expect(count('repairCycles: contract.limits?.repairCycles')).toBe(2);
    expect(count('approvalWaitMs: approvalWaitMsFor(contract)')).toBe(2);
    expect(count('resolveLiveWorkers({')).toBe(2);
  });
});
