import { paidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-fixtures';
import {
  checkJuliusPaidRunArchiveConformance,
  runJuliusArchiveConformanceCases,
  type JuliusArchiveConformanceCaseResult,
  type JuliusArchiveConformanceReport,
} from '../src/relay/mission/julius/julius-brain-archive-conformance';
import type { JuliusPaidRunArchiveExport } from '../src/relay/mission/julius/julius-brain-archive-import';
import { checkJuliusArchiveExportCompatibility, juliusArchiveImporterDeclaration } from '../src/relay/mission/julius/julius-brain-export-compatibility';

/**
 * THE EXPORT CONFORMANCE CHECK, FOR WHOEVER PRODUCES EXPORTS.
 *
 *   node dist-relay-bridge/julius-archive-export-conformance.cjs <export.json> [--artifact <artifactId>=<file>]... [--cases]
 *   node dist-relay-bridge/julius-archive-export-conformance.cjs --self-test
 *   node dist-relay-bridge/julius-archive-export-conformance.cjs --declare
 *   node dist-relay-bridge/julius-archive-export-conformance.cjs --compat <declaration.json>
 *
 * Reads files only: no database, no network, no Brain. Prints one JSON report.
 *   exit 0  CONFORMANT (and, with --cases, every applicable case passed)
 *   exit 1  not conformant, or a case failed
 *   exit 2  usage, or a file could not be read or parsed
 *
 * --cases applies every catalogued corruption to the export and checks each is
 * refused: proof that the checks bite on this exporter's real output, not only
 * on Project Brain's fixture. --self-test does the same on the built-in fixture.
 */

export interface ConformanceCliIo {
  readonly readText: (path: string) => string;
  readonly readBytes: (path: string) => Uint8Array;
  readonly write: (text: string) => void;
}

const USAGE = 'usage: julius-archive-export-conformance <export.json> [--artifact <artifactId>=<file>]... [--cases] | --self-test | --declare | --compat <declaration.json>';

export function runArchiveExportConformance(argv: readonly string[], io: ConformanceCliIo): number {
  const fail = (reason: string) => { io.write(`${JSON.stringify({ error: reason, usage: USAGE }, null, 2)}\n`); return 2; };
  let exportPath: string | null = null;
  let withCases = false;
  let selfTest = false;
  let declare = false;
  let compatPath: string | null = null;
  const artifacts = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--cases') withCases = true;
    else if (arg === '--self-test') selfTest = true;
    else if (arg === '--declare') declare = true;
    else if (arg === '--compat') {
      const path = argv[i += 1];
      if (path === undefined) return fail('--compat takes a declaration file');
      compatPath = path;
    }
    else if (arg === '--artifact') {
      const spec = argv[i += 1];
      const split = spec?.indexOf('=') ?? -1;
      if (spec === undefined || split < 1 || split === spec.length - 1) return fail('--artifact takes <artifactId>=<file>');
      artifacts.set(spec.slice(0, split), spec.slice(split + 1));
    } else if (arg.startsWith('--')) return fail(`unknown option ${arg.slice(0, 40)}`);
    else if (exportPath === null) exportPath = arg;
    else return fail('one export at a time');
  }
  // What this importer enforces, for the Formal lane to compare its exporter against.
  if (declare) {
    if (exportPath !== null || compatPath !== null || selfTest) return fail('--declare takes nothing else');
    io.write(`${JSON.stringify(juliusArchiveImporterDeclaration(), null, 2)}\n`);
    return 0;
  }
  // The handshake: an exporter's declaration against this importer's.
  if (compatPath !== null) {
    if (exportPath !== null || selfTest) return fail('--compat takes nothing else');
    let declaration: unknown;
    try { declaration = JSON.parse(io.readText(compatPath)); } catch (error) { return fail(`cannot read ${compatPath}: ${error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'unknown'}`); }
    const report = checkJuliusArchiveExportCompatibility(declaration);
    io.write(`${JSON.stringify({ subject: compatPath, ...report }, null, 2)}\n`);
    return report.verdict === 'REFUSED' ? 1 : 0;
  }
  if (selfTest === (exportPath !== null)) return fail(selfTest ? '--self-test takes no export' : 'an export file is required');

  let document: unknown;
  if (selfTest) document = paidRunArchive();
  else {
    try { document = JSON.parse(io.readText(exportPath!)); } catch (error) { return fail(`cannot read ${exportPath}: ${error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'unknown'}`); }
  }
  const bytes = new Map<string, Uint8Array>();
  for (const [artifactId, path] of artifacts) {
    try { bytes.set(artifactId, io.readBytes(path)); } catch { return fail(`cannot read the bytes for artifact ${artifactId.slice(0, 80)}`); }
  }
  const report: JuliusArchiveConformanceReport = checkJuliusPaidRunArchiveConformance(document, artifacts.size > 0 ? { artifactBytes: (id) => bytes.get(id) ?? null } : {});
  let cases: readonly JuliusArchiveConformanceCaseResult[] | null = null;
  if ((withCases || selfTest) && report.verdict === 'CONFORMANT') cases = runJuliusArchiveConformanceCases(document as JuliusPaidRunArchiveExport);
  const counts = cases === null ? null : {
    pass: cases.filter((c) => c.result === 'PASS').length, fail: cases.filter((c) => c.result === 'FAIL').length, notApplicable: cases.filter((c) => c.result === 'NOT_APPLICABLE').length,
  };
  io.write(`${JSON.stringify({ subject: selfTest ? 'built-in fixture (shaped after paid run 34739303313)' : exportPath, ...report, cases: cases === null ? (withCases ? 'NOT RUN: the export does not conform' : null) : { counts, results: cases } }, null, 2)}\n`);
  return report.verdict === 'CONFORMANT' && (counts === null || counts.fail === 0) ? 0 : 1;
}
