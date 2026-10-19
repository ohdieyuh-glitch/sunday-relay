/**
 * SUNDAY RELAY — SLASH COMMAND AST.
 *
 * THE RULE THIS MODULE ENCODES, inherited verbatim from the Validated Mission
 * Command Protocol (`../commands/command-types.ts`):
 *
 *   a user command is a REQUEST for a state transition — never the transition
 *   itself.
 *
 * A parsed slash command is therefore INERT. It names an intent and a target;
 * it authorizes nothing. Everything that could cost money, mutate a workspace,
 * consume an entitlement or start a Mission happens downstream, after
 * authentication, workspace authorization, feature flags, role availability,
 * budget validation, permission checks, approval checks and Mission preflight.
 * `loop-command-parser.test.ts` proves the parser reaches none of them.
 *
 * WHY A SEPARATE AST RATHER THAN A `RelayMissionCommand`. The mission command
 * protocol interprets NATURAL LANGUAGE into typed state changes against an
 * EXISTING mission. A slash command is a different thing at a different time:
 * it is a grammar, it usually precedes any mission, and most of its verbs
 * (`templates`, `catalog`, `schedules`) request a VIEW rather than a
 * transition. Collapsing the two would force one of them to lie about what it
 * is. They meet later, at the point where a confirmed Loop Contract produces
 * real mission commands.
 *
 * PURE. Types and closed const arrays only.
 */

import type { RelayLoopTargetSelector } from './loop-roles';

/* ------------------------------------------------------------- families */

/** The two command families. `/loops` is a spelling of the loop family. */
export const RELAY_SLASH_FAMILIES = ['loop', 'sloop'] as const;
export type RelaySlashFamily = (typeof RELAY_SLASH_FAMILIES)[number];

/* -------------------------------------------------------------- actions */

/**
 * Verbs that operate on an EXISTING Loop or on the catalog. Closed set: a word
 * that is not here is either a target expression or the start of an objective,
 * and the parser decides which in that order.
 */
export const RELAY_LOOP_ACTIONS = [
  'status',
  'inspect',
  'pause',
  'resume',
  'stop',
  'history',
  'templates',
  'help',
] as const;
export type RelayLoopAction = (typeof RELAY_LOOP_ACTIONS)[number];

/**
 * Actions that address ONE Loop and therefore accept an optional Loop id.
 * `templates` and `help` do not — passing one would be meaningless, and
 * accepting it silently would teach a wrong mental model.
 */
export const RELAY_LOOP_ACTIONS_ACCEPTING_ID: readonly RelayLoopAction[] = [
  'status',
  'inspect',
  'pause',
  'resume',
  'stop',
  'history',
];

/** Swarm Loop verbs. `converge` is S-Loop-only — it requests early, safe
 *  convergence of branches, which a non-swarm Loop does not have. */
export const RELAY_SWARM_LOOP_ACTIONS = ['status', 'inspect', 'converge', 'stop', 'help'] as const;
export type RelaySwarmLoopAction = (typeof RELAY_SWARM_LOOP_ACTIONS)[number];

export const RELAY_SWARM_ACTIONS_ACCEPTING_ID: readonly RelaySwarmLoopAction[] = [
  'status',
  'inspect',
  'converge',
  'stop',
];

/** Schedule sub-verbs reachable today. The Cron RUNTIME lands in its own
 *  approved stage; the GRAMMAR is fixed now so that stage needs no parser
 *  redesign. */
export const RELAY_LOOP_SCHEDULE_VERBS = ['schedule', 'cron', 'schedules'] as const;
export type RelayLoopScheduleVerb = (typeof RELAY_LOOP_SCHEDULE_VERBS)[number];

/* --------------------------------------------------------- command kinds */

export const RELAY_SLASH_COMMAND_KINDS = [
  'loop_composer',
  'loop_create',
  'loop_action',
  'loop_catalog',
  'loop_schedule_composer',
  'loop_schedule_create',
  'loop_cron_create',
  'loop_schedule_list',
  'sloop_composer',
  'sloop_create',
  'sloop_action',
] as const;
export type RelaySlashCommandKind = (typeof RELAY_SLASH_COMMAND_KINDS)[number];

/* ------------------------------------------------------------- commands */

/** `/loop` — open the Loop Composer. Creates nothing. */
export interface RelayLoopComposerCommand {
  readonly kind: 'loop_composer';
}

/**
 * `/loop <objective>` · `/loop all <objective>` · `/loop architect,coding <o>`
 *
 * A REQUEST to compile a draft Loop Contract. The objective is preserved as
 * the user wrote it (see `loop-command-parser.ts` on quoting) because it is
 * the one field no normalization can improve and every downstream surface
 * quotes it back.
 */
export interface RelayLoopCreateCommand {
  readonly kind: 'loop_create';
  readonly target: RelayLoopTargetSelector;
  readonly objective: string;
}

/** `/loop status [loop-id]` and friends. */
export interface RelayLoopActionCommand {
  readonly kind: 'loop_action';
  readonly action: RelayLoopAction;
  /** `null` means "the caller's current Loop", resolved by the surface. */
  readonly loopId: string | null;
}

/** `/loops` — catalog, active Loops, scheduled Loops, templates, history. */
export interface RelayLoopCatalogCommand {
  readonly kind: 'loop_catalog';
}

/** `/loop schedule` — open the Scheduled Loop Composer. */
export interface RelayLoopScheduleComposerCommand {
  readonly kind: 'loop_schedule_composer';
}

/**
 * `/loop schedule <natural-language schedule and objective>`
 *
 * The remainder is NOT split into schedule and objective here. Separating
 * "every weekday at 8am" from "inspect the repository" requires schedule
 * parsing, which is a later approved stage; guessing the boundary now would
 * produce a confident wrong answer. The whole request is preserved verbatim
 * for that stage to interpret and for the confirmation preview to quote.
 */
export interface RelayLoopScheduleCreateCommand {
  readonly kind: 'loop_schedule_create';
  readonly target: RelayLoopTargetSelector;
  readonly scheduleRequest: string;
}

/** `/loop cron <expression> <objective>` — the advanced, explicit form. */
export interface RelayLoopCronCreateCommand {
  readonly kind: 'loop_cron_create';
  readonly target: RelayLoopTargetSelector;
  /** Preserved EXACTLY as written, single-space-joined when unquoted. Never
   *  reordered, never re-spaced internally, never semantically interpreted
   *  here — a cron expression is data, and this stage is a grammar. */
  readonly cronExpression: string;
  readonly objective: string;
}

/** `/loop schedules` — list scheduled, paused, active and failed Cron Loops. */
export interface RelayLoopScheduleListCommand {
  readonly kind: 'loop_schedule_list';
}

export type RelayLoopScheduleCommand =
  | RelayLoopScheduleComposerCommand
  | RelayLoopScheduleCreateCommand
  | RelayLoopCronCreateCommand
  | RelayLoopScheduleListCommand;

export type RelayLoopCommand =
  | RelayLoopComposerCommand
  | RelayLoopCreateCommand
  | RelayLoopActionCommand
  | RelayLoopCatalogCommand
  | RelayLoopScheduleCommand;

/* ---------------------------------------------------------- swarm loops */

/** `/sloop` — open the Swarm Loop Composer. Subject to the Unchain gate. */
export interface RelaySwarmLoopComposerCommand {
  readonly kind: 'sloop_composer';
}

/** `/sloop <objective>` — request a draft S-Loop Contract. */
export interface RelaySwarmLoopCreateCommand {
  readonly kind: 'sloop_create';
  readonly target: RelayLoopTargetSelector;
  readonly objective: string;
}

/** `/sloop status|inspect|converge|stop|help [loop-id]`. */
export interface RelaySwarmLoopActionCommand {
  readonly kind: 'sloop_action';
  readonly action: RelaySwarmLoopAction;
  readonly loopId: string | null;
}

export type RelaySwarmLoopCommand =
  | RelaySwarmLoopComposerCommand
  | RelaySwarmLoopCreateCommand
  | RelaySwarmLoopActionCommand;

export type RelaySlashCommand = RelayLoopCommand | RelaySwarmLoopCommand;

/* --------------------------------------------------------------- parsed */

/**
 * What the parser returns on success. `raw` is kept so a preview can show the
 * user exactly what Relay believes they typed, which is how a mis-parse gets
 * noticed BEFORE confirmation rather than after execution.
 */
export interface RelayParsedSlashCommand {
  readonly raw: string;
  readonly family: RelaySlashFamily;
  readonly command: RelaySlashCommand;
}

/* --------------------------------------------------------------- routing */

/**
 * Which interpreter should see this input.
 *
 * `slash` — leading `/`; the canonical grammar in this module owns it.
 * `natural_language` — everything else; the EXISTING deterministic mission
 *   command interpreter owns it, unchanged. Loop-first does not mean
 *   chat-removed, and this is the seam that keeps both true.
 */
export const RELAY_INPUT_ROUTES = ['slash', 'natural_language'] as const;
export type RelayInputRoute = (typeof RELAY_INPUT_ROUTES)[number];
