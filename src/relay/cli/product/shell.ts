import type { StateStore } from '../../persistence';
import type { CliCaps } from './contracts';
import {
  finalizeDraft, initialState, reduceKey, reduceTick, renderScreen,
  type AppData, type KeyEvent, type Screen,
} from './app';

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
          i = j + 1; continue;
        }
        i = chunk.length; continue; // incomplete CSI split across chunks: drop the partial
      }
      // SS3: ESC O <final> (F1-F4, keypad) — swallowed like the CSI keys.
      if (next === 'O') { i = i + 2 < chunk.length ? i + 3 : chunk.length; continue; }
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
  let state = initialState(options.playbackMs > 0, {
    screen: options.initialScreen, selectedProjectId: options.selectedProjectId,
  });
  const data = options.data;
  let timer: NodeJS.Timeout | null = null;
  let rawEnabled = false;
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (timer) { clearInterval(timer); timer = null; }
    try {
      if (rawEnabled && stdin.isTTY) (stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(false);
    } catch { /* already restored */ }
    try { stdin.pause(); } catch { /* stream may be closed */ }
    try { stdout.write('\x1b[?25h\x1b[0m\n'); } catch { /* stream may be closed */ } // cursor back + reset — never trap the user
  };

  const frame = (): void => {
    const lines = renderScreen(state, data, caps);
    stdout.write(`\x1b[H\x1b[2J${lines.join('\n')}\n`);
  };

  return new Promise<number>((resolve) => {
    let settled = false;
    // The signal/fatal handlers must exist before `finish` can detach them.
    const onSignal = (): void => finish(130);
    const onFatal = (err: unknown): void => {
      try { stdout.write(`\nRelay CLI error: ${(err as Error)?.message ?? String(err)}\n`); } catch { /* ignore */ }
      finish(1);
    };
    const onResize = (): void => {
      if (stdout.columns) { caps.width = Math.max(40, Math.min(200, stdout.columns)); frame(); }
    };
    const detach = (): void => {
      if (!ownsProcess) return;
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGHUP', onSignal);
      process.removeListener('uncaughtException', onFatal);
      process.removeListener('unhandledRejection', onFatal);
      stdout.removeListener('resize', onResize);
    };
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      detach();
      restore();
      resolve(code);
    };
    try {
      if (stdin.isTTY) {
        (stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(true);
        rawEnabled = true;
      }
      stdin.resume();
      stdin.setEncoding('utf8');
      stdout.write('\x1b[?25l'); // hide cursor during frames

      if (ownsProcess) {
        process.on('SIGTERM', onSignal);
        process.on('SIGHUP', onSignal);
        process.on('uncaughtException', onFatal);
        process.on('unhandledRejection', onFatal);
        stdout.on('resize', onResize);
      }

      stdin.on('data', (chunk: string) => {
        try {
          for (const key of parseKeys(chunk)) {
            state = reduceKey(state, key, data);
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
            if (state.quit) { frame(); finish(0); return; }
          }
          frame();
        } catch (err) { onFatal(err); }
      });
      stdin.on('error', onFatal);
      stdin.on('end', () => finish(0));

      // The demo advances ONLY through the pure reduceTick: it animates the
      // status dots and, while playing, reveals fixture events at the current
      // speed. Reduced motion still reveals events but never animates dots.
      timer = setInterval(() => {
        try {
          const stepped = reduceTick(state, data);
          state = stepped.state;
          if (!caps.reducedMotion || stepped.revealed) frame();
        } catch (err) { onFatal(err); }
      }, Math.max(200, options.playbackMs || 600));

      frame();
    } catch (err) {
      onFatal(err);
    }
  });
}
