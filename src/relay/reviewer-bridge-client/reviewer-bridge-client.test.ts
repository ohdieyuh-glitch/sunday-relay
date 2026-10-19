import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_TOKEN_ENV, BRIDGE_URL_ENV, createReviewerBridgeClient, isConfigurationError,
  isLoopbackHost, redactBridgeSecrets, resolveBridgeTarget, resolveBridgeToken,
} from './index';
import { startFakeBridge, type FakeBridge } from './fake-bridge';
import { runReviewerBridgeCli, exitCodeForBridgeError } from '../cli/reviewer-bridge-cli';
import { EXIT } from '../cli/exit-codes';

/**
 * THE REVIEWER BRIDGE CLIENT, DRIVEN OVER REAL HTTP.
 *
 * A bearer credential and a remote origin are the two things this layer can
 * get catastrophically wrong, so the tests are built around them: where the
 * token travels, which origins it may travel to, and what happens when a
 * server misbehaves. The client under test is the real one, speaking to a real
 * socket — a stubbed `fetch` would prove none of it.
 */

const TOKEN = 'rlb-test-token-value-0123456789';
const bridges: FakeBridge[] = [];
afterEach(async () => {
  while (bridges.length > 0) {
    const b = bridges.pop();
    if (b !== undefined) await b.close();
  }
});

async function bridge(routes: Record<string, Parameters<typeof startFakeBridge>[0]['routes'][string]>, opts?: { acceptToken?: boolean }) {
  const b = await startFakeBridge({ token: TOKEN, routes, acceptToken: opts?.acceptToken });
  bridges.push(b);
  return b;
}

const clientFor = (url: string, token: string = TOKEN, extra: Record<string, unknown> = {}) => {
  const built = createReviewerBridgeClient({ bridgeUrl: url, token, ...extra });
  if (!built.ok) throw new Error(`client build failed: ${built.error.kind}`);
  return built.value;
};

/* ---------------------------------------------------- URL / TLS policy --- */

describe('the bridge target is validated before any request', () => {
  it('allows loopback over plain HTTP', () => {
    for (const url of ['http://127.0.0.1:7777', 'http://localhost:3000', 'http://[::1]:9000']) {
      const r = resolveBridgeTarget(url);
      expect(r.ok, url).toBe(true);
      if (r.ok) expect(r.value.loopback).toBe(true);
    }
    expect(isLoopbackHost('127.0.0.5')).toBe(true);
    expect(isLoopbackHost('relay.example.com')).toBe(false);
  });

  it('rejects plain HTTP to a remote host — a bearer token must not travel in cleartext', () => {
    const r = resolveBridgeTarget('http://relay.example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('insecure_remote_url');
    expect(r.error.message).toContain('https');
  });

  it('allows HTTPS to a remote host', () => {
    const r = resolveBridgeTarget('https://relay.example.com/bridge/');
    expect(r.ok).toBe(true);
    // Trailing slash normalised away so paths compose predictably.
    if (r.ok) expect(r.value.baseUrl).toBe('https://relay.example.com/bridge');
  });

  it('rejects embedded credentials, odd schemes, queries and nonsense', () => {
    const cases: Array<[string, string]> = [
      ['https://user:pass@relay.example.com', 'invalid_bridge_url'],
      ['ftp://relay.example.com', 'invalid_bridge_url'],
      ['file:///etc/passwd', 'invalid_bridge_url'],
      ['https://relay.example.com?token=abc', 'invalid_bridge_url'],
      ['not-a-url', 'invalid_bridge_url'],
    ];
    for (const [url, kind] of cases) {
      const r = resolveBridgeTarget(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error.kind, url).toBe(kind);
    }
  });

  it('treats an unset bridge as configuration missing, never as localhost', () => {
    for (const value of [undefined, null, '', '   ']) {
      const r = resolveBridgeTarget(value);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('configuration_missing');
        expect(r.error.message).toContain(BRIDGE_URL_ENV);
        // No silent fallback to a local bridge.
        expect(r.error.message).not.toContain('127.0.0.1');
      }
    }
  });

  it('requires a token and names the variable that supplies it', () => {
    const r = resolveBridgeToken('');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('configuration_missing');
      expect(r.error.message).toContain(BRIDGE_TOKEN_ENV);
    }
  });
});

/* ----------------------------------------------------- authentication --- */

describe('the credential travels only in the Authorization header', () => {
  it('sends a bearer header and never puts the token in the URL', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { body: { data: { harness: 'hermes', evidence: {} } } },
    });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(true);
    expect(b.requests).toHaveLength(1);
    expect(b.requests[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(b.requests[0].url).not.toContain(TOKEN);
    expect(b.requests[0].url).toBe('/relay-api/reviewer/readiness');
    expect(b.requests[0].body).not.toContain(TOKEN);
  }, 30_000);

  it('reports a rejected credential without revealing why', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { body: { data: {} } },
    }, { acceptToken: false });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('authentication_failed');
    // The server's own message ("nope") is discarded — silence is the point.
    expect(result.error.message).not.toContain('nope');
    expect(result.error.message).not.toContain(TOKEN);
  }, 30_000);

  it('redacts anything token-shaped from text that came back', () => {
    const text = `failed for Bearer ${TOKEN} using Authorization: ${TOKEN} and xai-abcdefgh12345678`;
    const safe = redactBridgeSecrets(text, TOKEN);
    expect(safe).not.toContain(TOKEN);
    expect(safe).not.toContain('xai-abcdefgh12345678');
    expect(safe).toContain('[redacted]');
  });

  it('never introduces a VITE-prefixed credential name', () => {
    const dir = resolve(__dirname);
    for (const file of ['bridge-client.ts', 'bridge-target.ts', 'bridge-contracts.ts', 'index.ts']) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/VITE_/);
    }
  });
});

/* ---------------------------------------------------------- transport --- */

describe('the transport refuses what it cannot trust', () => {
  it('refuses a redirect rather than forwarding the credential', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': {
        status: 302, headers: { location: 'https://evil.example.com/steal' }, body: {},
      },
    });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_response');
    expect(result.error.message).toContain('redirect');
    // The token reached only the original origin.
    expect(b.requests).toHaveLength(1);
  }, 30_000);

  it('rejects a non-JSON content type', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { rawBody: '<html>hi</html>', contentType: 'text/html' },
    });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_response');
  }, 30_000);

  it('rejects malformed JSON', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { rawBody: '{not json', contentType: 'application/json' },
    });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_response');
  }, 30_000);

  it('rejects an oversized response', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { body: { data: { blob: 'x'.repeat(5000) } } },
    });
    const client = clientFor(b.url, TOKEN, { maxResponseBytes: 512 });
    const result = await client.getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_response');
  }, 30_000);

  it('bounds the request with a timeout', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { delayMs: 3_000, body: { data: {} } },
    });
    const client = clientFor(b.url, TOKEN, { timeoutMs: 300 });
    const started = Date.now();
    const result = await client.getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it('reports an unreachable bridge truthfully', async () => {
    // A port nothing listens on.
    const result = await clientFor('http://127.0.0.1:1').getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unreachable');
      // Crucially NOT "stopped" or "not running".
      expect(result.error.message).not.toMatch(/stopped|not running|completed/i);
    }
  }, 30_000);

  it('requires the data envelope rather than trusting a bare body', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/readiness': { body: { harness: 'hermes' } },
    });
    const result = await clientFor(b.url).getReviewerReadiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_response');
  }, 30_000);

  it('maps the server\'s own error classification', async () => {
    for (const [kind, status] of [['budget_blocked', 402], ['model_unverified', 409],
      ['run_disconnected', 500], ['reviewer_not_ready', 503]] as const) {
      const b = await bridge({
        'GET /relay-api/reviewer/readiness': { status, body: { kind, error: 'server said so' } },
      });
      const result = await clientFor(b.url).getReviewerReadiness();
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.error.kind, kind).toBe(kind);
    }
  }, 30_000);
});

/* --------------------------------------------- CLI over the real client --- */

const io = () => {
  const lines: string[] = [];
  return {
    lines,
    io: { out: (l: string) => lines.push(l), env: {} as Record<string, string | undefined> },
  };
};

describe('the CLI drives the real client', () => {
  it('test-connection reports separate requested and verified identities, and creates no run', async () => {
    const b = await bridge({
      'POST /relay-api/reviewer/test-connection': {
        body: {
          data: {
            harness: 'hermes', evidence: {}, providerRequestMade: true,
            requestedModel: 'grok-4.5', verifiedModelId: null, provider: null,
            checkedAt: '2026-08-01T00:00:00.000Z', connected: false,
            reason: 'No credential is configured on the Relay Bridge.',
          },
        },
      },
    });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'test-connection', missionId: 'm1', json: false, authorize: false,
      client: clientFor(b.url),
    }, h.io);
    const out = h.lines.join('\n');
    expect(code).toBe(EXIT.blocked);
    expect(out).toContain('Requested:    grok-4.5');
    // Verified stays Unknown because the server proved nothing.
    expect(out).toContain('Verified:     Unknown');
    expect(out).toContain('Run created:  no');
    expect(out).not.toContain(TOKEN);
    // Exactly one call, and it was the test-connection route.
    expect(b.requests.map((r) => r.url)).toEqual(['/relay-api/reviewer/test-connection']);
  }, 30_000);

  it('start refuses without explicit authorization and never calls the bridge', async () => {
    const b = await bridge({ 'POST /relay-api/reviewer/start': { body: { data: {} } } });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'start', missionId: 'm1', json: false, authorize: false,
      harness: 'hermes', generation: 'rev-1', idempotencyKey: 'idem-1',
      client: clientFor(b.url),
    }, h.io);
    expect(code).toBe(EXIT.blocked);
    expect(h.lines.join('\n')).toContain('requires --authorize');
    expect(b.requests).toHaveLength(0);
  }, 30_000);

  it('start requires generation, harness and an idempotency key', async () => {
    const b = await bridge({ 'POST /relay-api/reviewer/start': { body: { data: {} } } });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'start', missionId: 'm1', json: false, authorize: true, client: clientFor(b.url),
    }, h.io);
    expect(code).toBe(EXIT.usage);
    const out = h.lines.join('\n');
    expect(out).toContain('--generation');
    expect(out).toContain('--harness');
    expect(out).toContain('--idempotency-key');
    expect(b.requests).toHaveLength(0);
  }, 30_000);

  it('start sends the idempotency key and reports acceptance, not completion', async () => {
    const b = await bridge({
      'POST /relay-api/reviewer/start': {
        body: {
          data: {
            runId: 'run-1', accepted: true, state: 'preparing', missionId: 'm1',
            reviewGeneration: 'rev-1', requestedHarness: 'hermes', requestedModel: null,
            idempotencyKey: 'idem-1', deduplicated: false,
            limits: { timeoutMs: 1000, maxOutputBytes: 10, maxTurns: 1, maxPromptBytes: 10 },
          },
        },
      },
    });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'start', missionId: 'm1', json: true, authorize: true,
      harness: 'hermes', generation: 'rev-1', idempotencyKey: 'idem-1',
      client: clientFor(b.url),
    }, h.io);
    expect(code).toBe(EXIT.completed);
    const payload = JSON.parse(h.lines.join('\n'));
    expect(payload.runId).toBe('run-1');
    expect(payload.completed).toBe(false);
    // Requested and actual stay separate; actual is unknown until it runs.
    expect(payload.requestedHarness).toBe('hermes');
    expect(payload.actualHarness).toBeNull();
    expect(payload.actualModel).toBeNull();
    const sent = JSON.parse(b.requests[0].body);
    expect(sent.idempotencyKey).toBe('idem-1');
    expect(sent.authorized).toBe(true);
    // The CLI never chooses a model.
    expect(sent.requestedModel).toBeNull();
    expect(sent.limits.maxTurns).toBe(1);
  }, 30_000);

  it('a repeated start with the same key maps to one run', async () => {
    const b = await bridge({
      'POST /relay-api/reviewer/start': {
        body: {
          data: {
            runId: 'run-1', accepted: true, state: 'reviewing', missionId: 'm1',
            reviewGeneration: 'rev-1', requestedHarness: 'hermes', requestedModel: null,
            idempotencyKey: 'idem-1', deduplicated: true,
            limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1 },
          },
        },
      },
    });
    const client = clientFor(b.url);
    const runIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const h = io();
      await runReviewerBridgeCli({
        mode: 'start', missionId: 'm1', json: true, authorize: true,
        harness: 'hermes', generation: 'rev-1', idempotencyKey: 'idem-1', client,
      }, h.io);
      runIds.push(JSON.parse(h.lines.join('\n')).runId);
    }
    // The server is the idempotency authority; the CLI just reports one id.
    expect(new Set(runIds).size).toBe(1);
    expect(b.requests.every((r) => JSON.parse(r.body).idempotencyKey === 'idem-1')).toBe(true);
  }, 30_000);

  it('status keeps requested and actual apart and never mutates', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/status/m1': {
        body: {
          data: {
            missionId: 'm1', runId: 'run-1', startedAt: null, completedAt: null,
            limits: null, failureClassification: null, evidence: null,
            view: {
              connectionState: 'reviewing', connectionLabel: 'Reviewing',
              harnessLabel: 'Unknown', requestedHarnessLabel: 'hermes',
              modelLabel: 'Unknown', requestedModelLabel: 'grok-4.5',
              providerLabel: 'Unknown', independenceLabel: 'Unknown', usageLabel: 'Unknown',
            },
          },
        },
      },
    });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'status', missionId: 'm1', json: false, authorize: false, client: clientFor(b.url),
    }, h.io);
    expect(code).toBe(EXIT.completed);
    const out = h.lines.join('\n');
    expect(out).toContain('Harness:      Unknown (requested hermes)');
    expect(out).toContain('Model:        Unknown (requested grok-4.5)');
    expect(out).toContain('Usage:        Unknown');
    // Read-only: one GET, no POST anywhere.
    expect(b.requests.map((r) => r.method)).toEqual(['GET']);
  }, 30_000);

  it('an unreachable bridge is not reported as a stopped reviewer', async () => {
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'status', missionId: 'm1', json: false, authorize: false,
      client: clientFor('http://127.0.0.1:1'),
    }, h.io);
    const out = h.lines.join('\n');
    expect(code).toBe(EXIT.blocked);
    expect(out).toContain('unreachable');
    expect(out).not.toMatch(/Stopped|not running|Completed/);
  }, 30_000);

  it('stop is idempotent, preserves findings and never completes the run', async () => {
    const b = await bridge({
      'POST /relay-api/reviewer/stop/m1': {
        body: {
          data: {
            missionId: 'm1', runId: 'run-1', cancellationRequested: true,
            cancellationConfirmed: false, state: 'stopping', findingsPreserved: 2,
            message: 'Stop requested. Findings and evidence are preserved.',
          },
        },
      },
    });
    const client = clientFor(b.url);
    for (let i = 0; i < 3; i += 1) {
      const h = io();
      const code = await runReviewerBridgeCli({
        mode: 'stop', missionId: 'm1', json: true, authorize: false, client,
      }, h.io);
      expect(code).toBe(EXIT.completed);
      const payload = JSON.parse(h.lines.join('\n'));
      expect(payload.completed).toBe(false);
      expect(payload.cancellationConfirmed).toBe(false);
      expect(payload.findingsPreserved).toBe(2);
    }
    expect(b.requests).toHaveLength(3);
  }, 30_000);

  it('retry needs fresh authorization, a prior run and a new key', async () => {
    const b = await bridge({
      'POST /relay-api/reviewer/retry': {
        body: {
          data: {
            missionId: 'm1', priorRunId: 'run-1', runId: 'run-2', idempotencyKey: 'idem-2',
            state: 'preparing', preservedFindings: 3,
            requestedHarness: 'hermes', requestedModel: 'grok-4.5',
          },
        },
      },
    });
    const client = clientFor(b.url);

    const noAuth = io();
    expect(await runReviewerBridgeCli({
      mode: 'retry', missionId: 'm1', json: false, authorize: false,
      priorRun: 'run-1', idempotencyKey: 'idem-2', client,
    }, noAuth.io)).toBe(EXIT.blocked);
    expect(noAuth.lines.join('\n')).toContain('fresh --authorize');
    expect(b.requests).toHaveLength(0);

    const h = io();
    expect(await runReviewerBridgeCli({
      mode: 'retry', missionId: 'm1', json: true, authorize: true,
      priorRun: 'run-1', idempotencyKey: 'idem-2', client,
    }, h.io)).toBe(EXIT.completed);
    const payload = JSON.parse(h.lines.join('\n'));
    // A new run id, and the prior one is still named.
    expect(payload.runId).toBe('run-2');
    expect(payload.priorRunId).toBe('run-1');
    expect(payload.idempotencyKey).toBe('idem-2');
    expect(payload.preservedFindings).toBe(3);
    expect(payload.completed).toBe(false);
  }, 30_000);

  it('inspect shows validated findings without printing secrets', async () => {
    const b = await bridge({
      'GET /relay-api/reviewer/inspect/m1': {
        body: {
          data: {
            missionId: 'm1', runId: 'run-1', startedAt: null, completedAt: null,
            limits: null, failureClassification: null, evidence: null,
            proposedVerdict: 'needs_changes', validatedVerdict: null,
            independenceLabel: 'Unknown', independenceReasons: ['no identity evidence'],
            toolUseEvidence: [], stopReason: null,
            findings: [{
              findingId: 'F-1', severity: 'blocking', title: 'inverted guard',
              file: 'src/a.ts', line: 12, blocking: true,
            }],
            view: {
              connectionState: 'completed', connectionLabel: 'Completed',
              harnessLabel: 'Unknown', requestedHarnessLabel: 'hermes',
              modelLabel: 'Unknown', requestedModelLabel: 'grok-4.5',
              providerLabel: 'Unknown', independenceLabel: 'Unknown', usageLabel: 'Unknown',
            },
          },
        },
      },
    });
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'inspect', missionId: 'm1', json: false, authorize: false, client: clientFor(b.url),
    }, h.io);
    expect(code).toBe(EXIT.completed);
    const out = h.lines.join('\n');
    expect(out).toContain('F-1');
    expect(out).toContain('src/a.ts:12');
    expect(out).toContain('Proposed:     needs_changes');
    // Relay's own conclusion is separate and still absent.
    expect(out).toContain('Validated:    Unknown');
    expect(out).not.toContain(TOKEN);
    expect(b.requests.map((r) => r.method)).toEqual(['GET']);
  }, 30_000);

  it('missing configuration blocks before any socket is opened', async () => {
    const h = io();
    const code = await runReviewerBridgeCli({
      mode: 'status', missionId: 'm1', json: false, authorize: false,
    }, h.io);
    expect(code).toBe(EXIT.blocked);
    expect(h.lines.join('\n')).toContain(BRIDGE_URL_ENV);
  }, 30_000);

  it('maps error kinds to distinguishable exit codes', () => {
    expect(exitCodeForBridgeError({ kind: 'configuration_missing', message: '' })).toBe(EXIT.blocked);
    expect(exitCodeForBridgeError({ kind: 'budget_blocked', message: '' })).toBe(EXIT.budgetExceeded);
    expect(exitCodeForBridgeError({ kind: 'validation_failed', message: '' })).toBe(EXIT.usage);
    expect(exitCodeForBridgeError({ kind: 'run_disconnected', message: '' })).toBe(EXIT.runFailed);
    expect(isConfigurationError({ kind: 'insecure_remote_url', message: '' })).toBe(true);
    expect(isConfigurationError({ kind: 'run_not_found', message: '' })).toBe(false);
  });
});

/* ------------------------------------------------------ the boundary --- */

describe('the client keeps the CLI a thin client', () => {
  const REPO = resolve(__dirname, '..', '..', '..');

  it('imports no server internals, no process adapter and no provider client', () => {
    for (const file of ['bridge-client.ts', 'bridge-target.ts', 'bridge-contracts.ts', 'index.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src, file).not.toMatch(/from\s+['"].*relay-bridge/);
      expect(src, file).not.toMatch(/reviewer-harness\/hermes/);
      expect(src, file).not.toMatch(/node:child_process|spawn\(/);
      expect(src, file).not.toMatch(/XAI_API_KEY|api\.x\.ai/);
      // No React, no browser modules.
      expect(src, file).not.toMatch(/from\s+['"]react|\/ui\//);
    }
  });

  it('the CLI reaches the bridge only through this client', () => {
    const cli = readFileSync(join(REPO, 'src', 'relay', 'cli', 'reviewer-bridge-cli.ts'), 'utf8');
    expect(cli).toMatch(/from '\.\.\/reviewer-bridge-client'/);
    expect(cli).not.toMatch(/relay-bridge/);
    expect(cli).not.toMatch(/fetch\(/);
    const main = readFileSync(join(REPO, 'src', 'relay', 'cli', 'main.ts'), 'utf8');
    expect(main).not.toMatch(/from\s+['"].*relay-bridge/);
  });

  it('uses the canonical Reviewer domain types rather than copies', () => {
    const contracts = readFileSync(join(__dirname, 'bridge-contracts.ts'), 'utf8');
    expect(contracts).toMatch(/from '\.\.\/mission\/reviewer-harness'/);
    expect(contracts).toContain('ReviewerHarnessView');
    expect(contracts).toContain('HarnessRuntimeEvidence');
  });

  it('the browser never imports the CLI bridge client', () => {
    const uiDir = join(REPO, 'src', 'relay', 'ui');
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const offenders = walk(uiDir).filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /reviewer-bridge-client|reviewer-bridge-cli/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
