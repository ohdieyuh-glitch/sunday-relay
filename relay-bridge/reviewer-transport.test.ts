import { describe, expect, it, vi } from 'vitest';

import {
  remoteReviewerPreflight,
  resolveReviewerTransport,
  reviewerPreflight,
} from './reviewer-transport';
import { REMOTE_HERMES_ENV, type RemoteHermesConfig } from './hermes-remote-review';
import type { HermesConfig, HermesPreflightResult } from './hermes-reviewer';

/**
 * THE PREFLIGHT MUST MATCH THE TRANSPORT.
 *
 * This is the failure this module exists to prevent, and it has happened
 * before in this repository: the hosted Coding Agent was refused by a probe
 * for the LOCAL CLI on a container that was never going to have one, so the
 * hosted path died with "Install Claude Code" while being correctly
 * configured.
 *
 * The same shape applies to the Reviewer. `hermesPreflight` runs
 * `hermes --help` and fails when the binary is absent — always, on a
 * container. So the central test here is that a remote transport NEVER
 * reaches the local probe.
 */

const REMOTE_ENV = {
  [REMOTE_HERMES_ENV.mode]: 'remote',
  [REMOTE_HERMES_ENV.url]: 'https://hermes.example.com',
  [REMOTE_HERMES_ENV.token]: 'service-token',
  [REMOTE_HERMES_ENV.trustedOrigins]: 'https://hermes.example.com',
};

const remoteConfig: RemoteHermesConfig = {
  serviceUrl: 'https://hermes.example.com',
  token: 'service-token',
  trustedOrigins: ['https://hermes.example.com'],
  timeoutMs: 1_000,
  reviewTimeoutMs: 10_000,
  pollIntervalMs: 1,
};

const localConfig: HermesConfig = {
  executable: 'hermes', timeoutMs: 1_000, maxOutputBytes: 1_000,
};

const readiness = (over: Record<string, unknown> = {}, status = 200): Response =>
  new Response(JSON.stringify({
    lifecycle: 'running',
    evidence: {
      installed: true, compatible: true, credentialPresent: true,
      readOnlyEnforceable: true, verifiedModelId: 'hermes-3',
      failureReason: null,
      ...over,
    },
  }), { status, headers: { 'content-type': 'application/json' } });

describe('choosing the transport', () => {
  it('chooses remote when the deployment configured one', () => {
    const transport = resolveReviewerTransport(REMOTE_ENV);
    expect(transport.kind).toBe('remote');
  });

  it('chooses local when the deployment never asked for remote', () => {
    // Not a misconfiguration. A bridge that never asked for the remote
    // reviewer is correctly configured for the local one.
    const transport = resolveReviewerTransport({});
    expect(transport.kind).toBe('local');
  });

  it('is UNAVAILABLE, never local, when remote was asked for and cannot be had', () => {
    // Falling back to local here would turn a configuration mistake into a
    // confusing preflight failure about a binary nobody intended to use.
    const transport = resolveReviewerTransport({
      ...REMOTE_ENV, [REMOTE_HERMES_ENV.token]: '',
    });
    expect(transport.kind).toBe('unavailable');
    if (transport.kind === 'unavailable') expect(transport.refusal).toBe('no_token');
  });
});

describe('a remote transport never reaches the local probe', () => {
  it('does not call the local preflight at all', async () => {
    // THE TEST THIS MODULE EXISTS FOR. A container has no `hermes` binary;
    // probing for one would refuse a correctly configured remote reviewer.
    const localPreflight = vi.fn();
    await reviewerPreflight({
      transport: resolveReviewerTransport(REMOTE_ENV),
      localConfig,
      localPreflight: localPreflight as unknown as (c: HermesConfig) => HermesPreflightResult,
      deps: { fetchImpl: (() => Promise.resolve(readiness())) as unknown as typeof fetch },
    });
    expect(localPreflight).not.toHaveBeenCalled();
  });

  it('does not call the local preflight when remote is misconfigured either', async () => {
    const localPreflight = vi.fn();
    const result = await reviewerPreflight({
      transport: resolveReviewerTransport({ ...REMOTE_ENV, [REMOTE_HERMES_ENV.url]: '' }),
      localConfig,
      localPreflight: localPreflight as unknown as (c: HermesConfig) => HermesPreflightResult,
    });
    expect(localPreflight).not.toHaveBeenCalled();
    expect(result.ready).toBe(false);
    // And it says which configuration is missing, not that a binary is absent.
    expect(result.reason).toContain(REMOTE_HERMES_ENV.url);
  });

  it('DOES call the local preflight for a local transport', async () => {
    const localPreflight = vi.fn().mockReturnValue({ ready: true, missing: [] });
    await reviewerPreflight({
      transport: resolveReviewerTransport({}),
      localConfig,
      localPreflight: localPreflight as unknown as (c: HermesConfig) => HermesPreflightResult,
    });
    expect(localPreflight).toHaveBeenCalledTimes(1);
  });
});

describe('the remote readiness probe', () => {
  it('is ready when the service reports it is', async () => {
    const result = await remoteReviewerPreflight(remoteConfig, {
      fetchImpl: (() => Promise.resolve(readiness())) as unknown as typeof fetch,
    });
    expect(result.ready).toBe(true);
  });

  it('repeats what the SERVICE said rather than deciding for it', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ installed: false }, 'hermes installed'],
      [{ compatible: false }, 'compatible hermes version'],
      [{ credentialPresent: false }, 'provider credential'],
      [{ readOnlyEnforceable: false }, 'read-only'],
    ];
    for (const [over, expected] of cases) {
      const result = await remoteReviewerPreflight(remoteConfig, {
        fetchImpl: (() => Promise.resolve(readiness(over))) as unknown as typeof fetch,
      });
      expect(result.ready, expected).toBe(false);
      expect(JSON.stringify(result), expected).toContain(expected);
    }
  });

  it('refuses a service that cannot enforce read-only, however healthy it is', async () => {
    // Read-only is the Reviewer's whole safety property. A service that cannot
    // enforce it is not a Reviewer Relay may use.
    const result = await remoteReviewerPreflight(remoteConfig, {
      fetchImpl: (() => Promise.resolve(readiness({ readOnlyEnforceable: false }))) as unknown as typeof fetch,
    });
    expect(result.ready).toBe(false);
  });

  it('refuses a service that is shutting down', async () => {
    const body = new Response(JSON.stringify({
      lifecycle: 'shutting_down',
      evidence: { installed: true, compatible: true, credentialPresent: true, readOnlyEnforceable: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const result = await remoteReviewerPreflight(remoteConfig, {
      fetchImpl: (() => Promise.resolve(body)) as unknown as typeof fetch,
    });
    expect(result.ready).toBe(false);
  });

  it('reports an unreachable service as unready rather than throwing', async () => {
    const result = await remoteReviewerPreflight(remoteConfig, {
      fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch,
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('could not be reached');
  });

  it('never puts the credential in a readiness reason', async () => {
    const result = await remoteReviewerPreflight(remoteConfig, {
      fetchImpl: (() => Promise.resolve(new Response('nope', { status: 401 }))) as unknown as typeof fetch,
    });
    expect(JSON.stringify(result)).not.toContain('service-token');
  });

  it('sends the credential as a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(readiness());
    await remoteReviewerPreflight(remoteConfig, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer service-token');
    // A readiness probe reads. It must never create a run.
    expect(init.method).toBe('GET');
  });
});

/**
 * THE PROVIDER REVIEWER, AND THE AMBIGUITY IT CREATES.
 *
 * A third way to have a Reviewer means two can now be enabled at once. Picking
 * one silently would make the reviewer that ran depend on the order of two
 * lines in a function, and an operator would read a verdict from a component
 * they did not choose.
 */
describe('the provider Reviewer', () => {
  const PROVIDER_ENV = {
    RELAY_OPENAI_REVIEWER_MODE: 'live',
    OPENAI_API_KEY: 'key',
    RELAY_OPENAI_REVIEWER_MODEL: 'gpt-test',
  };
  const REMOTE = {
    [REMOTE_HERMES_ENV.mode]: 'remote',
    [REMOTE_HERMES_ENV.url]: 'https://hermes.example.com',
    [REMOTE_HERMES_ENV.token]: 'service-token',
    [REMOTE_HERMES_ENV.trustedOrigins]: 'https://hermes.example.com',
  };

  it('is chosen when it is the one enabled', () => {
    const transport = resolveReviewerTransport(PROVIDER_ENV);
    expect(transport.kind).toBe('provider');
  });

  it('REFUSES when both it and the remote Hermes are enabled', () => {
    const transport = resolveReviewerTransport({ ...PROVIDER_ENV, ...REMOTE });
    expect(transport.kind).toBe('unavailable');
    if (transport.kind === 'unavailable') {
      expect(transport.refusal).toBe('ambiguous_reviewer');
      // It names BOTH, so an operator knows which two to look at.
      expect(transport.detail).toContain(REMOTE_HERMES_ENV.mode);
      expect(transport.detail).toContain('RELAY_OPENAI_REVIEWER_MODE');
    }
  });

  it('is unavailable, never local, when enabled and missing its model', () => {
    const transport = resolveReviewerTransport({ ...PROVIDER_ENV, RELAY_OPENAI_REVIEWER_MODEL: '' });
    expect(transport.kind).toBe('unavailable');
  });

  it('still leaves an unconfigured bridge on the local reviewer', () => {
    expect(resolveReviewerTransport({}).kind).toBe('local');
  });

  it('never reaches the local probe', async () => {
    const localPreflight = vi.fn();
    const result = await reviewerPreflight({
      transport: resolveReviewerTransport(PROVIDER_ENV),
      localConfig,
      localPreflight: localPreflight as unknown as (c: HermesConfig) => HermesPreflightResult,
    });
    expect(localPreflight).not.toHaveBeenCalled();
    expect(result.ready).toBe(true);
    // Configuration presence, and it says so — proving the provider answers
    // costs a paid call.
    expect(result.reason).toContain('proven by the first review');
  });

  it('makes no network call to decide readiness', async () => {
    const fetchImpl = vi.fn();
    await reviewerPreflight({
      transport: resolveReviewerTransport(PROVIDER_ENV),
      localConfig,
      localPreflight: (() => ({ ready: false })) as unknown as (c: HermesConfig) => HermesPreflightResult,
      deps: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
