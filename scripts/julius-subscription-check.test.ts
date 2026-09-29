import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANTHROPIC_CREDENTIAL_ENV_NAMES, CLAUDE_SUBSCRIPTION_TOKEN_ENV } from '../relay-bridge/hosted-coding-agent/hosted-auth';
import { sdkExecutableCandidates as sdkCandidatesTs } from '../relay-bridge/hosted-coding-agent/hosted-login-probe';
import * as check from './julius-subscription-check.mjs';

/**
 * THE WORKFLOW'S ZERO-GENERATION SUBSCRIPTION CHECK AND ITS SMOKE.
 *
 * The workflow patch replaces the Anthropic `GET /v1/models` API-key probe with
 * `scripts/julius-subscription-check.mjs status`. Every token here is a FAKE marked
 * FAKETESTNOTREAL; the `status` run below uses the Agent SDK's REAL bundled CLI,
 * which classifies a placeholder token offline (measured 2026-09-29) and so answers
 * deterministically without contacting anything. The `smoke` mode is never run
 * against a provider here: it would spend subscription usage.
 */

const TOKEN = 'FAKETESTNOTREAL-oauth-token-sentinel';
const TOKEN_ENV_NAME = 'CLAUDE_CODE_OAUTH_TOKEN';
const BASE = { PATH: process.env.PATH ?? '' };
const capture = (argv: string[], env: Record<string, string | undefined>) => {
  const lines: string[] = [];
  const code = check.main(argv, env, (line: string) => lines.push(line)) as number;
  return { code, output: lines.join('\n') };
};

describe('the lists cannot drift from the runtime they gate', () => {
  it('the outranking names are exactly hosted-auth.ts\'s credential names, and the token name matches', () => {
    expect([...check.OUTRANKING_ENV_NAMES]).toEqual([...ANTHROPIC_CREDENTIAL_ENV_NAMES]);
    expect(check.TOKEN_ENV).toBe(CLAUDE_SUBSCRIPTION_TOKEN_ENV);
  });

  it('it looks for the CLI where the runtime probe (and the SDK) does', () => {
    for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64'], ['darwin', 'arm64']] as const) {
      expect(check.sdkExecutableCandidates(platform, arch)).toEqual(sdkCandidatesTs(platform, arch));
    }
  });

  it('the child environment is built from nothing: five base names and the token, nothing else', () => {
    const child = check.composeChildEnv({ ...BASE, [TOKEN_ENV_NAME]: TOKEN, OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', XAI_API_KEY: 'x' }, '/h');
    expect(Object.keys(child).sort()).toEqual(['CI', 'CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'NO_COLOR', 'PATH', 'TERM']);
  });
});

describe('status verdicts over the measured shapes', () => {
  it('token-only and stored-login shapes pass; the plan is recorded or absent', () => {
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}'))
      .toMatchObject({ ok: true, method: 'oauth_token', plan: 'absent' });
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'))
      .toMatchObject({ ok: true, method: 'claude.ai', plan: 'max' });
  });

  it('a key in play, a third party, no login or an unknown plan are refused, with a closed reason', () => {
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}').reason).toBe('API_KEY_IN_PLAY');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}').reason).toBe('API_KEY_IN_PLAY');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"bedrock"}').reason).toBe('NOT_FIRST_PARTY');
    expect(check.statusVerdict('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}').reason).toBe('NOT_LOGGED_IN');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"free"}').reason).toBe('PLAN_NOT_A_SUBSCRIPTION');
    expect(check.statusVerdict('garbage').reason).toBe('STATUS_UNREADABLE');
  });

  it('--require-plan max refuses an absent or different plan', () => {
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}', 'max').reason).toBe('PLAN_NOT_REQUIRED_PLAN');
    expect(check.statusVerdict('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"max"}', 'max').ok).toBe(true);
  });

  it('the smoke passes only on a clean exact OK', () => {
    expect(check.smokeVerdict('{"type":"result","is_error":false,"result":"OK"}')).toEqual({ ok: true, reply: 'OK' });
    expect(check.smokeVerdict('{"type":"result","is_error":false,"result":" OK\\n"}').ok).toBe(true);
    expect(check.smokeVerdict('{"type":"result","is_error":false,"result":"OK!"}').reply).toBe('UNEXPECTED');
    expect(check.smokeVerdict('{"type":"result","is_error":true,"result":"Credit balance is too low"}')).toEqual({ ok: false, reply: 'ERROR' });
    expect(check.smokeVerdict('not json').reply).toBe('UNREADABLE');
  });
});

describe('main: fail closed on presence, never print a value', () => {
  it('no token: SUBSCRIPTION_NOT_READY / TOKEN_MISSING', () => {
    const run = capture(['status', '--model', 'claude-fable-5'], { ...BASE });
    expect(run.code).toBe(1);
    expect(run.output).toBe('provider_readiness provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION reason=TOKEN_MISSING result=SUBSCRIPTION_NOT_READY');
  });

  it.each([...ANTHROPIC_CREDENTIAL_ENV_NAMES])('token + %s: refused by name, before any CLI runs', (name) => {
    const run = capture(['status'], { ...BASE, [TOKEN_ENV_NAME]: TOKEN, [name]: 'FAKETESTNOTREAL-route', [check.EXECUTABLE_ENV]: join(tmpdir(), 'no-such-claude') });
    expect(run.code).toBe(1);
    expect(run.output).toContain(`reason=OUTRANKED_BY_${name} `);
    expect(run.output).not.toContain(TOKEN);
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  });

  it('smoke with no CLI installed fails closed without spending anything', () => {
    const run = capture(['smoke'], { ...BASE, [TOKEN_ENV_NAME]: TOKEN, [check.EXECUTABLE_ENV]: join(mkdtempSync(join(tmpdir(), 'sc-')), 'none') });
    expect(run.code).toBe(1);
    expect(run.output).toContain('reason=CLI_NOT_INSTALLED result=SUBSCRIPTION_NOT_READY');
  });

  it('status with the REAL bundled CLI and a placeholder token: SUBSCRIPTION_LOGIN_PRESENT, oauth_token, and the token never printed', () => {
    const run = capture(['status', '--model', 'claude-fable-5'], { ...BASE, [TOKEN_ENV_NAME]: TOKEN });
    expect(run.output).toBe('provider_readiness provider=anthropic model=claude-fable-5 http=none auth=CLAUDE_SUBSCRIPTION method=oauth_token plan=absent result=SUBSCRIPTION_LOGIN_PRESENT');
    expect(run.code).toBe(0);
    expect(run.output).not.toContain(TOKEN);
  }, 60_000);

  it('an unsafe model label is never echoed', () => {
    const run = capture(['status', '--model', 'x; echo $CLAUDE_CODE_OAUTH_TOKEN'], { ...BASE });
    expect(run.output).toContain('model=unpinned');
  });
});
