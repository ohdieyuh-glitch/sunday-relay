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
import * as S from './e2-safe-git';

const DIR = __dirname;
type Site = { file: string; line: number; via: string; argsText: string; sub: string; callText: string };
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
        out.push({ file, line, via: 'moduleGit', argsText: t, callText: (ts.isCallExpression(n.parent) ? n.parent : n).getText(sf), sub: /safeDir\([^)]*\),\s*'([a-z-]+)'/u.exec(t)?.[1] ?? '?' });
      } else if (['execFileSync', 'execFile', 'spawn', 'spawnImpl', 'spawnSync', 'execSync', 'exec', 'fork'].includes(name) && a0 !== undefined) {
        const prog = a0.getText(sf);
        all.push(`${file}:${name}:${prog}`);
        if (/['"`]git['"`]/u.test(prog) || gitBins.has(prog)) {
          const t = n.arguments[1]?.getText(sf) ?? '';
          out.push({ file, line, via: name, argsText: t, callText: n.getText(sf), sub: /safeDir\([^)]*\),\s*'([a-z-]+)'/u.exec(t)?.[1] ?? (t === 'argv.slice(1)' ? '(capture)' : '?') });
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
      'e2-safe-git.ts:execFileSync:?' /* round 8 R7-1: the one site in the safe primitive (sg) */,
    ]);
    expect(sites.length).toBe(9);
  });
  it('every child_process call in the e2 files is one of these git sites or the runner spawnImpl (which runs only allowlisted verifier argv or isModuleGit argv)', () => {
    expect(all).toEqual([
      'e2-evidence-gate.ts:spawnImpl:bin', "e2-evidence-gate.ts:spawnImpl:'taskkill'" /* Windows process-tree kill, not git */, 'e2-evidence-gate.ts:execFile:bin',
      'e2-evidence-gate.ts:execFileSync:bin', 'e2-evidence-gate.ts:execFileSync:bin', 'e2-evidence-gate.ts:execFileSync:bin',
      "e2-safe-git.ts:execFileSync:'git'",
    ]);
  });
  it('each argv site spreads GIT_PINS and safeDir(); the capture site only runs module-minted argv', () => {
    const bad = sites.filter((s) => s.sub === '(capture)' ? false : !((s.argsText.includes('...GIT_PINS') && /\.\.\.safeDir\(/u.test(s.argsText)) || s.argsText.startsWith('[...e2GitPins(')));
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
  /* Round 8 R7-5: the FULL pin list (Skywalker: the r12 test checked only hooksPath/fsmonitor; core.pager was covered
     only by the literal-argv test). Every argv site spreads GIT_PINS (above), so pinning GIT_PINS exactly and forbidding
     any later '-c'/flag override at a site checks every pin at every site. */
  const EXPECTED_PINS = ['--no-replace-objects',
    ...['diff.noprefix=false', 'diff.renames=false', 'core.quotepath=false', 'diff.mnemonicPrefix=false', 'color.ui=never', 'diff.relative=false',
      'diff.suppressBlankEmpty=false', 'core.autocrlf=false', 'diff.context=3', 'diff.interHunkContext=0', 'diff.orderFile=/dev/null', 'diff.srcPrefix=a/',
      'diff.dstPrefix=b/', 'diff.algorithm=myers', 'diff.indentHeuristic=true', 'core.attributesFile=/dev/null', 'diff.wsErrorHighlight=none',
      'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.sshCommand=/bin/false', 'protocol.allow=never', 'core.pager=cat', 'diff.external=',
      'core.useReplaceRefs=false'].flatMap((kv) => ['-c', kv]),
    '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904'];
  it('R7-5: e2GitPins is exactly the 24 -c pins (23 + core.useReplaceRefs), --no-replace-objects, --attr-source, then safe.directory', () => {
    expect(G.e2GitPins(DIR)).toEqual([...EXPECTED_PINS, '-c', `safe.directory=${DIR}`]);
    expect(EXPECTED_PINS.filter((x) => x === '-c').length).toBe(24);
    expect(EXPECTED_PINS).toContain('core.pager=cat');
  });
  it('R7-5: no site adds a -c or global option after the pins (no override), and every site runs with E2_GIT_ENV', () => {
    for (const s of sites) {
      if (s.sub === '(capture)') { expect(s.callText).toMatch(/env/u); continue; }
      const after = s.argsText.includes('...safeDir(') ? s.argsText.slice(s.argsText.indexOf('...safeDir(')) : s.argsText.slice(s.argsText.indexOf(')') + 1);
      expect(after, `${s.file}:${s.line}`).not.toMatch(/'-c'|'--(?:git-dir|work-tree|exec-path|namespace|attr-source|config-env)/u);
      /* moduleGit argv get their env from the runner/CAPTURE (both fixed to E2_GIT_ENV, checked below), never the caller. */
      if (s.via !== 'moduleGit') expect(s.callText, `${s.file}:${s.line}`).toMatch(/\.\.\.E2_GIT_ENV/u);
    }
    const src = readFileSync(join(DIR, 'e2-evidence-gate.ts'), 'utf8');
    expect(src).toMatch(/isModuleGit\(argv\)\s*\?\s*\{ LANG: 'C\.UTF-8', LC_ALL: 'C\.UTF-8', \.\.\.E2_GIT_ENV,/u);
    expect(src).toMatch(/env: \{ LANG: 'C\.UTF-8', LC_ALL: 'C\.UTF-8', \.\.\.E2_GIT_ENV, GIT_NO_REPLACE_OBJECTS: '1', PATH: E2_VERIFIER_PATH \} \}, \(e, out\)/u);
    /* the safe primitive's one extra pin, and its env puts caller extras BEFORE the gate env. */
    expect(S.SAFE_GIT_EXTRA_PINS).toEqual(['-c', 'commit.gpgSign=false']);
    expect(readFileSync(join(DIR, 'e2-safe-git.ts'), 'utf8')).toMatch(/env: \{ \.\.\.\(opts\.env \?\? \{\}\), LANG: 'C\.UTF-8', LC_ALL: 'C\.UTF-8', \.\.\.E2_GIT_ENV, GIT_DIR: c\.gitDir,[^}]*PATH: E2_VERIFIER_PATH \}/u);
    expect(G.E2_GIT_ENV).toEqual({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1',
      GIT_GRAFT_FILE: '/dev/null', GIT_REPLACE_REF_BASE: 'refs/e2-no-replace/', GIT_NO_REPLACE_OBJECTS: '1' });
  });
});
