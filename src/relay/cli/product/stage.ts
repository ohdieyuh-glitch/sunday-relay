import { paint } from './theme';
import { safeText } from './safety';
import type { CliCaps } from './contracts';
import {
  layoutStage, stageCapacity, stageShapeFor, type RelayStageActor,
} from '../../shared/relay-stage-layout';
import {
  RELAY_BACKDROPS, projectBackdropChoices, resolveBackdrop,
} from '../../shared/relay-stage-backdrop';

/**
 * THE RELAY STAGE, ON THE CLI.
 *
 * The website draws the stage; a terminal cannot. What it CAN do — and what
 * parity actually requires — is answer the same questions from the same
 * projection: how much room is there, who is on it, which scene is selected,
 * and what the other choices are.
 *
 * This exists because the alternative was a registry entry claiming the CLI had
 * an equivalent of the backdrop picker when it had none. A parity gate that is
 * satisfied by a declaration rather than by a surface is measuring paperwork.
 *
 * It calls `layoutStage` and `projectBackdropChoices` — the SAME functions the
 * website calls. Neither surface computes a figure of its own, which is what
 * stops `relay project stage` and the workspace disagreeing about capacity.
 */

/** A terminal has columns, not pixels. This is the width the stage is asked about. */
const CLI_ASSUMED_VIEWPORT_PX = 1440;

export interface StageViewInput {
  readonly caps: CliCaps;
  /** The cast the host knows about. Empty is a real answer. */
  readonly actors: readonly RelayStageActor[];
  /**
   * The stored preference, which may name a scene this build does not have.
   *
   * THREE STATES, DELIBERATELY. A string is a preference that was read.
   * `null` means a reader ran and found nothing stored. `undefined` means THIS
   * SURFACE HAS NO READER — which is today's only case, because the browser
   * keeps this in its own local storage and `project.stageBackdrop` is a field
   * nothing sets. They print different sentences because they are different
   * facts, and collapsing them is how a surface starts asserting a reason it
   * cannot verify.
   */
  readonly selectedBackdrop?: string | null | undefined;
  readonly reducedMotion?: boolean;
}

export function renderStageView(input: StageViewInput): { lines: string[]; json: unknown } {
  const p = paint(input.caps);
  const shape = stageShapeFor(CLI_ASSUMED_VIEWPORT_PX);
  const layout = layoutStage({
    actors: input.actors,
    viewportWidthPx: CLI_ASSUMED_VIEWPORT_PX,
  });
  const resolved = resolveBackdrop(input.selectedBackdrop);
  const choices = projectBackdropChoices({
    selected: input.selectedBackdrop,
    reducedMotion: input.reducedMotion ?? false,
  });

  const lines: string[] = [
    `  ${p.dim('SHAPE'.padEnd(18))} ${p.tone('cream', `${shape.aspectRatio.toFixed(2)}:1, floor ${shape.minHeightRem}rem`)}`,
    `  ${p.dim('CAPACITY'.padEnd(18))} ${p.tone('cream', `${stageCapacity(shape)} dog-widths`)}`,
    `  ${p.dim('PLACED'.padEnd(18))} ${p.tone('cream', `${layout.requestedWidth} dog-widths`)}`,
    '',
  ];

  if (layout.emptyReason !== null) {
    // The stage says why it is empty rather than drawing a dog to fill it.
    lines.push(p.dim(layout.emptyReason), '');
  } else {
    for (const placement of layout.placements) {
      const depth = placement.order / 1000;
      lines.push(
        `  ${p.tone('cream', placement.id.padEnd(18))} `
        + p.dim(`layer ${placement.layer}, depth ${depth.toFixed(2)}, `)
        + p.dim(`${placement.leftPercent.toFixed(0)}% across`),
      );
    }
    lines.push('');
  }

  if (layout.overflowing) {
    lines.push(
      p.tone('amber', `  This stage has room for about ${layout.capacity} dog-widths, `
        + `and ${layout.requestedWidthLabel} were placed. Some are overlapping.`),
      '',
    );
  }

  /**
   * ABSENT IS UNKNOWN, NOT NONE.
   *
   * The browser stores the backdrop per BROWSER, in its own local storage, and
   * this surface has no reader for it — `project.stageBackdrop` exists on the
   * draft and nothing ever sets it. Printing `None` for that said the founder
   * had no scene selected when what is true is that this surface cannot see
   * their selection, and a founder who picked Jungle on the website was told
   * `None` here. A missing value is Unknown; it is never a default.
   */
  const noReader = input.selectedBackdrop === undefined;
  const readNothing = input.selectedBackdrop === null;
  const unreadable = noReader || readNothing;
  lines.push(`  ${p.dim('BACKDROP'.padEnd(18))} `
    + (noReader
      ? p.dim('Unknown — the website stores this per browser, and the CLI cannot read it')
      : readNothing
        ? p.dim('Unknown — nothing has been stored for this project')
        : p.tone(resolved.id === 'none' ? 'gray' : 'amber', resolved.label)));
  if (!unreadable && resolved.id === 'none' && input.selectedBackdrop !== 'none') {
    // A preference from an older build is a fact about that build, not an
    // instruction to show something else.
    lines.push(p.dim(`  "${safeText(input.selectedBackdrop as string, { maxLength: 40 })}" `
      + 'is not a scene this build has, so no scene is drawn.'));
  }
  lines.push('');

  for (const choice of choices) {
    // NOTHING IS TICKED WHEN NOTHING IS KNOWN. Marking None `[x]` two lines
    // under "the CLI cannot read it" made this surface contradict itself: the
    // header said the selection is unknown and the list asserted one.
    const marker = !unreadable && choice.selected
      ? p.tone('gold', '  [x] ')
      : p.dim('  [ ] ');
    lines.push(`${marker}${p.tone('cream', choice.label)}`);
    lines.push(`      ${p.dim(choice.description)}`);
    if (choice.animated) {
      lines.push(`      ${p.dim(choice.changesWithReducedMotion
        ? 'This scene moves. Your reduced-motion setting stills it.'
        : 'This scene moves.')}`);
    }
  }
  lines.push('', p.dim('  Scenery only. A backdrop changes nothing Relay reports and gates nothing.'));

  return {
    lines,
    json: {
      shape,
      capacity: layout.capacity,
      requestedWidth: layout.requestedWidth,
      overflowing: layout.overflowing,
      emptyReason: layout.emptyReason,
      placements: layout.placements,
      // `null`, NOT `'none'`, when this surface has no reader. A machine
      // consumer piping `--json` was told `backdrop: "none"` — a definite
      // claim — while the human-readable output beside it said Unknown.
      backdrop: unreadable ? null : resolved.id,
      backdropChoices: choices.map((c) => ({
        id: c.id, selected: !unreadable && c.selected, animated: c.animated,
        changesWithReducedMotion: c.changesWithReducedMotion,
      })),
      catalog: RELAY_BACKDROPS.map((entry) => entry.id),
    },
  };
}
