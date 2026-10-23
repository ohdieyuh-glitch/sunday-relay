/**
 * WONDER WEB WINDOWS — pure presentation decisions for the in-world workspace.
 *
 * Contract: `wonderland-wonder-web-windows.v1`.
 *
 * This module decides what a window is called, which outline token it shows,
 * which phase it is in, where it tiles, and which animation intent Cosmo should
 * play. It does not draw, does not open a socket, and does not talk to a
 * provider. Time arrives as an injected `tsUtcMs`.
 *
 * NUMBERING. `vmNumber` is read off the session record BRIDGE already chose.
 * The only place a number is chosen is BRIDGE's session service under
 * `src/relay/integration/wonder-web-vm/`. This file never chooses, replaces,
 * or stores a number as an identity. The address of a window is `vmSessionId`.
 *
 * SESSION INPUT. The record below is the shape this module consumes. BRIDGE's
 * published session contract is authoritative; if that contract renames a
 * field, adapt this input type to it. `endCause` is carried so a VM-ended
 * animation can name the server's reason. Omit it rather than inventing one.
 *
 * CLIENT. States, tiling and chips are shaped so they can drive the workspace
 * already on `aa930c26` (`WonderlandUiSubsystem.cpp`). The mapping lives in
 * `docs/relay/WONDERLAND_WONDER_WEB_WINDOWS.md`. This module does not include
 * Unreal types.
 */

export const WONDER_WEB_WINDOWS_CONTRACT = 'wonderland-wonder-web-windows.v1' as const;

export const PARENT_TERMINAL_KINDS = ['grok_bot_group', 'openai_companion', 'julius'] as const;
export type ParentTerminalKind = (typeof PARENT_TERMINAL_KINDS)[number];

export const VM_SESSION_STATES = ['provisioning', 'running', 'paused', 'ended', 'failed'] as const;
export type VmSessionState = (typeof VM_SESSION_STATES)[number];

export const LIVE_SESSION_STATES = ['provisioning', 'running', 'paused'] as const;
export type LiveSessionState = (typeof LIVE_SESSION_STATES)[number];

/** Why the server ended the VM. Not inferred from a missing field. */
export const SESSION_END_CAUSES = ['idle_timeout', 'max_lifetime', 'explicit_stop', 'failure'] as const;
export type SessionEndCause = (typeof SESSION_END_CAUSES)[number];

/**
 * Phases a Cosmo workspace can be told to show.
 *
 * `focused` is exclusive (the client's `FocusedWonderWebWindow`). `pinned` is
 * not a phase. `minimized` is the chip: the session keeps running.
 */
export const WINDOW_PHASES = ['opening', 'live', 'minimized', 'focused', 'closing', 'closed'] as const;
export type WindowPhase = (typeof WINDOW_PHASES)[number];

export const SHOWN_PHASES = ['opening', 'live', 'focused'] as const;
export const HELD_PHASES = ['opening', 'live', 'focused', 'minimized'] as const;

export const ANIMATION_INTENTS = [
  'cinematic_closeup',
  'spawn_inline',
  'minimize_fold',
  'restore_unfold',
  'close_anim',
  'camera_return',
  'vm_ended_anim',
] as const;
export type AnimationIntent = (typeof ANIMATION_INTENTS)[number];

export const WONDER_WEB_WINDOW_EVENTS = [
  'ww_window_opened',
  'ww_window_surfaced',
  'ww_window_minimized',
  'ww_window_focused',
  'ww_window_pinned',
  'ww_panel_closed',
  'ww_session_terminated',
] as const;
export type WonderWebWindowEventName = (typeof WONDER_WEB_WINDOW_EVENTS)[number];

/** Matches `WONDERLAND_CLIENT_ROLE`. Passed in on every log line; never read from the environment. */
export const WONDER_WEB_WINDOW_CLIENT_ROLE = 'presentational' as const;

/**
 * Shown windows, not chips. The client default when no entitlement is loaded
 * is 6 (`GetWonderWebWindowLimit`, `WonderlandEntitlements.h`).
 */
export const DEFAULT_SHOWN_WINDOW_CAP = 6;

export const DEFAULT_IDLE_AUTO_MINIMIZE_MS = 60_000;
export const DEFAULT_SURFACE_RATE_LIMIT_MS = 5_000;

/** Used only when a display name is rejected. Deliberately not a provider or terminal name. */
export const AGENT_DISPLAY_NAME_FALLBACK = 'Agent';

export const TITLE_SEPARATOR = ' \u2014 ';

export const ADMISSIONS = ['shown', 'queued_chip'] as const;
export type WindowAdmission = (typeof ADMISSIONS)[number];

/* --------------------------------------------------------------- session */

export interface WonderWebParentTerminal {
  readonly terminalId: string;
  readonly kind: ParentTerminalKind;
  readonly displayName: string;
}

/**
 * Input from BRIDGE. `vmNumber` is displayed and copied into QA lines.
 * It is not an address and it is not chosen here.
 */
export interface WonderWebVmSessionRecord {
  readonly vmSessionId: string;
  readonly agentId: string;
  readonly agentDisplayName: string;
  readonly vmNumber: number;
  readonly terminal: WonderWebParentTerminal;
  readonly accentColorRef: string;
  readonly sessionState: VmSessionState;
  readonly endCause?: SessionEndCause | null;
}

/* ----------------------------------------------------------------- state */

export interface WonderWebWindow {
  readonly vmSessionId: string;
  readonly agentId: string;
  readonly agentDisplayName: string;
  readonly terminalId: string;
  readonly terminalKind: ParentTerminalKind;
  readonly terminalDisplayName: string;
  readonly accentColorToken: string | null;
  readonly phase: WindowPhase;
  readonly pinned: boolean;
  readonly admission: WindowAdmission;
  readonly openedOrder: number;
  readonly openedAtMs: number;
  readonly openAnimation: 'cinematic_closeup' | 'spawn_inline' | null;
  readonly closeAnimation: 'close_anim' | 'vm_ended_anim' | null;
  readonly lastSurfaceAtMs: number | null;
  readonly idleSinceMs: number | null;
  readonly sessionState: VmSessionState;
}

export interface WonderWebWindowManagerState {
  readonly contract: typeof WONDER_WEB_WINDOWS_CONTRACT;
  readonly windowCap: number;
  readonly cameraInCloseup: boolean;
  readonly nextOpenedOrder: number;
  readonly windows: readonly WonderWebWindow[];
}

export interface WonderWebWindowLogContext {
  readonly tsUtcMs: number;
  readonly clientRole: string;
  readonly netId: string;
  readonly buildSha: string;
  readonly corrId: string;
}

export interface WonderWebWindowLogEvent {
  readonly ts_utc_ms: number;
  readonly client_role: string;
  readonly net_id: string;
  readonly build_sha: string;
  readonly corr_id: string;
  readonly event: WonderWebWindowEventName;
  readonly vmSessionId: string;
  /** The session record's vm number at emit time, or null when that record did not carry a usable one. */
  readonly n: number | null;
}

export interface AnimationCue {
  readonly intent: AnimationIntent;
  readonly vmSessionId: string;
  readonly endCause: SessionEndCause | null;
}

export interface WonderWebWindowError {
  readonly code:
    | 'agent_display_name_rejected'
    | 'invalid_session'
    | 'vm_number_unusable'
    | 'session_id_reused'
    | 'session_not_live'
    | 'not_owner'
    | 'window_not_found'
    | 'illegal_phase'
    | 'agent_identity_changed'
    | 'unsupported_contract'
    | 'number_is_not_identity'
    | 'vm_number_not_an_address'
    | 'browser_id_not_an_address'
    | 'session_mismatch'
    | 'window_cap_unusable'
    | 'window_cap_reached'
    | 'invalid_end_cause';
  readonly message: string;
  readonly fallback?: typeof AGENT_DISPLAY_NAME_FALLBACK;
}

export interface WonderWebWindowOk<T> {
  readonly ok: true;
  readonly state: WonderWebWindowManagerState;
  readonly value: T;
  readonly events: readonly WonderWebWindowLogEvent[];
  readonly animations: readonly AnimationCue[];
}

export interface WonderWebWindowRefusal {
  readonly ok: false;
  readonly state: WonderWebWindowManagerState;
  readonly error: WonderWebWindowError;
  readonly events: readonly [];
  readonly animations: readonly [];
}

export type WonderWebWindowResult<T> = WonderWebWindowOk<T> | WonderWebWindowRefusal;

export type VisibilityEvent =
  | { readonly kind: 'progress_milestone' }
  | { readonly kind: 'permission_request' }
  | { readonly kind: 'failure' }
  | { readonly kind: 'result' }
  | { readonly kind: 'idle'; readonly idleSinceMs: number }
  | { readonly kind: 'user_minimize' }
  | { readonly kind: 'user_pin' }
  | { readonly kind: 'user_unpin' }
  | { readonly kind: 'user_focus' };

export interface VisibilityPolicy {
  readonly idleAutoMinimizeMs: number;
  readonly surfaceRateLimitMs: number;
}

export const DEFAULT_VISIBILITY_POLICY: VisibilityPolicy = {
  idleAutoMinimizeMs: DEFAULT_IDLE_AUTO_MINIMIZE_MS,
  surfaceRateLimitMs: DEFAULT_SURFACE_RATE_LIMIT_MS,
};

/* --------------------------------------------------------------- geometry */

/**
 * Defaults measured off `aa930c26` TileWonderWeb and the screen cvars.
 * `halfView` is the null-workspace fallback (`WonderlandWonderWebScreen.cpp`
 * 211 and the tile call's fallback). A live frame should pass `HalfView()`.
 * `pairSize` and `manySize` are literals in TileWonderWeb, not cvars.
 * The chip row on the client multiplies the chip's design height by the
 * literal 0.2, which is also `wl.WonderWeb.ChipScale`'s default.
 */
export interface WorkspaceTileOptions {
  readonly halfView: { readonly x: number; readonly y: number };
  readonly viewAcross: number;
  readonly gap: number;
  readonly hudClearance: number;
  readonly margin: number;
  readonly loneSize: number;
  readonly pairSize: number;
  readonly manySize: number;
  readonly expandedSize: number;
  readonly baseGlass: { readonly x: number; readonly y: number };
  readonly chipDesign: { readonly x: number; readonly y: number };
  readonly chipScale: number;
  readonly keepOut: readonly WorkspaceKeepOut[];
  readonly expandedVmSessionId: string | null;
}

export interface WorkspaceKeepOut {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const CLIENT_WORKSPACE_TILE_DEFAULTS: WorkspaceTileOptions = {
  halfView: { x: 295, y: 166 },
  viewAcross: 16,
  gap: 18,
  hudClearance: 8,
  margin: 10,
  loneSize: 1.15,
  pairSize: 1,
  manySize: 0.9,
  expandedSize: 1.6,
  baseGlass: { x: 240, y: 160 },
  chipDesign: { x: 560, y: 96 },
  chipScale: 0.2,
  keepOut: [],
  expandedVmSessionId: null,
};

export interface TiledWindow {
  readonly vmSessionId: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface ChipPlacement {
  readonly vmSessionId: string;
  readonly dockSlot: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorkspaceLayout {
  readonly shown: readonly TiledWindow[];
  readonly chips: readonly ChipPlacement[];
  readonly tileArea: WorkspaceKeepOut | null;
}

export interface StatusIndicator {
  readonly vmSessionId: string;
  readonly ownerName: string;
  readonly outlineColorToken: string | null;
  readonly title: string | null;
  readonly status: 'minimized';
  readonly dockSlot: number;
}

export interface ObserverView {
  readonly outlineColorToken: string | null;
  readonly ownerName: string;
  readonly title: string | null;
  readonly status: WindowPhase;
}

export const OBSERVER_VIEW_KEYS = ['outlineColorToken', 'ownerName', 'title', 'status'] as const;

/* ------------------------------------------------------------- predicates */

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isUsableVmNumber(value: unknown): value is number {
  return isPositiveInt(value);
}

/** Client pool is `browser` and `browser-2`..`browser-12`. The whole `browser` / `browser-N` shape is refused. */
export function isLegacyBrowserId(id: string): boolean {
  return id === 'browser' || /^browser-\d+$/.test(id);
}

export function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

export function resolveAgentDisplayName(
  raw: string,
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly fallback: typeof AGENT_DISPLAY_NAME_FALLBACK; readonly reason: string } {
  if (typeof raw !== 'string' || hasControlChar(raw)) {
    return { ok: false, fallback: AGENT_DISPLAY_NAME_FALLBACK, reason: 'Display name is empty or contains a control character.' };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, fallback: AGENT_DISPLAY_NAME_FALLBACK, reason: 'Display name is empty or contains a control character.' };
  }
  return { ok: true, name };
}

/**
 * Title is the agent name and the session's number. A rejected name becomes
 * `Agent`, never the terminal kind or a provider label. An unusable number
 * yields null rather than a stand-in.
 */
export function formatWindowTitle(agentDisplayName: string, vmNumber: number): string | null {
  if (!isUsableVmNumber(vmNumber)) return null;
  const resolved = resolveAgentDisplayName(agentDisplayName);
  const name = resolved.ok ? resolved.name : resolved.fallback;
  return `${name}${TITLE_SEPARATOR}Wonder Web VM ${vmNumber}`;
}

export function accentTokenFromRef(accentColorRef: string): string | null {
  if (typeof accentColorRef !== 'string' || hasControlChar(accentColorRef)) return null;
  const token = accentColorRef.trim();
  return token.length === 0 ? null : token;
}

export function addressByVmNumber(_vmNumber: number): WonderWebWindowError {
  return {
    code: 'vm_number_not_an_address',
    message: 'vmNumber is a display value from the session record. It cannot address a window.',
  };
}

export function addressByBrowserId(_browserId: string): WonderWebWindowError {
  return {
    code: 'browser_id_not_an_address',
    message: 'A browser or browser-N id cannot address a window. Identity is vmSessionId.',
  };
}

export function isShownPhase(phase: WindowPhase): boolean {
  return phase === 'opening' || phase === 'live' || phase === 'focused';
}

export function isHeldPhase(phase: WindowPhase): boolean {
  return isShownPhase(phase) || phase === 'minimized';
}

export function isLiveSessionState(state: VmSessionState): state is LiveSessionState {
  return state === 'provisioning' || state === 'running' || state === 'paused';
}

export function windowBySession(
  state: WonderWebWindowManagerState,
  vmSessionId: string,
): WonderWebWindow | null {
  return state.windows.find((window) => window.vmSessionId === vmSessionId) ?? null;
}

export function authorizeWindowAction(window: WonderWebWindow, actorAgentId: string): boolean {
  return actorAgentId === window.agentId;
}

/* ----------------------------------------------------------------- create */

export function createWindowManager(options?: { readonly windowCap?: number }):
  | { readonly ok: true; readonly state: WonderWebWindowManagerState }
  | { readonly ok: false; readonly error: WonderWebWindowError } {
  const requested = options?.windowCap;
  if (requested !== undefined && !isPositiveInt(requested)) {
    return {
      ok: false,
      error: { code: 'window_cap_unusable', message: 'Shown-window cap must be a positive integer.' },
    };
  }
  return {
    ok: true,
    state: {
      contract: WONDER_WEB_WINDOWS_CONTRACT,
      windowCap: requested ?? DEFAULT_SHOWN_WINDOW_CAP,
      cameraInCloseup: false,
      nextOpenedOrder: 1,
      windows: [],
    },
  };
}

/* ------------------------------------------------------------------- logs */

function logEvent(
  ctx: WonderWebWindowLogContext,
  event: WonderWebWindowEventName,
  vmSessionId: string,
  session: WonderWebVmSessionRecord | null,
): WonderWebWindowLogEvent {
  const n = session !== null && session.vmSessionId === vmSessionId && isUsableVmNumber(session.vmNumber)
    ? session.vmNumber
    : null;
  return {
    ts_utc_ms: ctx.tsUtcMs,
    client_role: ctx.clientRole,
    net_id: ctx.netId,
    build_sha: ctx.buildSha,
    corr_id: ctx.corrId,
    event,
    vmSessionId,
    n,
  };
}

export function formatLogLine(event: WonderWebWindowLogEvent): string {
  return canonicalStringify(event);
}

function refuse<T>(state: WonderWebWindowManagerState, error: WonderWebWindowError): WonderWebWindowRefusal {
  return { ok: false, state, error, events: [], animations: [] };
}

function succeed<T>(
  state: WonderWebWindowManagerState,
  value: T,
  events: readonly WonderWebWindowLogEvent[],
  animations: readonly AnimationCue[],
): WonderWebWindowOk<T> {
  return { ok: true, state, value, events, animations };
}

function cue(intent: AnimationIntent, vmSessionId: string, endCause: SessionEndCause | null = null): AnimationCue {
  return { intent, vmSessionId, endCause };
}

/* --------------------------------------------------------------- validate */

function validateSession(session: WonderWebVmSessionRecord, requireLiveNumber: boolean): WonderWebWindowError | null {
  if (session === null || typeof session !== 'object') {
    return { code: 'invalid_session', message: 'Session record is missing.' };
  }
  if (typeof session.vmSessionId !== 'string' || session.vmSessionId.trim().length === 0 || hasControlChar(session.vmSessionId)) {
    return { code: 'invalid_session', message: 'vmSessionId is missing.' };
  }
  if (isLegacyBrowserId(session.vmSessionId)) {
    return { code: 'browser_id_not_an_address', message: 'vmSessionId must not be a browser or browser-N id.' };
  }
  if (typeof session.agentId !== 'string' || session.agentId.trim().length === 0 || hasControlChar(session.agentId)) {
    return { code: 'invalid_session', message: 'agentId is missing.' };
  }
  if (!(PARENT_TERMINAL_KINDS as readonly string[]).includes(session.terminal?.kind)) {
    return { code: 'invalid_session', message: 'Terminal kind is not one of the parent terminals.' };
  }
  if (typeof session.terminal.terminalId !== 'string' || session.terminal.terminalId.trim().length === 0 || hasControlChar(session.terminal.terminalId)) {
    return { code: 'invalid_session', message: 'terminalId is missing.' };
  }
  if (typeof session.terminal.displayName !== 'string' || hasControlChar(session.terminal.displayName)) {
    return { code: 'invalid_session', message: 'Terminal display name is unusable.' };
  }
  if (!(VM_SESSION_STATES as readonly string[]).includes(session.sessionState)) {
    return { code: 'invalid_session', message: 'sessionState is not a known VM state.' };
  }
  if (session.endCause !== undefined && session.endCause !== null && !(SESSION_END_CAUSES as readonly string[]).includes(session.endCause)) {
    return { code: 'invalid_end_cause', message: 'endCause is not a known server reason.' };
  }
  if (requireLiveNumber && !isUsableVmNumber(session.vmNumber)) {
    return { code: 'vm_number_unusable', message: 'vmNumber must be a positive integer supplied by the session record.' };
  }
  return null;
}

function contextError(ctx: WonderWebWindowLogContext): WonderWebWindowError | null {
  if (typeof ctx.tsUtcMs !== 'number' || !Number.isFinite(ctx.tsUtcMs)) {
    return { code: 'invalid_session', message: 'tsUtcMs must be injected.' };
  }
  return null;
}

/* ------------------------------------------------------------------- open */

function shownCount(windows: readonly WonderWebWindow[]): number {
  return windows.filter((window) => isShownPhase(window.phase)).length;
}

function heldCount(windows: readonly WonderWebWindow[]): number {
  return windows.filter((window) => isHeldPhase(window.phase)).length;
}

function replaceWindow(windows: readonly WonderWebWindow[], next: WonderWebWindow): WonderWebWindow[] {
  return windows.map((window) => (window.vmSessionId === next.vmSessionId ? next : window));
}

function demoteFocus(windows: readonly WonderWebWindow[], exceptId: string): WonderWebWindow[] {
  return windows.map((window) => (
    window.vmSessionId !== exceptId && window.phase === 'focused'
      ? { ...window, phase: 'live' }
      : window
  ));
}

function mostRecentShown(windows: readonly WonderWebWindow[], exceptId: string): WonderWebWindow | null {
  let best: WonderWebWindow | null = null;
  for (const window of windows) {
    if (window.vmSessionId === exceptId || !isShownPhase(window.phase)) continue;
    if (best === null || window.openedOrder > best.openedOrder) best = window;
  }
  return best;
}

function focusMostRecent(
  windows: WonderWebWindow[],
  exceptId: string,
  ctx: WonderWebWindowLogContext,
  sessionFor: (id: string) => WonderWebVmSessionRecord | null,
  events: WonderWebWindowLogEvent[],
): WonderWebWindow[] {
  const next = mostRecentShown(windows, exceptId);
  if (next === null || next.phase === 'focused') return windows;
  events.push(logEvent(ctx, 'ww_window_focused', next.vmSessionId, sessionFor(next.vmSessionId)));
  return replaceWindow(demoteFocus(windows, next.vmSessionId), { ...next, phase: 'focused' });
}

export function openWindow(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  const ctxError = contextError(ctx);
  if (ctxError) return refuse(state, ctxError);
  const invalid = validateSession(session, true);
  if (invalid) return refuse(state, invalid);
  const named = resolveAgentDisplayName(session.agentDisplayName);
  if (!named.ok) {
    return refuse(state, {
      code: 'agent_display_name_rejected',
      message: named.reason,
      fallback: named.fallback,
    });
  }
  if (!isLiveSessionState(session.sessionState)) {
    return refuse(state, { code: 'session_not_live', message: 'A window opens only for a provisioning, running, or paused session.' });
  }

  const existing = windowBySession(state, session.vmSessionId);
  if (existing !== null) {
    if (existing.agentId !== session.agentId) {
      return refuse(state, { code: 'agent_identity_changed', message: 'agentId on a vmSessionId does not change.' });
    }
    if (existing.phase === 'closed') {
      if (!isLiveSessionState(existing.sessionState)) {
        return refuse(state, { code: 'session_id_reused', message: 'vmSessionId is never reused after the session ends.' });
      }
      return admit(state, session, ctx, named.name, existing);
    }
    if (existing.phase === 'closing') {
      return refuse(state, { code: 'illegal_phase', message: 'The panel is still closing.' });
    }
    if (existing.phase === 'minimized') {
      return restoreWindow(state, existing, session, ctx, false);
    }
    return focusWindow(state, existing, session, ctx, false);
  }

  return admit(state, session, ctx, named.name, null);
}

function admit(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
  agentDisplayName: string,
  previous: WonderWebWindow | null,
): WonderWebWindowOk<WonderWebWindow> {
  const others = previous === null
    ? state.windows
    : state.windows.filter((window) => window.vmSessionId !== previous.vmSessionId);
  const queued = shownCount(others) >= state.windowCap;
  const otherHeld = others.some((window) => isHeldPhase(window.phase));
  const openAnimation = queued ? null : otherHeld ? 'spawn_inline' : 'cinematic_closeup';
  const openedOrder = previous?.openedOrder ?? state.nextOpenedOrder;
  const window: WonderWebWindow = {
    vmSessionId: session.vmSessionId,
    agentId: session.agentId,
    agentDisplayName,
    terminalId: session.terminal.terminalId,
    terminalKind: session.terminal.kind,
    terminalDisplayName: session.terminal.displayName,
    accentColorToken: accentTokenFromRef(session.accentColorRef),
    phase: queued ? 'minimized' : 'opening',
    pinned: previous?.pinned ?? false,
    admission: queued ? 'queued_chip' : 'shown',
    openedOrder,
    openedAtMs: previous?.openedAtMs ?? ctx.tsUtcMs,
    openAnimation,
    closeAnimation: null,
    lastSurfaceAtMs: previous?.lastSurfaceAtMs ?? null,
    idleSinceMs: null,
    sessionState: session.sessionState,
  };
  const events = [logEvent(ctx, 'ww_window_opened', window.vmSessionId, session)];
  if (queued) events.push(logEvent(ctx, 'ww_window_minimized', window.vmSessionId, session));
  const animations: AnimationCue[] = [];
  let cameraInCloseup = state.cameraInCloseup;
  if (openAnimation === 'cinematic_closeup') {
    animations.push(cue('cinematic_closeup', window.vmSessionId));
    cameraInCloseup = true;
  } else if (openAnimation === 'spawn_inline') {
    animations.push(cue('spawn_inline', window.vmSessionId));
  }
  const windows = previous === null
    ? [...state.windows, window]
    : replaceWindow(state.windows, window);
  return succeed(
    {
      ...state,
      cameraInCloseup,
      nextOpenedOrder: previous === null ? state.nextOpenedOrder + 1 : state.nextOpenedOrder,
      windows,
    },
    window,
    events,
    animations,
  );
}

export function settleOpening(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  const ctxError = contextError(ctx);
  if (ctxError) return refuse(state, ctxError);
  const window = windowBySession(state, session.vmSessionId);
  if (window === null) return refuse(state, { code: 'window_not_found', message: 'No window for that vmSessionId.' });
  if (session.vmSessionId !== window.vmSessionId) {
    return refuse(state, { code: 'session_mismatch', message: 'Session record does not match the window.' });
  }
  if (window.phase !== 'opening') {
    return refuse(state, { code: 'illegal_phase', message: 'Only an opening window settles.' });
  }
  const next: WonderWebWindow = { ...window, phase: 'focused' };
  const windows = replaceWindow(demoteFocus(state.windows, window.vmSessionId), next);
  return succeed(
    { ...state, windows },
    next,
    [logEvent(ctx, 'ww_window_focused', window.vmSessionId, session)],
    [],
  );
}

/* ------------------------------------------------------------------ close */

function finishClose(
  state: WonderWebWindowManagerState,
  window: WonderWebWindow,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
  kind: 'panel' | 'session',
): WonderWebWindowOk<WonderWebWindow> {
  const endCause = kind === 'session' ? (session.endCause ?? null) : null;
  const closeAnimation = kind === 'session' ? 'vm_ended_anim' : 'close_anim';
  const next: WonderWebWindow = {
    ...window,
    phase: 'closing',
    closeAnimation,
    sessionState: kind === 'session' ? session.sessionState : window.sessionState,
  };
  let windows = replaceWindow(state.windows, next);
  const events: WonderWebWindowLogEvent[] = [];
  const animations: AnimationCue[] = [];
  if (kind === 'session') {
    events.push(logEvent(ctx, 'ww_session_terminated', window.vmSessionId, session));
    animations.push(cue('vm_ended_anim', window.vmSessionId, endCause));
  } else {
    animations.push(cue('close_anim', window.vmSessionId));
  }
  events.push(logEvent(ctx, 'ww_panel_closed', window.vmSessionId, session));
  if (window.phase === 'focused') {
    const moved: WonderWebWindowLogEvent[] = [];
    windows = focusMostRecent(windows, window.vmSessionId, ctx, () => null, moved);
    events.push(...moved);
  }
  let cameraInCloseup = state.cameraInCloseup;
  if (heldCount(windows) === 0 && cameraInCloseup) {
    animations.push(cue('camera_return', window.vmSessionId));
    cameraInCloseup = false;
  }
  return succeed({ ...state, cameraInCloseup, windows }, next, events, animations);
}

export function closePanel(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  actorAgentId: string,
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  const ready = readyMutation(state, session, actorAgentId, ctx, false);
  if (!ready.ok) return ready;
  const window = ready.window;
  if (window.phase === 'closed') {
    return refuse(state, { code: 'illegal_phase', message: 'The panel is already closed.' });
  }
  if (window.phase === 'closing') return succeed(state, window, [], []);
  return finishClose(state, window, session, ctx, 'panel');
}

export function settleClosing(
  state: WonderWebWindowManagerState,
  vmSessionId: string,
): WonderWebWindowResult<WonderWebWindow> {
  const window = windowBySession(state, vmSessionId);
  if (window === null) return refuse(state, { code: 'window_not_found', message: 'No window for that vmSessionId.' });
  if (window.phase !== 'closing') {
    return refuse(state, { code: 'illegal_phase', message: 'Only a closing panel settles.' });
  }
  const next: WonderWebWindow = { ...window, phase: 'closed' };
  return succeed({ ...state, windows: replaceWindow(state.windows, next) }, next, [], []);
}

export function applySession(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  const ctxError = contextError(ctx);
  if (ctxError) return refuse(state, ctxError);
  const invalid = validateSession(session, false);
  if (invalid) return refuse(state, invalid);
  const window = windowBySession(state, session.vmSessionId);
  if (window === null) return refuse(state, { code: 'window_not_found', message: 'No window for that vmSessionId.' });
  if (window.agentId !== session.agentId) {
    return refuse(state, { code: 'agent_identity_changed', message: 'agentId on a vmSessionId does not change.' });
  }
  const named = resolveAgentDisplayName(session.agentDisplayName);
  const patched: WonderWebWindow = {
    ...window,
    agentDisplayName: named.ok ? named.name : window.agentDisplayName,
    terminalId: session.terminal.terminalId,
    terminalKind: session.terminal.kind,
    terminalDisplayName: session.terminal.displayName,
    accentColorToken: accentTokenFromRef(session.accentColorRef),
    sessionState: session.sessionState,
  };
  if (isLiveSessionState(session.sessionState) && !isLiveSessionState(window.sessionState)) {
    return refuse(state, { code: 'session_id_reused', message: 'vmSessionId is never reused after the session ends.' });
  }
  if (!isLiveSessionState(session.sessionState)) {
    if (!isLiveSessionState(window.sessionState)) return succeed(state, window, [], []);
    if (patched.phase === 'closed' || patched.phase === 'closing') {
      const next = { ...patched };
      return succeed(
        { ...state, windows: replaceWindow(state.windows, next) },
        next,
        [logEvent(ctx, 'ww_session_terminated', window.vmSessionId, session)],
        [],
      );
    }
    return finishClose({ ...state, windows: replaceWindow(state.windows, patched) }, patched, session, ctx, 'session');
  }
  const next = patched;
  return succeed({ ...state, windows: replaceWindow(state.windows, next) }, next, [], []);
}

/* --------------------------------------------------------------- actions */

function readyMutation(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  actorAgentId: string,
  ctx: WonderWebWindowLogContext,
  requireUsableNumber: boolean,
): { readonly ok: true; readonly window: WonderWebWindow } | WonderWebWindowRefusal {
  const ctxError = contextError(ctx);
  if (ctxError) return refuse(state, ctxError);
  const invalid = validateSession(session, requireUsableNumber);
  if (invalid) return refuse(state, invalid);
  const window = windowBySession(state, session.vmSessionId);
  if (window === null) return refuse(state, { code: 'window_not_found', message: 'No window for that vmSessionId.' });
  if (session.agentId !== window.agentId) {
    return refuse(state, { code: 'agent_identity_changed', message: 'agentId on a vmSessionId does not change.' });
  }
  if (!authorizeWindowAction(window, actorAgentId)) {
    return refuse(state, { code: 'not_owner', message: 'The action is authorized by agentId, not by display name or colour.' });
  }
  return { ok: true, window };
}

function focusWindow(
  state: WonderWebWindowManagerState,
  window: WonderWebWindow,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
  fromMinimized: boolean,
): WonderWebWindowResult<WonderWebWindow> {
  if (window.phase === 'closed' || window.phase === 'closing') {
    return refuse(state, { code: 'illegal_phase', message: 'A closed panel cannot take focus.' });
  }
  if (window.phase === 'focused' && !fromMinimized) return succeed(state, window, [], []);
  const next: WonderWebWindow = {
    ...window,
    phase: 'focused',
    admission: 'shown',
    sessionState: session.sessionState,
  };
  const windows = replaceWindow(demoteFocus(state.windows, window.vmSessionId), next);
  const events = [logEvent(ctx, 'ww_window_focused', window.vmSessionId, session)];
  const animations: AnimationCue[] = [];
  if (fromMinimized) {
    events.unshift(logEvent(ctx, 'ww_window_surfaced', window.vmSessionId, session));
    animations.push(cue('restore_unfold', window.vmSessionId));
  }
  return succeed({ ...state, windows }, next, events, animations);
}

function restoreWindow(
  state: WonderWebWindowManagerState,
  window: WonderWebWindow,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
  respectCap: boolean,
): WonderWebWindowResult<WonderWebWindow> {
  if (respectCap && shownCount(state.windows) >= state.windowCap) {
    return refuse(state, {
      code: 'window_cap_reached',
      message: 'The shown-window cap is full. The session keeps running as a chip.',
    });
  }
  const stamped = { ...window, lastSurfaceAtMs: ctx.tsUtcMs };
  return focusWindow({ ...state, windows: replaceWindow(state.windows, stamped) }, stamped, session, ctx, true);
}

function minimizeWindow(
  state: WonderWebWindowManagerState,
  window: WonderWebWindow,
  session: WonderWebVmSessionRecord,
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  if (window.phase === 'closed' || window.phase === 'closing') {
    return refuse(state, { code: 'illegal_phase', message: 'A closed panel cannot minimize.' });
  }
  if (window.phase === 'minimized') return succeed(state, window, [], []);
  const next: WonderWebWindow = { ...window, phase: 'minimized', admission: 'queued_chip' };
  let windows = replaceWindow(state.windows, next);
  const events = [logEvent(ctx, 'ww_window_minimized', window.vmSessionId, session)];
  if (window.phase === 'focused') {
    windows = focusMostRecent(windows, window.vmSessionId, ctx, () => null, events);
  }
  return succeed(
    { ...state, windows },
    next,
    events,
    [cue('minimize_fold', window.vmSessionId)],
  );
}

export function applyUserAction(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  actorAgentId: string,
  action: 'focus' | 'minimize' | 'pin' | 'unpin' | 'close',
  ctx: WonderWebWindowLogContext,
): WonderWebWindowResult<WonderWebWindow> {
  const kind: VisibilityEvent['kind'] = action === 'focus'
    ? 'user_focus'
    : action === 'minimize'
      ? 'user_minimize'
      : action === 'pin'
        ? 'user_pin'
        : action === 'unpin'
          ? 'user_unpin'
          : 'user_minimize';
  if (action === 'close') return closePanel(state, session, actorAgentId, ctx);
  return applyVisibility(state, session, actorAgentId, { kind }, ctx);
}

export function applyVisibility(
  state: WonderWebWindowManagerState,
  session: WonderWebVmSessionRecord,
  actorAgentId: string,
  event: VisibilityEvent,
  ctx: WonderWebWindowLogContext,
  policy: VisibilityPolicy = DEFAULT_VISIBILITY_POLICY,
): WonderWebWindowResult<WonderWebWindow> {
  const ready = readyMutation(state, session, actorAgentId, ctx, false);
  if (!ready.ok) return ready;
  const window = ready.window;
  if (window.phase === 'closed' || window.phase === 'closing') {
    return refuse(state, { code: 'illegal_phase', message: 'The panel is not on the workspace.' });
  }

  if (event.kind === 'user_pin') {
    if (window.pinned) return succeed(state, window, [], []);
    const next = { ...window, pinned: true };
    return succeed(
      { ...state, windows: replaceWindow(state.windows, next) },
      next,
      [logEvent(ctx, 'ww_window_pinned', window.vmSessionId, session)],
      [],
    );
  }
  if (event.kind === 'user_unpin') {
    if (!window.pinned) return succeed(state, window, [], []);
    const next = { ...window, pinned: false };
    return succeed({ ...state, windows: replaceWindow(state.windows, next) }, next, [], []);
  }
  if (event.kind === 'user_minimize') return minimizeWindow(state, window, session, ctx);
  if (event.kind === 'user_focus') {
    if (window.phase === 'minimized') return restoreWindow(state, window, session, ctx, true);
    return focusWindow(state, window, session, ctx, false);
  }
  if (event.kind === 'idle') {
    const stamped = { ...window, idleSinceMs: event.idleSinceMs };
    const elapsed = ctx.tsUtcMs - event.idleSinceMs;
    if (window.pinned || !isShownPhase(window.phase) || elapsed < policy.idleAutoMinimizeMs) {
      return succeed({ ...state, windows: replaceWindow(state.windows, stamped) }, stamped, [], []);
    }
    return minimizeWindow({ ...state, windows: replaceWindow(state.windows, stamped) }, stamped, session, ctx);
  }

  const urgent = event.kind === 'permission_request' || event.kind === 'failure' || event.kind === 'result';
  if (window.phase !== 'minimized') {
    if (urgent && window.phase !== 'focused') return focusWindow(state, window, session, ctx, false);
    return succeed(state, window, [], []);
  }
  if (!urgent) {
    const last = window.lastSurfaceAtMs;
    if (last !== null && ctx.tsUtcMs - last < policy.surfaceRateLimitMs) {
      return succeed(state, window, [], []);
    }
    if (shownCount(state.windows) >= state.windowCap) return succeed(state, window, [], []);
  }
  return restoreWindow(state, window, session, ctx, false);
}

/* ------------------------------------------------------------- projection */

export function displayedTitle(window: WonderWebWindow, session: WonderWebVmSessionRecord | null): string | null {
  if (session === null || session.vmSessionId !== window.vmSessionId) return null;
  return formatWindowTitle(window.agentDisplayName, session.vmNumber);
}

export function observerView(window: WonderWebWindow, session: WonderWebVmSessionRecord | null): ObserverView {
  return {
    outlineColorToken: window.accentColorToken,
    ownerName: window.agentDisplayName,
    title: displayedTitle(window, session),
    status: window.phase,
  };
}

export function statusIndicators(
  state: WonderWebWindowManagerState,
  sessions: readonly WonderWebVmSessionRecord[],
): readonly StatusIndicator[] {
  const byId = new Map(sessions.map((session) => [session.vmSessionId, session]));
  return state.windows
    .filter((window) => window.phase === 'minimized')
    .slice()
    .sort((a, b) => a.openedOrder - b.openedOrder || a.vmSessionId.localeCompare(b.vmSessionId))
    .map((window, dockSlot) => {
      const session = byId.get(window.vmSessionId) ?? null;
      return {
        vmSessionId: window.vmSessionId,
        ownerName: window.agentDisplayName,
        outlineColorToken: window.accentColorToken,
        title: displayedTitle(window, session),
        status: 'minimized' as const,
        dockSlot,
      };
    });
}

/* ------------------------------------------------------------------- tile */

function byOpenedOrder(a: WonderWebWindow, b: WonderWebWindow): number {
  return a.openedOrder - b.openedOrder || (a.vmSessionId < b.vmSessionId ? -1 : a.vmSessionId > b.vmSessionId ? 1 : 0);
}

export function tileWindows(
  state: WonderWebWindowManagerState,
  options?: Partial<WorkspaceTileOptions>,
): WorkspaceLayout {
  const opt: WorkspaceTileOptions = { ...CLIENT_WORKSPACE_TILE_DEFAULTS, ...options, keepOut: options?.keepOut ?? CLIENT_WORKSPACE_TILE_DEFAULTS.keepOut };
  const shown = state.windows.filter((window) => isShownPhase(window.phase)).slice().sort(byOpenedOrder);
  const folded = state.windows.filter((window) => window.phase === 'minimized').slice().sort(byOpenedOrder);
  const half = opt.halfView;
  const chips: ChipPlacement[] = folded.map((window, index) => {
    const width = opt.chipDesign.x * opt.chipScale;
    const height = opt.chipDesign.y * opt.chipScale;
    return {
      vmSessionId: window.vmSessionId,
      dockSlot: index,
      x: -half.x + opt.margin + width * 0.5 + index * (width + 6),
      y: -half.y + opt.margin + height * 0.5,
      width,
      height,
    };
  });
  if (shown.length === 0 || opt.baseGlass.x <= 0 || opt.baseGlass.y <= 0 || half.x <= 0 || half.y <= 0) {
    return { shown: [], chips, tileArea: null };
  }

  const gap = Math.max(opt.gap, 0);
  const clearX = Math.max(opt.hudClearance, 0) / (2 * half.x);
  const clearY = Math.max(opt.hudClearance, 0) / (2 * half.y);
  const marginX = opt.margin / (2 * half.x);
  const marginY = opt.margin / (2 * half.y);
  const chipRow = folded.length > 0 ? (opt.chipDesign.y * opt.chipScale + 12) / (2 * half.y) : 0;
  const bottom = 1 - marginY - chipRow;
  let belowTop = marginY;
  for (const box of opt.keepOut) {
    if (box.minY < 0.5) belowTop = Math.max(belowTop, box.maxY + clearY);
  }
  const areas: WorkspaceKeepOut[] = [{ minX: marginX, minY: belowTop, maxX: 1 - marginX, maxY: bottom }];
  let left = marginX;
  let right = 1 - marginX;
  for (const box of opt.keepOut) {
    if (box.maxX < 0.5) left = Math.max(left, box.maxX + clearX);
    else if (box.minX > 0.5) right = Math.min(right, box.minX - clearX);
  }
  let top = marginY;
  for (const box of opt.keepOut) {
    if (box.maxX > left && box.minX < right && box.minY < 0.5) top = Math.max(top, box.maxY + clearY);
  }
  if (right > left && bottom > top) areas.push({ minX: left, minY: top, maxX: right, maxY: bottom });

  const areaUu = (area: WorkspaceKeepOut) => ({
    x: (area.maxX - area.minX) * 2 * half.x,
    y: (area.maxY - area.minY) * 2 * half.y,
  });
  const centreUu = (area: WorkspaceKeepOut) => ({
    x: ((area.minX + area.maxX) * 0.5 - 0.5) * 2 * half.x + opt.viewAcross,
    y: (0.5 - (area.minY + area.maxY) * 0.5) * 2 * half.y,
  });
  const fit = (area: WorkspaceKeepOut, across: number, down: number, want: number) => {
    const room = areaUu(area);
    return Math.min(want, (room.x - gap * (across - 1)) / (opt.baseGlass.x * across), (room.y - gap * (down - 1)) / (opt.baseGlass.y * down));
  };

  const count = shown.length;
  const want = count === 1 ? opt.loneSize : count === 2 ? opt.pairSize : opt.manySize;
  let bestSize = -1;
  let bestArea = 0;
  let bestAcross = count;
  for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
    for (let across = count; across >= 1; across -= 1) {
      const down = Math.ceil(count / across);
      const size = fit(areas[areaIndex]!, across, down, want);
      if (size > bestSize + 0.01) {
        bestSize = size;
        bestArea = areaIndex;
        bestAcross = across;
      }
    }
  }
  const area = areas[bestArea]!;
  const size = Math.max(bestSize, 0.3);
  const down = Math.ceil(count / bestAcross);
  const centre = centreUu(area);
  const cellX = opt.baseGlass.x * size + gap;
  const cellY = opt.baseGlass.y * size + gap;
  const placed: TiledWindow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / bestAcross);
    const inRow = row < down - 1 ? bestAcross : count - bestAcross * (down - 1);
    const column = index % bestAcross;
    placed.push({
      vmSessionId: shown[index]!.vmSessionId,
      x: centre.x + (column - (inRow - 1) * 0.5) * cellX,
      y: centre.y + ((down - 1) * 0.5 - row) * cellY,
      size,
      width: opt.baseGlass.x * size,
      height: opt.baseGlass.y * size,
    });
  }
  if (opt.expandedVmSessionId !== null) {
    const targetIndex = placed.findIndex((place) => place.vmSessionId === opt.expandedVmSessionId);
    if (targetIndex >= 0) {
      let expandedSize = -1;
      let expandedArea = 0;
      for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
        const candidate = fit(areas[areaIndex]!, 1, 1, opt.expandedSize);
        if (candidate > expandedSize) {
          expandedSize = candidate;
          expandedArea = areaIndex;
        }
      }
      const expandedCentre = centreUu(areas[expandedArea]!);
      const grown = Math.max(expandedSize, 0.3);
      const current = placed[targetIndex]!;
      placed[targetIndex] = {
        ...current,
        x: expandedCentre.x,
        y: expandedCentre.y,
        size: grown,
        width: opt.baseGlass.x * grown,
        height: opt.baseGlass.y * grown,
      };
    }
  }
  return { shown: placed, chips, tileArea: area };
}

/* ------------------------------------------------------------ persistence */

const WINDOW_KEYS = [
  'accentColorToken',
  'admission',
  'agentDisplayName',
  'agentId',
  'closeAnimation',
  'idleSinceMs',
  'lastSurfaceAtMs',
  'openAnimation',
  'openedAtMs',
  'openedOrder',
  'phase',
  'pinned',
  'sessionState',
  'terminalDisplayName',
  'terminalId',
  'terminalKind',
  'vmSessionId',
] as const;

export function serializeWindows(state: WonderWebWindowManagerState): string {
  const windows = state.windows.map((window) => {
    const record: Record<string, unknown> = {};
    for (const key of WINDOW_KEYS) record[key] = window[key];
    return record;
  });
  return canonicalStringify({
    cameraInCloseup: state.cameraInCloseup,
    contract: state.contract,
    nextOpenedOrder: state.nextOpenedOrder,
    windowCap: state.windowCap,
    windows,
  });
}

export function deserializeWindows(json: string): WonderWebWindowResult<WonderWebWindowManagerState> {
  const empty = createWindowManager();
  const base = empty.ok ? empty.state : {
    contract: WONDER_WEB_WINDOWS_CONTRACT,
    windowCap: DEFAULT_SHOWN_WINDOW_CAP,
    cameraInCloseup: false,
    nextOpenedOrder: 1,
    windows: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return refuse(base, { code: 'unsupported_contract', message: 'Window state is not JSON.' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse(base, { code: 'unsupported_contract', message: 'Window state is not a document.' });
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.contract !== WONDER_WEB_WINDOWS_CONTRACT) {
    return refuse(base, { code: 'unsupported_contract', message: 'Window contract is not this build.' });
  }
  if ('vmNumber' in doc || 'n' in doc) {
    return refuse(base, { code: 'number_is_not_identity', message: 'A VM number is not part of window identity.' });
  }
  if (!isPositiveInt(doc.windowCap) || typeof doc.cameraInCloseup !== 'boolean' || !isPositiveInt(doc.nextOpenedOrder)) {
    return refuse(base, { code: 'unsupported_contract', message: 'Window manager fields are incomplete.' });
  }
  if (!Array.isArray(doc.windows)) {
    return refuse(base, { code: 'unsupported_contract', message: 'Windows are not a list.' });
  }
  const windows: WonderWebWindow[] = [];
  const seen = new Set<string>();
  for (const raw of doc.windows) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return refuse(base, { code: 'unsupported_contract', message: 'A window record is not an object.' });
    }
    const row = raw as Record<string, unknown>;
    if ('vmNumber' in row || 'n' in row || 'browserId' in row) {
      return refuse(base, { code: 'number_is_not_identity', message: 'A window record must not carry a number or browser id.' });
    }
    const extra = Object.keys(row).filter((key) => !(WINDOW_KEYS as readonly string[]).includes(key));
    if (extra.length > 0) {
      return refuse(base, { code: 'unsupported_contract', message: 'A window record has a field this contract does not know.' });
    }
    if (typeof row.vmSessionId !== 'string' || row.vmSessionId.length === 0) {
      return refuse(base, { code: 'unsupported_contract', message: 'A window is missing vmSessionId.' });
    }
    if (isLegacyBrowserId(row.vmSessionId)) {
      return refuse(base, { code: 'browser_id_not_an_address', message: 'Window identity must not be a browser or browser-N id.' });
    }
    if (seen.has(row.vmSessionId)) {
      return refuse(base, { code: 'unsupported_contract', message: 'vmSessionId appears twice.' });
    }
    if (!WINDOW_PHASES.includes(row.phase as WindowPhase)) {
      return refuse(base, { code: 'unsupported_contract', message: 'Window phase is unknown.' });
    }
    if (!ADMISSIONS.includes(row.admission as WindowAdmission)) {
      return refuse(base, { code: 'unsupported_contract', message: 'Window admission is unknown.' });
    }
    if (!PARENT_TERMINAL_KINDS.includes(row.terminalKind as ParentTerminalKind)) {
      return refuse(base, { code: 'unsupported_contract', message: 'Terminal kind is unknown.' });
    }
    if (!VM_SESSION_STATES.includes(row.sessionState as VmSessionState)) {
      return refuse(base, { code: 'unsupported_contract', message: 'Stored session state is unknown.' });
    }
    if (typeof row.agentId !== 'string' || typeof row.agentDisplayName !== 'string' || typeof row.terminalId !== 'string' || typeof row.terminalDisplayName !== 'string') {
      return refuse(base, { code: 'unsupported_contract', message: 'Window identity fields are incomplete.' });
    }
    if (typeof row.pinned !== 'boolean' || !isPositiveInt(row.openedOrder) || typeof row.openedAtMs !== 'number') {
      return refuse(base, { code: 'unsupported_contract', message: 'Window order fields are incomplete.' });
    }
    const openAnimation = row.openAnimation;
    if (openAnimation !== null && openAnimation !== 'cinematic_closeup' && openAnimation !== 'spawn_inline') {
      return refuse(base, { code: 'unsupported_contract', message: 'Open animation is unknown.' });
    }
    const closeAnimation = row.closeAnimation;
    if (closeAnimation !== null && closeAnimation !== 'close_anim' && closeAnimation !== 'vm_ended_anim') {
      return refuse(base, { code: 'unsupported_contract', message: 'Close animation is unknown.' });
    }
    if (!(row.accentColorToken === null || typeof row.accentColorToken === 'string')) {
      return refuse(base, { code: 'unsupported_contract', message: 'Accent token is not a string or null.' });
    }
    if (!(row.lastSurfaceAtMs === null || typeof row.lastSurfaceAtMs === 'number')) {
      return refuse(base, { code: 'unsupported_contract', message: 'Surface time is not a number or null.' });
    }
    if (!(row.idleSinceMs === null || typeof row.idleSinceMs === 'number')) {
      return refuse(base, { code: 'unsupported_contract', message: 'Idle time is not a number or null.' });
    }
    seen.add(row.vmSessionId);
    windows.push({
      accentColorToken: row.accentColorToken,
      admission: row.admission as WindowAdmission,
      agentDisplayName: row.agentDisplayName,
      agentId: row.agentId,
      closeAnimation,
      idleSinceMs: row.idleSinceMs,
      lastSurfaceAtMs: row.lastSurfaceAtMs,
      openAnimation,
      openedAtMs: row.openedAtMs,
      openedOrder: row.openedOrder,
      phase: row.phase as WindowPhase,
      pinned: row.pinned,
      sessionState: row.sessionState as VmSessionState,
      terminalDisplayName: row.terminalDisplayName,
      terminalId: row.terminalId,
      terminalKind: row.terminalKind as ParentTerminalKind,
      vmSessionId: row.vmSessionId,
    });
  }
  const focused = windows.filter((window) => window.phase === 'focused');
  if (focused.length > 1) {
    return refuse(base, { code: 'unsupported_contract', message: 'More than one window is focused.' });
  }
  const loaded: WonderWebWindowManagerState = {
    contract: WONDER_WEB_WINDOWS_CONTRACT,
    windowCap: doc.windowCap,
    cameraInCloseup: doc.cameraInCloseup,
    nextOpenedOrder: doc.nextOpenedOrder,
    windows,
  };
  return succeed(loaded, loaded, [], []);
}

function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`;
  }
  return 'null';
}
