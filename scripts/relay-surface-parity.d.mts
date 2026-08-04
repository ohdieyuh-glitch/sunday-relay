/**
 * Type declarations for the dependency-free parity checker.
 *
 * The checker is authored as plain `.mjs` on purpose: the npm script runs it
 * with `node` and no build step, and the TypeScript tests import the SAME
 * functions, so there is exactly one implementation of the parity rules.
 * These declarations give the test suite type safety over that module.
 */

export interface ParityFailure {
  capabilityId: string;
  rule: string;
  detail: string;
}

export interface ParityResult {
  ok: boolean;
  failures: ParityFailure[];
}

export interface LoadedRegistry {
  registry: { manifestVersion: string; capabilities: unknown[]; [key: string]: unknown };
  checksum: string;
  path: string;
}

export type LoadResult =
  | { ok: true; value: LoadedRegistry }
  | { ok: false; error: string };

export const REGISTRY_RELATIVE_PATH: string;
export const PARITY_CLASSES: string[];
export const SURFACE_STATUSES: string[];
export const DOMAINS: string[];
export const DEFAULT_COMPANION_PATHS: string[];

export function loadRegistry(repoRoot: string): LoadResult;

export function validateRegistry(
  registry: unknown,
  options?: { now?: string },
): ParityResult;

export function compareRegistries(
  local: { registry: { manifestVersion: string }; checksum: string },
  companion: { registry: { manifestVersion: string }; checksum: string },
): ParityResult;

/**
 * Companion comparison is opt-in: `explicit` is required, and there are no
 * default search paths (the old defaults pointed at Alcatraz worktrees).
 */
export function findCompanion(repoRoot: string, explicit?: string): string | null;

/* ------------------------- founder exception policy --------------------- */

export const FOUNDER_IDENTITIES: readonly string[];
export const MAX_EXCEPTION_LIFETIME_DAYS: number;
export const MIN_EXCEPTION_REASON_LENGTH: number;
export const REQUIRED_CAPABILITIES: readonly string[];
export const NON_EXEMPTIBLE_CAPABILITIES: readonly string[];

/**
 * Every reason the exception on `capability` is not a valid founder waiver.
 * An empty list is the ONLY thing that grants exemption.
 */
export function validateException(
  capability: unknown,
  now: string,
): Array<{ rule: string; detail: string }>;

/* ------------------------ declaration classification -------------------- */

export const COMMAND_PREFIX: RegExp;
export const DECLARABLE_EXTENSIONS: readonly string[];
export const ANCHOR_SEGMENT: RegExp;

export type DeclarationClassification =
  | { kind: 'file'; path: string; anchor: string | null }
  | { kind: 'command'; command: string }
  | { kind: 'invalid'; reason: string };

/**
 * Structural classification of one registry declaration. There is no silent
 * third branch: a declaration is a `relay …` command, a well-formed file
 * claim, or a FINDING. Whitespace can no longer demote a file claim.
 */
export function classifyDeclaration(declared: unknown): DeclarationClassification;

/** `path/to/file.ts#symbol` → `path/to/file.ts`. */
export function declaredPathOf(declared: string): string;

/** True when a declaration classifies as a FILE claim. */
export function isFileClaim(declared: string): boolean;

/** Resolves a declared path inside the repository, refusing escapes. */
export function resolveInsideRepo(
  repoRoot: string,
  path: string,
): { ok: true; full: string } | { ok: false; reason: string };

/** Splits an anchor into every segment that must appear in the file. */
export function anchorSegments(anchor: string): string[];

/** Every anchor segment must be well-formed AND present in the file. */
export function verifyAnchor(
  content: string,
  anchor: string,
): { ok: true; segments: string[] } | { ok: false; reason: string };

export interface DeclarationFieldSpec {
  /** The registry field, or `exception.evidence`. */
  field: string;
  /** The rule-name fragment used when the declaration does not resolve. */
  kind: string;
  /**
   * Whether a `relay …` COMMAND notation is legitimate here. Only the CLI's
   * entry points and test references admit one; every other field declares
   * FILES, and a command there would be verified by nothing.
   */
  commandsAllowed: boolean;
}

/** Every field the registry declares evidence in, including shared domain. */
export const DECLARATION_FIELDS: readonly DeclarationFieldSpec[];
export const EXCEPTION_EVIDENCE_FIELD: DeclarationFieldSpec;

/**
 * Every declaration the registry makes must resolve in this repository: the
 * file must exist inside the tree and any anchor must name something the file
 * genuinely contains. Exception evidence is held to the same standard.
 * `checked` counts file claims inspected, `present` counts those that fully
 * resolved, and `commands` counts `relay …` notations in the two fields where
 * a command is legitimate — those the CLI's own command tests verify.
 */
export function verifyDeclaredFiles(
  repoRoot: string,
  registry: unknown,
): ParityResult & { checked: number; present: number; commands: number };

export function runParityCheck(options: {
  repoRoot: string;
  strict?: boolean;
  companionPath?: string;
  now?: string;
}): ParityResult & { lines: string[] };

/* ---------------------- website reachability (the mount) ---------------- */

/** Entries a browser genuinely loads, mirroring the browser boundary guard. */
export const BROWSER_ENTRY_POINTS: readonly string[];

/**
 * Website surfaces that are DECLARED and TESTED but that no browser entry
 * renders, each mapped to the reason an operator cannot reach them. Recording
 * one is a disclosure, not an approval, and the record is checked in both
 * directions.
 */
export const UNMOUNTED_WEBSITE_SURFACES: Readonly<Record<string, string>>;

/**
 * Remove `//` and block comments while leaving string and template literals
 * intact, so a commented-out import contributes no edge and a specifier holding
 * `//` inside a string is not truncated.
 */
export function stripComments(source: string): string;

/**
 * Every module specifier a source file imports that a bundler would actually
 * follow. Comments and type-only clauses are excluded; the one surviving
 * over-approximation (an unconsumed barrel re-export) is stated in the
 * implementation's doc block rather than hidden.
 */
export function importSpecifiersOf(source: string): string[];

/**
 * Resolve one specifier to a repo-relative module path, or `null` for a
 * package, an asset, or anything outside the tree. Conservative by design: an
 * unresolved edge is an edge not followed, which can only understate
 * reachability — a loud false failure, never a silent false pass.
 */
export function resolveModuleSpecifier(
  repoRoot: string,
  fromRelative: string,
  specifier: string,
): string | null;

/** Every module a browser entry can reach, as repo-relative paths. */
export function reachableFromBrowserEntries(
  repoRoot: string,
  entries?: readonly string[],
): Set<string>;

/**
 * Existence is not reachability. Every implemented or tested website entry
 * point must be reachable from a browser entry, or be recorded as unmounted
 * with a reason. `record` is injectable so the rules can be proven to FAIL;
 * production callers use the default.
 */
export function verifyWebsiteReachability(
  repoRoot: string,
  registry: unknown,
  record?: Readonly<Record<string, string>>,
): ParityResult & { checked: number; mounted: number; unmounted: string[] };
