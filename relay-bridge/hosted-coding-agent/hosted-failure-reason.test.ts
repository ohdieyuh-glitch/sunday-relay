import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOSTED_FAILURE_REASONS, HOSTED_FAILURE_REASON_VOCABULARY_VERSION, classifyHostedFailure, type HostedFailureReason } from './hosted-failure-reason';
import { JULIUS_HOSTED_FAILURE_REASONS, safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';

/**
 * THE ONE PROPERTY THIS MODULE EXISTS FOR: A PROVIDER'S CHARACTERS NEVER LEAVE.
 *
 * Paid Mission 5's rerun reached the Coding Agent with the plan accepted after
 * three reviewed repair rounds, ran six of its twenty-six turns, made five tool
 * calls, changed nothing, and stopped `is_error: true` for $0.885661. The
 * durable record said `coder_provider_error_after_init` and one fixed sentence.
 * Why it failed is now unrecoverable.
 *
 * The fixed sentence stays. `hosted-runner.ts` gives the reason and the reason
 * is right: a provider error can quote the request, and the request can quote
 * the credential. So this module does not widen what may be forwarded — it
 * forwards NOTHING. It matches the runtime's final text and returns a constant
 * of its own, and the mission projection accepts that constant only by
 * MEMBERSHIP, never by shape.
 *
 * Shape would not be enough, and that is the point of the credential cases
 * below: `sk_ant_api03_…` satisfies every token regex in the repository.
 */
describe('a hosted coder failure is classified, never quoted', () => {
  /**
   * ASSEMBLED AT RUN TIME, NEVER WRITTEN DOWN.
   *
   * `relay-repository-boundary.mjs` refuses a credential-shaped literal in a
   * tracked file — correctly, and with no exception for tests. Shortening these
   * until the tripwire tolerates them would also shorten them past what they
   * exist to prove, so the VALUES are exactly as credential-shaped as the real
   * thing and the SOURCE contains no such literal. Both rules hold at once.
   */
  const ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'AAAABBBBCCCCDDDDEEEE'].join('-');
  const GITHUB_TOKEN = ['ghp', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].join('_');
  const CONNECTION_URL = ['https://user', ':', 'hunter2', '@', 'internal.example/v1'].join('');
  const SECRETS = [
    `API Error 500: {"error":{"message":"invalid x-api-key ${ANTHROPIC_KEY}"}}`,
    ANTHROPIC_KEY.replace(/-/gu, '_'),
    `Authorization: Bearer ${GITHUB_TOKEN}`,
    `connection to ${CONNECTION_URL} was reset`,
  ];

  it('the fixtures really are credential-shaped, so nothing here is proven against a placeholder', () => {
    // The same three shapes the repository tripwire refuses, asserted on the
    // assembled VALUES. A later edit that shortens a fixture below the shape it
    // stands in for fails here — which is the only thing keeping the assembly
    // above from becoming a way to test less.
    expect(ANTHROPIC_KEY).toMatch(/sk-ant-[A-Za-z0-9_-]{20,}/u);
    expect(GITHUB_TOKEN).toMatch(/\bghp_[A-Za-z0-9]{30,}/u);
    expect(CONNECTION_URL).toMatch(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{6,}@[^\s/]+/u);
  });

  it('answers with a member of the vocabulary for every input, hostile or not', () => {
    const inputs: readonly unknown[] = [
      ...SECRETS, null, undefined, '', '   ', '\n\t', 'lorem ipsum', 0, 1, true, false, {}, [],
      'x'.repeat(100_000), '💥 unhandled', '{"result":"error"}', 'ERROR', 'Error: 429',
    ];
    for (const input of inputs) {
      const reason = classifyHostedFailure(input as string | null | undefined);
      expect(HOSTED_FAILURE_REASONS as readonly string[], `${String(input).slice(0, 40)} left the vocabulary`).toContain(reason);
    }
  });

  it('never returns a value derived from the text it was given', () => {
    // The safety property stated directly: the answer is one of eleven
    // constants, so no substring of a provider body can be in it. Asserted
    // against real credential SHAPES rather than against a placeholder, because
    // a placeholder proves nothing about a regex that might have captured.
    for (const secret of SECRETS) {
      const reason: string = classifyHostedFailure(secret);
      expect(secret.includes(reason), 'the answer was lifted out of the input').toBe(false);
      for (const fragment of ['sk-ant', 'sk_ant', 'ghp_', 'hunter2', 'x-api-key', 'Bearer']) {
        expect(reason.includes(fragment), `${fragment} travelled`).toBe(false);
      }
    }
  });

  it('the module has no path that can return its input', () => {
    // Behaviour above proves the current patterns; this proves the SHAPE of the
    // module, so a later edit that returns a captured group fails here rather
    // than on a paid run. Every `return` names a literal or a constant.
    const source = readFileSync(resolve(process.cwd(), 'relay-bridge/hosted-coding-agent/hosted-failure-reason.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function classifyHostedFailure'));
    expect(body).not.toMatch(/return[^;]*finalText/u);
    expect(body, 'a capture group is how a substring escapes a classifier').not.toMatch(/\.exec\(|\.match\(|\.replace\(/u);
    expect(body, 'template interpolation in a return is the other way').not.toMatch(/return\s*`/u);
  });

  it('separates "said nothing" from "said something we do not recognise"', () => {
    // Unknown is not zero, and neither is silence. A runtime that reported no
    // final text at all is a different fact from one that reported prose the
    // vocabulary has no word for, and collapsing them would hide which.
    for (const empty of [null, undefined, '', '   ', '\n']) expect(classifyHostedFailure(empty)).toBe('no_message');
    expect(classifyHostedFailure('the sky is blue')).toBe('unclassified');
  });

  it('reaches every classified reason from text a provider actually produces', () => {
    const cases: readonly (readonly [string, HostedFailureReason])[] = [
      ['API Error: 429 {"type":"rate_limit_error"}', 'rate_limited'],
      ['Claude AI usage limit reached|1760400000', 'usage_limit_reached'],
      // The shape Attempt 5 actually ended on: a 400 that is not a bad request.
      ['API Error: 400 {"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}', 'credit_unavailable'],
      ['prompt is too long: 250000 tokens > 200000 maximum', 'context_length_exceeded'],
      ['the response was blocked by the content filter', 'content_filtered'],
      ['API Error: 529 overloaded_error', 'provider_overloaded'],
      ['API Error: 401 authentication_error', 'provider_auth_rejected'],
      ['API Error: 400 invalid_request_error', 'provider_bad_request'],
      ['API Error: 500 internal server error', 'provider_server_error'],
      ['the stream was aborted before it completed', 'stream_interrupted'],
      ['Unhandled exception in tool execution', 'execution_error'],
    ];
    for (const [text, expected] of cases) expect(classifyHostedFailure(text), text).toBe(expected);
    // Every classified reason is reachable; only the two absence answers are not
    // in the table above, and they have their own case.
    const reached = new Set(cases.map(([, reason]) => reason));
    expect([...HOSTED_FAILURE_REASONS].filter((reason) => !reached.has(reason) && reason !== 'unclassified' && reason !== 'no_message')).toEqual([]);
  });

  it('is deterministic and specific-first when a sentence matches twice', () => {
    // "API Error: 429 …" satisfies the rate-limit pattern AND the general
    // execution-error pattern. Order decides, and the specific answer is the
    // useful one — a repair for a rate limit is not a repair for a crash.
    expect(classifyHostedFailure('API Error: 429 rate limit — request failed')).toBe('rate_limited');
    expect(classifyHostedFailure('API Error: 429 rate limit — request failed')).toBe('rate_limited');
    expect(classifyHostedFailure('error: context length exceeded')).toBe('context_length_exceeded');
  });
});

/**
 * TWO COPIES OF ONE VOCABULARY, HELD TOGETHER.
 *
 * The mission projection owns what it will accept; the adapter owns what it can
 * say. They are separate because an adapter may not import the mission
 * projection — so the only thing stopping them drifting is this file. A reason
 * the adapter can emit and the domain does not admit becomes `null` in the
 * durable row: the failure would be recorded as "not known", which is precisely
 * the lie this whole repair exists to stop.
 */
describe('the adapter can say exactly what the mission projection admits', () => {
  it('the two vocabularies are the same list in the same order', () => {
    expect([...HOSTED_FAILURE_REASONS]).toEqual([...JULIUS_HOSTED_FAILURE_REASONS]);
  });

  it('every reason the classifier can return survives the diagnostics allowlist', () => {
    for (const reason of HOSTED_FAILURE_REASONS) {
      expect(safeReviewDiagnostics({ failureReason: reason })?.failureReason, `${reason} was dropped`).toBe(reason);
    }
  });

  it('the allowlist admits this field by MEMBERSHIP, so a credential-shaped value is refused', () => {
    // The reason `safeEnum` is used here and `safeReasonCode` is not:
    // `incompleteReason` and `providerStatus` come from a provider's own enum,
    // and this does not. Each of these satisfies the token regexes.
    for (const shaped of ['sk_ant_api03_AAAABBBB', 'ghp_ABCDEFGHIJKLMNOP', 'rate_limited_but_longer', 'Bearer_token']) {
      expect(safeReviewDiagnostics({ failureReason: shaped })?.failureReason, `${shaped} reached a durable row`).toBeNull();
    }
  });

  it('names its own version, so a later vocabulary change is visible in the record', () => {
    expect(HOSTED_FAILURE_REASON_VOCABULARY_VERSION).toBe('julius-hosted-failure-reason.v1');
  });
});

/**
 * THE SUBSCRIPTION'S USAGE LIMIT, CLASSIFIED (Decision C, audit F5, 2026-10-13). Four Opus arms back to back on one
 * Max subscription can reach its limit mid-arm. The smoke recognised the sentence; the live coder's classifier did not,
 * so the record said UNCLASSIFIED (or PARTIAL_RESPONSE) instead of the limit.
 */
describe('F5: the usage-limit sentence is the smoke\'s, recognised by one function', () => {
  it('every wording the smoke recognises is usage_limit_reached here, ahead of a 429 or an error word in the same text', () => {
    for (const text of [
      'Claude AI usage limit reached|1760400000',
      '5-hour limit reached ∙ resets 3pm',
      'Weekly limit reached - resets Mon 9am',
      'Opus limit reached',
      'API Error: 429 usage limit reached for this session',
    ]) expect(classifyHostedFailure(text), text).toBe('usage_limit_reached');
    expect(classifyHostedFailure('API Error: 429 {"type":"rate_limit_error"}'), 'a plain 429 is still a rate limit').toBe('rate_limited');
  });

  it('it is never retried within the run, and the durable row names it', async () => {
    const { codingAgentFailureFromHostedReason } = await import('../julius/claude-code-coding-provider');
    const { juliusCodingAgentFailureDisposition } = await import('../../src/relay/mission/julius');
    const failure = codingAgentFailureFromHostedReason('usage_limit_reached');
    expect(failure).toBe('CREDIT_UNAVAILABLE');
    expect(juliusCodingAgentFailureDisposition(failure)).toMatchObject({ retryable: false, operatorAction: true });
    expect(safeReviewDiagnostics({ failureReason: 'usage_limit_reached' })?.failureReason).toBe('usage_limit_reached');
  });

  it('ONE RECOGNISER: the smoke and the classifier import it, and neither restates the sentence', () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
    const shared = read('scripts/julius-usage-limit.mjs');
    expect(shared).toContain('limit reached');
    for (const reader of ['scripts/julius-subscription-check.mjs', 'relay-bridge/hosted-coding-agent/hosted-failure-reason.ts']) {
      const source = read(reader);
      expect(source, `${reader} imports the shared recogniser`).toMatch(/import \{ isSubscriptionUsageLimit \} from '[./]+(scripts\/)?julius-usage-limit\.mjs';/u);
      expect(source, `${reader} does not restate the sentence`).not.toMatch(/limit reached/u);
    }
  });
});
