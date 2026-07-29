import type { CliCaps, DogStateVM } from './contracts';
import { breakpoint } from './layout';
import {
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_TERMINAL_TONE,
  OFFICIAL_RELAY_DOG_WIDTH,
  officialRelayDogGrid,
  type OfficialRelayDogPixel,
  type OfficialRelayDogPose,
} from './official-relay-dog-sprite';
import {
  officialRelayDogViewForState,
  type OfficialRelayDogActivity,
  type OfficialRelayDogMotion,
} from './official-relay-dog-states';

/**
 * THE OFFICIAL RELAY DOG in the terminal.
 *
 * Sunday Relay has ONE dog, and this module draws it: the compact FRONT-FACING
 * voxel companion with upright rectangular ears, a block head, a dark charcoal
 * visor band with two square amber eyes, a short squared muzzle, a compact
 * chest and short block legs, in bone/cream white with a shadow tone for the
 * dimensional surfaces.
 *
 * The art is NOT drawn here. Every pixel comes from the shared, byte-identical
 * `official-relay-dog-sprite` module — the same grids the website renders
 * through src/relay/ui/pixel-dog/RelayPixelDog.tsx — and every state meaning
 * comes from the shared `official-relay-dog-states` module, which mirrors the
 * website's Milestone 4.5 motion system. This file only decides how to paint
 * those pixels into a terminal.
 *
 * The retired dog (large, flat, horizontally stretched, SIDE-FACING, four long
 * legs, raised rectangular tail, oversized gold collar stripe) is GONE — from
 * the header, the footer, and the reduced-capability fallbacks alike. There is
 * no code path that can draw it.
 *
 * 1. HEADER: the official dog beside the SUNDAY RELAY wordmark, rendered with
 *    half-blocks so one sprite pixel is one square terminal pixel. ONE uniform
 *    scale factor drives both axes, so the body can never stretch. Terminals
 *    without color or Unicode get the SAME sprite, silhouette-folded to ASCII.
 * 2. FOOTER: the canonical dog STATE label plus a motion track. Motion is a
 *    pure function of (state, tick); `--reduced-motion`, non-TTY and plain
 *    modes render the static frame. The renderer never decides the dog state;
 *    it only chooses the safe visual for a given canonical state.
 */

/* ------------------------- pixel -> terminal ------------------------- */

/** One sprite pixel is one square terminal pixel: half-block rendering pairs
 *  two stacked sprite rows into a single text cell, so a pixel is 1 column
 *  wide and half a cell tall — square on a normal 1:2 terminal cell. */
export const OFFICIAL_DOG_SCALE = 1;
/** Rendered size at the uniform scale, in terminal cells. */
export const OFFICIAL_DOG_COLUMNS = OFFICIAL_RELAY_DOG_WIDTH * OFFICIAL_DOG_SCALE;
export const OFFICIAL_DOG_ROWS = (OFFICIAL_RELAY_DOG_HEIGHT * OFFICIAL_DOG_SCALE) / 2;

const RESET = '\x1b[0m';

function fg(pixel: OfficialRelayDogPixel): string {
  return `\x1b[38;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE[pixel]}m`;
}
function bg(pixel: OfficialRelayDogPixel): string {
  return `\x1b[48;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE[pixel]}m`;
}

const isPixel = (ch: string): ch is OfficialRelayDogPixel =>
  ch === 'w' || ch === 's' || ch === 'd' || ch === 'y' || ch === 'c';

/**
 * Render two sprite rows into one text row using ▀ (foreground paints the
 * upper pixel, background the lower). Empty pixels stay UNPAINTED — the sprite
 * keeps its transparency and never carries a background plate.
 */
function halfBlockRow(upper: string, lower: string): string {
  let out = '';
  for (let i = 0; i < upper.length; i += 1) {
    const up = upper[i] ?? '.';
    const low = lower[i] ?? '.';
    if (isPixel(up)) {
      out += isPixel(low) ? `${fg(up)}${bg(low)}▀${RESET}` : `${fg(up)}▀${RESET}`;
      continue;
    }
    // Only the lower pixel: paint it as the BACKGROUND of a space, so no
    // foreground glyph invents a pixel that the sprite does not have.
    if (isPixel(low)) { out += `${bg(low)} ${RESET}`; continue; }
    out += ' ';
  }
  return out;
}

/**
 * ASCII silhouette fold for terminals with no color or no Unicode. It is the
 * SAME official sprite at the SAME 18x14 proportions, folded two pixel rows to
 * a character exactly like the half-block path — so the front-facing head,
 * upright ears, visor band and amber eyes stay recognizable without a single
 * escape sequence. The retired side-profile ASCII dog is not a fallback and
 * does not exist.
 */
const ASCII_FOLD: Array<[(up: string, low: string) => boolean, string]> = [
  // Eyes read as eyes; the visor band reads as a solid bar.
  [(u, l) => u === 'y' || l === 'y', 'o'],
  [(u, l) => u === 'd' || l === 'd', '='],
  [(u, l) => u === 'c' || l === 'c', '+'],
  [(u, l) => isPixel(u) && isPixel(l), '#'],
  [(u) => isPixel(u), '"'],
  [(_u, l) => isPixel(l), '.'],
];

function asciiRow(upper: string, lower: string): string {
  let out = '';
  for (let i = 0; i < upper.length; i += 1) {
    const up = upper[i] ?? '.';
    const low = lower[i] ?? '.';
    const match = ASCII_FOLD.find(([test]) => test(up, low));
    out += match ? match[1] : ' ';
  }
  return out.replace(/\s+$/, '');
}

/** Paint any official pose into terminal rows. Pure: (pose, caps) -> lines. */
export function officialDogRows(pose: OfficialRelayDogPose, caps: CliCaps): string[] {
  const grid = officialRelayDogGrid(pose);
  const blank = '.'.repeat(OFFICIAL_RELAY_DOG_WIDTH);
  const rows: string[] = [];
  for (let i = 0; i < grid.length; i += 2) {
    const upper = grid[i] ?? blank;
    const lower = grid[i + 1] ?? blank;
    rows.push(caps.color && caps.unicode ? halfBlockRow(upper, lower) : asciiRow(upper, lower));
  }
  return rows;
}

/* --------------------------- header logo ----------------------------- */

/**
 * The header dog: the official sprite standing beside the wordmark. The same
 * sprite, the same uniform scale and the same proportions at every width —
 * desktop or mobile, color or not. Narrow (`linear`) layouts drop the logo
 * entirely in the renderer rather than showing a squeezed or redrawn dog.
 */
export function headerLogo(caps: CliCaps): string[] {
  const rows = officialDogRows('standing', caps);
  // A one-column gutter keeps the dog off the wordmark at every breakpoint.
  return rows.map((row) => ` ${row}`);
}

/** The header dog for a given canonical state — same sprite, state pose. Used
 *  where a screen wants the header dog to reflect what Relay is doing. */
export function headerLogoForState(state: DogStateVM, caps: CliCaps): string[] {
  const view = officialRelayDogViewForState(canonicalStateName(state));
  return officialDogRows(view.pose, caps).map((row) => ` ${row}`);
}

/* ---------------------------- state bridge ---------------------------- */

/**
 * The CLI's display vocabulary is the website's state vocabulary in uppercase
 * with spaces ('CARRYING HANDOFF' <-> 'carrying_handoff'). Translating here —
 * rather than keeping a second table of meanings — is what makes the two
 * surfaces provably the same product.
 */
export function canonicalStateName(state: DogStateVM): string {
  return state.toLowerCase().replace(/ /g, '_');
}

export function dogStateLabel(state: DogStateVM): string {
  return officialRelayDogViewForState(canonicalStateName(state)).label;
}

/* --------------------------- footer dog ------------------------------ */

/**
 * Terminal-native motion frames. Each one plays the MEANING the website
 * animates, at the same tick cadence — never a different meaning, and never
 * the retired dog.
 *
 *   patrol          walks the track left and right, turning at the boundaries
 *   carry           crosses the track carrying the handoff
 *   attention_jump  hops in place with an attention marker (WAITING FOR USER)
 *   work_scratch    stays put, front paws pawing at the work surface
 *   scan            stays put, sweeping
 *   still / halt    static frame
 */
const MARK_UNICODE = { grounded: '▄▄', raised: '▀▀' } as const;
const MARK_ASCII = { grounded: '^^', raised: '^^' } as const;
const SCRATCH_UNICODE = ['▚', '▞'] as const;
const SCRATCH_ASCII = ['/', '\\'] as const;
const SCAN_UNICODE = ['▘', '▝'] as const;
const SCAN_ASCII = ['-', '='] as const;

export interface FooterDog {
  /** The dog mark positioned inside a fixed-width track. */
  track: string;
  /** Text state — always present, never color/glyph-only. */
  label: string;
  moving: boolean;
  /** The canonical activity this state maps to (same word as the website). */
  activity: OfficialRelayDogActivity;
  /** The canonical motion meaning being played. */
  motion: OfficialRelayDogMotion;
  /** True when the state is asking a human to act. */
  attention: boolean;
  /** The official pose this state draws. */
  pose: OfficialRelayDogPose;
}

/**
 * Pure frame function: (state, tick, trackWidth) -> positioned dog. The dog
 * moves only for canonical travelling states, jumps only when the user is
 * being waited on, and scratches only while implementing — and only when
 * motion is allowed at all.
 */
export function footerDog(input: {
  state: DogStateVM;
  tick: number;
  caps: CliCaps;
  trackWidth?: number;
}): FooterDog {
  const { caps } = input;
  const view = officialRelayDogViewForState(canonicalStateName(input.state));
  const animated = !caps.reducedMotion && caps.tty && view.motion !== 'still' && view.motion !== 'halt';

  const mark = caps.unicode ? MARK_UNICODE : MARK_ASCII;
  const markWidth = mark.grounded.length;
  const trackWidth = Math.max(markWidth + 2, input.trackWidth ?? 16);
  const span = Math.max(1, trackWidth - markWidth);

  let position = 0;
  let glyph: string = mark.grounded;
  let suffix = '';

  if (animated) {
    if (view.travelling) {
      // Walk the track and turn at the boundaries — the terminal's patrol.
      const cycle = input.tick % (span * 2);
      position = cycle < span ? cycle : span * 2 - cycle;
    } else if (view.motion === 'attention_jump') {
      // Jump for attention: the mark lifts off the baseline every other tick.
      glyph = input.tick % 2 === 0 ? mark.grounded : mark.raised;
    } else if (view.motion === 'work_scratch') {
      // Up on its toes, pawing at the work surface in front of it.
      glyph = mark.raised;
      suffix = (caps.unicode ? SCRATCH_UNICODE : SCRATCH_ASCII)[input.tick % 2];
    } else if (view.motion === 'scan') {
      suffix = (caps.unicode ? SCAN_UNICODE : SCAN_ASCII)[input.tick % 2];
    }
  }

  // WAITING FOR USER always carries its urgency as TEXT as well, so it reads
  // the same under reduced motion, without color, and to a screen reader.
  if (view.attentionRequired) suffix = suffix || '!';

  const body = `${glyph}${suffix}`;
  const track =
    ' '.repeat(position) + body + ' '.repeat(Math.max(0, trackWidth - position - body.length));

  return {
    track,
    label: `RELAY DOG · ${view.label}`,
    moving: animated && view.travelling,
    activity: view.activity,
    motion: view.motion,
    attention: view.attentionRequired,
    pose: view.pose,
  };
}

/** Width the header reserves for the dog at a given breakpoint. Exposed so
 *  layout tests can prove the dog never overflows or overlaps the wordmark. */
export function headerLogoWidth(caps: CliCaps): number {
  return breakpoint(caps.width) === 'linear' ? 0 : OFFICIAL_DOG_COLUMNS + 1;
}
