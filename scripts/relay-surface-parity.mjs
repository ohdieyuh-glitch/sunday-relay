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
import { isAbsolute, join, resolve, sep } from 'node:path';

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
