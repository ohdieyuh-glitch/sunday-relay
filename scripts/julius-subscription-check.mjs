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
 *                   with `--status-file` naming the status JSON of the same run, and
 *                   `--auth-exit` / `--cli-exit` the exit codes of that `auth status`
 *                   and that `claude -p`, as the workflow recorded them.
 *                   PASS only for a clean exact "OK" (`is_error: false`) beside a
 *                   subscription status, answered by the REQUESTED model (or its dated
 *                   build) and by NO other model, as the result's own `modelUsage`
 *                   attests, with BOTH exits reported and 0.
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

/**
 * `claude -p --output-format json` stdout → PASS only for a clean, exact "OK". Clean means the
 * result says `is_error: false` itself (the founder's criterion, literally): an absent or
 * non-boolean flag is not a clean answer, so it is UNEXPECTED, never OK.
 */
export function smokeVerdict(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw ?? ''); } catch { parsed = null; }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, reply: 'UNREADABLE' };
  if (parsed.is_error === true) return { ok: false, reply: 'ERROR' };
  const text = typeof parsed.result === 'string' ? parsed.result.trim() : null;
  if (text === 'OK' && parsed.is_error === false) return { ok: true, reply: 'OK' };
  return { ok: false, reply: 'UNEXPECTED' };
}

/**
 * WHY A SMOKE REPLY WAS NOT A CLEAN OK, IN CLOSED TOKENS ONLY.
 *
 * `smokeVerdict` says only THAT the reply failed. When the smoke of 2026-09-30 (run 36685079176)
 * failed, nothing could say why: the CLI's JSON carries its reason as free text in `result`, which
 * this file never repeats. Three things are read from it, each reduced to a closed vocabulary:
 *   subtype  the CLI's result subtype (`success`, `error_max_turns`, …) when it is a plain token;
 *   http     the JSON's `api_error_status`, or the status an `API Error: NNN` result names;
 *   reason   MODEL_NOT_ENTITLED_OR_NOT_FOUND (404 / not_found_error), AUTH (401, 403 /
 *            authentication_error, permission_error), USAGE_LIMIT (the subscription's own limit),
 *            RATE_LIMITED (429 / rate_limit_error), OVERLOADED (529 / overloaded_error), MAX_TURNS
 *            (subtype error_max_turns), UNEXPECTED_REPLY (no error, and not OK), UNREADABLE (no JSON),
 *            or OTHER.
 * The text is only MATCHED: three digits, a fixed set of error-type names and the usage-limit phrase.
 * Nothing it says is ever returned.
 */
const ERROR_TYPE_REASON = Object.freeze({
  not_found_error: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND',
  authentication_error: 'AUTH',
  permission_error: 'AUTH',
  rate_limit_error: 'RATE_LIMITED',
  overloaded_error: 'OVERLOADED',
});
const STATUS_REASON = Object.freeze({
  404: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND', 401: 'AUTH', 403: 'AUTH', 429: 'RATE_LIMITED', 529: 'OVERLOADED',
});
export function smokeFailureReason(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw ?? ''); } catch { parsed = null; }
  if (parsed === null || typeof parsed !== 'object') return { reason: 'UNREADABLE', http: 'none', subtype: 'none' };
  const subtype = typeof parsed.subtype === 'string' && /^[a-z_]{1,40}$/u.test(parsed.subtype) ? parsed.subtype : 'none';
  const text = typeof parsed.result === 'string' ? parsed.result : '';
  // `text.match`, never RegExp#exec: the boundary scan refuses the exec call form in a file a paid run executes.
  const named = text.match(/\bAPI Error: ([1-5]\d\d)\b/u);
  const status = Number.isInteger(parsed.api_error_status) && parsed.api_error_status >= 100 && parsed.api_error_status <= 599
    ? parsed.api_error_status : named === null ? null : Number(named[1]);
  const http = status === null ? 'none' : String(status);
  const errorType = text.match(/"type"\s*:\s*"(not_found_error|authentication_error|permission_error|rate_limit_error|overloaded_error)"/u);
  const reason = subtype === 'error_max_turns' ? 'MAX_TURNS'
    : errorType !== null ? ERROR_TYPE_REASON[errorType[1]]
      : /usage limit reached|\b(?:5-hour|weekly|session|opus) limit reached\b/iu.test(text) ? 'USAGE_LIMIT'
        : status !== null && STATUS_REASON[status] !== undefined ? STATUS_REASON[status]
          : parsed.is_error === true ? 'OTHER'
            : 'UNEXPECTED_REPLY';
  return { reason, http, subtype };
}

/**
 * WHICH MODEL ANSWERED THE SMOKE, AND WHETHER IT IS THE ONE ASKED FOR (founder rule, 2026-09-30:
 * no automatic downgrade, and a STOP rather than a substitute).
 *
 * The CLI's `--output-format json` result carries no turns, only `modelUsage`: the runtime's own
 * account of which models it called and what each produced. So EVERY producer must be the
 * requested model (Codex on #302, F1):
 *   - an entry PRODUCED when its `outputTokens` is a positive number;
 *   - a producer credits the requested model only when its own KEY is the requested model EXACTLY,
 *     or that model's DATED BUILD (`<requested>-YYYYMMDD`), and the SDK's `canonicalModel` for it,
 *     when the entry carries one, is one of those too. Nothing looser: an alias key credits nothing;
 *   - ONE producer that does not credit it makes the whole answer a MISMATCH. Beside the requested
 *     model it is a substitute or a fallback, and without turns nothing here could tell it from a
 *     helper. The workflow pins the CLI's small-fast model to the requested one, so a genuine
 *     housekeeping call credits it too, and this holds by construction.
 * This is STRICTER than the runtime's reading of a coder session (`hostedServedModel`,
 * relay-bridge/hosted-coding-agent/hosted-observation.ts), which has turns to attribute output with.
 * `match` is EXACT (every producer's key is the exact id), DATED_BUILD (every producer credits it,
 * one or more by its dated build), MISMATCH (a producer that does not credit it) or NONE (no
 * producer: nothing is attested). `served` is the producers' keys, largest first, at most eight,
 * or `none`, so a MISMATCH names what answered.
 *
 * A KEY IS SHOWN, NEVER RAW. Each character outside the line's own alphabet becomes `_`, and the
 * label is cut to 64. So `claude-opus-5-5[1m]` reads `claude-opus-5-5_1m_`: the smoke still STOPS on
 * it (the match is computed on the raw names, and the display cannot change a verdict), and the stop
 * says why. It used to read `unsafe`, and a stop that cannot say what answered costs a founder
 * cycle to explain.
 */
const servedLabel = (key) => key.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 64);
const DATE_SUFFIX = /^\d{8}$/u;
export function smokeServedModel(raw, requested) {
  let parsed = null;
  try { parsed = JSON.parse(raw ?? ''); } catch { parsed = null; }
  const usage = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.modelUsage : null;
  const producers = [];
  if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
    for (const [key, value] of Object.entries(usage)) {
      if (key.trim() === '' || value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const output = typeof value.outputTokens === 'number' && Number.isFinite(value.outputTokens) ? value.outputTokens : 0;
      if (output <= 0) continue;
      const canonical = typeof value.canonicalModel === 'string' && value.canonicalModel.trim() !== '' ? value.canonicalModel : null;
      producers.push({ key, canonical, output });
    }
  }
  producers.sort((a, b) => b.output - a.output || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // One name's credit: the requested id EXACTLY, its DATED BUILD, or nothing.
  const creditOf = (name) => (typeof requested !== 'string' || requested === '' ? null
    : name === requested ? 'EXACT'
      : name.startsWith(`${requested}-`) && DATE_SUFFIX.test(name.slice(requested.length + 1)) ? 'DATED_BUILD'
        : null);
  // A producer's credit is its KEY's, and only when a canonicalModel it carries credits too.
  const credits = producers.map((producer) =>
    (producer.canonical !== null && creditOf(producer.canonical) === null ? null : creditOf(producer.key)));
  const match = producers.length === 0 ? 'NONE'
    : credits.includes(null) ? 'MISMATCH'
      : credits.every((credit) => credit === 'EXACT') ? 'EXACT' : 'DATED_BUILD';
  const served = producers.length === 0 ? 'none'
    : producers.slice(0, 8).map((producer) => servedLabel(producer.key)).join(',');
  return { served, match };
}

/**
 * AN EXIT CODE THE WORKFLOW REPORTS, OR NULL (Codex on #302, F3). The CLI's JSON is not the CLI's
 * verdict on itself: an OK-looking reply followed by a non-zero exit is not a clean answer, and a
 * non-zero `auth status` makes the status file it wrote untrustworthy. The workflow records both
 * exits; the verdict must SEE them, so they arrive as `--auth-exit` and `--cli-exit`. Only a plain
 * 0-255 integer counts; anything else is unreported, and an unreported exit is a FAIL.
 */
const exitCode = (value) => (typeof value === 'string' && /^(0|[1-9]\d{0,2})$/u.test(value) && Number(value) <= 255 ? Number(value) : null);

const safeLabel = (value) => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/u.test(value) ? value : 'unpinned');
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const readFile = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

const USAGE = 'usage: julius-subscription-check.mjs env-check|status-verdict|smoke-verdict'
  + ' [--for status|smoke] [--model <id>] [--require-plan max|pro|team|enterprise] [--status-file <path>]'
  + ' [--auth-exit <0-255> --cli-exit <0-255>] (CLI JSON on stdin)';

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
  const reply = status.ok ? stdin() : '';
  const answer = status.ok ? smokeVerdict(reply) : { ok: false, reply: 'NO_SUBSCRIPTION_STATUS' };
  // A PASS NEEDS THE REQUESTED MODEL, AND ONLY IT, TO HAVE ANSWERED: an exact OK from another model,
  // from the requested one beside another that produced output, or from no model the result can
  // name, fails closed. The served line is printed for every reply read, so a pass shows which build
  // answered too.
  // A PASS ALSO NEEDS BOTH EXITS REPORTED AND 0 (F3): the auth status's and the CLI's own.
  const authExit = exitCode(flag('auth-exit'));
  const cliExit = exitCode(flag('cli-exit'));
  let pass = answer.ok;
  if (status.ok) {
    const served = smokeServedModel(reply, model);
    print(`subscription_smoke_served provider=anthropic requested=${model} served=${served.served} match=${served.match}`);
    const servedOk = served.match === 'EXACT' || served.match === 'DATED_BUILD';
    pass = answer.ok && servedOk && authExit === 0 && cliExit === 0;
    // WHY, when a reply was read and failed: its own closed line, so the PASS and FAIL lines the
    // workflow greps stay exactly as they were. ONE reason, the first that holds:
    //   EXIT_UNREPORTED    an exit is missing or not a 0-255 integer: nothing else can be trusted;
    //   AUTH_EXIT_NONZERO  the status the reply was read beside came from a failed `auth status`;
    //   the reply's own    a reply that is not a clean OK keeps its reason (an error reply exits
    //                      non-zero by design, and its MODEL_NOT_ENTITLED or USAGE_LIMIT must show);
    //   CLI_EXIT_NONZERO   an OK-looking reply the CLI itself exited non-zero on;
    //   SERVED_MODEL_…     an OK the requested model did not answer (UNATTESTED when none did).
    if (!pass) {
      const why = smokeFailureReason(reply);
      const reason = authExit === null || cliExit === null ? 'EXIT_UNREPORTED'
        : authExit !== 0 ? 'AUTH_EXIT_NONZERO'
          : !answer.ok ? why.reason
            : cliExit !== 0 ? 'CLI_EXIT_NONZERO'
              : served.match === 'NONE' ? 'SERVED_MODEL_UNATTESTED' : 'SERVED_MODEL_MISMATCH';
      print(`subscription_smoke_reason provider=anthropic model=${model} reason=${reason} http=${why.http} subtype=${why.subtype}`);
    }
  }
  print(`subscription_smoke provider=anthropic model=${model} auth=CLAUDE_SUBSCRIPTION method=${method} reply=${answer.reply} result=${pass ? 'PASS' : 'FAIL'}`);
  return pass ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
