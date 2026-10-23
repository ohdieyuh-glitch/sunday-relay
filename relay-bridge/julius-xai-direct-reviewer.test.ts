import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RoleCallInput } from './julius-dispatch';
import { createXaiDirectReviewerRoleProvider } from './julius-xai-direct-reviewer';

const KEY = ['xai', 'test', 'canary', 'k3y'].join('-');
const callIn = (over: Partial<RoleCallInput> = {}): RoleCallInput => ({
  role: 'reviewer', runId: 'r1', dispatchId: 'd1', missionId: 'm1', apiKey: KEY, architectText: 'plan', coderArtifact: 'artifact', ...over,
});
const ok = (body: unknown, status = 200) => async () => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const good = {
  id: 'resp_abc123', model: 'grok-requested', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{"verdict":"approve","summary":"matches the brief"}' }] }],
};
const make = (fetchImpl: Parameters<typeof createXaiDirectReviewerRoleProvider>[0]['fetchImpl'], over = {}) =>
  createXaiDirectReviewerRoleProvider({ model: 'grok-requested', keyEnv: 'XAI_API_KEY', brief: 'brief', fetchImpl, ...over });

describe('direct xAI reviewer adapter (fake fetch only)', () => {
  it('G3-2: pre-contact refusals (no key, no inputs) say the provider was not contacted; a post-200 failure does not', async () => {
    let fetched = 0;
    const f = async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{}' }; };
    expect(await make(f).call(callIn({ apiKey: '' }))).toMatchObject({ ok: false, failureClass: 'xai_key_missing', providerContacted: false });
    expect(await make(f).call(callIn({ coderArtifact: null }))).toMatchObject({ failureClass: 'review_inputs_absent', providerContacted: false });
    expect(fetched).toBe(0);
    expect((await make(ok('not json')).call(callIn())).providerContacted).toBeUndefined();
  });
  it('returns the provider response id, the model FROM THE BODY, usage and exactly one request', async () => {
    const r = await make(ok(good)).call(callIn());
    expect(r).toMatchObject({ ok: true, responseId: 'resp_abc123', model: 'grok-requested', verdict: 'approve', requests: 1, usage: { input: 10, output: 5, total: 15 } });
  });
  it('fails the leg when the body has no id (unattested), no served model, or a different model; mismatch is recorded', async () => {
    const noId = await make(ok({ ...good, id: undefined })).call(callIn());
    expect(noId).toMatchObject({ ok: false, failureClass: 'xai_response_id_missing', responseId: null });
    const noModel = await make(ok({ ...good, model: undefined })).call(callIn());
    expect(noModel).toMatchObject({ ok: false, failureClass: 'xai_served_model_missing', model: null });
    const other = await make(ok({ ...good, model: 'grok-other' })).call(callIn());
    expect(other).toMatchObject({ ok: false, failureClass: 'xai_model_mismatch', responseId: 'resp_abc123', model: 'grok-other' });
  });
  it('F1: every failure after a 200 body keeps id, served model, usage (null when absent), requests 1 and the shown digest', async () => {
    const usageOnly = { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    const cases: [string, unknown, Record<string, unknown>][] = [
      ['xai_model_mismatch', { ...good, model: 'grok-other' }, { responseId: 'resp_abc123', model: 'grok-other', usage: { input: 10, output: 5, total: 15 } }],
      ['xai_verdict_unreadable', { ...good, output: [{ content: [{ text: 'nope' }] }] }, { responseId: 'resp_abc123', model: 'grok-requested', usage: { input: 10, output: 5, total: 15 } }],
      ['xai_response_unreadable', { ...good, output: undefined }, { responseId: 'resp_abc123', model: 'grok-requested', usage: { input: 10, output: 5, total: 15 } }],
      ['xai_served_model_missing', { ...good, model: undefined }, { responseId: 'resp_abc123', model: null, usage: { input: 10, output: 5, total: 15 } }],
      ['xai_response_id_missing', { ...good, id: undefined }, { responseId: null, model: 'grok-requested', usage: { input: 10, output: 5, total: 15 } }],
      ['xai_response_id_missing', { model: 'grok-requested', ...usageOnly, id: undefined }, { responseId: null, usage: { input: 10, output: 5, total: 15 } }],
      ['xai_model_mismatch', { id: 'resp_x', model: 'grok-other' }, { responseId: 'resp_x', usage: { input: null, output: null, total: null } }],
      ['xai_response_unreadable', 'not json', { responseId: null, model: null, usage: { input: null, output: null, total: null } }],
    ];
    for (const [cls, body, expected] of cases) {
      const r = await make(ok(body)).call(callIn());
      expect(r).toMatchObject({ ok: false, failureClass: cls, requests: 1, ...expected });
      expect(r.shownSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it('F2: a dated alias is rejected by default and accepted only when listed in servedModelAllow', async () => {
    const dated = { ...good, model: 'grok-requested-20261001' };
    expect(await make(ok(dated)).call(callIn())).toMatchObject({ ok: false, failureClass: 'xai_model_mismatch', model: 'grok-requested-20261001' });
    expect(await make(ok(dated), { servedModelAllow: ['grok-requested-20261001'] }).call(callIn())).toMatchObject({ ok: true, model: 'grok-requested-20261001' });
    // An explicit list REPLACES the default: the requested name itself is then only accepted if listed.
    expect(await make(ok(good), { servedModelAllow: ['grok-requested-20261001'] }).call(callIn())).toMatchObject({ ok: false, failureClass: 'xai_model_mismatch' });
    expect(() => make(ok(good), { servedModelAllow: [] })).toThrow('xai_reviewer_served_model_allow_invalid');
    expect(() => make(ok(good), { servedModelAllow: [' '] })).toThrow('xai_reviewer_served_model_allow_invalid');
  });
  it('e: the reviewer sees the exact artifact bytes, their sha256 and the executor evidence; shownSha256 is the hash of the exact message', async () => {
    let body = '';
    const art = 'ARTIFACT \u00e9 bytes\n';
    const ev = 'M\tsrc/a.js';
    const r = await make(async (_u, init) => { body = init.body; return ok(good)(); }).call(callIn({ coderArtifact: art, coderEvidence: ev }));
    const msg = (JSON.parse(body) as { input: { role: string; content: string }[] }).input[1].content;
    expect(msg).toContain(art);
    expect(msg).toContain(`sha256 ${createHash('sha256').update(art, 'utf8').digest('hex')}`);
    expect(msg).toContain(ev);
    expect(msg).toContain(`sha256 ${createHash('sha256').update(ev, 'utf8').digest('hex')}`);
    expect(r.shownSha256).toBe(createHash('sha256').update(msg, 'utf8').digest('hex'));
    const without = await make(ok(good)).call(callIn({ coderArtifact: art }));
    expect(without.shownSha256).not.toBe(r.shownSha256);
  });
  it('sends the key only in the Authorization header and never in the body or output', async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const r = await make(async (url, init) => { seen = { url, headers: init.headers, body: init.body }; return ok(good)(); }).call(callIn());
    expect(seen!.url).toBe('https://api.x.ai/v1/responses');
    expect(seen!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen!.body).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    const sent = JSON.parse(seen!.body) as Record<string, unknown>;
    expect(sent.store).toBe(false);
    expect(Object.keys(sent).sort()).toEqual(['input', 'model', 'store']);
    expect(sent.stream).toBeUndefined();
    expect(sent.stream_options).toBeUndefined();
  });
  it('maps rejects and unreadable verdicts; a bad verdict keeps the response id', async () => {
    const rej = await make(ok({ ...good, output: [{ content: [{ text: '{"verdict":"reject","summary":"wrong totals"}' }] }] })).call(callIn());
    expect(rej).toMatchObject({ ok: true, verdict: 'reject' });
    const bad = await make(ok({ ...good, output: [{ content: [{ text: 'looks fine to me' }] }] })).call(callIn());
    expect(bad).toMatchObject({ ok: false, failureClass: 'xai_verdict_unreadable', responseId: 'resp_abc123' });
    const odd = await make(ok({ ...good, output: [{ content: [{ text: '{"verdict":"maybe","summary":"x"}' }] }] })).call(callIn());
    expect(odd.ok).toBe(false);
  });
  it('failure classes carry no provider text', async () => {
    const echo = `server said: bad key ${KEY}`;
    for (const [status, cls] of [[401, 'xai_unauthorized'], [429, 'xai_rate_limited'], [500, 'xai_http_error']] as const) {
      const r = await make(ok(echo, status)).call(callIn());
      expect(r).toMatchObject({ ok: false, failureClass: cls, responseId: null });
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
    const t = await make(async () => { throw new Error(echo); }).call(callIn());
    expect(t).toMatchObject({ ok: false, failureClass: 'xai_transport_error' });
    expect(JSON.stringify(t)).not.toContain(KEY);
    expect((await make(ok('not json')).call(callIn())).failureClass).toBe('xai_response_unreadable');
    expect((await make(ok([1, 2])).call(callIn())).failureClass).toBe('xai_response_unreadable');
  });
  it('refuses without a key, without inputs, and at construction without model, key env or https', async () => {
    expect((await make(ok(good)).call(callIn({ apiKey: '' }))).failureClass).toBe('xai_key_missing');
    expect((await make(ok(good)).call(callIn({ coderArtifact: null }))).failureClass).toBe('review_inputs_absent');
    expect(() => createXaiDirectReviewerRoleProvider({ model: '', keyEnv: 'K', brief: 'b', fetchImpl: ok(good) })).toThrow('xai_reviewer_requires_model');
    expect(() => createXaiDirectReviewerRoleProvider({ model: 'm', keyEnv: '', brief: 'b', fetchImpl: ok(good) })).toThrow('xai_reviewer_requires_key_env');
    expect(() => make(ok(good), { baseUrl: 'http://api.x.ai/v1' })).toThrow('xai_reviewer_requires_https');
  });
  it('has the xai independence group and honours the fake flag', () => {
    expect(make(ok(good)).providerId).toBe('xai');
    expect(make(ok(good), { fake: true }).fake).toBe(true);
  });
  const withTicks = (ticks: unknown) => ({ ...good, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_in_usd_ticks: ticks } });
  const leg = (body: unknown) => make(ok(body)).call(callIn());

  it('rounds cost_in_usd_ticks up to integer micros, keeps the raw ticks, and does not price token counts', async () => {
    // k * 10_000 and one tick above it, k = 900_719_925_474. Both are safe integers.
    // Plain correctness checks beside Number.MAX_SAFE_INTEGER. Float Math.ceil(t/10000)
    // agrees with this ceiling for every safe integer; these values are not a counterexample.
    const exactNearMax = 9_007_199_254_740_000;
    const oneTickOverNearMax = 9_007_199_254_740_001;
    const cases: ReadonlyArray<readonly [number, number]> = [
      [158_500, 16],
      [160_000, 16],
      [150_001, 16],
      [159_999, 16],
      [160_001, 17],
      [1, 1],
      [9_999, 1],
      [10_000, 1],
      [10_001, 2],
      [0, 0],
      [100_000_000, 10_000],
      [exactNearMax, 900_719_925_474],
      [oneTickOverNearMax, 900_719_925_475],
      [Number.MAX_SAFE_INTEGER, 900_719_925_475],
    ];
    for (const [ticks, micros] of cases) {
      expect(Number.isSafeInteger(ticks)).toBe(true);
      const r = await leg(withTicks(ticks));
      expect(r).toMatchObject({ ok: true, usage: { input: 10, output: 5, total: 15 }, costUsdMicros: micros, costUsdTicksRaw: ticks });
    }
  });

  it('refuses a missing, null, negative, non-integer, or non-safe tick count and does not store zero', async () => {
    expect(await leg(good)).toMatchObject({ ok: true, usage: { input: 10, output: 5, total: 15 } });
    expect((await leg(good)).costUsdMicros ?? null).toBeNull();
    expect((await leg(good)).costUsdTicksRaw ?? null).toBeNull();
    for (const ticks of [null, -1, -10_000, 1.5, '158500', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const r = await leg(withTicks(ticks));
      expect(r.ok).toBe(true);
      expect(r.costUsdMicros ?? null).toBeNull();
      expect(r.costUsdTicksRaw ?? null).toBeNull();
    }
  });

  it('over-states a safe tick count by less than one micro and never rounds down', async () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    let state = 0xC0FFEE;
    const next32 = (): number => {
      state = Math.imul(state ^ (state >>> 15), state | 1) + 0x6d2b79f5;
      return state >>> 0;
    };
    const samples = [0, Number.MAX_SAFE_INTEGER, 9_007_199_254_740_000, 9_007_199_254_740_001];
    for (let i = 0; i < 200; i += 1) {
      const hi = BigInt(next32() & 0x1f_ffff);
      const lo = BigInt(next32());
      samples.push(Number(((hi << 32n) | lo) % (max + 1n)));
    }
    for (const ticks of samples) {
      const r = await leg(withTicks(ticks));
      expect(r.ok).toBe(true);
      expect(r.costUsdTicksRaw).toBe(ticks);
      const micros = r.costUsdMicros;
      expect(Number.isSafeInteger(micros)).toBe(true);
      const m = BigInt(micros as number);
      const t = BigInt(ticks);
      expect(m * 10_000n >= t).toBe(true);
      expect((m - 1n) * 10_000n < t).toBe(true);
    }
  });

  it('a streaming body or a body with no top-level usage produces no dollar receipt', async () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_abc123","model":"grok-requested","usage":{"cost_in_usd_ticks":158500}}}',
      '',
    ].join('\n');
    const streamed = await leg(sse);
    expect(streamed).toMatchObject({ ok: false, failureClass: 'xai_response_unreadable' });
    expect(streamed.costUsdMicros ?? null).toBeNull();
    expect(streamed.costUsdTicksRaw ?? null).toBeNull();
    const noUsage = { id: good.id, model: good.model, output: good.output };
    const bare = await leg(noUsage);
    expect(bare).toMatchObject({ ok: true, responseId: 'resp_abc123', model: 'grok-requested' });
    expect(bare.costUsdMicros ?? null).toBeNull();
    expect(bare.costUsdTicksRaw ?? null).toBeNull();
  });
});
