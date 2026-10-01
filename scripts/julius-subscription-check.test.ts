import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANTHROPIC_CREDENTIAL_ENV_NAMES, CLAUDE_SUBSCRIPTION_TOKEN_ENV } from '../relay-bridge/hosted-coding-agent/hosted-auth';
import * as check from './julius-subscription-check.mjs';

/**
 * THE WORKFLOW'S SUBSCRIPTION VERDICTS.
 *
 * The workflow runs the Agent SDK's bundled CLI itself, as a literal command, and
 * pipes its JSON to `scripts/julius-subscription-check.mjs`, which only JUDGES:
 * no process is started here, so the repository boundary scan can read every
 * command a paid run executes. The verdicts are tested on fixed JSON — the shapes
 * the bundled CLI was measured to print (2026-09-29) and the shapes that must be
 * refused. The real CLI is driven through the workflow step itself in
 * `julius-paid-workflow.test.ts`. Every token here is a FAKE marked FAKETESTNOTREAL.
 */

const TOKEN = 'FAKETESTNOTREAL-oauth-token-sentinel';
const TOKEN_ENV_NAME = 'CLAUDE_CODE_OAUTH_TOKEN';
const READY = { [TOKEN_ENV_NAME]: TOKEN };
const TOKEN_ONLY = '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}';
const API_KEY_METHOD = '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}';
const OK_REPLY = '{"type":"result","is_error":false,"result":"OK"}';
/** An OK the requested model answered, as the CLI's own `modelUsage` attests it (founder, 2026-09-30: claude-opus-5-5). */
const OK_ATTESTED = '{"type":"result","subtype":"success","is_error":false,"result":"OK","modelUsage":{"claude-opus-5-5":{"inputTokens":3,"outputTokens":1}}}';
const apiError = (status: number, type: string) => JSON.stringify({
  type: 'result', subtype: 'success', is_error: true,
  result: `API Error: ${String(status)} ${JSON.stringify({ type: 'error', error: { type, message: 'model: claude-fable-5 FAKETESTNOTREAL-free-text' } })}`,
});

/** The exits the workflow reports beside a clean CLI (F3): `auth status` and `claude -p` both exited 0. */
const CLEAN_EXITS = ['--auth-exit', '0', '--cli-exit', '0'];
/** The exits beside an error reply: the real CLI exits 1 on one. */
const ERROR_EXITS = ['--auth-exit', '0', '--cli-exit', '1'];

const capture = (argv: string[], env: Record<string, string | undefined>, stdin = '', files: Record<string, string> = {}) => {
  const lines: string[] = [];
  const code = check.main(argv, env, {
    print: (line: string) => lines.push(line),
    stdin: () => stdin,
    readFile: (path: string) => files[path] ?? '',
  });
  return { code, output: lines.join('\n') };
};

describe('the lists cannot drift from the runtime they gate', () => {
  it('the outranking names are exactly hosted-auth.ts\'s credential names, and the token name matches', () => {
    expect([...check.OUTRANKING_ENV_NAMES]).toEqual([...ANTHROPIC_CREDENTIAL_ENV_NAMES]);
    expect(check.TOKEN_ENV).toBe(CLAUDE_SUBSCRIPTION_TOKEN_ENV);
  });

  it('the file a paid workflow runs starts no process: the CLI call lives in the workflow as a literal command', () => {
    const source = readFileSync(resolve(__dirname, 'julius-subscription-check.mjs'), 'utf8');
    expect(source).not.toMatch(/child_process/u);
    expect(source).not.toMatch(/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/u);
  });
});

describe('status verdicts over the measured shapes', () => {
  it('token-only and stored-login shapes pass; the plan is recorded or absent', () => {
    expect(check.statusVerdict(TOKEN_ONLY)).toMatchObject({ ok: true, method: 'oauth_token', plan: 'absent' });
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'))
      .toMatchObject({ ok: true, method: 'claude.ai', plan: 'max' });
  });

  it('a key in play, a third party, no login or an unknown plan are refused, with a closed reason', () => {
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}').reason).toBe('API_KEY_IN_PLAY');
    expect(check.statusVerdict(API_KEY_METHOD).reason).toBe('API_KEY_IN_PLAY');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}').reason).toBe('API_KEY_IN_PLAY');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"bedrock"}').reason).toBe('NOT_FIRST_PARTY');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"third_party","apiProvider":"firstParty"}').reason).toBe('NOT_A_SUBSCRIPTION_METHOD');
    expect(check.statusVerdict('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}').reason).toBe('NOT_LOGGED_IN');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"free"}').reason).toBe('PLAN_NOT_A_SUBSCRIPTION');
    expect(check.statusVerdict('garbage').reason).toBe('STATUS_UNREADABLE');
    expect(check.statusVerdict('').reason).toBe('STATUS_UNREADABLE');
    expect(check.statusVerdict('[]').reason).toBe('STATUS_UNREADABLE');
  });

  it('--require-plan max refuses an absent or different plan', () => {
    expect(check.statusVerdict(TOKEN_ONLY, 'max').reason).toBe('PLAN_NOT_REQUIRED_PLAN');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"max"}', 'max').ok).toBe(true);
  });

  it('the smoke passes only on a clean exact OK', () => {
    expect(check.smokeVerdict(OK_REPLY)).toEqual({ ok: true, reply: 'OK' });
    expect(check.smokeVerdict('{"type":"result","is_error":false,"result":" OK\\n"}').ok).toBe(true);
    expect(check.smokeVerdict('{"type":"result","is_error":false,"result":"OK!"}').reply).toBe('UNEXPECTED');
    expect(check.smokeVerdict('{"type":"result","is_error":true,"result":"Credit balance is too low"}')).toEqual({ ok: false, reply: 'ERROR' });
    expect(check.smokeVerdict('not json').reply).toBe('UNREADABLE');
    expect(check.smokeVerdict('').reply).toBe('UNREADABLE');
    // Clean means `is_error: false` said by the result itself (the founder's criterion, literally).
    for (const flag of ['', '"is_error":"false",', '"is_error":null,', '"is_error":0,', '"is_error":[],']) {
      expect(check.smokeVerdict(`{"type":"result",${flag}"result":"OK"}`), flag).toEqual({ ok: false, reply: 'UNEXPECTED' });
    }
  });
});

describe('env-check: presence only, before the CLI runs', () => {
  it('a token and nothing that outranks it: silent success', () => {
    expect(check.envReason(READY)).toBeNull();
    expect(capture(['env-check', '--model', 'claude-fable-5'], READY)).toEqual({ code: 0, output: '' });
  });

  it('no token: SUBSCRIPTION_NOT_READY / TOKEN_MISSING', () => {
    const run = capture(['env-check', '--model', 'claude-fable-5'], {});
    expect(run.code).toBe(1);
    expect(run.output).toBe('provider_readiness provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION reason=TOKEN_MISSING result=SUBSCRIPTION_NOT_READY');
  });

  it.each([...ANTHROPIC_CREDENTIAL_ENV_NAMES])('token + %s: refused by name, in every mode, the value never printed', (name) => {
    for (const mode of ['env-check', 'status-verdict', 'smoke-verdict']) {
      const run = capture([mode, '--status-file', 's.json'], { ...READY, [name]: 'FAKETESTNOTREAL-route' }, OK_REPLY, { 's.json': TOKEN_ONLY });
      expect(run.code, mode).toBe(1);
      expect(run.output, mode).toContain(`reason=OUTRANKED_BY_${name} result=SUBSCRIPTION_NOT_READY`);
      expect(run.output, mode).not.toContain('FAKETESTNOTREAL');
    }
  });

  it('the smoke purpose labels its line for the smoke log', () => {
    expect(capture(['env-check', '--for', 'smoke', '--model', 'claude-fable-5'], {}).output)
      .toBe('subscription_smoke_auth provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION reason=TOKEN_MISSING result=SUBSCRIPTION_NOT_READY');
  });
});

describe('status-verdict and smoke-verdict print the exact lines the workflow greps', () => {
  const READINESS_LINE = /^provider_readiness provider=anthropic .* auth=CLAUDE_SUBSCRIPTION method=(oauth_token|claude\.ai) .* result=SUBSCRIPTION_LOGIN_PRESENT$/u;
  const SMOKE_PASS = /^subscription_smoke provider=anthropic .* auth=CLAUDE_SUBSCRIPTION method=(oauth_token|claude\.ai) reply=OK result=PASS$/u;

  it('a token-only status: SUBSCRIPTION_LOGIN_PRESENT, matching the readiness grep', () => {
    const run = capture(['status-verdict', '--model', 'claude-fable-5'], READY, TOKEN_ONLY);
    expect(run.code).toBe(0);
    expect(run.output).toBe('provider_readiness provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION method=oauth_token plan=absent result=SUBSCRIPTION_LOGIN_PRESENT');
    expect(run.output).toMatch(READINESS_LINE);
  });

  it('an api_key method FAILS CLOSED: not ready, and no line the readiness grep would count', () => {
    const run = capture(['status-verdict', '--model', 'claude-fable-5'], READY, API_KEY_METHOD);
    expect(run.code).toBe(1);
    expect(run.output).toBe('provider_readiness provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION reason=API_KEY_IN_PLAY result=SUBSCRIPTION_NOT_READY');
    expect(run.output).not.toMatch(READINESS_LINE);
  });

  it('a CLI that printed nothing (not installed, did not start) is unreadable, never a pass', () => {
    const run = capture(['status-verdict'], READY, '');
    expect(run.code).toBe(1);
    expect(run.output).toContain('reason=STATUS_UNREADABLE result=SUBSCRIPTION_NOT_READY');
  });

  it('the smoke passes on an exact OK, answered by the requested model, beside a subscription status of the same run', () => {
    const run = capture(['smoke-verdict', '--model', 'claude-opus-5-5', '--status-file', 's.json', ...CLEAN_EXITS], READY, OK_ATTESTED, { 's.json': TOKEN_ONLY });
    expect(run.code).toBe(0);
    expect(run.output.split('\n')).toEqual([
      'subscription_smoke_served provider=anthropic requested=claude-opus-5-5 served=claude-opus-5-5 match=EXACT',
      'subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=PASS',
    ]);
    expect(run.output.split('\n').at(-1)).toMatch(SMOKE_PASS);
  });

  it('an OK beside an api_key status FAILS CLOSED: the reply is not even read', () => {
    const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json'], READY, OK_REPLY, { 's.json': API_KEY_METHOD });
    expect(run.code).toBe(1);
    expect(run.output).toBe('subscription_smoke provider=anthropic model=claude-fable-5 auth=CLAUDE_SUBSCRIPTION method=none reply=NO_SUBSCRIPTION_STATUS result=FAIL');
    expect(run.output).not.toMatch(SMOKE_PASS);
  });

  it('no status file, or an error reply, fails', () => {
    expect(capture(['smoke-verdict'], READY, OK_REPLY).code).toBe(1);
    const error = capture(['smoke-verdict', '--status-file', 's.json'], READY, '{"is_error":true,"result":"Invalid API key"}', { 's.json': TOKEN_ONLY });
    expect(error.code).toBe(1);
    expect(error.output).toContain('reply=ERROR result=FAIL');
    expect(error.output).not.toContain('Invalid API key');
  });

  it('an unsafe model label is never echoed, and an unknown mode or plan is a usage error', () => {
    expect(capture(['env-check', '--model', 'x; echo $CLAUDE_CODE_OAUTH_TOKEN'], {}).output).toContain('model=unpinned');
    expect(capture(['status'], READY).code).toBe(2);
    expect(capture(['smoke'], READY).code).toBe(2);
    expect(capture(['status-verdict', '--require-plan', 'free'], READY, TOKEN_ONLY).code).toBe(2);
  });
});

/**
 * WHY A SMOKE FAILED, SAID IN CLOSED TOKENS (2026-09-30). The smoke of run 36685079176 failed with nothing
 * but an exit code: the CLI's reason lives in its JSON as free text, which this file never repeats. These
 * shapes follow the CLI's result message. Every line printed must stay inside the closed grammar below.
 */
describe('smoke failures say why, in closed tokens only', () => {
  const REASON_LINE = /^subscription_smoke_reason provider=anthropic model=[A-Za-z0-9._-]+ reason=[A-Z_]+ http=(\d{3}|none) subtype=([a-z_]{1,40}|none)$/u;

  it.each([
    [apiError(404, 'not_found_error'), { reason: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND', http: '404', subtype: 'success' }],
    [apiError(401, 'authentication_error'), { reason: 'AUTH', http: '401', subtype: 'success' }],
    [apiError(403, 'permission_error'), { reason: 'AUTH', http: '403', subtype: 'success' }],
    [apiError(429, 'rate_limit_error'), { reason: 'RATE_LIMITED', http: '429', subtype: 'success' }],
    [apiError(529, 'overloaded_error'), { reason: 'OVERLOADED', http: '529', subtype: 'success' }],
    ['{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1759999999"}', { reason: 'USAGE_LIMIT', http: 'none', subtype: 'success' }],
    ['{"type":"result","subtype":"success","is_error":true,"result":"5-hour limit reached - resets 3pm"}', { reason: 'USAGE_LIMIT', http: 'none', subtype: 'success' }],
    ['{"type":"result","subtype":"error_max_turns","is_error":true}', { reason: 'MAX_TURNS', http: 'none', subtype: 'error_max_turns' }],
    ['{"type":"result","is_error":true,"api_error_status":429,"result":"x"}', { reason: 'RATE_LIMITED', http: '429', subtype: 'none' }],
    // The status alone, with no error type beside it.
    ['{"type":"result","is_error":true,"result":"API Error: 404 upstream"}', { reason: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND', http: '404', subtype: 'none' }],
    ['{"type":"result","is_error":true,"result":"API Error: 403 upstream"}', { reason: 'AUTH', http: '403', subtype: 'none' }],
    ['{"type":"result","is_error":true,"result":"API Error: 529 upstream"}', { reason: 'OVERLOADED', http: '529', subtype: 'none' }],
    // The error type alone, with no status beside it; and a type that outranks a status which says otherwise.
    [JSON.stringify({ type: 'result', is_error: true, result: JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } }) }), { reason: 'OVERLOADED', http: 'none', subtype: 'none' }],
    [JSON.stringify({ type: 'result', is_error: true, result: `API Error: 400 ${JSON.stringify({ type: 'error', error: { type: 'not_found_error' } })}` }), { reason: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND', http: '400', subtype: 'none' }],
    ['{"type":"result","is_error":true,"result":"rate limit reached"}', { reason: 'OTHER', http: 'none', subtype: 'none' }],
    ['{"type":"result","is_error":true,"result":"API Error: 500 upstream"}', { reason: 'OTHER', http: '500', subtype: 'none' }],
    ['{"type":"result","is_error":true,"result":"Credit balance is too low"}', { reason: 'OTHER', http: 'none', subtype: 'none' }],
    ['{"type":"result","subtype":"success","is_error":false,"result":"OK!"}', { reason: 'UNEXPECTED_REPLY', http: 'none', subtype: 'success' }],
    ['not json', { reason: 'UNREADABLE', http: 'none', subtype: 'none' }],
    ['', { reason: 'UNREADABLE', http: 'none', subtype: 'none' }],
  ])('%s → its closed reason', (raw, expected) => {
    expect(check.smokeFailureReason(raw)).toEqual(expected);
  });

  it('a subtype or a status that is not a plain token is never echoed', () => {
    expect(check.smokeFailureReason('{"is_error":true,"subtype":"x; echo $CLAUDE_CODE_OAUTH_TOKEN","api_error_status":"429"}'))
      .toEqual({ reason: 'OTHER', http: 'none', subtype: 'none' });
    expect(check.smokeFailureReason('{"is_error":true,"api_error_status":4290}').http).toBe('none');
  });

  it('smoke-verdict prints the reason on its own closed line, before the FAIL line, which is unchanged', () => {
    const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json', ...ERROR_EXITS], READY, apiError(429, 'rate_limit_error'), { 's.json': TOKEN_ONLY });
    expect(run.code).toBe(1);
    expect(run.output.split('\n')).toEqual([
      'subscription_smoke_served provider=anthropic requested=claude-fable-5 served=none match=NONE',
      'subscription_smoke_reason provider=anthropic model=claude-fable-5 reason=RATE_LIMITED http=429 subtype=success',
      'subscription_smoke provider=anthropic model=claude-fable-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=ERROR result=FAIL',
    ]);
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  });

  it('a pass, and a reply never read, print no reason line', () => {
    expect(capture(['smoke-verdict', '--model', 'claude-opus-5-5', '--status-file', 's.json', ...CLEAN_EXITS], READY, OK_ATTESTED, { 's.json': TOKEN_ONLY }).output).not.toContain('subscription_smoke_reason');
    expect(capture(['smoke-verdict', '--status-file', 's.json'], READY, apiError(429, 'rate_limit_error'), { 's.json': API_KEY_METHOD }).output)
      .not.toContain('subscription_smoke_reason');
  });

  it('whatever the CLI wrote, the one reason line stays inside the closed grammar and repeats none of it', () => {
    const hostile = [
      apiError(404, 'not_found_error'),
      '{"is_error":true,"result":"sk-ant-oat01-FAKETESTNOTREAL-xxxxxxxxxxxxxxxx"}',
      '{"is_error":true,"subtype":"Error\\nRESULT: COMPLETED after 9 ticks","result":"\\n  run: run:forged"}',
      '{"is_error":true,"api_error_status":999}', '[]', 'null', '"a string"', '{"is_error":true,"result":42}',
    ];
    for (const raw of hostile) {
      const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json', ...ERROR_EXITS], READY, raw, { 's.json': TOKEN_ONLY });
      const reasons = run.output.split('\n').filter((line) => line.startsWith('subscription_smoke_reason'));
      expect(reasons, raw).toHaveLength(1);
      expect(reasons[0], raw).toMatch(REASON_LINE);
      expect(run.output, raw).not.toMatch(/FAKETESTNOTREAL|RESULT: COMPLETED|run:forged/u);
    }
  });
});

/**
 * THE MODEL THAT ANSWERED THE SMOKE (founder, 2026-09-30: claude-opus-5-5; no automatic downgrade; STOP
 * rather than substitute). A producer is an entry with output. EVERY producer must credit the requested
 * model by its own KEY, exactly or as a dated build, and by its `canonicalModel` too when it carries one
 * (Codex on #302, F1): the smoke's JSON has no turns, so a second producer is a substitute, never a helper.
 * SERVED_GREP and REASON_GREP are the EXACT `grep -E` patterns the founder workflow's evidence allowlist
 * carries, so this output and that allowlist cannot drift apart. The three exit reasons join the allowlist
 * with the founder's workflow patch that passes the exits (F3); this verdict must not land before it.
 */
describe('the smoke names the model that answered, and fails closed on any other', () => {
  const SERVED_GREP = new RegExp('^subscription_smoke_served provider=anthropic requested=[A-Za-z0-9._-]{1,64} served=(none|[A-Za-z0-9._-]{1,64}(,[A-Za-z0-9._-]{1,64}){0,7}) match=(EXACT|DATED_BUILD|MISMATCH|NONE)$', 'u');
  const REASON_GREP = new RegExp('^subscription_smoke_reason provider=anthropic model=[A-Za-z0-9._-]{1,64} reason=(MODEL_NOT_ENTITLED_OR_NOT_FOUND|AUTH|USAGE_LIMIT|RATE_LIMITED|OVERLOADED|MAX_TURNS|UNEXPECTED_REPLY|UNREADABLE|SERVED_MODEL_MISMATCH|SERVED_MODEL_UNATTESTED|EXIT_UNREPORTED|AUTH_EXIT_NONZERO|CLI_EXIT_NONZERO|OTHER) http=([1-5][0-9]{2}|none) subtype=([a-z_]{1,40}|none)$', 'u');
  const REQUESTED = 'claude-opus-5-5';
  const usage = (entries: Record<string, Record<string, unknown>>) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK', modelUsage: entries });
  const smoke = (raw: string) => capture(['smoke-verdict', '--model', REQUESTED, '--status-file', 's.json', ...CLEAN_EXITS], READY, raw, { 's.json': TOKEN_ONLY });

  it.each([
    [usage({ 'claude-opus-5-5': { outputTokens: 1 } }), { served: 'claude-opus-5-5', match: 'EXACT' }],
    [usage({ 'claude-opus-5-5-20260915': { outputTokens: 1 } }), { served: 'claude-opus-5-5-20260915', match: 'DATED_BUILD' }],
    // The KEY credits; a canonicalModel it carries must credit too. An alias key credits nothing.
    [usage({ 'claude-opus-5-5': { outputTokens: 1, canonicalModel: 'claude-opus-5-5' } }), { served: 'claude-opus-5-5', match: 'EXACT' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 1, canonicalModel: 'claude-opus-5-5-20260915' } }), { served: 'claude-opus-5-5', match: 'EXACT' }],
    [usage({ 'claude-opus-5-5-20260915': { outputTokens: 1, canonicalModel: 'claude-opus-5-5' } }), { served: 'claude-opus-5-5-20260915', match: 'DATED_BUILD' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 1, canonicalModel: 'claude-sonnet-5' } }), { served: 'claude-opus-5-5', match: 'MISMATCH' }],
    [usage({ 'claude-sonnet-5': { outputTokens: 1, canonicalModel: 'claude-opus-5-5' } }), { served: 'claude-sonnet-5', match: 'MISMATCH' }],
    [usage({ opus: { outputTokens: 1, canonicalModel: 'claude-opus-5-5' } }), { served: 'opus', match: 'MISMATCH' }],
    [usage({ opus: { outputTokens: 1, canonicalModel: 'claude-opus-5-5-20260915' } }), { served: 'opus', match: 'MISMATCH' }],
    // EVERY producer: a second model with output, whichever produced more, is a MISMATCH that names both.
    [usage({ 'claude-opus-5-5': { outputTokens: 2 }, 'claude-haiku-4-5-20251001': { outputTokens: 30 } }), { served: 'claude-haiku-4-5-20251001,claude-opus-5-5', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 5 }, 'claude-haiku-4-5-20251001': { outputTokens: 1 } }), { served: 'claude-opus-5-5,claude-haiku-4-5-20251001', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 1 }, 'claude-sonnet-5': { outputTokens: 5 } }), { served: 'claude-sonnet-5,claude-opus-5-5', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 1 }, 'claude-opus-5-5[1m]': { outputTokens: 1 } }), { served: 'claude-opus-5-5,claude-opus-5-5_1m_', match: 'MISMATCH' }],
    // Every producer crediting it passes; one that is a dated build makes the match DATED_BUILD.
    [usage({ 'claude-opus-5-5': { outputTokens: 1 }, 'claude-opus-5-5-20260915': { outputTokens: 1 } }), { served: 'claude-opus-5-5,claude-opus-5-5-20260915', match: 'DATED_BUILD' }],
    // An entry that produced nothing is not a producer, whatever it is.
    [usage({ 'claude-opus-5-5': { outputTokens: 1 }, 'claude-sonnet-5': { outputTokens: 0 } }), { served: 'claude-opus-5-5', match: 'EXACT' }],
    [usage({ 'claude-sonnet-5': { outputTokens: 5 } }), { served: 'claude-sonnet-5', match: 'MISMATCH' }],
    // Nothing looser than exact or <requested>-YYYYMMDD.
    [usage({ 'claude-opus-5-5-2026': { outputTokens: 1 } }), { served: 'claude-opus-5-5-2026', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-5-20260915-beta': { outputTokens: 1 } }), { served: 'claude-opus-5-5-20260915-beta', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-50': { outputTokens: 1 } }), { served: 'claude-opus-5-50', match: 'MISMATCH' }],
    [usage({ 'xclaude-opus-5-5': { outputTokens: 1 } }), { served: 'xclaude-opus-5-5', match: 'MISMATCH' }],
    // A model that produced nothing is not a producer; nothing produced is NONE.
    [usage({ 'claude-opus-5-5': { outputTokens: 0 }, 'claude-sonnet-5': { outputTokens: 4 } }), { served: 'claude-sonnet-5', match: 'MISMATCH' }],
    [usage({ 'claude-opus-5-5': { outputTokens: 0 } }), { served: 'none', match: 'NONE' }],
    [OK_REPLY, { served: 'none', match: 'NONE' }],
    ['{"type":"result","is_error":false,"result":"OK","modelUsage":[]}', { served: 'none', match: 'NONE' }],
    ['not json', { served: 'none', match: 'NONE' }],
  ])('%s', (raw, expected) => {
    expect(check.smokeServedModel(raw, REQUESTED)).toEqual(expected);
  });

  it('a key is never echoed raw: outside the alphabet each character is `_`, cut to 64; at most eight producers are listed', () => {
    // A suffixed name is still not the requested model, so it is still a STOP. Now the stop says what answered.
    expect(check.smokeServedModel(usage({ 'claude-opus-5-5[1m]': { outputTokens: 1 } }), REQUESTED)).toEqual({ served: 'claude-opus-5-5_1m_', match: 'MISMATCH' });
    expect(check.smokeServedModel(usage({ 'claude opus; echo $X`id`\n': { outputTokens: 1 } }), REQUESTED)).toEqual({ served: 'claude_opus__echo__X_id__', match: 'MISMATCH' });
    expect(check.smokeServedModel(usage({ ['m'.repeat(70)]: { outputTokens: 1 } }), REQUESTED).served).toBe('m'.repeat(64));
    // The line printed for it is still inside the allowlist's grammar.
    expect(smoke(usage({ 'claude-opus-5-5[1m]': { outputTokens: 1 } })).output.split('\n')[0]).toMatch(SERVED_GREP);
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`model-${String(index)}`, { outputTokens: 10 - index }]));
    expect(check.smokeServedModel(usage(many), REQUESTED).served.split(',')).toHaveLength(8);
  });

  it('an exact OK from ANOTHER model fails closed: SERVED_MODEL_MISMATCH, and the verdict reads reply=OK result=FAIL', () => {
    const run = smoke(usage({ 'claude-sonnet-5': { outputTokens: 1 } }));
    expect(run.code).toBe(1);
    expect(run.output.split('\n')).toEqual([
      'subscription_smoke_served provider=anthropic requested=claude-opus-5-5 served=claude-sonnet-5 match=MISMATCH',
      'subscription_smoke_reason provider=anthropic model=claude-opus-5-5 reason=SERVED_MODEL_MISMATCH http=none subtype=success',
      'subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=FAIL',
    ]);
  });

  it('an exact OK that no model is credited with fails closed: SERVED_MODEL_UNATTESTED', () => {
    const run = smoke(OK_REPLY);
    expect(run.code).toBe(1);
    expect(run.output).toContain('match=NONE');
    expect(run.output).toContain('reason=SERVED_MODEL_UNATTESTED');
    expect(run.output).toContain('reply=OK result=FAIL');
  });

  it('a dated build passes', () => {
    const run = smoke(usage({ 'claude-opus-5-5-20260915': { outputTokens: 1 } }));
    expect(run.code).toBe(0);
    expect(run.output).toContain('result=PASS');
    expect(run.output).not.toContain('subscription_smoke_reason');
  });

  it('ANY second model with output beside the requested one FAILS: SERVED_MODEL_MISMATCH, and the served line names both (F1)', () => {
    for (const [raw, served] of [
      [usage({ 'claude-opus-5-5': { outputTokens: 2 }, 'claude-haiku-4-5-20251001': { outputTokens: 30 } }), 'claude-haiku-4-5-20251001,claude-opus-5-5'],
      [usage({ 'claude-opus-5-5': { outputTokens: 1 }, 'claude-sonnet-5': { outputTokens: 5 } }), 'claude-sonnet-5,claude-opus-5-5'],
      [usage({ 'claude-opus-5-5': { outputTokens: 5 }, 'claude-sonnet-5': { outputTokens: 1 } }), 'claude-opus-5-5,claude-sonnet-5'],
    ]) {
      const run = smoke(raw);
      expect(run.code, raw).toBe(1);
      expect(run.output.split('\n'), raw).toEqual([
        `subscription_smoke_served provider=anthropic requested=claude-opus-5-5 served=${served} match=MISMATCH`,
        'subscription_smoke_reason provider=anthropic model=claude-opus-5-5 reason=SERVED_MODEL_MISMATCH http=none subtype=success',
        'subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=FAIL',
      ]);
    }
  });

  it('an OK the result does not call is_error: false is not clean: UNEXPECTED, reason UNEXPECTED_REPLY', () => {
    for (const flag of ['', '"is_error":"false",']) {
      const run = smoke(`{"type":"result","subtype":"success",${flag}"result":"OK","modelUsage":{"claude-opus-5-5":{"outputTokens":1}}}`);
      expect(run.code, flag).toBe(1);
      expect(run.output, flag).toContain('reason=UNEXPECTED_REPLY');
      expect(run.output, flag).toContain('reply=UNEXPECTED result=FAIL');
    }
  });

  it('every served and reason line matches the founder allowlist grep exactly, whatever the CLI wrote', () => {
    const replies = [OK_ATTESTED, usage({ 'claude-sonnet-5': { outputTokens: 1 } }), OK_REPLY, apiError(529, 'overloaded_error'), 'garbage',
      '{"is_error":true,"modelUsage":{"x y":{"outputTokens":1}}}'];
    for (const raw of replies) {
      const lines = smoke(raw).output.split('\n');
      expect(lines.filter((line) => line.startsWith('subscription_smoke_served')), raw).toHaveLength(1);
      for (const line of lines.filter((entry) => entry.startsWith('subscription_smoke_served'))) expect(line, raw).toMatch(SERVED_GREP);
      for (const line of lines.filter((entry) => entry.startsWith('subscription_smoke_reason'))) expect(line, raw).toMatch(REASON_GREP);
    }
  });
});

/**
 * THE EXITS ARE PART OF THE ANSWER (Codex on #302, F3). The workflow records `subscription_smoke_auth_exit`
 * and `subscription_smoke_cli_exit`, but a verdict that read only the CLI's JSON passed an OK-looking reply
 * the CLI itself exited 1 on. Now the verdict is TOLD both exits and passes only when both are 0; a missing
 * or malformed exit is a FAIL of its own. One reason is printed, the first that holds: EXIT_UNREPORTED,
 * AUTH_EXIT_NONZERO, the reply's own reason, CLI_EXIT_NONZERO, then the served model's.
 */
describe('the smoke passes only when both exits were reported and 0', () => {
  const OK_OPUS = '{"type":"result","subtype":"success","is_error":false,"result":"OK","modelUsage":{"claude-opus-5-5":{"inputTokens":3,"outputTokens":1}}}';
  const OK_SONNET = '{"type":"result","subtype":"success","is_error":false,"result":"OK","modelUsage":{"claude-sonnet-5":{"inputTokens":3,"outputTokens":1}}}';
  const verdict = (exits: string[], raw = OK_OPUS) =>
    capture(['smoke-verdict', '--model', 'claude-opus-5-5', '--status-file', 's.json', ...exits], READY, raw, { 's.json': TOKEN_ONLY });
  const reasonOf = (output: string) => (output.split('\n').find((line) => line.startsWith('subscription_smoke_reason')) ?? '').match(/reason=([A-Z_]+)/u)?.[1] ?? null;

  it('control: both exits 0 and the requested model\'s OK is a PASS with no reason line', () => {
    const run = verdict(CLEAN_EXITS);
    expect(run.code).toBe(0);
    expect(run.output).toContain('reply=OK result=PASS');
    expect(reasonOf(run.output)).toBeNull();
  });

  it('an OK-looking reply the CLI exited 1 on FAILS: CLI_EXIT_NONZERO, and the verdict line still reads reply=OK', () => {
    const run = verdict(['--auth-exit', '0', '--cli-exit', '1']);
    expect(run.code).toBe(1);
    expect(run.output.split('\n')).toEqual([
      'subscription_smoke_served provider=anthropic requested=claude-opus-5-5 served=claude-opus-5-5 match=EXACT',
      'subscription_smoke_reason provider=anthropic model=claude-opus-5-5 reason=CLI_EXIT_NONZERO http=none subtype=success',
      'subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=FAIL',
    ]);
  });

  it('a subscription status from an `auth status` that exited 1 FAILS: AUTH_EXIT_NONZERO', () => {
    const run = verdict(['--auth-exit', '1', '--cli-exit', '0']);
    expect(run.code).toBe(1);
    expect(reasonOf(run.output)).toBe('AUTH_EXIT_NONZERO');
    expect(run.output).toContain('reply=OK result=FAIL');
  });

  it.each([
    [[]],
    [['--cli-exit', '0']],
    [['--auth-exit', '0']],
    [['--auth-exit', '0', '--cli-exit']],
    [['--auth-exit', '', '--cli-exit', '0']],
    [['--auth-exit', '0', '--cli-exit', '-1']],
    [['--auth-exit', '0', '--cli-exit', '256']],
    [['--auth-exit', '0', '--cli-exit', '00']],
    [['--auth-exit', '0', '--cli-exit', '0.0']],
    [['--auth-exit', '0', '--cli-exit', '0x0']],
    [['--auth-exit', '0', '--cli-exit', ' 0']],
    [['--auth-exit', '0', '--cli-exit', '0 ']],
    [['--auth-exit', 'zero', '--cli-exit', '0']],
  ])('an exit missing or not a plain 0-255 integer FAILS: EXIT_UNREPORTED (%j)', (exits) => {
    const run = verdict(exits);
    expect(run.code).toBe(1);
    expect(reasonOf(run.output)).toBe('EXIT_UNREPORTED');
    expect(run.output).toContain('reply=OK result=FAIL');
  });

  it('every exit from 0 to 255 is read as itself; only 0 passes', () => {
    for (const code of [1, 2, 9, 42, 127, 200, 255]) {
      expect(reasonOf(verdict(['--auth-exit', '0', '--cli-exit', String(code)]).output), String(code)).toBe('CLI_EXIT_NONZERO');
      expect(reasonOf(verdict(['--auth-exit', String(code), '--cli-exit', '0']).output), String(code)).toBe('AUTH_EXIT_NONZERO');
    }
  });

  it('an error reply the CLI exited 1 on keeps its own reason (the real CLI exits non-zero on every error reply)', () => {
    const run = verdict(ERROR_EXITS, apiError(404, 'not_found_error'));
    expect(run.code).toBe(1);
    expect(reasonOf(run.output)).toBe('MODEL_NOT_ENTITLED_OR_NOT_FOUND');
    expect(run.output).toContain('reply=ERROR result=FAIL');
  });

  it('one reason, in a fixed order: unreported, then auth, then the reply\'s own, then the CLI\'s exit, then the served model', () => {
    expect(reasonOf(verdict(['--auth-exit', '1'], apiError(429, 'rate_limit_error')).output)).toBe('EXIT_UNREPORTED');
    expect(reasonOf(verdict(['--auth-exit', '1', '--cli-exit', '1'], apiError(429, 'rate_limit_error')).output)).toBe('AUTH_EXIT_NONZERO');
    expect(reasonOf(verdict(['--auth-exit', '0', '--cli-exit', '1'], apiError(429, 'rate_limit_error')).output)).toBe('RATE_LIMITED');
    expect(reasonOf(verdict(['--auth-exit', '0', '--cli-exit', '1'], OK_SONNET).output)).toBe('CLI_EXIT_NONZERO');
    expect(reasonOf(verdict(CLEAN_EXITS, OK_SONNET).output)).toBe('SERVED_MODEL_MISMATCH');
    for (const run of [verdict(['--auth-exit', '1']), verdict(['--auth-exit', '1', '--cli-exit', '1'], OK_SONNET)]) {
      expect(run.output.split('\n').filter((line) => line.startsWith('subscription_smoke_reason'))).toHaveLength(1);
    }
  });

  it('without a subscription status the reply is never read, whatever the exits say', () => {
    const run = capture(['smoke-verdict', '--model', 'claude-opus-5-5', '--status-file', 's.json', ...CLEAN_EXITS], READY, OK_OPUS, { 's.json': API_KEY_METHOD });
    expect(run.code).toBe(1);
    expect(run.output).toBe('subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=none reply=NO_SUBSCRIPTION_STATUS result=FAIL');
  });

  it('an exit value is never echoed: only closed tokens reach the log', () => {
    const run = verdict(['--auth-exit', '0', '--cli-exit', '1; echo FAKETESTNOTREAL']);
    expect(reasonOf(run.output)).toBe('EXIT_UNREPORTED');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
    expect(run.output).not.toContain('echo');
  });
});
