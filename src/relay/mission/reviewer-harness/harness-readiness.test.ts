import { describe, expect, it } from 'vitest';
import {
  HARNESS_READINESS_LABEL, NO_RUNTIME_EVIDENCE, REVIEWER_HARNESS_CATALOG,
  assessHarnessReadiness, effectiveCatalogEntry, findCatalogEntry,
  harnessIsSelectableForRun, projectHarnessCatalog,
  type HarnessRuntimeEvidence,
} from './index';

/**
 * THE READINESS LADDER — the one place a static product definition meets a
 * server-side fact. These tests exist because the two obvious mistakes are
 * cheap: letting a browser conclude something it cannot know, and letting one
 * satisfied requirement stand in for another.
 */

const hermes = () => {
  const e = findCatalogEntry('hermes');
  if (e === null) throw new Error('the canonical Hermes entry is missing');
  return e;
};

const evidence = (o: Partial<HarnessRuntimeEvidence> = {}): HarnessRuntimeEvidence => ({
  ...NO_RUNTIME_EVIDENCE,
  bridgeAvailable: true,
  installed: true,
  binaryPath: '/usr/local/bin/harness',
  version: '0.18.2',
  compatible: true,
  machineInterface: 'oneshot_json',
  machineInterfaceVerified: true,
  credentialPresent: true,
  modelVerified: true,
  requestedModel: 'grok-4.5',
  verifiedModelId: 'grok-4.5',
  readOnlyEnforceable: true,
  checkedAt: '2026-08-01T12:00:00.000Z',
  failureReason: null,
  ...o,
});

describe('a browser can never conclude a harness is ready', () => {
  it('reports Backend unavailable with no server-side evidence', () => {
    const r = assessHarnessReadiness(hermes(), null);
    expect(r.state).toBe('bridge_unavailable');
    expect(r.label).toBe('Backend unavailable');
    expect(r.startable).toBe(false);
  });

  it('says Adapter unavailable for a harness Relay does not implement', () => {
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      if (entry.catalogId === 'hermes') continue;
      const r = assessHarnessReadiness(entry, evidence());
      // Even with a perfect probe, no adapter means no run.
      expect(r.label, entry.catalogId).toBe('Adapter unavailable');
      expect(r.startable, entry.catalogId).toBe(false);
    }
  });

  it('the default catalog projection is the truthful browser one', () => {
    const view = projectHarnessCatalog();
    const row = view.entries.find((e) => e.catalogId === 'hermes');
    expect(row?.readinessState).toBe('bridge_unavailable');
    expect(row?.readinessLabel).toBe('Backend unavailable');
    expect(row?.startable).toBe(false);
    expect(view.startableCount).toBe(0);
  });
});

describe('each requirement is separate and none implies another', () => {
  const cases: ReadonlyArray<[string, Partial<HarnessRuntimeEvidence>, string]> = [
    ['a missing runtime', { installed: false }, 'not_installed'],
    ['an old version', { compatible: false }, 'incompatible'],
    ['an unverified interface', { machineInterfaceVerified: false }, 'interface_unverified'],
    ['unenforceable read-only', { readOnlyEnforceable: false }, 'interface_unverified'],
    ['no credential', { credentialPresent: false }, 'credentials_missing'],
    ['an unverified model', { modelVerified: false }, 'model_unverified'],
  ];

  for (const [label, patch, expected] of cases) {
    it(`${label} blocks with state ${expected}`, () => {
      const r = assessHarnessReadiness(hermes(), evidence(patch));
      expect(r.state).toBe(expected);
      expect(r.label).toBe(HARNESS_READINESS_LABEL[expected as keyof typeof HARNESS_READINESS_LABEL]);
      expect(r.startable).toBe(false);
      expect(r.missing.length).toBeGreaterThan(0);
    });
  }

  it('an installed binary is not a credential, and a credential is not a model', () => {
    const installedOnly = assessHarnessReadiness(hermes(), evidence({
      credentialPresent: false, modelVerified: false,
    }));
    expect(installedOnly.state).toBe('credentials_missing');
    const credentialOnly = assessHarnessReadiness(hermes(), evidence({ modelVerified: false }));
    expect(credentialOnly.state).toBe('model_unverified');
  });

  it('reaches ready only when everything is proven, and says authorization is still required', () => {
    const r = assessHarnessReadiness(hermes(), evidence());
    expect(r.state).toBe('ready');
    expect(r.startable).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.reason).toContain('explicit authorization');
  });
});

describe('a probe can never promote a harness', () => {
  it('changes only installation and read-only support', () => {
    const base = hermes();
    const effective = effectiveCatalogEntry(base, evidence());
    expect(effective.installState).toBe('installed');
    expect(effective.readOnlyReviewSupported).toBe('yes');
    expect(effective.name).toBe(base.name);
    expect(effective.integrationStatus).toBe(base.integrationStatus);
    expect(effective.capabilities).toEqual(base.capabilities);
    expect(effective.description).toBe(base.description);
  });

  it('cannot make a coming-soon harness startable by installing it', () => {
    const vellum = findCatalogEntry('vellum');
    const effective = effectiveCatalogEntry(vellum!, evidence());
    // No adapter, so the entry is returned untouched and the rule still says no.
    expect(effective.installState).toBe('not_installed');
    expect(harnessIsSelectableForRun(effective)).toBe(false);
  });

  it('an incompatible runtime is not "installed" for startability purposes', () => {
    const effective = effectiveCatalogEntry(hermes(), evidence({ compatible: false }));
    expect(effective.installState).toBe('not_installed');
    expect(harnessIsSelectableForRun(effective)).toBe(false);
  });
});

describe('the projection carries runtime evidence to both surfaces', () => {
  it('renders a ready harness only when a bridge proved it', () => {
    const view = projectHarnessCatalog(null, { hermes: evidence() });
    const row = view.entries.find((e) => e.catalogId === 'hermes');
    expect(row?.readinessState).toBe('ready');
    expect(row?.startable).toBe(true);
    expect(row?.installLabel).toBe('Installed');
    expect(view.startableCount).toBe(1);
    // The other six are untouched by evidence about a different harness.
    expect(view.entries.filter((e) => e.startable)).toHaveLength(1);
  });

  it('carries the blocking reason onto the row', () => {
    const view = projectHarnessCatalog(null, {
      hermes: evidence({ credentialPresent: false, modelVerified: false }),
    });
    const row = view.entries.find((e) => e.catalogId === 'hermes');
    expect(row?.readinessLabel).toBe('Credentials required on Relay Bridge');
    expect(row?.startable).toBe(false);
    expect(row?.unavailableReasons.join(' ')).toContain('credential');
  });

  it('never lets evidence alone create a connected identity', () => {
    const view = projectHarnessCatalog(null, { hermes: evidence() });
    // A ready harness has still not run: actual identity stays Unknown.
    expect(view.identityRows.find((r) => r.key === 'actual_harness')?.value).toBe('Unknown');
    expect(view.identityRows.find((r) => r.key === 'actual_model')?.value).toBe('Unknown');
    expect(view.statusLabel).toBe('Reviewer harness not connected');
  });
});
