import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_COUNT_TOKENS_URL,
  anthropicArchitectRequestBody,
  anthropicBodyShape,
  anthropicBodyShapeFragment,
  anthropicCountTokensBody,
  anthropicEvidenceLevels,
  anthropicEvidenceLine,
  anthropicSchemaLimitsCheck,
  COUNT_TOKENS_ENDPOINT_ONLY_FIELDS,
  anthropicMessageEvidence,
  anthropicProbeMatrix,
  anthropicStructuredOutputSchema,
  classifyAnthropicStatus,
  firstFailingAnthropicProbe,
  runAnthropicArchitect,
  runAnthropicProbes,
  sanitizeProbeMessage,
  PROBE_MESSAGE_MAX_CHARS,
} from '../../src/relay/connectors/gpt-architect/anthropic-architect-runner';
import type { GptArchitectConfig } from '../../src/relay/connectors/gpt-architect/config';
import { ARCHITECT_PROBE_SYNTHETIC_INPUT, architectPlanProbeParts, architectProviderRefusalLine } from './live-workers';
import { juliusAnthropicAcceptanceProbesEnabled, runJuliusAnthropicAcceptanceProbesIfOptedIn } from '../julius-live-mission';

/**
 * THE $0 ACCEPTANCE PROBE AND THE REFUSAL DIAGNOSTICS, on the ACTUAL production request.
 *
 * Run 40698923582 sent `POST /v1/messages` once and got `400 invalid_request_error`, while every
 * preflight line before it (`GET /v1/models`, http 200) had passed: the preflight never sent a Messages
 * request. Everything here uses the real builder, the real transformed production schema and the real
 * charter. Nothing opens a socket: every request goes to an injected fetch.
 */

const KEY = 'FAKETESTNOTREAL-architect-key-0000';
const CONFIG: GptArchitectConfig = {
  apiKeyPresent: true, model: 'claude-opus-5-5', liveMode: true, maxOutputTokens: 20_000, timeoutMs: 1_000, unusable: [], reasoningEffort: 'high',
};
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

function production() {
  const parts = architectPlanProbeParts();
  const schema = anthropicStructuredOutputSchema(parts.schema);
  const body = anthropicArchitectRequestBody(
    { instructions: parts.instructions, input: ARCHITECT_PROBE_SYNTHETIC_INPUT },
    { model: CONFIG.model as string, maxOutputTokens: CONFIG.maxOutputTokens, reasoningEffort: CONFIG.reasoningEffort },
    schema,
  );
  return { parts, schema, body };
}

interface Call { readonly url: string; readonly init: RequestInit }
const ok = (): Response => new Response(JSON.stringify({ input_tokens: 123 }), { status: 200, headers: { 'request-id': 'req_011CFAKEOK0001' } });
const bad = (message: string, status = 400): Response =>
  new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status, headers: { 'request-id': 'req_011CFAKEBAD0001' } });
function fetchWith(answer: (call: Call, index: number) => Response | Error, calls: Call[] = []): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const result = answer(call, calls.length - 1);
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
}

function headerNames(headers: HeadersInit | undefined): string[] {
  if (headers == null) return [];
  if (headers instanceof Headers) return [...headers.keys()].map((name) => name.toLowerCase());
  if (Array.isArray(headers)) return headers.map(([name]) => name.toLowerCase());
  return Object.keys(headers).map((name) => name.toLowerCase());
}

describe('the production request body: one builder, golden hashes', () => {
  it('the live call and the probe send byte-identical bodies except max_tokens', async () => {
    const { parts, body } = production();
    const calls: Call[] = [];
    await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: parts.instructions, input: ARCHITECT_PROBE_SYNTHETIC_INPUT, schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => bad('x'), calls) },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.init.body).toBe(JSON.stringify(body));
    const probeBody = anthropicCountTokensBody(body);
    expect('max_tokens' in probeBody).toBe(false);
    expect(JSON.stringify({ ...probeBody, max_tokens: 20_000 }).length).toBe(JSON.stringify({ ...body }).length);
  });

  it('golden: the transformed production schema and the whole body hash do not drift', () => {
    const { schema, body } = production();
    expect(Buffer.byteLength(JSON.stringify(schema), 'utf8')).toBe(3587);
    expect(sha(JSON.stringify(schema))).toBe(GOLDEN_SCHEMA_SHA256);
    expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'system', 'messages', 'output_config']);
    expect(sha(JSON.stringify(body))).toBe(GOLDEN_BODY_SHA256);
  });

  it('the body carries exactly the documented fields: no thinking, no sampling, no tool_choice, no prefill', () => {
    const { body } = production();
    expect(Object.keys(body)).not.toContain('thinking');
    expect(Object.keys(body)).not.toContain('temperature');
    expect(Object.keys(body)).not.toContain('tool_choice');
    expect(Object.keys(body.output_config as object)).toEqual(['format', 'effort']);
    expect((body.messages as Array<{ role: string }>).at(-1)?.role).toBe('user');
    expect(body.max_tokens as number).toBeLessThan(128_000);
  });

  it('the transformed production schema stays inside the documented structured-output limits', () => {
    const { schema } = production();
    const check = anthropicSchemaLimitsCheck(schema);
    expect(check.problems).toEqual([]);
    expect(check.optionalProperties).toBeLessThanOrEqual(24);
    expect(check.unionNodes).toBeLessThanOrEqual(16);
  });
});

describe('the structure of the exact body sent (E4b): metrics, never text', () => {
  const shapeOf = (system: string, input: unknown, effort: string | undefined = 'high') => {
    const parts = architectPlanProbeParts();
    const body = anthropicArchitectRequestBody({ instructions: system, input: input as string }, { model: 'claude-opus-5-5', maxOutputTokens: 20_000, reasoningEffort: effort }, anthropicStructuredOutputSchema(parts.schema));
    return anthropicBodyShape(body, JSON.stringify(body));
  };

  it('on the production body the metrics are exact and the hashes are the golden ones', () => {
    const { parts, body } = production();
    const shape = anthropicBodyShape(body, JSON.stringify(body));
    expect(shape).toMatchObject({
      model: 'claude-opus-5-5', maxTokens: 20_000, effort: 'high', messageCount: 1, contentParts: ['string'],
      systemChars: parts.instructions.length, inputChars: ARCHITECT_PROBE_SYNTHETIC_INPUT.length,
      hasNul: false, hasLoneSurrogate: false, hasControlChars: false, emptySystem: false, emptyInput: false, jsonValid: true,
      bodyBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'), schemaBytes: 3587,
    });
    expect(shape.bodySha256).toBe(GOLDEN_BODY_SHA256);
    expect(shape.schemaSha256).toBe(GOLDEN_SCHEMA_SHA256);
  });

  it('bytes are bytes, chars are chars: a multi-byte input is counted both ways', () => {
    const shape = shapeOf('s', 'é漢😀');
    expect(shape.inputChars).toBe(4);
    expect(shape.inputBytes).toBe(Buffer.byteLength('é漢😀', 'utf8'));
    expect(shape.inputBytes).toBeGreaterThan(shape.inputChars);
  });

  it('flags NUL, a lone surrogate, control characters and empty strings, and a body that does not round-trip', () => {
    expect(shapeOf('s', 'a\u0000b').hasNul).toBe(true);
    expect(shapeOf('s', 'a\u0000b').hasControlChars).toBe(true);
    expect(shapeOf('s', 'a\uD800b').hasLoneSurrogate).toBe(true);
    expect(shapeOf('s', 'a😀b').hasLoneSurrogate).toBe(false);
    expect(shapeOf('line\nbreak\ttab', 'x').hasControlChars).toBe(false);
    expect(shapeOf('s', 'a\u0007b').hasControlChars).toBe(true);
    expect(shapeOf('  ', 'x').emptySystem).toBe(true);
    expect(shapeOf('s', '').emptyInput).toBe(true);
    const parts = architectPlanProbeParts();
    const body = anthropicArchitectRequestBody({ instructions: 's', input: 'x' }, { model: 'claude-opus-5-5', maxOutputTokens: 1 }, anthropicStructuredOutputSchema(parts.schema));
    expect(anthropicBodyShape(body, '{not json').jsonValid).toBe(false);
    expect(anthropicBodyShape(body, JSON.stringify(body, null, 2)).jsonValid).toBe(false);
    expect(anthropicBodyShape(body, JSON.stringify(body)).effort).toBeNull();
  });

  it('counts the messages', () => {
    const body = { model: 'claude-opus-5-5', max_tokens: 5, system: 's', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] };
    expect(anthropicBodyShape(body, JSON.stringify(body))).toMatchObject({ messageCount: 3, contentParts: ['string', 'string', 'string'], inputChars: 1 });
    const empty = { model: 'claude-opus-5-5', system: 's', messages: [] as unknown[] };
    expect(anthropicBodyShape(empty, JSON.stringify(empty))).toMatchObject({ messageCount: 0, contentParts: [], emptyInput: true });
  });

  it('content parts are listed by type token in order', () => {
    const parts = architectPlanProbeParts();
    const body = { model: 'claude-opus-5-5', max_tokens: 5, system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'Bad Type!' }] }] };
    expect(anthropicBodyShape(body, JSON.stringify(body)).contentParts).toEqual(['text', 'image', 'unknown']);
    expect(parts.schema).toBeTruthy();
  });

  it('the printable fragment carries no text: canary prompts never appear, only numbers, flags and hash prefixes', () => {
    const canary = 'SECRET-MISSION-PACKET canary prompt text';
    const fragment = anthropicBodyShapeFragment(shapeOf(canary, canary));
    expect(fragment).not.toContain('SECRET');
    expect(fragment).not.toContain('canary');
    expect(fragment).toMatch(/^shape=model:claude-opus-5-5,max_tokens:20000,effort:high,body_bytes:[0-9]+,body_sha:[0-9a-f]{16},system_chars:[0-9]+,system_bytes:[0-9]+,input_chars:[0-9]+,input_bytes:[0-9]+,messages:1,parts:string,schema_bytes:[0-9]+,schema_sha:[0-9a-f]{16},nul:0,lone_surrogate:0,ctrl:0,empty_system:0,empty_input:0,json_valid:1$/u);
  });

  it('a REAL refused call carries the shape in the evidence and the stdout line, and no prompt text anywhere', async () => {
    const parts = architectPlanProbeParts();
    const outcome = await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: 'SYSTEM-CANARY ' + parts.instructions, input: 'MISSION-PACKET-CANARY', schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => bad('invalid')) },
    );
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    expect(outcome.refusal.shape).toMatchObject({ messageCount: 1, inputChars: 'MISSION-PACKET-CANARY'.length, jsonValid: true, maxTokens: 20_000 });
    const everything = JSON.stringify(outcome) + architectProviderRefusalLine('anthropic', outcome.refusal);
    expect(everything).not.toContain('MISSION-PACKET-CANARY');
    expect(everything).not.toContain('SYSTEM-CANARY');
    expect(architectProviderRefusalLine('anthropic', outcome.refusal)).toContain(' shape=model:claude-opus-5-5,max_tokens:20000');
  });

  it('the probe lines carry the shape of the PROBE body (production probes only), so a trial can be compared with a live refusal', async () => {
    const { body } = production();
    const results = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body), fetch: fetchWith(() => ok()) });
    const by = Object.fromEntries(results.map((result) => [result.id, result.line]));
    for (const id of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']) expect(by[id]).toContain(' shape=model:claude-opus-5-5,max_tokens:unknown');
    expect(by.C1).not.toContain(' shape=');
    expect(by.P5).toContain('schema_sha:' + GOLDEN_SCHEMA_SHA256.slice(0, 16));
  });
});

describe('the token-count adapter changes ONLY the endpoint-specific fields', () => {
  it('the adapted body equals the production body minus max_tokens, field by field, byte for byte', () => {
    const { body } = production();
    const adapted = anthropicCountTokensBody(body);
    expect(COUNT_TOKENS_ENDPOINT_ONLY_FIELDS).toEqual(['max_tokens']);
    expect(Object.keys(adapted)).toEqual(Object.keys(body).filter((key) => !COUNT_TOKENS_ENDPOINT_ONLY_FIELDS.includes(key)));
    for (const key of Object.keys(adapted)) expect(JSON.stringify(adapted[key])).toBe(JSON.stringify(body[key]));
    expect(JSON.stringify({ model: adapted.model, max_tokens: body.max_tokens, system: adapted.system, messages: adapted.messages, output_config: adapted.output_config })).toBe(JSON.stringify(body));
  });
  it('does not mutate the production body and keeps model, system, messages and output_config identical by value', () => {
    const { body } = production();
    const before = JSON.stringify(body);
    const adapted = anthropicCountTokensBody(body);
    expect(JSON.stringify(body)).toBe(before);
    expect(adapted.output_config).toEqual(body.output_config);
    expect(adapted.messages).toEqual(body.messages);
    expect(adapted.system).toBe(body.system);
    expect(adapted.model).toBe(body.model);
  });
});

describe('four kinds of evidence, never conflated', () => {
  it('EV1: the production schema passes the documented limits; each breach is a named problem', () => {
    const { schema } = production();
    expect(anthropicSchemaLimitsCheck(schema)).toMatchObject({ valid: true, problems: [], optionalProperties: 0 });
    expect(anthropicSchemaLimitsCheck({ type: 'object', properties: { a: { type: 'array', maxItems: 3, items: { type: 'string' } } } }).problems)
      .toEqual(expect.arrayContaining(['additionalProperties_not_false:#', 'unsupported_keyword:maxItems:#/properties/a']));
    const many = { type: 'object', additionalProperties: false, required: [], properties: Object.fromEntries(Array.from({ length: 25 }, (_v, i) => ['p' + i, { type: 'string' }])) };
    expect(anthropicSchemaLimitsCheck(many).problems).toContain('optional_properties_above_24:25');
    const unions = { type: 'object', additionalProperties: false, required: Array.from({ length: 17 }, (_v, i) => 'u' + i), properties: Object.fromEntries(Array.from({ length: 17 }, (_v, i) => ['u' + i, { anyOf: [{ type: 'string' }, { type: 'null' }] }])) };
    expect(anthropicSchemaLimitsCheck(unions).problems).toContain('union_nodes_above_16:17');
    expect(anthropicSchemaLimitsCheck({ type: 'object', additionalProperties: false, required: ['x'], properties: { x: { type: 'string', pattern: '^a' } } }).valid).toBe(false);
    expect(anthropicSchemaLimitsCheck({ type: 'object', additionalProperties: false, required: ['x'], properties: { x: { type: 'array', minItems: 2, items: { type: 'string' } } } }).problems).toContain('minItems_above_1:#/properties/x');
  });

  it('EV2 passing never sets EV3 or EV4, and always prints the warning', async () => {
    const { body, schema } = production();
    const results = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body), fetch: fetchWith(() => ok()) });
    const evidence = anthropicEvidenceLevels({ schemaCheck: anthropicSchemaLimitsCheck(schema), probeResults: results, messages: 'not_called' });
    expect(evidence).toEqual({ ev1: 'PASS', ev2: 'PASS', ev3: 'NOT_OBSERVED', ev4: 'NOT_OBSERVED' });
    expect(anthropicEvidenceLine('architect', evidence)).toBe('request_evidence role=architect EV1_OFFLINE_SCHEMA_VALID=PASS EV2_TOKEN_COUNT_ACCEPTED=PASS EV3_MESSAGES_ACCEPTED=NOT_OBSERVED EV4_GENERATION_OK=NOT_OBSERVED token_count_only=not_proof_of_messages_acceptance');
  });

  it('EV3 and EV4 come only from a real Messages outcome', () => {
    expect(anthropicEvidenceLevels({ schemaCheck: null, probeResults: null, messages: 'not_called' })).toEqual({ ev1: 'NOT_OBSERVED', ev2: 'NOT_OBSERVED', ev3: 'NOT_OBSERVED', ev4: 'NOT_OBSERVED' });
    expect(anthropicEvidenceLevels({ schemaCheck: null, probeResults: null, messages: 'accepted' })).toMatchObject({ ev3: 'PASS', ev4: 'NOT_OBSERVED' });
    expect(anthropicEvidenceLevels({ schemaCheck: null, probeResults: null, messages: 'generated' })).toMatchObject({ ev3: 'PASS', ev4: 'PASS' });
    expect(anthropicEvidenceLevels({ schemaCheck: null, probeResults: null, messages: 'refused' })).toMatchObject({ ev3: 'FAIL', ev4: 'FAIL' });
  });

  it('a failing production probe is EV2 FAIL (no warning); a failing control alone is not', async () => {
    const { body } = production();
    const failing = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body), fetch: fetchWith((call) => (String(call.init.body).includes('objectiveSummary') ? bad('x') : ok())) });
    const evidence = anthropicEvidenceLevels({ schemaCheck: null, probeResults: failing, messages: 'not_called' });
    expect(evidence.ev2).toBe('FAIL');
    expect(anthropicEvidenceLine('architect', evidence)).not.toContain('token_count_only');
    const controlOnly = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body), fetch: fetchWith((call) => (String(call.init.body).includes('"ok"') ? bad('x') : ok())) });
    expect(anthropicEvidenceLevels({ schemaCheck: null, probeResults: controlOnly, messages: 'not_called' }).ev2).toBe('PASS');
  });

  it('the printer prints the schema check, the evidence lines and the summary; a REAL refusal prints EV3/EV4 FAIL', async () => {
    const { printAnthropicAcceptanceProbes } = await import('./live-workers');
    const lines: string[] = [];
    await printAnthropicAcceptanceProbes({
      env: { ANTHROPIC_ARCHITECT_API_KEY: 'A', ANTHROPIC_API_KEY: 'C' }, architectOnAnthropic: true, architectModel: 'claude-opus-5-5', architectEffort: 'high',
      out: (line) => lines.push(line), fetch: fetchWith(() => ok()),
    });
    expect(lines).toContain('request_schema_check role=architect EV1=PASS optional=0 unions=1');
    expect(lines).toContain('request_evidence role=architect EV1_OFFLINE_SCHEMA_VALID=PASS EV2_TOKEN_COUNT_ACCEPTED=PASS EV3_MESSAGES_ACCEPTED=NOT_OBSERVED EV4_GENERATION_OK=NOT_OBSERVED token_count_only=not_proof_of_messages_acceptance');
    expect(lines.some((line) => line.includes('role=coder')), 'the coder is never probed').toBe(false);
    const parts = architectPlanProbeParts();
    const outcome = await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: parts.instructions, input: 'x', schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => bad('invalid')) },
    );
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    expect(architectProviderRefusalLine('anthropic', outcome.refusal)).toContain(' messages_accepted=FAIL generation_ok=FAIL ');
  });

  it('F6: messages_accepted is UNKNOWN for a 5xx refusal, not FAIL', async () => {
    const parts = architectPlanProbeParts();
    const outcome = await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: parts.instructions, input: 'x', schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => bad('overloaded', 503)) },
    );
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    const line = architectProviderRefusalLine('anthropic', outcome.refusal);
    expect(line).toContain('http=503');
    expect(line).toContain(' messages_accepted=UNKNOWN ');
    expect(line).not.toContain('messages_accepted=FAIL');
    expect(line).toContain(' generation_ok=FAIL ');
  });
});

describe('the probe matrix', () => {
  it('is the fixed bisection: P0..P5 are growing subsets of the production body, plus two controls', () => {
    const { body } = production();
    const probes = anthropicProbeMatrix(body);
    expect(probes.map((probe) => probe.id)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'C1', 'C2']);
    for (const probe of probes) {
      expect('max_tokens' in probe.body).toBe(false);
      expect(probe.body.model).toBe('claude-opus-5-5');
    }
    const by = Object.fromEntries(probes.map((probe) => [probe.id, probe.body]));
    expect(Object.keys(by.P0 as object)).toEqual(['model', 'messages']);
    expect(by.P1).toMatchObject({ system: body.system });
    expect(by.P2).toMatchObject({ messages: body.messages });
    expect((by.P3 as { output_config: object }).output_config).toEqual({ format: (body.output_config as { format: unknown }).format });
    expect((by.P4 as { output_config: object }).output_config).toEqual({ effort: 'high' });
    expect(by.P5).toEqual(anthropicCountTokensBody(body));
    expect((by.C1 as { output_config: { format: { schema: { properties: object } } } }).output_config.format.schema.properties).toEqual({ ok: { type: 'boolean' } });
    expect((by.C2 as { output_config: object }).output_config).toEqual({ effort: 'low' });
  });

  it('omits P4 when the mission declared no effort', () => {
    const parts = architectPlanProbeParts();
    const schema = anthropicStructuredOutputSchema(parts.schema);
    const noEffort = anthropicArchitectRequestBody({ instructions: parts.instructions, input: 'x' }, { model: 'claude-opus-5-5', maxOutputTokens: 1 }, schema);
    expect(anthropicProbeMatrix(noEffort).map((probe) => probe.id)).toEqual(['P0', 'P1', 'P2', 'P3', 'P5', 'C1', 'C2']);
  });

  it('every probe goes to the pinned count_tokens URL with only the key header, never to /v1/messages', async () => {
    const { body } = production();
    const calls: Call[] = [];
    const results = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body), fetch: fetchWith(() => ok(), calls) });
    expect(results).toHaveLength(8);
    for (const call of calls) {
      expect(call.url).toBe(ANTHROPIC_COUNT_TOKENS_URL);
      expect(call.url).not.toBe('https://api.anthropic.com/v1/messages');
      expect((call.init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
      expect(call.init.redirect).toBe('error');
      expect(String(call.init.body)).not.toContain('max_tokens');
    }
    expect(results.every((result) => result.http === 200 && result.inputTokens === 123)).toBe(true);
    expect(firstFailingAnthropicProbe(results)).toBeNull();
  });

  it('F3: count_tokens request header names are exactly the reviewed set (no anthropic-beta)', async () => {
    const REVIEWED_COUNT_TOKENS_HEADER_NAMES = ['anthropic-version', 'content-type', 'x-api-key'];
    const { body } = production();
    const calls: Call[] = [];
    await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body).slice(0, 1), fetch: fetchWith(() => ok(), calls) });
    expect(calls).toHaveLength(1);
    const names = headerNames(calls[0]?.init.headers).sort();
    expect(names).toEqual(REVIEWED_COUNT_TOKENS_HEADER_NAMES);
    expect(names).not.toContain('anthropic-beta');
  });

  it('isolates the first failing production probe and keeps the controls out of that verdict', async () => {
    const { body } = production();
    const probes = anthropicProbeMatrix(body);
    const results = await runAnthropicProbes({
      role: 'architect', apiKey: KEY, probes,
      fetch: fetchWith((call) => (String(call.init.body).includes('json_schema') && String(call.init.body).includes('objectiveSummary') ? bad('output_config.format.schema: schema is too complex for compilation') : String(call.init.body).includes('"ok"') ? bad('control failed') : ok())),
    });
    expect(firstFailingAnthropicProbe(results)).toBe('P3');
    const p3 = results.find((result) => result.id === 'P3');
    expect(p3?.message?.messageClass).toBe('schema_too_complex');
    expect(results.find((result) => result.id === 'C1')?.http).toBe(400);
    expect(results.find((result) => result.id === 'P2')?.http).toBe(200);
  });

  it('a failing CONTROL never fails the production verdict (it only calibrates)', async () => {
    const { body } = production();
    const results = await runAnthropicProbes({
      role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body),
      fetch: fetchWith((call) => (String(call.init.body).includes('"ok"') ? bad('control failed') : ok())),
    });
    expect(results.find((result) => result.id === 'C1')?.http).toBe(400);
    expect(firstFailingAnthropicProbe(results)).toBeNull();
  });

  it('a network failure is http=none, never a pass', async () => {
    const { body } = production();
    const results = await runAnthropicProbes({ role: 'coder', apiKey: KEY, probes: anthropicProbeMatrix(body).slice(0, 1), fetch: fetchWith(() => new Error('socket hang up')) });
    expect(results[0]?.http).toBeNull();
    expect(results[0]?.line).toContain('role=coder probe=P0 http=none');
    expect(firstFailingAnthropicProbe(results)).toBe('P0');
  });
});

describe('diagnostics never carry a secret or a prompt', () => {
  const CANARIES = [
    `${'sk'}-${'ant'}-api03-CANARYSECRETKEY1234567890abcdef`,
    `${'sk'}-${'ant'}-short12345`,
    'Bearer CANARYBEARERTOKEN123456',
    'canary.person@example.com',
    'deadbeefdeadbeefdeadbeefdeadbeef0',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn012345',
  ];
  const MESSAGE = `output_config.format.schema: invalid. key ${CANARIES[0]} short ${CANARIES[1]} auth ${CANARIES[2]} user ${CANARIES[3]} id ${CANARIES[4]} blob ${CANARIES[5]}   ${'word '.repeat(200)}`;

  it('a probe line is sanitized: no canary, capped, one line', async () => {
    const { body } = production();
    const results = await runAnthropicProbes({ role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body).slice(0, 1), fetch: fetchWith(() => bad(MESSAGE)) });
    const line = results[0]?.line ?? '';
    for (const canary of CANARIES) expect(line).not.toContain(canary);
    expect(line).not.toContain('\n');
    expect(line).toContain('class=schema_or_output_config');
    expect(line).toContain(`message_len=${MESSAGE.length}`);
    expect(line).toContain('http=400');
    expect(line).toContain('request_id=req_011CFAKEBAD0001');
    expect(line).not.toContain('message="');
    expect(results[0]?.probeMessage).toBeNull();
    expect(sanitizeProbeMessage(MESSAGE)).not.toMatch(/sk-ant|@example|Bearer CANARY/u);
    expect(sanitizeProbeMessage(MESSAGE).length).toBeLessThanOrEqual(PROBE_MESSAGE_MAX_CHARS);
  });

  it('F5: a mocked provider error body sentinel never appears in probe output', async () => {
    const SENTINEL = 'PROVIDER_ERROR_BODY_SENTINEL_DO_NOT_PRINT';
    const { body } = production();
    const results = await runAnthropicProbes({
      role: 'architect', apiKey: KEY, probes: anthropicProbeMatrix(body).slice(0, 1),
      fetch: fetchWith(() => bad(SENTINEL)),
    });
    const printed = results.map((result) => result.line).join('\n');
    expect(printed).not.toContain(SENTINEL);
    expect(printed).not.toContain('message="');
    expect(JSON.stringify(results)).not.toContain(SENTINEL);
    expect(results[0]?.probeMessage).toBeNull();
    expect(printed).toContain('class=other');
    expect(printed).toContain('http=400');
    expect(printed).toContain('request_id=req_011CFAKEBAD0001');
  });

  it('a REAL call keeps class, length and hash only: nothing of the message is in the outcome or the stdout line', async () => {
    const parts = architectPlanProbeParts();
    const outcome = await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: parts.instructions, input: 'SECRETMISSIONTEXT canary prompt', schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => bad(MESSAGE)) },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    const everything = JSON.stringify(outcome) + architectProviderRefusalLine('anthropic', outcome.refusal);
    for (const canary of CANARIES) expect(everything).not.toContain(canary);
    expect(everything).not.toContain('SECRETMISSIONTEXT');
    expect(everything).not.toContain('output_config.format.schema');
    expect(outcome.refusal.message).toEqual({ messageClass: 'schema_or_output_config', length: MESSAGE.length, sha256: sha(MESSAGE) });
    expect(architectProviderRefusalLine('anthropic', outcome.refusal)).toContain(`message_class=schema_or_output_config message_len=${MESSAGE.length} message_sha256=${sha(MESSAGE).slice(0, 16)}`);
  });
});

describe('message classes and the credit case', () => {
  const table: ReadonlyArray<readonly [string, string]> = [
    ['Your credit balance is too low to access the Anthropic API.', 'credit_balance'],
    ['Schema is too complex for compilation.', 'schema_too_complex'],
    ['output_config.format: unsupported keyword', 'schema_or_output_config'],
    ['effort is not supported for this model', 'effort'],
    ['max_tokens must be less than 128000', 'max_tokens'],
    ['thinking.budget_tokens is not allowed', 'thinking'],
    ['This model does not support assistant message prefill; the final assistant turn is rejected', 'prefill'],
    ['tool_choice: type "tool" and "any" are not supported', 'tool_choice'],
    ['temperature may only be set to 1', 'sampling'],
    ['Your organization does not have access to this feature', 'organization_or_access'],
    ['The model claude-x does not exist', 'model'],
    ['prompt is too long: 900000 tokens', 'request_too_large'],
    ['something unforeseen', 'other'],
  ];
  it.each(table)('%s -> %s', (message, expected) => {
    expect(anthropicMessageEvidence(message).messageClass).toBe(expected);
  });
  it('the credit refusal still classifies the FAILURE as insufficient_credit, unchanged', () => {
    expect(classifyAnthropicStatus(400, 'invalid_request_error', true)).toBe('insufficient_credit');
    expect(classifyAnthropicStatus(400, 'invalid_request_error', false)).toBe('provider_error');
  });
  it('an unreadable error body leaves message null, never a class guessed from nothing', async () => {
    const parts = architectPlanProbeParts();
    const outcome = await runAnthropicArchitect(
      { apiKey: KEY, config: CONFIG, instructions: parts.instructions, input: 'x', schema: { name: 'plan', schema: parts.schema } },
      { fetch: fetchWith(() => new Response('<html>bad gateway</html>', { status: 400 })) },
    );
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    expect(outcome.refusal.message).toBeNull();
    expect(architectProviderRefusalLine('anthropic', outcome.refusal)).not.toContain('message_class');
  });
});

const GOLDEN_SCHEMA_SHA256 = '4c878b8cf7111ddf80b5c725b681b74f52e53373bde4963a6b39c3401f76e788';
const GOLDEN_BODY_SHA256 = '530a8c751811d909162da72086c87cadc1fb2b7caa301ca2317e22e0a26be6fe';

describe('the observe-mode printer used by the live entrypoint preflight', () => {
  it('the key variable names are the ones J1_ROLE_CREDENTIALS names (live-workers cannot import live-composition)', async () => {
    const { J1_ROLE_CREDENTIALS } = await import('./live-composition');
    const { ARCHITECT_KEY_ENV, CODER_KEY_ENV } = await import('./live-workers');
    expect(J1_ROLE_CREDENTIALS.find((row) => row.role === 'PROMPT_ARCHITECT')?.keyEnv).toBe(ARCHITECT_KEY_ENV);
    expect(J1_ROLE_CREDENTIALS.find((row) => row.role === 'CODING_AGENT')?.keyEnv).toBe(CODER_KEY_ENV);
  });

  it('MUTATION: prints the architect matrix only: 8 count_tokens calls (never more than 10), all with the architect key; the coder key is never read', async () => {
    const { printAnthropicAcceptanceProbes } = await import('./live-workers');
    const lines: string[] = [];
    const seen: Array<{ key: string; model: unknown }> = [];
    const fetchImpl = fetchWith((call) => {
      seen.push({ key: (call.init.headers as Record<string, string>)['x-api-key'] as string, model: (JSON.parse(String(call.init.body)) as { model: unknown }).model });
      return ok();
    });
    const read: string[] = [];
    const env = new Proxy({ ANTHROPIC_ARCHITECT_API_KEY: 'ARCH-KEY-NOTREAL', ANTHROPIC_API_KEY: 'CODER-KEY-NOTREAL' } as Record<string, string | undefined>, {
      get: (target, prop) => { read.push(String(prop)); return target[String(prop)]; },
    });
    await printAnthropicAcceptanceProbes({
      env, architectOnAnthropic: true, architectModel: 'claude-opus-5-5', architectEffort: 'high',
      out: (line) => lines.push(line), fetch: fetchImpl,
    });
    expect(seen).toHaveLength(8);
    expect(seen.length).toBeLessThanOrEqual(10);
    expect(lines.filter((line) => line.startsWith('request_acceptance role=architect')).map((line) => /probe=(\S+)/u.exec(line)?.[1]))
      .toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'C1', 'C2']);
    expect(lines.some((line) => line.includes('role=coder'))).toBe(false);
    expect(lines.filter((line) => line.startsWith('request_acceptance_summary'))).toEqual([
      'request_acceptance_summary role=architect mode=observe first_failing=none controls=C1:200,C2:200 token_count_only=not_proof_of_messages_acceptance',
    ]);
    expect(seen.every((entry) => entry.key === 'ARCH-KEY-NOTREAL')).toBe(true);
    expect(read, 'the coder key variable is never read').not.toContain('ANTHROPIC_API_KEY');
    expect(lines.join('\n')).not.toMatch(/KEY-NOTREAL/u);
  });

  it('OBSERVE ONLY: a failing probe is printed and nothing throws; a missing key is a printed skip', async () => {
    const { printAnthropicAcceptanceProbes } = await import('./live-workers');
    const lines: string[] = [];
    await printAnthropicAcceptanceProbes({
      env: { ANTHROPIC_ARCHITECT_API_KEY: 'ARCH-KEY-NOTREAL' },
      architectOnAnthropic: true, architectModel: 'claude-opus-5-5', architectEffort: undefined,
      out: (line) => lines.push(line), fetch: fetchWith(() => bad('schema is too complex')),
    });
    expect(lines.some((line) => line.includes('first_failing=P0'))).toBe(true);
    expect(lines.some((line) => line.includes('role=coder'))).toBe(false);
    const absent: string[] = [];
    await printAnthropicAcceptanceProbes({
      env: {}, architectOnAnthropic: true, architectModel: 'claude-opus-5-5', architectEffort: undefined,
      out: (line) => absent.push(line), fetch: () => { throw new Error('no key, no call'); },
    });
    expect(absent).toEqual(['request_acceptance role=architect probe=none skipped=key_or_model_absent']);
  });

  it('an unexpected error while preparing the probes is a printed skip, never a throw', async () => {
    const { printAnthropicAcceptanceProbes } = await import('./live-workers');
    const lines: string[] = [];
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } }) as Record<string, string | undefined>;
    await printAnthropicAcceptanceProbes({ env: hostile, architectOnAnthropic: true, architectModel: 'claude-opus-5-5', architectEffort: 'high', out: (line) => lines.push(line) });
    expect(lines).toEqual([
      'request_acceptance role=architect probe=none skipped=probe_error',
    ]);
  });

  it('an OpenAI architect prints no architect probes', async () => {
    const { printAnthropicAcceptanceProbes } = await import('./live-workers');
    const lines: string[] = [];
    await printAnthropicAcceptanceProbes({
      env: { ANTHROPIC_API_KEY: 'CODER-KEY-NOTREAL' }, architectOnAnthropic: false, architectModel: null, architectEffort: undefined,
      out: (line) => lines.push(line), fetch: () => { throw new Error('nothing is probed'); },
    });
    expect(lines, 'an OpenAI architect and a coder key: nothing at all').toEqual([]);
  });
});

describe('the preflight call site', () => {
  it('the non-confirm-live branch opts in through the one gate, and the confirm-live path never prints probes', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(process.cwd(), 'relay-bridge', 'julius-live-mission.ts'), 'utf8');
    const start = source.indexOf("if (!flag('confirm-live')) {");
    const end = source.indexOf('return 5;', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('await runJuliusAnthropicAcceptanceProbesIfOptedIn(');
    expect(block).toContain("confirmLive: flag('confirm-live')");
    expect(block).not.toContain('printAnthropicAcceptanceProbes(');
    // Not on the confirmed live path.
    expect(source.slice(end)).not.toContain('printAnthropicAcceptanceProbes(');
    expect(source.slice(end)).not.toContain('runJuliusAnthropicAcceptanceProbesIfOptedIn(');
  });
});

describe('JULIUS_ANTHROPIC_ACCEPTANCE_PROBES is a strict opt-in', () => {
  const probeArgs = {
    architectOnAnthropic: true as const,
    architectModel: 'claude-opus-5-5',
    architectEffort: 'high',
  };

  it.each([undefined, '', 'true', '01', ' 1', '0'])(
    'env var %j: zero provider calls and the probe printer is not invoked',
    async (value) => {
      const env: Record<string, string | undefined> = {
        ANTHROPIC_ARCHITECT_API_KEY: 'ARCH-KEY-NOTREAL',
        ANTHROPIC_API_KEY: 'CODER-KEY-NOTREAL',
      };
      if (value !== undefined) env.JULIUS_ANTHROPIC_ACCEPTANCE_PROBES = value;
      const calls: Call[] = [];
      const lines: string[] = [];
      let printerInvoked = 0;
      await runJuliusAnthropicAcceptanceProbesIfOptedIn({
        env, confirmLive: false, ...probeArgs, out: (line) => lines.push(line),
        fetch: () => { throw new Error('provider touched while opted out'); },
        print: async () => { printerInvoked += 1; throw new Error('printAnthropicAcceptanceProbes invoked while opted out'); },
      });
      expect(juliusAnthropicAcceptanceProbesEnabled(env, false)).toBe(false);
      expect(printerInvoked).toBe(0);
      expect(calls).toHaveLength(0);
      expect(lines).toEqual([]);
    },
  );

  it('F4: the env gate runs before any probe construction or provider contact', async () => {
    const env = new Proxy({} as Record<string, string | undefined>, {
      get: (_target, prop) => {
        if (prop === 'JULIUS_ANTHROPIC_ACCEPTANCE_PROBES') return '';
        throw new Error(`env read before/without opt-in: ${String(prop)}`);
      },
    });
    const lines: string[] = [];
    let printerInvoked = 0;
    await runJuliusAnthropicAcceptanceProbesIfOptedIn({
      env, confirmLive: false, ...probeArgs, out: (line) => lines.push(line),
      fetch: () => { throw new Error('provider touched before the env gate'); },
      print: async () => { printerInvoked += 1; throw new Error('probe printer invoked before the env gate'); },
    });
    expect(printerInvoked).toBe(0);
    expect(lines).toEqual([]);
  });

  it('confirm-live with JULIUS_ANTHROPIC_ACCEPTANCE_PROBES=1 makes zero count_tokens calls', async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    let printerInvoked = 0;
    await runJuliusAnthropicAcceptanceProbesIfOptedIn({
      env: {
        JULIUS_ANTHROPIC_ACCEPTANCE_PROBES: '1',
        ANTHROPIC_ARCHITECT_API_KEY: 'ARCH-KEY-NOTREAL',
        ANTHROPIC_API_KEY: 'CODER-KEY-NOTREAL',
      },
      confirmLive: true, ...probeArgs, out: (line) => lines.push(line),
      fetch: fetchWith(() => ok(), calls),
      print: async (input) => {
        printerInvoked += 1;
        const { printAnthropicAcceptanceProbes } = await import('./live-workers');
        await printAnthropicAcceptanceProbes(input);
      },
    });
    expect(juliusAnthropicAcceptanceProbesEnabled({ JULIUS_ANTHROPIC_ACCEPTANCE_PROBES: '1' }, true)).toBe(false);
    expect(printerInvoked).toBe(0);
    expect(calls).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it('opt-in 1 without confirm-live is the only path that constructs probes', async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    await runJuliusAnthropicAcceptanceProbesIfOptedIn({
      env: {
        JULIUS_ANTHROPIC_ACCEPTANCE_PROBES: '1',
        ANTHROPIC_ARCHITECT_API_KEY: 'ARCH-KEY-NOTREAL',
        ANTHROPIC_API_KEY: 'CODER-KEY-NOTREAL',
      },
      confirmLive: false, ...probeArgs, out: (line) => lines.push(line),
      fetch: fetchWith(() => ok(), calls),
    });
    expect(juliusAnthropicAcceptanceProbesEnabled({ JULIUS_ANTHROPIC_ACCEPTANCE_PROBES: '1' }, false)).toBe(true);
    expect(calls).toHaveLength(8);
    expect(calls.every((call) => call.url === ANTHROPIC_COUNT_TOKENS_URL)).toBe(true);
    expect(calls.every((call) => (call.init.headers as Record<string, string>)['x-api-key'] === 'ARCH-KEY-NOTREAL')).toBe(true);
    expect(lines.some((line) => line.includes('role=coder'))).toBe(false);
    expect(lines.some((line) => line.startsWith('request_acceptance_summary') && line.includes('mode=observe') && line.includes('token_count_only=not_proof_of_messages_acceptance'))).toBe(true);
  });
});
