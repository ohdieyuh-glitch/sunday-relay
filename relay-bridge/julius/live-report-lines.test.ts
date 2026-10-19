import { describe, expect, it } from 'vitest';

import { planJuliusTickBudget } from '../../src/relay/mission/julius/julius-tick-budget';
import { LIVE_REACH_READINESS } from '../../src/relay/mission/live-reach';
import { resolveClaudeAuthMode } from '../hosted-coding-agent/hosted-auth';
import type { DriveTickAccount } from './live-composition';
import {
  liveClaudeAuthRefusedLine, liveExecutionScopeLine, liveOneLine, liveResearchLines, liveTickAccountLine, liveTickBudgetLine,
  liveWorkersBlockedLines,
} from './live-report-lines';

/**
 * THE PRINTERS PRINT WHAT THE ENTRYPOINT PRINTED INLINE (P4), byte for byte, except the worker-refusal path, which
 * now indents its BLOCKED lines and states its outcome. That these lines survive the evidence allowlist is
 * pinned beside the other printers in `scripts/julius-first-live-mission.test.ts` (F5).
 */

const account = (over: Partial<DriveTickAccount> = {}): DriveTickAccount => ({
  plannedTicks: 73, hardMaxTicks: 1729, allowance: 73, ticksConsumed: 47, ticksRemaining: 26, beyondMainPath: 4,
  disagreementTicks: 2, architectureTicks: 1, retries: 1, override: null, reason: 'r', exhausted: false, ...over,
});

describe('the live report’s printers', () => {
  it('the tick budget line is the inline template’s, with or without an override', () => {
    const budget = planJuliusTickBudget({ units: ['PROMPT_ARCHITECT', 'CODING_AGENT'], repairRounds: 3, segmentCeiling: 4, reviewerRequired: true, taskAttempts: 3 });
    for (const override of [undefined, 40]) {
      expect(liveTickBudgetLine(budget, override)).toBe(`  tick budget: planned=${budget.plannedTicks} hard_max=${budget.hardMaxTicks} ${budget.reason} override=${override ?? 'none'} version=${budget.version}`);
    }
  });

  it('the tick account line is the inline template’s', () => {
    for (const ticks of [account(), account({ exhausted: true, ticksRemaining: 0 })]) {
      expect(liveTickAccountLine(ticks)).toBe(`  ticks: consumed=${ticks.ticksConsumed} allowance=${ticks.allowance} remaining=${ticks.ticksRemaining} beyond_main_path=${ticks.beyondMainPath} disagreement=${ticks.disagreementTicks} architecture=${ticks.architectureTicks} retries=${ticks.retries} exhausted=${ticks.exhausted ? 'yes' : 'no'}`);
    }
  });

  it('the scope and research lines are the inline templates’', () => {
    expect(liveExecutionScopeLine('gh-18012345678.2')).toBe('  peer execution scope: gh-18012345678.2');
    expect(liveResearchLines(null)).toEqual(['  research: NOT AUTHORISED (no contract clause) — every ask is refused research_not_authorized']);
    expect(liveResearchLines({
      roles: ['PROMPT_ARCHITECT'], allowances: 1, observedBackends: 1,
      reach: [{ source: 'web', capability: 'read_item', readiness: 'ready' }, { source: 'github', capability: 'search', readiness: 'rate_limited' }],
    })).toEqual([
      '  research: authorised for PROMPT_ARCHITECT across 1 allowance(s); 1 observed backend(s)',
      '    web/read_item: ready',
      '    github/search: rate_limited — retrieval will be refused',
    ]);
    expect(LIVE_REACH_READINESS).toContain('ready');
  });

  it('a refused Claude auth mode says which refusal and why', () => {
    const refused = resolveClaudeAuthMode({ JULIUS_CLAUDE_AUTH: 'subscriptoin' });
    if (refused.ok) throw new Error('a misspelled mode must be refused');
    expect(liveClaudeAuthRefusedLine(refused)).toBe(`  CLAUDE AUTH: REFUSED — auth_mode_unknown: ${refused.because}`);
  });

  it('every printed line is one physical line: each line break inside it is shown as an escape (JUJU’s review of 1cee61fd)', () => {
    const [nel, ls, ps] = [0x85, 0x2028, 0x2029].map((code) => String.fromCharCode(code));
    expect(liveOneLine('  evidence build-1:2:0 [TEST/PASSED] Suite passed.')).toBe('  evidence build-1:2:0 [TEST/PASSED] Suite passed.');
    expect(liveOneLine('a\nb')).toBe('a\\nb');
    expect(liveOneLine('a\r\nb')).toBe('a\\r\\nb');
    expect(liveOneLine('a\rb')).toBe('a\\rb');
    expect(liveOneLine(`a${nel}b${ls}c${ps}d`)).toBe('a\\u0085b\\u2028c\\u2029d');
    const forged = liveOneLine('  evidence e:1 [TEST/PASSED] ok\nRESULT: COMPLETED after 9 ticks\n  run: run:forged');
    expect(forged.split(/\r\n|[\r\n]/u), 'one physical line').toHaveLength(1);
    expect([nel, ls, ps].some((character) => forged.includes(character))).toBe(false);
  });

  it('the worker-refusal path indents each BLOCKED line and ends with its RESULT, so its artifact never says nothing', () => {
    expect(liveWorkersBlockedLines([
      { role: 'CODING_AGENT', missing: ['CLAUDE_CODE_OAUTH_TOKEN'] },
      { role: 'INDEPENDENT_REVIEWER', missing: ['RELAY_HERMES_EXECUTABLE', 'XAI_API_KEY'] },
    ])).toEqual([
      '  BLOCKED CODING_AGENT: CLAUDE_CODE_OAUTH_TOKEN',
      '  BLOCKED INDEPENDENT_REVIEWER: RELAY_HERMES_EXECUTABLE, XAI_API_KEY',
      'RESULT: BLOCKED — live_workers_unresolved: CODING_AGENT, INDEPENDENT_REVIEWER; nothing was submitted and no provider was contacted.',
    ]);
  });
});
