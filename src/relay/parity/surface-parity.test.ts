import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  compareRegistries,
  findCompanion,
  loadRegistry,
  runParityCheck,
  validateRegistry,
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

  it('every referenced test file on THIS surface actually exists (no invented evidence)', () => {
    // The registry is byte-identical in both repositories, but each repository
    // can only verify its OWN surface's paths — the companion's files are not
    // on this disk. Which surface this is, is detected from a marker directory.
    const isWebsite = existsSync(join(repoRoot, 'src', 'relay', 'ui', 'official-relay-dog'));
    let verified = 0;
    for (const record of registry.capabilities) {
      const refs = isWebsite
        ? (record.websiteStatus === 'tested' ? record.websiteTestReferences : [])
        : (record.cliStatus === 'tested' ? record.cliTestReferences : []);
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

  it('accepts a founder-approved exception with a reason and an approver', () => {
    const result = check([capability({
      capabilityId: 'approved-exempt', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: {
        reason: 'Browser viewport layout has no terminal equivalent.',
        approvedBy: 'founder',
        approvedAt: '2026-07-28T00:00:00.000Z',
      },
    })]);
    expect(result.ok).toBe(true);
  });

  it('fails an exception missing the founder identity or the reason', () => {
    expect(rules(check([capability({
      capabilityId: 'no-approver', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: { reason: 'x', approvedBy: '', approvedAt: '2026-07-01T00:00:00.000Z' },
    })]))).toContain('exception-approver');

    expect(rules(check([capability({
      capabilityId: 'no-reason', parityClass: 'surface_specific',
      cliStatus: 'not_started', cliEntryPoints: [], cliTestReferences: [],
      exception: { reason: '   ', approvedBy: 'founder', approvedAt: '2026-07-01T00:00:00.000Z' },
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
      },
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

  it('STRICT mode never passes when the companion repository is unavailable', () => {
    const result = runParityCheck({
      repoRoot,
      strict: true,
      companionPath: join(repoRoot, 'this-companion-does-not-exist'),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('companion-missing');
    expect(result.lines.join('\n')).toContain('strict mode requires it');
  });

  it('local mode says plainly that cross-repository parity was NOT verified', () => {
    const result = runParityCheck({
      repoRoot,
      strict: false,
      companionPath: join(repoRoot, 'this-companion-does-not-exist'),
      now: NOW,
    });
    expect(result.lines.join('\n')).toContain('cross-repository parity NOT verified');
  });

  it('loads this repository\'s registry and finds the companion when present', () => {
    const loaded = loadRegistry(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(REGISTRY_RELATIVE_PATH.replace(/\\/g, '/')).toBe(RELAY_PARITY_REGISTRY_PATH);
    // findCompanion returns null or a real path — never this repository itself.
    const companion = findCompanion(repoRoot);
    if (companion !== null) expect(companion).not.toBe(repoRoot);
  });
});
