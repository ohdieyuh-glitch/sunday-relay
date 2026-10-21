/**
 * SUNDAY RELAY — CLI LOOP COMMANDS.
 *
 * The terminal half of ONE grammar. This file does no parsing of its own: it
 * turns argv into the same slash string a browser composer would produce, hands
 * it to `parseSlashCommand`, and prints the same `projectLoopCommandPreview`
 * the website renders. So `relay loop coder "fix it"` and `/loop coder fix it`
 * cannot come to mean different things — not because two implementations were
 * kept in step, but because there is only one.
 *
 * IT SPENDS NOTHING. A CLI Loop command parses, resolves against whatever the
 * caller knows, and prints a preview. Compiling and STARTING a Loop is a
 * separate, confirmed step and is deliberately not reachable from here.
 *
 * READS AND CONTROLS OF A NAMED RUN GO ELSEWHERE. `loop-run-cli.ts` routes
 * those to the bridge, because a user asking `status lpr_x` wants to know what
 * a run is DOING and a preview answers a different question. This module keeps
 * the drafting half, unchanged and still free of I/O.
 *
 * The CLI stays a thin client: this module imports only `../mission` (the
 * barrel the boundary test permits) and formats what comes back.
 */

import {
  ALL_LOOP_FEATURES_DISABLED,
  DEFAULT_LOOP_LIMITS,
  evaluateLoopAvailability,
  parseSlashCommand,
  projectLoopCommandPreview,
  renderLoopPreviewLines,
  resolveLoopTarget,
  type RelayAgentRegistrySnapshot,
  type RelayLoopFeatureFlags,
  type RelayLoopTarget,
  type RelayParsedSlashCommand,
} from '../mission';

/**
 * Rebuild the canonical slash string from argv.
 *
 * Quoting is the one thing that needs care: a shell has already removed the
 * quotes the user typed, so an objective arriving as several argv entries is
 * re-joined and, when it contains internal runs of spaces worth keeping, is
 * re-quoted so the parser's verbatim-quoted path applies. Everything else is a
 * plain join — the grammar is the same either way.
 */
export function slashCommandFromArgv(positionals: readonly string[]): string {
  const [command, ...rest] = positionals;
  if (command === undefined) return '/loop';
  // A literal slash command passed through as one argument is already
  // canonical: `relay "/loop all fix it"`.
  if (command.startsWith('/')) return [command, ...rest].join(' ').trim();
  const parts = rest.map((part) => (/\s{2,}/.test(part) ? `"${part}"` : part));
  return `/${command}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`.trim();
}

export interface LoopCliInput {
  /** argv positionals AFTER the `relay` binary name. */
  readonly positionals: readonly string[];
  /** Feature flags the caller observed. Absent means every feature is off. */
  readonly flags?: RelayLoopFeatureFlags;
  /** Registry observation, when the caller has one. `undefined` renders as
   *  Unknown rather than as an empty agent list. */
  readonly registry?: RelayAgentRegistrySnapshot;
  readonly observedAt: string;
}

export interface LoopCliResult {
  readonly lines: readonly string[];
  /** Non-zero when the command could not be understood. A BLOCKED command is
   *  understood perfectly well and exits zero — it simply cannot run yet. */
  readonly invalid: boolean;
  /** The parsed command, for callers that need it (tests, future runtime). */
  readonly parsed: RelayParsedSlashCommand | null;
}

/**
 * Run a CLI Loop command and return what to print.
 *
 * Returns lines rather than writing them, so the same function is testable
 * without capturing stdout and so a caller can wrap it in any presentation.
 */
export function runLoopCli(input: LoopCliInput): LoopCliResult {
  const slash = slashCommandFromArgv(input.positionals);
  const result = parseSlashCommand(slash);

  if (!result.ok) {
    const lines = [`Could not read that command: ${result.error.message}`];
    for (const detail of result.error.details ?? []) lines.push(`  ${detail}`);
    lines.push('', 'Try `relay loop help` for the full grammar.');
    return { lines, invalid: true, parsed: null };
  }

  const parsed = result.value;
  const command = parsed.command;

  const availability = evaluateLoopAvailability({
    command,
    flags: input.flags ?? ALL_LOOP_FEATURES_DISABLED,
    // Unchain does not exist in this build. Passing `null` is the truthful
    // value, and it is the ONLY value this surface can pass — a CLI cannot
    // mint a session, and neither can anything else client-side.
    unchain: null,
    assignableRoles: input.registry?.eligibleRoles ?? [],
    observedAt: input.observedAt,
  });

  let target: RelayLoopTarget | null = null;
  if (input.registry !== undefined) {
    if (command.kind === 'loop_create' || command.kind === 'sloop_create') {
      target = resolveLoopTarget(command.target, input.registry);
    } else if (command.kind === 'loop_schedule_create' || command.kind === 'loop_cron_create') {
      target = resolveLoopTarget(command.target, input.registry);
    }
  }

  const preview = projectLoopCommandPreview({
    parsed,
    availability,
    target,
    limits: DEFAULT_LOOP_LIMITS,
    independentReviewRequired: true,
  });

  return { lines: renderLoopPreviewLines(preview), invalid: false, parsed };
}

/** The grammar, as `relay loop help` prints it. One source for both surfaces'
 *  help text would be better still; that arrives with the composer. */
export const LOOP_CLI_HELP: readonly string[] = [
  'Relay Loops — persistent compound-agent work.',
  '',
  '  relay loop                          open the Loop Composer',
  '  relay loop <objective>              draft a Loop for your active compound agent',
  '  relay loop all <objective>          draft a Loop for every eligible agent',
  '  relay loop team <objective>         alias of `all`',
  '  relay loop architect <objective>    draft a Prompt Architect Loop',
  '  relay loop coding <objective>       draft a Coding Agent Loop',
  '  relay loop reviewer <objective>     draft an independent Reviewer Loop',
  '  relay loop architect,coding <o>     draft a multi-role Loop',
  '',
  '  relay loop status <run-id>          READ a live run from the server',
  '  relay loop inspect <run-id>         iterations, assignments, evidence, budget, blockers',
  '  relay loop history <loop-id>        prior runs of one Loop',
  '  relay loop pause|resume|stop <run-id> --authorize --idempotency-key <key>',
  '  relay loop templates                available Loop templates',
  '  relay loops                         the Loop catalog',
  '',
  'A command NAMING a run reaches the Relay Bridge. Without an id there is no',
  'local notion of "your current Loop", so it prints the grammar instead.',
  'Reading costs nothing and needs no authorization. Pausing, resuming and',
  'stopping change what a run does with money and with a workspace, so each',
  'needs --authorize AND an --idempotency-key you mint: reuse the SAME key when',
  'retrying, so a retry is never recorded as a second decision.',
  '',
  'Set RELAY_BRIDGE_URL and RELAY_BRIDGE_TOKEN to reach a bridge. The token is',
  'read from the environment only — never from argv, where the process table',
  'would carry it.',
  '',
  '  relay loop schedule                 open the Scheduled Loop Composer',
  '  relay loop schedule <when + what>   draft a recurring Loop',
  '  relay loop cron "<expr>" <o>        draft a Cron Loop from an expression',
  '  relay loop schedules                list scheduled Loops',
  '',
  '  relay sloop <objective>             draft a Swarm Loop (requires Unchain)',
  '  relay sloop status|inspect|converge|stop [id]',
  '',
  'Role aliases: architect | prompt-architect | planning · coding | coder | code |',
  'coding-agent · reviewer | review | harness | harness-reviewer.',
  '',
  'Nothing is spent because a command parsed. A Loop that requests execution',
  'shows a contract you must confirm first.',
];
