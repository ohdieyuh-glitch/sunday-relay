import type { ProviderAsk, ProviderResult, SidekickProviderPort } from './sidekick-ports';

/**
 * THE LLM COMPANION, BACKED BY A REAL OPENAI ACCOUNT — built, and unable to spend anything until the founder says so.
 *
 * FOUNDER DIRECTIVE (2026-09-17): the LLM Companion is to become an actual conversational companion; build everything
 * around the live connection provider-free first; do not use paid calls until the founder personally completes the real
 * provider connection.
 *
 * THE AUTH ROUTE, AS IT REALLY IS. OpenAI's official mechanism for an application like this is an API key created in the
 * founder's own account at platform.openai.com. That is a different thing from a ChatGPT subscription: a Plus or Pro
 * subscription does not by itself grant API access, and assuming otherwise would have the founder hunting for a key he
 * has not made. So the key is the route, and it is connected through Julius Connect's own vault -- never typed into a
 * terminal, a chat, the Unreal console, a log or a source file.
 *
 * WHAT THIS PROCESS EVER SEES. A credential REFERENCE from the domain, and, at the moment of a call, the material
 * resolved from the vault inside this function and used once. It is never written to a log line, never put on the view
 * Wonderland reads, and never included in an audit detail.
 *
 * TWO LOCKS, AND BOTH MUST BE OPEN:
 *   1. A key must actually be connected (resolved through the vault by reference).
 *   2. WONDERLAND_SIDEKICK_LIVE must be 1. A connected key is not consent to spend: until the founder sets that, this
 *      refuses with AUTH_REQUIRED and no request is made.
 */

export interface OpenAiCompanionOptions {
  /**
   * Resolve the credential, by reference, at the moment of a call. Returns null when nothing is connected. The vault
   * lives in the Julius Connect runtime; this never holds the material between calls.
   */
  readonly resolveKey: () => string | null;
  readonly baseUrl?: string;
  readonly liveEnvVar?: string;
  /** For tests: something that behaves like fetch. Nothing is stubbed in the real path. */
  readonly fetchImpl?: typeof fetch;
}

export function createOpenAiCompanion(options: OpenAiCompanionOptions): SidekickProviderPort {
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  const liveEnvVar = options.liveEnvVar ?? 'WONDERLAND_SIDEKICK_LIVE';
  const doFetch = options.fetchImpl ?? fetch;
  const isLive = (): boolean => process.env[liveEnvVar] === '1';

  return {
    providerId: 'openai',

    async reachable() {
      const key = options.resolveKey();
      if (key === null) {
        return {
          ok: false,
          failure: 'AUTH_REQUIRED',
          detail:
            'No OpenAI key is connected. Create one in your own account at platform.openai.com and connect it through Julius Connect. A ChatGPT subscription does not by itself grant API access.',
        };
      }
      if (!isLive()) {
        return {
          ok: false,
          failure: 'AUTH_REQUIRED',
          detail: `A key is connected, but Wonderland has not been told it may spend on it. The founder sets ${liveEnvVar}=1 for this runtime when he is ready; until then no request is made.`,
        };
      }
      // A REACHABILITY CHECK THAT COSTS NOTHING: listing models is not a completion and is not billed as one.
      try {
        const response = await doFetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, failure: 'AUTH_REQUIRED', detail: 'OpenAI refused the connected key. Connect a valid one through Julius Connect.' };
        }
        if (!response.ok) {
          return { ok: false, failure: 'PROVIDER_ERROR', detail: `OpenAI answered ${response.status} when asked what models the account has.` };
        }
        return { ok: true, detail: 'The connected OpenAI account answered.' };
      } catch (error) {
        return { ok: false, failure: 'PROVIDER_ERROR', detail: `Could not reach OpenAI: ${String(error).slice(0, 160)}` };
      }
    },

    async ask(input: ProviderAsk): Promise<ProviderResult> {
      const key = options.resolveKey();
      if (key === null) {
        return { ok: false, failure: 'AUTH_REQUIRED', detail: 'Nothing was sent: no OpenAI key is connected.' };
      }
      if (!isLive()) {
        return { ok: false, failure: 'AUTH_REQUIRED', detail: `Nothing was sent: Wonderland has not been allowed to spend on this account yet (${liveEnvVar} is not set).` };
      }
      const started = Date.now();
      const messages = [
        {
          role: 'system',
          content:
            'You are the LLM Companion who floats beside a visitor in Wonderland. You converse, explain and think things through with them. You hold no authority in Wonderland: you do not run missions, spend anything, or act on the world. Julius, the compound agent, is the mission authority, and Jhinn is a separate single agent that does scoped work. Be brief unless asked for more.',
        },
        ...input.history.flatMap((turn) => [
          { role: 'user', content: turn.ask },
          { role: 'assistant', content: turn.answer },
        ]),
        { role: 'user', content: input.ask },
      ];

      try {
        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: input.modelId, messages, stream: true }),
          signal: input.signal,
        });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, failure: 'AUTH_REQUIRED', detail: 'OpenAI refused the connected key.' };
        }
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after') ?? '0') * 1000;
          // A 429 IS TWO DIFFERENT THINGS, and the account cares which: too fast, or nothing left to spend.
          const said = await response.text().catch(() => '');
          const exhausted = /insufficient_quota|billing|credit/i.test(said);
          return exhausted
            ? { ok: false, failure: 'QUOTA_EXHAUSTED', detail: 'The connected OpenAI account has no credit or quota left.' }
            : { ok: false, failure: 'RATE_LIMITED', detail: 'OpenAI asked us to slow down.', retryAfterMs: retryAfter > 0 ? retryAfter : undefined };
        }
        if (!response.ok || response.body === null) {
          return { ok: false, failure: 'PROVIDER_ERROR', detail: `OpenAI answered ${response.status}.` };
        }

        // STREAMED, so the terminal and the body move while the model is still talking.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rest = '';
        let answer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          rest += decoder.decode(value, { stream: true });
          const lines = rest.split('\n');
          rest = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const event = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const piece = event.choices?.[0]?.delta?.content;
              if (typeof piece === 'string' && piece.length > 0) {
                answer += piece;
                input.onChunk({ text: answer });
              }
            } catch {
              // A chunk this build cannot read is not shown as though it were part of the answer.
              return { ok: false, failure: 'MALFORMED', detail: 'OpenAI sent a chunk this build could not read, so none of it is shown.' };
            }
          }
          if (Date.now() - started > input.timeoutMs) {
            return { ok: false, failure: 'TIMEOUT', detail: 'OpenAI did not finish in time.' };
          }
        }
        if (answer.trim().length === 0) {
          return { ok: false, failure: 'MALFORMED', detail: 'OpenAI finished without saying anything.' };
        }
        return { ok: true, answer, modelId: input.modelId, ms: Date.now() - started };
      } catch (error) {
        if (input.signal.aborted) {
          return { ok: false, failure: 'CANCELLED', detail: 'Stopped before the answer finished.' };
        }
        return { ok: false, failure: 'PROVIDER_ERROR', detail: `Could not reach OpenAI: ${String(error).slice(0, 160)}` };
      }
    },
  };
}
