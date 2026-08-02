import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import {
  architectPreflight, loadArchitectConfig, verifyArchitectConnection,
} from './openai-architect';

/**
 * THE ARCHITECT, READY FOR ONE LIVE PROOF.
 *
 * The defect this file exists for: the receipt used to stamp the REQUESTED
 * model as though it were verified. A request for `gpt-4o` is commonly
 * answered by `gpt-4o-2024-08-06`, and only the response is authority for what
 * ran — so the first live call would have produced a receipt asserting an
 * identity nothing had checked.
 *
 * NOTHING HERE CONTACTS OPENAI. Every call is against an injected fetch.
 */

const OPERATOR = 'operator-token-for-tests-only';
const KEY = 'sk-test-not-a-real-key';

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s === undefined) continue;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  vi.unstubAllEnvs();
});

const liveEnv = (over: Record<string, string> = {}) => ({
  OPENAI_API_KEY: KEY,
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-4o',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ...over,
}) as NodeJS.ProcessEnv;

const reply = (body: unknown, status = 200) => vi.fn(async () => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
})) as unknown as typeof fetch;

/* ------------------------------------------------ requested vs actual ---- */

describe('requested and actual model stay separate', () => {
  it('reports the model the PROVIDER named, not the one requested', async () => {
    const fetchImpl = reply({
      model: 'gpt-4o-2026-01-01', id: 'chatcmpl-abcdef123456',
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    });
    const r = await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.requestedModel).toBe('gpt-4o');
    // The dated variant the provider actually ran.
    expect(r.actualModel).toBe('gpt-4o-2026-01-01');
    expect(r.actualModel).not.toBe(r.requestedModel);
  });

  it('a 200 that names no model has verified nothing', async () => {
    const fetchImpl = reply({ id: 'chatcmpl-x', usage: {} });
    const r = await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.actualModel).toBeNull();
    expect(r.provider).toBeNull();
    expect(r.reason).toContain('without naming a model');
  });

  it('never falls back to the requested model when the response omits it', async () => {
    const fetchImpl = reply({ id: 'x' });
    const r = await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    expect(r.actualModel).toBeNull();
  });
});

/* ------------------------------------------------------- configuration --- */

describe('a configured credential is not a verified connection', () => {
  it('refuses to call at all until every requirement is present', async () => {
    const fetchImpl = vi.fn();
    for (const missing of ['RELAY_PROMPT_ARCHITECT_MODE', 'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL']) {
      const env = liveEnv();
      delete (env as Record<string, unknown>)[missing];
      const r = await verifyArchitectConnection({
        config: loadArchitectConfig(env), fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.ok, missing).toBe(false);
      expect(r.actualModel, missing).toBeNull();
    }
    // Not one request was made.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a key alone does not enable live mode', () => {
    const ready = architectPreflight(loadArchitectConfig({
      OPENAI_API_KEY: KEY, OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv));
    expect(ready.ready).toBe(false);
    expect(ready.missing).toContain('RELAY_PROMPT_ARCHITECT_MODE=live');
  });
});

/* ------------------------------------------------------------ failures --- */

describe('failures are stated, never smoothed over', () => {
  const cases: ReadonlyArray<[number, string]> = [
    [401, 'rejected the credential'],
    [429, 'rate limit or insufficient balance'],
    [500, 'status 500'],
  ];
  for (const [status, fragment] of cases) {
    it(`HTTP ${status} → not ok, and says why`, async () => {
      const fetchImpl = reply({ error: { message: `leaky body ${KEY}` } }, status);
      const r = await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(fragment);
      // The provider body can quote the request, which quotes the key.
      expect(r.reason).not.toContain(KEY);
      expect(JSON.stringify(r)).not.toContain(KEY);
    });
  }

  it('an unreachable provider is reported, not treated as a refusal', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('could not be reached');
  });
});

/* -------------------------------------------------------------- spend ---- */

describe('the verification call is as small as it can be', () => {
  it('caps output tokens hard and asks for one word', async () => {
    const seen: Array<{ body: string }> = [];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push({ body: String(init.body) });
      return { ok: true, status: 200, json: async () => ({ model: 'gpt-4o-x' }) };
    }) as unknown as typeof fetch;
    await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    const sent = JSON.parse(seen[0].body) as { max_completion_tokens: number; messages: Array<{ content: string }> };
    expect(sent.max_completion_tokens).toBe(16);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].content.length).toBeLessThan(60);
  });

  it('sends the credential only in the Authorization header', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return { ok: true, status: 200, json: async () => ({ model: 'm' }) };
    }) as unknown as typeof fetch;
    await verifyArchitectConnection({ config: loadArchitectConfig(liveEnv()), fetchImpl });
    expect(seen[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[0].url).not.toContain(KEY);
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });
});

/* ------------------------------------------------------------- route ----- */

describe('the verification route is operator-only and needs consent', () => {
  async function boot(): Promise<string> {
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', 'https://sunday-relay.vercel.app');
    const server = createBridgeServer(loadBridgeConfig(process.env), {
      start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined,
    } as never);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const a = server.address();
    return `http://127.0.0.1:${typeof a === 'object' && a !== null ? a.port : 0}`;
  }

  const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/relay-api/architect/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('refuses without the operator token', async () => {
    const base = await boot();
    const res = await post(base, { authorized: true });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(OPERATOR);
  }, 30_000);

  it('refuses a browser session — this route spends money', async () => {
    const base = await boot();
    const res = await post(base, { authorized: true }, { Authorization: 'Relay-Session anything' });
    expect(res.status).toBe(401);
  }, 30_000);

  it('refuses even the operator without explicit authorization', async () => {
    const base = await boot();
    const res = await post(base, {}, { Authorization: `Bearer ${OPERATOR}` });
    expect(res.status).toBe(403);
    expect(String((await res.json()).error)).toContain('spends money');
  }, 30_000);

  it('is blocked by configuration before any provider request', async () => {
    const base = await boot();
    // No OPENAI_* configured in this process, so preflight blocks first.
    const res = await post(base, { authorized: true }, { Authorization: `Bearer ${OPERATOR}` });
    expect(res.status).toBe(409);
    const body = await res.json() as { data: { ok: boolean; actualModel: string | null } };
    expect(body.data.ok).toBe(false);
    expect(body.data.actualModel).toBeNull();
  }, 30_000);
});

/* --------------------------------------------------- no other provider --- */

describe('no other role is touched', () => {
  it('the verification path names no Coding Agent, Reviewer or Hermes call', () => {
    const src = readFileSync(join(process.cwd(), 'relay-bridge/openai-architect.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function verifyArchitectConnection'));
    for (const forbidden of ['claude', 'hermes', 'anthropic', 'x.ai', 'reviewer']) {
      expect(fn.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
