#!/usr/bin/env node
/**
 * Tiny non-Unreal client for POST /relay-api/wonderland/julius/ask (phase A).
 *
 *   node scripts/julius-ask-client.mjs --url http://127.0.0.1:8787 --question "What is Julius?"
 *
 * Inputs (flag, then environment): --url / JULIUS_ASK_URL, --question / JULIUS_ASK_QUESTION,
 * --key / JULIUS_ASK_IDEMPOTENCY_KEY (default: a fresh random key, never printed), JULIUS_ASK_TIMEOUT_MS (default 120000), and the credential ONLY from the environment:
 * JULIUS_ASK_SESSION (a paired native Relay-Session token) or JULIUS_ASK_OPERATOR_TOKEN. A credential is never
 * accepted as an argument (it would land in shell history) and is never printed.
 */
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = (flag('url') ?? process.env.JULIUS_ASK_URL ?? '').replace(/\/+$/, '');
const question = flag('question') ?? process.env.JULIUS_ASK_QUESTION ?? '';
const key = flag('key') ?? process.env.JULIUS_ASK_IDEMPOTENCY_KEY ?? `ask-${randomBytes(12).toString('hex')}`;
const session = process.env.JULIUS_ASK_SESSION;
const operator = process.env.JULIUS_ASK_OPERATOR_TOKEN;

if (base === '' || question.trim() === '' || (session === undefined && operator === undefined)) {
  console.error('usage: --url <bridge base url> --question <text>; set JULIUS_ASK_SESSION or JULIUS_ASK_OPERATOR_TOKEN in the environment');
  process.exit(2);
}

const authorization = session !== undefined ? `Relay-Session ${session}` : `Bearer ${operator}`;
const timeoutMs = Number(process.env.JULIUS_ASK_TIMEOUT_MS ?? 120000);
let response;
let text;
try {
  response = await fetch(`${base}/relay-api/wonderland/julius/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization, 'x-relay-idempotency-key': key },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000),
  });
  text = await response.text();
} catch (error) {
  console.error(`request failed: ${error?.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  process.exit(1);
}
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = null; }

if (!response.ok || parsed?.data === undefined) {
  console.error(`HTTP ${response.status} ${parsed?.error?.kind ?? 'unreadable response'}`);
  process.exit(1);
}
const d = parsed.data;
console.log(d.answer);
console.log(`\n[${d.role} ${d.provider} ${d.model}] tokens in=${d.usage.input} cached=${d.usage.cached} out=${d.usage.output} reasoning=${d.usage.reasoning} total=${d.usage.total}`);
console.log(`[cost ${d.costBasis}, ${d.billingPath}] ask=${d.askId} response=${d.responseId} ledger=${d.ledgerRef}`);
