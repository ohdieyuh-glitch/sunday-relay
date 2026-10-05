/**
 * Type declarations for the Wonderland deploy check.
 *
 * Plain `.mjs` so the founder and JUJU run it with `node` and no build step;
 * the tests import the same functions.
 */

import type { R16Backend, R16Host } from './wonderland-r16-harness.mjs';

type Fetch = typeof fetch;

export declare const DEPLOY_CHECK_VERSION: string;
export declare const DEPLOY_CHECKS: readonly string[];
export declare const DEPLOY_CHECK_FOREIGN_ORIGIN: string;

export interface DeployRead {
  readonly status: number;
  readonly body: unknown;
  readonly allowOrigin: string | null;
}

export interface DeployFacts {
  readonly origin: string;
  readonly health: DeployRead;
  readonly unauthenticated: DeployRead;
  readonly foreign: DeployRead;
  readonly allowed: DeployRead;
  readonly backend: R16Backend;
  readonly host: R16Host;
  readonly reported: { readonly voiceSchema: string; readonly eosClientConfig: string; readonly eosTrustedServer: string };
}

export interface DeployRow { readonly name: string; readonly result: 'PASS' | 'FAIL'; readonly detail: string }

export declare function readDeployFacts(input: {
  readonly bridge: string;
  readonly origin: string;
  readonly operatorToken: string | undefined;
  readonly fetch: Fetch;
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
}): Promise<DeployFacts>;

export declare function judgeDeploy(facts: DeployFacts, expectCommit: string): readonly DeployRow[];
