/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { RelayBridgePairingPanel } from '../app/RelayBridgePairingPanel';
import { RelayReviewerStatus } from './RelayReviewerStatus';
import {
  BRIDGE_SESSION_STORAGE_KEY, clearBridgeSession, loadBridgeSession, pairBrowser,
  disconnectBrowser,
} from '../app/bridge-session';
import { projectHarnessCatalog } from '../../mission/reviewer-harness';

/**
 * THE PAIRING SURFACE.
 *
 * Written from the angle of what must never happen: the grant secret must not
 * survive submission, land in storage, or appear in the DOM; and no outcome
 * except an accepted session may read as connected.
 */

const BRIDGE = 'https://bridge.example';
const GRANT_ID = 'grant-abc';
const GRANT_SECRET = 'super-secret-grant-value-0123456789';
const SESSION_TOKEN = 'issued-session-token-value';

beforeEach(() => {
  clearBridgeSession();
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => { cleanup(); clearBridgeSession(); vi.restoreAllMocks(); });

const panel = (over: Record<string, unknown> = {}) =>
  render(createElement(RelayBridgePairingPanel, {
    open: true, onClose: () => {}, bridgeUrl: BRIDGE, ...over,
  } as never));

const idField = () => screen.getByLabelText('Grant ID') as HTMLInputElement;
const secretField = () => screen.getByLabelText('Grant Secret') as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: /Pair Browser|Pairing/ });

/* ------------------------------------------------------ reachability ----- */

describe('the pairing control sits beside the Reviewer Harness control', () => {
  it('is reachable from the Reviewer panel in one click', () => {
    render(createElement(RelayReviewerStatus, {
      reviewerName: 'Codex', state: 'waiting', findings: [], repairs: [],
      harnessCatalog: projectHarnessCatalog(),
      onOpenFinding: () => {}, onOpenRepair: () => {},
    } as never));
    const trigger = screen.getByRole('button', { name: 'Relay Bridge' });
    expect(trigger.closest('.rpw-reviewer')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reviewer Harness' })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Relay Bridge' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------- fields ---- */

describe('the form asks for exactly two things', () => {
  it('renders both labelled fields and a submit button', () => {
    panel();
    expect(idField()).toBeTruthy();
    expect(secretField()).toBeTruthy();
    expect(submit().textContent).toBe('Pair Browser');
  });

  it('the grant secret is a password input, never readable text', () => {
    panel();
    expect(secretField().getAttribute('type')).toBe('password');
    expect(idField().getAttribute('type')).toBe('text');
    // Neither field offers to remember a credential.
    expect(secretField().getAttribute('autocomplete')).toBe('off');
  });

  it('says grants expire and are single-use', () => {
    panel();
    const text = document.body.textContent ?? '';
    expect(text).toContain('two minutes');
    expect(text).toContain('once');
  });

  it('refuses an empty submission without calling the bridge', async () => {
    const pairImpl = vi.fn();
    panel({ pairImpl });
    await act(async () => { fireEvent.click(submit()); });
    expect(pairImpl).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('required');
  });
});

/* --------------------------------------------------- the secret's life --- */

describe('the grant secret does not survive submission', () => {
  const fill = () => {
    fireEvent.change(idField(), { target: { value: GRANT_ID } });
    fireEvent.change(secretField(), { target: { value: GRANT_SECRET } });
  };

  it('clears both fields the moment the request goes out', async () => {
    const pairImpl = vi.fn(async () => ({ state: 'connected' as const, message: null }));
    panel({ pairImpl });
    fill();
    await act(async () => { fireEvent.click(submit()); });
    // The panel now shows the connected view, so the fields are gone entirely.
    expect(screen.queryByLabelText('Grant Secret')).toBeNull();
    expect(pairImpl).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: GRANT_ID, grantSecret: GRANT_SECRET }),
    );
  });

  it('clears the fields even when pairing is REJECTED', async () => {
    const pairImpl = vi.fn(async () => ({
      state: 'authentication_rejected' as const, message: 'That grant was not accepted.',
    }));
    panel({ pairImpl });
    fill();
    await act(async () => { fireEvent.click(submit()); });
    expect(secretField().value).toBe('');
    expect(idField().value).toBe('');
  });

  it('never writes the secret to any storage', async () => {
    const pairImpl = vi.fn(async () => ({ state: 'connected' as const, message: null }));
    panel({ pairImpl });
    fill();
    await act(async () => { fireEvent.click(submit()); });
    const stored = JSON.stringify({ ...window.sessionStorage, ...window.localStorage });
    expect(stored).not.toContain(GRANT_SECRET);
    expect(stored).not.toContain(GRANT_ID);
  });

  it('never renders the secret as text in the DOM', async () => {
    const pairImpl = vi.fn(async () => ({
      state: 'authentication_rejected' as const, message: 'That grant was not accepted.',
    }));
    panel({ pairImpl });
    fill();
    await act(async () => { fireEvent.click(submit()); });
    expect(document.body.textContent ?? '').not.toContain(GRANT_SECRET);
  });

  it('logs nothing at all', async () => {
    const logs: unknown[] = [];
    for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(...a); });
    }
    const pairImpl = vi.fn(async () => ({ state: 'connected' as const, message: null }));
    panel({ pairImpl });
    fill();
    await act(async () => { fireEvent.click(submit()); });
    expect(JSON.stringify(logs)).not.toContain(GRANT_SECRET);
    expect(JSON.stringify(logs)).not.toContain(GRANT_ID);
  });
});

/* ------------------------------------------------------- no false claim -- */

describe('no outcome except an accepted session reads as connected', () => {
  const outcomes = [
    ['authentication_rejected', 'Authentication rejected'],
    ['bridge_unavailable', 'Relay Bridge unavailable'],
    ['session_expired', 'Session expired'],
    ['reachable_not_paired', 'not paired'],
  ] as const;

  for (const [state, fragment] of outcomes) {
    it(`${state} shows "${fragment}", never Connected`, async () => {
      const pairImpl = vi.fn(async () => ({ state, message: null }));
      panel({ pairImpl });
      fireEvent.change(idField(), { target: { value: GRANT_ID } });
      fireEvent.change(secretField(), { target: { value: GRANT_SECRET } });
      await act(async () => { fireEvent.click(submit()); });
      const shown = document.querySelector('[data-bridge-state]');
      expect(shown?.getAttribute('data-bridge-state')).toBe(state);
      expect(shown?.textContent).toContain(fragment);
      expect(document.body.textContent).not.toContain('Securely connected');
    });
  }

  it('an expired or replayed grant is stated as a rejection with the reason', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ kind: 'authentication_failed' }),
    })) as unknown as typeof fetch;
    const result = await pairBrowser({
      grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl,
    });
    expect(result.state).toBe('authentication_rejected');
    expect(result.message).toContain('once');
    expect(loadBridgeSession()).toBeNull();
  });

  it('an unreachable bridge is unavailable, not connected', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const result = await pairBrowser({
      grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl,
    });
    expect(result.state).toBe('bridge_unavailable');
    expect(loadBridgeSession()).toBeNull();
  });
});

/* ------------------------------------------------ what pairing stores ---- */

describe('a successful pairing stores only the session token', () => {
  const okFetch = () => vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { sessionToken: SESSION_TOKEN, expiresAt: '2026-08-02T00:00:00.000Z' } }),
  })) as unknown as typeof fetch;

  it('saves the token to sessionStorage and nothing to localStorage', async () => {
    const result = await pairBrowser({
      grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl: okFetch(),
    });
    expect(result.state).toBe('connected');
    const stored = window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY) ?? '';
    expect(stored).toContain(SESSION_TOKEN);
    expect(stored).not.toContain(GRANT_SECRET);
    expect(stored).not.toContain(GRANT_ID);
    expect(window.localStorage.length).toBe(0);
  });

  it('sends the grant in the BODY, never a URL', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: { sessionToken: SESSION_TOKEN } }) };
    }) as unknown as typeof fetch;
    await pairBrowser({ grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl });
    expect(seen[0].url).toBe(`${BRIDGE}/relay-api/browser/session`);
    expect(seen[0].url).not.toContain(GRANT_SECRET);
    expect(String(seen[0].init.body)).toContain(GRANT_SECRET);
  });
});

/* ---------------------------------------------------------- disconnect --- */

describe('disconnect is honest about what it achieved', () => {
  const pairedFetch = () => vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ data: { sessionToken: SESSION_TOKEN } }),
  })) as unknown as typeof fetch;

  it('clears the local session even when the bridge is unreachable', async () => {
    await pairBrowser({ grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl: pairedFetch() });
    expect(loadBridgeSession()).not.toBeNull();
    const down = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const result = await disconnectBrowser({ bridgeUrl: BRIDGE, fetchImpl: down });
    expect(loadBridgeSession()).toBeNull();
    // And it does NOT claim the bridge revoked anything.
    expect(result.revokedOnBridge).toBe(false);
    expect(result.message).toContain('did not confirm revocation');
  });

  it('claims revocation only when the bridge confirmed it', async () => {
    await pairBrowser({ grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: BRIDGE, fetchImpl: pairedFetch() });
    const okRevoke = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    const result = await disconnectBrowser({ bridgeUrl: BRIDGE, fetchImpl: okRevoke });
    expect(result.revokedOnBridge).toBe(true);
    expect(result.message).toContain('revoked on the Relay Bridge');
    expect(loadBridgeSession()).toBeNull();
  });

  it('returns the panel to the unpaired state', async () => {
    const disconnectImpl = vi.fn(async () => ({
      state: 'reachable_not_paired' as const, revokedOnBridge: true, message: 'Session revoked.',
    }));
    const pairImpl = vi.fn(async () => ({ state: 'connected' as const, message: null }));
    panel({ pairImpl, disconnectImpl });
    fireEvent.change(idField(), { target: { value: GRANT_ID } });
    fireEvent.change(secretField(), { target: { value: GRANT_SECRET } });
    await act(async () => { fireEvent.click(submit()); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Disconnect' })); });
    expect(document.querySelector('[data-bridge-state]')?.getAttribute('data-bridge-state'))
      .toBe('reachable_not_paired');
    expect(screen.getByLabelText('Grant ID')).toBeTruthy();
  });
});

/* -------------------------------------------------------- offline rule --- */

describe('offline still means zero bridge requests', () => {
  it('makes no request when no bridge is configured', async () => {
    const fetchImpl = vi.fn();
    const result = await pairBrowser({
      grantId: GRANT_ID, grantSecret: GRANT_SECRET, bridgeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the panel shows offline rather than inventing reachability', () => {
    panel({ bridgeUrl: null });
    expect(document.querySelector('[data-bridge-state]')?.getAttribute('data-bridge-state'))
      .toBe('offline');
  });
});

/* --------------------------------------------------------- the bundle ---- */

describe('the operator credential is nowhere near this surface', () => {
  const REPO = resolve(__dirname, '..', '..', '..', '..');

  it('no pairing source names the operator token', () => {
    for (const f of [
      'src/relay/ui/app/RelayBridgePairingPanel.tsx',
      'src/relay/ui/app/bridge-session.ts',
    ]) {
      const src = readFileSync(join(REPO, f), 'utf8');
      expect(src, f).not.toContain('RELAY_BRIDGE_API_TOKEN');
      expect(src, f).not.toContain('RELAY_BRIDGE_TOKEN');
      // Comments may EXPLAIN why localStorage is never used; executable code
      // may not touch it.
      const executable = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\n)\s*\/\/[^\n]*/g, '');
      expect(executable, f).not.toMatch(/localStorage/);
      // A browser session is never sent as Bearer — that is the operator scheme.
      expect(executable, f).not.toMatch(/Bearer \$\{/);
    }
  });

  it('credential inputs exist in exactly two deliberate places, neither a workspace panel', () => {
    // `project-workspace.test.tsx` forbids credential fields among the
    // workspace panels. Both inputs below are app-layer dialogs that exist to
    // receive a credential the founder is deliberately carrying across: the
    // PSP agent id, and now the pairing grant. Pinning the exact set means a
    // third one cannot appear unnoticed.
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const withPasswordField = walk(join(REPO, 'src', 'relay', 'ui'))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /type="password"/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(`${REPO}/`, ''));
    expect(withPasswordField.sort()).toEqual([
      'src/relay/ui/app/RelayBridgePairingPanel.tsx',
      'src/relay/ui/psp-import/RelayPspAgentImport.tsx',
    ]);
    // And neither lives among the workspace panels.
    expect(withPasswordField.some((f) => f.includes('/project-workspace/'))).toBe(false);
  });

  it('browser sessions stay read-only — the panel offers no run control', () => {
    panel();
    const text = document.body.textContent ?? '';
    for (const forbidden of ['Start review', 'Retry', 'Test connection']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
