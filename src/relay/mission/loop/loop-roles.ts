/**
 * SUNDAY RELAY — LOOP TARGET ROLES.
 *
 * WHAT A LOOP TARGET IS. A Loop command names WHO the user wants to work, not
 * who will actually work. `/loop architect …` is a REQUEST for the Prompt
 * Architect role; whether an architect is configured, available and eligible
 * is decided later, by the server, against the real agent registry. This
 * module owns only the first half of that: turning the target expression the
 * user typed into canonical requested roles, deterministically.
 *
 * WHY THE ROLE UNION IS NOT RE-TYPED HERE. `RELAY_AGENT_ROLES` is derived from
 * the canonical `MissionRole` (see `agent-operating/operating-profile-types`),
 * and a fourth role cannot appear without first appearing in that union. This
 * module imports it rather than restating it, so an alias can never resolve to
 * a role Relay does not actually have. Aliases the founder directive names for
 * roles that do not exist yet (research, testing, specialist PSP roles) are
 * therefore deliberately ABSENT: adding them here would let a command claim a
 * target Relay cannot staff.
 *
 * PURE. No I/O, no clock, no registry lookup, no network. Alias normalization
 * is a string operation and nothing more.
 */

import { RELAY_AGENT_ROLES, type RelayAgentRole } from '../agent-operating';

/* ------------------------------------------------------------- targeting */

/**
 * HOW A LOOP NAMES ITS WORKERS.
 *
 *   active_compound_agent — the default. Whatever roles the active Relay
 *                           compound agent is currently configured with. The
 *                           preview must show which those are, so the user
 *                           never confirms a target they cannot see.
 *   all_eligible_agents   — `/loop all` / `/loop team`. Every eligible role in
 *                           the registry, which may be a LARGER set than the
 *                           active compound agent.
 *   exact_roles           — `/loop architect,coding`. Exactly the named roles;
 *                           anything unavailable becomes a truthful blocker
 *                           rather than a silent substitution.
 */
export const RELAY_LOOP_TARGET_KINDS = [
  'active_compound_agent',
  'all_eligible_agents',
  'exact_roles',
] as const;
export type RelayLoopTargetKind = (typeof RELAY_LOOP_TARGET_KINDS)[number];

/**
 * The REQUESTED half of a Loop target. Deliberately carries no resolved
 * identity: `requestedRoles` is what the user asked for, and the resolved
 * roles plus the actual agent identities live on `RelayLoopTarget`
 * (`loop-target.ts`) once the server has consulted the registry. Keeping the
 * two apart is the same requested-versus-actual discipline
 * `RelayExecutionAttestation` and `RelayRuntimeReference` already enforce.
 */
export interface RelayLoopTargetSelector {
  readonly kind: RelayLoopTargetKind;
  /**
   * The literal expression the user typed — `all`, `architect,coding`. `null`
   * when the user typed no target at all and the default applied, which is
   * what lets a preview say "you did not name a target" truthfully instead of
   * pretending the user chose the default.
   */
  readonly requestedExpression: string | null;
  /**
   * Canonical roles, deduplicated, in the order the user named them. EMPTY for
   * `active_compound_agent` and `all_eligible_agents` — those kinds are
   * resolved against the registry, and pre-filling them here would be an
   * invented answer to a question only the server can answer.
   */
  readonly requestedRoles: readonly RelayAgentRole[];
}

/** The default target when a Loop command names no roles. */
export const DEFAULT_LOOP_TARGET: RelayLoopTargetSelector = Object.freeze({
  kind: 'active_compound_agent',
  requestedExpression: null,
  requestedRoles: Object.freeze([]) as readonly RelayAgentRole[],
});

/* ---------------------------------------------------------------- aliases */

/** The two words that mean "the whole compound agent organization". */
export const RELAY_LOOP_ALL_ALIASES = ['all', 'team'] as const;

/**
 * THE ONE ALIAS TABLE. Every surface — website composer, CLI, help text,
 * tests — resolves aliases through this map, so `/loop coder` and
 * `relay loop coder` can never mean different things.
 *
 * Both hyphenated and underscored spellings are accepted because the CLI
 * conventionally hyphenates (`prompt-architect`) while the domain union
 * underscores (`prompt_architect`), and a user should not have to know which
 * surface they are on.
 */
export const RELAY_LOOP_ROLE_ALIASES: Readonly<Record<string, RelayAgentRole>> = Object.freeze({
  architect: 'prompt_architect',
  'prompt-architect': 'prompt_architect',
  prompt_architect: 'prompt_architect',
  planning: 'prompt_architect',

  coding: 'coding_agent',
  coder: 'coding_agent',
  code: 'coding_agent',
  'coding-agent': 'coding_agent',
  coding_agent: 'coding_agent',

  reviewer: 'reviewer',
  review: 'reviewer',
  harness: 'reviewer',
  'harness-reviewer': 'reviewer',
  harness_reviewer: 'reviewer',
});

/** Canonical alias per role — what help output and previews should show. */
export const RELAY_LOOP_CANONICAL_ALIAS: Readonly<Record<RelayAgentRole, string>> = Object.freeze({
  prompt_architect: 'architect',
  coding_agent: 'coding',
  reviewer: 'reviewer',
});

/** Every accepted role word, sorted — for help text and error messages. */
export const RELAY_LOOP_ROLE_WORDS: readonly string[] =
  Object.freeze([...Object.keys(RELAY_LOOP_ROLE_ALIASES)].sort());

/** Does this single token name the whole compound agent? */
export function isAllTargetWord(token: string): boolean {
  return (RELAY_LOOP_ALL_ALIASES as readonly string[]).includes(token.trim().toLowerCase());
}

/** Resolve one alias to a canonical role, or `null` when it names none. */
export function roleForAlias(token: string): RelayAgentRole | null {
  return RELAY_LOOP_ROLE_ALIASES[token.trim().toLowerCase()] ?? null;
}

/* ------------------------------------------------------------ resolution */

export interface RoleExpressionProblem {
  /** Stable, testable reason — never a sentence the caller has to match on. */
  readonly reason:
    | 'empty_target'
    | 'empty_role_entry'
    | 'unknown_role'
    | 'duplicate_role'
    | 'all_not_combinable';
  /** The offending token exactly as typed, for a precise message. */
  readonly token: string;
}

export type RoleExpressionResult =
  | { readonly ok: true; readonly selector: RelayLoopTargetSelector }
  | { readonly ok: false; readonly problems: readonly RoleExpressionProblem[] };

/**
 * Parse a target expression — `all`, `team`, `architect`, `architect,coding`.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS ITS OWN REASON:
 *
 *   `architect,`        empty_role_entry    a trailing separator is a typo, and
 *                                           silently ignoring it would let
 *                                           `architect,,coding` mean something.
 *   `architect,arch…`   duplicate_role      after normalization two aliases can
 *                                           name ONE role; running it twice is
 *                                           duplicate work, which the scheduler
 *                                           exists to prevent.
 *   `all,coding`        all_not_combinable  "everything plus one thing" has no
 *                                           meaning, and guessing which the user
 *                                           meant would be inventing intent.
 *   `qa`                unknown_role        Relay has three roles. A target it
 *                                           cannot staff must fail loudly at
 *                                           parse time, not quietly at dispatch.
 *
 * Every problem is collected, not just the first, so a user fixing a malformed
 * list sees the whole list at once.
 */
export function parseRoleExpression(expression: string): RoleExpressionResult {
  const raw = expression.trim();
  if (raw === '') {
    return { ok: false, problems: [{ reason: 'empty_target', token: expression }] };
  }

  const entries = raw.split(',');
  const problems: RoleExpressionProblem[] = [];
  const roles: RelayAgentRole[] = [];
  const seen = new Set<RelayAgentRole>();
  let sawAll = false;

  for (const entry of entries) {
    const token = entry.trim();
    if (token === '') {
      problems.push({ reason: 'empty_role_entry', token: entry });
      continue;
    }
    if (isAllTargetWord(token)) {
      sawAll = true;
      continue;
    }
    const role = roleForAlias(token);
    if (role === null) {
      problems.push({ reason: 'unknown_role', token });
      continue;
    }
    if (seen.has(role)) {
      problems.push({ reason: 'duplicate_role', token });
      continue;
    }
    seen.add(role);
    roles.push(role);
  }

  if (sawAll && roles.length > 0) {
    problems.push({ reason: 'all_not_combinable', token: raw });
  }
  if (problems.length > 0) return { ok: false, problems };

  if (sawAll) {
    return {
      ok: true,
      selector: { kind: 'all_eligible_agents', requestedExpression: raw, requestedRoles: [] },
    };
  }
  return {
    ok: true,
    selector: { kind: 'exact_roles', requestedExpression: raw, requestedRoles: roles },
  };
}

/**
 * Could this token START a target expression? Used by the parser to tell
 * `/loop architect fix the bug` (a target plus an objective) from
 * `/loop fix the bug` (an objective that happens to begin with a word).
 *
 * THE RULE: at least ONE comma-separated entry must be a known role word.
 *
 * Why "one" and not "every". `/loop architect,qa implement it` is plainly a
 * target whose second role is wrong, and the user deserves "unknown role: qa"
 * rather than a Loop whose objective silently begins "architect,qa". Requiring
 * every entry to be known would swallow exactly that mistake.
 *
 * WHAT THIS HONESTLY CANNOT DECIDE. When NO entry is a role word,
 * `qa,ops fix it` and `refactor,cleanup the parser` are the same shape, and
 * nothing in the text distinguishes a misspelled target from a prose list.
 * Both are therefore read as objectives. That is a real limit of the grammar,
 * and the alternative — treating any comma list as a target — would reject
 * legitimate objectives. A target that survives here but names nothing real is
 * caught downstream by role resolution against the registry, which is the
 * layer that can actually answer the question.
 */
export function looksLikeTargetExpression(token: string): boolean {
  const raw = token.trim();
  if (raw === '') return false;
  return raw.split(',').some((entry) => {
    const t = entry.trim();
    return t !== '' && (isAllTargetWord(t) || roleForAlias(t) !== null);
  });
}

/** Canonical role list, re-exported so callers need one import for targeting. */
export const RELAY_LOOP_TARGETABLE_ROLES: readonly RelayAgentRole[] = RELAY_AGENT_ROLES;
