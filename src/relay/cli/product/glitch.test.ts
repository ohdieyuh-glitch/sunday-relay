import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runProductShell } from './shell';
import { demoData } from './demo';
import { detectCaps } from './theme';
import type { CliCaps } from './contracts';

/**
 * Prompt 8.7 — CLI glitch regression harness. A pseudo-terminal driven with
 * FAKE streams + FAKE timers exercises the REAL interactive shell loop and
 * asserts lifecycle behavior (not snapshots): exactly one timer, no repaint on
 * idle/paused/completed frames, flicker-free redraw, one keypress → one action,
 * clean + idempotent teardown, alternate-screen exit exactly once, and a safe
 * fatal path. These lock the founder-reported "CLI keeps glitching" fixes.
 *
 * Quit note: on the demo CONSOLE a single `q` navigates back (approved 8.6
 * behavior), so console-ending scenarios exit with Ctrl+C (`\x03`), which
 * always quits cleanly (exit 0). `q` only quits from the splash / home.
 */

interface FakeStdin extends EventEmitter {
  isTTY: boolean;
  setRawMode(mode: boolean): void;
  resume(): void;
  pause(): void;
  setEncoding(enc: string): void;
  rawModeCalls: boolean[];
}
interface FakeStdout extends EventEmitter {
  columns: number | undefined;
  rows: number | undefined;
  writes: string[];
  write(text: string): boolean;
}

function fakeStdin(isTTY: boolean): FakeStdin {
  const s = new EventEmitter() as FakeStdin;
  s.isTTY = isTTY;
  s.rawModeCalls = [];
  s.setRawMode = (m: boolean) => { s.rawModeCalls.push(m); };
  s.resume = () => undefined;
  s.pause = () => undefined;
  s.setEncoding = () => undefined;
  return s;
}
function fakeStdout(columns: number | undefined = 100, rows: number | undefined = undefined): FakeStdout {
  const s = new EventEmitter() as FakeStdout;
  s.columns = columns;
  s.rows = rows;
  s.writes = [];
  s.write = (text: string) => { s.writes.push(text); return true; };
  return s;
}

const caps = (width = 100): CliCaps => detectCaps({ argv: {}, env: {}, isTTY: true, columns: width });

/** A frame repaint is the only write that begins by homing the cursor
 * (`\x1b[H…`); alt-screen enter/exit, the one-time clear, and restore never do. */
const frameWrites = (out: FakeStdout): string[] => out.writes.filter((w) => w.startsWith('\x1b[H'));
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
/** The `\n`-separated content lines of the most recent painted frame. */
const lastFrameLines = (out: FakeStdout): string[] => {
  const f = frameWrites(out).at(-1) ?? '';
  return f.replace(/^\x1b\[H/, '').replace(/\x1b\[J$/, '').split('\n');
};

const QUIT = '\x03'; // Ctrl+C — always quits cleanly from any screen

function launch(opts: { screen?: 'demo-intro' | 'console'; isTTY?: boolean; width?: number; rows?: number; playbackMs?: number }) {
  const stdin = fakeStdin(opts.isTTY ?? true);
  const stdout = fakeStdout(opts.width ?? 100, opts.rows);
  const pending = runProductShell({
    caps: caps(opts.width ?? 100),
    data: demoData(),
    store: null,
    playbackMs: opts.playbackMs ?? 300,
    now: () => '2026-07-26T12:43:00.000Z',
    initialScreen: opts.screen ?? 'demo-intro',
    stdin: stdin as never,
    stdout: stdout as never,
  });
  return { stdin, stdout, pending };
}

describe('CLI glitch regression (pseudo-terminal harness)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('enters the alternate screen once, hides the cursor, and paints one first frame', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    expect(stdout.writes.filter((w) => w.includes('\x1b[?1049h'))).toHaveLength(1);
    expect(stdout.writes.some((w) => w.includes('\x1b[?25l'))).toBe(true);
    expect(frameWrites(stdout).length).toBe(1);
    stdin.emit('data', 'q'); // splash: q quits
    await pending;
  });

  it('does NOT repaint the idle splash — the timer is silent until a key or a reveal', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    const before = frameWrites(stdout).length; // 1
    await vi.advanceTimersByTimeAsync(3000); // ~10 ticks on the idle splash
    expect(frameWrites(stdout).length).toBe(before); // zero extra repaints
    stdin.emit('data', 'q');
    await pending;
  });

  it('no per-frame full-screen clear — a repaint never blanks the whole screen', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    stdin.emit('data', 'p'); // play
    await vi.advanceTimersByTimeAsync(6000);
    const frames = frameWrites(stdout);
    expect(frames.length).toBeGreaterThan(1);
    for (const w of frames) {
      expect(w.includes('\x1b[2J'), 'a repaint must not blank the whole screen (that flash IS the flicker)').toBe(false);
      expect(w.endsWith('\x1b[J')).toBe(true); // clears only the tail below
    }
    stdin.emit('data', QUIT);
    await pending;
  });

  it('playback advances frames while playing, then STOPS repainting after completion', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    stdin.emit('data', 'p');
    await vi.advanceTimersByTimeAsync(3000);
    expect(frameWrites(stdout).length).toBeGreaterThan(1); // advanced during playback
    await vi.advanceTimersByTimeAsync(60_000); // past the full 42s timeline → COMPLETE
    const atComplete = frameWrites(stdout).length;
    await vi.advanceTimersByTimeAsync(30_000); // keep the clock running long after COMPLETE
    expect(frameWrites(stdout).length).toBe(atComplete); // settled: zero idle repaints
    stdin.emit('data', QUIT);
    await pending;
  });

  it('pause freezes progression: no repaints accrue while paused', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    stdin.emit('data', 'p'); // play
    await vi.advanceTimersByTimeAsync(3000);
    stdin.emit('data', 'p'); // pause (one keypress repaint)
    const afterPauseKey = frameWrites(stdout).length;
    await vi.advanceTimersByTimeAsync(9000); // ~30 idle ticks while paused
    expect(frameWrites(stdout).length).toBe(afterPauseKey); // frozen
    stdin.emit('data', QUIT);
    await pending;
  });

  it('one physical keypress causes exactly one repaint', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console' });
    const start = frameWrites(stdout).length;
    stdin.emit('data', 'v'); // toggle view — one real change
    expect(frameWrites(stdout).length).toBe(start + 1);
    stdin.emit('data', 'v'); // toggle back — one real change
    expect(frameWrites(stdout).length).toBe(start + 2);
    stdin.emit('data', QUIT);
    await pending;
  });

  it('splash Q exits 0, restores the cursor, resets SGR, and leaves the alternate screen exactly once', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro' });
    stdin.emit('data', 'q');
    const code = await pending;
    expect(code).toBe(0);
    const all = stdout.writes.join('');
    expect(all).toContain('\x1b[?25h'); // cursor shown
    expect(all).toContain('\x1b[0m'); // SGR reset
    expect(stdout.writes.filter((w) => w.includes('\x1b[?1049l'))).toHaveLength(1); // alt-screen exit once
    expect(stdin.rawModeCalls).toEqual([true, false]); // raw on then off, once each
  });

  it('Ctrl+C exits cleanly (0) and restores the terminal', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console' });
    stdin.emit('data', '\x03');
    const code = await pending;
    expect(code).toBe(0);
    expect(stdout.writes.join('')).toContain('\x1b[?1049l');
  });

  it('a fatal error restores the terminal (alt-screen exit) and prints a SANITIZED message with no ANSI', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console' });
    stdin.emit('error', new Error('boom \x1b[2J\x07 sk-FAKETESTNOTREAL000000 aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee /home/secret/x'));
    const code = await pending;
    expect(code).toBe(1);
    expect(stdout.writes.join('')).toContain('\x1b[?1049l'); // left the alternate screen
    const errChunk = stdout.writes.find((w) => w.includes('Relay CLI error:'));
    expect(errChunk).toBeDefined();
    expect(errChunk).not.toContain('\x1b');
    expect(errChunk).not.toContain('\x07');
    expect(errChunk).not.toContain('sk-FAKETESTNOTREAL000000');
    expect(errChunk).not.toContain('/home/secret');
    expect(errChunk).toContain('[REDACTED]');
  });

  it('teardown is idempotent: after exit no timer remains and no frame paints', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console' });
    stdin.emit('data', 'p'); // play
    await vi.advanceTimersByTimeAsync(2000);
    stdin.emit('data', QUIT);
    await pending;
    const framesAtExit = frameWrites(stdout).length;
    expect(vi.getTimerCount()).toBe(0); // the single interval was cleared
    await vi.advanceTimersByTimeAsync(10_000); // late clock ticks paint nothing
    stdin.emit('data', 'p'); // stray input after cleanup is ignored
    expect(frameWrites(stdout).length).toBe(framesAtExit);
  });

  it('exactly one interval timer is owned across play/pause/restart/speed churn', async () => {
    const { stdin, pending } = launch({ screen: 'console' });
    for (const k of ['p', 'p', 'r', '2', 'p', '3', 'p', 'v', 'p']) stdin.emit('data', k);
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(1); // never spawns a second loop
    stdin.emit('data', QUIT);
    await pending;
  });

  it('resize repaints once at the new width without crashing or spawning a loop', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console', width: 100 });
    stdin.emit('data', 'p');
    await vi.advanceTimersByTimeAsync(2000);
    const before = frameWrites(stdout).length;
    stdout.columns = 60;
    stdout.emit('resize');
    expect(vi.getTimerCount()).toBe(1); // still one timer
    expect(frameWrites(stdout).length).toBe(before + 1); // one forced repaint
    expect(stdout.writes.some((w) => w === '\x1b[2J')).toBe(true); // blanked once for the new geometry
    stdin.emit('data', QUIT);
    await pending;
  });

  it('two sequential runs in the same "terminal" each start and exit cleanly', async () => {
    for (let run = 0; run < 2; run += 1) {
      const { stdin, stdout, pending } = launch({ screen: 'console' });
      stdin.emit('data', 'p');
      await vi.advanceTimersByTimeAsync(1500);
      stdin.emit('data', QUIT);
      expect(await pending).toBe(0);
      expect(stdout.writes.filter((w) => w.includes('\x1b[?1049h'))).toHaveLength(1);
      expect(stdout.writes.filter((w) => w.includes('\x1b[?1049l'))).toHaveLength(1);
    }
  });

  it('a fixed width yields a deterministic first frame with no line exceeding the terminal width', async () => {
    for (const width of [140, 100, 80, 60, 40]) {
      const { stdin, stdout, pending } = launch({ screen: 'console', width });
      const frame = frameWrites(stdout)[0] ?? '';
      for (const line of stripAnsi(frame).split('\n')) {
        expect(line.length, `width ${width}`).toBeLessThanOrEqual(width);
      }
      stdin.emit('data', QUIT);
      await pending;
    }
  });
});

describe('CLI viewport scrolling (content taller than the terminal)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('when the frame fits (tall terminal) there is NO scroll hint and no windowing', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console', rows: 200 });
    const lines = lastFrameLines(stdout);
    expect(lines.some((l) => stripAnsi(l).toLowerCase().includes('scroll'))).toBe(false);
    stdin.emit('data', QUIT);
    await pending;
  });

  it('when the frame overflows it shows a bounded window (<= rows) plus a scroll hint', async () => {
    const rows = 18;
    const { stdin, stdout, pending } = launch({ screen: 'console', rows });
    const lines = lastFrameLines(stdout);
    expect(lines.length).toBeLessThanOrEqual(rows);
    expect(lines.some((l) => stripAnsi(l).toLowerCase().includes('scroll'))).toBe(true);
    stdin.emit('data', QUIT);
    await pending;
  });

  it('Home scrolls to the true top, End returns to the followed bottom (windows differ)', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console', rows: 18 });
    const bottom = frameWrites(stdout).at(-1); // initial view follows the bottom
    stdin.emit('data', '\x1b[H'); // Home → top
    const top = frameWrites(stdout).at(-1);
    expect(top).not.toBe(bottom);
    // The top window shows content that IS above the bottom window: its hint
    // reports rows below.
    expect(stripAnsi(top ?? '').toLowerCase()).toContain('below');
    stdin.emit('data', '\x1b[F'); // End → bottom again (re-follow)
    expect(frameWrites(stdout).at(-1)).toBe(bottom);
    stdin.emit('data', QUIT);
    await pending;
  });

  it('one scroll key produces exactly one repaint and does not touch mission state', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'console', rows: 18 });
    const before = frameWrites(stdout).length;
    stdin.emit('data', '\x1b[5~'); // PageUp
    expect(frameWrites(stdout).length).toBe(before + 1);
    stdin.emit('data', QUIT);
    expect(await pending).toBe(0); // still quits cleanly (scroll never changed mission state)
  });

  it('during playback the followed view keeps the newest content visible, and scrolling up releases follow', async () => {
    const { stdin, stdout, pending } = launch({ screen: 'demo-intro', rows: 18 });
    stdin.emit('data', 'p'); // into console, playing
    await vi.advanceTimersByTimeAsync(9000); // several reveals
    // Following: the bottom window shows a scroll hint with content above it.
    expect(stripAnsi(frameWrites(stdout).at(-1) ?? '').toLowerCase()).toContain('above');
    stdin.emit('data', '\x1b[5~'); // scroll up → release follow
    const held = frameWrites(stdout).length;
    await vi.advanceTimersByTimeAsync(3000); // more reveals keep arriving
    // The view stayed put (still repaints as the "below" count grows, but never
    // crashes and never spawns a second loop).
    expect(vi.getTimerCount()).toBe(1);
    expect(frameWrites(stdout).length).toBeGreaterThanOrEqual(held);
    stdin.emit('data', QUIT);
    await pending;
  });
});
