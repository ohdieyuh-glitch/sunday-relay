import { describe, expect, it } from 'vitest';
import { parseCli } from '../main';
import { detectCaps } from './theme';
import { breakpoint, spread, truncateVisible, visibleLength } from './layout';
import { safePath, safeText } from './safety';
import { footerDog, headerLogo } from './dog';
import { initialState, reduceKey, renderScreen, DRAFT_FIELDS, FORBIDDEN_DRAFT_FIELDS, type AppData } from './app';
import { parseKeys } from './shell';
import { demoData, plainWalkthrough } from './demo';
import { dogStateFrom, missionConsoleVM } from './projections';
import { DEMO_TIMELINE } from './fixtures';
import { runCliContractVerification } from './verify-harness';
import type { CliCaps } from './contracts';

/**
 * Relay CLI product tests (Prompt 8.6) — focused units plus the full CLI
 * contract harness. No TTY needed, no provider call anywhere.
 */

const caps = (over: Partial<CliCaps> = {}): CliCaps => ({
  tty: true, color: true, unicode: true, width: 120, reducedMotion: false,
  plain: false, json: false, ...over,
});

describe('cli contract verification (offline, fixtures, isolated state root)', () => {
  it('every contract check passes with zero provider calls', async () => {
    const { checks, failures } = await runCliContractVerification(parseCli as never);
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    expect(failed, failed.join('\n')).toEqual([]);
    expect(failures).toBe(0);
    expect(checks.length).toBeGreaterThanOrEqual(50);
  }, 120_000);
});

describe('command parsing + routing', () => {
  it('routes the product commands', () => {
    expect(parseCli(['home']).command).toBe('home');
    expect(parseCli(['projects']).command).toBe('projects');
    expect(parseCli(['project', 'new']).command).toBe('project');
    expect(parseCli(['project', 'status']).command).toBe('project');
    expect(parseCli(['recover']).command).toBe('recover');
    expect(parseCli(['cli', 'demo']).command).toBe('cli');
    expect(parseCli(['cli', 'contract-verify']).command).toBe('cli');
  });

  it('keeps every existing engineering command routable', () => {
    for (const argv of [['supervised', 'contract-verify'], ['codex', 'doctor'], ['claude', 'doctor'],
      ['state', 'doctor'], ['runs', 'list'], ['persistence', 'recovery-drill'], ['workspace', 'verify'], ['doctor']]) {
      const parsed = parseCli(argv);
      expect(parsed.error, argv.join(' ')).toBeUndefined();
    }
  });
});

describe('caps + layout + width projection', () => {
  it('detects TTY/color/motion honestly', () => {
    const nonTty = detectCaps({ argv: {}, env: {}, isTTY: false, columns: 90 });
    expect(nonTty.color).toBe(false);
    expect(nonTty.reducedMotion).toBe(true);
    const noColor = detectCaps({ argv: {}, env: { NO_COLOR: '1' }, isTTY: true, columns: 90 });
    expect(noColor.color).toBe(false);
    expect(detectCaps({ argv: { 'reduced-motion': true }, env: {}, isTTY: true }).reducedMotion).toBe(true);
  });

  it('projects breakpoints and bounds visible width', () => {
    expect(breakpoint(140)).toBe('full');
    expect(breakpoint(100)).toBe('stacked');
    expect(breakpoint(70)).toBe('compact');
    expect(breakpoint(50)).toBe('linear');
    expect(visibleLength('\x1b[33mgold\x1b[0m')).toBe(4);
    expect(visibleLength(truncateVisible('x'.repeat(100), 20, caps()))).toBeLessThanOrEqual(20);
    expect(visibleLength(spread('left', 'right', 40))).toBe(40);
  });
});

describe('ANSI safety + redaction', () => {
  it('strips injection, masks ids/emails, bounds newlines, shortens paths', () => {
    expect(safeText('a\x1b[2Jb')).toBe('ab');
    expect(safeText('a\nb')).toBe('a · b');
    expect(safeText('id aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toContain('[session-ref]');
    expect(safeText('mail a@b.co')).toContain('[masked-email]');
    expect(safePath(`/a/${'x'.repeat(100)}/z.ts`, 30).length).toBeLessThanOrEqual(30);
  });

  it('the draft flow never asks for credential material', () => {
    const labels = DRAFT_FIELDS.map((f) => f.label.toLowerCase()).join(' ');
    for (const forbidden of FORBIDDEN_DRAFT_FIELDS) {
      expect(labels).not.toContain(forbidden);
    }
  });
});

describe('keyboard + reducer', () => {
  const data: AppData = demoData();

  it('parses key sequences including graceful ctrl-c', () => {
    expect(parseKeys('\x03')[0].name).toBe('ctrl-c');
    expect(parseKeys('\x1b[A')[0].name).toBe('up');
    expect(parseKeys('\x7f')[0].name).toBe('backspace');
  });

  it('navigates screens, toggles the console view, and quits gracefully', () => {
    let state = initialState(false);
    state = reduceKey(state, { name: 't', char: 't' }, data);
    expect(state.screen).toBe('console');
    state = reduceKey(state, { name: 'v', char: 'v' }, data);
    expect(state.view).toBe('stream');
    state = reduceKey(state, { name: 'v', char: 'v' }, data);
    expect(state.view).toBe('panels');
    state = reduceKey(state, { name: 'escape' }, data);
    state = reduceKey(state, { name: 'q', char: 'q' }, data);
    expect(state.quit).toBe(true);
    expect(reduceKey(initialState(false), { name: 'ctrl-c' }, data).quit).toBe(true);
  });

  it('natural-language input never fabricates a response or calls a provider', () => {
    let state = initialState(false);
    state = reduceKey(state, { name: 't', char: 't' }, data);
    for (const ch of 'xplease build me an app') state = reduceKey(state, { name: ch, char: ch }, data);
    state = reduceKey(state, { name: 'enter' }, data);
    expect(state.message).toContain('Ask Relay is not configured');
  });
});

describe('relay dog', () => {
  it('derives state from canonical events and animates only moving states', () => {
    expect(dogStateFrom(DEMO_TIMELINE.slice(0, 3))).toBe('RESEARCHING');
    expect(dogStateFrom(DEMO_TIMELINE)).toBe('COMPLETE');
    // Milestone 4.5: only idle patrol and carrying a handoff travel the track.
    const moving = footerDog({ state: 'WANDERING', tick: 3, caps: caps() });
    expect(moving.moving).toBe(true);
    const still = footerDog({ state: 'WAITING FOR USER', tick: 3, caps: caps() });
    expect(still.moving).toBe(false);
    const reduced = footerDog({ state: 'WANDERING', tick: 3, caps: caps({ reducedMotion: true }) });
    expect(reduced.moving).toBe(false);
    expect(footerDog({ state: 'WANDERING', tick: 1, caps: caps() }).track)
      .not.toBe(footerDog({ state: 'WANDERING', tick: 4, caps: caps() }).track);
  });

  it('renders the official dog header logo with an ASCII fallback', () => {
    expect(headerLogo(caps()).length).toBeGreaterThan(3);
    const ascii = headerLogo(caps({ color: false, unicode: false }));
    expect(ascii.join('')).not.toContain('\x1b');
  });
});

describe('offline demo', () => {
  it('plain walkthrough is deterministic and fully labeled', () => {
    const c = caps({ tty: false, color: false, unicode: false, plain: true, reducedMotion: true });
    const a = plainWalkthrough(demoData(), c).join('\n');
    const b = plainWalkthrough(demoData(), c).join('\n');
    expect(a).toBe(b);
    for (const label of ['OFFLINE DEMO', 'FAKE ADAPTERS', 'NO PROVIDER CALLS', 'SIMULATED RESTART', 'VERIFIED COMPLETE']) {
      expect(a).toContain(label);
    }
    expect(a).not.toContain('\x1b');
  });

  it('console VM never invents progress beyond the provided canonical events', () => {
    const vm = missionConsoleVM({
      route: 'RLY / 001', projectName: 'X',
      workforce: { architect: { name: 'A', online: true }, coding: { name: 'C', online: true }, reviewer: { name: 'R', online: true, configured: true }, mode: 'GUIDED' },
      events: DEMO_TIMELINE.slice(0, 2), view: 'panels', demo: true,
      callBudget: { consumed: 0, max: 4 }, outputVisibility: 'WORKING', phase: 'PLAN',
    });
    expect(vm.stream).toHaveLength(2);
    expect(vm.missionLabel).toBe('MISSION IN PROGRESS');
    const lines = renderScreen({ ...initialState(false), screen: 'console', timelineCount: 2 }, demoData(), caps());
    expect(lines.join('\n')).not.toContain('Mission verified complete');
  });
});
