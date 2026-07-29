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

export interface RelaySurfaceException {
  reason: string;
  /** Founder identity. A developer may not self-exempt a capability. */
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
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
