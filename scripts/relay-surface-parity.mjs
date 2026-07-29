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
 *   local (default)  validate this repository's registry. If the companion
 *                    repository is present, also compare the two registries.
 *   --strict         CI mode: the companion repository is REQUIRED. A missing
 *                    or unreadable companion is a FAILURE, never a silent pass.
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

/** Default companion locations, tried in order. */
export const DEFAULT_COMPANION_PATHS = [
  '../sunday-relay',
  '../sunday-relay-claude-home',
];

export function findCompanion(repoRoot, explicit) {
  const candidates = explicit ? [explicit] : DEFAULT_COMPANION_PATHS.map((p) => resolve(repoRoot, p));
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (path === resolve(repoRoot)) continue;
    if (existsSync(join(path, REGISTRY_RELATIVE_PATH))) return path;
  }
  return null;
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

  const companion = findCompanion(repoRoot, companionPath);
  if (companion) {
    const companionLoaded = loadRegistry(companion);
    if (!companionLoaded.ok) {
      say(`  FAIL  companion registry unreadable: ${companionLoaded.error}`);
      failures.push({ capabilityId: '(companion)', rule: 'companion-unreadable', detail: companionLoaded.error });
    } else {
      say(`  companion: ${companion}`);
      failures.push(...compareRegistries(local, companionLoaded.value).failures);
    }
  } else if (strict) {
    // STRICT MODE NEVER PASSES SILENTLY when the companion is unavailable.
    say('  FAIL  companion repository not found — strict mode requires it');
    failures.push({
      capabilityId: '(companion)',
      rule: 'companion-missing',
      detail: 'strict mode requires the companion repository; parity cannot be proven without it',
    });
  } else {
    say('  companion: NOT FOUND — cross-repository parity NOT verified (local mode)');
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
