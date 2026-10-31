/* Round 9 (Skywalker 8439b565 N8-1, N8-2): two base-file bypasses of the parse allowlist carried the child-v8 forgery to
   a full-gate PASS 3/3. Reproduced here through the FULL gate (spec with base run -> reexec -> diff -> e2Gate). */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as G from './e2-evidence-gate';
import * as S from './e2-safe-git';
import { FORGE_F3 } from './e2-forge-f3-r14.fixture';
import { MODEL, RUN, START, anchorOf, call, git, liveCapture, makeRepo, tail } from './e2-test-kit';
import { pinT, recordGitDiffT } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-n8-r14-')));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
let k = 0;
/** Round 10: the wiring contract end to end: store before the coder -> pin from it -> coder edits the worktree -> snapshot -> diff (throwaway dir + store) -> gate -> dispose. */
/* Round 11 (Skywalker 8:4x PM, PILOT R10-2): `foreign` chowns the whole workspace to uid 65534 BEFORE the store is built
   (the live workspace is chowned to the sandbox uid while the gate runs as the runner user); the coder's edits are then
   written as that uid via sudo. Needs passwordless sudo; the caller asserts sudo availability in both branches. */
const SUDO = ((): boolean => { try { execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ME = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
export async function trustedGate(base: Record<string, string>, head: Record<string, string>, cmd: string, opts: { foreign?: true } = {}): Promise<{ refused?: string; gate?: 'PASS' | readonly string[]; summary?: unknown }> {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  const { base: b } = makeRepo(repo, base, {}, W); git(repo, 'reset', '-q', '--hard', b);
  const write = (p: string, c: string): void => {
    if (opts.foreign !== true) { W(join(repo, p), c); return; }
    /* the scratch root is 0700 (runner-owned), so root writes and the tree is re-chowned to the sandbox uid */
    execFileSync('sudo', ['-n', 'sh', '-c', 'mkdir -p "$1" && cat > "$2" && chown -R 65534:65534 "$3"', 'w', dirname(join(repo, p)), join(repo, p), repo], { input: c, stdio: ['pipe', 'ignore', 'ignore'] });
  };
  if (opts.foreign === true) { execFileSync('sudo', ['-n', 'chown', '-R', '65534:65534', repo]); execFileSync('sudo', ['-n', 'chmod', '-R', 'go-w', repo]); }
  try { return await trustedFlow(repo, b, head, cmd, write); } finally { if (opts.foreign === true) execFileSync('sudo', ['-n', 'chown', '-R', ME, repo]); }
}
async function trustedFlow(repo: string, b: string, head: Record<string, string>, cmd: string, write: (p: string, c: string) => void): Promise<{ refused?: string; gate?: 'PASS' | readonly string[]; summary?: unknown }> {
  const store = S.buildTrustedSeedStore({ seed: repo, base: b });
  if ('refused' in store) return { refused: store.refused };
  try {
    const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
    const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: cmd, workspace: repo, base: b, trustedObjects: store.objects }, runner);
    if ('refused' in spec) return { refused: spec.refused };
    for (const [p, c] of Object.entries(head)) write(p, c);
    const snap = S.snapshotCommitSafely({ workspace: repo, parent: b, message: 'snapshot', author: { name: 'j', email: 'j@x' }, trustedObjects: store.objects });
    if ('refused' in snap) return { refused: snap.refused };
    try {
      const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
      const diff = await G.recordGitDiff({ base: b, head: snap.head, cwd: repo, runner, objectDir: snap.objectDir.path, trustedObjects: store.objects });
      const { lines, evidence } = await liveCapture(root, `s${k}.jsonl`, START + Object.keys(head).map((p, i) => call(`c${i}`, 'edit_file', { path: p })).join('') + tail());
      const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base: b, head: snap.head, workspace: repo }, modelId: MODEL });
      return { gate: g.ok ? 'PASS' : g.reasons, summary: reexec?.commands.map((c) => c.testSummary) };
    } finally { snap.dispose(); }
  } finally { store.dispose(); }
}
export async function fullGate(base: Record<string, string>, head: Record<string, string>, cmd: string): Promise<{ refused?: string; gate?: 'PASS' | readonly string[]; summary?: unknown }> {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  const { base: b, head: h } = makeRepo(repo, base, head, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
  const spec = await pinT({ testCommand: cmd, workspace: repo, base: b }, runner);
  if ('refused' in spec) return { refused: spec.refused };
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const diff = await recordGitDiffT({ base: b, head: h, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `s${k}.jsonl`, START + Object.keys(head).map((p, i) => call(`c${i}`, 'edit_file', { path: p })).join('') + tail());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base: b, head: h, workspace: repo }, modelId: MODEL });
  return { gate: g.ok ? 'PASS' : g.reasons, summary: reexec?.commands.map((c) => c.testSummary) };
}
const LIB = 'module.exports=(x)=>x+1;\n';
const TR = (load: string): string => "import t from 'node:test'; import a from 'assert'; " + load + '\n' + [0, 1, 2].map((i) => `t('c${i}',()=>a.strictEqual(f(${i}),${i + 1}));`).join('\n') + '\n';
const FORGE = `require('fs').writeSync(1,Buffer.from('${FORGE_F3}','base64'));process.exit(0);\n`;
const C = 'node --test t.test.mjs';
const N81 = "const kk='constr'+'uctor';const FF=(()=>0)[kk];const f=FF('return this.process.mainM'+'odule.require')()('./lib.js');";
/* N8-2 repro body, used in the N8-2 block below. */
export const N82 = "let f; x = 0 <!-- `\nf=require('./lib.js')\n// `";

describe('N8-1: a pure index read reaching Function', () => {
  it('control: the forgery behind a literal require of a coder module is refused (imports_untrusted)', async () => {
    expect(await fullGate({ 'lib.js': LIB, 't.test.mjs': TR("const f=require('./lib.js');") }, { 'lib.js': FORGE }, C)).toEqual({ refused: 'spec_pinned_test_imports_untrusted' });
  }, 60_000);
  it('Skywalker repro (B_forge_index_function) through the full gate: refused, never PASS', async () => {
    const r = await fullGate({ 'lib.js': LIB, 't.test.mjs': TR(N81) }, { 'lib.js': FORGE }, C);
    expect(r.gate).not.toBe('PASS');
    expect(r).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
  }, 60_000);
  const variants: Array<[string, string]> = [
    ['concat key on an arrow', "const k='constr'+'uctor'; const F=(()=>0)[k];\n"],
    ['template-literal key', "const k=`constr${'uctor'}`; const F=(function(){})[k];\n"],
    ['plain template key', "const k=`__proto__`; const o={}; const p=o[k];\n"],
    ['literal string assigned then used', "const k='constructor'; const o={}; const F=o[k];\n"],
    ['optional chaining index on an arrow', "const k='x'; const F=(()=>0)?.[k];\n"],
    ['index on a class expression', "const k='x'; const F=(class {})[k];\n"],
    ['index on a function expression', "const k='x'; const F=(function(){})[k];\n"],
    ['member on an arrow', "const F=(()=>0).call;\n"],
    ['destructuring constructor', "const { constructor: F } = () => 0;\n"],
    ['destructuring with a concat computed key', "const { ['constr'+'uctor']: F } = () => 0;\n"],
    ['Object.getPrototypeOf', "const P = Object.getPrototypeOf(() => 0);\n"],
    ['.constructor', "const F = (() => 0).constructor;\n"],
    ['prototype via concat', "const k='proto'+'type'; const o={}; const p=o[k];\n"],
  ];
  variants.push(
    ['PILOT R8-1: literal constructor key via a variable, arrow block body', "const k='constructor'; const F=(()=>{})[k]; F('return 1')();\n"],
    ['PILOT R8-1: class X{}; X[k]', "class X {} const k='a'+'b'; const F=X[k]; F('return 1');\n"],
    ['PILOT R8-1: runtime-built key, result called', "const s='xab'; const k=s.slice(1); const o={}; const F=o[k]; F();\n"],
    ['PILOT R8-1: runtime-built key, result passed to a function', "const k='ab'.slice(1); const o={}; String(o[k]);\n"],
    ['PILOT R8-1: index result stored in a let', "const k='ab'.slice(1); const o={}; let F=o[k];\n"],
    ['PILOT R8-1: index result returned', "const g=(o,k)=>o[k];\n"],
    ['PILOT R8-1: string eval anywhere', "const x='eval';\n"],
    ['PILOT R8-1: string child_process anywhere', "const x='node:child_'+'process';\n"],
    ['PILOT R8-1: shadowed assert is not trusted', "import assert from 'node:assert';\nfunction f(assert){ const k='ab'.slice(1); const o={}; assert.equal(o[k]); }\n"],
  );
  for (const [name, src] of variants) {
    it(`scan refuses: ${name}`, () => { expect(G.scanPinnedSource(src)).toBe('spec_pinned_test_dynamic_load'); });
  }
  it('ordinary index reads stay accepted', () => {
    expect(G.scanPinnedSource("import assert from 'node:assert';\nconst a=[1,2]; let i=0; const s='ab'; const c=s[i]; let out='';\nif (a[i+1] === 2 && c !== 'x') out += c;\nassert.equal(s[i], 'a'); /\\w/.test(s[i - 1] ?? '');\n")).toBeNull();
  });
});

describe('N8-1 (a): every verifier child runs with --disallow-code-generation-from-strings', () => {
  it('a base test that builds code from strings fails in the verifier run (EvalError), so even an unscanned route gives no Function', async () => {
    const dir = join(root, `dcg${k++}`); mkdirSync(dir);
    W(join(dir, 't.test.mjs'), "import t from 'node:test'; import a from 'node:assert'; \nt('blocked',()=>{a.throws(()=>new (Object.getPrototypeOf(()=>0).constructor)('return 1'),EvalError);a.throws(()=>eval('1'),EvalError);});\n");
    const r = await G.spawnVerifierRunner({ timeoutMs: 60_000 })(['node', '--test', '--test-reporter=tap', 't.test.mjs'], dir);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});

describe('N8-1 (a): the real missions still pass with the flag on (full gate)', () => {
  const REPO = join(__dirname, '..', '..');
  it('julius-inworld-data-1: oracle output PASS 4/4', async () => {
    const { readFileSync } = await import('node:fs');
    const MIS = join(REPO, 'relay-bridge/julius-inworld-mission/julius-inworld-data-1');
    const seed: Record<string, string> = {};
    for (const f of ['format.test.mjs', 'data/posts.json', 'data/legacy_ledger.csv']) seed[f] = readFileSync(join(MIS, 'seed', f), 'utf8');
    const oracle = await import(join(MIS, 'checker/oracle.mjs')) as { normalize: (c: string, p: unknown) => unknown };
    const norm = JSON.stringify(oracle.normalize(seed['data/legacy_ledger.csv'] as string, JSON.parse(seed['data/posts.json'] as string)));
    const r = await fullGate(seed, { 'out/normalized.json': norm }, 'node --test format.test.mjs');
    expect(r.gate).toBe('PASS');
    expect(JSON.stringify(r.summary)).toMatch(/"pass":4[,}]/u);
    const t = await trustedGate(seed, { 'out/normalized.json': norm }, 'node --test format.test.mjs'); /* Round 10: the wiring contract path */
    expect(t.refused ?? t.gate).toBe('PASS');
    expect(JSON.stringify(t.summary)).toMatch(/"pass":4[,}]/u);
    /* Round 11 R10-2: the same flow with the workspace owned by uid 65534 (real chown via sudo -n). */
    expect(SUDO, 'passwordless sudo is required for the foreign-owned run; without it this run is NOT exercised').toBe(true);
    const f = await trustedGate(seed, { 'out/normalized.json': norm }, 'node --test format.test.mjs', { foreign: true });
    expect(f.refused ?? f.gate).toBe('PASS');
    expect(JSON.stringify(f.summary)).toMatch(/"pass":4[,}]/u);
    const fw = await trustedGate(seed, { 'out/normalized.json': '{}' }, 'node --test format.test.mjs', { foreign: true }); /* control: a wrong answer */
    expect(fw.gate).not.toBe('PASS');
  }, 60_000);
  it('julius-unreal-mission-1: reference solution PASS 5/5', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { relative } = await import('node:path');
    const UM = join(REPO, '.github/julius-missions/julius-unreal-mission-1');
    const seed: Record<string, string> = {};
    const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const q = join(d, e.name); if (e.isDirectory()) walk(q); else if (e.isFile()) seed[relative(join(UM, 'workspace'), q)] = readFileSync(q, 'utf8'); } };
    walk(join(UM, 'workspace'));
    const head: Record<string, string> = {};
    for (const f of ['WonderlandSocialHubPanel.cpp', 'WonderlandSocialHubPanel.h']) head[`wonderland/Source/Wonderland/${f}`] = readFileSync(join(UM, 'dryrun/reference', f), 'utf8');
    const r = await fullGate(seed, head, 'node --test .julius/hub-scroll-static.test.mjs');
    expect(r.gate).toBe('PASS');
    expect(JSON.stringify(r.summary)).toMatch(/"pass":5[,}]/u);
    const t = await trustedGate(seed, head, 'node --test .julius/hub-scroll-static.test.mjs'); /* Round 10: the wiring contract path */
    expect(t.refused ?? t.gate).toBe('PASS');
    expect(JSON.stringify(t.summary)).toMatch(/"pass":5[,}]/u);
    /* Round 11 R10-2: foreign-owned workspace (uid 65534). */
    expect(SUDO, 'passwordless sudo is required for the foreign-owned run; without it this run is NOT exercised').toBe(true);
    const f = await trustedGate(seed, head, 'node --test .julius/hub-scroll-static.test.mjs', { foreign: true });
    expect(f.refused ?? f.gate).toBe('PASS');
    expect(JSON.stringify(f.summary)).toMatch(/"pass":5[,}]/u);
    const fu = await trustedGate(seed, {}, 'node --test .julius/hub-scroll-static.test.mjs', { foreign: true }); /* control: the unchanged seed (4/5) */
    expect(fu.gate).not.toBe('PASS');
  }, 120_000);
});

describe('N8-2: HTML-comment parse divergence + .mjs-only pinned tests (Round 9)', () => {
  const body = "import t from 'node:test'; import a from 'assert';\n" + N82 + "\n" + [0, 1, 2].map((i) => `t('c${i}',()=>a.strictEqual(f(${i}),${i + 1}));`).join('\n') + '\n';
  it('Skywalker exact input as .cjs through the full gate: spec_pinned_test_not_mjs, never PASS', async () => {
    const r = await fullGate({ 'lib.js': LIB, 't.test.cjs': body }, { 'lib.js': FORGE }, 'node --test t.test.cjs');
    expect(r).toEqual({ refused: 'spec_pinned_test_not_mjs' });
  }, 60_000);
  it('Skywalker exact input as .js with no package.json through the full gate: spec_pinned_test_not_mjs', async () => {
    const r = await fullGate({ 'lib.js': LIB, 't.test.js': body }, { 'lib.js': FORGE }, 'node --test t.test.js');
    expect(r).toEqual({ refused: 'spec_pinned_test_not_mjs' });
  }, 60_000);
  it('Skywalker exact input as .mjs through the full gate: spec_pinned_test_html_comment', async () => {
    const r = await fullGate({ 'lib.js': LIB, 't.test.mjs': body }, { 'lib.js': FORGE }, C);
    expect(r).toEqual({ refused: 'spec_pinned_test_html_comment' });
  }, 60_000);
  it('scan refuses <!-- and line-leading --> anywhere', () => {
    expect(G.scanPinnedSource('const x = 1 <!-- y\n')).toBe('spec_pinned_test_html_comment');
    expect(G.scanPinnedSource('const x = 1;\n--> y\n')).toBe('spec_pinned_test_html_comment');
    expect(G.scanPinnedSource("const s = '<!--';\n")).toBe('spec_pinned_test_html_comment');
  });
});
