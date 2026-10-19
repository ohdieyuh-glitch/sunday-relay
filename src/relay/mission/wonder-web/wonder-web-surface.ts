import type { ConnectionState } from '../terminal';
import {
  isOpenableInWonderWeb,
  type WonderWebCreationDraft,
  type WonderWebCreationStatus,
} from './wonder-web-contracts';
import { type WonderWebAccess, wonderWebAccessFor } from './wonder-web-sandbox';

/**
 * WONDER WEB — the surface, as a read model.
 *
 * This is the typed form of the founder's Wonder Web reference: a window with a
 * tab strip, a chrome row, an address, a viewport and a terminal. It is a
 * PROJECTION — it decides nothing and stores nothing. Relay is authoritative and
 * the client is presentational, exactly as `WONDERLAND_AUTHORITY` already says
 * for the world document, so the browser surface and the Unreal surface render
 * the same struct and cannot drift into two different opinions about what the
 * user is looking at.
 *
 * WHY THE TABS ARE PEOPLE. In the reference, the tab strip is not a list of
 * documents — it is `MY VIEW` followed by other named users, each with a
 * coloured presence dot. That makes Wonder Web the place multiplayer becomes
 * visible, and it makes one rule load-bearing from the very first commit: a tab
 * for another player is an OBSERVATION, never a handle. `WonderWebTab.access`
 * carries that distinction as data, and the projection refuses to emit a
 * controllable tab for a creation the viewer does not own.
 *
 * THE VIEWPORT NEVER LIES. A creation that failed renders its failure. A
 * creation still building renders that it is building. The idle mark — the
 * Wonder face on black — is shown when there is genuinely nothing open, and
 * never as a cover for a state the surface would rather not explain.
 */

/* --------------------------------------------------------------- the tabs */

/**
 * One tab in the strip.
 *
 * `dotColorToken` is a TOKEN, not a hex value: the palette belongs to the
 * stylesheet and to Unreal's material, and baking `#FFD400` into a projection
 * would put the design system in the domain layer. The reference assigns each
 * peer a distinct dot, so the token is derived deterministically from the user
 * id and stays stable for that user across sessions and machines.
 */
export interface WonderWebTab {
  readonly userId: string;
  readonly label: string;
  readonly isSelf: boolean;
  readonly isActive: boolean;
  readonly dotColorToken: string;
  readonly connectionState: ConnectionState | null;
  /** What this viewer may do with what the tab shows. Never 'control' for a peer. */
  readonly access: WonderWebAccess;
}

/**
 * The peer dot palette, in assignment order.
 *
 * Six tokens, assigned round-robin by a stable hash of the user id. The
 * reference shows four peers with clearly distinguishable dots; six gives room
 * for the five-collaborator ceiling the multiplayer definition sets, plus the
 * viewer's own.
 */
export const WONDER_WEB_DOT_TOKENS = [
  'wonder-dot-amber',
  'wonder-dot-violet',
  'wonder-dot-azure',
  'wonder-dot-rose',
  'wonder-dot-jade',
  'wonder-dot-coral',
] as const;

/** Stable, deterministic, and cheap. The same user gets the same dot everywhere. */
export function wonderWebDotToken(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash = Math.imul(hash ^ userId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return WONDER_WEB_DOT_TOKENS[hash % WONDER_WEB_DOT_TOKENS.length];
}

/* ------------------------------------------------------------ the address */

/**
 * The address bar.
 *
 * `secure` drives the lock in the reference, and it is a FACT about how the
 * bytes reached the frame — a creation served from the local sandbox root over
 * the in-process channel is secure; one that somehow is not says so rather than
 * showing a lock because the design has one.
 */
export interface WonderWebAddress {
  readonly display: string;
  readonly secure: boolean;
  readonly creationId: string | null;
  readonly projectId: string | null;
}

/* ----------------------------------------------------------- the viewport */

/**
 * WHAT THE BIG BLACK AREA IS SHOWING, as a closed union.
 *
 * A union rather than a set of nullable fields, because "which of these is it"
 * is exactly the question the renderer asks, and a nullable soup lets a renderer
 * answer it wrongly by checking the fields in the wrong order.
 */
export type WonderWebViewport =
  /** Nothing is open. The Wonder face on black — the reference's resting state. */
  | { readonly kind: 'idle'; readonly mark: 'wonder-face' }
  /** Work is happening and the user is told which work. */
  | { readonly kind: 'working'; readonly status: WonderWebCreationStatus; readonly message: string }
  /** A creation is open and running. */
  | { readonly kind: 'creation'; readonly creationId: string; readonly entrypoint: string; readonly running: boolean }
  /** It failed, and the panel says so with the reason it has. */
  | { readonly kind: 'failed'; readonly creationId: string; readonly summary: string; readonly phase: string }
  /** The viewer may see that it exists and no more. */
  | { readonly kind: 'observed'; readonly creationId: string; readonly ownerUserId: string; readonly status: WonderWebCreationStatus };

/* ----------------------------------------------------------- the terminal */

/** One line in the Wonder Web terminal. Already redacted upstream. */
export interface WonderWebTerminalLine {
  readonly sequence: number;
  readonly text: string;
  readonly stream: 'build' | 'runtime';
}

/**
 * The terminal strip along the bottom of the reference.
 *
 * `prompt` is rendered verbatim (`wonder@project:~$`). `acceptsInput` is false
 * whenever the viewer lacks control — an observer sees a peer's terminal output
 * without being given a place to type into their machine.
 */
export interface WonderWebTerminalPanel {
  readonly prompt: string;
  readonly lines: readonly WonderWebTerminalLine[];
  readonly truncatedFrom: number | null;
  readonly acceptsInput: boolean;
  readonly busy: boolean;
}

/* ------------------------------------------------------------ the chrome */

/**
 * Which chrome controls are live.
 *
 * Every one is a derived fact. `canRebuild` being false on somebody else's
 * creation is the same authorization rule as everything else here, surfaced
 * where a renderer can grey out a button instead of discovering the refusal
 * after the click.
 */
export interface WonderWebChrome {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly canReload: boolean;
  readonly canStop: boolean;
  readonly canRestart: boolean;
  readonly canRebuild: boolean;
  readonly canReturnToProject: boolean;
}

/* ------------------------------------------------------------ the window */

/** The whole Wonder Web window, as one serializable observation. */
export interface WonderWebSurface {
  readonly title: string;
  readonly observedAtIso: string;
  readonly viewerUserId: string;
  readonly tabs: readonly WonderWebTab[];
  readonly address: WonderWebAddress;
  readonly viewport: WonderWebViewport;
  readonly terminal: WonderWebTerminalPanel;
  readonly chrome: WonderWebChrome;
  /** Null when live. A sentence when Relay could not observe something. */
  readonly unavailableReason: string | null;
}

export const WONDER_WEB_TITLE = 'WONDER WEB' as const;
export const WONDER_WEB_IDLE_MARK = 'wonder-face' as const;
export const WONDER_WEB_TERMINAL_PROMPT = 'wonder@project:~$' as const;

/* --------------------------------------------------------- the projection */

export interface WonderWebPeer {
  readonly userId: string;
  readonly displayName: string;
  readonly connectionState: ConnectionState | null;
}

export interface WonderWebSurfaceInput {
  readonly viewerUserId: string;
  readonly viewerDisplayName: string;
  /** Co-present players in the same multiplayer session, excluding the viewer. */
  readonly peers: readonly WonderWebPeer[];
  /** The creation currently open, if any. */
  readonly creation: WonderWebCreationDraft | null;
  readonly projectId: string | null;
  readonly observedAtIso: string;
  /** Set when Relay could not read something it needed. Renders instead of guessing. */
  readonly unavailableReason?: string | null;
  readonly history?: { readonly canGoBack: boolean; readonly canGoForward: boolean };
}

const WORKING_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  CREATED: 'This creation exists. Nothing has been prepared yet.',
  PREPARING: 'Preparing the sources.',
  BUILDING: 'Building.',
});

function viewportFor(
  creation: WonderWebCreationDraft | null,
  access: WonderWebAccess,
): WonderWebViewport {
  if (creation === null) return { kind: 'idle', mark: WONDER_WEB_IDLE_MARK };

  /**
   * NO ACCESS SHOWS NOTHING. This branch is first among the access checks and
   * it is not merely defensive: without it, a viewer with no relationship to a
   * creation fell through to the openable branch and received its entrypoint.
   * Fail closed — a creation the viewer has no standing to see is, as far as
   * this surface is concerned, not open at all.
   */
  if (access === 'none') return { kind: 'idle', mark: WONDER_WEB_IDLE_MARK };

  // An observer is told the creation exists and its state, and is given no
  // entrypoint — the bytes of somebody else's creation are not theirs to load.
  if (access === 'observe') {
    return {
      kind: 'observed',
      creationId: creation.creationId,
      ownerUserId: creation.ownerUserId,
      status: creation.status,
    };
  }
  if (creation.status === 'FAILED') {
    const last = creation.errors[creation.errors.length - 1];
    return {
      kind: 'failed',
      creationId: creation.creationId,
      summary: last?.summary ?? 'This creation failed and recorded no reason.',
      phase: last?.phase ?? 'unknown',
    };
  }
  if (isOpenableInWonderWeb(creation)) {
    return {
      kind: 'creation',
      creationId: creation.creationId,
      // Non-null by `isOpenableInWonderWeb`, restated for the type rather than asserted.
      entrypoint: creation.entrypoint ?? '',
      running: creation.status === 'RUNNING',
    };
  }
  if (creation.status === 'STOPPED') {
    return { kind: 'working', status: 'STOPPED', message: 'Stopped. The build is still here.' };
  }
  return {
    kind: 'working',
    status: creation.status,
    message: WORKING_MESSAGES[creation.status] ?? 'Working.',
  };
}

function chromeFor(creation: WonderWebCreationDraft | null, access: WonderWebAccess, history: { canGoBack: boolean; canGoForward: boolean }): WonderWebChrome {
  const control = access === 'control' && creation !== null;
  return {
    canGoBack: history.canGoBack,
    canGoForward: history.canGoForward,
    canReload: control && isOpenableInWonderWeb(creation),
    canStop: control && creation.status === 'RUNNING',
    canRestart: control && (creation.status === 'STOPPED' || creation.status === 'READY'),
    // A failed creation is precisely the one a user most needs to rebuild.
    canRebuild: control && creation.status !== 'PREPARING' && creation.status !== 'BUILDING',
    canReturnToProject: creation?.projectId != null,
  };
}

/**
 * Project the Wonder Web window for ONE viewer.
 *
 * The viewer's own tab is always first and always `MY VIEW`, matching the
 * reference. Peers follow in the order given, each an observation.
 */
export function projectWonderWebSurface(input: WonderWebSurfaceInput): WonderWebSurface {
  const peerIds = input.peers.map((peer) => peer.userId);
  const access =
    input.creation === null
      ? 'control'
      : wonderWebAccessFor(input.creation, input.viewerUserId, peerIds);

  const selfTab: WonderWebTab = {
    userId: input.viewerUserId,
    label: 'MY VIEW',
    isSelf: true,
    isActive: true,
    dotColorToken: wonderWebDotToken(input.viewerUserId),
    connectionState: 'LIVE',
    access: 'control',
  };
  const peerTabs: readonly WonderWebTab[] = input.peers.map((peer) => ({
    userId: peer.userId,
    label: peer.displayName,
    isSelf: false,
    isActive: false,
    dotColorToken: wonderWebDotToken(peer.userId),
    connectionState: peer.connectionState,
    // A peer tab is an observation. There is no branch here that yields 'control'.
    access: 'observe',
  }));

  const controls = access === 'control';
  const lines: readonly WonderWebTerminalLine[] =
    input.creation === null || !controls
      ? []
      : input.creation.logs.map((line) => ({
        sequence: line.sequence,
        text: line.text,
        stream: line.stream,
      }));

  return {
    title: WONDER_WEB_TITLE,
    observedAtIso: input.observedAtIso,
    viewerUserId: input.viewerUserId,
    tabs: [selfTab, ...peerTabs],
    address: {
      display: input.projectId === null ? 'wonder.app' : 'wonder.app/project',
      secure: true,
      creationId: input.creation?.creationId ?? null,
      projectId: input.projectId,
    },
    viewport: viewportFor(input.creation, access),
    terminal: {
      prompt: WONDER_WEB_TERMINAL_PROMPT,
      lines,
      truncatedFrom: null,
      acceptsInput: controls,
      busy:
        input.creation !== null &&
        (input.creation.status === 'BUILDING' || input.creation.status === 'PREPARING'),
    },
    chrome: chromeFor(input.creation, access, input.history ?? { canGoBack: false, canGoForward: false }),
    unavailableReason: input.unavailableReason ?? null,
  };
}
