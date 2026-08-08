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
    // Three totals now: the two declaration counts, and the reachability count
    // that distinguishes a declared website file from one a browser entry can
    // actually render. A quoted reachability number that has drifted would be
    // the worst of the three — it is the line that claims the website has the
    // capability at all.
    const quoted = [...contract.matchAll(
      /^\s*(declared (?:surface files|CLI commands):.*|website entry points reachable:.*)$/gmu,
    )].map((match) => match[1].trim());
    expect(quoted.length, 'the contract should quote all three totals').toBe(3);
    for (const line of quoted) {
      expect(output, `the contract quotes "${line}", which the checker does not print`).toContain(line);
    }
    // A GENEROUS, EXPLICIT TIME BUDGET — not a weakened assertion. This test
    // SHELLS OUT to the parity checker, whose walk grows with the registry; it
    // passed 5s on a 2-core host once the MCP capabilities were declared, and
    // failed for being slow rather than for a stale number. The comparison
    // above is unchanged.
  }, 120_000);

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
  const beta = unwrap(read('docs/relay/BETA_WAVES.md'));

  it('each one declares its implementation status up front', () => {
    /*
     * ASSERTED ON THE STATUS LINE, NOT ON THE WHOLE DOCUMENT.
     *
     * This read `expect(loop).toContain('RUNTIME NOT IMPLEMENTED')` and kept
     * passing after the runtime landed — because the rewritten header explains
     * that the previous version of the line SAID that. The test was satisfied
     * by a sentence withdrawing the very claim it existed to check, which is
     * the same defect class as a comment describing a gate the code lacks.
     */
    const statusLine = (doc: string): string => doc.slice(0, doc.indexOf('---'));
    expect(statusLine(loop)).toContain('SINGLE-LOOP RUNTIME IMPLEMENTED');
    expect(statusLine(loop)).toContain('DEFAULT OFF');
    expect(statusLine(loop)).toContain('NO LOOP HAS RUN IN PRODUCTION');
    // SUPERSEDED 2026-08-06 when the Rechaining PLANNER landed (nothing calls
    // it, so the behaviour still does not exist).
    //
    // THE PIN IS ONE CONTIGUOUS CLAIM, deliberately. The first attempt at this
    // supersession used three separate substrings — 'THE METER', 'ARE NOT',
    // 'No session can exist' — and review proved a status rewritten to claim
    // the Meter and session lifecycle WERE implemented still satisfied all
    // three, because each matched somewhere in a seventeen-line preamble.
    // That is exactly the defect class this test's own header describes, and
    // it was committed here. A contiguous phrase cannot be satisfied by
    // scattered fragments.
    // (Whitespace is normalized above, so the phrase is written with single
    // spaces and survives reflow — asserting on a raw line break is how a doc
    // test starts failing for formatting rather than for meaning.)
    expect(statusLine(unchain)).toContain(
      'THE METER, SESSION LIFECYCLE, UNCHAINED FORM, RECHAINING EXECUTION AND S-LOOP RUNTIME ARE NOT IMPLEMENTED',
    );
    // SUPERSEDED 2026-08-06 twice: 'SCHEDULER NOT IMPLEMENTED' until the
    // pure evaluator landed; 'CLAIMING AND DISPATCH NOT' until the pure
    // claim/overlap/missed-run decisions landed. The status must keep naming
    // what is STILL missing — the persistence adapter and dispatch — not
    // merely celebrate what exists, so the assertion pins the remaining gap.
    expect(statusLine(cron)).toContain('DECISIONS');
    // SUPERSEDED repeatedly through 2026-08-06 as each pure stage landed, and
    // again on 2026-08-08 when the in-bridge scheduler landed. 'NO SCHEDULER'
    // and 'NO TIMER' were retired because they became FALSE — there is now a
    // timer — and a pin that is false is not a guard, it is a lie the suite
    // enforces. What replaces them must still name what is MISSING, which is
    // dispatch, and must survive the scheduler being switched on.
    //
    // ONE CONTIGUOUS CLAIM, for the reason the Unchain pin above records: a
    // status rewritten to claim dispatch works cannot satisfy this phrase,
    // whereas scattered fragments ('NEVER', 'DISPATCHED') could.
    expect(statusLine(cron)).toContain('DECISIONS');
    expect(statusLine(cron)).toContain(
      'A SCHEDULED RUN IS CREATED AND NEVER DISPATCHED, WHETHER AN OPERATOR OR THE TIMER ASKED',
    );
    // The timer exists, so the honest remaining limit is that nobody gets one
    // they did not switch on. A status that quietly dropped this would be
    // describing a background process the operator never chose.
    expect(statusLine(cron)).toContain('AN IN-BRIDGE SCHEDULER THAT IS OFF BY DEFAULT');
    // WAVE 0's GATE. The most load-bearing sentence in that document had no
    // mechanism to fail the day it stopped being true.
    //
    // ONE `toContain` INCLUDING THE `**Status:` MARKER, because two separate
    // assertions were both satisfied by a WITHDRAWAL PREAMBLE — "Status: WAVE 0
    // IS OPEN. This line previously said NO STORE, NO ROUTE…" passed both while
    // announcing the opposite. That is verbatim the LOOP_ENGINE defect recorded
    // twelve lines above, committed again in the fix for it.
    expect(beta).toContain(
      '**Status: THE ACCESS DECISION IS IMPLEMENTED AND PURE. NO STORE, NO ROUTE, NO '
      + 'ENROLMENT PATH, AND NO WAVE HAS BEEN OPENED. NOBODY HAS BEEN ADMITTED TO ANYTHING.**',
    );
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
    // Was `No Loop has ever run`. The runtime made that false, and the
    // sentence that replaced it is stronger because it separates the four
    // claims the status line now keeps apart.
    expect(loop).toContain('No Loop has run outside a test');
    expect(loop).toContain('SINGLE-LOOP RUNTIME IMPLEMENTED');
    expect(loop).toContain('DEFAULT OFF');
  });
});

/**
 * THE HERMES REVIEWER DOCUMENTATION CONTRACT.
 *
 * The Reviewer service milestone added a server-only process with its own
 * credentials, its own deployment story, and a long list of things that have
 * NOT happened yet. None of that was pinned by a test: the entire block could
 * be deleted from `.env.example`, or quietly upgraded into claiming a
 * deployment that never occurred, and every gate would still report green.
 *
 * Documentation is the only place several of these facts exist at all — the
 * service is not deployed, so there is no running system to contradict a false
 * claim about it. That makes the claims worth a contract of their own.
 */
describe('the Hermes Reviewer environment contract', () => {
  const env = read('.env.example');

  it('documents every variable the bridge and the service actually read', () => {
    for (const name of [
      'RELAY_HERMES_MODE', 'RELAY_HERMES_SERVICE_URL', 'RELAY_HERMES_SERVICE_TOKEN',
      'RELAY_HERMES_PROVIDER', 'RELAY_HERMES_MODEL', 'RELAY_HERMES_EXECUTABLE',
      'XAI_API_KEY', 'ANTHROPIC_API_KEY',
      // The trusted-origin allowlist. It was introduced, made REQUIRED in
      // production, documented at length in `.env.example` and in the
      // README — and left out of this list, so every one of those lines could
      // have been deleted with the whole gate still green. A contract that
      // does not name the newest variable is not covering the newest risk.
      'RELAY_HERMES_TRUSTED_ORIGINS',
    ]) {
      expect(env, `${name} must be documented`).toContain(name);
    }
  });

  it('gives no credential-bearing variable a value, commented or not', () => {
    // A commented example still teaches, and `.env.example` is copied wholesale.
    // Asserting only that the NAME appears would let a real token be pasted in
    // beside a `#` and travel into the repository looking like documentation.
    for (const name of ['RELAY_HERMES_SERVICE_TOKEN', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) {
      const occurrences = [...env.matchAll(new RegExp(`^\\s*#?\\s*${name}=(.*)$`, 'gm'))];
      expect(occurrences.length, `${name} should appear in .env.example`).toBeGreaterThan(0);
      for (const [line, value] of occurrences) {
        // Anything after `=` that is not whitespace or a trailing comment is a value.
        expect(value.replace(/#.*$/u, '').trim(), `${line.trim()} carries a value`).toBe('');
      }
    }
  });

  it('declares each Hermes variable exactly once as a live assignment', () => {
    // A `.env` is read last-wins, so a second live definition silently
    // overrides the first and the operator debugs a value they cannot see.
    // This block previously declared executable, provider and model twice,
    // with DIFFERENT values in each copy.
    for (const name of [
      'RELAY_HERMES_MODE', 'RELAY_HERMES_EXECUTABLE', 'RELAY_HERMES_PROVIDER',
      'RELAY_HERMES_MODEL', 'XAI_API_KEY', 'ANTHROPIC_API_KEY',
    ]) {
      const live = [...env.matchAll(new RegExp(`^${name}=`, 'gmu'))];
      expect(live.length, `${name} has ${live.length} live definitions; exactly one is correct`).toBe(1);
    }
  });

  it('never gives a server-only Hermes variable a VITE_ name', () => {
    // A VITE_ name is inlined into the public bundle.
    for (const forbidden of [
      'VITE_XAI_API_KEY', 'VITE_ANTHROPIC_API_KEY', 'VITE_RELAY_HERMES_SERVICE_TOKEN',
    ]) {
      expect(env, `${forbidden} would ship a secret to the browser`)
        .not.toMatch(new RegExp(`^\\s*${forbidden}=`, 'mu'));
    }
  });
});

describe('the Hermes Reviewer claims only what has actually happened', () => {
  /**
   * These documents wrap, and a wrapped line carries its container's prefix —
   * `#` in an env file, `>` in a markdown blockquote. The CLAIM is what
   * matters, not where the paragraph happened to break, so prefixes and line
   * breaks are flattened before any prose is matched. Variable assertions
   * above deliberately do NOT use this: there, `#` is meaningful.
   */
  const flow = (text: string) => text.replace(/^[\s>#]+/gmu, ' ').replace(/\s+/gu, ' ');

  const env = flow(read('.env.example'));
  const serviceReadme = flow(read('relay-hermes-service/README.md'));
  const nixpacks = flow(read('relay-hermes-service/nixpacks.toml'));

  it('states plainly that the service is not deployed', () => {
    expect(serviceReadme).toMatch(/not deployed/iu);
    expect(env).toContain('Repository artifacts existing is not deployment');
  });

  it('does not claim the build artifact installs Hermes', () => {
    // The recipe provisions the Node and Python TOOLCHAIN; it neither vendors
    // nor fetches the Hermes binary. Both documents said it was "installed
    // into the image at build time", which is an installation nobody has done
    // — the same class of defect this milestone exists to remove.
    for (const doc of [serviceReadme, nixpacks]) {
      expect(doc).not.toMatch(/is installed into the image/iu);
      expect(doc).not.toMatch(/binary is installed at build time/iu);
    }
    expect(serviceReadme, 'the README must say the recipe does not install Hermes')
      .toMatch(/does not install Hermes/iu);
    expect(nixpacks, 'the recipe must say the binary is not fetched by it')
      .toMatch(/neither vendored here nor fetched/iu);
    expect(nixpacks, 'the recipe must say the install step has not happened')
      .toMatch(/has NOT been performed/u);
  });

  it('claims no production connection, no live review and no paid run', () => {
    for (const doc of [serviceReadme, nixpacks, env]) {
      expect(doc).not.toMatch(/production connection (?:passed|verified|proven|succeeded)/iu);
      expect(doc).not.toMatch(/test.connection (?:passed|succeeded|verified)/iu);
      expect(doc).not.toMatch(/(?:a|the) live (?:Grok|Hermes) review (?:ran|occurred|completed|succeeded)/iu);
      expect(doc).not.toMatch(/paid (?:review|run|request) (?:has )?(?:occurred|completed|succeeded|ran)/iu);
    }
    // And the README must keep saying so affirmatively, not merely omit it.
    expect(serviceReadme).toMatch(/no provider request has ever been\s+made through it/u);
    expect(serviceReadme).toMatch(/no paid Reviewer run has occurred/u);
  });

  it('keeps Anthropic identity honestly unverified rather than inferred', () => {
    // xAI can be checked for free; Anthropic cannot without paying, so the
    // README must not quietly upgrade "credential present" into "verified".
    expect(serviceReadme).toMatch(/provider_unverified/u);
    expect(serviceReadme).toMatch(/Credential presence is not provider verification/u);
  });

  it('does not tell an operator that installing Hermes locally connects a hosted bridge', () => {
    expect(env).toMatch(/does NOT make a hosted Relay Bridge\s+connected/u);
  });

  it('keeps the build recipe free of the ids, domains and URLs nothing else checks', () => {
    /**
     * The recipe states that no credential, Railway project or service id,
     * private domain or public bridge URL may appear in it. Only the FIRST of
     * those is enforced elsewhere: the boundary scanner's committed-credential
     * tripwire reads every tracked file. It has no content rule for ids,
     * domains or the bridge URL, and `nixpacks.toml` is not in its forbidden
     * paths at all, so it never classifies this file as deployment config.
     *
     * That gap is the whole reason for this test. A recipe that names an
     * invariant no gate checks is the same defect as one claiming an install
     * nobody performed — the claim reads as a measurement and is not one.
     *
     * Read RAW, deliberately: `#` is what makes these lines comments, and a
     * secret pasted into a comment is still committed.
     */
    const recipe = read('relay-hermes-service/nixpacks.toml');
    expect(recipe, 'no URL belongs in the build recipe')
      .not.toMatch(/https?:\/\//u);
    expect(recipe, 'no Railway domain belongs in the build recipe')
      .not.toMatch(/[\w-]+\.(?:up\.)?railway\.app|\.railway\.internal/iu);
    expect(recipe, 'no Railway project or service id belongs in the build recipe')
      .not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
  });
});
