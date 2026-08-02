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

  /**
   * The runbook used to hand the browser surface to "the separate frontend
   * session", leaving its command and URL as PENDING THAT SESSION'S
   * CONFIRMATION. The surface is in this repository and its dev/preview
   * commands are declared in this package.json, so the operator was waiting on
   * a checkout that does not exist. What survives the correction is the part
   * that was always true: nothing verifies the browser automatically, so the
   * founder records the command and the URL by hand.
   */
  it('does not hand the browser surface to a separate session or checkout', () => {
    expect(runbook).not.toMatch(/frontend session/iu);
    expect(runbook).not.toMatch(/PENDING FRONTEND SESSION CONFIRMATION/u);
    expect(runbook).toMatch(/built from this repository/u);
    // The manual-verification instruction must not have been lost with it.
    expect(runbook).toMatch(/Do \*\*not\*\* invent the URL/u);
    expect(runbook).toMatch(/never inspects the browser\s+surface/u);
    // And the commands it names must be real scripts.
    for (const script of ['dev', 'build', 'preview']) {
      expect(pkg.scripts[script], `the runbook names \`${script}\``).toBeTruthy();
    }
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

/**
 * The parity contract used to quote an output line the checker never printed,
 * and to describe a companion checkout as REQUIRED in CI when the checker only
 * compares one if `--companion <path>` is passed. Documenting a string that
 * does not exist is how a reader comes to believe in a guarantee nobody
 * implemented, so the quotes are now pinned to the implementation.
 */
describe('the parity contract describes the checker that exists', () => {
  const contract = read('docs/relay/WEBSITE_CLI_PARITY_CONTRACT.md');
  const checker = read('scripts/relay-surface-parity.mjs');
  // Markdown wraps a quoted line across sources lines; the STRING is what
  // matters, not where the paragraph happened to break.
  const unwrapped = contract.replace(/\s+/gu, ' ');

  it('quotes only output and rule names the checker actually produces', () => {
    for (const quoted of [
      'companion: not requested — both surfaces are verified in this repository',
      'companion-unreadable',
      'no-file-evidence',
    ]) {
      expect(unwrapped, `the contract no longer quotes "${quoted}"`).toContain(quoted);
      expect(checker, `"${quoted}" is documented but appears nowhere in the checker`).toContain(quoted);
    }
  });

  it('quotes count lines the checker really prints — a stale total must fail', () => {
    // The contract quotes the checker's own totals. A quoted number that has
    // drifted is worse than no number, because it reads as a measurement. The
    // checker is offline and read-only, so the honest guard is to ask it.
    let output: string;
    try {
      output = execFileSync('node', ['scripts/relay-surface-parity.mjs'], { cwd: ROOT, encoding: 'utf8' });
    } catch (err) {
      // A parity FAILURE is another gate's business. The totals are printed
      // either way, and this test compares only those.
      output = String((err as { stdout?: string }).stdout ?? '');
    }
    const quoted = [...contract.matchAll(/^\s*(declared (?:surface files|CLI commands):.*)$/gmu)]
      .map((match) => match[1].trim());
    expect(quoted.length, 'the contract should quote both totals').toBe(2);
    for (const line of quoted) {
      expect(output, `the contract quotes "${line}", which the checker does not print`).toContain(line);
    }
  });

  it('names sharedDomainReferences as a field that is VERIFIED, not merely declared', () => {
    expect(unwrapped).toMatch(/sharedDomainReferences.{0,120}(verified|resolved)/iu);
    // Command notation is legitimate in exactly two fields, and the doc must
    // not imply it is accepted anywhere a file is claimed.
    expect(unwrapped).toMatch(/command-notation-not-permitted/u);
    expect(checker).toContain('command-notation-not-permitted');
    for (const field of ['cliEntryPoints', 'cliTestReferences']) {
      expect(unwrapped, `${field} is where command notation is legitimate`).toContain(field);
    }
  });

  it('describes the companion comparison as opt-in, never as required', () => {
    expect(contract).toMatch(/companion comparison is OPT-IN/u);
    expect(contract).toMatch(/--companion <path>/u);
    expect(contract).not.toMatch(/the companion is \*\*required\*\*/u);
    expect(contract).not.toMatch(/companion repository is unavailable/u);
    // …and the checker must still refuse an explicitly requested companion it
    // cannot read, which is the part of the old claim that WAS true.
    expect(checker).toMatch(/companion registry not found/u);
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

describe('the Loop Engine documents state what exists, truthfully', () => {
  // These three docs record decisions that arrived from outside the
  // repository. That makes them the ONLY place a reviewer can check the
  // locked terms against — so the one thing they must never do is imply a
  // feature exists because it is written down.
  // Markdown wraps a sentence across source lines, so every assertion below
  // runs against the UNWRAPPED text — the same idiom the parity-contract
  // block above uses. Asserting on a raw line is how a doc test starts
  // failing for reflow rather than for meaning.
  const unwrap = (text: string) => text.replace(/\s+/gu, ' ');
  const loop = unwrap(read('docs/relay/LOOP_ENGINE.md'));
  const unchain = unwrap(read('docs/relay/UNCHAIN.md'));
  const cron = unwrap(read('docs/relay/CRON_LOOPS.md'));

  it('each one declares its implementation status up front', () => {
    expect(loop).toContain('RUNTIME NOT IMPLEMENTED');
    expect(unchain).toContain('SPECIFIED, NOT IMPLEMENTED');
    expect(cron).toContain('SCHEDULER NOT IMPLEMENTED');
  });

  it('the Unchain record carries the locked founder decisions', () => {
    expect(unchain).toContain('temporary capacity expansion');
    expect(unchain).toContain('Exactly two');
    // The "does NOT do" list, as the document actually words it.
    for (const refusal of [
      'grant new permissions',
      'expand workspace access',
      'bypass human approvals',
      'bypass spending controls',
      'allow unverified completion',
    ]) {
      expect(unchain, `UNCHAIN.md must state that Unchain does not ${refusal}`).toContain(refusal);
    }
    expect(unchain).toContain('server-authoritative');
    expect(unchain).toContain('Rechaining');
    // Capacity, never authority — and skins never grant anything.
    expect(unchain).toContain('never grants capacity');
    // `modes.ts` is a ceiling, never a way to grant more authority.
    expect(unchain).toContain('an authority-expansion mechanism');
    expect(unchain).toContain('Mode policy is a ceiling');
  });

  it('the Unchain record refuses to claim documentation is implementation', () => {
    expect(unchain).toContain('Documentation is not implementation');
    expect(unchain).toContain('Open founder decisions');
  });

  it('the Cron record fixes the approved beta scheduling decision', () => {
    expect(cron).toContain('journal and snapshots remain the source of truth');
    expect(cron).toContain('in-bridge scheduler');
    expect(cron).toContain('OccurrenceClaimPort');
    expect(cron).toContain('not durable schedule truth');
    expect(cron).toContain('Distributed multi-worker scheduling is not claimed');
    expect(cron).toContain('IANA timezone');
    expect(cron).toContain('fails closed');
  });

  it('the Loop Engine record states that parsing is not execution', () => {
    expect(loop).toContain('Parsing is not execution');
    expect(loop).toContain('Completion is earned, not claimed');
    expect(loop).toContain('Requested is not actual');
    expect(loop).toContain('Maximum utilization is **not** claimed');
    expect(loop).toContain('No Loop has ever run');
  });
});
