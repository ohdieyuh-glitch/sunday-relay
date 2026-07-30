import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * BOUNDARY-SCANNER REGRESSION SUITE (H-4 and H-5).
 *
 * H-4 — the synthetic-fixture allowance was a FILE-WIDE secret-scanner bypass:
 *   1. the annotated line was found with `content.indexOf(match)` — the FIRST
 *      occurrence of that text — so annotating one placeholder laundered every
 *      later identical value in the file, and the finding was reported against
 *      the wrong line;
 *   2. the annotation was accepted unconditionally, so a REAL usable
 *      credential could be annotated away;
 *   3. it was honoured anywhere: production source, a workflow, a `.env`.
 *
 * H-5 — deployment detection had regressed against the base scanner:
 *   `vercel --prod` matched nothing; only `.github/workflows/**` was read, so
 *   package scripts and shell wrappers were invisible; deployment ACTIONS were
 *   an allowlist of six exact strings; and `relay-boundary:allow-mention`
 *   silenced the whole line including an executable command on it.
 *
 * Both scanners are run END TO END against throwaway git repositories, and the
 * deployment cases are additionally run against the BASE scanner extracted
 * from git, so "the head detects everything the base did" is measured rather
 * than asserted.
 *
 * Every credential-shaped string here is assembled from fragments and lives
 * only in a temp directory deleted in `afterAll`, so this file contains no
 * matchable literal and the scanner stays honest when it scans itself.
 */

const REPO_ROOT = resolve(__dirname, '..');
const SCANNER = join(REPO_ROOT, 'scripts', 'relay-repository-boundary.mjs');

/**
 * The exact head PR #2 was blocked at. Pinning the SHA rather than a relative
 * ref keeps this comparison anchored to the REVIEWED baseline as commits are
 * added on top; a relative ref would quietly start comparing the repair
 * against itself.
 */
const REVIEWED_BASE_SHA = 'd21d383ab020a7039ee877d5270cd513470d943b';

let workspace: string;
let baseScanner: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'relay-scanner-regression-'));
  // The PRE-REPAIR scanner, taken verbatim from the reviewed commit, so the
  // base/head comparison below is a measurement and not a transcription.
  baseScanner = join(workspace, 'base-relay-repository-boundary.mjs');
  const base = execFileSync(
    'git',
    ['show', `${REVIEWED_BASE_SHA}:scripts/relay-repository-boundary.mjs`],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  writeFileSync(baseScanner, base);
});
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

interface RunResult { code: number; output: string }

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(workspace, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Regression Test'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

function runScanner(script: string, cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

const scan = (files: Record<string, string>) => runScanner(SCANNER, repoWith(files));
const scanWithBase = (files: Record<string, string>) => runScanner(baseScanner, repoWith(files));

const baseline = (): Record<string, string> => ({
  'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { test: 'vitest run' } }, null, 2),
  'src/relay/core/app.ts': 'export const relay = true;\n',
});

/* Credential shapes, assembled so this file contains no matchable literal. */
const AKIA = 'AKIA';
const SK = 'sk' + '-';
const REAL_AWS = `${AKIA}${'J3QK7ZP2W9RMT4XC'}`;          // 15 distinct chars — usable-looking
const SYNTHETIC_AWS = `${AKIA}${'QQQQQQQQQQQQQQQQ'}`;      // 4 distinct chars — obviously fake
const REAL_ANTHROPIC = `${SK}${'ant-'}${'api03-9fKq2Lm7Rt4XwZ8vB6nH1jD5gS3pY0cU7eI4oA2mQ'}`;
const ANNOTATION = 'relay-boundary:allow-fixture';
const MENTION = 'relay-boundary:allow-mention';

/* ================================================================== H-4 */

describe('H-4 — the fixture allowance is per occurrence, not per file', () => {
  it('one annotation cannot launder an identical secret later in the same file', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts':
        `export const a = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n`
        + 'export const spacer = 1;\n'
        + `export const b = '${SYNTHETIC_AWS}';\n`, // same value, NO annotation
    });
    expect(result.code, `the unannotated second occurrence was laundered:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[secret]');
    // Reported against the line it was actually found on — line 3, not line 1.
    expect(result.output).toMatch(/fixture\.test\.ts:3 —/);
    expect(result.output).not.toMatch(/fixture\.test\.ts:1 —/);
  });

  it('reports the EXACT matched line, not the first occurrence of the value', () => {
    const result = scan({
      ...baseline(),
      'src/relay/leak.ts': `const pad = 1;\nconst pad2 = 2;\nconst pad3 = 3;\nexport const k = '${REAL_AWS}';\n`,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/leak\.ts:4 —/);
  });

  it('repeated identical values are judged independently — only the annotated one is allowed', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts':
        `export const a = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n`
        + `export const b = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n`
        + `export const c = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a realistic credential CANNOT be annotated away', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `export const k = '${REAL_AWS}'; // ${ANNOTATION}\n`,
    });
    expect(result.code, `a usable-looking key was annotated away:\n${result.output}`).toBe(1);
    expect(result.output).toContain('not obviously synthetic');
  });

  it('an annotation in PRODUCTION source is ignored', () => {
    const result = scan({
      ...baseline(),
      'src/relay/core/config.ts': `export const k = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('production source may never carry a fixture allowance');
  });

  it('an annotation in a WORKFLOW is ignored', () => {
    const result = scan({
      ...baseline(),
      '.github/workflows/leak.yml':
        `name: leak\njobs:\n  x:\n    steps:\n      - run: echo ${SYNTHETIC_AWS} # ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('a workflow file may never carry a fixture allowance');
  });

  it('an annotation in ENVIRONMENT configuration is ignored', () => {
    for (const path of ['.env', '.env.example', 'relay.env', '.envrc']) {
      const result = scan({ ...baseline(), [path]: `AWS_KEY=${SYNTHETIC_AWS} # ${ANNOTATION}\n` });
      expect(result.code, `${path}:\n${result.output}`).toBe(1);
      expect(result.output).toContain('environment configuration file may never carry a fixture allowance');
    }
  });

  it('an annotation on the line ABOVE is accepted — structural association, not just same-line', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `// ${ANNOTATION}\nexport const k = '${SYNTHETIC_AWS}';\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('an annotation TWO lines above does not reach the value', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `// ${ANNOTATION}\nconst unrelated = 1;\nexport const k = '${SYNTHETIC_AWS}';\n`,
    });
    expect(result.code, result.output).toBe(1);
  });

  it('an annotation cannot suppress an UNRELATED finding on the same line', () => {
    const focused = `it${'.'}only('x', () => {}); // ${ANNOTATION}\n`;
    const result = scan({ ...baseline(), 'src/relay/x.test.ts': focused });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[focused-test]');
  });

  it('an annotation cannot suppress a DIFFERENT secret shape on the same line', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts':
        `export const pair = ['${SYNTHETIC_AWS}', '${REAL_ANTHROPIC}']; // ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[secret]');
  });

  it('the marked-placeholder path still works with no annotation at all', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `export const k = '${SK}FAKETESTNOTREAL0000000000000000000000';\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a marker glued onto a real key is still reported', () => {
    const result = scan({
      ...baseline(),
      'src/relay/leak.ts': `export const k = '${REAL_ANTHROPIC}-FAKE';\n`,
    });
    expect(result.code, result.output).toBe(1);
  });
});

/**
 * The same measurement for the fixture allowance: each case is a bypass that
 * the BASE scanner accepted (exit 0 — the secret stayed committed) and the
 * head scanner must reject.
 */
const FIXTURE_BYPASS_CASES: Array<[string, Record<string, string>]> = [
  [
    'one annotation launders an identical value later in the file',
    {
      'src/relay/fixture.test.ts':
        `export const a = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\nexport const b = '${SYNTHETIC_AWS}';\n`,
    },
  ],
  [
    'a realistic credential annotated as a fixture',
    { 'src/relay/fixture.test.ts': `export const k = '${REAL_AWS}'; // ${ANNOTATION}\n` },
  ],
  [
    'a fixture annotation in production source',
    { 'src/relay/core/config.ts': `export const k = '${REAL_AWS}'; // ${ANNOTATION}\n` },
  ],
  [
    'a fixture annotation in a workflow',
    {
      '.github/workflows/leak.yml':
        `name: leak\njobs:\n  x:\n    steps:\n      - run: echo ${REAL_AWS} # ${ANNOTATION}\n`,
    },
  ],
  [
    'a fixture annotation in environment configuration',
    { '.env.example': `AWS_KEY=${REAL_AWS} # ${ANNOTATION}\n` },
  ],
  [
    'a realistic provider key annotated in a fixture file',
    { 'src/relay/fixture.test.ts': `export const k = '${REAL_ANTHROPIC}'; // ${ANNOTATION}\n` },
  ],
];

describe('H-4 — every reported bypass is accepted by the base scanner and rejected by the head', () => {
  it('measures base and head over every fixture-allowance bypass', () => {
    const stillBypassed: string[] = [];
    let acceptedByBase = 0;
    let rejectedByHead = 0;

    for (const [label, files] of FIXTURE_BYPASS_CASES) {
      const tree = { ...baseline(), ...files };
      if (scanWithBase(tree).code === 0) acceptedByBase += 1;
      if (scan(tree).code === 1) rejectedByHead += 1;
      else stillBypassed.push(label);
    }

    const total = FIXTURE_BYPASS_CASES.length;
    // eslint-disable-next-line no-console
    console.log(
      `\nFIXTURE-ALLOWANCE BYPASSES — base ACCEPTED ${acceptedByBase}/${total} (the secret stayed committed), `
      + `head REJECTED ${rejectedByHead}/${total}`,
    );

    expect(stillBypassed, 'these fixture bypasses still work on the head scanner').toEqual([]);
    expect(acceptedByBase, 'each case must reproduce a bypass the base scanner accepted').toBe(total);
    expect(rejectedByHead).toBe(total);
  }, 120_000);
});

/* ================================================================== H-5 */

/** A one-step workflow around `step`. */
const workflowWith = (step: string) => ({
  '.github/workflows/relay-ci.yml':
    `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
});

/**
 * ACTIVE deployment paths. Every one of these must fail on the head scanner,
 * and each is additionally measured against the base scanner below.
 */
const ACTIVE_DEPLOY_CASES: Array<[string, Record<string, string>]> = [
  ['vercel --prod', workflowWith('      - run: vercel --prod')],
  ['npx vercel --prod', workflowWith('      - run: npx vercel --prod')],
  ['vercel deploy', workflowWith('      - run: vercel deploy')],
  ['railway up', workflowWith('      - run: railway up')],
  ['flyctl deploy', workflowWith('      - run: flyctl deploy --remote-only')],
  ['netlify deploy', workflowWith('      - run: netlify deploy --prod')],
  ['wrangler deploy', workflowWith('      - run: wrangler deploy')],
  ['surge', workflowWith('      - run: surge ./dist relay.example.com')],
  ['heroku', workflowWith('      - run: heroku container:release web')],
  ['docker push', workflowWith('      - run: docker push registry.example.com/relay:latest')],
  ['kubectl apply', workflowWith('      - run: kubectl apply -f k8s/')],
  ['helm upgrade', workflowWith('      - run: helm upgrade relay ./chart')],
  ['terraform apply', workflowWith('      - run: terraform apply -auto-approve')],
  ['npm publish', workflowWith('      - run: npm publish --access public')],
  ['gh release create', workflowWith('      - run: gh release create v1.0.0')],
  ['supabase db push', workflowWith('      - run: supabase db push')],
  ['a deployment webhook', workflowWith('      - run: curl -X POST https://api.render.com/deploy/srv-abc?key=xyz')],
  ['the listed vercel action', workflowWith('      - uses: amondnet/vercel-action@v25')],
  ['an UNLISTED deployment action', workflowWith('      - uses: some-vendor/cloud-deploy-action@v3')],
  ['a shell wrapper', { 'scripts/deploy.sh': '#!/usr/bin/env bash\nset -euo pipefail\nvercel --prod\n' }],
  [
    'a deploying package script',
    { 'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { deploy: 'vercel --prod' } }, null, 2) },
  ],
  [
    'a workflow running a deploying package script',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'railway up' } }, null, 2),
      ...workflowWith('      - run: npm run ship'),
    },
  ],
  ['a run: block scalar', workflowWith('      - run: |\n          echo building\n          vercel --prod')],
  ['sh -c around a deploy', workflowWith('      - run: sh -c "npm run build && railway up"')],
  ['allow-mention on an executable command', workflowWith(`      - run: vercel --prod # ${MENTION}`)],
];

describe('H-5 — active deployment behaviour is detected wherever it lives', () => {
  for (const [label, files] of ACTIVE_DEPLOY_CASES) {
    it(`detects ${label}`, () => {
      const result = scan({ ...baseline(), ...files });
      expect(result.code, `${label} was NOT detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    });
  }

  it('allow-mention cannot silence an executable deployment command, and says so', () => {
    const result = scan({ ...baseline(), ...workflowWith(`      - run: vercel --prod # ${MENTION}`) });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('IGNORED — it cannot silence an executable command');
  });

  it('never prints "no active deployment command" when one exists', () => {
    const result = scan({ ...baseline(), ...workflowWith('      - run: vercel --prod') });
    expect(result.output).not.toContain('no active deployment command');
    expect(result.output).toContain('RELAY REPOSITORY BOUNDARY: FAIL');
  });
});

describe('H-5 — documentation, prose and inert samples are NOT deployment', () => {
  it('a comment stating the workflow never deploys passes', () => {
    const result = scan({
      ...baseline(),
      ...workflowWith(
        '      # This workflow never deploys: no Vercel, no Railway, no Fly.\n'
        + '      - name: Confirm no Vercel or Railway deployment is configured\n'
        + '        run: echo "no deploy here"',
      ),
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a markdown document describing deployment passes', () => {
    const result = scan({
      ...baseline(),
      'docs/relay/DEPLOYMENT.md': '# Deployment\n\nRelay does not deploy. We do not run `vercel --prod`.\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('an inert sample inside a TEST file passes', () => {
    const result = scan({
      ...baseline(),
      'src/relay/deploy-detection.test.ts': "const sample = 'vercel --prod';\nexport const s = sample;\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a non-executing YAML title naming a vendor passes with an allow-mention', () => {
    const result = scan({
      ...baseline(),
      ...workflowWith(`      - name: assert vercel deploy is absent # ${MENTION}\n        run: echo ok`),
    });
    expect(result.code, result.output).toBe(0);
  });
});

/* ---------------------------------------------- base vs head coverage */

describe('H-5 — the head scanner detects everything the base scanner did', () => {
  // Each case builds two throwaway git repositories and runs two scanners, so
  // this is deliberately slower than a unit test. The timeout is explicit
  // rather than inherited, so a slow machine reports a real result instead of
  // a timeout that could be mistaken for a failure.
  it('measures base and head over every active deployment case', () => {
    const missedByHead: string[] = [];
    const newlyCaughtByHead: string[] = [];
    const missedByBoth: string[] = [];
    let caughtByBase = 0;
    let caughtByHead = 0;

    for (const [label, files] of ACTIVE_DEPLOY_CASES) {
      const tree = { ...baseline(), ...files };
      const base = scanWithBase(tree);
      const head = scan(tree);
      if (base.code === 1) caughtByBase += 1;
      if (head.code === 1) caughtByHead += 1;
      if (base.code === 1 && head.code !== 1) missedByHead.push(label);
      if (base.code !== 1 && head.code === 1) newlyCaughtByHead.push(label);
      if (base.code !== 1 && head.code !== 1) missedByBoth.push(label);
    }

    const total = ACTIVE_DEPLOY_CASES.length;
    // Both figures are MEASURED. Printing a hardcoded denominator would be the
    // same class of misleading assertion this repair set out to remove.
    // eslint-disable-next-line no-console
    console.log(
      `\nDEPLOYMENT COVERAGE — base caught ${caughtByBase}/${total}, head caught ${caughtByHead}/${total}`
      + `\n  newly caught by head (${newlyCaughtByHead.length}):\n    ${newlyCaughtByHead.join('\n    ')}`
      + (missedByBoth.length ? `\n  MISSED BY BOTH (${missedByBoth.length}):\n    ${missedByBoth.join('\n    ')}` : ''),
    );

    expect(missedByHead, 'the head scanner REGRESSED on these base-detected cases').toEqual([]);
    expect(missedByBoth, 'these active deployment paths are detected by neither scanner').toEqual([]);
    expect(caughtByHead, 'the head scanner must catch every active deployment case').toBe(total);
    expect(newlyCaughtByHead.length, 'the head scanner must add coverage, not just match').toBeGreaterThan(0);
  }, 120_000);

  it('base and head agree that prose is not deployment', () => {
    const tree = {
      ...baseline(),
      'docs/relay/DEPLOYMENT.md': '# Deployment\n\nRelay does not deploy.\n',
    };
    expect(scan(tree).code, 'head must not fail on documentation').toBe(0);
    expect(scanWithBase(tree).code, 'base did not fail on documentation either').toBe(0);
  });
});
