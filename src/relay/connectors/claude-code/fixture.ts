import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Safe-edit live fixture (Prompt 8) — a THROWAWAY Git repository built under
 * the OS temp dir (never the real Sunday repository). One claimed source
 * file with a failing baseline test; every other file protected. No
 * dependencies, no installation, no Bash tool required by the agent, and the
 * test runs with Node's built-in runner — so Relay can verify independently
 * after the agent exits.
 */

export const CLAIMED_FILE = 'src/normalize.js';
export const TEST_FILE = 'test/normalize.test.js';
export const RELAY_TEST_ARGS = ['--test', TEST_FILE];

const FIXTURE_ENV = {
  GIT_AUTHOR_NAME: 'Relay Fixture', GIT_AUTHOR_EMAIL: 'fixture@relay.local',
  GIT_COMMITTER_NAME: 'Relay Fixture', GIT_COMMITTER_EMAIL: 'fixture@relay.local',
  GIT_TERMINAL_PROMPT: '0',
};

const fixtureGit = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...FIXTURE_ENV },
  });

/** The stub ships a deliberately-wrong implementation so the test fails. */
const STUB_IMPLEMENTATION = `// Relay live fixture — implement normalizeProjectName so the tests pass.
// A project name should become lowercase, trimmed, with spaces and
// underscores turned into single hyphens, and no leading/trailing hyphens.
function normalizeProjectName(name) {
  // TODO(relay-fixture): replace this stub with a correct implementation.
  return name;
}

module.exports = { normalizeProjectName };
`;

/** The reference implementation the fake Claude writes (and a real Claude
 * should produce) — used only by offline tests via the fake executable. */
export const REFERENCE_IMPLEMENTATION = `function normalizeProjectName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[\\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = { normalizeProjectName };
`;

const TEST_SOURCE = `const test = require('node:test');
const assert = require('node:assert');
const { normalizeProjectName } = require('../src/normalize.js');

test('trims and lowercases with hyphens', () => {
  assert.strictEqual(normalizeProjectName('  My Project  '), 'my-project');
});
test('underscores become hyphens', () => {
  assert.strictEqual(normalizeProjectName('Hello_World'), 'hello-world');
});
test('collapses repeated separators', () => {
  assert.strictEqual(normalizeProjectName('a--b__c'), 'a-b-c');
});
`;

const PACKAGE_JSON = `{
  "name": "relay-live-fixture",
  "version": "0.0.0",
  "private": true,
  "scripts": { "test": "node --test test/" }
}
`;

export interface BuiltFixture {
  fixtureRoot: string;
  sourceRepo: string;
  baselineRevision: string;
  claimedFile: string;
  protectedPaths: { forbidden: string[]; readOnly: string[] };
}

/** Build the fixture repository and return its identity. Caller removes
 * `fixtureRoot` when done. */
export function buildSafeEditFixture(): BuiltFixture {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'relay-claude-fixture-'));
  const sourceRepo = join(fixtureRoot, 'source');
  mkdirSync(join(sourceRepo, 'src'), { recursive: true });
  mkdirSync(join(sourceRepo, 'test'), { recursive: true });

  fixtureGit(['init', '-q', '-b', 'main'], sourceRepo);
  writeFileSync(join(sourceRepo, 'src', 'normalize.js'), STUB_IMPLEMENTATION);
  writeFileSync(join(sourceRepo, 'test', 'normalize.test.js'), TEST_SOURCE);
  writeFileSync(join(sourceRepo, 'package.json'), PACKAGE_JSON);
  writeFileSync(join(sourceRepo, 'README.md'), '# Relay live fixture\n');
  fixtureGit(['add', '.'], sourceRepo);
  fixtureGit(['commit', '-q', '-m', 'failing baseline'], sourceRepo);
  const baselineRevision = fixtureGit(['rev-parse', 'HEAD'], sourceRepo).trim();

  return {
    fixtureRoot,
    sourceRepo,
    baselineRevision,
    claimedFile: CLAIMED_FILE,
    protectedPaths: { forbidden: ['package.json', 'README.md'], readOnly: ['test'] },
  };
}
