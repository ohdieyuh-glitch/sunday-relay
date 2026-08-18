/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (CLI renderer).
 *
 * READ-ONLY terminal presentation of the Coliseum duel domain: duel results,
 * the proof meter, and the command-binding table. The CLI and the website
 * render the SAME shared projection (`projectDuelResults`, imported through
 * the `../mission` barrel), so the two surfaces cannot disagree about who
 * fought, what was proven, or what remains unknown. Only the presentation
 * differs: the website styles it, this prints it.
 *
 * Truthfulness rules carried as code, not as discipline:
 * - `null` prints the word `Unknown` — never 0, never a dash posing as data.
 * - An UNVERIFIED proof entry scores 0 visibly; a claim is a CLAIM until an
 *   independent verifier confirmed it.
 * - An `unbound` command has no engine; the table says so and this renderer
 *   never fabricates a result for it.
 * - Every view rendered in this build is a DEVELOPMENT FIXTURE, and the
 *   disclosure is structural: the render functions REQUIRE the data source
 *   and print the banner before any figure, so a caller cannot drop it by
 *   forgetting a flag.
 * - "No duel" is stated as a fact, not padded with an invented example.
 */

import type {
  DuelCommandView,
  DuelParticipantResultView,
  DuelResultsView,
} from '../mission';
import {
  activeAutomationFightResults,
  challengedDuelResults,
  concludedManualDuelResults,
} from '../mission';

export interface ColiseumRenderOptions {
  /** Terminal width; the layout degrades gracefully when narrow. */
  width: number;
  plain: boolean;
}

/** Where the rendered view actually came from. There is no live source yet. */
export type ColiseumDataSource = 'development_fixture';

export const COLISEUM_FIXTURE_DISCLOSURE =
  'SIMULATED DATA — DEVELOPMENT FIXTURE — NOT LIVE DUEL DATA';

const NARROW = 60;

function line(label: string, value: string, options: ColiseumRenderOptions): string {
  if (options.width < NARROW) return `${label}:\n  ${value}`;
  const padding = Math.max(1, 24 - label.length);
  return `${label}${' '.repeat(padding)}${value}`;
}

function wrap(text: string, width: number, indent: string): string[] {
  const usable = Math.max(20, width - indent.length);
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= usable) {
      current = `${current} ${word}`;
    } else {
      out.push(`${indent}${current}`);
      current = word;
    }
  }
  if (current.length > 0) out.push(`${indent}${current}`);
  return out;
}

/** A number that may be Unknown, rendered truthfully. Unknown is not zero. */
export function formatMaybe(value: number | null): string {
  return value === null ? 'Unknown' : String(value);
}

/** A signed delta that may be Unknown. Penalties keep their minus sign. */
export function formatDelta(value: number | null): string {
  if (value === null) return 'Unknown';
  return value > 0 ? `+${value}` : String(value);
}

/**
 * THE DISCLOSURE, before any figure. Emitted by every render function in this
 * file from the REQUIRED `source` argument — the same rule the mission
 * economics renderer applies — so fixture duels can never be presented as a
 * real fight between real agents.
 */
function disclosureLines(
  source: ColiseumDataSource,
  options: ColiseumRenderOptions,
): string[] {
  const rule = '─'.repeat(
    Math.max(20, Math.min(options.width - 2, COLISEUM_FIXTURE_DISCLOSURE.length + 4)),
  );
  return [
    `  ${rule}`,
    ...wrap(COLISEUM_FIXTURE_DISCLOSURE, options.width, '  '),
    ...(source === 'development_fixture'
      ? wrap(
        'No duel ran, no sandbox was provisioned, no agent fought, and no XP was awarded. '
        + 'Relay has no live Coliseum data source configured in this build.',
        options.width,
        '  ',
      )
      : []),
    `  ${rule}`,
    '',
  ];
}

const STATUS_LABEL: Readonly<Record<DuelResultsView['status'], string>> = {
  challenged: 'Challenged',
  accepted: 'Accepted',
  provisioning: 'Provisioning',
  active: 'Active',
  concluded: 'Concluded',
  aborted: 'Aborted',
};

const MODE_LABEL: Readonly<Record<DuelResultsView['mode'], string>> = {
  manual: 'Manual duel',
  'automation-fight': 'Automation Fight',
};

/* --------------------------------------------------------------- sections */

/** PROOF METER — one participant. Unverified entries score 0, visibly. */
function proofMeterLines(
  participant: DuelParticipantResultView,
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push(`  ${participant.displayName} (${participant.kind})`);
  out.push(`  ${line('  Proof score', String(participant.proofScore), options)}`);
  out.push(`  ${line('  Bugs found (verified)', String(participant.bugsFound), options)}`);
  out.push(`  ${line('  Repairs accepted', String(participant.repairsAccepted), options)}`);
  out.push(`  ${line('  Regressions prevented', String(participant.regressionsPrevented), options)}`);
  out.push(`  ${line('  Evaluation quality', formatMaybe(participant.evaluationQuality), options)}`);
  out.push(`  ${line('  Reliability delta', formatDelta(participant.reliabilityDelta), options)}`);
  out.push(`  ${line('  Performance delta', formatDelta(participant.performanceDelta), options)}`);
  out.push(`  ${line('  XP earned', String(participant.xpEarned), options)}`);
  if (participant.opponentFixBonus > 0) {
    out.push(`  ${line('  Opponent-fix bonus', String(participant.opponentFixBonus), options)}`);
  }
  if (participant.rewards.length > 0) {
    out.push(`  ${line('  Rewards', participant.rewards.join(', '), options)}`);
  }
  if (participant.entries.length === 0) {
    out.push(...wrap(
      '· No proof entries submitted. This is not the same as nothing found.',
      options.width, '  ',
    ));
  }
  for (const entry of participant.entries) {
    // A CLAIM stays a claim until verified: unverified prints 0 points and
    // says why, so a self-report can never read as evidence.
    const state = entry.verified
      ? `${entry.points} pts (verified)`
      : '0 pts (UNVERIFIED CLAIM — not evidence)';
    out.push(...wrap(`· [${entry.category}] ${entry.summary} — ${state}`, options.width, '  '));
  }
  return out;
}

/** COMMAND BINDINGS — an unbound command truthfully has no engine. */
export function renderColiseumCommands(
  commands: readonly DuelCommandView[],
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('  COMMAND BINDINGS');
  for (const command of commands) {
    const state = command.binding === 'bound'
      ? 'bound'
      : 'UNBOUND — no engine; refuses rather than fabricates';
    out.push(`  ${line(`  /${command.name}`, state, options)}`);
    out.push(...wrap(command.description, options.width, '      '));
  }
  return out;
}

/* ------------------------------------------------------------ full render */

/** COLISEUM DUEL — results + proof meter + command table, disclosure first. */
export function renderColiseumDuel(
  view: DuelResultsView,
  source: ColiseumDataSource,
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('WONDERLAND COLISEUM — DUEL');
  out.push(`  duel ${view.duelId}`);
  out.push('');
  out.push(...disclosureLines(source, options));
  out.push(`  ${line('Status', STATUS_LABEL[view.status], options)}`);
  out.push(`  ${line('Mode', MODE_LABEL[view.mode], options)}`);

  // A missing winner stays missing. For an unfinished duel there is no winner
  // to report; for a concluded one, "none declared" is itself the fact.
  const winner = view.winnerParticipantId === null
    ? (view.status === 'concluded' || view.status === 'aborted'
      ? 'None declared'
      : 'Not decided — the duel has not concluded')
    : view.winnerParticipantId;
  out.push(`  ${line('Winner', winner, options)}`);

  out.push('');
  out.push('  PROOF METER');
  for (const participant of view.participants) {
    out.push('');
    out.push(...proofMeterLines(participant, options));
  }

  out.push('');
  out.push('  VERIFIED FIXES');
  if (view.verifiedFixes.length === 0) {
    out.push(...wrap('· No verified fixes recorded for this duel.', options.width, '  '));
  }
  for (const fix of view.verifiedFixes) {
    out.push(...wrap(
      `· ${fix.summary} → ${fix.targetParticipantId} (${fix.appliedState})`,
      options.width, '  ',
    ));
  }

  out.push('');
  out.push(...renderColiseumCommands(view.commands, options));
  return out;
}

/**
 * NO DUEL — the truthful empty state. Prints the fact and stops; it never
 * substitutes a fixture, an example, or an invented fight.
 */
export function renderColiseumNoDuel(options: ColiseumRenderOptions): string[] {
  return [
    'WONDERLAND COLISEUM',
    ...wrap(
      'No duel exists. No challenge has been created, no sandbox provisioned, and no '
      + 'agent has fought. There is nothing to score and nothing is shown in its place.',
      options.width, '  ',
    ),
  ];
}

/* ---------------------------------------------------------------- fixture */

/**
 * The deterministic development fixtures this CLI reads today — the SAME
 * scenarios the Coliseum domain fixtures define, derived through the real
 * shared projection so the CLI and the website render identical facts. A live
 * Coliseum source, when one exists, supplies real duels through the identical
 * shared core; none of the semantics change when it does.
 */
export function buildColiseumFixture(): {
  source: ColiseumDataSource;
  concluded: DuelResultsView;
  activeFight: DuelResultsView;
  challenged: DuelResultsView;
} {
  return {
    source: 'development_fixture',
    concluded: concludedManualDuelResults(),
    activeFight: activeAutomationFightResults(),
    challenged: challengedDuelResults(),
  };
}
