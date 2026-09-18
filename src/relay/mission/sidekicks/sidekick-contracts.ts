/**
 * WONDERLAND SIDEKICKS — THE CONTRACT BETWEEN A COMPANION AND THE THING THAT THINKS FOR IT.
 *
 * FOUNDER DIRECTIVE (2026-09-17): the LLM Companion and Jhinn are to stop being simulated companions and become real
 * ones -- a conversational model behind the LLM Companion, a real agentic coding runtime behind Jhinn. This file is the
 * part that must be right whichever provider ends up behind them.
 *
 * THREE IDENTITIES, AND THEY DO NOT COLLAPSE. The founder locked this:
 *
 *   JULIUS (the Relay Dog) is the COMPOUND agent and the mission authority. It is not a sidekick and never appears in
 *   this file's registry. Connecting a real provider to a sidekick does not make that sidekick Julius.
 *   JHINN is a SINGLE agent: one scoped task at a time, bounded, reporting to the user -- not orchestrating missions.
 *   THE LLM COMPANION converses. It has no authority over anything at all.
 *
 * So authority is a property of the sidekick, declared here, and 'mission' is a value a sidekick can never hold. A real
 * Claude Code connection does not turn Jhinn into Julius; a real OpenAI model does not become mission authority.
 *
 * WHAT IS TRUE IS SAID PLAINLY. A companion is either backed by a real provider or it is not, and the state says which.
 * SIMULATED is a state, not a disguise: nothing in here ever answers as though a provider spoke when none did.
 */

/* ==================================================================== who a sidekick is */

/** The two kinds of sidekick. Julius is deliberately absent: it is the compound agent, not a sidekick. */
export const SIDEKICK_KINDS = ['llm_companion', 'single_agent'] as const;
export type SidekickKind = (typeof SIDEKICK_KINDS)[number];

/**
 * What a sidekick is allowed to be. 'mission' is listed because it is the thing sidekicks must never hold -- naming it
 * is how the rule gets tested rather than remembered.
 */
export const SIDEKICK_AUTHORITIES = ['conversation', 'scoped_work', 'mission'] as const;
export type SidekickAuthority = (typeof SIDEKICK_AUTHORITIES)[number];

/** The authority each kind of sidekick has, and the only authority it may ever have. */
export const AUTHORITY_BY_KIND: Readonly<Record<SidekickKind, SidekickAuthority>> = Object.freeze({
  llm_companion: 'conversation',
  single_agent: 'scoped_work',
});

/** Julius's authority, here only so that the separation can be asserted rather than assumed. */
export const JULIUS_AUTHORITY: SidekickAuthority = 'mission';

export function authorityOf(kind: SidekickKind): SidekickAuthority {
  return AUTHORITY_BY_KIND[kind];
}

/** True only for an authority a sidekick may hold. Mission authority belongs to Julius and to nothing else. */
export function isSidekickAuthority(authority: SidekickAuthority): boolean {
  return authority === 'conversation' || authority === 'scoped_work';
}

/* ==================================================================== what state it is in */

/**
 * THE EIGHT TRUTH STATES, exactly as the founder named them. Every surface that shows a companion shows one of these,
 * and none of them can be reached by pretending.
 */
export const SIDEKICK_STATES = [
  'SIMULATED',
  'AUTH_REQUIRED',
  'CONNECTING',
  'CONNECTED',
  'WORKING',
  'RATE_LIMITED',
  'FAILED',
  'DISCONNECTED',
] as const;
export type SidekickState = (typeof SIDEKICK_STATES)[number];

/**
 * The moves that exist. Anything not here is a bug rather than a surprise -- in particular nothing reaches CONNECTED
 * except from CONNECTING, so a surface cannot claim a connection that was never made.
 */
export const SIDEKICK_EDGES: ReadonlyArray<readonly [SidekickState, SidekickState]> = Object.freeze([
  ['SIMULATED', 'AUTH_REQUIRED'],
  ['SIMULATED', 'CONNECTING'],
  ['AUTH_REQUIRED', 'CONNECTING'],
  ['AUTH_REQUIRED', 'SIMULATED'],
  ['CONNECTING', 'CONNECTED'],
  ['CONNECTING', 'AUTH_REQUIRED'],
  ['CONNECTING', 'FAILED'],
  ['CONNECTING', 'DISCONNECTED'],
  ['CONNECTED', 'WORKING'],
  ['CONNECTED', 'RATE_LIMITED'],
  ['CONNECTED', 'FAILED'],
  ['CONNECTED', 'DISCONNECTED'],
  ['CONNECTED', 'AUTH_REQUIRED'],
  ['WORKING', 'CONNECTED'],
  ['WORKING', 'RATE_LIMITED'],
  ['WORKING', 'FAILED'],
  ['WORKING', 'DISCONNECTED'],
  ['RATE_LIMITED', 'CONNECTED'],
  ['RATE_LIMITED', 'FAILED'],
  ['RATE_LIMITED', 'DISCONNECTED'],
  ['FAILED', 'CONNECTING'],
  ['FAILED', 'DISCONNECTED'],
  ['FAILED', 'SIMULATED'],
  ['DISCONNECTED', 'CONNECTING'],
  ['DISCONNECTED', 'SIMULATED'],
  ['DISCONNECTED', 'AUTH_REQUIRED'],
]);

export function isLegalSidekickTransition(from: SidekickState, to: SidekickState): boolean {
  return SIDEKICK_EDGES.some(([a, b]) => a === from && b === to);
}

/** True while a real provider is behind the sidekick. SIMULATED and everything before CONNECTED are not real. */
export function isLiveState(state: SidekickState): boolean {
  return state === 'CONNECTED' || state === 'WORKING' || state === 'RATE_LIMITED';
}

/* ==================================================================== what the body does */

/**
 * WHAT THE MASCOT IS DOING, which is a different question from what the connection is doing: a connected companion that
 * has been asked nothing is idle, and a companion with no provider is not "thinking" about anything.
 *
 * These come from real runtime activity. A canned timer must never produce them -- a body that looks busy while nothing
 * is happening is a lie told in animation.
 */
export const MASCOT_STATES = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'WORKING',
  'RESPONDING',
  'WAITING_FOR_AUTH',
  'ERROR',
  'DISCONNECTED',
] as const;
export type MascotState = (typeof MASCOT_STATES)[number];

/** What a turn is doing right now, which is what actually drives the body. */
export const TURN_STATES = ['ASKED', 'THINKING', 'STREAMING', 'DONE', 'CANCELLED', 'FAILED'] as const;
export type TurnState = (typeof TURN_STATES)[number];

/**
 * THE BODY FOLLOWS THE RUNTIME. Given the connection's state and the live turn (if any), there is exactly one honest
 * thing for the mascot to be doing.
 */
export function mascotStateFor(state: SidekickState, turn: TurnState | null, kind: SidekickKind): MascotState {
  if (state === 'AUTH_REQUIRED') return 'WAITING_FOR_AUTH';
  if (state === 'FAILED') return 'ERROR';
  if (state === 'DISCONNECTED') return 'DISCONNECTED';
  // RATE LIMITED IS WAITING, NOT WORKING: the provider has asked us to slow down and nothing is being computed.
  if (state === 'RATE_LIMITED') return 'IDLE';
  if (turn === 'ASKED') return 'LISTENING';
  if (turn === 'THINKING') return kind === 'single_agent' ? 'WORKING' : 'THINKING';
  if (turn === 'STREAMING') return kind === 'single_agent' ? 'WORKING' : 'RESPONDING';
  if (turn === 'FAILED') return 'ERROR';
  // CONNECTED WITH NOTHING TO DO, or simulated and unasked: idle, and honestly so.
  return 'IDLE';
}

/* ==================================================================== how it can go wrong */

/**
 * EVERY WAY A TURN CAN END BADLY, named. Each one is a different thing to tell the user, and each is reachable in the
 * provider-free build through fixtures, so the behaviour is seen before any provider is paid.
 */
export const SIDEKICK_FAILURES = [
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'TIMEOUT',
  'CANCELLED',
  'MALFORMED',
  'DISCONNECTED',
  'REFUSED',
  'PROVIDER_ERROR',
] as const;
export type SidekickFailure = (typeof SIDEKICK_FAILURES)[number];

/** What the user is told, per failure: plain, specific, and never a guess about the cause. */
export const FAILURE_WORDS: Readonly<Record<SidekickFailure, string>> = Object.freeze({
  AUTH_REQUIRED: 'This companion has no account connected yet, so nothing was asked of any provider.',
  RATE_LIMITED: 'The provider asked us to slow down. Nothing was lost; the turn can be asked again shortly.',
  QUOTA_EXHAUSTED: 'The account behind this companion has no credit or quota left, so the provider refused the request.',
  TIMEOUT: 'The provider did not answer in time. Nothing partial is shown as though it were an answer.',
  CANCELLED: 'The turn was cancelled before it finished.',
  MALFORMED: 'The provider answered with something this build could not read, so none of it is shown.',
  DISCONNECTED: 'The connection went away mid-turn.',
  REFUSED: 'The gate refused this: the capability it needs has not been granted.',
  PROVIDER_ERROR: 'The provider reported an error of its own.',
});

/* ==================================================================== who is behind it */

/**
 * HOW AN ACCOUNT IS ACTUALLY CONNECTED. The founder's rule: use the official mechanism each provider really offers, in
 * this order, and never scrape a credential or borrow a browser session.
 *
 *   'account_cli'    the provider's own tool, signed in by the person on this machine with the provider's own flow.
 *                    NOTHING CROSSES THIS SEAM: Wonderland never sees a token, because the tool holds its own.
 *   'api_credential' an official API credential, held in the vault and passed as a reference (never as text).
 *
 * A subscription is not automatically a credential. Which of these a provider supports is a fact about that provider,
 * recorded in the registry, not an assumption made here.
 */
export const SIDEKICK_AUTH_MECHANISMS = ['account_cli', 'api_credential'] as const;
export type SidekickAuthMechanism = (typeof SIDEKICK_AUTH_MECHANISMS)[number];

export interface SidekickAuthOption {
  readonly mechanism: SidekickAuthMechanism;
  /** What the person actually does, in their own words, on their own machine. */
  readonly humanStep: string;
  /** True when this build can really use this mechanism today. */
  readonly available: boolean;
  /** When it cannot, why -- so a surface never shows a route it cannot walk. */
  readonly unavailableReason: string | null;
  /**
   * Whether using this mechanism means a secret passes through this system at all. `account_cli` is false: the
   * provider's own tool holds its own credential and Wonderland holds nothing.
   */
  readonly holdsCredential: boolean;
}

export interface SidekickModel {
  readonly modelId: string;
  readonly label: string;
  /** What this model is for, in one line. */
  readonly purpose: string;
}

export interface SidekickProvider {
  readonly providerId: string;
  readonly displayName: string;
  /** Which kind of sidekick this provider can be behind. A conversational model cannot be a single agent, and the reverse. */
  readonly backs: SidekickKind;
  /** True for a deterministic stand-in that contacts nothing; false for a provider that really reaches out. */
  readonly development: boolean;
  readonly auth: readonly SidekickAuthOption[];
  readonly models: readonly SidekickModel[];
  /** Said plainly on every surface: what this provider is not, and what it will not be asked to do. */
  readonly notThis: string;
}

/** The first auth option this build can actually use, or null when none of them can be walked yet. */
export function chooseAuth(provider: SidekickProvider): SidekickAuthOption | null {
  return provider.auth.find((option) => option.available) ?? null;
}

/* ==================================================================== a conversation, and a piece of work */

/** One exchange with a sidekick. Content belongs to the user and the provider; this is the shape around it. */
export interface SidekickTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly askedAt: string;
  readonly state: TurnState;
  /** What the user said. Kept because the user can see it anyway -- it is their own words in their own terminal. */
  readonly ask: string;
  /** What came back, as far as it has come. Empty until the provider says something. */
  readonly answer: string;
  /** Present only when the turn ended badly. */
  readonly failure: SidekickFailure | null;
  /** Which model answered. Recorded per turn, because a session's model can change between turns. */
  readonly modelId: string;
  /** How long the provider took, once it is over. */
  readonly ms: number | null;
  /**
   * TRUE ONLY WHEN A REAL PROVIDER ANSWERED. A fixture answer is marked, everywhere, for the life of the record: this
   * is what stops a simulated answer from later being mistaken for a real one.
   */
  readonly real: boolean;
}

/**
 * A SESSION IS THE COMPANION'S MEMORY, and its identity: the same companion, across turns, with one provider and one
 * model at a time. A new provider is a new session, because it is not the same mind.
 */
export interface SidekickSession {
  readonly sessionId: string;
  readonly kind: SidekickKind;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: string;
  /** SIMULATED for a fixture provider, REAL once a real one is behind it. */
  readonly mode: 'SIMULATED' | 'REAL';
  readonly turns: readonly SidekickTurn[];
}

/* ==================================================================== what was done, and by whom */

export interface SidekickAuditRow {
  readonly eventId: string;
  readonly at: string;
  readonly sidekickId: string;
  readonly action:
    | 'auth.required'
    | 'auth.completed'
    | 'connected'
    | 'disconnected'
    | 'turn.asked'
    | 'turn.answered'
    | 'turn.failed'
    | 'turn.cancelled'
    | 'model.changed'
    | 'work.started'
    | 'work.finished'
    | 'refused';
  readonly providerId: string;
  readonly modelId: string | null;
  /** SIMULATED or REAL, recorded at the moment it happened and never rewritten. */
  readonly mode: 'SIMULATED' | 'REAL';
  readonly outcome: 'success' | 'failed' | 'pending';
  /** Plain words. NEVER a credential, and never the whole of what was said. */
  readonly detail: string;
}

/**
 * NOTHING SECRET PASSES HERE. The same shape-check the connections side uses: a record that looks like it is carrying
 * key material is refused rather than stored, because the cheapest way to never leak a secret is to never hold one.
 */
const SECRET_SHAPES = [/sk-[A-Za-z0-9_-]{12,}/, /Bearer\s+[A-Za-z0-9._-]{12,}/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

export function looksLikeSecret(text: string): boolean {
  return SECRET_SHAPES.some((shape) => shape.test(text));
}
