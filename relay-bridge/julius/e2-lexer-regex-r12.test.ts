/* Round 7 (PILOT R6-8): a regex literal holding a quote (`/'/`) opened a fake string in the lexer, so the static floor
   under-counted and the pinned-file scan could miss a load. Regex literals are now skipped as regex literals. */
import { describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';

const count = (src: string): number => (G.stripJsNoise(src).match(/(?<![.\w$])(?:test|it)\s*\(/gu) ?? []).length;
describe('regex literals in the lexers', () => {
  it('PILOT regex_quote_hides: 2 calls counted', () => {
    expect(count("const test=require('node:test');const re=/'/;test('a',()=>{});test('b',()=>{});")).toBe(2);
    expect(count("const re = /[/'\"]/g; test('a', () => {}); const r2 = /\\/'/; test('b', () => {});")).toBe(2);
  });
  it('division is still division', () => {
    expect(count("const x = a / b; test('a', () => {}); const y = (c) / 2 / 'q'; test('b', () => {});")).toBe(2);
  });
  it('the pinned-file scan sees a load after a regex literal with a quote', () => {
    expect(G.scanPinnedSource("const re = /'/; require('./lib.js'); const s = '/';\n")).toBe('spec_pinned_test_imports_untrusted');
    expect(G.scanPinnedSource("const re = /\"`/; eval('1'); //`\"\n")).toBe('spec_pinned_test_dynamic_load');
  });
});
