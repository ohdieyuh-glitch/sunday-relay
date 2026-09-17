import type { AuthorizationOutcome } from './connect-lifecycle';
import type { CapabilityRequest, ConnectorDescriptor } from './connect-contracts';

/**
 * JULIUS CONNECT — THE PORTS THE RUNTIME IMPLEMENTS.
 *
 * Types only; nothing here runs. The domain never touches a secret: the runtime's vault holds credential material and
 * hands the domain an opaque reference, and resolves that reference only inside the connector runtime, at the moment an
 * AUTHORIZED capability executes -- never into Julius's model context, a terminal, a log, Project Brain, the Mission
 * Contract, chat, audit text or a screenshot.
 */

export interface ConnectCredentialVaultPort {
  /** Store material the user produced at the trust boundary; returns the only thing the rest of the system ever sees. */
  store(input: { connectorId: string; userId: string; material: string; label: string }): { credentialRef: string };
  /**
   * Resolve a reference for ONE authorized capability execution. The runtime calls this after the gate allowed the use;
   * a revoked or unknown reference resolves to nothing.
   */
  resolveForExecution(input: { credentialRef: string; connectionId: string; capability: string }): { material: string } | null;
  /** Destroy the material a reference names. After this, resolution fails. */
  revoke(credentialRef: string): void;
  /** Safe metadata only -- never the material. */
  describe(credentialRef: string): { credentialRef: string; connectorId: string; label: string; revoked: boolean } | null;
}

/**
 * Completes an authorization the user approved: the OAuth exchange, the MCP handshake, the credential capture, the
 * governed browser sign-in. Development connectors complete deterministically without contacting anything.
 */
export interface ConnectAuthorizerPort {
  authorize(input: { connector: ConnectorDescriptor; request: CapabilityRequest; at: string }): AuthorizationOutcome;
}
