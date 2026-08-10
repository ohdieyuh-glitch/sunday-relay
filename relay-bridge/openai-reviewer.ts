import { buildReviewPrompt, validateHermesReview, type HermesOutcome, type ReviewPacket } from './hermes-reviewer';

/**
 * A REVIEWER THAT NEEDS NO INSTALLED BINARY AND NO NEW SERVICE.
 *
 * Both existing Reviewers are blocked on something outside the code: the local
 * one needs Hermes on the PATH, which a container never has, and the remote
 * one needs a service that is not deployed and whose creation needs browser
 * consent nobody here can give.
 *
 * This one needs neither, because production ALREADY has a working provider
 * credential — the Prompt Architect uses it, and `/relay-api/health` reports
 * `promptArchitectReady: true`. A Reviewer over the same API is a hosted
 * Reviewer today rather than after a deployment.
 *
 * INDEPENDENCE IS PRESERVED, and this is the question that decides whether the
 * idea is allowed at all. Independence is a property of the reviewer against
 * the CODING AGENT, not against the architect: a review is worth something
 * when the thing being reviewed was not written by the reviewer. The coding
 * agent is Anthropic; this reviewer is OpenAI; they are different providers
 * and different vendors. `reviewerIsIndependent` decides it from the
 * registry's independence groups, and this occupant carries its own —
 * registering it does not weaken that check, and a deployment that ran an
 * OpenAI coding agent would be refused this Reviewer by the same rule.
 *
 * THE SAME OUTCOME TYPE AND THE SAME VALIDATOR. `HermesOutcome` and
 * `validateHermesReview` are reused deliberately: a third Reviewer must not
 * introduce a third vocabulary for verdicts, and it must not be able to return
 * a shape the others could not.
 */

export interface OpenAiReviewerConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}

export const OPENAI_REVIEWER_ENV = Object.freeze({
  mode: 'RELAY_OPENAI_REVIEWER_MODE',
  model: 'RELAY_OPENAI_REVIEWER_MODEL',
  key: 'OPENAI_API_KEY',
});

export type OpenAiReviewerRefusal = 'not_enabled' | 'no_credential' | 'no_model';

export type OpenAiReviewerResolution =
  | { readonly ok: true; readonly config: OpenAiReviewerConfig }
  | { readonly ok: false; readonly refusal: OpenAiReviewerRefusal; readonly detail: string };

/**
 * Read the configuration, or say what is missing.
 *
 * ENABLED EXPLICITLY. The credential is already present for the architect, and
 * quietly reusing it for a second paid role would spend money nobody asked to
 * spend. An operator turns this on.
 */
export function resolveOpenAiReviewer(env: NodeJS.ProcessEnv): OpenAiReviewerResolution {
  if ((env[OPENAI_REVIEWER_ENV.mode] ?? '').trim() !== 'live') {
    return {
      ok: false,
      refusal: 'not_enabled',
      detail: `${OPENAI_REVIEWER_ENV.mode} is not "live". The provider credential exists for the Prompt Architect; using it for a second paid role is an explicit decision.`,
    };
  }
  const apiKey = (env[OPENAI_REVIEWER_ENV.key] ?? '').trim();
  if (apiKey === '') {
    return { ok: false, refusal: 'no_credential', detail: `${OPENAI_REVIEWER_ENV.key} is not set.` };
  }
  const model = (env[OPENAI_REVIEWER_ENV.model] ?? '').trim();
  if (model === '') {
    // No default. A model is what a review costs and how good it is, and
    // choosing one on an operator's behalf spends their money on a guess.
    return { ok: false, refusal: 'no_model', detail: `${OPENAI_REVIEWER_ENV.model} is not set.` };
  }
  return { ok: true, config: { apiKey, model, timeoutMs: 90_000, maxOutputTokens: 1600 } };
}

const SYSTEM = [
  'You are an INDEPENDENT reviewer for Sunday Relay. You did not write this change.',
  'You review a diff against acceptance criteria and report findings.',
  'You do not implement, you do not repair, and you do not decide whether the mission is complete.',
  'Respond with ONE JSON object and nothing else, matching exactly this shape:',
  '{"verdict":"approved"|"changes_required","summary":string,',
  '"findings":[{"id":string,"severity":"blocking"|"normal","file":string,"detail":string}]}',
  'A finding you cannot point at a file for is not a finding.',
].join('\n');

export interface OpenAiReviewDeps {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

/**
 * Run one review through the provider API.
 *
 * Returns `HermesOutcome` — the same three cases the other two Reviewers
 * return, so the mission leg is unchanged and no caller learns which Reviewer
 * answered from the SHAPE of the answer.
 */
export async function runOpenAiReview(input: {
  readonly packet: ReviewPacket;
  readonly config: OpenAiReviewerConfig;
  readonly deps?: OpenAiReviewDeps;
}): Promise<HermesOutcome> {
  const deps = input.deps ?? {};
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = now();

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, input.config.timeoutMs);

  let response: Response;
  try {
    response = await doFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify({
        model: input.config.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildReviewPrompt(input.packet) },
        ],
        max_completion_tokens: input.config.maxOutputTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch {
    return { kind: 'launch_failed', safeMessage: 'The reviewer provider could not be reached.' };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // ANSWERED AND REFUSED is not the same as never reached, and the status is
    // the actionable part. The body is never surfaced: it is provider text.
    return {
      kind: 'review_incomplete',
      safeMessage: response.status === 401
        ? 'The reviewer provider rejected the credential.'
        : response.status === 429
          ? 'The reviewer provider refused the request (rate limit or insufficient balance).'
          : `The reviewer provider returned status ${String(response.status)}.`,
      startedAt,
      completedAt: now(),
    };
  }

  let text: string;
  try {
    const payload = await response.json() as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    text = payload.choices?.[0]?.message?.content ?? '';
    // The model the provider ACTUALLY ran, never the one requested.
    const actualModel = payload.model ?? null;
    const result = validateHermesReview(text);
    if (result === null) {
      return {
        kind: 'review_incomplete',
        safeMessage: 'The reviewer returned a review Relay could not read.',
        startedAt,
        completedAt: now(),
      };
    }
    return {
      kind: 'reviewed',
      result,
      startedAt,
      completedAt: now(),
      model: actualModel,
      provider: 'openai',
    };
  } catch {
    return {
      kind: 'review_incomplete',
      safeMessage: 'The reviewer response could not be read.',
      startedAt,
      completedAt: now(),
    };
  }
}

/**
 * Readiness, without spending anything.
 *
 * Configuration presence only, and it says so. A provider that will answer is
 * something only a paid call proves, and a probe that made one would charge an
 * operator for the privilege of being told the credential works.
 */
export function openAiReviewerPreflight(env: NodeJS.ProcessEnv): {
  readonly ready: boolean;
  readonly reason: string;
  readonly missing: readonly string[];
} {
  const resolution = resolveOpenAiReviewer(env);
  if (!resolution.ok) {
    return { ready: false, reason: resolution.detail, missing: [resolution.refusal] };
  }
  return {
    ready: true,
    reason: 'Configured. Whether the provider answers is proven by the first review, not by this check.',
    missing: [],
  };
}
