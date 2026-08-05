/**
 * SUNDAY RELAY — WEBSITE/CLI SURFACE PARITY CHECK.
 *
 * Every meaningful Relay capability must exist on BOTH surfaces: the
 * website/application and the CLI/terminal. They are two interfaces to one
 * product, and this check is what stops them becoming two products.
 *
 * ONE implementation, used by both the npm script and the test suite — there
 * is deliberately no second copy of these rules. Pure, deterministic, and
 * dependency-free (node builtins only).
 *
 * MODES
 *   local (default)  validate this repository's registry and confirm that every
 *                    declaration resolves on disk — each surface's entry points
 *                    and test references, the SHARED DOMAIN modules both
 *                    surfaces import, and any exception's cited evidence.
 *                    A missing or unresolvable declaration is a FAILURE here
 *                    too — parity is not advisory in either mode.
 *   --strict         CI mode. Adds the one thing CI must refuse that a local
 *                    run may merely warn about: a registry that declares NO
 *                    verifiable file evidence at all. "0/0 present" reads
 *                    like a pass and is not one.
 *
 * POST-SEPARATION NOTE — why there is no longer a "companion repository".
 * This check was written when the website and the CLI lived in two separate
 * Alcatraz WORKTREES, so proving parity meant comparing two copies of the
 * registry across two checkouts. `--strict` REQUIRED that second checkout,
 * and the default search paths pointed into the Alcatraz repository.
 *
 * Both surfaces now live in this one repository, so:
 *   - requiring an Alcatraz checkout would be cross-product coupling, and
 *     would fail outright in CI where no such path exists;
 *   - the far stronger property is available here: every website and CLI
 *     entry point and test reference the registry names must actually EXIST
 *     in this tree. A registry that claims a capability whose file is gone is
 *     exactly the drift this check is for.
 *
 * `--companion <path>` is still honoured when passed EXPLICITLY (useful for
 * comparing against another Relay checkout), but it is never searched for by
 * default and never required.
 *
 * Run:  npm run relay:surface-parity:check [-- --strict] [-- --companion <path>]
 */

import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const REGISTRY_RELATIVE_PATH = join('src', 'relay', 'parity', 'relay-surface-capabilities.json');

export const PARITY_CLASSES = ['functional_required', 'semantic_visual_required', 'surface_specific'];
export const SURFACE_STATUSES = ['not_started', 'planned', 'implemented', 'tested'];
export const DOMAINS = [
  'project', 'mission', 'command', 'agent', 'psp', 'workspace', 'review',
  'evidence', 'economics', 'trace', 'identity', 'relay_dog', 'settings',
];

/** A surface counts as PRESENT once it is implemented or tested. */
const isPresent = (status) => status === 'implemented' || status === 'tested';

/* --------------------- founder exception policy ------------------------- *
 *
 * An exception SUSPENDS the product's central promise — that the website and
 * the CLI are two interfaces to one product. The previous rule accepted any
 * non-empty `approvedBy` string, so `approvedBy: "me"` with no expiry was a
 * permanent, self-granted waiver that the check reported as PASS.
 *
 * The repaired policy is deliberately hard to satisfy:
 *
 *   - the approver must be the CANONICAL FOUNDER IDENTITY, from a fixed
 *     allowlist. A generic word ("founder", "admin"), an agent name, or an
 *     empty/anonymous value is not an approval;
 *   - a reason is mandatory and must be a real sentence, not a placeholder;
 *   - both dates are mandatory. `approvedAt` may not be in the future and
 *     `expiresAt` must be in the future — there is NO permanent exception;
 *   - the lifetime is bounded, so an exception cannot be granted for a decade;
 *   - the exception must name the exact capability it covers (no wildcard)
 *     and the exact surface that is missing, and that surface must actually
 *     be the missing one;
 *   - it must cite evidence, and the evidence must resolve on disk like any
 *     other declaration;
 *   - capabilities that carry CORE MISSION TRUTH cannot be exempted at all.
 * ----------------------------------------------------------------------- */

/**
 * The canonical founder identity. Deliberately a single, unambiguous, fully
 * qualified form: the bare word "founder" is exactly the value the old rule
 * accepted from anyone, so it is not accepted here.
 */
export const FOUNDER_IDENTITIES = Object.freeze(['founder:ohdieyuh-glitch']);

/** No exception may outlive this many days from its approval. */
export const MAX_EXCEPTION_LIFETIME_DAYS = 90;

/** A reason shorter than this is a placeholder, not a justification. */
export const MIN_EXCEPTION_REASON_LENGTH = 24;

/** Capabilities that must exist in the registry at all. */
export const REQUIRED_CAPABILITIES = Object.freeze([
  'relay-dog-identity',
  'relay-dog-state-semantics',
  'psp-agent-id-import',
]);

/**
 * CORE MISSION TRUTH. Exempting any of these would let one surface tell an
 * operator something the other surface cannot — about who reviewed, what was
 * verified, what was repaired, what was approved, or what a mission cost.
 * No founder approval unlocks these; the capability must be implemented.
 */
export const NON_EXEMPTIBLE_CAPABILITIES = Object.freeze([
  ...REQUIRED_CAPABILITIES,
  'mission-contract-creation',
  'mission-status',
  'review',
  'repair',
  'approval',
  'evidence-inspection',
  'verified-mission-cost',
]);

const DAY_MS = 86_400_000;
const WILDCARD = /[*?]|^(all|any|every|\.\*)$/i;

/** Parses an ISO instant, returning null for anything unparseable. */
const instant = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Validates one exception and returns EVERY reason it is not a valid founder
 * waiver. An exception grants exemption only when this returns an empty list —
 * partial compliance grants nothing.
 */
export function validateException(capability, now) {
  const failures = [];
  const fail = (rule, detail) => failures.push({ rule, detail });
  const exception = capability?.exception;
  const nowMs = instant(now) ?? 0;

  if (!exception || typeof exception !== 'object') {
    fail('exception-missing', 'no exception record');
    return failures;
  }

  if (capability.parityClass !== 'surface_specific') {
    fail(
      'exception-not-permitted',
      `parityClass "${capability.parityClass}" can never be exempted — an exception here is dead metadata that reads as an approval`,
    );
  }
  if (NON_EXEMPTIBLE_CAPABILITIES.includes(capability.capabilityId)) {
    fail(
      'exception-non-exemptible',
      `${capability.capabilityId} carries core mission truth and cannot be exempted by any approval`,
    );
  }

  /* -------------------------------- reason ---------------------------- */
  if (typeof exception.reason !== 'string' || exception.reason.trim().length < MIN_EXCEPTION_REASON_LENGTH) {
    fail(
      'exception-reason',
      `a reason of at least ${MIN_EXCEPTION_REASON_LENGTH} characters is required, explaining why no CLI/website equivalent can exist`,
    );
  }

  /* ------------------------------- approver --------------------------- */
  const approvedBy = typeof exception.approvedBy === 'string' ? exception.approvedBy.trim() : '';
  if (approvedBy === '') {
    fail('exception-approver', 'exception requires approvedBy (the canonical founder identity)');
  } else if (!FOUNDER_IDENTITIES.includes(approvedBy)) {
    fail(
      'exception-approver',
      `"${approvedBy}" is not the canonical founder identity — expected one of ${FOUNDER_IDENTITIES.join(', ')}`,
    );
  }

  /* --------------------------------- dates ---------------------------- */
  const approvedAt = instant(exception.approvedAt);
  if (approvedAt === null) {
    fail('exception-approved-at', 'exception requires a parseable ISO approvedAt');
  } else if (approvedAt > nowMs) {
    fail('exception-approved-at', `approvedAt ${exception.approvedAt} is in the future`);
  }

  const expiresAt = instant(exception.expiresAt);
  if (expiresAt === null) {
    fail(
      'exception-expires-at',
      'exception requires a parseable ISO expiresAt — there is no permanent parity exception',
    );
  } else if (expiresAt <= nowMs) {
    fail('expired-exception', `exception expired at ${exception.expiresAt}`);
  }

  if (approvedAt !== null && expiresAt !== null && expiresAt - approvedAt > MAX_EXCEPTION_LIFETIME_DAYS * DAY_MS) {
    fail(
      'exception-lifetime',
      `an exception may not run longer than ${MAX_EXCEPTION_LIFETIME_DAYS} days (this one runs ${Math.round((expiresAt - approvedAt) / DAY_MS)})`,
    );
  }

  /* ------------------------- what it actually covers ------------------ */
  const affected = typeof exception.affectedCapability === 'string' ? exception.affectedCapability.trim() : '';
  if (affected === '') {
    fail('exception-affected-capability', 'exception must name the capability it covers');
  } else if (WILDCARD.test(affected)) {
    fail('exception-affected-capability', `"${affected}" is a wildcard — an exception covers exactly one capability`);
  } else if (affected !== capability.capabilityId) {
    fail(
      'exception-affected-capability',
      `exception names "${affected}" but sits on "${capability.capabilityId}"`,
    );
  }

  const missingSurface = exception.missingSurface;
  const websitePresent = isPresent(capability.websiteStatus);
  const cliPresent = isPresent(capability.cliStatus);
  if (missingSurface !== 'website' && missingSurface !== 'cli') {
    fail('exception-missing-surface', 'exception must name the missing surface: "website" or "cli"');
  } else if (missingSurface === 'website' && websitePresent) {
    fail('exception-missing-surface', 'the exception claims the website is missing, but it is implemented');
  } else if (missingSurface === 'cli' && cliPresent) {
    fail('exception-missing-surface', 'the exception claims the CLI is missing, but it is implemented');
  }

  /* -------------------------------- evidence -------------------------- *
   * A waiver may not cite proof that does not exist — so evidence must be a
   * FILE claim, and `verifyDeclaredFiles` then resolves it on disk.
   *
   * THE BYPASS THIS CLOSES. Evidence was classified with the same classifier
   * as an entry point, and a `relay …` notation is deliberately NOT checked
   * against the filesystem (the CLI's own command tests verify commands). So
   * `relay this-command-does-not-exist --fabricated` satisfied the evidence
   * requirement with zero verification: an invented string was accepted as the
   * proof that suspends the product's central promise. Evidence is the one
   * place a command notation can never be legitimate, because nothing else in
   * this check will ever look for it.
   * --------------------------------------------------------------------- */
  const evidence = exception.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail('exception-evidence', 'exception must cite at least one evidence reference');
  } else {
    const seen = new Set();
    for (const declared of evidence) {
      const classified = classifyDeclaration(declared);
      if (classified.kind === 'invalid') {
        fail('exception-evidence', `evidence ${JSON.stringify(declared)}: ${classified.reason}`);
        continue;
      }
      if (classified.kind !== 'file') {
        fail(
          'exception-evidence',
          `evidence ${JSON.stringify(declared)} is a "relay …" command notation, which no check resolves on disk`
          + ' — a waiver must cite a file that exists',
        );
        continue;
      }
      const key = `${classified.path}#${classified.anchor ?? ''}`;
      if (seen.has(key)) {
        fail('exception-evidence', `evidence ${JSON.stringify(declared)} is cited more than once`);
      }
      seen.add(key);
    }
  }

  return failures;
}

/* ------------------------------- loading -------------------------------- */

export function loadRegistry(repoRoot) {
  const path = join(repoRoot, REGISTRY_RELATIVE_PATH);
  if (!existsSync(path)) {
    return { ok: false, error: `registry not found at ${path}` };
  }
  const raw = readFileSync(path, 'utf8');
  try {
    return {
      ok: true,
      value: {
        registry: JSON.parse(raw),
        checksum: createHash('sha256').update(raw).digest('hex'),
        path,
      },
    };
  } catch (err) {
    return { ok: false, error: `registry at ${path} is not valid JSON: ${err.message}` };
  }
}

/* ------------------------------ validation ------------------------------ */

/**
 * Validate one registry. `now` is injected so exception expiry is
 * deterministic and testable — this function never reads a clock.
 */
export function validateRegistry(registry, options = {}) {
  const now = options.now ?? '1970-01-01T00:00:00.000Z';
  const failures = [];
  const fail = (capabilityId, rule, detail) => failures.push({ capabilityId, rule, detail });

  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.capabilities)) {
    return { ok: false, failures: [{ capabilityId: '(registry)', rule: 'shape', detail: 'registry has no capabilities array' }] };
  }
  if (typeof registry.manifestVersion !== 'string' || registry.manifestVersion === '') {
    fail('(registry)', 'manifest-version', 'manifestVersion is required');
  }

  const seen = new Set();
  for (const capability of registry.capabilities) {
    const id = capability?.capabilityId ?? '(missing id)';

    /* ------------------------------- shape ------------------------------ */
    if (typeof capability.capabilityId !== 'string' || capability.capabilityId === '') {
      fail(id, 'capability-id', 'capabilityId is required');
    } else if (seen.has(capability.capabilityId)) {
      fail(id, 'duplicate-capability-id', 'capabilityId appears more than once');
    } else {
      seen.add(capability.capabilityId);
    }
    if (!DOMAINS.includes(capability.domain)) {
      fail(id, 'domain', `unknown domain "${capability.domain}"`);
    }
    if (!PARITY_CLASSES.includes(capability.parityClass)) {
      fail(id, 'parity-class', `unknown parityClass "${capability.parityClass}"`);
    }
    if (!SURFACE_STATUSES.includes(capability.websiteStatus)) {
      fail(id, 'website-status', `unknown websiteStatus "${capability.websiteStatus}"`);
    }
    if (!SURFACE_STATUSES.includes(capability.cliStatus)) {
      fail(id, 'cli-status', `unknown cliStatus "${capability.cliStatus}"`);
    }

    const website = isPresent(capability.websiteStatus);
    const cli = isPresent(capability.cliStatus);
    const exception = capability.exception;

    /* ---------------------------- exceptions ---------------------------- */
    if (capability.parityClass === 'surface_specific' && !exception) {
      fail(id, 'unapproved-exception',
        'surface_specific requires a complete, founder-approved, expiring exception');
    }

    // An exception exempts ONLY when it is valid in every respect. Partial
    // compliance grants nothing — that is what made the old rule bypassable.
    let exceptionFailures = [];
    if (exception) {
      exceptionFailures = validateException(capability, now);
      for (const failure of exceptionFailures) fail(id, failure.rule, failure.detail);
    }
    const exempt = Boolean(
      exception && capability.parityClass === 'surface_specific' && exceptionFailures.length === 0,
    );

    /* ------------------------------ parity ------------------------------ */
    if (!exempt) {
      if (website && !cli) {
        fail(id, 'missing-cli-implementation',
          `website is ${capability.websiteStatus} but CLI is ${capability.cliStatus}`);
      }
      if (cli && !website) {
        fail(id, 'missing-website-implementation',
          `CLI is ${capability.cliStatus} but website is ${capability.websiteStatus}`);
      }
    }

    /* ------------------------- entry points/tests ----------------------- */
    if (website && (!Array.isArray(capability.websiteEntryPoints) || capability.websiteEntryPoints.length === 0)) {
      fail(id, 'missing-website-entry-point', 'an implemented website capability needs an entry point');
    }
    if (cli && (!Array.isArray(capability.cliEntryPoints) || capability.cliEntryPoints.length === 0)) {
      fail(id, 'missing-cli-entry-point', 'an implemented CLI capability needs an entry point');
    }
    if (capability.websiteStatus === 'tested'
      && (!Array.isArray(capability.websiteTestReferences) || capability.websiteTestReferences.length === 0)) {
      fail(id, 'missing-website-tests', 'websiteStatus "tested" requires at least one test reference');
    }
    if (capability.cliStatus === 'tested'
      && (!Array.isArray(capability.cliTestReferences) || capability.cliTestReferences.length === 0)) {
      fail(id, 'missing-cli-tests', 'cliStatus "tested" requires at least one test reference');
    }

    /* --------------------- evidence must be DISTINCT -------------------- *
     * Declaring the same reference twice, or citing one surface's file as
     * the other surface's implementation, is how a registry can claim parity
     * it does not have. Shared DOMAIN tests are legitimate and stay allowed —
     * what is required is that each present surface also carries at least one
     * piece of evidence that is genuinely its own.
     * ------------------------------------------------------------------- */
    const list = (field) => (Array.isArray(capability[field]) ? capability[field] : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim());

    for (const field of ['websiteEntryPoints', 'cliEntryPoints', 'websiteTestReferences', 'cliTestReferences']) {
      const values = list(field);
      const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
      for (const duplicate of new Set(duplicates)) {
        fail(id, 'duplicate-declaration', `${field} names ${duplicate} more than once`);
      }
    }

    const websiteEntries = list('websiteEntryPoints');
    const cliEntries = list('cliEntryPoints');
    for (const shared of websiteEntries.filter((value) => cliEntries.includes(value))) {
      fail(id, 'shared-entry-point',
        `${shared} is declared as BOTH the website and the CLI entry point — one file cannot be two surfaces`);
    }

    const websiteTests = list('websiteTestReferences');
    const cliTests = list('cliTestReferences');
    if (capability.websiteStatus === 'tested' && websiteTests.length > 0
      && websiteTests.every((value) => cliTests.includes(value))) {
      fail(id, 'no-distinct-website-evidence',
        'every website test reference is also a CLI test reference — no evidence is specific to the website surface');
    }
    if (capability.cliStatus === 'tested' && cliTests.length > 0
      && cliTests.every((value) => websiteTests.includes(value))) {
      fail(id, 'no-distinct-cli-evidence',
        'every CLI test reference is also a website test reference — no evidence is specific to the CLI surface');
    }
  }

  /* ------------------------ milestone requirements ---------------------- */
  const required = ['relay-dog-identity', 'relay-dog-state-semantics', 'psp-agent-id-import'];
  for (const capabilityId of required) {
    if (!seen.has(capabilityId)) {
      fail(capabilityId, 'missing-required-capability',
        'this capability must be present in the parity registry');
    }
  }

  return { ok: failures.length === 0, failures };
}

/* --------------------------- companion compare -------------------------- */

/**
 * Compares this registry against ANOTHER Relay checkout's copy: same manifest
 * version, same checksum. A divergence is a failure — never a silent pass.
 *
 * This is OPT-IN and is never part of proving parity here. Sunday Relay is ONE
 * repository, and the website and the CLI are two SURFACES of it that share
 * the canonical modules directly, so nothing has to be duplicated across
 * checkouts for them to agree. (Superseded framing: when the two surfaces
 * lived in separate worktrees that could not import each other, comparing two
 * copies of the registry was the only available proof.) Parity is proven here
 * by `verifyDeclaredFiles` — every declaration resolving in this tree.
 */
export function compareRegistries(local, companion) {
  const failures = [];
  if (local.registry.manifestVersion !== companion.registry.manifestVersion) {
    failures.push({
      capabilityId: '(manifest)',
      rule: 'manifest-version-mismatch',
      detail: `local ${local.registry.manifestVersion} != companion ${companion.registry.manifestVersion}`,
    });
  }
  if (local.checksum !== companion.checksum) {
    failures.push({
      capabilityId: '(manifest)',
      rule: 'manifest-checksum-mismatch',
      detail: `local ${local.checksum.slice(0, 16)}… != companion ${companion.checksum.slice(0, 16)}…`,
    });
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Companion comparison is OPT-IN only. There are deliberately no default
 * search paths: the previous defaults pointed at Alcatraz worktrees, which
 * made a Relay check depend on the other product's checkout.
 */
export const DEFAULT_COMPANION_PATHS = [];

export function findCompanion(repoRoot, explicit) {
  if (!explicit) return null;
  const path = resolve(explicit);
  if (path === resolve(repoRoot)) return null;
  return existsSync(join(path, REGISTRY_RELATIVE_PATH)) ? path : null;
}

/* ------------------------ declared-file existence ----------------------- */

/**
 * Both surfaces live in this repository now, so every entry point and test
 * reference the registry declares must resolve to a real file. This is what
 * replaces the cross-checkout comparison: it catches a registry that still
 * claims a capability whose implementation or test has been deleted, renamed,
 * or never landed.
 */
/**
 * The registry declares entry points in two legitimate notations:
 *
 *   FILE     `src/relay/cli/product/app.ts`
 *            `src/relay/cli/product/app.ts#DRAFT_FIELDS`      symbol anchor
 *            `src/relay/ui/.../RelayMissionEconomics.tsx#VIEW RECEIPTS`  text
 *            `src/relay/core/app.ts#pause -> pause-run`       mapping anchor
 *   COMMAND  `relay mission budget`
 *            `relay (interactive) /pause`
 *
 * THE BYPASS THIS REPLACES. The old discriminator was "contains no
 * whitespace and ends in an extension". Whitespace therefore DEMOTED a file
 * claim to a command: `"src/relay/ui/gone.tsx "` — one trailing space — was
 * silently classified as a CLI command and never checked on disk. Any deleted
 * or invented file could be kept in the registry that way, and the check
 * still printed PASS.
 *
 * The repaired classifier is structural and has no silent third branch:
 *
 *   - a COMMAND is anything beginning with the CLI binary name `relay`, and
 *     is verified by the CLI's own command tests rather than the filesystem;
 *   - everything else MUST be a well-formed file claim;
 *   - anything that is neither is a FAILURE (`unparseable-declaration`),
 *     never a skip. Whitespace can no longer turn a file claim into a
 *     non-file claim, because a non-file claim must say `relay …`.
 */

/** The CLI binary name — the only prefix that marks a command notation. */
export const COMMAND_PREFIX = /^relay(\s|$)/;

/** Extensions the registry may declare as source evidence. */
export const DECLARABLE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.md', '.yml', '.yaml',
]);

/** A resolvable anchor segment: an identifier, a dotted path, or UI text. */
export const ANCHOR_SEGMENT = /^[A-Za-z_][A-Za-z0-9_ ./-]*$/;

/**
 * Classifies one declaration. Returns `{kind:'file'|'command'|'invalid'}` —
 * and `invalid` is a finding, never something the caller may skip.
 */
export function classifyDeclaration(declared) {
  if (typeof declared !== 'string') {
    return { kind: 'invalid', reason: `declaration is ${declared === null ? 'null' : typeof declared}, not a string` };
  }
  const raw = declared.trim();
  if (raw === '') return { kind: 'invalid', reason: 'declaration is empty or whitespace only' };
  if (COMMAND_PREFIX.test(raw)) return { kind: 'command', command: raw };

  const parts = raw.split('#');
  if (parts.length > 2) {
    return { kind: 'invalid', reason: `"${raw}" contains more than one "#" anchor separator` };
  }
  const path = parts[0].trim();
  const anchor = parts.length === 2 ? parts[1].trim() : null;

  if (path === '') return { kind: 'invalid', reason: `"${raw}" has an anchor but no file path` };
  if (/\s/.test(path)) {
    return {
      kind: 'invalid',
      reason: `"${raw}" is neither a "relay …" command nor a whitespace-free file path`,
    };
  }
  if (!DECLARABLE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))) {
    return { kind: 'invalid', reason: `"${path}" has no recognised source-file extension` };
  }
  if (parts.length === 2 && anchor === '') {
    return { kind: 'invalid', reason: `"${raw}" has an empty anchor` };
  }
  return { kind: 'file', path, anchor };
}

/** `path/to/file.ts#symbol` → `path/to/file.ts`. */
export const declaredPathOf = (declared) => String(declared).split('#')[0].trim();

/** Kept for callers that only need the discriminator. */
export const isFileClaim = (declared) => classifyDeclaration(declared).kind === 'file';

/**
 * Resolves a declared path INSIDE the repository, refusing absolute paths,
 * `..` traversal, NUL bytes, and symlinks that escape the tree. A registry is
 * a checked-in text file; a declaration that reaches outside the repository
 * is not evidence about this product.
 */
export function resolveInsideRepo(repoRoot, path) {
  if (path.includes('\0')) return { ok: false, reason: 'path contains a NUL byte' };
  if (isAbsolute(path)) return { ok: false, reason: `"${path}" is an absolute path` };
  if (path.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: `"${path}" escapes the repository with ".."` };
  }
  let root = resolve(repoRoot);
  try { root = realpathSync(root); } catch { /* a non-existent root is caught below */ }
  const full = resolve(root, path);
  const inside = (candidate) => candidate === root || candidate.startsWith(root + sep);
  if (!inside(full)) return { ok: false, reason: `"${path}" resolves outside the repository` };
  if (existsSync(full)) {
    let real = full;
    try { real = realpathSync(full); } catch { /* fall through with `full` */ }
    if (!inside(real)) return { ok: false, reason: `"${path}" is a symlink that escapes the repository` };
  }
  return { ok: true, full };
}

/**
 * Splits an anchor into the segments that must actually appear in the file.
 * `DRAFT_FIELDS(architect,codingAgent,reviewer)` → the symbol AND each named
 * field; `pause -> pause-run` → both sides of the mapping. Every segment is
 * checked, so an anchor cannot smuggle an unverified half.
 */
export function anchorSegments(anchor) {
  const segments = [];
  for (const half of String(anchor).split('->')) {
    const part = half.trim();
    if (part === '') continue;
    const call = /^([^(]*)\((.*)\)$/.exec(part);
    if (call) {
      if (call[1].trim() !== '') segments.push(call[1].trim());
      for (const argument of call[2].split(',')) {
        if (argument.trim() !== '') segments.push(argument.trim());
      }
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/** Every anchor segment must be well-formed AND present in the file. */
export function verifyAnchor(content, anchor) {
  const segments = anchorSegments(anchor);
  if (segments.length === 0) {
    return { ok: false, reason: `anchor "${anchor}" names no symbol or text` };
  }
  for (const segment of segments) {
    if (!ANCHOR_SEGMENT.test(segment)) {
      return { ok: false, reason: `anchor segment "${segment}" is not a valid symbol or literal` };
    }
    if (!content.includes(segment)) {
      return { ok: false, reason: `anchor "${segment}" does not appear in the file` };
    }
  }
  return { ok: true, segments };
}

/**
 * Every field in which the registry declares evidence, and whether a `relay …`
 * COMMAND notation is legitimate there.
 *
 * A command is verified by the CLI's own command tests, NOT by this check, so
 * a field that admits commands admits a declaration nothing here inspects on
 * disk. That is only defensible where the evidence genuinely is a command: the
 * CLI's entry points and its test references. Everywhere else — the website's
 * own surface, the shared domain modules both surfaces import, and the
 * evidence a founder exception cites — the declaration is a FILE claim, and a
 * command notation there is a way to declare something no check will look for.
 */
export const DECLARATION_FIELDS = Object.freeze([
  Object.freeze({ field: 'websiteEntryPoints', kind: 'website-entry', commandsAllowed: false }),
  Object.freeze({ field: 'cliEntryPoints', kind: 'cli-entry', commandsAllowed: true }),
  Object.freeze({ field: 'websiteTestReferences', kind: 'website-test', commandsAllowed: false }),
  Object.freeze({ field: 'cliTestReferences', kind: 'cli-test', commandsAllowed: true }),
  Object.freeze({ field: 'sharedDomainReferences', kind: 'shared-domain', commandsAllowed: false }),
]);

/** Exception evidence is held to the file-claim rules, in its own field. */
export const EXCEPTION_EVIDENCE_FIELD = Object.freeze({
  field: 'exception.evidence', kind: 'exception-evidence', commandsAllowed: false,
});

/**
 * Both surfaces live in this repository, so every declaration the registry
 * makes must resolve here: the file must exist, inside the repository, and
 * any anchor must name something the file genuinely contains. Exception
 * evidence is validated on exactly the same terms as any other declaration —
 * a waiver may not cite proof that does not exist.
 *
 * THE UNVERIFIED FIELD THIS CLOSES. The field list was written from the two
 * surfaces' entry points and tests, and `sharedDomainReferences` — a REQUIRED
 * field, and the one that names the modules BOTH surfaces import — was never
 * in it. Seventy declarations were carried in the registry, printed nowhere in
 * the totals, and checked by nothing; seven of them did not resolve at all.
 * A field that is declared but never verified reads exactly like evidence and
 * is not evidence.
 *
 * `checked` counts file claims that were inspected, `present` counts those
 * that fully resolved, and `commands` counts `relay …` notations in the two
 * fields where a command is legitimate.
 */
export function verifyDeclaredFiles(repoRoot, registry) {
  const failures = [];
  let checked = 0;
  let present = 0;
  let commands = 0;

  for (const capability of registry.capabilities ?? []) {
    const id = capability.capabilityId ?? '(unnamed)';
    const declarations = [];
    for (const spec of DECLARATION_FIELDS) {
      for (const declared of capability[spec.field] ?? []) declarations.push([spec, declared]);
    }
    for (const declared of capability.exception?.evidence ?? []) {
      declarations.push([EXCEPTION_EVIDENCE_FIELD, declared]);
    }

    for (const [{ field, kind, commandsAllowed }, declared] of declarations) {
      const classified = classifyDeclaration(declared);

      if (classified.kind === 'invalid') {
        failures.push({
          capabilityId: id,
          rule: 'unparseable-declaration',
          detail: `${field}: ${classified.reason}`,
        });
        continue;
      }
      if (classified.kind === 'command') {
        if (!commandsAllowed) {
          failures.push({
            capabilityId: id,
            rule: 'command-notation-not-permitted',
            detail: `${field} names the command ${JSON.stringify(declared)}, but ${field} declares FILES — `
              + 'a command notation here is never resolved on disk by anything',
          });
          continue;
        }
        commands += 1;
        continue; // verified by the CLI's own command tests, not the filesystem
      }
      if (classified.kind !== 'file') {
        // No silent third branch: an unrecognised classification is a finding.
        failures.push({
          capabilityId: id,
          rule: 'unclassified-declaration',
          detail: `${field}: ${JSON.stringify(declared)} classified as "${classified.kind}", which this check cannot verify`,
        });
        continue;
      }

      checked += 1;
      const resolved = resolveInsideRepo(repoRoot, classified.path);
      if (!resolved.ok) {
        failures.push({ capabilityId: id, rule: 'unsafe-declared-path', detail: `${field}: ${resolved.reason}` });
        continue;
      }
      if (!existsSync(resolved.full) || !statSync(resolved.full).isFile()) {
        failures.push({
          capabilityId: id,
          rule: `missing-${kind}-file`,
          detail: `${field} names ${declared}, but ${classified.path} is not a file in this repository`,
        });
        continue;
      }
      if (classified.anchor === null) {
        present += 1;
        continue;
      }

      let content;
      try {
        content = readFileSync(resolved.full, 'utf8');
      } catch (err) {
        failures.push({
          capabilityId: id,
          rule: 'unreadable-declared-file',
          detail: `${field}: ${classified.path} could not be read (${err.message})`,
        });
        continue;
      }
      const anchored = verifyAnchor(content, classified.anchor);
      if (!anchored.ok) {
        failures.push({
          capabilityId: id,
          rule: 'missing-declared-anchor',
          detail: `${field} names ${declared}, but ${anchored.reason}`,
        });
        continue;
      }
      present += 1;
    }
  }
  return { ok: failures.length === 0, failures, checked, present, commands };
}

/* ------------------- website reachability (the mount) -------------------- *
 *
 * THE UNVERIFIED CLAIM THIS CLOSES.
 *
 * Everything above proves a declared website file EXISTS. It cannot tell the
 * difference between a screen an operator can navigate to and a component that
 * only its own unit test ever renders. `mcp-connection-management` was
 * declared `tested` on both surfaces, with a real component and a real test,
 * for an entire milestone in which NO browser entry rendered it. The registry
 * read as parity; the product had a terminal surface and no website surface.
 *
 * So the entry point of an implemented website capability must be REACHABLE
 * from a real browser entry — an import path that a bundler would follow from
 * `src/relay/main.tsx`. That is what "the website has this capability" means.
 *
 * A surface that genuinely is not mounted is not silently tolerated: it must be
 * RECORDED below, with a reason, and the record is checked in both directions.
 * A recorded path that has since become reachable FAILS, so mounting something
 * forces the record to be corrected rather than left to rot into a permanent
 * excuse.
 * ----------------------------------------------------------------------- */

/** Entries a browser genuinely loads. Kept identical to the browser boundary
 *  guard's list (`src/relay/shared/browser-boundary.test.ts`). */
export const BROWSER_ENTRY_POINTS = Object.freeze(['src/relay/main.tsx']);

/** Extensions a TypeScript/React import may resolve to, longest-lived first. */
const MODULE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** Assets contribute no module edge; a bundler loads them, nothing imports on. */
const ASSET_EXTENSIONS = /\.(css|json|svg|png|jpe?g|gif|webp|woff2?|ttf)$/i;

/**
 * WEBSITE SURFACES THAT ARE DECLARED BUT NOT MOUNTED.
 *
 * Each entry is a component that exists, is tested, and that no browser entry
 * renders. Recording one is a disclosure, not an approval — the reason must say
 * what an operator therefore cannot reach today.
 */
export const UNMOUNTED_WEBSITE_SURFACES = Object.freeze({
  'src/relay/ui/project-workspace/RelayMissionEconomics.tsx':
    'the mission economics panel is rendered only by its own tests and by '
    + 'src/relay/cli/simulated-data-disclosure.test.ts; no browser route mounts it, so a '
    + 'website operator cannot today reach mission cost receipts, budget status or the '
    + 'verified mission cost. Pre-existing and untouched by the MCP milestone.',
});

/**
 * Reduce a source file to the text a MODULE-EDGE MATCHER may safely read.
 *
 * Not "remove comments while leaving literals intact" — that is what this said
 * for three review rounds and it is not what it does. Precisely:
 *
 *   comments            REMOVED
 *   template text       BLANKED (newlines kept), `${…}` treated as code
 *   ordinary strings    BLANKED, except in SPECIFIER position, where the text
 *                       is the answer and is preserved verbatim
 *   regex literals      preserved whole, so a quote or backtick inside one
 *                       cannot open a phantom string
 *
 * WHY BLANKING, NOT PRESERVING. A specifier is itself quoted text, so the
 * matcher cannot tell `from './x'` from a string that merely CONTAINS
 * `from './x'`. Prose like `' import { X } from "./phantom" '` produced an edge
 * no bundler creates — a silent false pass, in the checker built to prevent
 * one. Blanking everything except the specifier position removes the ambiguity
 * instead of arguing with it.
 *
 * THE THREE DEFECTS THIS SHAPE EXISTS TO CLOSE, each found by an independent
 * review after the previous fix:
 *
 * 1. Opening a string on ANY quote. A bare apostrophe in JSX text —
 *    `Relay's own inspection` — is not a delimiter, and it opened a "string"
 *    that never closed, so every later comment in that file survived.
 * 2. Guessing regex position from `<` and from a line break. That made every
 *    JSX closing tag `</Tag>` and every line beginning with `/` look like the
 *    start of a regex; the bogus regex ran to the first slash of a later `//`
 *    and put the comment body back in code position.
 * 3. Copying `${…}` verbatim, so a comment inside an interpolation was never
 *    stripped.
 *
 * The rules that replace the guessing, each derived from what the language
 * actually permits rather than from a pattern that happened to work:
 *
 * - A `'`/`"` string cannot span an UNESCAPED newline, so both close at every
 *   line break that is not preceded by a continuation.
 * - `abc'def'` is not valid JavaScript, so a quote directly after an identifier
 *   character, `)`, `]` or `}` cannot be an opener — UNLESS the preceding token
 *   is one of the keywords a literal legitimately follows (`from`, `import`,
 *   `as`, `case`, `return`, …). Leaving `from` out of that list truncated
 *   `import x from 'https://esm.sh/react'` at the `//` and swallowed the next
 *   line's real import.
 * - Whether `/` starts a regex or is division is the classic ambiguity, decided
 *   by what precedes it. That is a heuristic, and it is stated as one.
 *
 * RESIDUALS, STATED RATHER THAN IMPLIED, AND NOT CLAIMED EXHAUSTIVE. An
 * earlier version of this paragraph asserted that every residual fails in the
 * loud direction; a reviewer then found one that does not, which is why the
 * claim is now about the ones listed rather than about all of them.
 *
 * - A regex in a position the heuristic does not recognise — after `)` or `}`
 *   — is not consumed, so a backtick inside it can still open a template.
 * - An ODD backtick in JSX prose (`Press \`Enter`) opens one too: a backtick
 *   after an identifier is how a TAGGED template is written, and the two are
 *   indistinguishable without JSX context. This repository contains none.
 * - An unopened string or JSX text containing `/*` opens a block comment that
 *   runs to the next `*` + `/`.
 * - `clausePattern` matches `[^;]*?` across newlines, so an `export type`
 *   alias NOT terminated by `;` can swallow the next import and be classified
 *   type-only. Every alias in this tree ends `;`. Pre-existing.
 * - A fully static TEMPLATE specifier — `import(\`./x\`)` — is not followed,
 *   while `src/relay/shared/browser-boundary.test.ts` deliberately does follow that
 *   form. The two scanners disagree; this one is the conservative side.
 *
 * All five drop an edge, which is a visible parity failure. That is a fact
 * about these five, not a guarantee about a sixth.
 *
 * `src/relay/parity/surface-parity.test.ts` asserts the properties over the
 * REAL graph in three directions: a comment on its own line, a comment appended
 * to an existing line, and a real import that must still be found.
 */
/**
 * Characters after which a `/` begins a REGEX rather than a division.
 *
 * `<`, `>` and `\n` are DELIBERATELY ABSENT. Including them was a defect with a
 * wide blast radius in a React codebase: `<` made every JSX closing tag look
 * like the start of a regex, and treating a line break as significant made
 * every line beginning with `/` one too — 1400 phantom positions across 61 of
 * the 270 reachable modules, `src/relay/main.tsx` among them.
 *
 * `)` and `}` are absent for the opposite reason: `if (x) /re/.test(y)` is a
 * regex and `(a + b) / c` is division, and nothing short of a parser separates
 * them. A regex in that position is therefore not consumed — see RESIDUALS.
 */
const REGEX_POSITION_BEFORE = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^',
]);

/** Keywords after which a `/` is a regex rather than a division. */
const REGEX_POSITION_KEYWORDS =
  /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/u;

/**
 * Keywords a STRING may legally follow even though they end in an identifier
 * character. `from` is the one that mattered: without it,
 * `import x from 'https://esm.sh/react'` never opened a string, the `//` inside
 * the URL became a line comment, and the next line's real import went with it.
 */
const LITERAL_POSITION_KEYWORDS =
  /(?:^|[^\w$])(?:from|import|export|as|default|case|return|typeof|instanceof|in|of|new|delete|void|do|else|yield|await)\s*$/u;

/**
 * A string in SPECIFIER position is the answer, so its text is kept verbatim.
 * Every other string is blanked — see the doc block.
 *
 * `.` and `?` are excluded from the preceding class deliberately.
 * `Array.from(…)`, `Buffer.from(…)` and `obj?.import(…)` are member calls, not
 * import clauses, and treating them as specifier position preserved their
 * argument verbatim — so `Array.from(' import { X } from "./phantom" ')`
 * produced an edge no bundler creates. A silent false pass, in the rule added
 * to close silent false passes.
 */
const SPECIFIER_POSITION = /(?:^|[^\w$.?])(?:from|import|require)\s*\(?\s*$/u;

export function stripComments(source) {
  let out = '';
  let index = 0;
  /** An open `'` or `"` string. Backticks have their own context stack. */
  let quote = null;
  /** True while inside a SPECIFIER string, whose text must survive verbatim. */
  let keepQuoted = false;
  /** The last significant character emitted in CODE position. */
  let previous = '';
  /**
   * Template-literal contexts, innermost last.
   *
   * `interpolation === null` — we are in template TEXT, which is blanked.
   * `interpolation >= 0`     — we are inside `${…}`, which is ordinary code and
   *                            goes through every rule below, brace-counted so
   *                            the expression ends where it really ends.
   *
   * A stack rather than a flag because a template may nest inside an
   * interpolation inside a template.
   */
  const templates = [];
  const top = () => (templates.length === 0 ? null : templates[templates.length - 1]);
  const inTemplateText = () => top() !== null && top().interpolation === null;

  /**
   * At least the last 48 emitted characters (48–96, since it is trimmed in
   * batches). Its own small string because
   * `out.slice(-24)` re-flattened the entire accumulated rope on every call —
   * quadratic, and this scanner now asks the question once per quote as well as
   * once per slash.
   */
  let recent = '';
  const emit = (text) => {
    out += text;
    recent += text;
    // Trimmed in batches rather than on every character: slicing per character
    // allocated two strings per byte, which cost roughly a second over the
    // whole tree. Batching recovers that AND keeps the ~30 s the bounded buffer
    // saves on a pathological line — an earlier version of this comment said
    // the per-character cost outweighed that saving, which was wrong by more
    // than an order of magnitude.
    if (recent.length > 96) recent = recent.slice(-48);
  };
  const startsRegex = () => {
    if (previous === '') return true;
    if (REGEX_POSITION_BEFORE.has(previous)) return true;
    return REGEX_POSITION_KEYWORDS.test(recent.slice(-48));
  };
  const canOpenString = () => startsRegex() || LITERAL_POSITION_KEYWORDS.test(recent.slice(-48));
  const inSpecifierPosition = () => SPECIFIER_POSITION.test(recent.slice(-48));

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    // TEMPLATE TEXT — blanked. See the doc block: text that reads like an
    // import is not an edge, and the specifier matcher cannot tell.
    if (inTemplateText()) {
      if (char === '\\') {
        // Keep line structure even across an escaped line break, or the output
        // loses a line and every later position shifts.
        if (next === '\n') emit('\n');
        index += 2;
        continue;
      }
      if (char === '`') { templates.pop(); previous = '`'; index += 1; continue; }
      if (char === '$' && next === '{') {
        emit('${');
        top().interpolation = 0;
        previous = '{';
        index += 2;
        continue;
      }
      if (char === '\n') emit('\n');   // keep line structure
      index += 1;
      continue;
    }

    if (quote !== null) {
      // Blanked unless this literal IS the specifier. Delimiters and newlines
      // always survive, so the matcher still sees `from ''` and line numbers
      // do not shift.
      if (keepQuoted || char === quote || char === '\n') emit(char);
      if (char === '\\') {
        if (keepQuoted) emit(next ?? '');
        // A line continuation inside a blanked string still ends a line, and
        // dropping it shifts every later position. Same rule as template text.
        else if (next === '\n') emit('\n');
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
        // A closed literal is a VALUE, so a `/` after it is division.
        previous = char;
      } else if (char === '\n') {
        // A `'` or `"` string cannot cross a newline. Anything still open at a
        // line break was never a delimiter — an apostrophe in prose, or a quote
        // inside a regex — so the scanner resynchronises rather than swallowing
        // the rest of the file.
        quote = null;
        previous = char;
      }
      index += 1;
      continue;
    }

    // A QUOTE ONLY OPENS A STRING WHERE A STRING COULD LEGALLY START.
    //
    // `Relay's own inspection` in JSX text is not a string — and JavaScript
    // agrees: `abc'def'` is not valid, so a quote directly after an identifier
    // character, `)`, `]` or `}` cannot be an opener. That one rule removes the
    // apostrophe-in-prose class entirely, rather than bounding it to a line.
    //
    // `<` and `>` are excluded for the same reason they are excluded from
    // regex position: after `>` comes JSX TEXT far more often than a comparison
    // against a string literal in this codebase. The cost of being wrong is
    // small in this direction — an unrecognised string has its contents passed
    // through the ordinary rules, and a specifier's own quotes are still
    // emitted, so `from '…'` still matches.
    if (char === "'" || char === '"') {
      if (canOpenString()) {
        quote = char;
        keepQuoted = inSpecifierPosition();
        emit(char);
        index += 1;
        continue;
      }
      // Prose. Emit it and move on; it delimits nothing.
      emit(char);
      previous = char;
      index += 1;
      continue;
    }

    if (char === '`') {
      templates.push({ interpolation: null });
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue; // the newline itself is copied on the next turn
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') emit('\n');
        index += 1;
      }
      index += 2;
      continue;
    }

    // A REGEX LITERAL, consumed whole — so a quote or a backtick inside it can
    // never be mistaken for the start of a string.
    if (char === '/' && startsRegex()) {
      let cursor = index + 1;
      let inClass = false;
      let closed = false;
      while (cursor < source.length) {
        const c = source[cursor];
        // An escape cannot span a line break: `\` at end-of-line means this was
        // never a regex, and skipping the newline would run the scan past the
        // line it is supposed to be bounded to.
        if (c === '\\') {
          if (source[cursor + 1] === '\n' || cursor + 1 >= source.length) break;
          cursor += 2;
          continue;
        }
        if (c === '\n') break;            // unterminated — it was not a regex
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; cursor += 1; break; }
        cursor += 1;
      }
      // A candidate whose closing slash is immediately followed by `/` or `*`
      // did not close a regex — it ran INTO a comment and stopped on its first
      // slash. Consuming it would put the comment body back in code position.
      if (closed && source[cursor] !== '/' && source[cursor] !== '*') {
        while (cursor < source.length && /[a-z]/u.test(source[cursor])) cursor += 1;
        emit(source.slice(index, cursor));
        previous = '/';
        index = cursor;
        continue;
      }
      // Not a regex after all. Fall through and treat it as an ordinary char.
    }

    // Brace counting, so `${…}` ends where the expression ends rather than at
    // the first `}` inside an object literal or a nested block.
    const context = top();
    if (context !== null && context.interpolation !== null) {
      if (char === '{') context.interpolation += 1;
      else if (char === '}') {
        if (context.interpolation === 0) {
          emit('}');
          context.interpolation = null;   // back to template TEXT
          previous = '}';
          index += 1;
          continue;
        }
        context.interpolation -= 1;
      }
    }

    emit(char);
    // Whitespace, INCLUDING a newline, does not change what preceded the next
    // `/`. Treating a line break as significant is what made every line
    // starting with `/` look like a regex.
    if (!/\s/u.test(char)) previous = char;
    index += 1;
  }
  return out;
}

/**
 * True when an import/export clause contributes NO runtime module edge because
 * every binding it names is type-only. TypeScript erases these entirely, so a
 * surface reachable only through one is not reachable in the shipped bundle.
 *
 *   `import type { Props } from './X'`       — erased
 *   `import { type A, type B } from './X'`   — erased
 *   `import { type A, B } from './X'`        — NOT erased, B is a value
 *   `import './X'`                           — NOT erased, side-effect import
 */
function clauseIsTypeOnly(clause) {
  const text = clause.trim();
  if (/^(?:import|export)\s+type\b/u.test(text)) return true;
  const braces = /\{([^}]*)\}/u.exec(text);
  if (braces === null) return false;                       // default or namespace binding
  const beforeBraces = text.slice(0, braces.index);
  if (/[A-Za-z0-9_$]\s*,\s*$/u.test(beforeBraces.replace(/^(?:import|export)\s+/u, ''))) {
    return false;                                          // `import Default, { … }`
  }
  if (/\*\s*as\s/u.test(beforeBraces)) return false;        // namespace binding
  const named = braces[1].split(',').map((part) => part.trim()).filter((part) => part !== '');
  /*
   * `import {} from './X'` — NO EDGE, and the reasoning is bundler-specific
   * rather than specification-shaped.
   *
   * A previous version of this line said the module is still evaluated
   * "because Vite/esbuild preserves it as a side-effect import". A reviewer
   * ran the repository's own esbuild: `transform` emits no import at all, and
   * a real `bundle: true` build drops the module entirely. So reporting an
   * edge here would claim a reachability the shipped bundle does not have —
   * a silent false pass, which is the one direction this checker must never
   * fail in. The specification does evaluate it; this bundler does not, and
   * the bundler is what ships.
   */
  if (named.length === 0) return true;
  return named.every((part) => /^type\s/u.test(part));
}

/**
 * Every module specifier a source file imports, in the forms this repo uses.
 *
 * TWO KNOWN OVER-APPROXIMATIONS, stated rather than hidden. Both are in the
 * phantom direction — they can report a surface reachable that a bundler would
 * not include — and neither changes this tree's answer today.
 *
 * 1. A barrel's `export … from './X'` is followed even when nothing consumes
 *    the re-exported binding. The edge is real in the module graph (the module
 *    is evaluated), but a tree-shaking bundler may drop it. Closing this needs
 *    binding-level liveness analysis this script does not do.
 * 2. A TypeScript IMPORT-TYPE node in type position — `import('./x').T`,
 *    `keyof typeof import('./x')` — is erased by `tsc` and counted here. Seven
 *    instances across five files. A reachability walk driven by the TypeScript
 *    parser returns the SAME 270 modules, so every target is reachable by a
 *    real edge as well; the count is unchanged either way.
 *
 * Comments and type-only IMPORT CLAUSES, which are not edges under any
 * bundler, are excluded.
 */
export function importSpecifiersOf(source) {
  const code = stripComments(source);
  const specifiers = [];
  const clausePattern = /(?:^|[\s;}])((?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"])/gu;
  for (const match of code.matchAll(clausePattern)) {
    if (clauseIsTypeOnly(match[1])) continue;
    specifiers.push(match[2]);
  }
  const patterns = [
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Resolve one specifier to a repo-relative module path, or `null` when it is a
 * package, an asset, or something outside the tree. Deliberately conservative:
 * an edge this step cannot resolve is an edge NOT followed, which can only make
 * a surface look LESS reachable — a false failure that is loud, never a false
 * pass that is silent.
 *
 * That guarantee covers RESOLUTION only. Whether a candidate edge should have
 * been offered at all is `importSpecifiersOf`'s question, and its doc block
 * names the two over-approximations that survive there.
 */
export function resolveModuleSpecifier(repoRoot, fromRelative, specifier) {
  let candidate;
  if (specifier.startsWith('.')) {
    candidate = join(dirname(fromRelative), specifier);
  } else if (specifier.startsWith('/src/') || specifier.startsWith('/relay-bridge/')) {
    candidate = specifier.slice(1); // root-absolute, as the bundler resolves it
  } else {
    return null; // a package, a `node:` builtin, or an alias this check does not follow
  }
  candidate = candidate.split(/[\\/]/).filter((part) => part !== '' && part !== '.').join('/');
  if (ASSET_EXTENSIONS.test(candidate)) return null;

  const exists = (relativePath) => {
    const resolved = resolveInsideRepo(repoRoot, relativePath);
    return resolved.ok && existsSync(resolved.full) && statSync(resolved.full).isFile()
      ? relativePath
      : null;
  };

  if (/\.[a-z]+$/iu.test(candidate)) {
    const direct = exists(candidate);
    if (direct !== null) return direct;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const withExtension = exists(`${candidate}${extension}`);
    if (withExtension !== null) return withExtension;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const asIndex = exists(`${candidate}/index${extension}`);
    if (asIndex !== null) return asIndex;
  }
  return null;
}

/** Every module a browser entry can reach, as repo-relative paths. */
export function reachableFromBrowserEntries(repoRoot, entries = BROWSER_ENTRY_POINTS) {
  const seen = new Set();
  const pending = [];
  for (const entry of entries) {
    const resolved = resolveInsideRepo(repoRoot, entry);
    if (resolved.ok && existsSync(resolved.full)) {
      seen.add(entry);
      pending.push(entry);
    }
  }
  while (pending.length > 0) {
    const current = pending.pop();
    const resolved = resolveInsideRepo(repoRoot, current);
    if (!resolved.ok) continue;
    let source;
    try { source = readFileSync(resolved.full, 'utf8'); } catch { continue; }
    for (const specifier of importSpecifiersOf(source)) {
      const next = resolveModuleSpecifier(repoRoot, current, specifier);
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  return seen;
}

/** A website capability counts here once it claims to be on the website. */
const claimsWebsite = (capability) =>
  capability.websiteStatus === 'implemented' || capability.websiteStatus === 'tested';

/**
 * Hold every implemented website entry point to actual reachability from a
 * browser entry, and hold the unmounted record to being accurate in BOTH
 * directions.
 */
export function verifyWebsiteReachability(repoRoot, registry, record = UNMOUNTED_WEBSITE_SURFACES) {
  const failures = [];
  const reachable = reachableFromBrowserEntries(repoRoot);
  const declared = new Set();
  const unmountedSeen = new Set();
  const isRecorded = (path) => Object.prototype.hasOwnProperty.call(record, path);
  let checked = 0;
  let mounted = 0;

  for (const capability of registry.capabilities ?? []) {
    if (!claimsWebsite(capability)) continue;
    const id = capability.capabilityId ?? '(unnamed)';
    for (const entry of capability.websiteEntryPoints ?? []) {
      const path = declaredPathOf(entry);
      if (classifyDeclaration(entry).kind !== 'file') continue;
      declared.add(path);
      checked += 1;
      if (reachable.has(path)) {
        mounted += 1;
        if (isRecorded(path)) {
          failures.push({
            capabilityId: id,
            rule: 'stale-unmounted-record',
            detail: `${path} is recorded as an unmounted website surface, but a browser entry now reaches it — `
              + 'remove the record rather than leaving a disclosure that has stopped being true',
          });
        }
        continue;
      }
      if (isRecorded(path)) {
        unmountedSeen.add(path);
        continue;
      }
      failures.push({
        capabilityId: id,
        rule: 'website-entry-unreachable',
        detail: `websiteEntryPoints names ${path}, which is ${capability.websiteStatus} but is NOT reachable from `
          + `${BROWSER_ENTRY_POINTS.join(', ')} — the file exists and nothing in the running website renders it. `
          + 'Mount it, or record it in UNMOUNTED_WEBSITE_SURFACES with the reason an operator cannot reach it',
      });
    }
  }

  for (const path of Object.keys(record)) {
    if (!declared.has(path)) {
      failures.push({
        capabilityId: '(registry)',
        rule: 'unused-unmounted-record',
        detail: `${path} is recorded as an unmounted website surface, but no capability declares it — `
          + 'a record for nothing describes nothing',
      });
    }
  }

  return { ok: failures.length === 0, failures, checked, mounted, unmounted: [...unmountedSeen].sort() };
}

/* --------------------------------- run ---------------------------------- */

export function runParityCheck(options) {
  const { repoRoot, strict = false, companionPath, now } = options;
  const lines = [];
  const say = (line) => lines.push(line);

  say('RELAY SURFACE PARITY CHECK');
  say(`  mode: ${strict ? 'STRICT (CI)' : 'local'}`);

  const loaded = loadRegistry(repoRoot);
  if (!loaded.ok) {
    say(`  FAIL  ${loaded.error}`);
    return { ok: false, lines, failures: [{ capabilityId: '(registry)', rule: 'registry-missing', detail: loaded.error }] };
  }
  const local = loaded.value;
  say(`  registry: ${REGISTRY_RELATIVE_PATH} (manifest ${local.registry.manifestVersion})`);
  say(`  capabilities: ${local.registry.capabilities.length}`);

  const validation = validateRegistry(local.registry, { now });
  const failures = [...validation.failures];

  // Both surfaces are in THIS repository: every file the registry declares
  // must exist here. This is the real parity evidence, and it never depends
  // on another checkout.
  //
  // TRUTHFUL ARITHMETIC. The ratio below used to be `checked - failures.length`
  // over `checked`. Failures that never incremented `checked` — an unparseable
  // declaration, a command in a file-claim field — were still subtracted from
  // it, so the numerator and the denominator came from different populations
  // and presence could be understated to zero or below. `present` is counted
  // where a declaration actually resolves, so the two numbers describe the same
  // set, and declaration failures are reported on their own line.
  const declared = verifyDeclaredFiles(repoRoot, local.registry);
  failures.push(...declared.failures);
  say(`  declared surface files: ${declared.present}/${declared.checked} present`);
  say(`  declared CLI commands: ${declared.commands} (verified by the CLI's own command tests)`);
  if (declared.failures.length > 0) {
    say(`  declaration failures: ${declared.failures.length}`);
  }

  // EXISTENCE IS NOT REACHABILITY. A declared component that no browser entry
  // renders is a capability the website does not have, however complete and
  // however well tested the component is.
  const reachability = verifyWebsiteReachability(repoRoot, local.registry);
  failures.push(...reachability.failures);
  say(`  website entry points reachable: ${reachability.mounted}/${reachability.checked} mounted`);
  for (const path of reachability.unmounted) {
    say(`  NOT MOUNTED  ${path} — ${UNMOUNTED_WEBSITE_SURFACES[path]}`);
  }

  // A registry that declares no file evidence at all would otherwise report a
  // cheerful "0/0 present". In CI that is a failure, not a pass.
  if (declared.checked === 0) {
    const detail = 'the registry declares no verifiable file evidence — nothing was compared';
    if (strict) failures.push({ capabilityId: '(registry)', rule: 'no-file-evidence', detail });
    else say(`  WARN  ${detail}`);
  }

  if (companionPath !== undefined) {
    const companion = findCompanion(repoRoot, companionPath);
    if (companion === null) {
      say(`  FAIL  companion registry not found at ${companionPath}`);
      failures.push({
        capabilityId: '(companion)', rule: 'companion-unreadable',
        detail: `no registry at the explicitly requested companion path ${companionPath}`,
      });
    } else {
      const companionLoaded = loadRegistry(companion);
      if (!companionLoaded.ok) {
        say(`  FAIL  companion registry unreadable: ${companionLoaded.error}`);
        failures.push({ capabilityId: '(companion)', rule: 'companion-unreadable', detail: companionLoaded.error });
      } else {
        say(`  companion (explicit): ${companion}`);
        failures.push(...compareRegistries(local, companionLoaded.value).failures);
      }
    }
  } else {
    say('  companion: not requested — both surfaces are verified in this repository');
  }

  for (const failure of failures) {
    say(`  FAIL  ${failure.capabilityId} · ${failure.rule} — ${failure.detail}`);
  }
  say(failures.length === 0 ? '  PASS  website/CLI parity holds.' : `  ${failures.length} parity failure(s).`);

  return { ok: failures.length === 0, lines, failures };
}

/* --------------------------------- CLI ---------------------------------- */

const invokedDirectly = process.argv[1]
  && import.meta.url === `file://${resolve(process.argv[1])}`;

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const companionIndex = argv.indexOf('--companion');
  const result = runParityCheck({
    repoRoot: process.cwd(),
    strict: argv.includes('--strict'),
    companionPath: companionIndex >= 0 ? argv[companionIndex + 1] : undefined,
    now: new Date().toISOString(),
  });
  result.lines.forEach((line) => process.stdout.write(`${line}\n`));
  process.exit(result.ok ? 0 : 1);
}
