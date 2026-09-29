import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_CREDENTIAL_ENV_NAMES, CLAUDE_SUBSCRIPTION_TOKEN_ENV, SUBSCRIPTION_LOGIN_SOURCES,
  classifyClaudeAuthStatus, claudeAuthLine, claudeAuthSourceLine, decideClaudeAuth,
} from './hosted-auth';
import { HOSTED_CHILD_ENV_KEYS, HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION, hostedChildEnv } from './hosted-envelope';
import { observeCoderLogin, sdkExecutableCandidates, type LoginSpawn } from './hosted-login-probe';
import { emptyObservation, foldHostedMessage } from './hosted-observation';
import { hostedCoderCost } from '../julius/claude-code-coding-provider';

/**
 * THE FOUNDER'S RULE: the Coding Agent authenticates with the Claude Max
 * subscription, never Anthropic API billing — and on a GitHub runner the only way
 * the subscription arrives is a `claude setup-token` token in
 * `CLAUDE_CODE_OAUTH_TOKEN`. Paid attempt 1 (run 36568129865) ran the coder on
 * `ANTHROPIC_API_KEY` and died on `credit_unavailable`: a routing defect.
 *
 * Every token below is a FAKE marked FAKETESTNOTREAL. No real credential exists in
 * this test, and the assertions are about NAMES and CLASSES, never values — except
 * the sentinel checks, which prove a fake value never reaches a printed line.
 */

const TOKEN = 'FAKETESTNOTREAL-oauth-token-sentinel';
const KEY = 'FAKETESTNOTREAL-api-key-sentinel';

/** Exactly what the bundled CLI printed on 2026-09-29 for each measured environment (enum fields only). */
const MEASURED = Object.freeze({
  tokenOnly: '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}',
  tokenPlusKeyBundled: '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}',
  tokenPlusKeyWorkstation: '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}',
  storedLogin: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}',
  nothing: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}',
});

describe('the child environment: the token enters under CLAUDE_SUBSCRIPTION and nowhere else', () => {
  it('subscription + token: the base allow-list plus CLAUDE_CODE_OAUTH_TOKEN, and no Anthropic credential name', () => {
    const env = hostedChildEnv({ apiKey: KEY, path: '/p', home: '/h', mode: 'CLAUDE_SUBSCRIPTION', oauthToken: TOKEN });
    expect(Object.keys(env).sort()).toEqual([...HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION, CLAUDE_SUBSCRIPTION_TOKEN_ENV].sort());
    expect(env[CLAUDE_SUBSCRIPTION_TOKEN_ENV]).toBe(TOKEN);
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) expect(Object.keys(env), name).not.toContain(name);
    expect(Object.values(env), 'the API key handed alongside must not appear').not.toContain(KEY);
  });

  it('subscription with an empty or absent token carries no token variable at all', () => {
    for (const oauthToken of [undefined, '']) {
      const env = hostedChildEnv({ apiKey: '', path: '/p', home: '/h', mode: 'CLAUDE_SUBSCRIPTION', ...(oauthToken === undefined ? {} : { oauthToken }) });
      expect(Object.keys(env).sort(), String(oauthToken)).toEqual([...HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION].sort());
    }
  });

  it('API mode NEVER receives the OAuth token, even when one is handed in', () => {
    for (const mode of ['ANTHROPIC_API', undefined] as const) {
      const env = hostedChildEnv({ apiKey: KEY, path: '/p', home: '/h', oauthToken: TOKEN, ...(mode === undefined ? {} : { mode }) });
      expect(Object.keys(env).sort(), String(mode)).toEqual([...HOSTED_CHILD_ENV_KEYS].sort());
      expect(Object.keys(env)).not.toContain(CLAUDE_SUBSCRIPTION_TOKEN_ENV);
      expect(Object.values(env)).not.toContain(TOKEN);
    }
  });
});

describe('the decision over the names the child would carry', () => {
  const tokenChild = Object.keys(hostedChildEnv({ apiKey: '', mode: 'CLAUDE_SUBSCRIPTION', oauthToken: TOKEN }));
  const tokenLogin = classifyClaudeAuthStatus(MEASURED.tokenOnly);

  it('token-only child + an oauth_token observation: SUBSCRIPTION, credentialSource subscription_oauth_token', () => {
    const answer = decideClaudeAuth({ mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: tokenChild, login: tokenLogin });
    expect(answer).toEqual({
      ok: true,
      provenance: {
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK', authentication: 'CLAUDE_SUBSCRIPTION',
        plan: 'unknown', credentialSource: 'subscription_oauth_token', apiKeyUsed: false, apiCostApplicable: false,
      },
    });
  });

  it('the stored-login path is still accepted, and says so', () => {
    const child = Object.keys(hostedChildEnv({ apiKey: '', mode: 'CLAUDE_SUBSCRIPTION' }));
    const answer = decideClaudeAuth({ mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: child, login: classifyClaudeAuthStatus(MEASURED.storedLogin) });
    expect(answer.ok && answer.provenance.credentialSource).toBe('local_subscription');
    expect(answer.ok && answer.provenance.plan).toBe('max');
  });

  it.each([...ANTHROPIC_CREDENTIAL_ENV_NAMES])('token + %s in the child: REFUSED subscription_would_use_api_key', (name) => {
    const answer = decideClaudeAuth({ mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: [...tokenChild, name], login: tokenLogin });
    expect(answer).toMatchObject({ ok: false, refusal: 'subscription_would_use_api_key' });
    if (!answer.ok) expect(answer.because).toContain(name);
  });

  it('a token observation that the child would not carry is refused: it was not taken in the child', () => {
    const child = Object.keys(hostedChildEnv({ apiKey: '', mode: 'CLAUDE_SUBSCRIPTION' }));
    const answer = decideClaudeAuth({ mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: child, login: tokenLogin });
    expect(answer).toMatchObject({ ok: false, refusal: 'subscription_login_absent' });
  });

  it('API mode whose child would carry the token is REFUSED — API mode is the key alone', () => {
    const answer = decideClaudeAuth({
      mode: 'ANTHROPIC_API', apiKeyProvided: true, childEnvNames: [...HOSTED_CHILD_ENV_KEYS, CLAUDE_SUBSCRIPTION_TOKEN_ENV],
    });
    expect(answer).toMatchObject({ ok: false, refusal: 'api_mode_would_carry_subscription_token' });
  });

  it('API mode itself is intact: key present, token absent, API_KEY provenance', () => {
    const answer = decideClaudeAuth({ mode: 'ANTHROPIC_API', apiKeyProvided: true, childEnvNames: [...HOSTED_CHILD_ENV_KEYS] });
    expect(answer).toMatchObject({ ok: true, provenance: { authentication: 'ANTHROPIC_API_KEY', credentialSource: null, apiKeyUsed: true, apiCostApplicable: true } });
  });

  it('the printed lines name SUBSCRIPTION and the source, and carry nothing opaque', () => {
    const answer = decideClaudeAuth({ mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: tokenChild, login: tokenLogin });
    if (!answer.ok) throw new Error('expected SUBSCRIPTION');
    expect(claudeAuthLine(answer.provenance))
      .toBe('CLAUDE AUTH: SUBSCRIPTION provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=unknown api_key_used=false api_cost_applicable=false');
    expect(claudeAuthSourceLine(answer.provenance)).toBe('claude auth source: subscription_oauth_token');
  });
});

describe('classifying `auth status` output: measured shapes, no raw text retained', () => {
  it('each measured shape classifies as the path it is', () => {
    expect(classifyClaudeAuthStatus(MEASURED.tokenOnly)).toEqual({ loggedIn: true, sourceClass: 'subscription_oauth_token', subscriptionLabel: 'unknown' });
    expect(classifyClaudeAuthStatus(MEASURED.storedLogin)).toEqual({ loggedIn: true, sourceClass: 'local_subscription', subscriptionLabel: 'max' });
    expect(classifyClaudeAuthStatus(MEASURED.nothing).sourceClass).toBe('not_logged_in');
    // THE KEY OUTRANKS THE TOKEN, and both CLI versions say so in their own way.
    expect(classifyClaudeAuthStatus(MEASURED.tokenPlusKeyBundled).sourceClass).toBe('api_key');
    expect(classifyClaudeAuthStatus(MEASURED.tokenPlusKeyWorkstation).sourceClass).toBe('api_key');
  });

  it('a plan the token path does report is recorded; a word nobody defined is unknown', () => {
    expect(classifyClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"max"}').subscriptionLabel).toBe('max');
    expect(classifyClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","subscriptionType":"platinum"}').subscriptionLabel).toBe('unknown');
  });

  it('every non-first-party or unreadable answer is refused by the decision', () => {
    for (const raw of [
      '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"bedrock"}',
      '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"vertex"}',
      '{"loggedIn":true,"authMethod":"oauth_token"}',
      '{"loggedIn":true,"authMethod":"something_new","apiProvider":"firstParty"}',
      'not json', '[]', 'null', '', null,
    ]) {
      const observed = classifyClaudeAuthStatus(raw);
      expect((SUBSCRIPTION_LOGIN_SOURCES as readonly string[]).includes(observed.sourceClass), String(raw)).toBe(false);
    }
  });

  it('the observation carries three closed fields and no text from the CLI', () => {
    const observed = classifyClaudeAuthStatus(`{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","email":"x@y.z","token":"${TOKEN}"}`);
    expect(Object.keys(observed).sort()).toEqual(['loggedIn', 'sourceClass', 'subscriptionLabel']);
    expect(JSON.stringify(observed)).not.toContain(TOKEN);
    expect(JSON.stringify(observed)).not.toContain('x@y.z');
  });
});

describe('the probe runs in the SAME environment the child gets', () => {
  it('spawns `auth status --json` with exactly the composed child env, and returns only a class', () => {
    const childEnv = hostedChildEnv({ apiKey: '', path: '/p', home: '/h', mode: 'CLAUDE_SUBSCRIPTION', oauthToken: TOKEN });
    const seen: { executable: string; args: readonly string[]; names: string[] }[] = [];
    const spawn: LoginSpawn = (executable, args, env) => {
      seen.push({ executable, args, names: Object.keys(env).sort() });
      return MEASURED.tokenOnly;
    };
    const observed = observeCoderLogin({ executable: '/sdk/claude', childEnv, spawn });
    expect(seen).toEqual([{ executable: '/sdk/claude', args: ['auth', 'status', '--json'], names: Object.keys(childEnv).sort() }]);
    expect(seen[0]!.names).toContain(CLAUDE_SUBSCRIPTION_TOKEN_ENV);
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) expect(seen[0]!.names).not.toContain(name);
    expect(observed.sourceClass).toBe('subscription_oauth_token');
    expect(JSON.stringify(observed)).not.toContain(TOKEN);
  });

  it('no executable, or one that cannot start, is an unobservable login — fail closed', () => {
    expect(observeCoderLogin({ executable: null, childEnv: {} }).loggedIn).toBe(false);
    expect(observeCoderLogin({ executable: '/x', childEnv: {}, spawn: () => null }).sourceClass).toBe('not_logged_in');
  });

  it('looks for the executable exactly where the Agent SDK does', () => {
    expect(sdkExecutableCandidates('linux', 'x64')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude', '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    ]);
    expect(sdkExecutableCandidates('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']);
    expect(sdkExecutableCandidates('darwin', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude']);
  });
});

describe('billing on the token path: SUBSCRIPTION, and no API amount of any kind — null, never 0', () => {
  it('a subscription dispatch the runtime priced is still no API spend', () => {
    const observed = foldHostedMessage(emptyObservation(), {
      type: 'result', subtype: 'success', is_error: false, result: 'Done.', num_turns: 1, duration_ms: 10,
      total_cost_usd: 0.42, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [], session_id: 's-1',
    });
    const cost = hostedCoderCost('CLAUDE_SUBSCRIPTION', observed);
    expect(cost.billingPath).toBe('SUBSCRIPTION');
    expect(cost.costBasis).toBe('NOT_APPLICABLE');
    expect(cost.costUsdMicros, 'no API spend exists; null, not a fabricated 0').toBeNull();
    expect(cost.costUsdMicros).not.toBe(0);
  });
});
