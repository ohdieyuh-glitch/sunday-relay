import type { Breakpoint, CliCaps } from './contracts';
import { GLYPHS, paint } from './theme';

/**
 * Relay CLI layout primitives (Prompt 8.6). Width-aware helpers: ANSI-aware
 * visible-length math, right alignment, thin gold dividers, sharp terminal
 * panels, breakpoint projection. Renderers use ONLY these primitives so
 * every screen degrades deterministically at 120+/80–119/60–79/<60 columns.
 */

// eslint-disable-next-line no-control-regex
const ANSI_OUT_RE = /\x1b\[[0-9;]*m/g;

/** Terminal column width of a single code point (wcwidth-lite): 0 for
 * combining/zero-width marks, 2 for East Asian Wide/Fullwidth + emoji, else 1.
 * Free-text (project names, event text) is real user input, so the width
 * guarantee must hold for CJK/Kana/Hangul, not just the CLI's own ASCII. */
function charWidth(code: number): number {
  if (
    (code >= 0x0300 && code <= 0x036f) || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff) || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe20 && code <= 0xfe2f) || code === 0x200b || code === 0xfeff
  ) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0x303e) || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x1f000
  ) return 2;
  return 1;
}

export function visibleLength(text: string): number {
  let length = 0;
  for (const ch of text.replace(ANSI_OUT_RE, '')) {
    length += charWidth(ch.codePointAt(0) ?? 0);
  }
  return length;
}

export function breakpoint(width: number): Breakpoint {
  if (width >= 120) return 'full';
  if (width >= 80) return 'stacked';
  if (width >= 60) return 'compact';
  return 'linear';
}

/** Truncate to a visible width with an explicit ellipsis (never silently). */
export function truncateVisible(text: string, max: number, caps: CliCaps): string {
  if (visibleLength(text) <= max) return text;
  const ellipsis = caps.unicode ? '…' : '...';
  const budget = Math.max(1, max - visibleLength(ellipsis));
  let out = '';
  let used = 0;
  for (const ch of text.replace(ANSI_OUT_RE, '')) {
    const w = visibleLength(ch);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out + ellipsis;
}

export function padVisible(text: string, width: number): string {
  const pad = width - visibleLength(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

/** Left text + right text on one line at the given width. */
export function spread(left: string, right: string, width: number): string {
  const gap = width - visibleLength(left) - visibleLength(right);
  if (gap < 1) return `${left} ${right}`;
  return `${left}${' '.repeat(gap)}${right}`;
}

const ASCII_FOLD: Array<[RegExp, string]> = [
  [/…/g, '...'], [/·/g, '.'], [/→/g, '->'], [/✓/g, 'OK'], [/●/g, '*'], [/■/g, '#'],
  [/≡/g, '='], [/×/g, 'x'], [/│/g, '|'], [/─/g, '-'], [/[┌┐└┘├┤]/g, '+'], [/[▸❯]/g, '>'],
  [/🐾/g, ':paw:'], [/ᴥ/g, '.'], [/°/g, 'o'], [/ʼ/g, "'"], [/[▀█]/g, '#'], [/[▁▃▅]/g, '.'],
];

/** Fold any remaining non-ASCII presentation glyphs when the terminal has
 * no Unicode support (content still carries its text equivalents). */
export function asciiFold(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ASCII_FOLD) out = out.replace(pattern, replacement);
  // Any straggler outside printable ASCII becomes '?': plain mode must be
  // strictly pipe-safe.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x0a\x20-\x7e]/g, '?');
}

/** Final width pass: no rendered line may exceed the terminal width. */
export function fitLines(lines: string[], caps: CliCaps, width?: number): string[] {
  const max = width ?? caps.width;
  const folded = caps.unicode ? lines : lines.map(asciiFold);
  return folded.map((line) => (visibleLength(line) > max ? truncateVisible(line, max, caps) : line));
}

/** Thin structural divider in dim brass — a quiet rule, not a bright band. */
export function divider(caps: CliCaps, width: number): string {
  return paint(caps).tone('goldDim', GLYPHS.hline(caps).repeat(Math.max(4, width)));
}

/** Sharp terminal panel: top border with an embedded title, body lines with
 * side rails, bottom border. Body lines are padded/truncated to fit. */
export function panelBox(input: {
  caps: CliCaps;
  width: number;
  top?: string;        // pre-styled title line content (without borders)
  body: string[];
  bottom?: string;
}): string[] {
  const { caps, width } = input;
  const p = paint(caps);
  const h = GLYPHS.hline(caps);
  const v = p.tone('goldDim', GLYPHS.vline(caps));
  const inner = Math.max(10, width - 4);
  const lines: string[] = [];
  const topContent = input.top ?? '';
  const topFill = Math.max(0, width - 4 - visibleLength(topContent) - (topContent ? 2 : 0));
  lines.push(p.tone('goldDim', GLYPHS.tl(caps) + h) + (topContent ? ` ${topContent} ` : h.repeat(2))
    + p.tone('goldDim', h.repeat(topFill) + GLYPHS.tr(caps)));
  for (const raw of input.body) {
    const line = visibleLength(raw) > inner ? truncateVisible(raw, inner, caps) : raw;
    lines.push(`${v} ${padVisible(line, inner)} ${v}`);
  }
  if (input.bottom !== undefined) {
    const bottomFill = Math.max(0, width - 4 - visibleLength(input.bottom) - (input.bottom ? 2 : 0));
    lines.push(p.tone('goldDim', GLYPHS.bl(caps) + h) + (input.bottom ? ` ${input.bottom} ` : h.repeat(2))
      + p.tone('goldDim', h.repeat(bottomFill) + GLYPHS.br(caps)));
  } else {
    lines.push(p.tone('goldDim', GLYPHS.bl(caps) + h.repeat(Math.max(2, width - 2)) + GLYPHS.br(caps)));
  }
  return lines;
}
