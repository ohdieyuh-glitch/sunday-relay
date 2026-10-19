import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_CREDENTIAL_ENV_NAMES, CLAUDE_AUTH_MODES, JULIUS_CLAUDE_AUTH_ENV,
  claudeAuthLine, decideClaudeAuth, resolveClaudeAuthMode,
  type ClaudeAuthMode,
} from './hosted-auth';
import {
  HOSTED_CHILD_ENV_KEYS, HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION,
  hostedChildEnv, hostedChildEnvKeys,
} from './hosted-envelope';
import {
  JULIUS_COST_BASES, consistentJuliusBillingPath, juliusCostComponent, safeJuliusCostBasis, summariseJuliusMissionCost,
} from '../../src/relay/mission/julius/julius-cost-accounting';
import { emptyObservation, foldHostedMessage } from './hosted-observation';
import { hostedCoderCost } from '../julius/claude-code-coding-provider';

/**
 * WHICH CREDENTIAL THE CODING AGENT WOULD USE, ASSERTED RATHER THAN HOPED FOR.
 *
 * The founder's requirement is a preflight that can tell SUBSCRIPTION from API KEY
 * and fails closed when subscription is asked for but a key would actually be used.
 *
 * THE OBVIOUS IMPLEMENTATION WOULD HAVE BEEN VACUOUS, and that is measured rather
 * than argued: with a FAKE key placed in an otherwise minimal child environment,
 * `claude auth status --json` still answered `authMethod: "claude.ai"` and
 * `apiProvider: "firstParty"`. Only `subscriptionType` changed, from `"max"` to
 * `null`. So a preflight that asked the CLI "is a key in play" would have answered
 * SUBSCRIPTION with the key sitting right there.
 *
 * The authority is therefore the COMPOSED CHILD ENVIRONMENT, which Julius builds
 * from `{}` and fully controls, and the login probe is used only for what it does
 * know: whether a first-party subscription login exists at all.
 */

const login = (overrides: Partial<{ loggedIn: boolean; sourceClass: string; subscriptionLabel: string }> = {}) =>
  ({ loggedIn: true, sourceClass: 'local_subscription', subscriptionLabel: 'max', ...overrides });

describe('the mode is explicit, and an unknown value is refused rather than defaulted', () => {
  it('absent means API mode, so every existing deployment is unchanged', () => {
    const resolved = resolveClaudeAuthMode({});
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.mode).toBe('ANTHROPIC_API');
    for (const blank of ['', '   ']) {
      const answer = resolveClaudeAuthMode({ [JULIUS_CLAUDE_AUTH_ENV]: blank });
      expect(answer.ok && answer.mode, JSON.stringify(blank)).toBe('ANTHROPIC_API');
    }
  });

  it('both modes resolve, and they are the only two', () => {
    expect([...CLAUDE_AUTH_MODES]).toEqual(['ANTHROPIC_API', 'CLAUDE_SUBSCRIPTION']);
    for (const mode of CLAUDE_AUTH_MODES) {
      const answer = resolveClaudeAuthMode({ [JULIUS_CLAUDE_AUTH_ENV]: mode });
      expect(answer.ok && answer.mode, mode).toBe(mode);
    }
  });

  it('a MISSPELLED mode is refused, because a silent fallback to API mode bills a card', () => {
    for (const wrong of ['subscription', 'CLAUDE_SUBSCRIPTON', 'max', 'api', 'ANTHROPIC-API']) {
      const answer = resolveClaudeAuthMode({ [JULIUS_CLAUDE_AUTH_ENV]: wrong });
      expect(answer.ok, wrong).toBe(false);
      if (!answer.ok) {
        expect(answer.refusal).toBe('auth_mode_unknown');
        expect(answer.because).toContain(wrong);
      }
    }
  });
});

describe('the child environment is where the decision becomes a fact', () => {
  it('API mode carries the credential; SUBSCRIPTION mode does not carry it at all', () => {
    const api = hostedChildEnv({ apiKey: 'test-key-value', path: '/p', home: '/h', mode: 'ANTHROPIC_API' });
    expect(Object.keys(api).sort()).toEqual([...HOSTED_CHILD_ENV_KEYS].sort());
    expect(api.ANTHROPIC_API_KEY).toBe('test-key-value');

    const sub = hostedChildEnv({ apiKey: 'test-key-value', path: '/p', home: '/h', mode: 'CLAUDE_SUBSCRIPTION' });
    expect(Object.keys(sub).sort()).toEqual([...HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION].sort());
    expect('ANTHROPIC_API_KEY' in sub,
      'a key present here would take precedence over the subscription, which is the whole hazard').toBe(false);
    // Even a non-empty key passed alongside the mode must not appear. The mode
    // decides, not the caller's tidiness.
    expect(Object.values(sub)).not.toContain('test-key-value');
  });

  it('SUBSCRIPTION mode carries NO credential-bearing variable of any kind', () => {
    const sub = hostedChildEnv({ apiKey: 'k', path: '/p', home: '/h', mode: 'CLAUDE_SUBSCRIPTION' });
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      expect(Object.keys(sub), name).not.toContain(name);
    }
  });

  it('the child is still built from NOTHING, so the parent cannot leak into it', () => {
    // The parent of a real run holds the operator token, the OpenAI architect key,
    // the xAI reviewer key and the database URL. None may appear here, and the
    // guarantee is that the object starts empty rather than being filtered.
    for (const mode of CLAUDE_AUTH_MODES) {
      const env = hostedChildEnv({ apiKey: 'k', path: '/p', home: '/h', mode });
      expect(Object.keys(env).sort(), mode).toEqual([...hostedChildEnvKeys(mode)].sort());
      for (const leak of ['OPENAI_API_KEY', 'XAI_API_KEY', 'DATABASE_URL', 'RELAY_OPERATOR_TOKEN']) {
        expect(Object.keys(env), `${mode}: ${leak}`).not.toContain(leak);
      }
    }
  });

  it('absent mode behaves exactly as API mode did before any of this existed', () => {
    const before = hostedChildEnv({ apiKey: 'k', path: '/p', home: '/h' });
    const api = hostedChildEnv({ apiKey: 'k', path: '/p', home: '/h', mode: 'ANTHROPIC_API' });
    expect(before).toEqual(api);
  });
});

describe('the decision fails closed, and its refusals are named', () => {
  const childFor = (mode: ClaudeAuthMode): readonly string[] => [...hostedChildEnvKeys(mode)];

  it('API mode requires a key, and says so when there is none', () => {
    const answer = decideClaudeAuth({ mode: 'ANTHROPIC_API', apiKeyProvided: false, childEnvNames: childFor('ANTHROPIC_API') });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.refusal).toBe('api_key_missing');
  });

  it('API mode with a key records API authentication and an APPLICABLE cost', () => {
    const answer = decideClaudeAuth({ mode: 'ANTHROPIC_API', apiKeyProvided: true, childEnvNames: childFor('ANTHROPIC_API') });
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.provenance).toMatchObject({
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
        authentication: 'ANTHROPIC_API_KEY', apiKeyUsed: true, apiCostApplicable: true, plan: null,
      });
    }
  });

  it('SUBSCRIPTION mode is REFUSED when a key would be passed to the child', () => {
    const answer = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: true,
      childEnvNames: childFor('CLAUDE_SUBSCRIPTION'), login: login(),
    });
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.refusal).toBe('subscription_would_use_api_key');
      expect(answer.because).toContain('precedence');
    }
  });

  it('SUBSCRIPTION mode is REFUSED for ANY credential variable in the child, not only the key', () => {
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      const answer = decideClaudeAuth({
        mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false,
        childEnvNames: [...childFor('CLAUDE_SUBSCRIPTION'), name], login: login(),
      });
      expect(answer.ok, name).toBe(false);
      if (!answer.ok) {
        expect(answer.refusal, name).toBe('subscription_would_use_api_key');
        expect(answer.because, name).toContain(name);
      }
    }
  });

  it('the STRUCTURAL check runs BEFORE the login is consulted, so a good login cannot excuse a key', () => {
    const answer = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: true,
      childEnvNames: childFor('CLAUDE_SUBSCRIPTION'), login: login(),
    });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.refusal).not.toBe('subscription_login_absent');
  });

  it('SUBSCRIPTION mode is REFUSED with no login, and names the human step', () => {
    for (const observed of [undefined, login({ loggedIn: false })]) {
      const answer = decideClaudeAuth({
        mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false,
        childEnvNames: childFor('CLAUDE_SUBSCRIPTION'),
        ...(observed === undefined ? {} : { login: observed }),
      });
      expect(answer.ok).toBe(false);
      if (!answer.ok) {
        expect(answer.refusal).toBe('subscription_login_absent');
        expect(answer.because, 'the refusal must point at the official login, and at nothing else')
          .toContain('claude` login');
      }
    }
  });

  it('SUBSCRIPTION mode is REFUSED for a login that is not first-party', () => {
    for (const sourceClass of ['api_key', 'bedrock', 'vertex', 'gateway', 'unknown']) {
      const answer = decideClaudeAuth({
        mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false,
        childEnvNames: childFor('CLAUDE_SUBSCRIPTION'), login: login({ sourceClass }),
      });
      expect(answer.ok, sourceClass).toBe(false);
      if (!answer.ok) expect(answer.refusal, sourceClass).toBe('subscription_login_not_first_party');
    }
  });

  it('SUBSCRIPTION mode records the plan, and that NO API cost is APPLICABLE — never a zero', () => {
    const answer = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false,
      childEnvNames: childFor('CLAUDE_SUBSCRIPTION'), login: login(),
    });
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.provenance).toEqual({
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK',
        authentication: 'CLAUDE_SUBSCRIPTION', plan: 'max', credentialSource: 'local_subscription',
        apiKeyUsed: false, apiCostApplicable: false,
      });
      // THE PROVIDER IS UNCHANGED BY ANY OF THIS. Billing moved; the vendor did not.
      expect(answer.provenance.provider).toBe('ANTHROPIC');
      // And there is no cost FIELD at all, so nothing can render a $0 that would
      // assert a billing event happened and cost nothing.
      expect(Object.keys(answer.provenance)).not.toContain('apiCostUsd');
    }
  });

  it('the printable line carries a class and a plan label, and no value that could be a secret', () => {
    const answer = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false,
      childEnvNames: childFor('CLAUDE_SUBSCRIPTION'), login: login(),
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const line = claudeAuthLine(answer.provenance);
    expect(line).toContain('CLAUDE AUTH: SUBSCRIPTION');
    expect(line).toContain('api_key_used=false');
    expect(line).toContain('api_cost_applicable=false');
    // Nothing long and opaque: a plan label is a word, and there is no token here
    // to redact because no value ever entered this module.
    expect(line).not.toMatch(/[A-Za-z0-9_-]{20,}/u);
  });
});

/**
 * THE FORWARDING CHAIN, ASSERTED STRUCTURALLY AND LABELLED AS SUCH.
 *
 * This is a source assertion and it is weaker than a behavioural one. It is here
 * because the wiring nearly WAS a no-op: the composition passes the mode with a
 * conditional spread, and a spread defeats TypeScript's excess-property check — so
 * before the field was declared on the adapter's options the whole mode typechecked,
 * compiled, and was silently dropped one call before it mattered.
 *
 * THE BEHAVIOURAL PROOF NOW EXISTS, and it needed no provider call after all:
 * `relay-bridge/julius/coding-agent-child-env.runtime.test.ts` composes from the
 * environment, dispatches through the real adapter, provider, runner and Agent SDK,
 * and asks the SPAWNED CHILD what environment it received. It fails when the
 * composition drops the mode and when the child env inherits the parent — both
 * mutations were run. These source checks stay as the cheap guard on the
 * declarations, which is the half a spread cannot be trusted to enforce.
 */
describe('every hop forwards the mode, because one that does not is invisible', () => {
  const ROOT = process.cwd();
  const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

  it.each([
    ['relay-bridge/julius/live-composition.ts', 'authMode: authMode.mode'],
    ['relay-bridge/julius/live-workers.ts', 'authMode: input.authMode'],
    ['relay-bridge/julius/claude-code-coding-provider.ts', 'authMode: input.authMode'],
    ['relay-bridge/hosted-coding-agent/hosted-runner.ts', 'mode: input.authMode'],
  ])('%s forwards it', (file, needle) => {
    expect(read(file), `${file} must pass the mode on, or the hop below never sees it`).toContain(needle);
  });

  it('each hop also DECLARES it, which is what a spread cannot be trusted to enforce', () => {
    for (const file of [
      'relay-bridge/julius/live-workers.ts',
      'relay-bridge/julius/claude-code-coding-provider.ts',
      'relay-bridge/hosted-coding-agent/hosted-runner.ts',
    ]) {
      expect(read(file), file).toMatch(/authMode\?:\s*ClaudeAuthMode/u);
    }
  });
});

/**
 * GATE J: SUBSCRIPTION USAGE IS NOT ANTHROPIC API SPEND, and the accounting says so.
 *
 * The runtime may still report a `total_cost_usd` under a subscription. That is a
 * PRICED ESTIMATE of what the same work would have cost through the API, not a
 * billing event that occurred. Recording it as spend is the exact
 * misclassification the founder's gate forbids, and recording `0` instead would be
 * worse: it asserts a billing event happened and cost nothing.
 *
 * So the basis is `NOT_APPLICABLE` and the amount is absent. The figure is not
 * lost — the runner still bounds the run with it — but nothing sums it as money
 * anyone was charged.
 */
describe('subscription usage is never reported as API spend', () => {
  it('NOT_APPLICABLE is a known basis and is NOT a spend basis', () => {
    expect([...JULIUS_COST_BASES]).toContain('NOT_APPLICABLE');
    expect(safeJuliusCostBasis('NOT_APPLICABLE'), 'an unrecognised word would degrade to UNKNOWN')
      .toBe('NOT_APPLICABLE');
    // The accounting's own arithmetic must not treat it as money charged.
    const summed = summariseJuliusMissionCost([
      juliusCostComponent({ taskId: 't1', role: 'CODING_AGENT', basis: 'NOT_APPLICABLE', usdMicros: null }),
      juliusCostComponent({ taskId: 't2', role: 'PROMPT_ARCHITECT', basis: 'PROVIDER_REPORTED', usdMicros: 2_000_000 }),
    ]);
    expect(summed.knownUsdMicros, 'only the architect was charged').toBe(2_000_000);
    expect(summed.complete, 'a NOT_APPLICABLE component is not a spend basis, so the total is not complete').toBe(false);
  });

  it('a subscription component carrying an amount STILL does not become spend', () => {
    // Defence in depth: even if some future caller put a figure on it, the basis is
    // what decides, so the number cannot leak into the charged total.
    const summed = summariseJuliusMissionCost([
      juliusCostComponent({ taskId: 't1', role: 'CODING_AGENT', basis: 'NOT_APPLICABLE', usdMicros: 9_999_999 }),
    ]);
    expect(summed.knownUsdMicros, 'the BASIS decides what is money, never the presence of a number').toBe(0);
  });

  /**
   * THIS WAS A SOURCE-TEXT TEST, AND IT PASSED WHILE THE SUCCESS ENDING WAS WRONG.
   *
   * It checked that the provider's file contained the subscription branch — which
   * the diagnostics builder alone satisfied — while the SUCCESS ending priced itself
   * by hand and settled the runtime's notional figure as PROVIDER_REPORTED API
   * spend. The integration lane found it by reading the ledger path. Every ending
   * now asks `hostedCoderCost`, and the proof that each one reaches the durable
   * ledger correctly is `relay-bridge/julius/subscription-settlement.runtime.test.ts`,
   * which drives real dispatches into the real kernel. This is the shared unit,
   * fed an observation folded from a real SDK result message.
   */
  it('one function decides the cost for every ending, from the mode and never from the amount', () => {
    const observed = foldHostedMessage(emptyObservation(), {
      type: 'result', subtype: 'success', is_error: false, result: 'Done.', num_turns: 1, duration_ms: 10,
      total_cost_usd: 0.42, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [], session_id: 's-1',
    });
    expect(hostedCoderCost('CLAUDE_SUBSCRIPTION', observed)).toEqual({
      costUsdMicros: null, costBasis: 'NOT_APPLICABLE', executionCostUsdMicros: 420_000, billingPath: 'SUBSCRIPTION',
    });
    expect(hostedCoderCost(undefined, observed)).toEqual({
      costUsdMicros: 420_000, costBasis: 'PROVIDER_REPORTED', executionCostUsdMicros: null, billingPath: 'API_BILLED',
    });
    expect(hostedCoderCost('ANTHROPIC_API', observed), 'naming the default is the default').toEqual(hostedCoderCost(undefined, observed));
    // NOTHING OBSERVED: no figure of either kind, and the basis still says which world it is.
    expect(hostedCoderCost('CLAUDE_SUBSCRIPTION', null)).toEqual({
      costUsdMicros: null, costBasis: 'NOT_APPLICABLE', executionCostUsdMicros: null, billingPath: 'SUBSCRIPTION',
    });
    expect(hostedCoderCost(undefined, null)).toEqual({
      costUsdMicros: null, costBasis: 'UNKNOWN', executionCostUsdMicros: null, billingPath: 'API_BILLED',
    });
  });

  it('a billing path that contradicts its basis is never recorded', () => {
    expect(consistentJuliusBillingPath('SUBSCRIPTION', 'NOT_APPLICABLE')).toBe('SUBSCRIPTION');
    expect(consistentJuliusBillingPath('API_BILLED', 'PROVIDER_REPORTED')).toBe('API_BILLED');
    // An API bill whose amount nobody read is still an API bill.
    expect(consistentJuliusBillingPath('API_BILLED', 'UNKNOWN')).toBe('API_BILLED');
    expect(consistentJuliusBillingPath('SUBSCRIPTION', 'PROVIDER_REPORTED'), 'no charge beside a charge').toBeNull();
    expect(consistentJuliusBillingPath('SUBSCRIPTION', 'UNKNOWN'), 'no charge beside a charge nobody read').toBeNull();
    expect(consistentJuliusBillingPath('API_BILLED', 'NOT_APPLICABLE'), 'a bill beside no billing event').toBeNull();
    expect(consistentJuliusBillingPath('subscription', 'NOT_APPLICABLE'), 'a word nobody defined').toBeNull();
    expect(consistentJuliusBillingPath(undefined, 'NOT_APPLICABLE')).toBeNull();
  });
});
