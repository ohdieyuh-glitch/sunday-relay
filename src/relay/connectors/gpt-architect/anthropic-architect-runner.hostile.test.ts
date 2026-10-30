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

async function refusalOf(message: string, apiKey: string = KEY) {
  const urls: string[] = [];
  const outcome = await runAnthropicArchitect({ ...PROMPT_REQUEST, apiKey }, {
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

/*
 * PILOT REVIEW OF dcf7cd28 (M1, M3, L2, L3, L5). Each row failed on dcf7cd28
 * before the fix in the same commit. Classification is asserted unchanged by
 * `refusalOf` on every row (the frozen status rule).
 */
describe('PILOT M1: authorization schemes never keep their credential', () => {
  const rows: readonly { name: string; message: string; never: readonly string[] }[] = [
    { name: 'Authorization: Basic <b64>', message: 'Authorization: Basic dXNlcjpwYXNz rejected', never: ['dXNlcjpwYXNz'] },
    { name: 'bare Basic <b64> with padding', message: 'header Basic dXNlcjpwYXNzd29yZA== is not accepted', never: ['dXNlcjpwYXNzd29yZA'] },
    { name: 'authorization=Token <value>', message: 'authorization=Token abc123def456 refused', never: ['abc123def456'] },
    { name: 'Authorization: Bearer <value>', message: 'Authorization: Bearer abcDEF123xyz refused', never: ['abcDEF123xyz'] },
    { name: 'bare Token <value> with a digit', message: 'Token Zx9Yw8Vu is revoked', never: ['Zx9Yw8Vu'] },
    { name: 'x-api-key: Basic <b64>', message: 'x-api-key: Basic QWxhZGRpbjpvcGVu', never: ['QWxhZGRpbjpvcGVu'] },
  ];
  for (const row of rows) {
    it(row.name, async () => {
      const { text } = await refusalOf(row.message);
      for (const fragment of row.never) expect(text, `${fragment} never travels`).not.toContain(fragment);
    });
  }
});

describe('PILOT M3: the request key in pieces or encodings omits the excerpt (fails closed)', () => {
  const KEY20 = 'Zq7Wm2Kp9Rt4Vx8Lb3Nc';
  const KEY_SYM = 'Zq7Wm2Kp9Rt4/x8Lb3N+';
  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
  const b64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
  const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');
  const rev = (text: string): string => text.split('').reverse().join('');
  const rows: readonly { name: string; key: string; message: string; never: readonly string[] }[] = [
    { name: '20-char key split 10+10', key: KEY20, message: `bad key ${KEY20.slice(0, 10)} ${KEY20.slice(10)} here`, never: [KEY20.slice(0, 10), KEY20.slice(10)] },
    { name: 'key split every 5 characters', key: KEY20, message: `key ${KEY20.match(/.{1,5}/gu)!.join(' ')} denied`, never: [KEY20.slice(0, 5), KEY20.slice(15)] },
    { name: 'key split every 4 characters with dashes', key: KEY20, message: `key ${KEY20.match(/.{1,4}/gu)!.join('-')} denied`, never: [KEY20.slice(0, 4), KEY20.slice(16)] },
    { name: 'base64 of the key', key: KEY20, message: `credential ${b64(KEY20)} rejected`, never: [b64(KEY20).slice(0, 12)] },
    { name: 'base64url of the key', key: KEY_SYM, message: `credential ${b64url(KEY_SYM)} rejected`, never: [b64url(KEY_SYM).slice(0, 12)] },
    { name: 'URL-encoded key', key: KEY_SYM, message: `credential ${encodeURIComponent(KEY_SYM)} rejected`, never: ['Zq7Wm2Kp9Rt4', '%2F', 'x8Lb3N'] },
    { name: 'hex of the key', key: KEY20, message: `credential ${hex(KEY20)} rejected`, never: [hex(KEY20).slice(0, 12)] },
    { name: 'hex of the key split every 6', key: KEY20, message: `credential ${hex(KEY20).match(/.{1,6}/gu)!.join(' ')} rejected`, never: [hex(KEY20).slice(0, 6), hex(KEY20).slice(6, 12)] },
    { name: 'reversed key', key: KEY20, message: `credential ${rev(KEY20)} rejected`, never: [rev(KEY20).slice(0, 10)] },
    { name: 'a 6-character run of the key', key: KEY20, message: 'value Kp9Rt4 rejected', never: ['Kp9Rt4'] },
    { name: 'the base64 of 6 key characters (8 base64 characters)', key: KEY20, message: `value ${b64(KEY20).slice(0, 8)} rejected`, never: [b64(KEY20).slice(0, 8)] },
    { name: 'the hex of 6 key characters split 6+6', key: KEY20, message: `value ${hex(KEY20).slice(0, 6)} ${hex(KEY20).slice(6, 12)} rejected`, never: [hex(KEY20).slice(0, 6), hex(KEY20).slice(6, 12)] },
    { name: 'upper-cased key in two halves', key: KEY20, message: `KEY ${KEY20.toUpperCase().slice(0, 10)} ${KEY20.toUpperCase().slice(10)}`, never: [KEY20.toUpperCase().slice(0, 10)] },
  ];
  for (const row of rows) {
    it(row.name, async () => {
      const { evidence, text } = await refusalOf(row.message, row.key);
      for (const fragment of row.never) expect(text, `${fragment} never travels`).not.toContain(fragment);
      expect(evidence.excerptOmitted === 'unsafe_residue' || (evidence.excerpt ?? '').includes('[redacted]')).toBe(true);
    });
  }

  it('the whole key in another case is redacted by value and the excerpt is kept', async () => {
    const { evidence } = await refusalOf(`invalid key ${KEY20.toUpperCase()}`, KEY20);
    expect(evidence).toMatchObject({ excerpt: 'invalid key [redacted]', excerptOmitted: null });
  });

  it('a 5-character run is below the rule and stays (documented residual)', async () => {
    const { evidence } = await refusalOf('value Kp9Rt rejected', KEY20);
    expect(evidence).toMatchObject({ excerpt: 'value Kp9Rt rejected', excerptOmitted: null });
  });
});

describe('PILOT L2/L3/L5: folded prefixes, bare passwords, key_ remnants, spelled-out e-mail, IPv6', () => {
  const rows: readonly { name: string; message: string; never: readonly string[]; omitted?: string }[] = [
    { name: 'Cyrillic s + non-breaking hyphen sk-ant prefix', message: 'key \u0455k\u2011ant-abc123 invalid', never: ['abc123'] },
    { name: 'en-dash separated sk-ant key', message: 'key sk\u2013ant\u2013api03\u2013AbCdEfGh invalid', never: ['AbCdEfGh', 'api03'] },
    { name: 'fullwidth sk- prefix', message: 'key \uff53\uff4b-ant-api03-FAKE99 invalid', never: ['FAKE99', 'api03'] },
    { name: 'password without : or =', message: 'password hunter2 was rejected', never: ['hunter2'] },
    { name: 'password is <value>', message: 'the password is hunter2', never: ['hunter2'] },
    { name: 'key_ remnant below the id rule', message: 'key_ab denied', never: ['key_ab'], omitted: 'unsafe_residue' },
    { name: 'spelled-out e-mail', message: 'contact jane dot roe at example dot com', never: ['example', 'roe'] },
    { name: 'bracketed e-mail', message: 'contact jane[at]example[dot]com now', never: ['example'] },
    { name: 'compressed IPv6', message: 'from 2001:db8::1 refused', never: ['2001:db8', 'db8::1'] },
    { name: 'full IPv6', message: 'from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 refused', never: ['85a3', '7334'] },
    { name: 'IPv6 with letter-only groups', message: 'from fe80:abcd:dead:beef:cafe refused', never: ['abcd', 'dead:beef'] },
  ];
  for (const row of rows) {
    it(row.name, async () => {
      const { evidence, text } = await refusalOf(row.message);
      for (const fragment of row.never) expect(text, `${fragment} never travels`).not.toContain(fragment);
      if (row.omitted !== undefined) expect(evidence).toMatchObject({ excerpt: null, excerptOmitted: row.omitted });
    });
  }

  it('benign text is untouched: times, words after token, plain prose', async () => {
    for (const message of ['Request too large: max_tokens 20000 exceeds the limit at 10:30 UTC.', 'token count exceeds the context window', 'Basic plan workspaces cannot use this model']) {
      const { evidence } = await refusalOf(message);
      expect(evidence.excerptOmitted, message).toBeNull();
    }
  });
});

describe('Skywalker F1: the whole key never survives in a kept excerpt, whatever splits it', () => {
  const chunks = (text: string, size: number): string[] => text.match(new RegExp(`.{1,${size}}`, 'gu'))!;
  // Format (Cf) characters and combining marks (M) that the fixed invisible list does not name.
  const UNLISTED = ['\u2061', '\u2062', '\u2063', '\u2064', '\u206a', '\u206f', '\ufff9', '\u{e0020}', '\u0301', '\u20dd', '\u034f'] as const;
  for (const size of [10, 11, 12, 13, 14]) {
    it(`the request key split by spaces into ${String(size)}-character chunks`, async () => {
      const { evidence } = await refusalOf(`key ${chunks(KEY, size).join(' ')} invalid`);
      const kept = JSON.stringify(evidence);
      for (const piece of chunks(KEY, size).filter((p) => p.length >= 6)) expect(kept, piece).not.toContain(piece);
      expect(evidence).toMatchObject({ excerpt: null, excerptOmitted: 'unsafe_residue' });
    });
  }
  for (const mark of UNLISTED) {
    it(`the request key interleaved with U+${mark.codePointAt(0)!.toString(16).toUpperCase()} and a space every 12 characters`, async () => {
      const spaced = chunks(KEY, 12).map((piece) => interleave(piece, mark)).join(' ');
      const { evidence } = await refusalOf(`key ${spaced} invalid`);
      const kept = JSON.stringify(evidence);
      for (const piece of ['FAKETEST', 'NOTREAL', 'architect', 'key-0000']) expect(kept, piece).not.toContain(piece);
      expect(evidence.excerpt === null || !/[A-Za-z0-9]\?[A-Za-z0-9]\?[A-Za-z0-9]/u.test(evidence.excerpt)).toBe(true);
      expect(evidence).toMatchObject({ excerpt: null, excerptOmitted: 'unsafe_residue' });
    });
  }
  it('an unlisted format character or combining mark is stripped, not kept as ?', async () => {
    const { evidence } = await refusalOf('Schema is too\u2063 complex\u0301 for compilation.');
    expect(evidence).toMatchObject({ excerpt: 'Schema is too complex for compilation.', excerptOmitted: null });
  });
  it('NOT TIGHTENED: legitimate provider text is still kept whole', async () => {
    for (const message of [
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
      'messages: text content blocks must be non-empty',
    ]) {
      const { evidence } = await refusalOf(message);
      expect(evidence, message).toMatchObject({ excerpt: message, excerptOmitted: null });
    }
  });
});
