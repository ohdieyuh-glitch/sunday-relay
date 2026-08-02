import { describe, expect, it } from 'vitest';
import {
  HERMES_FAILURE_KINDS, HERMES_SERVICE_PROTOCOL, selectHermesMode,
  selectionProvesReachability,
} from './hermes-transport';
import {
  HERMES_PROVIDERS, PROVIDER_CREDENTIAL_ENV, describeProvider,
  loadHermesProviderConfig, providerVerificationLimit,
} from './hermes-provider';

/**
 * Every test here is offline. Nothing in this file resolves a host, opens a
 * socket, or spawns a process — which is the point, because the behaviour
 * being pinned is precisely what Relay must do BEFORE any of that.
 */

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

const REMOTE = {
  RELAY_HERMES_MODE: 'remote',
  RELAY_HERMES_SERVICE_URL: 'http://hermes.railway.internal:8080',
  RELAY_HERMES_SERVICE_TOKEN: 'service-token',
};

describe('transport selection fails closed', () => {
  it('selects the executable transport for explicit local mode', () => {
    const s = selectHermesMode({ env: env({ RELAY_HERMES_MODE: 'local' }), production: true });
    expect(s.ok && s.mode).toBe('local');
  });

  it('selects the HTTP transport for explicit remote mode', () => {
    const s = selectHermesMode({ env: env(REMOTE), production: true });
    expect(s.ok && s.mode).toBe('remote');
  });

  it('fails closed in production when no mode is configured', () => {
    // This is the original bug: an unset mode used to mean "probe this
    // container's PATH", which told a founder to install Hermes on a machine
    // that could never satisfy the check.
    const s = selectHermesMode({ env: env({}), production: true });
    expect(s.ok).toBe(false);
    expect(s.ok === false && s.kind).toBe('configuration_missing');
    expect(s.ok === false && s.safeMessage).toContain('will not guess');
  });

  it('keeps the documented local default off production', () => {
    const s = selectHermesMode({ env: env({}), production: false });
    expect(s.ok && s.mode).toBe('local');
  });

  it('fails closed on a malformed mode', () => {
    for (const mode of ['REMOTE', 'hybrid', 'auto', 'Local', 'remote ']) {
      const s = selectHermesMode({ env: env({ RELAY_HERMES_MODE: mode.trim() === mode ? mode : mode }), production: false });
      // `remote ` trims to a valid mode; every other value here is rejected.
      if (mode.trim() === 'remote') continue;
      expect(s.ok, mode).toBe(false);
    }
  });

  it('treats a blank mode as unset rather than malformed', () => {
    // Deployment systems routinely materialise an unset variable as an empty
    // string, so blank is indistinguishable from absent and must not be a
    // separate failure. It still fails closed in production, which is where
    // guessing was the original bug.
    for (const blank of ['', '   ']) {
      expect(selectHermesMode({ env: env({ RELAY_HERMES_MODE: blank }), production: true }).ok, `prod:${blank}`)
        .toBe(false);
      const dev = selectHermesMode({ env: env({ RELAY_HERMES_MODE: blank }), production: false });
      expect(dev.ok && dev.mode, `dev:${blank}`).toBe('local');
    }
  });

  it('fails closed when remote mode has no service URL', () => {
    const s = selectHermesMode({
      env: env({ RELAY_HERMES_MODE: 'remote', RELAY_HERMES_SERVICE_TOKEN: 't' }), production: true,
    });
    expect(s.ok).toBe(false);
    expect(s.ok === false && s.safeMessage).toContain('RELAY_HERMES_SERVICE_URL');
  });

  it('fails closed when remote mode has no service token', () => {
    const s = selectHermesMode({
      env: env({ RELAY_HERMES_MODE: 'remote', RELAY_HERMES_SERVICE_URL: 'http://h.internal' }),
      production: true,
    });
    expect(s.ok).toBe(false);
    expect(s.ok === false && s.safeMessage).toContain('RELAY_HERMES_SERVICE_TOKEN');
  });

  it('fails closed on a service URL that is not http(s)', () => {
    const s = selectHermesMode({
      env: env({ ...REMOTE, RELAY_HERMES_SERVICE_URL: 'file:///etc/passwd' }), production: true,
    });
    expect(s.ok).toBe(false);
  });

  it('never reports remote mode as local, whatever the executable override says', () => {
    // A leftover RELAY_HERMES_EXECUTABLE must not drag a remote bridge back
    // into probing its own container.
    const s = selectHermesMode({
      env: env({ ...REMOTE, RELAY_HERMES_EXECUTABLE: '/usr/local/bin/hermes' }), production: true,
    });
    expect(s.ok && s.mode).toBe('remote');
    expect(JSON.stringify(s)).not.toContain('/usr/local/bin/hermes');
  });

  it('does not echo a rejected URL, which names internal host layout', () => {
    const s = selectHermesMode({
      env: env({ ...REMOTE, RELAY_HERMES_SERVICE_URL: 'ftp://secret-internal-host:9999' }), production: true,
    });
    expect(s.ok === false && s.safeMessage).not.toContain('secret-internal-host');
  });

  it('never treats a configured URL as a reachable service', () => {
    expect(selectionProvesReachability()).toBe(false);
  });
});

describe('the failure vocabulary is categorised, not free text', () => {
  it('covers every state the Reviewer must be able to report', () => {
    for (const kind of [
      'configuration_missing', 'authentication_failed', 'service_unreachable',
      'incompatible_runtime', 'interface_unverified', 'readonly_unverified',
      'credentials_missing', 'provider_unverified', 'model_unverified',
      'protocol_mismatch', 'malformed_response', 'timed_out',
    ]) {
      expect(HERMES_FAILURE_KINDS).toContain(kind);
    }
  });

  it('versions the bridge-to-service protocol', () => {
    expect(HERMES_SERVICE_PROTOCOL).toBe('relay-hermes-reviewer.v1');
  });
});

describe('provider identity is configured, not assumed', () => {
  const ANTHROPIC = {
    RELAY_HERMES_PROVIDER: 'anthropic',
    RELAY_HERMES_MODEL: 'claude-sonnet-5',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const XAI = {
    RELAY_HERMES_PROVIDER: 'xai',
    RELAY_HERMES_MODEL: 'grok-4',
    XAI_API_KEY: 'xai-test',
  };

  it('supports Anthropic and xAI, and nothing else', () => {
    expect([...HERMES_PROVIDERS]).toEqual(['anthropic', 'xai']);
    // Explicitly out of scope for this change.
    expect(HERMES_PROVIDERS).not.toContain('google');
    expect(HERMES_PROVIDERS).not.toContain('gemini');
  });

  it('reads an Anthropic-backed Hermes, which is what this machine actually has', () => {
    const r = loadHermesProviderConfig(env(ANTHROPIC));
    expect(r.ok).toBe(true);
    expect(r.ok && r.config.provider).toBe('anthropic');
    expect(r.ok && r.config.credentialEnvName).toBe('ANTHROPIC_API_KEY');
    expect(r.ok && r.config.credentialPresent).toBe(true);
  });

  it('reads an xAI-backed Hermes without conflating it with Anthropic', () => {
    const r = loadHermesProviderConfig(env(XAI));
    expect(r.ok && r.config.provider).toBe('xai');
    expect(r.ok && r.config.credentialEnvName).toBe('XAI_API_KEY');
    // The Anthropic key must not satisfy an xAI configuration.
    const crossed = loadHermesProviderConfig(env({
      RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-4', ANTHROPIC_API_KEY: 'sk-ant-test',
    }));
    expect(crossed.ok && crossed.config.credentialPresent).toBe(false);
  });

  it('refuses to choose a provider or a model', () => {
    expect(loadHermesProviderConfig(env({ RELAY_HERMES_MODEL: 'x' })).ok).toBe(false);
    expect(loadHermesProviderConfig(env({ RELAY_HERMES_PROVIDER: 'anthropic' })).ok).toBe(false);
  });

  it('rejects an unrecognised provider without echoing operator text', () => {
    const r = loadHermesProviderConfig(env({
      RELAY_HERMES_PROVIDER: 'google', RELAY_HERMES_MODEL: 'gemini-x',
    }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.safeMessage).not.toContain('google');
  });

  it('maps each provider to its own credential variable', () => {
    expect(PROVIDER_CREDENTIAL_ENV.anthropic).toBe('ANTHROPIC_API_KEY');
    expect(PROVIDER_CREDENTIAL_ENV.xai).toBe('XAI_API_KEY');
  });
});

describe('presence is not verification', () => {
  const cfg = (o: Record<string, string>) => {
    const r = loadHermesProviderConfig(env(o));
    if (!r.ok) throw new Error('expected config');
    return r.config;
  };

  it('reports a missing credential as credentials_missing', () => {
    const limit = providerVerificationLimit(cfg({
      RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-4',
    }));
    expect(limit?.kind).toBe('credentials_missing');
  });

  it('reports an Anthropic credential as present but the model as unverified', () => {
    // Relay has no token-free way to confirm an Anthropic credential may use a
    // model, and will not invent an endpoint or spend tokens to pretend it
    // does. The limitation is stated rather than hidden.
    const limit = providerVerificationLimit(cfg({
      RELAY_HERMES_PROVIDER: 'anthropic', RELAY_HERMES_MODEL: 'claude-sonnet-5',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    }));
    expect(limit?.kind).toBe('provider_unverified');
    expect(limit?.safeMessage).toContain('until a real review runs');
  });

  it('leaves xAI verifiable, because listing costs no tokens', () => {
    const limit = providerVerificationLimit(cfg({
      RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-4', XAI_API_KEY: 'xai-test',
    }));
    expect(limit).toBeNull();
  });

  it('never lets a configured model become a verified model', () => {
    const identity = describeProvider(cfg({
      RELAY_HERMES_PROVIDER: 'anthropic', RELAY_HERMES_MODEL: 'claude-sonnet-5',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    }));
    expect(identity.requestedModel).toBe('claude-sonnet-5');
    expect(identity.verifiedModelId).toBeNull();
  });

  it('exposes no credential material in the safe identity', () => {
    const identity = describeProvider(cfg({
      RELAY_HERMES_PROVIDER: 'anthropic', RELAY_HERMES_MODEL: 'claude-sonnet-5',
      ANTHROPIC_API_KEY: 'sk-ant-SECRET',
    }));
    const s = JSON.stringify(identity);
    expect(s).not.toContain('sk-ant');
    expect(s).not.toMatch(/length|hash|sha/i);
  });
});
