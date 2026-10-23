import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WONDERLAND_CLIENT_ROLE } from './wonderland-contracts';
import {
  AGENT_DISPLAY_NAME_FALLBACK,
  DEFAULT_SHOWN_WINDOW_CAP,
  WONDER_WEB_WINDOW_CLIENT_ROLE,
  WONDER_WEB_WINDOWS_CONTRACT,
  addressByBrowserId,
  addressByVmNumber,
  applySession,
  applyUserAction,
  applyVisibility,
  closePanel,
  createWindowManager,
  deserializeWindows,
  formatWindowTitle,
  SESSION_END_CAUSES,
  observerView,
  openWindow,
  serializeWindows,
  settleClosing,
  settleOpening,
  statusIndicators,
  tileWindows,
  type WonderWebVmSessionRecord,
  type WonderWebWindowLogContext,
  type WonderWebWindowManagerState,
  type WonderWebWindowResult,
} from './wonder-web-windows';

/**
 * Logic only. These tests never open a VM, a socket, or an Unreal editor.
 * The C++ block compiles the standalone mirror and compares one golden report.
 */

const CTX: WonderWebWindowLogContext = {
  tsUtcMs: 1_700_000_000_000,
  clientRole: 'presentational',
  netId: 'net-7',
  buildSha: 'f539cab2',
  corrId: 'corr-golden',
};

const LIFETIME_KEYS = [
  'keepalive',
  'heartbeat',
  'extend',
  'extendsession',
  'renew',
  'ttl',
  'stayalive',
  'holdsession',
  'bumpexpiry',
  'preventidle',
  'preventtimeout',
];

function lifetimeHits(value: unknown, hits: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && LIFETIME_KEYS.includes(value.toLowerCase())) hits.push(value);
    return hits;
  }
  if (Array.isArray(value)) {
    for (const item of value) lifetimeHits(item, hits);
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LIFETIME_KEYS.includes(key.toLowerCase())) hits.push(key);
    lifetimeHits(child, hits);
  }
  return hits;
}

function manager(cap?: number): WonderWebWindowManagerState {
  const created = createWindowManager(cap === undefined ? undefined : { windowCap: cap });
  if (!created.ok) throw new Error(created.error.code);
  return created.state;
}

function session(over: Partial<WonderWebVmSessionRecord> & Pick<WonderWebVmSessionRecord, 'vmSessionId'>): WonderWebVmSessionRecord {
  return {
    vmSessionId: over.vmSessionId,
    agentId: over.agentId ?? 'auth-dot',
    agentDisplayName: over.agentDisplayName ?? 'Dot',
    vmNumber: over.vmNumber ?? 1,
    terminal: over.terminal ?? { terminalId: 'term-julius', kind: 'julius', displayName: 'Julius' },
    accentColorRef: over.accentColorRef ?? 'accent-julius',
    sessionState: over.sessionState ?? 'running',
    endCause: over.endCause,
  };
}

function withUnpublishedCause(record: WonderWebVmSessionRecord, endCause: string): WonderWebVmSessionRecord {
  return { ...record, endCause } as unknown as WonderWebVmSessionRecord;
}

function must<T>(result: WonderWebWindowResult<T>): Extract<WonderWebWindowResult<T>, { ok: true }> {
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

describe('names, titles, and the parent accent', () => {
  it('titles the window with the customized name and the session number', () => {
    expect(formatWindowTitle('Dot', 3)).toBe('Dot \u2014 Wonder Web VM 3');
    expect(formatWindowTitle('Dot', 3)).not.toContain('Julius');
    expect(formatWindowTitle('Dot', 3)).not.toContain('grok');
  });

  it('rejects an empty or control-character name and falls back to Agent, not a provider', () => {
    const state = manager();
    const rejected = openWindow(state, session({ vmSessionId: 'sess-empty', agentDisplayName: '' }), CTX);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('agent_display_name_rejected');
      expect(rejected.error.fallback).toBe(AGENT_DISPLAY_NAME_FALLBACK);
    }
    expect(state.windows).toHaveLength(0);
    expect(formatWindowTitle('\nDot', 1)).toBe('Agent \u2014 Wonder Web VM 1');
    expect(formatWindowTitle('   ', 1)).toBe('Agent \u2014 Wonder Web VM 1');
    const fallback = AGENT_DISPLAY_NAME_FALLBACK.toLowerCase();
    for (const label of ['grok', 'openai', 'julius', 'chatgpt', 'claude', 'gpt', 'hermes', 'grok_bot_group', 'openai_companion']) {
      expect(fallback).not.toBe(label);
    }
    expect(formatWindowTitle('ドット', 2)).toBe('ドット \u2014 Wonder Web VM 2');
  });

  it('does not invent a number when the session record has none', () => {
    expect(formatWindowTitle('Dot', 0)).toBeNull();
    const opened = openWindow(manager(), session({ vmSessionId: 'sess-n', vmNumber: 0 }), CTX);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe('vm_number_unusable');
  });

  it('copies accentColorRef and never substitutes the client gold', () => {
    const first = must(openWindow(manager(), session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
    const second = must(openWindow(first.state, session({ vmSessionId: 'sess-2', vmNumber: 4, agentDisplayName: 'Card' }), CTX));
    expect(first.value.accentColorToken).toBe('accent-julius');
    expect(second.value.accentColorToken).toBe('accent-julius');
    expect(first.value.terminalDisplayName).toBe('Julius');
    expect(first.value.terminalKind).toBe('julius');
    expect(displayed(first.value.vmSessionId, second.state, session({ vmSessionId: 'sess-1', vmNumber: 3 }))).toBe('Dot \u2014 Wonder Web VM 3');
    const blank = must(openWindow(manager(), session({ vmSessionId: 'sess-blank', accentColorRef: '   ' }), CTX));
    expect(blank.value.accentColorToken).toBeNull();
    expect(JSON.stringify(blank.value)).not.toContain('FFD400');
    expect(JSON.stringify(blank.value)).not.toContain('#FFD400');
  });
});

function displayed(id: string, state: WonderWebWindowManagerState, record: WonderWebVmSessionRecord): string | null {
  const window = state.windows.find((item) => item.vmSessionId === id);
  if (!window) return null;
  return observerView(window, record).title;
}

describe('open, focus, chips, and distinct animations', () => {
  it('glides the camera only for the first shown window', () => {
    const first = must(openWindow(manager(), session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
    expect(first.animations.map((item) => item.intent)).toEqual(['cinematic_closeup']);
    expect(first.state.cameraInCloseup).toBe(true);
    expect(first.events.map((item) => item.event)).toEqual(['ww_window_opened']);
    expect(first.events[0]).toMatchObject({ vmSessionId: 'sess-1', n: 3, client_role: 'presentational' });
    const settled = must(settleOpening(first.state, session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
    expect(settled.value.phase).toBe('focused');
    const second = must(openWindow(settled.state, session({ vmSessionId: 'sess-2', vmNumber: 4, agentDisplayName: 'Card' }), CTX));
    expect(second.animations.map((item) => item.intent)).toEqual(['spawn_inline']);
    expect(second.animations.some((item) => item.intent === 'cinematic_closeup' || item.intent === 'camera_return')).toBe(false);
    expect(second.state.cameraInCloseup).toBe(true);
    expect(second.state.windows.map((item) => item.sessionState)).toEqual(['running', 'running']);
  });

  it('a panel close plays close_anim and does not end the session', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const other = must(openWindow(settled.state, session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' }), CTX));
    const closed = must(closePanel(other.state, session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' }), 'auth-dot', CTX));
    expect(closed.animations.map((item) => item.intent)).toEqual(['close_anim']);
    expect(closed.animations.some((item) => item.intent === 'minimize_fold' || item.intent === 'vm_ended_anim')).toBe(false);
    expect(closed.events.map((item) => item.event)).toEqual(['ww_panel_closed']);
    expect(closed.value.sessionState).toBe('running');
    expect(closed.state.windows.find((item) => item.vmSessionId === 'sess-1')?.sessionState).toBe('running');
    expect(lifetimeHits(closed)).toEqual([]);
  });

  it('returns the camera only when the last held window closes and the camera is in the close-up', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const second = must(openWindow(settled.state, session({ vmSessionId: 'sess-2', vmNumber: 2 }), CTX));
    const oneGone = must(closePanel(second.state, session({ vmSessionId: 'sess-2', vmNumber: 2 }), 'auth-dot', CTX));
    expect(oneGone.animations.map((item) => item.intent)).not.toContain('camera_return');
    expect(oneGone.state.cameraInCloseup).toBe(true);
    const last = must(closePanel(oneGone.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', CTX));
    expect(last.animations.map((item) => item.intent)).toEqual(['close_anim', 'camera_return']);
    expect(last.state.cameraInCloseup).toBe(false);
  });

  it('minimizes to a chip and restores with its own unfold', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const other = must(openWindow(settled.state, session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' }), CTX));
    const folded = must(applyUserAction(other.state, session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' }), 'auth-dot', 'minimize', CTX));
    expect(folded.animations.map((item) => item.intent)).toEqual(['minimize_fold']);
    expect(folded.value.phase).toBe('minimized');
    expect(folded.value.sessionState).toBe('running');
    const chips = statusIndicators(folded.state, [session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' })]);
    expect(chips).toEqual([
      expect.objectContaining({ vmSessionId: 'sess-2', status: 'minimized', dockSlot: 0, ownerName: 'Card' }),
    ]);
    const restored = must(applyVisibility(
      folded.state,
      session({ vmSessionId: 'sess-2', vmNumber: 2, agentDisplayName: 'Card' }),
      'auth-dot',
      { kind: 'user_focus' },
      CTX,
    ));
    expect(restored.animations.map((item) => item.intent)).toEqual(['restore_unfold']);
    expect(restored.value.phase).toBe('focused');
  });

  it('reopens a still-live session on the same vmSessionId', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-a', vmNumber: 4 }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-a', vmNumber: 4 }), CTX));
    const closed = must(closePanel(settled.state, session({ vmSessionId: 'sess-a', vmNumber: 4 }), 'auth-dot', CTX));
    const gone = must(settleClosing(closed.state, 'sess-a'));
    expect(gone.value.sessionState).toBe('running');
    const again = must(openWindow(gone.state, session({ vmSessionId: 'sess-a', vmNumber: 4 }), CTX));
    expect(again.value.vmSessionId).toBe('sess-a');
    expect(again.value.phase).toBe('opening');
    expect(again.animations.map((item) => item.intent)).toEqual(['cinematic_closeup']);
    expect(observerView(again.value, session({ vmSessionId: 'sess-a', vmNumber: 4 })).title).toBe('Dot \u2014 Wonder Web VM 4');
    expect(again.events.some((item) => item.event === 'ww_session_terminated')).toBe(false);
  });
});

describe('PILOT camera rule', () => {
  it('counts chips as held, so a new open beside only chips is spawn_inline', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const folded = must(applyUserAction(settled.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', 'minimize', CTX));
    expect(folded.animations.map((item) => item.intent)).toEqual(['minimize_fold']);
    expect(folded.state.cameraInCloseup).toBe(true);
    const next = must(openWindow(folded.state, session({ vmSessionId: 'sess-2', vmNumber: 2 }), CTX));
    expect(next.animations.map((item) => item.intent)).toEqual(['spawn_inline']);
    expect(next.animations.some((item) => item.intent === 'cinematic_closeup' || item.intent === 'camera_return')).toBe(false);
    expect(next.state.cameraInCloseup).toBe(true);
  });

  it('does not return the camera when the last shown window leaves and a chip remains', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const second = must(openWindow(settled.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), CTX));
    const folded = must(applyUserAction(second.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), 'auth-dot', 'minimize', CTX));
    const closed = must(closePanel(folded.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', CTX));
    expect(closed.animations.map((item) => item.intent)).toEqual(['close_anim']);
    expect(closed.state.cameraInCloseup).toBe(true);
    expect(closed.state.windows.find((item) => item.vmSessionId === 'sess-chip')?.phase).toBe('minimized');
    const ended = must(applySession(
      folded.state,
      session({ vmSessionId: 'sess-1', sessionState: 'ended', endCause: 'owner_terminated' }),
      CTX,
    ));
    expect(ended.animations.map((item) => item.intent)).toEqual(['vm_ended_anim']);
    expect(ended.state.cameraInCloseup).toBe(true);
  });

  it('returns the camera only when the last held window leaves and the camera was in the close-up', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const second = must(openWindow(settled.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), CTX));
    const folded = must(applyUserAction(second.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), 'auth-dot', 'minimize', CTX));
    const shownGone = must(closePanel(folded.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', CTX));
    const chipGone = must(closePanel(shownGone.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), 'auth-dot', CTX));
    expect(chipGone.animations.map((item) => item.intent)).toEqual(['close_anim', 'camera_return']);
    expect(chipGone.state.cameraInCloseup).toBe(false);

    const parked = serializeWindows(settled.state).replace('"cameraInCloseup":true', '"cameraInCloseup":false');
    const loaded = must(deserializeWindows(parked));
    expect(loaded.state.cameraInCloseup).toBe(false);
    const quiet = must(closePanel(loaded.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', CTX));
    expect(quiet.animations.map((item) => item.intent)).toEqual(['close_anim']);
    expect(quiet.state.cameraInCloseup).toBe(false);
  });
});

describe('wonder-web-vm-session.v1 endCause', () => {
  it('accepts each of the six published causes and no others', () => {
    expect([...SESSION_END_CAUSES]).toEqual([
      'owner_terminated',
      'idle_timeout',
      'max_lifetime',
      'provider_failed',
      'cap_exhausted',
      'authorization_revoked',
    ]);
    for (const cause of SESSION_END_CAUSES) {
      const opened = must(openWindow(manager(), session({ vmSessionId: `sess-${cause}` }), CTX));
      const settled = must(settleOpening(opened.state, session({ vmSessionId: `sess-${cause}` }), CTX));
      const ended = must(applySession(
        settled.state,
        session({ vmSessionId: `sess-${cause}`, sessionState: 'ended', endCause: cause }),
        CTX,
      ));
      expect(ended.animations[0]).toMatchObject({ intent: 'vm_ended_anim', endCause: cause });
      expect(ended.animations.some((item) => item.intent === 'close_anim')).toBe(false);
    }
  });

  it('rejects an unknown cause and an endCause on a running session', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const unknown = applySession(
      settled.state,
      withUnpublishedCause(session({ vmSessionId: 'sess-1', sessionState: 'ended' }), 'explicit_stop'),
      CTX,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('unsupported_contract');
    expect(unknown.state).toBe(settled.state);
    const running = applySession(
      settled.state,
      { ...session({ vmSessionId: 'sess-1', sessionState: 'running' }), endCause: 'idle_timeout' } as WonderWebVmSessionRecord,
      CTX,
    );
    expect(running.ok).toBe(false);
    if (!running.ok) expect(running.error.code).toBe('unsupported_contract');
    expect(running.state).toBe(settled.state);
    expect(settled.value.sessionState).toBe('running');
  });

  it('a panel close never carries an end cause', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const closed = must(closePanel(settled.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', CTX));
    expect(closed.animations).toEqual([
      expect.objectContaining({ intent: 'close_anim', endCause: null, vmSessionId: 'sess-1' }),
      expect.objectContaining({ intent: 'camera_return', endCause: null }),
    ]);
    expect(closed.value.sessionState).toBe('running');
  });
});

describe('the shown-window cap', () => {
  it('defaults to 6 and queues a seventh session as a chip without stopping it', () => {
    expect(DEFAULT_SHOWN_WINDOW_CAP).toBe(6);
    let state = manager();
    for (let index = 1; index <= 6; index += 1) {
      const opened = must(openWindow(state, session({ vmSessionId: `sess-${index}`, vmNumber: index, agentDisplayName: `Dot ${index}` }), CTX));
      state = opened.value.phase === 'opening'
        ? must(settleOpening(opened.state, session({ vmSessionId: `sess-${index}`, vmNumber: index, agentDisplayName: `Dot ${index}` }), CTX)).state
        : opened.state;
    }
    expect(state.windows.filter((item) => item.phase === 'focused' || item.phase === 'live').length).toBe(6);
    const seventh = must(openWindow(state, session({ vmSessionId: 'sess-7', vmNumber: 7, agentDisplayName: 'Card' }), CTX));
    expect(seventh.value.phase).toBe('minimized');
    expect(seventh.value.admission).toBe('queued_chip');
    expect(seventh.value.sessionState).toBe('running');
    expect(seventh.animations).toEqual([]);
    expect(seventh.events.map((item) => item.event)).toEqual(['ww_window_opened', 'ww_window_minimized']);
    expect(lifetimeHits(seventh)).toEqual([]);
    expect(seventh.state.windows.every((item) => item.sessionState === 'running')).toBe(true);
  });
});

describe('session end is not a panel close and never keeps the VM alive', () => {
  it('plays vm_ended_anim for a pinned focused window and emits no lifetime action', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-end' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-end' }), CTX));
    const pinned = must(applyUserAction(settled.state, session({ vmSessionId: 'sess-end' }), 'auth-dot', 'pin', CTX));
    expect(pinned.events.map((item) => item.event)).toEqual(['ww_window_pinned']);
    expect(pinned.animations).toEqual([]);
    const ended = must(applySession(
      pinned.state,
      session({ vmSessionId: 'sess-end', sessionState: 'ended', endCause: 'idle_timeout' }),
      CTX,
    ));
    expect(ended.animations.map((item) => item.intent)).toEqual(['vm_ended_anim', 'camera_return']);
    expect(ended.animations.some((item) => item.intent === 'close_anim' || item.intent === 'minimize_fold')).toBe(false);
    expect(ended.animations[0]).toMatchObject({ intent: 'vm_ended_anim', endCause: 'idle_timeout' });
    expect(ended.events.map((item) => item.event)).toEqual(['ww_session_terminated', 'ww_panel_closed']);
    expect(ended.value.phase).toBe('closing');
    expect(ended.value.pinned).toBe(true);
    expect(ended.value.sessionState).toBe('ended');
    expect(lifetimeHits(ended)).toEqual([]);
    expect(JSON.stringify(ended)).not.toMatch(/keepalive|heartbeat|extendSession|stayAlive/i);
  });

  it('also ends a minimized window with vm_ended_anim, not the fold', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const other = must(openWindow(settled.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), CTX));
    const folded = must(applyUserAction(other.state, session({ vmSessionId: 'sess-chip', vmNumber: 2 }), 'auth-dot', 'minimize', CTX));
    const ended = must(applySession(
      folded.state,
      session({ vmSessionId: 'sess-chip', vmNumber: 2, sessionState: 'failed', endCause: 'provider_failed' }),
      CTX,
    ));
    expect(ended.animations.map((item) => item.intent)).toEqual(['vm_ended_anim']);
    expect(ended.value.phase).toBe('closing');
    expect(ended.state.windows.find((item) => item.vmSessionId === 'sess-1')?.phase).toBe('focused');
    expect(ended.state.cameraInCloseup).toBe(true);
  });
});

describe('identity is vmSessionId', () => {
  it('a reused number and a browser-N id cannot address another window', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-old', vmNumber: 4 }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-old', vmNumber: 4 }), CTX));
    const ended = must(applySession(settled.state, session({ vmSessionId: 'sess-old', vmNumber: 4, sessionState: 'ended', endCause: 'owner_terminated' }), CTX));
    const closed = must(settleClosing(ended.state, 'sess-old'));
    const next = must(openWindow(closed.state, session({ vmSessionId: 'sess-new', vmNumber: 4, agentDisplayName: 'Card', agentId: 'auth-card' }), CTX));
    const settledNext = must(settleOpening(next.state, session({ vmSessionId: 'sess-new', vmNumber: 4, agentDisplayName: 'Card', agentId: 'auth-card' }), CTX));
    const missed = applyUserAction(
      settledNext.state,
      session({ vmSessionId: 'sess-old', vmNumber: 4, sessionState: 'ended', endCause: 'owner_terminated' }),
      'auth-dot',
      'focus',
      CTX,
    );
    expect(missed.ok).toBe(false);
    expect(settledNext.state.windows.find((item) => item.vmSessionId === 'sess-new')?.phase).toBe('focused');
    expect(settledNext.state.windows.find((item) => item.vmSessionId === 'sess-old')?.phase).toBe('closed');
    expect(addressByVmNumber(4).code).toBe('vm_number_not_an_address');
    expect(addressByBrowserId('browser-2').code).toBe('browser_id_not_an_address');
    expect(addressByBrowserId('browser').code).toBe('browser_id_not_an_address');
    const legacy = openWindow(manager(), session({ vmSessionId: 'browser-2' }), CTX);
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.error.code).toBe('browser_id_not_an_address');
    const wrongRecord = observerView(
      settledNext.state.windows.find((item) => item.vmSessionId === 'sess-old')!,
      session({ vmSessionId: 'sess-new', vmNumber: 4, agentDisplayName: 'Card', agentId: 'auth-card' }),
    );
    expect(wrongRecord.title).toBeNull();
    expect(JSON.stringify(serializeWindows(settledNext.state))).not.toContain('vmNumber');
    expect(JSON.stringify(serializeWindows(settledNext.state))).not.toContain('browser-2');
  });

  it('refuses to revive an ended vmSessionId', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-old' }), CTX));
    const ended = must(applySession(
      must(settleOpening(opened.state, session({ vmSessionId: 'sess-old' }), CTX)).state,
      session({ vmSessionId: 'sess-old', sessionState: 'failed', endCause: 'max_lifetime' }),
      CTX,
    ));
    const closed = must(settleClosing(ended.state, 'sess-old'));
    const revived = openWindow(closed.state, session({ vmSessionId: 'sess-old', sessionState: 'running' }), CTX);
    expect(revived.ok).toBe(false);
    if (!revived.ok) expect(revived.error.code).toBe('session_id_reused');
  });
});

describe('Skywalker criteria 8, 9, and 11', () => {
  it('the observer projection is only outline, owner, title, and status', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
    const bait = {
      ...session({ vmSessionId: 'sess-1', vmNumber: 3 }),
      stream: 'rtsp://secret.example/live',
      frame: 'FRAMEBYTES',
      url: 'https://vm.example/desktop',
      page: 'https://vm.example/page',
      action: 'click#submit',
    };
    const view = observerView(opened.value, bait);
    expect(Object.keys(view).sort()).toEqual(['outlineColorToken', 'ownerName', 'status', 'title']);
    const blob = JSON.stringify(view);
    for (const secret of ['rtsp://secret.example/live', 'FRAMEBYTES', 'https://vm.example/desktop', 'https://vm.example/page', 'click#submit']) {
      expect(blob).not.toContain(secret);
    }
    expect(view).toEqual({
      outlineColorToken: 'accent-julius',
      ownerName: 'Dot',
      title: 'Dot \u2014 Wonder Web VM 3',
      status: 'opening',
    });
  });

  it('two agents with the same name and colour cannot act on each other', () => {
    const shared = { agentDisplayName: 'Dot', accentColorRef: 'accent-gold', terminal: { terminalId: 'term-a', kind: 'openai_companion' as const, displayName: 'OpenAI companion' } };
    const first = must(openWindow(manager(), session({ vmSessionId: 'sess-a', agentId: 'auth-1', vmNumber: 1, ...shared }), CTX));
    const second = must(openWindow(first.state, session({ vmSessionId: 'sess-b', agentId: 'auth-2', vmNumber: 2, ...shared }), CTX));
    const denied = applyUserAction(
      second.state,
      session({ vmSessionId: 'sess-b', agentId: 'auth-2', vmNumber: 2, ...shared }),
      'auth-1',
      'close',
      CTX,
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('not_owner');
    expect(denied.state).toBe(second.state);
    expect(second.state.windows.find((item) => item.vmSessionId === 'sess-b')?.phase).toBe('opening');
  });
});

describe('visibility', () => {
  it('surfaces permission immediately and rate-limits progress', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const folded = must(applyVisibility(settled.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', { kind: 'user_minimize' }, CTX));
    const progress = must(applyVisibility(
      folded.state,
      session({ vmSessionId: 'sess-1' }),
      'auth-dot',
      { kind: 'progress_milestone' },
      { ...CTX, tsUtcMs: CTX.tsUtcMs },
    ));
    expect(progress.value.phase).toBe('focused');
    const againFolded = must(applyVisibility(progress.state, session({ vmSessionId: 'sess-1' }), 'auth-dot', { kind: 'user_minimize' }, { ...CTX, tsUtcMs: CTX.tsUtcMs + 10 }));
    const throttled = must(applyVisibility(
      againFolded.state,
      session({ vmSessionId: 'sess-1' }),
      'auth-dot',
      { kind: 'progress_milestone' },
      { ...CTX, tsUtcMs: CTX.tsUtcMs + 20 },
    ));
    expect(throttled.value.phase).toBe('minimized');
    expect(throttled.animations).toEqual([]);
    const permission = must(applyVisibility(
      throttled.state,
      session({ vmSessionId: 'sess-1' }),
      'auth-dot',
      { kind: 'permission_request' },
      { ...CTX, tsUtcMs: CTX.tsUtcMs + 30 },
    ));
    expect(permission.value.phase).toBe('focused');
    expect(permission.animations.map((item) => item.intent)).toEqual(['restore_unfold']);
  });

  it('auto-minimizes an idle window unless it is pinned', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX));
    const settled = must(settleOpening(opened.state, session({ vmSessionId: 'sess-1' }), CTX));
    const early = must(applyVisibility(
      settled.state,
      session({ vmSessionId: 'sess-1' }),
      'auth-dot',
      { kind: 'idle', idleSinceMs: 0 },
      { ...CTX, tsUtcMs: 59_999 },
    ));
    expect(early.value.phase).toBe('focused');
    const idle = must(applyVisibility(
      early.state,
      session({ vmSessionId: 'sess-1' }),
      'auth-dot',
      { kind: 'idle', idleSinceMs: 0 },
      { ...CTX, tsUtcMs: 60_000 },
    ));
    expect(idle.value.phase).toBe('minimized');
    expect(idle.animations.map((item) => item.intent)).toEqual(['minimize_fold']);
    const pinnedOpen = must(openWindow(manager(), session({ vmSessionId: 'sess-pin' }), CTX));
    const pinnedSettled = must(settleOpening(pinnedOpen.state, session({ vmSessionId: 'sess-pin' }), CTX));
    const pinned = must(applyUserAction(pinnedSettled.state, session({ vmSessionId: 'sess-pin' }), 'auth-dot', 'pin', CTX));
    const still = must(applyVisibility(
      pinned.state,
      session({ vmSessionId: 'sess-pin' }),
      'auth-dot',
      { kind: 'idle', idleSinceMs: 0 },
      { ...CTX, tsUtcMs: 120_000 },
    ));
    expect(still.value.phase).toBe('focused');
    expect(still.value.pinned).toBe(true);
    const manual = must(applyUserAction(still.state, session({ vmSessionId: 'sess-pin' }), 'auth-dot', 'minimize', CTX));
    expect(manual.value.phase).toBe('minimized');
  });
});

describe('tiling matches the client workspace rules', () => {
  it('places one window, two windows, and a chip without overlap', () => {
    const lone = must(settleOpening(
      must(openWindow(manager(), session({ vmSessionId: 'sess-1' }), CTX)).state,
      session({ vmSessionId: 'sess-1' }),
      CTX,
    ));
    const one = tileWindows(lone.state);
    expect(one.shown).toHaveLength(1);
    expect(one.chips).toHaveLength(0);
    expect(one.shown[0]?.size).toBeCloseTo(1.15, 5);
    const pairState = must(openWindow(lone.state, session({ vmSessionId: 'sess-2', vmNumber: 2 }), CTX)).state;
    const pair = tileWindows(pairState);
    expect(pair.shown).toHaveLength(2);
    expect(pair.shown[0]!.x).toBeLessThan(pair.shown[1]!.x);
    expect(pair.shown[0]!.y).toBeCloseTo(pair.shown[1]!.y, 5);
    const folded = must(applyUserAction(pairState, session({ vmSessionId: 'sess-2', vmNumber: 2 }), 'auth-dot', 'minimize', CTX));
    const layout = tileWindows(folded.state);
    expect(layout.shown.map((item) => item.vmSessionId)).toEqual(['sess-1']);
    expect(layout.chips.map((item) => item.vmSessionId)).toEqual(['sess-2']);
    expect(layout.chips[0]?.dockSlot).toBe(0);
    const again = tileWindows(folded.state);
    expect(again).toEqual(layout);
  });

  it('tiles ten shown windows deterministically', () => {
    let state = manager(12);
    for (let index = 1; index <= 10; index += 1) {
      const opened = must(openWindow(state, session({ vmSessionId: `w${index}`, vmNumber: index }), CTX));
      state = opened.value.phase === 'opening'
        ? must(settleOpening(opened.state, session({ vmSessionId: `w${index}`, vmNumber: index }), CTX)).state
        : opened.state;
    }
    const layout = tileWindows(state);
    expect(layout.shown).toHaveLength(10);
    const ids = layout.shown.map((item) => item.vmSessionId);
    expect(ids).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10']);
    expect(tileWindows(state)).toEqual(layout);
  });
});

describe('persistence', () => {
  it('round-trips and refuses a document that keys a window by number', () => {
    const opened = must(openWindow(manager(), session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
    const raw = serializeWindows(opened.state);
    expect(raw).not.toContain('vmNumber');
    const loaded = deserializeWindows(raw);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.state).toEqual(opened.state);
    const numbered = deserializeWindows(raw.replace('"vmSessionId":"sess-1"', '"vmSessionId":"sess-1","vmNumber":3'));
    expect(numbered.ok).toBe(false);
    if (!numbered.ok) expect(numbered.error.code).toBe('number_is_not_identity');
  });
});

describe('the module does not choose VM numbers or read the clock', () => {
  it('the source only reads vmNumber and stays free of Node', () => {
    const source = readFileSync(new URL('./wonder-web-windows.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bvmNumber\s*=/);
    expect(source).not.toMatch(/lowestFree|nextVmNumber|allocateVm/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/from\s*['"]node:/);
    expect(source).toContain(WONDER_WEB_WINDOWS_CONTRACT);
    expect(WONDER_WEB_WINDOW_CLIENT_ROLE).toBe(WONDERLAND_CLIENT_ROLE);
  });
});

describe('C++ mirror', () => {
  it('prints the same golden report as this module', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..');
    const dir = mkdtempSync(join(tmpdir(), 'ww-logic-'));
    const binary = join(dir, 'wonder-web-window-logic-test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-o',
      binary,
      join(root, 'wonderland/Source/Wonderland/WonderlandWonderWebWindowLogic.cpp'),
      join(root, 'wonderland/Tools/wonder-web-window-logic-test.cpp'),
    ], { stdio: 'pipe' });
    const stdout = execFileSync(binary, { encoding: 'utf8' });
    const line = stdout.trim().split('\n').filter((item) => item.startsWith('{')).at(-1);
    expect(line, stdout).toBeTruthy();
    expect(JSON.parse(line!)).toEqual(goldenReport());
  }, 30_000);
});

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The report the standalone C++ tool must print. Steps are fixed. */
export function goldenReport(): Record<string, unknown> {
  const first = must(openWindow(manager(), session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
  const settled = must(settleOpening(first.state, session({ vmSessionId: 'sess-1', vmNumber: 3 }), CTX));
  const second = must(openWindow(settled.state, session({ vmSessionId: 'sess-2', vmNumber: 4, agentDisplayName: 'Card' }), CTX));
  const closed = must(closePanel(second.state, session({ vmSessionId: 'sess-2', vmNumber: 4, agentDisplayName: 'Card' }), 'auth-dot', CTX));
  const endOpen = must(openWindow(manager(), session({ vmSessionId: 'sess-end' }), CTX));
  const endSettled = must(settleOpening(endOpen.state, session({ vmSessionId: 'sess-end' }), CTX));
  const endPinned = must(applyUserAction(endSettled.state, session({ vmSessionId: 'sess-end' }), 'auth-dot', 'pin', CTX));
  const ended = must(applySession(endPinned.state, session({ vmSessionId: 'sess-end', sessionState: 'ended', endCause: 'idle_timeout' }), CTX));
  let capped = manager();
  for (let index = 1; index <= 6; index += 1) {
    const opened = must(openWindow(capped, session({ vmSessionId: `cap-${index}`, vmNumber: index }), CTX));
    capped = opened.value.phase === 'opening'
      ? must(settleOpening(opened.state, session({ vmSessionId: `cap-${index}`, vmNumber: index }), CTX)).state
      : opened.state;
  }
  const seventh = must(openWindow(capped, session({ vmSessionId: 'cap-7', vmNumber: 7, agentDisplayName: 'Card' }), CTX));
  const lone = tileWindows(settled.state);
  const view = observerView(settled.value, session({ vmSessionId: 'sess-1', vmNumber: 3 }));
  const denied = applyUserAction(
    second.state,
    session({ vmSessionId: 'sess-2', vmNumber: 4, agentDisplayName: 'Card' }),
    'someone-else',
    'close',
    CTX,
  );
  const acceptedCauses: string[] = [];
  for (const cause of SESSION_END_CAUSES) {
    const id = `cause-${cause}`;
    const causeOpen = must(openWindow(manager(), session({ vmSessionId: id }), CTX));
    const causeSettled = must(settleOpening(causeOpen.state, session({ vmSessionId: id }), CTX));
    const causeEnded = must(applySession(
      causeSettled.state,
      session({ vmSessionId: id, sessionState: 'ended', endCause: cause }),
      CTX,
    ));
    acceptedCauses.push(causeEnded.animations[0]?.endCause ?? '');
  }
  const unknownCause = applySession(
    settled.state,
    withUnpublishedCause(session({ vmSessionId: 'sess-1', sessionState: 'ended' }), 'explicit_stop'),
    CTX,
  );
  const runningCause = applySession(
    settled.state,
    session({ vmSessionId: 'sess-1', sessionState: 'running', endCause: 'idle_timeout' }),
    CTX,
  );
  return {
    accent: first.value.accentColorToken,
    causes: acceptedCauses,
    authCode: denied.ok ? '' : denied.error.code,
    browserCode: addressByBrowserId('browser-2').code,
    closeEvents: closed.events.map((item) => item.event),
    closeIntents: closed.animations.map((item) => item.intent),
    contract: WONDER_WEB_WINDOWS_CONTRACT,
    defaultCap: DEFAULT_SHOWN_WINDOW_CAP,
    emptyName: openWindow(manager(), session({ vmSessionId: 'sess-empty', agentDisplayName: '' }), CTX).ok
      ? ''
      : 'agent_display_name_rejected',
    endEvents: ended.events.map((item) => item.event),
    endIntents: ended.animations.map((item) => item.intent),
    endPhase: ended.value.phase,
    endPinned: ended.value.pinned,
    fallback: AGENT_DISPLAY_NAME_FALLBACK,
    firstIntent: first.animations[0]?.intent ?? '',
    lifetime: lifetimeHits(ended).length,
    numberCode: addressByVmNumber(4).code,
    observerKeys: Object.keys(view).sort(),
    observerTitle: view.title,
    secondCamera: second.state.cameraInCloseup,
    secondIntents: second.animations.map((item) => item.intent),
    seventhAdmission: seventh.value.admission,
    seventhIntents: seventh.animations.map((item) => item.intent),
    seventhPhase: seventh.value.phase,
    seventhSession: seventh.value.sessionState,
    runningCause: runningCause.ok ? '' : runningCause.error.code,
    unknownCause: unknownCause.ok ? '' : unknownCause.error.code,
    tile1Size: round6(lone.shown[0]?.size ?? 0).toFixed(6),
    tile1X: round6(lone.shown[0]?.x ?? 0).toFixed(6),
    tile1Y: round6(lone.shown[0]?.y ?? 0).toFixed(6),
    title: formatWindowTitle('Dot', 3),
  };
}
