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
  readonly category: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly shape: string;
  readonly kind: string;
  readonly file: string;
  readonly reference: string;
}

/** The founder's mission classes, plus failure/recovery. Closed on purpose. */
const CATEGORIES = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * A TYPE GUARD, NOT A CAST.
 *
 * `CATEGORIES.includes(x as Row['category'])` checks the value and narrows
 * nothing, so the `category` pushed below stayed a `string` and
 * `tsc -p scripts/tsconfig.json` refused it — while vitest, which does not
 * typecheck, ran the file happily. That is the whole reason this is a guard: the
 * cast asked the compiler to look away at exactly the point where the closed set
 * is supposed to be enforced.
 */
const isCategory = (value: string): value is Row['category'] =>
  (CATEGORIES as readonly string[]).includes(value);

function rowsOf(markdown: string): readonly Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const [id, shape, kind, file, reference] = cells as [string, string, string, string, string];
    if (id === '#' || id.startsWith('---')) continue;
    /**
     * THE CATEGORY LETTERS, AND WHY THIS LIST IS CHECKED RATHER THAN OPEN.
     *
     * A row whose letter this parser does not know is SKIPPED — silently, which
     * is how two Category E rows came to sit in the page unchecked the moment
     * they were added. So the letters are a closed set, the count of categories
     * is asserted below, and a new category must be added HERE before its rows
     * mean anything.
     */
    const category = id.charAt(0);
    if (!isCategory(category)) continue;
    rows.push({
      id, category, shape,
      kind: kind.replace(/\*/gu, ''),
      file: file.replace(/`/gu, ''),
      reference: reference.replace(/`/gu, ''),
    });
  }
  return rows;
}

/**
 * Every leading letter the page's own table rows use, whatever the parser makes
 * of them — the raw truth the parser is then held against.
 */
function* markdownLetters(markdown: string): Generator<string> {
  for (const line of markdown.split(/\r?\n/u)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const id = cells[0]!;
    if (id === '#' || id.startsWith('---')) continue;
    if (/^[A-Z]\d/u.test(id)) yield id.charAt(0);
  }
}

const ledger = readFileSync(join(REPO, LEDGER), 'utf8');
const rows = rowsOf(ledger);

describe('the MVP qualification ledger', () => {
  it('parses, and covers every category, including the ones added after this page was written', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    // EVERY LETTER THE PAGE USES IS A LETTER THIS PARSER KNOWS. Without this,
    // adding a category to the page adds rows nothing resolves — which happened
    // with E, and is the reason the list is closed and checked.
    const lettersInPage = [...new Set([...markdownLetters(ledger)])].sort();
    expect(lettersInPage, 'a row letter the parser does not know is a row nobody checks').toEqual([...CATEGORIES]);
    for (const category of CATEGORIES) {
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
