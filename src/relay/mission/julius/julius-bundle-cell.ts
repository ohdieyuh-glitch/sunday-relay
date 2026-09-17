/**
 * READING A CELL OUT OF AN EXPORTED EVIDENCE BUNDLE — PURE.
 *
 * THE PROBLEM THIS EXISTS FOR. Every paid run's evidence leaves the database as
 * tab-separated text, written by an exporter that is NOT in this workspace. A
 * reader of `worker-diagnostics.tsv` has to decide what an empty field between
 * two tabs tells it, and the whole product rests on that decision — UNKNOWN IS
 * NOT ZERO, and it is not the empty string either.
 *
 * THE FORMAT IS SPECIFIED FOR YOU and the MEANING OF AN EMPTY TEXT FIELD IS
 * NOT, and the asymmetry is deliberate. Unquoted, tab-separated, no escape
 * processing: that is the format, and this module may rely on it. Whether an
 * empty TEXT field can be told apart from a NULL depends on how the exporter
 * renders one, which is a property of the exporter and of nothing in this file.
 * Do not assume an answer here.
 *
 * For a NUMERIC column the question does not arise: a number is never the empty
 * string, so blank is unambiguously absent. For a TEXT column it does, and
 * pretending otherwise is how a bundle gets scored as complete.
 *
 * WHAT THIS MODULE IS FOR. One vocabulary for what a cell actually tells you,
 * so a gate can refuse to score a run on a cell that cannot be read rather
 * than quietly treating it as absent. It is pure: no Node, no clock, no
 * filesystem. It parses text and returns a verdict.
 *
 * EVERY FUNCTION BELOW THROWS. This module is the deliverable of a bounded
 * Julius mission; its specification is `julius-bundle-cell.test.ts`, which is
 * written and currently fails.
 */

/** What a single cell of an exported bundle is willing to say about itself. */
export const JULIUS_BUNDLE_CELL_KINDS = ['VALUE', 'UNKNOWN', 'AMBIGUOUS', 'UNREADABLE'] as const;
export type JuliusBundleCellKind = (typeof JULIUS_BUNDLE_CELL_KINDS)[number];

export const JULIUS_BUNDLE_CELL_VERSION = 'julius-bundle-cell.v1' as const;

/**
 * A cell, read.
 *
 * `AMBIGUOUS` is the one that earns this module. It means the text on the wire
 * is compatible with more than one fact and the reader may not choose between
 * them — not that the reader failed. `UNREADABLE` is different: the text is
 * present and is not a member of what the column may contain.
 */
export type JuliusBundleCell =
  | { readonly kind: 'VALUE'; readonly text: string }
  | { readonly kind: 'UNKNOWN' }
  | { readonly kind: 'AMBIGUOUS'; readonly candidates: readonly string[] }
  | { readonly kind: 'UNREADABLE'; readonly reason: string };

/**
 * A numeric cell. Blank is UNKNOWN — a number is never the empty string, so
 * there is nothing for it to be confused with.
 */
export function readNumericCell(raw: string): JuliusBundleCell {
  void raw;
  throw new Error('bundle_cell_not_implemented');
}

/**
 * A cell from a CLOSED vocabulary. A token outside the set is UNREADABLE and
 * names itself; it is never coerced to the nearest member and never treated as
 * absent.
 */
export function readTokenCell(raw: string, vocabulary: readonly string[]): JuliusBundleCell {
  void raw; void vocabulary;
  throw new Error('bundle_cell_not_implemented');
}

/** A boolean cell, as PostgreSQL renders one. Blank is UNKNOWN. */
export function readBooleanCell(raw: string): JuliusBundleCell {
  void raw;
  throw new Error('bundle_cell_not_implemented');
}

/**
 * A FREE-TEXT cell — the one the producer cannot disambiguate.
 *
 * WHAT BLANK MEANS HERE IS NOT A MATTER OF TASTE, and it is not decidable from
 * inside this file: it depends on what the exporter actually writes for a SQL
 * NULL. Establish that from the producer before choosing, and record in the
 * implementation where the answer came from.
 */
export function readTextCell(raw: string): JuliusBundleCell {
  void raw;
  throw new Error('bundle_cell_not_implemented');
}

/** One column of a bundle row, and what kind of cell it holds. */
export interface JuliusBundleColumn {
  readonly name: string;
  readonly kind: 'numeric' | 'token' | 'boolean' | 'text';
  /** Required for a `token` column, refused on any other. */
  readonly vocabulary?: readonly string[];
}

export interface JuliusBundleRowReading {
  readonly version: typeof JULIUS_BUNDLE_CELL_VERSION;
  readonly cells: Readonly<Record<string, JuliusBundleCell>>;
  /** Column names whose cells could not be read at all. */
  readonly unreadable: readonly string[];
  /** Column names whose cells are compatible with more than one fact. */
  readonly ambiguous: readonly string[];
  /**
   * Whether a reader may SCORE this row.
   *
   * False when any column it was asked for is ambiguous or unreadable. A gate
   * that scored an ambiguous row would be publishing a number it cannot
   * defend, which is the failure this whole module is against.
   */
  readonly scorable: boolean;
}

/**
 * Read one row against its declared columns.
 *
 * A column declared and absent from the row is UNKNOWN, not an error: a bundle
 * written before a fact was instrumented genuinely does not carry it, and
 * refusing the whole row would make an older bundle unreadable rather than
 * partially readable.
 */
export function readBundleRow(
  row: Readonly<Record<string, string>>,
  columns: readonly JuliusBundleColumn[],
): JuliusBundleRowReading {
  void row; void columns;
  throw new Error('bundle_cell_not_implemented');
}

/**
 * Parse one TSV file into rows, by its own header line.
 *
 * TAB-SEPARATED AND NOTHING ELSE. No quoting, no escape processing: the
 * producer quotes nothing, so a reader that invented quoting rules would be
 * parsing a format nobody writes.
 *
 * A row whose field count does not match the header is UNREADABLE as a row and
 * is reported rather than padded or truncated — a short row silently padded is
 * how a missing column becomes a plausible value.
 */
export function parseBundleTsv(content: string): {
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
  readonly malformed: readonly { readonly line: number; readonly fields: number }[];
} {
  void content;
  throw new Error('bundle_cell_not_implemented');
}
