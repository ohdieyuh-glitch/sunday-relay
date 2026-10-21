import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  JULIUS_JOB_STAMP_LAG_RESERVE_MS, JULIUS_RESERVE_AFTER_LIVE_MS, architectWorstCaseSpendMs, coderRuntimeBudgetRefusal, coderRuntimeScheduleFor, coderRuntimeScheduleOfContract,
} from '../julius/live-composition';
import { liveCoderRuntimeBudgetLines } from '../julius/live-report-lines';
import { compileBootstrapRequest, parseLiveMissionContract } from '../julius/mission-contract';
import { JOB_BUDGET_MS, REVIEWER_JOB_SHARE_MS, reviewerDeadlineHardCeilingMs } from '../reviewer-deadline';
import {
  CODER_FIT_INFRASTRUCTURE_ALLOWANCE_MS, CoderRuntimeBudgetRefused, coderRuntimeSchedule, resolveContractCoderRuntime,
} from './coder-envelope';

/**
 * ADVERSARIAL TESTS of the opt-in coder session budget (juju2, 2026-10-20). They are written to BREAK `limits.coderRuntimeMinutes`,
 * not to restate its design: boundary and malformed values through BOTH the parser and the checker CLI (differential), a brute-force oracle for the schedule
 * arithmetic over the whole declarable grid, hostile job environments, the report lines against the contract's own numbers, and the
 * "absent = byte identical" property from several directions. A failing case here is a defect (or a wrong expectation, said in the case).
 */
const ROOT = resolve(__dirname, '..', '..');
const MISSIONS = join(ROOT, '.github', 'julius-missions');
const CHECKER = join(ROOT, 'scripts', 'julius-live-contract-check.mjs');

const rawMission2 = (): Record<string, unknown> => JSON.parse(readFileSync(join(MISSIONS, 'julius-live-mission-2', 'contract.json'), 'utf8')) as Record<string, unknown>;
/** The raw TEXT of mission 2's contract with `limits` extended by a RAW JSON fragment (so values JSON.stringify cannot produce, like 1e400 or a duplicate key, can be written). */
const textWithRawLimits = (fragment: string): string => {
  const raw = rawMission2();
  const limits = JSON.stringify(raw.limits as Record<string, unknown>);
  const merged = limits === '{}' ? `{${fragment}}` : `${limits.slice(0, -1)},${fragment}}`;
  return JSON.stringify({ ...raw, limits: '@@LIMITS@@' }).replace('"@@LIMITS@@"', merged);
};
const withLimits = (extra: Record<string, unknown>): string => {
  const raw = rawMission2();
  return JSON.stringify({ ...raw, limits: { ...(raw.limits as Record<string, unknown>), ...extra } });
};
const digestOf = (raw: string): string => {
  const parsed = parseLiveMissionContract(raw);
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest;
};

const FIGURES = {
  reviewerShareMs: REVIEWER_JOB_SHARE_MS, reviewerCycleCeilingMs: reviewerDeadlineHardCeilingMs(),
  architectWorstCaseMs: architectWorstCaseSpendMs({}), infrastructureMs: CODER_FIT_INFRASTRUCTURE_ALLOWANCE_MS,
  marginsMs: JULIUS_JOB_STAMP_LAG_RESERVE_MS + JULIUS_RESERVE_AFTER_LIVE_MS, jobBudgetMs: JOB_BUDGET_MS,
};

describe('A. boundary and malformed values: the parser and the checker CLI must agree on every one (differential)', () => {
  let scratch = '';
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'julius-crt-adv-')); });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });
  const check = (raw: string): number => {
    const file = join(scratch, `c-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(file, raw);
    try { execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8', cwd: ROOT, stdio: 'pipe' }); return 0; } catch (error) { return (error as { status: number }).status; }
  };
  // [raw JSON fragment for the value, accepted?]
  const CASES: Array<[string, boolean]> = [
    ['13', true], ['45', true], ['12', false], ['46', false], ['13.0', true], ['1.3e1', true], ['4.5e1', true], ['45.0000000000000001', true], ['44.99999999999999', false],
    ['13.000000000000002', false], ['0', false], ['-0', false], ['-13', false], ['1e400', false], ['-1e400', false], ['"13"', false], ['null', false], ['true', false], ['false', false],
    ['[13]', false], ['{}', false], ['[]', false], ['9007199254740993', false], ['1e-7', false],
  ];
  it('each boundary / malformed value is accepted or refused identically by parseLiveMissionContract and by the checker CLI', () => {
    const disagreements: string[] = [];
    for (const [fragment, accepted] of CASES) {
      const raw = textWithRawLimits(`"coderRuntimeMinutes":${fragment}`);
      const parsed = parseLiveMissionContract(raw).ok;
      const checked = check(raw) === 0;
      if (parsed !== accepted || checked !== accepted) disagreements.push(`${fragment}: expected ${accepted}, parser ${parsed}, checker ${checked}`);
    }
    expect(disagreements).toEqual([]);
  });
  it('a DUPLICATE key: the parser and the checker see the same (last) value, so neither can be shown 13 while the digest binds 99', () => {
    const raw = textWithRawLimits('"coderRuntimeMinutes":13,"coderRuntimeMinutes":99');
    expect(parseLiveMissionContract(raw).ok).toBe(false);
    expect(check(raw)).not.toBe(0);
    const reverse = textWithRawLimits('"coderRuntimeMinutes":99,"coderRuntimeMinutes":13');
    expect(parseLiveMissionContract(reverse).ok).toBe(true);
    expect(check(reverse)).toBe(0);
    // and the digest binds the value the parser used: reverse equals a plain 13
    expect(digestOf(reverse)).toBe(digestOf(withLimits({ coderRuntimeMinutes: 13 })));
  });
  it('13.0 and 1.3e1 are the SAME contract as 13 (one binding digest), and every value in range binds a distinct digest', () => {
    const base = digestOf(withLimits({ coderRuntimeMinutes: 13 }));
    expect(digestOf(textWithRawLimits('"coderRuntimeMinutes":13.0'))).toBe(base);
    expect(digestOf(textWithRawLimits('"coderRuntimeMinutes":1.3e1'))).toBe(base);
    const digests = new Set<string>();
    for (let m = 13; m <= 45; m += 1) digests.add(digestOf(withLimits({ coderRuntimeMinutes: m })));
    digests.add(digestOf(JSON.stringify(rawMission2())));
    expect(digests.size).toBe(34);
  });
  it('limits key order and surrounding whitespace do not change the binding digest, and an UNDEFINED / absent key is the same contract as no key', () => {
    const a = digestOf(withLimits({ coderRuntimeMinutes: 20, repairCycles: 2 }));
    const b = digestOf(withLimits({ repairCycles: 2, coderRuntimeMinutes: 20 }));
    expect(a).toBe(b);
    const raw = rawMission2();
    expect(digestOf(JSON.stringify({ ...raw, limits: { ...(raw.limits as object), coderRuntimeMinutes: undefined } }))).toBe(digestOf(JSON.stringify(raw)));
  });
  it('the key in a position other than limits (top level, inside research, as a string-keyed look-alike) is refused or inert and never reaches the digest as a budget', () => {
    const raw = rawMission2();
    const top = JSON.stringify({ ...raw, coderRuntimeMinutes: 30 });
    const topParsed = parseLiveMissionContract(top);
    if (topParsed.ok) expect(digestOf(top)).toBe(digestOf(JSON.stringify(raw))); // inert (if the parser tolerates unknown top-level keys, the digest must not move)
    // A misspelt key is NOT refused by the parser on pristine main either (JULIUS_LIMITS_KEYS is only the checker's whitelist): pin the baseline and the checker's refusal.
    const lookalike = textWithRawLimits('"coderRuntimeMinute":30');
    const misspeltOld = textWithRawLimits('"repairCycle":3');
    expect(parseLiveMissionContract(misspeltOld).ok, 'baseline: the parser tolerates an unknown limits key').toBe(parseLiveMissionContract(lookalike).ok);
    expect(check(lookalike), 'the checker refuses the misspelt key').not.toBe(0);
    expect(check(misspeltOld)).not.toBe(0);
  });
});

const refusedCode = (fn: () => unknown): string => { try { fn(); return 'NO_THROW'; } catch (error) { return error instanceof CoderRuntimeBudgetRefused ? error.code : `OTHER:${String(error)}`; } };

describe('B. the schedule arithmetic against a brute-force oracle over the WHOLE declarable grid', () => {
  const WAITS = [0, 2_100_000];
  it('guaranteed cycles = the largest g <= declared with main + g*cycle <= job, found by counting (not by the production division)', () => {
    let rows = 0;
    for (let m = 13; m <= 45; m += 1) for (let r = 0; r <= 12; r += 1) for (const wait of WAITS) {
      const s = coderRuntimeSchedule({ coderRuntimeMinutes: m, repairCycles: r, approvalWaitMs: wait, ...FIGURES });
      const attempt = m * 60_000 + 45_000 + 420_000;
      const dispatch = 2 * attempt;
      const main = FIGURES.reviewerShareMs + FIGURES.architectWorstCaseMs + FIGURES.infrastructureMs + wait + FIGURES.marginsMs + dispatch;
      const cycle = dispatch + FIGURES.reviewerCycleCeilingMs;
      let g = 0;
      if (main <= FIGURES.jobBudgetMs) while (g < r && main + (g + 1) * cycle <= FIGURES.jobBudgetMs) g += 1;
      let single = 0;
      const smain = main - dispatch + attempt;
      if (smain <= FIGURES.jobBudgetMs) while (smain + (single + 1) * (attempt + FIGURES.reviewerCycleCeilingMs) <= FIGURES.jobBudgetMs) single += 1;
      expect(s.guaranteedRepairCycles, `m=${m} r=${r} wait=${wait}`).toBe(g);
      expect(s.singleAttemptCyclesThatFit, `single m=${m} wait=${wait}`).toBe(single);
      expect(s.declaredRepairCycles).toBe(r);
      expect(s.mainPathWorstCaseMs).toBe(main);
      expect(s.worstCycleMs).toBe(cycle);
      expect(s.worstCaseAtDeclaredMs).toBe(main + r * cycle);
      expect(s.headroomAtDeclaredMs).toBe(FIGURES.jobBudgetMs - (main + r * cycle));
      expect(s.allDeclaredCyclesGuaranteed).toBe(main <= FIGURES.jobBudgetMs && g === r);
      // consistency properties
      expect(s.guaranteedRepairCycles).toBeLessThanOrEqual(r);
      if (s.headroomAtDeclaredMs >= 0) expect(s.allDeclaredCyclesGuaranteed).toBe(true);
      if (s.allDeclaredCyclesGuaranteed) expect(s.headroomAtDeclaredMs).toBeGreaterThanOrEqual(0);
      if (r > 0) expect(Math.min(r, s.singleAttemptCyclesThatFit)).toBeGreaterThanOrEqual(s.guaranteedRepairCycles); // one full attempt per dispatch can never fit FEWER cycles than the worst case does
      rows += 1;
    }
    expect(rows).toBe(33 * 13 * 2);
  });
  it('monotone: more minutes never GUARANTEE more cycles; more declared cycles never change what is guaranteed beyond the cap of the declared count', () => {
    for (const wait of WAITS) for (let r = 0; r <= 12; r += 1) {
      let previous = Infinity;
      for (let m = 13; m <= 45; m += 1) {
        const g = coderRuntimeSchedule({ coderRuntimeMinutes: m, repairCycles: r, approvalWaitMs: wait, ...FIGURES }).guaranteedRepairCycles;
        expect(g, `r=${r} m=${m}`).toBeLessThanOrEqual(previous);
        previous = g;
      }
    }
  });
  it('INTEGER SAFETY: absurd repair-cycle counts (2^31, MAX_SAFE_INTEGER) neither overflow nor change the guarantee, which stays capped by the job', () => {
    for (const r of [2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const s = coderRuntimeSchedule({ coderRuntimeMinutes: 13, repairCycles: r, approvalWaitMs: 0, ...FIGURES });
      expect(Number.isFinite(s.worstCaseAtDeclaredMs)).toBe(true);
      expect(s.guaranteedRepairCycles).toBe(coderRuntimeSchedule({ coderRuntimeMinutes: 13, repairCycles: 12, approvalWaitMs: 0, ...FIGURES }).guaranteedRepairCycles);
      expect(s.allDeclaredCyclesGuaranteed).toBe(false);
      expect(s.declaredRepairCycles).toBe(r);
    }
  });
  it('hostile numbers are REFUSED (fail closed): a NaN / Infinity / negative figure can neither fit nor poison the guaranteed count with NaN', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      for (const field of ['reviewerShareMs', 'architectWorstCaseMs', 'infrastructureMs', 'marginsMs', 'approvalWaitMs', 'reviewerCycleCeilingMs'] as const) {
        const input = { coderRuntimeMinutes: 20, repairCycles: 1, approvalWaitMs: 0, ...FIGURES, [field]: bad };
        expect(refusedCode(() => coderRuntimeSchedule(input)), `${field}=${bad}`).toBe('coder_runtime_budget_unfit');
      }
    }
    for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(refusedCode(() => coderRuntimeSchedule({ coderRuntimeMinutes: 20, repairCycles: 1, approvalWaitMs: 0, ...FIGURES, jobBudgetMs: bad })), `jobBudgetMs=${bad}`).toBe('coder_runtime_budget_unfit');
    }
  });
  it('a NEGATIVE approval wait (a caller that trusts nothing) cannot make a 45-minute main path fit: it is refused', () => {
    expect(refusedCode(() => coderRuntimeSchedule({ coderRuntimeMinutes: 45, repairCycles: 1, approvalWaitMs: -10_000_000, ...FIGURES }))).toBe('coder_runtime_budget_unfit');
  });
  it('resolveContractCoderRuntime refuses by CODE for every non-integer-in-range input, including coercible ones, and never clamps', () => {
    for (const bad of [12, 46, 13.5, '13', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.0001, 0, true, [13], {}, 13n]) {
      let error: unknown;
      try { resolveContractCoderRuntime(bad); } catch (e) { error = e; }
      expect(error, String(bad)).toBeInstanceOf(CoderRuntimeBudgetRefused);
    }
  });
});

describe('C. a hostile JOB ENVIRONMENT: the architect timeout is the one live input of the fit', () => {
  const ENV_BASE: Record<string, string | undefined> = {};
  it('every odd value of RELAY_PROMPT_ARCHITECT_TIMEOUT_MS gives a finite answer; a refusal always names the overrun; no value makes an over-budget main path pass', () => {
    const values: Array<string | undefined> = [undefined, '', ' ', '0', '-1', '-5400000', 'abc', 'NaN', 'Infinity', '-Infinity', '1e12', '1e309', '5400000', '5400000.5', '0x10', '00600000', '600000', '1', '9007199254740993'];
    for (const v of values) for (const minutes of [13, 29, 45]) {
      const env = v === undefined ? ENV_BASE : { ...ENV_BASE, RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: v };
      let refusal: string | null = 'unset';
      let schedule: ReturnType<typeof coderRuntimeScheduleFor> | null = null;
      try {
        refusal = coderRuntimeBudgetRefusal({ env, coderRuntimeMinutes: minutes, repairCycles: 1, approvalWaitMs: 0 });
        schedule = coderRuntimeScheduleFor({ env, coderRuntimeMinutes: minutes, repairCycles: 1, approvalWaitMs: 0 });
      } catch (error) { throw new Error(`env=${JSON.stringify(v)} minutes=${minutes} THREW: ${String(error)}`); }
      // the refusal and the schedule must tell the same story
      expect(refusal === null, `env=${JSON.stringify(v)} m=${minutes}`).toBe(schedule.mainPathFits);
      if (schedule.mainPathFits) expect(schedule.mainPathWorstCaseMs).toBeLessThanOrEqual(schedule.limitMs);
      else expect(refusal).toContain('coder_runtime_budget_unfit');
      if (!schedule.mainPathFits) expect(schedule.guaranteedRepairCycles).toBe(0);
    }
  });
  it('the ARCHITECT figure is monotone in the timeout: a slower architect never turns a refusal into an acceptance', () => {
    let accepted = true;
    for (const timeoutMs of [0, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 5_400_000, 7_200_000]) {
      const refusal = coderRuntimeBudgetRefusal({ env: { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: String(timeoutMs) }, coderRuntimeMinutes: 45, repairCycles: 1, approvalWaitMs: 0 });
      if (refusal !== null) accepted = false;
      else expect(accepted, `timeout ${timeoutMs} accepted after a smaller... larger timeout was refused`).toBe(true);
    }
  });
});

describe('D. the report: what the preflight prints is exactly the contract\'s own numbers, and it never claims a reduction', () => {
  const lines = (m: number, r: number | undefined, gated = false) => liveCoderRuntimeBudgetLines(coderRuntimeScheduleOfContract({}, {
    limits: { coderRuntimeMinutes: m, ...(r === undefined ? {} : { repairCycles: r }) }, ...(gated ? { approvalGates: [{}] } : {}),
  } as never));
  it('over the whole grid: repair_cycles_reduced=no appears exactly once, declared == the contract\'s count (default 1), guaranteed <= declared, the notice appears iff guaranteed < declared', () => {
    for (let m = 13; m <= 45; m += 1) for (const r of [undefined, 0, 1, 2, 3, 7]) for (const gated of [false, true]) {
      const out = lines(m, r, gated);
      expect(out.length === 1 || out.length === 2, `m=${m} r=${r}`).toBe(true);
      const main = out[0];
      expect(main.match(/repair_cycles_reduced=no/gu)?.length).toBe(1);
      expect(main).not.toMatch(/repair_cycles_reduced=(yes|true|1)/u);
      const declared = Number(/repair_cycles_declared=(\d+)/u.exec(main)![1]);
      const guaranteed = Number(/repair_cycles_guaranteed_at_worst_case=(\d+)/u.exec(main)![1]);
      expect(declared, `m=${m} r=${r}`).toBe(r ?? 1);
      expect(guaranteed).toBeLessThanOrEqual(declared);
      expect(out.length === 2).toBe(guaranteed < declared);
      expect(Number(/minutes=(\d+)/u.exec(main)![1])).toBe(m);
    }
  });
  it('an invalid declared value prints NOTHING (the refusal is the preflight\'s own problem), never a schedule with a made-up number', () => {
    for (const bad of [12, 46, 13.5, 'x', null]) expect(lines(bad as never, 1)).toEqual([]);
  });
});

describe('E. ABSENT = byte identical, from more directions than the committed-contract digests', () => {
  it('a contract with every other limit set and NO coderRuntimeMinutes has the same digest whether or not the parser ever saw the new key list', () => {
    for (const extra of [{}, { repairCycles: 2 }, { spendUsd: 5 }, { coderEffort: 'high' }, { coderSelfTestCalls: 2 }]) {
      const raw = withLimits(extra);
      const parsed = parseLiveMissionContract(raw);
      expect(parsed.ok, JSON.stringify(extra)).toBe(true);
      if (parsed.ok) expect('coderRuntimeMinutes' in (parsed.contract.limits ?? {})).toBe(false);
    }
  });
  it('coderRuntimeScheduleOfContract / liveCoderRuntimeBudgetLines print NOTHING for a contract without the key, with or without other limits and an approval gate', () => {
    for (const contract of [{}, { limits: {} }, { limits: { repairCycles: 3 } }, { limits: { repairCycles: 3 }, approvalGates: [{}] }]) {
      expect(coderRuntimeScheduleOfContract({}, contract as never)).toBeNull();
      expect(liveCoderRuntimeBudgetLines(coderRuntimeScheduleOfContract({}, contract as never))).toEqual([]);
    }
  });
  it('the checker prints coder-session lines for EXACTLY the committed contracts that declare limits.coderRuntimeMinutes, and for no other (on the final P3 stack G and H declare it; on main and after step 3 none does)', () => {
    const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs');
    for (const name of readdirSync(MISSIONS)) {
      const file = join(MISSIONS, name, 'contract.json');
      if (!existsSync(file)) continue;
      let output = '';
      try { output = execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8', cwd: ROOT, stdio: 'pipe' }); } catch (error) { output = (error as { stdout: string }).stdout ?? ''; }
      const declares = ((JSON.parse(readFileSync(file, 'utf8')) as { limits?: { coderRuntimeMinutes?: unknown } }).limits ?? {}).coderRuntimeMinutes !== undefined;
      if (declares) expect(output, `${name} declares a session budget: the checker echoes it`).toMatch(/coder session budget: \d+ minute\(s\)/u);
      else expect(output, `${name} declares none: no coder-session text`).not.toMatch(/coder session/u);
    }
  });
});
