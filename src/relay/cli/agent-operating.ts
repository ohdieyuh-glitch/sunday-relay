/**
 * SUNDAY RELAY — CLI RENDERING OF THE AGENT OPERATING PROFILE.
 *
 * The CLI and the website render the SAME shared projection
 * (`projectAgentOperatingProfile`), so the two surfaces cannot disagree about
 * which runtime is performing the work, which Mission Contract governs it,
 * which environment it runs in, or which tools it was granted. Only the
 * presentation differs: the website styles these rows, this prints them.
 *
 * Nothing here formats a label of its own — every value comes out of the
 * projection already worded. Nothing here calls a provider, reads a
 * credential, or prints a secret.
 */

import type { RelayAgentOperatingProjection } from '../mission';

export interface OperatingRenderOptions {
  /** Terminal width; the layout degrades gracefully when narrow. */
  width: number;
  plain: boolean;
}

const NARROW = 60;

/** Wraps to the terminal width, so a long tool list never overruns. */
function wrap(text: string, width: number, indent: string): string[] {
  const limit = Math.max(20, width - indent.length);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (`${line} ${word}`.length <= limit) line += ` ${word}`;
    else { lines.push(`${indent}${line}`); line = word; }
  }
  if (line !== '') lines.push(`${indent}${line}`);
  return lines.length === 0 ? [`${indent}${text}`] : lines;
}

/**
 * SIMULATED-DATA DISCLOSURE.
 *
 * Emitted from the PROJECTION's own `dataSourceLabel`, which is derived from
 * the runtime's execution mode — so it cannot be dropped by a caller that
 * forgets a flag, and simulated runtime, environment or tool activity is never
 * printed as live.
 */
function disclosureLines(
  projection: RelayAgentOperatingProjection,
  options: OperatingRenderOptions,
): string[] {
  if (projection.dataSourceLabel === null) return [];
  // PLAIN MEANS ASCII. A box-drawing rule is not plain output, and a terminal
  // that asked for plain asked for a reason.
  const glyph = options.plain ? '-' : '─';
  const rule = glyph.repeat(Math.max(20, Math.min(options.width - 2, projection.dataSourceLabel.length + 4)));
  return [
    `  ${rule}`,
    ...wrap(projection.dataSourceLabel, options.width, '  '),
    ...wrap(
      'No agent ran and no runtime is attached. Relay has no live agent runtime configured in this build.',
      options.width,
      '  ',
    ),
    `  ${rule}`,
  ];
}

/**
 * THE FOUR ROWS — Runtime, Mission Contract, Environment, Tools.
 *
 * Iterated from `projection.rows`, so the CLI cannot print three of them, put
 * them in a different order, or invent a fifth. That array is the shared
 * rendering contract both surfaces are held to.
 */
export function renderAgentOperatingProfile(
  projection: RelayAgentOperatingProjection,
  options: OperatingRenderOptions,
): string[] {
  const out: string[] = [];
  out.push(`AGENT ${options.plain ? '-' : '—'} ${projection.roleLabel.toUpperCase()}`);
  out.push(...disclosureLines(projection, options));

  const narrow = options.width < NARROW;
  const width = Math.max(...projection.rows.map((row) => row.label.length));

  for (const row of projection.rows) {
    if (narrow) {
      // Below sixty columns the two-column form cannot hold, so each row
      // becomes a labelled block rather than a truncated line.
      out.push(`  ${row.label}`);
      out.push(...wrap(row.value, options.width, '    '));
      continue;
    }
    const label = row.label.padEnd(width, ' ');
    const [first, ...rest] = wrap(row.value, options.width - width - 4, '');
    out.push(`  ${label}  ${first ?? ''}`.trimEnd());
    for (const line of rest) out.push(`  ${' '.repeat(width)}  ${line}`);
  }
  return out;
}

/** Every agent's profile, in canonical role order. */
export function renderAgentOperatingProfiles(
  projections: readonly RelayAgentOperatingProjection[],
  options: OperatingRenderOptions,
): string[] {
  const out: string[] = [];
  for (const [index, projection] of projections.entries()) {
    if (index > 0) out.push('');
    out.push(...renderAgentOperatingProfile(projection, options));
  }
  return out;
}
