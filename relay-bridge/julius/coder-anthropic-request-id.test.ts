import { describe, expect, it } from 'vitest';

import { observeHostedMessages } from '../hosted-coding-agent/hosted-observation';
import { hostedCoderDiagnostics } from './claude-code-coding-provider';
import { safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';

const REQUESTED = 'claude-opus-5-5';
const LIMITS = { maxTurns: 4, maxCostCents: 50, maxRuntimeMs: 1_000 };

function session(requestId: string, messageId: string) {
  return observeHostedMessages([
    { type: 'system', subtype: 'init', model: REQUESTED, session_id: 'sess-not-the-request', apiKeySource: 'ANTHROPIC_API_KEY' },
    {
      type: 'assistant',
      request_id: requestId,
      message: { id: messageId, model: REQUESTED, usage: { input_tokens: 11, output_tokens: 7 } },
    },
    {
      type: 'result', subtype: 'success', is_error: false, result: 'done',
      num_turns: 1, total_cost_usd: 0.02,
      usage: { input_tokens: 11, output_tokens: 7 },
      modelUsage: { [REQUESTED]: { inputTokens: 11, outputTokens: 7 } },
    },
  ]);
}

describe('a coder dispatch records the Anthropic API id, not the runtime session', () => {
  it('keeps the request id, the message id, the served model, the tokens, and the cost', () => {
    const observed = session('req_01ABCDEFGHIJKLMNOP', 'msg_01ABCDEFGHIJKLMNOP');
    expect(observed.sessionId).toBe('sess-not-the-request');
    const diagnostics = hostedCoderDiagnostics({
      taskType: 'build', authMode: 'ANTHROPIC_API', requestedModel: REQUESTED,
      observed, limits: LIMITS, outcome: 'succeeded',
    });
    expect(diagnostics.responseId).toBe('req_01ABCDEFGHIJKLMNOP');
    expect(diagnostics.providerRequestId).toBe('req_01ABCDEFGHIJKLMNOP');
    expect(diagnostics.providerMessageId).toBe('msg_01ABCDEFGHIJKLMNOP');
    expect(diagnostics.providerRequestAvailability).toBe('CAPTURED');
    expect(diagnostics.providerRequestUnavailableReason).toBeNull();
    expect(diagnostics.requestedModel).toBe(REQUESTED);
    expect(diagnostics.servedModel).toBe(REQUESTED);
    expect(diagnostics.inputTokens).toBe(11);
    expect(diagnostics.outputTokens).toBe(7);
    expect(diagnostics.costBasis).toBe('PROVIDER_REPORTED');
    expect(diagnostics.billingPath).toBe('API_BILLED');
    expect(JSON.stringify(diagnostics)).not.toContain('sess-not-the-request');
    const safe = safeReviewDiagnostics(diagnostics);
    expect(safe?.responseId).toBe('req_01ABCDEFGHIJKLMNOP');
    expect(safe?.providerRequestId).toBe('req_01ABCDEFGHIJKLMNOP');
    expect(safe?.providerMessageId).toBe('msg_01ABCDEFGHIJKLMNOP');
  });

  it('a credential-shaped request id is unavailable and does not fall through to the message id', () => {
    const diagnostics = hostedCoderDiagnostics({
      taskType: 'build', authMode: 'ANTHROPIC_API', requestedModel: REQUESTED,
      observed: session('sk-ant-FAKETESTNOTREAL', 'msg_01ABCDEFGHIJKLMNOP'),
      limits: LIMITS, outcome: 'failed',
    });
    expect(diagnostics.responseId).toBeNull();
    expect(diagnostics.providerRequestId).toBeNull();
    expect(diagnostics.providerMessageId).toBeNull();
    expect(diagnostics.providerRequestAvailability).toBe('UNAVAILABLE');
    expect(diagnostics.providerRequestUnavailableReason).toBe('provider_request_id_credential_shaped');
    expect(JSON.stringify(diagnostics)).not.toContain('FAKETESTNOTREAL');
  });

  it('with no assistant message the id is unavailable, not the session id', () => {
    const observed = observeHostedMessages([
      { type: 'system', subtype: 'init', session_id: 'sess-only', model: REQUESTED },
    ]);
    const diagnostics = hostedCoderDiagnostics({
      taskType: 'build', requestedModel: REQUESTED, observed, limits: LIMITS, outcome: 'failed',
    });
    expect(diagnostics.responseId).toBeNull();
    expect(diagnostics.providerRequestAvailability).toBe('UNAVAILABLE');
    expect(diagnostics.providerRequestUnavailableReason).toBe('provider_request_id_not_reported');
    expect(JSON.stringify(diagnostics)).not.toContain('sess-only');
  });
});
