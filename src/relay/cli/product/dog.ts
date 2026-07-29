import type { CliCaps, DogStateVM } from './contracts';
import { MOVING_DOG_STATES } from './contracts';
import { breakpoint } from './layout';

/**
 * Relay Dog (Prompt 8.6) — the pixel mascot from the founder-approved
 * mockups: a FOUR-LEGGED, side-facing pixel dog (NOT an upright humanoid) —
 * a big boxy head with two ears, a dark visor band with two Sunday-gold
 * eyes, a gold collar, a long horizontal body, a raised tail, and four legs.
 *
 * 1. HEADER LOGO: a static half-block pixel dog beside the SUNDAY RELAY
 *    wordmark — LARGE at full width, SMALL at stacked/compact width, and a
 *    horizontal ASCII dog (never a humanoid) when Unicode/color is off.
 * 2. FOOTER DOG: the canonical dog STATE label plus a paw that WALKS along a
 *    track when — and only when — the canonical state is a moving state.
 *    Motion is a pure function of (state, tick); `--reduced-motion`, non-TTY,
 *    and plain modes render the static frame. The renderer never decides the
 *    dog state; it only chooses the safe visual for a given canonical state.
 */

/* --------------------------- header logo ----------------------------- */

/** Legend: W white body, G gray shadow, D dark outline, v dark visor,
 *  e gold eye, c gold collar, . blank. Facing LEFT. */
const LARGE_DOG = normalize([
  '..DD....DD..........', //  ears
  '..DWD..DWD..........',
  '.DDWWWWWWWDD.........', //  head top
  '.DWWWWWWWWWD......DD.', //  head ; tail tip
  '.DvveWvvWevvD....DWWD', //  visor band + gold eyes ; tail
  '.DWWWWWWWWWWD.DDDDWWD', //  head bottom ; back rises to tail
  'DDWWWWWWWWWWDDWWWWWWD', //  neck joins the body
  'DWWWWWWWWWWWWWWWWWWWD', //  body
  '.DccccWWWWWWWWWWWWWWD', //  gold collar + belly
  '..DDWWWWWWWWWWWWWWWWD', //  belly bottom
  '...WWG.WWG...WWG.WWG.', //  four legs
  '...WWG.WWG...WWG.WWG.',
  '...WWG.WWG...WWG.WWG.',
  '...DD..DD....DD..DD..', //  four feet
]);

const SMALL_DOG = normalize([
  '.DD...DD......', //  ears
  'DDWWWWWDD.....', //  head top
  'DWveevvWD..DD.', //  visor + gold eyes ; tail
  'DWWWWWWWDDDWWD', //  head bottom + back to tail
  'DWWWWWWWWWWWWD', //  body
  '.DccWWWWWWWWWD', //  gold collar + belly
  '..WWG.WWG.WWWD', //  legs + rear
  '..WWG.WWG.WWG.',
  '..DD..DD..DD..', //  feet
]);

/** A horizontal four-legged ASCII dog (never a humanoid) for no-Unicode or
 *  no-color terminals — the text label always accompanies it. */
const ASCII_DOG = [
  '   __',
  '  /o \\___',
  '  \\______\\',
  '   ||   ||',
];

const PIXEL_TONE: Record<string, string> = {
  W: '253', // white body
  G: '245', // gray shadow
  D: '236', // dark outline
  v: '238', // dark visor band
  e: '136', // Sunday gold eye
  c: '136', // Sunday gold collar
};

/** Pad every row to the widest so half-block pairing never misaligns. */
function normalize(rows: string[]): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.'));
}

/** Render two pixel rows into one text row using ▀ (fg = upper, bg = lower). */
function halfBlockRow(upper: string, lower: string): string {
  let out = '';
  for (let i = 0; i < upper.length; i += 1) {
    const up = upper[i];
    const low = lower[i] ?? '.';
    if (up === '.' && low === '.') { out += ' '; continue; }
    const fg = up === '.' ? '' : `\x1b[38;5;${PIXEL_TONE[up]}m`;
    const bg = low === '.' ? '' : `\x1b[48;5;${PIXEL_TONE[low]}m`;
    out += `${fg}${bg}${up === '.' ? ' ' : '▀'}\x1b[0m`;
  }
  return out;
}

/** The header dog: a colored half-block pixel dog (LARGE at full width, SMALL
 *  otherwise) or a horizontal ASCII dog when Unicode/color is unavailable. */
export function headerLogo(caps: CliCaps): string[] {
  if (!caps.color || !caps.unicode) return ASCII_DOG.slice();
  const grid = breakpoint(caps.width) === 'full' ? LARGE_DOG : SMALL_DOG;
  const blank = '.'.repeat(grid[0].length);
  const rows: string[] = [];
  for (let i = 0; i < grid.length; i += 2) {
    rows.push(` ${halfBlockRow(grid[i], grid[i + 1] ?? blank)}`);
  }
  return rows;
}

/* --------------------------- footer dog ------------------------------ */

// The walking mascot is a paw (unicode) / paw prints (ASCII) that trots along
// the track — clearly canine, never a face or humanoid. The RELAY DOG · <STATE>
// label always carries the canonical state for accessibility and no-color.
const DOG_FRAMES_UNICODE = ['🐾'];
const DOG_FRAMES_ASCII = ['oo'];

export interface FooterDog {
  /** The dog glyph positioned inside a fixed-width track. */
  track: string;
  /** Text state — always present, never color/glyph-only. */
  label: string;
  moving: boolean;
}

/** Pure frame function: (state, tick, trackWidth) → positioned dog. The dog
 * moves only for canonical moving states and only when motion is allowed. */
export function footerDog(input: {
  state: DogStateVM;
  tick: number;
  caps: CliCaps;
  trackWidth?: number;
}): FooterDog {
  const { state, caps } = input;
  const frames = caps.unicode ? DOG_FRAMES_UNICODE : DOG_FRAMES_ASCII;
  const moving = MOVING_DOG_STATES.includes(state) && !caps.reducedMotion && caps.tty;
  // Size the track by the WIDEST frame so no frame overruns at the bounce.
  const maxFrameLen = Math.max(...frames.map((f) => f.length));
  const trackWidth = Math.max(maxFrameLen + 2, input.trackWidth ?? 16);
  const span = trackWidth - maxFrameLen;
  let position = 0;
  let frame = frames[0];
  if (moving) {
    frame = frames[input.tick % frames.length];
    const cycle = input.tick % (span * 2);
    position = cycle < span ? cycle : span * 2 - cycle; // bounce
  }
  const track = ' '.repeat(position) + frame + ' '.repeat(Math.max(0, trackWidth - position - frame.length));
  return { track, label: `RELAY DOG · ${state}`, moving };
}
