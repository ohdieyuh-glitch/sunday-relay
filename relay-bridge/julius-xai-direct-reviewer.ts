import { createHash } from 'node:crypto';

import { XAI_DEFAULT_BASE_URL } from './reviewer-harness/hermes/xai-models';
import type { RoleCallInput, RoleCallOutput, RoleProvider } from './julius-dispatch';

/**
 * J1 REVIEWER, DIRECT xAI PATH. An alternative to the Hermes reviewer adapter for one reason: Hermes reports no provider response id
 * (OPEN_ITEMS 22, review F1), and a leg without an id cannot be reconciled against the provider console. This calls the xAI Responses
 * endpoint itself, ONE request per review, so the response id, the served model and the usage are the provider's own words, and
 * `requests` is exactly 1.
 *
 * It opens no socket of its own: `fetchImpl` is injected (tests pass a fake). The key arrives as `call.apiKey` from the controller;
 * this file never reads the environment. A failure carries a class token only, never a provider message.
 *
 * UNVERIFIED against the live service: the request and response field names follow the Responses-API shape (`id`, `model`,
 * `output[].content[].text`, `usage.input_tokens`); no request was sent to xAI to confirm them. A mismatch makes the leg REFUSE
 * (`xai_response_unreadable`), it never invents a field.
 */

export const J1_XAI_REVIEWER_PROVIDER_ID = 'xai';

export const J1_XAI_REVIEW_INSTRUCTIONS = [
  'You are the independent Reviewer for a Relay mission.',
  'You are shown the mission brief, the architect plan and the coder artifact. You did not write any of them.',
  'Judge whether the artifact satisfies the brief. Reply with ONE JSON object and nothing else: {"verdict":"approve"|"reject","summary":"<short reasons>"}.',
].join(' ');

export interface XaiDirectReviewerInput {
  readonly model: string;
  readonly keyEnv: string;
  readonly brief: string;
  readonly fetchImpl: (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fake?: boolean;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const refuse = (failureClass: string, responseId: string | null = null): RoleCallOutput => ({ ok: false, text: '', responseId, model: null, failureClass });

export function createXaiDirectReviewerRoleProvider(input: XaiDirectReviewerInput): RoleProvider {
  if (!nonEmpty(input.model)) throw new Error('xai_reviewer_requires_model');
  if (!nonEmpty(input.keyEnv)) throw new Error('xai_reviewer_requires_key_env');
  const base = (input.baseUrl ?? XAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('xai_reviewer_requires_https');
  return {
    providerId: J1_XAI_REVIEWER_PROVIDER_ID, model: input.model, fake: input.fake ?? false, keyEnv: input.keyEnv,
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.apiKey)) return refuse('xai_key_missing');
      if (!nonEmpty(call.architectText) || !nonEmpty(call.coderArtifact)) return refuse('review_inputs_absent');
      const userText = [
        `MISSION BRIEF:\n${input.brief}`,
        `ARCHITECT PLAN:\n${call.architectText}`,
        `CODER ARTIFACT (sha256 ${createHash('sha256').update(call.coderArtifact, 'utf8').digest('hex')}):\n${call.coderArtifact}`,
      ].join('\n\n');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 600_000);
      let status = 0;
      let raw = '';
      try {
        const res = await input.fetchImpl(`${base}/responses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${call.apiKey}` },
          body: JSON.stringify({ model: input.model, store: false, input: [{ role: 'system', content: J1_XAI_REVIEW_INSTRUCTIONS }, { role: 'user', content: userText }] }),
          signal: controller.signal,
        });
        status = res.status;
        raw = await res.text();
        if (!res.ok) return refuse(status === 401 || status === 403 ? 'xai_unauthorized' : status === 429 ? 'xai_rate_limited' : 'xai_http_error');
      } catch {
        return refuse('xai_transport_error');
      } finally {
        clearTimeout(timer);
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return refuse('xai_response_unreadable');
        body = parsed as Record<string, unknown>;
      } catch {
        return refuse('xai_response_unreadable');
      }
      const responseId = nonEmpty(body.id) ? body.id : null;
      const servedModel = nonEmpty(body.model) ? body.model : null;
      // Attestation (review F1): the id and the served model come from the response BODY only. No id = unattested = the leg fails.
      if (responseId === null) return { ...refuse('xai_response_id_missing'), model: servedModel };
      // A served model that differs from the requested one is a mismatch, recorded (id + served model returned) and failing.
      if (servedModel !== null && servedModel !== input.model) return { ...refuse('xai_model_mismatch', responseId), model: servedModel };
      if (servedModel === null) return refuse('xai_served_model_missing', responseId);
      const text = extractText(body);
      if (text === null) return refuse('xai_response_unreadable', responseId);
      let verdict: 'approve' | 'reject';
      let summary: string;
      try {
        const v: unknown = JSON.parse(text.trim());
        const o = v as { verdict?: unknown; summary?: unknown };
        if (v === null || typeof v !== 'object' || (o.verdict !== 'approve' && o.verdict !== 'reject') || !nonEmpty(o.summary)) return refuse('xai_verdict_unreadable', responseId);
        verdict = o.verdict;
        summary = o.summary;
      } catch {
        return refuse('xai_verdict_unreadable', responseId);
      }
      const usage = (body.usage ?? {}) as Record<string, unknown>;
      const inTok = num(usage.input_tokens);
      const outTok = num(usage.output_tokens);
      return {
        ok: true, text: summary, responseId, model: servedModel,
        usage: { input: inTok, output: outTok, total: num(usage.total_tokens) ?? (inTok !== null && outTok !== null ? inTok + outTok : null) },
        requests: 1, verdict,
      };
    },
  };
}

function extractText(body: Record<string, unknown>): string | null {
  if (nonEmpty(body.output_text)) return body.output_text;
  if (!Array.isArray(body.output)) return null;
  const parts: string[] = [];
  for (const item of body.output as unknown[]) {
    const content = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content as unknown[]) {
      const t = (c as { text?: unknown } | null)?.text;
      if (nonEmpty(t)) parts.push(t);
    }
  }
  return parts.length === 0 ? null : parts.join('');
}
