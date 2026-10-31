/* Round 9 (Skywalker N8-4, PILOT R8-4, PILOT R8-5): the pinned-source scanner must refuse by name when its parser is
   missing (bundled gate, node_modules absent) and must never throw or hang on oversized / deeply nested input. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as G from './e2-evidence-gate';

const here = resolve(__dirname);
const esbuild = resolve(here, '../../node_modules/.bin/esbuild');
function bundleAndScan(external: boolean, src: string): string {
  const d = mkdtempSync(join(tmpdir(), 'e2-bundle-r14-'));
  try {
    /* Outside the repo: no node_modules on the resolution path, so `typescript` is unresolvable unless bundled in. */
    execFileSync(esbuild, [join(here, 'e2-evidence-gate.ts'), '--bundle', '--platform=node', '--format=cjs', ...(external ? ['--external:typescript'] : []), `--outfile=${join(d, 'g.cjs')}`, '--log-level=error']);
    writeFileSync(join(d, 'run.cjs'), `let r; try { r = require('./g.cjs').scanPinnedSource(${JSON.stringify(src)}); } catch (e) { r = 'THREW:' + e.message.split('\\n')[0]; } process.stdout.write(JSON.stringify(r));`);
    return JSON.parse(execFileSync(process.execPath, [join(d, 'run.cjs')], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } })) as string;
  } finally { rmSync(d, { recursive: true, force: true }); }
}

describe('N8-4 / R8-4: scanner unavailable is a named refusal (esbuild bundle, node_modules hidden)', () => {
  it('esbuild is available offline in this checkout', () => { expect(existsSync(esbuild)).toBe(true); });
  it('bundled gate with typescript external and no node_modules: scanPinnedSource -> e2_scanner_unavailable (no throw)', () => {
    expect(bundleAndScan(true, "import t from 'node:test';\nt('a', () => {});\n")).toBe('e2_scanner_unavailable');
  }, 60_000);
  it('bundled gate with typescript bundled in: the same scan accepts (control)', () => {
    expect(bundleAndScan(false, "import t from 'node:test';\nt('a', () => {});\n")).toBeNull();
  }, 60_000);
});

describe('R8-5: size and depth guards before the parse; any parse throw is a named refusal', () => {
  it('a file over 256 KiB is refused quickly', () => {
    const t0 = Date.now();
    expect(G.scanPinnedSource('// x\n'.repeat(1024 * 1024))).toBe('spec_pinned_test_too_large');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('exactly at the cap is scanned (not refused for size)', () => {
    const s = 'const a = 1;\n'; const pad = '/' + '/'.repeat(G.E2_PINNED_MAX_BYTES - s.length - 2) + '\n';
    expect(Buffer.byteLength(s + pad)).toBe(G.E2_PINNED_MAX_BYTES);
    expect(G.scanPinnedSource(s + pad)).toBeNull();
  });
  it('20k nested [ is refused (too_deep), not a stack overflow', () => {
    expect(G.scanPinnedSource('const a = ' + '['.repeat(20_000) + ']'.repeat(20_000) + ';\n')).toBe('spec_pinned_test_too_deep');
  });
  it('50k nested ( is refused (too_deep)', () => {
    expect(G.scanPinnedSource('const a = ' + '('.repeat(50_000) + '1' + ')'.repeat(50_000) + ';\n')).toBe('spec_pinned_test_too_deep');
  });
  it('depth undercounted via closing brackets in strings still never throws (parse throw -> named refusal or parse result)', () => {
    const src = 'const a = ' + "[')',".repeat(30_000) + '0' + ']'.repeat(30_000) + ';\n';
    let r: unknown; expect(() => { r = G.scanPinnedSource(src); }).not.toThrow();
    expect(r).not.toBeNull();
  });
  it('ordinary nesting stays accepted', () => {
    expect(G.scanPinnedSource('const a = ' + '['.repeat(50) + ']'.repeat(50) + ';\n')).toBeNull();
  });
});
