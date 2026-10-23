import { createHash } from 'node:crypto';

import { XAI_DEFAULT_BASE_URL } from './reviewer-harness/hermes/xai-models';
import type { RoleCallInput, RoleCallOutput, RoleProvider, RoleUsage } from './julius-dispatch';

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
 *
 * DOLLAR RECEIPT. xAI puts the billed amount on `usage.cost_in_usd_ticks` (1 USD = 10_000_000_000 ticks, so one micro-USD
 * is 10_000 ticks). This adapter rounds that UP to an integer `costUsdMicros` with integer quotient and remainder
 * (`micros = q + (r > 0 ? 1 : 0)`), and keeps the provider's tick count on `costUsdTicksRaw`. Token counts are not a
 * price. A missing, non-integer, negative, or non-safe tick count is omitted, never stored as 0. The call is one
 * non-streaming POST: the body is `{ model, store: false, input }` and `usage` is read from that JSON object.
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
  /**
   * The served-model strings the body may carry. DEFAULT [model]: strict equality with the requested model. A dated alias is accepted
   * only when listed here by name; the strict check is never loosened implicitly (review F2).
   */
  readonly servedModelAllow?: readonly string[];
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fake?: boolean;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 1 USD = 10_000_000_000 xAI ticks, so one micro-USD is 10_000 ticks. Round UP.
 * Integer quotient and remainder only: no float division. Not a safe non-negative integer: no receipt.
 */
function costUsdMicrosFromXaiTicks(ticks: unknown): { readonly costUsdMicros: number; readonly costUsdTicksRaw: number } | null {
  if (typeof ticks !== 'number' || !Number.isSafeInteger(ticks) || ticks < 0) return null;
  const t = BigInt(ticks);
  const q = t / 10_000n;
  const r = t % 10_000n;
  const micros = r > 0n ? q + 1n : q;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { costUsdMicros: Number(micros), costUsdTicksRaw: ticks };
}

const refuse = (failureClass: string, responseId: string | null = null): RoleCallOutput => ({ ok: false, text: '', responseId, model: null, failureClass });
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export function createXaiDirectReviewerRoleProvider(input: XaiDirectReviewerInput): RoleProvider {
  if (!nonEmpty(input.model)) throw new Error('xai_reviewer_requires_model');
  if (!nonEmpty(input.keyEnv)) throw new Error('xai_reviewer_requires_key_env');
  const allow: readonly string[] = input.servedModelAllow ?? [input.model];
  if (allow.length === 0 || allow.some((m) => !nonEmpty(m))) throw new Error('xai_reviewer_served_model_allow_invalid');
  const base = (input.baseUrl ?? XAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('xai_reviewer_requires_https');
  return {
    providerId: J1_XAI_REVIEWER_PROVIDER_ID, model: input.model, fake: input.fake ?? false, keyEnv: input.keyEnv, servedModelAllow: allow,
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.apiKey)) return { ...refuse('xai_key_missing'), providerContacted: false };
      if (!nonEmpty(call.architectText) || !nonEmpty(call.coderArtifact)) return { ...refuse('review_inputs_absent'), providerContacted: false };
      const evidence = nonEmpty(call.coderEvidence) ? call.coderEvidence : null;
      const userText = [
        `MISSION BRIEF:\n${input.brief}`,
        `ARCHITECT PLAN:\n${call.architectText}`,
        `CODER ARTIFACT (exact bytes, sha256 ${sha256(call.coderArtifact)}):\n${call.coderArtifact}`,
        ...(evidence === null ? [] : [`EXECUTOR EVIDENCE (exact bytes, sha256 ${sha256(evidence)}):\n${evidence}`]),
      ].join('\n\n');
      /* sha256 over EVERYTHING the reviewer was shown (the exact user message). Ledgered on every leg that sent it. */
      const shownSha256 = sha256(userText);
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
        if (!res.ok) return { ...refuse(status === 401 || status === 403 ? 'xai_unauthorized' : status === 429 ? 'xai_rate_limited' : 'xai_http_error'), shownSha256 };
      } catch {
        return { ...refuse('xai_transport_error'), shownSha256 };
      } finally {
        clearTimeout(timer);
      }
      /* From here a 200 body HAS ARRIVED: the request was made and may be billed. EVERY failure below returns what the body gave (id,
         served model, usage if present, null where absent: UNKNOWN is never zero), requests: 1 and the shown digest (review F1). */
      const paid = (failureClass: string, o: { responseId?: string | null; model?: string | null; usage?: RoleUsage; costUsdMicros?: number; costUsdTicksRaw?: number } = {}): RoleCallOutput => ({
        ok: false, text: '', responseId: o.responseId ?? null, model: o.model ?? null, failureClass, requests: 1, shownSha256,
        usage: o.usage ?? { input: null, output: null, total: null },
        ...(typeof o.costUsdMicros === 'number' ? { costUsdMicros: o.costUsdMicros, costUsdTicksRaw: o.costUsdTicksRaw } : {}),
      });
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return paid('xai_response_unreadable');
        body = parsed as Record<string, unknown>;
      } catch {
        return paid('xai_response_unreadable');
      }
      const responseId = nonEmpty(body.id) ? body.id : null;
      const servedModel = nonEmpty(body.model) ? body.model : null;
      const usageRaw = (body.usage !== null && typeof body.usage === 'object' && !Array.isArray(body.usage) ? body.usage : {}) as Record<string, unknown>;
      const inTok = num(usageRaw.input_tokens);
      const outTok = num(usageRaw.output_tokens);
      const usage: RoleUsage = { input: inTok, output: outTok, total: num(usageRaw.total_tokens) ?? (inTok !== null && outTok !== null ? inTok + outTok : null) };
      const receipt = costUsdMicrosFromXaiTicks(usageRaw.cost_in_usd_ticks);
      const costFields = receipt === null ? {} : { costUsdMicros: receipt.costUsdMicros, costUsdTicksRaw: receipt.costUsdTicksRaw };
      const carried = { responseId, model: servedModel, usage, ...costFields };
      // Attestation (review F1): the id and the served model come from the response BODY only. No id = unattested = the leg fails.
      if (responseId === null) return paid('xai_response_id_missing', carried);
      if (servedModel === null) return paid('xai_served_model_missing', carried);
      // F2: the body model must be in the explicit allow list (default: the requested model only).
      if (!allow.includes(servedModel)) return paid('xai_model_mismatch', carried);
      const text = extractText(body);
      if (text === null) return paid('xai_response_unreadable', carried);
      let verdict: 'approve' | 'reject';
      let summary: string;
      try {
        const v: unknown = JSON.parse(text.trim());
        const o = v as { verdict?: unknown; summary?: unknown };
        if (v === null || typeof v !== 'object' || (o.verdict !== 'approve' && o.verdict !== 'reject') || !nonEmpty(o.summary)) return paid('xai_verdict_unreadable', carried);
        verdict = o.verdict;
        summary = o.summary;
      } catch {
        return paid('xai_verdict_unreadable', carried);
      }
      return { ok: true, text: summary, responseId, model: servedModel, usage, requests: 1, verdict, shownSha256, ...costFields };
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
