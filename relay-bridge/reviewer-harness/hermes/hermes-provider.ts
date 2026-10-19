/**
 * PROVIDER IDENTITY FOR THE HERMES REVIEWER — server-side, and pure.
 *
 * Hermes is the HARNESS. The provider is whoever actually serves the model.
 * The model is an exact id. The existing implementation collapsed all three
 * into "Hermes = xAI = Grok", which was true of the first integration and is
 * not true of the machine this now has to run on: the installed Hermes is
 * authenticated through Anthropic, so a reviewer that hardcodes xAI reports a
 * provider identity nothing checked.
 *
 * This module makes the provider a configured value with two supported
 * implementations. Google and Gemini are deliberately not among them.
 *
 * THE RULE THAT SHAPES EVERY FIELD BELOW: a credential being present is not a
 * provider being verified, and a configured model name is not a verified model
 * identity. Those are three separate facts and this module keeps them apart,
 * because conflating them is how a Reviewer ends up claiming a model answered
 * when nothing ever asked one.
 */

export const HERMES_PROVIDERS = ['anthropic', 'xai'] as const;
export type HermesProviderId = (typeof HERMES_PROVIDERS)[number];

export const HERMES_PROVIDER_ENV = 'RELAY_HERMES_PROVIDER';
export const HERMES_MODEL_ENV = 'RELAY_HERMES_MODEL';

/** The credential variable each provider reads. Names only — never values. */
export const PROVIDER_CREDENTIAL_ENV: Readonly<Record<HermesProviderId, string>> =
  Object.freeze({
    anthropic: 'ANTHROPIC_API_KEY',
    xai: 'XAI_API_KEY',
  });

/**
 * The base-URL variable each provider reads.
 *
 * THIS MAPPING IS THE ONLY AUTHORITY. It exists because the runner used to
 * hardcode the xAI names at its single call site, so an Anthropic-configured
 * Reviewer handed its Anthropic secret to the child as `XAI_API_KEY` and no
 * `ANTHROPIC_API_KEY` at all. That is two faults at once: the run cannot
 * authenticate, and a secret for one vendor is presented under a variable
 * named for another.
 *
 * A caller may not name the variable. It is derived from the provider, here,
 * so the two can never drift apart again.
 */
export const PROVIDER_BASE_URL_ENV: Readonly<Record<HermesProviderId, string>> =
  Object.freeze({
    anthropic: 'ANTHROPIC_BASE_URL',
    xai: 'XAI_BASE_URL',
  });

/** Every provider-scoped variable name, for allowlist and leak assertions. */
export const ALL_PROVIDER_ENV_NAMES: readonly string[] = Object.freeze([
  ...Object.values(PROVIDER_CREDENTIAL_ENV),
  ...Object.values(PROVIDER_BASE_URL_ENV),
]);

/** The variables a run for THIS provider may set, and no others. */
export function providerEnvNames(provider: HermesProviderId): {
  readonly credential: string; readonly baseUrl: string;
} {
  return { credential: PROVIDER_CREDENTIAL_ENV[provider], baseUrl: PROVIDER_BASE_URL_ENV[provider] };
}

/**
 * Whether a provider offers an authenticated, zero-inference way to confirm
 * that THIS credential may use THIS model.
 *
 * xAI does: `GET /v1/models` lists what the authenticated account can reach,
 * costs no tokens, and is already implemented in `xai-models.ts`.
 *
 * Anthropic is marked unverifiable here deliberately. Relay will not invent an
 * endpoint it has not confirmed, and the only honest alternative — sending a
 * tiny inference request — is a paid provider call, which a readiness or
 * test-connection path must never make. So the limitation is represented in
 * the evidence model instead of being papered over: an Anthropic-backed
 * Reviewer can report its credential as present and its runtime as ready, and
 * must report `modelVerified: false` with `provider_unverified` until a real
 * review proves otherwise.
 */
export const PROVIDER_SUPPORTS_LISTING: Readonly<Record<HermesProviderId, boolean>> =
  Object.freeze({ anthropic: false, xai: true });

export type HermesProviderConfigResult =
  | { readonly ok: true; readonly config: HermesProviderConfig }
  | { readonly ok: false; readonly kind: 'configuration_missing'; readonly safeMessage: string };

export interface HermesProviderConfig {
  readonly provider: HermesProviderId;
  /** The exact model id the deployment asked for. Relay never chooses one. */
  readonly requestedModel: string;
  readonly credentialEnvName: string;
  /** A credential VARIABLE is set. Never a claim that it works. */
  readonly credentialPresent: boolean;
  /** Whether this provider can be verified without spending tokens. */
  readonly verifiable: boolean;
}

const isProvider = (value: string): value is HermesProviderId =>
  (HERMES_PROVIDERS as readonly string[]).includes(value);

/**
 * Read provider identity from the server environment.
 *
 * Fails closed on anything missing or unrecognised rather than defaulting to a
 * provider: silently picking one would be exactly the bug this module exists
 * to remove.
 */
export function loadHermesProviderConfig(
  env: NodeJS.ProcessEnv,
): HermesProviderConfigResult {
  const rawProvider = (env[HERMES_PROVIDER_ENV] ?? '').trim();
  if (rawProvider === '') {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `No ${HERMES_PROVIDER_ENV} is configured, and Relay will not choose a Reviewer provider.`,
    };
  }
  if (!isProvider(rawProvider)) {
    return {
      ok: false, kind: 'configuration_missing',
      // The rejected value is NOT echoed: it is operator-supplied text.
      safeMessage: `${HERMES_PROVIDER_ENV} must be one of: ${HERMES_PROVIDERS.join(', ')}.`,
    };
  }
  const requestedModel = (env[HERMES_MODEL_ENV] ?? '').trim();
  if (requestedModel === '') {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `No ${HERMES_MODEL_ENV} is configured, and Relay will not choose a model on your behalf.`,
    };
  }
  const credentialEnvName = PROVIDER_CREDENTIAL_ENV[rawProvider];
  const rawCredential = env[credentialEnvName];
  return {
    ok: true,
    config: {
      provider: rawProvider,
      requestedModel,
      credentialEnvName,
      credentialPresent: typeof rawCredential === 'string' && rawCredential.trim() !== '',
      verifiable: PROVIDER_SUPPORTS_LISTING[rawProvider],
    },
  };
}

/**
 * The only representation of provider config that may leave the server.
 *
 * Note what is absent: the credential, its length, and any hash of it. A hash
 * would let two deployments be compared for equality, which is more than a
 * caller needs to know and more than Relay should tell them.
 */
export interface SafeProviderIdentity {
  readonly provider: HermesProviderId;
  readonly requestedModel: string;
  readonly credentialPresent: boolean;
  readonly verifiable: boolean;
  /** Populated only by a real verification. Never echoed from requestedModel. */
  readonly verifiedModelId: string | null;
}

export function describeProvider(
  config: HermesProviderConfig,
  verifiedModelId: string | null = null,
): SafeProviderIdentity {
  return {
    provider: config.provider,
    requestedModel: config.requestedModel,
    credentialPresent: config.credentialPresent,
    verifiable: config.verifiable,
    // There is deliberately no fallback to requestedModel here.
    verifiedModelId,
  };
}

/**
 * Why a provider could not be verified, when it could not.
 *
 * `provider_unverified` for a provider with no listing mechanism is not a
 * failure of configuration — it is an accurate statement that Relay has no
 * free way to check, and the caller is entitled to know the difference.
 */
export function providerVerificationLimit(
  config: HermesProviderConfig,
): { kind: 'credentials_missing' | 'provider_unverified'; safeMessage: string } | null {
  if (!config.credentialPresent) {
    return {
      kind: 'credentials_missing',
      safeMessage: `No ${config.credentialEnvName} is configured for the Hermes Reviewer service.`,
    };
  }
  if (!config.verifiable) {
    return {
      kind: 'provider_unverified',
      safeMessage:
        `Relay has no token-free way to confirm this ${config.provider} credential may use the requested model, `
        + 'so the model stays unverified until a real review runs.',
    };
  }
  return null;
}
