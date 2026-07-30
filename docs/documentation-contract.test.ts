import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Documentation contract.
 *
 * The independent review of the separation PR found the README advertising
 * documents, source trees and npm scripts that did not exist — inherited drift
 * from the period when Relay's work lived across four Alcatraz worktrees. The
 * integration restored those trees, so the README is now true; this test is
 * what keeps it true.
 *
 * It also holds the operator runbook to the independent repository: it used to
 * tell the founder to `cd` into the Alcatraz checkout and required a branch and
 * commit that do not exist here.
 */

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; bin?: Record<string, string> };

describe('README advertises only what exists', () => {
  it('every docs/relay document it names is present', () => {
    const named = [...readme.matchAll(/`(docs\/relay\/[A-Za-z0-9_.-]+|[A-Z][A-Z0-9_]+\.(?:md|json))`/g)]
      .map((m) => m[1]);
    expect(named.length).toBeGreaterThan(10);
    // A bare NAME.md may be a docs/relay specification or a root-level
    // historical record (RELAY_STATUS.md, RELAY_INTEGRATION.md) — both are
    // legitimate, so a name counts as present if it resolves in either place.
    const missing = [...new Set(named)].filter(
      (name) => !existsSync(join(ROOT, name)) && !existsSync(join(ROOT, 'docs/relay', name)),
    );
    expect(missing, 'README names documents that do not exist').toEqual([]);
  });

  it('every source path in its architecture map is present', () => {
    const paths = [...readme.matchAll(/^(src\/relay\/[a-z-]+|relay-bridge|docs\/relay)\b/gm)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(5);
    const missing = [...new Set(paths)].filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, 'README maps source trees that do not exist').toEqual([]);
  });

  it('every npm command it tells the reader to run is a real script', () => {
    const commands = [...readme.matchAll(/npm run ([a-z0-9:._-]+)/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(5);
    const missing = [...new Set(commands)].filter((c) => typeof pkg.scripts[c] !== 'string');
    expect(missing, 'README documents npm scripts that do not exist').toEqual([]);
  });

  it('names the shared browser-safe seam introduced by the integration', () => {
    expect(readme).toContain('src/relay/shared');
  });

  it('still positions Relay as an independent product', () => {
    expect(readme).toContain('Sunday Relay turns separate AI tools');
    expect(readme).toContain('Aquala Technologies');
    expect(readme).toContain('docs/REPOSITORY_GOVERNANCE.md');
  });
});

describe('CLI invocation is real', () => {
  it('package.json maps the documented `relay` command to the built CLI', () => {
    expect(pkg.bin, 'docs write commands as `relay <command>`, so a bin mapping must exist').toBeDefined();
    expect(pkg.bin?.relay).toBe('dist-relay/cli.cjs');
  });

  it('the build emits an executable entry with a shebang', () => {
    expect(pkg.scripts['relay:build']).toContain('--banner:js="#!/usr/bin/env node"');
  });

  /**
   * BUILD-DEPENDENT, AND ACCOUNTED FOR.
   *
   * `npm test` runs before `npm run relay:build`, so in a clean checkout
   * `dist-relay/cli.cjs` does not exist yet. This test used to `return`
   * there — a guarantee reported as green without running, and one the CI
   * report never mentioned while it counted two OTHER skipped tests.
   *
   * It no longer returns silently. The absent-build branch asserts that CI
   * re-runs this exact file after the CLI build, which is the only place the
   * claim can actually be proven; `scripts/ci-test-accounting.test.ts` holds
   * the whole ledger of build-dependent tests.
   */
  it('the built CLI actually runs and reports the Relay product', () => {
    const built = join(ROOT, 'dist-relay', 'cli.cjs');
    if (!existsSync(built)) {
      const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'relay-ci.yml'), 'utf8');
      expect(
        workflow.includes('docs/documentation-contract.test.ts'),
        'this assertion needs dist-relay/cli.cjs, so CI must re-run this file after `npm run relay:build`',
      ).toBe(true);
      return;
    }
    expect(readFileSync(built, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    const out = execFileSync('node', [built, 'version'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('Relay CLI');
  });
});

describe('YC demo runbook targets the independent repository', () => {
  const runbook = read('docs/relay/YC_DEMO_RUNBOOK.md');

  it('uses the independent repository path', () => {
    expect(runbook).toContain('/home/kaisinrogodfree5/sunday-relay-product');
  });

  it('never tells the operator to run Relay commands in the Alcatraz worktree', () => {
    expect(runbook).not.toMatch(/cd\s+\/home\/kaisinrogodfree5\/sunday-relay(?!-product)\b/);
  });

  it('carries no retired branch or checkpoint REQUIREMENT', () => {
    // The names may appear in the note explaining what was retired; they must
    // not appear as an instruction the operator has to satisfy.
    for (const line of runbook.split('\n')) {
      if (line.trimStart().startsWith('>')) continue;      // the explanatory note
      expect(line).not.toContain('feature/relay-yc-demo');
      expect(line).not.toContain('9f8075f');
    }
  });

  it('points at the versioned product baseline instead', () => {
    expect(runbook).toContain('YC_DEMO_BASELINE.json');
    expect(existsSync(join(ROOT, 'docs/relay/YC_DEMO_BASELINE.json'))).toBe(true);
  });
});

describe('CURRENT_STATE is truthful about the integration', () => {
  const current = read('docs/relay/CURRENT_STATE.md');

  it('no longer claims there are no known blockers', () => {
    expect(current).not.toMatch(/##\s*Known blockers\s*\n\s*\nNone\.\s*\n/);
  });

  it('accounts for each recorded integration blocker', () => {
    for (const marker of ['browser', 'DraftField', 'YC readiness', 'persistence']) {
      expect(current.toLowerCase()).toContain(marker.toLowerCase());
    }
    expect(current).toContain('Repaired');
  });

  /**
   * This used to require the phrase "Transitional duplication" — the note
   * saying Mission Economics existed byte-identically in two lineages. That
   * stopped being true once both surfaces landed in one repository, so the
   * test now requires the CORRECTED description AND requires the stale claim
   * to be gone: a document may not describe a duplication that no longer
   * exists, and a test may not require it to.
   */
  it('describes Mission Economics as ONE implementation, not a duplication', () => {
    expect(current).toContain('Mission Economics');
    expect(current).toContain('ONE implementation');
    expect(current).toMatch(/thin re-export/u);
    expect(current).toMatch(/no second copy and nothing to keep in sync/u);
    // The superseded wording must not survive as a live claim.
    expect(current).not.toContain('Transitional duplication, deliberately preserved');
    expect(current).not.toMatch(/Mission Economics exists\s+byte-identically/u);
  });
});

describe('development contracts are accounted for', () => {
  const contracts = read('docs/relay/DEVELOPMENT_CONTRACTS.md');

  it('states what was carried and what was excluded, with reasons', () => {
    expect(contracts).toContain('CARRIED');
    expect(contracts).toContain('EXCLUDED');
    expect(contracts).toContain('relay-home-preview.html');
    expect(contracts).toContain('relay-landing-preview.html');
    expect(contracts).toContain('src/relay/ui/home/preview.tsx');
    expect(contracts).toContain('src/relay/ui/landing/preview.tsx');
  });

  it('the environment contract exists and holds no real value', () => {
    const env = read('.env.example');
    for (const name of [
      'RELAY_BRIDGE_PORT', 'RELAY_BRIDGE_CONFIRM_LIVE', 'RELAY_PROMPT_ARCHITECT_MODE',
      'RELAY_HERMES_EXECUTABLE', 'VITE_RELAY_LIVE', 'VITE_RELAY_BRIDGE_URL',
    ]) {
      expect(env, `${name} must be documented`).toContain(name);
    }
    // Secret-bearing variables are present but EMPTY.
    for (const name of ['OPENAI_API_KEY', 'RELAY_PROMPT_ARCHITECT_MODE', 'RELAY_BRIDGE_CONFIRM_LIVE']) {
      expect(env).toMatch(new RegExp(`^${name}=\\s*$`, 'm'));
    }
    expect(env.toLowerCase()).toContain('never a vite_ variable');
  });

  it('.env stays untracked while .env.example is the only tracked one', () => {
    const ignore = read('.gitignore');
    expect(ignore).toContain('.env');
    expect(ignore).toContain('!.env.example');
    expect(existsSync(join(ROOT, '.env'))).toBe(false);
  });
});
