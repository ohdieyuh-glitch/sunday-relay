import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MILESTONE 4.5 boundary tests — the mechanical proof that Relay Dog motion
 * is VISUAL ONLY. Mission state drives the dog; the dog drives nothing.
 *
 * Repo convention: source-level assertions, matching relay-boundary.test.ts
 * and the Mission Operations domain boundary tests.
 */

const dir = join(process.cwd(), 'src', 'relay', 'ui', 'relay-dog-motion');
const sources = readdirSync(dir)
  .filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
  .map((name) => join(dir, name));
const read = (file: string) => readFileSync(file, 'utf8');
const css = readFileSync(join(dir, 'relay-dog-motion.css'), 'utf8');

/** The dog may never reach mission, trace, capsule, provider, or agent code. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/from\s+['"].*mission\/trace/u, 'the Aquala Trace ledger'],
  [/from\s+['"].*mission\/execution-capsules/u, 'execution capsules'],
  [/from\s+['"].*mission\/commands/u, 'the command protocol'],
  [/from\s+['"].*mission\/status/u, 'the mission status model'],
  [/from\s+['"].*connectors\//u, 'agent connectors'],
  [/from\s+['"].*relay-bridge/u, 'the relay bridge'],
  [/from\s+['"].*fusion-engine/u, 'the Fusion Engine'],
  [/from\s+['"]openai['"]|from\s+['"]@anthropic/u, 'provider SDKs'],
  [/from\s+['"]node:/u, 'node builtins'],
  [/\bfetch\s*\(/u, 'network fetch'],
  [/XMLHttpRequest|WebSocket|EventSource/u, 'network transports'],
  [/child_process|execSync|spawnSync/u, 'shell processes'],
  [/process\.env/u, 'environment variables'],
  [/localStorage|sessionStorage|indexedDB/u, 'persisted storage'],
  [/createClient|supabase/iu, 'database clients'],
];

/** Names that would mean the dog is writing product state. */
const FORBIDDEN_CALLS =
  /appendTraceEvent\(|createTrace\(|prepareExecutionCapsule\(|submitMissionCommand\(|executeMissionCommand\(|applyStatusTransition\(|beginLiveMission\(|pollLiveMission\(|cancelLiveMission\(/u;

describe('relay dog motion boundary', () => {
  it('finds the motion sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(4);
  });

  it('never reaches mission, trace, capsule, provider, agent, network, or storage code', () => {
    for (const file of sources) {
      const content = read(file);
      for (const [pattern, why] of FORBIDDEN) {
        expect(pattern.test(content), `${file} must not reference ${why}`).toBe(false);
      }
    }
  });

  it('never calls anything that would mutate mission or trace state', () => {
    for (const file of sources) {
      expect(FORBIDDEN_CALLS.test(read(file)), `${file} must not write product state`).toBe(false);
    }
  });

  it('the pure layers stay free of React and browser APIs', () => {
    for (const name of ['dog-behavior.ts', 'patrol-engine.ts']) {
      const content = read(join(dir, name));
      expect(/from\s+['"]react/u.test(content), `${name} must stay React-free`).toBe(false);
      expect(/window\.|document\.|matchMedia|requestAnimationFrame/u.test(content)).toBe(false);
      expect(/Date\.now\(|new Date\(\)|Math\.random\(/u.test(content)).toBe(false);
    }
  });

  it('patrol position is never persisted anywhere', () => {
    for (const file of sources) {
      const content = read(file);
      expect(/localStorage|sessionStorage|history\.replaceState|searchParams/u.test(content)).toBe(
        false,
      );
    }
  });

  it('exactly ONE animation-frame loop exists, in the one controller', () => {
    const withRaf = sources.filter((file) => /requestAnimationFrame\(/u.test(read(file)));
    expect(withRaf.map((f) => f.split('/').pop())).toEqual(['useRelayDogPatrol.ts']);

    const controller = read(join(dir, 'useRelayDogPatrol.ts'));
    // One scheduling site inside the loop, one to start it.
    expect(controller.match(/requestAnimationFrame\(tick\)/gu)?.length).toBe(2);
    expect(/cancelAnimationFrame\(/u.test(controller)).toBe(true);
    // No timers competing with the frame loop.
    expect(/setInterval\(|setTimeout\(/u.test(controller)).toBe(false);
  });

  it('no other Relay UI module starts its own dog loop', () => {
    const uiRoot = join(process.cwd(), 'src', 'relay', 'ui');
    const offenders: string[] = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) continue;
        if (full.startsWith(dir)) continue;
        if (/requestAnimationFrame\(/u.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(uiRoot);
    expect(offenders).toEqual([]);
  });

  it('the CSS adds no external asset and no forbidden colour', () => {
    expect(/url\(/u.test(css), 'no url() — the repo forbids external assets').toBe(false);
    expect(/#ffd700|#ffc107|yellow-400|amber-400/iu.test(css)).toBe(false);
    expect(/filter:\s*drop-shadow|box-shadow:[^;]*rgba\(\s*255/iu.test(css)).toBe(false);
  });

  it('the boundary itself no longer clips, and honours reduced motion', () => {
    // THIS ASSERTION USED TO SAY THE OPPOSITE, AND PASSED FOR THE WRONG REASON.
    //
    // It required `.rdm { overflow-x: hidden }`. That declaration was deleted —
    // CSS forces `overflow-y` to `auto` when the other axis is `hidden`, so a
    // rule written to stop horizontal scroll was clipping the dog vertically —
    // and this line kept passing anyway, because the comment left in its place
    // EXPLAINS the removal using the words the regex was matching, and `[^}]*`
    // walks straight through a comment.
    //
    // Comments are stripped, and the assertion is inverted to match the code.
    // Horizontal containment is the PAGE's job now: `.rpw-stage-bounds` in the
    // workspace, `.reh` on the home screen.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(/\.rdm\s*\{[^}]*overflow(-x|-y)?\s*:/su.test(declarations)).toBe(false);
    expect(/@media \(prefers-reduced-motion: reduce\)/u.test(css)).toBe(true);
    expect(/\.rdm--reduced[^{]*\{[^}]*animation:\s*none/su.test(css)).toBe(true);
  });

  it('separates the transform layers so animations never overwrite each other', () => {
    // travel = translateX (inline), facing = scaleX, body = the activity.
    expect(/\.rdm-facing--left\s*\{\s*transform:\s*scaleX\(-1\)/u.test(css)).toBe(true);
    // Text and glyphs are counter-flipped, never rendered backwards.
    expect(/\.rdm-facing--left \.rpd-caption/u.test(css)).toBe(true);
    expect(/\.rdm-facing--left \.rpd-marker/u.test(css)).toBe(true);
    expect(/@keyframes rdm-attention-jump/u.test(css)).toBe(true);
    expect(/@keyframes rdm-tiptoe-reach/u.test(css)).toBe(true);
    expect(/@keyframes rdm-paw-scratch/u.test(css)).toBe(true);
  });

  it('no in-place activity animation has a horizontal component', () => {
    // translateY / scaleY / rotate only — a translateX in any of these would
    // drift the dog along the track and fight the patrol layer.
    for (const name of [
      'rdm-tiptoe-reach',
      'rdm-paw-scratch',
      'rdm-sleep-breathe',
      'rdm-dig-lunge',
      'rdm-code-type',
      'rdm-enter-sleep',
      'rdm-enter-dig',
      'rdm-enter-code',
    ]) {
      const start = css.indexOf(`@keyframes ${name}`);
      expect(start, `${name} keyframes are missing`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf('}\n', css.indexOf('{', start + 12)) + 1);
      expect(/translateX/u.test(block), `${name} drifts horizontally`).toBe(false);
    }
  });

  it('the waiting jump has no horizontal component', () => {
    const start = css.indexOf('@keyframes rdm-attention-jump');
    const block = css.slice(start, css.indexOf('}', css.indexOf('.rdm-body--waiting_for_user')));
    expect(/translateX/u.test(block)).toBe(false);
  });
});
