/* Round 10 (Skywalker 5a6e3400 F9-3): `assert.ok = (F)=>F('...')(); assert.ok(g[k])` passed the scan under the
   inert-value rule (an argument of an assert method). Imported bindings are now immutable to the scan: no assignment,
   delete, ++/--, or destructuring target on a member chain rooted at ANY import, no reassigning or shadowing an import,
   and an assert/test import (or a chain rooted at one) may appear only as a callee or as the object of a further member
   access, so it never escapes into Object.assign or an alias. The verifier child's --disallow-code-generation-from-strings
   flag stays as a second layer (pinned in e2-n8-r14 / e2-verifier-env tests). */
import { describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';

const K = "const k=['c','onstructor'].join(''); function g(){};";
const REFUSE = 'spec_pinned_test_import_mutated';
describe('F9-3: imported bindings cannot be mutated, shadowed or aliased', () => {
  const bad: Array<[string, string]> = [
    ['Skywalker exact (scan-sweep assert_reassign)', `import assert from 'node:assert'; ${K} assert.ok = (f)=>f('1'); assert.ok(g[k]);`],
    ['Skywalker R9 runtime form', `import assert from 'node:assert'; const kk=['c','onstructor'].join(''); async function g(){}; const P={}; assert.ok=(F)=>{ P.v = F('1')(); }; assert.ok(g[kk]); await P.v;`],
    ['strict default import', `import assert from 'node:assert/strict'; ${K} assert.ok = (f)=>f('1'); assert.ok(g[k]);`],
    ['namespace import', `import * as A from 'node:assert'; ${K} A.ok = (f)=>f('1');`],
    ['element-access member', `import assert from 'node:assert'; assert['ok'] = (f)=>f('1');`],
    ['compound assignment', `import assert from 'node:assert'; assert.ok ||= (f)=>f('1');`],
    ['nested chain', `import assert from 'node:assert'; assert.strict.ok = (f)=>f('1');`],
    ['delete', `import assert from 'node:assert'; delete assert.ok;`],
    ['++', `import assert from 'node:assert'; assert.x++;`],
    ['array destructuring target', `import assert from 'node:assert'; [assert.ok] = [(f)=>f('1')];`],
    ['object destructuring target', `import assert from 'node:assert'; ({ a: assert.ok } = { a: (f)=>f('1') });`],
    ['for-of target', `import assert from 'node:assert'; for (assert.ok of [1]) {}`],
    ['Object.assign on assert', `import assert from 'node:assert'; Object.assign(assert, { ok: (f)=>f('1') });`],
    ['Object.assign on assert.strict', `import assert from 'node:assert'; Object.assign(assert.strict, { ok: (f)=>f('1') });`],
    ['const alias then mutate', `import assert from 'node:assert'; const a = assert; a.ok = (f)=>f('1');`],
    ['const alias of alias then Object.assign', `import assert from 'node:assert'; const a = assert; const b = a; Object.assign(b, {});`],
    ['let alias', `import assert from 'node:assert'; let a = assert; a(1);`],
    ['alias of a member chain', `import assert from 'node:assert'; const s = assert.strict; s.ok = 1;`],
    ['shorthand escape', `import assert from 'node:assert'; const o = { assert }; o.assert.ok = 1;`],
    ['PILOT R9-2 SHADOW (function expression named assert)', "import test from 'node:test'; import assert from 'node:assert';\nconst fn = () => 0; const k = ['constr','uctor'].join(''); let got = 'none';\n(function assert(v, d) { if (d) { try { got = String(v('return 7')()); } catch (e) { got = e.name; } return; } assert(fn[k], 1); })(0, 0);\ntest('a', () => assert.strictEqual(got, '7'));\n"],
    ['PILOT R9-2 class expression named assert', "import test from 'node:test'; import assert from 'node:assert';\nconst fn=()=>0; const k=['constr','uctor'].join(''); (class assert { static m(){ assert(fn[k]); } }); test('a',()=>{});"],
    ['PILOT R9-2 function expression named like a named import', "import test from 'node:test'; import { strictEqual } from 'node:assert';\nconst fn=()=>0; const k=['constr','uctor'].join(''); let got='none';\n(function strictEqual(v, d){ if (d) { try { got=String(v('return 7')()); } catch (e) { got=e.name; } return; } strictEqual(fn[k], 1); })(0, 0);\ntest('a',()=>{});\n"],
    ['test binding mutated', `import test from 'node:test'; test.it = 1;`],
    ['named test import mutated', `import { test } from 'node:test'; test.skip = 1;`],
    ['node:fs member mutated', `import fs from 'node:fs'; fs.readFileSync = (f)=>f;`],
    ['named node:path import mutated', `import { posix } from 'node:path'; posix.join = 1;`],
    ['reassign an import', `import assert from 'node:assert'; assert = (f)=>f('1');`],
    ['shadow by const', `import assert from 'node:assert'; { const assert = { ok: (f)=>f('1') }; assert.ok(1); }`],
    ['shadow by parameter', `import assert from 'node:assert'; function h(assert){ assert.ok(1); }`],
    ['shadow by catch', `import assert from 'node:assert'; try {} catch (assert) {}`],
    ['shadow by function', `import assert from 'node:assert'; { function assert(){} }`],
    ['shadow by class', `import assert from 'node:assert'; { class assert {} }`],
  ];
  for (const [name, src] of bad) it(`refused: ${name}`, () => { expect(G.scanPinnedSource(src)).toBe(REFUSE); });

  const ok: Array<[string, string]> = [
    ['honest assert calls', "import assert from 'node:assert/strict'; import test from 'node:test'; test('a', () => { assert.strictEqual(1, 1); assert.deepStrictEqual([1], [1]); });"],
    ['named imports used as callees', "import { strictEqual } from 'node:assert/strict'; import { test, describe } from 'node:test'; describe('d', () => test('a', () => strictEqual(1, 1)));"],
    ['test.skip / t.test member call', "import test from 'node:test'; test.skip('a', () => {}); test('b', async (t) => { await t.test('c', () => {}); });"],
    ['await assert.rejects', "import assert from 'node:assert'; import test from 'node:test'; test('r', async () => { await assert.rejects(async () => { throw new Error('x'); }); });"],
    ['node:fs and node:path values passed as arguments', "import { readFileSync } from 'node:fs'; import { join, sep } from 'node:path'; const p = join('a', 'b'); const s = p.split(sep); readFileSync;"],
    ['a const alias of a test import used as a callee (e2-verifier-floor fixture form)', "import __t from 'node:test'; const test = __t; test('a', () => {}); test('b', () => {});"],
    ['a property NAMED like an import is not a use', "import test from 'node:test'; const re = /x/; re.test('x'); const o = { test: 1 }; o.test;"],
  ];
  for (const [name, src] of ok) it(`accepted: ${name}`, () => { expect(G.scanPinnedSource(src)).toBeNull(); });
});
