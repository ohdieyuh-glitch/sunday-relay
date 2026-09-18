import {
  JHINN,
  LLM_COMPANION,
  askSidekick,
  changeModel,
  completeConnection,
  connectSidekick,
  disconnectSidekick,
  emptySidekickWorld,
  failTurn,
  SIDEKICK_REGISTRY,
  findProvider,
  findSidekick,
  finishTurn,
  liveTurn,
  markTurn,
  mascotOf,
  recoverInterruptedTurns,
  type SidekickClock,
  type SidekickFailure,
  type SidekickWorld,
} from '../../src/relay/mission/sidekicks';
import { fail, ok, relayError, type RelayResult } from '../../src/relay/protocol/errors';
import { createClaudeCodeAgent } from './claude-code-agent';
import { createFixtureAgent, createFixtureCompanion } from './fixture-providers';
import { createOpenAiCompanion } from './openai-companion';
import type { AgentProviderPort, SidekickProviderPort } from './sidekick-ports';

/**
 * THE SIDEKICK SERVICE — one place where the companions are actually alive.
 *
 * The domain holds the rules; this holds the clock, the providers and the turns in flight. Wonderland is a VIEW of it:
 * the terminals and the bodies read this and decide nothing, exactly as the Connections window reads Julius Connect.
 *
 * WHAT IT WILL NOT DO. It will not contact a real provider that the founder has not connected; it will not answer as a
 * provider when none is there; and it will not let a sidekick take mission authority, which is Julius's alone.
 */

export const SIDEKICK_SERVICE_SCHEMA = 'relay-sidekicks-service.v1' as const;

export interface SidekickServiceOptions {
  readonly now?: () => Date;
  /** How long a turn may take before it is given up on. */
  readonly timeoutMs?: number;
  /** How long a rate-limited companion waits before it is CONNECTED again. */
  readonly rateLimitMs?: number;
  /**
   * The providers this service can actually use. Development stand-ins are always here; a real one appears only when it
   * has been built AND the founder has connected it.
   */
  readonly companions?: readonly SidekickProviderPort[];
  readonly agents?: readonly AgentProviderPort[];
  /**
   * How the OpenAI key is resolved, by reference, at the moment of a call. The founder connects it through Julius
   * Connect and the vault answers here; with nothing connected this returns null and the companion stays AUTH_REQUIRED.
   * It is never held between calls and never reaches a log or a view.
   */
  readonly resolveOpenAiKey?: () => string | null;
}

export interface SidekickServiceView {
  readonly schema: typeof SIDEKICK_SERVICE_SCHEMA;
  readonly revision: number;
  readonly sidekicks: readonly {
    readonly sidekickId: string;
    readonly kind: string;
    readonly state: string;
    readonly mascot: string;
    readonly providerId: string;
    readonly providerName: string;
    readonly modelId: string;
    readonly mode: 'SIMULATED' | 'REAL';
    readonly note: string;
    readonly authority: string;
    readonly sessionId: string | null;
    readonly turns: number;
    readonly live: { readonly turnId: string; readonly state: string; readonly ask: string; readonly answer: string } | null;
    readonly lastAnswer: string;
    readonly failure: string | null;
  }[];
  readonly audit: readonly { readonly at: string; readonly sidekickId: string; readonly action: string; readonly mode: string; readonly outcome: string; readonly detail: string }[];
  /**
   * WHAT IS ACTUALLY ON THIS MACHINE, as found by asking rather than by assuming. Each real provider says whether it is
   * reachable and what is missing -- the tool not installed, an account not signed in, or live use not yet allowed --
   * so the founder is told the true next step instead of a sentence written months ago.
   */
  readonly providers: readonly { readonly providerId: string; readonly displayName: string; readonly backs: string; readonly ready: boolean; readonly detail: string; readonly checkedAt: string | null }[];
}

export interface SidekickService {
  view(): SidekickServiceView;
  intent(body: unknown): RelayResult<SidekickServiceView>;
  tick(): void;
  close(): Promise<void>;
}

const TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

function field(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

function text(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

export function createSidekickService(options: SidekickServiceOptions = {}): SidekickService {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 60_000;
  const rateLimitMs = options.rateLimitMs ?? 5_000;
  const clock = (): SidekickClock => ({ at: now().toISOString() });

  // THE REAL PROVIDERS ARE HERE AND CANNOT SPEND. Both refuse with AUTH_REQUIRED until the founder has connected his own
  // account AND allowed live use; the development stand-ins do the whole path meanwhile.
  const companions: SidekickProviderPort[] = [
    ...(options.companions ?? []),
    createOpenAiCompanion({ resolveKey: options.resolveOpenAiKey ?? (() => null) }),
    createFixtureCompanion(),
    createFixtureCompanion({ slowMs: 4000 }),
  ];
  const agents: AgentProviderPort[] = [...(options.agents ?? []), createClaudeCodeAgent(), createFixtureAgent()];

  let world: SidekickWorld = emptySidekickWorld(clock());
  let revision = 1;
  const inFlight = new Map<string, AbortController>();
  const rateLimitedUntil = new Map<string, number>();
  /** What each real provider said when it was last asked whether it is there. Nothing is contacted to find out. */
  const probed = new Map<string, { ready: boolean; detail: string; checkedAt: string }>();

  const changed = () => {
    revision += 1;
  };

  const apply = (result: RelayResult<SidekickWorld>): RelayResult<SidekickWorld> => {
    if (result.ok) {
      world = result.value;
      changed();
    }
    return result;
  };

  /** The port behind a sidekick right now, or null when its provider is not one this service can drive. */
  const portFor = (sidekickId: string): { companion?: SidekickProviderPort; agent?: AgentProviderPort } => {
    const sidekick = findSidekick(world, sidekickId);
    if (sidekick === null) return {};
    if (sidekick.kind === 'llm_companion') {
      // The slow fixture is the same provider id with a different model, so the model chooses the pace.
      const slow = sidekick.modelId.endsWith('-slow');
      const found = companions.filter((port) => port.providerId === sidekick.providerId);
      return { companion: slow ? found[found.length - 1] : found[0] };
    }
    return { agent: agents.find((port) => port.providerId === sidekick.providerId) };
  };

  /** Run one turn against whatever is behind this sidekick, streaming as it goes. */
  const runTurn = (sidekickId: string): void => {
    const sidekick = findSidekick(world, sidekickId);
    const turn = sidekick === null ? null : liveTurn(sidekick);
    if (sidekick === null || turn === null || sidekick.session === null) return;
    const { companion, agent } = portFor(sidekickId);
    const controller = new AbortController();
    inFlight.set(sidekickId, controller);

    const history = sidekick.session.turns
      .filter((row) => row.turnId !== turn.turnId && row.state === 'DONE')
      .map((row) => ({ ask: row.ask, answer: row.answer }));

    const common = {
      sessionId: sidekick.session.sessionId,
      turnId: turn.turnId,
      modelId: sidekick.modelId,
      ask: turn.ask,
      history,
      timeoutMs,
      onChunk: (chunk: { text: string }) => {
        apply(markTurn(world, { sidekickId, state: 'STREAMING', answer: chunk.text }));
      },
      signal: controller.signal,
    };

    apply(markTurn(world, { sidekickId, state: 'THINKING' }));

    const promise =
      agent !== undefined
        ? agent.work({
            ...common,
            // BOUNDED BY CONSTRUCTION. A single agent works in one folder with one allowance, and the task cannot widen it.
            workingDirectory: process.env.WONDERLAND_AGENT_DIR ?? process.cwd(),
            allow: ['read'],
          })
        : companion !== undefined
          ? companion.ask(common)
          : Promise.resolve({ ok: false as const, failure: 'REFUSED' as SidekickFailure, detail: 'No provider is behind this companion in this build.' });

    void promise
      .catch((error: unknown) => ({ ok: false as const, failure: 'PROVIDER_ERROR' as SidekickFailure, detail: String(error).slice(0, 200) }))
      .then((result) => {
        inFlight.delete(sidekickId);
        if (result.ok) {
          apply(finishTurn(world, { sidekickId, answer: result.answer, ms: result.ms }, clock()));
          return;
        }
        if (result.failure === 'RATE_LIMITED') {
          rateLimitedUntil.set(sidekickId, now().getTime() + ('retryAfterMs' in result && typeof result.retryAfterMs === 'number' ? result.retryAfterMs : rateLimitMs));
        }
        apply(failTurn(world, { sidekickId, failure: result.failure, detail: result.detail }, clock()));
      });
  };

  const view = (): SidekickServiceView => ({
    schema: SIDEKICK_SERVICE_SCHEMA,
    revision,
    sidekicks: world.sidekicks.map((sidekick) => {
      const provider = findProvider(sidekick.providerId);
      const turn = liveTurn(sidekick);
      const done = sidekick.session?.turns.filter((row) => row.state === 'DONE') ?? [];
      return {
        sidekickId: sidekick.sidekickId,
        kind: sidekick.kind,
        state: sidekick.state,
        mascot: mascotOf(world, sidekick.sidekickId),
        providerId: sidekick.providerId,
        providerName: provider?.displayName ?? sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        note: sidekick.note,
        authority: sidekick.kind === 'llm_companion' ? 'conversation' : 'scoped_work',
        sessionId: sidekick.session?.sessionId ?? null,
        turns: sidekick.session?.turns.length ?? 0,
        live: turn === null ? null : { turnId: turn.turnId, state: turn.state, ask: turn.ask, answer: turn.answer },
        lastAnswer: done.length > 0 ? done[done.length - 1].answer : '',
        failure: sidekick.failure,
      };
    }),
    audit: world.audit.slice(0, 40).map((row) => ({ at: row.at, sidekickId: row.sidekickId, action: row.action, mode: row.mode, outcome: row.outcome, detail: row.detail })),
    providers: SIDEKICK_REGISTRY.filter((provider) => !provider.development).map((provider) => {
      const found = probed.get(provider.providerId);
      return {
        providerId: provider.providerId,
        displayName: provider.displayName,
        backs: provider.backs,
        ready: found?.ready ?? false,
        detail: found?.detail ?? 'Not looked for yet. Ask for a probe to find out what is on this machine.',
        checkedAt: found?.checkedAt ?? null,
      };
    }),
  });

  return {
    view,
    intent(body) {
      const intent = field(body, 'intent');
      const sidekickId = field(body, 'sidekickId') ?? LLM_COMPANION;
      if (intent === null) {
        return fail(relayError('validation-failed', 'An intent needs a name.'));
      }
      switch (intent) {
        case 'connect': {
          const providerId = field(body, 'providerId');
          if (providerId === null) return fail(relayError('validation-failed', 'connect needs a providerId.'));
          const result = apply(connectSidekick(world, { sidekickId, providerId, modelId: field(body, 'modelId') ?? undefined }, clock()));
          return result.ok ? ok(view()) : result;
        }
        case 'disconnect': {
          inFlight.get(sidekickId)?.abort();
          const result = apply(disconnectSidekick(world, { sidekickId }, clock()));
          return result.ok ? ok(view()) : result;
        }
        case 'ask': {
          const ask = text(body, 'ask');
          if (ask === null) return fail(relayError('validation-failed', 'ask needs something to say.'));
          const result = apply(askSidekick(world, { sidekickId, ask }, clock()));
          if (!result.ok) return result;
          // Only run if the domain actually opened a turn: a refused ask (a secret, say) opens none.
          const sidekick = findSidekick(world, sidekickId);
          if (sidekick !== null && sidekick.liveTurnId !== null) {
            runTurn(sidekickId);
          }
          return ok(view());
        }
        case 'cancel': {
          const controller = inFlight.get(sidekickId);
          if (controller === undefined) return fail(relayError('illegal-transition', 'There is nothing in flight to cancel.'));
          controller.abort();
          return ok(view());
        }
        case 'model': {
          const modelId = field(body, 'modelId');
          if (modelId === null) return fail(relayError('validation-failed', 'model needs a modelId.'));
          const result = apply(changeModel(world, { sidekickId, modelId }, clock()));
          return result.ok ? ok(view()) : result;
        }
        case 'probe': {
          // ASKING IS FREE. Each real provider is asked whether it is there -- a version check, a models listing -- and
          // says what is missing. No completion is requested and nothing is spent.
          for (const provider of SIDEKICK_REGISTRY.filter((row) => !row.development)) {
            const port: { reachable: SidekickProviderPort['reachable'] } | undefined =
              companions.find((row) => row.providerId === provider.providerId) ?? agents.find((row) => row.providerId === provider.providerId);
            if (port === undefined) {
              probed.set(provider.providerId, { ready: false, detail: 'This build has no adapter for that provider.', checkedAt: now().toISOString() });
              continue;
            }
            void port.reachable().then((reach) => {
              probed.set(provider.providerId, { ready: reach.ok, detail: reach.detail, checkedAt: now().toISOString() });
              changed();
            });
          }
          return ok(view());
        }
        case 'reset': {
          for (const controller of inFlight.values()) controller.abort();
          inFlight.clear();
          rateLimitedUntil.clear();
          world = emptySidekickWorld(clock());
          changed();
          return ok(view());
        }
        default:
          return fail(relayError('validation-failed', `Unknown intent ${intent}. Known: connect, disconnect, ask, cancel, model, probe, reset.`));
      }
    },
    tick() {
      const t = now().getTime();
      // A rate-limited companion comes back on its own, because that is what a rate limit is: a wait, not a break.
      for (const [sidekickId, until] of rateLimitedUntil) {
        if (t >= until) {
          rateLimitedUntil.delete(sidekickId);
          const sidekick = findSidekick(world, sidekickId);
          if (sidekick !== null && sidekick.state === 'RATE_LIMITED') {
            apply(failTurn(world, { sidekickId, failure: 'CANCELLED', detail: 'The pause is over; the companion is ready again.' }, clock()));
          }
        }
      }
      // A connection that is still opening: ask the provider whether it is really there.
      for (const sidekick of world.sidekicks) {
        if (sidekick.state !== 'CONNECTING') continue;
        const { companion, agent } = portFor(sidekick.sidekickId);
        const port = companion ?? agent;
        if (port === undefined) {
          apply(failTurn(world, { sidekickId: sidekick.sidekickId, failure: 'REFUSED', detail: 'No provider of that name is available in this build.' }, clock()));
          continue;
        }
        void port.reachable().then((reach) => {
          if (reach.ok) {
            apply(completeConnection(world, { sidekickId: sidekick.sidekickId, credentialRef: null }, clock()));
          } else {
            apply(failTurn(world, { sidekickId: sidekick.sidekickId, failure: reach.failure, detail: reach.detail }, clock()));
          }
        });
      }
    },
    async close() {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      // A TURN LEFT IN FLIGHT IS LOST, NOT RESUMED: the world says so rather than coming back mid-thought.
      world = recoverInterruptedTurns(world, clock());
      for (const port of [...companions, ...agents]) {
        await port.close?.();
      }
    },
  };
}

export { JHINN, LLM_COMPANION };
