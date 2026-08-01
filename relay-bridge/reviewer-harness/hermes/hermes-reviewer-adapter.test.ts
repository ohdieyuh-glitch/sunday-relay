import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DISABLED_TOOLSETS, MINIMUM_HERMES_VERSION, WRITE_CAPABLE_TOOLSETS,
  buildHermesArgs, createIsolatedProfile, createProbe, discoverHermes,
  isolatedChildEnv, isolatedConfigYaml, loadXaiConfig, localReadiness,
  modelMatchesVerified, parseModelList, parseUsageFile, runHermesReviewer,
  unknownToolsets, verifiedReadiness, verifyXaiModel, versionAtLeast,
  XAI_API_KEY_ENV, XAI_DEFAULT_BASE_URL,
} from './index';
import { writeFakeHermes, writeFakeHermesProbe } from './fake-executable';
import { assessHarnessReadiness, effectiveCatalogEntry } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import { findCatalogEntry, harnessIsSelectableForRun } from '../../../src/relay/mission/reviewer-harness';

/**
 * THE HERMES ADAPTER, EXERCISED AS A PROCESS.
 *
 * The fake Hermes is a real executable spawned by the real runner, so argv,
 * the environment allowlist, the output cap, the usage file, cancellation and
 * process-group termination are all genuinely under test. A test that mocked
 * the adapter would prove none of them.
 *
 * NOTHING HERE CONTACTS A PROVIDER. `verifyXaiModel` is always given an
 * injected fetch, and the fake executable opens no socket.
 */

const dirs: string[] = [];
const workdir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'relay-hermes-test-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const hermesEntry = () => {
  const e = findCatalogEntry('hermes');
  if (e === null) throw new Error('the canonical Hermes catalog entry is missing');
  return e;
};

const FULL_FLAGS = ['-z', '--usage-file', '-t', '--ignore-rules', '--safe-mode'] as const;

const probeFor = (dir: string, opts?: { version?: string; flags?: readonly string[]; acpOk?: boolean }) => {
  const bin = writeFakeHermesProbe(join(dir, 'hermes-probe.cjs'), {
    version: opts?.version ?? '0.18.2',
    flags: opts?.flags ?? FULL_FLAGS,
    acpOk: opts?.acpOk ?? true,
  });
  return { bin, probe: createProbe(dir) };
};

/* ------------------------------------------------------------ discovery */

describe('discovery reports what is installed, and nothing more', () => {
  it('reports not installed when no binary answers', () => {
    const dir = workdir();
    const d = discoverHermes({ executable: join(dir, 'absent'), probe: createProbe(dir) });
    expect(d.installed).toBe(false);
    expect(d.compatible).toBe(false);
    expect(d.machineInterfaceVerified).toBe(false);
    expect(d.failureReason).toContain('No Hermes runtime was found');
  });

  it('reports an incompatible version rather than attempting it', () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir, { version: '0.9.0' });
    const d = discoverHermes({ executable: bin, probe });
    expect(d.installed).toBe(true);
    expect(d.version).toBe('0.9.0');
    expect(d.compatible).toBe(false);
    expect(d.machineInterfaceVerified).toBe(false);
    expect(d.failureReason).toContain(MINIMUM_HERMES_VERSION);
  });

  it('selects the one-shot transport only when every required flag exists', () => {
    const dir = workdir();
    const partial = probeFor(dir, { flags: ['-z'] });
    const d = discoverHermes({ executable: partial.bin, probe: partial.probe });
    expect(d.installed).toBe(true);
    expect(d.machineInterface).toBeNull();
    expect(d.missingFlags).toContain('--usage-file');
    expect(d.failureReason).toContain('--usage-file');
  });

  it('verifies the interface on a supported build', () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const d = discoverHermes({ executable: bin, probe });
    expect(d.installed).toBe(true);
    expect(d.compatible).toBe(true);
    expect(d.machineInterface).toBe('oneshot_json');
    expect(d.machineInterfaceVerified).toBe(true);
    expect(d.readOnlyEnforceable).toBe(true);
    expect(d.acpAvailable).toBe(true);
    expect(d.failureReason).toBeNull();
  });

  it('an installed binary alone is NOT a connected reviewer', () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const evidence = localReadiness({
      executable: bin, probe,
      xai: { apiKey: null, baseUrl: XAI_DEFAULT_BASE_URL, requestedModel: null, timeoutMs: 1000 },
    });
    expect(evidence.installed).toBe(true);
    // Present binary, but no credential and no verified model.
    expect(evidence.credentialPresent).toBe(false);
    expect(evidence.modelVerified).toBe(false);
    const readiness = assessHarnessReadiness(hermesEntry(), evidence);
    expect(readiness.startable).toBe(false);
    expect(readiness.state).toBe('credentials_missing');
  });

  it('discovery makes no provider request and mutates no global config', () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    discoverHermes({ executable: bin, probe });
    expect(fetchSpy).not.toHaveBeenCalled();
    // The probe env points HOME and HERMES_HOME at the isolated dir, so the
    // operator's own ~/.hermes can never be the target.
    const env = isolatedChildEnv({
      profile: createIsolatedProfile(dir), apiKey: null, apiKeyEnvVar: XAI_API_KEY_ENV,
      baseUrl: null, baseUrlEnvVar: 'XAI_BASE_URL',
    });
    expect(env.HERMES_HOME).toContain('relay-hermes-profile-');
    expect(env.HOME).toBe(env.HERMES_HOME);
  });

  it('parses and compares versions without guessing', () => {
    expect(versionAtLeast('0.18.2', '0.18.0')).toBe(true);
    expect(versionAtLeast('0.18.0', '0.18.0')).toBe(true);
    expect(versionAtLeast('0.17.9', '0.18.0')).toBe(false);
    expect(versionAtLeast(null, '0.18.0')).toBe(false);
    expect(versionAtLeast('not-a-version', '0.18.0')).toBe(false);
  });
});

/* -------------------------------------------------- isolation and tools */

describe('the isolated profile makes read-only structural', () => {
  it('disables every built-in toolset, including every write-capable one', () => {
    const yaml = isolatedConfigYaml();
    for (const toolset of DISABLED_TOOLSETS) expect(yaml).toContain(`- ${toolset}`);
    for (const toolset of WRITE_CAPABLE_TOOLSETS) {
      expect(DISABLED_TOOLSETS, `${toolset} must be disabled`).toContain(toolset);
    }
    // No fallback providers, no MCP servers, no plugins, no hooks.
    expect(yaml).toContain('mcp_servers: {}');
    expect(yaml).toContain('plugins: []');
    expect(yaml).not.toContain('providers:');
    expect(yaml).toContain('max_turns: 1');
  });

  it('inherits no personal memory, skills, SOUL.md or conversations', () => {
    const profile = createIsolatedProfile(workdir());
    // A freshly minted home contains only what Relay put there.
    const yaml = readFileSync(profile.configPath, 'utf8');
    expect(yaml).toContain('disabled_toolsets');
    expect(yaml).toContain('enabled: false');
    for (const name of ['SOUL.md', 'AGENTS.md', 'memories', 'sessions', 'skills']) {
      expect(() => statSync(join(profile.home, name))).toThrow();
    }
    profile.dispose();
  });

  it('creates owner-only directories and config', () => {
    const profile = createIsolatedProfile(workdir());
    expect(statSync(profile.home).mode & 0o777).toBe(0o700);
    expect(statSync(profile.configPath).mode & 0o777).toBe(0o600);
    profile.dispose();
  });

  it('flags a toolset a future Hermes adds that the profile does not disable', () => {
    expect(unknownToolsets([...DISABLED_TOOLSETS])).toEqual([]);
    expect(unknownToolsets([...DISABLED_TOOLSETS, 'brand_new_write_tool']))
      .toEqual(['brand_new_write_tool']);
  });

  it('builds an allowlisted child environment, never a copy of the parent', () => {
    const profile = createIsolatedProfile(workdir());
    process.env.RELAY_TEST_UNRELATED_SECRET = 'must-not-propagate';
    const env = isolatedChildEnv({
      profile, apiKey: 'xai-test-key', apiKeyEnvVar: XAI_API_KEY_ENV,
      baseUrl: null, baseUrlEnvVar: 'XAI_BASE_URL',
    });
    expect(env.RELAY_TEST_UNRELATED_SECRET).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env[XAI_API_KEY_ENV]).toBe('xai-test-key');
    expect(Object.keys(env).sort()).toEqual(
      ['HERMES_HOME', 'HERMES_IGNORE_RULES', 'HOME', 'NO_COLOR', 'PATH', 'TERM', XAI_API_KEY_ENV].sort(),
    );
    delete process.env.RELAY_TEST_UNRELATED_SECRET;
    profile.dispose();
  });
});

/* ------------------------------------------------------ process safety */

describe('the process is launched safely', () => {
  it('passes the prompt as one argv entry and never the credential', () => {
    const args = buildHermesArgs({
      prompt: 'review this; rm -rf / && echo "$(whoami)"',
      model: 'grok-4.5', provider: 'xai', usageFilePath: '/tmp/u.json',
    });
    expect(args[0]).toBe('-z');
    // One argument — not interpolated into a command string.
    expect(args[1]).toBe('review this; rm -rf / && echo "$(whoami)"');
    expect(args.join(' ')).not.toContain('xai-');
    expect(args).not.toContain('--yolo');
    expect(args).toContain('--ignore-rules');
  });

  it('the spawned child receives no credential in argv', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-argv.cjs'), 'echo_argv');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: 'xai-super-secret', baseUrl: null,
      profile: createIsolatedProfile(dir),
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.stdout).not.toContain('xai-super-secret');
    expect(JSON.parse(outcome.stdout)).toContain('--ignore-rules');
  }, 30_000);

  it('the credential reaches the child only through the allowlisted env', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-env.cjs'), 'echo_env');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: 'xai-super-secret', baseUrl: null,
      profile: createIsolatedProfile(dir),
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    const env = JSON.parse(outcome.stdout) as Record<string, string>;
    expect(env[XAI_API_KEY_ENV]).toBe('xai-super-secret');
    expect(env.HERMES_HOME).toContain('relay-hermes-profile-');
    expect(env.PATH).toBeDefined();
    // Nothing else from the parent process came along.
    expect(Object.keys(env).length).toBeLessThanOrEqual(8);
  }, 30_000);

  it('caps stdout instead of buffering without bound', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-flood.cjs'), 'flood');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
      limits: { timeoutMs: 20_000, maxOutputBytes: 8_192, maxTurns: 1, maxPromptBytes: 1024 },
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.stdout).toContain('[output truncated at limit]');
    expect(outcome.stdout.length).toBeLessThan(64 * 1024);
  }, 30_000);

  it('a timeout terminates the process tree and is never a completion', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-hang.cjs'), 'hang');
    const started = Date.now();
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
      limits: { timeoutMs: 1_200, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 1024 },
    });
    expect(outcome.kind).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it('cancellation reports cancelled, never completed', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-hang2.cjs'), 'hang');
    const controller = new AbortController();
    const promise = runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 400);
    const outcome = await promise;
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind !== 'cancelled') return;
    expect(outcome.safeMessage).toContain('preserved');
  }, 30_000);

  it('a non-zero exit is a failure, not a verdict', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-crash.cjs'), 'crash');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.exitCode).toBe(3);
    // stderr is never surfaced verbatim.
    expect(outcome.safeMessage).not.toContain('boom');
  }, 30_000);

  it('blocks oversized evidence rather than silently truncating it', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-clean.cjs'), 'clean');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'x'.repeat(5_000), model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
      limits: { timeoutMs: 10_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 1_000 },
    });
    expect(outcome.kind).toBe('launch_failed');
    if (outcome.kind !== 'launch_failed') return;
    expect(outcome.safeMessage).toContain('exceeds the configured input limit');
  }, 30_000);
});

/* ----------------------------------------------------------- usage */

describe('usage is reported or Unknown, never zero', () => {
  it('reads the harness usage report from a real run', async () => {
    const dir = workdir();
    const bin = writeFakeHermes(join(dir, 'hermes-clean2.cjs'), 'clean');
    const outcome = await runHermesReviewer({
      executable: bin, prompt: 'p', model: 'grok-4.5', provider: 'xai',
      apiKey: null, baseUrl: null, profile: createIsolatedProfile(dir),
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.usage.source).toBe('harness_reported');
    expect(outcome.usage.totalTokens).toBe(1540);
    expect(outcome.usage.model).toBe('grok-4.5');
    expect(outcome.usage.costMicros).toBe('4200');
  }, 30_000);

  it('a missing or malformed usage report is Unknown, not zero', () => {
    const dir = workdir();
    const absent = parseUsageFile(join(dir, 'nope.json'));
    expect(absent.totalTokens).toBeNull();
    expect(absent.source).toBe('unavailable');
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, 'not json');
    expect(parseUsageFile(bad).source).toBe('unavailable');
    expect(parseUsageFile(bad).inputTokens).toBeNull();
  });
});

/* --------------------------------------------------- model identity */

describe('the model is verified against the authenticated account', () => {
  const cfg = (model: string | null, key: string | null = 'xai-key') => ({
    apiKey: key, baseUrl: XAI_DEFAULT_BASE_URL, requestedModel: model, timeoutMs: 5_000,
  });
  const listing = (ids: string[]) => vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id, owned_by: 'xai' })) }),
  }));

  it('verifies a model the account can actually use', async () => {
    const fetchImpl = listing(['grok-4.5', 'grok-3']);
    const r = await verifyXaiModel({ config: cfg('grok-4.5'), fetchImpl: fetchImpl as never });
    expect(r.kind).toBe('verified');
    if (r.kind !== 'verified') return;
    expect(r.verifiedModelId).toBe('grok-4.5');
  });

  it('blocks an unavailable model and never substitutes another', async () => {
    const fetchImpl = listing(['grok-3', 'grok-2']);
    const r = await verifyXaiModel({ config: cfg('grok-4.5'), fetchImpl: fetchImpl as never });
    expect(r.kind).toBe('model_unavailable');
    if (r.kind !== 'model_unavailable') return;
    expect(r.safeMessage).toContain('does not substitute');
    // The available list is recorded, but nothing was chosen from it.
    expect(r.availableModels).toContain('grok-3');
  });

  it('refuses to pick a model when none is configured', async () => {
    const r = await verifyXaiModel({ config: cfg(null), fetchImpl: listing(['grok-4.5']) as never });
    expect(r.kind).toBe('unreachable');
    if (r.kind !== 'unreachable') return;
    expect(r.safeMessage).toContain('will not choose one');
  });

  it('reports a missing credential without contacting the provider', async () => {
    const fetchImpl = vi.fn();
    const r = await verifyXaiModel({ config: cfg('grok-4.5', null), fetchImpl: fetchImpl as never });
    expect(r.kind).toBe('credentials_missing');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sanitises a provider rejection to a status, never a body', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 401,
      json: async () => ({ error: 'invalid api key xai-leaked-value' }),
    }));
    const r = await verifyXaiModel({ config: cfg('grok-4.5'), fetchImpl: fetchImpl as never });
    expect(r.kind).toBe('unreachable');
    if (r.kind !== 'unreachable') return;
    expect(r.safeMessage).toContain('HTTP 401');
    expect(r.safeMessage).not.toContain('xai-leaked-value');
  });

  it('sends the credential only in the Authorization header', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'grok-4.5' }] }) };
    });
    await verifyXaiModel({ config: cfg('grok-4.5'), fetchImpl: fetchImpl as never });
    expect(seen[0].url).toBe('https://api.x.ai/v1/models');
    expect(seen[0].headers.Authorization).toBe('Bearer xai-key');
    expect(seen[0].url).not.toContain('xai-key');
  });

  it('a runtime model mismatch invalidates the run', () => {
    expect(modelMatchesVerified('grok-4.5', 'grok-4.5').ok).toBe(true);
    // Unknown stays Unknown — it is not a mismatch.
    expect(modelMatchesVerified('grok-4.5', null).ok).toBe(true);
    const bad = modelMatchesVerified('grok-4.5', 'grok-3');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('invalidated the run');
  });

  it('parses only well-formed model records', () => {
    expect(parseModelList({ data: [{ id: 'grok-4.5' }, { id: '' }, null, 7] })
      .map((m) => m.id)).toEqual(['grok-4.5']);
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
  });

  it('reads the credential from the server environment only', () => {
    const c = loadXaiConfig({ XAI_API_KEY: ' key ', RELAY_REVIEWER_MODEL: 'grok-4.5' } as NodeJS.ProcessEnv);
    expect(c.apiKey).toBe('key');
    expect(c.baseUrl).toBe(XAI_DEFAULT_BASE_URL);
    expect(loadXaiConfig({} as NodeJS.ProcessEnv).apiKey).toBeNull();
    // An operator may override the base URL; the default is xAI.
    expect(loadXaiConfig({ XAI_BASE_URL: 'https://proxy.internal/v1' } as NodeJS.ProcessEnv).baseUrl)
      .toBe('https://proxy.internal/v1');
  });
});

/* ------------------------------------------------------- readiness gate */

describe('readiness never upgrades itself', () => {
  const xaiCfg = (key: string | null, model: string | null) => ({
    apiKey: key, baseUrl: XAI_DEFAULT_BASE_URL, requestedModel: model, timeoutMs: 5_000,
  });

  it('local readiness contacts no provider and never claims a verified model', async () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const evidence = localReadiness({ executable: bin, probe, xai: xaiCfg('xai-key', 'grok-4.5') });
    expect(evidence.credentialPresent).toBe(true);
    expect(evidence.modelVerified).toBe(false);
    expect(evidence.verifiedModelId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assessHarnessReadiness(hermesEntry(), evidence).state).toBe('model_unverified');
  });

  it('does not contact the provider when a local requirement already failed', async () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir, { version: '0.1.0' });
    const fetchImpl = vi.fn();
    const r = await verifiedReadiness({
      executable: bin, probe, xai: xaiCfg('xai-key', 'grok-4.5'), fetchImpl: fetchImpl as never,
    });
    expect(r.providerRequestMade).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(assessHarnessReadiness(hermesEntry(), r.evidence).state).toBe('incompatible');
  });

  it('reaches ready only when every requirement is proven', async () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ data: [{ id: 'grok-4.5' }] }),
    }));
    const r = await verifiedReadiness({
      executable: bin, probe, xai: xaiCfg('xai-key', 'grok-4.5'), fetchImpl: fetchImpl as never,
    });
    expect(r.providerRequestMade).toBe(true);
    expect(r.evidence.modelVerified).toBe(true);
    expect(r.evidence.verifiedModelId).toBe('grok-4.5');
    const readiness = assessHarnessReadiness(hermesEntry(), r.evidence);
    expect(readiness.state).toBe('ready');
    expect(readiness.startable).toBe(true);
    // Ready is still not authorization.
    expect(readiness.reason).toContain('explicit authorization');
  });

  it('an unavailable model leaves the harness unstartable', async () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ data: [{ id: 'grok-3' }] }),
    }));
    const r = await verifiedReadiness({
      executable: bin, probe, xai: xaiCfg('xai-key', 'grok-4.5'), fetchImpl: fetchImpl as never,
    });
    expect(r.evidence.modelVerified).toBe(false);
    const readiness = assessHarnessReadiness(hermesEntry(), r.evidence);
    expect(readiness.startable).toBe(false);
    expect(readiness.state).toBe('model_unverified');
  });

  it('the effective entry only ever changes the two runtime-knowable fields', async () => {
    const dir = workdir();
    const { bin, probe } = probeFor(dir);
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ data: [{ id: 'grok-4.5' }] }),
    }));
    const r = await verifiedReadiness({
      executable: bin, probe, xai: xaiCfg('xai-key', 'grok-4.5'), fetchImpl: fetchImpl as never,
    });
    const base = hermesEntry();
    const effective = effectiveCatalogEntry(base, r.evidence);
    expect(effective.installState).toBe('installed');
    expect(effective.readOnlyReviewSupported).toBe('yes');
    // Name, maturity and capabilities are untouched by a probe.
    expect(effective.name).toBe(base.name);
    expect(effective.integrationStatus).toBe(base.integrationStatus);
    expect(effective.capabilities).toEqual(base.capabilities);
    expect(harnessIsSelectableForRun(effective)).toBe(true);
    // Without evidence the canonical rule still says no.
    expect(harnessIsSelectableForRun(base)).toBe(false);
  });
});
