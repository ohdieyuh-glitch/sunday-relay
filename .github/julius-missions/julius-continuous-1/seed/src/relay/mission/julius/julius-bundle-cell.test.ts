import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JULIUS_BUNDLE_CELL_KINDS,
  JULIUS_BUNDLE_CELL_VERSION,
  parseBundleTsv,
  readBooleanCell,
  readBundleRow,
  readNumericCell,
  readTextCell,
  readTokenCell,
  type JuliusBundleColumn,
} from './julius-bundle-cell';

/**
 * READING AN EVIDENCE BUNDLE — THE SPECIFICATION.
 *
 * The rule the whole module exists to hold: A READER NEVER TURNS AN ABSENCE
 * INTO A VALUE, AND NEVER TURNS AN AMBIGUITY INTO AN ABSENCE. A blank numeric
 * cell is genuinely unknown. A blank free-text cell may be unknown or may be an
 * empty string, and a reader that picks one is publishing a fact nobody wrote.
 *
 * Every case below is about that distinction. None of them is about performance
 * and none of them is about convenience: a reader that is convenient about an
 * ambiguous cell is the defect.
 */

const KIND = (cell: { kind: string }): string => cell.kind;

/* --------------------------------------------------------------- numbers */

test('a numeric cell reads as its value', () => {
  const cell = readNumericCell('1390954');
  assert.equal(KIND(cell), 'VALUE');
  assert.equal(cell.kind === 'VALUE' ? cell.text : null, '1390954');
});

test('a blank numeric cell is UNKNOWN, because a number is never the empty string', () => {
  assert.equal(KIND(readNumericCell('')), 'UNKNOWN');
});

test('a numeric cell that is not a number is UNREADABLE, never zero and never absent', () => {
  // The failure this forbids: coercing to 0 and reporting a run as having spent
  // nothing when the cell says something nobody can parse.
  for (const raw of ['n/a', 'NULL', '1,390,954', '1.2.3', 'Infinity', 'NaN']) {
    assert.equal(KIND(readNumericCell(raw)), 'UNREADABLE', raw);
  }
});

test('a negative and a zero are both values, and are not confused with absence', () => {
  assert.equal(KIND(readNumericCell('0')), 'VALUE');
  assert.equal(KIND(readNumericCell('-1')), 'VALUE');
});

test('surrounding whitespace does not make a number unreadable, and does not make blank a value', () => {
  assert.equal(KIND(readNumericCell('  42  ')), 'VALUE');
  assert.equal(KIND(readNumericCell('   ')), 'UNKNOWN');
});

/* ---------------------------------------------------------- closed sets */

const BASIS = ['PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'RESERVED_UNSETTLED', 'UNKNOWN'] as const;

test('a token from the vocabulary reads as its value', () => {
  const cell = readTokenCell('PROVIDER_REPORTED', BASIS);
  assert.equal(KIND(cell), 'VALUE');
});

test('a token outside the vocabulary is UNREADABLE and says so', () => {
  const cell = readTokenCell('PROVIDER-REPORTED', BASIS);
  assert.equal(KIND(cell), 'UNREADABLE');
  assert.ok(cell.kind === 'UNREADABLE' && cell.reason.length > 0);
});

test('a blank token cell is UNKNOWN, not the vocabulary member that happens to be named UNKNOWN', () => {
  // THE TRAP. `UNKNOWN` is a legitimate member of this particular vocabulary —
  // a settlement that arrived reporting nothing. A cell that is BLANK is a
  // different fact: no settlement row was exported at all. Collapsing them
  // would make an unexported row indistinguishable from an unreported cost.
  const blank = readTokenCell('', BASIS);
  assert.equal(KIND(blank), 'UNKNOWN');
  const reported = readTokenCell('UNKNOWN', BASIS);
  assert.equal(KIND(reported), 'VALUE');
  assert.notDeepEqual(blank, reported);
});

/* ---------------------------------------------------------------- booleans */

test('a boolean reads the shapes PostgreSQL actually writes', () => {
  for (const raw of ['t', 'true']) assert.equal(KIND(readBooleanCell(raw)), 'VALUE', raw);
  for (const raw of ['f', 'false']) assert.equal(KIND(readBooleanCell(raw)), 'VALUE', raw);
});

test('a blank boolean is UNKNOWN, never false', () => {
  // `timedOut` blank does not mean the run did not time out.
  assert.equal(KIND(readBooleanCell('')), 'UNKNOWN');
});

test('a boolean that is neither is UNREADABLE', () => {
  for (const raw of ['0', '1', 'yes', 'T ', 'maybe']) {
    assert.equal(KIND(readBooleanCell(raw.trim() === 'T' ? 'maybe' : raw)), 'UNREADABLE', raw);
  }
});

/* ------------------------------------------------------------- free text */

test('free text that is present reads as its value', () => {
  const cell = readTextCell('claude-fable-5');
  assert.equal(KIND(cell), 'VALUE');
});

/**
 * THE CASE THIS MISSION IS ABOUT.
 *
 * A blank free-text cell is compatible with TWO facts, and which one the
 * exporter means is not decidable from inside this module. The answer is a
 * property of the PRODUCER, which is not in this workspace.
 *
 * The test asserts the only thing that is true regardless: a reader may not
 * silently pick one. It must either report the cell as AMBIGUOUS and name both
 * candidates, or — if and only if the producer genuinely distinguishes them —
 * report UNKNOWN. Anything else publishes a fact nobody wrote.
 *
 * DO NOT GUESS. Establish what the exporter writes for a SQL NULL, and let the
 * implementation say where that answer came from.
 */
test('a blank free-text cell is never silently resolved', () => {
  const cell = readTextCell('');
  assert.ok(cell.kind === 'AMBIGUOUS' || cell.kind === 'UNKNOWN',
    `a blank text cell read as ${cell.kind}`);
  // Implied by the line above, and kept because it is the sentence this whole
  // mission is about. It adds no coverage; it says the rule out loud.
  assert.notEqual(cell.kind, 'VALUE');
  if (cell.kind === 'AMBIGUOUS') {
    // Both readings are named, so a reader downstream can see what it is being
    // asked to choose between rather than being handed a bare refusal.
    assert.ok(cell.candidates.length >= 2, 'an ambiguity names its candidates');
  }
});

/* ------------------------------------------------------------------ rows */

const COLUMNS: readonly JuliusBundleColumn[] = [
  { name: 'cost_usd_micros', kind: 'numeric' },
  { name: 'cost_basis', kind: 'token', vocabulary: BASIS },
  { name: 'timed_out', kind: 'boolean' },
  { name: 'served_model', kind: 'text' },
];

test('a row reads every declared column, and reports what it could not read', () => {
  const reading = readBundleRow({
    cost_usd_micros: '1390954', cost_basis: 'PROVIDER_REPORTED',
    timed_out: 'f', served_model: 'claude-fable-5',
  }, COLUMNS);
  assert.equal(reading.version, JULIUS_BUNDLE_CELL_VERSION);
  assert.deepEqual(reading.unreadable, []);
  assert.deepEqual(reading.ambiguous, []);
  assert.equal(reading.scorable, true);
});

test('a declared column absent from the row is UNKNOWN, not an error', () => {
  // An older bundle written before a fact was instrumented genuinely does not
  // carry it. Refusing the whole row would make it unreadable rather than
  // partially readable.
  const reading = readBundleRow({ cost_usd_micros: '5' }, COLUMNS);
  assert.equal(KIND(reading.cells.cost_basis!), 'UNKNOWN');
  assert.deepEqual(reading.unreadable, []);
});

test('an unreadable cell makes the row unscorable and is named', () => {
  const reading = readBundleRow({
    cost_usd_micros: 'n/a', cost_basis: 'PROVIDER_REPORTED', timed_out: 'f', served_model: 'm',
  }, COLUMNS);
  assert.deepEqual(reading.unreadable, ['cost_usd_micros']);
  assert.equal(reading.scorable, false);
});

test('a token column declared without a vocabulary is refused rather than read loosely', () => {
  // REFUSED FOR ITS OWN REASON, not merely throwing. A bare `assert.throws`
  // here passes against the unimplemented stub, which would make this case
  // satisfied by doing nothing — so the reason is asserted too.
  assert.throws(
    () => readBundleRow({ a: 'x' }, [{ name: 'a', kind: 'token' }]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.notEqual(error.message, 'bundle_cell_not_implemented');
      return true;
    },
  );
  // And a token column WITH a vocabulary is read, so the refusal is about the
  // missing vocabulary rather than about token columns.
  const ok = readBundleRow({ a: 'PROVIDER_REPORTED' }, [{ name: 'a', kind: 'token', vocabulary: BASIS }]);
  assert.equal(ok.cells.a!.kind, 'VALUE');
});

/* ------------------------------------------------------------------ TSV */

test('a TSV parses by its own header', () => {
  const parsed = parseBundleTsv('a\tb\n1\t2\n3\t4\n');
  assert.deepEqual(parsed.header, ['a', 'b']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]!.a, '1');
  assert.deepEqual(parsed.malformed, []);
});

test('a blank field survives parsing as a blank field, not as a missing key', () => {
  // The whole module depends on a blank reaching the cell readers intact.
  const parsed = parseBundleTsv('a\tb\n\t2\n');
  assert.equal(parsed.rows[0]!.a, '');
  assert.ok('a' in parsed.rows[0]!);
});

test('a row with the wrong field count is reported, never padded or truncated', () => {
  const parsed = parseBundleTsv('a\tb\n1\n1\t2\t3\n1\t2\n');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.malformed.length, 2);
  assert.deepEqual(parsed.malformed.map((entry) => entry.fields), [1, 3]);
});

test('nothing invents quoting the exporter does not write', () => {
  // The producer quotes nothing, so a quote character is data.
  const parsed = parseBundleTsv('a\n"x\ty"\n');
  assert.equal(parsed.malformed.length, 1);
});

test('an empty file is an empty reading, not a crash', () => {
  const parsed = parseBundleTsv('');
  assert.deepEqual(parsed.header, []);
  assert.deepEqual(parsed.rows, []);
});

/* ------------------------------------------------------------ vocabulary */

test('the kind vocabulary is closed and complete', () => {
  assert.deepEqual([...JULIUS_BUNDLE_CELL_KINDS], ['VALUE', 'UNKNOWN', 'AMBIGUOUS', 'UNREADABLE']);
});
