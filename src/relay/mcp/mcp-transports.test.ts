import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { McpRegistryEntryId, McpServerDefinitionId } from '../protocol/ids';
import { MCP_BASELINE_PROTOCOL_REVISION } from './domain/mcp-protocol';
import { CONSEQUENTIAL_DETAIL, mcpFailure, preferredFailure } from './domain/mcp-failure';
import type { McpTransportOpenRequest } from './domain/mcp-ports';
import {
  MCP_DEFAULT_NETWORK_POLICY, MCP_LOOPBACK_TEST_NETWORK_POLICY,
} from './policy/mcp-network-policy';
import type { McpRegistryEntry } from './registry/mcp-registry-types';
import {
  createFakeExecutableShims, fixedResolver, installNoExternalNetworkGuard,
  loopbackOnlyResolver, startFakeHttpMcpServer, type FakeHttpServerHandle,
} from './testing/fake-mcp-harness';
import {
  buildChildEnvironment, MCP_ALLOWED_STDIO_EXECUTABLES, planStdioLaunch,
} from './transports/stdio-launch-policy';
import { McpStdioTransportFactory } from './transports/stdio-transport';
import { McpStreamableHttpTransportFactory } from './transports/streamable-http-transport';

/* ------------------------------------------------------------------ *
 * Registry entries for the fixture servers.
 * ------------------------------------------------------------------ */

const stdioEntry = (overrides: Partial<McpRegistryEntry> = {}): McpRegistryEntry => ({
  registryEntryId: 'mrg_test_stdio' as McpRegistryEntryId,
  serverDefinitionId: 'msd_test_stdio' as McpServerDefinitionId,
  displayName: 'Fixture stdio server',
  category: 'filesystem_repository',
  state: 'approved',
  expectedServerName: 'relay-fixture-repository',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-repository',
    fixedArguments: [],
    argumentAllowlist: [],
    environmentAllowlist: ['RELAY_FIXTURE_SCENARIO'],
    workspaceRootBehavior: 'isolated_temp',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {},
  maximumRiskClass: 'read_only',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: '2026-08-02T00:00:00.000Z',
  securityReviewer: 'relay-founder',
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: [],
  ...overrides,
});

const httpEntry = (url: string, overrides: Partial<McpRegistryEntry> = {}): McpRegistryEntry => ({
  ...stdioEntry(),
  registryEntryId: 'mrg_test_http' as McpRegistryEntryId,
  displayName: 'Fixture HTTP server',
  transport: 'streamable_http',
  stdio: null,
  http: { url, expectedOrigin: new URL(url).origin, allowsPlainHttp: true },
  ...overrides,
});

const openRequest = (registryEntryId: string): McpTransportOpenRequest => ({
  connectionId: 'mcn_test0001',
  registryEntryId,
  requestedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
  clientName: 'relay-test',
  clientVersion: '0.0.0',
  connectTimeoutMs: 30_000,
  resolvedCredential: null,
});

const shims = createFakeExecutableShims([...MCP_ALLOWED_STDIO_EXECUTABLES]);

const stdioFactory = (scenario: string, registry: readonly McpRegistryEntry[]) =>
  new McpStdioTransportFactory({
    registry,
    resolveExecutable: shims.resolve,
    approvedFilesystemRoots: [],
    workspaceRoot: null,
    relaySuppliedEnvironment: { RELAY_FIXTURE_SCENARIO: scenario },
    terminationGraceMs: 300,
  });

const openHandles: Array<{ close: () => Promise<void> }> = [];
const httpHandles: FakeHttpServerHandle[] = [];

afterEach(async () => {
  await Promise.all(openHandles.splice(0).map((h) => h.close().catch(() => undefined)));
  await Promise.all(httpHandles.splice(0).map((h) => h.close().catch(() => undefined)));
});

const processAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/* ==================================================================== *
 * LAUNCH POLICY — pure, no process
 * ==================================================================== */

describe('stdio launch policy', () => {
  const definition = stdioEntry().stdio!;

  const plan = (overrides: Partial<Parameters<typeof planStdioLaunch>[0]> = {}) => planStdioLaunch({
    definition,
    additionalArguments: [],
    credentialEnvironment: {},
    relaySuppliedEnvironment: { RELAY_FIXTURE_SCENARIO: 'clean_read_only' },
    cwd: '/tmp/isolated',
    startupTimeoutMs: 5_000,
    approvedFilesystemRoots: [],
    ...overrides,
  });

  it('permits an allowlisted executable', () => {
    expect(plan().allowed).toBe(true);
  });

  it('REFUSES an executable that is not allowlisted', () => {
    const decision = plan({ definition: { ...definition, executable: 'curl' } });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.category).toBe('executable_not_allowed');
  });

  it('REFUSES a path as an executable, absolute or relative', () => {
    for (const executable of ['/usr/bin/node', './server', '../server', 'C:\\node.exe']) {
      const decision = plan({ definition: { ...definition, executable } });
      expect(decision.allowed, executable).toBe(false);
      expect(!decision.allowed && decision.reason).toContain('NAME');
    }
  });

  it('REFUSES an argument that is not on the entry allowlist', () => {
    const decision = plan({ additionalArguments: ['--allow-everything'] });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.category).toBe('argument_not_allowed');
  });

  it('REFUSES an argument carrying shell metacharacters', () => {
    const permissive = { ...definition, argumentAllowlist: ['--x=*'] };
    for (const argument of ['--x=a;rm -rf /', '--x=`id`', '--x=$(id)', '--x=a|b', '--x=a>b']) {
      const decision = plan({ definition: permissive, additionalArguments: [argument] });
      expect(decision.allowed, argument).toBe(false);
    }
  });

  it('REFUSES a working directory outside every approved root', () => {
    const decision = plan({ cwd: '/etc', approvedFilesystemRoots: ['/srv/workspaces'] });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.category).toBe('environment_not_allowed');
  });

  it('REFUSES an environment variable the entry does not allowlist', () => {
    const decision = plan({ relaySuppliedEnvironment: { PATH: '/usr/bin' } });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.reason).toContain('allowlist');
  });
});

describe('the child environment is built FROM EMPTY', () => {
  it('contains only what was allowlisted AND supplied', () => {
    const result = buildChildEnvironment({
      allowlist: ['RELAY_FIXTURE_SCENARIO'],
      credentialEnvironment: {},
      relaySuppliedEnvironment: { RELAY_FIXTURE_SCENARIO: 'clean_read_only' },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.env)).toEqual(['RELAY_FIXTURE_SCENARIO']);
  });

  it('never inherits PATH, HOME, or anything else from the parent', () => {
    const result = buildChildEnvironment({
      allowlist: ['RELAY_FIXTURE_SCENARIO'],
      credentialEnvironment: {},
      relaySuppliedEnvironment: {},
    });
    expect(result.ok && Object.keys(result.env)).toEqual([]);
  });

  it('REFUSES a Relay-supplied variable whose name matches a never-forward pattern', () => {
    const result = buildChildEnvironment({
      allowlist: ['GITHUB_TOKEN'],
      credentialEnvironment: {},
      relaySuppliedEnvironment: { GITHUB_TOKEN: 'leaked-from-parent' },
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('never-forwarded');
  });

  it('PERMITS a credential-resolver variable with a secret-shaped name — that is what it is', () => {
    const result = buildChildEnvironment({
      allowlist: ['GITHUB_TOKEN'],
      credentialEnvironment: { GITHUB_TOKEN: 'resolved-server-side' },
      relaySuppliedEnvironment: {},
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.env.GITHUB_TOKEN).toBe('resolved-server-side');
  });
});

/* ==================================================================== *
 * STDIO — REAL SPAWNED PROCESSES
 * ==================================================================== */

describe('which fatal condition describes what happened', () => {
  const pipe = (): ReturnType<typeof mcpFailure> => mcpFailure(
    'process_exited_early', 'the MCP server closed its input',
    { details: [CONSEQUENTIAL_DETAIL] },
  );

  it('lets whatever the process reports replace the pipe error it caused', () => {
    // THE ORDER THESE ARRIVE IN IS NOT THE ORDER THEY ARE CAUSED IN. A server
    // dying mid-write emits the broken pipe BEFORE `exit` — measured 5 of 5 —
    // so first-wins alone latched the consequence and discarded what the exit
    // knew. Both halves matter: a SIGNAL and a plain exit CODE.
    const crash = mcpFailure('process_crashed', 'terminated by SIGSEGV');
    expect(preferredFailure(pipe(), crash)).toBe(crash);
    const exited = mcpFailure('process_exited_early', 'exited with code 1');
    // Same category as the consequence, and still the better answer — an
    // earlier rule replaced only a crash and lost this one.
    expect(preferredFailure(pipe(), exited)).toBe(exited);
    expect(preferredFailure(null, crash)).toBe(crash);
  });

  it('never lets an unmarked cause be overwritten', () => {
    const crash = mcpFailure('process_crashed', 'terminated by SIGSEGV');
    // A crash is a cause; a pipe error arriving after it is its consequence.
    expect(preferredFailure(crash, pipe())).toBe(crash);
    expect(preferredFailure(crash, mcpFailure('internal_error', 'later noise'))).toBe(crash);
    // An UNMARKED early exit is an observation, not a consequence, so it holds.
    const plain = mcpFailure('process_exited_early', 'exited with code 1');
    expect(preferredFailure(plain, mcpFailure('internal_error', 'later noise'))).toBe(plain);
  });
});

describe('stdio transport against a real child process', () => {
  it('the executable shims exist and resolve', () => {
    expect(existsSync(shims.directory)).toBe(true);
    expect(shims.resolve('relay-fixture-repository')).not.toBeNull();
    expect(shims.resolve('not-allowlisted')).toBeNull();
  });

  it('starts, negotiates 2025-11-25, declares its identity and lists capabilities', async () => {
    const registry = [stdioEntry()];
    const outcome = await stdioFactory('clean_read_only', registry).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok, outcome.ok ? '' : outcome.failure.message).toBe(true);
    if (!outcome.ok) return;
    openHandles.push(outcome.value);

    expect(outcome.value.session.negotiatedProtocolVersion).toBe('2025-11-25');
    expect(outcome.value.session.declaredIdentity?.name).toBe('relay-fixture-repository');

    const listed = await outcome.value.listCapabilities({ timeoutMs: 10_000 });
    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.value.tools.length).toBeGreaterThan(0);
  }, 40_000);

  it('calls a tool and returns real content', async () => {
    const outcome = await stdioFactory('clean_read_only', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    openHandles.push(outcome.value);

    const result = await outcome.value.callTool('read_file', { path: 'a.ts' }, { timeoutMs: 10_000 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.content[0]?.text).toContain('read');
  }, 40_000);

  it('REFUSES to launch an unallowlisted executable, leaving no process behind', async () => {
    const registry = [stdioEntry({ stdio: { ...stdioEntry().stdio!, executable: 'curl' } })];
    const outcome = await stdioFactory('clean_read_only', registry).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.category).toBe('executable_not_allowed');
  });

  it('classifies a PROTOCOL MISMATCH distinctly from a network or parse failure', async () => {
    const outcome = await stdioFactory('protocol_mismatch', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The SDK refuses the unsupported revision during initialize; Relay's own
    // negotiator refuses it again. Either way it must NOT be malformed_response
    // or server_unreachable.
    expect(['protocol_mismatch', 'initialize_failed', 'internal_error']).toContain(outcome.failure.category);
    expect(outcome.failure.category).not.toBe('malformed_response');
    expect(outcome.failure.category).not.toBe('server_unreachable');
  }, 40_000);

  it('classifies NON-MCP STDOUT distinctly, and never reports it as ready', async () => {
    const outcome = await stdioFactory('malformed_message', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(['non_mcp_stdout', 'malformed_response', 'timed_out', 'process_spawn_failed']).toContain(outcome.failure.category);
  }, 40_000);

  it('a crashed process can never serve a call', async () => {
    const outcome = await stdioFactory('process_crash', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    if (!outcome.ok) {
      // Crashed before the handshake completed — also a truthful outcome. The
      // claim under test is "a crash can never become a COMPLETION", not "the
      // crash always wins the race against the handshake deadline"; on a
      // loaded host the deadline can fire first, and `timed_out` is an equally
      // honest non-completion.
      expect(['process_crashed', 'process_exited_early', 'process_spawn_failed', 'initialize_failed', 'timed_out'])
        .toContain(outcome.failure.category);
      return;
    }
    openHandles.push(outcome.value);
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    const result = await outcome.value.callTool('read_file', { path: 'a.ts' }, { timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && ['process_crashed', 'process_exited_early']).toContain(
      result.ok === false ? result.failure.category : '',
    );
  }, 40_000);

  it('close() terminates the process GROUP and leaves NO ORPHAN', async () => {
    const before = fixtureProcessPids();

    const outcome = await stdioFactory('clean_read_only', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The child is genuinely running — otherwise the teardown assertion below
    // would pass vacuously.
    const during = fixtureProcessPids();
    const spawned = during.filter((pid) => !before.includes(pid));
    expect(spawned.length, 'the fixture child should be running before close()').toBeGreaterThan(0);

    await outcome.value.close();
    await new Promise((resolve) => { setTimeout(resolve, 1_000); });

    for (const pid of spawned) {
      expect(processAlive(pid), `pid ${pid} survived close() — an orphan`).toBe(false);
    }
    expect(fixtureProcessPids().filter((pid) => !before.includes(pid))).toEqual([]);
  }, 40_000);

  it('a per-request timeout is honoured and never becomes a result', async () => {
    const outcome = await stdioFactory('timeout', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    openHandles.push(outcome.value);

    const result = await outcome.value.callTool('read_file', { path: 'a.ts' }, { timeoutMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.category).toBe('timed_out');
  }, 40_000);

  it('cancellation is honoured and never becomes a result', async () => {
    const outcome = await stdioFactory('timeout', [stdioEntry()]).open(openRequest('mrg_test_stdio'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    openHandles.push(outcome.value);

    const controller = new AbortController();
    const pending = outcome.value.callTool('read_file', { path: 'a.ts' }, { timeoutMs: 10_000, signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.ok === false && ['cancelled', 'timed_out']).toContain(result.ok === false ? result.failure.category : '');
  }, 40_000);
});

/**
 * Every live pid whose command line names a fixture shim.
 *
 * The orphan assertion runs against the PROCESS TABLE rather than a pid the
 * transport handed back, for two reasons: a pid is host topology and is
 * deliberately absent from `McpClientPort`, and a leaked handle would only
 * prove the DIRECT child died. Scanning catches a helper the server itself
 * spawned, which is the orphan that actually survives a naive kill.
 *
 * Linux-only by construction; the guard below skips cleanly elsewhere rather
 * than asserting something it cannot observe.
 */
function fixtureProcessPids(): number[] {
  if (!existsSync('/proc')) return [];
  const pids: number[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmdline = readFileSync(join('/proc', name, 'cmdline'), 'utf8');
      if (cmdline.includes(shims.directory)) pids.push(Number(name));
    } catch {
      // The process exited between listing and reading — not our child's problem.
    }
  }
  return pids;
}

/* ==================================================================== *
 * STREAMABLE HTTP — REAL LOOPBACK SERVER
 * ==================================================================== */

describe('Streamable HTTP transport against a real loopback server', () => {
  it('connects, negotiates and lists capabilities over an ephemeral loopback port', async () => {
    const server = await startFakeHttpMcpServer({ scenario: 'clean_read_only' });
    httpHandles.push(server);

    const factory = new McpStreamableHttpTransportFactory({
      registry: [httpEntry(server.url)],
      policy: MCP_LOOPBACK_TEST_NETWORK_POLICY,
      resolver: loopbackOnlyResolver,
    });
    const outcome = await factory.open(openRequest('mrg_test_http'));
    expect(outcome.ok, outcome.ok ? '' : outcome.failure.message).toBe(true);
    if (!outcome.ok) return;
    openHandles.push(outcome.value);

    expect(outcome.value.session.negotiatedProtocolVersion).toBe('2025-11-25');
    const listed = await outcome.value.listCapabilities({ timeoutMs: 10_000 });
    expect(listed.ok).toBe(true);
  }, 40_000);

  it('classifies an HTTP AUTH FAILURE distinctly from a network failure', async () => {
    const server = await startFakeHttpMcpServer({
      scenario: 'clean_read_only',
      requireAuthorization: 'Bearer the-right-one',
    });
    httpHandles.push(server);

    const factory = new McpStreamableHttpTransportFactory({
      registry: [httpEntry(server.url)],
      policy: MCP_LOOPBACK_TEST_NETWORK_POLICY,
      resolver: loopbackOnlyResolver,
    });
    const outcome = await factory.open(openRequest('mrg_test_http'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('authentication_failed');
    expect(outcome.failure.category).not.toBe('server_unreachable');
    expect(server.requestCount()).toBeGreaterThan(0);
  }, 40_000);

  it('REFUSES a non-loopback endpoint under the default policy, with ZERO requests made', async () => {
    const factory = new McpStreamableHttpTransportFactory({
      registry: [httpEntry('https://mcp.example.com/mcp', {
        http: { url: 'https://mcp.example.com/mcp', expectedOrigin: 'https://mcp.example.com', allowsPlainHttp: false },
      })],
      policy: MCP_DEFAULT_NETWORK_POLICY,
      // Resolves to cloud metadata — the SSRF case a hostname check misses.
      resolver: fixedResolver({ 'mcp.example.com': ['169.254.169.254'] }),
    });
    const guard = installNoExternalNetworkGuard();
    try {
      const outcome = await factory.open(openRequest('mrg_test_http'));
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.failure.category).toBe('network_policy_blocked');
      expect(guard.externalAttempts()).toEqual([]);
    } finally {
      guard.restore();
    }
  }, 20_000);

  it('REFUSES a plain-HTTP endpoint under the default policy before any request', async () => {
    const factory = new McpStreamableHttpTransportFactory({
      registry: [httpEntry('http://mcp.example.com/mcp', {
        http: { url: 'http://mcp.example.com/mcp', expectedOrigin: 'http://mcp.example.com', allowsPlainHttp: false },
      })],
      policy: MCP_DEFAULT_NETWORK_POLICY,
      resolver: loopbackOnlyResolver,
    });
    const outcome = await factory.open(openRequest('mrg_test_http'));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.category).toBe('network_policy_blocked');
  });

  it('REFUSES a redirect that leaves the approved origin for a blocked destination', async () => {
    const server = await startFakeHttpMcpServer({
      scenario: 'clean_read_only',
      redirectTo: 'http://169.254.169.254/latest/meta-data/',
    });
    httpHandles.push(server);

    const factory = new McpStreamableHttpTransportFactory({
      registry: [httpEntry(server.url)],
      policy: MCP_LOOPBACK_TEST_NETWORK_POLICY,
      resolver: loopbackOnlyResolver,
    });
    const outcome = await factory.open(openRequest('mrg_test_http'));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.category).toBe('network_policy_blocked');
  }, 40_000);
});

/* ==================================================================== *
 * THE OFFLINE GUARANTEE
 * ==================================================================== */

describe('the suite makes no external call', () => {
  it('an external fetch FAILS rather than succeeding quietly', async () => {
    const guard = installNoExternalNetworkGuard();
    try {
      await expect(fetch('https://example.com/')).rejects.toThrow(/RELAY TEST GUARD/);
      expect(guard.externalAttempts()).toHaveLength(1);
    } finally {
      guard.restore();
    }
  });

  it('an external DNS resolution FAILS', async () => {
    await expect(loopbackOnlyResolver.resolve('example.com')).rejects.toThrow(/RELAY TEST GUARD/);
  });
});
