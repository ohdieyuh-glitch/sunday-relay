/**
 * WHICH CREDENTIAL THE CODING AGENT WILL ACTUALLY USE, DECIDED BEFORE IT RUNS.
 *
 * WHY THIS EXISTS. The Coding Agent leg has always required `ANTHROPIC_API_KEY`,
 * so founder-operated qualification needed a separately funded Anthropic API
 * balance. Claude Code supports subscription authentication, and the founder holds
 * a Max plan, so a development/qualification run can use the supported
 * subscription path instead. Production keeps the API mode; nothing is replaced.
 *
 * THE ONE THING THAT MAKES THIS PROVABLE. `hostedChildEnv` builds the child's
 * environment from `{}` — an ALLOW-LIST, never a filtered copy of `process.env`.
 * So the child cannot inherit an Anthropic credential by accident: it holds
 * exactly what this module puts there. Subscription mode is therefore not a
 * sanitising pass that might miss a variable, it is the ABSENCE of an entry, which
 * is a structural fact rather than an observation.
 *
 * AND WHY THE OBVIOUS PREFLIGHT WOULD HAVE BEEN VACUOUS. `claude auth status
 * --json` looks like the oracle for "which credential would a request use". It is
 * not. Measured on 2026-09-28 with a FAKE key placed in an otherwise minimal child
 * environment, it still answered `authMethod: "claude.ai"`, `apiProvider:
 * "firstParty"` — the stored login — and the only thing that changed was
 * `subscriptionType`, which went from `"max"` to `null`. A preflight that asked
 * `auth status` whether a key was in play would have answered SUBSCRIPTION while
 * the key was right there. So the authority here is the composed child
 * environment, which Julius owns, and `auth status` is used only for what it does
 * know: whether a subscription login exists at all.
 *
 * NO CREDENTIAL VALUE IS READ, COMPARED, LOGGED OR RETURNED by anything in this
 * file. It works in variable NAMES and in a coarse plan label.
 *
 * PURE. No Node, no clock, no network, no filesystem, no process spawning.
 */

/** The variable that selects the mode. Absent means API mode, as it always was. */
export const JULIUS_CLAUDE_AUTH_ENV = 'JULIUS_CLAUDE_AUTH';

export const CLAUDE_AUTH_MODES = Object.freeze(['ANTHROPIC_API', 'CLAUDE_SUBSCRIPTION'] as const);
export type ClaudeAuthMode = (typeof CLAUDE_AUTH_MODES)[number];

/**
 * EVERY VARIABLE WHOSE PRESENCE WOULD TAKE THE CHILD OFF THE SUBSCRIPTION PATH,
 * whether by billing an API key, by pointing at a gateway, or by switching vendor.
 *
 * `ANTHROPIC_API_KEY` first because Anthropic documents that it takes precedence
 * over subscription authentication, which is the whole hazard. The rest are here
 * because "not billed to the API" is not the same claim as "authenticated by the
 * subscription", and a run that silently went through Bedrock would satisfy the
 * first while failing the second.
 */
export const ANTHROPIC_CREDENTIAL_ENV_NAMES: readonly string[] = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_BEARER_TOKEN_BEDROCK',
]);

export type ClaudeAuthRefusal =
  | 'auth_mode_unknown'
  | 'api_key_missing'
  | 'subscription_would_use_api_key'
  | 'subscription_login_absent'
  | 'subscription_login_not_first_party';

/**
 * Resolve the requested mode. An UNRECOGNISED value is refused rather than
 * defaulted: "JULIUS_CLAUDE_AUTH=subscription" quietly falling back to API mode is
 * exactly the mistake that bills a card nobody meant to use.
 */
export function resolveClaudeAuthMode(
  env: Readonly<Record<string, string | undefined>>,
): { readonly ok: true; readonly mode: ClaudeAuthMode } | { readonly ok: false; readonly refusal: 'auth_mode_unknown'; readonly because: string } {
  const raw = env[JULIUS_CLAUDE_AUTH_ENV];
  if (raw === undefined || raw.trim() === '') return { ok: true, mode: 'ANTHROPIC_API' };
  const value = raw.trim();
  if ((CLAUDE_AUTH_MODES as readonly string[]).includes(value)) {
    return { ok: true, mode: value as ClaudeAuthMode };
  }
  return {
    ok: false, refusal: 'auth_mode_unknown',
    because: `${JULIUS_CLAUDE_AUTH_ENV} is "${value}", which is neither ${CLAUDE_AUTH_MODES.join(' nor ')}. A misspelled mode must not fall back to billing an API key.`,
  };
}

/** What a login probe can say without reading a credential. Shaped after `ClaudeAuthClassification`. */
export interface ClaudeLoginObservation {
  readonly loggedIn: boolean;
  /** `local_subscription` is the only class subscription mode accepts. */
  readonly sourceClass: string;
  /** A coarse plan label only: 'max', 'pro', 'team', 'enterprise' or 'unknown'. Never billing. */
  readonly subscriptionLabel: string;
}

export interface ClaudeAuthDecisionInput {
  readonly mode: ClaudeAuthMode;
  /** Whether an API key was supplied for the child. The VALUE never reaches here. */
  readonly apiKeyProvided: boolean;
  /** The NAMES the composed child environment will carry. Values are never passed. */
  readonly childEnvNames: readonly string[];
  /** Absent in API mode, where no login is consulted. */
  readonly login?: ClaudeLoginObservation;
}

/** How the run authenticated, recorded beside the provider rather than instead of it. */
export interface ClaudeAuthProvenance {
  /** Unchanged by any of this: the provider is still Anthropic. */
  readonly provider: 'ANTHROPIC';
  readonly execution: 'CLAUDE_AGENT_SDK';
  readonly authentication: 'CLAUDE_SUBSCRIPTION' | 'ANTHROPIC_API_KEY';
  /** The coarse plan label, or null in API mode where no plan is involved. */
  readonly plan: string | null;
  readonly apiKeyUsed: boolean;
  /**
   * WHETHER AN ANTHROPIC API COST CAN EXIST FOR THIS RUN.
   *
   * `false` under subscription auth, and that is NOT the same as zero. A recorded
   * $0 would assert that a billing event happened and cost nothing; there is no
   * billing event to report at all, and this repository's rule is that unknown is
   * `null` and never `0`.
   */
  readonly apiCostApplicable: boolean;
}

export type ClaudeAuthDecision =
  | { readonly ok: true; readonly provenance: ClaudeAuthProvenance }
  | { readonly ok: false; readonly refusal: ClaudeAuthRefusal; readonly because: string };

/**
 * FAIL CLOSED. Every path that is not positively established is a refusal, and the
 * refusals carry names a record can quote.
 */
export function decideClaudeAuth(input: ClaudeAuthDecisionInput): ClaudeAuthDecision {
  const refuse = (refusal: ClaudeAuthRefusal, because: string): ClaudeAuthDecision =>
    ({ ok: false, refusal, because });

  /** Which credential-bearing names the child would actually carry. */
  const offending = input.childEnvNames.filter((name) => ANTHROPIC_CREDENTIAL_ENV_NAMES.includes(name));

  if (input.mode === 'ANTHROPIC_API') {
    if (!input.apiKeyProvided) {
      return refuse('api_key_missing', 'API mode was requested and no Anthropic API key was supplied for the Coding Agent.');
    }
    return {
      ok: true,
      provenance: Object.freeze({
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
        authentication: 'ANTHROPIC_API_KEY', plan: null,
        apiKeyUsed: true, apiCostApplicable: true,
      }),
    };
  }

  // SUBSCRIPTION MODE.
  //
  // The structural check comes FIRST and is the one that matters: if the child
  // would carry a credential variable, the request would be billed to it whatever
  // any login probe says. This is the case Anthropic's documented precedence
  // creates, and it is refused before a login is even consulted.
  if (input.apiKeyProvided || offending.length > 0) {
    const named = offending.length > 0 ? offending.join(', ') : 'an API key passed to the child';
    return refuse('subscription_would_use_api_key',
      `Subscription mode was requested but the Coding Agent's environment would carry ${named}, which takes precedence over subscription authentication. Refusing rather than billing an API balance nobody chose.`);
  }

  const login = input.login;
  if (login === undefined || !login.loggedIn) {
    return refuse('subscription_login_absent',
      'Subscription mode was requested and no Claude Code subscription login was observed. A founder must complete the official `claude` login; nothing here may create, copy or persist a credential.');
  }
  if (login.sourceClass !== 'local_subscription') {
    return refuse('subscription_login_not_first_party',
      `Subscription mode was requested and the observed login classifies as "${login.sourceClass}" rather than a first-party subscription. Only the supported claude.ai subscription path is accepted.`);
  }

  return {
    ok: true,
    provenance: Object.freeze({
      provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
      authentication: 'CLAUDE_SUBSCRIPTION',
      plan: login.subscriptionLabel,
      apiKeyUsed: false,
      // No Anthropic API billing event can exist for this run, so there is no cost
      // to report — not a zero cost.
      apiCostApplicable: false,
    }),
  };
}

/** A one-line, secret-free statement for a preflight to print. */
export function claudeAuthLine(provenance: ClaudeAuthProvenance): string {
  return [
    `CLAUDE AUTH: ${provenance.authentication === 'CLAUDE_SUBSCRIPTION' ? 'SUBSCRIPTION' : 'API KEY'}`,
    `provider=${provenance.provider}`,
    `execution=${provenance.execution}`,
    `plan=${provenance.plan ?? 'n/a'}`,
    `api_key_used=${String(provenance.apiKeyUsed)}`,
    `api_cost_applicable=${String(provenance.apiCostApplicable)}`,
  ].join(' ');
}
