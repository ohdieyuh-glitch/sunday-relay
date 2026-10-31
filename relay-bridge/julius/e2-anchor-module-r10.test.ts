/* Round 5 R4-2 (PILOT 44c062b9) + Skywalker steering: the anchor constructor lives in its own module and takes an injected
   WorkflowAnchorSource; the gate and capture modules do not export it; only the anchor module, the planned wiring module
   and tests may import it. This reduces ACCIDENTAL misuse only: the real guarantee is the workflow-side source. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as A from './e2-external-anchor';
import * as G from './e2-evidence-gate';
import * as S from './cursor-run-stream-evidence';

const REPO = join(__dirname, '..', '..');
const ALLOWED = new Set(['relay-bridge/julius/e2-external-anchor.ts', `relay-bridge/julius/${A.E2_ANCHOR_WIRING_MODULE}.ts`]);
function walk(d: string, out: string[]): void {
  for (const n of readdirSync(d)) {
    if (/^(?:node_modules|\.git|dist.*)$/u.test(n)) continue; /* build output dirs skipped by pattern, not read */
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(?:[cm]?[jt]sx?)$/u.test(n)) out.push(p);
  }
}

describe('R4-2: the anchor constructor is its own module', () => {
  it('the gate and capture modules do not export a constructor', () => {
    for (const m of [G, S] as Record<string, unknown>[]) for (const k of ['externalAnchor', 'e2ExternalAnchor', 'anchorFromWorkflow']) expect(k in m, k).toBe(false);
  });
  it('static scan: only the anchor module, the wiring module and tests import e2-external-anchor', () => {
    const files: string[] = [];
    for (const d of ['relay-bridge', 'scripts', 'src', 'apps', 'packages']) { try { walk(join(REPO, d), files); } catch { /* absent */ } }
    const offenders = files.map((f) => relative(REPO, f)).filter((f) => !/\.test\.[cm]?[jt]sx?$/u.test(f) && !f.endsWith('/e2-test-kit.ts') && !ALLOWED.has(f))
      .filter((f) => /from\s+['"][^'"]*e2-external-anchor['"]|require\(\s*['"][^'"]*e2-external-anchor['"]|import\(\s*['"][^'"]*e2-external-anchor['"]/u.test(readFileSync(join(REPO, f), 'utf8')));
    /* The gate reads the brand through the checker only (it never imports a constructor name). */
    expect(offenders.filter((f) => f !== 'relay-bridge/julius/e2-evidence-gate.ts')).toEqual([]);
    const gateSrc = readFileSync(join(__dirname, 'e2-evidence-gate.ts'), 'utf8');
    const imp = /import\s*\{([^}]*)\}\s*from\s*'\.\/e2-external-anchor'/u.exec(gateSrc);
    expect(imp?.[1]?.split(',').map((x) => x.trim()).filter(Boolean).sort()).toEqual(['isWorkflowAnchor', 'type ExternalAnchor']);
    expect(/export\s*\{[^}]*externalAnchor|export\s*\*\s*from\s*'\.\/e2-external-anchor'/u.test(gateSrc)).toBe(false);
  });
  it('the constructor reads an injected WorkflowAnchorSource; e2ExternalAnchor is the same function; brand check kept', () => {
    const src: A.WorkflowAnchorSource = { read: () => ({ source: 'workflow_output', hash: 'a'.repeat(64) }) };
    const a = A.externalAnchor(src);
    expect(a.finalHash).toBe('a'.repeat(64));
    expect(A.e2ExternalAnchor).toBe(A.externalAnchor);
    expect(A.isWorkflowAnchor(a)).toBe(true);
    expect(A.isWorkflowAnchor({ ...a })).toBe(false);
    expect(() => A.externalAnchor({ read: () => ({ source: 'evidence_file' as 'ledger_hash', hash: 'x' }) })).toThrow(TypeError);
    expect(() => A.externalAnchor({ read: () => null as unknown as { source: 'ledger_hash'; hash: string } })).toThrow(TypeError);
    expect(A.externalAnchor(() => ({ source: 'ledger_hash', hash: 'b' })).source).toBe('ledger_hash');
  });
});
