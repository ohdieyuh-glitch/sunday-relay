/**
 * THE COMMAND PARSER — user text in, a typed Relay operation request out.
 *
 * DETERMINISTIC AND STRICT. No natural-language interpretation, no fuzzy
 * matching, no nearest command. `/gauntletlop` is refused as unknown rather
 * than run as `/gauntletloop`, because a command that silently becomes a
 * different command is the one failure a control surface must not have.
 *
 * NOTHING IS IGNORED. An unknown flag, a duplicated flag, a value where none
 * was expected — each is a refusal with its own reason. Dropping an unknown
 * flag would let `--rounds 5 --unchained` run a gauntlet while quietly
 * discarding half of what the user asked for.
 *
 * IT VALIDATES SHAPE, NOT POLICY. See `julius-operation-contracts.ts`: Relay
 * refuses values that are not real values; Julius refuses values its policy
 * does not permit. A Relay-side copy of a policy limit would go stale in
 * silence and start refusing operations the product allows.
 *
 * SECRETS NEVER SURVIVE. `sourceText` is the audit trail of what a user typed,
 * so it is redacted with the same rule the Live Terminal uses before it is
 * carried anywhere.
 *
 * PURE. No Node, no network, no clock — `issuedAt` and `requestId` are given.
 */

import { checkFreeId } from '../../protocol/ids';
import { redactTerminalText } from '../../mission/terminal';
import { COMPOUND_AGENT_SLOTS, type CompoundAgentSlot } from '../compound-agent';
import {
  JULIUS_AUTONOMY_LEVELS,
  OPERATION_REQUEST_BOUNDS,
  RELAY_JULIUS_OPERATION_VERSION,
  requestedAutonomyIsCoherent,
  type JuliusAutonomyLevel,
  type RelayJuliusOperationEnvelope,
  type RelayJuliusOperationRequest,
} from './julius-operation-contracts';

/* -------------------------------------------------------------- refusals */

export const COMMAND_REFUSALS = [
  'empty_command',
  'not_a_command',
  'unknown_command',
  'unknown_flag',
  'duplicate_flag',
  'missing_flag_value',
  'unterminated_quote',
  'invalid_flag_value',
  'value_out_of_range',
  'missing_required_flag',
  'unexpected_argument',
  'invalid_run_id',
  'invalid_request_id',
  'invalid_issuer',
  'text_too_long',
  'unsupported_role_preference',
  'autonomy_conflicts_with_execution_mode',
] as const;
export type CommandRefusal = (typeof COMMAND_REFUSALS)[number];

export interface CommandProblem {
  readonly reason: CommandRefusal;
  /** The flag or field, when the problem belongs to one. */
  readonly field: string;
  readonly safeMessage: string;
}

export type CommandParseResult =
  | { readonly ok: true; readonly request: RelayJuliusOperationRequest }
  | { readonly ok: false; readonly problems: readonly CommandProblem[] };

const problem = (reason: CommandRefusal, field: string, safeMessage: string): CommandProblem =>
  ({ reason, field, safeMessage });

/* ------------------------------------------------------------ the context */

export interface CommandContext {
  readonly runId: string;
  readonly requestId: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  /**
   * The run's current Relay execution mode. Needed for the ONE coherence check
   * this layer makes; every other policy question belongs to Julius.
   */
  readonly executionMode: 'guided' | 'semi' | 'autonomous';
}

/* ------------------------------------------------------------ tokenizing */

interface Parsed {
  readonly command: string;
  readonly flags: ReadonlyMap<string, string>;
  readonly positional: readonly string[];
}

/**
 * One token, with the two facts about quoting that decide different things.
 *
 * `leadingQuoted` — the token OPENED with a quote, so it is text even if it
 * looks like a flag. `"--rounds"` is a word the user quoted, not a directive.
 * `anyQuoted` — a quote appeared somewhere, so `--reason=""` carries an
 * explicitly empty VALUE rather than a missing one. Collapsing these two into
 * one boolean makes `--task="Audit the boundary"` stop being a flag, which is
 * the bug this replaced.
 */
interface Token {
  readonly text: string;
  readonly leadingQuoted: boolean;
  readonly anyQuoted: boolean;
}

/**
 * SPLIT ON WHITESPACE, EXCEPT INSIDE QUOTES.
 *
 * A parser that splits on bare whitespace cannot express a multi-word value at
 * all: `--task=Audit the boundary` silently becomes `--task=Audit` plus two
 * stray words, and every free-text flag this layer has — a task description, a
 * pause reason, a denial reason — is free text. The first version of this
 * tokenizer did exactly that, and its own tests caught it.
 *
 * QUOTING IS TRACKED, NOT JUST STRIPPED. `"--rounds"` is TEXT, not a flag —
 * a user quoting something has said it is a value, and a tokenizer that
 * forgets the quotes turns a quoted word into a directive. So each token
 * carries whether it was quoted, and flag detection reads only unquoted ones.
 *
 * An unterminated quote is a REFUSAL. Closing it silently would run a command
 * whose text the user did not finish writing.
 */
function splitTokens(line: string): Token[] | null {
  const tokens: Token[] = [];
  let text = '';
  let anyQuoted = false;
  let leadingQuoted = false;
  let started = false;
  let quote: '"' | "'" | null = null;

  const flush = (): void => {
    if (started) tokens.push({ text, leadingQuoted, anyQuoted });
    text = ''; anyQuoted = false; leadingQuoted = false; started = false;
  };

  for (const character of line) {
    if (quote !== null) {
      if (character === quote) { quote = null; continue; }
      text += character; continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      if (!started) leadingQuoted = true;
      anyQuoted = true; started = true;
      continue;
    }
    if (/\s/.test(character)) { flush(); continue; }
    text += character; started = true;
  }
  if (quote !== null) return null;
  flush();
  return tokens;
}

/**
 * Split a command line into a verb, `--flag value` / `--flag=value` pairs, and
 * whatever positional text follows.
 *
 * A flag with no value is an ERROR rather than a boolean: every flag this
 * parser accepts takes one, and silently treating a missing value as `true`
 * is how `--rounds --unchained` becomes a gauntlet with an unbounded ceiling.
 */
function tokenize(line: string): { parsed: Parsed } | { problems: CommandProblem[] } {
  const problems: CommandProblem[] = [];
  const tokens = splitTokens(line.trim());
  if (tokens === null) {
    return {
      problems: [problem('unterminated_quote', 'command',
        'A quote was opened and never closed. Relay will not close it on the user\'s behalf.')],
    };
  }
  const isFlag = (token: Token | undefined): boolean =>
    token !== undefined && !token.leadingQuoted && token.text.startsWith('--');

  const command = tokens[0]!.text.slice(1).toLowerCase();
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!isFlag(token)) { positional.push(token.text); continue; }
    const body = token.text.slice(2);
    const equals = body.indexOf('=');
    const name = (equals === -1 ? body : body.slice(0, equals)).toLowerCase();
    if (name === '') {
      problems.push(problem('unknown_flag', '--', 'A bare `--` is not a flag.'));
      continue;
    }
    let value: string | undefined;
    let valueWasQuoted = false;
    if (equals !== -1) {
      // `--task="Audit the boundary"` arrives as one token whose quoted halves
      // were already joined, so the value is everything after the first `=`.
      value = body.slice(equals + 1);
      valueWasQuoted = token.anyQuoted;
    } else {
      const next = tokens[index + 1];
      if (next !== undefined && !isFlag(next)) {
        value = next.text; valueWasQuoted = next.anyQuoted; index += 1;
      }
    }
    // An EXPLICITLY QUOTED empty value is a value: `--reason=""` says "none",
    // which the command's own required-field check then refuses by name. An
    // ABSENT value is a different mistake and keeps its own reason.
    if (value === undefined || (value === '' && !valueWasQuoted)) {
      problems.push(problem('missing_flag_value', `--${name}`, `--${name} needs a value.`));
      continue;
    }
    if (flags.has(name)) {
      problems.push(problem('duplicate_flag', `--${name}`,
        `--${name} was given more than once. Relay will not choose which one the user meant.`));
      continue;
    }
    flags.set(name, value);
  }

  if (problems.length > 0) return { problems };
  return { parsed: { command, flags, positional } };
}

/* ------------------------------------------------------------- validators */

function boundedInteger(
  raw: string, field: string, maximum: number, problems: CommandProblem[],
): number | null {
  if (!/^\d+$/.test(raw)) {
    problems.push(problem('invalid_flag_value', field,
      `${field} must be a whole number. "${raw}" is not one, and Relay will not guess what was meant.`));
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    problems.push(problem('value_out_of_range', field, `${field} must be at least 1.`));
    return null;
  }
  if (value > maximum) {
    problems.push(problem('value_out_of_range', field,
      `${field} must be at most ${maximum}. That ceiling is a request-shape bound, not a policy limit — Julius decides what is actually permitted.`));
    return null;
  }
  return value;
}

function boundedText(
  raw: string, field: string, problems: CommandProblem[],
): string {
  if (raw.length > OPERATION_REQUEST_BOUNDS.maxTextLength) {
    problems.push(problem('text_too_long', field,
      `${field} must be at most ${OPERATION_REQUEST_BOUNDS.maxTextLength} characters.`));
    return '';
  }
  return redactTerminalText(raw).text;
}

function boundedIdentifier(
  raw: string, field: string, problems: CommandProblem[],
): string {
  if (raw.length > OPERATION_REQUEST_BOUNDS.maxIdentifierLength || raw.trim() === '') {
    problems.push(problem('invalid_flag_value', field,
      `${field} must be a non-empty identifier of at most ${OPERATION_REQUEST_BOUNDS.maxIdentifierLength} characters.`));
    return '';
  }
  return raw;
}

function rejectUnknownFlags(
  parsed: Parsed, allowed: readonly string[], problems: CommandProblem[],
): void {
  for (const name of parsed.flags.keys()) {
    if (!allowed.includes(name)) {
      problems.push(problem('unknown_flag', `--${name}`,
        `/${parsed.command} has no --${name} flag. It accepts: ${allowed.length > 0 ? allowed.map((f) => `--${f}`).join(', ') : 'no flags'}.`));
    }
  }
}

function rejectPositional(parsed: Parsed, problems: CommandProblem[]): void {
  if (parsed.positional.length > 0) {
    problems.push(problem('unexpected_argument', 'arguments',
      `/${parsed.command} takes no free text, and "${parsed.positional.join(' ')}" was given.`));
  }
}

function validateContext(context: CommandContext, problems: CommandProblem[]): void {
  if (checkFreeId(context.runId, 'runId') !== null) {
    problems.push(problem('invalid_run_id', 'runId',
      'A command needs a non-empty run identifier of at most 200 characters.'));
  }
  if (checkFreeId(context.requestId, 'requestId') !== null) {
    problems.push(problem('invalid_request_id', 'requestId',
      'A command needs a non-empty request identifier of at most 200 characters.'));
  }
  if (typeof context.issuedBy !== 'string' || context.issuedBy.trim() === '') {
    problems.push(problem('invalid_issuer', 'issuedBy',
      'A command must record who issued it. An unattributed command is refused rather than recorded as anonymous.'));
  }
}

/* ---------------------------------------------------------------- parsing */

/** Command names, in one place so the unknown-command message can list them. */
export const RELAY_JULIUS_COMMANDS = [
  'gauntletloop', 'autonomy', 'subagent', 'pause', 'resume', 'cancel', 'approve', 'deny',
] as const;

export function parseJuliusCommand(line: string, context: CommandContext): CommandParseResult {
  const problems: CommandProblem[] = [];

  if (typeof line !== 'string' || line.trim() === '') {
    return { ok: false, problems: [problem('empty_command', 'command', 'No command was given.')] };
  }
  if (!line.trim().startsWith('/')) {
    return {
      ok: false,
      problems: [problem('not_a_command', 'command',
        'A Julius operation is issued as a slash command. Free text is not interpreted as one.')],
    };
  }

  const tokenized = tokenize(line);
  if ('problems' in tokenized) return { ok: false, problems: tokenized.problems };
  const parsed = tokenized.parsed;

  validateContext(context, problems);

  const envelope: RelayJuliusOperationEnvelope = {
    operationVersion: RELAY_JULIUS_OPERATION_VERSION,
    requestId: context.requestId,
    runId: context.runId,
    issuedBy: context.issuedBy,
    issuedAt: context.issuedAt,
    sourceText: redactTerminalText(line.trim()).text,
  };

  const finish = (request: RelayJuliusOperationRequest): CommandParseResult =>
    (problems.length > 0 ? { ok: false, problems } : { ok: true, request });

  switch (parsed.command) {
    /* -------------------------------------------------------- gauntlet -- */
    case 'gauntletloop': {
      rejectUnknownFlags(parsed, ['rounds'], problems);
      rejectPositional(parsed, problems);
      const raw = parsed.flags.get('rounds');
      // ABSENT IS NOT ZERO. No `--rounds` means the user named no ceiling and
      // Julius's policy default applies; Relay substitutes nothing.
      const maxRounds = raw === undefined
        ? null
        : boundedInteger(raw, '--rounds', OPERATION_REQUEST_BOUNDS.maxGauntletRounds, problems);
      return finish({ ...envelope, operation: 'START_GAUNTLET', requestedLimits: { maxRounds } });
    }

    /* -------------------------------------------------------- autonomy -- */
    case 'autonomy': {
      rejectUnknownFlags(parsed, ['mode'], problems);
      const raw = parsed.flags.get('mode') ?? parsed.positional[0];
      if (parsed.flags.has('mode') && parsed.positional.length > 0) rejectPositional(parsed, problems);
      if (raw === undefined) {
        problems.push(problem('missing_required_flag', '--mode',
          `/autonomy needs a mode: ${JULIUS_AUTONOMY_LEVELS.join(', ')}.`));
        return { ok: false, problems };
      }
      const mode = raw.toUpperCase();
      if (!(JULIUS_AUTONOMY_LEVELS as readonly string[]).includes(mode)) {
        problems.push(problem('invalid_flag_value', '--mode',
          `"${raw}" is not an autonomy level. Relay accepts: ${JULIUS_AUTONOMY_LEVELS.join(', ')}.`));
        return { ok: false, problems };
      }
      const requestedMode = mode as JuliusAutonomyLevel;
      if (!requestedAutonomyIsCoherent(requestedMode, context.executionMode)) {
        problems.push(problem('autonomy_conflicts_with_execution_mode', '--mode',
          `This run is in ${context.executionMode} mode, in which the user asked to be consulted. Requesting ${requestedMode} in the same run is a contradiction, so Relay will not compose the request. Change the execution mode first. Julius may still deny ${requestedMode} from any mode.`));
      }
      return finish({ ...envelope, operation: 'SET_AUTONOMY_MODE', requestedMode });
    }

    /* -------------------------------------------------------- subagent -- */
    case 'subagent': {
      const allowed = ['capability', 'task', 'role', 'parent-task', 'max-depth', 'max-children'];
      rejectUnknownFlags(parsed, allowed, problems);
      rejectPositional(parsed, problems);

      const capabilityRaw = parsed.flags.get('capability');
      const taskRaw = parsed.flags.get('task');
      const parentRaw = parsed.flags.get('parent-task');
      for (const [name, value] of [
        ['--capability', capabilityRaw], ['--task', taskRaw], ['--parent-task', parentRaw],
      ] as const) {
        if (value === undefined) {
          problems.push(problem('missing_required_flag', name, `/subagent needs ${name}.`));
        }
      }

      let rolePreference: CompoundAgentSlot | null = null;
      const roleRaw = parsed.flags.get('role');
      if (roleRaw !== undefined) {
        const upper = roleRaw.toUpperCase();
        if (!(COMPOUND_AGENT_SLOTS as readonly string[]).includes(upper)) {
          problems.push(problem('unsupported_role_preference', '--role',
            `"${roleRaw}" is not a worker role. Relay accepts: ${COMPOUND_AGENT_SLOTS.join(', ')}. A specialist role is assigned by Julius and cannot be requested by name.`));
        } else {
          rolePreference = upper as CompoundAgentSlot;
        }
      }

      const depthRaw = parsed.flags.get('max-depth');
      const childrenRaw = parsed.flags.get('max-children');
      const maxDepth = depthRaw === undefined
        ? null : boundedInteger(depthRaw, '--max-depth', OPERATION_REQUEST_BOUNDS.maxSubagentDepth, problems);
      const maxChildren = childrenRaw === undefined
        ? null : boundedInteger(childrenRaw, '--max-children', OPERATION_REQUEST_BOUNDS.maxSubagentCount, problems);

      return finish({
        ...envelope,
        operation: 'REQUEST_SUBAGENT',
        parentTaskId: boundedIdentifier(parentRaw ?? '', '--parent-task', problems),
        requestedCapability: boundedIdentifier(capabilityRaw ?? '', '--capability', problems),
        requestedTask: boundedText(taskRaw ?? '', '--task', problems),
        rolePreference,
        requestedBounds: { maxDepth, maxChildren },
      });
    }

    /* ------------------------------------------------------- lifecycle -- */
    case 'pause': {
      rejectUnknownFlags(parsed, ['reason'], problems);
      const reason = parsed.flags.get('reason') ?? parsed.positional.join(' ');
      return finish({
        ...envelope, operation: 'PAUSE_RUN', reason: boundedText(reason, '--reason', problems),
      });
    }

    case 'resume': {
      rejectUnknownFlags(parsed, [], problems);
      rejectPositional(parsed, problems);
      return finish({ ...envelope, operation: 'RESUME_RUN' });
    }

    case 'cancel': {
      rejectUnknownFlags(parsed, ['reason'], problems);
      const reason = parsed.flags.get('reason') ?? parsed.positional.join(' ');
      if (reason.trim() === '') {
        problems.push(problem('missing_required_flag', '--reason',
          '/cancel needs a reason. A cancellation with no recorded reason is indistinguishable from a failure nobody explained.'));
      }
      return finish({
        ...envelope, operation: 'CANCEL_RUN', reason: boundedText(reason, '--reason', problems),
      });
    }

    /* -------------------------------------------------------- approval -- */
    case 'approve':
    case 'deny': {
      rejectUnknownFlags(parsed, ['approval', 'reason'], problems);
      const approvalRaw = parsed.flags.get('approval') ?? parsed.positional[0];
      if (approvalRaw === undefined) {
        problems.push(problem('missing_required_flag', '--approval',
          `/${parsed.command} needs the approval it answers.`));
      }
      const reason = parsed.flags.get('reason') ?? parsed.positional.slice(1).join(' ');
      if (parsed.command === 'deny' && reason.trim() === '') {
        problems.push(problem('missing_required_flag', '--reason',
          '/deny needs a reason. A denial the requester cannot act on is a dead end.'));
      }
      return finish({
        ...envelope,
        operation: 'SUBMIT_APPROVAL',
        approvalId: boundedIdentifier(approvalRaw ?? '', '--approval', problems),
        decision: parsed.command === 'approve' ? 'APPROVE' : 'DENY',
        reason: boundedText(reason, '--reason', problems),
      });
    }

    default:
      return {
        ok: false,
        problems: [problem('unknown_command', 'command',
          `/${parsed.command} is not a Relay operation. Relay accepts: ${RELAY_JULIUS_COMMANDS.map((c) => `/${c}`).join(', ')}. Relay does not guess at a nearest match.`)],
      };
  }
}
