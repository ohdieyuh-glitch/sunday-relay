/**
 * SUNDAY RELAY — LOOP ENGINE (barrel).
 *
 * ONE grammar, ONE target contract, consumed identically by the website
 * composer, the CLI and every test. Re-exported through `../index` (the
 * mission barrel) for the same reason mission economics, the agent operating
 * foundation, worktrees, the coding agent, the prompt architect and the
 * reviewer harness are: the CLI boundary permits only the bare `../mission`
 * path, and BOTH surfaces must normalize a command through the SAME parser
 * rather than each growing their own.
 *
 * Everything here is PURE and browser-safe. The durable Loop runtime, the
 * scheduler and the Unchain meter are server-side and live elsewhere; nothing
 * in this directory may import them.
 */

export {
  commandRequestsExecution,
  isSlashCommandInput,
  parseSlashCommand,
  routeRelayInput,
} from './loop-command-parser';

export {
  RELAY_INPUT_ROUTES,
  RELAY_LOOP_ACTIONS,
  RELAY_LOOP_ACTIONS_ACCEPTING_ID,
  RELAY_LOOP_SCHEDULE_VERBS,
  RELAY_SLASH_COMMAND_KINDS,
  RELAY_SLASH_FAMILIES,
  RELAY_SWARM_ACTIONS_ACCEPTING_ID,
  RELAY_SWARM_LOOP_ACTIONS,
  type RelayInputRoute,
  type RelayLoopAction,
  type RelayLoopActionCommand,
  type RelayLoopCatalogCommand,
  type RelayLoopCommand,
  type RelayLoopComposerCommand,
  type RelayLoopCreateCommand,
  type RelayLoopCronCreateCommand,
  type RelayLoopScheduleCommand,
  type RelayLoopScheduleComposerCommand,
  type RelayLoopScheduleCreateCommand,
  type RelayLoopScheduleListCommand,
  type RelayLoopScheduleVerb,
  type RelayParsedSlashCommand,
  type RelaySlashCommand,
  type RelaySlashCommandKind,
  type RelaySlashFamily,
  type RelaySwarmLoopAction,
  type RelaySwarmLoopActionCommand,
  type RelaySwarmLoopCommand,
  type RelaySwarmLoopComposerCommand,
  type RelaySwarmLoopCreateCommand,
} from './loop-command-types';

export {
  DEFAULT_LOOP_TARGET,
  RELAY_LOOP_ALL_ALIASES,
  RELAY_LOOP_CANONICAL_ALIAS,
  RELAY_LOOP_ROLE_ALIASES,
  RELAY_LOOP_ROLE_WORDS,
  RELAY_LOOP_TARGETABLE_ROLES,
  RELAY_LOOP_TARGET_KINDS,
  isAllTargetWord,
  looksLikeTargetExpression,
  parseRoleExpression,
  roleForAlias,
  type RelayLoopTargetKind,
  type RelayLoopTargetSelector,
  type RoleExpressionProblem,
  type RoleExpressionResult,
} from './loop-roles';
