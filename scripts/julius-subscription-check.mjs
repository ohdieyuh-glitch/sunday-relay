#!/usr/bin/env node
/**
 * THE CODING AGENT'S SUBSCRIPTION, JUDGED WITHOUT AN API KEY AND WITHOUT PRINTING A SECRET.
 *
 * FOUNDER RULE: the Coding Agent (Claude Agent SDK) authenticates with the founder's
 * Claude Max subscription and never bills the Anthropic API. On a GitHub runner the
 * subscription arrives as a `claude setup-token` token in `CLAUDE_CODE_OAUTH_TOKEN`.
 * This replaces the workflow's `GET /v1/models` API-key probe for the Coding Agent,
 * which could only ever prove an API key.
 *
 * THIS FILE STARTS NO PROCESS. The workflow runs the Agent SDK's bundled CLI itself,
 * as a literal command in the YAML — `env -i` with an allow-list of PATH, a fresh
 * HOME, CI/NO_COLOR/TERM and the token, from an empty temporary directory — so the
 * repository boundary scan can read every command a paid run executes. This script
 * only judges what the CLI wrote, and the step's own environment:
 *
 *   env-check       before the CLI runs: the token is PRESENT and no variable that
 *                   outranks it or leaves the subscription path is set in the step.
 *                   Silent on success; one closed SUBSCRIPTION_NOT_READY line if not.
 *   status-verdict  `auth status --json` on stdin. Passes only for a logged-in
 *                   first-party subscription path (`oauth_token` or `claude.ai`)
 *                   with no API-key source. Repeats env-check first.
 *   smoke-verdict   `claude -p "Reply with exactly OK" --output-format json` on stdin,
 *                   with `--status-file` naming the status JSON of the same run.
 *                   PASS only for a clean exact "OK" beside a subscription status.
 *
 * FAIL CLOSED. There is no fallback: an API-key method, an API-key source, a third
 * party, an unreadable answer or a missing token is SUBSCRIPTION_NOT_READY / FAIL,
 * never a reason to try ANTHROPIC_API_KEY.
 *
 * NOTHING THE CLI PRINTS IS REPEATED. Its JSON is parsed for closed fields and
 * discarded; its stderr is never read. Every line printed here is built from a
 * closed vocabulary. The token is never read, compared, logged or returned: its
 * PRESENCE is the only thing checked.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
/**
 * Every name documented to outrank the setup-token token or to leave the
 * subscription path. Kept equal to `ANTHROPIC_CREDENTIAL_ENV_NAMES` in
 * relay-bridge/hosted-coding-agent/hosted-auth.ts by a test.
 */
export const OUTRANKING_ENV_NAMES = Object.freeze([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK',
]);
const PLANS = Object.freeze(['max', 'pro', 'team', 'enterprise']);
const SUBSCRIPTION_METHODS = Object.freeze(['oauth_token', 'claude.ai']);

const closed = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * The step's environment, by PRESENCE only. `null` when the subscription path is
 * clear; otherwise a closed reason. The token's value is never read.
 */
export function envReason(env) {
  if (!env[TOKEN_ENV]) return 'TOKEN_MISSING';
  const outranking = OUTRANKING_ENV_NAMES.filter((name) => env[name]);
  return outranking.length > 0 ? `OUTRANKED_BY_${outranking.join('+')}` : null;
}

/**
 * `auth status --json` stdout → closed fields and a verdict. The raw text is not kept.
 * MEASURED 2026-09-29 (placeholder token, bundled CLI 2.1.220): token only answers
 * `loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty"` with NO
 * `subscriptionType`; a key beside it adds `apiKeySource`. So a plan is recorded
 * when reported and `absent` otherwise — asserted to be a subscription plan when
 * present, and required only under `--require-plan`.
 */
export function statusVerdict(raw, requirePlan = null) {
  let parsed = null;
  try { parsed = JSON.parse(raw ?? ''); } catch { parsed = null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, method: 'unreadable', provider: 'unreadable', plan: 'unreadable', keySource: 'unreadable', reason: 'STATUS_UNREADABLE' };
  }
  const loggedIn = parsed.loggedIn === true;
  const method = closed(String(parsed.authMethod ?? 'none').toLowerCase(), ['oauth_token', 'claude.ai', 'api_key', 'none'], 'other');
  const provider = String(parsed.apiProvider ?? '').toLowerCase() === 'firstparty' ? 'firstParty' : 'other';
  const planRaw = parsed.subscriptionType;
  const plan = planRaw === undefined || planRaw === null ? 'absent' : closed(String(planRaw).toLowerCase(), PLANS, 'other');
  const keySourceRaw = typeof parsed.apiKeySource === 'string' ? parsed.apiKeySource.trim().toLowerCase() : '';
  const keySource = keySourceRaw === '' || keySourceRaw === 'none' ? 'none' : 'present';
  let reason = null;
  if (!loggedIn) reason = 'NOT_LOGGED_IN';
  else if (keySource !== 'none' || method === 'api_key') reason = 'API_KEY_IN_PLAY';
  else if (provider !== 'firstParty') reason = 'NOT_FIRST_PARTY';
  else if (!SUBSCRIPTION_METHODS.includes(method)) reason = 'NOT_A_SUBSCRIPTION_METHOD';
  else if (plan === 'other') reason = 'PLAN_NOT_A_SUBSCRIPTION';
  else if (requirePlan !== null && plan !== requirePlan) reason = 'PLAN_NOT_REQUIRED_PLAN';
  return { ok: reason === null, method, provider, plan, keySource, reason };
}

/** `claude -p --output-format json` stdout → PASS only for a clean, exact "OK". */
export function smokeVerdict(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw ?? ''); } catch { parsed = null; }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, reply: 'UNREADABLE' };
  if (parsed.is_error === true) return { ok: false, reply: 'ERROR' };
  const text = typeof parsed.result === 'string' ? parsed.result.trim() : null;
  if (text === 'OK') return { ok: true, reply: 'OK' };
  return { ok: false, reply: 'UNEXPECTED' };
}

const safeLabel = (value) => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/u.test(value) ? value : 'unpinned');
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const readFile = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

const USAGE = 'usage: julius-subscription-check.mjs env-check|status-verdict|smoke-verdict'
  + ' [--for status|smoke] [--model <id>] [--require-plan max|pro|team|enterprise] [--status-file <path>] (CLI JSON on stdin)';

/**
 * @param argv  the arguments after the script
 * @param env   the STEP's environment, inspected by presence only
 * @param io    `print` for the closed lines; `stdin` and `readFile` for the CLI's JSON
 */
export function main(argv, env = process.env, io = {}) {
  const print = io.print ?? ((line) => process.stdout.write(`${line}\n`));
  const stdin = io.stdin ?? readStdin;
  const read = io.readFile ?? readFile;
  const mode = argv[0];
  const flag = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] ?? null : null; };
  const model = safeLabel(flag('model'));
  const requirePlan = flag('require-plan');
  const purpose = flag('for') ?? (mode === 'smoke-verdict' ? 'smoke' : 'status');
  if (!['env-check', 'status-verdict', 'smoke-verdict'].includes(mode) || !['status', 'smoke'].includes(purpose)) {
    print(USAGE);
    return 2;
  }
  if (requirePlan !== null && !PLANS.includes(requirePlan)) { print('subscription_check result=REQUIRE_PLAN_UNKNOWN'); return 2; }
  const label = purpose === 'status' ? 'provider_readiness provider=anthropic' : 'subscription_smoke_auth provider=anthropic';
  const notReady = (reason) => { print(`${label} model=${model} http=none auth=CLAUDE_SUBSCRIPTION reason=${reason} result=SUBSCRIPTION_NOT_READY`); return 1; };

  // PRESENCE ONLY, and repeated by every mode: no verdict is given in a step whose
  // environment could have put the CLI on anything but the token.
  const blocked = envReason(env);
  if (blocked !== null) return notReady(blocked);
  if (mode === 'env-check') return 0;

  if (mode === 'status-verdict') {
    const verdict = statusVerdict(stdin(), requirePlan);
    if (!verdict.ok) return notReady(verdict.reason);
    print(`${label} model=${model} http=none auth=CLAUDE_SUBSCRIPTION method=${verdict.method} plan=${verdict.plan} result=SUBSCRIPTION_LOGIN_PRESENT`);
    return 0;
  }

  // smoke-verdict: a reply counts only beside a subscription status from the same run.
  const statusFile = flag('status-file');
  const status = statusVerdict(statusFile === null ? '' : read(statusFile), requirePlan);
  const method = status.ok ? status.method : 'none';
  const answer = status.ok ? smokeVerdict(stdin()) : { ok: false, reply: 'NO_SUBSCRIPTION_STATUS' };
  print(`subscription_smoke provider=anthropic model=${model} auth=CLAUDE_SUBSCRIPTION method=${method} reply=${answer.reply} result=${answer.ok ? 'PASS' : 'FAIL'}`);
  return answer.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
