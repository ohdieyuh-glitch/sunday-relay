import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayDogMotionBoundary } from './RelayDogMotionBoundary';
import { RelayDogOperationalDecor, operationalActivityDescription } from './RelayDogOperationalDecor';
import { projectWorkspaceDogBehavior } from './dog-behavior';
import { RelayPixelDog } from '../pixel-dog';
import { DOG_PRESENTATION } from '../project-workspace/projections';
import {
  OFFICIAL_RELAY_DOG_POSES,
  officialRelayDogViewForState,
} from '../official-relay-dog';
import type { WorkspaceDogState } from '../project-workspace/contracts';

/**
 * Relay Dog OPERATIONAL ANIMATIONS — reviewing sleeps, repairing digs, coding
 * types at the keys with no code panel beside it.
 *
 * The load-bearing assertions here are the TRUTHFULNESS ones. An animation is
 * allowed to be charming; it is never allowed to say that a review approved,
 * that verification passed, that a repair succeeded or that coding finished.
 */

const dir = __dirname;
const css = readFileSync(join(dir, 'relay-dog-motion.css'), 'utf8');

/** The full text of one @keyframes rule, brace-balanced — slicing at the first
 *  `}` would cut the block off after its first stop and make any assertion
 *  about later stops vacuously true. */
function keyframes(name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return css.slice(start);
}

/** Render the full boundary for a workspace state, as the workspace does. */
function renderState(state: WorkspaceDogState, reducedMotion = false): string {
  const p = DOG_PRESENTATION[state];
  return renderToStaticMarkup(
    createElement(RelayDogMotionBoundary, {
      behavior: projectWorkspaceDogBehavior(state),
      reducedMotion,
      children: createElement(RelayPixelDog, {
        pose: p.pose,
        label: p.label,
        marker: p.marker,
        moving: p.moving,
        reducedMotion,
      }),
    }),
  );
}

const decor = (activity: 'reviewing' | 'repairing' | 'implementing', reducedMotion = false) =>
  renderToStaticMarkup(createElement(RelayDogOperationalDecor, { activity, reducedMotion }));

/** Words that would assert an OUTCOME rather than an activity. */
const OUTCOME_WORDS = [
  'APPROVED', 'approved',
  'VERIFIED', 'verified',
  'COMPLETE', 'complete',
  'PASSED', 'passed',
  'RELEASED', 'released',
  'SUCCESS', 'success',
  'REPAIRED', 'repaired',
];

/* ============================================================== REVIEWING */

describe('REVIEWING — the dog snoozes', () => {
  it('maps reviewing to the sleeping pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.reviewing.pose).toBe('sleeping');
    const view = officialRelayDogViewForState('reviewing');
    expect(view.activity).toBe('reviewing');
    expect(view.pose).toBe('sleeping');
    expect(view.motion).toBe('sleep');
  });

  it('the sleeping state has its own visual hook, distinct from every other', () => {
    const html = renderState('reviewing');
    expect(html).toContain('rdm--reviewing');
    expect(html).toContain('rdm-body--reviewing');
    expect(html).toContain('rpd--sleeping');
    expect(html).toContain('rdo--sleep');
    // Not the digging or coding scenery.
    expect(html).not.toContain('rdo--dig');
    expect(html).not.toContain('rdo--code');
  });

  it('draws the eyes CLOSED while keeping ears, visor and muzzle identical', () => {
    const sleeping = OFFICIAL_RELAY_DOG_POSES.sleeping;
    const standing = OFFICIAL_RELAY_DOG_POSES.standing;
    // No amber eye pixel anywhere in the sleeping pose.
    expect(sleeping.join('')).not.toContain('y');
    expect(standing.join('')).toContain('y');
    // The ear row and the visor band survive unchanged.
    expect(sleeping.some((r) => r.includes('ww..ww'))).toBe(true);
    expect(sleeping.some((r) => r.includes('dddddd'))).toBe(true);
  });

  it('renders breathing, a drifting Z and a sleep twitch — inside 4-7s', () => {
    expect(css).toContain('@keyframes rdm-sleep-breathe');
    expect(css).toContain('@keyframes rdm-sleep-twitch');
    expect(css).toContain('@keyframes rdo-z-drift');
    const loop = css.match(/animation:\s*rdm-sleep-breathe\s+([\d.]+)s/);
    expect(loop, 'the sleep loop duration is not declared').not.toBeNull();
    const seconds = Number(loop?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(7);
  });

  it('the Z decoration is aria-hidden and carries no text meaning', () => {
    const html = decor('reviewing');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('rdo-z');
    // Every decorative node sits inside the aria-hidden container.
    expect(html.indexOf('aria-hidden="true"')).toBeLessThan(html.indexOf('rdo-z'));
  });

  it('NEVER renders approval, verification or success semantics', () => {
    const html = renderState('reviewing');
    expect(DOG_PRESENTATION.reviewing.marker).toBe('question');
    expect(DOG_PRESENTATION.reviewing.marker).not.toBe('check');
    expect(html).not.toContain('rpd-marker--check');
    expect(html).toContain('REVIEWING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `reviewing must not render "${word}"`).not.toContain(word);
    }
  });

  it('the accessible sentence describes the activity, never an outcome', () => {
    const sentence = operationalActivityDescription('reviewing');
    expect(sentence).toBe('Relay Dog is snoozing while the mission is under review.');
    expect(sentence).toContain('under review');
    expect(sentence).not.toMatch(/reviewed|approved|verified|passed/i);
    expect(renderState('reviewing')).toContain('under review');
  });

  it('reduced motion holds a STATIC sleeping pose with one still Z', () => {
    const html = renderState('reviewing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--sleeping');
    // Exactly one Z, not three.
    expect((html.match(/rdo-z /g) ?? []).length + (html.match(/rdo-z"/g) ?? []).length)
      .toBeGreaterThan(0);
    expect((html.match(/rdo-z--/g) ?? []).length).toBe(1);
    expect(css).toMatch(/\.rdm--reduced[^@]*\.rdo-z[^{]*\{[^}]*animation:\s*none/su);
  });
});

/* ============================================================== REPAIRING */

describe('REPAIRING — the dog digs', () => {
  it('maps repairing to the digging pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.repairing.pose).toBe('digging');
    const view = officialRelayDogViewForState('repairing');
    expect(view.activity).toBe('repairing');
    expect(view.pose).toBe('digging');
    expect(view.motion).toBe('dig');
  });

  it('has its own visual hook and leans forward with the eyes OPEN', () => {
    const html = renderState('repairing');
    expect(html).toContain('rdm-body--repairing');
    expect(html).toContain('rpd--digging');
    expect(html).toContain('rdo--dig');
    // Investigating, not resting: the amber eyes stay.
    expect(OFFICIAL_RELAY_DOG_POSES.digging.join('')).toContain('y');
    expect(OFFICIAL_RELAY_DOG_POSES.digging).not.toEqual(OFFICIAL_RELAY_DOG_POSES.sleeping);
  });

  it('alternates left and right paw scrapes, and pauses to look in the hole', () => {
    const paws = keyframes('rdm-dig-paws');
    expect(paws, 'rdm-dig-paws is missing').not.toBe('');
    // A negative AND a positive X offset — the left paw and the right paw.
    expect(paws, 'no left-paw scrape').toMatch(/translate\(-[\d.]+px/);
    expect(paws, 'no right-paw scrape').toMatch(/translate\([1-9][\d.]*px/);
    // The lunge keyframes hold a beat for the look into the hole.
    const lunge = keyframes('rdm-dig-lunge');
    expect(lunge, 'rdm-dig-lunge is missing').not.toBe('');
    expect(lunge, 'no inspection pause').toMatch(/68%,\s*80%/);
  });

  it('keeps the dig loop inside 2.5-5s', () => {
    const loop = css.match(/animation:\s*\n?\s*rdm-enter-dig[^;]*rdm-dig-lunge\s+([\d.]+)s/s)
      ?? css.match(/rdm-dig-lunge\s+([\d.]+)s/);
    expect(loop).not.toBeNull();
    const seconds = Number(loop?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(2.5);
    expect(seconds).toBeLessThanOrEqual(5);
  });

  it('dirt is decorative, aria-hidden, restrained and cannot escape', () => {
    const html = decor('repairing');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('rdo-hole');
    expect(html).toContain('rdo-mound');
    const clods = (html.match(/rdo-clod--/g) ?? []).length;
    expect(clods).toBeGreaterThan(0);
    expect(clods, 'dozens of particles are prohibited').toBeLessThanOrEqual(8);
    // The container clips, so no particle can leave the intended area.
    expect(css).toMatch(/\.rdo\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.rdo\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('NEVER marks the mission repaired or complete', () => {
    const html = renderState('repairing');
    expect(DOG_PRESENTATION.repairing.marker).toBe('alert');
    expect(html).not.toContain('rpd-marker--check');
    expect(html).toContain('REPAIRING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `repairing must not render "${word}"`).not.toContain(word);
    }
    const sentence = operationalActivityDescription('repairing');
    expect(sentence).toBe('Relay Dog is digging into the project to repair an issue.');
    expect(sentence).not.toMatch(/repaired|fixed|resolved|complete/i);
  });

  it('reduced motion holds a STATIC digging pose with no flying particles', () => {
    const html = renderState('repairing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--digging');
    expect(html).toContain('rdo-hole');
    expect(html).toContain('rdo-mound');
    expect((html.match(/rdo-clod/g) ?? []).length).toBe(0);
    // The held pose still reads as digging rather than standing.
    expect(css).toMatch(/\.rdm--reduced \.rdm-body--repairing\s*\{[^}]*transform:\s*translateY/s);
  });
});

/* ================================================================= CODING */

describe('CODING — the dog types at the keys, with no code panel', () => {
  it('maps implementing to the coding pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.implementing.pose).toBe('coding');
    const view = officialRelayDogViewForState('implementing');
    expect(view.activity).toBe('implementing');
    expect(view.pose).toBe('coding');
    expect(view.motion).toBe('code_progression');
  });

  it('renders the dog at a keyboard, still typing', () => {
    const html = renderState('implementing');
    expect(html).toContain('rdm-body--implementing');
    expect(html).toContain('rpd--coding');
    expect(css).toContain('@keyframes rdm-code-type');
    expect(css).toContain('@keyframes rdm-code-paws');
  });

  /**
   * The founder removed the code panel that used to sit beside the dog. The
   * dog stayed; the panel did not. These are the assertions that keep it gone
   * — a decorative surface that draws code is exactly the kind of thing that
   * grows back.
   */
  it('draws NO code panel: no editor, no code lines, no progression module', () => {
    for (const reducedMotion of [false, true]) {
      const html = renderState('implementing', reducedMotion);
      for (const hook of ['rdo--code', 'rdo--code-static', 'rdo-editor', 'rdo-code']) {
        expect(html, `implementing still renders "${hook}"`).not.toContain(hook);
      }
    }
    // The decor renders nothing at all for implementing.
    expect(decor('implementing')).toBe('');
    expect(decor('implementing', true)).toBe('');
    // No orphan styles or keyframes left behind to revive it.
    for (const hook of [
      'rdo--code',
      'rdo-editor',
      'rdo-code',
      '@keyframes rdo-code-level',
    ]) {
      expect(css, `dead style "${hook}" survives`).not.toContain(hook);
    }
    expect(existsSync(join(dir, 'code-progression.ts')), 'code-progression.ts survives').toBe(false);
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    expect(decorSource).not.toContain('code-progression');
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).not.toContain('code-progression');
  });

  it('the coding state is VISUAL ONLY — it never completes mission state', () => {
    const html = renderState('implementing');
    expect(html).toContain('IMPLEMENTING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `coding must not render "${word}"`).not.toContain(word);
    }
    expect(html).not.toContain('rpd-marker--check');
    const sentence = operationalActivityDescription('implementing');
    expect(sentence).toBe('Relay Dog is writing and implementing code.');
    expect(sentence).not.toMatch(/complete|finished|done|verified/i);
  });

  it('reduced motion holds a STATIC coding pose', () => {
    const html = renderState('implementing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--coding');
    // The reduced-motion fallback label still names the state in words.
    expect(html).toContain(projectWorkspaceDogBehavior('implementing').reducedMotionFallback);
  });
});

/* =============================================================== IDENTITY */

describe('OFFICIAL RELAY DOG identity survives all three states', () => {
  const states: WorkspaceDogState[] = ['reviewing', 'repairing', 'implementing'];

  it('every operational pose is the official 18x14 dog with the official palette', () => {
    for (const pose of ['sleeping', 'digging', 'coding'] as const) {
      const grid = OFFICIAL_RELAY_DOG_POSES[pose];
      expect(grid, pose).toHaveLength(14);
      for (const row of grid) expect(row.length, pose).toBe(18);
      // Only legal pixels — no new colour is introduced for a state.
      expect(/^[.wsdyc]+$/.test(grid.join('')), pose).toBe(true);
      // The collar and the dimensional shadow tone are part of the identity.
      expect(grid.join(''), `${pose} lost the collar`).toContain('c');
      expect(grid.join(''), `${pose} lost the shadow tone`).toContain('s');
      // Ears and the visor band are the recognition features.
      expect(grid.some((r) => r.includes('ww..ww')), `${pose} lost the ears`).toBe(true);
      expect(grid.some((r) => r.includes('dddddd')), `${pose} lost the visor`).toBe(true);
    }
  });

  it('state changes do NOT replace the mascot — one identity, many poses', () => {
    for (const state of states) {
      const html = renderState(state);
      // The same component, the same accessible name prefix, every time.
      expect(html, state).toContain('Relay Dog:');
      expect(html, state).toContain('rpd-art');
    }
    // No state-specific dog component exists.
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    expect(decorSource).not.toContain('POSES');
    expect(decorSource).not.toMatch(/'\.{9}ww\.\.ww/);
  });

  it('the operational states introduce no second palette or hardcoded dog', () => {
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    // The scenery may have its own scenery colours, but it must not restate the
    // DOG's palette — that is what would fork the identity and break a future
    // PSP recolour.
    for (const hex of ['#ece9e2', '#b9b5ab', '#f2c14e', '#d9a441']) {
      expect(decorSource, `decor restates the dog palette ${hex}`).not.toContain(hex);
    }
  });

  /**
   * PSP colourway customization is a documented FUTURE capability: a PSP may
   * eventually override `OFFICIAL_RELAY_DOG_PALETTE`, and every pose must
   * recolour with it. Three new poses are three new chances to hardcode a
   * colour and quietly break that seam, so the seam is asserted directly.
   */
  it('the PSP recolour seam still reaches all three new poses', () => {
    const sprite = readFileSync(
      join(dir, '..', '..', 'shared', 'official-relay-dog-sprite.ts'),
      'utf8',
    );
    // Poses are PIXEL KEYS, never colours: a pose grid may only contain the
    // palette's key letters, so recolouring the palette recolours every pose.
    for (const pose of ['sleeping', 'digging', 'coding'] as const) {
      for (const row of OFFICIAL_RELAY_DOG_POSES[pose]) {
        expect(/^[.wsdyc]+$/.test(row), `${pose} row "${row}" is not pure palette keys`).toBe(true);
        expect(row, `${pose} hardcodes a colour`).not.toMatch(/#[0-9a-f]{3,6}/i);
      }
    }
    // And there is exactly ONE palette to override.
    expect(sprite).toContain('OFFICIAL_RELAY_DOG_PALETTE');
    const paletteCount = (sprite.match(/OFFICIAL_RELAY_DOG_PALETTE\s*[:=]/g) ?? []).length;
    expect(paletteCount, 'more than one palette definition would fork the identity').toBeLessThanOrEqual(1);
  });

  it('the animation never touches agent identity or mission facts', () => {
    for (const file of ['RelayDogOperationalDecor.tsx', 'RelayDogMotionBoundary.tsx']) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const forbidden of [
        'actualAgentId',
        'requestedAgentId',
        'appendTrace',
        'capsule',
        'budget',
        'pspId',
      ]) {
        // Only assignment/call shapes are forbidden — the animation may name a
        // concept in a comment, it may never write one.
        expect(
          new RegExp(`${forbidden}\\s*[=:]\\s*[^\\s]`).test(source)
            && !source.includes('lines:'),
          `${file} appears to write ${forbidden}`,
        ).toBe(false);
      }
    }
  });
});

/* ============================================================= REGRESSION */

describe('REGRESSION — untouched states stay untouched', () => {
  it('idle, researching, handoff, verifying, complete and error are unchanged', () => {
    const expected: Array<[WorkspaceDogState, string, string]> = [
      ['wandering', 'standing', 'WANDERING'],
      ['trotting', 'trotting', 'TROTTING'],
      ['researching', 'sitting', 'RESEARCHING'],
      ['carrying_handoff', 'carrying', 'CARRYING HANDOFF'],
      ['verifying', 'standing', 'VERIFYING'],
      ['waiting_for_user', 'sitting', 'WAITING FOR USER'],
      ['complete', 'sitting', 'COMPLETE'],
      ['stopped_safely', 'lying', 'STOPPED SAFELY'],
    ];
    for (const [state, pose, label] of expected) {
      expect(DOG_PRESENTATION[state].pose, state).toBe(pose);
      expect(DOG_PRESENTATION[state].label, state).toBe(label);
    }
  });

  it('only reviewing and repairing carry scenery — no other state does', () => {
    for (const state of [
      'wandering', 'trotting', 'researching', 'carrying_handoff',
      'verifying', 'waiting_for_user', 'complete', 'stopped_safely',
    ] as WorkspaceDogState[]) {
      const html = renderState(state);
      expect(html, state).not.toContain('rdo--sleep');
      expect(html, state).not.toContain('rdo--dig');
      expect(html, state).not.toContain('rdo--code');
    }
  });

  it('COMPLETE keeps its check and remains the only state that shows one', () => {
    expect(DOG_PRESENTATION.complete.marker).toBe('check');
    expect(renderState('complete')).toContain('rpd-marker--check');
    for (const state of ['reviewing', 'repairing', 'implementing'] as WorkspaceDogState[]) {
      expect(renderState(state), state).not.toContain('rpd-marker--check');
    }
  });

  it('idle patrol still belongs to idle alone', () => {
    expect(projectWorkspaceDogBehavior('wandering').patrolEnabled).toBe(true);
    for (const state of ['reviewing', 'repairing', 'implementing'] as WorkspaceDogState[]) {
      expect(projectWorkspaceDogBehavior(state).patrolEnabled, state).toBe(false);
    }
  });

  it('the decor never intercepts a click, so mission controls stay reachable', () => {
    expect(css).toMatch(/\.rdo\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('adds no animation framework and no heavy asset', () => {
    const pkg = JSON.parse(readFileSync(join(dir, '..', '..', '..', '..', 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['framer-motion', 'gsap', 'lottie-web', 'three', 'anime.js', 'react-spring']) {
      expect(deps[banned], `${banned} was added`).toBeUndefined();
    }
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    expect(decorSource).not.toContain('requestAnimationFrame');
    expect(decorSource).not.toContain('setInterval');
    expect(decorSource).not.toContain('setTimeout');
    expect(decorSource).not.toContain('useState');
    // Real canvas/WebGL USAGE, not the word in a comment.
    expect(decorSource).not.toMatch(/<canvas|getContext\(|WebGL/);
    // No video and no raster animation, at any size.
    expect(decorSource).not.toMatch(/<video|<img|\.gif|\.mp4|\.webm/i);
    expect(css).not.toMatch(/url\([^)]*\.(gif|mp4|webm|png|jpe?g)/i);
  });

  it('every operational keyframe animates only compositor properties', () => {
    // transform/opacity are composited; width/height/top/left/margin force
    // layout on every frame, which is what makes a decorative loop expensive.
    const LAYOUT = /\b(width|height|top|left|right|bottom|margin|padding|font-size)\s*:/;
    const names = [
      'rdm-sleep-breathe', 'rdm-sleep-twitch', 'rdo-z-drift',
      'rdm-dig-lunge', 'rdm-dig-paws', 'rdo-clod-fly',
      'rdm-code-type', 'rdm-code-paws',
      'rdm-enter-sleep', 'rdm-enter-dig', 'rdm-enter-code',
    ];
    for (const name of names) {
      const block = keyframes(name);
      expect(block, `${name} is missing`).not.toBe('');
      expect(LAYOUT.test(block), `${name} animates a layout property`).toBe(false);
    }
  });

  it('the scene is responsive and cannot overflow horizontally', () => {
    // The boundary already clips its own track; the decor is absolutely
    // positioned inside it and clipped too.
    expect(css).toMatch(/\.rdm\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(css).toMatch(/\.rdo\s*\{[^}]*overflow:\s*hidden/s);
    // A phone breakpoint keeps the remaining scenery legible rather than
    // letting it shrink without bound.
    expect(css).toContain('@media (max-width: 480px)');
    const phone = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(phone).toContain('.rdo--sleep .rdo-z');
    expect(phone).toMatch(/font-size:\s*[\d.]+px/);
  });
});

/* ============================================================ TRANSITIONS */

describe('TRANSITIONS between the three states feel connected', () => {
  it('each operational state plays exactly one short enter beat', () => {
    for (const [name, max] of [
      ['rdm-enter-sleep', 0.6],
      ['rdm-enter-dig', 0.6],
      ['rdm-enter-code', 0.6],
    ] as const) {
      expect(css, `${name} is missing`).toContain(`@keyframes ${name}`);
      const used = css.match(new RegExp(`${name}\\s+([\\d.]+)s[^;]*\\b1\\b`));
      expect(used, `${name} is not played once`).not.toBeNull();
      expect(Number(used?.[1]), `${name} is too slow to read the state`).toBeLessThanOrEqual(max);
    }
  });

  it('the enter beats stop under reduced motion like every other loop', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\.rdm-body--reviewing[\s\S]*?animation:\s*none/,
    );
  });

  /**
   * "Transitions must not delay the truthful state display." A transition is
   * allowed to move the dog; it is not allowed to hide, fade in, or postpone
   * the STATE the operator is being told.
   */
  it('the truthful state is displayed immediately, not animated in', () => {
    for (const [state, label] of [
      ['reviewing', 'REVIEWING'],
      ['repairing', 'REPAIRING'],
      ['implementing', 'IMPLEMENTING'],
    ] as const) {
      const html = renderState(state);
      // The label is in the FIRST paint — no JS gate, no delay, no placeholder.
      expect(html, `${state} must show its label immediately`).toContain(label);
      expect(html, `${state} must not paint a transitional placeholder`).not.toMatch(/TRANSITION|LOADING|…&nbsp;/);
      // Nothing is rendered hidden or fully transparent while a beat plays.
      expect(html, `${state} paints hidden`).not.toMatch(/opacity:\s*0[^.]/);
      expect(html, `${state} paints invisible`).not.toMatch(/visibility:\s*hidden/);
    }
  });

  it('no enter beat animates opacity, so nothing fades in over the state', () => {
    for (const name of ['rdm-enter-sleep', 'rdm-enter-dig', 'rdm-enter-code']) {
      const block = keyframes(name);
      expect(block, `${name} is missing`).not.toBe('');
      expect(block, `${name} fades the dog in and delays the state`).not.toContain('opacity');
      // Transform-only, which is what keeps the beat cheap AND non-hiding.
      expect(block).toMatch(/transform:/);
    }
  });

  it('every enter beat is shorter than the shortest state loop it accompanies', () => {
    // A beat that outlasts its loop would read as the state's own motion.
    const beats = [
      ['rdm-enter-sleep', 'rdm-sleep-breathe'],
      ['rdm-enter-dig', 'rdm-dig-lunge'],
      ['rdm-enter-code', 'rdm-code-type'],
    ] as const;
    for (const [beat, loop] of beats) {
      const beatSeconds = Number(css.match(new RegExp(`${beat}\\s+([\\d.]+)s`))?.[1]);
      const loopSeconds = Number(css.match(new RegExp(`${loop}\\s+([\\d.]+)s`))?.[1]);
      expect(Number.isFinite(beatSeconds), `${beat} has no duration`).toBe(true);
      expect(Number.isFinite(loopSeconds), `${loop} has no duration`).toBe(true);
      expect(beatSeconds, `${beat} outlasts ${loop}`).toBeLessThan(loopSeconds);
    }
  });
});
