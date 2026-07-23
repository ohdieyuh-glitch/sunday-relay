import type { CliCaps, EventSymbol, Tone } from './contracts';

/**
 * Relay CLI theme (Prompt 8.6) — the retro-futuristic terminal palette from
 * the founder-approved mockups: deep black background, warm cream text,
 * Sunday signal gold, green ONLY for verified/online, amber for waiting,
 * coral for blocking, muted cyan for the Reviewer. Color is enhancement
 * only — every symbol has a text equivalent and NO_COLOR/plain modes render
 * identical information.
 */

// Sunday gold is a restrained, aged-brass signal — NOT neon yellow. 178 (bright
// gold) read as a harsh lemon wash across every label; 136 is a dim amber-gold
// used for wordmark/eyes/collar/active accents, and goldDim (94, dark brass) is
// reserved for structural dividers, borders, and route/mode plates so the
// framework recedes and cream/gray text carries the hierarchy.
const CODES: Record<Tone, string> = {
  gold: '\x1b[38;5;136m',
  goldDim: '\x1b[38;5;94m',
  cream: '\x1b[38;5;230m',
  gray: '\x1b[38;5;245m',
  green: '\x1b[38;5;114m',
  amber: '\x1b[38;5;179m',
  coral: '\x1b[38;5;203m',
  cyan: '\x1b[38;5;110m',
};
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export interface Paint {
  tone(tone: Tone, text: string): string;
  bold(text: string): string;
  dim(text: string): string;
  boldTone(tone: Tone, text: string): string;
}

export function paint(caps: CliCaps): Paint {
  if (!caps.color) {
    const id = (text: string): string => text;
    return { tone: (_t, text) => text, bold: id, dim: id, boldTone: (_t, text) => text };
  }
  return {
    tone: (tone, text) => `${CODES[tone]}${text}${RESET}`,
    bold: (text) => `${BOLD}${text}${RESET}`,
    dim: (text) => `${DIM}${text}${RESET}`,
    boldTone: (tone, text) => `${BOLD}${CODES[tone]}${text}${RESET}`,
  };
}

/* --------------------------- symbols -------------------------------- */

/** Every glyph has an ASCII text equivalent (accessibility requirement). */
const SYMBOLS: Record<EventSymbol, { glyph: string; ascii: string; tone: Tone; label: string }> = {
  active: { glyph: '●', ascii: '*', tone: 'amber', label: 'ACTIVE' },
  event: { glyph: '■', ascii: '#', tone: 'gold', label: 'EVENT' },
  handoff: { glyph: '→', ascii: '->', tone: 'gold', label: 'HANDOFF' },
  verified: { glyph: '✓', ascii: 'OK', tone: 'green', label: 'VERIFIED' },
  review: { glyph: '≡', ascii: '=', tone: 'cyan', label: 'REVIEW' },
  action: { glyph: '!', ascii: '!', tone: 'amber', label: 'ACTION REQUIRED' },
  blocked: { glyph: '×', ascii: 'x', tone: 'coral', label: 'BLOCKED' },
};

export function symbolText(symbol: EventSymbol, caps: CliCaps): { text: string; tone: Tone; label: string } {
  const s = SYMBOLS[symbol];
  return { text: caps.unicode ? s.glyph : s.ascii, tone: s.tone, label: s.label };
}

export const GLYPHS = {
  vline: (caps: CliCaps): string => (caps.unicode ? '│' : '|'),
  hline: (caps: CliCaps): string => (caps.unicode ? '─' : '-'),
  tl: (caps: CliCaps): string => (caps.unicode ? '┌' : '+'),
  tr: (caps: CliCaps): string => (caps.unicode ? '┐' : '+'),
  bl: (caps: CliCaps): string => (caps.unicode ? '└' : '+'),
  br: (caps: CliCaps): string => (caps.unicode ? '┘' : '+'),
  teeL: (caps: CliCaps): string => (caps.unicode ? '├' : '+'),
  teeR: (caps: CliCaps): string => (caps.unicode ? '┤' : '+'),
  dotOn: (caps: CliCaps): string => (caps.unicode ? '●' : '*'),
  square: (caps: CliCaps): string => (caps.unicode ? '■' : '#'),
  paw: (caps: CliCaps): string => (caps.unicode ? '🐾' : ':paw:'),
  bars: (caps: CliCaps): string => (caps.unicode ? '▁▃▅' : '.:!'),
  prompt: (caps: CliCaps): string => (caps.unicode ? '❯' : '>'),
};

/** Capability detection. Width comes from the terminal (bounded 40..200);
 * NO_COLOR and non-TTY disable color; plain/json force linear-safe output. */
export function detectCaps(input: {
  argv: { 'no-color'?: boolean; plain?: boolean; json?: boolean; 'reduced-motion'?: boolean; compact?: boolean };
  env: Record<string, string | undefined>;
  isTTY: boolean;
  columns?: number;
}): CliCaps {
  const plain = input.argv.plain === true;
  const json = input.argv.json === true;
  const noColor = input.argv['no-color'] === true || input.env.NO_COLOR !== undefined || !input.isTTY || plain || json;
  const lang = `${input.env.LANG ?? ''}${input.env.LC_ALL ?? ''}${input.env.LC_CTYPE ?? ''}`;
  const unicode = !plain && (input.isTTY || /utf-?8/i.test(lang));
  // --compact forces the dense 60–79 column layout regardless of the real
  // terminal width (never widening past it), so the flag is not a no-op.
  const raw = Math.max(40, Math.min(200, input.columns ?? 80));
  const width = input.argv.compact === true ? Math.min(raw, 79) : raw;
  return {
    tty: input.isTTY,
    color: !noColor,
    unicode,
    width,
    reducedMotion: input.argv['reduced-motion'] === true || !input.isTTY || plain || json,
    plain,
    json,
  };
}
