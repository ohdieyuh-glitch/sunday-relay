import { describe, expect, it, vi } from 'vitest';

import {
  OPENAI_REVIEWER_ENV,
  openAiReviewerPreflight,
  resolveOpenAiReviewer,
  runOpenAiReview,
  type OpenAiReviewerConfig,
} from './openai-reviewer';
import { reviewerIsIndependent } from '../src/relay/mission/entitlement';
import { ROLE_OCCUPANTS } from '../src/relay/mission/role-slots';
import type { ReviewPacket } from './hermes-reviewer';

/**
 * A REVIEWER A HOSTED BRIDGE CAN ACTUALLY HAVE.
 *
 * The other two are blocked on things outside the code — a binary a container
 * never has, and a service that is not deployed. This one uses the credential
 * production already holds for the Prompt Architect.
 *
 * The question that decides whether it is allowed at all is independence, so
 * that is tested against the REAL registry rather than argued about.
 */

const PACKET: ReviewPacket = {
  missionId: 'msn-1',
  originalRequest: 'Add the migration guard.',
  handoffJson: '{"objective":"Add the migration guard."}',
  acceptanceCriteria: ['The guard refuses an unknown version.'],
  baseRevision: 'abc1234',
  artifactDigest: 'sha256:deadbeef',
  changedFiles: ['src/app.ts'],
  unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts',
  changedFileContents: 'export const guard = true;',
  testCommand: 'npm test',
  testOutput: 'ok',
  relayEvidence: ['relay verified the diff applies'],
};

const config: OpenAiReviewerConfig = {
  apiKey: ['sk', 'testkeynotreal0000000000000000'].join('-'),
  model: 'gpt-test',
  timeoutMs: 1_000,
  maxOutputTokens: 800,
};

const REVIEW = JSON.stringify({
  verdict: 'changes_required',
  summary: 'One blocking finding.',
  findings: [{ id: 'F-1', severity: 'blocking', file: 'src/app.ts', detail: 'Unknown version accepted.' }],
});

const completion = (content: string, model = 'gpt-test-0613'): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], model }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

describe('independence, decided by the real registry', () => {
  it('is independent of the Anthropic coding agent', () => {
    const reviewer = ROLE_OCCUPANTS.find((o) => o.occupantId === 'openai_reviewer');
    const coder = ROLE_OCCUPANTS.find((o) => o.occupantId === 'claude_code_local');
    expect(reviewer).toBeDefined();
    expect(coder).toBeDefined();
    // A review is worth something when the thing reviewed was not written by
    // the reviewer. The real rule compares agent, session, adapter AND group —
    // an earlier version of this test passed two bare groups and was wrong
    // about the contract, which is exactly what it was meant to check.
    expect(reviewerIsIndependent({
      reviewerAgentId: reviewer?.agentId ?? '',
      reviewerSessionId: null,
      reviewerAdapterId: reviewer?.adapterId ?? '',
      reviewerIndependenceGroup: reviewer?.independenceGroup ?? '',
      implementerAgentId: coder?.agentId ?? '',
      implementerSessionId: null,
      implementerAdapterId: coder?.adapterId ?? '',
      implementerIndependenceGroup: coder?.independenceGroup ?? '',
    })).toBe(true);
  });

  it('is NOT independent of an OpenAI architect’s own group, by construction', () => {
    // Sharing `openai-gpt` with the OpenAI architect is deliberate: a
    // deployment that ever ran an OpenAI CODING agent must be refused this
    // Reviewer, and sharing the group makes that automatic rather than
    // remembered.
    const reviewer = ROLE_OCCUPANTS.find((o) => o.occupantId === 'openai_reviewer');
    const architect = ROLE_OCCUPANTS.find((o) => o.occupantId === 'openai_gpt_architect');
    expect(reviewer?.independenceGroup).toBe(architect?.independenceGroup);
    expect(reviewerIsIndependent({
      reviewerAgentId: reviewer?.agentId ?? '',
      reviewerSessionId: null,
      reviewerAdapterId: reviewer?.adapterId ?? '',
      reviewerIndependenceGroup: reviewer?.independenceGroup ?? '',
      implementerAgentId: architect?.agentId ?? '',
      implementerSessionId: null,
      implementerAdapterId: architect?.adapterId ?? '',
      implementerIndependenceGroup: architect?.independenceGroup ?? '',
    })).toBe(false);
  });

  it('runs anywhere, and needs no installed binary', () => {
    const reviewer = ROLE_OCCUPANTS.find((o) => o.occupantId === 'openai_reviewer');
    expect(reviewer?.environments).toContain('hosted');
    expect(reviewer?.adapterAvailable).toBe(true);
  });
});

describe('it is enabled explicitly', () => {
  const base = {
    [OPENAI_REVIEWER_ENV.mode]: 'live',
    [OPENAI_REVIEWER_ENV.key]: 'key',
    [OPENAI_REVIEWER_ENV.model]: 'gpt-test',
  };

  it('resolves when the operator turned it on and named a model', () => {
    expect(resolveOpenAiReviewer(base).ok).toBe(true);
  });

  it('refuses to reuse the architect’s credential without being asked', () => {
    // The credential is already present. Spending it on a second paid role
    // must be a decision, not a default.
    const resolution = resolveOpenAiReviewer({ ...base, [OPENAI_REVIEWER_ENV.mode]: '' });
    if (resolution.ok) throw new Error('it enabled itself');
    expect(resolution.refusal).toBe('not_enabled');
    expect(resolution.detail).toContain('explicit decision');
  });

  it('refuses without a model rather than choosing one', () => {
    // A model is what a review costs and how good it is. Choosing on an
    // operator's behalf spends their money on a guess.
    const resolution = resolveOpenAiReviewer({ ...base, [OPENAI_REVIEWER_ENV.model]: '' });
    if (resolution.ok) throw new Error('it guessed a model');
    expect(resolution.refusal).toBe('no_model');
  });

  it('refuses without a credential', () => {
    const resolution = resolveOpenAiReviewer({ ...base, [OPENAI_REVIEWER_ENV.key]: '' });
    if (resolution.ok) throw new Error('it ran without a credential');
    expect(resolution.refusal).toBe('no_credential');
  });

  it('reports readiness as CONFIGURATION only, and says so', () => {
    const ready = openAiReviewerPreflight(base);
    expect(ready.ready).toBe(true);
    // A probe that proved the provider answers would be a paid call.
    expect(ready.reason).toContain('proven by the first review');
  });
});

describe('running a review', () => {
  it('returns the same outcome shape as the other Reviewers', async () => {
    const outcome = await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: (() => Promise.resolve(completion(REVIEW))) as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.result.findings).toHaveLength(1);
    // The model the provider ACTUALLY ran, never the one requested.
    expect(outcome.servedModel).toBe('gpt-test-0613');
    // Requested and served are separate, and they really do differ here.
    expect(outcome.requestedModel).toBe('gpt-test');
    expect(outcome.provider).toBe('openai');
  });

  it('refuses a review it cannot read rather than inventing a verdict', async () => {
    const outcome = await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: (() => Promise.resolve(completion('not json'))) as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('review_incomplete');
  });

  it('separates unreachable from refused', async () => {
    const unreachable = await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch },
    });
    expect(unreachable.kind).toBe('launch_failed');

    const refused = await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: (() => Promise.resolve(new Response('{}', { status: 429 }))) as unknown as typeof fetch },
    });
    // It answered. Different fact, different next step for an operator.
    expect(refused.kind).toBe('review_incomplete');
    if (refused.kind === 'review_incomplete') {
      expect(refused.safeMessage).toContain('rate limit or insufficient balance');
    }
  });

  it('never puts the credential or the provider body in an outcome', async () => {
    const outcome = await runOpenAiReview({
      packet: PACKET, config,
      deps: {
        fetchImpl: (() => Promise.resolve(
          new Response('{"error":{"message":"key sk-leakedleakedleaked"}}', { status: 500 }),
        )) as unknown as typeof fetch,
      },
    });
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(config.apiKey);
    // The provider's body is provider text and never surfaced.
    expect(text).not.toContain('leakedleaked');
  });

  it('sends the credential as a bearer token and asks for JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(REVIEW));
    await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.apiKey}`);
    const body = JSON.parse(init.body as string) as { response_format?: { type?: string } };
    expect(body.response_format?.type).toBe('json_object');
  });

  it('tells the reviewer it did not write the change', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(REVIEW));
    await runOpenAiReview({
      packet: PACKET, config,
      deps: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      messages: { role: string; content: string }[];
    };
    const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('did not write this change');
    // And it is told what it may NOT do, since a reviewer that repairs is not
    // a reviewer.
    expect(system).toContain('do not decide whether the mission is complete');
  });
});
