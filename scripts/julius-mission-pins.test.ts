import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A FROZEN MISSION STAYS FROZEN, and the host that runs it proves so.
 *
 * Mission 6 is the representative paid qualification. Its contract, its seed and the
 * one repository file it slices were frozen, and a paid run must run exactly those —
 * never a version that drifted toward being easier to pass. `.github/julius-mission-pins.sh`
 * checks the git object ids in `.github/julius-mission-pins.txt` at the revision being
 * sliced, and the workspace provisioning script calls it before anything is mounted or
 * built, on the hosted runner and on a local rig alike.
 */

const ROOT = resolve(process.cwd());
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const pins = (args: readonly string[], env: Record<string, string> = {}) => spawnSync('bash', ['.github/julius-mission-pins.sh', ...args], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
});

describe('the frozen pins hold, and a drifted pin refuses', () => {
  it('Mission 6 holds all four of its pins at HEAD', () => {
    const run = pins(['julius-live-mission-6', '.', 'HEAD']);
    expect(run.stderr).toBe('');
    expect(run.stdout).toMatch(/^mission_pins_verified=4 mission=julius-live-mission-6 revision=[0-9a-f]{40}$/mu);
    expect(run.status).toBe(0);
  });

  it('a pin that names different content refuses, and says which path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-pins-'));
    try {
      const drifted = join(dir, 'pins.txt');
      writeFileSync(drifted, `julius-live-mission-6 src/relay/workspace/julius-tools/node-tool-adapter.ts ${'0'.repeat(40)}\n`);
      const run = pins(['julius-live-mission-6', '.', 'HEAD'], { JULIUS_MISSION_PINS_FILE: drifted });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('mission_pin_mismatch: julius-live-mission-6 src/relay/workspace/julius-tools/node-tool-adapter.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every frozen mission holds every one of its pins at HEAD, so its preflight prints that count', () => {
    // The count a dispatch's preflight must print is per mission, not Mission 6's 4: a throwaway-tree
    // mission pins its one directory. A pin added for a mission must also be held here.
    const counts = new Map<string, number>();
    for (const line of read('.github/julius-mission-pins.txt').split('\n')) {
      const [name] = line.trim().split(/\s+/u);
      if (!name || name.startsWith('#')) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const pairArms = ['julius-learning-pair-1-without-1', 'julius-learning-pair-1-with-1', 'julius-learning-pair-1-without-2', 'julius-learning-pair-1-with-2'];
    expect([...counts.keys()].sort()).toEqual([...pairArms, 'julius-live-mission-2', 'julius-live-mission-3', 'julius-live-mission-5', 'julius-live-mission-6', 'julius-unreal-mission-1'].sort());
    expect(counts.get('julius-live-mission-5'), 'Mission 5 is a throwaway tree: its directory is its one pin').toBe(1);
    expect(counts.get('julius-unreal-mission-1'), 'row 14-Unreal is a throwaway tree: its directory is its one pin').toBe(1);
    for (const arm of pairArms) expect(counts.get(arm), `${arm}: a Decision C arm is a throwaway tree, its directory its one pin`).toBe(1);
    for (const [mission, count] of counts) {
      const run = pins([mission, '.', 'HEAD']);
      expect(run.stderr, mission).toBe('');
      expect(run.stdout).toMatch(new RegExp(`^mission_pins_verified=${count} mission=${mission} revision=[0-9a-f]{40}$`, 'mu'));
      expect(run.status, mission).toBe(0);
    }
  });

  it('a mission that is not listed is not frozen, and passes with zero pins', () => {
    const run = pins(['julius-first-live', '.', 'HEAD']);
    expect(run.stdout).toMatch(/^mission_pins_verified=0 /mu);
    expect(run.status).toBe(0);
  });
});

describe('the pins are checked where they cannot be skipped, and agree everywhere they are written', () => {
  it('the workspace script checks them before it mounts, builds or touches anything', () => {
    const script = read('.github/julius-live-workspace.sh');
    const check = script.indexOf('bash .github/julius-mission-pins.sh "$MISSION_NAME"');
    expect(check, 'the provisioning script must call the pin check').toBeGreaterThan(0);
    expect(check, 'and before the tmpfs is mounted').toBeLessThan(script.indexOf('sudo mount -t tmpfs'));
    expect(check, 'and before anything is copied into the workspace').toBeLessThan(script.indexOf('mkdir -p "$FLEET_ROOT/$TENANT"'));
  });

  it('the local launcher pins exactly what the shared pins file pins', () => {
    const file = read('.github/julius-mission-pins.txt').split('\n')
      .filter((line) => line.startsWith('julius-live-mission-6 '))
      .map((line) => line.split(/\s+/u).slice(1, 3).join('='));
    const launcher = read('scripts/julius-local-qualification.sh');
    const tree = /^readonly MISSION6_TREE=([0-9a-f]{40})$/mu.exec(launcher)?.[1];
    const blobs = /^readonly MISSION6_SLICE_BLOBS='([^']+)'$/mu.exec(launcher)?.[1]?.split('\n') ?? [];
    expect(file.sort()).toEqual([`.github/julius-missions/julius-live-mission-6=${tree}`, ...blobs].sort());
  });
});
