import { afterEach, describe, expect, it } from 'vitest';
import { GPT_ARCHITECT_SDK_MAX_RETRIES, runGptArchitect } from './gpt-runner';
import type { GptArchitectConfig } from './config';

/**
 * #43 · THE OPENAI SDK NEVER RE-SENDS AN ARCHITECT REQUEST ON ITS OWN.
 *
 * With `maxRetries: 1` the SDK re-sent after a connection error, a timeout,
 * 408/409/429 or any 5xx, before Julius ever saw the failure. None of those
 * proves the first request went unprocessed, so it could buy a second paid
 * answer. The proof counts what reached the wire: `fetch` is stubbed, so no
 * request leaves the process and nothing is contacted or spent.
 */

const config: GptArchitectConfig = {
  apiKeyPresent: true, model: 'gpt-5.6-sol', liveMode: true, maxOutputTokens: 64, timeoutMs: 5_000,
} as unknown as GptArchitectConfig;

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

/** Stub the wire: every call is counted and answered by `respond`. */
function wire(respond: () => Promise<Response>): () => number {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return respond(); }) as typeof fetch;
  return () => calls;
}

const run = () => runGptArchitect({ apiKey: 'FAKETESTNOTREAL-openai', config, instructions: 'i', input: 'x' });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('#43 · the architect\'s openai client makes exactly one request per call', () => {
  it('the SDK retry budget is zero', () => {
    expect(GPT_ARCHITECT_SDK_MAX_RETRIES).toBe(0);
  });

  it.each([
    ['a 500', () => Promise.resolve(json(500, { error: { message: 'server error' } }))],
    ['a 503', () => Promise.resolve(json(503, { error: { message: 'unavailable' } }))],
    // x-should-retry would make the SDK re-send if any budget were left.
    ['a 429 the server says to retry', () => Promise.resolve(json(429, { error: { message: 'rate limited' } }, { 'x-should-retry': 'true', 'retry-after-ms': '1' }))],
    ['a 408', () => Promise.resolve(json(408, { error: { message: 'timeout' } }))],
    ['a dropped connection', () => Promise.reject(new TypeError('fetch failed: socket hang up'))],
  ] as const)('%s: one request on the wire, and the call fails', async (_name, respond) => {
    const calls = wire(respond);
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(calls(), 'the SDK must not re-send').toBe(1);
  }, 30_000);
});
