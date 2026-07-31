import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  anchorSegments,
  compareRegistries,
  declaredPathOf,
  DECLARATION_FIELDS,
  DEFAULT_COMPANION_PATHS,
  findCompanion,
  isFileClaim,
  loadRegistry,
  runParityCheck,
  validateRegistry,
  verifyAnchor,
  verifyDeclaredFiles,
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
