/**
 * Type declarations for the Wonderland R16 harness.
 *
 * Plain `.mjs` so the founder, CORE and CI run it with `node` and no build step;
 * the tests import the same functions.
 */

type Fetch = typeof fetch;

export declare const R16_VERSION: string;
export declare const R16_CHECKS: readonly string[];
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
}): Promise<{ readonly results: readonly R16Result[]; readonly commands: number; readonly heartbeats: number }>;

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

export declare function summarizeR16(results: readonly R16Result[]): {
  readonly passed: number;
  readonly failed: number;
  readonly missing: readonly string[];
  readonly of: number;
};
