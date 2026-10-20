import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * BLINDNESS GUARD (task T7, Candidate C, mission julius-diag-digest-evidence-1).
 *
 * REVIEW's blindness rules: the mission's reviewers must not see the dry run, the
 * oracle, the reference fix or the prereg. A mission directory carries `slice.txt`
 * (whose comment lines name invariants the seeded specification deliberately does
 * not pin) and `dryrun/` (the known-good and known-bad fixes). Neither is part of
 * what a paid mission is supposed to know.
 *
 * Two independent properties are pinned, each with a positive control (a seeded
 * leak must make the checker fail, otherwise a green result means nothing):
 *
 *  1. STATIC: no production file (workflow, provisioner, bridge, kernel, scripts)
 *     references `dryrun/`, `reference-fix`, `prereg` paths, and only the
 *     provisioner and the workflow's seed-kind gate read `slice.txt`.
 *  2. DYNAMIC: the workspace the provisioner builds for every slice mission (the
 *     tree the coder edits and the reviewer's diff is taken from) contains no
 *     `slice.txt`, no `dryrun/`, and none of slice.txt's comment text.
 *
 * The reviewer itself holds no tool (scripts/julius-reviewer-isolation.mjs) and sees
 * only the review packet, so what reaches it is bounded by the workspace diff, the
 * contract and the evidence, which is what these checks protect.
 */

const REPO = join(import.meta.dirname, '..');
const MISSIONS = join(REPO, '.github/julius-missions');
const HARNESS = join(REPO, '.github/julius-mission-slice');
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ static scan */

interface SourceFile { readonly path: string; readonly text: string }

/** A reference to a mission's private material (dry run, reference fix, prereg) or to slice.txt. */
const PRIVATE_PATH = /(^|[^A-Za-z0-9_])(dryrun|reference-fix|prereg)[A-Za-z0-9_-]*\/|\/(dryrun|reference-fix|prereg)\b/u;
const SLICE_TXT = /slice\.txt/u;
/** Copying or archiving the whole mission directory into anything. */
const WHOLE_MISSION_DIR = /\b(cp|rsync|tar|cpSync|cat)\b[^\n]*\$\{?MISSION_DIR\}?\/?["']?(\s|$)/u;

/** The only production files allowed to name slice.txt: the provisioner and the workflow's seed-kind gate. */
const SLICE_TXT_READERS: readonly string[] = [
  '.github/julius-live-workspace.sh',
  '.github/workflows/julius-first-live-mission.yml',
];

const leakHits = (files: readonly SourceFile[]): string[] => {
  const hits: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      const where = `${file.path}:${index + 1}`;
      if (PRIVATE_PATH.test(line)) hits.push(`${where} private-path ${line.trim().slice(0, 100)}`);
      if (WHOLE_MISSION_DIR.test(line)) hits.push(`${where} whole-mission-dir ${line.trim().slice(0, 100)}`);
      if (SLICE_TXT.test(line) && !SLICE_TXT_READERS.includes(file.path)) {
        hits.push(`${where} slice.txt-outside-provisioner ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return hits;
};

/** Production = tracked, executable or configuration source outside the missions, tests and prose. */
const productionFiles = (): SourceFile[] =>
  git(REPO, 'ls-files', '--', '.github', 'scripts', 'relay-bridge', 'src').split('\n').filter((path) => path.length > 0)
    .filter((path) => !path.startsWith('.github/julius-missions/'))
    .filter((path) => !/\.(test\.[cm]?[jt]s|md|html|json|txt|png|svg|sql)$/u.test(path))
    .filter((path) => path !== 'scripts/julius-mission-reviewer-blindness.test.ts')
    .map((path) => ({ path, text: readFileSync(join(REPO, path), 'utf8') }));

describe('production never names a mission\'s dry run, reference fix or prereg, and only the provisioner reads slice.txt', () => {
  it('scans a non-trivial production set (an empty set would make the check vacuous)', () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => f.path)).toContain('.github/julius-live-workspace.sh');
    expect(files.map((f) => f.path)).toContain('.github/workflows/julius-first-live-mission.yml');
  });

  it('finds no leak in the real tree', () => {
    expect(leakHits(productionFiles())).toEqual([]);
  });

  it('POSITIVE CONTROL: a seeded copy of dryrun/ into the workspace is flagged', () => {
    const seeded: SourceFile[] = [{
      path: '.github/julius-live-workspace.sh',
      text: 'cp -r "$MISSION_DIR/dryrun" "$WORKSPACE/dryrun"\n',
    }];
    expect(leakHits(seeded).length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: archiving the whole mission directory is flagged', () => {
    expect(leakHits([{ path: 'scripts/x.sh', text: 'tar -c "$MISSION_DIR" | tar -x -C "$WORKSPACE"\n' }]).length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: a bridge module reading slice.txt is flagged, the provisioner is not', () => {
    const text = "const s = readFileSync(join(missionDir, 'slice.txt'), 'utf8');\n";
    expect(leakHits([{ path: 'relay-bridge/julius/review-packet.ts', text }]).length).toBe(1);
    expect(leakHits([{ path: '.github/julius-live-workspace.sh', text }])).toEqual([]);
  });

  it('POSITIVE CONTROL: a reference to a prereg or reference-fix path is flagged', () => {
    expect(leakHits([{ path: 'relay-bridge/a.ts', text: "readFileSync('.github/julius-missions/m/prereg/PREREG.md')\n" }]).length).toBeGreaterThan(0);
    expect(leakHits([{ path: 'relay-bridge/a.ts', text: "join(dir, 'reference-fix/solution.patch')\n" }]).length).toBeGreaterThan(0);
  });

  it('the provisioner drops comment lines before it archives (slice.txt text is never data)', () => {
    const script = readFileSync(join(REPO, '.github/julius-live-workspace.sh'), 'utf8');
    expect(script).toContain('line=${line%%#*}');
  });
});

/* -------------------------------------------------------------- workspace scan */

const sliceMissionNames = (): string[] =>
  readdirSync(MISSIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    .filter((name) => existsSync(join(MISSIONS, name, 'slice.txt')));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
};

/** Comment text of slice.txt that is long enough to be distinctive. */
const sliceComments = (mission: string): string[] =>
  readFileSync(join(MISSIONS, mission, 'slice.txt'), 'utf8').split('\n')
    .filter((line) => line.startsWith('#')).map((line) => line.replace(/^#\s*/u, '').trim()).filter((line) => line.length >= 40);

/** What in a provisioned workspace a reviewer could be shown, by name or by content. */
const workspaceLeaks = (dir: string, comments: readonly string[]): string[] => {
  const leaks: string[] = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split('\\').join('/');
    if (/(^|\/)slice\.txt$/u.test(rel)) leaks.push(`${rel} (slice.txt)`);
    if (/(^|\/)(dryrun|reference-fix|prereg|oracle)(\/|$)/u.test(rel)) leaks.push(`${rel} (private directory)`);
    if (statSync(file).size > 2_000_000) continue;
    const text = readFileSync(file, 'utf8');
    for (const comment of comments) if (text.includes(comment)) leaks.push(`${rel} (contains slice.txt comment: ${comment.slice(0, 40)})`);
  }
  return leaks;
};

/** The provisioner's slice-mode steps (archive from a revision, harness, overlay), minus tmpfs and root. */
const provision = (mission: string): string => {
  const missionDir = join(MISSIONS, mission);
  const dir = mkdtempSync(join(tmpdir(), 'julius-blind-'));
  scratch.push(dir);
  const paths = readFileSync(join(missionDir, 'slice.txt'), 'utf8').split('\n')
    .map((line) => line.replace(/#.*$/u, '').replace(/\s+/gu, '')).filter((line) => line.length > 0);
  const rev = git(REPO, 'rev-parse', 'HEAD').trim();
  execFileSync('sh', ['-c', `git -C '${REPO}' archive --format=tar ${rev} -- ${paths.join(' ')} | tar -x -C '${dir}'`]);
  mkdirSync(join(dir, '.julius'), { recursive: true });
  for (const file of ['resolve.mjs', 'loader.mjs']) cpSync(join(HARNESS, file), join(dir, '.julius', file));
  const overlay = join(missionDir, 'seed');
  if (existsSync(overlay)) cpSync(overlay, dir, { recursive: true });
  return dir;
};

describe('the workspace a slice mission provisions shows its coder and reviewer no slice.txt and no dryrun/', () => {
  const missions = sliceMissionNames();

  it('finds slice missions, including Candidate C', () => {
    expect(missions).toContain('julius-diag-digest-evidence-1');
  });

  it.each(missions)('%s: no slice.txt, no private directory, none of the slice.txt comment text', (mission) => {
    const dir = provision(mission);
    expect(workspaceLeaks(dir, sliceComments(mission))).toEqual([]);
  }, 30_000);

  it.each(missions)('%s: the seed overlay carries only the specification, never private material', (mission) => {
    const overlay = join(MISSIONS, mission, 'seed');
    if (!existsSync(overlay)) return;
    const names = walk(overlay).map((file) => relative(overlay, file).split('\\').join('/'));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /(^|\/)(dryrun|reference-fix|prereg|oracle|slice\.txt)(\/|$)/u.test(name))).toEqual([]);
  });

  it('Candidate C has comment text to protect (the content control below would be vacuous without it)', () => {
    expect(sliceComments('julius-diag-digest-evidence-1').length).toBeGreaterThan(3);
  });

  it('POSITIVE CONTROL: a workspace with dryrun/ copied in is flagged', () => {
    const mission = 'julius-diag-digest-evidence-1';
    const dir = provision(mission);
    cpSync(join(MISSIONS, mission, 'dryrun'), join(dir, 'dryrun'), { recursive: true });
    const leaks = workspaceLeaks(dir, sliceComments(mission));
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some((leak) => leak.includes('private directory'))).toBe(true);
  });

  it('POSITIVE CONTROL: a workspace carrying slice.txt is flagged by name', () => {
    const mission = 'julius-diag-digest-evidence-1';
    const dir = provision(mission);
    cpSync(join(MISSIONS, mission, 'slice.txt'), join(dir, 'slice.txt'));
    expect(workspaceLeaks(dir, sliceComments(mission)).some((leak) => leak.includes('slice.txt'))).toBe(true);
  });

  it('POSITIVE CONTROL: slice.txt comment text pasted into a sliced source file is flagged by content', () => {
    const mission = 'julius-diag-digest-evidence-1';
    const dir = provision(mission);
    const target = join(dir, 'src/relay/mission/durable/durable-digest.ts');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n// ${sliceComments(mission)[0]}\n`);
    expect(workspaceLeaks(dir, sliceComments(mission)).some((leak) => leak.includes('contains slice.txt comment'))).toBe(true);
  });
});
