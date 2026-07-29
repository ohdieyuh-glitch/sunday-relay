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
 *   local (default)  validate this repository's registry and confirm every
 *                    declared entry point and test reference exists on disk.
 *   --strict         CI mode: the same rules, and a declared file that does
 *                    not exist is a FAILURE rather than a warning.
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

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const REGISTRY_RELATIVE_PATH = join('src', 'relay', 'parity', 'relay-surface-capabilities.json');

export const PARITY_CLASSES = ['functional_required', 'semantic_visual_required', 'surface_specific'];
export const SURFACE_STATUSES = ['not_started', 'planned', 'implemented', 'tested'];
export const DOMAINS = [
  'project', 'mission', 'command', 'agent', 'psp', 'workspace', 'review',
  'evidence', 'economics', 'trace', 'identity', 'relay_dog', 'settings',
];

/** A surface counts as PRESENT once it is implemented or tested. */
const isPresent = (status) => status === 'implemented' || status === 'tested';

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
    if (capability.parityClass === 'surface_specific') {
      if (!exception) {
        fail(id, 'unapproved-exception',
          'surface_specific requires an exception with a reason and founder approval');
      }
    }
    if (exception) {
      if (typeof exception.reason !== 'string' || exception.reason.trim() === '') {
        fail(id, 'exception-reason', 'exception requires a reason');
      }
      if (typeof exception.approvedBy !== 'string' || exception.approvedBy.trim() === '') {
        fail(id, 'exception-approver', 'exception requires approvedBy (founder identity)');
      }
      if (typeof exception.approvedAt !== 'string' || exception.approvedAt.trim() === '') {
        fail(id, 'exception-approved-at', 'exception requires approvedAt');
      }
      if (typeof exception.expiresAt === 'string' && exception.expiresAt <= now) {
        fail(id, 'expired-exception', `exception expired at ${exception.expiresAt}`);
      }
    }

    /* ------------------------------ parity ------------------------------ */
    const exempt = capability.parityClass === 'surface_specific'
      && exception
      && typeof exception.approvedBy === 'string'
      && exception.approvedBy.trim() !== ''
      && !(typeof exception.expiresAt === 'string' && exception.expiresAt <= now);

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
 * The two repositories cannot import each other, so parity across them is
 * proven by comparing the byte-identical registry: same manifest version, same
 * checksum. A divergence is a failure — never a silent pass.
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
 * The registry declares entry points in several legitimate notations:
 *   `src/relay/cli/product/app.ts`                 a source file
 *   `src/relay/cli/product/app.ts#DRAFT_FIELDS`    a symbol within one
 *   `relay mission budget`                         a CLI command
 *   `relay (interactive) /pause`                   an interactive slash command
 * Only the first two are FILE claims and only those are checked on disk.
 * Commands are verified by the CLI's own command tests, not the filesystem.
 * The discriminator is deliberately strict: a path never contains whitespace
 * and always carries a file extension, while every command form contains a
 * space. Matching on '/' alone would misread `relay (interactive) /pause`.
 */
/** `path/to/file.ts#symbol` → `path/to/file.ts`. */
export const declaredPathOf = (declared) => declared.split('#')[0].trim();

export const isFileClaim = (declared) =>
  !/\s/.test(declared) && /\.[A-Za-z0-9]+$/.test(declaredPathOf(declared));

export function verifyDeclaredFiles(repoRoot, registry) {
  const failures = [];
  let checked = 0;
  const fields = [
    ['websiteEntryPoints', 'missing-website-entry-file'],
    ['cliEntryPoints', 'missing-cli-entry-file'],
    ['websiteTestReferences', 'missing-website-test-file'],
    ['cliTestReferences', 'missing-cli-test-file'],
  ];
  for (const capability of registry.capabilities ?? []) {
    const id = capability.capabilityId ?? '(unnamed)';
    for (const [field, rule] of fields) {
      for (const declared of capability[field] ?? []) {
        if (typeof declared !== 'string' || declared.trim() === '') continue;
        if (!isFileClaim(declared)) continue;          // a CLI command, not a path
        checked += 1;
        const path = declaredPathOf(declared);
        if (!existsSync(resolve(repoRoot, path))) {
          failures.push({ capabilityId: id, rule, detail: `${field} names ${declared}, but ${path} does not exist` });
        }
      }
    }
  }
  return { ok: failures.length === 0, failures, checked };
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
  const declared = verifyDeclaredFiles(repoRoot, local.registry);
  failures.push(...declared.failures);
  say(`  declared surface files: ${declared.checked - declared.failures.length}/${declared.checked} present`);

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
