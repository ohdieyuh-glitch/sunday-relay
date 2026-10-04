import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EVERY OUTBOX ROW IS WRITTEN RIGHT AFTER ITS OWN EVENT, BY A NAMED WRITER (row 13 (i), migration 030).
 *
 * Migration 030 dropped the outbox's foreign key to events. Its check was a predicate read under SERIALIZABLE,
 * and on a small events table it ran as a sequential scan, through which two runs' appends cancelled each other.
 * The database still enforces the guarantee: 030's triggers refuse an outbox row whose event was not written
 * earlier in the same transaction. This pin is the second line. It names the writers, so a sixth is a reviewed
 * change and not an accident, and it holds each to the shape that passes the database's check by construction:
 *   - Julius's four writers: the events INSERT, then the outbox INSERT, within the three lines that end it;
 *   - Wonderland: `appendEvent` inserts the event, `enqueueEvent` inserts its outbox row, and `commitCommand` is
 *     `enqueueEvent`'s only caller, on the line after `appendEvent` returned that event.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const OUTBOX = 'INSERT INTO relay_wonderland.outbox(';
const EVENTS = 'INSERT INTO relay_wonderland.events(';
const WONDERLAND = 'src/relay/persistence/wonderland-postgres.ts';
const WRITERS = [
  'src/relay/persistence/julius-event-postgres.ts',
  'src/relay/persistence/julius-postgres.ts',
  'src/relay/persistence/julius-repair-postgres.ts',
  'src/relay/persistence/julius-tool-settlement-postgres.ts',
  WONDERLAND,
];

const production = (): Record<string, string> => {
  const files = execFileSync('git', ['ls-files', 'src', 'relay-bridge', 'scripts', 'python'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(ts|mts|cts|js|mjs|cjs|py)$/u.test(file) && !/\.(test|spec)\.[cm]?[tj]sx?$/u.test(file) && !file.includes('/wonderland-migrations/'));
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]));
};

/** What is wrong with the outbox writers in these sources; empty when the pin holds. */
function audit(sources: Record<string, string>): string[] {
  const problems: string[] = [];
  const writers = Object.keys(sources).filter((file) => sources[file]!.includes(OUTBOX)).sort();
  for (const file of writers) if (!WRITERS.includes(file)) problems.push(`unreviewed outbox writer: ${file}`);
  for (const file of WRITERS) {
    const source = sources[file] ?? '';
    const count = source.split(OUTBOX).length - 1;
    if (count !== 1) { problems.push(`${file}: ${count} outbox INSERTs, not exactly 1`); continue; }
    const lines = source.split('\n');
    const at = lines.findIndex((line) => line.includes(OUTBOX));
    if (file === WONDERLAND) {
      if (!/async enqueueEvent\(event: WonderlandEvent\): Promise<void> \{\s*$/u.test(lines[at - 1] ?? '')) problems.push(`${file}: the outbox INSERT is not enqueueEvent's body`);
      const callers = Object.entries(sources).flatMap(([name, text]) => text.split('\n').flatMap((line, index) => (
        /\.enqueueEvent\(/u.test(line) ? [{ name, index, line, previous: text.split('\n')[index - 1] ?? '' }] : [])));
      if (callers.length !== 1) problems.push(`enqueueEvent has ${callers.length} callers, not exactly 1 (commitCommand)`);
      for (const caller of callers) {
        if (!/await transaction\.enqueueEvent\(event\);/u.test(caller.line)
          || !/const event = await transaction\.appendEvent\(/u.test(caller.previous)) problems.push(`${caller.name}:${caller.index + 1}: enqueueEvent is not called with the event appendEvent returned on the line before`);
      }
      continue;
    }
    const window = lines.slice(Math.max(0, at - 3), at + 1).join('\n');
    const events = window.lastIndexOf(EVENTS, window.lastIndexOf(OUTBOX));
    if (events < 0) problems.push(`${file}:${at + 1}: no events INSERT before the outbox INSERT within three lines`);
  }
  return problems;
}

describe('the outbox writers (row 13 (i): what migration 030’s triggers enforce, pinned at the source)', () => {
  it('exactly the five named writers write outbox rows, each right after its own event', () => {
    expect(audit(production())).toEqual([]);
  });

  it('CONTROL: the pin sees a new writer, a second INSERT, an outbox row with no event before it, and a moved Wonderland call', () => {
    const real = production();
    const julius = 'src/relay/persistence/julius-repair-postgres.ts';
    const wonderland = real[WONDERLAND]!;
    const edits: Array<[string, Record<string, string>]> = [
      ['a sixth writer', { ...real, 'src/relay/persistence/some-new-writer.ts': `await client.query('${OUTBOX}outbox_id,event_id,project_id) VALUES($1,$2,$3)');` }],
      ['a second outbox INSERT in a writer', { ...real, [julius]: `${real[julius]}\nawait client.query('${OUTBOX}outbox_id) VALUES($1)');\n` }],
      ['an outbox INSERT with no events INSERT before it', { ...real, [julius]: real[julius]!.split(EVENTS).join('INSERT INTO relay_wonderland.not_events(') }],
      ['a second enqueueEvent caller', { ...real, 'relay-bridge/elsewhere.ts': 'await store.enqueueEvent(somethingElse);' }],
      ['enqueueEvent called without appendEvent before it', { ...real, [WONDERLAND]: wonderland.replace('const event = await transaction.appendEvent(input.event, input.streamId);', 'const event = input.event as WonderlandEvent;') }],
    ];
    for (const [what, sources] of edits) {
      expect(Object.values(sources).join('') === Object.values(real).join(''), `${what}: the edit applied`).toBe(false);
      expect(audit(sources).length, what).toBeGreaterThan(0);
    }
  });
});
