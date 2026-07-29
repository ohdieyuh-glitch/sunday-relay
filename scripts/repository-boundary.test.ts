import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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

/* Synthetic credential shapes. Assembled from fragments so the literals never
 * appear whole in this file — the scanner scans this repository too. */
const SK = 'sk' + '-';
const fake = (prefix: string, body: string) => `${prefix}${body}`;

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
    ['an AWS secret access key', `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYZ\n`],
    ['a database URL with inline credentials', `export const u = 'postgres://svcuser:h7Kq2Lm9Rt4X@db.internal:5432/app';`],
    ['a Supabase service-role assignment', `SUPABASE_SERVICE_ROLE_KEY=abc123XYZ789qrsTUV456defGHI\n`],
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

  it('honours an explicit per-line allow-fixture annotation', () => {
    const result = scan({
      ...baseline(),
      'src/relay/fixture.test.ts':
        `export const k = '${fake(SK + 'proj-', 'abc123XYZ789qrsTUV456defGHI0mnoPQR')}'; // relay-boundary:allow-fixture\n`,
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
    const psp = 'PSP-AGENT-1-RLY742-9fKq2Lm7Rt4XwZ8vB6nH1jD5gS3pY0cU-7e4a';
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
    expect(result.stdout).toMatch(/no active deployment command in any workflow \(\d+ behaviours checked\)/);
    expect(result.stdout).toMatch(/forbidden path patterns/);
    // The old banner asserted an absolute that the rules cannot support.
    expect(result.stdout).not.toContain('no deployment step in CI.');
  });

  it('still detects a focused test', () => {
    const result = scan({ ...baseline(), 'src/relay/x.test.ts': 'it.only("x", () => {});\n' });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('[focused-test]');
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
    expect(result.output).toContain('npm script(s) missing');
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
