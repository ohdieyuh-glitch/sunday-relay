import { randomBytes } from 'node:crypto';

import type {
  AuthorizationOutcome,
  CapabilityRequest,
  ConnectAuthorizerPort,
  ConnectCredentialVaultPort,
  ConnectStepExecutor,
  ConnectorDescriptor,
} from '../../src/relay/mission/julius-connect';

/**
 * JULIUS CONNECT — THE DEVELOPMENT CONNECTOR RUNTIME.
 *
 * Deterministic, provider-free adapters for the four development connectors (OAuth-shaped, MCP-shaped, API-credential-
 * shaped, browser-only). They do what a real adapter does at the same points -- complete an approved authorization,
 * put the resulting material in the vault and return only its reference; resolve that reference when an authorized
 * capability executes -- and they contact nothing. A connector that is not a development connector is refused here:
 * no real provider integration exists in this build, and this runtime will not pretend one does.
 */

const DEVELOPMENT_ACCOUNTS: Readonly<Record<string, string>> = Object.freeze({
  'dev-figma': 'founder · Wonderland design team (development)',
  'dev-insight-mcp': 'founder · insight workspace (development)',
  'dev-postgres': 'wonderland_dev role (development)',
  'dev-legacy-portal': 'founder@supplier-portal (development)',
});

export interface DevelopmentAuthorizer extends ConnectAuthorizerPort {
  /** Make the next authorization fail, to exercise FAILED. */
  failNext(reason: string): void;
}

export function createDevelopmentAuthorizer(vault: ConnectCredentialVaultPort): DevelopmentAuthorizer {
  let failure: string | null = null;
  return {
    failNext(reason) {
      failure = reason;
    },
    authorize({ connector, request }: { connector: ConnectorDescriptor; request: CapabilityRequest; at: string }): AuthorizationOutcome {
      if (connector.connectorId === 'open-web') {
        // THE ONE REAL CONNECTOR THAT NEEDS NO PROVIDER. There is nothing to sign into and no secret to hold: the
        // authorization IS the user saying yes, and the browser is bound by its allowlist either way. Rather than invent a
        // credential, the reference says plainly that there is none.
        const { credentialRef } = vault.store({
          connectorId: connector.connectorId, userId: request.userId,
          material: 'no-credential: the governed browser signs into nothing', label: 'the open web (no credential)',
        });
        return {
          kind: 'authorized', credentialRef, accountLabel: 'no account · the governed browser, on its allowlist',
          grantedCapabilities: request.requested, expiresAt: '2099-01-01T00:00:00.000Z',
        };
      }
      if (!connector.development) {
        return { kind: 'failed', reason: `${connector.displayName}: no provider integration exists in this build.` };
      }
      if (failure !== null) {
        const reason = failure;
        failure = null;
        return { kind: 'failed', reason };
      }
      // Dummy development material: random, never shown, and useless anywhere but this process.
      const { credentialRef } = vault.store({
        connectorId: connector.connectorId, userId: request.userId, material: `devcred-${randomBytes(12).toString('hex')}`, label: `${connector.displayName} ${request.route}`,
      });
      return {
        kind: 'authorized', credentialRef, accountLabel: DEVELOPMENT_ACCOUNTS[connector.connectorId] ?? `${connector.displayName} (development)`,
        grantedCapabilities: request.requested, expiresAt: '2099-01-01T00:00:00.000Z',
      };
    },
  };
}

/**
 * EXECUTE ONE AUTHORIZED STEP. The gate already allowed it; the reference is resolved here, inside the runtime, for this
 * one use, and the development connector "performs" the step deterministically. A reference the vault no longer resolves
 * (revoked underneath) fails the step rather than running it.
 */
export function createDevelopmentStepExecutor(vault: ConnectCredentialVaultPort): ConnectStepExecutor {
  return ({ step, decision }) => {
    const credential = vault.resolveForExecution({ credentialRef: decision.credentialRef, connectionId: decision.connectionId, capability: step.capability });
    if (credential === null) return { outcome: 'failed', detail: `The credential for ${step.capability} no longer resolves.` };
    return { outcome: 'success', detail: `Julius: ${step.label} (development connector, no external call).` };
  };
}
