import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStateStore } from '../../persistence';
import { parseCli } from '../main';
import { safeText } from './safety';
import { visibleLength, divider } from './layout';
import { footerDog, headerLogo, OFFICIAL_DOG_COLUMNS, OFFICIAL_DOG_ROWS } from './dog';
import { OFFICIAL_RELAY_DOG_TERMINAL_TONE } from './official-relay-dog-sprite';
import { parseKeys } from './shell';
import { detectCaps, paint } from './theme';
import { renderHeader, renderMissionConsole, renderPanel } from './renderer';
import { missionConsoleVM } from './projections';
import {
  DRAFT_FIELDS, finalizeDraft, initialState, reduceKey, reduceTick, renderScreen,
  type AppData, type AppState,
} from './app';
import { findProjectRecord, productProjectView } from './commands';
import { demoData } from './demo';
import { DEMO_TIMELINE } from './fixtures';
import type { CliCaps } from './contracts';

/**
 * Prompt 8.6 hardening regression suite — locks in the fixes for the defects
 * the adversarial review surfaced (which the original contract harness missed):
 * CR/C1 terminal injection, panel-border off-by-one, parseKeys escape/split/
 * non-ASCII handling, wide-char width math, dog-track overrun, project routing,
 * and the [H]/[C]/Tab/command-bar reducer gaps. No TTY, no provider call.
 */

const caps = (over: Partial<CliCaps> = {}): CliCaps => ({
  tty: true, color: true, unicode: true, width: 120, reducedMotion: false,
  plain: false, json: false, ...over,
});
const CR = String.fromCharCode(0x0d);
const C1_CSI = String.fromCharCode(0x9b);
const C1_OSC = String.fromCharCode(0x9d);

describe('safety boundary — terminal-control injection that must never survive', () => {
  it('folds a lone carriage return so cursor-return spoofing cannot overwrite a line', () => {
    const out = safeText(`SAFE LINE${CR}EVIL OVERWRITE`);
    expect(out).not.toContain(CR);
    expect(out).toContain('SAFE LINE');
    expect(out).toContain('EVIL OVERWRITE');
  });

  it('strips 8-bit C1 control introducers (single-byte CSI/OSC/ST)', () => {
    expect(safeText(`a${C1_CSI}2Jb`)).not.toContain(C1_CSI);
    expect(safeText(`x${C1_OSC}0;titley`)).not.toContain(C1_OSC);
  });

  it('bounds LF/CRLF and Unicode line separators to a single line', () => {
    expect(safeText('a\nb')).toBe('a · b');
    expect(safeText('a\r\nb')).toBe('a · b');
    expect(safeText('one\u2028two\u2029three')).not.toMatch(/[\u2028\u2029]/);
  });
});

describe('layout — wide/combining character width (the terminal-width guarantee)', () => {
  it('counts East Asian Wide/Fullwidth chars as two columns', () => {
    expect(visibleLength('日本語プロジェクト')).toBe(18);
    expect(visibleLength('한국어')).toBe(6);
    expect(visibleLength('ＡＢ')).toBe(4);
  });
  it('counts combining marks as zero columns and ASCII as one', () => {
    expect(visibleLength('é')).toBe(1);
    expect(visibleLength('abc')).toBe(3);
  });
});

describe('renderer — PANELS view border alignment', () => {
  it('renders every panel with top, body, and bottom borders of equal width', () => {
    for (const width of [140, 120, 100, 80, 60]) {
      const vm = missionConsoleVM({
        route: 'RLY / 001', projectName: 'Terminal Product',
        workforce: { architect: { name: 'A', online: true }, coding: { name: 'C', online: true }, reviewer: { name: 'R', online: true, configured: true }, mode: 'GUIDED' },
        events: DEMO_TIMELINE, view: 'panels', demo: true,
        callBudget: { consumed: 2, max: 4 }, outputVisibility: 'HELD FOR REVIEW', phase: 'BUILD',
      });
      for (const panel of vm.panels) {
        const lines = renderPanel(panel, caps({ width }), 0);
        const widths = new Set(lines.map((l) => visibleLength(l)));
        expect(widths.size, `panel ${panel.role} @ ${width}: border widths ${[...widths].join(',')}`).toBe(1);
      }
    }
  });
});

describe('dog — track never overruns its width at the bounce', () => {
  it('keeps every animation frame within trackWidth for all ticks', () => {
    for (const trackWidth of [18, 8]) {
      for (let tick = 0; tick < 60; tick += 1) {
        const dog = footerDog({ state: 'TROTTING', tick, caps: caps(), trackWidth });
        expect(visibleLength(dog.track), `tick ${tick} @ ${trackWidth}`).toBeLessThanOrEqual(trackWidth);
      }
    }
  });
});

describe('shell parseKeys — escape sequences never leak as spurious hotkeys', () => {
  it('maps Home/End/PgUp/PgDn to named scroll events and never leaks escape + printables', () => {
    // Navigation keys map to named events (used for viewport scrolling)…
    expect(parseKeys('\x1b[5~').map((k) => k.name)).toEqual(['pageup']);
    expect(parseKeys('\x1b[6~').map((k) => k.name)).toEqual(['pagedown']);
    expect(parseKeys('\x1b[H').map((k) => k.name)).toEqual(['home']);
    expect(parseKeys('\x1b[F').map((k) => k.name)).toEqual(['end']);
    expect(parseKeys('\x1bOH').map((k) => k.name)).toEqual(['home']);
    expect(parseKeys('\x1bOF').map((k) => k.name)).toEqual(['end']);
    // …Delete (`3~`) and other CSI keys are still swallowed entirely.
    expect(parseKeys('\x1b[3~')).toEqual([]);
    // In every case: no spurious Escape, and no raw byte leaks as a typed char.
    for (const seq of ['\x1b[3~', '\x1b[H', '\x1b[F', '\x1b[5~', '\x1b[6~', '\x1bOH', '\x1bOF']) {
      const keys = parseKeys(seq);
      expect(keys.some((k) => k.name === 'escape'), seq).toBe(false);
      expect(keys.some((k) => k.char !== undefined), seq).toBe(false);
    }
  });
  it('drops an incomplete CSI split across chunks without cancelling anything', () => {
    expect(parseKeys('\x1b[')).toEqual([]);
    expect(parseKeys('\x1bO')).toEqual([]);
  });
  it('still parses arrows, shift-Tab, and a lone Escape', () => {
    expect(parseKeys('\x1b[A')[0].name).toBe('up');
    expect(parseKeys('\x1b[Z')[0].name).toBe('tab');
    expect(parseKeys('\x1b').map((k) => k.name)).toEqual(['escape']);
  });
  it('passes printable non-ASCII (CJK/accented) through as typed characters', () => {
    const keys = parseKeys('café日');
    expect(keys.map((k) => k.char).join('')).toBe('café日');
    expect(keys.some((k) => k.name === 'escape')).toBe(false);
  });
});

describe('caps — --compact forces the dense layout', () => {
  it('narrows a wide terminal into the compact band', () => {
    expect(detectCaps({ argv: { compact: true }, env: {}, isTTY: true, columns: 200 }).width).toBeLessThanOrEqual(79);
    expect(detectCaps({ argv: {}, env: {}, isTTY: true, columns: 200 }).width).toBe(200);
  });
});

describe('reducer — advertised affordances actually work', () => {
  const data: AppData = { projects: [], events: [], tasks: [], findings: [], repairs: [], evidence: [], recovery: null, demo: false };

  it('[H] opens History from the project screen, Home elsewhere', () => {
    const onProject = reduceKey({ ...initialState(false), screen: 'project' }, { name: 'h', char: 'h' }, data);
    expect(onProject.screen).toBe('history');
    const elsewhere = reduceKey({ ...initialState(false), screen: 'findings' }, { name: 'h', char: 'h' }, data);
    expect(elsewhere.screen).toBe('home');
  });

  it('[C] answers honestly that Connect is not configured (no silent no-op)', () => {
    const out = reduceKey(initialState(false), { name: 'c', char: 'c' }, data);
    expect(out.message.toLowerCase()).toContain('not configured');
  });

  it('Tab toggles the console view and advances selection elsewhere', () => {
    const onConsole = reduceKey({ ...initialState(false), screen: 'console', view: 'panels' }, { name: 'tab' }, data);
    expect(onConsole.view).toBe('stream');
  });

  it('a long console entry stays in the command bar and never fires navigation', () => {
    let state: AppState = { ...initialState(false), screen: 'console' };
    for (const ch of 'x'.repeat(85)) state = reduceKey(state, { name: ch.toLowerCase(), char: ch }, data);
    expect(state.typed.length).toBe(80);
    // A hotkey letter typed mid-entry appends (capped), it must NOT navigate.
    const after = reduceKey(state, { name: 'h', char: 'h' }, data);
    expect(after.screen).toBe('console');
  });
});

describe('finalizeDraft — every free-text field is sanitized on the write path', () => {
  it('redacts injection in objective/repository/architect even from a raw draft object', () => {
    const draft = finalizeDraft({
      name: 'Proj', objective: `ship\x1b[2J it${CR}now`, repositoryPath: `/repo${C1_CSI}x`,
      architect: 'Al\nice',
    }, '2026-07-23T00:00:00.000Z');
    expect(draft.objective).not.toContain('\x1b');
    expect(draft.objective).not.toContain(CR);
    expect(draft.repositoryPath ?? '').not.toContain(C1_CSI);
    expect(draft.architect).not.toContain('\n');
  });
});

describe('routing — non-interactive project sub-surfaces render real content', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'relay-hardening-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('parses the project sub-actions and resolves a saved project by reference', () => {
    expect(parseCli(['project', 'findings']).projectAction).toBe('findings');
    expect(parseCli(['project', 'tasks']).projectAction).toBe('tasks');
    expect(parseCli(['project', 'evidence']).projectAction).toBe('evidence');
    const store = createStateStore({ root });
    const draft = finalizeDraft({ name: 'Terminal Product' }, '2026-07-23T00:00:00.000Z');
    store.writeProjectRecord(draft.projectId, draft as unknown as Record<string, unknown>);
    expect(findProjectRecord(store, 'terminal-product')?.name).toBe('Terminal Product');
  });

  it('findings/evidence/tasks/settings each render their OWN surface (not the status screen)', () => {
    const store = createStateStore({ root });
    const draft = finalizeDraft({ name: 'Terminal Product', objective: 'Ship the CLI' }, '2026-07-23T00:00:00.000Z');
    store.writeProjectRecord(draft.projectId, draft as unknown as Record<string, unknown>);
    const strip = (r: { lines: string[] }): string => r.lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

    const findings = productProjectView(store, caps({ color: false }), 'findings');
    expect(strip(findings)).toContain('RLY / FINDINGS');
    expect(strip(findings)).toContain('No findings recorded');

    const evidence = productProjectView(store, caps({ color: false }), 'evidence');
    expect(strip(evidence)).toContain('RLY / EVIDENCE');

    const tasks = productProjectView(store, caps({ color: false }), 'tasks');
    expect(strip(tasks)).toContain('RLY / TASKS');
    expect(strip(tasks)).toContain('No manual tasks');

    const settings = productProjectView(store, caps({ color: false }), 'settings');
    expect(strip(settings)).toContain('RLY / SETTINGS');
    expect(strip(settings)).toContain('Ship the CLI');
    expect(findings.exitCode).toBe(0);
  });
});

describe('Relay Dog — the OFFICIAL front-facing voxel dog (one identity)', () => {
  it('the header logo is the official sprite: upright ears, dark visor, amber eyes', () => {
    const logo = headerLogo(caps());
    // 18x14 sprite folded two pixel rows per line = 7 rows, 18 columns.
    expect(logo.length).toBe(OFFICIAL_DOG_ROWS);
    const maxW = Math.max(...logo.map(visibleLength));
    expect(maxW).toBe(OFFICIAL_DOG_COLUMNS + 1); // + the one-column gutter
    const raw = logo.join('\n');
    expect(raw).toContain('▀');                              // half-block pixel art
    expect(raw).toContain(`38;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE.y}`); // amber eyes
    expect(raw).toContain(`48;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE.d}`); // dark visor band
    expect(raw).toContain(`38;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE.w}`); // bone-white body
  });

  it('the header dog keeps ONE uniform scale and identical proportions at every width', () => {
    const wide = headerLogo(caps({ width: 130 }));
    const narrow = headerLogo(caps({ width: 90 }));
    const mobile = headerLogo(caps({ width: 62 }));
    // Same sprite, same rows, same columns — never a second, redrawn dog.
    expect(narrow).toEqual(wide);
    expect(mobile).toEqual(wide);
    for (const logo of [wide, narrow, mobile]) {
      expect(logo.length).toBe(OFFICIAL_DOG_ROWS);
      expect(Math.max(...logo.map(visibleLength))).toBe(OFFICIAL_DOG_COLUMNS + 1);
    }
  });

  it('the no-Unicode fallback is the SAME official sprite folded to ASCII, no ANSI', () => {
    const ascii = headerLogo(caps({ color: false, unicode: false }));
    const raw = ascii.join('\n');
    expect(raw).not.toContain('\x1b');           // plain
    expect(ascii.length).toBe(OFFICIAL_DOG_ROWS); // same proportions as the sprite
    expect(raw).toContain('o');                   // the amber eyes survive the fold
    expect(raw).toContain('=');                   // the visor band survives the fold
    // The retired side dog's ASCII silhouette is gone for good.
    expect(raw).not.toContain('/o \\___');
    expect(raw).not.toContain('\\______\\');
  });

  it('the footer carries the canonical state label and the official motion meaning', () => {
    const still = footerDog({ state: 'COMPLETE', tick: 0, caps: caps() });
    const patrol = footerDog({ state: 'WANDERING', tick: 3, caps: caps() });
    const thinking = footerDog({ state: 'TROTTING', tick: 3, caps: caps() });
    expect(still.label).toContain('RELAY DOG');
    expect(still.track).not.toMatch(/[°ᴥ]/);     // not the old <°ᴥ°> face
    expect(patrol.moving).toBe(true);            // idle patrols
    expect(thinking.moving).toBe(false);         // thinking stops walking (4.5)
    expect(still.moving).toBe(false);
  });

  it('the Complete pose only appears for the canonical COMPLETE state (renderer never invents it)', () => {
    expect(footerDog({ state: 'COMPLETE', tick: 0, caps: caps() }).label).toContain('COMPLETE');
    expect(footerDog({ state: 'WANDERING', tick: 0, caps: caps() }).label).not.toContain('COMPLETE');
  });
});

describe('Sunday gold is a restrained aged-brass signal, not neon yellow', () => {
  it('primary gold is dim brass (136), never the old neon 178', () => {
    const g = paint(caps()).tone('gold', 'RELAY');
    expect(g).toContain('38;5;136');
    expect(g).not.toContain('38;5;178');
  });

  it('structural dividers/borders use the dimmer brass (goldDim 94), below the gold text', () => {
    const d = divider(caps(), 40);
    expect(d).toContain('38;5;94');
    expect(d).not.toContain('38;5;178');
    // Panel borders recede to goldDim too, while cream text carries content.
    const panelRaw = renderPanel({
      role: 'coding', title: 'CODING AGENT', badge: 'ACTIVE', statusRight: 'WORKING', statusTone: 'gold',
      events: [{ at: '12:00:00', role: 'coding', symbol: 'event', primary: 'Editing claimed file' }],
    }, caps(), 0).join('\n');
    expect(panelRaw).toContain('38;5;94');   // dim border
  });

  it('the header stays readable with no color and emits only SGR color codes (no cursor/clear/OSC)', () => {
    const noColor = renderHeader({ caps: caps({ color: false }), route: 'RLY / 001', workforce: null, demo: false });
    expect(noColor.join('')).not.toContain('\x1b');
    const colored = renderHeader({ caps: caps(), route: 'RLY / 001', workforce: null, demo: false }).join('');
    // Only SGR (…m) sequences — never cursor moves, clears, or OSC in header art.
    expect(colored).not.toMatch(/\x1b\[[0-9;]*[A-LN-Za-ln-z]/); // no non-'m' CSI finals
    expect(colored).not.toContain('\x1b]');                      // no OSC
  });
});

describe('offline demo — timed visual mission simulation (founder scope)', () => {
  const data: AppData = demoData();
  const strip = (lines: string[]): string => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

  it('opens on the activation splash with the full offline honesty banner', () => {
    expect(initialState(true).screen).toBe('demo-intro');
    const splash = strip(renderScreen({ ...initialState(true) }, data, caps({ color: false })));
    expect(splash).toContain('OFFLINE VISUAL SIMULATION');
    expect(splash).toContain('NO REAL FILE CHANGES');
    expect(splash).toContain('[ENTER]');
    expect(splash).toContain('[P]');
  });

  it('ENTER activates the console (panels), P activates and plays, N steps once', () => {
    const intro = initialState(true);
    const entered = reduceKey(intro, { name: 'enter' }, data);
    expect(entered.screen).toBe('console');
    expect(entered.view).toBe('panels');
    expect(entered.timelineCount).toBe(1);
    expect(entered.playing).toBe(false);
    const played = reduceKey(intro, { name: 'p' }, data);
    expect(played.screen).toBe('console');
    expect(played.playing).toBe(true);
  });

  it('reduceTick reveals events at a paced cadence ONLY while playing', () => {
    let s: AppState = { ...initialState(true), screen: 'console', timelineCount: 1, playing: true, speed: 1 };
    let revealedAtLeastOnce = false;
    for (let i = 0; i < 8; i += 1) { const r = reduceTick(s, data); s = r.state; revealedAtLeastOnce ||= r.revealed; }
    expect(revealedAtLeastOnce).toBe(true);
    expect(s.timelineCount).toBeGreaterThan(1);
    // Paused: many ticks reveal nothing.
    let paused: AppState = { ...initialState(true), screen: 'console', timelineCount: 3, playing: false };
    const before = paused.timelineCount;
    for (let i = 0; i < 20; i += 1) paused = reduceTick(paused, data).state;
    expect(paused.timelineCount).toBe(before);
  });

  it('faster speed reveals in fewer ticks than normal speed', () => {
    const ticksToReveal = (speed: number): number => {
      let s: AppState = { ...initialState(true), screen: 'console', timelineCount: 1, playing: true, speed };
      for (let i = 1; i <= 40; i += 1) { const r = reduceTick(s, data); s = r.state; if (r.revealed) return i; }
      return 999;
    };
    expect(ticksToReveal(2)).toBeLessThan(ticksToReveal(1));
  });

  it('reduceTick settles at COMPLETE and stops playing at the end', () => {
    let s: AppState = { ...initialState(true), screen: 'console', timelineCount: data.events.length, playing: true };
    s = reduceTick(s, data).state;
    expect(s.playing).toBe(false);
    expect(s.timelineCount).toBe(data.events.length);
  });

  it('P toggles play/pause, N steps and pauses, R restarts, 1/2/3 set speed (single keys on the console)', () => {
    const console0: AppState = { ...initialState(true), screen: 'console', timelineCount: 5, playing: true, typed: '' };
    expect(reduceKey(console0, { name: 'p' }, data).playing).toBe(false);
    const stepped = reduceKey(console0, { name: 'n' }, data);
    expect(stepped.timelineCount).toBe(6);
    expect(stepped.playing).toBe(false);
    expect(reduceKey(console0, { name: 'r' }, data).timelineCount).toBe(1);
    expect(reduceKey(console0, { name: '2' }, data).speed).toBe(1.5);
    expect(reduceKey(console0, { name: '3' }, data).speed).toBe(2);
  });

  it('slash commands drive playback without touching canonical phase; NL is declined', () => {
    const withTyped = (t: string): AppState => ({ ...initialState(true), screen: 'console', timelineCount: 4, typed: t });
    expect(reduceKey(withTyped('/pause'), { name: 'enter' }, data).playing).toBe(false);
    expect(reduceKey(withTyped('/play'), { name: 'enter' }, data).playing).toBe(true);
    expect(reduceKey(withTyped('/next'), { name: 'enter' }, data).timelineCount).toBe(5);
    expect(reduceKey(withTyped('/restart'), { name: 'enter' }, data).timelineCount).toBe(1);
    expect(reduceKey(withTyped('/stream'), { name: 'enter' }, data).view).toBe('stream');
    // /complete cannot bypass CompletionPolicy — no phase change, honest message.
    const complete = reduceKey(withTyped('/complete'), { name: 'enter' }, data);
    expect(complete.timelineCount).toBe(4);
    expect(complete.message.toLowerCase()).toContain('completionpolicy');
    // Natural-language input is declined and never advances the fixture.
    const nl = reduceKey(withTyped('please just finish it'), { name: 'enter' }, data);
    expect(nl.timelineCount).toBe(4);
    expect(nl.message).toContain('Ask Relay is not configured');
  });

  it('the console keeps the OFFLINE labels and shows a playback control bar', () => {
    const out = strip(renderScreen({ ...initialState(true), screen: 'console', timelineCount: 8, playing: false }, data, caps({ color: false })));
    expect(out).toContain('OFFLINE DEMO');
    expect(out).toContain('VISUAL SIMULATION');
    expect(out).toContain('PAUSED');
    expect(out).toContain('step 8/');
    expect(out).toContain('[P]lay/pause');
  });

  it('the footer HANDOFF NETWORK status tracks the mission phase', () => {
    const handoff = (count: number): string => missionConsoleVM({
      route: 'RLY / 001', projectName: 'X',
      workforce: { architect: { name: 'A', online: true }, coding: { name: 'C', online: true }, reviewer: { name: 'R', online: true, configured: true }, mode: 'GUIDED' },
      events: DEMO_TIMELINE.slice(0, count), view: 'panels', demo: true,
      callBudget: { consumed: 0, max: 4 }, outputVisibility: 'WORKING', phase: 'BUILD',
    }).footer.handoff;
    expect(handoff(0)).toContain('STANDBY');
    expect(handoff(6)).toContain('ACTIVE');
    expect(handoff(DEMO_TIMELINE.length)).toContain('COMPLETE');
  });

  it('the stream view marks the currently active (last revealed) event, but not once complete', () => {
    const mk = (count: number) => missionConsoleVM({
      route: 'RLY / 001', projectName: 'X',
      workforce: { architect: { name: 'A', online: true }, coding: { name: 'C', online: true }, reviewer: { name: 'R', online: true, configured: true }, mode: 'GUIDED' },
      events: DEMO_TIMELINE.slice(0, count), view: 'stream', demo: true,
      callBudget: { consumed: 0, max: 4 }, outputVisibility: 'WORKING', phase: 'BUILD',
    });
    const mid = strip(renderMissionConsole(mk(6), caps()));
    expect(mid).toContain('▸');                                  // active pointer while in progress
    const done = strip(renderMissionConsole(mk(DEMO_TIMELINE.length), caps()));
    expect(done).not.toContain('▸');                             // no active pointer once complete
  });
});

describe('project layer — selectable options, not typed responses (Prompt 8.7)', () => {
  const data: AppData = { projects: [], events: [], tasks: [], findings: [], repairs: [], evidence: [], recovery: null, demo: false };
  const strip2 = (lines: string[]): string => lines.join('\n')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

  /** Open the draft and advance to the field with the given key (accepting
   * defaults: Enter on selects, a placeholder on REQUIRED text fields so they
   * don't block, fallback on optional text). */
  const openAt = (key: string): AppState => {
    let s = reduceKey(initialState(false), { name: 'n', char: 'n' }, data);
    let guard = 0;
    while (DRAFT_FIELDS[s.draftIndex] && DRAFT_FIELDS[s.draftIndex].key !== key && !s.draftReview && guard < 60) {
      guard += 1;
      const field = DRAFT_FIELDS[s.draftIndex];
      if (field.kind === 'text' && !field.optional) s = reduceKey(s, { name: 'x', char: 'x' }, data);
      s = reduceKey(s, { name: 'enter' }, data);
    }
    return s;
  };

  it('every discrete-value field is a SELECT (no typing); free-form fields stay text/list', () => {
    const selects = DRAFT_FIELDS.filter((f) => f.kind === 'select').map((f) => f.key);
    for (const key of ['projectType', 'existingProject', 'productionImpact', 'architect', 'codingAgent', 'reviewer', 'mode', 'researchPreference', 'callLimit']) {
      expect(selects, key).toContain(key);
    }
    // Selects carry options and never require typing.
    for (const f of DRAFT_FIELDS.filter((f) => f.kind === 'select')) {
      expect(f.options && f.options.length > 0, `${f.key} needs options`).toBe(true);
    }
    // Free-form identity/scope fields remain typed.
    for (const key of ['name', 'objective']) {
      expect(DRAFT_FIELDS.find((f) => f.key === key)?.kind).toBe('text');
    }
  });

  it('a select field renders a highlighted option list, not a text prompt', () => {
    const s = openAt('mode');
    const out = strip2(renderScreen(s, data, caps()));
    expect(out).toContain('Guided');
    expect(out).toContain('Semi-autonomous');
    expect(out).toContain('Autonomous');
    expect(out).toContain('▸');                    // a highlighted option
    expect(out).toContain('[Enter] select');       // selection affordance, not a typed prompt
    expect(out).not.toContain('type < then Enter');
  });

  it('arrow keys move the highlight and Enter commits the highlighted option', () => {
    let s = openAt('mode');
    expect(s.selection).toBe(0);                   // Guided (default)
    s = reduceKey(s, { name: 'down' }, data);
    expect(s.selection).toBe(1);                   // Semi-autonomous highlighted
    const modeIndex = s.draftIndex;
    s = reduceKey(s, { name: 'enter' }, data);     // commit Semi
    expect(s.draft.mode).toBe('SEMI');
    expect(s.draftIndex).toBeGreaterThan(modeIndex); // advanced
  });

  it('a number key jumps directly to an option', () => {
    let s = openAt('callLimit');
    s = reduceKey(s, { name: '3', char: '3' }, data); // 3rd option = 6 calls
    expect(s.selection).toBe(2);
    s = reduceKey(s, { name: 'enter' }, data);
    expect(s.draft.callLimit).toBe(6);
  });

  it('Backspace on a select goes back to the previous field, keeping the earlier choice highlighted', () => {
    let s = openAt('codingAgent');
    // choose reviewer's neighbour path: go forward to reviewer, then back
    const agentIndex = s.draftIndex;
    s = reduceKey(s, { name: 'enter' }, data);       // commit Claude Code → reviewer
    expect(DRAFT_FIELDS[s.draftIndex].key).toBe('reviewer');
    s = reduceKey(s, { name: 'down' }, data);        // highlight "None"
    s = reduceKey(s, { name: 'enter' }, data);       // commit reviewer = None → mode
    s = reduceKey(s, { name: 'backspace' }, data);   // back to reviewer
    expect(DRAFT_FIELDS[s.draftIndex].key).toBe('reviewer');
    expect(s.selection).toBe(1);                     // the "None" choice is still highlighted
    void agentIndex;
  });

  it('Enter-through-defaults yields the default selections (no typing anywhere)', () => {
    let s = reduceKey(initialState(false), { name: 'n', char: 'n' }, data);
    // type only the two free-text required fields; Enter through everything else
    for (const ch of 'My Project') s = reduceKey(s, { name: ch.toLowerCase(), char: ch }, data);
    s = reduceKey(s, { name: 'enter' }, data);       // name
    s = reduceKey(s, { name: 'enter' }, data);       // projectType = feature (default select)
    for (const ch of 'Ship it') s = reduceKey(s, { name: ch.toLowerCase(), char: ch }, data);
    s = reduceKey(s, { name: 'enter' }, data);       // objective
    while (!s.draftReview) s = reduceKey(s, { name: 'enter' }, data); // defaults for the rest
    const draft = finalizeDraft(s.draft, '2026-07-26T00:00:00.000Z');
    expect(draft.name).toBe('My Project');
    expect(draft.projectType).toBe('feature');
    expect(draft.architect).toBe('Sunday Alcatraz');
    expect(draft.codingAgent).toBe('Claude Code');
    expect(draft.reviewer).toBe('Codex');
    expect(draft.mode).toBe('GUIDED');
    expect(draft.existingProject).toBe(true);
    expect(draft.callLimit).toBe(4);
    expect(draft.runtimeLimitMinutes).toBe(30);
  });

  it('letters are inert on a select (they never leak into a typed response)', () => {
    let s = openAt('mode');
    const before = s.selection;
    s = reduceKey(s, { name: 'x', char: 'x' }, data);
    expect(s.selection).toBe(before);   // unchanged
    expect(s.typed).toBe('');           // nothing typed
    expect(DRAFT_FIELDS[s.draftIndex].key).toBe('mode'); // did not advance
  });
});
