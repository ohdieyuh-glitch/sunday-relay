import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * CI TEST ACCOUNTING (N-2).
 *
 * The reported defect: the CI summary counted TWO skipped tests — the two
 * `it.runIf(bundles.length > 0)` production-bundle assertions — while a THIRD
 * build-dependent test, "the built CLI actually runs and reports the Relay
 * product", silently `return`ed when `dist-relay/cli.cjs` was absent. It was
 * neither counted nor reported: a guarantee that read as green without ever
 * running.
 *
 * Two things fix that, and this file is the second of them:
 *
 *   1. every build- or environment-dependent test now asserts in BOTH
 *      branches — either against the artifact, or that CI re-runs its file
 *      after the build that produces the artifact;
 *   2. this ledger makes the accounting COMPLETE and keeps it complete. A new
 *      `runIf`, a new `.skip`, or a new test that can end without asserting
 *      fails here rather than quietly joining the untracked set.
 *
 * Reads only: `git ls-files` plus the test sources themselves.
 */

const ROOT = resolve(__dirname, '..');

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const testFiles = trackedFiles.filter((f) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(f));
const sourceOf = (f: string) => readFileSync(join(ROOT, f), 'utf8');

/**
 * Every test file whose behaviour depends on a BUILD ARTIFACT, and how each
 * one is accounted for. `npm test` runs before every build, so a clean
 * checkout has none of these artifacts and the file must still be honest.
 *
 * Two accounting strategies are permitted, and each file declares which:
 *
 *   rerun_after_build   the artifact-absent branch asserts that CI re-runs
 *                       this exact file after the build that produces the
 *                       artifact — the only place the claim can be proven;
 *   asserts_both        the file asserts a real, DIFFERENT guarantee in each
 *                       branch, so it needs no re-run to be truthful.
 *
 * There is no third option, and no file may be build-dependent without
 * appearing here — the completeness test below enforces that.
 */
type Accounting = 'rerun_after_build' | 'asserts_both';

const BUILD_DEPENDENT: ReadonlyArray<{
  file: string;
  needs: string;
  producedBy: string;
  accounting: Accounting;
  /** For `asserts_both`: the CI step that still exercises the built path. */
  builtPathExercisedBy?: string;
}> = [
  {
    file: 'src/relay/ui/preview/production-entry.test.tsx',
    needs: 'dist/assets/*.js',
    producedBy: 'npm run build',
    accounting: 'rerun_after_build',
  },
  {
    file: 'docs/documentation-contract.test.ts',
    needs: 'dist-relay/cli.cjs',
    producedBy: 'npm run relay:build',
    accounting: 'rerun_after_build',
  },
  {
    // The signal handlers can only be proven on a real process, which means
    // the built entry point. Its artifact-absent branch asserts CI re-runs it
    // after the Hermes service build.
    file: 'relay-hermes-service/signal-lifecycle.test.ts',
    needs: 'dist-relay-hermes/main.cjs',
    producedBy: 'npm run relay:hermes:build',
    accounting: 'rerun_after_build',
  },
  {
    // Fully build-aware already: with the CLI built it requires READY FOR
    // FOUNDER ACCEPTANCE, and without it requires NOT READY naming exactly
    // the `relay-build` check. Both branches assert, so no re-run is needed —
    // and CI exercises the built path anyway through `relay:yc-demo:check`.
    file: 'src/relay/yc/yc-acceptance.test.ts',
    needs: 'dist-relay/cli.cjs',
    producedBy: 'npm run relay:build',
    accounting: 'asserts_both',
    builtPathExercisedBy: 'npm run relay:yc-demo:check',
  },
];

const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'relay-ci.yml'), 'utf8');

/* ------------------------------------------------ no conditional skipping */

describe('no test is skipped without being reported', () => {
  it('no test uses runIf, skipIf, or .skip', () => {
    const offenders: string[] = [];
    for (const file of testFiles) {
      const source = sourceOf(file);
      for (const [index, line] of source.split('\n').entries()) {
        if (/^\s*(\/\/|\*)/.test(line)) continue; // a comment may DESCRIBE the rule
        if (/\b(it|test|describe)\s*\.\s*(runIf|skipIf|skip)\b/.test(line)) {
          offenders.push(`${file}:${index + 1} — ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      'a conditionally skipped test is reported as "skipped", which reads as "nothing to see". '
      + 'Assert in both branches instead — see production-entry.test.tsx for the shape.',
    ).toEqual([]);
  });

  it('no test can END without asserting', () => {
    // A bare `if (…) return;` in a test body ends the test with whatever
    // assertions happened to run first — possibly none. A `return` inside a
    // BLOCK is fine, because this repository's convention is that the block
    // asserts something before returning.
    const offenders: string[] = [];
    for (const file of testFiles) {
      const lines = sourceOf(file).split('\n');
      for (const [index, line] of lines.entries()) {
        if (!/^\s*if \(.*\) return;\s*(\/\/.*)?$/.test(line)) continue;
        const preceding = lines.slice(Math.max(0, index - 3), index).filter((l) => l.trim() !== '');
        // Guarded: the two lines above already asserted the same condition, so
        // the return is unreachable when the assertion holds — it is a
        // TypeScript narrowing aid, not a skip.
        if (preceding.slice(-2).some((l) => l.includes('expect('))) continue;
        offenders.push(`${file}:${index + 1} — ${line.trim()}`);
      }
    }
    expect(
      offenders,
      'this test can finish having asserted nothing. Either assert in the early-exit branch, '
      + 'or throw — never return silently.',
    ).toEqual([]);
  });
});

/* --------------------------------------------- build-dependent accounting */

describe('every build-dependent test is re-run after its build', () => {
  for (const entry of BUILD_DEPENDENT) {
    const { file, needs, producedBy, accounting } = entry;

    it(`${file} exists and is accounted for as "${accounting}"`, () => {
      expect(trackedFiles, `${file} is listed as build-dependent but does not exist`).toContain(file);

      if (accounting === 'rerun_after_build') {
        expect(
          workflow.includes(file),
          `${file} asserts against ${needs}, which \`npm test\` runs before producing. `
          + `CI must re-run it after \`${producedBy}\`.`,
        ).toBe(true);
        // The absent-artifact branch must point at the workflow itself, which
        // is what turns "skipped" into "accounted for".
        expect(
          sourceOf(file).includes('relay-ci.yml'),
          `${file} must assert, in its artifact-absent branch, that CI re-runs it after \`${producedBy}\``,
        ).toBe(true);
        return;
      }

      // asserts_both — the file needs no re-run, but it must genuinely branch
      // on the artifact and assert something real on each side, and CI must
      // still exercise the built path somewhere.
      const source = sourceOf(file);
      expect(source, `${file} must detect whether ${needs} exists`).toMatch(/existsSync\(/u);
      expect(source, `${file} must branch on the artifact`).toMatch(/\belse\b/u);
      expect(
        entry.builtPathExercisedBy && workflow.includes(entry.builtPathExercisedBy),
        `${file} asserts both branches, but CI must still exercise its BUILT path`,
      ).toBe(true);
    });
  }

  it('the CI step order actually produces the artifacts before the re-runs', () => {
    const at = (needle: string) => workflow.indexOf(needle);
    expect(at('npm run build'), 'the website build must appear in CI').toBeGreaterThan(-1);
    expect(at('npm run relay:build'), 'the CLI build must appear in CI').toBeGreaterThan(-1);
    expect(
      at('src/relay/ui/preview/production-entry.test.tsx'),
      'the production-entry re-run must come AFTER the website build',
    ).toBeGreaterThan(at('npm run build'));
    expect(
      at('docs/documentation-contract.test.ts'),
      'the documentation-contract re-run must come AFTER the CLI build',
    ).toBeGreaterThan(at('npm run relay:build'));
    expect(at('npm run relay:hermes:build'), 'the Hermes service build must appear in CI').toBeGreaterThan(-1);
    expect(
      at('relay-hermes-service/signal-lifecycle.test.ts'),
      'the signal-lifecycle re-run must come AFTER the Hermes service build',
    ).toBeGreaterThan(at('npm run relay:hermes:build'));
  });

  it('the workflow describes the accounting as it now is — nothing is skipped', () => {
    // The re-run steps used to be justified in prose by the claim that the
    // build-dependent assertions SKIP during `npm test`, and that without the
    // re-run the guarantee "would be a skipped test reported as green". That
    // stopped being true when the conditional skipping was removed: those
    // files assert in BOTH branches now. Prose that still says "skipped"
    // teaches the next maintainer that deleting a re-run step costs only a
    // skipped test, when it actually costs the built-artifact branch itself.
    expect(workflow, 'the assertions no longer skip — they assert in both branches').not.toMatch(/\bthey\s+SKIP\b/u);
    expect(workflow).not.toMatch(/skipped test reported as green/u);
  });

  it('the list of build-dependent tests is COMPLETE', () => {
    // Any other test that reads dist/ or dist-relay/ is build-dependent and
    // must be declared above, so the ledger cannot silently fall behind.
    //
    // THIS FILE is the one honest exception: it NAMES the artifacts in the
    // ledger's `needs` fields without ever reading one. The exception is
    // exactly one path and the test below proves it earns it, so this cannot
    // become a place to hide a genuinely build-dependent test.
    const LEDGER = 'scripts/ci-test-accounting.test.ts';
    const declared = new Set([...BUILD_DEPENDENT.map((entry) => entry.file), LEDGER]);
    // Every artifact directory this repository produces must appear here. The
    // Hermes Reviewer service added a FOURTH one, and a completeness check
    // that does not know about an artifact cannot report a test depending on
    // it — it just returns green, which is the failure mode this test exists
    // to prevent.
    const undeclared = testFiles.filter(
      (file) => !declared.has(file)
        && /['"`](\.\.\/)*dist(-relay|-relay-bridge|-relay-hermes)?['"`,/]/.test(sourceOf(file)),
    );
    expect(
      undeclared,
      'this test reads a build artifact but is not in BUILD_DEPENDENT, so nothing guarantees CI re-runs it',
    ).toEqual([]);
  });

  it('the ledger itself reads no build artifact — it only names them', () => {
    const self = sourceOf('scripts/ci-test-accounting.test.ts');
    // It may mention `dist/...` inside a `needs:` string; it may not touch one.
    for (const access of [
      /existsSync\([^)]*dist/,
      /readFileSync\([^)]*dist/,
      /readdirSync\([^)]*dist/,
      /join\([^)]*['"`]dist/,
    ]) {
      expect(access.test(self), `the ledger reads a build artifact via ${access}`).toBe(false);
    }
  });
});

/* --------------------------------------------- immutable CI supply chain */

describe('CI actions are pinned to immutable commit SHAs', () => {
  it('no workflow references a mutable tag or branch', () => {
    const offenders: string[] = [];
    for (const [index, line] of workflow.split('\n').entries()) {
      if (/^\s*#/.test(line)) continue;
      const uses = /^\s*-?\s*uses\s*:\s*['"]?([^'"\s]+)/.exec(line);
      if (!uses) continue;
      const [, ref] = uses;
      const at = ref.lastIndexOf('@');
      const version = at >= 0 ? ref.slice(at + 1) : '';
      // A 40-character hex SHA is immutable; `v4`, `main`, `latest` are not.
      if (!/^[0-9a-f]{40}$/.test(version)) {
        offenders.push(`.github/workflows/relay-ci.yml:${index + 1} — ${ref}`);
      }
    }
    expect(
      offenders,
      'a mutable tag can be repointed by the action owner at any time, which changes what CI '
      + 'executes without changing anything in this repository. Pin to a commit SHA.',
    ).toEqual([]);
  });

  it('each pinned SHA still records the human-readable version beside it', () => {
    for (const line of workflow.split('\n')) {
      if (!/^\s*-?\s*uses\s*:/.test(line) || /^\s*#/.test(line)) continue;
      expect(line, `${line.trim()} must keep a "# v…" comment so the pin is reviewable`).toMatch(/#\s*v?\d/u);
    }
  });
});
