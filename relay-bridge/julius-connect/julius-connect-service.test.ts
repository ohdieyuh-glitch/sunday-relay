import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createDevelopmentCredentialVault } from './development-vault';
import type { LiveBrowser } from './live-browser';
import { startJuliusConnectDevServer } from './dev-server';
import { createJuliusConnectService, type JuliusConnectService, type JuliusConnectServiceView } from './julius-connect-service';

/**
 * THE LIVE SERVICE, DRIVEN THE WAY WONDERLAND DRIVES IT: one Julius, intents in, the surface out, the ticker doing the
 * work. The founder's playtest chain end to end, the vault holding what the record never sees, and the HTTP door closed
 * to everything but a local native client.
 */

function manualClock() {
  let t = Date.UTC(2026, 8, 17, 12, 0, 0);
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}

function must(result: ReturnType<JuliusConnectService['intent']>): JuliusConnectServiceView {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function run(service: JuliusConnectService, clock: ReturnType<typeof manualClock>, ms: number, stepMs = 100): void {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    clock.advance(stepMs);
    service.tick();
  }
}

describe('julius connect service: the founder playtest chain', () => {
  it('task needs the design connector -> prompt -> connect -> connected -> resumes -> audit -> revoke -> refused', () => {
    const clock = manualClock();
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas', now: clock.now, authorizationMs: 1000, stepMs: 500 });

    must(service.intent({ intent: 'start_task', templateId: 'design-sync' }));
    run(service, clock, 600);
    let view = service.view();
    const prompt = view.surface.prompt!;
    expect(prompt.banner).toBe('EXTERNAL CAPABILITY REQUIRED');
    expect(prompt.kind).toBe('DEVELOPMENT CONNECTOR');
    expect(view.surface.tasks[0].runState).toBe('BLOCKED');
    expect(view.surface.services.find((s) => s.connectorId === 'dev-figma')?.state).toBe('AUTHORIZATION_REQUIRED');

    view = must(service.intent({ intent: 'approve', requestId: prompt.requestId }));
    expect(view.surface.services.find((s) => s.connectorId === 'dev-figma')?.state).toBe('CONNECTING');
    expect(view.surface.prompt).toBeNull();
    run(service, clock, 1100);
    view = service.view();
    const figma = view.surface.services.find((s) => s.connectorId === 'dev-figma')!;
    expect(figma.state).toBe('CONNECTED');
    expect(figma.projectScope).toEqual(['files.read', 'design.write']);
    expect(figma.accountLabel).toContain('development');

    run(service, clock, 1200);
    view = service.view();
    expect(view.surface.tasks[0].runState).toBe('EXECUTING');
    expect(view.surface.tasks[0].progress).toBeGreaterThanOrEqual(1);
    expect(view.surface.audit.some((a) => a.action === 'capability.used' && a.outcome === 'success')).toBe(true);
    // The credential was resolved inside the runtime for each use -- and never appears in the surface.
    expect(service.vaultResolutions()).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(view)).not.toMatch(/vault:\/\/|devcred-/);

    view = must(service.intent({ intent: 'revoke', connectionId: figma.connectionId! }));
    expect(view.surface.services.find((s) => s.connectorId === 'dev-figma')).toMatchObject({ state: 'REVOKED', projectScope: [] });
    const usesAtRevoke = service.vaultResolutions();
    run(service, clock, 600);
    view = service.view();
    expect(view.surface.tasks[0].runState).toBe('BLOCKED');
    expect(view.surface.tasks[0].blockedReason).toBe('EXTERNAL_CAPABILITY_REQUIRED');
    expect(service.vaultResolutions()).toBe(usesAtRevoke);
    expect(view.surface.prompt).toBeNull();

    view = must(service.intent({ intent: 'probe', connectorId: 'dev-figma', capability: 'files.read' }));
    expect(view.surface.audit[0]).toMatchObject({ action: 'capability.denied', outcome: 'denied', capability: 'files.read' });

    // Reconnect and Julius finishes.
    view = must(service.intent({ intent: 'connect', connectorId: 'dev-figma' }));
    must(service.intent({ intent: 'approve', requestId: view.surface.prompt!.requestId }));
    run(service, clock, 8000);
    expect(service.view().surface.tasks[0].runState).toBe('COMPLETED');
  });

  it('refuses unknown or malformed intents, and development controls drive failure states the task obeys', () => {
    const clock = manualClock();
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas', now: clock.now, authorizationMs: 100, stepMs: 100 });
    expect(service.intent({ intent: 'rm -rf' }).ok).toBe(false);
    expect(service.intent('approve').ok).toBe(false);
    expect(service.intent({ intent: 'approve', requestId: '../../etc' }).ok).toBe(false);
    expect(service.intent({ intent: '__proto__' }).ok).toBe(false);

    must(service.intent({ intent: 'dev_fail_next_authorization' }));
    must(service.intent({ intent: 'connect', connectorId: 'dev-figma' }));
    must(service.intent({ intent: 'approve', requestId: service.view().surface.prompt!.requestId }));
    run(service, clock, 300);
    expect(service.view().surface.services.find((s) => s.connectorId === 'dev-figma')?.state).toBe('FAILED');

    must(service.intent({ intent: 'connect', connectorId: 'dev-figma' }));
    must(service.intent({ intent: 'approve', requestId: service.view().surface.prompt!.requestId }));
    run(service, clock, 300);
    const connectionId = service.view().surface.services.find((s) => s.connectorId === 'dev-figma')!.connectionId!;
    must(service.intent({ intent: 'start_task' }));
    expect(service.intent({ intent: 'start_task' }).ok).toBe(false);
    run(service, clock, 300);
    must(service.intent({ intent: 'dev_set_health', connectionId, to: 'RATE_LIMITED' }));
    run(service, clock, 300);
    const blocked = service.view().surface.tasks[0];
    expect(blocked.runState).toBe('BLOCKED');
    expect(service.view().surface.prompt).toBeNull();
    must(service.intent({ intent: 'dev_set_health', connectionId, to: 'CONNECTED' }));
    run(service, clock, 300);
    expect(service.view().surface.tasks[0].runState).toBe('EXECUTING');
    expect(service.intent({ intent: 'dev_set_health', connectionId, to: 'REVOKED' }).ok).toBe(false);
  });

  it('connects by what the user calls it', () => {
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas' });
    const view = must(service.intent({ intent: 'connect', name: 'design tool' }));
    expect(view.surface.prompt?.connectorId).toBe('dev-figma');
    expect(service.intent({ intent: 'connect', name: 'nothing like this' }).ok).toBe(false);
    expect(service.intent({ intent: 'connect', name: '<script>' }).ok).toBe(false);
  });

  it('real services cannot be connected in this build', () => {
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas' });
    const view = must(service.intent({ intent: 'connect', connectorId: 'github' }));
    expect(view.surface.prompt).toBeNull();
    expect(view.surface.services.find((s) => s.connectorId === 'github')).toMatchObject({ state: 'NOT_CONNECTED', stateLabel: 'INTEGRATION NOT BUILT' });
    expect(view.surface.audit[0]).toMatchObject({ action: 'capability.requested', outcome: 'failed' });
  });
});

describe('julius connect service: Julius on the real web', () => {
  /**
   * A BROWSER THAT REMEMBERS WHAT IT WAS ASKED, and answers slowly, the way a real one does: nothing finishes inside the
   * tick that started it. Nothing here reaches the network; what is under test is that the service asks for real work in
   * the right order and only when the gate allows it.
   */
  function fakeBrowser(): LiveBrowser & { asked: string[] } {
    const asked: string[] = [];
    const later = <T,>(value: T): Promise<T> => new Promise((resolve) => setImmediate(() => resolve(value)));
    return {
      asked,
      navigate: (_tab, url) => { asked.push(`navigate ${url}`); return later({ ok: true as const, host: 'en.wikipedia.org' }); },
      setViewport: () => later(true),
      read: () => { asked.push('read'); return later({ title: 'Design system - Wikipedia', url: 'https://en.wikipedia.org/wiki/Design_system', text: 'A design system is a set of standards.' }); },
      searchOnPage: (_tab, query) => { asked.push(`search ${query}`); return later({ ok: true as const }); },
      frame: () => later(null),
      click: () => later(true),
      scroll: () => later(true),
      typeText: () => later(true),
      pressKey: () => later(true),
      back: () => later(true),
      close: () => later(undefined),
      log: () => [],
      open: () => [],
      shutdown: () => later(undefined),
    };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('asks the founder first, then really browses: open, read, search, read -- each one an audited use', async () => {
    const clock = manualClock();
    const browser = fakeBrowser();
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas', now: clock.now, browser, authorizationMs: 200, stepMs: 100 });
    must(service.intent({ intent: 'start_task', templateId: 'web-lookup' }));
    run(service, clock, 300);
    // NOTHING WAS BROWSED. The task is blocked on a connection the founder has not given yet.
    expect(browser.asked).toEqual([]);
    const prompt = service.view().surface.prompt!;
    expect(prompt.requested.map((c) => c.capabilityId)).toEqual(['web.read', 'web.search']);
    expect(prompt.notRequested.map((c) => c.capabilityId)).toEqual(expect.arrayContaining(['web.sign_in', 'web.purchase']));

    must(service.intent({ intent: 'approve', requestId: prompt.requestId }));
    for (let i = 0; i < 40; i += 1) {
      run(service, clock, 200);
      await settle();
    }
    expect(browser.asked).toEqual([
      'navigate https://en.wikipedia.org/wiki/Design_system',
      'read',
      'search design tokens',
      'read',
    ]);
    const view = service.view();
    expect(view.surface.tasks[0]?.runState).toBe('COMPLETED');
    const used = view.surface.audit.filter((e) => e.action === 'capability.used');
    expect(used).toHaveLength(4);
    // The detail is what the page really said, not a stand-in sentence.
    expect(used.some((e) => e.detail.includes('Design system - Wikipedia'))).toBe(true);
  });

  it('without a browser, a web task fails honestly rather than pretending it browsed', async () => {
    const clock = manualClock();
    const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas', now: clock.now, authorizationMs: 200, stepMs: 100 });
    must(service.intent({ intent: 'start_task', templateId: 'web-lookup' }));
    run(service, clock, 300);
    const prompt = service.view().surface.prompt!;
    must(service.intent({ intent: 'approve', requestId: prompt.requestId }));
    run(service, clock, 2000);
    await settle();
    const failed = service.view().surface.audit.filter((e) => e.action === 'capability.used' && e.outcome === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].detail).toContain('without the real browser');
    expect(service.view().surface.tasks[0]?.runState).not.toBe('COMPLETED');
  });
});

describe('development credential vault', () => {
  it('hands out references, resolves only live ones, destroys on revoke, and never serializes material', () => {
    const vault = createDevelopmentCredentialVault();
    const { credentialRef } = vault.store({ connectorId: 'dev-postgres', userId: 'founder', material: 'devcred-abc123', label: 'db' });
    expect(credentialRef).toMatch(/^vault:\/\/dev\//);
    expect(JSON.stringify(vault)).not.toContain('devcred-abc123');
    expect(JSON.stringify(vault.describe(credentialRef))).not.toContain('devcred-abc123');
    expect(vault.resolveForExecution({ credentialRef, connectionId: 'c', capability: 'db.read' })?.material).toBe('devcred-abc123');
    vault.revoke(credentialRef);
    expect(vault.resolveForExecution({ credentialRef, connectionId: 'c', capability: 'db.read' })).toBeNull();
    expect(vault.describe(credentialRef)?.revoked).toBe(true);
    expect(vault.resolveForExecution({ credentialRef: 'vault://dev/unknown', connectionId: 'c', capability: 'db.read' })).toBeNull();
  });
});

describe('julius connect http door', () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  it('serves the surface and takes intents from a native local client, and refuses web pages', async () => {
    const started = await startJuliusConnectDevServer(0, { authorizationMs: 50, stepMs: 50 });
    close = started.close;
    const surface = await call(started.port, 'GET', '/julius-connect/v1/surface');
    expect(surface.status).toBe(200);
    expect(surface.json.mode).toBe('DEVELOPMENT');

    const started2 = await call(started.port, 'POST', '/julius-connect/v1/intents', JSON.stringify({ intent: 'start_task' }), { 'Content-Type': 'application/json' });
    expect(started2.status).toBe(200);

    const fromPage = await call(started.port, 'POST', '/julius-connect/v1/intents', JSON.stringify({ intent: 'reset' }), { 'Content-Type': 'application/json', Origin: 'https://example.com' });
    expect(fromPage.status).toBe(403);
    const notJson = await call(started.port, 'POST', '/julius-connect/v1/intents', 'intent=reset', { 'Content-Type': 'text/plain' });
    expect(notJson.status).toBe(415);
    const bad = await call(started.port, 'POST', '/julius-connect/v1/intents', JSON.stringify({ intent: 'approve', requestId: 'creq_9999' }), { 'Content-Type': 'application/json' });
    expect(bad.status).toBe(404);
    expect(bad.json.ok).toBe(false);
  });
});
