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

  it('the smoke passes on an exact OK beside a subscription status of the same run', () => {
    const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json'], READY, OK_REPLY, { 's.json': TOKEN_ONLY });
    expect(run.code).toBe(0);
    expect(run.output).toBe('subscription_smoke provider=anthropic model=claude-fable-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=PASS');
    expect(run.output).toMatch(SMOKE_PASS);
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
  const apiError = (status: number, type: string) => JSON.stringify({
    type: 'result', subtype: 'success', is_error: true,
    result: `API Error: ${String(status)} ${JSON.stringify({ type: 'error', error: { type, message: 'model: claude-fable-5 FAKETESTNOTREAL-free-text' } })}`,
  });

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
    const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json'], READY, apiError(429, 'rate_limit_error'), { 's.json': TOKEN_ONLY });
    expect(run.code).toBe(1);
    expect(run.output.split('\n')).toEqual([
      'subscription_smoke_reason provider=anthropic model=claude-fable-5 reason=RATE_LIMITED http=429 subtype=success',
      'subscription_smoke provider=anthropic model=claude-fable-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=ERROR result=FAIL',
    ]);
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  });

  it('a pass, and a reply never read, print no reason line', () => {
    expect(capture(['smoke-verdict', '--status-file', 's.json'], READY, OK_REPLY, { 's.json': TOKEN_ONLY }).output).not.toContain('subscription_smoke_reason');
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
      const run = capture(['smoke-verdict', '--model', 'claude-fable-5', '--status-file', 's.json'], READY, raw, { 's.json': TOKEN_ONLY });
      const reasons = run.output.split('\n').filter((line) => line.startsWith('subscription_smoke_reason'));
      expect(reasons, raw).toHaveLength(1);
      expect(reasons[0], raw).toMatch(REASON_LINE);
      expect(run.output, raw).not.toMatch(/FAKETESTNOTREAL|RESULT: COMPLETED|run:forged/u);
    }
  });
});
