/**
 * SUNDAY RELAY — THE CANONICAL SLASH COMMAND PARSER.
 *
 * ONE PARSER. The website composer, the CLI, future mobile surfaces, help
 * output and every test call THIS function. There is deliberately no second
 * implementation: `/loop coder fix it` and `relay loop coder "fix it"` must
 * normalize to the identical command object, and the only way to guarantee
 * that is for there to be one place where the meaning is decided.
 *
 * PARSING IS NOT EXECUTION. This module has no filesystem, network, provider,
 * clock, journal or registry access. It consumes no entitlement, starts no
 * Mission and spends nothing. A successfully parsed command is a REQUEST that
 * must still pass authentication, workspace authorization, feature flags,
 * role availability, budget validation, permission checks, approval checks and
 * Mission preflight before anything happens. `loop-command-parser.test.ts`
 * proves the absence of every one of those capabilities structurally.
 *
 * HOW AMBIGUITY IS RESOLVED — the whole grammar in four ordered rules, applied
 * to the first token after the command word:
 *
 *   1. a SCHEDULE VERB (`schedule`, `cron`, `schedules`)  → scheduling
 *   2. an ACTION verb  (`status`, `pause`, `help`, …)     → act on a Loop
 *   3. a TARGET expression (`all`, `architect,coding`)    → target + objective
 *   4. anything else                                       → objective, default target
 *
 * The order matters and is fixed. Rules 1 and 2 are closed word sets, so they
 * can never grow by accident. Rule 3 requires EVERY comma-separated entry to
 * be a known role word, which is what keeps `/loop refactor,cleanup the
 * parser` an objective while `/loop code,review the parser` is a target — and
 * makes neither a guess.
 *
 * WHAT IT REFUSES TO GUESS. `/loop schedule every weekday at 8am inspect the
 * repo` is NOT split into a schedule and an objective here. Finding that
 * boundary needs real schedule parsing, which is a later approved stage.
 * Preserving the request verbatim is truthful; splitting it confidently would
 * not be.
 */

import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import { PREFIXES } from '../../protocol/ids';
import {
  RELAY_LOOP_ACTIONS,
  RELAY_LOOP_ACTIONS_ACCEPTING_ID,
  RELAY_LOOP_SCHEDULE_VERBS,
  RELAY_SWARM_ACTIONS_ACCEPTING_ID,
  RELAY_SWARM_LOOP_ACTIONS,
  type RelayInputRoute,
  type RelayLoopAction,
  type RelayParsedSlashCommand,
  type RelaySlashCommand,
  type RelaySwarmLoopAction,
} from './loop-command-types';
import {
  DEFAULT_LOOP_TARGET,
  RELAY_LOOP_ROLE_WORDS,
  looksLikeTargetExpression,
  parseRoleExpression,
  type RelayLoopTargetSelector,
  type RoleExpressionProblem,
} from './loop-roles';

/* --------------------------------------------------------------- routing */

/**
 * Does this input belong to the slash grammar?
 *
 * A leading slash is REQUIRED and is the only signal. Leading whitespace is
 * tolerated because a composer text field collects it; nothing else is. In
 * particular a bare `loop do the thing` is natural language and stays with the
 * existing deterministic mission command interpreter — loop-first does not
 * mean chat-removed.
 */
export function isSlashCommandInput(input: string): boolean {
  return typeof input === 'string' && input.trimStart().startsWith('/');
}

/** Which interpreter owns this input. The one seam between the two paths. */
export function routeRelayInput(input: string): RelayInputRoute {
  return isSlashCommandInput(input) ? 'slash' : 'natural_language';
}

/* ------------------------------------------------------------ primitives */

const LOOP_ID_PREFIX = PREFIXES.lpe;
const SCHEDULE_ID_PREFIX = PREFIXES.lps;
/**
 * A RUN id. The grammar predates the runtime, so it addressed Loops and
 * schedules and nothing else — which left `relay loop status lpr_…`
 * unexpressible the moment runs became real things a user can name. A Loop is
 * the standing instruction; a run is one execution of it, and `status`,
 * `inspect`, `pause`, `resume` and `stop` are all questions about a RUN.
 */
const RUN_ID_PREFIX = PREFIXES.lpr;
/** Same body rule the protocol's `checkId` uses, so a Loop id that parses here
 *  is a Loop id that validates there. Duplicating the SHAPE would let the two
 *  drift; deriving the prefix from `PREFIXES` is what prevents it. */
const ID_BODY = /^[A-Za-z0-9_-]{1,190}$/;

function isLoopIdToken(token: string): boolean {
  return token.startsWith(LOOP_ID_PREFIX) && ID_BODY.test(token.slice(LOOP_ID_PREFIX.length));
}

function isScheduleIdToken(token: string): boolean {
  return token.startsWith(SCHEDULE_ID_PREFIX) && ID_BODY.test(token.slice(SCHEDULE_ID_PREFIX.length));
}

/** Any Relay identifier a Loop action may legitimately address. */
function isRunIdToken(token: string): boolean {
  return token.startsWith(RUN_ID_PREFIX) && ID_BODY.test(token.slice(RUN_ID_PREFIX.length));
}

/** Any Relay identifier a Loop action may legitimately address. */
function isAddressableIdToken(token: string): boolean {
  return isLoopIdToken(token) || isScheduleIdToken(token) || isRunIdToken(token);
}

const WHITESPACE = /\s/;

/** Split off the first whitespace-delimited word; return it and the rest. */
function takeWord(text: string): { word: string; rest: string } {
  const trimmed = text.trimStart();
  const boundary = trimmed.search(WHITESPACE);
  if (boundary === -1) return { word: trimmed, rest: '' };
  return { word: trimmed.slice(0, boundary), rest: trimmed.slice(boundary).trimStart() };
}

/**
 * Normalize free text the user wrote.
 *
 * A fully quoted value is preserved EXACTLY as written inside the quotes —
 * that is the escape hatch for an objective whose internal spacing matters.
 * Everything else is trimmed and has runs of whitespace (including the
 * newlines a textarea produces) collapsed to single spaces, because an
 * objective that differs only by line wrapping is the same objective and
 * should produce the same `bindingDigest` later.
 */
function normalizeFreeText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    if (!inner.includes('"')) return inner;
  }
  return trimmed.replace(/\s+/g, ' ');
}

/* ---------------------------------------------------------------- errors */

function invalid(message: string, details: string[] = []): RelayResult<RelayParsedSlashCommand> {
  return fail(relayError('invalid-command', message, details.length > 0 ? { details } : {}));
}

/** Turn structured role problems into safe, specific, testable messages. */
function roleProblemDetails(problems: readonly RoleExpressionProblem[]): string[] {
  return problems.map((problem) => {
    switch (problem.reason) {
      case 'empty_target':
        return 'A target was expected but the expression was empty.';
      case 'empty_role_entry':
        return 'A role list may not contain an empty entry — check for a stray or doubled comma.';
      case 'unknown_role':
        return `Unknown role "${problem.token}". Known roles: ${RELAY_LOOP_ROLE_WORDS.join(', ')}.`;
      case 'duplicate_role':
        return `Role "${problem.token}" is named more than once after alias normalization.`;
      case 'all_not_combinable':
        return `"${problem.token}" combines "all"/"team" with specific roles; name one or the other.`;
    }
  });
}

/* ---------------------------------------------------------- action parse */

interface ActionParse {
  readonly loopId: string | null;
  readonly problem: string | null;
}

/**
 * Read the optional Loop id that follows an action verb.
 *
 * A trailing token that is NOT an id is refused rather than ignored, because
 * `/loop status of the auth work` is a sentence, not a command, and quietly
 * dropping the tail would show the user status for something they did not ask
 * about. `null` means "the caller's current Loop", which each surface resolves.
 */
function parseOptionalLoopId(rest: string, verb: string, acceptsId: boolean): ActionParse {
  const remainder = rest.trim();
  if (remainder === '') return { loopId: null, problem: null };
  if (!acceptsId) {
    return { loopId: null, problem: `"${verb}" takes no arguments (received "${remainder}").` };
  }
  const { word, rest: tail } = takeWord(remainder);
  if (!isAddressableIdToken(word)) {
    return {
      loopId: null,
      problem: `"${word}" is not a Loop identifier — expected ${LOOP_ID_PREFIX}<id>, ${RUN_ID_PREFIX}<id> or ${SCHEDULE_ID_PREFIX}<id>.`,
    };
  }
  if (tail.trim() !== '') {
    return { loopId: null, problem: `Unexpected text after the Loop identifier: "${tail.trim()}".` };
  }
  return { loopId: word, problem: null };
}

/* ------------------------------------------------------------ cron parse */

const CRON_FIELD_COUNT = 5;

/**
 * Does this token have the SHAPE of a cron field?
 *
 * Two accepted forms: numeric-and-operator (`0`, `*`, `1-5`, `1,3,5`, and the
 * step form written with a slash) and three-letter calendar names, possibly in
 * ranges or lists (`MON-FRI`, `JAN,JUL`). Nothing here checks RANGES — `99`
 * passes, because validating cron semantics belongs to the schedule stage,
 * not to a grammar.
 *
 * This exists only to find where a bare expression ENDS. Without it,
 * `/loop cron 0 8 * inspect things` would consume `inspect` and `things` as
 * fields and then report a missing objective, which points the user at the
 * wrong end of their mistake.
 */
const CRON_NUMERIC_FIELD = /^[0-9*,\-/?]+$/;
const CRON_NAMED_FIELD = /^[A-Za-z]{3}(?:[-,][A-Za-z]{3})*$/;

function looksLikeCronField(token: string): boolean {
  return CRON_NUMERIC_FIELD.test(token) || CRON_NAMED_FIELD.test(token);
}

interface CronParse {
  readonly expression: string;
  readonly rest: string;
  readonly problem: string | null;
}

/**
 * Read a cron expression, quoted or bare.
 *
 * Quoted (`"0 8 * * 1-5"`) is the recommended form and is taken verbatim.
 * Bare is accepted as exactly FIVE whitespace-separated fields — the standard
 * minute/hour/day-of-month/month/day-of-week form — because without a
 * delimiter there is no other way to know where the expression stops and the
 * objective starts. Seconds fields and `@reboot`-style macros are deliberately
 * not accepted: they would change the field count and make that boundary
 * ambiguous, and Relay's approved schedule model does not include them.
 *
 * NOTHING here interprets cron semantics. Field ranges, day-of-week spellings
 * and timezone resolution belong to the schedule stage. This is a grammar.
 */
function parseCronExpression(rest: string): CronParse {
  const trimmed = rest.trim();
  if (trimmed === '') {
    return { expression: '', rest: '', problem: 'A cron expression is required.' };
  }
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1);
    if (closing === -1) {
      return { expression: '', rest: '', problem: 'The quoted cron expression has no closing quote.' };
    }
    const expression = trimmed.slice(1, closing);
    if (expression.trim() === '') {
      return { expression: '', rest: '', problem: 'The quoted cron expression is empty.' };
    }
    return { expression, rest: trimmed.slice(closing + 1).trim(), problem: null };
  }

  const shortfall = (count: number) =>
    `A bare cron expression needs ${CRON_FIELD_COUNT} fields (minute hour day-of-month month day-of-week); received ${count}. Quote it to be explicit.`;

  const fields: string[] = [];
  let cursor = trimmed;
  for (let index = 0; index < CRON_FIELD_COUNT; index += 1) {
    if (cursor === '') {
      return { expression: '', rest: '', problem: shortfall(fields.length) };
    }
    const { word, rest: tail } = takeWord(cursor);
    if (!looksLikeCronField(word)) {
      return {
        expression: '',
        rest: '',
        problem: `"${word}" is not a cron field. ${shortfall(index)}`,
      };
    }
    fields.push(word);
    cursor = tail;
  }
  return { expression: fields.join(' '), rest: cursor.trim(), problem: null };
}

/* ------------------------------------------------------------ target read */

interface TargetRead {
  readonly target: RelayLoopTargetSelector;
  readonly rest: string;
  readonly problems: readonly RoleExpressionProblem[];
}

/**
 * Apply grammar rule 3, then rule 4: if the first word is a target expression
 * consume it, otherwise leave the whole remainder as the objective under the
 * default target.
 */
function readTarget(remainder: string): TargetRead {
  const trimmed = remainder.trim();
  if (trimmed === '') return { target: DEFAULT_LOOP_TARGET, rest: '', problems: [] };
  const { word, rest } = takeWord(trimmed);
  if (!looksLikeTargetExpression(word)) {
    return { target: DEFAULT_LOOP_TARGET, rest: trimmed, problems: [] };
  }
  const parsed = parseRoleExpression(word);
  if (!parsed.ok) return { target: DEFAULT_LOOP_TARGET, rest, problems: parsed.problems };
  return { target: parsed.selector, rest, problems: [] };
}

/* ------------------------------------------------------------ the parser */

/**
 * Parse one slash command.
 *
 * Returns a `RelayResult`, never throws — errors are VALUES here for the same
 * reason they are everywhere else in Relay: transition and validation logic
 * stays pure and deterministic, and a caller cannot forget to handle one.
 */
export function parseSlashCommand(input: string): RelayResult<RelayParsedSlashCommand> {
  if (typeof input !== 'string') {
    return invalid('A slash command must be a string.');
  }
  const raw = input.trim();
  if (raw === '') return invalid('A slash command may not be empty.');
  if (!raw.startsWith('/')) {
    return invalid('A slash command must begin with "/".', [
      'Input without a leading slash is natural language and is interpreted by the mission command interpreter.',
    ]);
  }

  // The command name must touch the slash. `/ loop fix it` is a typo, and
  // repairing it silently would teach a grammar Relay does not actually have.
  const afterSlash = raw.slice(1);
  if (afterSlash === '' || WHITESPACE.test(afterSlash.charAt(0))) {
    return invalid('A slash command needs a name immediately after "/" — try /loop or /loops.');
  }

  const { word: commandWord, rest } = takeWord(afterSlash);
  const name = commandWord.toLowerCase();

  if (name === 'loops') {
    if (rest.trim() !== '') {
      return invalid('/loops takes no arguments — it opens the Loop catalog.', [
        `Received: "${rest.trim()}".`,
      ]);
    }
    return ok({ raw, family: 'loop', command: { kind: 'loop_catalog' } });
  }

  if (name === 'loop') return parseLoopFamily(raw, rest);
  if (name === 'sloop') return parseSwarmFamily(raw, rest);

  return invalid(`Unknown slash command "/${commandWord}".`, [
    'Known commands: /loop, /loops, /sloop.',
  ]);
}

function parseLoopFamily(raw: string, rest: string): RelayResult<RelayParsedSlashCommand> {
  const remainder = rest.trim();
  if (remainder === '') {
    return ok({ raw, family: 'loop', command: { kind: 'loop_composer' } });
  }

  const { word, rest: afterWord } = takeWord(remainder);
  const verb = word.toLowerCase();

  // Rule 1 — scheduling verbs.
  if ((RELAY_LOOP_SCHEDULE_VERBS as readonly string[]).includes(verb)) {
    return parseScheduleVerb(raw, verb, afterWord);
  }

  // Rule 2 — action verbs.
  if ((RELAY_LOOP_ACTIONS as readonly string[]).includes(verb)) {
    const action = verb as RelayLoopAction;
    const acceptsId = RELAY_LOOP_ACTIONS_ACCEPTING_ID.includes(action);
    const parsed = parseOptionalLoopId(afterWord, `/loop ${action}`, acceptsId);
    if (parsed.problem !== null) return invalid(parsed.problem);
    return ok({ raw, family: 'loop', command: { kind: 'loop_action', action, loopId: parsed.loopId } });
  }

  // Rules 3 and 4 — target then objective.
  const read = readTarget(remainder);
  if (read.problems.length > 0) {
    return invalid('The Loop target could not be understood.', roleProblemDetails(read.problems));
  }
  const objective = normalizeFreeText(read.rest);
  if (objective === '') {
    return invalid('A Loop needs an objective.', [
      read.target.requestedExpression === null
        ? 'Try /loop <objective>, or /loop help for the full grammar.'
        : `Target "${read.target.requestedExpression}" was named but no objective followed.`,
    ]);
  }
  return ok({
    raw,
    family: 'loop',
    command: { kind: 'loop_create', target: read.target, objective },
  });
}

function parseScheduleVerb(
  raw: string,
  verb: string,
  rest: string,
): RelayResult<RelayParsedSlashCommand> {
  if (verb === 'schedules') {
    if (rest.trim() !== '') {
      return invalid('/loop schedules takes no arguments — it lists Cron Loops.', [
        `Received: "${rest.trim()}".`,
      ]);
    }
    return ok({ raw, family: 'loop', command: { kind: 'loop_schedule_list' } });
  }

  if (verb === 'schedule') {
    const remainder = rest.trim();
    if (remainder === '') {
      return ok({ raw, family: 'loop', command: { kind: 'loop_schedule_composer' } });
    }
    const read = readTarget(remainder);
    if (read.problems.length > 0) {
      return invalid('The scheduled Loop target could not be understood.', roleProblemDetails(read.problems));
    }
    const scheduleRequest = normalizeFreeText(read.rest);
    if (scheduleRequest === '') {
      return invalid('A scheduled Loop needs a schedule and an objective.', [
        'Try /loop schedule Every weekday at 8 AM, inspect the repository for failing tests.',
      ]);
    }
    return ok({
      raw,
      family: 'loop',
      command: { kind: 'loop_schedule_create', target: read.target, scheduleRequest },
    });
  }

  // verb === 'cron'
  const cron = parseCronExpression(rest);
  if (cron.problem !== null) {
    return invalid(cron.problem, ['Try /loop cron "0 8 * * 1-5" <objective>.']);
  }
  const read = readTarget(cron.rest);
  if (read.problems.length > 0) {
    return invalid('The Cron Loop target could not be understood.', roleProblemDetails(read.problems));
  }
  const objective = normalizeFreeText(read.rest);
  if (objective === '') {
    return invalid('A Cron Loop needs an objective after the cron expression.', [
      `Parsed cron expression: "${cron.expression}".`,
    ]);
  }
  return ok({
    raw,
    family: 'loop',
    command: {
      kind: 'loop_cron_create',
      target: read.target,
      cronExpression: cron.expression,
      objective,
    },
  });
}

function parseSwarmFamily(raw: string, rest: string): RelayResult<RelayParsedSlashCommand> {
  const remainder = rest.trim();
  if (remainder === '') {
    return ok({ raw, family: 'sloop', command: { kind: 'sloop_composer' } });
  }

  const { word, rest: afterWord } = takeWord(remainder);
  const verb = word.toLowerCase();

  if ((RELAY_SWARM_LOOP_ACTIONS as readonly string[]).includes(verb)) {
    const action = verb as RelaySwarmLoopAction;
    const acceptsId = RELAY_SWARM_ACTIONS_ACCEPTING_ID.includes(action);
    const parsed = parseOptionalLoopId(afterWord, `/sloop ${action}`, acceptsId);
    if (parsed.problem !== null) return invalid(parsed.problem);
    return ok({ raw, family: 'sloop', command: { kind: 'sloop_action', action, loopId: parsed.loopId } });
  }

  const read = readTarget(remainder);
  if (read.problems.length > 0) {
    return invalid('The Swarm Loop target could not be understood.', roleProblemDetails(read.problems));
  }
  const objective = normalizeFreeText(read.rest);
  if (objective === '') {
    return invalid('A Swarm Loop needs an objective.', [
      read.target.requestedExpression === null
        ? 'Try /sloop <objective>, or /sloop help for the full grammar.'
        : `Target "${read.target.requestedExpression}" was named but no objective followed.`,
    ]);
  }
  return ok({ raw, family: 'sloop', command: { kind: 'sloop_create', target: read.target, objective } });
}

/* ----------------------------------------------------------- convenience */

/**
 * Does this command, if authorized, request work that could cost money?
 *
 * Used by surfaces to decide whether a confirmation preview is mandatory. It
 * answers a question about the REQUEST only — it is not an authorization, a
 * budget check, or a promise that execution will follow.
 */
export function commandRequestsExecution(command: RelaySlashCommand): boolean {
  switch (command.kind) {
    case 'loop_create':
    case 'loop_schedule_create':
    case 'loop_cron_create':
    case 'sloop_create':
      return true;
    default:
      return false;
  }
}
