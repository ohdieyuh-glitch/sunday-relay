import type { AgentProviderPort, AgentTask, ProviderAsk, ProviderResult, SidekickProviderPort } from './sidekick-ports';

/**
 * THE DEVELOPMENT PROVIDERS — deterministic, provider-free, and honest about being so.
 *
 * FOUNDER DIRECTIVE (2026-09-17): "Use deterministic fixtures first." Every part of the architecture that a real provider
 * will exercise is exercised here first: streaming, cancellation, timeouts, rate limits, exhausted quota, a malformed
 * answer, a provider that has gone away. They contact nothing, cost nothing, and everything they produce is marked
 * SIMULATED by the domain for the life of the record.
 *
 * THEY ARE NOT IMPERSONATIONS. A fixture companion does not pretend to be a model: it answers in its own voice, says it
 * is a fixture, and answers the same way every time so a proof can be believed.
 */

const sleep = (ms: number, signal: AbortSignal): Promise<'slept' | 'cancelled'> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve('cancelled');
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve('slept');
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve('cancelled');
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * THE WORD THAT MAKES A FIXTURE MISBEHAVE. A proof needs to see a rate limit, an empty account and a broken answer, and
 * the only honest way to see them without a provider is to ask for them deliberately.
 */
const TROUBLE: ReadonlyArray<readonly [RegExp, ProviderResult]> = [
  [/\brate.?limit\b/i, { ok: false, failure: 'RATE_LIMITED', detail: 'The provider asked for a pause (fixture).', retryAfterMs: 4000 }],
  [/\bquota\b|\bno credit\b/i, { ok: false, failure: 'QUOTA_EXHAUSTED', detail: 'The account behind this companion has no credit left (fixture).' }],
  [/\bmalformed\b|\bgarbage\b/i, { ok: false, failure: 'MALFORMED', detail: 'The provider answered with something unreadable (fixture).' }],
  [/\bprovider error\b/i, { ok: false, failure: 'PROVIDER_ERROR', detail: 'The provider reported an error of its own (fixture).' }],
  [/\bdrop\b|\bdisconnect\b/i, { ok: false, failure: 'DISCONNECTED', detail: 'The connection went away mid-turn (fixture).' }],
];

function troubleFor(ask: string): ProviderResult | null {
  return TROUBLE.find(([pattern]) => pattern.test(ask))?.[1] ?? null;
}

/** A deterministic answer in the fixture's own voice: about what was asked, without pretending to know anything. */
function fixtureAnswer(ask: string, history: readonly { ask: string; answer: string }[]): string {
  const asked = ask.length > 120 ? `${ask.slice(0, 117)}…` : ask;
  const nth = history.length + 1;
  return [
    `SIMULATED COMPANION (no provider was contacted).`,
    `You asked, on turn ${nth}: "${asked}"`,
    nth > 1 ? `I still have the ${history.length} turn${history.length === 1 ? '' : 's'} before this one, which is what a session is for.` : `This is the first turn of this session.`,
    `When a real provider is connected, this is where its answer appears and this line will not be here.`,
  ].join('\n');
}

export function createFixtureCompanion(options: { readonly slowMs?: number } = {}): SidekickProviderPort {
  const slowMs = options.slowMs ?? 0;
  return {
    providerId: 'dev-companion',
    async reachable() {
      return { ok: true, detail: 'A development stand-in. Nothing was contacted.' };
    },
    async ask(input: ProviderAsk): Promise<ProviderResult> {
      const started = Date.now();
      const trouble = troubleFor(input.ask);
      if (trouble !== null) {
        // Even a deliberate failure takes a moment, so a surface shows WORKING and then the failure, as it would for real.
        if ((await sleep(Math.min(400, input.timeoutMs), input.signal)) === 'cancelled') {
          return { ok: false, failure: 'CANCELLED', detail: 'Cancelled before the provider answered.' };
        }
        return trouble;
      }
      const answer = fixtureAnswer(input.ask, input.history);
      // STREAMED, because a companion that appears word by word is a different thing to watch than one that blinks in.
      const words = answer.split(' ');
      let sent = '';
      for (const word of words) {
        const pause = slowMs > 0 ? Math.max(8, Math.round(slowMs / words.length)) : 8;
        if ((await sleep(pause, input.signal)) === 'cancelled') {
          return { ok: false, failure: 'CANCELLED', detail: 'Cancelled part way through the answer.' };
        }
        if (Date.now() - started > input.timeoutMs) {
          return { ok: false, failure: 'TIMEOUT', detail: 'The fixture deliberately outlasted its timeout.' };
        }
        sent = sent.length === 0 ? word : `${sent} ${word}`;
        input.onChunk({ text: sent });
      }
      return { ok: true, answer, modelId: input.modelId, ms: Date.now() - started };
    },
  };
}

/**
 * THE FIXTURE SINGLE AGENT. It does the SHAPE of bounded work -- inspect, change, run, report -- against nothing, so
 * that the scoping, the allowance and the reporting are all exercised before a real agent is ever handed a folder.
 *
 * IT IS NOT JULIUS AND DOES NOT PRETEND TO BE. It takes one task, reports on it, and stops.
 */
export function createFixtureAgent(): AgentProviderPort {
  return {
    providerId: 'dev-single-agent',
    async reachable() {
      return { ok: true, detail: 'A development stand-in for a coding agent. Nothing is run and no file is touched.' };
    },
    async work(input: AgentTask): Promise<ProviderResult> {
      const started = Date.now();
      const trouble = troubleFor(input.ask);
      if (trouble !== null) {
        if ((await sleep(300, input.signal)) === 'cancelled') {
          return { ok: false, failure: 'CANCELLED', detail: 'Cancelled before the task began.' };
        }
        return trouble;
      }
      const steps = [
        `SIMULATED SINGLE AGENT (nothing was run, no file was touched).`,
        `Task: ${input.ask.length > 100 ? `${input.ask.slice(0, 97)}…` : input.ask}`,
        `Scope: ${input.workingDirectory} — may ${input.allow.join(', ') || 'do nothing'} and nothing outside it.`,
        `1. Looked at the folder. (fixture)`,
        `2. Changed the one file the task named. (fixture)`,
        `3. Ran the check the task named. (fixture)`,
        `4. Reporting back, which is where a single agent stops: it does not carry on into a mission.`,
      ];
      let sent = '';
      for (const step of steps) {
        if ((await sleep(220, input.signal)) === 'cancelled') {
          return { ok: false, failure: 'CANCELLED', detail: 'Cancelled part way through the task.' };
        }
        if (Date.now() - started > input.timeoutMs) {
          return { ok: false, failure: 'TIMEOUT', detail: 'The fixture deliberately outlasted its timeout.' };
        }
        sent = sent.length === 0 ? step : `${sent}\n${step}`;
        input.onChunk({ text: sent });
      }
      return { ok: true, answer: sent, modelId: input.modelId, ms: Date.now() - started };
    },
  };
}
