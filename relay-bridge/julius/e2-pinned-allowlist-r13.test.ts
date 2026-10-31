/* Round 8 R7-3 (Skywalker ba9ee244 + PILOT lists): the pinned-file scan is an ALLOWLIST over a TypeScript parse, not a
   lexical blacklist. Every listed bypass is refused; anything that does not parse is refused; the inworld seed still passes. */
import { describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';

const DYN = 'spec_pinned_test_dynamic_load';
describe('R7-3: every listed bypass is refused', () => {
  const bypasses: Array<[string, string]> = [
    ['unicode-escaped require', "const r = \\u0072equire('node:child_process');\n"],
    ['unicode-escaped identifier (any)', "const \\u0061 = 1;\n"],
    ['globalThis.Function', "globalThis.Function('return 1')();\n"],
    ["globalThis['ev'+'al']", "globalThis['ev' + 'al']('1');\n"],
    ['global', "global.x = 1;\n"],
    ["process.getBuiltinModule('module')", "process.getBuiltinModule('module').createRequire('/x')('./y');\n"],
    ["process.getBuiltinModule('child_process')", "process.getBuiltinModule('child_process').execSync('id');\n"],
    ['node:test run() (named)', "import { run } from 'node:test';\nrun({ files: ['x.js'] });\n"],
    ['node:test run() (member)', "import test from 'node:test';\ntest.run({ files: ['x.js'] });\n"],
    ['node:test mock.module', "import { mock } from 'node:test';\nmock.module('x', {});\n"],
    ["regex /'/ after )", "if (true) /'/.test('a'); const r = require('./x');\n"],
    ["process['env'][k]", "const k = 'A'; const v = process['env'][k];\n"],
    ['Reflect.get(process.env,k)', "const k = 'A'; Reflect.get(process.env, k);\n"],
    ['Object.entries(process.env)', "Object.entries(process.env);\n"],
    ["process['dlopen']", "process['dlopen']({}, '/x.node');\n"],
    ['WebAssembly', "WebAssembly.instantiate(new Uint8Array(8));\n"],
    ['Proxy', "new Proxy({}, {});\n"],
    ['Symbol.for', "Symbol.for('nodejs.util.inspect.custom');\n"],
    ['import.meta.resolve', "import.meta.resolve('./x');\n"],
    ['createRequire via node:module', "import { createRequire } from 'node:module';\n"],
    ['computed non-literal key (string expr)', "const o = {}; const k = 'a'; o[k + ''].x;\n"],
    ['index then call', "const o = {}; const k = 'a'; o[k]();\n"],
    ['double dynamic index then call (Function via constructor)', "const f = () => 1; const a = 'x'; const b = 'y'; f[a][b]('return 1')();\n"],
    ['index then member', "const o = {}; const k = 'a'; o[k].call;\n"],
    ['index assignment target', "const o = {}; const k = '__proto__'; o[k] = {};\n"],
    ['index with a call in the key', "const o = {}; o[String(1)];\n"],
    ['computed destructuring key', "const k = 'constructor'; const { [k]: F } = () => 1;\n"],
    ["'constructor' literal key", "(() => 1)['constructor']('1');\n"],
    ['constructor destructured', "const { constructor: F } = () => 1;\n"],
    ['getPrototypeOf', "Object.getPrototypeOf(async () => {});\n"],
    ['dynamic import of a literal', "await import('node:fs');\n"],
    ['tagged template', "String.raw`x`;\n"],
    ['with statement (sloppy CJS)', "with ({}) { x; }\n"],
    ['parse error', "const = ;\n"],
    ['node:process', "import { env } from 'node:process';\n"],
    ['node:os is not on the list', "import os from 'node:os';\n"],
    ['import = (TS form)', "import fs = require('node:fs');\n"],
    /* PILOT ba9ee244 R7-2 list. */
    ["PILOT globalThis['Func'+'tion']", "globalThis['Func' + 'tion']('return 1')();\n"],
    ["PILOT \\u0072equire('./pay.js')", "\\u0072equire('./pay.js');\n"],
    ["PILOT if (1) /'/; import('./pay.js')", "if (1) /'/.test('x'); import('./pay.js');\n"],
    ['PILOT await import(node:fs)', "await import('node:fs');\n"],
    ['PILOT await import(node:http)', "await import('node:http');\n"],
    ['PILOT await import(node:net)', "await import('node:net');\n"],
    ['PILOT process.execve', "process.execve('/bin/sh', ['sh']);\n"],
    ['PILOT WebAssembly.compile', "WebAssembly.compile(new Uint8Array(8));\n"],
    ['PILOT R7-3 node:sqlite', "import { DatabaseSync } from 'node:sqlite';\n"],
    ['PILOT R7-3 require(node:sqlite)', "require('node:sqlite');\n"],
  ];
  for (const [name, src] of bypasses) it(name, () => { expect(G.scanPinnedSource(src)).not.toBeNull(); });
  it('dynamic forms carry the dynamic-load code; untrusted modules carry imports_untrusted', () => {
    expect(G.scanPinnedSource("globalThis.Function('1');\n")).toBe(DYN);
    expect(G.scanPinnedSource("import os from 'node:os';\n")).toBe('spec_pinned_test_imports_untrusted');
    expect(G.scanPinnedSource("const = ;\n")).toBe('spec_pinned_test_unparsed');
  });
});
describe('R7-3: the allowlist itself', () => {
  it('PILOT R7-3: node:sqlite is not on the list and is refused as untrusted', () => {
    expect(G.E2_PINNED_IMPORT_ALLOWLIST.has('node:sqlite')).toBe(false);
    expect(G.scanPinnedSource("import s from 'node:sqlite';\n")).toBe('spec_pinned_test_imports_untrusted');
  });
  it('is exactly this list (bare and node: forms)', () => {
    expect([...G.E2_PINNED_IMPORT_ALLOWLIST].sort()).toEqual(['assert', 'assert/strict', 'crypto', 'node:crypto', 'fs', 'fs/promises', 'node:assert', 'node:assert/strict', 'node:fs', 'node:fs/promises',
      'node:path', 'node:path/posix', 'node:test', 'node:url', 'node:util', 'path', 'path/posix', 'url', 'util'].sort());
  });
  it('accepts ordinary test code: literal imports, regex and template literals, import.meta.url, literal indices', () => {
    for (const src of [
      "import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test, { describe, it } from 'node:test';\nconst doc = JSON.parse(readFileSync(new URL('./o.json', import.meta.url), 'utf8'));\ntest('a', () => { assert.match('x', /^[a-z]'\\/$/u); assert.equal(`${1 + 1}`, '2'); assert.equal([1][0], 1); });\n",
      "const test = require('node:test'); const a = require('node:assert');\ntest('c0', () => a.ok(/[`'\"]/.test('`')));\n",
      "const s = 'abc'; let n = 0; for (let i = 0; i < s.length; i += 1) { if (s[i] === s[i + 1]) n += 1; const c = s[i - 1]; }\n",
    ]) expect(G.scanPinnedSource(src), src).toBeNull();
  });
});
describe('R7-3: the accepted mission fixtures stay accepted (census)', () => {
  it('julius-unreal-mission-1 .julius/hub-scroll-static.test.mjs (node:crypto createHash) and julius-inworld-data-1 format.test.mjs scan clean', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const m = join(__dirname, '../../.github/julius-missions');
    expect(G.scanPinnedSource(readFileSync(join(m, 'julius-unreal-mission-1/workspace/.julius/hub-scroll-static.test.mjs'), 'utf8'))).toBeNull();
    expect(G.scanPinnedSource(readFileSync(join(m, 'julius-inworld-data-1/workspace/format.test.mjs'), 'utf8'))).toBeNull();
  });
});
describe('R7-3: julius-unreal-mission-1 through the real spec path (seeded one-commit repo, trusted base run)', () => {
  it('is accepted with floor [5] and base-registered [5]', async () => {
    const { cpSync, mkdtempSync, realpathSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { git } = await import('./e2-test-kit');
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2-unreal13-')));
    try {
      cpSync(join(__dirname, '../../.github/julius-missions/julius-unreal-mission-1/workspace'), dir, { recursive: true });
      git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, '-c', 'user.name=x', '-c', 'user.email=x@x', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed');
      const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test .julius/hub-scroll-static.test.mjs', workspace: dir, base: git(dir, 'rev-parse', 'HEAD') }, G.spawnVerifierRunner({ timeoutMs: 60_000 }));
      expect('refused' in spec ? spec : { minTests: spec.minTests, baseRegistered: spec.baseRegistered }).toEqual({ minTests: [5], baseRegistered: [5] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});

describe('Round 8 mutation kills: string-named bindings and numeric specifiers', () => {
  it('A15: a banned name written as a string in an import/export specifier or binding is refused', () => {
    expect(G.scanPinnedSource("import { 'run' as r } from 'node:test';\n")).toBe('spec_pinned_test_dynamic_load');
    expect(G.scanPinnedSource("const { 'constructor': C } = () => 1;\n")).toBe('spec_pinned_test_dynamic_load');
  });
  it('A18: a numeric require specifier is refused', () => {
    expect(G.scanPinnedSource('require(1);\n')).toBe('spec_pinned_test_dynamic_load');
  });
});
