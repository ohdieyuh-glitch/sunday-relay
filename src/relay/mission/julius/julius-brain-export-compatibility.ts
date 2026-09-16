import { canonicalJuliusBrainJson, juliusBrainSha256 } from './julius-brain-contracts';
import {
  JULIUS_ARCHIVE_SECTIONS,
  JULIUS_ARCHIVE_IMPORTER_VERSION,
  JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT,
  juliusArchiveContractDigest,
  type JuliusArchiveSection,
} from './julius-brain-archive-import';

/**
 * THE FREEZE HANDSHAKE: WHAT EACH SIDE SAYS BEFORE ANY HISTORY MOVES.
 *
 * Project Brain never reads the paid-run archive's tables, so the archive's
 * internal shape may keep changing. What must be agreed is the DOCUMENT:
 *
 *   the exporter declares   the format it emits, who emits it and at what
 *                           version, the digest of the contract it was built
 *                           against, the sections it can fill, and the lowest
 *                           importer it expects to be read by
 *   the importer declares   the same format, its own version, the digest of the
 *                           contract it enforces, and the sections it requires
 *
 * `checkJuliusArchiveExportCompatibility` compares them and answers ACCEPTED,
 * ACCEPTED_WITH_GAPS (sections the exporter cannot fill: those facts will be
 * Unknown, truthfully) or REFUSED, with reasons. It is a handshake, not a
 * promise: a document still has to pass the conformance kit, and the import
 * still refuses anything that contradicts the live run.
 *
 * A CONTRACT DIGEST IS NOT A VERSION. Two sides on `…export.v1` whose digests
 * differ are reading different field rules; that is worth knowing before an
 * import, not after.
 */

export const JULIUS_ARCHIVE_COMPATIBILITY_FORMAT = 'julius-paid-run-archive-export-compatibility.v1' as const;

export interface JuliusArchiveExporterDeclaration {
  readonly format: typeof JULIUS_ARCHIVE_COMPATIBILITY_FORMAT;
  readonly exportFormat: string;
  readonly producer: { readonly name: string; readonly version: string };
  /** The digest of the contract the exporter was built against (`juliusArchiveContractDigest`). */
  readonly contractDigest: string;
  /** The importer version the exporter expects to be read by, at least. */
  readonly minimumImporterVersion: string;
  /** Sections the exporter can fill. A section it cannot fill is not a failure; its facts are Unknown. */
  readonly sections: readonly string[];
  /** What the exporter can do beyond the sections: e.g. `artifact-bytes`, `sealed-integrity`, `explicit-nulls`. */
  readonly capabilities: readonly string[];
  /** Free text: which archive shapes this exporter was built from. Never read as a contract. */
  readonly archiveShapes?: readonly string[];
  readonly declaredAt: string;
}

export interface JuliusArchiveImporterDeclaration {
  readonly format: typeof JULIUS_ARCHIVE_COMPATIBILITY_FORMAT;
  readonly exportFormat: typeof JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT;
  readonly importerVersion: string;
  readonly contractDigest: string;
  readonly requiredSections: readonly JuliusArchiveSection[];
  readonly requiredCapabilities: readonly string[];
}

/** Everything the importer enforces today, as one document the Formal lane can compare against. */
export function juliusArchiveImporterDeclaration(): JuliusArchiveImporterDeclaration {
  return {
    format: JULIUS_ARCHIVE_COMPATIBILITY_FORMAT,
    exportFormat: JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT,
    importerVersion: JULIUS_ARCHIVE_IMPORTER_VERSION,
    contractDigest: juliusArchiveContractDigest(),
    // Every section must be present as a list, even when empty: an absent section is a malformed document.
    requiredSections: [...JULIUS_ARCHIVE_SECTIONS],
    requiredCapabilities: ['explicit-nulls', 'sealed-integrity'],
  };
}

export type JuliusArchiveCompatibilityVerdict = 'ACCEPTED' | 'ACCEPTED_WITH_GAPS' | 'REFUSED';

export interface JuliusArchiveCompatibilityReport {
  readonly verdict: JuliusArchiveCompatibilityVerdict;
  readonly reasons: readonly string[];
  /** Sections the exporter does not fill: their facts arrive Unknown, which the import keeps Unknown. */
  readonly unfilledSections: readonly string[];
  readonly contractDigestMatches: boolean;
  readonly importer: JuliusArchiveImporterDeclaration;
}

const VERSION = /^[A-Za-z0-9_.:@+-]{1,64}$/;

export function checkJuliusArchiveExportCompatibility(
  declaration: unknown,
  importer: JuliusArchiveImporterDeclaration = juliusArchiveImporterDeclaration(),
): JuliusArchiveCompatibilityReport {
  const reasons: string[] = [];
  const refuse = (verdict: JuliusArchiveCompatibilityVerdict, unfilledSections: readonly string[] = [], contractDigestMatches = false): JuliusArchiveCompatibilityReport =>
    ({ verdict, reasons, unfilledSections, contractDigestMatches, importer });

  if (typeof declaration !== 'object' || declaration === null) { reasons.push('declaration: an object'); return refuse('REFUSED'); }
  const value = declaration as Record<string, unknown>;
  if (value.format !== JULIUS_ARCHIVE_COMPATIBILITY_FORMAT) reasons.push(`format: ${JULIUS_ARCHIVE_COMPATIBILITY_FORMAT}`);
  if (value.exportFormat !== importer.exportFormat) reasons.push(`exportFormat: this importer reads ${importer.exportFormat}, the exporter emits ${String(value.exportFormat).slice(0, 80)}`);
  const producer = value.producer as { name?: unknown; version?: unknown } | undefined;
  if (typeof producer?.name !== 'string' || producer.name.length === 0) reasons.push('producer.name: who emits the document');
  if (typeof producer?.version !== 'string' || !VERSION.test(producer.version)) reasons.push('producer.version: the exporter version');
  if (typeof value.declaredAt !== 'string' || Number.isNaN(Date.parse(String(value.declaredAt)))) reasons.push('declaredAt: an ISO timestamp');
  if (typeof value.minimumImporterVersion !== 'string' || !VERSION.test(value.minimumImporterVersion)) reasons.push('minimumImporterVersion: the lowest importer this exporter expects');
  else if (value.minimumImporterVersion > importer.importerVersion) reasons.push(`minimumImporterVersion: the exporter expects ${value.minimumImporterVersion}; this importer is ${importer.importerVersion}`);
  const sections = Array.isArray(value.sections) ? value.sections.map(String) : null;
  if (sections === null) reasons.push('sections: the sections the exporter can fill');
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities.map(String) : [];
  for (const capability of importer.requiredCapabilities) {
    if (!capabilities.includes(capability)) reasons.push(`capabilities: ${capability} is required — ${capability === 'explicit-nulls' ? 'a null must say whether it is Unknown or recorded absent' : 'the document must carry its own hashes'}`);
  }
  const unknownSections = (sections ?? []).filter((section) => !(importer.requiredSections as readonly string[]).includes(section));
  if (unknownSections.length > 0) reasons.push(`sections: ${unknownSections.join(', ')} ${unknownSections.length === 1 ? 'is not a section of' : 'are not sections of'} ${importer.exportFormat}`);
  const unfilled = importer.requiredSections.filter((section) => !(sections ?? []).includes(section));
  const contractDigestMatches = value.contractDigest === importer.contractDigest;
  if (typeof value.contractDigest !== 'string' || value.contractDigest.length === 0) reasons.push('contractDigest: the digest of the contract the exporter was built against');
  else if (!contractDigestMatches) {
    reasons.push(`contractDigest: the exporter was built against ${String(value.contractDigest).slice(0, 23)}…; this importer enforces ${importer.contractDigest.slice(0, 23)}… — compare the field rules before importing`);
  }

  if (reasons.length > 0) return refuse('REFUSED', unfilled, contractDigestMatches);
  if (unfilled.length > 0) {
    reasons.push(`sections not filled by this exporter: ${unfilled.join(', ')} — their facts arrive Unknown, and stay Unknown`);
    return { verdict: 'ACCEPTED_WITH_GAPS', reasons, unfilledSections: unfilled, contractDigestMatches, importer };
  }
  return { verdict: 'ACCEPTED', reasons: [], unfilledSections: [], contractDigestMatches, importer };
}

/** The digest of a declaration, for recording which handshake an import was made under. */
export const juliusArchiveDeclarationDigest = (declaration: JuliusArchiveExporterDeclaration): string => juliusBrainSha256(canonicalJuliusBrainJson(declaration));
