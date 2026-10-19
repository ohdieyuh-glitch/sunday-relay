import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A PAGE ROOT THAT HOSTS AN ACTOR MUST NOT CLIP IT.
 *
 * `overflow-x: hidden` cannot leave the other axis alone: CSS computes
 * `overflow-y` to `auto` whenever the other axis is neither `visible` nor
 * `clip`. So a declaration written to stop horizontal scrolling silently makes
 * the element a scroll container and CLIPS ANYTHING THAT LEAVES IT VERTICALLY.
 *
 * That is exactly what the Relay Stage exists to undo, and it was true three
 * times over: on the dog's own motion boundary, on the home page root, and on
 * the workspace root one level outside the stage's own containment — where it
 * would have defeated the fix from an ancestor.
 *
 * `overflow-x: clip` stops horizontal scrolling and leaves the vertical axis
 * genuinely visible. This test pins that choice for every root that hosts a
 * `RelayDogMotionBoundary`, so the next person to reach for `hidden` here has
 * to read why first.
 */

const UI = __dirname;
const read = (relative: string): string =>
  // Comments stripped: a comment EXPLAINING why `overflow-x: hidden` was
  // removed contains the words, and an assertion that reads its own
  // explanation is not testing anything. This suite exists because two
  // assertions in this repository did exactly that and stayed green.
  readFileSync(join(UI, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Roots that contain a Relay Dog, and the rule each one's containment lives in. */
const ACTOR_HOSTING_ROOTS = [
  { file: 'entry-home/relay-entry-home.css', selector: '.reh' },
  { file: 'project-workspace/relay-project-workspace.css', selector: '.rpw' },
  { file: 'relay-stage/relay-stage.css', selector: '.rpw-stage-bounds' },
] as const;

describe('a page root hosting the Relay Dog contains without clipping', () => {
  for (const { file, selector } of ACTOR_HOSTING_ROOTS) {
    it(`${selector} uses overflow-x: clip, never hidden`, () => {
      const css = read(file);
      const start = css.indexOf(`${selector} {`);
      expect(start, `${selector} is not declared in ${file}`).toBeGreaterThanOrEqual(0);
      const block = css.slice(start, css.indexOf('}', start));
      expect(block, `${selector} must contain horizontally`).toMatch(/overflow-x:\s*clip/);
      expect(block, `${selector} must not make itself a scroll container`)
        .not.toMatch(/overflow(-x|-y)?:\s*(hidden|auto|scroll)/);
    });
  }

  it('the dog’s own boundary declares no overflow at all', () => {
    const css = read('relay-dog-motion/relay-dog-motion.css');
    const block = css.slice(css.indexOf('.rdm {'), css.indexOf('.rdm-travel'));
    expect(block).not.toMatch(/overflow(-x|-y)?:\s*/);
  });

  it('no other stylesheet declares a bare .rdm rule that would land on the dog', () => {
    // The Demo Mission summary used to own `.rdm` AND `.rdm-body`. Both
    // stylesheets are imported by the preview app, so equal specificity plus
    // later source order put the panel's `overflow-x: hidden` on the dog below
    // 640px — and a border and panel background on it at every width.
    const demo = read('app/demo-simulation/relay-demo-workspace.css');
    expect(demo).not.toMatch(/(^|[\s,}])\.rdm(?![a-z-])/m);
    expect(demo).not.toMatch(/(^|[\s,}])\.rdm-body\b/m);
  });
});
