/**
 * Type declarations for the loopback GitHub device-flow stub (development rehearsal only; its identities are NOT real).
 *
 * Authored as plain `.mjs` so it runs with `node` and no build step; the TypeScript tests import the SAME server.
 */
import type { Server } from 'node:http';

export declare const STUB_BANNER: string;

export interface StubIdentity {
  readonly id: number;
  readonly login: string;
}

export declare function parseIdentity(text: string): StubIdentity;

export declare function createGitHubDeviceStub(identities: readonly StubIdentity[], log?: (line: string) => void): Server;
