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
 * THE SETUP-TOKEN PATH (2026-09-29). A GitHub runner has no stored login, so the
 * founder's subscription reaches it as a `claude setup-token` token in
 * `CLAUDE_CODE_OAUTH_TOKEN` — the one credential variable subscription mode admits
 * into the child, and never admits in API mode. Every higher-precedence name in
 * `ANTHROPIC_CREDENTIAL_ENV_NAMES` must still be absent. The login observation is
 * taken by running `auth status` in the SAME composed environment the child gets
 * (`hosted-login-probe.ts`) and classified by `classifyClaudeAuthStatus` below.
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

/**
 * THE ONE CREDENTIAL VARIABLE SUBSCRIPTION MODE MAY CARRY INTO THE CHILD.
 *
 * `claude setup-token` mints a long-lived OAuth token for a Pro/Max subscription,
 * and Claude Code and the Agent SDK read it from this variable. It is how the
 * subscription reaches a machine with no stored `claude` login — a GitHub runner
 * above all. Anthropic documents its precedence as BELOW `ANTHROPIC_AUTH_TOKEN`,
 * `ANTHROPIC_API_KEY` and `apiKeyHelper` (and below cloud-provider credentials), so
 * it authenticates the child only while every name in
 * `ANTHROPIC_CREDENTIAL_ENV_NAMES` is absent — which the structural check below
 * already requires.
 *
 * It is NEVER placed in an API-mode child: there it would be a second credential
 * nobody chose, and the record would no longer say which one a request used.
 */
export const CLAUDE_SUBSCRIPTION_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

/**
 * AN EXPLICIT CODING AGENT EXECUTABLE, honoured by BOTH the login probe and the
 * runner (as the SDK's `pathToClaudeCodeExecutable`), so the binary observed is the
 * binary executed. Absent — the normal case — both use the executable the Agent SDK
 * bundles.
 */
export const CODER_CLAUDE_EXECUTABLE_ENV = 'JULIUS_CODER_CLAUDE_EXECUTABLE';

/**
 * THE LOGIN CLASSES SUBSCRIPTION MODE ACCEPTS, and provenance names which one.
 *   - `local_subscription`: the stored claude.ai login on this machine (`authMethod: "claude.ai"`).
 *   - `subscription_oauth_token`: a `claude setup-token` token supplied as
 *     `CLAUDE_CODE_OAUTH_TOKEN` (`authMethod: "oauth_token"`).
 */
export const SUBSCRIPTION_LOGIN_SOURCES = Object.freeze(['local_subscription', 'subscription_oauth_token'] as const);
export type SubscriptionLoginSource = (typeof SUBSCRIPTION_LOGIN_SOURCES)[number];

export type ClaudeAuthRefusal =
  | 'auth_mode_unknown'
  | 'api_key_missing'
  | 'api_mode_would_carry_subscription_token'
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
  /** Only a `SUBSCRIPTION_LOGIN_SOURCES` class is accepted by subscription mode. */
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
  /**
   * WHICH SUBSCRIPTION CREDENTIAL the run authenticated with: the stored login or
   * the setup-token OAuth token. Null in API mode. A class name, never a value.
   */
  readonly credentialSource: SubscriptionLoginSource | null;
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
    // API mode is its own capability and stays exactly that: a subscription token
    // beside the key would be a second credential in the child, and the record
    // could no longer say which one a request used.
    if (input.childEnvNames.includes(CLAUDE_SUBSCRIPTION_TOKEN_ENV)) {
      return refuse('api_mode_would_carry_subscription_token',
        `API mode was requested but the Coding Agent's environment would also carry ${CLAUDE_SUBSCRIPTION_TOKEN_ENV}. API mode takes the API key alone.`);
    }
    return {
      ok: true,
      provenance: Object.freeze({
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
        authentication: 'ANTHROPIC_API_KEY', plan: null, credentialSource: null,
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
  if (!(SUBSCRIPTION_LOGIN_SOURCES as readonly string[]).includes(login.sourceClass)) {
    return refuse('subscription_login_not_first_party',
      `Subscription mode was requested and the observed login classifies as "${login.sourceClass}" rather than a first-party subscription. Only the supported claude.ai login or a setup-token subscription token is accepted.`);
  }
  // The token path is accepted only when the child would actually carry the token;
  // an observation that claims one without the variable was not taken in this child.
  if (login.sourceClass === 'subscription_oauth_token' && !input.childEnvNames.includes(CLAUDE_SUBSCRIPTION_TOKEN_ENV)) {
    return refuse('subscription_login_absent',
      `Subscription mode observed a subscription token, but the Coding Agent's environment would not carry ${CLAUDE_SUBSCRIPTION_TOKEN_ENV}. The observation must be taken in the child's own environment.`);
  }

  return {
    ok: true,
    provenance: Object.freeze({
      provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
      authentication: 'CLAUDE_SUBSCRIPTION',
      plan: login.subscriptionLabel,
      credentialSource: login.sourceClass as SubscriptionLoginSource,
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

/**
 * Which subscription credential, on its own line so the `CLAUDE AUTH:` line keeps
 * the exact shape the evidence allow-list and the local launcher already pin.
 */
export function claudeAuthSourceLine(provenance: ClaudeAuthProvenance): string {
  return `claude auth source: ${provenance.credentialSource ?? 'anthropic_api_key'}`;
}

/**
 * CLASSIFY THE OUTPUT OF `claude auth status --json`, TAKEN IN THE CHILD'S OWN ENVIRONMENT.
 *
 * PURE: it is handed the CLI's stdout and returns a class and a plan label. The raw
 * text is never returned, stored or echoed; nothing but the closed fields below is
 * read from it.
 *
 * MEASURED on 2026-09-29 with the CLI the Agent SDK bundles (2.1.220) and the
 * workstation CLI (2.1.284), using ONLY FAKE placeholder values in an otherwise
 * minimal environment — no real credential was used, created or read:
 *   - token only:            `loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty"`,
 *                            and NO `subscriptionType` field;
 *   - token + API key:       2.1.220 kept `authMethod: "oauth_token"` but added
 *                            `apiKeySource: "ANTHROPIC_API_KEY"`; 2.1.284 answered
 *                            `authMethod: "api_key"` with the same `apiKeySource`;
 *   - token + AUTH_TOKEN:    STILL `authMethod: "oauth_token"` with no `apiKeySource` —
 *                            `auth status` does not see `ANTHROPIC_AUTH_TOKEN` at all;
 *   - stored login, no token: `authMethod: "claude.ai"`, `subscriptionType: "max"`.
 * The CLI did not validate the fake token (exit 0, offline), so `auth status` proves
 * which PATH the child would take, not that the token is live. That is why the
 * structural check on the composed environment stays the authority for "no API
 * credential", and this classifier only says whether a subscription path exists.
 *
 * ASSUMPTION, LABELLED: a REAL setup-token token was not available to measure. The
 * classifier assumes it reports `authMethod: "oauth_token"` like the placeholder did,
 * and that `subscriptionType` may be absent (the plan label is then `unknown`, never
 * guessed). If a real token reports `"claude.ai"` instead, it is still accepted, as a
 * first-party subscription login.
 */
export function classifyClaudeAuthStatus(raw: string | null): ClaudeLoginObservation {
  const absent: ClaudeLoginObservation = Object.freeze({ loggedIn: false, sourceClass: 'not_logged_in', subscriptionLabel: 'unknown' });
  if (raw === null || raw.trim() === '') return absent;
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...absent, sourceClass: 'unknown' };
    parsed = value as Record<string, unknown>;
  } catch {
    return { ...absent, sourceClass: 'unknown' };
  }
  const loggedIn = parsed.loggedIn === true;
  const method = typeof parsed.authMethod === 'string' ? parsed.authMethod.toLowerCase() : '';
  const provider = typeof parsed.apiProvider === 'string' ? parsed.apiProvider.toLowerCase() : '';
  const keySource = typeof parsed.apiKeySource === 'string' ? parsed.apiKeySource.trim() : '';
  const plan = typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType.toLowerCase() : '';
  const subscriptionLabel = ['max', 'pro', 'team', 'enterprise'].includes(plan) ? plan : 'unknown';

  let sourceClass: string;
  if (!loggedIn) sourceClass = 'not_logged_in';
  // ANY API-key source outranks the login it sits beside, whatever `authMethod` says.
  else if (keySource !== '' && keySource.toLowerCase() !== 'none') sourceClass = 'api_key';
  else if (provider !== 'firstparty') sourceClass = provider.includes('bedrock') ? 'bedrock' : provider.includes('vertex') ? 'vertex' : 'third_party';
  else if (method === 'oauth_token') sourceClass = 'subscription_oauth_token';
  else if (method === 'claude.ai') sourceClass = 'local_subscription';
  else if (method.includes('api')) sourceClass = 'api_key';
  else sourceClass = 'unknown';
  return Object.freeze({ loggedIn, sourceClass, subscriptionLabel });
}
