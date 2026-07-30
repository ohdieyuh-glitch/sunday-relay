/**
 * SUNDAY RELAY — WEBSITE/CLI CAPABILITY PARITY REGISTRY (types).
 *
 * The registry itself is JSON — `relay-surface-capabilities.json`, byte-
 * identical in the website and CLI repositories — so that ONE file is read by
 * both the TypeScript tests and the dependency-free Node check script, with no
 * build step and no second source of truth.
 *
 * These types describe that file. See docs/relay/WEBSITE_CLI_PARITY_CONTRACT.md
 * for the contract they enforce.
 */

export type RelaySurfaceDomain =
  | 'project'
  | 'mission'
  | 'command'
  | 'agent'
  | 'psp'
  | 'workspace'
  | 'review'
  | 'evidence'
  | 'economics'
  | 'trace'
  | 'identity'
  | 'relay_dog'
  | 'settings';

/**
 * functional_required        the capability must EXIST on both surfaces
 * semantic_visual_required   both surfaces must communicate the same state or
 *                            identity; presentation may differ
 * surface_specific           allowed ONLY with a founder-approved exception
 */
export type RelayParityClass =
  | 'functional_required'
  | 'semantic_visual_required'
  | 'surface_specific';

export type RelaySurfaceStatus = 'not_started' | 'planned' | 'implemented' | 'tested';

/**
 * A parity exception SUSPENDS the product's central promise, so every field
 * here is mandatory and the checker validates each one. Partial compliance
 * grants nothing: an exception exempts a capability only when it is valid in
 * every respect. See `scripts/relay-surface-parity.mjs#validateException`.
 */
export interface RelaySurfaceException {
  /** A real justification — placeholder-length strings are rejected. */
  reason: string;
  /**
   * The CANONICAL founder identity, from the checker's fixed allowlist. A
   * generic word, an agent name, or an anonymous value is not an approval,
   * and a developer may never self-exempt a capability.
   */
  approvedBy: string;
  /** ISO instant; may not be in the future. */
  approvedAt: string;
  /**
   * ISO instant; MUST be in the future and within the checker's bounded
   * maximum lifetime. There is no permanent parity exception.
   */
  expiresAt: string;
  /** Exactly the capabilityId this exception sits on. Never a wildcard. */
  affectedCapability: string;
  /** The surface that is genuinely absent. */
  missingSurface: 'website' | 'cli';
  /**
   * Evidence references, in the same notation as entry points, each of which
   * must resolve on disk. A waiver may not cite proof that does not exist.
   */
  evidence: string[];
}

export interface RelaySurfaceCapability {
  capabilityId: string;
  name: string;
  domain: RelaySurfaceDomain;
  parityClass: RelayParityClass;

  websiteStatus: RelaySurfaceStatus;
  cliStatus: RelaySurfaceStatus;

  websiteEntryPoints: string[];
  cliEntryPoints: string[];

  websiteTestReferences: string[];
  cliTestReferences: string[];

  sharedDomainReferences: string[];

  exception?: RelaySurfaceException;
}

export interface RelaySurfaceCapabilityRegistry {
  manifestVersion: string;
  description: string;
  capabilities: RelaySurfaceCapability[];
}

/** Where the canonical registry lives in BOTH repositories. */
export const RELAY_PARITY_REGISTRY_PATH = 'src/relay/parity/relay-surface-capabilities.json';

/** A surface counts as PRESENT once it is implemented or tested. */
export function surfaceIsPresent(status: RelaySurfaceStatus): boolean {
  return status === 'implemented' || status === 'tested';
}
