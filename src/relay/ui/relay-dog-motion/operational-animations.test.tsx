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
 * Relay Dog OPERATIONAL ANIMATIONS — the five states the founder asked to be
 * readable without the label:
 *
 *   implementing — up on its tippy toes, paws raised, no code panel beside it
 *   researching  — a newspaper riding on its back while it reads
 *   verifying    — its tail going back and forth
 *   reviewing    — lying down asleep, with the Z marks drifting up
 *   repairing    — digging the floor, with the hole, the mound and the dirt
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

const decor = (
  activity: 'reviewing' | 'repairing' | 'implementing' | 'researching' | 'verifying',
  reducedMotion = false,
) => renderToStaticMarkup(createElement(RelayDogOperationalDecor, { activity, reducedMotion }));

/** One CSS rule body, brace-balanced, for a selector that appears verbatim. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

/** Every vertical offset in a keyframes block, in px — `translateY(n)` and the
 *  y of `translate(x, y)` alike. Positive is DOWN, as in CSS. */
function verticalOffsets(name: string): number[] {
  const block = keyframes(name);
  return [
    ...[...block.matchAll(/translateY\((-?[\d.]+)px\)/g)].map((m) => Number(m[1])),
    ...[...block.matchAll(/translate\([^,)]+,\s*(-?[\d.]+)px\)/g)].map((m) => Number(m[1])),
  ];
}

/** Every scaleY factor in a keyframes block. */
function scaleYFactors(name: string): number[] {
  return [...keyframes(name).matchAll(/scaleY\(([\d.]+)\)/g)].map((m) => Number(m[1]));
}

/** Every rotation in a keyframes block, in degrees. */
function rotations(name: string): number[] {
  return [...keyframes(name).matchAll(/rotate\((-?[\d.]+)deg\)/g)].map((m) => Number(m[1]));
}

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

describe('REVIEWING — the dog lies down and sleeps', () => {
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

  /**
   * The founder asked for a dog that is LYING DOWN, not one that snoozes on
   * its feet. The sleeping sprite is already curled with its eyes shut; what
   * the motion layer owes is the settle onto the ground — and it must hold it
   * for the WHOLE loop, so there is no frame in which the dog stands back up.
   *
   * It has to settle on the SPRITE layer. `.rdm-body` carries the dog's own
   * floor and caption with it, so a settle there moves the ground down too and
   * the dog never actually reaches it.
   */
  it('settles the dog down onto the ground and keeps it there', () => {
    expect(css).toMatch(
      /\.rdm-body--reviewing \.rpd-art\s*\{[^}]*animation:\s*rdm-sleep-twitch/s,
    );
    const offsets = verticalOffsets('rdm-sleep-twitch');
    expect(offsets.length, 'the sleeping sprite declares no settle').toBeGreaterThan(0);
    // Every stop is BELOW the standing baseline, by a visible amount.
    for (const y of offsets) {
      expect(y, `the sleep loop stands the dog back up at ${y}px`).toBeGreaterThanOrEqual(3);
    }
    // And it flattens rather than stretching — a dog on the floor, not sitting.
    const scales = scaleYFactors('rdm-sleep-twitch');
    expect(scales.length).toBeGreaterThan(0);
    for (const s of scales) expect(s, 'the sleeping dog is not settled').toBeLessThan(0.95);
    // The whole-figure breath stays small: the indicator breathes, the ground
    // under it does not heave.
    for (const y of verticalOffsets('rdm-sleep-breathe')) expect(Math.abs(y)).toBeLessThanOrEqual(2);
  });

  it('draws the ground the dog has settled onto, in both motion modes', () => {
    for (const reducedMotion of [false, true]) {
      expect(decor('reviewing', reducedMotion)).toContain('rdo-rest');
    }
    // Static scenery: the rest patch never animates, in either mode.
    expect(css).toMatch(/\.rdo--sleep \.rdo-rest\s*\{(?:(?!\}).)*\}/su);
    expect(ruleBody('.rdo--sleep .rdo-rest')).not.toContain('animation');
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
    expect(sentence).toBe('Relay Dog is lying down asleep while the mission is under review.');
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
    // Held settled and flattened: still lying down with nothing moving.
    expect(css).toMatch(
      /\.rdm--reduced \.rdm-body--reviewing \.rpd-art\s*\{[^}]*transform:\s*translate\(0,\s*[\d.]+px\)\s*scaleY/s,
    );
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

  /**
   * The first dig moved 1.5px and read as a shiver — the founder could not
   * tell what the animation was. A dig has to be big enough to see: the front
   * end drives DOWN into the floor and the paws rake back a real distance.
   */
  it('digs hard enough to read as digging, not as a shiver', () => {
    // The dig belongs to the SPRITE: the ground it is digging must not move
    // with it, so the stroke lives on .rpd-art and not on the whole figure.
    expect(css).toMatch(/\.rdm-body--repairing \.rpd-art\s*\{[^}]*animation:\s*rdm-dig-paws/s);
    // Paws rake a real distance, both ways, rather than twitching.
    const rakes = [...keyframes('rdm-dig-paws').matchAll(/translate\((-?[\d.]+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...rakes.map(Math.abs)), 'the paw scrape is too small to see')
      .toBeGreaterThanOrEqual(3);
    // The front end drives DOWN into the floor on every stroke.
    const drops = verticalOffsets('rdm-dig-paws').filter((y) => y > 0);
    expect(drops.length, 'the dig never drives into the floor').toBeGreaterThan(0);
    expect(Math.max(...drops), 'the dig is too shallow to read').toBeGreaterThanOrEqual(3);
    // And the nose pitches over the hole, not a fraction of a degree.
    const angles = rotations('rdm-dig-paws').map(Math.abs);
    expect(Math.max(...angles), 'the dog barely leans into the hole').toBeGreaterThanOrEqual(4);
    // The whole figure only leans in — its floor and label must not tip.
    for (const a of rotations('rdm-dig-lunge')) {
      expect(Math.abs(a), 'the whole scene tips with the dig').toBeLessThanOrEqual(2.5);
    }
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
    // The held pose still reads as digging rather than standing: the figure
    // leans in and the sprite is held nose-down with its paws back.
    expect(css).toMatch(/\.rdm--reduced \.rdm-body--repairing\s*\{[^}]*transform:\s*translateY/s);
    expect(css).toMatch(
      /\.rdm--reduced \.rdm-body--repairing \.rpd-art\s*\{[^}]*transform:\s*translate\(-[\d.]+px,\s*[\d.]+px\)\s*rotate/s,
    );
  });
});

/* ========================================================== IMPLEMENTING */

describe('IMPLEMENTING — the dog is up on its tippy toes, with no code panel', () => {
  /**
   * The founder's words: "the dog is on its tippy toes and its arms are up".
   * That STANCE is sprite art, and the sprite already has it: `reaching` is the
   * pose drawn up on the hind toes with both forepaws lifted. Implementing must
   * be drawn in it — no motion layer can lift a seated dog's arms.
   */
  it('draws implementing in the tippy-toe, paws-raised pose', () => {
    expect(DOG_PRESENTATION.implementing.pose).toBe('reaching');
    const view = officialRelayDogViewForState('implementing');
    expect(view.activity).toBe('implementing');
    expect(view.pose).toBe('reaching');
    // The motion NAME is shared identity, mirrored by the CLI and pinned by the
    // parity capability — the website does not rename it from its own layer.
    expect(view.motion).toBe('code_progression');
    // And it is the official sprite's raised stance, not a new drawing: the
    // forepaws sit ABOVE the collar row rather than below it.
    const reaching = OFFICIAL_RELAY_DOG_POSES.reaching;
    const collarRow = reaching.findIndex((r) => r.includes('c'));
    expect(collarRow, 'the reaching pose lost its collar').toBeGreaterThan(-1);
    expect(reaching[collarRow], 'the raised forepaws are missing').toMatch(/ww\.$|\.ww\./);
  });

  it('renders the dog in the reaching pose with its own raised-stance loop', () => {
    const html = renderState('implementing');
    expect(html).toContain('rdm-body--implementing');
    expect(html).toContain('rpd--reaching');
    expect(html, 'implementing still draws the seated coding pose').not.toContain('rpd--coding');
    expect(css).toContain('@keyframes rdm-code-type');
    expect(css).toContain('@keyframes rdm-code-paws');
    // The pose brings its own rise-and-settle with it.
    expect(css).toMatch(/\.rpd--reaching\s*\{[^}]*animation:\s*rdm-tiptoe-reach/s);
  });

  /**
   * The pose puts the dog on its toes; the motion has to KEEP it there. A loop
   * that returns to the ground on every cycle is a bob, not a stance.
   */
  it('holds the dog clear of the floor for the whole loop, never flat', () => {
    // The lift belongs to the SPRITE: on the figure layer it would take the
    // dog's own floor up with it and the dog would never leave the ground.
    expect(css).toMatch(/\.rdm-body--implementing \.rpd-art\s*\{[^}]*animation:\s*rdm-code-paws/s);
    const offsets = verticalOffsets('rdm-code-paws');
    expect(offsets.length, 'the implementing stance declares no rise').toBeGreaterThan(0);
    for (const y of offsets) {
      expect(y, `the implementing stance drops the dog flat at ${y}px`).toBeLessThanOrEqual(-2);
    }
    // It stretches upward onto its toes rather than squashing down.
    const scales = scaleYFactors('rdm-code-paws');
    expect(scales.length).toBeGreaterThan(0);
    for (const s of scales) expect(s, 'the dog is not stretched up').toBeGreaterThan(1);
    // The reach pushes higher than the held stance — paws working, not frozen.
    expect(Math.min(...offsets), 'the paws never reach any higher').toBeLessThan(Math.max(...offsets));
    // The whole-figure beat stays small: the ground under the dog holds still.
    for (const y of verticalOffsets('rdm-code-type')) expect(Math.abs(y)).toBeLessThanOrEqual(2);
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
    expect(sentence).toBe('Relay Dog is up on its toes, paws raised, implementing the work.');
    expect(sentence).not.toMatch(/complete|finished|done|verified/i);
  });

  it('reduced motion holds the dog STILL, and still up on its toes', () => {
    const html = renderState('implementing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--reaching');
    // The reduced-motion fallback label still names the state in words.
    expect(html).toContain(projectWorkspaceDogBehavior('implementing').reducedMotionFallback);
    // Held at the top of the rise — a raised dog, not a standing one.
    expect(css).toMatch(
      /\.rdm--reduced \.rdm-body--implementing \.rpd-art\s*\{[^}]*transform:\s*translate\(0,\s*-[\d.]+px\)/s,
    );
  });
});

/* =========================================================== RESEARCHING */

describe('RESEARCHING — the dog carries a newspaper on its back', () => {
  it('draws the newspaper, on the dog, in both motion modes', () => {
    for (const reducedMotion of [false, true]) {
      const html = renderState('researching', reducedMotion);
      expect(html, 'the newspaper is missing').toContain('rdo--news');
      expect(html).toContain('rdo-news');
      // On the DOG's own box, not stranded out in the patrol track.
      expect(ruleBody('.rdo')).toMatch(/width:\s*\d+px/);
      expect(ruleBody('.rdo')).toMatch(/height:\s*\d+px/);
    }
  });

  it('the newspaper is decoration: aria-hidden, and it carries no words', () => {
    const html = decor('researching');
    expect(html).toContain('aria-hidden="true"');
    expect(html.indexOf('aria-hidden="true"')).toBeLessThan(html.indexOf('rdo-news'));
    // A decorative sheet, never readable text that could be mistaken for a
    // finding, a headline, or a result.
    expect(html).not.toMatch(/>[^<]*[A-Za-z]{3}[^<]*</);
  });

  it('is NOT the handoff: a delivery and a reading are different states', () => {
    const research = renderState('researching');
    const handoff = renderState('carrying_handoff');
    expect(DOG_PRESENTATION.researching.pose).toBe('sitting');
    expect(DOG_PRESENTATION.carrying_handoff.pose).toBe('carrying');
    // The handoff never grows a newspaper, and researching never travels.
    expect(handoff, 'the handoff drew the newspaper').not.toContain('rdo--news');
    expect(research).toContain('RESEARCHING');
    expect(projectWorkspaceDogBehavior('researching').patrolEnabled).toBe(false);
    // Newsprint tones only — the decor never restates the dog's gold.
    expect(ruleBody('.rdo--news .rdo-news')).not.toContain('#d9a441');
  });

  it('reading is not a finding: no outcome, no check, no result', () => {
    const html = renderState('researching');
    expect(html).not.toContain('rpd-marker--check');
    for (const word of OUTCOME_WORDS) {
      expect(html, `researching must not render "${word}"`).not.toContain(word);
    }
    const sentence = operationalActivityDescription('researching');
    expect(sentence).toBe('Relay Dog is reading up on the mission with a newspaper on its back.');
    expect(sentence).not.toMatch(/found|proved|confirmed|verified|complete/i);
  });

  it('reduced motion holds the newspaper still, on the back', () => {
    const html = renderState('researching', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rdo-news');
    expect(css).toMatch(/\.rdm--reduced[^@]*\.rdo-news[^{]*\{[^}]*animation:\s*none/su);
    // The angle that puts it ON the back survives with the motion stopped.
    expect(ruleBody('.rdo--news .rdo-news')).toMatch(/transform:\s*rotate\(-?[\d.]+deg\)/);
  });
});

/* ============================================================= VERIFYING */

describe('VERIFYING — the tail goes back and forth', () => {
  it('wags: the body swings on the beat, and the sweep is marked both ways', () => {
    const html = renderState('verifying');
    expect(html).toContain('rdm-body--verifying');
    expect(html).toContain('rdo--wag');
    // Two sweeps: one for each side the tail travels to.
    expect((html.match(/rdo-wag--/g) ?? []).length).toBe(2);
    expect(keyframes('rdm-tail-wag'), 'rdm-tail-wag is missing').not.toBe('');
    // The swing is on the SPRITE, pivoting at its front feet, so the tail end
    // travels furthest — and the caption and floor do not tilt with it.
    expect(css).toMatch(/\.rdm-body--verifying \.rpd-art\s*\{[^}]*animation:\s*rdm-tail-wag/s);
    expect(ruleBody('.rdm-body--verifying .rpd-art')).toMatch(/transform-origin:\s*\d+%\s+bottom/);
    const angles = rotations('rdm-tail-wag');
    // BACK and FORTH — a negative angle and a positive one, not one lean.
    expect(Math.min(...angles), 'the tail never travels one way').toBeLessThan(0);
    expect(Math.max(...angles), 'the tail never travels the other way').toBeGreaterThan(0);
    // Quick, the way a wag is quick.
    const seconds = Number(css.match(/rdm-tail-wag\s+([\d.]+)s/)?.[1]);
    expect(seconds).toBeGreaterThan(0.2);
    expect(seconds).toBeLessThanOrEqual(1);
  });

  it('the wag never drifts the dog along the patrol track', () => {
    expect(keyframes('rdm-tail-wag')).not.toContain('translateX');
    expect(projectWorkspaceDogBehavior('verifying').patrolEnabled).toBe(false);
  });

  it('the sweep marks are decoration, aria-hidden, and few', () => {
    const html = decor('verifying');
    expect(html).toContain('aria-hidden="true"');
    expect(html.indexOf('aria-hidden="true"')).toBeLessThan(html.indexOf('rdo-wag'));
    expect((html.match(/rdo-wag--/g) ?? []).length).toBeLessThanOrEqual(4);
  });

  /**
   * The most dangerous state on this list. A wagging dog reads as HAPPY, and
   * happy must never be mistaken for PASSED — verification is still running.
   */
  it('a wagging tail NEVER means verification passed', () => {
    const html = renderState('verifying');
    expect(DOG_PRESENTATION.verifying.marker).toBe('question');
    expect(DOG_PRESENTATION.verifying.marker).not.toBe('check');
    expect(html).not.toContain('rpd-marker--check');
    expect(html).toContain('VERIFYING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `verifying must not render "${word}"`).not.toContain(word);
    }
    const sentence = operationalActivityDescription('verifying');
    expect(sentence).toBe('Relay Dog is waiting with its tail wagging while verification runs.');
    expect(sentence).not.toMatch(/verified|passed|approved|complete|success/i);
    // And no green anywhere in the wag scenery — green is the check's colour.
    expect(ruleBody('.rdo--wag .rdo-wag')).not.toMatch(/#6fbf73|green/i);
  });

  it('reduced motion holds ONE sweep and a tail carried to one side', () => {
    const html = renderState('verifying', true);
    expect(html).toContain('rdm--reduced');
    expect((html.match(/rdo-wag--/g) ?? []).length).toBe(1);
    expect(css).toMatch(/\.rdm--reduced[^@]*\.rdo-wag[^{]*\{[^}]*animation:\s*none/su);
    expect(css).toMatch(
      /\.rdm--reduced \.rdm-body--verifying \.rpd-art\s*\{[^}]*transform:\s*rotate/s,
    );
  });
});

/* =============================================================== IDENTITY */

describe('OFFICIAL RELAY DOG identity survives all five states', () => {
  const states: WorkspaceDogState[] = [
    'reviewing',
    'repairing',
    'implementing',
    'researching',
    'verifying',
  ];

  it('every operational pose is the official 18x14 dog with the official palette', () => {
    for (const pose of ['sleeping', 'digging', 'reaching', 'sitting', 'standing'] as const) {
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
   * recolour with it. Every pose an operational state draws is another chance
   * to hardcode a colour and quietly break that seam, so it is asserted here.
   */
  it('the PSP recolour seam still reaches every operational pose', () => {
    const sprite = readFileSync(
      join(dir, '..', '..', 'shared', 'official-relay-dog-sprite.ts'),
      'utf8',
    );
    // Poses are PIXEL KEYS, never colours: a pose grid may only contain the
    // palette's key letters, so recolouring the palette recolours every pose.
    for (const pose of ['sleeping', 'digging', 'reaching', 'sitting', 'standing'] as const) {
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

  /**
   * Each state carries ONLY its own scenery. Four states have some; every
   * other state has none, and implementing still has none at all — the code
   * panel the founder removed cannot come back through another state's door.
   */
  it('each state carries only its own scenery, and no other state has any', () => {
    const SCENERY = ['rdo--sleep', 'rdo--dig', 'rdo--news', 'rdo--wag', 'rdo--code'] as const;
    const owned: Partial<Record<WorkspaceDogState, string>> = {
      reviewing: 'rdo--sleep',
      repairing: 'rdo--dig',
      researching: 'rdo--news',
      verifying: 'rdo--wag',
    };
    for (const state of [
      'wandering', 'trotting', 'implementing', 'researching', 'carrying_handoff',
      'verifying', 'reviewing', 'repairing', 'waiting_for_user', 'complete', 'stopped_safely',
    ] as WorkspaceDogState[]) {
      const html = renderState(state);
      for (const hook of SCENERY) {
        if (owned[state] === hook) expect(html, `${state} lost ${hook}`).toContain(hook);
        else expect(html, `${state} drew ${hook}`).not.toContain(hook);
      }
    }
  });

  it('COMPLETE keeps its check and remains the only state that shows one', () => {
    expect(DOG_PRESENTATION.complete.marker).toBe('check');
    expect(renderState('complete')).toContain('rpd-marker--check');
    for (const state of [
      'reviewing', 'repairing', 'implementing', 'researching', 'verifying',
    ] as WorkspaceDogState[]) {
      expect(renderState(state), state).not.toContain('rpd-marker--check');
    }
  });

  it('idle patrol still belongs to idle alone', () => {
    expect(projectWorkspaceDogBehavior('wandering').patrolEnabled).toBe(true);
    for (const state of [
      'reviewing', 'repairing', 'implementing', 'researching', 'verifying',
    ] as WorkspaceDogState[]) {
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
      'rdm-read-settle', 'rdo-news-ride',
      'rdm-tail-wag', 'rdo-wag-sweep',
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
