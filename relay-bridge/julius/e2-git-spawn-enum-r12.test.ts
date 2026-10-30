/* Round 7 (Skywalker/PILOT, 4:15 PM): enumerate EVERY git invocation in the e2 production files and fail if one lacks the
   pins. A git argv site is (a) a moduleGit([...]) call (run through the trusted runner's spawn or its CAPTURE execFile) or
   (b) an execFileSync/execFile/spawn call whose program is resolveProgram('git') or the literal 'git'. Each must spread
   GIT_PINS and safeDir(<workspace>); GIT_PINS must carry core.hooksPath=/dev/null and core.fsmonitor=false, and safeDir
   must yield safe.directory=<realpath>. The CAPTURE execFile runs argv.slice(1) only after isModuleGit(argv), so it can
   only run an argv minted by one of the (a) sites. The exact count is pinned so a new site needs a deliberate update. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';

const DIR = __dirname;
type Site = { file: string; line: number; via: string; argsText: string; sub: string };
function sitesOf(file: string): Site[] {
  const src = readFileSync(join(DIR, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const gitBins = new Set<string>();
  const out: Site[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined && /resolveProgram\(\s*'git'\s*\)/u.test(n.initializer.getText(sf))) gitBins.add(n.name.text);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text; const a0 = n.arguments[0];
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (name === 'moduleGit' && a0 !== undefined) {
        const t = a0.getText(sf);
        out.push({ file, line, via: 'moduleGit', argsText: t, sub: /safeDir\([^)]*\),\s*'([a-z-]+)'/u.exec(t)?.[1] ?? '?' });
      } else if (['execFileSync', 'execFile', 'spawn', 'spawnImpl', 'spawnSync', 'execSync', 'exec', 'fork'].includes(name) && a0 !== undefined) {
        const prog = a0.getText(sf);
        all.push(`${file}:${name}:${prog}`);
        if (/['"`]git['"`]/u.test(prog) || gitBins.has(prog)) {
          const t = n.arguments[1]?.getText(sf) ?? '';
          out.push({ file, line, via: name, argsText: t, sub: /safeDir\([^)]*\),\s*'([a-z-]+)'/u.exec(t)?.[1] ?? (t === 'argv.slice(1)' ? '(capture)' : '?') });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const files = readdirSync(DIR).filter((f) => /^e2-.*\.ts$/u.test(f) && !f.endsWith('.test.ts') && f !== 'e2-test-kit.ts');
const all: string[] = [];
const sites = files.flatMap(sitesOf);

describe('every git invocation in the e2 gate/spec/diff path carries the pins', () => {
  it('the exact set of git argv sites (file, subcommand, via)', () => {
    expect(sites.map((s) => `${s.file}:${s.via}:${s.sub}`)).toEqual([
      'e2-evidence-gate.ts:execFile:(capture)',
      'e2-evidence-gate.ts:execFileSync:cat-file',
      'e2-evidence-gate.ts:execFileSync:ls-tree',
      'e2-evidence-gate.ts:execFileSync:ls-tree',
      'e2-evidence-gate.ts:moduleGit:diff',
      'e2-evidence-gate.ts:moduleGit:merge-base',
      'e2-evidence-gate.ts:moduleGit:diff',
      'e2-evidence-gate.ts:moduleGit:rev-parse',
    ]);
  });
  it('every child_process call in the e2 files is one of these git sites or the runner spawnImpl (which runs only allowlisted verifier argv or isModuleGit argv)', () => {
    expect(all).toEqual([
      'e2-evidence-gate.ts:spawnImpl:bin', "e2-evidence-gate.ts:spawnImpl:'taskkill'" /* Windows process-tree kill, not git */, 'e2-evidence-gate.ts:execFile:bin',
      'e2-evidence-gate.ts:execFileSync:bin', 'e2-evidence-gate.ts:execFileSync:bin', 'e2-evidence-gate.ts:execFileSync:bin',
    ]);
  });
  it('each argv site spreads GIT_PINS and safeDir(); the capture site only runs module-minted argv', () => {
    const bad = sites.filter((s) => s.sub === '(capture)' ? false : !(s.argsText.includes('...GIT_PINS') && /\.\.\.safeDir\(/u.test(s.argsText)));
    expect(bad).toEqual([]);
    const src = readFileSync(join(DIR, 'e2-evidence-gate.ts'), 'utf8');
    const cap = sites.find((s) => s.sub === '(capture)');
    expect(cap).toBeDefined();
    expect(src.split('\n').slice(Math.max(0, (cap?.line ?? 1) - 4), cap?.line).join('\n')).toMatch(/!isModuleGit\(argv\)\)\s*\{\s*resolve\(null\)/u);
  });
  it('the pins themselves: safe.directory (realpath), core.hooksPath=/dev/null, core.fsmonitor=false', () => {
    const pins = G.e2GitPins(DIR);
    const kv = pins.filter((_, i) => pins[i - 1] === '-c');
    expect(kv).toContain('core.hooksPath=/dev/null');
    expect(kv).toContain('core.fsmonitor=false');
    expect(kv.filter((x) => x.startsWith('safe.directory='))).toEqual([`safe.directory=${DIR}`]);
  });
});
