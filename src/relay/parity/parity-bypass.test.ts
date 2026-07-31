import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ANCHOR_SEGMENT,
  anchorSegments,
  classifyDeclaration,
  COMMAND_PREFIX,
  FOUNDER_IDENTITIES,
  isFileClaim,
  MAX_EXCEPTION_LIFETIME_DAYS,
  MIN_EXCEPTION_REASON_LENGTH,
  NON_EXEMPTIBLE_CAPABILITIES,
  resolveInsideRepo,
  runParityCheck,
  validateException,
  validateRegistry,
  verifyAnchor,
  verifyDeclaredFiles,
} from '../../../scripts/relay-surface-parity.mjs';
import type { RelaySurfaceCapability, RelaySurfaceException } from './surface-capability-types';

/**
 * PARITY BYPASS REGRESSION SUITE (H-2).
 *
 * Two ways the parity requirement could be switched off while the check still
 * printed PASS. Both are reproduced here exactly as they were reported, and
 * both must now fail.
 *
 * BYPASS A — the founder exception. `exempt` required only that `approvedBy`
 * was a NON-EMPTY STRING and that an OPTIONAL `expiresAt` had not passed. So
 * `{reason: "x", approvedBy: "me", approvedAt: "..."}` — self-granted,
 * unexplained, and permanent, because omitting `expiresAt` meant it never
 * expired — suspended parity for any capability, forever.
 *
 * BYPASS B — the evidence path. A declaration was treated as a FILE CLAIM
 * only when it contained NO WHITESPACE. One trailing space demoted it to a
 * "CLI command", which the checker skipped without looking at the disk. Every
 * deleted or invented file could be kept in the registry that way.
 *
 * Reads only. No network, no provider, no deployment.
 */

const repoRoot = process.cwd();
const NOW = '2026-07-29T12:00:00.000Z';
const FOUNDER = FOUNDER_IDENTITIES[0];

const rules = (result: { failures: Array<{ rule: string }> }) => result.failures.map((f) => f.rule);

function capability(overrides: Partial<RelaySurfaceCapability> = {}): RelaySurfaceCapability {
  return {
    capabilityId: 'sample',
    name: 'Sample',
    domain: 'settings',
    parityClass: 'functional_required',
    websiteStatus: 'tested',
    cliStatus: 'tested',
    websiteEntryPoints: ['src/relay/ui/app/projection.ts'],
    cliEntryPoints: ['relay sample'],
    websiteTestReferences: ['src/relay/ui/app/live-mission.test.ts'],
    cliTestReferences: ['src/relay/cli/cli.test.ts'],
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
        capability({ capabilityId: 'relay-dog-identity' }),
        capability({ capabilityId: 'relay-dog-state-semantics' }),
        capability({ capabilityId: 'psp-agent-id-import' }),
      ],
    },
    { now: NOW },
  );
}

/** A COMPLETE, valid founder exception — the only shape that exempts. */
function validException(overrides: Partial<RelaySurfaceException> = {}): RelaySurfaceException {
  return {
    reason: 'The browser viewport chrome has no meaningful terminal equivalent to render.',
    approvedBy: FOUNDER,
    approvedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    affectedCapability: 'exempt-me',
    missingSurface: 'cli',
    evidence: ['src/relay/ui/app/projection.ts'],
    ...overrides,
  };
}

/** A surface_specific capability whose CLI side genuinely does not exist. */
function exemptCandidate(exception: RelaySurfaceException | undefined) {
  return capability({
    capabilityId: 'exempt-me',
    parityClass: 'surface_specific',
    cliStatus: 'not_started',
    cliEntryPoints: [],
    cliTestReferences: [],
    ...(exception ? { exception } : {}),
  });
}

/* ==================================================================== A */

describe('BYPASS A — the founder exception could be self-granted and permanent', () => {
  it('reproduces the reviewed bypass, and it now FAILS', () => {
    // The EXACT shape the old `exempt` accepted: any non-empty approver, no
    // expiry at all, a one-character reason.
    const bypass = { reason: 'x', approvedBy: 'me', approvedAt: '2026-07-01T00:00:00.000Z' };
    const result = check([exemptCandidate(bypass as unknown as RelaySurfaceException)]);

    expect(result.ok, 'a self-granted permanent exception must not pass').toBe(false);
    // It is not exempt, so the underlying parity gap is reported too.
    expect(rules(result)).toContain('missing-cli-implementation');
    expect(rules(result)).toEqual(
      expect.arrayContaining([
        'exception-reason',
        'exception-approver',
        'exception-expires-at',
        'exception-affected-capability',
        'exception-missing-surface',
        'exception-evidence',
      ]),
    );
  });

  it('a COMPLETE founder exception still exempts — the rule is strict, not broken', () => {
    const result = check([exemptCandidate(validException())]);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('an anonymous or empty approver is not an approval', () => {
    for (const approvedBy of ['', '   ', 'anonymous', 'unknown']) {
      const result = validateException(exemptCandidate(validException({ approvedBy })), NOW);
      expect(rules({ failures: result }), approvedBy).toContain('exception-approver');
    }
  });

  it('a SELF-approved exception — a developer or an agent — is not an approval', () => {
    for (const approvedBy of ['claude', 'claude-code', 'codex', 'hermes', 'relay', 'ci', 'bot', 'founder']) {
      const result = validateException(exemptCandidate(validException({ approvedBy })), NOW);
      expect(rules({ failures: result }), approvedBy).toContain('exception-approver');
    }
    // Only the canonical, fully qualified identity is accepted.
    expect(FOUNDER_IDENTITIES).toEqual(['founder:ohdieyuh-glitch']);
  });

  it('a placeholder reason is not a justification', () => {
    for (const reason of ['', '   ', 'x', 'temporary', 'because']) {
      const result = validateException(exemptCandidate(validException({ reason })), NOW);
      expect(rules({ failures: result }), reason).toContain('exception-reason');
    }
    expect(MIN_EXCEPTION_REASON_LENGTH).toBeGreaterThanOrEqual(24);
  });

  it('there is NO permanent exception — a missing expiry fails', () => {
    const { expiresAt: _dropped, ...noExpiry } = validException();
    const result = validateException(
      exemptCandidate(noExpiry as unknown as RelaySurfaceException),
      NOW,
    );
    expect(rules({ failures: result })).toContain('exception-expires-at');
  });

  it('an EXPIRED exception fails, and the parity gap reappears', () => {
    const result = check([
      exemptCandidate(
        validException({ approvedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-03-01T00:00:00.000Z' }),
      ),
    ]);
    expect(rules(result)).toContain('expired-exception');
    expect(rules(result)).toContain('missing-cli-implementation');
  });

  it('the lifetime is bounded — a decade-long waiver fails', () => {
    const result = validateException(
      exemptCandidate(
        validException({ approvedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2036-07-01T00:00:00.000Z' }),
      ),
      NOW,
    );
    expect(rules({ failures: result })).toContain('exception-lifetime');
    expect(MAX_EXCEPTION_LIFETIME_DAYS).toBeLessThanOrEqual(90);
  });

  it('a back-dated future approval fails', () => {
    const result = validateException(
      exemptCandidate(validException({ approvedAt: '2027-01-01T00:00:00.000Z' })),
      NOW,
    );
    expect(rules({ failures: result })).toContain('exception-approved-at');
  });

  it('a malformed date is not a date', () => {
    for (const patch of [{ approvedAt: 'soon' }, { expiresAt: 'never' }, { expiresAt: '' }]) {
      const result = validateException(exemptCandidate(validException(patch)), NOW);
      expect(result.length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
  });

  it('a WILDCARD capability cannot be exempted', () => {
    for (const affectedCapability of ['*', '?', 'all', 'any', '.*', 'mission-*']) {
      const result = validateException(
        exemptCandidate(validException({ affectedCapability })),
        NOW,
      );
      expect(rules({ failures: result }), affectedCapability).toContain('exception-affected-capability');
    }
  });

  it('an exception that names a DIFFERENT capability does not cover this one', () => {
    const result = validateException(
      exemptCandidate(validException({ affectedCapability: 'some-other-capability' })),
      NOW,
    );
    expect(rules({ failures: result })).toContain('exception-affected-capability');
  });

  it('the exception must name the surface that is ACTUALLY missing', () => {
    // The CLI is the missing side here; claiming the website is missing is a lie.
    const result = validateException(exemptCandidate(validException({ missingSurface: 'website' })), NOW);
    expect(rules({ failures: result })).toContain('exception-missing-surface');
  });

  /**
   * BYPASS A2 — a fabricated COMMAND satisfied the evidence requirement.
   *
   * Evidence was classified with the same classifier as an entry point, and a
   * `relay …` notation is deliberately never resolved on disk (the CLI's own
   * command tests verify commands). So an invented command was accepted as the
   * proof that suspends parity — a string nothing in this repository would
   * ever look for. Evidence is the one field where command notation can never
   * be legitimate.
   */
  it('a FABRICATED command cannot satisfy exception evidence', () => {
    const fabricated = 'relay this-command-does-not-exist --fabricated';
    // It really is a command notation — that is what made it skippable.
    expect(classifyDeclaration(fabricated).kind).toBe('command');

    const evidence = [fabricated];
    expect(rules({ failures: validateException(exemptCandidate(validException({ evidence })), NOW) }))
      .toContain('exception-evidence');

    // And the declared-file pass refuses it too, rather than counting it as a
    // verified command.
    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [exemptCandidate(validException({ evidence }))],
    });
    expect(declared.ok).toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('command-notation-not-permitted');
    expect(declared.commands, 'a fabricated command must not be counted as verified').toBe(0);

    // The whole waiver fails, so the parity gap it was hiding reappears.
    const result = check([exemptCandidate(validException({ evidence }))]);
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('missing-cli-implementation');
  });

  it('evidence is mandatory, must resolve, and may not be cited twice', () => {
    expect(rules({ failures: validateException(exemptCandidate(validException({ evidence: [] })), NOW) }))
      .toContain('exception-evidence');

    expect(
      rules({
        failures: validateException(
          exemptCandidate(
            validException({ evidence: ['src/relay/ui/app/projection.ts', 'src/relay/ui/app/projection.ts'] }),
          ),
          NOW,
        ),
      }),
    ).toContain('exception-evidence');

    // Evidence that does not exist on disk fails the declared-file pass.
    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [exemptCandidate(validException({ evidence: ['src/relay/ui/does-not-exist.ts'] }))],
    });
    expect(declared.ok).toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('missing-exception-evidence-file');
  });

  it('CORE MISSION TRUTH cannot be exempted by any approval, however complete', () => {
    for (const capabilityId of NON_EXEMPTIBLE_CAPABILITIES) {
      const result = validateException(
        capability({
          capabilityId,
          parityClass: 'surface_specific',
          cliStatus: 'not_started',
          cliEntryPoints: [],
          cliTestReferences: [],
          exception: validException({ affectedCapability: capabilityId }),
        }),
        NOW,
      );
      expect(rules({ failures: result }), capabilityId).toContain('exception-non-exemptible');
    }
    for (const required of ['review', 'repair', 'approval', 'mission-status', 'evidence-inspection']) {
      expect(NON_EXEMPTIBLE_CAPABILITIES).toContain(required);
    }
  });

  it('an exception on a class that can never be exempted is reported, not ignored', () => {
    const result = check([
      capability({
        capabilityId: 'not-surface-specific',
        parityClass: 'functional_required',
        exception: validException({ affectedCapability: 'not-surface-specific', missingSurface: 'cli' }),
      }),
    ]);
    expect(rules(result)).toContain('exception-not-permitted');
  });

  it('surface_specific with no exception at all still fails', () => {
    expect(rules(check([exemptCandidate(undefined)]))).toContain('unapproved-exception');
  });
});

/* ==================================================================== B */

describe('BYPASS B — whitespace could demote a file claim to an unchecked "command"', () => {
  it('reproduces the reviewed bypass, and it now FAILS', () => {
    // ONE trailing space. The old `isFileClaim` returned false, so the
    // checker skipped it and never looked at the disk.
    const declaration = 'src/relay/ui/this-file-was-deleted.tsx ';
    expect(/\s/.test(declaration), 'the bypass depended on the whitespace rule').toBe(true);

    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [capability({ capabilityId: 'ghost', websiteEntryPoints: [declaration] })],
    });
    expect(declared.ok, 'a whitespace-padded missing file must not be skipped').toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('missing-website-entry-file');
  });

  it('whitespace in every position still resolves to the same file claim', () => {
    for (const declaration of [
      ' src/relay/ui/app/projection.ts',
      'src/relay/ui/app/projection.ts ',
      '\tsrc/relay/ui/app/projection.ts\n',
      'src/relay/ui/app/projection.ts #deriveMissionProjection',
      'src/relay/ui/app/projection.ts# deriveMissionProjection',
    ]) {
      const classified = classifyDeclaration(declaration);
      // Narrow by THROWING, never by returning: a silent return here would
      // turn a real regression into a test that asserts nothing.
      if (classified.kind !== 'file') {
        throw new Error(`${JSON.stringify(declaration)} classified as ${classified.kind}, expected a file claim`);
      }
      expect(classified.path).toBe('src/relay/ui/app/projection.ts');
    }
  });

  it('a declaration that is neither a command nor a path is a FAILURE, never a skip', () => {
    for (const declaration of [
      'somewhere in the website',
      'the CLI does this',
      'src/relay/ui/app/projection',
      'src/relay/ui/app/projection.ts#a#b',
      'src/relay/ui/app/projection.ts#',
      '#anchor-only',
      '',
      '   ',
    ]) {
      expect(classifyDeclaration(declaration).kind, JSON.stringify(declaration)).toBe('invalid');
    }

    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [capability({ capabilityId: 'vague', cliEntryPoints: ['somewhere in the CLI'] })],
    });
    expect(declared.ok).toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('unparseable-declaration');
  });

  it('only a "relay …" notation counts as a command', () => {
    for (const command of [
      'relay mission budget',
      'relay (interactive) /pause',
      'relay (interactive) /done | /cannot-complete',
      'relay',
    ]) {
      expect(classifyDeclaration(command).kind, command).toBe('command');
      expect(isFileClaim(command)).toBe(false);
    }
    expect(COMMAND_PREFIX.test('relayish thing')).toBe(false);
    expect(classifyDeclaration('npm run relay:cli:demo').kind).toBe('invalid');
  });

  it('path traversal, absolute paths and NUL bytes are refused', () => {
    for (const path of [
      '../outside.ts',
      'src/../../outside.ts',
      '/etc/passwd.ts',
      'src/relay/\0evil.ts',
    ]) {
      expect(resolveInsideRepo(repoRoot, path).ok, path).toBe(false);
    }
    expect(resolveInsideRepo(repoRoot, 'src/relay/ui/app/projection.ts').ok).toBe(true);

    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [capability({ capabilityId: 'escape', websiteEntryPoints: ['../../../etc/hosts.ts'] })],
    });
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('unsafe-declared-path');
  });

  it('a symlink that escapes the repository is refused', () => {
    const outside = mkdtempSync(join(tmpdir(), 'relay-parity-outside-'));
    writeFileSync(join(outside, 'secret.ts'), 'export const x = 1;\n');
    const linkDir = join(repoRoot, 'node_modules', '.relay-parity-symlink-test');
    mkdirSync(linkDir, { recursive: true });
    const link = join(linkDir, 'escape.ts');
    try {
      symlinkSync(join(outside, 'secret.ts'), link);
    } catch {
      // A platform without symlink permission cannot exercise this path; the
      // containment rule is still asserted by the traversal cases above.
      rmSync(outside, { recursive: true, force: true });
      rmSync(linkDir, { recursive: true, force: true });
      return;
    }
    const relative = 'node_modules/.relay-parity-symlink-test/escape.ts';
    expect(resolveInsideRepo(repoRoot, relative).ok).toBe(false);
    rmSync(outside, { recursive: true, force: true });
    rmSync(linkDir, { recursive: true, force: true });
  });

  it('a directory is not a file', () => {
    const declared = verifyDeclaredFiles(repoRoot, {
      capabilities: [capability({ capabilityId: 'dir', websiteEntryPoints: ['src/relay/ui/app.ts'] })],
    });
    // `src/relay/ui/app` is a directory; naming it with an extension fails.
    expect(declared.ok).toBe(false);
  });
});

/* ==================================================================== C */

describe('BYPASS C — a REQUIRED declaration field was verified by nothing', () => {
  /**
   * `sharedDomainReferences` names the canonical modules BOTH surfaces import.
   * It is required by the contract, and the checker's field list simply did
   * not contain it: 70 declarations were carried, counted in no total, and
   * checked by nothing. Seven did not resolve — five were BARE FILENAMES with
   * no directory, and two used an anchor notation the checker cannot even
   * express. A field that is declared but never verified reads exactly like
   * evidence and is not evidence.
   */
  const shared = (sharedDomainReferences: string[]) => ({
    capabilities: [capability({ capabilityId: 'shared-domain-case', sharedDomainReferences })],
  });
  const sharedRules = (sharedDomainReferences: string[]) =>
    verifyDeclaredFiles(repoRoot, shared(sharedDomainReferences))
      .failures.map((f: { rule: string }) => f.rule);

  it('a shared domain module that does not exist FAILS', () => {
    const declared = verifyDeclaredFiles(repoRoot, shared(['src/relay/shared/never-existed.ts']));
    expect(declared.ok, 'an unverified required field is not evidence').toBe(false);
    expect(declared.failures.map((f: { rule: string }) => f.rule)).toContain('missing-shared-domain-file');
  });

  it('a shared domain module that DOES exist passes, and is counted', () => {
    const declared = verifyDeclaredFiles(repoRoot, shared([
      'src/relay/shared/official-relay-dog-sprite.ts',
      'src/relay/mission/economics/money.ts',
    ]));
    expect(declared.failures, JSON.stringify(declared.failures)).toEqual([]);
    expect(declared.ok).toBe(true);
    // 2 shared + the capability's own website entry and both test references.
    expect(declared.checked).toBe(5);
    expect(declared.present).toBe(5);
  });

  it('a shared domain ANCHOR the file does not contain FAILS', () => {
    expect(sharedRules(['src/relay/mission/economics/money.ts#thisSymbolWasNeverDefined']))
      .toContain('missing-declared-anchor');
    // The exact pre-repair notation: ANCHOR_SEGMENT admits no ":", so
    // `#intent:pause` could never have resolved against any file.
    expect(sharedRules(['src/relay/mission/commands/command-types.ts#intent:pause']))
      .toContain('missing-declared-anchor');
    // The repaired call form resolves both segments.
    expect(sharedRules(['src/relay/mission/commands/command-types.ts#RELAY_MISSION_COMMAND_INTENTS(pause)']))
      .toEqual([]);
    expect(sharedRules(['src/relay/mission/commands/command-types.ts#RELAY_MISSION_COMMAND_INTENTS(resume)']))
      .toEqual([]);
  });

  it('a BARE filename that resolves to nothing FAILS', () => {
    // The five PSP declarations exactly as the registry carried them. They
    // classify as file claims — they were simply never checked.
    for (const bare of [
      'psp-agent-id.ts', 'psp-entitlement.ts', 'psp-import.ts', 'psp-errors.ts', 'psp-trace.ts',
    ]) {
      expect(classifyDeclaration(bare).kind, bare).toBe('file');
      expect(sharedRules([bare]), bare).toContain('missing-shared-domain-file');
    }
    // The repaired declarations resolve.
    expect(sharedRules([
      'src/relay/psp/psp-agent-id.ts', 'src/relay/psp/psp-entitlement.ts',
      'src/relay/psp/psp-import.ts', 'src/relay/psp/psp-errors.ts', 'src/relay/psp/psp-trace.ts',
    ])).toEqual([]);
  });

  it('traversal, absolute paths and NUL bytes are refused in the shared domain field too', () => {
    for (const path of [
      '../outside.ts',
      'src/relay/../../outside.ts',
      '/etc/passwd.ts',
      'src/relay/\0evil.ts',
    ]) {
      expect(sharedRules([path]), path).toContain('unsafe-declared-path');
    }
  });

  /**
   * A `relay …` notation is verified by the CLI's own command tests, never by
   * the filesystem — so it is only legitimate where the evidence genuinely IS
   * a command. Allowing it in a FILE field is a way to declare something no
   * check will ever look for.
   */
  it('a COMMAND notation is refused everywhere it is not legitimate', () => {
    expect(sharedRules(['relay mission budget'])).toContain('command-notation-not-permitted');

    const fileFields = ['websiteEntryPoints', 'websiteTestReferences', 'sharedDomainReferences'] as const;
    for (const field of fileFields) {
      const declared = verifyDeclaredFiles(repoRoot, {
        capabilities: [capability({ capabilityId: `cmd-in-${field}`, [field]: ['relay project status'] })],
      });
      expect(declared.failures.map((f: { rule: string }) => f.rule), field)
        .toContain('command-notation-not-permitted');
    }

    // The two CLI fields still accept commands — that is where they belong.
    for (const field of ['cliEntryPoints', 'cliTestReferences'] as const) {
      const declared = verifyDeclaredFiles(repoRoot, {
        capabilities: [capability({
          capabilityId: `cmd-in-${field}`,
          // Both CLI fields start as file claims, so the command counted below
          // is exactly the one under test.
          cliEntryPoints: ['src/relay/cli/main.ts'],
          cliTestReferences: ['src/relay/cli/cli.test.ts'],
          [field]: ['relay project status'],
        })],
      });
      expect(declared.failures, field).toEqual([]);
      expect(declared.commands, field).toBe(1);
    }
  });
});

/* ------------------------------------------------------------- anchors */

describe('anchors must name something the file genuinely contains', () => {
  it('splits every anchor form into the segments it must prove', () => {
    expect(anchorSegments('DRAFT_FIELDS')).toEqual(['DRAFT_FIELDS']);
    expect(anchorSegments('DRAFT_FIELDS(architect,codingAgent,reviewer)')).toEqual([
      'DRAFT_FIELDS', 'architect', 'codingAgent', 'reviewer',
    ]);
    expect(anchorSegments('pause -> pause-run')).toEqual(['pause', 'pause-run']);
    expect(anchorSegments('VIEW RECEIPTS')).toEqual(['VIEW RECEIPTS']);
  });

  it('an invented symbol fails', () => {
    const content = 'export const realSymbol = 1;\n';
    expect(verifyAnchor(content, 'realSymbol').ok).toBe(true);
    expect(verifyAnchor(content, 'inventedSymbol').ok).toBe(false);
  });

  it('EVERY segment must resolve — an anchor cannot smuggle an unverified half', () => {
    const content = 'export const pause = 1;\n';
    expect(verifyAnchor(content, 'pause -> pause-run').ok).toBe(false);
    expect(verifyAnchor(`${content}// pause-run\n`, 'pause -> pause-run').ok).toBe(true);
  });

  it('an anchor that is not a symbol or literal is refused', () => {
    for (const anchor of ['', '  ', '$$$', '1abc', '<script>']) {
      expect(verifyAnchor('anything', anchor).ok, anchor).toBe(false);
    }
    expect(ANCHOR_SEGMENT.test('DRAFT_FIELDS')).toBe(true);
  });

  it('the REAL registry resolves every anchor it declares', () => {
    const result = runParityCheck({ repoRoot, strict: true, now: NOW });
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

/* ---------------------------------------------- duplicated evidence */

describe('duplicated evidence cannot satisfy parity', () => {
  it('the same reference declared twice in one list fails', () => {
    const result = check([
      capability({
        capabilityId: 'twice',
        websiteTestReferences: ['src/relay/ui/app/live-mission.test.ts', 'src/relay/ui/app/live-mission.test.ts'],
      }),
    ]);
    expect(rules(result)).toContain('duplicate-declaration');
  });

  it('one file cannot be BOTH the website and the CLI entry point', () => {
    const result = check([
      capability({
        capabilityId: 'one-file-two-surfaces',
        websiteEntryPoints: ['src/relay/shared/index.ts'],
        cliEntryPoints: ['src/relay/shared/index.ts'],
      }),
    ]);
    expect(rules(result)).toContain('shared-entry-point');
  });

  it('a surface with no evidence of its own fails, even though both lists are non-empty', () => {
    const shared = 'src/relay/mission/economics/economics-scenarios.test.ts';
    const result = check([
      capability({
        capabilityId: 'shared-only',
        websiteTestReferences: [shared],
        cliTestReferences: [shared],
      }),
    ]);
    expect(rules(result)).toEqual(
      expect.arrayContaining(['no-distinct-website-evidence', 'no-distinct-cli-evidence']),
    );
  });

  it('a SHARED domain test alongside surface-specific evidence is still fine', () => {
    const shared = 'src/relay/mission/economics/economics-scenarios.test.ts';
    const result = check([
      capability({
        capabilityId: 'shared-plus-own',
        websiteTestReferences: [shared, 'src/relay/ui/app/live-mission.test.ts'],
        cliTestReferences: [shared, 'src/relay/cli/cli.test.ts'],
      }),
    ]);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
  });
});

/* -------------------------------------------------- strict-mode floor */

describe('strict mode refuses a registry that verifies nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-parity-empty-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('"0/0 present" is not a pass in CI', () => {
    mkdirSync(join(root, 'src', 'relay', 'parity'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'relay', 'parity', 'relay-surface-capabilities.json'),
      JSON.stringify({
        manifestVersion: '1.0.0',
        description: 'command-only registry',
        capabilities: ['relay-dog-identity', 'relay-dog-state-semantics', 'psp-agent-id-import'].map((id) => ({
          capabilityId: id,
          name: id,
          domain: 'settings',
          parityClass: 'functional_required',
          websiteStatus: 'implemented',
          cliStatus: 'implemented',
          websiteEntryPoints: ['relay web'],
          cliEntryPoints: ['relay cli'],
          websiteTestReferences: [],
          cliTestReferences: [],
          sharedDomainReferences: [],
        })),
      }),
    );
    const strict = runParityCheck({ repoRoot: root, strict: true, now: NOW });
    expect(rules(strict)).toContain('no-file-evidence');
    expect(strict.ok).toBe(false);

    const local = runParityCheck({ repoRoot: root, strict: false, now: NOW });
    expect(local.lines.join('\n')).toContain('declares no verifiable file evidence');
  });
});
