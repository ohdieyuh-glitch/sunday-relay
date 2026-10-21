import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NodeJuliusToolAdapter,
  juliusSearchPath,
  juliusSearchNeedleMatches,
} from './node-tool-adapter.ts';

/**
 * THE TOOL THAT LIES ABOUT PATHS — THE SPECIFICATION.
 *
 * WHAT IS WRONG TODAY. `search.grep`, `search.find` and `search.glob` build the
 * paths they emit with `path.relative`, which uses the HOST separator. On Windows
 * every emitted path therefore reads `src\relay\thing.ts`, and two things break:
 *
 *   1. `search.find` / `search.glob` filter with `file.includes(needle)`, so a
 *      needle written the way every human and every model writes one —
 *      `src/relay` — matches NOTHING on Windows. The tool answers "no files"
 *      about a workspace full of them, and a Coding Agent told there is no such
 *      file believes it.
 *   2. `search.grep` emits `path:line:text`. The path half changes shape by host,
 *      so anything downstream that splits or compares it is host-dependent —
 *      including a model reading its own earlier output back.
 *
 * HOW IT SURVIVED. The one existing assertion about search output greps a file at
 * the workspace ROOT (`math.js:1`), where `relative` returns a bare filename with
 * no separator in it at all. The defect is invisible to every test that never
 * looks inside a subdirectory.
 *
 * WHY THIS TEST DOES NOT JUST ASSERT "the output contains /". On Linux, where CI
 * runs, `path.relative` ALREADY returns `/`, so such an assertion would pass
 * without the defect being fixed — a green test about nothing, on the only host
 * that gates the repository. So the specification is a PURE function that takes
 * the spelling it is given: `juliusSearchPath` normalises a workspace-relative
 * path to POSIX whatever the host, and `juliusSearchNeedleMatches` decides a
 * match for a needle written either way. Both are exercised here with BACKSLASH
 * input on every host, so this test fails on Linux and on Windows until the work
 * is done, and it keeps failing if a later change reintroduces the host
 * separator.
 *
 * THE END-TO-END HALF still drives the real adapter against a real temporary
 * workspace, because a pure helper nobody calls is not a fix. It calls
 * `execute(definition, request, context, decision)` — the adapter's actual
 * signature — and passes the three type-only shapes as literals, so this file's
 * import closure stays exactly one module.
 */

test('juliusSearchPath normalises a workspace-relative path to POSIX, on every host', () => {
  assert.equal(juliusSearchPath('src\\relay\\thing.ts'), 'src/relay/thing.ts');
  assert.equal(juliusSearchPath('src/relay/thing.ts'), 'src/relay/thing.ts');
  assert.equal(juliusSearchPath('thing.ts'), 'thing.ts');
  // Mixed spellings occur when one half of a path came from a manifest and the
  // other from the filesystem.
  assert.equal(juliusSearchPath('src\\relay/mission\\julius.ts'), 'src/relay/mission/julius.ts');
  // It normalises SEPARATORS and nothing else: no trimming, no case change, no
  // resolution, and a name that legitimately contains a dot or a space is
  // untouched.
  assert.equal(juliusSearchPath('docs/a file.name.md'), 'docs/a file.name.md');
  assert.equal(juliusSearchPath(''), '');
});

test('a needle written with / matches a path spelled either way', () => {
  // The defect, stated as the rule: the spelling of the needle and the spelling
  // of the path must not have to agree.
  assert.equal(juliusSearchNeedleMatches('src\\relay\\thing.ts', 'src/relay'), true);
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', 'src/relay'), true);
  assert.equal(juliusSearchNeedleMatches('src\\relay\\thing.ts', 'src\\relay'), true);
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', 'src\\relay'), true);
  // A needle that does not occur still does not match — the fix must not widen
  // what matches, only stop the separator deciding it.
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', 'docs/'), false);
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', 'relay/other'), false);
  // An empty needle matches everything, as `includes('')` always did: the tool's
  // "list every file" behaviour must not change.
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', ''), true);
  // A `*` is stripped as it was, so `*.ts` and `.ts` behave the same.
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.ts', '*.ts'), true);
  assert.equal(juliusSearchNeedleMatches('src/relay/thing.md', '*.ts'), false);
});

test('the helpers are pure: the same input answers the same way, and nothing is mutated', () => {
  const path = 'src\\relay\\thing.ts';
  assert.equal(juliusSearchPath(path), juliusSearchPath(path));
  assert.equal(path, 'src\\relay\\thing.ts');
  assert.equal(juliusSearchNeedleMatches(path, 'src/relay'), juliusSearchNeedleMatches(path, 'src/relay'));
});

/**
 * A real workspace with a SUBDIRECTORY, because a path with no separator in it
 * cannot show a separator defect.
 */
const workspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'julius-search-'));
  await mkdir(join(root, 'src', 'relay'), { recursive: true });
  await writeFile(join(root, 'src', 'relay', 'thing.ts'), 'export const needle = 1;\nexport const other = 2;\n');
  await writeFile(join(root, 'src', 'relay', 'plain.md'), 'no code here\n');
  return root;
};

/** The three shapes the adapter reads. All three are type-only at compile time. */
const definition = {
  toolId: 'search', toolVersion: '1.0.0', executesProcess: false, mutatesFilesystem: false,
  outputCeilingBytes: 256_000, timeoutCeilingMs: 30_000,
} as never;
const decision = { allowed: true, revision: 'card-1', reasons: [] } as never;

const search = async (toolId: string, args: Record<string, unknown>): Promise<string> => {
  const root = await workspace();
  const result = await new NodeJuliusToolAdapter().execute(
    definition,
    {
      invocationId: `invocation-${toolId}`, runId: 'run', taskId: 'task', projectId: 'project',
      workerId: 'coding-agent', toolId, toolVersion: '1.0.0', idempotencyKey: `key-${toolId}`,
      expectedMutation: 'NONE', arguments: { path: '.', ...args },
    } as never,
    {
      workspaceRoot: root, filesystemIsolation: 'WORKSPACE_ONLY',
      networkIsolation: 'MEDIATED_ALLOW', safeEnvironment: {},
    } as never,
    decision,
  );
  assert.equal(result.status, 'SUCCEEDED', `the tool itself failed: ${result.safeSummary}`);
  return String(result.stdout ?? '');
};

const lines = (stdout: string): string[] => stdout.split('\n').filter((line) => line !== '');

test('search.find emits POSIX paths and matches a POSIX needle through the adapter', async () => {
  const found = lines(await search('search.find', { pattern: 'src/relay' }));
  assert.ok(found.length >= 2, `expected the two seeded files, got ${JSON.stringify(found)}`);
  for (const line of found) {
    assert.ok(!line.includes('\\'), `emitted a host-separated path: ${line}`);
    assert.ok(line.startsWith('src/relay/'), `expected a POSIX workspace-relative path, got ${line}`);
  }
});

/**
 * THE CASE THAT PROVES THE HELPER IS CALLED, ON EITHER HOST.
 *
 * Every other end-to-end assertion here can pass VACUOUSLY on Linux, because
 * `path.relative` already returns `/` there: an implementation that exported both
 * helpers and wired neither would satisfy them on the only host that gates this
 * repository. So this case sends a needle spelled with the WRONG separator for
 * whatever host is running. A raw `file.includes(needle)` cannot match it on
 * either host — on Linux the path has `/` and the needle has `\`, on Windows the
 * reverse. It passes only if the needle matcher is actually in the filter.
 */
test('a needle spelled with the other host separator still matches, so the matcher is wired', async () => {
  const found = lines(await search('search.find', { pattern: 'src\\relay' }));
  assert.ok(found.length >= 2,
    `a backslash needle matched nothing, so the filter is still a raw includes: ${JSON.stringify(found)}`);
});

test('search.glob behaves the same as search.find, because they are one case', async () => {
  const found = lines(await search('search.glob', { pattern: 'src/relay' }));
  assert.ok(found.length >= 2, `expected the two seeded files, got ${JSON.stringify(found)}`);
  for (const line of found) assert.ok(!line.includes('\\'), `emitted a host-separated path: ${line}`);
});

test('search.grep emits path:line:text with a POSIX path, and the line and text unchanged', async () => {
  const found = lines(await search('search.grep', { pattern: 'needle' }));
  assert.equal(found.length, 1, `expected one match, got ${JSON.stringify(found)}`);
  const line = found[0]!;
  assert.ok(!line.includes('\\'), `emitted a host-separated path: ${line}`);
  assert.equal(line, 'src/relay/thing.ts:1:export const needle = 1;');
});

test('the workspace bound is unchanged: nothing outside the root is emitted', async () => {
  // The fix is about the SPELLING of a path, never about which paths exist. A
  // change that normalised its way out of the workspace would be a containment
  // failure wearing a formatting fix.
  for (const line of lines(await search('search.find', { pattern: '' }))) {
    assert.ok(!line.startsWith('/'), `absolute path emitted: ${line}`);
    assert.ok(!line.startsWith('..'), `path outside the workspace emitted: ${line}`);
    assert.ok(!/^[A-Za-z]:/u.test(line), `drive-qualified path emitted: ${line}`);
  }
});
