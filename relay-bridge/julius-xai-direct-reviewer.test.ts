import { describe, expect, it } from 'vitest';

import type { RoleCallInput } from './julius-dispatch';
import { createXaiDirectReviewerRoleProvider } from './julius-xai-direct-reviewer';

const KEY = ['xai', 'test', 'canary', 'k3y'].join('-');
const callIn = (over: Partial<RoleCallInput> = {}): RoleCallInput => ({
  role: 'reviewer', runId: 'r1', dispatchId: 'd1', missionId: 'm1', apiKey: KEY, architectText: 'plan', coderArtifact: 'artifact', ...over,
});
const ok = (body: unknown, status = 200) => async () => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const good = {
  id: 'resp_abc123', model: 'grok-served-1', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{"verdict":"approve","summary":"matches the brief"}' }] }],
};
const make = (fetchImpl: Parameters<typeof createXaiDirectReviewerRoleProvider>[0]['fetchImpl'], over = {}) =>
  createXaiDirectReviewerRoleProvider({ model: 'grok-requested', keyEnv: 'XAI_API_KEY', brief: 'brief', fetchImpl, ...over });

describe('direct xAI reviewer adapter (fake fetch only)', () => {
  it('returns the provider response id, the SERVED model, usage and exactly one request', async () => {
    const r = await make(ok(good)).call(callIn());
    expect(r).toMatchObject({ ok: true, responseId: 'resp_abc123', model: 'grok-served-1', verdict: 'approve', requests: 1, usage: { input: 10, output: 5, total: 15 } });
  });
  it('never reports the requested model when the response names none', async () => {
    const r = await make(ok({ ...good, model: undefined })).call(callIn());
    expect(r.ok).toBe(true);
    expect(r.model).toBeNull();
  });
  it('sends the key only in the Authorization header and never in the body or output', async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const r = await make(async (url, init) => { seen = { url, headers: init.headers, body: init.body }; return ok(good)(); }).call(callIn());
    expect(seen!.url).toBe('https://api.x.ai/v1/responses');
    expect(seen!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen!.body).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.parse(seen!.body).store).toBe(false);
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
});
