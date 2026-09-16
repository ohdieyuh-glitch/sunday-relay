import { describe, expect, it } from 'vitest';

import { JULIUS_ARCHIVE_SECTIONS, juliusArchiveContractDigest } from './julius-brain-archive-import';
import {
  checkJuliusArchiveExportCompatibility,
  JULIUS_ARCHIVE_COMPATIBILITY_FORMAT,
  juliusArchiveDeclarationDigest,
  juliusArchiveImporterDeclaration,
  type JuliusArchiveExporterDeclaration,
} from './julius-brain-export-compatibility';

/**
 * THE HANDSHAKE BEFORE ANY HISTORY MOVES. It settles what the document is, not
 * whether one document is valid — the conformance kit does that, afterwards.
 */

const exporter = (patch: Partial<JuliusArchiveExporterDeclaration> = {}): JuliusArchiveExporterDeclaration => ({
  format: JULIUS_ARCHIVE_COMPATIBILITY_FORMAT,
  exportFormat: 'julius-paid-run-archive-export.v1',
  producer: { name: 'julius-paid-run-archive', version: '1.0.0' },
  contractDigest: juliusArchiveContractDigest(),
  minimumImporterVersion: 'julius-brain-archive-import.v2',
  sections: [...JULIUS_ARCHIVE_SECTIONS],
  capabilities: ['explicit-nulls', 'sealed-integrity', 'artifact-bytes'],
  archiveShapes: ['research.tsv 17/21/34', 'worker-diagnostics.tsv 86/87/90', 'participation.tsv 23/28'],
  declaredAt: '2026-09-15T12:00:00.000Z',
  ...patch,
});

describe('the archive export freeze handshake', () => {
  it('an exporter that fills every section and carries both required capabilities is accepted', () => {
    const report = checkJuliusArchiveExportCompatibility(exporter());
    expect(report).toMatchObject({ verdict: 'ACCEPTED', reasons: [], unfilledSections: [], contractDigestMatches: true });
    expect(report.importer).toMatchObject({ exportFormat: 'julius-paid-run-archive-export.v1', importerVersion: 'julius-brain-archive-import.v2', requiredCapabilities: ['explicit-nulls', 'sealed-integrity'] });
    // The declaration is addressable, so an import can record which handshake it was made under.
    expect(juliusArchiveDeclarationDigest(exporter())).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(juliusArchiveDeclarationDigest(exporter())).not.toBe(juliusArchiveDeclarationDigest(exporter({ producer: { name: 'julius-paid-run-archive', version: '1.0.1' } })));
  });

  it('an exporter that cannot fill a section is accepted with the gap named: those facts arrive Unknown', () => {
    const report = checkJuliusArchiveExportCompatibility(exporter({ sections: JULIUS_ARCHIVE_SECTIONS.filter((section) => section !== 'repairs' && section !== 'toolInvocations') }));
    expect(report).toMatchObject({ verdict: 'ACCEPTED_WITH_GAPS', unfilledSections: ['repairs', 'toolInvocations'], contractDigestMatches: true });
    expect(report.reasons[0]).toBe('sections not filled by this exporter: repairs, toolInvocations — their facts arrive Unknown, and stay Unknown');
  });

  it('refuses another format, another export version, a missing capability, an unknown section or an importer it outranks', () => {
    const reasonOf = (patch: Partial<JuliusArchiveExporterDeclaration>) => checkJuliusArchiveExportCompatibility(exporter(patch)).reasons.join(' | ');
    expect(checkJuliusArchiveExportCompatibility(exporter({ exportFormat: 'julius-paid-run-archive.v1' }))).toMatchObject({ verdict: 'REFUSED' });
    expect(reasonOf({ exportFormat: 'julius-paid-run-archive.v1' })).toContain('this importer reads julius-paid-run-archive-export.v1');
    expect(reasonOf({ exportFormat: 'julius-paid-run-archive-export.v2' })).toContain('the exporter emits julius-paid-run-archive-export.v2');
    expect(reasonOf({ capabilities: ['sealed-integrity'] })).toContain('explicit-nulls is required');
    expect(reasonOf({ capabilities: ['explicit-nulls'] })).toContain('sealed-integrity is required');
    expect(reasonOf({ sections: [...JULIUS_ARCHIVE_SECTIONS, 'invoices'] })).toContain('invoices is not a section of');
    expect(reasonOf({ minimumImporterVersion: 'julius-brain-archive-import.v9' })).toContain('the exporter expects julius-brain-archive-import.v9');
    expect(reasonOf({ producer: { name: '', version: '1.0.0' } })).toContain('producer.name');
    expect(reasonOf({ declaredAt: 'yesterday' })).toContain('declaredAt');
    expect(checkJuliusArchiveExportCompatibility('not a declaration')).toMatchObject({ verdict: 'REFUSED', reasons: ['declaration: an object'] });
  });

  it('one format version, two sets of field rules: the digests differ, and that is said before anything is imported', () => {
    const drifted = checkJuliusArchiveExportCompatibility(exporter({ contractDigest: `sha256:${'0'.repeat(64)}` }));
    expect(drifted.verdict).toBe('REFUSED');
    expect(drifted.contractDigestMatches).toBe(false);
    expect(drifted.reasons[0]).toContain('compare the field rules before importing');
    // The importer's own digest is stable for a given contract, and is what the exporter is asked to match.
    expect(juliusArchiveImporterDeclaration().contractDigest).toBe(juliusArchiveContractDigest());
    expect(juliusArchiveContractDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
