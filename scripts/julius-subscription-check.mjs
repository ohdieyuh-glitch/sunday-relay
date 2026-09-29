#!/usr/bin/env node
/**
 * THE CODING AGENT'S SUBSCRIPTION, CHECKED WITHOUT AN API KEY AND WITHOUT PRINTING A SECRET.
 *
 * FOUNDER RULE: the Coding Agent (Claude Agent SDK) authenticates with the founder's
 * Claude Max subscription and never bills the Anthropic API. On a GitHub runner the
 * subscription arrives as a `claude setup-token` token in `CLAUDE_CODE_OAUTH_TOKEN`.
 * This replaces the workflow's `GET /v1/models` API-key probe for the Coding Agent,
 * which could only ever prove an API key.
 *
 *   status   zero generation. Runs `claude auth status --json` with the Agent SDK's
 *            own bundled CLI in an environment built from NOTHING but PATH, a fresh
 *            HOME, CI/NO_COLOR/TERM and the token — the same shape `hostedChildEnv`
 *            gives the Coding Agent. Passes only for a logged-in first-party
 *            subscription path (`oauth_token` or `claude.ai`) with no API-key source.
 *   smoke    `status`, then ONE `claude -p "Reply with exactly OK" --max-turns 1`
 *            in an empty temporary directory, same environment. It consumes a
 *            trivial amount of SUBSCRIPTION usage and no API credit, and proves the
 *            token is live and the pinned model is served on the subscription —
 *            which `auth status` cannot (it classified a placeholder token offline).
 *
 * NOTHING THE CLI PRINTS IS REPEATED. stdout is parsed for closed fields and
 * discarded; stderr is never read. Every line this script prints is built from a
 * closed vocabulary. The token reaches the child through its environment object —
 * never argv — and is never read, compared, logged or returned: its PRESENCE is
 * the only thing checked.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
export const EXECUTABLE_ENV = 'JULIUS_CODER_CLAUDE_EXECUTABLE';
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
const SMOKE_PROMPT = 'Reply with exactly OK';

/** The Agent SDK's own candidate order (sdk.mjs 0.3.220). */
export function sdkExecutableCandidates(platform = process.platform, arch = process.arch) {
  const suffix = platform === 'win32' ? '.exe' : '';
  const prefix = '@anthropic-ai/claude-agent-sdk';
  const packages = platform === 'linux'
    ? [`${prefix}-linux-${arch}`, `${prefix}-linux-${arch}-musl`]
    : [`${prefix}-${platform}-${arch}`];
  return packages.map((name) => `${name}/claude${suffix}`);
}

export function resolveCli(env = process.env) {
  const explicit = env[EXECUTABLE_ENV];
  if (explicit !== undefined && explicit.trim() !== '') return existsSync(explicit) ? explicit : null;
  const require = createRequire(import.meta.url);
  for (const candidate of sdkExecutableCandidates()) {
    try {
      const resolved = require.resolve(candidate);
      if (existsSync(resolved)) return resolved;
    } catch { /* not installed for this platform */ }
  }
  return null;
}

/** The child's environment, from nothing. The token is passed through, never read. */
export function composeChildEnv(parent, home) {
  return { PATH: parent.PATH ?? '', HOME: home, CI: '1', NO_COLOR: '1', TERM: 'dumb', [TOKEN_ENV]: parent[TOKEN_ENV] ?? '' };
}

const closed = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

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
  else if (method !== 'oauth_token' && method !== 'claude.ai') reason = 'NOT_A_SUBSCRIPTION_METHOD';
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

const run = (cli, args, env, cwd, timeout) => {
  const result = spawnSync(cli, args, {
    env, cwd, encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { stdout: typeof result.stdout === 'string' ? result.stdout : '', status: result.status, failed: result.error !== undefined };
};

export function main(argv, env = process.env, print = (line) => process.stdout.write(`${line}\n`)) {
  const mode = argv[0];
  const flag = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] ?? null : null; };
  const model = safeLabel(flag('model'));
  const requirePlan = flag('require-plan');
  if (mode !== 'status' && mode !== 'smoke') {
    print('usage: julius-subscription-check.mjs status|smoke [--model <id>] [--require-plan max|pro|team|enterprise]');
    return 2;
  }
  if (requirePlan !== null && !PLANS.includes(requirePlan)) { print('subscription_check result=REQUIRE_PLAN_UNKNOWN'); return 2; }
  const label = mode === 'status' ? 'provider_readiness provider=anthropic' : 'subscription_smoke_auth provider=anthropic';
  const notReady = (reason) => { print(`${label} model=${model} http=none auth=CLAUDE_SUBSCRIPTION reason=${reason} result=SUBSCRIPTION_NOT_READY`); return 1; };

  // PRESENCE ONLY. The value is never read here.
  if (!env[TOKEN_ENV]) return notReady('TOKEN_MISSING');
  const outranking = OUTRANKING_ENV_NAMES.filter((name) => env[name]);
  if (outranking.length > 0) return notReady(`OUTRANKED_BY_${outranking.join('+')}`);
  const cli = resolveCli(env);
  if (cli === null) return notReady('CLI_NOT_INSTALLED');

  const home = mkdtempSync(join(tmpdir(), 'julius-subscription-home-'));
  const work = mkdtempSync(join(tmpdir(), 'julius-subscription-smoke-'));
  try {
    const child = composeChildEnv(env, home);
    const status = run(cli, ['auth', 'status', '--json'], child, work, 30_000);
    const verdict = status.failed ? { ok: false, reason: 'CLI_DID_NOT_START', method: 'none', plan: 'absent' } : statusVerdict(status.stdout, requirePlan);
    if (!verdict.ok) return notReady(verdict.reason);
    print(`${label} model=${model} http=none auth=CLAUDE_SUBSCRIPTION method=${verdict.method} plan=${verdict.plan} result=SUBSCRIPTION_LOGIN_PRESENT`);
    if (mode === 'status') return 0;

    const args = ['-p', SMOKE_PROMPT, '--max-turns', '1', '--output-format', 'json'];
    if (model !== 'unpinned') args.push('--model', model);
    const smoke = run(cli, args, child, work, 180_000);
    const answer = smoke.failed ? { ok: false, reply: 'DID_NOT_START' } : smokeVerdict(smoke.stdout);
    print(`subscription_smoke provider=anthropic model=${model} auth=CLAUDE_SUBSCRIPTION method=${verdict.method} reply=${answer.reply} result=${answer.ok ? 'PASS' : 'FAIL'}`);
    return answer.ok ? 0 : 1;
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
