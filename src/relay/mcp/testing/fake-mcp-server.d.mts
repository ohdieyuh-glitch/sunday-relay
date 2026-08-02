/**
 * Types for `fake-mcp-server.mjs`.
 *
 * The fixture server is plain JavaScript because it must be executed directly
 * by a spawned child running with an environment built from empty — see that
 * file's docstring. This declaration is what lets the TypeScript harness import
 * it without `allowJs`, and without a second, drifting definition of the same
 * server.
 *
 * `Server` is the official SDK's server type. This is a fixture-only module,
 * so referencing it here does not widen the SDK adapter boundary:
 * `mcp-boundary.test.ts` already permits `src/relay/mcp/testing/`.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export declare const FAKE_MCP_SCENARIOS: readonly string[];
export declare const FAKE_SERVER_NAMES: Readonly<Record<string, string>>;
export declare const FAKE_SERVER_VERSION: string;
export declare const FAKE_SYNTHETIC_SECRET: string;
export declare const FAKE_INJECTION_PAYLOAD: string;

export declare function toolsForScenario(scenario: string): Array<Record<string, unknown>>;

export declare function createFakeMcpServer(options: {
  readonly scenario: string;
  readonly serverName?: string;
  readonly toolDelayMs?: number;
}): Server;
