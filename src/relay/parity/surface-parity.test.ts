import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  anchorSegments,
  BROWSER_ENTRY_POINTS,
  compareRegistries,
  declaredPathOf,
  DECLARATION_FIELDS,
  DEFAULT_COMPANION_PATHS,
  findCompanion,
  importSpecifiersOf,
  isFileClaim,
  loadRegistry,
  reachableFromBrowserEntries,
  resolveModuleSpecifier,
  runParityCheck,
  UNMOUNTED_WEBSITE_SURFACES,
  validateRegistry,
  verifyAnchor,
  verifyDeclaredFiles,
  verifyWebsiteReachability,
  REGISTRY_RELATIVE_PATH,
} from '../../../scripts/relay-surface-parity.mjs';
import {
  RELAY_PARITY_REGISTRY_PATH,
  surfaceIsPresent,
  type RelaySurfaceCapability,
  type RelaySurfaceCapabilityRegistry,
} from './surface-capability-types';

/**
 * WEBSITE/CLI PARITY CHECK — the check's own suite.
 *
 * It asserts both that the real registry is well-formed AND that the checker
 * genuinely FAILS on every condition it is supposed to catch. A parity check
 * that cannot fail is not a check.
 */

const repoRoot = process.cwd();
const NOW = '2026-07-28T12:00:00.000Z';

const registry: RelaySurfaceCapabilityRegistry = JSON.parse(
  readFileSync(join(repoRoot, RELAY_PARITY_REGISTRY_PATH), 'utf8'),
);

/** A minimal, VALID capability to mutate per failure case. */
function capability(overrides: Partial<RelaySurfaceCapability> = {}): RelaySurfaceCapability {
  return {
    capabilityId: 'sample',
    name: 'Sample',
    domain: 'mission',
    parityClass: 'functional_required',
    websiteStatus: 'tested',
    cliStatus: 'tested',
    websiteEntryPoints: ['web/entry'],
    cliEntryPoints: ['relay sample'],
    websiteTestReferences: ['web.test.ts'],
    cliTestReferences: ['cli.test.ts'],
    sharedDomainReferences: [],
    ...overrides,
  };
}

function check(capabilities: RelaySurfaceCapability[]) {
  return validateRegistry(
    {
      manifestVersion: '1.0.0',
      description: 'test',
      capabilities: [
        ...capabilities,
        // The three milestone-required records, so their absence is not what
        // fails a case that is testing something else.
        capability({ capabilityId: 'relay-dog-identity' }),
        capability({ capabilityId: 'relay-dog-state-semantics' }),
        capability({ capabilityId: 'psp-agent-id-import' }),
      ],
    },
    { now: NOW },
  );
}

const rules = (result: { failures: Array<{ rule: string }> }) => result.failures.map((f) => f.rule);

/* ----------------------------- the registry ----------------------------- */

describe('the capability parity registry', () => {
  it('exists, is versioned, and covers the required capabilities', () => {
    expect(registry.manifestVersion).toBeTruthy();
    expect(registry.capabilities.length).toBeGreaterThanOrEqual(15);
    const ids = registry.capabilities.map((c) => c.capabilityId);
    for (const required of [
      'relay-dog-identity', 'relay-dog-state-semantics', 'psp-agent-id-import',
      'mission-contract-creation', 'mission-start', 'mission-pause', 'mission-resume',
      'mission-cancel', 'agent-assignment', 'agent-reassignment', 'review', 'repair',
      'approval', 'mission-status', 'evidence-inspection',
    ]) {
      expect(ids, `missing capability record: ${required}`).toContain(required);
    }
    expect(new Set(ids).size, 'duplicate capabilityId in the registry').toBe(ids.length);
  });

  it('records the official Relay Dog and PSP Agent ID import as done on BOTH surfaces', () => {
    for (const id of ['relay-dog-identity', 'relay-dog-state-semantics', 'psp-agent-id-import']) {
      const record = registry.capabilities.find((c) => c.capabilityId === id)!;
      expect(record.websiteStatus, `${id} website`).toBe('tested');
      expect(record.cliStatus, `${id} cli`).toBe('tested');
      expect(record.websiteTestReferences.length).toBeGreaterThan(0);
      expect(record.cliTestReferences.length).toBeGreaterThan(0);
    }
  });

  /**
   * WHICH SURFACE IS THIS CHECKOUT? The marker must be the thing that MAKES a
   * surface a surface — its ENTRY POINT — not an incidental directory.
   *
   * The old marker was `existsSync('src/relay/ui/official-relay-dog')`, and it
   * was silently dangerous: the test read "marker absent" as "therefore this
   * is the CLI". A marker that stopped resolving for ANY reason — a rename, a
   * de-duplication, a moved asset — would not fail. It would quietly switch to
   * verifying the OTHER surface's paths and still report green, so a broken
   * marker was indistinguishable from a real CLI-only checkout.
   *
   * Entry points cannot degrade that way: presence is asserted rather than
   * inferred, absence of BOTH is a hard failure, and a checkout that carries
   * both entry points (this one does — website and CLI ship from one tree) has
   * BOTH surfaces' declared evidence verified rather than half of it skipped.
   */
  const SURFACE_ENTRIES = [
    { surface: 'website' as const, entry: join('src', 'relay', 'main.tsx') },
    { surface: 'cli' as const, entry: join('src', 'relay', 'cli', 'main.ts') },
  ];
  const presentSurfaces = SURFACE_ENTRIES
    .filter(({ entry }) => existsSync(join(repoRoot, entry)))
    .map(({ surface }) => surface);

  it('detects the surfaces in this checkout from their entry points, never by inference', () => {
    expect(
      presentSurfaces,
      `no surface entry point resolved (${SURFACE_ENTRIES.map((s) => s.entry).join(', ')}) — ` +
      'the marker is broken, and "not the website" must never be read as "the CLI"',
    ).not.toEqual([]);
  });

  it('every referenced test file on the surfaces PRESENT here exists (no invented evidence)', () => {
    // A repository can only verify the paths it actually carries — a companion
    // checkout's files are not on this disk. So verify exactly the surfaces
    // whose entry points resolved, and refuse to guess about the rest.
    expect(presentSurfaces, 'refusing to guess which surface to verify').not.toEqual([]);
    let verified = 0;
    for (const record of registry.capabilities) {
      const refs = [
        ...(presentSurfaces.includes('website') && record.websiteStatus === 'tested'
          ? record.websiteTestReferences : []),
        ...(presentSurfaces.includes('cli') && record.cliStatus === 'tested'
          ? record.cliTestReferences : []),
      ];
      for (const ref of refs) {
        // Command entry points ("relay project run") are not file paths.
        if (!/\.(ts|tsx)$/.test(ref)) continue;
        expect(existsSync(join(repoRoot, ref)), `${record.capabilityId}: ${ref} does not exist`)
          .toBe(true);
        verified += 1;
      }
    }
    expect(verified, 'no test references were verified on this surface').toBeGreaterThan(0);
  });

  /**
   * The real registry's parity failures are pinned here. This is the honest
   * ledger of where the two surfaces diverge: a NEW divergence fails this
   * test, and closing a listed one fails it too, so the gap list can never rot
   * silently.
   *
   * There are currently NO gaps. The previously open one — the CLI could pause
   * and resume a mission (`/pause`, `/resume` -> Relay Core `pause-run` /
   * `resume-run`) while the website could not — is closed: the website now
   * issues the same canonical `pause` / `resume` intents through the validated
   * Mission Command Protocol from `RelayMissionRunControls`.
   */
  it('has exactly the known, documented parity gaps — no more', () => {
    const result = validateRegistry(registry, { now: NOW });
    const actual = result.failures
      .map((f: { capabilityId: string; rule: string }) => `${f.capabilityId}:${f.rule}`)
      .sort();
    expect(actual).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('mission pause and resume are real on BOTH surfaces, with no exception', () => {
    for (const id of ['mission-pause', 'mission-resume']) {
      const record = registry.capabilities.find((c) => c.capabilityId === id)!;
      expect(record.parityClass, id).toBe('functional_required');
      expect(record.websiteStatus, `${id} website`).toBe('tested');
      expect(record.cliStatus, `${id} cli`).toBe('tested');
      expect(record.websiteEntryPoints.length, `${id} website entry`).toBeGreaterThan(0);
      expect(record.cliEntryPoints.length, `${id} cli entry`).toBeGreaterThan(0);
      expect(record.websiteTestReferences.length, `${id} website tests`).toBeGreaterThan(0);
      expect(record.cliTestReferences.length, `${id} cli tests`).toBeGreaterThan(0);
      // The requirement was to IMPLEMENT the capability, never to exempt it.
      expect(record.exception, `${id} must not be exempted`).toBeUndefined();
      // The CLI evidence recorded before this milestone is preserved verbatim.
      expect(record.cliEntryPoints.some((e) => e.includes('/pause') || e.includes('/resume')))
        .toBe(true);
    }
  });

  it('removing the website pause or resume implementation fails the check', () => {
    for (const id of ['mission-pause', 'mission-resume']) {
      const broken = {
        ...registry,
        capabilities: registry.capabilities.map((c) => (
          c.capabilityId === id
            ? { ...c, websiteStatus: 'not_started', websiteEntryPoints: [], websiteTestReferences: [] }
            : c
        )),
      };
      const result = validateRegistry(broken, { now: NOW });
      expect(result.ok, id).toBe(false);
      expect(rules(result)).toContain('missing-website-implementation');
    }
  });

  it('marks nothing as implemented without an entry point', () => {
    for (const record of registry.capabilities) {
      if (surfaceIsPresent(record.websiteStatus)) {
        expect(record.websiteEntryPoints.length, `${record.capabilityId} website`).toBeGreaterThan(0);
      }
      if (surfaceIsPresent(record.cliStatus)) {
        expect(record.cliEntryPoints.length, `${record.capabilityId} cli`).toBeGreaterThan(0);
      }
    }
  });
});

/* --------------------------- the check itself --------------------------- */

describe('the parity check fails when it should', () => {
  it('passes a fully consistent registry', () => {
    expect(check([capability({ capabilityId: 'ok' })]).ok).toBe(true);
  });

  it('fails when the website is implemented but the CLI is missing', () => {
    const result = check([capability({
      capabilityId: 'web-only', cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
    })]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('missing-cli-implementation');
  });

  it('fails when the CLI is implemented but the website is missing', () => {
    const result = check([capability({
      capabilityId: 'cli-only', websiteStatus: 'not_started',
      websiteEntryPoints: [], websiteTestReferences: [],
    })]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('missing-website-implementation');
  });

  it('fails when a tested capability has no test references', () => {
    expect(rules(check([capability({ capabilityId: 'no-web-tests', websiteTestReferences: [] })])))
      .toContain('missing-website-tests');
    expect(rules(check([capability({ capabilityId: 'no-cli-tests', cliTestReferences: [] })])))
      .toContain('missing-cli-tests');
  });

  it('fails an unapproved surface-specific exception', () => {
    const result = check([capability({
      capabilityId: 'self-exempt', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
    })]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('unapproved-exception');
  });

  /**
   * This case used to ACCEPT `{reason, approvedBy: 'founder', approvedAt}`
   * with no expiry — precisely the self-granted, permanent waiver the H-2
   * review found. Exemption is now all-or-nothing; the full adversarial
   * matrix lives in `parity-bypass.test.ts`.
   */
  it('accepts ONLY a complete founder exception, and rejects the old weak shape', () => {
    const incomplete = check([capability({
      capabilityId: 'approved-exempt', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: {
        reason: 'Browser viewport layout has no terminal equivalent.',
        approvedBy: 'founder',
        approvedAt: '2026-07-28T00:00:00.000Z',
      } as RelaySurfaceCapability['exception'],
    })]);
    expect(incomplete.ok, 'a permanent, generically-approved exception must not pass').toBe(false);

    const complete = check([capability({
      capabilityId: 'approved-exempt', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: {
        reason: 'Browser viewport chrome has no meaningful terminal equivalent to render.',
        approvedBy: 'founder:ohdieyuh-glitch',
        approvedAt: '2026-07-20T00:00:00.000Z',
        expiresAt: '2026-08-20T00:00:00.000Z',
        affectedCapability: 'approved-exempt',
        missingSurface: 'cli',
        evidence: ['src/relay/ui/app/projection.ts'],
      },
    })]);
    expect(complete.failures, JSON.stringify(complete.failures)).toEqual([]);
    expect(complete.ok).toBe(true);
  });

  it('fails an exception missing the founder identity or the reason', () => {
    expect(rules(check([capability({
      capabilityId: 'no-approver', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: { reason: 'x', approvedBy: '', approvedAt: '2026-07-01T00:00:00.000Z' } as RelaySurfaceCapability['exception'],
    })]))).toContain('exception-approver');

    expect(rules(check([capability({
      capabilityId: 'no-reason', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: { reason: '   ', approvedBy: 'founder', approvedAt: '2026-07-01T00:00:00.000Z' } as RelaySurfaceCapability['exception'],
    })]))).toContain('exception-reason');
  });

  it('fails an EXPIRED exception', () => {
    const result = check([capability({
      capabilityId: 'stale-exempt', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: {
        reason: 'temporary', approvedBy: 'founder',
        approvedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-06-01T00:00:00.000Z',
      } as RelaySurfaceCapability['exception'],
    })]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('expired-exception');
    expect(rules(result)).toContain('missing-cli-implementation');
  });

  it('fails a duplicate capability id', () => {
    const result = check([capability({ capabilityId: 'twin' }), capability({ capabilityId: 'twin' })]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('duplicate-capability-id');
  });

  it('fails an unknown domain, parity class, or status', () => {
    const bad = check([capability({
      capabilityId: 'weird',
      domain: 'nonsense' as RelaySurfaceCapability['domain'],
      parityClass: 'whatever' as RelaySurfaceCapability['parityClass'],
      websiteStatus: 'maybe' as RelaySurfaceCapability['websiteStatus'],
    })]);
    expect(rules(bad)).toEqual(expect.arrayContaining(['domain', 'parity-class', 'website-status']));
  });

  it('fails when a required milestone capability is absent', () => {
    const result = validateRegistry(
      { manifestVersion: '1.0.0', description: 'x', capabilities: [capability()] },
      { now: NOW },
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('missing-required-capability');
  });

  it('fails a malformed registry outright', () => {
    expect(validateRegistry(null, { now: NOW }).ok).toBe(false);
    expect(validateRegistry({ capabilities: 'nope' }, { now: NOW }).ok).toBe(false);
  });
});

/* -------------------------- companion repository ------------------------ */

describe('cross-repository verification', () => {
  it('detects a manifest version or checksum mismatch', () => {
    const local = { registry: { manifestVersion: '1.0.0' }, checksum: 'a'.repeat(64) };
    const same = { registry: { manifestVersion: '1.0.0' }, checksum: 'a'.repeat(64) };
    expect(compareRegistries(local, same).ok).toBe(true);

    const otherVersion = { registry: { manifestVersion: '2.0.0' }, checksum: 'a'.repeat(64) };
    expect(rules(compareRegistries(local, otherVersion))).toContain('manifest-version-mismatch');

    const otherChecksum = { registry: { manifestVersion: '1.0.0' }, checksum: 'b'.repeat(64) };
    expect(rules(compareRegistries(local, otherChecksum))).toContain('manifest-checksum-mismatch');
  });

  /* -------------------- post-separation re-anchoring --------------------
   * The companion-repository requirement was written when the website and
   * the CLI lived in two separate ALCATRAZ worktrees. Both surfaces are now
   * in this one repository, so requiring a second checkout would be
   * cross-product coupling (and would fail outright in CI). Parity is proven
   * here instead: every file the registry declares must exist in this tree.
   * -------------------------------------------------------------------- */

  it('never searches for a companion by default, and never points at Alcatraz', () => {
    expect(DEFAULT_COMPANION_PATHS).toEqual([]);
    expect(findCompanion(repoRoot)).toBeNull();
    expect(findCompanion(repoRoot, undefined)).toBeNull();
    const source = readFileSync(join(repoRoot, 'scripts/relay-surface-parity.mjs'), 'utf8');
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '');
    expect(executable).not.toContain('../sunday-relay');
    expect(executable).not.toContain('turbo-broccoli');
  });

  it('STRICT mode passes in this repository with no companion checkout at all', () => {
    const result = runParityCheck({ repoRoot, strict: true, now: NOW });
    expect(rules(result)).not.toContain('companion-missing');
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('both surfaces are verified in this repository');
  });

  it('an EXPLICIT companion path that does not exist is still a failure', () => {
    const result = runParityCheck({
      repoRoot,
      strict: true,
      companionPath: join(repoRoot, 'this-companion-does-not-exist'),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('companion-unreadable');
  });

  /**
   * TRUTHFUL TOTALS — and the assertion that would have caught the field the
   * checker never looked at.
   *
   * `sharedDomainReferences` is a REQUIRED field naming the canonical modules
   * BOTH surfaces import, and it was absent from the checker's field list: 70
   * declarations carried in the registry, counted in no total, verified by
   * nothing, and 7 of them did not resolve. The printed "120/120 present" was
   * a true statement about a population that silently excluded the field.
   *
   * The expected counts are recomputed here from the registry rather than
   * pinned to a literal, so this stays honest as capabilities are added — but
   * it walks EVERY declaring field. Dropping one from the checker again makes
   * the totals disagree, and the floor below fails outright.
   */
  it('verifies every declared FILE, sharedDomainReferences included, and counts them truthfully', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const fields = DECLARATION_FIELDS.map((spec: { field: string }) => spec.field);
    expect(fields, 'the shared domain field must be verified like any other')
      .toContain('sharedDomainReferences');

    let expectedFiles = 0;
    let expectedCommands = 0;
    let sharedDeclarations = 0;
    for (const record of registry.capabilities) {
      for (const field of fields as Array<keyof RelaySurfaceCapability>) {
        const declarations = (record[field] ?? []) as string[];
        for (const declared of declarations) {
          if (/^relay(\s|$)/.test(declared.trim())) expectedCommands += 1;
          else expectedFiles += 1;
        }
      }
      sharedDeclarations += record.sharedDomainReferences.length;
    }
    expect(sharedDeclarations, 'the registry declares no shared domain modules at all')
      .toBeGreaterThan(0);

    const declared = verifyDeclaredFiles(repoRoot, loaded.value.registry);
    expect(declared.failures).toEqual([]);
    expect(declared.ok).toBe(true);
    expect(declared.checked, 'every declaring field must be counted').toBe(expectedFiles);
    expect(declared.commands).toBe(expectedCommands);
    // `present` and `checked` must describe the SAME population.
    expect(declared.present).toBe(declared.checked);
    // The pre-repair total was 120 file claims, because the 70 shared-domain
    // declarations were invisible. A floor above that pins the repair.
    expect(declared.checked, 'the shared domain declarations must be in the total')
      .toBeGreaterThan(150);

    const result = runParityCheck({ repoRoot, strict: true, now: NOW });
    const output = result.lines.join('\n');
    expect(output).toContain(`declared surface files: ${declared.present}/${declared.checked} present`);
    expect(output).toContain(`declared CLI commands: ${declared.commands}`);
    // Nothing failed, so there is no failure line to print.
    expect(output).not.toContain('declaration failures:');
  });

  /**
   * The printed ratio used to be `checked - failures.length` over `checked`.
   * A failure that never incremented `checked` — an unparseable declaration —
   * was still subtracted from it, so the numerator and the denominator came
   * from different populations and presence could be understated to zero.
   */
  it('the printed ratio never mixes populations, even when declarations are unparseable', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const broken = JSON.parse(JSON.stringify(loaded.value.registry)) as {
      capabilities: Array<{ websiteEntryPoints?: string[] }>;
    };
    // Neither a command nor a path: counted in NEITHER `checked` nor `present`.
    broken.capabilities[0].websiteEntryPoints = ['somewhere in the website'];
    const declared = verifyDeclaredFiles(repoRoot, broken);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('unparseable-declaration');
    expect(declared.present).toBeLessThanOrEqual(declared.checked);
    expect(declared.present).toBe(declared.checked);
    expect(declared.checked).toBeGreaterThan(150);
  });

  it('a registry naming a shared domain module that does not exist FAILS', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const broken = JSON.parse(JSON.stringify(loaded.value.registry)) as {
      capabilities: Array<{ sharedDomainReferences?: string[] }>;
    };
    broken.capabilities[0].sharedDomainReferences = ['src/relay/shared/this-module-was-deleted.ts'];
    const declared = verifyDeclaredFiles(repoRoot, broken);
    expect(declared.ok).toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('missing-shared-domain-file');

    // A real shared module in the same slot passes — the rule is strict, not broken.
    broken.capabilities[0].sharedDomainReferences = ['src/relay/shared/official-relay-dog-sprite.ts'];
    expect(verifyDeclaredFiles(repoRoot, broken).ok).toBe(true);
  });

  /**
   * The pause and resume shared-domain anchors were written `#intent:pause`
   * and `#intent:resume`, which no file contains and which `ANCHOR_SEGMENT`
   * cannot even admit — `:` is not a legal segment character. They resolved
   * only because nothing checked the field. The repaired call form names the
   * canonical intent list AND the intent, and both segments are verified.
   */
  it('the repaired mission pause/resume anchors name real, verified intents', () => {
    const intentsPath = join('src', 'relay', 'mission', 'commands', 'command-types.ts');
    const content = readFileSync(join(repoRoot, intentsPath), 'utf8');

    for (const [id, intent] of [['mission-pause', 'pause'], ['mission-resume', 'resume']] as const) {
      const record = registry.capabilities.find((c) => c.capabilityId === id)!;
      const declared = record.sharedDomainReferences
        .find((reference) => declaredPathOf(reference) === intentsPath.replace(/\\/g, '/'));
      expect(declared, `${id} must declare the canonical command intent module`).toBeTruthy();

      const anchor = declared!.split('#')[1];
      expect(anchorSegments(anchor)).toEqual(['RELAY_MISSION_COMMAND_INTENTS', intent]);
      expect(verifyAnchor(content, anchor).ok, `${id} anchor must resolve`).toBe(true);

      // The pre-repair notation could never have resolved.
      expect(verifyAnchor(content, `intent:${intent}`).ok).toBe(false);
    }
  });

  it('a registry naming a file that does not exist FAILS', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const registry = JSON.parse(JSON.stringify(loaded.value.registry)) as {
      capabilities: Array<{ capabilityId: string; cliEntryPoints?: string[]; websiteEntryPoints?: string[] }>;
    };
    registry.capabilities[0].cliEntryPoints = ['src/relay/cli/this-file-was-deleted.ts'];
    const declared = verifyDeclaredFiles(repoRoot, registry);
    expect(declared.ok).toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('missing-cli-entry-file');

    registry.capabilities[0].websiteEntryPoints = ['src/relay/ui/gone.tsx'];
    expect(verifyDeclaredFiles(repoRoot, registry).failures.map((f: { rule: string }) => f.rule))
      .toContain('missing-website-entry-file');
  });

  it('distinguishes file claims from CLI command notations', () => {
    // Real paths — checked on disk.
    expect(isFileClaim('src/relay/cli/product/app.ts')).toBe(true);
    expect(isFileClaim('src/relay/cli/product/app.ts#DRAFT_FIELDS')).toBe(true);
    expect(declaredPathOf('src/relay/cli/product/app.ts#DRAFT_FIELDS')).toBe('src/relay/cli/product/app.ts');
    // Commands — verified by the CLI's own tests, never by the filesystem.
    // `relay (interactive) /pause` contains a slash, so a naive '/' rule
    // would have mistaken it for a path.
    expect(isFileClaim('relay mission budget')).toBe(false);
    expect(isFileClaim('relay (interactive) /pause')).toBe(false);
    expect(isFileClaim('relay (interactive) /done | /cannot-complete')).toBe(false);
  });

  it('loads this repository\'s registry', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(REGISTRY_RELATIVE_PATH.replace(/\\/g, '/')).toBe(RELAY_PARITY_REGISTRY_PATH);
  });
});

/* ------------------- reachability: existence is not a mount -------------- */

describe('an implemented website capability must be REACHABLE, not merely present', () => {
  /**
   * The gap this closes was real and it lasted a whole milestone.
   * `mcp-connection-management` was `tested` on both surfaces, every declared
   * file resolved, and no browser entry rendered the component. The registry
   * read as parity; the website had no such surface. These tests hold the
   * repaired rule to failing on exactly that shape.
   */

  const reachable = reachableFromBrowserEntries(repoRoot);

  it('the browser entry itself is reachable, and the walk found a real graph', () => {
    for (const entry of BROWSER_ENTRY_POINTS) expect(reachable.has(entry)).toBe(true);
    // A resolver that silently resolved nothing would report every surface
    // unmounted, and a resolver that "resolved" everything would report none.
    expect(reachable.size).toBeGreaterThan(50);
    expect(reachable.has('src/relay/ui/preview/RelayPreviewApp.tsx')).toBe(true);
    // Server-only modules are NOT in a browser graph.
    expect(reachable.has('src/relay/cli/main.ts')).toBe(false);
  });

  it('follows relative, index, extensionless and root-absolute specifiers', () => {
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/main.tsx', './ui/preview/RelayPreviewApp'))
      .toBe('src/relay/ui/preview/RelayPreviewApp.tsx');
    // A directory import resolves through its barrel.
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/ui/preview/RelayPreviewApp.tsx', '../project-settings'))
      .toBe('src/relay/ui/project-settings/index.ts');
    // Root-absolute, the form that once slipped past a boundary walker.
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/main.tsx', '/src/relay/ui/preview/RelayPreviewApp.tsx'))
      .toBe('src/relay/ui/preview/RelayPreviewApp.tsx');
    // Assets and packages contribute no module edge.
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/main.tsx', './relay.css')).toBeNull();
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/main.tsx', 'react')).toBeNull();
    expect(resolveModuleSpecifier(repoRoot, 'src/relay/main.tsx', 'node:fs')).toBeNull();
  });

  it('recognises every import form this repository actually uses', () => {
    const specifiers = importSpecifiersOf([
      "import { A } from './a';",
      "export { B } from './b';",
      "import './c.css';",
      "const d = await import('./d');",
      "import Default, { type F } from './f';",
      "import * as ns from './g';",
      // A side-effect import with empty braces IS a real edge: the module is
      // still evaluated, and this repository's bundler preserves it.
      "import {} from './h';",
    ].join('\n'));
    expect(specifiers).toEqual(expect.arrayContaining(['./a', './b', './c.css', './d', './f', './g', './h']));
  });

  it('counts NO edge for something a bundler would not include', () => {
    // The checker's whole purpose is preventing a false pass. Each of these
    // once produced one: a surface reachable ONLY through a type-only import or
    // a commented-out import was reported mounted, and TypeScript erases the
    // first while nothing at all executes the second.
    const specifiers = importSpecifiersOf([
      "import type { E } from './erased-type-clause';",
      "import { type OnlyAType } from './erased-inline-type';",
      "export type { G } from './erased-type-reexport';",
      "// import { Thing } from './commented-line';",
      "/* import { Thing } from './commented-block'; */",
      '/**\n * import { Thing } from "./commented-doc";\n */',
      // A bare apostrophe in prose is NOT a string delimiter. This one line is
      // what defeated the first version of the scanner for the rest of a file.
      "export const copy = <p>Relay's own inspection</p>;",
      "// import { Thing } from './commented-after-an-apostrophe';",
      // A regex carrying a quote, and one carrying an odd number of backticks.
      "const q = /['\"]/;",
      "// import { Thing } from './commented-after-a-regex';",
      'const t = /\\bimport\\s*\\(\\s*`([^`$]+)`\\s*\\)/g;',
      "// import { Thing } from './commented-after-a-backtick-regex';",
      "import { Real } from './real';",
    ].join('\n'));
    expect(specifiers).toEqual(['./real']);
  });

  it('does not truncate a line that carries a URL literal', () => {
    // A naive comment stripper eats everything after `//` — including, on this
    // line, the import that follows a string containing a protocol separator.
    const specifiers = importSpecifiersOf([
      "const endpoint = 'https://example.com/mcp'; import { A } from './a';",
      "const other = \"http://example.com\";",
      "import { B } from './b';",
    ].join('\n'));
    expect(specifiers).toEqual(expect.arrayContaining(['./a', './b']));
  });

  it('NO reachable module can be made to yield a phantom edge by a comment', () => {
    /*
     * THE PROPERTY, TESTED ON THE REAL TREE.
     *
     * Unit cases prove the scanner handles the shapes someone thought of. This
     * proves the thing the checker actually promises: that no file in the
     * browser graph can have a commented-out import counted as a real edge.
     *
     * It exists because the first version of `stripComments` failed exactly
     * here and no unit case caught it. A bare apostrophe in JSX text —
     * `Relay's own inspection` — opened a "string" that never closed, so every
     * comment after it in that file survived; 22 of 646 tracked files did it,
     * four of them inside this graph. A regex holding an odd number of
     * backticks did the same one layer down.
     */
    const ghost = './__phantom_edge_that_must_not_be_followed__';
    const offenders: string[] = [];
    for (const relative of reachableFromBrowserEntries(repoRoot)) {
      const full = join(repoRoot, relative);
      if (!existsSync(full)) continue;
      const source = readFileSync(full, 'utf8');
      const probed = `${source}\n// import { Ghost } from '${ghost}';\n`;
      if (importSpecifiersOf(probed).includes(ghost)) offenders.push(relative);
    }
    expect(offenders, 'a commented-out import was counted as a real edge').toEqual([]);
  });

  it('and no reachable module loses a REAL edge to the same scanner', () => {
    // The other direction. Over-stripping would produce a false FAILURE, which
    // is loud rather than silent — but it would still be wrong, and a scanner
    // that drops edges to protect itself is not a reachability checker.
    const real = './__real_edge_that_must_be_followed__';
    const offenders: string[] = [];
    for (const relative of reachableFromBrowserEntries(repoRoot)) {
      const full = join(repoRoot, relative);
      if (!existsSync(full)) continue;
      const probed = `${readFileSync(full, 'utf8')}\nimport { Real } from '${real}';\n`;
      if (!importSpecifiersOf(probed).includes(real)) offenders.push(relative);
    }
    expect(offenders, 'a real import was not seen').toEqual([]);
  });

  it('the doc block does not claim a false pass is impossible', () => {
    // LOW-value on its own, but the module used to assert a guarantee wider
    // than it held. The barrel over-approximation is real and must stay stated.
    const source = readFileSync(join(repoRoot, 'scripts/relay-surface-parity.mjs'), 'utf8');
    const docBlock = source.slice(0, source.indexOf('export function importSpecifiersOf'));
    expect(docBlock).toContain('KNOWN OVER-APPROXIMATION');
    expect(docBlock).toContain('unconsumed barrel re-export');
  });

  it('THE MCP SURFACE IS MOUNTED — the component and its settings host are both reachable', () => {
    for (const path of [
      'src/relay/ui/mcp/RelayMcpConnections.tsx',
      'src/relay/ui/mcp/mcp-settings-view.ts',
      'src/relay/ui/project-settings/SettingsMcp.tsx',
    ]) {
      expect(reachable.has(path), `${path} is declared but no browser entry reaches it`).toBe(true);
    }
  });

  it('this repository has no unreachable website entry point that is not disclosed', () => {
    const result = verifyWebsiteReachability(repoRoot, registry);
    expect(result.failures).toEqual([]);
    expect(result.mounted).toBeGreaterThan(0);
    expect(result.checked).toBeGreaterThanOrEqual(result.mounted);
  });

  it('FAILS a declared website surface that no browser entry renders', () => {
    const result = verifyWebsiteReachability(repoRoot, {
      capabilities: [capability({
        capabilityId: 'ghost-surface',
        // A real file, fully tested, that nothing in the running website mounts.
        websiteEntryPoints: ['src/relay/ui/project-workspace/RelayMissionEconomics.tsx#RelayMissionEconomics'],
      })],
    });
    // Recorded paths are disclosed, not failed — so use one that is NOT recorded.
    const undisclosed = verifyWebsiteReachability(repoRoot, {
      capabilities: [capability({
        capabilityId: 'ghost-surface',
        websiteEntryPoints: ['src/relay/ui/psp-import/relay-psp-import.test.tsx'],
      })],
    });
    expect(result.failures.map((f: { rule: string }) => f.rule)).not.toContain('website-entry-unreachable');
    expect(result.unmounted).toContain('src/relay/ui/project-workspace/RelayMissionEconomics.tsx');
    expect(undisclosed.failures.map((f: { rule: string }) => f.rule)).toContain('website-entry-unreachable');
  });

  it('does NOT demand reachability from a capability that claims no website surface', () => {
    const result = verifyWebsiteReachability(repoRoot, {
      capabilities: [capability({
        capabilityId: 'cli-only',
        websiteStatus: 'not_started',
        websiteEntryPoints: ['src/relay/ui/psp-import/relay-psp-import.test.tsx'],
      })],
    });
    // The `unused-unmounted-record` rule compares against the WHOLE registry
    // and is expected to fire on a one-capability fixture, so this asserts the
    // rule actually under test rather than an empty list.
    expect(result.failures.map((f: { rule: string }) => f.rule)).not.toContain('website-entry-unreachable');
    expect(result.checked).toBe(0);
  });

  it('FAILS a record that has gone stale — mounting forces the disclosure to be corrected', () => {
    // A path that IS reachable, recorded as if it were not. This is the shape
    // the MCP surface would have taken had its "not mounted" disclosure been
    // left behind by this change.
    const result = verifyWebsiteReachability(
      repoRoot,
      { capabilities: [capability({ capabilityId: 'mounted', websiteEntryPoints: ['src/relay/main.tsx'] })] },
      { 'src/relay/main.tsx': 'stale claim that the browser entry is not mounted' },
    );
    expect(result.failures.map((f: { rule: string }) => f.rule)).toContain('stale-unmounted-record');
  });

  it('FAILS a record that no capability declares — a disclosure about nothing', () => {
    const result = verifyWebsiteReachability(repoRoot, {
      capabilities: [capability({ capabilityId: 'unrelated', websiteEntryPoints: ['src/relay/main.tsx'] })],
    });
    expect(result.failures.map((f: { rule: string }) => f.rule)).toContain('unused-unmounted-record');
  });

  it('every recorded unmounted surface is genuinely unmounted AND genuinely declared', () => {
    for (const [path, why] of Object.entries(UNMOUNTED_WEBSITE_SURFACES)) {
      expect(existsSync(join(repoRoot, path)), `${path} is recorded but does not exist`).toBe(true);
      expect(reachable.has(path), `${path} is recorded as unmounted but IS reachable`).toBe(false);
      // A record with no reason discloses nothing.
      expect(String(why).length).toBeGreaterThan(40);
    }
    const result = verifyWebsiteReachability(repoRoot, registry);
    expect(result.failures.map((f: { rule: string }) => f.rule)).not.toContain('unused-unmounted-record');
  });

  it('the run prints the reachability total and every NOT MOUNTED disclosure', () => {
    const result = runParityCheck({ repoRoot, now: NOW });
    const printed = result.lines.join('\n');
    expect(printed).toMatch(/website entry points reachable: \d+\/\d+ mounted/);
    for (const path of Object.keys(UNMOUNTED_WEBSITE_SURFACES)) {
      expect(printed).toContain(`NOT MOUNTED  ${path}`);
    }
    expect(result.ok).toBe(true);
  });

  it('STRICT mode enforces reachability too — it is not a local-only courtesy', () => {
    const strict = runParityCheck({ repoRoot, strict: true, now: NOW });
    expect(strict.ok).toBe(true);
    expect(strict.lines.join('\n')).toMatch(/website entry points reachable: \d+\/\d+ mounted/);
  });
});
