import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE MVP QUALIFICATION LEDGER, HELD TO ITS OWN RULE.
 *
 * `docs/JULIUS_MVP_QUALIFICATION.md` answers the founder's question — can
 * Julius reliably accomplish useful human objectives — by category, and names a
 * file and a case for every claim. A claim in prose is the cheapest thing in a
 * repository to write and the easiest to leave standing after the case it names
 * is renamed; so the page is parsed rather than read, and every reference must
 * resolve. It does NOT check that the case passes — `npm test` does, and two
 * authorities on one fact is what this repository argues against.
 */

const REPO = join(import.meta.dirname, '..');
const LEDGER = 'docs/JULIUS_MVP_QUALIFICATION.md';

interface Row {
  readonly id: string;
  readonly category: 'A' | 'B' | 'C' | 'D';
  readonly shape: string;
  readonly kind: string;
  readonly file: string;
  readonly reference: string;
}

function rowsOf(markdown: string): readonly Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const [id, shape, kind, file, reference] = cells as [string, string, string, string, string];
    if (id === '#' || id.startsWith('---')) continue;
    const category = id.charAt(0);
    if (category !== 'A' && category !== 'B' && category !== 'C' && category !== 'D') continue;
    rows.push({
      id, category, shape,
      kind: kind.replace(/\*/gu, ''),
      file: file.replace(/`/gu, ''),
      reference: reference.replace(/`/gu, ''),
    });
  }
  return rows;
}

const ledger = readFileSync(join(REPO, LEDGER), 'utf8');
const rows = rowsOf(ledger);

describe('the MVP qualification ledger', () => {
  it('parses, and covers all four categories the founder named', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const category of ['A', 'B', 'C', 'D'] as const) {
      expect(rows.filter((row) => row.category === category).length,
        `category ${category} needs more than one representative mission`).toBeGreaterThan(1);
    }
    for (const row of rows) expect(['DETERMINISTIC', 'LIVE'], `${row.id}: kind`).toContain(row.kind);
  });

  it.each(rows.map((row) => [row.id, row] as const))('%s: its file exists', (_id, row) => {
    expect(existsSync(join(REPO, row.file)), `${row.file} is not in this repository`).toBe(true);
  });

  it.each(rows.filter((row) => row.reference !== '*(bundle, not a case)*')
    .map((row) => [row.id, row] as const))('%s: its case reference resolves in that file', (_id, row) => {
    const source = readFileSync(join(REPO, row.file), 'utf8');
    expect(source.includes(row.reference),
      `${row.file} does not contain "${row.reference}" — renamed or removed`).toBe(true);
  });

  it('holds exactly one LIVE row, from the one paid run that exists', () => {
    const live = rows.filter((row) => row.kind === 'LIVE');
    expect(live).toHaveLength(1);
    expect(live[0]!.file).toBe('docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md');
  });

  it('names what is not qualified in every category', () => {
    // The gaps are the half of a qualification page that is load-bearing.
    for (const gap of ['unfamiliar repository', 'tool-HEAVY', 'real Unreal change',
      'result is not a file', 'CONTENT refusal', 'LIVE']) {
      expect(ledger, `the ledger must still name the "${gap}" gap`).toContain(gap);
    }
  });
});
