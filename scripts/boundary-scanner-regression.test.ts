import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Every case builds a throwaway git repository and runs one or two scanner
 * processes; the differential runs both scanners over 55 shapes. The default
 * 5s budget turns a busy machine into a boundary failure, which is a
 * scheduling problem reported as a security finding.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });

const REPO_ROOT = resolve(__dirname, '..');
const SCANNER = join(REPO_ROOT, 'scripts', 'relay-repository-boundary.mjs');

/**
 * The exact head PR #2 was blocked at. Pinning the SHA rather than a relative
 * ref keeps this comparison anchored to the REVIEWED baseline as commits are
 * added on top; a relative ref would quietly start comparing the repair
 * against itself.
 */
const REVIEWED_BASE_SHA = 'd21d383ab020a7039ee877d5270cd513470d943b';

/**
 * The pre-repair scanner is read from a FROZEN COPY rather than from git.
 *
 * `git show <sha>:<path>` worked locally and failed in CI, because
 * `actions/checkout` performs a SHALLOW clone in which the base commit's tree
 * is not available. A regression proof that only runs on a deep clone is
 * exactly the environment-dependent shape this repository has already removed
 * once from its YC tests, so the baseline is checked in instead.
 *
 * The copy is guarded two ways, and BOTH branches assert — a doctored
 * "baseline" that flattered the repair would fail here:
 *
 *   - whenever the git object IS reachable, the copy must be byte-identical
 *     to `git show <sha>:<path>`;
 *   - always, its SHA-256 must equal the digest recorded below.
 */
const BASELINE_PATH = join('scripts', '__baseline__', 'relay-repository-boundary.d21d383.mjs');
const BASELINE_SHA256 = '29d51a010c8deaa2982b77de86e9b8dbee04609859f4af28005f578871273f5f';

let workspace: string;
let baseScanner: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'relay-scanner-regression-'));
  baseScanner = join(REPO_ROOT, BASELINE_PATH);
});

describe('the frozen baseline is genuinely the reviewed scanner', () => {
  it('matches the recorded digest', () => {
    const frozen = readFileSync(join(REPO_ROOT, BASELINE_PATH));
    expect(createHash('sha256').update(frozen).digest('hex')).toBe(BASELINE_SHA256);
  });

  it('is byte-identical to the reviewed commit, whenever that commit is reachable', () => {
    let fromGit: string | null = null;
    try {
      fromGit = execFileSync(
        'git',
        ['show', `${REVIEWED_BASE_SHA}:scripts/relay-repository-boundary.mjs`],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      fromGit = null; // shallow clone — the object is not in this checkout
    }

    if (fromGit === null) {
      // NOT a silent skip: assert the clone really is shallow, so a genuine
      // "the baseline commit is gone" failure cannot hide in this branch.
      const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      expect(shallow, 'the baseline commit is unreachable in a FULL clone').toBe('true');
      return;
    }
    expect(readFileSync(join(REPO_ROOT, BASELINE_PATH), 'utf8')).toBe(fromGit);
  });
});
// Every case builds a throwaway git repository, so the workspace holds
// hundreds of them by the end. The default 10s hook budget is not enough to
// remove that tree on a loaded machine, and a cleanup timeout fails the FILE
// while every test in it passed — a confusing way to report a tidy-up problem.
afterAll(() => rmSync(workspace, { recursive: true, force: true }), 180_000);

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

/** Both scanners over ONE repository — half the git work of scanning twice. */
function scanBoth(files: Record<string, string>): { base: RunResult; head: RunResult } {
  const dir = repoWith(files);
  return { base: runScanner(baseScanner, dir), head: runScanner(SCANNER, dir) };
}

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

/**
 * A high-entropy payload GENERATED AT RUNTIME from a fixed seed.
 *
 * HIGH-1a needs a value whose residue is genuinely key-like once the reserved
 * token is stripped — that is precisely what the defect turned on. Committing
 * such a value, even defanged, is what this repository refuses to do, so the
 * tracked file holds only arithmetic and the scanner receives real-shaped
 * input at run time.
 */
const ENTROPY_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
function entropyPayload(length: number, seed = 20260730): string {
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += ENTROPY_ALPHABET[state % ENTROPY_ALPHABET.length];
  }
  return out;
}
const PAYLOAD = entropyPayload(44);
/** The canonical reserved token. A marker word is not itself secret material. */
const TOKEN = 'FAKETESTNOTREAL';
/** The same usable-looking key with the token glued on in three positions. */
const TOKEN_APPENDED = `${SK}ant-api03-${PAYLOAD}${TOKEN}`;
const TOKEN_PREPENDED = `${SK}ant-${TOKEN}${PAYLOAD}`;
const TOKEN_INSERTED = `${SK}ant-api03-${PAYLOAD.slice(0, 20)}${TOKEN}${PAYLOAD.slice(20)}`;

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

/* ================================================================ HIGH-1a */

/**
 * HIGH-1a — `isObviouslySynthetic` returned true the moment the RESERVED
 * token appeared anywhere in the value, before it computed a residue at all.
 * A real key with `FAKETESTNOTREAL` glued on therefore passed the strict
 * synthetic policy, and an annotation laundered it — contradicting the
 * scanner's own documented rule that "a genuine key with a marker glued on
 * keeps its high-entropy residue and is still reported".
 *
 * These cases carry NO annotation, so the BASE scanner rejects them too. They
 * are kept out of `FIXTURE_BYPASS_CASES` for exactly that reason: that suite
 * asserts every case was a bypass the base accepted.
 */
describe('HIGH-1a — the reserved token is stripped, never trusted', () => {
  const positions: Array<[string, string]> = [
    ['appended after the payload', TOKEN_APPENDED],
    ['prepended before the payload', TOKEN_PREPENDED],
    ['inserted mid-payload', TOKEN_INSERTED],
  ];

  for (const [label, value] of positions) {
    it(`reports a high-entropy key with the token ${label}`, () => {
      const result = scan({ ...baseline(), 'src/relay/leak.ts': `export const k = '${value}';\n` });
      expect(result.code, result.output).toBe(1);
      expect(result.output).toContain('[secret]');
    });
  }

  it('a value that is ONLY the token and padding stays allowed', () => {
    // The repair must not break the convention it exists to protect: strip the
    // token and the residue is padding, which is not key material.
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `export const k = '${SK}${TOKEN}0000000000000000000000';\n`,
    });
    expect(result.code, result.output).toBe(0);
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
  // HIGH-1a — the reserved token glued onto a usable key, then annotated. The
  // base scanner short-circuited on the token's mere presence and accepted all
  // three positions.
  [
    'a high-entropy key with the reserved token appended, annotated',
    { 'src/relay/fixture.test.ts': `export const k = '${TOKEN_APPENDED}'; // ${ANNOTATION}\n` },
  ],
  [
    'a high-entropy key with the reserved token prepended, annotated',
    { 'src/relay/fixture.test.ts': `export const k = '${TOKEN_PREPENDED}'; // ${ANNOTATION}\n` },
  ],
  [
    'a high-entropy key with the reserved token inserted mid-value, annotated',
    { 'src/relay/fixture.test.ts': `export const k = '${TOKEN_INSERTED}'; // ${ANNOTATION}\n` },
  ],
  // HIGH-1b — a shipping production module whose NAME contains "fixtures".
  [
    'a fixture annotation in a production module named fixtures.ts',
    { 'src/relay/product/fixtures.ts': `export const k = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n` },
  ],
  [
    'a fixture annotation in a production module named psp-fixtures.ts',
    { 'src/relay/psp/psp-fixtures.ts': `export const k = '${SYNTHETIC_AWS}'; // ${ANNOTATION}\n` },
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

/** A wrapper that deploys, and one that does not. Written once, used widely. */
const SHIP_MJS = "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n";
const SHIP_TS = "import { execSync } from 'node:child_process';\nexecSync('railway up');\n";
const CHECK_MJS = "// Harmless. This repository never deploys.\nconsole.log('no deployment configured');\n";

/** A package manifest whose one script is `command`. */
const scriptRunning = (command: string, name = 'ship') => ({
  'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { [name]: command } }, null, 2),
});

/**
 * EVERY LAUNCH FORM THAT HID A WRAPPER (M-1 and the launcher gap beside it).
 *
 * Each entry runs a repository-local wrapper whose body deploys. The command
 * is the ONLY thing that varies, so a form that stops resolving fails here
 * rather than quietly reducing coverage.
 */
const NODE_LAUNCH_BYPASSES: Array<[string, string]> = [
  // The exact command the independent review demonstrated.
  ['node --env-file <value> (the reported bypass)', 'node --env-file .env scripts/ship.mjs'],
  ['node --env-file=<value>', 'node --env-file=.env scripts/ship.mjs'],
  ['node -r <value>', 'node -r dotenv/config scripts/ship.mjs'],
  ['node --require <value>', 'node --require dotenv/config scripts/ship.mjs'],
  ['node --import <value>', 'node --import tsx scripts/ship.mjs'],
  ['node --import=<value>', 'node --import=tsx scripts/ship.mjs'],
  ['node --loader <value>', 'node --loader ts-node/esm scripts/ship.mjs'],
  ['node --loader=<value>', 'node --loader=ts-node/esm scripts/ship.mjs'],
  ['node --experimental-loader <value>', 'node --experimental-loader ts-node/esm scripts/ship.mjs'],
  ['node --conditions <value>', 'node --conditions development scripts/ship.mjs'],
  ['node --conditions=<value>', 'node --conditions=development scripts/ship.mjs'],
  ['node -C <value>', 'node -C packages/app scripts/ship.mjs'],
  ['node --env-file-if-exists <value>', 'node --env-file-if-exists .env scripts/ship.mjs'],
  // The safety net: a value-consuming flag this scan has never heard of must
  // not hide the entry either, or the repair is only as good as its table.
  ['node behind a flag the scan does not know', 'node --some-unreleased-flag someValue scripts/ship.mjs'],
  ['node behind two unknown valued flags', 'node --alpha a --beta b scripts/ship.mjs'],
  // A boolean flag never consumed a value, and must not start doing so.
  ['node behind a boolean flag', 'node --experimental-vm-modules scripts/ship.mjs'],
  // `node -e` runs CODE, and a literal local import inside it is a wrapper.
  ['node -e with a literal local import', "node -e \"import('./scripts/ship.mjs')\""],
  // Repository-local launchers that are not node.
  ['npx tsx <file>', 'npx tsx scripts/ship.ts'],
  ['npm exec -- tsx <file>', 'npm exec -- tsx scripts/ship.ts'],
  ['pnpm exec tsx <file>', 'pnpm exec tsx scripts/ship.ts'],
  ['yarn tsx <file>', 'yarn tsx scripts/ship.ts'],
  ['ts-node <file>', 'ts-node scripts/ship.ts'],
  ['bun <file>', 'bun scripts/ship.ts'],
  ['bun run <file>', 'bun run scripts/ship.ts'],
  ['tsx behind a valued flag', 'npx tsx --tsconfig tsconfig.build.json scripts/ship.ts'],
];

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

  /* HIGH-2 — a quoted `#` used to erase the rest of the line. */
  ['a double-quoted hash before the deploy', workflowWith('      - run: echo "#" && vercel --prod')],
  ['a quoted hash mid-sentence before the deploy', workflowWith('      - run: echo "safe # text" ; vercel deploy')],
  ['a hash inside a URL before the deploy', workflowWith('      - run: curl https://x.test/a#b && wrangler deploy')],
  ['a run: block whose first line quotes a hash',
    workflowWith('      - run: |\n          echo "#"\n          vercel --prod')],
  [
    'a package script using # as argument data',
    { 'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: "node t.mjs --a='#top' && vercel --prod" } }, null, 2) },
  ],

  /* MEDIUM-1 — five real deploy forms that evaded command-position matching. */
  ['a leading environment assignment', workflowWith('      - run: env VERCEL_ORG_ID=team_abc vercel --prod')],
  ['a timeout wrapper', workflowWith('      - run: timeout 600 vercel --prod')],
  ['a relative path into node_modules', workflowWith('      - run: ./node_modules/.bin/vercel --prod')],
  ['yarn as the runner', workflowWith('      - run: yarn vercel --prod')],
  ['npm exec with a separator', workflowWith('      - run: npm exec -- vercel --prod')],

  /* A runner OPTION that takes a SEPARATE value. The option's value was
   * mistaken for the command, so `sudo -u deploy vercel --prod` resolved to
   * `deploy` and the deploy behind it was invisible. */
  ['sudo with a separated user value', workflowWith('      - run: sudo -u deploy vercel --prod')],
  ['env clearing the environment first', workflowWith('      - run: env -i vercel --prod')],
  ['xargs with a replacement token', workflowWith('      - run: xargs -I {} vercel --prod')],
  ['timeout with an attached signal value', workflowWith('      - run: timeout --signal=KILL 60 vercel --prod')],
  ['nice with a separated adjustment', workflowWith('      - run: nice -n 10 vercel --prod')],
  ['sudo with no option at all', workflowWith('      - run: sudo vercel --prod')],

  /* MEDIUM-3 — a Node wrapper a package script or workflow step actually runs. */
  [
    'an ESM wrapper reached by a package script',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],
  [
    'a CommonJS wrapper reached by a package script',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.cjs' } }, null, 2),
      'scripts/ship.cjs': "const { execSync } = require('child_process');\nexecSync('railway up');\n",
    },
  ],
  [
    'a TypeScript wrapper reached by a package script',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.ts' } }, null, 2),
      'scripts/ship.ts': "import cp from 'node:child_process';\ncp.execSync('netlify deploy --prod');\n",
    },
  ],
  [
    'the argument-array form of spawn inside a wrapper',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { spawn } from 'node:child_process';\nspawn('vercel', ['--prod']);\n",
    },
  ],
  [
    'a workflow running a package script that runs a deploying wrapper',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
      ...workflowWith('      - run: npm run ship'),
    },
  ],
  [
    'a wrapper that delegates to a local helper',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { go } from './deploy-impl.mjs';\ngo();\n",
      'scripts/deploy-impl.mjs':
        "import { execFileSync } from 'node:child_process';\n"
        + "export const go = () => execFileSync('flyctl', ['deploy']);\n",
    },
  ],

  /* MEDIUM-3a — the STATIC EDGES the follower could not see.
   *
   * MEDIUM-3 followed a `node <file>` entry point and then that file's
   * relative imports, but only where the specifier sat behind `from`,
   * `import(` or `require(`. A BARE SIDE-EFFECT IMPORT matched none of them,
   * so one line hid an entire deployment:
   *
   *     // scripts/ship.mjs
   *     import './deploy.mjs';     <- the scanner was blind to this edge
   *
   * Measured against the pre-repair head: the three `from`-clause forms were
   * DETECTED and `import './b.mjs';` was MISSED. */
  [
    'a bare side-effect import reaching a deploy',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import './deploy.mjs';\n",
      'scripts/deploy.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],
  [
    'a side-effect import chain one level deeper',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/a.mjs' } }, null, 2),
      'scripts/a.mjs': "import './b.mjs';\n",
      'scripts/b.mjs': "import './c.mjs';\n",
      'scripts/c.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],
  [
    'a side-effect import reached through a workflow step',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import './deploy.mjs';\n",
      'scripts/deploy.mjs': "import { execSync } from 'node:child_process';\nexecSync('railway up');\n",
      ...workflowWith('      - run: npm run ship'),
    },
  ],
  [
    'an `export * from` re-export reaching a deploy',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "export * from './deploy.mjs';\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('vercel --prod');\n",
    },
  ],
  [
    'a require() reaching a deploy in a .cjs wrapper',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.cjs' } }, null, 2),
      'scripts/ship.cjs': "const { go } = require('./deploy.cjs');\ngo();\n",
      'scripts/deploy.cjs':
        "const { execSync } = require('child_process');\nmodule.exports.go = () => execSync('vercel --prod');\n",
    },
  ],
  [
    'a static await import() with a literal specifier reaching a deploy',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "const m = await import('./deploy.mjs');\nm.go();\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('flyctl deploy');\n",
    },
  ],
  [
    'a substitution-free backtick specifier reaching a deploy',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': 'await import(`./deploy.mjs`);\n',
      'scripts/deploy.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],
  [
    'a deploy inside a module cycle',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/a.mjs' } }, null, 2),
      'scripts/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
      'scripts/b.mjs':
        "import './a.mjs';\nimport { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],

  /* F1 — a shell KEYWORD in command position. `resolveCommand` skipped
   * environment assignments and runners and then took the head word; `then`,
   * `do` and `else` are none of those, so the KEYWORD became the resolved
   * binary and every deploy behind it was invisible. A conditional deploy
   * step is the most natural real shape there is. */
  ['a deploy behind `then`', workflowWith('      - run: if true; then vercel --prod; fi')],
  ['a deploy behind `do`', workflowWith('      - run: for i in 1 2 3; do railway up; done')],
  ['a deploy behind `else`', workflowWith('      - run: if false; then echo x; else vercel --prod; fi')],
  ['a deploy behind `eval`', workflowWith('      - run: eval vercel --prod')],
  /* A compound command's CONDITION is itself a command, so `if vercel --prod`
   * runs the deploy exactly as `then vercel --prod` does. */
  ['a deploy as an `if` condition', workflowWith('      - run: if vercel --prod; then echo ok; fi')],
  ['a deploy as a `while` condition', workflowWith('      - run: while railway up; do break; done')],
  ['a deploy as an `until` condition', workflowWith('      - run: until vercel deploy; do sleep 1; done')],
  [
    'a deploy as an `if` condition in a shell wrapper',
    { 'scripts/cond.sh': '#!/usr/bin/env bash\nif vercel --prod; then echo ok; fi\n' },
  ],
  [
    'a deploy behind `then` in a shell wrapper',
    { 'scripts/release.sh': '#!/usr/bin/env bash\nif [ "$CI" = "1" ]; then vercel --prod; fi\n' },
  ],
  [
    'a deploy behind `then` in a package script',
    {
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { ship: 'if true; then vercel --prod; fi' } }, null, 2,
      ),
    },
  ],

  /* F2 — the RUNNER_PAIRS branch sliced two words and continued WITHOUT
   * dropping the runner's own arguments, so the runner's flag became the
   * binary. The one form under test, `npm exec -- vercel --prod`, passed only
   * because `--` happens to be handled at the top of `dropRunnerArguments`. */
  ['npm exec with a boolean flag', workflowWith('      - run: npm exec --yes -- vercel --prod')],
  ['pnpm dlx with an attached package value', workflowWith('      - run: pnpm dlx --package=vercel vercel --prod')],
  ['pnpm dlx with a separated package value', workflowWith('      - run: pnpm dlx --package vercel vercel --prod')],

  /* F3 — a QUOTED entry path was split away from its `node`, so the wrapper
   * was never queued: a silent pass, with no analyzability finding either. */
  [
    'a wrapper whose entry path is quoted',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: "node 'scripts/ship.mjs'" } }, null, 2),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],

  /* F7 — `docker://owner/name` matched no action pattern at all, so the one
   * action form that can run anything was the one form never checked. */
  ['a container deployment action', workflowWith('      - uses: docker://myorg/deployer:latest')],

  /* F8 — a backslash path resolved to neither a binary nor a tracked file. */
  ['a deploy binary named with backslashes', workflowWith('      - run: .\\node_modules\\.bin\\vercel --prod')],
  [
    'a wrapper named with backslashes',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node .\\scripts\\ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    },
  ],

  /* ITEM A — `createRequire` was the last module-loading indirection the
   * follower did not know. A reachable wrapper passed in silence while
   * reaching a real deploy through it. */
  [
    'a createRequire binding reaching a deploy',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'const r = createRequire(import.meta.url);\n'
        + "r('./deploy.cjs');\n",
      'scripts/deploy.cjs': "const { execSync } = require('child_process');\nexecSync('vercel --prod');\n",
    },
  ],
  [
    'a createRequire called inline, with no binding',
    {
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./deploy.cjs');\n",
      'scripts/deploy.cjs': "const { execSync } = require('child_process');\nexecSync('railway up');\n",
    },
  ],

  /* ITEM B — the three real publish forms, pinned in a WRAPPER, the position
   * where `allow-mention` is refused. Anchoring the patterns to a resolved
   * command head must not quietly cost their detection. */
  ['docker push in a shell wrapper', { 'scripts/p.sh': '#!/usr/bin/env bash\ndocker push myorg/app:latest\n' }],
  ['npm publish in a shell wrapper', { 'scripts/p.sh': '#!/usr/bin/env bash\nnpm publish\n' }],
  ['gh release create in a shell wrapper', { 'scripts/p.sh': '#!/usr/bin/env bash\ngh release create v1\n' }],

  /* AN UNKNOWN WRAPPER WORD. Resolution only skips runners it knows about, so
   * one unrecognised word in front of a deploy hid it. `xvfb-run docker push`
   * was a REGRESSION from anchoring the pattern rules; `xvfb-run vercel
   * --prod` was never caught by anything, because the binary rules had always
   * been head-position-only. */
  /* FINDING A — `yarn publish` in all five positions the differential found.
   *
   * Anchoring the pattern rules at the head of a RESOLVED command stripped the
   * runner first, and `yarn` IS a runner word, so `yarn publish` resolved to
   * `publish` and the publish pattern could not match. Publishing this package
   * is a founder-authorized action, and it went invisible in every surface
   * while the banner still claimed coverage. The suite stayed green because
   * every publish fixture was `npm publish` or `pnpm publish` — and neither
   * `npm` nor `pnpm` is a runner word on its own. */
  ['yarn publish', { 'scripts/p.sh': '#!/usr/bin/env bash\nyarn publish\n' }],
  ['yarn publish with a flag', { 'scripts/p.sh': '#!/usr/bin/env bash\nyarn publish --access public\n' }],
  ['yarn publish behind sudo', { 'scripts/p.sh': '#!/usr/bin/env bash\nsudo yarn publish\n' }],
  ['yarn publish behind a shell keyword', { 'scripts/p.sh': '#!/usr/bin/env bash\nif true; then yarn publish; fi\n' }],
  ['yarn publish inside sh -c', { 'scripts/p.sh': '#!/usr/bin/env bash\nbash -c "yarn publish"\n' }],

  ['a deploy behind an unknown wrapper', { 'scripts/w.sh': '#!/usr/bin/env bash\nxvfb-run docker push x\n' }],
  ['a deploy binary behind an unknown wrapper', { 'scripts/w.sh': '#!/usr/bin/env bash\nxvfb-run vercel --prod\n' }],
  [
    'a deploy binary behind an arbitrary unknown word',
    { 'scripts/w.sh': '#!/usr/bin/env bash\nsomeunknownwrapper vercel --prod\n' },
  ],

  /* ------------------------------------------------------------------ *
   * M-1 — A NODE FLAG'S VALUE IS NOT THE ENTRY POINT.
   *
   * The independent review of PR #2 demonstrated this exact bypass:
   *
   *     "ship": "node --env-file .env scripts/ship.mjs"
   *
   * `--env-file` was skipped as a flag, `.env` was taken as the script, it did
   * not resolve, and the finder broke BEFORE `scripts/ship.mjs`. The wrapper's
   * `execSync('vercel --prod')` was never read; the scan exited 0 and the
   * banner printed `0 Node entry point(s)` — a coverage claim that was false.
   *
   * Every value-consuming flag it named is a case here, in BOTH the separated
   * and the attached form, on BOTH surfaces, plus a flag the scan does not
   * know at all — because a repair that only enumerates flags is one unknown
   * flag away from the same defect.
   * ------------------------------------------------------------------ */
  ...NODE_LAUNCH_BYPASSES.map(
    ([label, command]): [string, Record<string, string>] => [
      label,
      { ...scriptRunning(command), 'scripts/ship.mjs': SHIP_MJS, 'scripts/ship.ts': SHIP_TS },
    ],
  ),
  ...NODE_LAUNCH_BYPASSES.slice(0, 6).map(
    ([label, command]): [string, Record<string, string>] => [
      `${label} — in a workflow run: step`,
      { ...workflowWith(`      - run: ${command}`), 'scripts/ship.mjs': SHIP_MJS, 'scripts/ship.ts': SHIP_TS },
    ],
  ),
  [
    'workflow → package script → flagged node wrapper → deployment',
    {
      ...scriptRunning('node --env-file .env scripts/ship.mjs'),
      'scripts/ship.mjs': SHIP_MJS,
      '.github/workflows/deploy.yml':
        'name: Ship\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ship\n',
    },
  ],
  [
    'workflow → package script → tsx launcher → deployment',
    {
      ...scriptRunning('npx tsx scripts/ship.ts'),
      'scripts/ship.ts': SHIP_TS,
      '.github/workflows/deploy.yml':
        'name: Ship\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ship\n',
    },
  ],
  [
    'a flagged node wrapper in a shell wrapper',
    { 'scripts/w.sh': '#!/usr/bin/env bash\nnode --import tsx scripts/ship.mjs\n', 'scripts/ship.mjs': SHIP_MJS },
  ],
  [
    'a flagged node invocation a reachable wrapper itself runs',
    {
      ...scriptRunning('node scripts/a.mjs'),
      'scripts/a.mjs': "import { execSync } from 'node:child_process';\nexecSync('node --env-file .env scripts/ship.mjs');\n",
      'scripts/ship.mjs': SHIP_MJS,
    },
  ],

  /* A GROUPED command is a command. `commandSegments` stopped treating a
   * parenthesis inside QUOTED data as grouping (L-1); real grouping must
   * keep working, so it is measured here rather than assumed. */
  ['a subshell-grouped deployment', workflowWith('      - run: (vercel --prod)')],
  ['a grouped deployment after safe prose', workflowWith('      - run: echo safe && (railway up)')],
  [
    'a grouped deployment after QUOTED prose naming a vendor',
    workflowWith('      - run: echo "Deployment (docs) here" && (netlify deploy --prod)'),
  ],
  ['a deployment inside an explicit sh -c string', workflowWith('      - run: sh -c "echo safe && vercel --prod"')],
  ['a deployment inside an explicit bash -c string', workflowWith("      - run: bash -c 'wrangler deploy'")],
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

  /* The repairs widen what counts as executable. Each widening gets a matching
   * negative control, or the rule becomes "these words are forbidden". */

  it('a GENUINE unquoted trailing comment is still inert (HIGH-2)', () => {
    const result = scan({
      ...baseline(),
      ...workflowWith('      - run: npm test # this repository never runs vercel --prod'),
    });
    expect(result.code, `a real comment was read as executable:\n${result.output}`).toBe(0);
  });

  it('the same wrappers around a harmless command stay clean (MEDIUM-1)', () => {
    const controls = [
      '      - run: env NODE_ENV=production npm run build',
      '      - run: timeout 600 npm test',
      '      - run: ./node_modules/.bin/vitest run',
      '      - run: yarn install --frozen-lockfile',
      '      - run: npm exec -- tsc --noEmit',
    ];
    for (const step of controls) {
      const result = scan({ ...baseline(), ...workflowWith(step) });
      expect(result.code, `${step}\n${result.output}`).toBe(0);
    }
  });

  it('a reachable wrapper that only DOCUMENTS a deploy command passes (MEDIUM-3)', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { verify: 'node scripts/verify.mjs' } }, null, 2),
      'scripts/verify.mjs':
        '// Relay never deploys. We do not run `vercel --prod`.\n'
        + "export const documented = 'vercel --prod';\n",
    });
    expect(result.code, `documentation inside a wrapper was read as a command:\n${result.output}`).toBe(0);
  });

  it('an unreferenced tracked script is NOT scanned as a deployment path (MEDIUM-3)', () => {
    // The bound that keeps this rule from failing on the repository's own
    // tooling — including the frozen baseline this suite depends on.
    const result = scan({
      ...baseline(),
      'scripts/unreferenced.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a side-effect import reaching a DOCUMENTATION-only module passes (MEDIUM-3a)', () => {
    // Following the edge must not make the reached file's prose executable.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { verify: 'node scripts/verify.mjs' } }, null, 2),
      'scripts/verify.mjs': "import './notes.mjs';\n",
      'scripts/notes.mjs':
        '// Relay never deploys. We do not run `vercel --prod`, and never `railway up`.\n'
        + "export const documented = 'vercel --prod';\n",
    });
    expect(result.code, `documentation behind a side-effect import was read as a command:\n${result.output}`)
      .toBe(0);
  });

  it('mutually-importing modules with no deploy stay clean and terminate (MEDIUM-3a)', () => {
    // Cycle protection is what makes side-effect edges safe to follow at all.
    const started = Date.now();
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/a.mjs' } }, null, 2),
      'scripts/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
      'scripts/b.mjs': "import './a.mjs';\nexport const b = 2;\n",
    });
    expect(result.code, result.output).toBe(0);
    expect(Date.now() - started, 'the cyclic scan did not terminate promptly').toBeLessThan(20_000);
  }, 30_000);

  it('a vendor named FIRST inside a string is not a command (F5)', () => {
    // The most consequential false positive in the scan: `checkDeployLine`
    // treats a wrapper line as executable, and deliberately refuses to honour
    // `allow-mention` there — so these lines could not be committed AT ALL,
    // in a repository whose own audit scripts grep for exactly these names.
    const inert = [
      'grep -R "vercel" .',
      'echo "vercel is never used here"',
      'command -v vercel >/dev/null',
      "grep -R 'railway up' .",
    ];
    for (const line of inert) {
      const result = scan({
        ...baseline(),
        'scripts/audit.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
      });
      expect(result.code, `${line} was reported, and no annotation can silence it:\n${result.output}`).toBe(0);
    }
  });

  it('quote transparency does not hide a real command (F5)', () => {
    // The other direction of the same change. `sh -c "vercel --prod"` has no
    // separator inside it to split on, and is resolved instead by `sh` being
    // a runner and `-c` being one of its arguments.
    const active = [
      'sh -c "npm run build && railway up"',
      'sh -c "vercel --prod"',
      "sh -c 'railway up'",
      'bash -eu -o pipefail -c "vercel --prod"',
      'echo `vercel --prod`',
      'echo $(vercel --prod)',
    ];
    for (const line of active) {
      const result = scan({
        ...baseline(),
        'scripts/run.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
      });
      expect(result.code, `${line} was hidden by quote handling:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    }
  });

  it('a keyword skip does not make the next word a command (F1)', () => {
    const controls = [
      '      - run: if true; then npm test; fi',
      '      - run: for f in src/*; do echo "$f"; done',
      '      - run: if false; then echo x; else npm run build; fi',
      '      - run: while npm test; do break; done',
      '      - run: until npm run build; do sleep 1; done',
      '      - name: Fail if vercel is configured anywhere\n        run: npm test',
    ];
    for (const step of controls) {
      const result = scan({ ...baseline(), ...workflowWith(step) });
      expect(result.code, `${step}\n${result.output}`).toBe(0);
    }
  });

  it('the guards that CHECK for a deploy CLI stay committable (F1)', () => {
    // `if`, `while` and `until` are keywords now, so the condition of a
    // compound command is read. These are the lines a repository writes to
    // prove it cannot deploy, in a wrapper — the position where
    // `allow-mention` is refused, so a false positive is uncommittable.
    const guards = [
      'if ! command -v vercel; then exit 1; fi',
      'if [ -x vercel ]; then exit 1; fi',
      'if which vercel; then exit 1; fi',
      'if grep -q "vercel" .; then exit 1; fi',
    ];
    for (const line of guards) {
      const result = scan({
        ...baseline(),
        'scripts/guard.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
      });
      expect(result.code, `${line} was flagged, and no annotation can silence it:\n${result.output}`).toBe(0);
    }
  });

  it('a `node <file>` entry into the FROZEN baseline is reported, not dropped (F9)', () => {
    // Excluding the frozen baseline as a scan TARGET is right; excluding it in
    // SILENCE is the same class of quiet pass F3 was.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { ship: 'node scripts/__baseline__/relay-repository-boundary.d21d383.mjs' } },
        null,
        2,
      ),
      'scripts/__baseline__/relay-repository-boundary.d21d383.mjs':
        "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, `a path through the frozen baseline passed in silence:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('frozen baseline copy');
    expect(result.output).not.toContain('[ci-deploy]');
  });

  it('a publish command named INSIDE A STRING is not a command (ITEM B)', () => {
    // The same F5 false positive, surviving in the pattern matcher. These are
    // wrapper lines, so `allow-mention` is refused on them — a finding here
    // could not be silenced, and the repository could not commit its own
    // publish audit. Both bare and annotated must be clean.
    const inert = [
      'echo "docker push x"',
      'echo "we never npm publish here"',
      'grep -q "gh release create" .',
    ];
    for (const line of inert) {
      for (const suffix of ['', ` # ${MENTION}`]) {
        const result = scan({
          ...baseline(),
          'scripts/audit.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}${suffix}\n`,
        });
        expect(result.code, `${line}${suffix} was reported:\n${result.output}`).toBe(0);
      }
    }
  });

  it('looking past an unknown wrapper does not flag a DATA command', () => {
    // The widening is only safe because `echo`, `grep` and the lookup
    // builtins are excluded. Each line below sits in a wrapper, where
    // `allow-mention` is refused — a finding here would be uncommittable.
    // The UNQUOTED forms are the point: a rule keyed on quotes alone would
    // report every one of them.
    const inert = [
      'echo we never npm publish here',
      'echo vercel is never used here',
      'grep -R vercel .',
      'grep -q docker push .',
      'if which vercel; then exit 1; fi',
      'command -v vercel >/dev/null',
      'test -x vercel',
      'find . -name vercel',
    ];
    for (const line of inert) {
      const result = scan({
        ...baseline(),
        'scripts/audit.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
      });
      expect(result.code, `${line} was reported, and no annotation can silence it:\n${result.output}`).toBe(0);
    }
  });

  it('createRequire loading a HARMLESS module is not a finding (ITEM A)', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'const r = createRequire(import.meta.url);\n'
        + "r('./helper.cjs');\n",
      'scripts/helper.cjs': 'module.exports.go = () => 1;\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a wrapper of regex literals and prose does not detonate the scan (ITEM A)', () => {
    // The masker's own regression: a quote inside a character class opened a
    // "string" that ran past a block-comment opener, so the comment was read
    // as code. It reported findings against the scanner's own documentation.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
      'scripts/s.mjs':
        'const quoted = /[\'"]/g;\n'
        + '/**\n'
        + ' * A computed specifier looks like import(target); an alias is r(name).\n'
        + ' */\n'
        + 'export const ok = Boolean(quoted);\n',
    });
    expect(result.code, `the masker read documentation as code:\n${result.output}`).toBe(0);
  });

  it('a COMPUTED specifier is reported, not guessed and not passed (MEDIUM-3a)', () => {
    // `execSync(c)` with a computed `c` was already reported; `await import(m)`
    // with a computed `m` passed in SILENCE, hiding a whole module subtree and
    // every command in it behind one variable. Same silent-pass class as F3
    // and F9. The scan still must not GUESS which file was meant.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': 'const n = 1;\nawait import(`./deploy-${n}.mjs`);\n',
      'scripts/deploy-1.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, `a computed specifier passed in silence:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('builds its module specifier at runtime');
    expect(result.output).not.toContain('[ci-deploy]');
  });

  it('a LITERAL dynamic specifier is followed rather than reported (MEDIUM-3a)', () => {
    // Reporting every `import(` would be an easy way to look thorough while
    // resolving nothing. A literal must still resolve to the real module.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "const m = await import('./deploy.mjs');\nm.go();\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/deploy.mjs');
    expect(result.output).not.toContain('builds its module specifier at runtime');
  });

  it('a computed specifier written in PROSE is not a finding (MEDIUM-3a)', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs':
        '// A computed specifier looks like import(target) or require(base + name).\n'
        + "export const documented = 'call import(x) to load it';\n",
    });
    expect(result.code, `documentation was read as a computed specifier:\n${result.output}`).toBe(0);
  });

  it('a side-effect import in an UNREFERENCED module is still not scanned (MEDIUM-3a)', () => {
    // The widening changes which EDGES are followed, never which files are
    // ROOTS. This is the bound that keeps the scan off the repository's own
    // tooling and off the frozen baseline.
    const result = scan({
      ...baseline(),
      'scripts/unreferenced.mjs': "import './unreferenced-impl.mjs';\n",
      'scripts/unreferenced-impl.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a command a reachable wrapper builds at runtime is reported, not passed (MEDIUM-3)', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/ship.mjs' } }, null, 2),
      'scripts/ship.mjs':
        "import { execSync } from 'node:child_process';\n"
        + 'execSync(`${process.env.RELAY_TARGET} --prod`);\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
  });
});

/* ---------------------------------------------- base vs head coverage */

describe('M-1 — a node flag value is not the entry point', () => {
  /**
   * THE REPORTED BYPASS, REPRODUCED EXACTLY.
   *
   * This is the command from the independent review of PR #2, with the file it
   * ran and the deployment inside it. It must fail, and the failure must name
   * the wrapper — not merely exit 1 for some unrelated reason.
   */
  it('the exact reported command is detected, and the wrapper is named', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node --env-file .env scripts/ship.mjs'),
      'scripts/ship.mjs': SHIP_MJS,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/ship.mjs');
    expect(result.output).toContain('a Vercel deployment command');
    expect(result.output).toContain('script "ship"');
  });

  it('the base scanner accepted that command — this is a real repair, not a restatement', () => {
    const files = {
      ...baseline(),
      ...scriptRunning('node --env-file .env scripts/ship.mjs'),
      'scripts/ship.mjs': SHIP_MJS,
    };
    expect(scanWithBase(files).code, 'the baseline must accept it, or the differential proves nothing').toBe(0);
    expect(scan(files).code).toBe(1);
  });

  /**
   * THE FALSE-ASSURANCE HALF. Exiting 0 was only half the defect; the other
   * half was a banner that stated a coverage fact which was not true. A scan
   * that resolves the entry must COUNT it.
   */
  it('the entry is counted in the banner, not reported as zero', () => {
    const passing = {
      ...baseline(),
      ...scriptRunning('node --env-file .env scripts/check.mjs'),
      'scripts/check.mjs': CHECK_MJS,
    };
    const result = scan(passing);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toMatch(/plus the [1-9]\d* script entry point\(s\)/);
    expect(result.output).not.toMatch(/plus the 0 script entry point\(s\)/);
  });

  it('an unflagged node invocation still resolves exactly as before', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node scripts/ship.mjs'),
      'scripts/ship.mjs': SHIP_MJS,
    });
    expect(result.code, result.output).toBe(1);
  });

  /* ----------------------------- safe controls ------------------------ */

  it('a flagged node invocation of a HARMLESS wrapper passes', () => {
    for (const command of [
      'node --env-file .env scripts/check.mjs',
      'node -r dotenv/config scripts/check.mjs',
      'node --import tsx scripts/check.mjs',
      'node --loader=ts-node/esm scripts/check.mjs',
    ]) {
      const result = scan({ ...baseline(), ...scriptRunning(command), 'scripts/check.mjs': CHECK_MJS });
      expect(result.code, `${command} was reported:\n${result.output}`).toBe(0);
    }
  });

  it('a missing optional preload followed by a real tracked entry is not a finding', () => {
    // `dotenv/config` is not a repository file. That is ordinary, and it must
    // not be mistaken either for the entry or for something unanalyzable.
    const result = scan({
      ...baseline(),
      ...scriptRunning('node -r dotenv/config scripts/check.mjs'),
      'scripts/check.mjs': CHECK_MJS,
    });
    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain('deploy-analyzability');
  });

  it('a package script with no deployment path passes', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { build: 'tsc -b && vite build', test: 'vitest run', version: 'node --version' } },
        null,
        2,
      ),
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a legitimate non-file execution mode with no deployment passes', () => {
    const result = scan({ ...baseline(), ...scriptRunning('node -e "console.log(1)"') });
    expect(result.code, result.output).toBe(0);
  });

  it('a determinate path that is not tracked source is neither read nor reported', () => {
    // A built CLI is exactly this shape, and this repository runs its own.
    const result = scan({ ...baseline(), ...scriptRunning('node dist-relay/cli.cjs demo yc --presentation') });
    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain('deploy-analyzability');
  });

  it('documentation containing node flag examples is not scanned as a command', () => {
    const result = scan({
      ...baseline(),
      'docs/relay/FLAGS.md':
        '# Node flags\n\n`node --env-file .env scripts/ship.mjs` and `node -r dotenv/config x.mjs`'
        + ' are examples. Neither is used here.\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  /* ------------------- unanalyzable, never silent --------------------- */

  it('an entry built at run time is reported rather than passed', () => {
    const result = scan({ ...baseline(), ...scriptRunning('node "$RELAY_SCRIPT"') });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('built at run time');
  });

  it('a program read from standard input is reported rather than passed', () => {
    const result = scan({ ...baseline(), ...scriptRunning('node - < scripts/ship.mjs') });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('standard input');
  });

  it('a path above the repository is reported rather than followed', () => {
    const result = scan({ ...baseline(), ...scriptRunning('node ../outside/ship.mjs') });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('above this repository');
  });

  /**
   * A PRELOAD RUNS BEFORE THE SCRIPT, so its module is an entry point too.
   * The first cut of this repair skipped a value flag and its value together,
   * which stopped `.env` being mistaken for the entry but ALSO threw away
   * `-r ./scripts/preload.mjs` — a module node genuinely executes. That is the
   * same bypass one slot over.
   */
  it('a preloaded module is read, in every preload flag and both spellings', () => {
    for (const command of [
      'node --require ./scripts/preload.mjs scripts/main.mjs',
      'node -r ./scripts/preload.mjs scripts/main.mjs',
      'node --require=./scripts/preload.mjs scripts/main.mjs',
      'node --import ./scripts/preload.mjs scripts/main.mjs',
      'node --loader ./scripts/preload.mjs scripts/main.mjs',
      'node -r ./scripts/preload.mjs',
    ]) {
      const result = scan({
        ...baseline(),
        ...scriptRunning(command),
        'scripts/preload.mjs': SHIP_MJS,
        'scripts/main.mjs': "console.log('ok');\n",
      });
      expect(result.code, `${command} did not read its preload:\n${result.output}`).toBe(1);
      expect(result.output).toContain('scripts/preload.mjs');
    }
  });

  it('a preload that is not a repository file says nothing', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node -r dotenv/config scripts/check.mjs'),
      'scripts/check.mjs': CHECK_MJS,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('-pe is node’s own spelling of -p -e, and its code is read', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node -pe "require(\'./scripts/ship.mjs\')"'),
      'scripts/ship.mjs': SHIP_MJS,
    });
    expect(result.code, result.output).toBe(1);
  });

  it('an extension-less or directory specifier resolves exactly as node resolves it', () => {
    for (const command of ['node ./scripts/ship', "node -e \"require('./scripts/ship')\""]) {
      const result = scan({ ...baseline(), ...scriptRunning(command), 'scripts/ship.mjs': SHIP_MJS });
      expect(result.code, `${command}:\n${result.output}`).toBe(1);
    }
  });

  it('an ESM import STATEMENT in evaluated code is followed', () => {
    // Node auto-detects ESM in --eval, so no flag is needed for this to run.
    const result = scan({
      ...baseline(),
      ...scriptRunning("node -e \"import './scripts/ship.mjs'\""),
      'scripts/ship.mjs': SHIP_MJS,
    });
    expect(result.code, result.output).toBe(1);
  });

  /**
   * AN ABSOLUTE PATH IS NOT A RELATIVE ONE. Dropping the empty leading segment
   * re-rooted it, so `node /scripts/ship.mjs` resolved to THIS repository's
   * `scripts/ship.mjs` — a different file than the one that runs — and an
   * absolute path elsewhere on the machine became a silent miss.
   */
  it('an absolute path outside the repository is reported, never re-rooted', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node /opt/ci/ship.mjs'),
      'opt/ci/ship.mjs': CHECK_MJS,   // the file the old re-rooting would have read
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('above this repository');
  });

  it('a node: builtin in evaluated code is not reported as unanalyzable', () => {
    // `deploy-analyzability` has no annotation escape hatch by design, so a
    // false positive here is unfixable red on ordinary code.
    for (const command of [
      'node -e "require(\'node:fs\').mkdirSync(x)"',
      'node -e "import(\'node:path\')"',
      'node -e "require(\'fs\')"',
      'node -e "require(\'@scope/Pkg/Thing.js\')"',
    ]) {
      const result = scan({ ...baseline(), ...scriptRunning(command) });
      expect(result.code, `${command} was reported:\n${result.output}`).toBe(0);
    }
  });

  it('a ${…} expansion does not split the line and lose the entry beyond it', () => {
    const result = scan({
      ...baseline(),
      ...scriptRunning('node ${NODE_ARGS} scripts/ship.mjs'),
      'scripts/ship.mjs': SHIP_MJS,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/ship.mjs');
  });

  it('the frozen-baseline refusal still fires through a flagged invocation', () => {
    const frozen = 'scripts/__baseline__/relay-repository-boundary.d21d383.mjs';
    const result = scan({
      ...baseline(),
      ...scriptRunning(`node --env-file .env ${frozen}`),
      [frozen]: '// a frozen copy\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('frozen baseline copy');
  });
});

describe('L-1 — a parenthesis inside quoted data is not shell grouping', () => {
  const safe = [
    'echo "Deployment (vercel) is out of scope"',
    "echo 'Deployment (railway) is disabled'",
    'printf \'%s\\n\' "Use (flyctl) only manually"',
    'echo "Deployment (vercel, railway, netlify) is out of scope"',
    'echo "see the runbook (section 3) before shipping"',
    'echo "a brace {vercel} is data too"',
  ];

  for (const line of safe) {
    it(`passes, with no annotation required: ${line}`, () => {
      // The point of the repair: these are EXECUTABLE lines, so
      // `allow-mention` is powerless on them by design. Before the repair they
      // could not be committed at all.
      const result = scan({ ...baseline(), ...workflowWith(`      - run: ${line}`) });
      expect(result.code, `${line} was reported:\n${result.output}`).toBe(0);
      expect(result.output).not.toContain(MENTION);
    });
  }

  it('the same prose in a shell wrapper and a package script also passes', () => {
    expect(
      scan({ ...baseline(), 'scripts/say.sh': '#!/usr/bin/env bash\necho "Deployment (vercel) is out of scope"\n' }).code,
    ).toBe(0);
    expect(scan({ ...baseline(), ...scriptRunning('echo "Deployment (vercel) is out of scope"', 'say') }).code).toBe(0);
  });

  /**
   * THE HALF A FIRST ATTEMPT GOT WRONG. Calling every quoted parenthesis
   * "data" removed the false positive and took four true detections with it:
   * command substitution is what a double-quoted run is FOR, and a quoted
   * command string passed to `sh -c` is a command. Each is measured here
   * against the previous head, not merely asserted.
   */
  it('command substitution inside quotes still groups and still reports', () => {
    for (const line of [
      'URL="$(vercel --prod)"',
      'echo "$(flyctl deploy)"',
      'sh -c "(vercel --prod)"',
      "sh -c '(railway up)'",
      'bash -c "cd app && (vercel --prod)"',
      'node -e "require(\'child_process\').execSync(\'vercel --prod\')"',
    ]) {
      const result = scan({ ...baseline(), ...workflowWith(`      - run: ${line}`) });
      expect(result.code, `${line} was NOT detected:\n${result.output}`).toBe(1);
    }
  });

  it('a wrapper reached through quoted grouping is still queued', () => {
    for (const line of ['sh -c "(node scripts/ship.mjs)"', 'URL="$(node scripts/ship.mjs)"']) {
      const result = scan({ ...baseline(), ...workflowWith(`      - run: ${line}`), 'scripts/ship.mjs': SHIP_MJS });
      expect(result.code, `${line} lost its entry point:\n${result.output}`).toBe(1);
    }
  });

  it('real grouping is still grouping', () => {
    for (const line of [
      '(vercel --prod)',
      'echo safe && (railway up)',
      'sh -c "echo safe && vercel --prod"',
      "bash -c 'wrangler deploy'",
      'echo "Deployment (docs) here" && (netlify deploy --prod)',
    ]) {
      const result = scan({ ...baseline(), ...workflowWith(`      - run: ${line}`) });
      expect(result.code, `${line} was NOT detected:\n${result.output}`).toBe(1);
    }
  });

  it('quoted-hash protection is unaffected', () => {
    expect(scan({ ...baseline(), ...workflowWith('      - run: echo "#" && vercel --prod') }).code).toBe(1);
    expect(scan({ ...baseline(), ...workflowWith('      - run: echo "# (vercel) note" && railway up') }).code).toBe(1);
  });

  it('an unbalanced quote falls back to the grouping reading, so nothing is lost', () => {
    // An apostrophe in prose is not a quote. The fallback groups MORE, never
    // less, which is what keeps base ⊆ head true through this change.
    const result = scan({ ...baseline(), ...workflowWith("      - run: echo Relay's policy && (vercel --prod)") });
    expect(result.code, result.output).toBe(1);
  });

  it('a case label is still inert and a case body is still detected', () => {
    const inert = 'name: ci\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n'
      + '      - run: |\n          case "$1" in\n            vercel) echo unsupported ;;\n          esac\n';
    expect(scan({ ...baseline(), '.github/workflows/c.yml': inert }).code).toBe(0);
    const active = inert.replace('vercel) echo unsupported ;;', 'prod) vercel --prod ;;');
    expect(scan({ ...baseline(), '.github/workflows/c.yml': active }).code).toBe(1);
  });
});

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
      const { base, head } = scanBoth({ ...baseline(), ...files });
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

  /**
   * THE DIFFERENTIAL INVARIANT — head must catch everything BASE caught.
   *
   * `ACTIVE_DEPLOY_CASES` proves head catches every case in the corpus, and
   * that base misses some of them. What it could not prove is coverage OUTSIDE
   * the corpus, and that is exactly where `yarn publish` was lost: it was
   * never a fixture, so nothing failed when it broke.
   *
   * This corpus is deliberately BROAD and mechanical rather than curated —
   * every deploy binary and every pattern vendor, bare and behind the runner
   * and keyword forms that resolution has to see through. The assertion is one
   * sentence: if the frozen baseline reports a shape, the head must report it
   * too. A repair may add coverage and may remove a false positive, but it may
   * never silently drop a detection the reviewed scanner already had.
   */
  const DIFFERENTIAL_CORPUS = [
    // Deploy binaries, bare.
    'vercel --prod', 'vercel deploy', 'railway up', 'flyctl deploy', 'netlify deploy --prod',
    'wrangler deploy', 'surge ./dist example.com', 'heroku container:release web', 'vc --prod',
    // Pattern vendors and subcommands.
    'fly deploy', 'fly launch', 'aws s3 sync ./dist s3://b', 'aws lambda update-function-code',
    'gcloud app deploy', 'gcloud run deploy svc', 'az webapp up', 'docker push myorg/app',
    'docker buildx build . --push', 'kubectl apply -f k8s/', 'kubectl rollout restart d/x',
    'helm install relay ./c', 'helm upgrade relay ./c', 'terraform apply', 'pulumi up',
    'serverless deploy', 'sst deploy', 'firebase deploy', 'eb deploy', 'now --prod',
    'supabase db push', 'supabase migration up', 'supabase link',
    // Publishing is deployment by another name — the family finding A broke.
    'npm publish', 'pnpm publish', 'yarn publish', 'bun publish',
    'npm publish --access public', 'yarn publish --access public',
    'gh release create v1', 'git push origin gh-pages',
    'curl -X POST https://api.render.com/deploy/srv-a',
    // The same shapes behind everything resolution must see through.
    'sudo yarn publish', 'sudo docker push x', 'env CI=1 vercel --prod', 'timeout 600 vercel --prod',
    'npx vercel --prod', 'yarn vercel --prod', 'npm exec -- vercel --prod',
    'if true; then yarn publish; fi', 'if true; then vercel --prod; fi',
    'for i in 1; do railway up; done', 'bash -c "yarn publish"', 'sh -c "vercel --prod"',
    './node_modules/.bin/vercel --prod', 'xvfb-run docker push x',
    // Grouped forms, kept measured because L-1 changed when a parenthesis
    // groups. A repair that removed a FALSE positive must not have removed a
    // true one with it.
    '(vercel --prod)', 'echo safe && (railway up)', 'bash -c \'wrangler deploy\'',
    'echo "Deployment (docs) here" && (netlify deploy --prod)',
  ];

  it('head detects every shape the frozen baseline detects', () => {
    // The comparison runs in a WORKFLOW STEP, because that is the only surface
    // the frozen baseline reads at all. Running it in a shell wrapper — where
    // the baseline detects nothing — would make the invariant vacuous, which
    // is a way of writing a green test that proves nothing.
    const lostByHead: string[] = [];
    const missedInWrapper: string[] = [];
    let caughtByBase = 0;
    let caughtByHead = 0;

    for (const line of DIFFERENTIAL_CORPUS) {
      const both = scanBoth({ ...baseline(), ...workflowWith(`      - run: ${line}`) });
      const base = both.base.code === 1;
      const head = both.head.code === 1;
      if (base) caughtByBase += 1;
      if (head) caughtByHead += 1;
      if (base && !head) lostByHead.push(line);

      // The SAME shape in a shell wrapper. The baseline is blind here, so this
      // half is a pure head-coverage assertion — and it is the half that would
      // have failed the moment `yarn publish` broke.
      const wrapped = { ...baseline(), 'scripts/differential.sh': `#!/usr/bin/env bash\n${line}\n` };
      if (scan(wrapped).code !== 1) missedInWrapper.push(line);
    }

    // eslint-disable-next-line no-console
    console.log(
      `\nDIFFERENTIAL — ${DIFFERENTIAL_CORPUS.length} shapes in a workflow step:`
      + ` base caught ${caughtByBase}, head caught ${caughtByHead}`
      + (lostByHead.length ? `\n  LOST BY HEAD (${lostByHead.length}):\n    ${lostByHead.join('\n    ')}` : '')
      + (missedInWrapper.length
        ? `\n  MISSED IN A WRAPPER (${missedInWrapper.length}):\n    ${missedInWrapper.join('\n    ')}`
        : ''),
    );

    expect(lostByHead, 'the head scanner LOST detections the frozen baseline had').toEqual([]);
    expect(missedInWrapper, 'these deployment shapes are not detected in a shell wrapper').toEqual([]);
    expect(caughtByBase, 'the comparison must run on a surface the baseline actually reads')
      .toBeGreaterThan(0);
    expect(caughtByHead).toBe(DIFFERENTIAL_CORPUS.length);
  }, 600_000);

  it('base and head agree that prose is not deployment', () => {
    const tree = {
      ...baseline(),
      'docs/relay/DEPLOYMENT.md': '# Deployment\n\nRelay does not deploy.\n',
    };
    expect(scan(tree).code, 'head must not fail on documentation').toBe(0);
    expect(scanWithBase(tree).code, 'base did not fail on documentation either').toBe(0);
  });
});
