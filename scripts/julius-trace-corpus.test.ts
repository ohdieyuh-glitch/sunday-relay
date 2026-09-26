import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE TRACE CORPUS LEDGER, HELD TO THE RULE IT DOCUMENTS.
 *
 * `docs/JULIUS_TRACE_CORPUS.md` claims coverage of twelve mission shapes and
 * names, for each, a file and a case. A coverage claim in prose is the cheapest
 * thing in a repository to write and the easiest to leave standing after the case
 * it names is renamed or deleted — at which point the page says Julius is covered
 * for a shape nothing exercises.
 *
 * So the page is parsed rather than read. Every file must exist and every case
 * reference must appear in it. That is the same rule Julius PR 9 put on mission
 * evidence — a reference that cannot be resolved is not a reference — applied to
 * the document that makes the claim.
 *
 * IT DOES NOT CHECK THAT THE CASE PASSES. `npm test` does that; duplicating it
 * here would be a second authority on the same fact. What this holds is that the
 * ledger points at something real.
 */

const REPO = join(import.meta.dirname, '..');
const LEDGER = 'docs/JULIUS_TRACE_CORPUS.md';

interface Row {
  readonly shape: string;
  readonly kind: string;
  readonly file: string;
  readonly reference: string;
}

/** The table rows, as the page writes them. Backticks are the page's own. */
function rowsOf(markdown: string): readonly Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const [id, shape, kind, file, reference] = cells as [string, string, string, string, string];
    // The header and its separator are the two rows that are not references.
    if (id === '#' || id.startsWith('---')) continue;
    rows.push({
      shape, kind: kind.replace(/\*/gu, ''),
      file: file.replace(/`/gu, ''),
      reference: reference.replace(/`/gu, ''),
    });
  }
  return rows;
}

const ledger = readFileSync(join(REPO, LEDGER), 'utf8');
const rows = rowsOf(ledger);

describe('the trace corpus ledger', () => {
  it('parses, and finds the twelve shapes the beta brief names', () => {
    // A parse that silently found nothing would make every case below vacuous —
    // the exact shape of the three vacuous MCP proofs this repository has already
    // paid for once.
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const row of rows) {
      expect(row.shape.length, 'every row names a shape').toBeGreaterThan(3);
      expect(['DETERMINISTIC', 'LIVE'], `${row.shape}: unknown kind ${row.kind}`).toContain(row.kind);
    }
  });

  it.each(rows.map((row) => [row.shape, row] as const))('%s: its file exists', (_shape, row) => {
    expect(existsSync(join(REPO, row.file)), `${row.file} is not in this repository`).toBe(true);
  });

  it.each(rows.filter((row) => row.reference !== '*(bundle, not a case)*')
    .map((row) => [row.shape, row] as const))(
    '%s: its case reference resolves in that file',
    (_shape, row) => {
      const source = readFileSync(join(REPO, row.file), 'utf8');
      expect(source.includes(row.reference),
        `${row.file} does not contain "${row.reference}" — the case was renamed or removed`).toBe(true);
    },
  );

  it('keeps exactly one LIVE row, and names the run it came from', () => {
    // The corpus must never quietly grow a second LIVE row: a live trace costs
    // money and a founder's authorisation, so one appearing without either is a
    // claim somebody typed.
    const live = rows.filter((row) => row.kind === 'LIVE');
    expect(live).toHaveLength(1);
    expect(live[0]!.file).toBe('docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md');
  });

  it('states what it does not cover', () => {
    // The gaps are the half of a coverage document that is load-bearing.
    for (const gap of ['tool-HEAVY mission', 'CONTENT refusal', 'LIVE trace of any shape',
      'paid matched pair']) {
      expect(ledger, `the ledger must still name the ${gap} gap`).toContain(gap);
    }
  });
});
