/**
 * SUNDAY RELAY — WEBSITE/CLI CAPABILITY PARITY REGISTRY (types).
 *
 * Sunday Relay is ONE repository. The website and the CLI are two SURFACES of
 * it, sharing the canonical domain modules directly, so there is one registry
 * and nothing to keep in sync across checkouts.
 *
 * The registry itself is JSON — `relay-surface-capabilities.json` — so that
 * ONE file is read by both the TypeScript tests and the dependency-free Node
 * check script, with no build step and no second source of truth.
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
   * Evidence references, each of which must resolve on disk: a file path, or
   * `path#anchor` where the anchor names something the file genuinely
   * contains. A waiver may not cite proof that does not exist — so unlike a
   * CLI entry point, evidence may NOT be a `relay …` command notation, which
   * nothing in this check resolves against the filesystem.
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

  /**
   * FILE claims. A `relay …` command notation is legitimate only in the two
   * CLI fields, where the CLI's own command tests are what verify it; in every
   * other field a command notation is a declaration nothing resolves on disk.
   */
  websiteEntryPoints: string[];
  cliEntryPoints: string[];

  websiteTestReferences: string[];
  cliTestReferences: string[];

  /**
   * The canonical modules BOTH surfaces import — the reason the website and
   * the CLI can agree at all. Required, and verified on exactly the same terms
   * as every other file claim: the file must exist inside this repository and
   * any anchor must name something it genuinely contains.
   */
  sharedDomainReferences: string[];

  exception?: RelaySurfaceException;
}

export interface RelaySurfaceCapabilityRegistry {
  manifestVersion: string;
  description: string;
  capabilities: RelaySurfaceCapability[];
}

/** Where the single canonical registry lives, for both surfaces. */
export const RELAY_PARITY_REGISTRY_PATH = 'src/relay/parity/relay-surface-capabilities.json';

/** A surface counts as PRESENT once it is implemented or tested. */
export function surfaceIsPresent(status: RelaySurfaceStatus): boolean {
  return status === 'implemented' || status === 'tested';
}
