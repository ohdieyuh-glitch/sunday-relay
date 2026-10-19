import type { StateStore } from '../../persistence';
import type { CliCaps } from './contracts';
import {
  finalizeDraft, initialState, reduceKey, reduceTick, renderScreen,
  type AppData, type KeyEvent, type Screen,
} from './app';
import { safeText } from './safety';
import { paint as themePaint } from './theme';
import { truncateVisible, visibleLength } from './layout';

/**
 * Relay CLI interactive shell (Prompt 8.6) — the thin IO loop around the
 * pure reducer: raw-mode keyboard input, full-frame repaints, a playback/
 * animation timer (ticks advance the dog and — in demo mode — reveal the
 * next SCRIPTED fixture event; nothing is invented from elapsed time), and
 * guaranteed terminal restoration on every exit path including Ctrl+C and
 * thrown errors. No provider is ever invoked from this loop.
 */

export interface ShellOptions {
  caps: CliCaps;
  data: AppData;
  store: StateStore | null;
  /** Demo playback interval (ms); 0 disables playback. */
  playbackMs: number;
  now: () => string;
  /** Screen to open on (default 'home'), e.g. 'new-project' / 'console'. */
  initialScreen?: Screen;
  /** Project to pre-select (for `relay project open|terminal <ref>`). */
  selectedProjectId?: string | null;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export function parseKeys(chunk: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === '\x03') { events.push({ name: 'ctrl-c' }); i += 1; continue; }
    if (ch === '\r' || ch === '\n') { events.push({ name: 'enter' }); i += 1; continue; }
    if (ch === '\x7f' || ch === '\b') { events.push({ name: 'backspace' }); i += 1; continue; }
    if (ch === '\t') { events.push({ name: 'tab' }); i += 1; continue; }
    if (ch === '\x1b') {
      const next = chunk[i + 1];
      // CSI: ESC [ <params/intermediates 0x20-0x3f> <final 0x40-0x7e>. Only
      // arrows + shift-Tab produce events; every other sequence (Home/End/
      // Delete/PgUp/F-keys/left/right) is SWALLOWED so its bytes never leak
      // out as a spurious Escape plus printable hotkeys.
      if (next === '[') {
        let j = i + 2;
        while (j < chunk.length && chunk[j] >= '\x20' && chunk[j] <= '\x3f') j += 1;
        if (j < chunk.length && chunk[j] >= '\x40' && chunk[j] <= '\x7e') {
          const seq = chunk.slice(i, j + 1);
          if (seq === '\x1b[A') events.push({ name: 'up' });
          else if (seq === '\x1b[B') events.push({ name: 'down' });
          else if (seq === '\x1b[Z') events.push({ name: 'tab' });
          // Scroll/navigation keys (mapped so the founder can scroll a frame
          // that overflows the viewport). Every OTHER CSI (Delete `3~`, F-keys,
          // modified arrows, mouse reports) is still SWALLOWED so its bytes
          // never leak as spurious hotkeys.
          else if (seq === '\x1b[5~') events.push({ name: 'pageup' });
          else if (seq === '\x1b[6~') events.push({ name: 'pagedown' });
          else if (seq === '\x1b[H' || seq === '\x1b[1~' || seq === '\x1b[7~') events.push({ name: 'home' });
          else if (seq === '\x1b[F' || seq === '\x1b[4~' || seq === '\x1b[8~') events.push({ name: 'end' });
          i = j + 1; continue;
        }
        i = chunk.length; continue; // incomplete CSI split across chunks: drop the partial
      }
      // SS3: ESC O <final> (F1-F4, keypad) — map only Home/End; swallow the rest.
      if (next === 'O') {
        const seq = chunk.slice(i, i + 3);
        if (seq === '\x1bOH') events.push({ name: 'home' });
        else if (seq === '\x1bOF') events.push({ name: 'end' });
        i = i + 2 < chunk.length ? i + 3 : chunk.length; continue;
      }
      // A truly lone ESC (nothing else in the chunk) is the Escape key.
      if (next === undefined) { events.push({ name: 'escape' }); i += 1; continue; }
      // ESC + an unrelated byte: emit Escape and reprocess the following byte.
      events.push({ name: 'escape' }); i += 1; continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 32 && code < 127) {
      events.push({ name: ch.toLowerCase(), char: ch });
      i += 1; continue;
    }
    // Printable non-ASCII (accented, CJK, …) is a legitimate typed character;
    // combine surrogate pairs and skip C0/C1 control codes.
    if (code >= 0xa0) {
      let cp = ch;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < chunk.length) { cp = chunk.slice(i, i + 2); i += 1; }
      events.push({ name: cp.toLowerCase(), char: cp });
    }
    i += 1;
  }
  return events;
}

export async function runProductShell(options: ShellOptions): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const { caps } = options;
  // Process-level signal handlers are attached ONLY when we own the real
  // process streams; injected fake streams (tests/harness) never touch them.
  const ownsProcess = (options.stdin ?? process.stdin) === process.stdin;
  // We take over the screen (alternate buffer + hidden cursor + raw mode) ONLY
  // for a real interactive terminal; injected fake streams never do.
  const interactive = stdin.isTTY === true;
  let state = initialState(options.playbackMs > 0, {
    screen: options.initialScreen, selectedProjectId: options.selectedProjectId,
  });
  const data = options.data;
  let timer: NodeJS.Timeout | null = null;
  let rawEnabled = false;
  let altScreen = false;
  let restored = false;
  // The exact string of the last frame we wrote — a frame is only sent when it
  // actually differs, so an idle splash or a settled COMPLETE screen never
  // repaints (no flicker, no busy CPU). Reset on resize to force a full redraw.
  let lastRendered: string | null = null;
  let pendingFatal: string | null = null;
  // Viewport scrolling: when a rendered frame is taller than the terminal, we
  // show a window into it and let the founder scroll (arrows on the console,
  // PgUp/PgDn/Home/End everywhere). `follow` keeps the newest content in view
  // during playback; scrolling up releases it, End re-follows. When the frame
  // fits, scrolling is inert and nothing changes.
  let scrollOffset = 0;
  let follow = true;
  let prevScreen: Screen = state.screen;

  const viewportRows = (): number | undefined => {
    const r = (stdout as { rows?: number }).rows;
    return typeof r === 'number' && r > 6 ? Math.min(200, r) : undefined;
  };

  const scrollHint = (above: number, below: number): string => {
    const p = themePaint(caps);
    const a = above > 0 ? p.tone('gold', `${caps.unicode ? '▲' : '^'} ${above} above`) : p.dim('· top ·');
    const b = below > 0 ? p.tone('gold', `${caps.unicode ? '▼' : 'v'} ${below} below`) : p.dim('· end ·');
    const controls = caps.width >= 64
      ? p.dim(`${caps.unicode ? '↑↓' : 'up/dn'} · PgUp/PgDn · Home/End scroll${follow ? '' : ' · End follows'}`)
      : p.dim(`${caps.unicode ? '↑↓' : 'up/dn'} scroll`);
    const line = `${a}   ${controls}   ${b}`;
    return visibleLength(line) > caps.width - 1 ? truncateVisible(line, caps.width - 1, caps) : line;
  };

  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (timer) { clearInterval(timer); timer = null; }
    try {
      if (rawEnabled && stdin.isTTY) (stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(false);
    } catch { /* already restored */ }
    try { stdin.pause(); } catch { /* stream may be closed */ }
    // Exit cleanly and EXACTLY once: show cursor, reset SGR, and leave the
    // alternate screen (restoring the founder's original terminal + scrollback)
    // if we ever entered it. Never trap the user in raw mode or a blank screen.
    try { stdout.write(`\x1b[?25h\x1b[0m${altScreen ? '\x1b[?1049l' : '\n'}`); } catch { /* stream may be closed */ }
    // The fatal message is written as its own plain-text line AFTER we have
    // left the alternate screen, so it lands on the restored terminal and never
    // shares a write with an ANSI control sequence.
    if (pendingFatal !== null) {
      try { stdout.write(`\nRelay CLI error: ${pendingFatal}\n`); } catch { /* stream may be closed */ }
    }
  };

  /**
   * Paint one COMPLETE frame, assembled entirely in memory before a SINGLE
   * stdout write. Flicker-free full-screen redraw: home the cursor, rewrite
   * every line clearing to end-of-line (so a shorter line leaves no tail), then
   * clear everything below (so a shorter frame leaves no stale rows) — never a
   * whole-screen blank, which is what flashes. Skips the write entirely when
   * the frame is byte-identical to the last one, and never writes after
   * cleanup has begun.
   */
  const paint = (force = false): void => {
    if (restored) return;
    const full = renderScreen(state, data, caps);
    const rows = viewportRows();
    let out = full;
    if (rows !== undefined && full.length > rows) {
      // Frame overflows the terminal: show a window + a scroll hint line.
      const viewport = rows - 1; // reserve one row for the hint
      const maxScroll = full.length - viewport;
      if (follow) scrollOffset = maxScroll; // stick to the newest content
      scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));
      out = [...full.slice(scrollOffset, scrollOffset + viewport), scrollHint(scrollOffset, maxScroll - scrollOffset)];
    } else {
      // Frame fits — scrolling is inert; stay pinned so it re-follows if it grows.
      scrollOffset = 0; follow = true;
    }
    const rendered = out.join('\n');
    if (!force && rendered === lastRendered) return;
    lastRendered = rendered;
    const body = out.map((l) => `${l}\x1b[0m\x1b[K`).join('\n');
    try { stdout.write(`\x1b[H${body}\x1b[J`); } catch { /* stream may be closed */ }
  };

  /** Geometry of the current frame if (and only if) it overflows the viewport. */
  const scrollGeometry = (): { viewport: number; maxScroll: number } | null => {
    const rows = viewportRows();
    if (rows === undefined) return null;
    const total = renderScreen(state, data, caps).length;
    if (total <= rows) return null;
    const viewport = rows - 1;
    return { viewport, maxScroll: Math.max(0, total - viewport) };
  };

  /** Shell-owned view scrolling. Returns true when the key was a scroll action
   * (and so must NOT fall through to the mission reducer). Up/Down scroll only
   * on the console (elsewhere they drive selection); PgUp/PgDn/Home/End scroll
   * on any overflowing screen. No-op when the frame fits. */
  const handleScrollKey = (key: KeyEvent): boolean => {
    const geo = scrollGeometry();
    if (!geo) return false;
    const upDown = state.screen === 'console';
    switch (key.name) {
      case 'pageup': scrollOffset = Math.max(0, scrollOffset - geo.viewport); follow = false; return true;
      case 'pagedown': scrollOffset = Math.min(geo.maxScroll, scrollOffset + geo.viewport); follow = scrollOffset >= geo.maxScroll; return true;
      case 'home': scrollOffset = 0; follow = false; return true;
      case 'end': scrollOffset = geo.maxScroll; follow = true; return true;
      case 'up': if (!upDown) return false; scrollOffset = Math.max(0, scrollOffset - 1); follow = false; return true;
      case 'down': if (!upDown) return false; scrollOffset = Math.min(geo.maxScroll, scrollOffset + 1); follow = scrollOffset >= geo.maxScroll; return true;
      default: return false;
    }
  };

  return new Promise<number>((resolve) => {
    let settled = false;
    // The signal/fatal handlers must exist before `finish` can detach them.
    const onSignal = (): void => finish(130);
    const onFatal = (err: unknown): void => {
      // Even the fatal path passes the single safe-rendering gate: an exception
      // message may carry paths, control bytes, or injected terminal sequences
      // and must never reach the terminal raw. It is queued and flushed by
      // restore() after we have left the alternate screen (so it is visible).
      // safeText strips control bytes + redacts secret/UUID/email shapes; here
      // we additionally collapse any absolute path to `…/<basename>` so an fs
      // error can never leak a home directory or username.
      if (pendingFatal === null) {
        pendingFatal = safeText((err as Error)?.message ?? err, { maxLength: 300 })
          .replace(/(?:\/[\w.@-]+){2,}\/?/g, (m) => `…/${m.replace(/\/$/, '').split('/').pop() ?? ''}`);
      }
      finish(1);
    };
    const onResize = (): void => {
      if (restored || !stdout.columns) return;
      caps.width = Math.max(40, Math.min(200, stdout.columns));
      // Geometry changed: blank once and force a full redraw so no wrapped
      // remnants of the old width survive.
      try { stdout.write('\x1b[2J'); } catch { /* stream may be closed */ }
      lastRendered = null;
      paint(true);
    };
    // A resize is a property of the OUTPUT stream, so the listener is attached
    // whenever stdout emits events (real or fake) — independent of whether we
    // own the process. Process-level signal handlers stay gated on ownership.
    const stdoutEvents = typeof (stdout as { on?: unknown }).on === 'function';
    const detach = (): void => {
      if (stdoutEvents) stdout.removeListener('resize', onResize);
      if (!ownsProcess) return;
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGHUP', onSignal);
      process.removeListener('uncaughtException', onFatal);
      process.removeListener('unhandledRejection', onFatal);
    };
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      detach();
      restore();
      resolve(code);
    };
    try {
      if (interactive) {
        (stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(true);
        rawEnabled = true;
        // Enter the alternate screen ONCE, hide the cursor, clear it once.
        stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
        altScreen = true;
      } else {
        stdout.write('\x1b[?25l'); // hide cursor even for a non-alt-screen render
      }
      stdin.resume();
      stdin.setEncoding('utf8');

      if (ownsProcess) {
        process.on('SIGTERM', onSignal);
        process.on('SIGHUP', onSignal);
        process.on('uncaughtException', onFatal);
        process.on('unhandledRejection', onFatal);
      }
      if (stdoutEvents) stdout.on('resize', onResize);

      stdin.on('data', (chunk: string) => {
        if (restored) return; // ignore any input queued after cleanup began
        try {
          for (const key of parseKeys(chunk)) {
            // View scrolling is handled by the shell and never reaches the
            // mission reducer, so a scroll can never change mission state.
            if (handleScrollKey(key)) { paint(); continue; }
            state = reduceKey(state, key, data);
            // A screen change starts fresh at the top and re-follows.
            if (state.screen !== prevScreen) { scrollOffset = 0; follow = true; prevScreen = state.screen; }
            if (state.message === '__SAVE_DRAFT__') {
              const draft = finalizeDraft(state.draft, options.now());
              const saved = options.store?.writeProjectRecord(draft.projectId, draft as unknown as Record<string, unknown>);
              const persisted = saved === undefined ? false : saved.ok;
              data.projects = [draft, ...data.projects.filter((p) => p.projectId !== draft.projectId)];
              state = {
                ...state, screen: 'home', previous: 'home', draft: {}, draftIndex: 0, draftReview: false,
                typed: '', savedDraft: draft,
                message: persisted
                  ? `Draft "${draft.name}" saved durably. No mission started; no provider called.`
                  : `Draft "${draft.name}" kept for this session.`,
              };
            }
            if (state.quit) { paint(); finish(0); return; }
          }
          // Every physical keypress produces at most one action + one repaint;
          // if the key changed nothing visible, paint() no-ops.
          paint();
        } catch (err) { onFatal(err); }
      });
      stdin.on('error', onFatal);
      stdin.on('end', () => finish(0));

      // The SINGLE playback/animation timer. reduceTick advances the fixture
      // ONLY while playing; we repaint only when a fixture event was revealed
      // or an animation is actually running (playing, motion allowed). On the
      // idle splash, while paused, and after the mission settles at COMPLETE the
      // timer therefore paints nothing — no flicker, no busy CPU. Frame-diffing
      // in paint() is the final guard against any redundant write.
      timer = setInterval(() => {
        if (restored) return;
        // Freeze COMPLETELY when not playing: no tick advance (so an interactive
        // repaint while paused shows the dog exactly where it stopped — pause
        // truly freezes), and no paint. Idle splash, paused, and settled-COMPLETE
        // all leave the timer doing nothing.
        if (!state.playing) return;
        try {
          const stepped = reduceTick(state, data);
          state = stepped.state;
          if (stepped.revealed || !caps.reducedMotion) paint();
        } catch (err) { onFatal(err); }
      }, Math.max(200, options.playbackMs || 600));

      paint(true); // first frame
    } catch (err) {
      onFatal(err);
    }
  });
}
