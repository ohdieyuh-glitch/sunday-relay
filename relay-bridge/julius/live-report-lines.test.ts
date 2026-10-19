import { describe, expect, it } from 'vitest';

import { planJuliusTickBudget } from '../../src/relay/mission/julius/julius-tick-budget';
import { LIVE_REACH_READINESS } from '../../src/relay/mission/live-reach';
import { resolveClaudeAuthMode } from '../hosted-coding-agent/hosted-auth';
import type { DriveTickAccount } from './live-composition';
import type { JuliusBudgetRow } from '../../src/relay/mission/julius/julius-slot-ledger';
import {
  LIVE_ACCOUNTING_LEGEND, LIVE_REVIEWER_KEY_IDENTITY_LINE, liveAccountingLines, liveAccountingLinesFor,
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

/**
 * THE ACCOUNTING LINES (instrument gaps a-c and e from the Independent Reviewer's read of paid run 39202992515).
 * The rows below are that run's own budget.tsv, re-stated: an architect and two reviewers settled with no
 * amount, a coder settled NOT_APPLICABLE / SUBSCRIPTION with the runtime's own figure, each holding 300000.
 */
describe('the accounting key and rollup', () => {
  const RUN = 'run:691f75dc35ffead7c7195664';
  const reserved = (role: string, id: string, held = 300_000): JuliusBudgetRow => ({
    type: 'budget.reserved', taskId: `${RUN}:${id}`, facts: { role, usdMicros: held, reservationId: `reservation:${id}` },
  });
  const settled = (id: string, facts: Record<string, string | number | boolean | null>): JuliusBudgetRow => ({
    type: 'budget.settled', taskId: `${RUN}:${id}`, facts: { reservationId: `reservation:${id}`, ...facts },
  });
  const allocated = (role: string, remaining: number): JuliusBudgetRow => ({
    type: 'budget.allocated', taskId: null, facts: { role, remainingUsdMicros: remaining, allocationPolicy: 'julius-allocation.v3' },
  });
  const unknownBill = { costBasis: 'UNKNOWN', billingPath: 'API_BILLED' };
  const run39202992515: readonly JuliusBudgetRow[] = [
    allocated('PROMPT_ARCHITECT', 100_000_000), reserved('PROMPT_ARCHITECT', 'plan'), settled('plan', unknownBill),
    allocated('INDEPENDENT_REVIEWER', 99_700_000), reserved('INDEPENDENT_REVIEWER', 'plan:review'), settled('plan:review', unknownBill),
    allocated('CODING_AGENT', 99_400_000), reserved('CODING_AGENT', 'build'),
    settled('build', { costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION', executionUsdMicros: 483_118 }),
    allocated('INDEPENDENT_REVIEWER', 99_100_000), reserved('INDEPENDENT_REVIEWER', 'build:review'), settled('build:review', unknownBill),
  ];
  const withoutLegend = (lines: readonly string[]): string[] => lines.slice(LIVE_ACCOUNTING_LEGEND.length);

  it('carries the coder’s runtime-reported figure as its own column, not as a bill and not as unknown', () => {
    expect(withoutLegend(liveAccountingLines(RUN, run39202992515))).toEqual([
      `ACCOUNTING: role run=${RUN} role=CODING_AGENT reservations=1 billed_known_usd_micros=0 billed_known_reservations=0 runtime_reported_usd_micros=483118 runtime_reported_reservations=1 unknown_held_usd_micros=0 unknown_reservations=0 unsettled_usd_micros=0 unsettled_reservations=0 released_usd_micros=0`,
      `ACCOUNTING: role run=${RUN} role=INDEPENDENT_REVIEWER reservations=2 billed_known_usd_micros=0 billed_known_reservations=0 runtime_reported_usd_micros=0 runtime_reported_reservations=0 unknown_held_usd_micros=600000 unknown_reservations=2 unsettled_usd_micros=0 unsettled_reservations=0 released_usd_micros=0`,
      `ACCOUNTING: role run=${RUN} role=PROMPT_ARCHITECT reservations=1 billed_known_usd_micros=0 billed_known_reservations=0 runtime_reported_usd_micros=0 runtime_reported_reservations=0 unknown_held_usd_micros=300000 unknown_reservations=1 unsettled_usd_micros=0 unsettled_reservations=0 released_usd_micros=0`,
      `ACCOUNTING: pool run=${RUN} opening_usd_micros=100000000 reserved_total_usd_micros=1200000 billed_known_usd_micros=0 runtime_reported_usd_micros=483118 unknown_held_usd_micros=900000 unsettled_usd_micros=0 released_usd_micros=0 final_remaining_usd_micros=98616882 basis=slot_ledger_charge_rule`,
    ]);
  });

  it('never adds the runtime-reported figure to the billed figure, and never converts tokens', () => {
    const rows: JuliusBudgetRow[] = [
      allocated('CODING_AGENT', 10_000_000), reserved('CODING_AGENT', 'a'),
      settled('a', { costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION', executionUsdMicros: 700, inputTokens: 13_133, outputTokens: 3_414 }),
      reserved('PROMPT_ARCHITECT', 'b'), settled('b', { costBasis: 'PROVIDER_REPORTED', usdMicros: 12_000, billingPath: 'API_BILLED' }),
    ];
    const poolLine = liveAccountingLines(RUN, rows).at(-1) ?? '';
    expect(poolLine).toContain('billed_known_usd_micros=12000 runtime_reported_usd_micros=700 ');
    expect(poolLine).toContain('final_remaining_usd_micros=9987300 ');
    expect(poolLine, 'no combined figure').not.toContain('12700');
  });

  it('a NOT_APPLICABLE settlement with no figure is unknown at its hold, never zero and never runtime-reported', () => {
    const rows: JuliusBudgetRow[] = [
      allocated('CODING_AGENT', 1_000_000), reserved('CODING_AGENT', 'a'), settled('a', { costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION' }),
    ];
    const roleLine = liveAccountingLines(RUN, rows).find((line) => line.startsWith('ACCOUNTING: role ')) ?? '';
    expect(roleLine).toContain('runtime_reported_usd_micros=0 runtime_reported_reservations=0 unknown_held_usd_micros=300000 unknown_reservations=1');
  });

  it('counts an unsettled reservation as unsettled and a released one as released, each once', () => {
    const rows: JuliusBudgetRow[] = [
      allocated('CODING_AGENT', 1_000_000), reserved('CODING_AGENT', 'open'), reserved('CODING_AGENT', 'freed'),
      settled('freed', { released: true, costBasis: 'UNKNOWN' }),
    ];
    const poolLine = liveAccountingLines(RUN, rows).at(-1) ?? '';
    expect(poolLine).toContain('reserved_total_usd_micros=600000 ');
    expect(poolLine).toContain('unsettled_usd_micros=300000 released_usd_micros=300000 final_remaining_usd_micros=700000 ');
  });

  it('says unknown, not zero, when the rows carry no opening pool', () => {
    const poolLine = liveAccountingLines(RUN, [reserved('CODING_AGENT', 'a')]).at(-1) ?? '';
    expect(poolLine).toContain('opening_usd_micros=unknown ');
    expect(poolLine).toContain('final_remaining_usd_micros=unknown ');
    expect(liveAccountingLines(RUN, []).at(-1)).toContain('reserved_total_usd_micros=0 ');
  });

  it('prints a role it does not recognise as a closed token, never as the text it was given', () => {
    const line = liveAccountingLines(RUN, [allocated('X', 1_000), reserved('lower case; role', 'a')]).find((entry) => entry.startsWith('ACCOUNTING: role ')) ?? '';
    expect(line).toContain(' role=UNRECOGNISED_ROLE ');
    expect(line).not.toContain('lower case');
  });

  it('names the three coder token instruments, what each fills, and that they are not reconciled', () => {
    const legend = LIVE_ACCOUNTING_LEGEND.join('\n');
    for (const name of ['tokens_ledger', 'tokens_sdk_result', 'tokens_stream_floor', 'tokens_reconciliation']) expect(legend, name).toContain(`legend ${name} `);
    expect(legend).toContain('input_tokens and output_tokens in effort and worker-diagnostics');
    expect(legend).toContain('result_model_first_input_tokens');
    expect(legend).toContain('stream_cache_creation_input_tokens');
    expect(legend).toContain('not reconciled');
    expect(legend).toContain('never converted from tokens');
    expect(LIVE_ACCOUNTING_LEGEND.every((line) => !line.includes('\n'))).toBe(true);
  });

  it('documents the reservation timestamps and the reviewer-key line without printing any key material', () => {
    expect(LIVE_ACCOUNTING_LEGEND.join('\n')).toContain('provider_request_started is blank unless the adapter observed one');
    expect(LIVE_REVIEWER_KEY_IDENTITY_LINE).toContain('presence in this process only');
    expect(LIVE_REVIEWER_KEY_IDENTITY_LINE).toContain('cannot tie them together');
    expect(LIVE_REVIEWER_KEY_IDENTITY_LINE.includes('\n')).toBe(false);
  });

  it('reads every page of the timeline, ignores other rows, and reports a failing reader in one line without throwing', async () => {
    const entries = run39202992515.map((row, index) => ({
      eventId: `e${index}`, sequence: index + 1, type: row.type, taskId: row.taskId, workerId: null, occurredAt: 'x',
      facts: row.facts as Record<string, string | number | boolean | null>,
    }));
    const noise = { eventId: 'n', sequence: 99, type: 'task.started', taskId: null, workerId: null, occurredAt: 'x', facts: {} };
    const calls: number[] = [];
    const reader = {
      timeline: async (input: { sinceSequence: number; limit: number }) => {
        calls.push(input.sinceSequence);
        const rest = [...entries, noise].filter((entry) => entry.sequence > input.sinceSequence).slice(0, 4);
        return { entries: rest, hasMore: rest.length === 4 && rest[3]!.sequence < 99 };
      },
    };
    expect(await liveAccountingLinesFor(reader, RUN, 'project:x')).toEqual(liveAccountingLines(RUN, run39202992515));
    expect(calls.length, 'paged').toBeGreaterThan(1);
    const failing = { timeline: async () => { throw new Error('store_unreachable'); } };
    expect(await liveAccountingLinesFor(failing, RUN, 'project:x')).toEqual(['ACCOUNTING: NOT RECORDED — store_unreachable']);
  });
});
