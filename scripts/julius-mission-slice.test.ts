import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * THE SANDBOX RULE, EXERCISED RATHER THAN ASSERTED.
 *
 * Julius must never write to trusted Sunday Relay main: a paid mission gets an
 * isolated disposable copy, and what comes back is a candidate diff. Slice mode
 * is what makes that possible for a mission whose SUBJECT is Sunday Relay — the
 * workspace is a byte-identical slice of this repository, so the diff a mission
 * produces is a patch against it.
 *
 * These tests take the same four steps the provisioner takes, on this
 * repository's real files, with no tmpfs and no root: archive from a revision,
 * seed the harness, run the sliced source, and apply the result back. The parts
 * that genuinely need root (the tmpfs mount and the ownership dance) are the
 * parts `.github/julius-live-workspace.sh` shares with the throwaway-tree mode
 * that three paid missions have already run.
 */

const REPO = join(import.meta.dirname, '..');
const HARNESS = join(REPO, '.github/julius-mission-slice');
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** Two real domain files with no imports outside themselves. */
const SLICE = [
  'src/relay/mission/julius/julius-cost-accounting.ts',
  'src/relay/mission/julius/julius-trajectory.ts',
];

const scratch: string[] = [];
const seedSlice = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'julius-slice-'));
  scratch.push(dir);
  const rev = git(REPO, 'rev-parse', 'HEAD').trim();
  // FROM A REVISION, NOT THE WORKING TREE — the property that stops a dirty
  // runner leaking an uncommitted file into a paid mission.
  execFileSync('sh', ['-c', `git -C '${REPO}' archive --format=tar ${rev} -- ${SLICE.join(' ')} | tar -x -C '${dir}'`]);
  mkdirSync(join(dir, '.julius'), { recursive: true });
  for (const file of ['resolve.mjs', 'loader.mjs']) cpSync(join(HARNESS, file), join(dir, '.julius', file));
  git(dir, 'init', '--quiet', '--initial-branch=main', '.');
  git(dir, '-c', 'user.name=J', '-c', 'user.email=j@invalid', 'add', '-A');
  git(dir, '-c', 'user.name=J', '-c', 'user.email=j@invalid', 'commit', '--quiet', '-m', 'seed');
  return dir;
};

afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

describe('the mission sandbox: a slice of this repository, and a diff that comes back', () => {
  it('seeds files byte-identical to the repository, well inside the 4 MiB ceiling', () => {
    const dir = seedSlice();
    for (const path of SLICE) {
      expect(readFileSync(join(dir, path), 'utf8'), `${path} must not be rewritten on the way in`)
        .toBe(readFileSync(join(REPO, path), 'utf8'));
    }
    const rev = git(REPO, 'rev-parse', 'HEAD').trim();
    const bytes = execFileSync('sh', ['-c', `git -C '${REPO}' archive --format=tar ${rev} -- ${SLICE.join(' ')} | wc -c`], { encoding: 'utf8' });
    // BETA_WORKSPACE_BYTES. Stated here so a slice that outgrows the executor's
    // ceiling fails in this suite rather than part-way through a paid run.
    expect(Number(bytes.trim())).toBeLessThan(4_194_304);
  }, 30_000);

  /**
   * The sandbox image is `node:22-bookworm-slim` with no network and no
   * `node_modules`, so the ONLY way real Relay TypeScript runs inside it is
   * Node's own type stripping plus a resolver for Relay's extensionless
   * imports. If either stops being true, a slice mission is unrunnable — which
   * is exactly the kind of thing that should fail here and not at $0.60 a go.
   */
  it('runs the sliced source under node --test with no dependency and no network', () => {
    const dir = seedSlice();
    writeFileSync(join(dir, 'src/relay/mission/julius/slice.test.ts'), [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      // Extensionless, exactly as Relay writes it — the specifier the seeded
      // resolver exists to handle.
      "import { summariseJuliusMissionCost, juliusCostComponent } from './julius-cost-accounting';",
      "import { validateTrajectoryEvent } from './julius-trajectory';",
      "test('real domain source, unmodified', () => {",
      "  assert.equal(summariseJuliusMissionCost([juliusCostComponent({ taskId: 't', usdMicros: 42 })]).knownUsdMicros, 42);",
      "  assert.throws(() => validateTrajectoryEvent({ runtimeVersion: ' ' } as never));",
      '});',
      '',
    ].join('\n'));
    const out = execFileSync(process.execPath,
      ['--import', './.julius/loader.mjs', '--test', 'src/relay/mission/julius/slice.test.ts'],
      { cwd: dir, encoding: 'utf8' });
    expect(out).toMatch(/# pass 1/u);
    expect(out).toMatch(/# fail 0/u);
  }, 30_000);

  /**
   * THE PROPERTY THE WHOLE MODE EXISTS FOR. A mission's output is `git diff`
   * over its workspace; slice mode is worth having only if that diff is a patch
   * against Sunday Relay. Live Run 3's diff was against a throwaway tree and
   * had to be re-verified by hand.
   */
  it('produces a diff that applies to this repository', () => {
    const dir = seedSlice();
    const target = 'src/relay/mission/julius/julius-cost-accounting.ts';
    const before = readFileSync(join(dir, target), 'utf8');
    const anchor = "/** A basis from the closed set, or `UNKNOWN`. A word nobody defined is not a basis. */";
    expect(before, 'the anchor this test edits must exist in the sliced file').toContain(anchor);
    writeFileSync(join(dir, target), before.replace(anchor, `/* a worker's edit */\n${anchor}`));

    const diff = git(dir, 'diff');
    expect(diff, 'the patch names the repository path, not a workspace-local one')
      .toContain(`a/${target}`);
    const patch = join(dir, 'candidate.patch');
    writeFileSync(patch, diff);
    // The real check: git itself decides, against the real checkout.
    expect(() => git(REPO, 'apply', '--check', patch)).not.toThrow();
    // And it is a patch, not a no-op: reversing an unapplied change is refused.
    expect(() => git(REPO, 'apply', '--check', '--reverse', patch)).toThrow();
  }, 30_000);

  it('leaves the harness outside every path a slice can name, so it can shadow nothing', () => {
    // `.julius/` is not a repository path, and no slice may name one — so the
    // two harness files cannot collide with, or stand in for, a real file.
    expect(SLICE.every((path) => !path.startsWith('.julius/'))).toBe(true);
    for (const file of ['resolve.mjs', 'loader.mjs']) {
      const source = readFileSync(join(HARNESS, file), 'utf8');
      // No dependency: the sandbox has no network and no node_modules.
      expect(source, `${file} may import only node builtins`).not.toMatch(/from\s+'(?!node:)[^.]/u);
    }
  });
});

describe('the provisioner refuses what it cannot honestly seed', () => {
  const script = readFileSync(join(REPO, '.github/julius-live-workspace.sh'), 'utf8');

  it('refuses a mission that declares both a throwaway tree and a slice', () => {
    // Two seeds would be two answers to "what is the coder editing?", and the
    // diff could not say which.
    expect(script).toContain('mission_seed_ambiguous');
  });

  it('refuses a slice path that could reach outside the repository', () => {
    for (const refusal of ['mission_slice_path_refused', 'mission_slice_empty', 'mission_slice_matched_nothing']) {
      expect(script, `the provisioner must be able to say ${refusal}`).toContain(refusal);
    }
    // Absolute, parent-relative and globbed paths are refused BEFORE git sees
    // them: the safety of this mode is that a mission can only name paths
    // inside the repository.
    expect(script).toMatch(/\/\*\|\*\.\.\*\|/u);
  });

  it('sizes the slice before writing it, against the executor ceiling', () => {
    // The tmpfs would refuse an oversized slice too, but as an ENOSPC part-way
    // through an extraction — a refusal nobody can act on.
    expect(script).toContain('mission_slice_too_large');
    expect(script).toMatch(/slice_bytes.*-gt.*WORKSPACE_BYTES/su);
  });

  it('reads the slice from a revision rather than from the working tree', () => {
    expect(script, 'a dirty runner must not be able to leak a file into a paid mission')
      .toMatch(/archive --format=tar "\$slice_sha"/u);
    expect(script).toContain('rev-parse --verify');
  });

  it('preserves repository-relative paths, which is what makes the diff a patch', () => {
    expect(script).toMatch(/tar -x -C "\$WORKSPACE"/u);
  });
});
