import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { GptArchitectConfig } from './config';
import {
  ANTHROPIC_PINNED_ORIGIN, PROVIDER_MESSAGE_EXCERPT_MAX, classifyAnthropicStatus, providerMessageClass, runAnthropicArchitect,
} from './anthropic-architect-runner';

/**
 * HOSTILE PROVIDER MESSAGES, PROVEN OFFLINE (run 40698923582 follow-up). Every
 * request goes to an injected fetch; nothing opens a socket or spends anything.
 * Every value below is a FAKE built for this file.
 *
 * The stored excerpt must never carry a key, an organization or workspace
 * detail, or prompt text, including when the provider interleaves invisible
 * characters to defeat a pattern. Category, length and digest always stand.
 */

const KEY = 'FAKETESTNOTREAL-architect-key-0000';
const CONFIG: GptArchitectConfig = {
  apiKeyPresent: true, model: 'claude-opus-5-5', liveMode: true, maxOutputTokens: 20_000, timeoutMs: 1_000, unusable: [],
};
const PROMPT_REQUEST = {
  apiKey: KEY, config: CONFIG,
  instructions: 'You are the Prompt Architect for project acme-widgets. Plan the change carefully and cite the files.',
  input: 'Customer Jane Roe reports that the invoice export drops the last line item when the total exceeds 1000.',
};
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const body = (message: string): string => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });
const ZW = ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad'] as const;
const interleave = (text: string, mark: string): string => text.split('').join(mark);

async function refusalOf(message: string) {
  const urls: string[] = [];
  const outcome = await runAnthropicArchitect(PROMPT_REQUEST, {
    fetch: (async (url: RequestInfo | URL) => { urls.push(String(url)); return new Response(body(message), { status: 400 }); }) as typeof fetch,
  });
  if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
  expect(urls, 'one call, to the pinned origin only').toHaveLength(1);
  expect(urls[0]!.startsWith(`${ANTHROPIC_PINNED_ORIGIN}/`)).toBe(true);
  expect(outcome.failureClass, 'the class is the frozen rule, whatever the message').toBe(
    classifyAnthropicStatus(400, 'invalid_request_error', /credit balance is too low/iu.test(message)),
  );
  const evidence = outcome.refusal.providerMessage!;
  expect(evidence.messageBytes).toBe(Buffer.byteLength(message, 'utf8'));
  expect(evidence.messageSha256).toBe(sha(message));
  if (evidence.excerpt !== null) {
    expect(evidence.excerpt).toMatch(/^[\x20-\x7e]*$/u);
    expect(evidence.excerpt.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
  }
  return { evidence, outcome, text: JSON.stringify(outcome) };
}

describe('an org spend-limit 400 is its own category, distinct from credit and auth, and never a class change', () => {
  it('the category is spend_limit; credit and auth wording are not', () => {
    expect(providerMessageClass('You have reached your specified API usage limits.')).toBe('spend_limit');
    expect(providerMessageClass('You have reached your specified workspace API usage limits.')).toBe('spend_limit');
    expect(providerMessageClass('Your credit balance is too low to access the Anthropic API.')).toBe('credit_too_low');
    expect(providerMessageClass('invalid x-api-key')).toBe('other');
  });

  it('spend limit: failure class provider_error, neither insufficient_credit nor authentication_failed', async () => {
    const { outcome, evidence } = await refusalOf('You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.');
    expect(outcome.failureClass).toBe('provider_error');
    expect(outcome.failureClass).not.toBe('insufficient_credit');
    expect(outcome.failureClass).not.toBe('authentication_failed');
    expect(evidence.messageClass).toBe('spend_limit');
  });

  it('a message carrying BOTH credit and spend-limit text stays insufficient_credit, exactly as the frozen rule says', async () => {
    const { outcome, evidence } = await refusalOf('Your credit balance is too low. You have reached your specified API usage limits.');
    expect(outcome.failureClass).toBe('insufficient_credit');
    expect(evidence.messageClass).toBe('credit_too_low');
  });

  it('a 401 with spend-limit wording is still authentication_failed: the category never moves a status class', async () => {
    const urls: string[] = [];
    const outcome = await runAnthropicArchitect(PROMPT_REQUEST, {
      fetch: (async (url: RequestInfo | URL) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'You have reached your specified API usage limits.' } }), { status: 401 });
      }) as typeof fetch,
    });
    expect(urls).toHaveLength(1);
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.failureClass).toBe('authentication_failed');
    expect(outcome.refusal?.providerMessage?.messageClass).toBe('spend_limit');
  });
});

describe('hostile excerpts: no key, organization detail or prompt text is ever stored', () => {
  const ORG_UUID = 'aff8a85a-82c3-4ca7-afa7-8d3f63856dc4';
  const rows: readonly { name: string; message: string; never: readonly string[]; omitted?: string; kept?: string }[] = [
    { name: 'org uuid', message: `organization ${ORG_UUID} has reached its limit`, never: [ORG_UUID, 'aff8a85a', '8d3f63856dc4'] },
    { name: 'org uuid split by spaces into its hex groups', message: 'org aff8a85a 82c3 4ca7 afa7 8d3f63856dc4 blocked', never: ['aff8a85a', '8d3f63856dc4'] },
    { name: 'short org hex prefix', message: 'org aff8a85a over limit', never: ['aff8a85a'] },
    { name: 'workspace id (31 chars, below the long-token rule): redacted, excerpt kept', message: 'workspace wrkspc_01TFFXWF62v6c3KaYy8gVTEe is over its limit', never: ['wrkspc_01TFFXWF62v6c3KaYy8gVTEe', '01TFFXWF62'], kept: 'workspace [redacted] is over its limit' },
    { name: 'org / user / apikey prefixed ids', message: 'org_01FAKEORGID99 user_01FAKEUSER99 apikey_01FAKEKEYID99 denied', never: ['FAKEORGID', 'FAKEUSER', 'FAKEKEYID'] },
    { name: 'sk-ant key split by zero-width spaces', message: `bad key ${interleave('sk-ant-api03-FAKE0000ZZ', '\u200b')} supplied`, never: ['FAKE', '0000ZZ', 'api03'] },
    { name: 'xai key split by every invisible mark', message: `key ${ZW.map((mark) => `xai-${interleave('FAKEabc123', mark)}`).join(' ')} rejected`, never: ['FAKE', 'abc123'] },
    { name: 'raw architect key echoed', message: `x-api-key ${KEY} is not valid`, never: [KEY, 'FAKETESTNOTREAL', 'architect-key'] },
    { name: 'raw architect key echoed with zero-width joins', message: `key ${interleave(KEY, '\u200d')} not valid`, never: ['FAKETESTNOTREAL', 'architect-key', 'key-0000'] },
    { name: 'a truncated fragment of the real key (below every shape rule): no excerpt', message: 'key FAKETESTNOTREAL-architect-key here', never: ['FAKETESTNOTREAL'], omitted: 'unsafe_residue' },
    { name: 'a short prefixed id fragment left behind: no excerpt', message: 'org_abc denied', never: ['org_abc'], omitted: 'unsafe_residue' },
    { name: 'the real key with its separator swapped', message: 'key FAKETESTNOTREAL_architect_key_0000 is not valid', never: ['FAKETESTNOTREAL', 'key_0000'] },
    { name: 'prompt text (input) with zero-width chars between every letter', message: `messages.0.content: ${interleave('the invoice export drops the last line item', '\u200b')}`, never: ['invoice', 'export', 'i?n?v', 'Jane'] },
    { name: 'prompt text (system) with soft hyphens', message: `system: ${interleave('Plan the change carefully and cite the files', '\u00ad')}`, never: ['carefully', 'P?l?a?n', 'acme'] },
    { name: 'prompt text with confusable Cyrillic letters', message: 'messages.0: the \u0456nvoice export drops the last line item', never: ['nvoice export', 'line item'] },
  ];
  for (const row of rows) {
    it(row.name, async () => {
      const { evidence, text } = await refusalOf(row.message);
      for (const fragment of row.never) expect(text, `${fragment} never travels`).not.toContain(fragment);
      if (evidence.excerpt !== null) expect(evidence.excerptOmitted).toBeNull();
      if (row.omitted !== undefined) expect(evidence).toMatchObject({ excerpt: null, excerptOmitted: row.omitted });
      if (row.kept !== undefined) expect(evidence).toMatchObject({ excerpt: row.kept, excerptOmitted: null });
    });
  }

  it('zero-width marks never survive into a kept excerpt as placeholders', async () => {
    const { evidence } = await refusalOf(`Schema is too ${ZW.join('')}complex for compilation.`);
    // The category reads the raw message, as the class does; only the excerpt is cleaned.
    expect(evidence.messageClass).toBe('other');
    expect(evidence.excerpt).toBe('Schema is too complex for compilation.');
  });

  it('a legitimate spend-limit message keeps its excerpt (the redaction does not eat dates)', async () => {
    const message = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.';
    const { evidence } = await refusalOf(message);
    expect(evidence).toMatchObject({ messageClass: 'spend_limit', excerpt: message, excerptOmitted: null });
  });
});
