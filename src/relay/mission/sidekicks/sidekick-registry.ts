import type { SidekickAuthOption, SidekickProvider } from './sidekick-contracts';

/**
 * WHO CAN BE BEHIND A COMPANION — and, just as carefully, how an account is really connected to each one.
 *
 * FOUNDER RULE (2026-09-17): "Do not assume any specific subscription automatically equals a particular API credential.
 * Detect and support the actual official authentication mechanism available for each provider." So each provider here
 * records the mechanisms IT actually offers, in the order this build prefers them, with the plain human step for each --
 * and where a mechanism does not exist, it is absent rather than invented.
 *
 * TWO POPULATIONS, never confused:
 *   DEVELOPMENT PROVIDERS contact nothing. They exist so the whole architecture -- auth, connection, turns, cancellation,
 *   rate limits, quota, malformed answers, reconnection, audit -- is exercised end to end before a single paid call.
 *   Everything they produce is marked SIMULATED for the life of the record.
 *   REAL PROVIDERS reach a real account. None of them is contacted until the founder has completed the real connection
 *   themselves; until then their routes say exactly what is missing.
 */

const option = (
  mechanism: SidekickAuthOption['mechanism'],
  humanStep: string,
  extra: Partial<SidekickAuthOption> = {},
): SidekickAuthOption => ({
  mechanism,
  humanStep,
  available: true,
  unavailableReason: null,
  holdsCredential: mechanism === 'api_credential',
  ...extra,
});

export const SIDEKICK_REGISTRY: readonly SidekickProvider[] = Object.freeze([
  /* ------------------------------------------------------------ the LLM Companion's providers */
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    backs: 'llm_companion',
    development: false,
    auth: [
      option(
        'api_credential',
        'Create an API key in your own OpenAI account at platform.openai.com, then connect it through Julius Connect. It is stored as a reference and never shown again.',
        {
          // TRUE AT THE TIME OF WRITING AND WORTH SAYING OUT LOUD: a ChatGPT subscription is a subscription to ChatGPT.
          // API access is a separate thing on the same account, billed separately. Assuming otherwise would have the
          // founder connect a key they do not have and wonder why nothing works.
          available: false,
          unavailableReason:
            'Waiting for the founder to create and connect an API key. A ChatGPT Plus or Pro subscription does not by itself grant API access -- API use is billed separately on the same account.',
        },
      ),
    ],
    models: [
      { modelId: 'gpt-4.1', label: 'GPT-4.1', purpose: 'The everyday conversational companion.' },
      { modelId: 'gpt-4.1-mini', label: 'GPT-4.1 mini', purpose: 'Faster and cheaper, for short exchanges.' },
    ],
    notThis:
      'A conversational companion. It holds no authority in Wonderland: it cannot run a mission, spend anything, or act on the world. Julius remains the mission authority.',
  },

  /* ------------------------------------------------------------ Jhinn's providers */
  {
    providerId: 'claude-code',
    displayName: 'Claude Code',
    backs: 'single_agent',
    development: false,
    auth: [
      option(
        'account_cli',
        "Sign in to Claude Code on this machine with its own login, the way you would to use it yourself. Wonderland then asks that tool to work; it never sees your credential, because the tool keeps its own.",
        {
          available: false,
          unavailableReason:
            'Waiting for the founder to sign in to Claude Code on this machine with its official flow, and for this build to confirm the tool answers.',
          holdsCredential: false,
        },
      ),
      option(
        'api_credential',
        'Or connect an Anthropic API key from your own console.anthropic.com account through Julius Connect, stored as a reference.',
        {
          available: false,
          unavailableReason: 'Only needed if you would rather not sign the tool in on this machine. Not connected.',
        },
      ),
    ],
    models: [
      { modelId: 'claude-code-default', label: "Claude Code's own model", purpose: 'Whatever model the signed-in Claude Code uses; it chooses, not Wonderland.' },
    ],
    notThis:
      'A SINGLE agent: one scoped piece of work at a time, inside the folder it was given, reporting back. It is not Julius, it does not orchestrate missions, and connecting it grants it no mission authority.',
  },

  /* ------------------------------------------------------------ development providers */
  {
    providerId: 'dev-companion',
    displayName: 'Companion (development)',
    backs: 'llm_companion',
    development: true,
    auth: [option('api_credential', 'Nothing to sign in to: this stand-in contacts nothing and answers from a fixture.', { holdsCredential: false })],
    models: [
      { modelId: 'fixture-chat', label: 'Fixture chat', purpose: 'Deterministic answers, so the whole path can be seen without a provider.' },
      { modelId: 'fixture-chat-slow', label: 'Fixture chat (slow)', purpose: 'The same, but slow enough to watch thinking and cancellation.' },
    ],
    notThis: 'Not a model. A deterministic stand-in whose every answer is marked SIMULATED, so it can never be mistaken for one.',
  },
  {
    providerId: 'dev-single-agent',
    displayName: 'Single Agent (development)',
    backs: 'single_agent',
    development: true,
    auth: [option('account_cli', 'Nothing to sign in to: this stand-in performs scoped work against a fixture and contacts nothing.', { holdsCredential: false })],
    models: [{ modelId: 'fixture-agent', label: 'Fixture agent', purpose: 'Deterministic scoped work: inspect, change, run, report.' }],
    notThis: 'Not an agent. A deterministic stand-in for one, so the bounded-work path is exercised before anything real runs.',
  },
] satisfies readonly SidekickProvider[]);

export function findProvider(providerId: string, registry: readonly SidekickProvider[] = SIDEKICK_REGISTRY): SidekickProvider | null {
  return registry.find((provider) => provider.providerId === providerId) ?? null;
}

/** Every provider that can be behind a kind of sidekick, development ones last: real first, where a real one exists. */
export function providersFor(kind: SidekickProvider['backs'], registry: readonly SidekickProvider[] = SIDEKICK_REGISTRY): readonly SidekickProvider[] {
  return registry.filter((provider) => provider.backs === kind).sort((a, b) => Number(a.development) - Number(b.development));
}

/**
 * THE PROVIDER A SIDEKICK FALLS BACK TO when no real account is connected: the development stand-in for its kind. This
 * is the honest default -- a companion with nothing behind it is SIMULATED and says so, rather than appearing broken or,
 * worse, appearing real.
 */
export function developmentProviderFor(kind: SidekickProvider['backs'], registry: readonly SidekickProvider[] = SIDEKICK_REGISTRY): SidekickProvider {
  const found = registry.find((provider) => provider.backs === kind && provider.development);
  if (found === undefined) {
    throw new Error(`no development provider for ${kind}`);
  }
  return found;
}
