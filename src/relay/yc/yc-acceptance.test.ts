import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runYcPreflight, ycDemoNotice, YC_DEMO_LABELS, repositorySlug,
  YC_EXPECTED_REPOSITORY, YC_FORBIDDEN_REPOSITORIES, YC_BASELINE_PATH, YC_BASELINE_SCHEMA_VERSION,
  YC_REQUIRED_DOCS, YC_REQUIRED_SCRIPTS,
  type YcBaseline, type YcCheck, type YcPreflightDeps,
} from './index';
import {
  DEMO_LABELS, DEMO_PLAYBACK_MS, DEMO_SPLASH_LABELS, DEMO_STEP_TICKS,
  demoData, detectCaps, initialState, plainWalkthrough, reduceTick, runProductShell,
  SECRET_SHAPE_RE, type AppState,
} from '../cli/product';
import { DEMO_TIMELINE } from '../cli/product/fixtures';
import { parseCli, runCli, runProductWatch, type CliIo } from '../cli/main';

/**
 * Prompt 8.7 — YC demo acceptance tests. Provider-free: everything here is
 * pure logic, fixtures, fake dependencies, and fake streams. These tests
 * lock the founder-facing demo commands, the truthful labeling, the
 * approved simulation content and pacing, the fatal-path sanitization, and
 * the watch/demo exit behavior.
 */

const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
const PROVIDER_STREAM_RE = /"type"\s*:\s*"(assistant|system|result|item\.completed|session\.created|turn\.completed)"/;

const plainCaps = detectCaps({ argv: { plain: true }, env: {}, isTTY: false, columns: 80 });

interface FakeDepsRecord {
  gitCalls: string[][];
  pathsTouched: string[];
}

/** The real, versioned product baseline — the fake deps serve it verbatim so
 * these tests exercise the document that actually ships. */
const REAL_BASELINE = readFileSync(join(process.cwd(), 'docs/relay/YC_DEMO_BASELINE.json'), 'utf8');
const REAL_REGISTRY = readFileSync(join(process.cwd(), 'src/relay/parity/relay-surface-capabilities.json'), 'utf8');

function fakeDeps(overrides: Partial<{
  branch: string;
  originUrl: string | null;
  baselineJson: string | null;
  registryJson: string | null;
  statusOutput: string;
  missingFiles: string[];
  packageJson: string | null;
  env: Record<string, string | undefined>;
  columns: number | undefined;
  demoExit: number;
  demoLines: string[];
}> = {}): { deps: YcPreflightDeps; record: FakeDepsRecord } {
  const record: FakeDepsRecord = { gitCalls: [], pathsTouched: [] };
  const scripts = Object.fromEntries(YC_REQUIRED_SCRIPTS.map((name) => [name, `echo ${name}`]));
  const packageJson = overrides.packageJson !== undefined
    ? overrides.packageJson
    : JSON.stringify({ scripts });
  const demoLines = overrides.demoLines ?? plainWalkthrough(demoData(), plainCaps);
  const missing = new Set(overrides.missingFiles ?? []);
  const deps: YcPreflightDeps = {
    runGit(args) {
      record.gitCalls.push([...args]);
      if (args[0] === 'remote') {
        const url = overrides.originUrl !== undefined
          ? overrides.originUrl
          : `https://github.com/${YC_EXPECTED_REPOSITORY}.git`;
        return url === null ? { ok: false, stdout: '' } : { ok: true, stdout: url };
      }
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
        return { ok: true, stdout: overrides.branch ?? 'main' };
      }
      if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc1234' };
      if (args[0] === 'status') return { ok: true, stdout: overrides.statusOutput ?? '' };
      return { ok: false, stdout: '' };
    },
    fileExists(relPath) {
      record.pathsTouched.push(relPath);
      return !missing.has(relPath);
    },
    readTextFile(relPath) {
      record.pathsTouched.push(relPath);
      if (relPath === 'package.json') return packageJson;
      if (relPath === YC_BASELINE_PATH) {
        return overrides.baselineJson !== undefined ? overrides.baselineJson : REAL_BASELINE;
      }
      if (relPath === 'src/relay/parity/relay-surface-capabilities.json') {
        return overrides.registryJson !== undefined ? overrides.registryJson : REAL_REGISTRY;
      }
      return null;
    },
    env: overrides.env ?? {},
    columns: overrides.columns ?? 120,
    runPlainDemo: async () => ({ lines: demoLines, exitCode: overrides.demoExit ?? 0 }),
  };
  return { deps, record };
}

describe('YC preflight (Prompt 8.7 acceptance)', () => {
  it('exits zero on valid main-repository state and reports READY FOR FOUNDER ACCEPTANCE', async () => {
    const { deps } = fakeDeps();
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(0);
    const text = report.lines.join('\n');
    expect(text).toContain('SUNDAY RELAY — YC DEMO PREFLIGHT');
    expect(text).toContain('READY FOR FOUNDER ACCEPTANCE');
    expect(text).toContain(YC_EXPECTED_REPOSITORY);
    expect(text).toContain('npm run relay:yc-demo:cli');
    expect(report.checks.every((c) => c.status !== 'FAIL')).toBe(true);
  });

  it('runs ONLY read-only git subcommands — never a mutation, provider, or deploy process', async () => {
    const { deps, record } = fakeDeps();
    await runYcPreflight(deps);
    expect(record.gitCalls.length).toBeGreaterThan(0);
    for (const call of record.gitCalls) {
      expect(['rev-parse', 'status', 'merge-base', 'remote']).toContain(call[0]);
      if (call[0] === 'remote') expect(call).toEqual(['remote', 'get-url', 'origin']);
    }
  });

  it('touches only repo-relative paths and NEVER a path outside this checkout', async () => {
    const { deps, record } = fakeDeps();
    await runYcPreflight(deps);
    expect(record.pathsTouched.length).toBeGreaterThan(0);
    for (const path of record.pathsTouched) {
      expect(path.startsWith('/')).toBe(false);
      expect(path.includes('..')).toBe(false);
      expect(path.includes('claude-home')).toBe(false);
      expect(path.includes('sunday-relay-claude')).toBe(false);
    }
  });

  it('the deps interface offers no write, no network, and no arbitrary-exec capability', () => {
    const { deps } = fakeDeps();
    const keys = Object.keys(deps).sort();
    expect(keys).toEqual(['columns', 'env', 'fileExists', 'readTextFile', 'runGit', 'runPlainDemo']);
  });

  /* ------------------- post-separation re-anchoring -------------------
   * Readiness is a statement about the PRODUCT and the REPOSITORY, never
   * about a branch or a commit. The old anchors (feature/relay-yc-demo,
   * 9f8075f) named an Alcatraz branch and a commit absent from this object
   * store, so they could never pass here and asserted nothing about Relay.
   * ------------------------------------------------------------------ */

  it('no longer requires any branch name or commit SHA anywhere in the engine', () => {
    const engine = readFileSync(join(process.cwd(), 'src/relay/yc/preflight.ts'), 'utf8');
    const executable = engine
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments may explain the history
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '');
    expect(executable).not.toContain('feature/relay-yc-demo');
    expect(executable).not.toContain('9f8075f');
    expect(executable).not.toContain('merge-base');
    // And the whole module — comments included — must not re-introduce them
    // as exported constants.
    expect(engine).not.toContain('YC_EXPECTED_BRANCH =');
    expect(engine).not.toContain('YC_MINIMUM_COMMIT =');
  });

  it('passes in the correct repository', async () => {
    const { deps } = fakeDeps({ originUrl: `https://github.com/${YC_EXPECTED_REPOSITORY}.git` });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(0);
    expect(report.checks.find((c) => c.name === 'repository-identity')?.status).toBe('PASS');
  });

  it('FAILS in the Alcatraz repository, and says which product it found', async () => {
    for (const forbidden of YC_FORBIDDEN_REPOSITORIES) {
      const { deps } = fakeDeps({ originUrl: `https://github.com/${forbidden}.git` });
      const report = await runYcPreflight(deps);
      expect(report.exitCode, forbidden).toBe(1);
      const identity = report.checks.find((c) => c.name === 'repository-identity');
      expect(identity?.status).toBe('FAIL');
      expect(identity?.detail).toContain('Sunday Alcatraz');
      expect(report.lines.join('\n')).toContain('NOT READY');
    }
  });

  it('FAILS when there is no origin at all — an unknown repository is never a pass', async () => {
    const { deps } = fakeDeps({ originUrl: null });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'repository-identity')?.detail).toContain('no origin remote');
  });

  it('recognises every remote spelling of the same repository', () => {
    for (const url of [
      `https://github.com/${YC_EXPECTED_REPOSITORY}.git`,
      `https://github.com/${YC_EXPECTED_REPOSITORY}`,
      `git@github.com:${YC_EXPECTED_REPOSITORY}.git`,
      `ssh://git@github.com/${YC_EXPECTED_REPOSITORY}.git`,
    ]) {
      expect(repositorySlug(url), url).toBe(YC_EXPECTED_REPOSITORY);
    }
    expect(repositorySlug('')).toBeNull();
    expect(repositorySlug('not-a-url')).toBeNull();
  });

  it('is branch-independent: main, relay/* and a detached CI head all pass identically', async () => {
    const reports = [];
    for (const branch of ['main', 'relay/integration-stabilization', 'relay/fix-anything', 'HEAD']) {
      const { deps } = fakeDeps({ branch });
      const report = await runYcPreflight(deps);
      expect(report.exitCode, branch).toBe(0);
      reports.push(report.checks.filter((c) => c.status === 'FAIL').length);
    }
    expect(reports).toEqual([0, 0, 0, 0]);
  });

  it('names a detached CI head truthfully instead of calling it a branch', async () => {
    const { deps } = fakeDeps({ branch: 'HEAD' });
    const report = await runYcPreflight(deps);
    const checkout = report.checks.find((c) => c.name === 'checkout');
    expect(checkout?.status).toBe('INFO');
    expect(checkout?.detail).toContain('detached HEAD');
    expect(checkout?.detail).toContain('branch-independent');
  });

  it('FAILS when the product baseline document is missing or unreadable', async () => {
    for (const baselineJson of [null, '{ not json']) {
      const { deps } = fakeDeps({ baselineJson });
      const report = await runYcPreflight(deps);
      expect(report.exitCode).toBe(1);
      expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain(YC_BASELINE_PATH);
    }
  });

  it('FAILS on an unknown baseline schema version rather than guessing', async () => {
    const baseline = { ...(JSON.parse(REAL_BASELINE) as YcBaseline), schemaVersion: 999 };
    const { deps } = fakeDeps({ baselineJson: JSON.stringify(baseline) });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain('schemaVersion');
  });

  it('FAILS when a baseline tries to re-point identity at another repository', async () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    baseline.repository.expectedNameWithOwner = 'ohdieyuh-glitch/turbo-broccoli';
    const { deps } = fakeDeps({ baselineJson: JSON.stringify(baseline) });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain('different repository');
  });

  it('FAILS when the official Relay Dog is missing', async () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    const dogFiles = baseline.requiredFiles.officialRelayDog;
    expect(dogFiles.length).toBeGreaterThan(0);
    const { deps } = fakeDeps({ missingFiles: [dogFiles[0]] });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    const check = report.checks.find((c) => c.name === 'product-baseline');
    expect(check?.status).toBe('FAIL');
    expect(check?.detail).toContain('officialRelayDog');
  });

  it('FAILS when the CLI entry point is missing', async () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    const { deps } = fakeDeps({ missingFiles: [baseline.requiredFiles.cliEntry[0]] });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain('cliEntry');
  });

  it('FAILS when the website entry point is missing', async () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    const { deps } = fakeDeps({ missingFiles: [baseline.requiredFiles.websiteEntry[0]] });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain('websiteEntry');
  });

  it('FAILS when a required demo contract fixture is missing', async () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    const { deps } = fakeDeps({ missingFiles: [baseline.requiredFiles.demoContractFixtures[0]] });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'product-baseline')?.detail).toContain('demoContractFixtures');
  });

  it('FAILS when a baseline capability is absent from the parity registry', async () => {
    const registry = JSON.parse(REAL_REGISTRY) as { capabilities: Array<{ capabilityId: string }> };
    registry.capabilities = registry.capabilities.slice(1);
    const dropped = (JSON.parse(REAL_REGISTRY) as typeof registry).capabilities[0].capabilityId;
    const { deps } = fakeDeps({ registryJson: JSON.stringify(registry) });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    const check = report.checks.find((c) => c.name === 'surface-parity-registry');
    expect(check?.status).toBe('FAIL');
    expect(check?.detail).toContain(dropped);
  });

  it('FAILS when the capability registry itself is missing', async () => {
    const { deps } = fakeDeps({ registryJson: null });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'surface-parity-registry')?.detail).toContain('registry missing');
  });

  it('FAILS when the demo drops a truthful offline disclosure label', async () => {
    for (const label of YC_DEMO_LABELS) {
      const lines = plainWalkthrough(demoData(), plainCaps).map((l) => l.split(label).join('REDACTED'));
      const { deps } = fakeDeps({ demoLines: lines });
      const report = await runYcPreflight(deps);
      expect(report.exitCode, label).toBe(1);
      expect(report.checks.find((c) => c.name === 'plain-demo')?.detail, label).toContain(label);
    }
  });

  it('the shipped baseline is internally consistent with the shipped registry', () => {
    const baseline = JSON.parse(REAL_BASELINE) as YcBaseline;
    const registry = JSON.parse(REAL_REGISTRY) as { capabilities: Array<{ capabilityId: string }> };
    expect(baseline.schemaVersion).toBe(YC_BASELINE_SCHEMA_VERSION);
    expect(baseline.repository.expectedNameWithOwner).toBe(YC_EXPECTED_REPOSITORY);
    expect(baseline.repository.forbiddenNamesWithOwner).toEqual([...YC_FORBIDDEN_REPOSITORIES]);
    expect(baseline.requiredCapabilityIds.length).toBe(registry.capabilities.length);
    const ids = new Set(registry.capabilities.map((c) => c.capabilityId));
    for (const id of baseline.requiredCapabilityIds) expect(ids.has(id), id).toBe(true);
    expect([...baseline.demoDisclosure.labels]).toEqual([...YC_DEMO_LABELS]);
    // The baseline is data, not an Alcatraz pin.
    expect(REAL_BASELINE).not.toContain('9f8075f');
    expect(REAL_BASELINE).not.toContain('feature/relay-yc-demo');
  });

  it('makes no provider call and starts no process while doing all of this', async () => {
    const { deps, record } = fakeDeps();
    const report = await runYcPreflight(deps);
    expect(report.checks.find((c) => c.name === 'no-live-provider')?.status).toBe('PASS');
    expect(report.checks.find((c) => c.name === 'no-deployment')?.status).toBe('PASS');
    for (const call of record.gitCalls) {
      expect(['rev-parse', 'status', 'remote']).toContain(call[0]);
    }
  });

  it('reports a dirty tree as WARN (never blocking, never deleting) — Gate B runs pre-commit', async () => {
    const { deps, record } = fakeDeps({ statusOutput: ' M a.ts\n M b.ts\n?? c.ts' });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(0);
    const tree = report.checks.find((c) => c.name === 'working-tree');
    expect(tree?.status).toBe('WARN');
    expect(tree?.detail).toContain('3 uncommitted change(s)');
    expect(tree?.detail).toContain('nothing is modified or deleted');
    for (const call of record.gitCalls) expect(['rev-parse', 'status', 'merge-base', 'remote']).toContain(call[0]);
  });

  it('reports the frontend as MANUAL VERIFICATION REQUIRED without inspecting it', async () => {
    const { deps } = fakeDeps();
    const report = await runYcPreflight(deps);
    const text = report.lines.join('\n');
    const frontend = report.checks.find((c) => c.name === 'browser-frontend');

    expect(text).toContain('MANUAL VERIFICATION REQUIRED');
    expect(frontend?.status).toBe('MANUAL');
    // The reason must be the TRUE one: the browser surface is in this
    // repository, and this check simply does not look at it. It is not owned
    // by some other repository or session.
    expect(frontend?.detail).toMatch(/not inspected by this check/u);
    expect(text).toMatch(/never inspects the browser surface/u);
    expect(text).toMatch(/record the exact frontend command \+ URL/iu);
    for (const stale of ['separate frontend session', 'Worktree owned']) {
      expect(text, `"${stale}" describes a repository split that does not exist`).not.toContain(stale);
    }
    // MANUAL is never allowed to read as verified.
    expect(frontend?.status).not.toBe('PASS');
  });

  it('fails when a required npm demo script is missing', async () => {
    const { deps } = fakeDeps({ packageJson: JSON.stringify({ scripts: { 'relay:cli:demo': 'x' } }) });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.lines.join('\n')).toContain('missing npm script(s)');
  });

  it('fails when required documentation is missing', async () => {
    const { deps } = fakeDeps({ missingFiles: ['docs/relay/YC_DEMO_RUNBOOK.md'] });
    const report = await runYcPreflight(deps);
    expect(report.exitCode).toBe(1);
    expect(report.lines.join('\n')).toContain('YC_DEMO_RUNBOOK.md');
  });

  it('fails when the plain demo exits nonzero or loses its offline labels', async () => {
    const bad = await runYcPreflight(fakeDeps({ demoExit: 3 }).deps);
    expect(bad.exitCode).toBe(1);
    const unlabeled = await runYcPreflight(fakeDeps({ demoLines: ['no labels here'] }).deps);
    expect(unlabeled.exitCode).toBe(1);
    expect(unlabeled.lines.join('\n')).toContain('missing labels');
  });

  it('never prints secret-like values, session ids, or provider stream shapes', async () => {
    const { deps } = fakeDeps({
      env: { NO_COLOR: '1', FAKE: 'sk-FAKETESTNOTREAL000000' },
      branch: 'feature/relay-yc-demo',
    });
    const report = await runYcPreflight(deps);
    const text = report.lines.join('\n');
    SECRET_SHAPE_RE.lastIndex = 0;
    expect(SECRET_SHAPE_RE.test(text)).toBe(false);
    expect(UUID_RE.test(text)).toBe(false);
    expect(PROVIDER_STREAM_RE.test(text)).toBe(false);
  });

  it('scrubs control bytes out of git-provided values (branch names cannot inject)', async () => {
    const { deps } = fakeDeps({ branch: 'evil\x1b[2J\x07branch' });
    const report = await runYcPreflight(deps);
    const text = report.lines.join('\n');
    expect(text.includes('\x07')).toBe(false);
    expect(/\x1b\[2J/.test(text)).toBe(false);
    // The branch is reported, not gated, so a hostile branch name must not
    // change the verdict either — it is scrubbed and the run still passes.
    expect(report.exitCode).toBe(0);
    expect(report.checks.find((c) => c.name === 'checkout')?.status).toBe('INFO');
  });

  it('scrubs a hostile origin URL and still refuses to call it the Relay repository', async () => {
    const { deps } = fakeDeps({ originUrl: 'https://github.com/evil\x1b[2J\x07owner/repo.git' });
    const report = await runYcPreflight(deps);
    const text = report.lines.join('\n');
    expect(text.includes('\x07')).toBe(false);
    expect(/\x1b\[2J/.test(text)).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.checks.find((c) => c.name === 'repository-identity')?.status).toBe('FAIL');
  });

  it('a thrown plain-demo error is scrubbed of absolute paths and secret shapes', async () => {
    const { deps } = fakeDeps();
    deps.runPlainDemo = async () => { throw new Error('EACCES /home/secretuser/.config sk-FAKETESTNOTREAL000000'); };
    const report = await runYcPreflight(deps);
    const text = report.lines.join('\n');
    expect(report.exitCode).toBe(1);
    expect(text).not.toContain('/home/secretuser');
    expect(text).not.toContain('sk-FAKETESTNOTREAL000000');
    expect(text).toContain('[redacted]');
  });

  it('the honesty notice names every offline label and the separate real proof', () => {
    for (const unicode of [true, false]) {
      const notice = ycDemoNotice(unicode).join('\n');
      for (const label of YC_DEMO_LABELS) expect(notice).toContain(label);
      expect(notice).toContain('NO REAL FILE CHANGES');
      expect(notice).toContain('Prompt 8.4');
    }
    expect(YC_DEMO_LABELS).toEqual([...DEMO_LABELS]);
  });
});

describe('YC demo command wiring (real package.json)', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('the approved CLI demo command remains available and unchanged', () => {
    expect(packageJson.scripts['relay:cli:demo']).toBe('npm run relay:build --silent && node dist-relay/cli.cjs cli demo');
    expect(packageJson.scripts['relay:cli:demo:plain']).toBe('npm run relay:build --silent && node dist-relay/cli.cjs cli demo --plain');
    expect(packageJson.scripts['relay:cli:contract-verify']).toBe('npm run relay:build --silent && node dist-relay/cli.cjs cli contract-verify');
  });

  it('the founder commands exist and route to the yc CLI (never a second demo engine)', () => {
    expect(packageJson.scripts['relay:yc-demo:check']).toBe('npm run relay:build --silent && node dist-relay/cli.cjs yc check');
    expect(packageJson.scripts['relay:yc-demo:cli']).toBe('npm run relay:build --silent && node dist-relay/cli.cjs yc demo');
  });

  it('no founder demo script can reach a live provider flag', () => {
    for (const name of ['relay:yc-demo:check', 'relay:yc-demo:cli', 'relay:cli:demo', 'relay:cli:demo:plain']) {
      expect(packageJson.scripts[name]).not.toContain('--confirm-live');
    }
  });

  it('every doc the preflight requires exists in this checkout', () => {
    for (const doc of YC_REQUIRED_DOCS) {
      expect(readFileSync(join(process.cwd(), doc), 'utf8').length, doc).toBeGreaterThan(0);
    }
  });
});

describe('approved simulation content (fixture language)', () => {
  const timeline = JSON.stringify(DEMO_TIMELINE);
  const plain = plainWalkthrough(demoData(), plainCaps).join('\n');

  it('stays labeled offline on every surface', () => {
    for (const label of DEMO_LABELS) expect(plain).toContain(label);
    expect(DEMO_SPLASH_LABELS.join(' ')).toContain('NO REAL FILE CHANGES');
  });

  it('shows Prompt Architect generation, research, Project Brain, and handoff', () => {
    expect(timeline).toContain('Generating implementation handoff');
    expect(timeline).toContain('Researching project details');
    expect(timeline).toContain('Updating Project Brain');
    expect(timeline).toContain('Handoff ready.');
  });

  it('shows Coding Agent inspection, edits, fixture tests, and the CLAIM', () => {
    expect(timeline).toContain('Inspecting claimed files');
    expect(timeline).toContain('Editing claimed file');
    expect(timeline).toContain('Running approved verification');
    expect(timeline).toContain('CLAIM PENDING VERIFICATION');
  });

  it('shows Relay treating reports as claims, verifying evidence, and holding output', () => {
    expect(timeline).toContain('claim, not proof');
    expect(timeline).toContain('Inspecting workspace revision');
    expect(timeline).toContain('Verified evidence.');
    expect(timeline).toContain('HELD FOR REVIEW');
    expect(timeline).toContain('Context preserved. Handoff intact.');
  });

  it('shows independent review, Finding F-1, Repair R-1, re-review, approval', () => {
    expect(timeline).toContain('Independent review active.');
    expect(timeline).toContain('Finding F-1');
    expect(timeline).toContain('Repair R-1 created');
    expect(timeline).toContain('Re-review active.');
    expect(timeline).toContain('Approved.');
  });

  it('VERIFIED COMPLETE appears only at the final CompletionPolicy step', () => {
    const completeIndexes = DEMO_TIMELINE
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.primary.includes('Mission verified complete'));
    expect(completeIndexes).toHaveLength(1);
    expect(completeIndexes[0]?.index).toBe(DEMO_TIMELINE.length - 1);
    expect(DEMO_TIMELINE[DEMO_TIMELINE.length - 1]?.secondary).toContain('CompletionPolicy satisfied');
  });

  it('the plain-mode snapshot is deterministic', () => {
    const again = plainWalkthrough(demoData(), plainCaps).join('\n');
    expect(again).toBe(plain);
  });

  it('contains no secret-shaped value, session id, or provider stream', () => {
    SECRET_SHAPE_RE.lastIndex = 0;
    expect(SECRET_SHAPE_RE.test(plain)).toBe(false);
    expect(UUID_RE.test(plain)).toBe(false);
    expect(PROVIDER_STREAM_RE.test(plain)).toBe(false);
    expect(/\blive\b/i.test(JSON.stringify(DEMO_TIMELINE))).toBe(false); // no fake live-provider claim
  });
});

describe('approved simulation pacing (locked)', () => {
  it('locks the founder-approved constants: 300ms tick × 7 steps × 21 events ≈ 42s', () => {
    expect(DEMO_PLAYBACK_MS).toBe(300);
    expect(DEMO_STEP_TICKS).toBe(7);
    expect(DEMO_TIMELINE.length).toBe(21);
    const reveals = DEMO_TIMELINE.length - 1; // splash enters at event 1
    const durationMs = DEMO_PLAYBACK_MS * DEMO_STEP_TICKS * reveals;
    expect(durationMs).toBe(42_000);
  });

  it('cannot become an accidental instant or excessively long demonstration', () => {
    const reveals = DEMO_TIMELINE.length - 1;
    for (const speed of [1, 1.5, 2]) {
      const ticksPerReveal = Math.max(1, Math.round(DEMO_STEP_TICKS / speed));
      const durationMs = DEMO_PLAYBACK_MS * ticksPerReveal * reveals;
      expect(durationMs).toBeGreaterThanOrEqual(15_000);
      expect(durationMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('the shell tick floor prevents a runaway interval', () => {
    const shell = readFileSync(join(process.cwd(), 'src/relay/cli/product/shell.ts'), 'utf8');
    expect(shell).toContain('Math.max(200, options.playbackMs || 600)');
  });

  it('reduceTick still reveals exactly one event per step and settles at COMPLETE', () => {
    const data = demoData();
    let state: AppState = { ...initialState(true), screen: 'console', playing: true, timelineCount: 1 };
    let reveals = 0;
    for (let i = 0; i < DEMO_STEP_TICKS * (DEMO_TIMELINE.length + 2); i += 1) {
      const stepped = reduceTick(state, data);
      if (stepped.revealed) reveals += 1;
      state = stepped.state;
    }
    expect(state.timelineCount).toBe(DEMO_TIMELINE.length);
    expect(state.playing).toBe(false); // settled — never loops or overruns
    expect(reveals).toBe(DEMO_TIMELINE.length - 1);
  });
});

describe('fatal-path safety and terminal restoration', () => {
  interface FakeStdin extends EventEmitter {
    isTTY: boolean;
    resume(): void;
    pause(): void;
    setEncoding(encoding: string): void;
  }
  function fakeStreams(): { stdin: FakeStdin; stdout: { write(text: string): boolean }; output: string[] } {
    const output: string[] = [];
    const stdin = new EventEmitter() as FakeStdin;
    stdin.isTTY = false;
    stdin.resume = () => undefined;
    stdin.pause = () => undefined;
    stdin.setEncoding = () => undefined;
    const stdout = { write: (text: string): boolean => { output.push(text); return true; } };
    return { stdin, stdout, output };
  }
  const caps = detectCaps({ argv: {}, env: {}, isTTY: false, columns: 80 });

  it('a fatal error exits 1 with a SANITIZED message and restores the terminal', async () => {
    const { stdin, stdout, output } = fakeStreams();
    const pending = runProductShell({
      caps, data: demoData(), store: null, playbackMs: 0, now: () => '2026-07-26T12:43:00.000Z',
      stdin: stdin as never, stdout: stdout as never,
    });
    stdin.emit('error', new Error('boom \x1b[2J\x07 sk-FAKETESTNOTREAL000000 aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
    const code = await pending;
    expect(code).toBe(1);
    const errorLine = output.find((chunk) => chunk.includes('Relay CLI error:'));
    expect(errorLine).toBeDefined();
    expect(errorLine).not.toContain('\x1b');
    expect(errorLine).not.toContain('\x07');
    expect(errorLine).not.toContain('sk-FAKETESTNOTREAL000000');
    expect(errorLine).toContain('[REDACTED]');
    expect(errorLine).toContain('[session-ref]');
    expect(output.join('')).toContain('\x1b[?25h'); // cursor restored on the fatal path too
  });

  it('a clean quit exits 0 and restores the terminal', async () => {
    const { stdin, stdout, output } = fakeStreams();
    const pending = runProductShell({
      caps, data: demoData(), store: null, playbackMs: 0, now: () => '2026-07-26T12:43:00.000Z',
      stdin: stdin as never, stdout: stdout as never,
    });
    stdin.emit('data', 'q'); // home screen: quit
    const code = await pending;
    expect(code).toBe(0);
    expect(output.join('')).toContain('\x1b[?25h');
  });
});

describe('product watch exit behavior', () => {
  it('resolves with the LAST produced exit code on Ctrl+C and restores the terminal', async () => {
    const signals = new EventEmitter();
    const writes: string[] = [];
    const pending = runProductWatch(
      () => ({ lines: ['view'], exitCode: 3 }),
      (r) => { writes.push(r.lines.join('\n')); return r.exitCode; },
      { intervalMs: 200, write: (text) => { writes.push(text); }, signalSource: signals as never },
    );
    signals.emit('SIGINT');
    const code = await pending;
    expect(code).toBe(3);
    expect(writes.join('')).toContain('view');
    expect(writes.join('')).toContain('\x1b[?25h');
    expect(signals.listenerCount('SIGINT')).toBe(0); // listener detached
  });

  it('a healthy watch still exits 0', async () => {
    const signals = new EventEmitter();
    const pending = runProductWatch(
      () => ({ lines: ['ok'], exitCode: 0 }),
      (r) => r.exitCode,
      { intervalMs: 200, write: () => undefined, signalSource: signals as never },
    );
    signals.emit('SIGINT');
    expect(await pending).toBe(0);
  });

  it('a throwing producer stops the loop with a nonzero code and never arms a leaking interval', async () => {
    const signals = new EventEmitter();
    let produceCalls = 0;
    const code = await runProductWatch(
      () => { produceCalls += 1; throw new Error('projection failed'); },
      (r) => r.exitCode,
      { intervalMs: 30, write: () => undefined, signalSource: signals as never },
    );
    expect(code).toBe(1);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(produceCalls).toBe(1);
    // If the first-paint throw had still armed the 30ms interval, produce
    // would keep firing; after > intervalMs it must still be exactly one.
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(produceCalls).toBe(1);
  });
});

describe('yc command CLI dispatch', () => {
  function fakeIo(env: Record<string, string | undefined> = {}): { io: CliIo; lines: string[] } {
    const lines: string[] = [];
    return { io: { out: (line) => lines.push(line), isTTY: false, env }, lines };
  }

  it('parseCli routes yc check / yc demo and rejects a missing or bad action', () => {
    expect(parseCli(['yc', 'check'])).toMatchObject({ command: 'yc', ycAction: 'check' });
    expect(parseCli(['yc', 'demo'])).toMatchObject({ command: 'yc', ycAction: 'demo' });
    expect(parseCli(['yc']).error).toContain('yc requires an action');
    expect(parseCli(['yc', 'bogus']).error).toContain('yc requires an action');
  });

  /* These two run the REAL preflight against this checkout, so exactly one
   * check is environment-dependent: `relay-build` asks whether
   * `dist-relay/cli.cjs` has been produced yet, and `npm test` legitimately
   * runs before `npm run relay:build` in a clean CI checkout. Asserting a bare
   * `exitCode === 0` therefore made these tests depend on whether someone had
   * built the CLI first — green locally, red in CI.
   *
   * They now assert something STRICTER instead: every product check passes,
   * the exit code is exactly consistent with the checks (0 iff no FAIL), and
   * `relay-build` is the ONLY check permitted to vary by environment. That
   * catches a genuine readiness regression in either environment, which the
   * old assertion could not do from a built tree. */
  const BUILD_DEPENDENT = 'relay-build';
  const cliIsBuilt = existsSync(join(process.cwd(), 'dist-relay', 'cli.cjs'));

  it('runCli yc check runs the real read-only preflight in this repo', async () => {
    const { io, lines } = fakeIo({ PATH: process.env.PATH, HOME: process.env.HOME });
    const code = await runCli(['yc', 'check'], io);
    const text = lines.join('\n');
    expect(text).toContain('SUNDAY RELAY — YC DEMO PREFLIGHT');
    expect(text).toContain('MANUAL VERIFICATION REQUIRED'); // frontend never inspected
    expect(text).toContain(YC_EXPECTED_REPOSITORY);          // identity, not a branch
    if (cliIsBuilt) {
      expect(text).toContain('READY FOR FOUNDER ACCEPTANCE');
      expect(code).toBe(0);
    } else {
      // The one honest reason a clean checkout is not yet recording-ready.
      expect(text).toContain('NOT READY');
      expect(text).toContain(BUILD_DEPENDENT);
      expect(code).not.toBe(0);
    }
  });

  it('runCli yc check --json emits the structured report and no text banner', async () => {
    const { io, lines } = fakeIo({ PATH: process.env.PATH, HOME: process.env.HOME });
    const code = await runCli(['yc', 'check', '--json'], io);
    const raw = lines.join('\n');
    expect(raw).not.toContain('SUNDAY RELAY — YC DEMO PREFLIGHT');

    const parsed = JSON.parse(raw) as { checks: YcCheck[]; exitCode: number };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(8);

    // The JSON carries the PREFLIGHT's own exit code (0/1); the CLI maps that
    // onto its exit-code vocabulary (EXIT.completed / EXIT.doctorFailure), so
    // the two agree on READY-ness rather than on the number itself.
    expect(parsed.exitCode === 0).toBe(code === 0);

    // Exit code is exactly consistent with the checks.
    const failures = parsed.checks.filter((c) => c.status === 'FAIL');
    expect(parsed.exitCode === 0).toBe(failures.length === 0);

    // Every PRODUCT check passes in this repository, whatever the build state.
    expect(failures.map((c) => c.name).filter((n) => n !== BUILD_DEPENDENT)).toEqual([]);
    for (const name of ['repository-identity', 'product-baseline', 'surface-parity-registry', 'plain-demo', 'documentation']) {
      expect(parsed.checks.find((c) => c.name === name)?.status, name).toBe('PASS');
    }
    if (cliIsBuilt) expect(parsed.exitCode).toBe(0);
  });

  it('runCli yc demo prints the honesty notice BEFORE the offline simulation, exit 0', async () => {
    const { io, lines } = fakeIo({ PATH: process.env.PATH, HOME: process.env.HOME });
    const code = await runCli(['yc', 'demo'], io);
    expect(code).toBe(0);
    const noticeIdx = lines.findIndex((l) => l.includes('SUNDAY RELAY — YC DEMO LAUNCHER'));
    const demoIdx = lines.findIndex((l) => l.includes('VISUAL SIMULATION'));
    expect(noticeIdx).toBeGreaterThanOrEqual(0);
    expect(demoIdx).toBeGreaterThan(noticeIdx);
    expect(lines.join('\n')).toContain('Mission verified complete.');
  });
});
