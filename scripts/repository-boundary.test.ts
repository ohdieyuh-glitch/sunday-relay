import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Repository-boundary scanner and parity-gate contract.
 *
 * Both scripts are run END TO END against throwaway git repositories, because
 * both read the real index (`git ls-files`) and the real filesystem — a unit
 * test of their regexes would prove less than the thing CI actually executes.
 *
 * Every credential-shaped string below is synthetic and lives only inside a
 * temp directory that is deleted in `afterAll`. None is ever committed to this
 * repository, so the scanner never sees them when it scans Relay itself.
 */

/**
 * Every case here SPAWNS a git repository and a scanner process, and several
 * cases run a dozen of each. Under the default 5s budget those pass on an idle
 * machine and time out on a busy one, which reports a scheduling problem as a
 * boundary failure — the least useful thing this suite could say.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const REPO_ROOT = resolve(__dirname, '..');
const SCANNER = join(REPO_ROOT, 'scripts', 'relay-repository-boundary.mjs');
const PARITY_GATE = join(REPO_ROOT, 'scripts', 'relay-parity-gate.mjs');

let workspace: string;

beforeAll(() => { workspace = mkdtempSync(join(tmpdir(), 'relay-boundary-')); });
afterAll(() => { rmSync(workspace, { recursive: true, force: true }); });

interface RunResult { code: number; stdout: string; stderr: string; output: string }

/** A throwaway git repo containing exactly `files`, scanned by the real script. */
function scan(files: Record<string, string>): RunResult {
  const dir = mkdtempSync(join(workspace, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Boundary Test'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return run(SCANNER, dir);
}

function run(script: string, cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '', output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    const stdout = e.stdout ?? '';
    const stderr = e.stderr ?? '';
    return { code: e.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
  }
}

/** A minimal clean Relay-shaped tree the individual cases build on. */
const baseline = (): Record<string, string> => ({
  'package.json': JSON.stringify({ name: 'sunday-relay', scripts: {} }, null, 2),
  'src/relay/core/app.ts': 'export const relay = true;\n',
});

/* Synthetic credential shapes.
 *
 * EVERY credential-shaped fixture below is ASSEMBLED FROM FRAGMENTS rather
 * than written as a literal, because the scanner scans this repository too —
 * and it must. A scanner that skipped its own tests would have a hole exactly
 * where its evidence lives, and annotating each line with
 * `relay-boundary:allow-fixture` would work but would make the strongest
 * fixture file in the repo read as one long list of exceptions.
 *
 * Assembly keeps the tests honest: the scanner still receives real-shaped
 * input at runtime, while the tracked file contains no matchable literal.
 * The same reasoning applies to the `.only` fixture — rule 5 has no allowance
 * mechanism at all, so it must not appear whole either.
 */
const SK = 'sk' + '-';
const fake = (prefix: string, body: string) => `${prefix}${body}`;
/** Join fragments so an env-assignment shape never appears whole here. */
const assign = (name: string, value: string) => `${name}${'='}${value}`;

/**
 * A high-entropy payload GENERATED AT RUNTIME from a fixed seed.
 *
 * The adversarial cases below need a value whose character content is
 * genuinely key-like — that is the whole point of them — and such a value must
 * never be committed, not even as a defanged fragment. A deterministic
 * generator gives the scanner a realistic residue at run time while the
 * tracked file contains only arithmetic.
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
/** The canonical reserved token. A marker word is not itself secret material. */
const TOKEN = 'FAKETESTNOTREAL';
const ANNOTATION = 'relay-boundary:allow-fixture';

describe('relay repository-boundary scanner', () => {
  it('passes on a clean Relay-shaped repository', () => {
    const result = scan(baseline());
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain('RELAY REPOSITORY BOUNDARY: PASS');
  });

  /* ------------------------------ secrets ------------------------------ */

  const secretCases: Array<[string, string]> = [
    ['a Stripe live key', `export const k = '${fake('sk_live_', '4eC39HqLyjWDarjtT1zdp7dc')}';`],
    ['an OpenAI sk-proj key', `export const k = '${fake(SK + 'proj-', 'abc123XYZ789qrsTUV456defGHI0mnoPQR')}';`],
    ['a Google API key', `export const k = '${fake('AIza', 'SyC93kd82jdKe93ldPQ7rMv61zXwq0TbNa')}';`],
    ['an npm token', `export const k = '${fake('npm_', 'aB3xY7zQ1wE5rT9yU2iO4pA6sD8fG0hJ2kL4')}';`],
    ['an AWS access key id', `export const k = '${fake('AKIA', 'J3QK7ZP2W9RMT4XC')}';`],
    ['an AWS secret access key',
      `${assign('AWS_SECRET' + '_ACCESS_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY' + 'gTvW1qZ4nHdK')}\n`],
    ['a database URL with inline credentials',
      `export const u = '${'postgres' + '://svcuser:'}${'h7Kq2Lm9Rt4X'}@db.internal:5432/app';`],
    ['a Supabase service-role assignment',
      `${assign('SUPABASE_SERVICE' + '_ROLE_KEY', 'abc123XYZ789qrsTUV456defGHI')}\n`],
    ['a GitHub token', `export const k = '${fake('ghp_', 'aB3xY7zQ1wE5rT9yU2iO4pA6sD8fG0hJ2kL4')}';`],
  ];

  for (const [label, content] of secretCases) {
    it(`detects ${label}`, () => {
      const result = scan({ ...baseline(), 'src/relay/leak.ts': content });
      expect(result.code, `${label} was not detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[secret]');
    });
  }

  it('preserves the synthetic-fixture allowance for marked placeholder values', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts': `export const k = '${SK}FAKETESTNOTREAL0000000000000000000000';\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('honours a per-occurrence allow-fixture annotation on an obviously synthetic value', () => {
    // The annotation exists for a value whose SHAPE cannot carry a marker
    // word. It is honoured only in a test/fixture file, only for this
    // occurrence, and only because the value is visibly non-random.
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts':
        `export const k = '${fake('AKIA', 'QQQQQQQQQQQQQQQQ')}'; // relay-boundary:allow-fixture\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a marker glued onto a real-looking key does NOT suppress the finding', () => {
    // The reported laundering hole: the old rule tested a generic marker word
    // against the greedy match, so appending `-FAKE` silenced a usable key.
    const laundered = `${fake(SK + 'ant-', 'api03-9fKq2Lm7Rt4XwZ8vB6nH1jD5gS3pY0cU7eI4oA2mQ')}-FAKE`;
    const result = scan({ ...baseline(), 'src/relay/leak.ts': `export const k = '${laundered}';\n` });
    expect(result.code, `laundered key was not detected:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[secret]');
  });

  it('detects a production-shaped PSP Agent ID, including inside a test file', () => {
    const psp = `${'PSP' + '-AGENT-'}1-RLY742-9fKq2Lm7Rt4XwZ8vB6nH1jD5gS3pY0cU-7e4a`;
    const result = scan({ ...baseline(), 'src/relay/psp/leak.test.ts': `export const id = '${psp}';\n` });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[psp-credential]');
  });

  /* ---------------------------- deployment ----------------------------- */

  const workflow = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  const deployCases: Array<[string, string]> = [
    ['flyctl', '      - run: flyctl deploy --remote-only'],
    ['netlify', '      - run: netlify deploy --prod'],
    ['wrangler', '      - run: wrangler deploy'],
    ['docker push', '      - run: docker push registry.example.com/relay:latest'],
    ['vercel', '      - run: npx vercel --prod'],
    ['railway', '      - run: railway up'],
    ['kubectl', '      - run: kubectl apply -f k8s/'],
    ['a deployment webhook', '      - run: curl -X POST https://api.render.com/deploy/srv-abc?key=xyz'],
    ['a third-party deploy action', '      - uses: amondnet/vercel-action@v25'],
    ['a Supabase migration', '      - run: supabase db push'],
  ];

  for (const [label, step] of deployCases) {
    it(`detects ${label} in a workflow`, () => {
      const result = scan(workflow(step));
      expect(result.code, `${label} was not detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    });
  }

  it('does NOT fail on policy prose or a step name that merely mentions a vendor', () => {
    const result = scan(workflow(
      '      # This workflow never deploys: no Vercel, no Railway, no Fly.\n'
      + '      - name: Confirm no Vercel or Railway deployment is configured\n'
      + '        run: echo "relay-boundary:allow-mention no deploy here"',
    ));
    expect(result.code, result.output).toBe(0);
  });

  /* -------------------------- forbidden paths -------------------------- */

  const pathCases: Array<[string, string]> = [
    ['the Alcatraz server', 'server/index.ts'],
    ['an Alcatraz server under src/', 'src/server/index.ts'],
    ['Alcatraz API routes', 'api/chat.ts'],
    ['Supabase configuration', 'supabase/config.toml'],
    ['database migrations', 'db/migrations/0001_init.sql'],
    ['the fusion engine', 'src/fusion-engine/router.ts'],
    ['an Alcatraz package', 'packages/fusion-core/index.ts'],
    ['a nested Dockerfile', 'docker/Dockerfile'],
    ['vercel.json', 'vercel.json'],
    ['netlify.toml', 'netlify.toml'],
    ['fly.toml', 'fly.toml'],
    ['a .vercel directory', '.vercel/project.json'],
  ];

  for (const [label, path] of pathCases) {
    it(`detects ${label} at ${path}`, () => {
      const result = scan({ ...baseline(), [path]: 'x\n' });
      expect(result.code, `${label} was not detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[alcatraz-path]');
    });
  }

  it('does NOT reject legitimate Relay server-side code — the boundary is product purity', () => {
    // Relay owning a backend is allowed; owning ALCATRAZ's backend is not.
    const result = scan({
      ...baseline(),
      'relay-bridge/server.ts': 'export const serve = () => {};\n',
      'relay-bridge/tsconfig.json': '{}\n',
      'src/relay/persistence/store.ts': 'export const store = {};\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  /* ---------------------------- reporting ------------------------------ */

  it('reports what it actually checked and claims no universal detection', () => {
    const result = scan(baseline());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('NOT universal secret detection');
    expect(result.stdout).toMatch(/no committed credential matching \d+ known key\/token shapes/);
    // The banner names every surface actually read, so "no active deployment
    // command" can never be printed about a surface that was not scanned.
    expect(result.stdout).toMatch(
      /no active deployment command in package scripts, shell wrappers or \.github workflows \(\d+ behaviours \+ any deployment action\)/,
    );
    expect(result.stdout).toContain('per occurrence, only in test/fixture files');
    // ...and the banner must say what "test/fixture file" now MEANS, because
    // the rule narrowed: a production module named `fixtures.ts` no longer
    // qualifies, and a banner that hid that would overstate the old coverage.
    expect(result.stdout).toContain('never a production module merely named "fixtures"');
    expect(result.stdout).toContain('judged on the residue left after every marker word is stripped');
    // The deployment surface now includes reachable Node and launcher
    // wrappers, and the banner states both the count and — just as important —
    // what is NOT read.
    expect(result.stdout).toMatch(/plus the \d+ script entry point\(s\) those scripts and steps actually run through/);
    // M-1: the banner must state that node arguments are parsed, because the
    // defect it replaced was a banner claiming coverage it did not have.
    expect(result.stdout).toContain('node arguments parsed deterministically');
    expect(result.stdout).toContain('a value-consuming flag and its value are');
    expect(result.stdout).toContain('still found behind a flag this scan does not know');
    expect(result.stdout).toContain('NOT scanned: every other tracked source file');
    expect(result.stdout).toContain('reported as unanalyzable rather than passed');
    expect(result.stdout).toMatch(/forbidden path patterns/);
    // The old banner asserted an absolute that the rules cannot support.
    expect(result.stdout).not.toContain('no deployment step in CI.');
  });

  it('still detects a focused test', () => {
    const focused = `it${'.'}only("x", () => {});\n`;
    const result = scan({ ...baseline(), 'src/relay/x.test.ts': focused });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[focused-test]');
  });
});

/* ===================================================================== *
 * HIGH-1 — the reserved token is stripped, never trusted, and a fixture
 * allowance is honoured by LOCATION rather than by filename.
 * ===================================================================== */

describe('HIGH-1a — a marker word cannot launder a high-entropy value', () => {
  const PAYLOAD = entropyPayload(44);

  /** `sk-ant-` is used because its shape survives a token glued anywhere in it;
   * a fixed-width shape such as an AWS key id simply stops matching instead. */
  const glued: Array<[string, string]> = [
    ['appended after the payload', `${SK}ant-api03-${PAYLOAD}${TOKEN}`],
    ['prepended before the payload', `${SK}ant-${TOKEN}${PAYLOAD}`],
    ['inserted mid-payload', `${SK}ant-api03-${PAYLOAD.slice(0, 20)}${TOKEN}${PAYLOAD.slice(20)}`],
  ];

  for (const [label, value] of glued) {
    it(`reports a real-looking key with the reserved token ${label}, even when annotated`, () => {
      const result = scan({
        ...baseline(),
        'src/relay/keys.test.ts': `export const k = '${value}'; // ${ANNOTATION}\n`,
      });
      expect(result.code, `the token laundered a high-entropy value:\n${result.output}`).toBe(1);
      expect(result.output).toContain('not obviously synthetic');
    });

    it(`reports the same value with no annotation at all (${label})`, () => {
      const result = scan({ ...baseline(), 'src/relay/keys.test.ts': `export const k = '${value}';\n` });
      expect(result.code, result.output).toBe(1);
      expect(result.output).toContain('[secret]');
    });
  }

  it('still accepts the canonical synthetic format in a test file', () => {
    const result = scan({
      ...baseline(),
      'src/relay/keys.test.ts': `export const k = '${SK}${TOKEN}0000000000000000000000';\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('still accepts the canonical synthetic format in a fixture DIRECTORY', () => {
    const result = scan({
      ...baseline(),
      'src/relay/__fixtures__/keys.ts': `export const k = 'AKIA${TOKEN}0'; // ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('the marker word in an unrelated comment does not reach the value', () => {
    const result = scan({
      ...baseline(),
      'src/relay/leak.ts': `// ${TOKEN} — the sample below is not real\nexport const k = '${SK}ant-api03-${PAYLOAD}';\n`,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[secret]');
  });

  it('a realistic value is reported in a workflow and in environment source alike', () => {
    const value = `${SK}ant-api03-${PAYLOAD}`;
    const inWorkflow = scan({
      ...baseline(),
      '.github/workflows/leak.yml':
        `name: leak\njobs:\n  x:\n    steps:\n      - run: echo ${value} # ${ANNOTATION}\n`,
    });
    expect(inWorkflow.code, inWorkflow.output).toBe(1);
    expect(inWorkflow.output).toContain('a workflow file may never carry a fixture allowance');

    const inEnv = scan({ ...baseline(), '.env.example': `KEY=${value} # ${ANNOTATION}\n` });
    expect(inEnv.code, inEnv.output).toBe(1);
    expect(inEnv.output).toContain('environment configuration file may never carry a fixture allowance');
  });

  it('two identical annotated-once values are judged independently', () => {
    const synthetic = `AKIA${'Q'.repeat(16)}`;
    const result = scan({
      ...baseline(),
      'src/relay/keys.test.ts':
        `const a = '${synthetic}'; // ${ANNOTATION}\nconst b = '${synthetic}';\nexport { a, b };\n`,
    });
    expect(result.code, `the unannotated occurrence was laundered:\n${result.output}`).toBe(1);
    expect(result.output).toMatch(/keys\.test\.ts:2 —/);
  });
});

describe('HIGH-1b — a fixture allowance follows the directory, not the filename', () => {
  const SYNTHETIC = `AKIA${'Q'.repeat(16)}`;

  it('a production module NAMED fixtures cannot carry a fixture allowance', () => {
    // This repository ships ten such modules. A name is a claim about a file;
    // a directory is a fact about it.
    const result = scan({
      ...baseline(),
      'src/relay/product/fixtures.ts': `export const k = '${SYNTHETIC}'; // ${ANNOTATION}\n`,
    });
    expect(result.code, `a production module named "fixtures" laundered a value:\n${result.output}`).toBe(1);
    expect(result.output).toContain('production source may never carry a fixture allowance');
  });

  it('a production module named fixture-something is refused the same way', () => {
    const result = scan({
      ...baseline(),
      'src/relay/psp/psp-fixtures.ts': `export const k = '${SYNTHETIC}'; // ${ANNOTATION}\n`,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('production source may never carry a fixture allowance');
  });

  const allowedLocations = [
    'src/relay/keys.test.ts',
    'src/relay/keys.spec.ts',
    'test/keys.ts',
    'tests/keys.ts',
    'src/relay/__tests__/keys.ts',
    'src/relay/fixtures/keys.ts',
    'src/relay/__fixtures__/keys.ts',
    'src/relay/testing/keys.ts',
  ];
  for (const path of allowedLocations) {
    it(`honours an allowance at ${path}`, () => {
      const result = scan({ ...baseline(), [path]: `export const k = '${SYNTHETIC}'; // ${ANNOTATION}\n` });
      expect(result.code, result.output).toBe(0);
    });
  }
});

/* ===================================================================== *
 * HIGH-2 — a `#` opens a comment only when it is unquoted and begins a word.
 * ===================================================================== */

describe('HIGH-2 — a quoted hash is data, not a comment', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  const hidden: Array<[string, string]> = [
    ['a double-quoted hash', '      - run: echo "#" && vercel --prod'],
    ['a single-quoted hash', "      - run: printf '#' && railway up"],
    ['a quoted hash mid-sentence', '      - run: echo "safe # text" ; vercel deploy'],
    ['an escaped hash', '      - run: echo \\# && netlify deploy --prod'],
    ['a hash inside a word', '      - run: curl https://x.test/a#b && wrangler deploy'],
    ['a run: block whose first line quotes a hash', '      - run: |\n          echo "#"\n          vercel --prod'],
  ];

  for (const [label, step] of hidden) {
    it(`still sees the deployment after ${label}`, () => {
      const result = scan(workflowStep(step));
      expect(result.code, `${label} hid the deployment:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    });
  }

  it('a package script that uses # as argument data is still scanned past it', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { ship: "node tool.mjs --anchor='#top' && vercel --prod" } },
        null,
        2,
      ),
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
  });

  it('a GENUINE unquoted trailing comment stays inert', () => {
    const result = scan(workflowStep('      - run: npm test # this repository never runs vercel --prod'));
    expect(result.code, `a real comment was executed:\n${result.output}`).toBe(0);
  });

  it('a deploy phrase that appears only in a full-line comment stays inert', () => {
    const result = scan(workflowStep('      # vercel --prod is never run here\n      - run: npm test'));
    expect(result.code, result.output).toBe(0);
  });

  it('an apostrophe in prose does not turn a real comment into executable text', () => {
    // `Relay's` opens a quote that never closes. Quote tracking would then
    // read the trailing comment as quoted data and scan it as a command, so
    // an unbalanced quote falls back to the plain word-boundary reading.
    const result = scan(workflowStep(
      "      - name: Relay's policy # we never run fly deploy from here\n        run: echo ok",
    ));
    expect(result.code, `prose with an apostrophe was read as a command:\n${result.output}`).toBe(0);
  });
});

/* ===================================================================== *
 * MEDIUM-1 — command position is resolved, not pattern-matched.
 * ===================================================================== */

describe('MEDIUM-1 — a deploy binary is found wherever it sits in command position', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  const evasions: Array<[string, string]> = [
    ['a leading environment assignment', 'env VERCEL_ORG_ID=team_abc vercel --prod'],
    ['a timeout wrapper', 'timeout 600 vercel --prod'],
    ['a relative path into node_modules', './node_modules/.bin/vercel --prod'],
    ['an absolute path', '/usr/local/bin/vercel --prod'],
    ['yarn as the runner', 'yarn vercel --prod'],
    ['npm exec with a separator', 'npm exec -- vercel --prod'],
    ['nohup and sudo together', 'nohup sudo vercel --prod'],
    // A runner OPTION that takes a SEPARATE value. Its value was mistaken for
    // the command, so `sudo -u deploy vercel --prod` resolved to `deploy`.
    ['sudo with a separated user value', 'sudo -u deploy vercel --prod'],
    ['sudo with a long-form user value', 'sudo --user deploy vercel --prod'],
    ['env clearing the environment first', 'env -i vercel --prod'],
    ['env unsetting a variable first', 'env -u NODE_OPTIONS vercel --prod'],
    ['xargs with a replacement token', 'xargs -I {} vercel --prod'],
    ['xargs with a separated argument count', 'xargs -n 1 vercel --prod'],
    ['timeout with a separated signal value', 'timeout -s KILL 60 vercel --prod'],
    ['timeout with an attached signal value', 'timeout --signal=KILL 60 vercel --prod'],
    ['nice with a separated adjustment', 'nice -n 10 vercel --prod'],
    ['sudo with no option at all', 'sudo vercel --prod'],
  ];

  for (const [label, command] of evasions) {
    it(`detects ${label}`, () => {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${label} evaded detection:\n${result.output}`).toBe(1);
      expect(result.output).toContain('a Vercel deployment command');
    });
  }

  // Side-by-side negative controls: the SAME wrappers around a harmless
  // command must stay clean, or the rule would just be "these words are
  // forbidden" rather than "this binary is in command position".
  const controls: Array<[string, string]> = [
    ['an environment assignment before a build', 'env NODE_ENV=production npm run build'],
    ['a timeout around the test suite', 'timeout 600 npm test'],
    ['a relative path to a test runner', './node_modules/.bin/vitest run'],
    ['an absolute path to node', '/usr/local/bin/node scripts/relay-parity-gate.mjs'],
    ['yarn installing dependencies', 'yarn install --frozen-lockfile'],
    ['npm exec around a formatter', 'npm exec -- tsc --noEmit'],
    // The valued-flag rule must consume the VALUE, never the command behind it.
    ['sudo running the test suite as another user', 'sudo -u ci npm test'],
    ['timeout with a signal around the test suite', 'timeout -s KILL 60 npm test'],
    ['nice around a build', 'nice -n 10 npm run build'],
  ];

  for (const [label, command] of controls) {
    it(`does NOT flag ${label}`, () => {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${label} was flagged:\n${result.output}`).toBe(0);
    });
  }

  it('does NOT flag a vendor named in the middle of a sentence', () => {
    const result = scan(workflowStep(
      '      - name: Confirm no Vercel or Railway deployment is configured\n        run: echo ok',
    ));
    expect(result.code, result.output).toBe(0);
  });
});

/* ===================================================================== *
 * MEDIUM-3 — a Node wrapper a package script runs is part of the script.
 * ===================================================================== */

describe('MEDIUM-3 — deployment inside a reachable Node wrapper', () => {
  const shipping = (scripts: Record<string, string>) => ({
    'package.json': JSON.stringify({ name: 'sunday-relay', scripts }, null, 2),
  });

  const wrappers: Array<[string, string, string]> = [
    [
      'an ESM wrapper using execSync',
      'scripts/ship.mjs',
      "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    ],
    [
      'a CommonJS wrapper using require',
      'scripts/ship.cjs',
      "const { execSync } = require('child_process');\nexecSync('railway up');\n",
    ],
    [
      'a TypeScript wrapper using a namespace import',
      'scripts/ship.ts',
      "import cp from 'node:child_process';\ncp.execSync('netlify deploy --prod');\n",
    ],
    [
      'the argument-array form of spawn',
      'scripts/ship.mjs',
      "import { spawn } from 'node:child_process';\nspawn('vercel', ['--prod']);\n",
    ],
    [
      'an aliased import',
      'scripts/ship.mjs',
      "import { execSync as sh } from 'node:child_process';\nsh('flyctl deploy');\n",
    ],
  ];

  for (const [label, path, source] of wrappers) {
    it(`detects ${label} reached by a package script`, () => {
      const result = scan({ ...baseline(), ...shipping({ ship: `node ${path}` }), [path]: source });
      expect(result.code, `${label} was invisible:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
      expect(result.output).toContain(path);
    });
  }

  it('a workflow that runs the package script is reported as an active deployment path', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: npm run ship\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('runs the deploying package script "ship"');
  });

  it('a wrapper that delegates to a local helper is followed', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "import { go } from './deploy-impl.mjs';\ngo();\n",
      'scripts/deploy-impl.mjs':
        "import { execFileSync } from 'node:child_process';\n"
        + "export const go = () => execFileSync('flyctl', ['deploy', '--remote-only']);\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/deploy-impl.mjs');
  });

  it('a command built at runtime is reported as UNANALYZABLE, never passed', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs':
        "import { execSync } from 'node:child_process';\n"
        + 'const target = process.env.RELAY_TARGET;\n'
        + 'execSync(`deploy ${target}`);\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('builds its command at runtime');
  });

  it('a safe wrapper that only DOCUMENTS a deploy command passes', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ verify: 'node scripts/verify.mjs' }),
      'scripts/verify.mjs':
        '// Relay never deploys. We do not run `vercel --prod`, ever.\n'
        + "export const documented = 'vercel --prod';\n",
    });
    expect(result.code, `documentation inside a wrapper was read as a command:\n${result.output}`).toBe(0);
  });

  it('a safe wrapper that shells out to git passes', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ verify: 'node scripts/verify.mjs' }),
      'scripts/verify.mjs':
        "import { execFileSync } from 'node:child_process';\n"
        + "execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('does NOT follow a bundler argument into the source graph', () => {
    // `esbuild src/tool.ts` NAMES a file; it does not run it. Following it
    // would drag the whole product graph into a deployment scan.
    const result = scan({
      ...baseline(),
      ...shipping({ build: 'esbuild src/tool.ts --bundle --outfile=out.cjs' }),
      'src/tool.ts': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a script name containing regex metacharacters is matched literally', () => {
    // A package script NAME is data, not pattern source. Interpolated raw,
    // `build:prod(fast)` becomes a capture group that matches `build:prodfast`
    // and misses the real invocation entirely.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { 'build:prod(fast)': 'vercel --prod', 'build:prod': 'echo safe' } },
        null,
        2,
      ),
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: npm run build:prod(fast)\n      - run: npm run build:prod\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('runs the deploying package script "build:prod(fast)"');
    // The non-deploying script on the next line must not be reported, and the
    // deploying one must not match the shorter name it merely starts with.
    expect(result.output).not.toContain('script "build:prod"');
  });

  it('a script name that is not a valid regular expression does not abort the scan', () => {
    // `deploy[all` throws when compiled as a pattern. A scanner that dies
    // mid-run reports nothing about everything it had not reached yet.
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { 'deploy[all': 'vercel --prod' } },
        null,
        2,
      ),
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: npm run deploy[all\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain('SyntaxError');
    expect(result.output).toContain('RELAY REPOSITORY BOUNDARY: FAIL');
    expect(result.output).toContain('runs the deploying package script "deploy[all"');
  });

  it('a deploying script name is not matched as a prefix of a longer one', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { ship: 'vercel --prod', shipyard: 'echo safe' } },
        null,
        2,
      ),
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: npm run shipyard\n',
    });
    // The `ship` script itself still fails the scan; the point is that the
    // WORKFLOW LINE running `shipyard` is not reported as running `ship`.
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain('runs the deploying package script "ship"');
  });

  it('does NOT scan a tracked script no package script or workflow runs', () => {
    // The scope is reachability. A repository full of .mjs files is not a
    // repository full of deployment paths, and a scan that says otherwise
    // fails on its own tooling before it ever protects anything.
    const result = scan({
      ...baseline(),
      'scripts/unreferenced.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(0);
  });
});

/* ===================================================================== *
 * MEDIUM-3a — every static edge that REACHES a module is followed.
 *
 * The follower read a specifier only when it sat behind `from`, `import(` or
 * `require(`. The BARE SIDE-EFFECT IMPORT carries no binding, so it matched
 * none of them — and it is the one import form whose whole purpose is to RUN a
 * module rather than to take something from it, which is exactly the shape of
 * a deploy wrapper. Measured against the pre-repair scanner:
 *
 *     import { go } from './b.mjs';   DETECT
 *     import { go } from './b';       DETECT
 *     import { go } from './b.js';    DETECT
 *     import './b.mjs';               MISS      <- one line hid a deployment
 *
 * Each edge form below gets a case, and each widening gets a matching negative
 * control — otherwise the rule degrades into "a reached file may not contain
 * these words".
 * ===================================================================== */

describe('MEDIUM-3a — a side-effect import is a reachability edge like any other', () => {
  const shipping = (scripts: Record<string, string>) => ({
    'package.json': JSON.stringify({ name: 'sunday-relay', scripts }, null, 2),
  });
  /** A module whose load-time work is a deployment. */
  const DEPLOYS = "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n";

  it('follows a bare side-effect import into a deploying module', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "import './deploy.mjs';\n",
      'scripts/deploy.mjs': DEPLOYS,
    });
    expect(result.code, `a side-effect import hid the deployment:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/deploy.mjs');
    // The helper inherits the script that reaches it, so the report names the
    // caller rather than falling back to "a package script".
    expect(result.output).toContain('script "ship"');
  });

  it('follows a double-quoted side-effect import', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': 'import "./deploy.mjs";\n',
      'scripts/deploy.mjs': DEPLOYS,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
  });

  it('follows a side-effect import ONE LEVEL DEEPER (a -> b -> c)', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/a.mjs' }),
      'scripts/a.mjs': "import './b.mjs';\n",
      'scripts/b.mjs': "import './c.mjs';\n",
      'scripts/c.mjs': DEPLOYS,
    });
    expect(result.code, `the transitive side-effect chain was not followed:\n${result.output}`).toBe(1);
    expect(result.output).toContain('scripts/c.mjs');
    expect(result.output).toContain('script "ship"');
  });

  it('follows an extensionless side-effect import', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "import './deploy';\n",
      'scripts/deploy.mjs': DEPLOYS,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
  });

  it('follows an `export * from` re-export into a deploying module', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "export * from './deploy.mjs';\n",
      'scripts/deploy.mjs': DEPLOYS,
    });
    expect(result.code, `a re-export edge was not followed:\n${result.output}`).toBe(1);
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  it('follows a named `export { … } from` re-export', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "export { go } from './deploy.mjs';\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('railway up');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  it('follows require() out of a CommonJS wrapper', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.cjs' }),
      'scripts/ship.cjs': "const { go } = require('./deploy.cjs');\ngo();\n",
      'scripts/deploy.cjs':
        "const { execSync } = require('child_process');\nmodule.exports.go = () => execSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/deploy.cjs');
  });

  it('follows a static `await import()` with a LITERAL specifier', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "const m = await import('./deploy.mjs');\nm.go();\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('flyctl deploy');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  it('follows a BACKTICK specifier that contains no substitution', () => {
    // A substitution-free template is a constant, exactly as `staticString`
    // already treats one for a command. Leaving it out would have made a
    // single backtick an evasion of this repair.
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': 'await import(`./deploy.mjs`);\n',
      'scripts/deploy.mjs': DEPLOYS,
    });
    expect(result.code, `a backtick specifier hid the deployment:\n${result.output}`).toBe(1);
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  /* ------------------------- negative controls ------------------------- */

  it('a COMPUTED specifier is REPORTED as unanalyzable — never guessed, never passed', () => {
    // Two things must both hold. The scan must not GUESS which file a runtime
    // specifier names: reporting the deploying module below would be a
    // coincidence, not evidence. And it must not stay SILENT either — a
    // computed specifier hides a whole module subtree, and every command in
    // it, behind one variable. Silence there is the same class of quiet pass
    // that a quoted entry path (F3) and a baseline entry (F9) were.
    const computed: Array<[string, Record<string, string>]> = [
      ['an interpolated template', {
        'scripts/ship.mjs': 'const n = 1;\nawait import(`./deploy-${n}.mjs`);\n',
        'scripts/deploy-1.mjs': DEPLOYS,
      }],
      ['a concatenated require', {
        'scripts/ship.mjs': "const n = 'deploy.cjs';\nrequire('./' + n);\n",
        'scripts/deploy.cjs': "const { execSync } = require('child_process');\nexecSync('vercel --prod');\n",
      }],
      ['a specifier read from the environment', {
        'scripts/ship.mjs': 'await import(process.env.RELAY_STEP);\n',
        'scripts/deploy.mjs': DEPLOYS,
      }],
    ];
    for (const [label, files] of computed) {
      const result = scan({ ...baseline(), ...shipping({ ship: 'node scripts/ship.mjs' }), ...files });
      expect(result.code, `${label} passed in silence:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[deploy-analyzability]');
      expect(result.output).toContain('builds its module specifier at runtime');
      expect(result.output).toContain('scripts/ship.mjs');
      // The module it MIGHT have meant is never named as a deployment: the
      // finding is that the path is unreadable, not that a file deploys.
      expect(result.output, `${label} named a guessed file as a deployment`).not.toContain('[ci-deploy]');
    }
  });

  it('a LITERAL dynamic specifier is FOLLOWED, not reported as unanalyzable', () => {
    // The control that keeps the rule honest: reporting every `import(` would
    // be an easy way to look thorough while resolving nothing.
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "const m = await import('./deploy.mjs');\nm.go();\n",
      'scripts/deploy.mjs':
        "import { execSync } from 'node:child_process';\nexport const go = () => execSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/deploy.mjs');
    expect(result.output, 'a literal specifier was reported instead of followed')
      .not.toContain('builds its module specifier at runtime');
  });

  it('a literal dynamic import of a HARMLESS module reports nothing at all', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "const m = await import('./helper.mjs');\nexport const v = m;\n",
      'scripts/helper.mjs': 'export const go = () => 1;\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a literal BARE-PACKAGE dynamic import is not reported', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "const fs = await import('node:fs');\nexport const ok = Boolean(fs);\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a computed specifier written in PROSE is not a finding', () => {
    // The call site is located in code, never in a comment or a string. A
    // scanner that failed on its own documentation would be unusable, and
    // this repository documents exactly these shapes.
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs':
        '// A computed specifier looks like import(target) or require(base + name).\n'
        + '/* Also written import(`./x-${n}.mjs`) in a block comment. */\n'
        + "export const documented = 'call import(x) to load it';\n",
    });
    expect(result.code, `documentation was read as a computed specifier:\n${result.output}`).toBe(0);
  });

  it('a computed specifier in an UNREFERENCED file is not reported', () => {
    // The rule is about REACHABLE wrappers. A repository full of dynamic
    // imports is not a repository full of hidden deployments.
    const result = scan({
      ...baseline(),
      'scripts/loose.mjs': 'const m = process.env.M;\nawait import(m);\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a side-effect import reaching a module that only DOCUMENTS a deploy passes', () => {
    // The widening follows an EDGE; it does not make a reached file's prose
    // executable. A module that names the command in a comment and in a plain
    // string starts no process, and must not be reported.
    const result = scan({
      ...baseline(),
      ...shipping({ verify: 'node scripts/verify.mjs' }),
      'scripts/verify.mjs': "import './notes.mjs';\n",
      'scripts/notes.mjs':
        '// Relay never deploys. We do not run `vercel --prod`, and never `railway up`.\n'
        + "export const documented = 'vercel --prod';\n"
        + "export const alsoDocumented = ['netlify deploy --prod', 'flyctl deploy'];\n",
    });
    expect(result.code, `documentation behind a side-effect import was read as a command:\n${result.output}`)
      .toBe(0);
  });

  it('mutually-importing modules with no deploy stay clean AND terminate', () => {
    // Cycle protection is load-bearing once side-effect edges are followed:
    // `a` importing `b` importing `a` is ordinary, and a follower that
    // re-queued an analyzed module would never stop. The explicit timeout
    // means a hang is reported as a hang rather than as a suite that stalls.
    const started = Date.now();
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/a.mjs' }),
      'scripts/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
      'scripts/b.mjs': "import './a.mjs';\nexport const b = 2;\n",
    });
    expect(result.code, result.output).toBe(0);
    expect(Date.now() - started, 'the cyclic scan did not terminate promptly').toBeLessThan(20_000);
  }, 30_000);

  it('a cycle does not lose the deployment inside it', () => {
    // Terminating is necessary but not sufficient: the finding must survive.
    const started = Date.now();
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/a.mjs' }),
      'scripts/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
      'scripts/b.mjs': `import './a.mjs';\n${DEPLOYS}`,
    });
    expect(result.code, `the cycle swallowed the deployment:\n${result.output}`).toBe(1);
    expect(result.output).toContain('scripts/b.mjs');
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it('a side-effect import in an UNREFERENCED script is still not scanned', () => {
    // The widening is about which edges are followed, never about widening the
    // ROOTS. An unreachable module graph remains unreachable — this is the
    // bound that keeps the rule from failing on the repository's own tooling.
    const result = scan({
      ...baseline(),
      'scripts/unreferenced.mjs': "import './unreferenced-impl.mjs';\n",
      'scripts/unreferenced-impl.mjs': DEPLOYS,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a bare import of a PACKAGE, not a relative path, is not followed', () => {
    // `import 'dotenv/config';` is a side-effect import of a dependency. Only
    // repository-local relative specifiers are repository files.
    const result = scan({
      ...baseline(),
      ...shipping({ verify: 'node scripts/verify.mjs' }),
      'scripts/verify.mjs': "import 'dotenv/config';\nexport const ok = true;\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a `node <file>` entry resolving INTO the frozen baseline is reported, not dropped (F9)', () => {
    // Refusing to SCAN the frozen baseline is right — it is the evidence the
    // regression suite measures against, and rescanning it would fail the scan
    // at its own proof. Refusing SILENTLY is not: the deployment below is
    // genuinely reachable, and a quiet drop is the same shape of pass F3 was.
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/__baseline__/relay-repository-boundary.d21d383.mjs' }),
      'scripts/__baseline__/relay-repository-boundary.d21d383.mjs': DEPLOYS,
    });
    expect(result.code, `a path through the frozen baseline passed in silence:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('frozen baseline copy');
    // The file itself is still NOT read: the finding is that the path is
    // unanalyzable, never a claim about the baseline's contents.
    expect(result.output).not.toContain('[ci-deploy]');
  });

  it('an IMPORT edge into the frozen baseline is reported the same way (F9)', () => {
    const result = scan({
      ...baseline(),
      ...shipping({ ship: 'node scripts/ship.mjs' }),
      'scripts/ship.mjs': "import './__baseline__/relay-repository-boundary.d21d383.mjs';\n",
      'scripts/__baseline__/relay-repository-boundary.d21d383.mjs': DEPLOYS,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('frozen baseline copy');
    expect(result.output).not.toContain('[ci-deploy]');
  });

  it('the banner states that a side-effect import is followed', () => {
    // The banner is the scanner's claim about its own coverage. A widening
    // that is not stated is a coverage claim nobody can audit.
    const result = scan(baseline());
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain('BARE SIDE-EFFECT');
    expect(result.stdout).toContain('a dynamic import with a literal specifier');
    // The doctrine, stated where anyone reading a PASS can check it: the three
    // things a reachable wrapper can hide are each REPORTED, never passed.
    expect(result.stdout).toContain('Nothing a reachable wrapper cannot be');
    expect(result.stdout).toContain('read through is passed in silence');
    expect(result.stdout).toContain('COMPUTED');
    expect(result.stdout).toContain('frozen baseline');
    expect(result.stdout).toContain('reported as unanalyzable');
    // Each way a wrapper can hide something is NAMED. A doctrine sentence
    // that reads as a closed set must actually enumerate the closed set.
    expect(result.stdout).toContain('createRequire alias');
    expect(result.stdout).toContain('a child_process binding that escapes');
    expect(result.stdout).toContain('any further launcher invocation a wrapper itself runs');
    // M-1 widened the doctrine, so the doctrine sentence widened with it.
    expect(result.stdout).toContain('an entry');
    expect(result.stdout).toContain('built at run time, a program read from standard input');
    expect(result.stdout).toContain('a path above this repository');
  });
});

/* ===================================================================== *
 * F1 — a shell KEYWORD in command position defeated every binary rule.
 *
 * `resolveCommand` skipped environment assignments and runners and then took
 * the head word. `then`, `do`, `else`, `elif` and `in` are none of those, so
 * the KEYWORD became the resolved binary and the deploy behind it vanished.
 * A conditional deploy step is the most natural real shape there is, and all
 * eight DEPLOY_BINARIES hid behind it — in workflows, `.sh` wrappers and
 * package scripts alike.
 * ===================================================================== */

describe('F1 — a deploy behind a shell keyword is still in command position', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  const keywordEvasions: Array<[string, string, string]> = [
    ['then, after a test', 'if true; then vercel --prod; fi', 'a Vercel deployment command'],
    ['do, in a for loop', 'for i in 1 2 3; do railway up; done', 'a Railway deployment command'],
    ['else, on the failing branch', 'if false; then echo x; else vercel --prod; fi', 'a Vercel deployment command'],
    ['elif, on a middle branch', 'if a; then b; elif c; then netlify deploy --prod; fi', 'a Netlify deployment command'],
    ['do, in a while loop', 'while read -r x; do wrangler deploy; done', 'a Cloudflare Wrangler deployment command'],
    ['eval', 'eval vercel --prod', 'a Vercel deployment command'],
    ['a negated command', '! vercel --prod', 'a Vercel deployment command'],
    ['then behind a runner', 'if true; then sudo -u ci vercel --prod; fi', 'a Vercel deployment command'],
  ];

  for (const [label, command, why] of keywordEvasions) {
    it(`detects a deploy introduced by ${label}`, () => {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${label} hid the deployment:\n${result.output}`).toBe(1);
      expect(result.output).toContain(why);
    });
  }

  it('detects the same keyword evasion in a shell wrapper', () => {
    const result = scan({
      ...baseline(),
      'scripts/release.sh': '#!/usr/bin/env bash\nset -euo pipefail\nif [ "$CI" = "1" ]; then vercel --prod; fi\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/release.sh:3');
  });

  it('detects the same keyword evasion in a package script', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify(
        { name: 'sunday-relay', scripts: { ship: 'if true; then vercel --prod; fi' } },
        null,
        2,
      ),
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
  });

  /* A COMPOUND COMMAND'S CONDITION IS ITSELF A COMMAND.
   *
   * `if`, `while` and `until` were held back at first, on the worry that they
   * also open an English sentence. Measured rather than assumed: the guards
   * people actually write stay clean, because none of them puts a deploy
   * binary in command position. */

  const conditionDeploys: Array<[string, string, string]> = [
    ['a deploy as an `if` condition', 'if vercel --prod; then echo ok; fi', 'a Vercel deployment command'],
    ['a deploy as a `while` condition', 'while railway up; do break; done', 'a Railway deployment command'],
    ['a deploy as an `until` condition', 'until vercel deploy; do sleep 1; done', 'a Vercel deployment command'],
  ];

  for (const [label, command, why] of conditionDeploys) {
    it(`detects ${label}`, () => {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${label} hid the deployment:\n${result.output}`).toBe(1);
      expect(result.output).toContain(why);
    });

    it(`detects ${label} in a shell wrapper, where nothing can be annotated`, () => {
      const result = scan({
        ...baseline(),
        'scripts/w.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${command}\n`,
      });
      expect(result.code, result.output).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    });
  }

  /* Negative controls. A keyword skip must not turn the WORD AFTER a keyword
   * into a command wherever the keyword appears — including in prose. */

  it('does NOT flag a harmless command behind the same keywords', () => {
    const controls = [
      'if true; then npm test; fi',
      'for f in src/*; do echo "$f"; done',
      'if false; then echo x; else npm run build; fi',
      'eval npm test',
      'while npm test; do break; done',
      'until npm run build; do sleep 1; done',
    ];
    for (const command of controls) {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${command} was flagged:\n${result.output}`).toBe(0);
    }
  });

  it('does NOT flag the GUARD shapes that check for a deploy CLI', () => {
    // These are the lines a repository writes to PROVE it cannot deploy. Each
    // is in a shell wrapper, the harshest position: `allow-mention` is refused
    // on an executable line, so a false positive here would make the guard
    // impossible to commit. None puts a deploy binary in command position.
    const guards = [
      'if ! command -v vercel; then exit 1; fi',
      'if [ -x vercel ]; then exit 1; fi',
      'if which vercel; then exit 1; fi',
      'if type vercel >/dev/null; then exit 1; fi',
      'if grep -q "vercel" .; then exit 1; fi',
      'echo "Fail if vercel is configured"',
    ];
    for (const line of guards) {
      const result = scan({
        ...baseline(),
        'scripts/guard.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
      });
      expect(result.code, `${line} was flagged, and no annotation can silence it:\n${result.output}`).toBe(0);
    }
  });

  it('does NOT flag prose whose sentence merely contains a keyword', () => {
    const result = scan(workflowStep(
      '      - name: Fail if vercel is configured anywhere in this repository\n        run: npm test',
    ));
    expect(result.code, `a sentence containing a keyword became a command:\n${result.output}`).toBe(0);
  });

  it('a YAML title that OPENS with `if` is reported, and CAN be annotated', () => {
    // The honest cost of including `if`. A `name:` value beginning "If vercel
    // …" does resolve to `vercel`. It is reported — but a `name:` is not an
    // executable position, so `allow-mention` silences it, which is exactly
    // what that annotation exists for. This is the trade-off, pinned rather
    // than hidden.
    const bare = scan(workflowStep('      - name: If vercel is configured, fail\n        run: npm test'));
    expect(bare.code, bare.output).toBe(1);
    expect(bare.output).toContain('named outside an executable position');

    const annotated = scan(workflowStep(
      '      - name: If vercel is configured, fail # relay-boundary:allow-mention\n        run: npm test',
    ));
    expect(annotated.code, `the annotation could not silence a non-executing title:\n${annotated.output}`).toBe(0);
  });
});

/* ===================================================================== *
 * F2 — the two-word-runner branch never dropped the runner's own flags.
 *
 * `RUNNER_PAIRS` sliced two words and continued WITHOUT calling
 * `dropRunnerArguments`, so the runner's own option became the binary. The
 * one form under test, `npm exec -- vercel --prod`, only passed because `--`
 * happens to be handled at the top of that helper.
 * ===================================================================== */

describe('F2 — a two-word runner drops its own arguments before the command', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  const evasions: Array<[string, string]> = [
    ['npm exec with a boolean flag', 'npm exec --yes -- vercel --prod'],
    ['npm exec with a valued package flag', 'npm exec --package vercel -- vercel --prod'],
    ['pnpm dlx with an attached package value', 'pnpm dlx --package=vercel vercel --prod'],
    ['pnpm dlx with a separated package value', 'pnpm dlx --package vercel vercel --prod'],
    ['yarn dlx with a flag', 'yarn dlx --quiet vercel --prod'],
    ['bun x with a flag', 'bun x --bun vercel --prod'],
    ['npm exec with several flags at once', 'npm exec --yes --silent -- vercel --prod'],
  ];

  for (const [label, command] of evasions) {
    it(`detects ${label}`, () => {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${label} evaded detection:\n${result.output}`).toBe(1);
      expect(result.output).toContain('a Vercel deployment command');
    });
  }

  it('does NOT flag the same runners around a harmless command', () => {
    // The valued-flag rule must consume a VALUE, never the command behind it.
    const controls = [
      'npm exec --yes -- tsc --noEmit',
      'pnpm dlx --package=typescript tsc --noEmit',
      'npm run build',
      'pnpm run test',
      'bun run test',
      'yarn dlx --quiet tsc --noEmit',
    ];
    for (const command of controls) {
      const result = scan(workflowStep(`      - run: ${command}`));
      expect(result.code, `${command} was flagged:\n${result.output}`).toBe(0);
    }
  });
});

/* ===================================================================== *
 * F3 and F5 — one root cause, two opposite symptoms.
 *
 * A quote used to FLUSH the current segment, so every quoted run became a
 * segment whose head word was read as a command. That produced a FALSE
 * NEGATIVE (a quoted entry path was never followed) and a FALSE POSITIVE (a
 * vendor named first inside a string became a deployment) at the same time.
 *
 * The false positive was the worse of the two: `checkDeployLine` is called
 * with `executable = true` for wrappers and package scripts, and it
 * deliberately refuses to honour `allow-mention` on an executable line — so
 * an audit script that greps for a deploy CLI could not be committed at all.
 * ===================================================================== */

describe('F3 — a quoted entry path is followed like an unquoted one', () => {
  const shipping = (scripts: Record<string, string>) => ({
    'package.json': JSON.stringify({ name: 'sunday-relay', scripts }, null, 2),
  });
  const DEPLOYS = "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n";

  const quoted: Array<[string, string]> = [
    ['single quotes', "node 'scripts/ship.mjs'"],
    ['double quotes', 'node "scripts/ship.mjs"'],
    ['a quoted path behind a runner', "timeout 600 node 'scripts/ship.mjs'"],
    ['a quoted path with a flag before it', "node --enable-source-maps 'scripts/ship.mjs'"],
  ];

  for (const [label, body] of quoted) {
    it(`follows an entry point named with ${label}`, () => {
      const result = scan({ ...baseline(), ...shipping({ ship: body }), 'scripts/ship.mjs': DEPLOYS });
      expect(result.code, `${label} hid the wrapper entirely:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
      expect(result.output).toContain('scripts/ship.mjs');
    });
  }

  it('follows a quoted entry point named in a workflow step', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: {} }, null, 2),
      'scripts/ship.mjs': DEPLOYS,
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: node "scripts/ship.mjs"\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/ship.mjs');
  });
});

describe('F5 — a vendor named inside a string is not a command', () => {
  /** A wrapper is the harshest case: it is executable, so `allow-mention`
   * cannot rescue a false positive there. */
  const wrapper = (line: string) => ({
    ...baseline(),
    'scripts/audit.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
  });

  const shouldBeClean: Array<[string, string]> = [
    ['a grep for the vendor name', 'grep -R "vercel" .'],
    ['an echo whose string STARTS with the vendor', 'echo "vercel is never used here"'],
    ['a presence check with command -v', 'command -v vercel >/dev/null'],
    ['a presence check with command -V', 'command -V vercel >/dev/null'],
    ['the vendor not first in the string (control)', 'echo "no vercel in this repo"'],
    ['a grep with single quotes', "grep -R 'railway up' ."],
    ['a failing assertion about the vendor', 'grep -q "netlify" . && exit 1'],
    ['a single-quoted vendor as data to a tool', "rg 'flyctl deploy' --files-with-matches"],
  ];

  for (const [label, line] of shouldBeClean) {
    it(`does NOT flag ${label}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${label} was reported, and no annotation can silence it:\n${result.output}`).toBe(0);
    });
  }

  it('an audit script that checks for every deploy CLI is committable', () => {
    // This is the concrete thing the false positive made impossible: a guard
    // in this repository that asserts no deploy CLI is reachable.
    const result = scan({
      ...baseline(),
      'scripts/audit.sh':
        '#!/usr/bin/env bash\n'
        + 'set -euo pipefail\n'
        + 'for tool in "vercel" "railway" "flyctl" "netlify" "wrangler"; do\n'
        + '  if command -v "$tool" >/dev/null; then echo "unexpected: $tool"; exit 1; fi\n'
        + 'done\n',
    });
    expect(result.code, `the repository cannot commit its own deploy-CLI audit:\n${result.output}`).toBe(0);
  });

  /* The other direction: transparency must not hide a real command. */

  const shouldDetect: Array<[string, string]> = [
    ['sh -c with a separator inside', 'sh -c "npm run build && railway up"'],
    ['sh -c with NO separator inside', 'sh -c "vercel --prod"'],
    ['sh -c with single quotes', "sh -c 'railway up'"],
    ['bash -c behind set options', 'bash -eu -o pipefail -c "vercel --prod"'],
    ['a quoted command NAME', '"vercel" --prod'],
    ['command substitution in backticks', 'echo `vercel --prod`'],
    ['command substitution with $()', 'echo $(vercel --prod)'],
    ['a quoted hash before the deploy', 'echo "#" && vercel --prod'],
  ];

  for (const [label, line] of shouldDetect) {
    it(`still detects a deploy via ${label}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${label} was hidden by quote handling:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    });
  }

  it('a shell interpreter running an ordinary script is not a deployment', () => {
    const result = scan({
      ...baseline(),
      'scripts/run.sh': '#!/usr/bin/env bash\nbash scripts/build.sh\nsh -c "npm test"\n',
      'scripts/build.sh': '#!/usr/bin/env bash\nnpm run build\n',
    });
    expect(result.code, result.output).toBe(0);
  });
});

/* ===================================================================== *
 * F7 and F8 — two shapes the matchers could not spell.
 * ===================================================================== */

describe('F7 — a container action is a deployment action', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  it('detects uses: docker://…/deployer', () => {
    // The owner class is `[\w.-]+` and `docker:` carries a colon, so the one
    // action form that can run anything at all matched nothing.
    const result = scan(workflowStep('      - uses: docker://myorg/deployer:latest'));
    expect(result.code, `a container deployment action was invisible:\n${result.output}`).toBe(1);
    expect(result.output).toContain('a third-party deployment action');
  });

  it('still detects the plain owner/name form', () => {
    const result = scan(workflowStep('      - uses: amondnet/vercel-action@v25'));
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('a third-party deployment action');
  });

  it('does NOT flag an ordinary action, container or not', () => {
    for (const step of ['      - uses: actions/checkout@v4', '      - uses: docker://library/node:20']) {
      const result = scan(workflowStep(step));
      expect(result.code, `${step} was flagged:\n${result.output}`).toBe(0);
    }
  });
});

describe('F8 — a backslash path resolves to the same binary and the same file', () => {
  const workflowStep = (step: string) => ({
    ...baseline(),
    '.github/workflows/relay-ci.yml':
      `name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`,
  });

  it('detects a deploy binary named with backslashes', () => {
    const result = scan(workflowStep('      - run: .\\node_modules\\.bin\\vercel --prod'));
    expect(result.code, `a backslash path evaded the binary rule:\n${result.output}`).toBe(1);
    expect(result.output).toContain('a Vercel deployment command');
  });

  it('follows a wrapper named with backslashes', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node .\\scripts\\ship.mjs' } }, null, 2),
      'scripts/ship.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/ship.mjs');
  });

  it('does NOT flag a harmless backslash path', () => {
    const result = scan(workflowStep('      - run: .\\node_modules\\.bin\\vitest run'));
    expect(result.code, result.output).toBe(0);
  });
});

/* ===================================================================== *
 * ITEM A — `createRequire` is a require, and was the last indirection the
 * follower did not know.
 *
 *     import { createRequire } from 'node:module';
 *     const r = createRequire(import.meta.url);
 *     r('./deploy.cjs');            // execSync('vercel --prod') lives here
 *
 * The wrapper passed while reaching a real deploy — the same silent-pass
 * class as a quoted entry path (F3), a baseline entry (F9) and a computed
 * specifier. A literal specifier is now FOLLOWED; anything unreadable is
 * REPORTED.
 * ===================================================================== */

describe('ITEM A — a createRequire result is followed like require', () => {
  const shipping = (entry: string) => ({
    'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: `node ${entry}` } }, null, 2),
  });
  const DEPLOY_CJS = "const { execSync } = require('child_process');\nexecSync('vercel --prod');\n";

  const reaching: Array<[string, string]> = [
    [
      'a plain createRequire binding',
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('./deploy.cjs');\n",
    ],
    [
      'an alias on the import',
      "import { createRequire as cr } from 'node:module';\nconst r = cr(import.meta.url);\nr('./deploy.cjs');\n",
    ],
    [
      "an import from 'module' without the node: prefix",
      "import { createRequire } from 'module';\nconst req = createRequire(import.meta.url);\nreq('./deploy.cjs');\n",
    ],
    [
      'a namespace import of node:module',
      "import mod from 'node:module';\nconst r = mod.createRequire(import.meta.url);\nr('./deploy.cjs');\n",
    ],
    [
      'a call with no binding at all',
      "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./deploy.cjs');\n",
    ],
    [
      'a destructured require of node:module',
      "const { createRequire } = require('node:module');\nconst r = createRequire(__filename);\nr('./deploy.cjs');\n",
    ],
  ];

  for (const [label, body] of reaching) {
    it(`follows ${label} into the deploying module`, () => {
      const result = scan({
        ...baseline(), ...shipping('scripts/s.mjs'), 'scripts/s.mjs': body, 'scripts/deploy.cjs': DEPLOY_CJS,
      });
      expect(result.code, `${label} passed in silence:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
      expect(result.output).toContain('scripts/deploy.cjs');
    });
  }

  it('reports a createRequire alias called with a COMPUTED specifier', () => {
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr(process.env.M);\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
    expect(result.output).toContain('builds its module specifier at runtime');
  });

  it('reports a createRequire binding that is REASSIGNED', () => {
    // Once the binding is rebound it no longer stands for the require it was
    // built from, so what it loads stops being knowable from this file.
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'let r = createRequire(import.meta.url);\n'
        + 'r = globalThis.somethingElse;\n'
        + "r('./helper.cjs');\n",
      'scripts/helper.cjs': 'module.exports.go = () => 1;\n',
    });
    expect(result.code, `a reassigned require binding passed in silence:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[deploy-analyzability]');
  });

  /* ------------------------- negative controls ------------------------- */

  it('does NOT report createRequire loading a harmless local module', () => {
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('./helper.cjs');\n",
      'scripts/helper.cjs': 'module.exports.go = () => 1;\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('does NOT report createRequire loading a bare package', () => {
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'const r = createRequire(import.meta.url);\n'
        + "export const p = r('some-pkg');\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('does NOT report a local function that merely SHARES the name', () => {
    // The alias is derived from a real `createRequire` binding, never from a
    // name that happens to look like one.
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs': "const r = (x) => x;\nexport const v = r('./deploy.cjs');\n",
      'scripts/deploy.cjs': DEPLOY_CJS,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('does NOT report createRequire in an UNREFERENCED file', () => {
    const result = scan({
      ...baseline(),
      'scripts/loose.mjs':
        "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('./deploy.cjs');\n",
      'scripts/deploy.cjs': DEPLOY_CJS,
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a wrapper full of regex literals and prose does not detonate the scan', () => {
    // THE MASKER'S OWN REGRESSION. Locating call sites in masked source went
    // wrong on this repository's own scanner: a quote inside a character
    // class such as ['"] opened a "string" that ran past a block-comment
    // opener, so the comment was read as code and the scan reported two
    // findings against its own documentation. Regex literals are masked now.
    const result = scan({
      ...baseline(),
      ...shipping('scripts/s.mjs'),
      'scripts/s.mjs':
        'const quoted = /[\'"]/g;\n'
        + 'const tricky = /(?:a|b)[\'"`]+/;\n'
        + '/**\n'
        + ' * A computed specifier looks like import(target).\n'
        + " * A createRequire alias is called as r(name), and require(base + n) too.\n"
        + ' */\n'
        + 'export const ok = Boolean(quoted && tricky);\n',
    });
    expect(result.code, `the masker read its own documentation as code:\n${result.output}`).toBe(0);
  });
});

/* ===================================================================== *
 * ITEM B — the same F5 false positive, surviving in the pattern matcher.
 *
 * `DEPLOY_PATTERNS` were tested against the RAW LINE, so a subcommand form
 * named anywhere in it matched — including inside a quoted string. These
 * lines are judged executable, so `allow-mention` is refused on them and they
 * could not be committed at all.
 * ===================================================================== */

describe('ITEM B — a publish command named in a string is not a command', () => {
  const wrapper = (line: string) => ({
    ...baseline(),
    'scripts/audit.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
  });
  const MENTION = 'relay-boundary:allow-mention';

  const inert = [
    'echo "docker push x"',
    'echo "we never npm publish here"',
    'grep -q "gh release create" .',
    "grep -R 'terraform apply' .",
    'echo "kubectl apply is never run here"',
  ];

  for (const line of inert) {
    it(`does NOT flag ${line}`, () => {
      const bare = scan(wrapper(line));
      expect(bare.code, `${line} was reported, and no annotation can silence it:\n${bare.output}`).toBe(0);
      // Annotated must be clean too — not because the annotation worked, but
      // because there was never a finding to silence.
      const annotated = scan(wrapper(`${line} # ${MENTION}`));
      expect(annotated.code, annotated.output).toBe(0);
    });
  }

  it('an audit script that greps for every publish command is committable', () => {
    const result = scan({
      ...baseline(),
      'scripts/audit.sh':
        '#!/usr/bin/env bash\n'
        + 'set -euo pipefail\n'
        + 'for phrase in "docker push" "npm publish" "gh release create" "terraform apply"; do\n'
        + '  if grep -Rq "$phrase" .; then echo "unexpected: $phrase"; exit 1; fi\n'
        + 'done\n',
    });
    expect(result.code, `the repository cannot commit its own publish audit:\n${result.output}`).toBe(0);
  });

  const active: Array<[string, string]> = [
    ['docker push myorg/app:latest', 'a container image push'],
    ['npm publish', 'a package publish'],
    ['gh release create v1', 'a GitHub release publish'],
    ['kubectl apply -f k8s/', 'a Kubernetes deployment command'],
    ['helm upgrade relay ./chart', 'a Helm release'],
    ['terraform apply -auto-approve', 'an infrastructure deployment command'],
    ['supabase db push', 'a database migration or project link'],
    ['fly deploy', 'a Fly.io deployment command'],
    ['aws s3 sync ./dist s3://b', 'an AWS deployment command'],
    ['gcloud run deploy svc', 'a Google Cloud deployment command'],
    ['firebase deploy', 'a hosting deployment command'],
    ['pnpm publish', 'a package publish'],
    ['git push origin gh-pages', 'a deployment push'],
    ['docker buildx build . --push', 'a container image push'],
  ];

  for (const [line, why] of active) {
    it(`still detects ${line}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${line} stopped being detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain(why);
    });
  }

  it('still detects a publish behind a runner or a shell keyword', () => {
    // Resolution strips the runner first, so anchoring the pattern to the
    // head of a RESOLVED command loses none of this.
    const behind = [
      'sudo docker push myorg/app',
      'npx supabase db push',
      'if true; then npm publish; fi',
      'env NODE_ENV=production npm publish',
      'timeout 600 docker push myorg/app',
    ];
    for (const line of behind) {
      const result = scan(wrapper(line));
      expect(result.code, `${line} stopped being detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    }
  });

  it('still detects a publish a reachable wrapper runs', () => {
    const result = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
      'scripts/s.mjs': "import { execSync } from 'node:child_process';\nexecSync('npm publish');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('a package publish');
  });

  it('does NOT flag the harmless forms of the same binaries', () => {
    for (const line of ['npm test', 'git push origin main', 'docker build .', 'kubectl get pods']) {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was flagged:\n${result.output}`).toBe(0);
    }
  });
});

/* ===================================================================== *
 * AN UNKNOWN WRAPPER IS STILL A WRAPPER.
 *
 * Resolution can only skip runners it has been told about, so ONE
 * unrecognised word in front of a deploy hid it. Anchoring the pattern rules
 * to a resolved head made that visible for `xvfb-run docker push x`, which
 * raw matching had caught. The BINARY rules had always been head-only, so
 * `xvfb-run vercel --prod` was never caught by anything.
 *
 * Enumerating wrappers cannot close this — the evasion is "any word not on
 * the list", which is unbounded. Each segment now also yields the command
 * that would run if its head were a wrapper: one literal step, taken only
 * when the head is neither a deploy binary nor a DATA command.
 * ===================================================================== */

describe('an unknown wrapper word does not hide a deploy', () => {
  const wrapper = (line: string) => ({
    ...baseline(),
    'scripts/w.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
  });
  const MENTION = 'relay-boundary:allow-mention';

  const mustDetect: Array<[string, string]> = [
    ['xvfb-run docker push x', 'a container image push'],
    ['xvfb-run vercel --prod', 'a Vercel deployment command'],
    ['someunknownwrapper vercel --prod', 'a Vercel deployment command'],
    ['docker push myorg/app:latest', 'a container image push'],
    ['npm publish', 'a package publish'],
    ['gh release create v1', 'a GitHub release publish'],
    ['sudo docker push x', 'a container image push'],
    ['if true; then npm publish; fi', 'a package publish'],
    ['stdbuf -oL docker push x', 'a container image push'],
  ];

  for (const [line, why] of mustDetect) {
    it(`detects ${line}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was hidden:\n${result.output}`).toBe(1);
      expect(result.output).toContain(why);
    });
  }

  it('an annotation still cannot silence an unknown-wrapper deploy', () => {
    // A wrapper line is executable, so `allow-mention` is refused on it. The
    // recovered coverage inherits that, as it must.
    const result = scan(wrapper(`xvfb-run docker push x # ${MENTION}`));
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('IGNORED — it cannot silence an executable command');
  });

  /* ------------------------- negative controls -------------------------
   *
   * Looking past an unknown head word is only safe because DATA commands are
   * excluded. These are the lines an audit script actually contains, and each
   * sits in a wrapper — the position where no annotation can rescue it. */

  const mustStayClean = [
    'echo "docker push x"',
    'echo "we never npm publish here"',
    'grep -q "gh release create" .',
    'grep -R "vercel" .',
    'if ! command -v vercel; then exit 1; fi',
    // The UNQUOTED forms matter just as much. A rule that keyed on the
    // absence of quotes alone would report every one of these.
    'echo we never npm publish here',
    'echo vercel is never used here',
    'grep -R vercel .',
    'grep -q docker push .',
    // A lookup prints where a binary would be found; it does not run it.
    'if which vercel; then exit 1; fi',
    'if type vercel >/dev/null; then exit 1; fi',
    'if [ -x vercel ]; then exit 1; fi',
    'command -v vercel >/dev/null',
    'hash vercel 2>/dev/null',
    'test -x vercel',
    'find . -name vercel',
  ];

  for (const line of mustStayClean) {
    it(`does NOT flag ${line}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was reported, and no annotation can silence it:\n${result.output}`).toBe(0);
    });
  }

  it('the step is ONE LITERAL word, so prose does not walk into a vendor name', () => {
    // Re-resolving the widened reading through keyword and runner skipping
    // would land on `vercel` here. It is deliberately literal, so it lands on
    // `if` and the sentence stays inert.
    const result = scan({
      ...baseline(),
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - name: Fail if vercel is configured anywhere\n        run: npm test\n',
    });
    expect(result.code, `a sentence walked into a vendor name:\n${result.output}`).toBe(0);
  });

  it('the runner controls are unchanged by the widening', () => {
    const controls = [
      'sudo -u ci npm test',
      'timeout -s KILL 60 npm test',
      'nice -n 10 npm run build',
      'env NODE_ENV=production npm run build',
      './node_modules/.bin/vitest run',
      'npm exec -- tsc --noEmit',
      'yarn install --frozen-lockfile',
      'docker build .',
      'kubectl get pods',
      'git push origin main',
      'npm test',
    ];
    for (const line of controls) {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was flagged:\n${result.output}`).toBe(0);
    }
  });
});

/* ===================================================================== *
 * FINDING A — a runner word swallowed a publish command.
 *
 * Anchoring the pattern rules at the head of a RESOLVED command strips the
 * runner first, and `yarn` IS a runner word, so `yarn publish` resolved to
 * `publish` and `\b(npm|pnpm|yarn|bun)\s+publish\b` could not match it. This
 * was a REGRESSION against the reviewed branch: it hid a founder-authorized
 * action in every surface while the banner still claimed coverage. Every
 * publish fixture was `npm publish` or `pnpm publish` — neither is a runner
 * word — so nothing failed.
 * ===================================================================== */

describe('FINDING A — a publish named by its runner is still a publish', () => {
  const wrapper = (line: string) => ({
    ...baseline(),
    'scripts/p.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${line}\n`,
  });

  const publishes = [
    'yarn publish',
    'yarn publish --access public',
    'sudo yarn publish',
    'if true; then yarn publish; fi',
    'bash -c "yarn publish"',
    'npm publish',
    'pnpm publish',
    'bun publish',
    'xvfb-run yarn publish',
  ];

  for (const line of publishes) {
    it(`detects ${line}`, () => {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was invisible:\n${result.output}`).toBe(1);
      expect(result.output).toContain('a package publish');
    });
  }

  it('detects yarn publish in a package script and in a workflow', () => {
    const inScript = scan({
      ...baseline(),
      'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { release: 'yarn publish' } }, null, 2),
    });
    expect(inScript.code, inScript.output).toBe(1);
    expect(inScript.output).toContain('a package publish');

    const inWorkflow = scan({
      ...baseline(),
      '.github/workflows/relay-ci.yml':
        'name: Relay CI\non:\n  pull_request:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n'
        + '    steps:\n      - run: yarn publish\n',
    });
    expect(inWorkflow.code, inWorkflow.output).toBe(1);
    expect(inWorkflow.output).toContain('a package publish');
  });

  it('does NOT flag the other things a runner does', () => {
    // Re-prefixing the stripped runner must not turn every runner line into a
    // publish.
    for (const line of ['yarn install --frozen-lockfile', 'yarn test', 'yarn build', 'npm run publish']) {
      const result = scan(wrapper(line));
      expect(result.code, `${line} was flagged:\n${result.output}`).toBe(0);
    }
  });

  it("the repository's own publish audit stays committable", () => {
    const result = scan({
      ...baseline(),
      'scripts/audit.sh':
        '#!/usr/bin/env bash\n'
        + 'set -euo pipefail\n'
        + 'for phrase in "docker push" "npm publish" "yarn publish" "gh release create"; do\n'
        + '  if grep -Rq "$phrase" .; then echo "unexpected: $phrase"; exit 1; fi\n'
        + 'done\n',
    });
    expect(result.code, `the repository cannot commit its own publish audit:\n${result.output}`).toBe(0);
  });
});

/* ===================================================================== *
 * FINDINGS B, C, D — the wrapper reader.
 * ===================================================================== */

const SHIPPING = {
  'package.json': JSON.stringify({ name: 'sunday-relay', scripts: { ship: 'node scripts/s.mjs' } }, null, 2),
};

describe('FINDING B — a call site is located in code, never in prose', () => {
  it('a COMMENT naming a deploy call is not a deploy', () => {
    // `maskProse` existed but was never wired to `execCallSites` — the very
    // site-finder it was written for. That was a live hazard in the scanner
    // itself: relay-ci.yml runs it, so it is a reachable entry point, and its
    // own comments name `execSync('vercel --prod')`. It passed only because it
    // imports execFileSync and not execSync.
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs':
        "import { execSync } from 'node:child_process';\n"
        + "// Example of what we must never do: execSync('vercel --prod')\n"
        + "execSync('git status');\n",
    });
    expect(result.code, `a comment was read as a deployment:\n${result.output}`).toBe(0);
  });

  it('a STRING naming a deploy call is not a deploy', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs':
        "import { execSync } from 'node:child_process';\n"
        + 'export const doc = "execSync(\'vercel --prod\')";\n'
        + "execSync('git status');\n",
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a child_process import written only in a COMMENT binds nothing', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs':
        "// import { execSync } from 'node:child_process';\n"
        + "// execSync('vercel --prod');\n"
        + 'export const ok = 1;\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a REAL deploy call is still detected', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
  });
});

describe('FINDING C — a wrapper that runs another node script is followed', () => {
  it('follows execSync("node scripts/deploy.mjs") into the deploy', () => {
    // The command is fully static and names a tracked, scannable file, so this
    // path CAN be read through — and the banner says nothing readable passes
    // in silence.
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import { execSync } from 'node:child_process';\nexecSync('node scripts/deploy.mjs');\n",
      'scripts/deploy.mjs': "import { execSync } from 'node:child_process';\nexecSync('vercel --prod');\n",
    });
    expect(result.code, `a node chain passed in silence:\n${result.output}`).toBe(1);
    expect(result.output).toContain('[ci-deploy]');
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  it('follows the argv form spawnSync("node", ["scripts/deploy.mjs"])', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['scripts/deploy.mjs']);\n",
      'scripts/deploy.mjs': "import { execSync } from 'node:child_process';\nexecSync('railway up');\n",
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('scripts/deploy.mjs');
  });

  it('a node chain to a harmless script reports nothing', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import { execSync } from 'node:child_process';\nexecSync('node scripts/ok.mjs');\n",
      'scripts/ok.mjs': 'export const ok = 1;\n',
    });
    expect(result.code, result.output).toBe(0);
  });

  it('a node chain that cycles terminates', () => {
    const started = Date.now();
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import { execSync } from 'node:child_process';\nexecSync('node scripts/b.mjs');\n",
      'scripts/b.mjs': "import { execSync } from 'node:child_process';\nexecSync('node scripts/s.mjs');\n",
    });
    expect(result.code, result.output).toBe(0);
    expect(Date.now() - started, 'the cyclic node chain did not terminate').toBeLessThan(20_000);
  }, 30_000);
});

describe('FINDING D — a child_process binding that escapes its call form', () => {
  const escapes: Array<[string, string]> = [
    [
      'promisify(exec)',
      "import { exec } from 'node:child_process';\nimport { promisify } from 'node:util';\n"
      + "const run = promisify(exec);\nawait run('vercel --prod');\n",
    ],
    [
      'a destructure off the namespace',
      "import cp from 'node:child_process';\nconst { execSync } = cp;\nexecSync('vercel --prod');\n",
    ],
    [
      'a computed property on the namespace',
      "import cp from 'node:child_process';\ncp['execSync']('vercel --prod');\n",
    ],
    [
      'a binding stored in a variable',
      "import { execSync } from 'node:child_process';\nconst run = execSync;\nrun('vercel --prod');\n",
    ],
  ];

  for (const [label, body] of escapes) {
    it(`reports ${label} rather than passing it`, () => {
      // Following a binding through an arbitrary alias is evaluation, not
      // extraction — the same line this section draws for a computed
      // specifier. So it is REPORTED, which is what the banner promises.
      const result = scan({ ...baseline(), ...SHIPPING, 'scripts/s.mjs': body });
      expect(result.code, `${label} passed in silence:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[deploy-analyzability]');
      expect(result.output).toContain('child_process binding');
    });
  }

  it('an ordinary call is NOT an escape', () => {
    for (const body of [
      "import { execFileSync } from 'node:child_process';\nexecFileSync('git', ['status']);\n",
      "import cp from 'node:child_process';\ncp.execFileSync('git', ['status']);\n",
      "const { execSync } = require('child_process');\nexecSync('git status');\n",
    ]) {
      const result = scan({ ...baseline(), ...SHIPPING, 'scripts/s.mjs': body });
      expect(result.code, `an ordinary call was reported as an escape:\n${result.output}`).toBe(0);
    }
  });

  it('a non-exec property on the namespace is not an escape', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs': "import cp from 'node:child_process';\nexport const f = cp.fork;\n",
    });
    expect(result.code, result.output).toBe(0);
  });
});

/* ===================================================================== *
 * FINDINGS E, F, G — three false positives the repairs introduced.
 * ===================================================================== */

describe('FINDINGS E and F — shell structure is not a command', () => {
  const wrapper = (body: string) => ({
    ...baseline(),
    'scripts/w.sh': `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`,
  });

  it('a case LABEL named for a vendor is not an invocation (E)', () => {
    // A `)` flushed the segment, so the label became a segment head. The
    // branch runs `echo`, never `vercel`.
    const result = scan(wrapper('case "$1" in\n  vercel) echo unsupported; exit 1;;\nesac'));
    expect(result.code, `a case label was read as a command:\n${result.output}`).toBe(0);
  });

  it('a case label with ALTERNATION is not an invocation (E)', () => {
    const result = scan(wrapper('case "$1" in\n  vercel|netlify) echo no; exit 1;;\nesac'));
    expect(result.code, result.output).toBe(0);
  });

  it('a BALANCED paren still exposes what it runs (E control)', () => {
    for (const body of ['echo $(vercel --prod)', '(vercel --prod)', 'echo `vercel --prod`']) {
      const result = scan(wrapper(body));
      expect(result.code, `${body} stopped being detected:\n${result.output}`).toBe(1);
      expect(result.output).toContain('[ci-deploy]');
    }
  });

  it('a line-continued `for … in` list is not a command (F)', () => {
    // `for x in vercel netlify` puts a LIST after `in`, never a command, so
    // skipping `in` made the first list item resolve as one.
    const result = scan(wrapper('for name \\\n  in vercel netlify; do echo "$name"; done'));
    expect(result.code, `a for/in list was read as a command:\n${result.output}`).toBe(0);
  });

  it('the single-line for/in stays clean and its `do` body is still read (F control)', () => {
    expect(scan(wrapper('for name in vercel netlify; do echo "$name"; done')).code).toBe(0);
    const deploying = scan(wrapper('for i in 1 2 3; do railway up; done'));
    expect(deploying.code, deploying.output).toBe(1);
    expect(deploying.output).toContain('a Railway deployment command');
  });
});

describe('FINDING G — a declaration is not a reassignment', () => {
  it('ordinary shadowing of the alias name does not fire', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'const r = createRequire(import.meta.url);\n'
        + "r('./helper.cjs');\n"
        + 'export function f() { let r = 0; r = r + 1; return r; }\n',
      'scripts/helper.cjs': 'module.exports.go = () => 1;\n',
    });
    expect(result.code, `an unrelated local named r was read as a reassignment:\n${result.output}`).toBe(0);
  });

  it('a real reassignment is reported ONCE, in its own words', () => {
    const result = scan({
      ...baseline(),
      ...SHIPPING,
      'scripts/s.mjs':
        "import { createRequire } from 'node:module';\n"
        + 'let r = createRequire(import.meta.url);\n'
        + 'r = globalThis.other;\n'
        + 'r = globalThis.another;\n'
        + "r('./helper.cjs');\n",
      'scripts/helper.cjs': 'module.exports.go = () => 1;\n',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('is reassigned after createRequire built it');
    // Not routed through the `${fn}()` template, which produced the malformed
    // "a reassigned createRequire binding() builds its module specifier".
    expect(result.output).not.toContain('binding() builds its module specifier');
    expect(result.output.match(/is reassigned after createRequire built it/g)).toHaveLength(1);
  });
});

describe('relay parity gate', () => {
  /** A tree with a chosen combination of registry / checker / scripts. */
  function gateTree(opts: { registry: boolean; checker: boolean; scripts: boolean; surfaces: boolean }): RunResult {
    const dir = mkdtempSync(join(workspace, 'gate-'));
    const scripts: Record<string, string> = opts.scripts
      ? {
        'relay:surface-parity:check': 'node scripts/relay-surface-parity.mjs',
        'relay:surface-parity:check:strict': 'node scripts/relay-surface-parity.mjs --strict',
      }
      : {};
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sunday-relay', scripts }, null, 2));
    if (opts.registry) {
      mkdirSync(join(dir, 'src/relay/parity'), { recursive: true });
      cpSync(
        join(REPO_ROOT, 'src/relay/parity/relay-surface-capabilities.json'),
        join(dir, 'src/relay/parity/relay-surface-capabilities.json'),
      );
    }
    if (opts.checker) {
      cpSync(join(REPO_ROOT, 'scripts/relay-surface-parity.mjs'), join(dir, 'scripts/relay-surface-parity.mjs'));
    }
    if (opts.surfaces) {
      mkdirSync(join(dir, 'src/relay/ui'), { recursive: true });
      mkdirSync(join(dir, 'src/relay/cli'), { recursive: true });
      writeFileSync(join(dir, 'src/relay/ui/.keep'), '');
      writeFileSync(join(dir, 'src/relay/cli/.keep'), '');
    }
    return run(PARITY_GATE, dir);
  }

  it('registry present and script present PASSES', () => {
    const result = gateTree({ registry: true, checker: true, scripts: true, surfaces: true });
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain('RELAY PARITY GATE: PASS');
  });

  it('registry present and script missing FAILS', () => {
    const result = gateTree({ registry: true, checker: true, scripts: false, surfaces: true });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('npm script(s) unusable');
  });

  it('script present and registry missing FAILS', () => {
    const result = gateTree({ registry: false, checker: true, scripts: true, surfaces: true });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('nothing to verify');
  });

  it('neither present FAILS on the integrated product', () => {
    const result = gateTree({ registry: false, checker: false, scripts: false, surfaces: true });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('cannot be skipped on the integrated product');
  });

  it('neither present is tolerated ONLY on a historical baseline, and never reads as a pass', () => {
    const result = gateTree({ registry: false, checker: false, scripts: false, surfaces: false });
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain('SKIP — historical baseline commit');
    expect(result.stdout).toContain('This is NOT a parity pass');
  });

  it('this repository passes the gate', () => {
    const result = run(PARITY_GATE, REPO_ROOT);
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain('RELAY PARITY GATE: PASS');
  });
});
