import { randomUUID } from 'node:crypto';

import type { ConnectCredentialVaultPort } from '../../src/relay/mission/julius-connect';

/**
 * JULIUS CONNECT — THE DEVELOPMENT CREDENTIAL VAULT.
 *
 * The shape of the real thing, honestly scoped. Credential material goes IN and a reference comes OUT; the reference is
 * all the rest of the system -- Julius's context, the connection record, the audit, the Connections surface, Wonderland
 * -- ever holds. Material is resolved only through `resolveForExecution`, which the connector runtime calls after the
 * capability gate allowed one use, and it is destroyed on revoke.
 *
 * WHAT IT IS NOT: durable or encrypted. It is process memory, nothing is written to disk, and it forgets everything when
 * the development service stops -- which is the point: no plaintext credential file is invented to stand in for a vault.
 * A production vault (OS keychain / KMS-backed secret store) implements the same port.
 *
 * The material here is always development dummy material produced by the development authorizer; no real secret has any
 * way in, because no real provider route exists in this build.
 */

interface Entry {
  readonly connectorId: string;
  readonly userId: string;
  readonly label: string;
  material: string | null;
}

export interface DevelopmentCredentialVault extends ConnectCredentialVaultPort {
  /** How many executions resolved material, for proof. Never the material. */
  resolutions(): number;
}

export function createDevelopmentCredentialVault(): DevelopmentCredentialVault {
  // A closure, not a field: nothing that serializes the vault object can reach the entries.
  const entries = new Map<string, Entry>();
  let resolved = 0;
  const vault: DevelopmentCredentialVault = {
    store({ connectorId, userId, material, label }) {
      const credentialRef = `vault://dev/${randomUUID()}`;
      entries.set(credentialRef, { connectorId, userId, label, material });
      return { credentialRef };
    },
    resolveForExecution({ credentialRef }) {
      const entry = entries.get(credentialRef);
      if (!entry || entry.material === null) return null;
      resolved += 1;
      return { material: entry.material };
    },
    revoke(credentialRef) {
      const entry = entries.get(credentialRef);
      if (entry) entry.material = null;
    },
    describe(credentialRef) {
      const entry = entries.get(credentialRef);
      return entry ? { credentialRef, connectorId: entry.connectorId, label: entry.label, revoked: entry.material === null } : null;
    },
    resolutions: () => resolved,
  };
  Object.defineProperty(vault, 'toJSON', { value: () => ({ kind: 'development-credential-vault', entries: entries.size }), enumerable: false });
  return vault;
}
