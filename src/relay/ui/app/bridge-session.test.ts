/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_SESSION_STORAGE_KEY, BRIDGE_STATE_LABEL, bridgeSessionHeader, claimsConnection,
  clearBridgeSession, loadBridgeSession, saveBridgeSession, stateFromResponse,
  type BridgeConnectionState,
} from './bridge-session';

/**
 * THE BROWSER SIDE OF THE CONNECTION.
 *
 * Two properties matter: the token never lands anywhere that outlives the tab,
 * and no failure mode is allowed to read as "connected".
 */


const session = (over: Partial<Parameters<typeof saveBridgeSession>[0]> = {}) => ({
  token: 'opaque-session-token', origin: window.location.origin,
  expiresAt: '2026-08-01T21:00:00.000Z', scope: 'browser_read_only' as const, participantId: null, ...over,
});

beforeEach(() => {
  clearBridgeSession();
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => clearBridgeSession());

describe('the token never lands in localStorage', () => {
  it('persists to sessionStorage only', () => {
    saveBridgeSession(session());
    expect(window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.length).toBe(0);
    // And nothing anywhere in localStorage contains the token.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('opaque-session-token');
  });

  it('never mentions localStorage in the module at all', () => {
    const source = readFileSync(join(__dirname, 'bridge-session.ts'), 'utf8');
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '');
    expect(executable).not.toContain('localStorage');
  });

  it('clears both the memory copy and the stored copy', () => {
    saveBridgeSession(session());
    expect(loadBridgeSession()).not.toBeNull();
    clearBridgeSession();
    expect(loadBridgeSession()).toBeNull();
    expect(window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('discards a session restored under a different origin', () => {
    window.sessionStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, JSON.stringify(session({
      origin: 'https://somewhere-else.example',
    })));
    expect(loadBridgeSession()).toBeNull();
    expect(window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('ignores malformed stored state rather than trusting it', () => {
    for (const raw of ['not json', '{}', 'null', '{"token":123}']) {
      window.sessionStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, raw);
      clearBridgeSession();
      window.sessionStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, raw);
      expect(loadBridgeSession(), raw).toBeNull();
    }
  });
});

describe('the session scheme cannot be confused with the operator one', () => {
  it('uses Relay-Session, never Bearer', () => {
    const header = bridgeSessionHeader(session());
    expect(header.Authorization).toBe('Relay-Session opaque-session-token');
    expect(header.Authorization).not.toContain('Bearer');
  });
});

describe('no failure reads as connected', () => {
  const cases: ReadonlyArray<[string, Parameters<typeof stateFromResponse>[0], BridgeConnectionState]> = [
    ['no response at all', { hadSession: true, status: null }, 'bridge_unavailable'],
    ['401 while holding a session', { hadSession: true, status: 401 }, 'session_expired'],
    ['401 with no session', { hadSession: false, status: 401 }, 'reachable_not_paired'],
    ['403 scope refusal', { hadSession: true, status: 403 }, 'authentication_rejected'],
    ['500', { hadSession: true, status: 500 }, 'bridge_unavailable'],
    ['200 while holding a session', { hadSession: true, status: 200 }, 'connected'],
    ['200 with no session', { hadSession: false, status: 200 }, 'reachable_not_paired'],
  ];

  for (const [name, input, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(stateFromResponse(input)).toBe(expected);
    });
  }

  it('only "connected" claims a connection', () => {
    const states: BridgeConnectionState[] = [
      'offline', 'reachable_not_paired', 'pairing', 'connected',
      'session_expired', 'bridge_unavailable', 'authentication_rejected',
    ];
    expect(states.filter(claimsConnection)).toEqual(['connected']);
  });

  it('every state has a truthful label, and none of the others says connected', () => {
    for (const [state, label] of Object.entries(BRIDGE_STATE_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
      if (state !== 'connected') expect(label.toLowerCase()).not.toContain('securely connected');
    }
    expect(BRIDGE_STATE_LABEL.offline).toContain('Offline');
    expect(BRIDGE_STATE_LABEL.session_expired).toContain('expired');
  });

  it('a 200 without a session is never connected — that is the unpaired probe', () => {
    // The health probe answers 200 to anyone. Treating that as a connection is
    // the exact false-positive this milestone exists to prevent.
    expect(stateFromResponse({ hadSession: false, status: 200 })).not.toBe('connected');
  });
});

describe('offline remains the default', () => {
  const REPO = resolve(__dirname, '..', '..', '..', '..');

  it('live mode is still opt-in via a non-secret flag', () => {
    const store = readFileSync(join(REPO, 'src/relay/ui/app/store.ts'), 'utf8');
    expect(store).toContain("VITE_RELAY_LIVE === '1'");
    // The demo adapter is the fallback, so an unset flag stays offline.
    expect(store).toContain('createDemoRelayApplicationAdapter()');
  });

  it('no VITE variable carries a token or secret anywhere in the UI', () => {
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const offenders = walk(join(REPO, 'src', 'relay', 'ui'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /VITE_[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the operator token name appears in no UI module', () => {
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const offenders = walk(join(REPO, 'src', 'relay', 'ui'))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /RELAY_BRIDGE_API_TOKEN/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
