/**
 * MCP SERVER IDENTITY AND TRUST (PURE).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (directive §4):
 *
 *     A configured label is not a verified identity.
 *     A reachable process is not a trusted server.
 *
 * Those two sentences are why identity is four separate fields instead of one
 * string. Every MCP host that gets breached through a "trusted" server got
 * there by having one field:
 *
 *   configured   what the operator typed, or what a registry entry is named.
 *                Attacker-influenced in exactly the way a filename is.
 *   requested    what Relay asked for when it opened the connection — the
 *                registry entry's declared identity.
 *   declared     what the server said it was in its `initialize` result.
 *                UNTRUSTED INPUT. A server can call itself anything.
 *   verified     what Relay independently confirmed, and by what means.
 *                Null until something actually verified it.
 *
 * `declared` and `verified` are never merged, because merging them is exactly
 * the bug: it makes a server's own claim about itself into Relay's belief
 * about it. `identityConfirmed` below is false whenever verification did not
 * happen, and every trust decision reads that field rather than the name.
 *
 * WHAT VERIFICATION MEANS TODAY, stated honestly: for a curated stdio entry it
 * is a match between the registry's declared identity and the server's own
 * declaration, plus the executable allowlist that decided what could be
 * launched at all. For Streamable HTTP it additionally includes the origin the
 * response actually came from. It is NOT a signature check — Relay does not
 * yet have a publisher-signing story, and `verificationMethod` says
 * `registry_match` rather than pretending otherwise.
 */

import type { McpRegistryEntryId } from '../../protocol/ids';

/** How a declared identity was checked. `none` is a real, common answer. */
export const MCP_VERIFICATION_METHODS = [
  'none',
  /** The server's declaration matched its curated registry entry. */
  'registry_match',
  /** Registry match, plus the response came from the expected origin. */
  'registry_match_and_origin',
  /** A checksum over the launched artifact matched the registry's. */
  'artifact_checksum',
] as const;
export type McpVerificationMethod = (typeof MCP_VERIFICATION_METHODS)[number];

/**
 * Trust is a property of the REGISTRY ENTRY plus what verification achieved —
 * never of the connection succeeding. `untrusted` is the default everywhere.
 */
export const MCP_SERVER_TRUST_LEVELS = [
  /** Not curated, or curated and refused. Never usable. */
  'untrusted',
  /** Curated and approved, but nothing about the running server was verified. */
  'registry_declared',
  /** Curated, approved, and the running server matched its declaration. */
  'registry_verified',
] as const;
export type McpServerTrust = (typeof MCP_SERVER_TRUST_LEVELS)[number];

/** What a server says about itself. Every field is untrusted external input. */
export interface McpDeclaredServerIdentity {
  readonly name: string;
  readonly version: string | null;
  /** Free-form server title, when the server supplies one. */
  readonly title: string | null;
}

/** What the registry says the server should be. */
export interface McpRequestedServerIdentity {
  readonly registryEntryId: McpRegistryEntryId;
  readonly expectedName: string;
  readonly expectedVersion: string | null;
  /** For HTTP: the exact origin Relay expects to be talking to. */
  readonly expectedOrigin: string | null;
}

export interface McpServerIdentity {
  /** The operator-facing label. Carries no authority whatsoever. */
  readonly configuredName: string;
  readonly requested: McpRequestedServerIdentity;
  /** Null until `initialize` returned. */
  readonly declared: McpDeclaredServerIdentity | null;
  /** Null unless verification actually ran AND succeeded. */
  readonly verified: McpDeclaredServerIdentity | null;
  readonly verificationMethod: McpVerificationMethod;
  readonly trust: McpServerTrust;
  /** The origin a Streamable HTTP response was actually served from. */
  readonly observedOrigin: string | null;
}

/** The one question policy is allowed to ask. Never `identity.declared.name`. */
export const identityConfirmed = (identity: McpServerIdentity): boolean =>
  identity.verified !== null
  && identity.verificationMethod !== 'none'
  && identity.trust === 'registry_verified';

/**
 * Compares a server's own declaration against what the registry expected.
 *
 * A version MISMATCH does not fail verification on its own — servers legitimately
 * ship patch releases between curation passes — but it is reported, and the
 * registry may pin an exact version when that matters. A NAME mismatch always
 * fails: the name is the thing the registry entry is about.
 */
export function verifyDeclaredIdentity(
  requested: McpRequestedServerIdentity,
  declared: McpDeclaredServerIdentity | null,
  observedOrigin: string | null,
): { readonly verified: McpDeclaredServerIdentity | null; readonly method: McpVerificationMethod; readonly trust: McpServerTrust; readonly notes: readonly string[] } {
  const notes: string[] = [];
  if (declared === null) {
    return { verified: null, method: 'none', trust: 'registry_declared', notes: ['the server declared no identity during initialize'] };
  }
  if (declared.name !== requested.expectedName) {
    notes.push(
      `the server declared the name "${declared.name}" but the registry entry expects "${requested.expectedName}"`,
    );
    return { verified: null, method: 'none', trust: 'untrusted', notes };
  }
  if (requested.expectedVersion !== null && declared.version !== requested.expectedVersion) {
    notes.push(
      `the server reports version ${declared.version ?? 'unknown'} where the registry expects ${requested.expectedVersion}`,
    );
  }
  if (requested.expectedOrigin !== null) {
    if (observedOrigin === null) {
      notes.push('no response origin was observed, so origin could not be confirmed');
      return { verified: declared, method: 'registry_match', trust: 'registry_verified', notes };
    }
    if (observedOrigin !== requested.expectedOrigin) {
      notes.push(`the response came from ${observedOrigin} but the registry entry expects ${requested.expectedOrigin}`);
      return { verified: null, method: 'none', trust: 'untrusted', notes };
    }
    return { verified: declared, method: 'registry_match_and_origin', trust: 'registry_verified', notes };
  }
  return { verified: declared, method: 'registry_match', trust: 'registry_verified', notes };
}
