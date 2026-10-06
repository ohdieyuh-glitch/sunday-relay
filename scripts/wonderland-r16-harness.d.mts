/**
 * Type declarations for the Wonderland R16 harness.
 *
 * Plain `.mjs` so the founder, CORE and CI run it with `node` and no build step;
 * the tests import the same functions.
 */

type Fetch = typeof fetch;

export declare const R16_VERSION: string;
export declare const R16_CHECKS: readonly string[];
/** The voice wall's closed list: counted only when the voice wall is checked (`--voice`). */
export declare const R16_VOICE_CHECKS: readonly string[];
export declare const R16_HEARTBEAT_MS: number;

export interface R16Players { readonly a: string; readonly b: string; readonly c: string; readonly nobody: string }
export interface R16Result { readonly name: string; readonly result: 'PASS' | 'FAIL'; readonly detail: string }

export declare function r16Players(nonce: string): R16Players;

export declare function pairR16Sessions(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly operatorToken: string;
  readonly playerIds: readonly string[];
  readonly fetch: Fetch;
}): Promise<{ readonly ok: true; readonly sessions: Record<string, string> } | { readonly ok: false; readonly reason: string }>;

export declare function runR16Scenario(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly nonce: string;
  readonly fetch: Fetch;
  /** The harness's own clock, for its heartbeat. Defaults to Date.now. */
  readonly clock?: () => number;
  /** Check the voice wall too. `idTokens` (EOS Connect ID tokens, per player) are bound first; without them each identity must already be bound. */
  readonly voice?: { readonly idTokens?: Readonly<Record<string, string>> | null } | null;
}): Promise<{
  readonly results: readonly R16Result[];
  readonly commands: number;
  readonly heartbeats: number;
  /** The name the backend showed for each player while all three were visible to all: from a verified sign-in, or null. */
  readonly names: Readonly<Record<string, string | null>>;
  /** Null when voice was not checked; otherwise whether every player was admitted to it, and how many joins were made. */
  readonly voice: { readonly admitted: boolean; readonly joins: number } | null;
}>;

/* ------------------------------------------------------------------- VOICE --- */

export type R16VoiceBinding =
  | { readonly bound: true; readonly productUserId: string; readonly outcome: string }
  | { readonly bound: false; readonly refused: string };

export declare function bindR16VoiceIdentities(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly idTokens: Readonly<Record<string, string>>;
  readonly fetch: Fetch;
}): Promise<Readonly<Record<string, R16VoiceBinding>>>;

export interface R16VoiceJoined { readonly rooms: readonly string[] | null }
export declare function r16VoiceShape(joined: { readonly a?: R16VoiceJoined | null; readonly b?: R16VoiceJoined | null; readonly c?: R16VoiceJoined | null }): {
  readonly rooms: { readonly a: number; readonly b: number; readonly c: number };
  readonly shared: { readonly ab: number; readonly ac: number; readonly bc: number; readonly abc: number };
};

/** Per player, per channel: the room ids given (never a token), or the refusal. */
export type R16VoiceRooms = Record<string, { readonly INSTANCE: { readonly rooms: readonly string[] } | { readonly refused: string }; readonly PARTY: { readonly rooms: readonly string[] } | { readonly refused: string } }>;

export declare function readR16VoiceRooms(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly fetch: Fetch;
}): Promise<R16VoiceRooms>;

export declare function r16VoiceRestartCheck(player: string): string;

export declare function verifyR16Voice(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly recorded: { readonly voice?: { readonly rooms: R16VoiceRooms } | null } | null;
  readonly fetch: Fetch;
}): Promise<readonly R16Result[]>;

export declare function readR16Views(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly nonce: string;
  readonly fetch: Fetch;
}): Promise<Record<string, unknown>>;

export declare function compareR16Views(before: unknown, after: unknown, path?: string): string[];

export declare function splitR16View(view: unknown): { readonly stored: Record<string, unknown>; readonly lease: Record<string, unknown> };

/** HELD | REENTERED | ABSENT | REFUSED_<status>_<code>, per player. */
export type R16Reconnect = string;

export declare function reconnectR16Presence(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly nonce: string;
  readonly recorded: { readonly views: Readonly<Record<string, unknown>> };
  readonly fetch: Fetch;
}): Promise<Record<string, R16Reconnect>>;

export declare function verifyR16Restart(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly players: R16Players;
  readonly nonce: string;
  readonly recorded: { readonly views: Readonly<Record<string, unknown>> };
  readonly fetch: Fetch;
}): Promise<{ readonly results: readonly R16Result[]; readonly reconnect: Readonly<Record<string, R16Reconnect>>; readonly views: Record<string, unknown> }>;

export declare function probeR16Voice(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly token: string;
  readonly fetch: Fetch;
}): Promise<string>;

/** With `voice` (or any voice result present), the voice checks are counted too. */
export declare function summarizeR16(results: readonly R16Result[], options?: { readonly voice?: boolean }): {
  readonly passed: number;
  readonly failed: number;
  readonly missing: readonly string[];
  readonly of: number;
};

/* ------------------------------------------------------------------- VENUE --- */

export type R16VenueReason =
  | 'NOT_HTTPS' | 'HOST_NOT_PUBLIC' | 'HOST_RESOLVES_PRIVATE' | 'HOST_UNRESOLVED'
  | 'SCRIPTED_PLAYERS' | 'PLAYERS_NOT_VERIFIED'
  | 'READINESS_UNREAD' | 'NOT_PRODUCTION' | 'STORE_NOT_CONNECTED' | 'STORE_NOT_CURRENT' | 'SOCIAL_NOT_READY'
  | 'COMMIT_UNKNOWN' | 'NO_EXPECTED_COMMIT' | 'COMMIT_NOT_EXPECTED'
  | 'SCENARIO_NOT_FINAL' | 'NOT_RESTARTED' | 'RESTART_UNPROVEN' | 'BUILD_CHANGED' | 'BACKEND_CHANGED';

export declare const R16_VENUE_REASONS: Readonly<Record<R16VenueReason, string>>;

export type R16HostKind = 'LOOPBACK' | 'PRIVATE' | 'LINK_LOCAL' | 'UNSPECIFIED' | 'LOCAL_NAME' | 'PUBLIC_ADDRESS' | 'NAME';
export interface R16Host { readonly https: boolean; readonly kind: R16HostKind; readonly resolves: 'PUBLIC' | 'NOT_PUBLIC' | 'UNRESOLVED' }

export declare function classifyR16Host(hostname: string): R16HostKind;
export declare function inspectR16Host(bridge: string, resolve: (hostname: string) => Promise<readonly string[]>): Promise<R16Host>;
export declare function resolveR16Host(hostname: string): Promise<string[]>;

export type R16Backend =
  | { readonly readable: false; readonly reason: string }
  | {
    readonly readable: true;
    readonly commit: string | null;
    readonly attestedBy: string | null;
    readonly production: boolean;
    readonly bootId: string;
    readonly startedAt: string | null;
    readonly database: string;
    readonly ledger: { readonly through: string | null; readonly pending: readonly string[]; readonly gapFree: boolean; readonly unknown: readonly string[] } | null;
    readonly social: string;
  };

export declare function readR16Backend(input: { readonly bridge: string; readonly operatorToken: string | undefined; readonly fetch: Fetch }): Promise<R16Backend>;

export interface R16Venue { readonly venue: 'HOSTED_FINAL' | 'REHEARSAL'; readonly reasons: readonly R16VenueReason[] }

export declare function judgeR16Venue(input: {
  readonly phase: 'scenario' | 'verify';
  readonly bridge: string;
  readonly host: R16Host;
  readonly identities: { readonly source: 'SIGNED_IN' | 'SCRIPTED'; readonly names: Readonly<Record<string, string | null>> | null };
  readonly backend: R16Backend;
  readonly expectCommit: string | null;
  /** The scenario's state file, for the verify phase. */
  readonly recorded?: { readonly bridge?: string; readonly backend?: unknown; readonly venue?: { readonly venue?: string } } | null;
}): R16Venue;

export declare const R16_RESTART_CHECK: string;
export declare function r16RestartCheck(before: unknown, after: R16Backend): R16Result;
